const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { compileFile } = require("../dist/compile");
const python = process.env.FERRA_PYTHON || "python3";
const dir = mkdtempSync(join(tmpdir(), "ferra-pybench-"));
try {
  const file = join(dir, "kernels.fe");
  writeFileSync(file, `extern python "math" def sqrt(x: f64) -> f64

def add(x: i32, y: i32) -> i32:
    return x + y

def root(x: f64) -> f64:
    return sqrt(x)

def mix(n: i32) -> i32:
    let mut s: i32 = 1
    for i in 0..n:
        s = s * 1664525 + 1013904223
    return (s % 251 + 251) % 251
`);
  compileFile(file, join(dir, "kernels"), { target: "python", python });
  const script = `import kernels, json, time, statistics, sys, platform, math

def measure(fn, calls):
    def run():
        start = time.perf_counter_ns()
        for _ in range(calls): fn()
        return (time.perf_counter_ns() - start) / calls
    for _ in range(3): run()
    samples = [run() for _ in range(11)]
    return dict(median_ns=statistics.median(samples), min_ns=min(samples), max_ns=max(samples), calls_per_sample=calls)

def add(x, y): return x+y

def mix(n):
    s = 1
    for _ in range(n): s = (s * 1664525 + 1013904223) & 0xffffffff
    if s >= 0x80000000: s -= 0x100000000
    return s % 251

assert kernels.mix(100000) == mix(100000)
assert kernels.root(81.0) == 9.0
report = dict(python=sys.version, platform=platform.platform(), methodology='3 warmups, 11 samples; Python loop and lambda overhead included; scalar calls and batched work reported separately',
    python_add=measure(lambda: add(1,2), 100000),
    ferra_add=measure(lambda: kernels.add(1,2), 100000),
    python_sqrt=measure(lambda: math.sqrt(81.0), 100000),
    ferra_calls_python_sqrt=measure(lambda: kernels.root(81.0), 100000),
    python_mix=measure(lambda: mix(100000), 1),
    ferra_mix=measure(lambda: kernels.mix(100000), 1))
print(json.dumps(report, indent=2))
`;
  const r = spawnSync(python, ["-c", script], { cwd: dir, encoding: "utf8", timeout: 120000 });
  if (r.error || r.status !== 0) throw new Error(r.error?.message || r.stderr);
  if (process.argv[2]) writeFileSync(process.argv[2], r.stdout);
  process.stdout.write(r.stdout);
} finally { rmSync(dir, { recursive: true, force: true }); }
