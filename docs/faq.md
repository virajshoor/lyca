# FAQ

**Author:** Viraj Shoor

Short answers for people writing Ferra v0 programs. Details live in the [language tour](language-tour.md) and [type system](type-system.md).

## Why does my program look like Python but reject Python?

Ferra copies Python's *layout* (indentation, `def`, `if`, `for`) so the source is easy to read and easy for an LLM to draft. It does not copy Python's *semantics*. Types are mandatory, there is no implicit coercion, `if` only accepts `bool`, and values follow a move/borrow model instead of a garbage collector.

## Why must every function declare a return type?

The compiler never infers a function signature. Write `def name(...) -> T:` even when `T` is `i32` and the body is a single `return`.

## Why is `main` `-> i32`?

The returned integer is the process exit code. That is how the hello-world and Fibonacci examples communicate a result without a richer I/O story. Values larger than 255 wrap in the Unix exit status; print a message and return `0` when you need a human-readable result.

## Can I print a number?

Not directly. `print` is `def print(s: &string) -> i32`. There is no integer formatting and no `str(n)` in v0. Return the number from `main` and inspect `$?`, or print a fixed string that describes the case.

## Why is `if n:` a type error?

Only `bool` is a condition (`FER226` / `FER227`). Write `if n != 0:` or a comparison. There is no truthiness.

## Why does `0 < n < 10` fail?

Comparisons do not chain. `0 < n` is `bool`, and `bool < 10` is a type error. Write `n > 0 and n < 10`.

## Why do I keep seeing `FER207`?

You mixed types the compiler will not convert: `i32` vs `i64`, `bool` vs `i32`, `f32` vs `f64`. Pick one type for the whole expression. There are no casts in v0.

## What is a moved value (`FER218`)?

`string`, arrays, and structs are moved when you use them as a value (assignment, pass-by-value argument, return). The source binding is then dead. Copy types (`i32`, `i64`, `f32`, `f64`, `bool`, `&T`) are not moved.

```ferra
let s: string = "hi"
print(s)                 # ok: print borrows
let t: string = s        # moves
# print(s)               # FER218
```

## When should I write `&T`?

When a function needs to read a move-type value without taking ownership:

```ferra
def len_msg(s: &string) -> i32:
    print(s)
    return 0
```

Callers can pass `s` or `&s`; the compiler inserts a borrow if the argument is owned `string`.

## Why can I not assign to `x`?

Bindings are immutable unless you write `let mut x: T = ...`. Assigning to a plain `let` is `FER217`.

## Why can I not mutate while I have a borrow (`FER220`)?

A live `&T` promises the owner will not change until that borrow goes out of scope. In v0 the borrow lasts until the end of its block, not until last use. Close the block (or drop the extra `let r`) before mutating.

## Can I borrow a field or an array element?

No. `&x` is only legal when `x` is a variable name (`FER222`). Borrow the whole local, or copy a Copy field out (`let n: i32 = p.x`).

## Why are tabs illegal?

The lexer rejects tab characters (`FER003`) so indent and dedent are unambiguous. Configure your editor to insert spaces.

## Is there a standard library?

Only `print`. Everything else is in your file: functions, structs, arrays. There are no modules and no `import` in v0.

## Which LLVM do I need?

You need `clang` on `PATH`. The compiler writes a `.ll` file and runs `clang file.ll -o out`. `llc` is not required. Apple Clang and LLVM Clang both work.

## How do I see the IR?

```bash
node dist/cli/index.js build file.fe -o /tmp/out
cat /tmp/out.ll
```

The `.ll` file is written next to the binary. You can feed it to `clang` yourself; that is all `ferra build` does after type checking.

## Does Ferra have a garbage collector?

No. v0 values are stack-allocated or, for string literals, stored in static data. The ownership rules exist so heap types can be added later without a GC. See [type-system.md](type-system.md).
