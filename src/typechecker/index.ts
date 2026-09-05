import { Expr, FnDecl, Program, Stmt, TypeAst } from "../ast";
import { CompileError, Span } from "../diagnostics";

export type FerraType =
  | { kind: "i32" }
  | { kind: "i64" }
  | { kind: "f32" }
  | { kind: "f64" }
  | { kind: "bool" }
  | { kind: "string" }
  | { kind: "array"; element: FerraType; size: number }
  | { kind: "struct"; name: string }
  | { kind: "ref"; inner: FerraType };

export type StructInfo = { name: string; fields: { name: string; type: FerraType }[] };

export type FnInfo = { name: string; params: { name: string; type: FerraType }[]; ret: FerraType; pythonModule?: string };

export type CheckedProgram = {
  ast: Program;
  structs: Map<string, StructInfo>;
  fns: Map<string, FnInfo>;
  exprTypes: Map<Expr, FerraType>;
  types: Map<TypeAst, FerraType>;
  target: "native" | "python";
};

const PRIMS = new Set(["i32", "i64", "f32", "f64", "bool", "string"]);

export function typeName(t: FerraType): string {
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

export function isCopy(t: FerraType): boolean {
  return t.kind === "i32" || t.kind === "i64" || t.kind === "f32" || t.kind === "f64" || t.kind === "bool" || t.kind === "ref";
}

export function sameType(a: FerraType, b: FerraType): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "array" && b.kind === "array") return a.size === b.size && sameType(a.element, b.element);
  if (a.kind === "struct" && b.kind === "struct") return a.name === b.name;
  if (a.kind === "ref" && b.kind === "ref") return sameType(a.inner, b.inner);
  return true;
}

type VarInfo = {
  type: FerraType;
  mut: boolean;
  state: "owned" | "moved";
  borrowCount: number;
  borrowedFrom?: VarInfo;
  loopDepth: number;
};

class Scope {
  vars = new Map<string, VarInfo>();
  order: string[] = [];
}

export function typecheck(ast: Program, source: string, filename: string, target: "native" | "python" = "native"): CheckedProgram {
  return new Typechecker(ast, source, filename, target).run();
}

class Typechecker {
  structs = new Map<string, StructInfo>();
  fns = new Map<string, FnInfo>();
  scopes: Scope[] = [];
  currentRet: FerraType | null = null;
  stmtBorrows: VarInfo[] = [];
  exprTypes = new Map<Expr, FerraType>();
  types = new Map<TypeAst, FerraType>();
  loopDepth = 0;

  constructor(
    private ast: Program,
    private source: string,
    private filename: string,
    private target: "native" | "python",
  ) {}

  run(): CheckedProgram {
    for (const d of this.ast.decls) {
      if (d.kind === "struct") {
        if (this.structs.has(d.name) || PRIMS.has(d.name)) {
          this.err("FER216", `duplicate definition of '${d.name}'`, d.span);
        }
        this.structs.set(d.name, { name: d.name, fields: [] });
      }
    }
    for (const d of this.ast.decls) {
      if (d.kind !== "struct") continue;
      const fields: StructInfo["fields"] = [];
      const seen = new Set<string>();
      for (const f of d.fields) {
        if (seen.has(f.name)) this.err("FER216", `duplicate field '${f.name}'`, f.span);
        seen.add(f.name);
        fields.push({ name: f.name, type: this.resolve(f.type) });
      }
      this.structs.set(d.name, { name: d.name, fields });
    }

    // Reject infinite layouts before emitting LLVM types.
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (t: FerraType): void => {
      if (t.kind === "ref") this.err("FER224", "references cannot be stored in aggregates", this.ast.span);
      if (t.kind === "array") visit(t.element);
      if (t.kind !== "struct" || done.has(t.name)) return;
      if (visiting.has(t.name)) this.err("FER228", "recursive value layout requires indirection", this.ast.span);
      visiting.add(t.name);
      for (const f of this.structs.get(t.name)!.fields) visit(f.type);
      visiting.delete(t.name);
      done.add(t.name);
    };
    for (const name of this.structs.keys()) visit({ kind: "struct", name });

    this.fns.set("print", {
      name: "print",
      params: [{ name: "s", type: { kind: "ref", inner: { kind: "string" } } }],
      ret: { kind: "i32" },
    });

    for (const d of this.ast.decls) {
      if (d.kind !== "fn" && d.kind !== "python") continue;
      if (this.fns.has(d.name)) this.err("FER216", `duplicate definition of '${d.name}'`, d.span);
      this.fns.set(d.name, {
        name: d.name,
        params: d.params.map((p) => ({ name: p.name, type: this.resolve(p.type) })),
        ret: this.resolve(d.returnType),
        pythonModule: d.kind === "python" ? d.module : undefined,
      });
    }

    for (const d of this.ast.decls) {
      if (d.kind === "struct") continue;
      const fn = this.fns.get(d.name)!;
      if (fn.ret.kind === "ref") this.err("FER224", "returning references is not supported", d.returnType.span);
      if (d.kind === "python" || (this.target === "python" && !d.name.startsWith("_"))) {
        for (const t of [...fn.params.map(p => p.type), fn.ret]) {
          if (!pythonType(t)) this.err("FER229", "Python boundary requires scalars, strings, or fixed numeric arrays", d.span);
        }
      }
      const names = new Set<string>();
      for (const param of d.params) {
        if (names.has(param.name)) this.err("FER216", `duplicate parameter '${param.name}'`, param.span);
        names.add(param.name);
      }
    }
    const main = this.fns.get("main");
    if (this.target === "native" && (!main || main.pythonModule)) this.err("FER214", "program must define 'main() -> i32'", this.ast.span, "add: def main() -> i32:");
    if (this.target === "native" && main && (main.params.length !== 0 || main.ret.kind !== "i32")) {
      const span = this.ast.decls.find((d) => d.kind === "fn" && d.name === "main")!.span;
      this.err("FER215", "main must be 'def main() -> i32'", span);
    }

    for (const d of this.ast.decls) {
      if (d.kind === "fn") this.checkFn(d);
    }
    return { ast: this.ast, structs: this.structs, fns: this.fns, exprTypes: this.exprTypes, types: this.types, target: this.target };
  }

  private checkFn(fn: FnDecl) {
    this.currentRet = this.fns.get(fn.name)!.ret;
    this.scopes = [new Scope()];
    for (const p of fn.params) {
      this.define(p.name, this.resolve(p.type), false, p.span);
    }
    this.checkBlock(fn.body);
    if (!alwaysReturns(fn.body)) {
      this.err("FER208", `function '${fn.name}' may exit without returning`, fn.span, "every path must 'return' a value");
    }
    this.scopes = [];
  }

  private checkBlock(stmts: Stmt[]) {
    this.scopes.push(new Scope());
    for (const s of stmts) {
      this.checkStmt(s);
      if (alwaysReturns([s])) break;
    }
    this.popScope();
  }

  private checkStmt(stmt: Stmt) {
    this.stmtBorrows = [];
    switch (stmt.kind) {
      case "let": {
        const ty = this.resolve(stmt.type);
        const val = this.checkExpr(stmt.value, ty);
        this.expectType(val, ty, stmt.value.span);
        // Resolve the owner before a new binding can shadow its name.
        const from = ty.kind === "ref" ? this.borrowSource(stmt.value) : undefined;
        this.define(stmt.name, ty, stmt.mut, stmt.span);
        if (from) {
          this.lookup(stmt.name)!.borrowedFrom = from;
          from.borrowCount++;
        }
        break;
      }
      case "assign": {
        this.checkAssign(stmt.target, stmt.value);
        break;
      }
      case "return": {
        const ty = this.checkExpr(stmt.value, this.currentRet);
        this.expectType(ty, this.currentRet!, stmt.value.span, "FER207");
        break;
      }
      case "if": {
        const c = this.checkExpr(stmt.cond, { kind: "bool" });
        this.expectType(c, { kind: "bool" }, stmt.cond.span, "FER226");
        this.releaseStmtBorrows();
        const before = this.snapshot();
        if (before.size === 0) {
          this.checkBlock(stmt.then);
          if (stmt.else_) this.checkBlock(stmt.else_);
          return;
        }
        this.checkBlock(stmt.then);
        const thenState = this.snapshot();
        this.restore(before);
        if (stmt.else_) this.checkBlock(stmt.else_);
        const elseState = this.snapshot();
        const paths = [];
        if (!alwaysReturns(stmt.then)) paths.push(thenState);
        if (!stmt.else_ || !alwaysReturns(stmt.else_)) paths.push(elseState);
        this.restore(before);
        for (const [v] of before) {
          v.state = paths.some(path => path.get(v) === "moved") ? "moved" : (paths[0]?.get(v) ?? v.state);
        }
        return;
      }
      case "while": {
        const before = this.snapshot();
        this.loopDepth++;
        const c = this.checkExpr(stmt.cond, { kind: "bool" });
        this.expectType(c, { kind: "bool" }, stmt.cond.span, "FER227");
        this.releaseStmtBorrows();
        this.checkBlock(stmt.body);
        this.loopDepth--;
        this.restore(before);
        return;
      }
      case "for": {
        const s = this.checkExpr(stmt.start, { kind: "i32" });
        const e = this.checkExpr(stmt.end, { kind: "i32" });
        this.expectType(s, { kind: "i32" }, stmt.start.span);
        this.expectType(e, { kind: "i32" }, stmt.end.span);
        this.releaseStmtBorrows();
        const before = this.snapshot();
        this.loopDepth++;
        this.scopes.push(new Scope());
        this.define(stmt.name, { kind: "i32" }, false, stmt.span);
        for (const b of stmt.body) {
          this.checkStmt(b);
          if (alwaysReturns([b])) break;
        }
        this.popScope();
        this.loopDepth--;
        this.restore(before);
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
      if (!v.mut) this.err("FER217", `cannot assign to immutable '${target.name}'`, target.span, "declare with 'let mut'");
      if (v.borrowCount > 0) this.err("FER220", `cannot mutate '${target.name}' while it is borrowed`, target.span);
      const ty = this.checkExpr(value, v.type);
      this.expectType(ty, v.type, value.span);
      this.dropRef(v);
      v.state = "owned";
      v.borrowCount = 0;

      return;
    }
    if (target.kind === "index") {
      const t = this.deref(this.checkPlace(target.target));
      if (t.kind !== "array") this.err("FER212", `cannot index '${typeName(t)}'`, target.target.span);
      const i = this.checkExpr(target.index, { kind: "i32" });
      this.expectType(i, { kind: "i32" }, target.index.span);
      this.checkIndex(target.index, t.size);
      const val = this.checkExpr(value, t.element);
      this.expectType(val, t.element, value.span);
      this.requireLiveRoot(target);
      return;
    }
    if (target.kind === "field") {
      const t = this.deref(this.checkPlace(target.target));
      if (t.kind !== "struct") this.err("FER209", `cannot access field on '${typeName(t)}'`, target.span);
      const st = this.structs.get(t.name)!;
      const f = st.fields.find((x) => x.name === target.name);
      if (!f) this.err("FER209", `no field '${target.name}' on ${t.name}`, target.span);
      const val = this.checkExpr(value, f.type);
      this.expectType(val, f.type, value.span);
      this.requireLiveRoot(target);
      return;
    }
    this.err("FER105", "invalid assignment target", target.span);
  }

  private checkExpr(expr: Expr, expected: FerraType | null): FerraType {
    const ty = this.inferExpr(expr, expected);
    this.exprTypes.set(expr, ty);
    return ty;
  }

  private inferExpr(expr: Expr, expected: FerraType | null): FerraType {
    switch (expr.kind) {
      case "int": {
        const ty =
          expected?.kind === "i32" || expected?.kind === "i64" ? expected : { kind: "i32" as const };
        const overflow = ty.kind === "i64" ? BigInt(expr.raw) > 9223372036854775807n : Number(expr.raw) > 2147483647;
        if (overflow) this.err("FER201", `integer literal does not fit in ${ty.kind}`, expr.span);
        return ty;
      }
      case "float": {
        const ty: FerraType = expected?.kind === "f32" ? expected : { kind: "f64" };
        const n = Number(expr.raw);
        if (!Number.isFinite(ty.kind === "f32" ? Math.fround(n) : n)) this.err("FER201", "float literal out of range", expr.span);
        return ty;
      }
      case "bool":
        return { kind: "bool" };
      case "string":
        return { kind: "string" };
      case "name":
        return this.useVar(expr.name, expr.span, expected);
      case "unary": {
        if (expr.op === "-" && expr.expr.kind === "int") {
          const ty: FerraType = expected?.kind === "i64" ? expected : { kind: "i32" };
          const max = ty.kind === "i64" ? 9223372036854775808n : 2147483648n;
          if (BigInt(expr.expr.raw) > max) this.err("FER201", `integer literal does not fit in ${ty.kind}`, expr.span);
          this.exprTypes.set(expr.expr, ty);
          return ty;
        }
        if (expr.op === "not") {
          const t = this.checkExpr(expr.expr, { kind: "bool" });
          this.expectType(t, { kind: "bool" }, expr.expr.span);
          return { kind: "bool" };
        }
        const t = this.checkExpr(expr.expr, expected);
        if (t.kind !== "i32" && t.kind !== "i64" && t.kind !== "f32" && t.kind !== "f64") {
          this.err("FER211", `unary '-' is not valid for '${typeName(t)}'`, expr.span);
        }
        return t;
      }
      case "borrow": {
        if (expr.expr.kind !== "name") {
          this.err("FER222", "can only borrow a variable name", expr.expr.span, "v0 allows '&x' but not '&p.x'");
        }
        const v = this.requireVar(expr.expr.name, expr.expr.span);
        if (v.state === "moved") this.err("FER223", `cannot borrow '${expr.expr.name}' after it was moved`, expr.span);
        if (v.type.kind === "ref") this.err("FER224", "nested references are not supported", expr.span);
        v.borrowCount++;
        this.stmtBorrows.push(v);
        return { kind: "ref", inner: v.type };
      }
      case "binary":
        return this.checkBinary(expr, expected);
      case "call":
        return this.checkCall(expr, expected);
      case "index": {
        const t = this.deref(this.checkPlace(expr.target));
        if (t.kind !== "array") this.err("FER212", `cannot index '${typeName(t)}'`, expr.target.span);
        const i = this.checkExpr(expr.index, { kind: "i32" });
        this.expectType(i, { kind: "i32" }, expr.index.span);
        this.checkIndex(expr.index, t.size);
        if (!isCopy(t.element)) this.movePlace(expr.target, expr.span);
        return t.element;
      }
      case "field": {
        const t = this.deref(this.checkPlace(expr.target));
        if (t.kind !== "struct") this.err("FER209", `cannot access field on '${typeName(t)}'`, expr.span);
        const st = this.structs.get(t.name);
        if (!st) this.err("FER210", `unknown struct '${t.name}'`, expr.span);
        const f = st.fields.find((x) => x.name === expr.name);
        if (!f) this.err("FER209", `no field '${expr.name}' on ${t.name}`, expr.span);
        if (!isCopy(f.type)) this.movePlace(expr.target, expr.span);
        return f.type;
      }
      case "struct": {
        const st = this.structs.get(expr.name);
        if (!st) this.err("FER210", `unknown struct '${expr.name}'`, expr.span);
        const seen = new Set<string>();
        for (const f of expr.fields) {
          if (seen.has(f.name)) this.err("FER216", `duplicate field '${f.name}'`, f.span);
          seen.add(f.name);
          const def = st.fields.find((x) => x.name === f.name);
          if (!def) this.err("FER209", `no field '${f.name}' on ${expr.name}`, f.span);
          const ty = this.checkExpr(f.value, def.type);
          this.expectType(ty, def.type, f.value.span);
        }
        for (const def of st.fields) {
          if (!seen.has(def.name)) this.err("FER201", `missing field '${def.name}' in ${expr.name}`, expr.span);
        }
        return { kind: "struct", name: expr.name };
      }
      case "array": {
        let elem: FerraType | null =
          expected?.kind === "array" ? expected.element : expected?.kind === "ref" && expected.inner.kind === "array" ? expected.inner.element : null;
        if (expr.elements.length === 0 && !elem) {
          this.err("FER201", "cannot infer type of empty array", expr.span, "annotate the let binding");
        }
        const types = expr.elements.map((el) => this.checkExpr(el, elem));
        elem = elem ?? types[0]!;
        for (let i = 0; i < types.length; i++) this.expectType(types[i]!, elem, expr.elements[i]!.span);
        const size = expected?.kind === "array" ? expected.size : expr.elements.length;
        if (expr.elements.length !== size) {
          this.err("FER213", `array literal has ${expr.elements.length} elements, expected ${size}`, expr.span);
        }
        return { kind: "array", element: elem, size };
      }
    }
  }

  private checkBinary(expr: Extract<Expr, { kind: "binary" }>, expected: FerraType | null): FerraType {
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
        "FER221",
        `cannot apply '${op}' to '${typeName(l)}' and '${typeName(r)}'`,
        expr.span,
        "Ferra has no implicit numeric conversion",
      );
    }
    if (cmp.includes(op)) {
      if (l.kind === "bool" && op !== "==" && op !== "!=") {
        this.err("FER225", `cannot order bool values with '${op}'`, expr.span);
      }
      if (l.kind === "string" || l.kind === "array" || l.kind === "struct" || l.kind === "ref") {
        this.err("FER225", `cannot compare '${typeName(l)}' with '${op}'`, expr.span);
      }
      return { kind: "bool" };
    }
    if (op === "%" && (l.kind === "f32" || l.kind === "f64")) {
      this.err("FER211", "'%' is only valid for integers", expr.span);
    }
    if (l.kind !== "i32" && l.kind !== "i64" && l.kind !== "f32" && l.kind !== "f64") {
      this.err("FER211", `arithmetic is not valid for '${typeName(l)}'`, expr.span);
    }
    return l;
  }

  private checkCall(expr: Extract<Expr, { kind: "call" }>, _expected: FerraType | null): FerraType {
    const fn = this.fns.get(expr.callee);
    if (!fn) this.err("FER205", `unknown function '${expr.callee}'`, expr.span);
    if (expr.args.length !== fn.params.length) {
      this.err("FER206", `'${fn.name}' expects ${fn.params.length} argument(s), got ${expr.args.length}`, expr.span);
    }
    for (let i = 0; i < fn.params.length; i++) {
      const param = fn.params[i]!.type;
      const arg = expr.args[i]!;
      let actual: FerraType;
      if (param.kind === "ref" && arg.kind === "name") {
        const v = this.requireVar(arg.name, arg.span);
        if (v.state === "moved") this.err("FER223", `cannot borrow '${arg.name}' after it was moved`, arg.span);
        if (sameType(v.type, param.inner)) {
          v.borrowCount++;
          this.stmtBorrows.push(v);
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

  private useVar(name: string, span: Span, expected: FerraType | null): FerraType {
    const v = this.requireVar(name, span);
    if (v.state === "moved") {
      this.err("FER218", `use of moved value '${name}'`, span, "borrow with '&' or re-bind a new value");
    }
    const ty = v.type;
    if (expected?.kind === "ref" && sameType(ty, expected.inner)) {
      v.borrowCount++;
      this.stmtBorrows.push(v);
      return expected;
    }
    if (!isCopy(ty)) {
      if (v.borrowCount > 0) this.err("FER219", `cannot move '${name}' while it is borrowed`, span);
      this.checkLoopMove(v, span);
      v.state = "moved";
    }
    return ty;
  }

  private resolve(t: TypeAst): FerraType {
    const cached = this.types.get(t);
    if (cached) return cached;
    const ty = this.resolveType(t);
    this.types.set(t, ty);
    return ty;
  }

  private resolveType(t: TypeAst): FerraType {
    switch (t.kind) {
      case "named":
        if (PRIMS.has(t.name)) return { kind: t.name as "i32" };
        if (this.structs.has(t.name)) return { kind: "struct", name: t.name };
        this.err("FER202", `unknown type '${t.name}'`, t.span);
        break;
      case "array": {
        const element = this.resolve(t.element);
        if (element.kind === "ref") this.err("FER224", "arrays cannot contain references", t.span);
        return { kind: "array", element, size: t.size };
      }
      case "ref": {
        const inner = this.resolve(t.inner);
        if (inner.kind === "ref") this.err("FER224", "nested references are not supported", t.span);
        return { kind: "ref", inner };
      }
    }
  }

  private define(name: string, type: FerraType, mut: boolean, span: Span) {
    const cur = this.scopes[this.scopes.length - 1]!;
    if (cur.vars.has(name)) this.err("FER216", `duplicate variable '${name}'`, span);
    if (type.kind === "ref" && mut) this.err("FER224", "reference bindings must be immutable", span);
    cur.vars.set(name, { type, mut, state: "owned", borrowCount: 0, loopDepth: this.loopDepth });
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
    if (!v) this.err("FER203", `unknown variable '${name}'`, span);
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
      const src = v.borrowedFrom;
      if (src && src.borrowCount > 0) src.borrowCount--;
      v.borrowedFrom = undefined;
    }
  }

  private releaseStmtBorrows() {
    for (const v of this.stmtBorrows) {
      if (v && v.borrowCount > 0) v.borrowCount--;
    }
    this.stmtBorrows = [];
  }

  private requireLiveRoot(expr: Expr): void {
    if (expr.kind === "field" || expr.kind === "index") return this.requireLiveRoot(expr.target);
    if (expr.kind === "name") this.checkPlace(expr);
  }

  private requireMutPlace(expr: Expr) {
    if (expr.kind === "name") {
      const v = this.requireVar(expr.name, expr.span);
      if (v.type.kind === "ref") this.err("FER224", "cannot mutate through a shared reference", expr.span);
      if (!v.mut) this.err("FER217", `cannot assign to immutable '${expr.name}'`, expr.span, "declare with 'let mut'");
      if (v.borrowCount > 0) this.err("FER220", `cannot mutate '${expr.name}' while it is borrowed`, expr.span);
      return;
    }
    if (expr.kind === "field" || expr.kind === "index") {
      this.requireMutPlace(expr.target);
      return;
    }
    this.err("FER105", "assignment requires an owned mutable variable", expr.span);
  }

  private checkPlace(expr: Expr): FerraType {
    const ty = this.inferPlace(expr);
    this.exprTypes.set(expr, ty);
    return ty;
  }

  private inferPlace(expr: Expr): FerraType {
    if (expr.kind === "name") {
      const v = this.requireVar(expr.name, expr.span);
      if (v.state === "moved") {
        this.err("FER218", `use of moved value '${expr.name}'`, expr.span, "borrow with '&' or re-bind a new value");
      }
      return v.type;
    }
    if (expr.kind === "field") {
      const t = this.deref(this.checkPlace(expr.target));
      if (t.kind !== "struct") this.err("FER209", `cannot access field on '${typeName(t)}'`, expr.span);
      const st = this.structs.get(t.name)!;
      const f = st.fields.find((x) => x.name === expr.name);
      if (!f) this.err("FER209", `no field '${expr.name}' on ${t.name}`, expr.span);
      return f.type;
    }
    if (expr.kind === "index") {
      const t = this.deref(this.checkPlace(expr.target));
      if (t.kind !== "array") this.err("FER212", `cannot index '${typeName(t)}'`, expr.target.span);
      const i = this.checkExpr(expr.index, { kind: "i32" });
      this.expectType(i, { kind: "i32" }, expr.index.span);
      this.checkIndex(expr.index, t.size);
      return t.element;
    }
    return this.checkExpr(expr, null);
  }

  private movePlace(expr: Expr, span: Span): void {
    if (expr.kind === "field" || expr.kind === "index") return this.movePlace(expr.target, span);
    if (expr.kind === "name") {
      const v = this.requireVar(expr.name, expr.span);
      if (v.type.kind === "ref") this.err("FER224", "cannot move a non-Copy value through a reference", span);
      if (v.borrowCount > 0) this.err("FER219", `cannot move '${expr.name}' while it is borrowed`, span);
      this.checkLoopMove(v, span);
      v.state = "moved";
    }
  }

  private borrowSource(expr: Expr): VarInfo | undefined {
    if (expr.kind === "borrow" && expr.expr.kind === "name") return this.lookup(expr.expr.name);
    if (expr.kind === "name") {
      const v = this.lookup(expr.name);
      return v?.type.kind === "ref" ? v.borrowedFrom : v;
    }
    return undefined;
  }

  private checkLoopMove(v: VarInfo, span: Span) {
    // ponytail: conservative loops; use fixed-point dataflow if loop-carried moves are needed.
    if (v.loopDepth < this.loopDepth) this.err("FER230", "cannot move an outer value in a loop", span, "borrow it instead, or create the value inside the loop");
  }

  private snapshot() {
    const state = new Map<VarInfo, "owned" | "moved">();
    for (const scope of this.scopes) for (const v of scope.vars.values()) {
      if (!isCopy(v.type)) state.set(v, v.state);
    }
    return state;
  }

  private restore(state: Map<VarInfo, "owned" | "moved">) {
    for (const [v, owned] of state) v.state = owned;
  }

  private checkIndex(expr: Expr, size: number) {
    const n = expr.kind === "int" ? BigInt(expr.raw) : expr.kind === "unary" && expr.op === "-" && expr.expr.kind === "int" ? -BigInt(expr.expr.raw) : null;
    if (n !== null && (n < 0n || n >= BigInt(size))) this.err("FER231", "array index out of bounds", expr.span);
  }

  private deref(t: FerraType): FerraType {
    return t.kind === "ref" ? t.inner : t;
  }

  private expectType(got: FerraType, want: FerraType, span: Span, code = "FER201") {
    if (!sameType(got, want)) {
      this.err(code, `type mismatch: expected ${typeName(want)}, found ${typeName(got)}`, span, "Ferra does not coerce types");
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

export function pythonType(t: FerraType): boolean {
  if (t.kind === "ref") return t.inner.kind !== "ref" && pythonType(t.inner);
  if (t.kind === "array") return ["i32", "i64", "f32", "f64", "bool"].includes(t.element.kind);
  return t.kind !== "struct";
}
