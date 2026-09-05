const { createHash } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { spawnSync } = require("node:child_process");
const { readdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } = require("node:fs");
const { tmpdir, cpus, platform, arch } = require("node:os");
const { join, resolve } = require("node:path");
const { parseArgs } = require("node:util");
const { values } = parseArgs({ options: {
  root: { type: "string", default: resolve(__dirname, "..") },
  output: { type: "string" },
  baseline: { type: "boolean", default: false },
}});
const root = resolve(values.root);
const { lex } = require(join(root, "dist/lexer"));
const { parse } = require(join(root, "dist/parser"));
const { typecheck } = require(join(root, "dist/typechecker"));
const { codegen } = require(join(root, "dist/codegen"));
const { compileSource, compileFile } = require(join(root, "dist/compile"));
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
function timed(fn, count = 11) {
  for (let i = 0; i < 3; i++) fn();
  const samples = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now(); fn(); samples.push(performance.now() - start);
  }
  return { median_ms: median(samples), min_ms: Math.min(...samples), max_ms: Math.max(...samples) };
}
function compilerSource(n) {
  return Array.from({ length: n }, (_, i) => `def f${i}(x: i32) -> i32:\n    let y: i32 = x + ${i}\n    if y > 10:\n        return y - 3\n    return y + 2\n`).join("\n") + "\ndef main() -> i32:\n    return f0(1)\n";
}
const compiler = [30, 300, 1000].map(functions => {
  const source = compilerSource(functions);
  const tokens = lex(source, "bench.lyca"), ast = parse(tokens, source, "bench.lyca");
  const checked = typecheck(ast, source, "bench.lyca");
  return { functions, bytes: Buffer.byteLength(source),
    lex: timed(() => lex(source, "bench.lyca")),
    parse: timed(() => parse(tokens, source, "bench.lyca")),
    typecheck: timed(() => typecheck(ast, source, "bench.lyca")),
    codegen: timed(() => codegen(checked, "bench.lyca")),
    pipeline: timed(() => compileSource(source, "bench.lyca")),
  };
});

const workloads = [
  {
    name: "recursion",
    source: `def fib(n: i32) -> i32:\n    if n <= 1:\n        return n\n    return fib(n - 1) + fib(n - 2)\ndef main() -> i32:\n    return fib(34) % 251\n`,
    c: `static int fib(int n) { return n <= 1 ? n : fib(n-1) + fib(n-2); }\nint main(void) { return fib(34) % 251; }`,
    expected: 5702887 % 251,
  },
  {
    name: "integer_loop",
    source: `def main() -> i32:\n    let mut s: i32 = 1\n    for i in 0..20000000:\n        s = s * 1664525 + 1013904223\n    return (s % 251 + 251) % 251\n`,
    c: `#include <stdint.h>\nint main(void) { uint32_t s=1; for(int i=0;i<20000000;i++) s=s*1664525u+1013904223u; return (((int32_t)s % 251) + 251) % 251; }`,
    expected: (() => { let s = 1; for (let i = 0; i < 20000000; i++) s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s % 251 + 251) % 251; })(),
  },
];
const dir = mkdtempSync(join(tmpdir(), "lyca-bench-"));
let runtime;
try {
  runtime = workloads.map(w => {
    const file = join(dir, `${w.name}.lyca`), c = join(dir, `${w.name}.c`);
    writeFileSync(file, w.source); writeFileSync(c, w.c);
    function run(path) {
      const r = spawnSync(path, [], { encoding: "utf8", timeout: 30000 });
      if (r.error || r.status !== w.expected) throw new Error(`${w.name}: ${r.error ?? r.stderr}; expected ${w.expected}, got ${r.status}`);
    }
    const levels = values.baseline ? [0] : [0, 2];
    const lyca = levels.map(opt => {
      const out = join(dir, `${w.name}-O${opt}`);
      const build = timed(() => compileFile(file, out, { opt }), 5);
      return { opt, build, run: timed(() => run(out)), bytes: statSync(out).size };
    });
    const out = join(dir, `${w.name}-c`);
    const build = timed(() => {
      const r = spawnSync("clang", [c, "-O2", "-o", out], { encoding: "utf8" });
      if (r.status !== 0) throw new Error(r.stderr);
    }, 5);
    return { name: w.name, checksum: w.expected, lyca, c_O2: { build, run: timed(() => run(out)), bytes: statSync(out).size } };
  });
} finally { rmSync(dir, { recursive: true, force: true }); }
function sourceHash(dir) {
  const hash = createHash("sha256");
  function walk(path) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) walk(file);
      else { hash.update(entry.name); hash.update(readFileSync(file)); }
    }
  }
  walk(dir); return hash.digest("hex");
}
const result = {
  source_sha256: sourceHash(join(root, "src")),
  process_peak_rss_kib: process.resourceUsage().maxRSS,
  timestamp: new Date().toISOString(),
  revision: spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
  working_tree: spawnSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" }).stdout.trim() ? "modified" : "clean",
  environment: { node: process.version, os: platform(), arch: arch(), cpu: cpus()[0]?.model, clang: spawnSync("clang", ["--version"], { encoding: "utf8" }).stdout.split("\n")[0] },
  methodology: "3 warmups; median/min/max of 11 timed samples (5 builds); runtime includes process startup; checksums verified every run; no performance pass/fail threshold",
  compiler, runtime,
};
const json = JSON.stringify(result, null, 2) + "\n";
if (values.output) writeFileSync(values.output, json);
process.stdout.write(json);
