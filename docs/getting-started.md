# Getting started

**Author:** Viraj Shoor

Lyca is a small, statically typed language with Python-like syntax. The compiler is written in TypeScript and emits LLVM IR, which `clang` lowers to a native binary.

## Requirements

- Node.js 18 or newer
- `clang` on your `PATH` (Apple Clang or LLVM Clang). Lyca shells out to `clang` to assemble and link the generated `.ll` file.

`llc` is not required. `clang` compiles LLVM IR directly.

## Install the compiler

```bash
git clone https://github.com/virajshoor/lyca.git
cd lyca
npm install
npm run build
```

The CLI is `node dist/cli/index.js`. After `npm run build` you can also run it as:

```bash
node dist/cli/index.js --help
```

Or link it:

```bash
npm link
lyca --help
```

## Hello World

Create `hello.lyca`:

```lyca
def main() -> i32:
    print("Hello, World!")
    return 0
```

Rules that trip people up:

- Indentation is spaces only (no tabs).
- Every function, including `main`, needs a return type.
- `main` must be `def main() -> i32`. Its return value is the process exit code.
- `print` is a builtin. It takes a `string` (or `&string`) and writes it to stdout followed by a newline.

Build and run:

```bash
node dist/cli/index.js build hello.lyca -o hello
./hello
```

Expected output:

```
Hello, World!
```

Exit code is `0`.

## Fibonacci

`examples/fib.lyca` is a complete program. `main` returns `fib(10)`, so the process exit code is `55`.

```bash
node dist/cli/index.js build examples/fib.lyca -o /tmp/fib
/tmp/fib
echo $?
```

```
55
```

## What the compiler writes

`lyca build file.lyca -o output` does two things:

1. Writes LLVM IR to `output.ll` (same path as the binary, with `.ll` appended).
2. Invokes `clang output.ll -o output`.

If type checking fails, nothing is written. Errors look like:

```
error[LYC207]: type mismatch: expected i32, found bool
 --> hello.lyca:2:12
  |
2 |     return true
  |            ^^^^
  |
  = hint: Lyca does not coerce types
```

Fix the source and rebuild. There is no REPL in v0.
