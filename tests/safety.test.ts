import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { compileFile, compileSource, CompileError } from "../src/compile";

const main = (body: string) => `def main() -> i32:\n${body}\n`;
function error(src: string, code: string) {
  try { compileSource(src, "safety.lyca"); throw new Error("expected diagnostic"); }
  catch (e) { expect(e).toBeInstanceOf(CompileError); expect((e as CompileError).code).toBe(code); }
}

describe("safety regressions", () => {
  it.each([
    ["i64 overflow", main("    let x: i64 = 9223372036854775808\n    return 0"), "LYC201"],
    ["negative overflow", main("    return -2147483649"), "LYC201"],
    ["composite equality", main('    return "a" == "b"'), "LYC225"],
    ["constant index", main("    let a: [i32; 1] = [2]\n    return a[-1]"), "LYC231"],
    ["constant write", main("    let mut a: [i32; 1] = [2]\n    a[1] = 0\n    return 0"), "LYC231"],
    ["reference escape", "def bad() -> &i32:\n    let x: i32 = 1\n    return &x\n" + main("    return 0"), "LYC224"],
    ["immutable range variable", main("    for i in 0..3:\n        i = 0\n    return 0"), "LYC217"],
    ["mutable reference", main("    let x: i32 = 1\n    let mut r: &i32 = &x\n    return 0"), "LYC224"],
    ["recursive layout", "struct A:\n    a: A\n" + main("    return 0"), "LYC228"],
    ["reference field", "struct A:\n    a: &i32\n" + main("    return 0"), "LYC224"],
    ["move in loop", main('    let s: string = "a"\n    for i in 0..2:\n        let t: string = s\n    return 0'), "LYC230"],
    ["move through reference", "def bad(a: &[string; 1]) -> string:\n    return a[0]\n" + main("    return 0"), "LYC224"],
    ["move during field assignment", "struct A:\n    x: i32\ndef consume(a: A) -> i32:\n    return a.x\n" + main("    let mut a: A = A { x: 1 }\n    a.x = consume(a)\n    return 0"), "LYC218"],
    ["temporary mutation", "struct A:\n    x: i32\ndef make() -> A:\n    return A { x: 1 }\n" + main("    make().x = 3\n    return 0"), "LYC105"],
    ["statement separator", main("    let x: i32 = 1 return x"), "LYC102"],
    ["conditional move", main('    let s: string = "a"\n    if false:\n        let t: string = s\n    print(s)\n    return 0'), "LYC223"],
    ["copied reference owner", main('    let mut s: string = "a"\n    let r: &string = &s\n    let r2: &string = r\n    s = "b"\n    return 0'), "LYC220"],
    ["nested projection move", "struct A:\n    s: string\nstruct B:\n    a: A\n" + main('    let b: B = B { a: A { s: "x" } }\n    let s: string = b.a.s\n    print(b.a.s)\n    return 0'), "LYC218"],
  ])("rejects %s", (_, src, code) => error(src, code));

  it("checks exclusive branches independently", () => {
    compileSource(main('    let s: string = "a"\n    if true:\n        let t: string = s\n        print(t)\n    else:\n        let t: string = s\n        print(t)\n    return 0'), "branches.lyca");
    compileSource(main('    let s: string = "a"\n    if false:\n        let t: string = s\n        return 1\n    print(s)\n    return 0'), "return.lyca");
  });

  it("tracks shadowed owners by identity and releases copied loans", () => {
    compileSource(main('    let mut s: string = "a"\n    if true:\n        let r: &string = &s\n        let s: string = "b"\n        let q: &string = r\n        print(q)\n    s = "c"\n    return 0'), "loans.lyca");
  });

  it("hoists every allocation out of loops", () => {
    const ir = compileSource(main("    let mut n: i32 = 0\n    for i in 0..100:\n        let a: [i32; 2] = [i, 2]\n        n = n + a[0]\n    return n"), "alloca.lyca");
    let label = "";
    for (const line of ir.split("\n")) {
      if (/^\w+:$/.test(line)) label = line;
      if (line.includes(" = alloca ")) expect(label).toBe("entry:");
    }
  });
});

// Real binaries exercise the checker/emitter agreement, not just IR spelling.
describe("native correctness", () => {
  it.each([
    ["shadowing", main("    let x: i32 = 9\n    if true:\n        let x: i32 = 2\n    for x in 0..x:\n        let y: i32 = x\n    return x"), 9, ""],
    ["nested structs", "struct First:\n    unused: i64\nstruct Inner:\n    n: i32\nstruct Outer:\n    inner: Inner\n" + main("    let mut x: Outer = Outer { inner: Inner { n: 2 } }\n    x.inner.n = 7\n    return x.inner.n"), 7, ""],
    ["borrowed arrays", "def sum(a: &[i32; 2]) -> i32:\n    return a[0] + a[1]\n" + main("    let a: [i32; 2] = [3, 4]\n    return sum(a) + sum(&a)"), 14, ""],
    ["multiline", "def f(\n    x: i32,\n    y: i32\n) -> i32:\n    return x + y\n" + main("    # comment before first statement\n    let constructor: [i32; 2] = [\n        3,\n        4,\n    ]\n    return f(\n        constructor[0],\n        constructor[1]\n    )"), 7, ""],
    ["float context", "def f(x: f32) -> f32:\n    return x + 0.1\n" + main("    if f(0.1) > 0.19:\n        return 4\n    return 0"), 4, ""],
    ["bounds trap", "def index(n: i32) -> i32:\n    let a: [i32; 1] = [3]\n    return a[n]\n" + main("    return index(-1)"), 1, "array index out of bounds"],
    ["division trap", main("    return 1 / 0"), 1, "invalid integer division"],
    ["integer minimum", main("    let x: i64 = -9223372036854775808\n    if x < 0:\n        return -2147483648 + 5\n    return 0"), 5, ""],
  ])("runs %s", (_, source, status, stderr) => {
    const dir = mkdtempSync(join(tmpdir(), "lyca-safety-"));
    try {
      const file = join(dir, "test.lyca"), out = join(dir, "test");
      writeFileSync(file, source);
      for (const opt of [0, 2] as const) {
      compileFile(file, out, { opt });
      const r = spawnSync(out, { encoding: "utf8", timeout: 5000 });
      expect(r.error).toBeUndefined();
      expect(r.status).toBe(status);
      expect(r.stderr).toContain(stderr);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
