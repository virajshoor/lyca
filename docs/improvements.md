# Delivered changes and next improvements

## Agreed goals

Improve both generated-program speed and compiler efficiency, correct unsupported claims, and implement Python calls in both directions. First Python release uses typed calls, scalars, strings, and copied fixed numeric arrays. Tightening unsafe/ambiguous v0 constructs is allowed. Preserve native compilation without a Python dependency.

## Delivered, in dependency order

1. **Establish correctness.** Keep regression tests for invalid integer literals, recursive layouts, composite equality, copied/shadowed loans, branch moves, loop moves, reference escape, mutation through borrowed/temporary places, and moves during assignment. Accepted native examples remain runnable. Range variables are now immutable.
2. **Carry checked types into codegen.** Store expression/annotation types during checking. Resolve nested fields from those types. Emit pointer references, restore lexical scopes, prefix symbols, and place all fixed allocations in the entry block. Do not reconstruct language types from LLVM text.
3. **Define runtime behavior.** Check dynamic array indices before reads/writes. Guard zero/minimum-overflow signed division and remainder. Wrap integer add/subtract/multiply. Keep normal IEEE floats. Native failures exit 1; Python calls raise exceptions. Reject unsupported reference escape rather than documenting a warning around accepted unsafe code.
4. **Use existing optimizers.** Default to clang O2, with explicit O0–O3 selection. Avoid repeated lexer tables/regex work, unnecessary Copy-state merging, duplicate string constants, runtime compilation when unused, and proven-unnecessary literal checks. Avoid a custom optimizer, handwritten SSA, LLVM binding dependencies, and speculative build caches.
5. **Add Python boundaries.** Implement typed `extern python` declarations and extension output. Use generated C wrappers with pointer-only C/LLVM interfaces. Validate values and lengths; preserve Python exceptions; release Python objects on every path. Context-owned string copies live through nested calls and are freed at the outer boundary. Keep GIL held in v1.
6. **Make claims reviewable.** Publish before/after compiler stages, build latency, native workloads versus matching C, and Python-boundary costs. Report regressions as well as gains. Add macOS/Linux CI, examples, compatibility rules, and migration notes.

Each stage has runnable checks in the existing Vitest suite. `npm run build`, `npm test`, `npm run test:python`, `npm run bench`, and `npm run bench:python` are the review commands. Benchmarks are reports, not CI timing gates.

## Next improvements, ordered by demonstrated need

These are follow-up tasks, not implemented guarantees. Each has a trigger and a specific acceptance check.

### 1. Reduce compiler metadata and ownership-analysis overhead

Trigger: full source-to-IR timing regresses despite faster scanning. Profile the published 30/300/1000-function workloads. Optimize the dominant measured stage; keep checked expression types and ownership rules intact. Do not remove validation to win a benchmark.

Acceptance: identical diagnostic and native/Python tests; report stage and full-pipeline medians from repeated runs on the same machine. A lexer-only speedup must not be presented as a whole-compiler speedup. Add a larger mixed structs/arrays/borrow workload before making a scalability claim.

### 2. Bound memory for long Python/string workloads

Trigger: applications repeatedly obtain Python strings during one long outer call. Current call-owned storage retains all copied strings until return.

Implement owned heap strings with explicit destruction on overwrite, scope exit, return, and every error path. Transfer ownership on moves and retain it across borrows. Replace or extend context unwinding before adding cleanup-required resources to LLVM frames.

Acceptance: a long-running string loop has bounded live memory, owned returns remain valid, moved values stay unusable, and injected conversion/call failures leak no buffers. Use ASan/LSan on a supported CI platform and publish memory measurements.

### 3. Add zero-copy NumPy input buffers

Trigger: the copied-array benchmark shows conversion dominates real numerical kernels. Add a distinct immutable slice/buffer type instead of changing fixed-array semantics silently. Start with one-dimensional contiguous native-endian numeric buffers. Validate dtype, length, stride, alignment, and overflow before exposing a pointer. Hold a `Py_buffer` until the native call ends; forbid escape into return values or persistent storage.

Acceptance: unchanged input, no copy for accepted buffers, clear rejection of noncontiguous/wrong-dtype inputs, and safe cleanup on bounds/Python errors. Keep copied fixed arrays as the existing compatibility path. Mutable buffers and arbitrary object dtypes remain out of that first buffer release.

### 4. Release the GIL around pure native kernels

Trigger: real callers need concurrent long-running kernels. Compute which exported functions transitively call Python. Only release the GIL for functions with no Python calls, and redesign failure propagation so no Python C API executes while it is released. Reacquire before conversion, exception creation, or cleanup.

Acceptance: two Python threads can overlap native kernels; Python-calling functions retain safe GIL behavior; native bounds/division errors still become exceptions without interpreter crashes.

### 5. Package broader compatibility

Trigger: users need wheels or another operating system. Add explicit interpreter/platform build jobs and import smoke tests before claiming support. Windows needs its own extension linking/library discovery. Stable-ABI wheels require an API audit and version-specific testing; do not rename existing artifacts to `abi3`.

General Python objects, keyword/method calls, mutable borrows, heap collections, modules, and generics remain separate language/runtime projects. Add them only with concrete workloads and lifetime/error-path tests.
