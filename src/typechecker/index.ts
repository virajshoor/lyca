import { Expr, FnDecl, Program, Stmt, TypeAst } from "../ast";
import { CompileError, Span } from "../diagnostics";

export type LycaType =
  | { kind: "i32" }
  | { kind: "i64" }
  | { kind: "f32" }
  | { kind: "f64" }
  | { kind: "bool" }
  | { kind: "string" }
  | { kind: "array"; element: LycaType; size: number }
  | { kind: "struct"; name: string }
  | { kind: "ref"; inner: LycaType };

export type StructInfo = { name: string; fields: { name: string; type: LycaType }[] };

export type FnInfo = { name: string; params: { name: string; type: LycaType }[]; ret: LycaType };

export type CheckedProgram = {
  ast: Program;
  structs: Map<string, StructInfo>;
  fns: Map<string, FnInfo>;
};

const PRIMS = new Set(["i32", "i64", "f32", "f64", "bool", "string"]);

export function typeName(t: LycaType): string {
  switch (t.kind) {
    case "array":
      return `[${typeName(t.element)}; ${t.size}]`;
    case "struct":
      return t.name;
    case "ref":
      return `&${typeName(t.inner)}`;
    default:
      return t.kind;
  }
}

export function isCopy(t: LycaType): boolean {
  return t.kind === "i32" || t.kind === "i64" || t.kind === "f32" || t.kind === "f64" || t.kind === "bool" || t.kind === "ref";
}

export function sameType(a: LycaType, b: LycaType): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "array" && b.kind === "array") return a.size === b.size && sameType(a.element, b.element);
  if (a.kind === "struct" && b.kind === "struct") return a.name === b.name;
  if (a.kind === "ref" && b.kind === "ref") return sameType(a.inner, b.inner);
  return true;
}

type VarInfo = {
  type: LycaType;
  mut: boolean;
  state: "owned" | "moved";
  borrowCount: number;
  borrowedFrom?: string;
};

class Scope {
  vars = new Map<string, VarInfo>();
  order: string[] = [];
}

export function typecheck(ast: Program, source: string, filename: string): CheckedProgram {
  return new Typechecker(ast, source, filename).run();
}

class Typechecker {
  structs = new Map<string, StructInfo>();
  fns = new Map<string, FnInfo>();
  scopes: Scope[] = [];
  currentRet: LycaType | null = null;
  stmtBorrows: string[] = [];

  constructor(
    private ast: Program,
    private source: string,
    private filename: string,
  ) {}

  run(): CheckedProgram {
    for (const d of this.ast.decls) {
      if (d.kind === "struct") {
        if (this.structs.has(d.name) || PRIMS.has(d.name)) {
          this.err("LYC216", `duplicate definition of '${d.name}'`, d.span);
        }
        this.structs.set(d.name, { name: d.name, fields: [] });
      }
    }
    for (const d of this.ast.decls) {
      if (d.kind !== "struct") continue;
      const fields: StructInfo["fields"] = [];
      const seen = new Set<string>();
      for (const f of d.fields) {
        if (seen.has(f.name)) this.err("LYC216", `duplicate field '${f.name}'`, f.span);
        seen.add(f.name);
        fields.push({ name: f.name, type: this.resolve(f.type) });
      }
      this.structs.set(d.name, { name: d.name, fields });
    }

    this.fns.set("print", {
      name: "print",
      params: [{ name: "s", type: { kind: "ref", inner: { kind: "string" } } }],
      ret: { kind: "i32" },
    });

    for (const d of this.ast.decls) {
      if (d.kind !== "fn") continue;
      if (this.fns.has(d.name)) this.err("LYC216", `duplicate definition of '${d.name}'`, d.span);
      this.fns.set(d.name, {
        name: d.name,
        params: d.params.map((p) => ({ name: p.name, type: this.resolve(p.type) })),
        ret: this.resolve(d.returnType),
      });
    }

    const main = this.fns.get("main");
    if (!main) this.err("LYC214", "program must define 'main() -> i32'", this.ast.span, "add: def main() -> i32:");
    if (main.params.length !== 0 || main.ret.kind !== "i32") {
      const span = this.ast.decls.find((d) => d.kind === "fn" && d.name === "main")!.span;
      this.err("LYC215", "main must be 'def main() -> i32'", span);
    }

    for (const d of this.ast.decls) {
      if (d.kind === "fn") this.checkFn(d);
    }
    return { ast: this.ast, structs: this.structs, fns: this.fns };
  }

  private checkFn(fn: FnDecl) {
    this.currentRet = this.fns.get(fn.name)!.ret;
    this.scopes = [new Scope()];
    const seen = new Set<string>();
    for (const p of fn.params) {
      if (seen.has(p.name)) this.err("LYC216", `duplicate parameter '${p.name}'`, p.span);
      seen.add(p.name);
      this.define(p.name, this.resolve(p.type), false, p.span);
    }
    this.checkBlock(fn.body);
    if (!alwaysReturns(fn.body)) {
      this.err("LYC208", `function '${fn.name}' may exit without returning`, fn.span, "every path must 'return' a value");
    }
    this.scopes = [];
  }

  private checkBlock(stmts: Stmt[]) {
    this.scopes.push(new Scope());
    for (const s of stmts) this.checkStmt(s);
    this.popScope();
  }

  private checkStmt(stmt: Stmt) {
    this.stmtBorrows = [];
    switch (stmt.kind) {
      case "let": {
        const ty = this.resolve(stmt.type);
        const val = this.checkExpr(stmt.value, ty);
        this.expectType(val, ty, stmt.value.span);
        this.define(stmt.name, ty, stmt.mut, stmt.span);
        if (ty.kind === "ref") {
          const from = this.borrowSource(stmt.value);
          if (from) {
            this.lookup(stmt.name)!.borrowedFrom = from;
            this.stmtBorrows = this.stmtBorrows.filter((n) => n !== from);
          }
        }
        break;
      }
      case "assign": {
        this.checkAssign(stmt.target, stmt.value);
        break;
      }
      case "return": {
        const ty = this.checkExpr(stmt.value, this.currentRet);
        this.expectType(ty, this.currentRet!, stmt.value.span, "LYC207");
        break;
      }
      case "if": {
        const c = this.checkExpr(stmt.cond, { kind: "bool" });
        this.expectType(c, { kind: "bool" }, stmt.cond.span, "LYC226");
        this.releaseStmtBorrows();
        this.checkBlock(stmt.then);
        if (stmt.else_) this.checkBlock(stmt.else_);
        return;
      }
      case "while": {
        const c = this.checkExpr(stmt.cond, { kind: "bool" });
        this.expectType(c, { kind: "bool" }, stmt.cond.span, "LYC227");
        this.releaseStmtBorrows();
        this.checkBlock(stmt.body);
        return;
      }
      case "for": {
        const s = this.checkExpr(stmt.start, { kind: "i32" });
        const e = this.checkExpr(stmt.end, { kind: "i32" });
        this.expectType(s, { kind: "i32" }, stmt.start.span);
        this.expectType(e, { kind: "i32" }, stmt.end.span);
        this.releaseStmtBorrows();
        this.scopes.push(new Scope());
        this.define(stmt.name, { kind: "i32" }, true, stmt.span);
        for (const b of stmt.body) this.checkStmt(b);
        this.popScope();
        return;
      }
      case "expr":
        this.checkExpr(stmt.expr, null);
        break;
    }
    this.releaseStmtBorrows();
  }

  private checkAssign(target: Expr, value: Expr) {
    this.requireMutPlace(target);
    if (target.kind === "name") {
      const v = this.requireVar(target.name, target.span);
      if (!v.mut) this.err("LYC217", `cannot assign to immutable '${target.name}'`, target.span, "declare with 'let mut'");
      if (v.borrowCount > 0) this.err("LYC220", `cannot mutate '${target.name}' while it is borrowed`, target.span);
      const ty = this.checkExpr(value, v.type);
      this.expectType(ty, v.type, value.span);
      this.dropRef(v);
      v.state = "owned";
      v.borrowCount = 0;
      if (v.type.kind === "ref" && value.kind === "borrow" && value.expr.kind === "name") {
        v.borrowedFrom = value.expr.name;
      }
      return;
    }
    if (target.kind === "index") {
      const t = this.deref(this.checkPlace(target.target));
      if (t.kind !== "array") this.err("LYC212", `cannot index '${typeName(t)}'`, target.target.span);
      const i = this.checkExpr(target.index, { kind: "i32" });
      this.expectType(i, { kind: "i32" }, target.index.span);
      const val = this.checkExpr(value, t.element);
      this.expectType(val, t.element, value.span);
      return;
    }
    if (target.kind === "field") {
      const t = this.deref(this.checkPlace(target.target));
      if (t.kind !== "struct") this.err("LYC209", `cannot access field on '${typeName(t)}'`, target.span);
      const st = this.structs.get(t.name)!;
      const f = st.fields.find((x) => x.name === target.name);
      if (!f) this.err("LYC209", `no field '${target.name}' on ${t.name}`, target.span);
      const val = this.checkExpr(value, f.type);
      this.expectType(val, f.type, value.span);
      return;
    }
    this.err("LYC105", "invalid assignment target", target.span);
  }

  private checkExpr(expr: Expr, expected: LycaType | null): LycaType {
    switch (expr.kind) {
      case "int": {
        const ty =
          expected?.kind === "i32" || expected?.kind === "i64" ? expected : { kind: "i32" as const };
        if (ty.kind === "i32") {
          const n = Number(expr.raw);
          if (n > 2147483647) {
            this.err("LYC201", "integer literal does not fit in i32", expr.span, "annotate as i64: let x: i64 = ...");
          }
        }
        return ty;
      }
      case "float": {
        return expected?.kind === "f32" || expected?.kind === "f64" ? expected : { kind: "f64" };
      }
      case "bool":
        return { kind: "bool" };
      case "string":
        return { kind: "string" };
      case "name":
        return this.useVar(expr.name, expr.span, expected);
      case "unary": {
        if (expr.op === "not") {
          const t = this.checkExpr(expr.expr, { kind: "bool" });
          this.expectType(t, { kind: "bool" }, expr.expr.span);
          return { kind: "bool" };
        }
        const t = this.checkExpr(expr.expr, expected);
        if (t.kind !== "i32" && t.kind !== "i64" && t.kind !== "f32" && t.kind !== "f64") {
          this.err("LYC211", `unary '-' is not valid for '${typeName(t)}'`, expr.span);
        }
        return t;
      }
      case "borrow": {
        if (expr.expr.kind !== "name") {
          this.err("LYC222", "can only borrow a variable name", expr.expr.span, "v0 allows '&x' but not '&p.x'");
        }
        const v = this.requireVar(expr.expr.name, expr.expr.span);
        if (v.state === "moved") this.err("LYC223", `cannot borrow '${expr.expr.name}' after it was moved`, expr.span);
        v.borrowCount++;
        this.stmtBorrows.push(expr.expr.name);
        return { kind: "ref", inner: v.type };
      }
      case "binary":
        return this.checkBinary(expr, expected);
      case "call":
        return this.checkCall(expr, expected);
      case "index": {
        const t = this.deref(this.checkPlace(expr.target));
        if (t.kind !== "array") this.err("LYC212", `cannot index '${typeName(t)}'`, expr.target.span);
        const i = this.checkExpr(expr.index, { kind: "i32" });
        this.expectType(i, { kind: "i32" }, expr.index.span);
        if (!isCopy(t.element)) this.movePlace(expr.target, expr.span);
        return t.element;
      }
      case "field": {
        const t = this.deref(this.checkPlace(expr.target));
        if (t.kind !== "struct") this.err("LYC209", `cannot access field on '${typeName(t)}'`, expr.span);
        const st = this.structs.get(t.name);
        if (!st) this.err("LYC210", `unknown struct '${t.name}'`, expr.span);
        const f = st.fields.find((x) => x.name === expr.name);
        if (!f) this.err("LYC209", `no field '${expr.name}' on ${t.name}`, expr.span);
        if (!isCopy(f.type)) this.movePlace(expr.target, expr.span);
        return f.type;
      }
      case "struct": {
        const st = this.structs.get(expr.name);
        if (!st) this.err("LYC210", `unknown struct '${expr.name}'`, expr.span);
        const seen = new Set<string>();
        for (const f of expr.fields) {
          if (seen.has(f.name)) this.err("LYC216", `duplicate field '${f.name}'`, f.span);
          seen.add(f.name);
          const def = st.fields.find((x) => x.name === f.name);
          if (!def) this.err("LYC209", `no field '${f.name}' on ${expr.name}`, f.span);
          const ty = this.checkExpr(f.value, def.type);
          this.expectType(ty, def.type, f.value.span);
        }
        for (const def of st.fields) {
          if (!seen.has(def.name)) this.err("LYC201", `missing field '${def.name}' in ${expr.name}`, expr.span);
        }
        return { kind: "struct", name: expr.name };
      }
      case "array": {
        let elem: LycaType | null =
          expected?.kind === "array" ? expected.element : expected?.kind === "ref" && expected.inner.kind === "array" ? expected.inner.element : null;
        if (expr.elements.length === 0 && !elem) {
          this.err("LYC201", "cannot infer type of empty array", expr.span, "annotate the let binding");
        }
        const types = expr.elements.map((el) => this.checkExpr(el, elem));
        elem = elem ?? types[0]!;
        for (let i = 0; i < types.length; i++) this.expectType(types[i]!, elem, expr.elements[i]!.span);
        const size = expected?.kind === "array" ? expected.size : expr.elements.length;
        if (expr.elements.length !== size) {
          this.err("LYC213", `array literal has ${expr.elements.length} elements, expected ${size}`, expr.span);
        }
        return { kind: "array", element: elem, size };
      }
    }
  }

  private checkBinary(expr: Extract<Expr, { kind: "binary" }>, expected: LycaType | null): LycaType {
    const op = expr.op;
    if (op === "and" || op === "or") {
      const l = this.checkExpr(expr.left, { kind: "bool" });
      const r = this.checkExpr(expr.right, { kind: "bool" });
      this.expectType(l, { kind: "bool" }, expr.left.span);
      this.expectType(r, { kind: "bool" }, expr.right.span);
      return { kind: "bool" };
    }
    const cmp = ["==", "!=", "<", ">", "<=", ">="];
    const innerExpect = expected && !cmp.includes(op) ? expected : null;
    const l = this.checkExpr(expr.left, innerExpect);
    const r = this.checkExpr(expr.right, l);
    if (!sameType(l, r)) {
      this.err(
        "LYC221",
        `cannot apply '${op}' to '${typeName(l)}' and '${typeName(r)}'`,
        expr.span,
        "Lyca has no implicit numeric conversion",
      );
    }
    if (cmp.includes(op)) {
      if (l.kind === "bool" && op !== "==" && op !== "!=") {
        this.err("LYC225", `cannot order bool values with '${op}'`, expr.span);
      }
      if (l.kind === "string" || l.kind === "array" || l.kind === "struct" || l.kind === "ref") {
        if (op !== "==" && op !== "!=") this.err("LYC225", `cannot compare '${typeName(l)}' with '${op}'`, expr.span);
      }
      return { kind: "bool" };
    }
    if (op === "%" && (l.kind === "f32" || l.kind === "f64")) {
      this.err("LYC211", "'%' is only valid for integers", expr.span);
    }
    if (l.kind !== "i32" && l.kind !== "i64" && l.kind !== "f32" && l.kind !== "f64") {
      this.err("LYC211", `arithmetic is not valid for '${typeName(l)}'`, expr.span);
    }
    return l;
  }

  private checkCall(expr: Extract<Expr, { kind: "call" }>, _expected: LycaType | null): LycaType {
    const fn = this.fns.get(expr.callee);
    if (!fn) this.err("LYC205", `unknown function '${expr.callee}'`, expr.span);
    if (expr.args.length !== fn.params.length) {
      this.err("LYC206", `'${fn.name}' expects ${fn.params.length} argument(s), got ${expr.args.length}`, expr.span);
    }
    for (let i = 0; i < fn.params.length; i++) {
      const param = fn.params[i]!.type;
      const arg = expr.args[i]!;
      let actual: LycaType;
      if (param.kind === "ref" && arg.kind === "name") {
        const v = this.requireVar(arg.name, arg.span);
        if (v.state === "moved") this.err("LYC223", `cannot borrow '${arg.name}' after it was moved`, arg.span);
        if (sameType(v.type, param.inner)) {
          v.borrowCount++;
          this.stmtBorrows.push(arg.name);
          actual = param;
        } else {
          actual = this.checkExpr(arg, param);
        }
      } else if (param.kind === "ref" && arg.kind !== "borrow") {
        actual = this.checkExpr(arg, param.inner);
        if (sameType(actual, param.inner)) actual = param;
      } else {
        actual = this.checkExpr(arg, param);
      }
      this.expectType(actual, param, arg.span);
    }
    return fn.ret;
  }

  private useVar(name: string, span: Span, expected: LycaType | null): LycaType {
    const v = this.requireVar(name, span);
    if (v.state === "moved") {
      this.err("LYC218", `use of moved value '${name}'`, span, "borrow with '&' or re-bind a new value");
    }
    const ty = v.type;
    if (expected?.kind === "ref" && sameType(ty, expected.inner)) {
      v.borrowCount++;
      this.stmtBorrows.push(name);
      return expected;
    }
    if (!isCopy(ty)) {
      if (v.borrowCount > 0) this.err("LYC219", `cannot move '${name}' while it is borrowed`, span);
      v.state = "moved";
    }
    return ty;
  }

  private resolve(t: TypeAst): LycaType {
    switch (t.kind) {
      case "named":
        if (PRIMS.has(t.name)) return { kind: t.name as "i32" };
        if (this.structs.has(t.name)) return { kind: "struct", name: t.name };
        this.err("LYC202", `unknown type '${t.name}'`, t.span);
        break;
      case "array":
        return { kind: "array", element: this.resolve(t.element), size: t.size };
      case "ref":
        return { kind: "ref", inner: this.resolve(t.inner) };
    }
  }

  private define(name: string, type: LycaType, mut: boolean, span: Span) {
    const cur = this.scopes[this.scopes.length - 1]!;
    if (cur.vars.has(name)) this.err("LYC216", `duplicate variable '${name}'`, span);
    cur.vars.set(name, { type, mut, state: "owned", borrowCount: 0 });
    cur.order.push(name);
  }

  private lookup(name: string): VarInfo | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const v = this.scopes[i]!.vars.get(name);
      if (v) return v;
    }
    return undefined;
  }

  private requireVar(name: string, span: Span): VarInfo {
    const v = this.lookup(name);
    if (!v) this.err("LYC203", `unknown variable '${name}'`, span);
    return v;
  }

  private popScope() {
    const scope = this.scopes.pop()!;
    for (const name of [...scope.order].reverse()) {
      this.dropRef(scope.vars.get(name)!);
    }
  }

  private dropRef(v: VarInfo) {
    if (v.borrowedFrom) {
      const src = this.lookup(v.borrowedFrom);
      if (src && src.borrowCount > 0) src.borrowCount--;
      v.borrowedFrom = undefined;
    }
  }

  private releaseStmtBorrows() {
    for (const name of this.stmtBorrows) {
      const v = this.lookup(name);
      if (v && v.borrowCount > 0) v.borrowCount--;
    }
    this.stmtBorrows = [];
  }

  private requireMutPlace(expr: Expr) {
    if (expr.kind === "name") {
      const v = this.requireVar(expr.name, expr.span);
      if (!v.mut) this.err("LYC217", `cannot assign to immutable '${expr.name}'`, expr.span, "declare with 'let mut'");
      if (v.borrowCount > 0) this.err("LYC220", `cannot mutate '${expr.name}' while it is borrowed`, expr.span);
      return;
    }
    if (expr.kind === "field" || expr.kind === "index") {
      this.requireMutPlace(expr.target);
      return;
    }
  }

  private checkPlace(expr: Expr): LycaType {
    if (expr.kind === "name") {
      const v = this.requireVar(expr.name, expr.span);
      if (v.state === "moved") {
        this.err("LYC218", `use of moved value '${expr.name}'`, expr.span, "borrow with '&' or re-bind a new value");
      }
      return v.type;
    }
    if (expr.kind === "field") {
      const t = this.deref(this.checkPlace(expr.target));
      if (t.kind !== "struct") this.err("LYC209", `cannot access field on '${typeName(t)}'`, expr.span);
      const st = this.structs.get(t.name)!;
      const f = st.fields.find((x) => x.name === expr.name);
      if (!f) this.err("LYC209", `no field '${expr.name}' on ${t.name}`, expr.span);
      return f.type;
    }
    if (expr.kind === "index") {
      const t = this.deref(this.checkPlace(expr.target));
      if (t.kind !== "array") this.err("LYC212", `cannot index '${typeName(t)}'`, expr.target.span);
      const i = this.checkExpr(expr.index, { kind: "i32" });
      this.expectType(i, { kind: "i32" }, expr.index.span);
      return t.element;
    }
    return this.checkExpr(expr, null);
  }

  private movePlace(expr: Expr, span: Span) {
    if (expr.kind === "name") {
      const v = this.requireVar(expr.name, expr.span);
      if (v.borrowCount > 0) this.err("LYC219", `cannot move '${expr.name}' while it is borrowed`, span);
      if (!isCopy(v.type)) v.state = "moved";
    }
  }

  private borrowSource(expr: Expr): string | undefined {
    if (expr.kind === "borrow" && expr.expr.kind === "name") return expr.expr.name;
    if (expr.kind === "name") {
      const v = this.lookup(expr.name);
      if (!v) return undefined;
      if (v.borrowedFrom) return v.borrowedFrom;
      if (v.type.kind !== "ref") return expr.name;
    }
    return undefined;
  }

  private deref(t: LycaType): LycaType {
    return t.kind === "ref" ? t.inner : t;
  }

  private expectType(got: LycaType, want: LycaType, span: Span, code = "LYC201") {
    if (!sameType(got, want)) {
      this.err(code, `type mismatch: expected ${typeName(want)}, found ${typeName(got)}`, span, "Lyca does not coerce types");
    }
  }

  private err(code: string, message: string, span: Span, hint?: string): never {
    throw new CompileError(code, message, span, this.filename, this.source, hint);
  }
}

function alwaysReturns(stmts: Stmt[]): boolean {
  for (const s of stmts) {
    if (s.kind === "return") return true;
    if (s.kind === "if" && alwaysReturns(s.then) && s.else_ && alwaysReturns(s.else_)) return true;
  }
  return false;
}
