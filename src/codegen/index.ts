import { Expr, FnDecl, Stmt } from "../ast";
import { CompileError } from "../diagnostics";
import { CheckedProgram, LycaType, FnInfo, pythonType } from "../typechecker";

const cmp: Record<string, [string, string]> = { "==": ["eq", "oeq"], "!=": ["ne", "une"], "<": ["slt", "olt"], ">": ["sgt", "ogt"], "<=": ["sle", "ole"], ">=": ["sge", "oge"] };
const ops: Record<string, [string, string]> = { "+": ["add", "fadd"], "-": ["sub", "fsub"], "*": ["mul", "fmul"], "/": ["sdiv", "fdiv"], "%": ["srem", "srem"] };

type Value = { ref: string; ty: LycaType };
type Place = { ptr: string; ty: LycaType };

export function irType(t: LycaType): string {
  switch (t.kind) {
    case "f32": return "float";
    case "f64": return "double";
    case "bool": return "i1";
    case "string": return "%lyca.String";
    case "ref": return "ptr";
    case "array": return `[${t.size} x ${irType(t.element)}]`;
    case "struct": return `%lyca.struct.${t.name}`;
    default: return t.kind;
  }
}

export function codegen(checked: CheckedProgram, filename: string): string {
  return new Emitter(checked, filename).emit();
}

class Emitter {
  strings: string[] = [];
  stringPool = new Map<string, string>();
  body: string[] = [];
  allocations: string[] = [];
  locals = new Map<string, Place>();
  tmp = 0;
  lab = 0;
  terminated = false;

  constructor(private checked: CheckedProgram, private filename: string) {}

  emit(): string {
    const header = [
      "; Lyca LLVM IR (host target)",
      "%lyca.String = type { ptr, i64 }",
      "declare void @lyca_fail(ptr, i32, i32) noreturn",
      "declare i32 @lyca_print(ptr)",
    ];
    for (const st of this.checked.structs.values()) {
      header.push(`%lyca.struct.${st.name} = type { ${st.fields.map(f => irType(f.type)).join(", ")} }`);
    }
    for (const fn of this.checked.fns.values()) {
      if (fn.pythonModule) header.push(`declare void @lyca_py_${fn.name}(${["ptr", "ptr", ...fn.params.map(() => "ptr")].join(", ")})`);
    }
    const bodies: string[] = [];
    for (const d of this.checked.ast.decls) {
      if (d.kind !== "fn") continue;
      bodies.push(this.emitFn(d));
      const fn = this.checked.fns.get(d.name)!;
      if (this.checked.target === "python" && !d.name.startsWith("_") && pythonType(fn.ret)) {
        bodies.push(this.exportWrapper(fn));
      }
    }
    if (this.checked.target === "native") {
      const hasPython = [...this.checked.fns.values()].some(f => f.pythonModule);
      if (hasPython) bodies.push(this.exportWrapper(this.checked.fns.get("main")!));
      else bodies.push("define i32 @main() {\nentry:\n  %r = call i32 @lyca.fn.main(ptr null)\n  ret i32 %r\n}");
    }
    return [...header, ...bodies, ...this.strings].join("\n\n") + "\n";
  }

  // Pointer-only boundary avoids platform-specific C aggregate calling conventions.
  private exportWrapper(fn: FnInfo): string {
    const args = fn.params.map((p, i) => `ptr %a${i}`);
    const lines = [`define void @lyca_export_${fn.name}(${["ptr %ctx", "ptr %out", ...args].join(", ")}) {`, "entry:"];
    const values = fn.params.map((p, i) => {
      if (p.type.kind === "ref") return `ptr %a${i}`;
      lines.push(`  %v${i} = load ${irType(p.type)}, ptr %a${i}`);
      return `${irType(p.type)} %v${i}`;
    });
    lines.push(`  %r = call ${irType(fn.ret)} @lyca.fn.${fn.name}(${["ptr %ctx", ...values].join(", ")})`, `  store ${irType(fn.ret)} %r, ptr %out`, "  ret void", "}");
    return lines.join("\n");
  }

  private emitFn(fn: FnDecl): string {
    this.tmp = 0;
    this.lab = 0;
    this.terminated = false;
    this.locals = new Map();
    this.body = [];
    this.allocations = [];
    const info = this.checked.fns.get(fn.name)!;
    const args = info.params.map((p, i) => `${irType(p.type)} %p${i}`);
    for (const [i, p] of info.params.entries()) {
      const ptr = this.alloca(p.type);
      this.store(p.type, `%p${i}`, ptr);
      this.locals.set(p.name, { ptr, ty: p.type });
    }
    for (const stmt of fn.body) this.emitStmt(stmt);
    if (!this.terminated) this.body.push("  unreachable");
    return [`define internal ${irType(info.ret)} @lyca.fn.${fn.name}(${["ptr %ctx", ...args].join(", ")}) {`, "entry:", ...this.allocations, ...this.body, "}"].join("\n");
  }

  private emitBlock(stmts: Stmt[]) {
    const outer = stmts.some(s => s.kind === "let") ? new Map(this.locals) : this.locals;
    for (const stmt of stmts) this.emitStmt(stmt);
    this.locals = outer;
  }

  private emitStmt(stmt: Stmt) {
    if (this.terminated) return;
    switch (stmt.kind) {
      case "let": {
        const ty = this.checked.types.get(stmt.type)!;
        const value = this.emitExpr(stmt.value, ty);
        const ptr = this.alloca(ty);
        this.store(ty, value.ref, ptr);
        this.locals.set(stmt.name, { ptr, ty });
        break;
      }
      case "assign": {
        const dest = this.placeExpr(stmt.target);
        const value = this.emitExpr(stmt.value, dest.ty);
        this.store(dest.ty, value.ref, dest.ptr);
        break;
      }
      case "return": {
        const value = this.emitExpr(stmt.value);
        this.body.push(`  ret ${irType(value.ty)} ${value.ref}`);
        this.terminated = true;
        break;
      }
      case "if": {
        const then = this.label("then"), end = this.label("endif");
        const otherwise = stmt.else_ ? this.label("else") : end;
        const cond = this.emitExpr(stmt.cond);
        this.body.push(`  br i1 ${cond.ref}, label %${then}, label %${otherwise}`);
        this.place(then);
        this.emitBlock(stmt.then);
        const thenEnds = this.terminated;
        if (!thenEnds) this.body.push(`  br label %${end}`);
        if (stmt.else_) {
          this.place(otherwise);
          this.emitBlock(stmt.else_);
          if (!this.terminated) this.body.push(`  br label %${end}`);
          if (thenEnds && this.terminated) break;
        }
        this.place(end);
        break;
      }
      case "while": {
        const head = this.label("while"), body = this.label("body"), end = this.label("endwhile");
        this.body.push(`  br label %${head}`);
        this.place(head);
        const cond = this.emitExpr(stmt.cond);
        this.body.push(`  br i1 ${cond.ref}, label %${body}, label %${end}`);
        this.place(body);
        this.emitBlock(stmt.body);
        if (!this.terminated) this.body.push(`  br label %${head}`);
        this.place(end);
        break;
      }
      case "for": {
        const outer = new Map(this.locals);
        // Both bounds use the enclosing scope and are evaluated once.
        const start = this.emitExpr(stmt.start), bound = this.emitExpr(stmt.end);
        const ty: LycaType = { kind: "i32" };
        const ptr = this.alloca(ty);
        this.store(ty, start.ref, ptr);
        this.locals.set(stmt.name, { ptr, ty });
        const head = this.label("for"), body = this.label("body"), end = this.label("endfor");
        this.body.push(`  br label %${head}`);
        this.place(head);
        const iv = this.load({ ptr, ty });
        const cmp = this.instruction(`icmp slt i32 ${iv.ref}, ${bound.ref}`);
        this.body.push(`  br i1 ${cmp}, label %${body}, label %${end}`);
        this.place(body);
        this.emitBlock(stmt.body);
        if (!this.terminated) {
          const current = this.load({ ptr, ty });
          const value = this.instruction(`add i32 ${current.ref}, 1`);
          this.store(ty, value, ptr);
          this.body.push(`  br label %${head}`);
        }
        this.place(end);
        this.locals = outer;
        break;
      }
      case "expr": this.emitExpr(stmt.expr); break;
    }
  }

  private emitExpr(expr: Expr, expected?: LycaType): Value {
    if (expected?.kind === "ref") {
      if (expr.kind === "borrow") return { ref: this.placeExpr(expr.expr).ptr, ty: expected };
      if (expr.kind === "name" && this.locals.get(expr.name)?.ty.kind === "ref") return this.load(this.locals.get(expr.name)!);
      return { ref: this.placeExpr(expr).ptr, ty: expected };
    }
    const ty = this.checked.exprTypes.get(expr);
    if (!ty) this.ice("expression lacks checked type");
    switch (expr.kind) {
      case "int": return { ref: expr.raw[0] === "0" ? BigInt(expr.raw).toString() : expr.raw, ty };
      case "float": {
        const b = Buffer.alloc(8);
        b.writeDoubleBE(ty.kind === "f32" ? Math.fround(Number(expr.raw)) : Number(expr.raw));
        return { ref: `0x${b.toString("hex")}`, ty };
      }
      case "bool": return { ref: expr.value ? "true" : "false", ty };
      case "string": {
        let global = this.stringPool.get(expr.value);
        const bytes = Buffer.from(expr.value, "utf8");
        if (!global) {
          global = `@lyca.str.${this.strings.length}`;
          const hex = [...bytes, 0].map(b => "\\" + b.toString(16).padStart(2, "0")).join("");
          this.strings.push(`${global} = private unnamed_addr constant [${bytes.length + 1} x i8] c"${hex}"`);
          this.stringPool.set(expr.value, global);
        }
        return { ref: `{ ptr ${global}, i64 ${bytes.length} }`, ty };
      }
      case "name": {
        const local = this.locals.get(expr.name);
        if (!local) this.ice(`unbound ${expr.name}`);
        return this.load(local);
      }
      case "borrow": return { ref: this.placeExpr(expr.expr).ptr, ty };
      case "unary": {
        const v = this.emitExpr(expr.expr);
        const op = expr.op === "not" ? `xor i1 ${v.ref}, true` : ty.kind === "f32" || ty.kind === "f64" ? `fneg ${irType(ty)} ${v.ref}` : `sub ${irType(ty)} 0, ${v.ref}`;
        return { ref: this.instruction(op), ty };
      }
      case "binary": return this.emitBinary(expr, ty);
      case "call": {
        const fn = this.checked.fns.get(expr.callee)!;
        const args = expr.args.map((a, i) => this.emitExpr(a, fn.params[i]!.type));
        if (fn.name === "print") return { ref: this.instruction(`call i32 @lyca_print(ptr ${args[0]!.ref})`), ty };
        if (fn.pythonModule) {
          const out = this.alloca(fn.ret);
          const pointers = args.map((a, i) => {
            if (fn.params[i]!.type.kind === "ref") return `ptr ${a.ref}`;
            const ptr = this.alloca(a.ty);
            this.store(a.ty, a.ref, ptr);
            return `ptr ${ptr}`;
          });
          this.body.push(`  call void @lyca_py_${fn.name}(${["ptr %ctx", `ptr ${out}`, ...pointers].join(", ")})`);
          return this.load({ ptr: out, ty });
        }
        return { ref: this.instruction(`call ${irType(ty)} @lyca.fn.${fn.name}(${["ptr %ctx", ...args.map(a => `${irType(a.ty)} ${a.ref}`)].join(", ")})`), ty };
      }
      case "index": case "field": return this.load(this.placeExpr(expr));
      case "struct": {
        const st = this.checked.structs.get(expr.name)!;
        let value = "undef";
        for (const field of expr.fields) {
          const index = st.fields.findIndex(f => f.name === field.name);
          const v = this.emitExpr(field.value);
          value = this.instruction(`insertvalue ${irType(ty)} ${value}, ${irType(v.ty)} ${v.ref}, ${index}`);
        }
        return { ref: value, ty };
      }
      case "array": {
        let value = "zeroinitializer";
        for (const [i, e] of expr.elements.entries()) {
          const v = this.emitExpr(e);
          value = this.instruction(`insertvalue ${irType(ty)} ${value}, ${irType(v.ty)} ${v.ref}, ${i}`);
        }
        return { ref: value, ty };
      }
    }
  }

  private emitBinary(expr: Extract<Expr, { kind: "binary" }>, ty: LycaType): Value {
    const op = expr.op;
    const l = this.emitExpr(expr.left);
    if (op === "and" || op === "or") {
      const slot = this.alloca(ty);
      this.store(ty, l.ref, slot);
      const rhs = this.label("rhs"), end = this.label("boolend");
      this.body.push(`  br i1 ${l.ref}, label %${op === "and" ? rhs : end}, label %${op === "and" ? end : rhs}`);
      this.place(rhs);
      this.store(ty, this.emitExpr(expr.right).ref, slot);
      this.body.push(`  br label %${end}`);
      this.place(end);
      return this.load({ ptr: slot, ty });
    }
    const r = this.emitExpr(expr.right);
    const fp = l.ty.kind === "f32" || l.ty.kind === "f64";
    const ir = irType(l.ty);

    if (cmp[op]) return { ref: this.instruction(`${fp ? "fcmp" : "icmp"} ${cmp[op]![fp ? 1 : 0]} ${ir} ${l.ref}, ${r.ref}`), ty };
    if (!fp && (op === "/" || op === "%") && !(expr.right.kind === "int" && Number(expr.right.raw) > 0)) {
      const zero = this.instruction(`icmp eq ${ir} ${r.ref}, 0`);
      const min = l.ty.kind === "i64" ? "-9223372036854775808" : "-2147483648";
      const a = this.instruction(`icmp eq ${ir} ${l.ref}, ${min}`);
      const b = this.instruction(`icmp eq ${ir} ${r.ref}, -1`);
      const overflow = this.instruction(`and i1 ${a}, ${b}`);
      const bad = this.instruction(`or i1 ${zero}, ${overflow}`);
      this.guard(bad, 2, expr.span.line);
    }

    return { ref: this.instruction(`${ops[op]![fp ? 1 : 0]} ${ir} ${l.ref}, ${r.ref}`), ty };
  }

  private placeExpr(expr: Expr): Place {
    if (expr.kind === "name") {
      const local = this.locals.get(expr.name);
      if (!local) this.ice(`unbound ${expr.name}`);
      if (local.ty.kind === "ref") return { ptr: this.load(local).ref, ty: local.ty.inner };
      return local;
    }
    if (expr.kind === "field") {
      const base = this.placeExpr(expr.target);
      if (base.ty.kind !== "struct") this.ice("field base is not a struct");
      const st = this.checked.structs.get(base.ty.name)!;
      const index = st.fields.findIndex(f => f.name === expr.name);
      return { ptr: this.instruction(`getelementptr ${irType(base.ty)}, ptr ${base.ptr}, i32 0, i32 ${index}`), ty: st.fields[index]!.type };
    }
    if (expr.kind === "index") {
      const base = this.placeExpr(expr.target);
      if (base.ty.kind !== "array") this.ice("index base is not an array");
      const index = this.emitExpr(expr.index);
      if (expr.index.kind !== "int") {
        const bad = this.instruction(`icmp uge i32 ${index.ref}, ${base.ty.size}`);
        this.guard(bad, 1, expr.span.line);
      }
      // Signed extension is explicit; the guard already excludes negative indices.
      const wide = this.instruction(`sext i32 ${index.ref} to i64`);
      return { ptr: this.instruction(`getelementptr ${irType(base.ty)}, ptr ${base.ptr}, i32 0, i64 ${wide}`), ty: base.ty.element };
    }
    const value = this.emitExpr(expr);
    const ptr = this.alloca(value.ty);
    this.store(value.ty, value.ref, ptr);
    return { ptr, ty: value.ty };
  }

  private guard(bad: string, code: number, line: number) {
    const error = this.label("error"), ok = this.label("ok");
    this.body.push(`  br i1 ${bad}, label %${error}, label %${ok}`);
    this.place(error);
    this.body.push(`  call void @lyca_fail(ptr %ctx, i32 ${code}, i32 ${line})`, "  unreachable");
    this.place(ok);
  }

  private load(place: Place): Value {
    return { ref: this.instruction(`load ${irType(place.ty)}, ptr ${place.ptr}`), ty: place.ty };
  }

  private alloca(ty: LycaType): string {
    const ptr = `%t${this.tmp++}`;
    this.allocations.push(`  ${ptr} = alloca ${irType(ty)}`);
    return ptr;
  }

  private store(ty: LycaType, value: string, ptr: string) { this.body.push(`  store ${irType(ty)} ${value}, ptr ${ptr}`); }
  private instruction(op: string): string { const r = `%t${this.tmp++}`; this.body.push(`  ${r} = ${op}`); return r; }
  private label(prefix: string): string { return `${prefix}${this.lab++}`; }
  private place(label: string) { this.body.push(`${label}:`); this.terminated = false; }
  private ice(message: string): never {
    throw new CompileError("LYC301", `internal compiler error: ${message}`, this.checked.ast.span, this.filename, "", "this is a compiler bug");
  }
}
