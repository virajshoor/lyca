# Lyca

**Python-like syntax. LLVM-native binaries. Types you can trust.**

Created by **Viraj Shoor**.

[![Build](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/virajshoor/lyca)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Language](https://img.shields.io/badge/language-TypeScript-3178C6)](https://www.typescriptlang.org/)

## Why Lyca

Lyca looks like Python so it is easy to read and easy for an LLM to generate on the first try: indentation, `def`, `if`, `for`, `return`. It does not behave like Python. Types are mandatory, there is no implicit coercion, and there is no garbage collector — a small ownership/borrow model keeps memory deterministic. The compiler emits LLVM IR and `clang` produces a native binary with C-like performance.

## Example

Fibonacci in Lyca, compiled to LLVM IR (simplified):

```lyca
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

Write `hello.lyca`:

```lyca
def main() -> i32:
    print("Hello, World!")
    return 0
```

Compile, run, check output:

```bash
node dist/cli/index.js build hello.lyca -o hello
./hello
```

```
Hello, World!
```

The same command works for the bundled examples:

```bash
node dist/cli/index.js build examples/fib.lyca -o /tmp/fib
/tmp/fib; echo $?
# 55
```

## Features

v0:

- [x] Functions with typed parameters and return types, including recursion
- [x] `if` / `elif` / `else`, `while`, `for` in `start..end` (half-open, `i32`)
- [x] Structs (no inheritance, no methods)
- [x] Fixed-size arrays `[T; N]` and `string`
- [x] Arithmetic, comparison, and `and` / `or` / `not`
- [x] Move/borrow checking (Copy vs move, `&T`, no use-after-move)
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
  cli/            lyca build file.lyca -o out
  compile.ts      Pipeline driver
  diagnostics.ts  Error formatting
docs/
  getting-started.md
  language-tour.md
  type-system.md
  compiler-architecture.md
  error-reference.md
examples/
  hello.lyca
  fib.lyca
tests/
```

## Documentation

- [Getting started](docs/getting-started.md) — install, hello world, build a binary
- [Language tour](docs/language-tour.md) — syntax, types, control flow, functions
- [Cheatsheet](docs/cheatsheet.md) — one-page syntax, types, and operators
- [Cookbook](docs/cookbook.md) — complete programs (factorial, gcd, structs, arrays)
- [FAQ](docs/faq.md) — common errors and Python-vs-Lyca surprises
- [Type system](docs/type-system.md) — ownership, what is allowed and why
- [Compiler architecture](docs/compiler-architecture.md) — internals for contributors
- [Error reference](docs/error-reference.md) — every `LYCnnn` code
- [Coding in Lyca (PDF)](docs/book/coding-in-lyca.pdf) — book-length tutorial by Viraj Shoor

## License

MIT © Viraj Shoor. See [LICENSE](LICENSE).

Bug reports and small patches are welcome. Read the language tour and error reference before sending a change; tests live in `tests/` and should cover both a valid program and the diagnostic you care about.
