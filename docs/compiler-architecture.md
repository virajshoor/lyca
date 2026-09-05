# Compiler architecture

The compiler is TypeScript running on Node.js. It emits textual LLVM IR and invokes clang. There is no native Node LLVM addon and no custom optimizer.

```text
.lyca source → lexer → AST → type/ownership checks → LLVM IR → clang → artifact
                                           ↘ optional C Python wrappers ↗
```

## Frontend

The lexer emits indentation tokens only outside brackets. Continuation lines and comments do not create nested blocks. Operator tables are reused; identifier scanning uses character comparisons. The recursive-descent parser consumes normalized tokens without a second bracket-depth state machine. Simple statements require separators.

The type checker collects signatures before checking bodies, so recursion works. It stores checked expression types and resolved annotations alongside the AST. Codegen uses that metadata; it does not reconstruct Lyca types from LLVM strings or guess a struct from declaration order.

Each lexical binding has its own ownership record. Loans refer to that record, not a variable's spelling. Branches check against independent incoming move states and merge only paths that continue. Copy-only scopes avoid unnecessary move-state merging. Loops conservatively reject moves of outer values. References cannot escape through returns or aggregates; reference bindings and range variables are immutable.

## LLVM emission

- Integers/floats/bools use LLVM scalar types; strings are `{ ptr, i64 }`.
- Structs and arrays are native aggregates; shared references are actual `ptr` values.
- Every fixed allocation is emitted in the function entry block. clang can promote scalar locals to SSA and remove dead storage.
- Scope exits restore shadowed names. Both range bounds are evaluated before the loop variable is introduced.
- Aggregate literals use `insertvalue`; nested fields use their checked types.
- `and`/`or` short-circuit. Integer add/subtract/multiply wrap; floating comparisons preserve NaN semantics.
- Dynamic index and signed division checks branch to a runtime error handler. Statically proven valid literal indices and positive literal divisors need no dynamic check.
- User functions/structs have prefixed LLVM symbols to avoid collisions with libc/runtime names.
- String constants are interned per compilation.

The default clang level is `-O2`; `--opt 0`, `1`, and `3` are available. No `-ffast-math` or host-specific instruction tuning is enabled. Programs without runtime calls do not compile/link the C support file.

## Python boundary

`extern python "module" def name(...) -> T` creates a foreign signature. `--target python` instead produces an extension exposing public local functions. Both can be used in the same file.

C wrappers use the selected interpreter's CPython headers and ABI. A pointer-only generated interface transfers input/output storage across C and LLVM; C aggregate-by-value calling conventions are deliberately avoided. Python conversions validate type, numeric range, and array length. Python references are released on success and error.

Generated functions pass an opaque context pointer. Core native builds use null and terminate with a diagnostic on runtime failure. Python builds allocate a context per outer call and catch errors in the C wrapper with `setjmp`/`longjmp`; GIL remains held. Python-derived string buffers belong to that context. No context or `PyObject` pointer is stored in process-global compiler-generated state.

## Build and validation

`compileSource(source, filename, options?)` returns checked textual IR. `compileFile(path, output, options?)` returns the actual artifact path. Options select native/Python target, optimization level, interpreter, and import name. Existing two-argument calls remain valid.

The build copies C runtime assets into `dist/runtime`. `compileFile` stages compilation next to the destination and publishes the executable only after clang succeeds. Missing tools, unsupported environments, and clang failures become `LYC301` diagnostics. An existing executable survives failed compilation.

Tests exercise parsing, ownership diagnostics, emitted allocation placement, native execution at O0/O2, Python conversion, exception propagation, embedded Python, and failed-build preservation. Benchmarks separately report frontend stages, full source-to-IR time, build latency, native runtime, and Python call overhead. Performance numbers are reports, not noisy CI pass/fail thresholds.
