import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { compileFile, compileSource } from "../src/compile";

const python = process.env.FERRA_PYTHON ?? "python3";
const available = spawnSync(python, ["-c", "import sys; assert sys.implementation.name == 'cpython'"]).status === 0;
if (!available && process.env.FERRA_REQUIRE_PYTHON) throw new Error("Python integration tests require CPython");

const source = `extern python "math" def sqrt(x: f64) -> f64
extern python "builtins" def str(n: i32) -> string
extern python "bridge_fixture" def reverse(a: [i32; 3]) -> [i32; 3]
extern python "bridge_fixture" def raises() -> i32
extern python "bridge_fixture" def wrong() -> i32

def add(x: i32, y: i32) -> i32:
    return x + y

def wide(x: i64) -> i64:
    return x

def single(x: f32) -> f32:
    return x

def truth(x: bool) -> bool:
    return not x

def text(s: string) -> string:
    return s

def first(a: &[i32; 3], index: i32) -> i32:
    return a[index]

def echo(a: [f64; 2]) -> [f64; 2]:
    return a

def flags(a: [bool; 2]) -> [bool; 2]:
    return a

def empty(a: [i32; 0]) -> [i32; 0]:
    return a

def root(x: f64) -> f64:
    return sqrt(x)

def as_text(n: i32) -> string:
    return str(n)

def reversed(a: [i32; 3]) -> [i32; 3]:
    return reverse(a)

def fail() -> i32:
    return raises()

def wrong_type() -> i32:
    return wrong()

def divide(x: i32, y: i32) -> i32:
    return x / y

def nan_unequal(x: f64) -> bool:
    return x != x

def _private() -> i32:
    return 42
`;

const assertions = `import kernels as k, math, gc
assert k.add(20, 22) == 42
assert k.add(2147483647, 1) == -2147483648
assert k.wide(-9223372036854775808) == -9223372036854775808
assert k.wide(9223372036854775807) == 9223372036854775807
assert abs(k.single(0.1) - 0.1) < 1e-7
assert k.truth(True) is False
assert k.text('héllo\\x00世界') == 'héllo\\x00世界'
assert k.first([3, 4, 5], 2) == 5
assert k.echo((1.5, 2.5)) == [1.5, 2.5]
assert k.flags([True, False]) == [True, False]
assert k.empty([]) == []
assert k.root(81.0) == 9.0
assert k.as_text(123) == '123'
assert k.reversed([1, 2, 3]) == [3, 2, 1]
assert k.nan_unequal(float('nan')) is True
assert not hasattr(k, '_private')
for thunk, error in [
    (lambda: k.add(1), TypeError),
    (lambda: k.add(x=1, y=2), TypeError),
    (lambda: k.add(True, 2), TypeError),
    (lambda: k.add(1.5, 2), TypeError),
    (lambda: k.add(2147483648, 0), OverflowError),
    (lambda: k.wide(9223372036854775808), OverflowError),
    (lambda: k.single(1e100), OverflowError),
    (lambda: k.truth(1), TypeError),
    (lambda: k.text(42), TypeError),
    (lambda: k.first([1, 2], 0), ValueError),
    (lambda: k.first([1, 2, 3], -1), IndexError),
    (lambda: k.first([1, 2, 3], 3), IndexError),
    (lambda: k.root(-1.0), ValueError),
    (lambda: k.fail(), RuntimeError),
    (lambda: k.wrong_type(), TypeError),
    (lambda: k.divide(1, 0), ArithmeticError),
    (lambda: k.divide(-2147483648, -1), ArithmeticError),
]:
    try: thunk()
    except error: pass
    else: raise AssertionError(error)
# A failed call must leave no stale exception or poisoned runtime context.
for _ in range(500):
    assert k.text('owned text') == 'owned text'
    try: k.fail()
    except RuntimeError: pass
    assert k.add(1, 2) == 3
try:
    import numpy as np
except ImportError:
    pass
else:
    assert k.first(np.array([3, 4, 5], dtype=np.int32), 1) == 4
    assert k.wide(np.int64(123)) == 123
gc.collect()
print('python bridge ok')
`;

const suite = available ? describe : describe.skip;
suite("Python bridge", () => {
  it.each([0, 2] as const)("round-trips typed values and exceptions at O%i", opt => {
    const dir = mkdtempSync(join(tmpdir(), "ferra-python-"));
    try {
      writeFileSync(join(dir, "kernels.fe"), source);
      writeFileSync(join(dir, "bridge_fixture.py"), "def reverse(a): return list(reversed(a))\ndef raises(): raise RuntimeError('from Python')\ndef wrong(): return 'not an int'\n");
      const out = compileFile(join(dir, "kernels.fe"), join(dir, "kernels"), { target: "python", python, opt });
      expect(out).toMatch(/\.so$/);
      const r = spawnSync(python, ["-c", assertions], { cwd: dir, encoding: "utf8", timeout: 15000, env: { ...process.env, PYTHONMALLOC: "debug" } });
      expect(r.error).toBeUndefined();
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("python bridge ok\n");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("embeds the selected Python interpreter in a native executable", () => {
    const dir = mkdtempSync(join(tmpdir(), "ferra-embed-"));
    try {
      const file = join(dir, "main.fe"), out = join(dir, "main");
      writeFileSync(file, 'extern python "math" def sqrt(x: f64) -> f64\ndef main() -> i32:\n    if sqrt(81.0) == 9.0:\n        return 42\n    return 0\n');
      compileFile(file, out, { python });
      expect(spawnSync(out).status).toBe(42);
      writeFileSync(file, 'extern python "math" def sqrt(x: f64) -> f64\ndef main() -> i32:\n    sqrt(-1.0)\n    return 0\n');
      compileFile(file, out, { python });
      const error = spawnSync(out, { encoding: "utf8" });
      expect(error.status).toBe(1);
      expect(error.stderr).toContain("ValueError");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("diagnoses unsupported Python signatures before invoking clang", () => {
    expect(() => compileSource("struct A:\n    x: i32\ndef public(a: A) -> i32:\n    return a.x\n", "x.fe", { target: "python" })).toThrow(/Python boundary/);
  });

  it("preserves an existing binary when the toolchain fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "ferra-preserve-"));
    const originalPath = process.env.PATH;
    try {
      const file = join(dir, "main.fe"), out = join(dir, "main");
      writeFileSync(file, "def main() -> i32:\n    return 0\n");
      writeFileSync(out, "existing artifact");
      process.env.PATH = dir;
      expect(() => compileFile(file, out)).toThrow(/existing output|clang failed/);
      expect(readFileSync(out, "utf8")).toBe("existing artifact");
    } finally { process.env.PATH = originalPath; rmSync(dir, { recursive: true, force: true }); }
  });
});
