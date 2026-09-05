import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileFile, compileSource } from "../src/compile";

function refFib(n: number): number {
  if (n <= 1) return n;
  return refFib(n - 1) + refFib(n - 2);
}

describe("e2e", () => {
  it("emits LLVM IR for fib", () => {
    const src = readFileSync("examples/fib.lyca", "utf8");
    const ir = compileSource(src, "examples/fib.lyca");
    expect(ir).toContain("define internal i32 @lyca.fn.fib(ptr %ctx, i32 %p0)");
    expect(ir).toContain("define i32 @main()");
    expect(ir).toContain("call i32 @lyca.fn.fib");
  });

  it("compiles fib.lyca to a binary whose exit code matches a JS reference", () => {
    const dir = mkdtempSync(join(tmpdir(), "lyca-"));
    const out = join(dir, "fib");
    compileFile("examples/fib.lyca", out);
    const r = spawnSync(out, { encoding: "utf8" });
    expect(r.status).toBe(refFib(10));
    expect(refFib(10)).toBe(55);
  });

  it("compiles hello.lyca and prints Hello, World!", () => {
    const dir = mkdtempSync(join(tmpdir(), "lyca-"));
    const out = join(dir, "hello");
    compileFile("examples/hello.lyca", out);
    const r = spawnSync(out, { encoding: "utf8" });
    expect(r.stdout).toBe("Hello, World!\n");
    expect(r.status).toBe(0);
  });
});
