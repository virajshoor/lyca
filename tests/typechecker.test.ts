import { describe, expect, it } from "vitest";
import { CompileError } from "../src/diagnostics";
import { lex } from "../src/lexer";
import { parse } from "../src/parser";
import { typecheck } from "../src/typechecker";

function check(src: string) {
  const ast = parse(lex(src, "t.lyca"), src, "t.lyca");
  return typecheck(ast, src, "t.lyca");
}

function err(src: string): CompileError {
  try {
    check(src);
    throw new Error("expected type error");
  } catch (e) {
    if (e instanceof CompileError) return e;
    throw e;
  }
}

describe("typechecker", () => {
  it("accepts a typed recursive function", () => {
    const src = `def fib(n: i32) -> i32:
    if n <= 1:
        return n
    return fib(n - 1) + fib(n - 2)

def main() -> i32:
    return fib(10)
`;
    expect(check(src).fns.has("fib")).toBe(true);
  });

  it("accepts structs, arrays, and for-range", () => {
    const src = `struct Point:
    x: i32
    y: i32

def main() -> i32:
    let mut p: Point = Point { x: 1, y: 2 }
    let a: [i32; 3] = [1, 2, 3]
    let mut s: i32 = 0
    for i in 0..3:
        s = s + a[i]
    p.x = p.y
    return s
`;
    check(src);
  });

  it("rejects type mismatch with line/column", () => {
    const src = `def main() -> i32:
    return true
`;
    const e = err(src);
    expect(e.code).toBe("LYC207");
    expect(e.span.line).toBe(2);
    expect(e.format()).toContain("expected i32, found bool");
    expect(e.format()).toContain("return true");
  });

  it("rejects implicit numeric coercion", () => {
    const src = `def main() -> i32:
    let x: i64 = 1
    return x
`;
    const e = err(src);
    expect(e.code).toBe("LYC207");
    expect(e.format()).toContain("i64");
  });

  it("rejects unknown variables and types", () => {
    expect(err(`def main() -> i32:\n    return y\n`).code).toBe("LYC203");
    expect(err(`def main() -> i32:\n    let x: Foo = 1\n    return 0\n`).code).toBe("LYC202");
  });

  it("rejects wrong arity and unknown functions", () => {
    expect(err(`def main() -> i32:\n    return foo()\n`).code).toBe("LYC205");
    const e = err(`def f(a: i32, b: i32) -> i32:\n    return a\ndef main() -> i32:\n    return f(1)\n`);
    expect(e.code).toBe("LYC206");
    expect(e.format()).toContain("expects 2");
  });

  it("requires main() -> i32", () => {
    expect(err(`def foo() -> i32:\n    return 0\n`).code).toBe("LYC214");
    expect(err(`def main(x: i32) -> i32:\n    return x\n`).code).toBe("LYC215");
  });

  it("requires a return on every path", () => {
    const e = err(`def main() -> i32:\n    let x: i32 = 1\n`);
    expect(e.code).toBe("LYC208");
  });

  it("rejects assigning to an immutable binding", () => {
    const e = err(`def main() -> i32:\n    let x: i32 = 1\n    x = 2\n    return x\n`);
    expect(e.code).toBe("LYC217");
    expect(e.span.line).toBe(3);
    expect(e.format()).toContain("let mut");
  });

  it("rejects use after move of a string", () => {
    const src = `def main() -> i32:
    let s: string = "hi"
    let t: string = s
    let u: string = s
    print(t)
    return 0
`;
    const e = err(src);
    expect(e.code).toBe("LYC218");
    expect(e.span.line).toBe(4);
    expect(e.format()).toContain("moved value");
  });

  it("allows borrowing instead of moving", () => {
    const src = `def main() -> i32:
    let s: string = "hi"
    let r: &string = &s
    print(r)
    print(s)
    return 0
`;
    check(src);
  });

  it("rejects moving a borrowed value", () => {
    const src = `def main() -> i32:
    let s: string = "hi"
    let r: &string = &s
    let t: string = s
    print(r)
    return 0
`;
    expect(err(src).code).toBe("LYC219");
  });

  it("rejects mutating while borrowed", () => {
    const src = `def main() -> i32:
    let mut s: string = "hi"
    let r: &string = &s
    s = "bye"
    print(r)
    return 0
`;
    expect(err(src).code).toBe("LYC220");
  });

  it("rejects non-bool if and while conditions", () => {
    expect(err(`def main() -> i32:\n    if 1:\n        return 0\n    return 1\n`).code).toBe("LYC226");
    expect(err(`def main() -> i32:\n    while 1:\n        return 0\n    return 1\n`).code).toBe("LYC227");
  });

  it("rejects mixed arithmetic types", () => {
    const e = err(`def main() -> i32:\n    let x: i64 = 1\n    let y: i32 = 2\n    return x + y\n`);
    expect(e.code).toBe("LYC221");
    expect(e.format()).toContain("no implicit numeric conversion");
  });

  it("rejects wrong array length", () => {
    const e = err(`def main() -> i32:\n    let a: [i32; 2] = [1, 2, 3]\n    return 0\n`);
    expect(e.code).toBe("LYC213");
  });

  it("rejects unknown fields", () => {
    const src = `struct Point:
    x: i32

def main() -> i32:
    let p: Point = Point { x: 1 }
    return p.y
`;
    expect(err(src).code).toBe("LYC209");
  });
});
