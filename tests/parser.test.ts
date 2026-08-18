import { describe, expect, it } from "vitest";
import { CompileError } from "../src/diagnostics";
import { lex } from "../src/lexer";
import { parse } from "../src/parser";

function ast(src: string) {
  return parse(lex(src, "t.fe"), src, "t.fe");
}

function err(src: string): CompileError {
  try {
    ast(src);
    throw new Error("expected parse error");
  } catch (e) {
    if (e instanceof CompileError) return e;
    throw e;
  }
}

const fib = `def fib(n: i32) -> i32:
    if n <= 1:
        return n
    return fib(n - 1) + fib(n - 2)

def main() -> i32:
    return fib(10)
`;

describe("parser", () => {
  it("parses fibonacci", () => {
    const p = ast(fib);
    expect(p.decls.map((d) => d.kind + ":" + d.name)).toEqual(["fn:fib", "fn:main"]);
    const fn = p.decls[0];
    if (fn.kind !== "fn") throw new Error("expected fn");
    expect(fn.params[0]!.name).toBe("n");
    expect(fn.body[0]!.kind).toBe("if");
  });

  it("parses structs, lets, loops, and arrays", () => {
    const src = `struct Point:
    x: i32
    y: i32

def main() -> i32:
    let mut p: Point = Point { x: 1, y: 2 }
    let a: [i32; 3] = [1, 2, 3]
    let s: i32 = 0
    for i in 0..3:
        s = s + a[i]
    while s < 10:
        s = s + 1
    p.x = p.x + 1
    return s
`;
    const p = ast(src);
    expect(p.decls[0]!.kind).toBe("struct");
    const fn = p.decls[1];
    if (fn.kind !== "fn") throw new Error("expected fn");
    expect(fn.body.map((s) => s.kind)).toEqual(["let", "let", "let", "for", "while", "assign", "return"]);
  });

  it("parses elif as nested if", () => {
    const src = `def main() -> i32:
    if false:
        return 1
    elif true:
        return 2
    else:
        return 3
`;
    const fn = ast(src).decls[0];
    if (fn.kind !== "fn") throw new Error("expected fn");
    const iff = fn.body[0];
    if (iff.kind !== "if" || !iff.else_ || iff.else_[0]!.kind !== "if") throw new Error("elif");
    expect(iff.else_[0]!.kind).toBe("if");
  });

  it("requires def or struct at top level", () => {
    const e = err("let x: i32 = 1\n");
    expect(e.code).toBe("FER101");
    expect(e.span.line).toBe(1);
    expect(e.format()).toContain("expected 'def' or 'struct'");
  });

  it("reports missing token with location", () => {
    const e = err("def main( -> i32:\n    return 0\n");
    expect(e.code).toBe("FER102");
    expect(e.span.line).toBe(1);
    expect(e.format()).toContain("error[FER102]");
  });

  it("rejects assignment to a literal", () => {
    const e = err("def main() -> i32:\n    1 = 2\n    return 0\n");
    expect(e.code).toBe("FER105");
    expect(e.span.line).toBe(2);
  });

  it("rejects a missing indented block after ':'", () => {
    const e = err("def main() -> i32:\n    if true:\n    return 0\n");
    expect(e.code).toBe("FER102");
    expect(e.format()).toContain("expected indent");
  });
});
