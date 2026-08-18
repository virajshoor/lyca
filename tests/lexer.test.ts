import { describe, expect, it } from "vitest";
import { CompileError } from "../src/diagnostics";
import { lex } from "../src/lexer";

function kinds(src: string): string[] {
  return lex(src, "t.fe").map((t) => (t.kind === "ident" ? `id:${t.value}` : t.kind));
}

function err(src: string): CompileError {
  try {
    lex(src, "t.fe");
    throw new Error("expected lex error");
  } catch (e) {
    if (e instanceof CompileError) return e;
    throw e;
  }
}

describe("lexer", () => {
  it("tokenizes hello world", () => {
    const src = `def main() -> i32:\n    print("Hello, World!")\n    return 0\n`;
    expect(kinds(src)).toEqual([
      "def",
      "id:main",
      "(",
      ")",
      "->",
      "id:i32",
      ":",
      "newline",
      "indent",
      "id:print",
      "(",
      "string",
      ")",
      "newline",
      "return",
      "int",
      "newline",
      "dedent",
      "eof",
    ]);
  });

  it("tokenizes keywords and operators", () => {
    const src = `def f(x: i32) -> bool:\n    return x == 1 and x != 2 or not true\n`;
    const k = kinds(src);
    expect(k).toContain("and");
    expect(k).toContain("or");
    expect(k).toContain("not");
    expect(k).toContain("==");
    expect(k).toContain("!=");
  });

  it("emits indent and dedent for nested blocks", () => {
    const src = `def f() -> i32:\n    if true:\n        return 1\n    return 0\n`;
    expect(kinds(src).filter((t) => t === "indent" || t === "dedent")).toEqual([
      "indent",
      "indent",
      "dedent",
      "dedent",
    ]);
  });

  it("treats 1..10 as int, range, int — not a float", () => {
    expect(kinds("1..10\n")).toEqual(["int", "..", "int", "newline", "eof"]);
  });

  it("lexes floats and ints separately", () => {
    expect(kinds("1.5\n")).toEqual(["float", "newline", "eof"]);
    expect(kinds("15\n")).toEqual(["int", "newline", "eof"]);
  });

  it("unescapes strings", () => {
    const t = lex('"a\\nb\\t\\"c"\n', "t.fe").find((x) => x.kind === "string")!;
    expect(t.value).toBe("a\nb\t\"c");
  });

  it("reports unexpected character with line and column", () => {
    const e = err("def f() -> i32:\n    return 1 $\n");
    expect(e.code).toBe("FER001");
    expect(e.span.line).toBe(2);
    expect(e.span.col).toBe(14);
    expect(e.format()).toContain("return 1 $");
    expect(e.format()).toContain("error[FER001]");
  });

  it("reports unterminated string", () => {
    const e = err('def f() -> i32:\n    return "hi\n');
    expect(e.code).toBe("FER002");
    expect(e.span.line).toBe(2);
    expect(e.format()).toContain("unterminated string");
  });

  it("rejects tabs", () => {
    const e = err("def f() -> i32:\n\treturn 1\n");
    expect(e.code).toBe("FER003");
    expect(e.span.line).toBe(2);
  });

  it("rejects inconsistent dedent", () => {
    const e = err("def f() -> i32:\n    if true:\n        return 1\n  return 0\n");
    expect(e.code).toBe("FER004");
    expect(e.format()).toContain("inconsistent indentation");
  });
});
