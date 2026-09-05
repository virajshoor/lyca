# Ferra

**Python-like syntax. Explicit types. Native LLVM output.**

[![CI](https://github.com/virajshoor/lyca/actions/workflows/ci.yml/badge.svg)](https://github.com/virajshoor/lyca/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Language](https://img.shields.io/badge/language-TypeScript-3178C6)](https://www.typescriptlang.org/)

## Why Ferra

Ferra is an experimental, statically typed language with indentation, `def`, `if`, `for`, and `return`. It compiles through LLVM IR and clang. Native builds use `-O2` by default; `--opt 0` trades runtime optimization for shorter builds. Performance depends on the program: see [measured results and methodology](docs/performance.md).

The native core has no garbage collector: arrays and structs use stack storage, and literals use static storage. Shared references use pointers, with conservative lexical ownership checks. This is a small v0 model, not a complete Rust lifetime system or a claim of proven memory safety.

Optional CPython integration works in both directions: Python can import compiled Ferra functions, and Ferra can call typed Python functions. Python-linked programs retain CPython's runtime, reference counting, garbage collection, and GIL. Python modules run under Python; they are not compiled into native Ferra code.

## Example

Fibonacci in Ferra, compiled to LLVM IR (simplified):

```ferra
def fib(n: i32) -> i32:
    if n <= 1:
        return n
    return fib(n - 1) + fib(n - 2)

def main() -> i32:
    return fib(10)
```

```llvm
define i32 @fib(i32 %p0) {
entry:
  ; n stored on the stack; compare, recurse, add
  %r = call i32 @fib(i32 %n.minus.1)
  %s = call i32 @fib(i32 %n.minus.2)
  %t = add i32 %r, %s
  ret i32 %t
}

define i32 @main() {
entry:
  %r = call i32 @fib(i32 10)
  ret i32 %r
}
```

`main` returns `fib(10)`, so the process exit code is `55`.

## Install and build the compiler

Requires Node.js 18+ and `clang` on your `PATH`.

```bash
git clone https://github.com/virajshoor/lyca.git
cd lyca
npm install
npm run build
npm test
```

## Hello World

Write `hello.fe`:

```ferra
def main() -> i32:
    print("Hello, World!")
    return 0
```

Compile, run, check output:

```bash
node dist/cli/index.js build hello.fe -o hello
./hello
```

```
Hello, World!
```

The same command works for the bundled examples:

```bash
node dist/cli/index.js build examples/fib.fe -o /tmp/fib
/tmp/fib; echo $?
# 55
```

## Python integration

Export a file's public functions (names without a leading `_`):

```bash
node dist/cli/index.js build examples/python-module.fe --target python -o build/kernels
PYTHONPATH=build python3 -c 'import kernels; print(kernels.add(20, 22))'
```

Call an installed Python module from a native executable:

```ferra
extern python "math" def sqrt(x: f64) -> f64

def main() -> i32:
    if sqrt(81.0) == 9.0:
        return 0
    return 1
```

Select an environment with `--python /path/to/venv/bin/python`. Python integration currently targets GIL-enabled CPython 3.10+ on macOS and Linux. Arrays and strings are copied at Python boundaries. General Python object handles and zero-copy NumPy buffers are future work. See [Python compatibility](docs/python-compatibility.md).

## Features

v0:

- [x] Functions with typed parameters and return types, including recursion
- [x] `if` / `elif` / `else`, `while`, `for` in `start..end` (half-open, `i32`)
- [x] Structs (no inheritance, no methods)
- [x] Fixed-size arrays `[T; N]` and `string`
- [x] Arithmetic, comparison, and `and` / `or` / `not`
- [x] Conservative move/borrow checking, shared pointer references, branch-state merging
- [x] Checked array indexing and integer division; wrapping integer add/subtract/multiply
- [x] Typed CPython calls in both directions (scalars, strings, fixed numeric arrays)
- [x] Single-file compile to a native executable; `main() -> i32` is the exit code
- [x] Builtin `print(&string)`
- [x] Rust-style error messages with codes, source lines, and hints

Later:

- [ ] Classes / methods / inheritance
- [ ] `&mut T`, non-lexical lifetimes, field borrows
- [ ] Heap types (`Box`, growable buffers) without a GC
- [ ] Slices, modules, multi-file programs
- [ ] Explicit numeric casts
- [ ] Generics and user-defined traits
- [ ] Native LLVM API (optional; text IR is the default)

## Project structure

```
src/
  lexer/          Hand-written tokenizer (indent/dedent)
  parser/         Recursive-descent parser → AST
  ast/            AST node types
  typechecker/    Types + ownership
  codegen/        LLVM IR emitter
  cli/            ferra build file.fe -o out
  runtime/        Small native/Python C support
  python.ts       CPython configuration and wrapper generation
  compile.ts      Pipeline driver
  diagnostics.ts  Error formatting
docs/
  getting-started.md
  language-tour.md
  type-system.md
  compiler-architecture.md
  error-reference.md
examples/
  hello.fe
  fib.fe
tests/
```

## Documentation

- [Python compatibility](docs/python-compatibility.md) — supported values, environments, exceptions, costs
- [Performance](docs/performance.md) — compiler/runtime benchmarks and limits
- [Implementation and next improvements](docs/improvements.md) — delivered changes and concrete follow-up work
- [Getting started](docs/getting-started.md) — install, hello world, build a binary
- [Language tour](docs/language-tour.md) — syntax, types, control flow, functions
- [Type system](docs/type-system.md) — ownership, what is allowed and why
- [Compiler architecture](docs/compiler-architecture.md) — internals for contributors
- [Error reference](docs/error-reference.md) — every `FERnnn` code

## License

MIT © Ferra Contributors. See [LICENSE](LICENSE).

Bug reports and small patches are welcome. Read the language tour and error reference before sending a change; tests live in `tests/` and should cover both a valid program and the diagnostic you care about.
