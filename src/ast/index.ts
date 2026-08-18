import { Span } from "../diagnostics";

export type TypeAst =
  | { kind: "named"; name: string; span: Span }
  | { kind: "array"; element: TypeAst; size: number; span: Span }
  | { kind: "ref"; inner: TypeAst; span: Span };

export type Expr =
  | { kind: "int"; raw: string; span: Span }
  | { kind: "float"; raw: string; span: Span }
  | { kind: "bool"; value: boolean; span: Span }
  | { kind: "string"; value: string; span: Span }
  | { kind: "name"; name: string; span: Span }
  | { kind: "binary"; op: string; left: Expr; right: Expr; span: Span }
  | { kind: "unary"; op: string; expr: Expr; span: Span }
  | { kind: "call"; callee: string; args: Expr[]; span: Span }
  | { kind: "index"; target: Expr; index: Expr; span: Span }
  | { kind: "field"; target: Expr; name: string; span: Span }
  | {
      kind: "struct";
      name: string;
      fields: { name: string; value: Expr; span: Span }[];
      span: Span;
    }
  | { kind: "array"; elements: Expr[]; span: Span }
  | { kind: "borrow"; expr: Expr; span: Span };

export type Stmt =
  | {
      kind: "let";
      mut: boolean;
      name: string;
      type: TypeAst;
      value: Expr;
      span: Span;
    }
  | { kind: "assign"; target: Expr; value: Expr; span: Span }
  | { kind: "return"; value: Expr; span: Span }
  | { kind: "if"; cond: Expr; then: Stmt[]; else_: Stmt[] | null; span: Span }
  | { kind: "while"; cond: Expr; body: Stmt[]; span: Span }
  | {
      kind: "for";
      name: string;
      start: Expr;
      end: Expr;
      body: Stmt[];
      span: Span;
    }
  | { kind: "expr"; expr: Expr; span: Span };

export type Param = { name: string; type: TypeAst; span: Span };

export type FnDecl = {
  kind: "fn";
  name: string;
  params: Param[];
  returnType: TypeAst;
  body: Stmt[];
  span: Span;
};

export type StructDecl = {
  kind: "struct";
  name: string;
  fields: { name: string; type: TypeAst; span: Span }[];
  span: Span;
};

export type Decl = FnDecl | StructDecl;

export type Program = { decls: Decl[]; span: Span };
