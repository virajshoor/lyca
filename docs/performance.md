# Performance: measurements, not a blanket speed claim

Native builds now default to clang `-O2`. The compiler emits entry-block storage that LLVM can optimize, reuses string constants and lexer tables, carries checked types to codegen, and omits unused C runtime compilation. This improves parts of the pipeline; it does **not** establish that every program or every compiler stage became faster.

## Reproduce

```bash
npm run build
node benchmarks/run.cjs --output /tmp/lyca-bench.json
node benchmarks/python.cjs /tmp/lyca-python-bench.json
```

`run.cjs --root /path/to/older/checkout --baseline` can measure the old compiler after building its `dist` directory. The baseline in this repository is commit `cc1b610`; the after report records the compiler-source hash used before committing this change. Raw reports: [before](benchmarks/before.json), [after](benchmarks/after.json), [Python](benchmarks/python.json).

Measurements were taken on Apple M1 Max, macOS arm64, Node 26.8.1, Apple clang 21.0.0, and CPython 3.14.7. Native tests use three warmups and eleven timed samples, with five samples for builds. The report includes medians and ranges. Runtime includes process startup and checks the result on every run. Compiler stage measurements reuse prerequisites; full-pipeline measurements rebuild tokens, AST, and checked types each time. Whole benchmark-process peak RSS is reported where available; it is not per-stage or native-program peak memory.

## Native runtime

Milliseconds, lower is better:

| Workload | Before, default O0 | After, default O2 | Matching C O2 |
|---|---:|---:|---:|
| Recursive Fibonacci, n=34 | 27.96 | 20.70 | 20.33 |
| 20 million integer recurrence steps | 28.24 | 23.38 | 22.60 |

The new defaults reduced elapsed time about 25% and 20% in these two workloads. Lyca and C are close here; this is not evidence for a universal “C-like performance” guarantee. These tests do not cover I/O, real applications, large arrays, or Python-boundary copying. Checksums and matching fixed-width arithmetic keep the compared work equivalent.

Build latency also matters. The new O2 builds took about 53 ms and 52 ms, versus about 47 ms and 48 ms for the old O0 builds. The new compiler exposes `--opt 0` when build latency matters more than optimization. New O0 recursion is slower than the old O0 binary; optimized builds remove much of the extra internal calling/storage overhead. See the raw report rather than assuming every mode improved.

## Compiler cost

The 1000-function lexical pass is faster after replacing per-character regex work and repeated operator tables. Full compilation also performs additional ownership checks and retains expression-type metadata. Those costs can outweigh scanning gains. The table below is generated from the checked-in measurements; use the raw stage results to identify where further work belongs.

| Functions | Before source → IR (ms) | After source → IR (ms) | Before lex (ms) | After lex (ms) |
|---:|---:|---:|---:|---:|
| 30 | 0.372 | 0.401 | 0.157 | 0.170 |
| 300 | 2.804 | 2.778 | 1.026 | 0.775 |
| 1000 | 8.756 | 9.032 | 3.915 | 2.689 |

Treat sub-millisecond results as noisy. Do not compare a lexer improvement with total compilation, or compare an O0 build time with an O2 build time without labeling the optimization levels. Compiler latency remains an improvement target; safety checks were not removed to make this table look better.

## Python boundary

The measured scalar addition cost was about **396 ns through Lyca**, versus **57 ns for a small Python function**, including benchmark-loop and lambda overhead. Calling Python `math.sqrt` through Lyca cost about **724 ns**, versus **51 ns directly**. Going through the bridge for tiny Python operations loses time.

A batched 100,000-step integer recurrence took about **94 μs in Lyca** versus **7.61 ms in Python**, roughly 81× on this one workload. Keep loops and numerical work inside a native function; cross the boundary once per batch. This is not a NumPy comparison or a claim that all Python code gets that speedup.

Arrays copy at the boundary. The GIL stays held. Python-derived strings are freed at the end of the outer call, so long calls can retain substantial temporary string memory. No zero-copy, concurrent-kernel, or bounded-string-memory performance claim is made.

## Next measurements

Add realistic mixed struct/array/borrow programs, allocation-heavy cases, and stable hardware measurements before setting regression thresholds. Profile metadata and ownership analysis before adding caching or rewriting the compiler. The prioritized tasks and acceptance checks are in [improvements](improvements.md).
