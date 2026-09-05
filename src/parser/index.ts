import {
  Decl,
  Expr,
  FnDecl,
  Param,
  Program,
  PythonDecl,
  Stmt,
  StructDecl,
  TypeAst,
} from "../ast";
import { CompileError, Span } from "../diagnostics";
import { Token, TokenKind } from "../lexer";

export function parse(tokens: Token[], source: string, filename: string): Program {
  return new Parser(tokens, source, filename).parseProgram();
}

class Parser {
  private i = 0;

  constructor(
    private tokens: Token[],
    private source: string,
    private filename: string,
  ) {}

  parseProgram(): Program {
    this.skipNL();
    const decls: Decl[] = [];
    const start = this.peek().span;
    while (!this.at("eof")) {
      this.skipNL();
      if (this.at("eof")) break;
      if (this.at("extern")) decls.push(this.parsePython());
      else if (this.at("def")) decls.push(this.parseFn());
      else if (this.at("struct")) decls.push(this.parseStruct());
      else {
        this.err(
          "LYC101",
          `unexpected ${this.describe(this.peek())}; expected 'def' or 'struct'`,
          this.peek().span,
          "top-level items must be functions or structs",
        );
      }
      this.skipNL();
    }
    const end = this.peek().span;
    return { decls, span: join(start, end) };
  }

  private parsePython(): PythonDecl {
    const start = this.expect("extern").span;
    this.expect("python");
    const module = this.expect("string");
    if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(module.value)) {
      this.err("LYC102", "expected a dotted Python module name", module.span);
    }
    this.expect("def");
    const name = this.expect("ident");
    this.expect("(");
    const params: Param[] = [];
    if (!this.at(")")) {
      params.push(this.parseParam());
      while (this.eat(",") && !this.at(")")) params.push(this.parseParam());
    }
    this.expect(")");
    this.expect("->");
    const returnType = this.parseType();
    this.expect("newline");
    return { kind: "python", module: module.value, name: name.value, params, returnType, span: join(start, returnType.span) };
  }

  private parseFn(): FnDecl {
    const start = this.expect("def").span;
    const nameTok = this.expect("ident");
    this.expect("(");
    const params: Param[] = [];
    this.skipNL();
    if (!this.at(")")) {
      params.push(this.parseParam());
      while (this.eat(",")) {
        this.skipNL();
        if (this.at(")")) break;
        params.push(this.parseParam());
      }
    }
    this.expect(")");
    this.expect("->");
    const returnType = this.parseType();
    const body = this.parseBlock();
    return {
      kind: "fn",
      name: nameTok.value,
      params,
      returnType,
      body,
      span: join(start, body.at(-1)?.span ?? returnType.span),
    };
  }

  private parseParam(): Param {
    const name = this.expect("ident");
    this.expect(":");
    const type = this.parseType();
    return { name: name.value, type, span: join(name.span, type.span) };
  }

  private parseStruct(): StructDecl {
    const start = this.expect("struct").span;
    const name = this.expect("ident");
    this.expect(":");
    this.expect("newline");
    this.skipNL();
    this.expect("indent");
    const fields: StructDecl["fields"] = [];
    while (!this.at("dedent") && !this.at("eof")) {
      this.skipNL();
      if (this.at("dedent") || this.at("eof")) break;
      const fname = this.expect("ident");
      this.expect(":");
      const type = this.parseType();
      fields.push({ name: fname.value, type, span: join(fname.span, type.span) });
      if (this.at("newline")) this.bump();
    }
    const end = this.expect("dedent").span;
    if (fields.length === 0) {
      this.err("LYC101", "struct must have at least one field", name.span);
    }
    return { kind: "struct", name: name.value, fields, span: join(start, end) };
  }

  private parseBlock(): Stmt[] {
    this.expect(":");
    this.expect("newline");
    this.skipNL();
    this.expect("indent");
    const stmts: Stmt[] = [];
    while (!this.at("dedent") && !this.at("eof")) {
      this.skipNL();
      if (this.at("dedent") || this.at("eof")) break;
      const stmt = this.parseStmt();
      stmts.push(stmt);
      if (!["if", "while", "for"].includes(stmt.kind) && !this.at("newline", "dedent", "eof")) {
        this.err("LYC102", "expected newline after statement", this.peek().span);
      }
      this.skipNL();
    }
    this.expect("dedent");
    if (stmts.length === 0) {
      this.err("LYC104", "indented block cannot be empty", this.peek().span);
    }
    return stmts;
  }

  private parseStmt(): Stmt {
    if (this.at("let")) return this.parseLet();
    if (this.at("return")) return this.parseReturn();
    if (this.at("if")) return this.parseIf();
    if (this.at("while")) return this.parseWhile();
    if (this.at("for")) return this.parseFor();
    const expr = this.parseExpr();
    if (this.eat("=")) {
      const value = this.parseExpr();
      if (!isLvalue(expr)) {
        this.err(
          "LYC105",
          "invalid assignment target",
          expr.span,
          "assign to a name, field, or array index",
        );
      }
      return { kind: "assign", target: expr, value, span: join(expr.span, value.span) };
    }
    return { kind: "expr", expr, span: expr.span };
  }

  private parseLet(): Stmt {
    const start = this.expect("let").span;
    const mut = this.eat("mut");
    const name = this.expect("ident");
    this.expect(":");
    const type = this.parseType();
    this.expect("=");
    const value = this.parseExpr();
    return {
      kind: "let",
      mut,
      name: name.value,
      type,
      value,
      span: join(start, value.span),
    };
  }

  private parseReturn(): Stmt {
    const start = this.expect("return").span;
    const value = this.parseExpr();
    return { kind: "return", value, span: join(start, value.span) };
  }

  private parseIf(): Stmt {
    const start = this.expect("if").span;
    const cond = this.parseExpr();
    const then = this.parseBlock();
    let else_: Stmt[] | null = null;
    this.skipNL();
    if (this.eat("elif")) {
      const inner = this.parseElifRest(this.peek().span);
      else_ = [inner];
    } else if (this.eat("else")) {
      else_ = this.parseBlock();
    }
    return { kind: "if", cond, then, else_, span: join(start, (else_ ?? then).at(-1)?.span ?? cond.span) };
  }

  private parseElifRest(span: Span): Stmt {
    const cond = this.parseExpr();
    const then = this.parseBlock();
    let else_: Stmt[] | null = null;
    this.skipNL();
    if (this.eat("elif")) else_ = [this.parseElifRest(this.peek().span)];
    else if (this.eat("else")) else_ = this.parseBlock();
    return { kind: "if", cond, then, else_, span };
  }

  private parseWhile(): Stmt {
    const start = this.expect("while").span;
    const cond = this.parseExpr();
    const body = this.parseBlock();
    return { kind: "while", cond, body, span: join(start, body.at(-1)!.span) };
  }

  private parseFor(): Stmt {
    const start = this.expect("for").span;
    const name = this.expect("ident");
    this.expect("in");
    const rangeStart = this.parseExpr();
    this.expect("..");
    const end = this.parseExpr();
    const body = this.parseBlock();
    return {
      kind: "for",
      name: name.value,
      start: rangeStart,
      end,
      body,
      span: join(start, body.at(-1)!.span),
    };
  }

  private parseType(): TypeAst {
    if (this.eat("&")) {
      const inner = this.parseType();
      return { kind: "ref", inner, span: join(this.prev().span, inner.span) };
    }
    if (this.eat("[")) {
      const lbr = this.prev().span;
      const element = this.parseType();
      this.expect(";");
      const sizeTok = this.expect("int");
      const rbr = this.expect("]").span;
      const size = Number(sizeTok.value);
      if (size < 0 || !Number.isSafeInteger(size) || size > 2147483647) {
        this.err("LYC101", "array size must be a non-negative integer", sizeTok.span);
      }
      return { kind: "array", element, size, span: join(lbr, rbr) };
    }
    const name = this.expect("ident");
    return { kind: "named", name: name.value, span: name.span };
  }

  private parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.eat("or")) {
      const right = this.parseAnd();
      left = { kind: "binary", op: "or", left, right, span: join(left.span, right.span) };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.eat("and")) {
      const right = this.parseNot();
      left = { kind: "binary", op: "and", left, right, span: join(left.span, right.span) };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.eat("not")) {
      const op = this.prev();
      const expr = this.parseNot();
      return { kind: "unary", op: "not", expr, span: join(op.span, expr.span) };
    }
    return this.parseCmp();
  }

  private parseCmp(): Expr {
    let left = this.parseAdd();
    if (this.at("==", "!=", "<", ">", "<=", ">=")) {
      const op = this.bump().kind;
      const right = this.parseAdd();
      left = { kind: "binary", op, left, right, span: join(left.span, right.span) };
    }
    return left;
  }

  private parseAdd(): Expr {
    let left = this.parseMul();
    while (this.at("+", "-")) {
      const op = this.bump().kind;
      const right = this.parseMul();
      left = { kind: "binary", op, left, right, span: join(left.span, right.span) };
    }
    return left;
  }

  private parseMul(): Expr {
    let left = this.parseUnary();
    while (this.at("*", "/", "%")) {
      const op = this.bump().kind;
      const right = this.parseUnary();
      left = { kind: "binary", op, left, right, span: join(left.span, right.span) };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.eat("-")) {
      const op = this.prev();
      const expr = this.parseUnary();
      return { kind: "unary", op: "-", expr, span: join(op.span, expr.span) };
    }
    if (this.eat("&")) {
      const op = this.prev();
      const expr = this.parseUnary();
      return { kind: "borrow", expr, span: join(op.span, expr.span) };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parseAtom();
    for (;;) {
      if (this.eat("(")) {
        if (expr.kind !== "name") {
          this.err("LYC101", "only named functions can be called", expr.span);
        }
        const args: Expr[] = [];
        this.skipNL();
        if (!this.at(")")) {
          args.push(this.parseExpr());
          while (this.eat(",")) {
            this.skipNL();
            if (this.at(")")) break;
            args.push(this.parseExpr());
          }
        }
        const end = this.expect(")").span;
        expr = { kind: "call", callee: expr.name, args, span: join(expr.span, end) };
        continue;
      }
      if (this.eat("[")) {
        const index = this.parseExpr();
        const end = this.expect("]").span;
        expr = { kind: "index", target: expr, index, span: join(expr.span, end) };
        continue;
      }
      if (this.eat(".")) {
        const name = this.expect("ident");
        expr = { kind: "field", target: expr, name: name.value, span: join(expr.span, name.span) };
        continue;
      }
      break;
    }
    return expr;
  }

  private parseAtom(): Expr {
    if (this.at("int")) {
      const t = this.bump();
      return { kind: "int", raw: t.value, span: t.span };
    }
    if (this.at("float")) {
      const t = this.bump();
      return { kind: "float", raw: t.value, span: t.span };
    }
    if (this.at("string")) {
      const t = this.bump();
      return { kind: "string", value: t.value, span: t.span };
    }
    if (this.at("true") || this.at("false")) {
      const t = this.bump();
      return { kind: "bool", value: t.kind === "true", span: t.span };
    }
    if (this.at("ident")) {
      const t = this.bump();
      if (this.at("{")) return this.parseStructLit(t);
      return { kind: "name", name: t.value, span: t.span };
    }
    if (this.eat("(")) {
      const inner = this.parseExpr();
      this.expect(")");
      return inner;
    }
    if (this.eat("[")) {
      const start = this.prev().span;
      const elements: Expr[] = [];
      this.skipNL();
      if (!this.at("]")) {
        elements.push(this.parseExpr());
        while (this.eat(",")) {
          this.skipNL();
          if (this.at("]")) break;
          elements.push(this.parseExpr());
        }
      }
      const end = this.expect("]").span;
      return { kind: "array", elements, span: join(start, end) };
    }
    this.err("LYC101", `unexpected ${this.describe(this.peek())} in expression`, this.peek().span);
  }

  private parseStructLit(name: Token): Expr {
    this.expect("{");
    const fields: { name: string; value: Expr; span: Span }[] = [];
    this.skipNL();
    if (!this.at("}")) {
      for (;;) {
        const fname = this.expect("ident");
        this.expect(":");
        const value = this.parseExpr();
        fields.push({ name: fname.value, value, span: join(fname.span, value.span) });
        this.skipNL();
        if (!this.eat(",")) break;
        this.skipNL();
        if (this.at("}")) break;
      }
    }
    const end = this.expect("}").span;
    return { kind: "struct", name: name.value, fields, span: join(name.span, end) };
  }

  private skipNL() {
    while (this.at("newline")) this.bump();
  }

  private at(...kinds: TokenKind[]): boolean {
    const k = this.peek().kind;
    return kinds.includes(k);
  }

  private eat(kind: TokenKind): boolean {
    if (this.at(kind)) {
      this.bump();
      return true;
    }
    return false;
  }

  private bump(): Token {
    const t = this.tokens[this.i]!;
    if (t.kind !== "eof") this.i++;
    return t;
  }

  private prev(): Token {
    return this.tokens[this.i - 1]!;
  }

  private peek(): Token {
    return this.tokens[this.i]!;
  }

  private expect(kind: TokenKind): Token {
    if (!this.at(kind)) {
      this.err(
        "LYC102",
        `expected ${kind}, found ${this.describe(this.peek())}`,
        this.peek().span,
      );
    }
    return this.bump();
  }

  private describe(t: Token): string {
    if (t.kind === "eof") return "end of file";
    if (t.kind === "newline") return "newline";
    if (t.kind === "indent") return "indent";
    if (t.kind === "dedent") return "dedent";
    if (t.value) return `'${t.value}'`;
    return t.kind;
  }

  private err(code: string, message: string, span: Span, hint?: string): never {
    throw new CompileError(code, message, span, this.filename, this.source, hint);
  }
}

function join(a: Span, b: Span): Span {
  return { line: a.line, col: a.col, endLine: b.endLine, endCol: b.endCol };
}

function isLvalue(expr: Expr): boolean {
  return expr.kind === "name" || expr.kind === "index" || expr.kind === "field";
}
