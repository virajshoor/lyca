import { Expr, FnDecl, Stmt, TypeAst } from "../ast";
import { CompileError } from "../diagnostics";
import { CheckedProgram, FerraType } from "../typechecker";

export function codegen(checked: CheckedProgram, filename: string): string {
  return new Emitter(checked, filename).emit();
}

class Emitter {
  header: string[] = [];
  strs: string[] = [];
  body: string[] = [];
  tmp = 0;
  lab = 0;
  terminated = false;
  locals = new Map<string, { ptr: string; ir: string }>();
  fnName = "";

  constructor(
    private checked: CheckedProgram,
    private filename: string,
  ) {}

  emit(): string {
    this.header.push(`; ModuleID = '${this.filename}'`);
    this.header.push(`source_filename = "${this.filename}"`);
    this.header.push("%String = type { ptr, i64 }");
    for (const st of this.checked.structs.values()) {
      this.header.push(`%${st.name} = type { ${st.fields.map((f) => this.irType(f.type)).join(", ")} }`);
    }
    this.header.push("declare i32 @puts(ptr noundef)");
    this.header.push("");
    this.header.push("define i32 @print(%String %s) {");
    this.header.push("entry:");
    this.header.push("  %p = extractvalue %String %s, 0");
    this.header.push("  %r = call i32 @puts(ptr %p)");
    this.header.push("  ret i32 0");
    this.header.push("}");
    this.header.push("");
    const fns: string[] = [];
    for (const d of this.checked.ast.decls) {
      if (d.kind === "fn") fns.push(this.emitFn(d));
    }
    return [...this.header, ...fns, ...this.strs].join("\n") + "\n";
  }

  private emitFn(fn: FnDecl): string {
    const info = this.checked.fns.get(fn.name)!;
    this.fnName = fn.name;
    this.tmp = 0;
    this.lab = 0;
    this.terminated = false;
    this.locals = new Map();
    this.body = [];
    const params = info.params.map((p, i) => `${this.irType(p.type)} %p${i}`).join(", ");
    const out = [`define ${this.irType(info.ret)} @${fn.name}(${params}) {`, "entry:"];
    info.params.forEach((p, i) => {
      const ptr = this.alloca(this.irType(p.type));
      this.store(this.irType(p.type), `%p${i}`, ptr);
      this.locals.set(p.name, { ptr, ir: this.irType(p.type) });
    });
    for (const s of fn.body) this.emitStmt(s);
    if (!this.terminated) this.body.push(`  ret ${this.irType(info.ret)} ${this.zero(info.ret)}`);
    out.push(...this.body, "}", "");
    return out.join("\n");
  }

  private emitStmt(stmt: Stmt) {
    if (this.terminated) return;
    switch (stmt.kind) {
      case "let": {
        const ty = astType(stmt.type);
        const ir = this.irType(ty);
        const ptr = this.alloca(ir);
        const v = this.emitExpr(stmt.value, ty);
        this.store(ir, v.ref, ptr);
        this.locals.set(stmt.name, { ptr, ir });
        break;
      }
      case "assign": {
        const dest = this.lvalue(stmt.target);
        const v = this.emitExpr(stmt.value, dest.ty);
        this.store(dest.ir, v.ref, dest.ptr);
        break;
      }
      case "return": {
        const ret = this.checked.fns.get(this.fnName)!.ret;
        const v = this.emitExpr(stmt.value, ret);
        this.body.push(`  ret ${this.irType(ret)} ${v.ref}`);
        this.terminated = true;
        break;
      }
      case "if": {
        const t = this.label("then");
        const f = this.label("else");
        const end = this.label("endif");
        const c = this.emitExpr(stmt.cond, { kind: "bool" });
        const hasElse = stmt.else_ !== null;
        this.body.push(`  br i1 ${c.ref}, label %${t}, label %${hasElse ? f : end}`);
        this.place(t);
        for (const s of stmt.then) this.emitStmt(s);
        const thenTerm = this.terminated;
        if (!thenTerm) this.body.push(`  br label %${end}`);
        let elseTerm = true;
        if (hasElse) {
          this.place(f);
          for (const s of stmt.else_!) this.emitStmt(s);
          elseTerm = this.terminated;
          if (!elseTerm) this.body.push(`  br label %${end}`);
        } else {
          elseTerm = false;
        }
        if (thenTerm && elseTerm) {
          this.terminated = true;
          return;
        }
        this.place(end);
        break;
      }
      case "while": {
        const h = this.label("wh");
        const b = this.label("wbody");
        const e = this.label("wend");
        this.body.push(`  br label %${h}`);
        this.place(h);
        const c = this.emitExpr(stmt.cond, { kind: "bool" });
        this.body.push(`  br i1 ${c.ref}, label %${b}, label %${e}`);
        this.place(b);
        for (const s of stmt.body) this.emitStmt(s);
        if (!this.terminated) this.body.push(`  br label %${h}`);
        this.place(e);
        break;
      }
      case "for": {
        const ptr = this.alloca("i32");
        const start = this.emitExpr(stmt.start, { kind: "i32" });
        this.store("i32", start.ref, ptr);
        this.locals.set(stmt.name, { ptr, ir: "i32" });
        const endv = this.emitExpr(stmt.end, { kind: "i32" });
        const h = this.label("forh");
        const b = this.label("forb");
        const e = this.label("fore");
        this.body.push(`  br label %${h}`);
        this.place(h);
        const i = this.t();
        this.body.push(`  ${i} = load i32, ptr ${ptr}`);
        const cmp = this.t();
        this.body.push(`  ${cmp} = icmp slt i32 ${i}, ${endv.ref}`);
        this.body.push(`  br i1 ${cmp}, label %${b}, label %${e}`);
        this.place(b);
        for (const s of stmt.body) this.emitStmt(s);
        if (!this.terminated) {
          const iv = this.t();
          this.body.push(`  ${iv} = load i32, ptr ${ptr}`);
          const n = this.t();
          this.body.push(`  ${n} = add nsw i32 ${iv}, 1`);
          this.store("i32", n, ptr);
          this.body.push(`  br label %${h}`);
        }
        this.place(e);
        this.locals.delete(stmt.name);
        break;
      }
      case "expr":
        this.emitExpr(stmt.expr, null);
        break;
    }
  }

  private emitExpr(expr: Expr, expected: FerraType | null): { ref: string; ir: string; ty: FerraType } {
    switch (expr.kind) {
      case "int": {
        const ty: FerraType = expected?.kind === "i64" ? { kind: "i64" } : { kind: "i32" };
        return { ref: expr.raw, ir: this.irType(ty), ty };
      }
      case "float": {
        const ty: FerraType = expected?.kind === "f32" ? { kind: "f32" } : { kind: "f64" };
        return { ref: Number(expr.raw).toExponential(16), ir: this.irType(ty), ty };
      }
      case "bool":
        return { ref: expr.value ? "true" : "false", ir: "i1", ty: { kind: "bool" } };
      case "string": {
        const buf = Buffer.from(expr.value, "utf8");
        const bytes = [...buf, 0];
        const name = `@str.${this.strs.length}`;
        const hex = bytes.map((b) => "\\" + b.toString(16).padStart(2, "0")).join("");
        this.strs.push(`${name} = private unnamed_addr constant [${bytes.length} x i8] c"${hex}"`);
        const s0 = this.t();
        this.body.push(`  ${s0} = getelementptr [${bytes.length} x i8], ptr ${name}, i32 0, i32 0`);
        const s1 = this.t();
        this.body.push(`  ${s1} = insertvalue %String undef, ptr ${s0}, 0`);
        const s2 = this.t();
        this.body.push(`  ${s2} = insertvalue %String ${s1}, i64 ${buf.length}, 1`);
        return { ref: s2, ir: "%String", ty: { kind: "string" } };
      }
      case "name": {
        const loc = this.requireLocal(expr.name);
        const r = this.t();
        this.body.push(`  ${r} = load ${loc.ir}, ptr ${loc.ptr}`);
        const ty = irToType(loc.ir);
        return { ref: r, ir: loc.ir, ty };
      }
      case "unary": {
        if (expr.op === "not") {
          const v = this.emitExpr(expr.expr, { kind: "bool" });
          const r = this.t();
          this.body.push(`  ${r} = xor i1 ${v.ref}, true`);
          return { ref: r, ir: "i1", ty: { kind: "bool" } };
        }
        const v = this.emitExpr(expr.expr, expected);
        const r = this.t();
        if (v.ir === "float" || v.ir === "double") this.body.push(`  ${r} = fneg ${v.ir} ${v.ref}`);
        else this.body.push(`  ${r} = sub ${v.ir} 0, ${v.ref}`);
        return { ref: r, ir: v.ir, ty: v.ty };
      }
      case "borrow":
        return this.emitExpr(expr.expr, expected?.kind === "ref" ? expected.inner : expected);
      case "binary":
        return this.emitBinary(expr, expected);
      case "call": {
        const fn = this.checked.fns.get(expr.callee)!;
        const args = expr.args.map((a, i) => {
          const want = fn.params[i]!.type;
          const v = this.emitExpr(a, want.kind === "ref" ? want.inner : want);
          return `${this.irType(want)} ${v.ref}`;
        });
        const r = this.t();
        this.body.push(`  ${r} = call ${this.irType(fn.ret)} @${fn.name}(${args.join(", ")})`);
        return { ref: r, ir: this.irType(fn.ret), ty: fn.ret };
      }
      case "index": {
        const ptr = this.asPtr(expr.target);
        const idx = this.emitExpr(expr.index, { kind: "i32" });
        const elemIr = elemIrOf(ptr.ir);
        const gep = this.t();
        this.body.push(`  ${gep} = getelementptr ${ptr.ir}, ptr ${ptr.ptr}, i32 0, i32 ${idx.ref}`);
        const r = this.t();
        this.body.push(`  ${r} = load ${elemIr}, ptr ${gep}`);
        return { ref: r, ir: elemIr, ty: irToType(elemIr) };
      }
      case "field": {
        const st = this.structOf(expr.target);
        const fi = st.fields.findIndex((f) => f.name === expr.name);
        const field = st.fields[fi]!;
        const lv = this.tryLvalue(expr.target);
        if (lv) {
          const gep = this.t();
          this.body.push(`  ${gep} = getelementptr %${st.name}, ptr ${lv.ptr}, i32 0, i32 ${fi}`);
          const r = this.t();
          this.body.push(`  ${r} = load ${this.irType(field.type)}, ptr ${gep}`);
          return { ref: r, ir: this.irType(field.type), ty: field.type };
        }
        const obj = this.emitExpr(expr.target, { kind: "struct", name: st.name });
        const r = this.t();
        this.body.push(`  ${r} = extractvalue %${st.name} ${obj.ref}, ${fi}`);
        return { ref: r, ir: this.irType(field.type), ty: field.type };
      }
      case "struct": {
        const st = this.checked.structs.get(expr.name)!;
        const ptr = this.alloca(`%${expr.name}`);
        for (const f of expr.fields) {
          const fi = st.fields.findIndex((x) => x.name === f.name);
          const v = this.emitExpr(f.value, st.fields[fi]!.type);
          const gep = this.t();
          this.body.push(`  ${gep} = getelementptr %${expr.name}, ptr ${ptr}, i32 0, i32 ${fi}`);
          this.store(this.irType(st.fields[fi]!.type), v.ref, gep);
        }
        const r = this.t();
        this.body.push(`  ${r} = load %${expr.name}, ptr ${ptr}`);
        return { ref: r, ir: `%${expr.name}`, ty: { kind: "struct", name: expr.name } };
      }
      case "array": {
        const n = expected?.kind === "array" ? expected.size : expr.elements.length;
        const elemTy: FerraType = expected?.kind === "array" ? expected.element : { kind: "i32" };
        const ir = `[${n} x ${this.irType(elemTy)}]`;
        const ptr = this.alloca(ir);
        expr.elements.forEach((el, i) => {
          const v = this.emitExpr(el, elemTy);
          const gep = this.t();
          this.body.push(`  ${gep} = getelementptr ${ir}, ptr ${ptr}, i32 0, i32 ${i}`);
          this.store(this.irType(elemTy), v.ref, gep);
        });
        const r = this.t();
        this.body.push(`  ${r} = load ${ir}, ptr ${ptr}`);
        return { ref: r, ir, ty: { kind: "array", element: elemTy, size: n } };
      }
    }
  }

  private emitBinary(expr: Extract<Expr, { kind: "binary" }>, expected: FerraType | null) {
    const op = expr.op;
    if (op === "and" || op === "or") {
      const res = this.alloca("i1");
      const l = this.emitExpr(expr.left, { kind: "bool" });
      this.store("i1", l.ref, res);
      const rhs = this.label(op + "rhs");
      const done = this.label(op + "done");
      if (op === "and") this.body.push(`  br i1 ${l.ref}, label %${rhs}, label %${done}`);
      else this.body.push(`  br i1 ${l.ref}, label %${done}, label %${rhs}`);
      this.place(rhs);
      const r = this.emitExpr(expr.right, { kind: "bool" });
      this.store("i1", r.ref, res);
      this.body.push(`  br label %${done}`);
      this.place(done);
      const v = this.t();
      this.body.push(`  ${v} = load i1, ptr ${res}`);
      return { ref: v, ir: "i1", ty: { kind: "bool" } as FerraType };
    }
    const hint = expected && isArith(expected) ? expected : null;
    const l = this.emitExpr(expr.left, hint);
    const r = this.emitExpr(expr.right, l.ty);
    const cmp: Record<string, [string, string]> = {
      "==": ["eq", "oeq"],
      "!=": ["ne", "one"],
      "<": ["slt", "olt"],
      ">": ["sgt", "ogt"],
      "<=": ["sle", "ole"],
      ">=": ["sge", "oge"],
    };
    if (cmp[op]) {
      const v = this.t();
      const fp = l.ir === "float" || l.ir === "double";
      this.body.push(`  ${v} = ${fp ? "fcmp" : "icmp"} ${fp ? cmp[op]![1] : cmp[op]![0]} ${l.ir} ${l.ref}, ${r.ref}`);
      return { ref: v, ir: "i1", ty: { kind: "bool" } as FerraType };
    }
    const fp = l.ir === "float" || l.ir === "double";
    const map: Record<string, [string, string]> = {
      "+": ["add", "fadd"],
      "-": ["sub", "fsub"],
      "*": ["mul", "fmul"],
      "/": ["sdiv", "fdiv"],
      "%": ["srem", "srem"],
    };
    const v = this.t();
    this.body.push(`  ${v} = ${fp ? map[op]![1] : map[op]![0]} ${l.ir} ${l.ref}, ${r.ref}`);
    return { ref: v, ir: l.ir, ty: l.ty };
  }

  private asPtr(expr: Expr): { ptr: string; ir: string } {
    const lv = this.tryLvalue(expr);
    if (lv) return lv;
    const v = this.emitExpr(expr, null);
    const ptr = this.alloca(v.ir);
    this.store(v.ir, v.ref, ptr);
    return { ptr, ir: v.ir };
  }

  private structOf(expr: Expr) {
    if (expr.kind === "name") {
      const loc = this.requireLocal(expr.name);
      const name = loc.ir.replace(/^%/, "");
      return this.checked.structs.get(name)!;
    }
    if (expr.kind === "struct") return this.checked.structs.get(expr.name)!;
    if (expr.kind === "call") {
      const ret = this.checked.fns.get(expr.callee)!.ret;
      if (ret.kind === "struct") return this.checked.structs.get(ret.name)!;
    }
    const first = [...this.checked.structs.values()][0];
    if (!first) this.ice("field access without struct");
    return first;
  }

  private lvalue(expr: Expr) {
    const v = this.tryLvalue(expr);
    if (!v) this.ice("not an lvalue");
    return v;
  }

  private tryLvalue(expr: Expr): { ptr: string; ir: string; ty: FerraType } | null {
    if (expr.kind === "name") {
      const loc = this.locals.get(expr.name);
      if (!loc) return null;
      return { ptr: loc.ptr, ir: loc.ir, ty: irToType(loc.ir) };
    }
    if (expr.kind === "index") {
      const base = this.asPtr(expr.target);
      const idx = this.emitExpr(expr.index, { kind: "i32" });
      const gep = this.t();
      this.body.push(`  ${gep} = getelementptr ${base.ir}, ptr ${base.ptr}, i32 0, i32 ${idx.ref}`);
      const elem = elemIrOf(base.ir);
      return { ptr: gep, ir: elem, ty: irToType(elem) };
    }
    if (expr.kind === "field") {
      const st = this.structOf(expr.target);
      const fi = st.fields.findIndex((f) => f.name === expr.name);
      const base = this.tryLvalue(expr.target) ?? this.asPtr(expr.target);
      const gep = this.t();
      this.body.push(`  ${gep} = getelementptr %${st.name}, ptr ${base.ptr}, i32 0, i32 ${fi}`);
      const ir = this.irType(st.fields[fi]!.type);
      return { ptr: gep, ir, ty: st.fields[fi]!.type };
    }
    return null;
  }

  private requireLocal(name: string) {
    const loc = this.locals.get(name);
    if (!loc) this.ice(`unbound ${name}`);
    return loc;
  }

  private irType(t: FerraType): string {
    switch (t.kind) {
      case "i32":
        return "i32";
      case "i64":
        return "i64";
      case "f32":
        return "float";
      case "f64":
        return "double";
      case "bool":
        return "i1";
      case "string":
        return "%String";
      case "array":
        return `[${t.size} x ${this.irType(t.element)}]`;
      case "struct":
        return `%${t.name}`;
      case "ref":
        return this.irType(t.inner);
    }
  }

  private zero(t: FerraType): string {
    if (t.kind === "f32" || t.kind === "f64") return "0.000000e+00";
    if (t.kind === "bool") return "false";
    if (t.kind === "string") return "zeroinitializer";
    if (t.kind === "struct" || t.kind === "array" || t.kind === "ref") return "zeroinitializer";
    return "0";
  }

  private alloca(ir: string): string {
    const p = this.t();
    this.body.push(`  ${p} = alloca ${ir}`);
    return p;
  }

  private store(ir: string, val: string, ptr: string) {
    this.body.push(`  store ${ir} ${val}, ptr ${ptr}`);
  }

  private t(): string {
    return `%t${this.tmp++}`;
  }

  private label(p: string): string {
    return `${p}${this.lab++}`;
  }

  private place(name: string) {
    this.body.push(`${name}:`);
    this.terminated = false;
  }

  private ice(msg: string): never {
    throw new CompileError(
      "FER301",
      `internal compiler error: ${msg}`,
      { line: 1, col: 1, endLine: 1, endCol: 1 },
      this.filename,
      "",
      "this is a compiler bug",
    );
  }
}

function isArith(t: FerraType): boolean {
  return t.kind === "i32" || t.kind === "i64" || t.kind === "f32" || t.kind === "f64";
}

function elemIrOf(arr: string): string {
  const m = /^\[(\d+) x (.+)\]$/.exec(arr);
  return m ? m[2]! : "i32";
}

function irToType(ir: string): FerraType {
  if (ir === "i32") return { kind: "i32" };
  if (ir === "i64") return { kind: "i64" };
  if (ir === "float") return { kind: "f32" };
  if (ir === "double") return { kind: "f64" };
  if (ir === "i1") return { kind: "bool" };
  if (ir === "%String") return { kind: "string" };
  const arr = /^\[(\d+) x (.+)\]$/.exec(ir);
  if (arr) return { kind: "array", element: irToType(arr[2]!), size: Number(arr[1]) };
  if (ir.startsWith("%")) return { kind: "struct", name: ir.slice(1) };
  return { kind: "i32" };
}

function astType(t: TypeAst): FerraType {
  if (t.kind === "named") {
    if (["i32", "i64", "f32", "f64", "bool", "string"].includes(t.name)) return { kind: t.name as "i32" };
    return { kind: "struct", name: t.name };
  }
  if (t.kind === "array") return { kind: "array", element: astType(t.element), size: t.size };
  return { kind: "ref", inner: astType(t.inner) };
}
