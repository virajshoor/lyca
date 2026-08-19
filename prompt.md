# Lyca — language brief for AI coding assistants

You are about to write code in **Lyca**, a small statically typed language that compiles to native binaries via LLVM. Everything you need is in this file. Do not assume any feature that is not listed here.

Lyca's syntax looks like Python (indentation, `def`, `if`, `for`), but it does **not** behave like Python:

- Every `let`, parameter, and return type is annotated. There is no inference beyond literals taking the type of their context.
- No implicit conversions, ever. `i32 + i64` is a compile error. There are no casts.
- Conditions must be `bool`. There is no truthiness.
- No garbage collector. `string`, arrays, and structs are *move* types with a borrow checker.
- The only builtin is `print(s: &string) -> i32`. There is no `len`, `str`, `range`, `input`, no string formatting, no string concatenation, no standard library, no imports, no modules. One file per program.

## Build and run

Source files use the `.lyca` extension. From the compiler repo (after `npm install && npm run build`):

```bash
node dist/cli/index.js build file.lyca -o out
./out
echo $?
```

`main` returns an `i32` that becomes the process exit code (on Unix the shell shows `0..255`, larger values wrap). Because `print` only accepts strings, programs report numeric results through the exit code, or print a fixed message and return `0`. If compilation fails, the compiler prints `error[LYCnnn]` with a source location and a hint; the error table at the bottom of this file tells you the fix.

## Program skeleton

```lyca
def main() -> i32:
    print("Hello, World!")
    return 0
```

`main` must have exactly this signature: no parameters, return type `i32` (`LYC214`/`LYC215`). Top-level items are only `struct` and `def`. Define every function in the same file; definition order does not matter, and recursion is allowed.

## Layout

- Indentation-based blocks, spaces only. A tab anywhere is `LYC003`.
- A `:` introducing a block must be followed by a newline and an indented body.
- A dedent must land exactly on a previous indent level (`LYC004`). Use 4-space steps.
- Comments run from `#` to end of line.
- No empty blocks (`LYC104`); there is no `pass`.

## Types

| Type | Meaning | Copy? |
|------|---------|-------|
| `i32` | 32-bit signed integer | yes |
| `i64` | 64-bit signed integer | yes |
| `f32` | 32-bit float | yes |
| `f64` | 64-bit float | yes |
| `bool` | `true` / `false` | yes |
| `string` | UTF-8 text, owned | no |
| `[T; N]` | fixed-size array, `N` values of `T` | no |
| `Name` | user struct (nominal) | no |
| `&T` | shared, immutable borrow | yes |

There is no `None`, no optionals, no `Any`, no `null`.

Literals: `123` is `i32` unless the context expects `i64` (a literal that does not fit `i32` is `LYC201`; annotate `i64`). `1.5` is `f64` unless the context expects `f32`. `"..."` is `string`; single-line only (`LYC002`), escapes are `\n`, `\t`, `\\`, `\"` only. `[1, 2, 3]` takes its element type from context, defaulting to `i32`; an empty array literal needs an explicit `[T; N]` annotation.

```lyca
def main() -> i32:
    let a: i32 = 10
    let b: i64 = 10
    let x: f64 = 1.5
    let ok: bool = true
    let s: string = "hi\n"
    let arr: [i32; 3] = [1, 2, 3]
    return a
```

## Variables

Every `let` needs a type annotation. Bindings are immutable unless declared `let mut`.

```lyca
def main() -> i32:
    let x: i32 = 1
    let mut y: i32 = 2
    y = y + 1
    # x = 5          # LYC217: assignment requires let mut
    return y
```

Two `let`s in the same block cannot share a name (`LYC216`); a nested block may shadow.

## Functions

Parameter types and a return type are mandatory. Every path through a function must return a value (`LYC208`): an `if` without `else` does not cover a path, and loops never count as returning.

```lyca
def add(a: i32, b: i32) -> i32:
    return a + b

def main() -> i32:
    return add(2, 3)
```

There are no methods, no closures, no optional or default arguments, and no first-class functions. Calls are always `name(args)` with exactly the declared number of arguments.

## Control flow

```lyca
def classify(n: i32) -> i32:
    if n == 0:
        return 1
    elif n == 1:
        return 2
    else:
        return 3

def main() -> i32:
    let mut s: i32 = 0
    for i in 0..4:
        s = s + i
    let mut j: i32 = 0
    while j < 10:
        j = j + 1
    # if s:            # LYC226: conditions must be bool, no truthiness
    # while 1:         # LYC227: same rule for while
    # if 0 < s < 10:   # comparisons do not chain; write: s > 0 and s < 10
    return s + j + classify(0)
```

`for i in start..end:` iterates the half-open interval `[start, end)` as `i32`; the loop variable is a fresh mutable `i32` local scoped to the body. There is no `break` or `continue` — restructure with `if` or a helper function.

## Operators

| Kind | Operators |
|------|-----------|
| Arithmetic | `+ - * / %` — both sides must be the same numeric type; `%` is integer-only; integer `/` truncates |
| Comparison | `== != < > <= >=` — ordering for numbers only; `==`/`!=` also on `bool` |
| Boolean | `and or not` — `and`/`or` short-circuit |
| Unary | `-` on numbers |
| Borrow | `&x` where `x` is a local variable name |

No string `+`, no string `==`, no bitwise operators, no `+=` family.

## Structs and arrays

```lyca
struct Point:
    x: i32
    y: i32

def main() -> i32:
    let mut p: Point = Point { x: 0, y: 1 }
    p.x = p.x + 1
    let mut a: [i32; 3] = [1, 2, 3]
    a[0] = 8
    let i: i32 = 1
    return p.x + a[i]
```

Structs have no methods and no inheritance; behavior is free functions taking `T` or `&T`. A struct literal must list every field exactly once, in any order. Array length is part of the type (`[i32; 2]` and `[i32; 3]` are different types), the index must be `i32`, and there are no slices and no way to ask an array its length — track `N` from the type.

## Ownership: copy, move, borrow

Copy types (`i32`, `i64`, `f32`, `f64`, `bool`, `&T`) can be used freely. Move types (`string`, arrays, structs) are moved when used as a value — assignment, pass-by-value, or return — and the old binding is dead:

```lyca
def main() -> i32:
    let s: string = "hi"
    let t: string = s
    # print(s)    # LYC218: s was moved into t
    print(t)
    return 0
```

Borrow instead of moving. `&x` is only legal on a plain variable name — not `&p.x` or `&a[0]` (`LYC222`); copy a Copy field out first (`let n: i32 = p.x`) if you need a reference to one.

```lyca
def main() -> i32:
    let s: string = "hi"
    let r: &string = &s
    print(r)
    print(s)
    return 0
```

When the expected type is `&T` and you pass an owned `T`, the compiler inserts the borrow for you. That is why `print(s)` does not consume `s`. A function parameter of type `&T` likewise borrows instead of moving.

Borrows are block-scoped: a `let r: &T = &s` borrow lives until the end of `r`'s indented block (no non-lexical lifetimes). While any borrow of `s` is live you cannot move `s` (`LYC219`) or assign to `s`, its fields, or its elements (`LYC220`):

```lyca
def main() -> i32:
    let mut s: string = "a"
    if true:
        let r: &string = &s
        print(r)
        # s = "b"    # LYC220: cannot mutate s while r is in scope
    s = "b"
    print(s)
    return 0
```

There is no `&mut`. Do not return `&T` from functions you write; return owned values. Reading a Copy field out of a struct does not move it; reading a move-typed field moves the whole struct.

## Never generate

| Never write | Why it fails | Write instead |
|-------------|--------------|----------------|
| `print(n)` with a number | `print` takes `&string` only | print a literal; return numbers from `main` as the exit code |
| `"a" + "b"` | no string concatenation (`LYC211`) | print one of several literals |
| `if n:` / `while 1:` | conditions must be `bool` (`LYC226`/`LYC227`) | `if n != 0:` |
| `0 < n < 10` | comparisons do not chain | `n > 0 and n < 10` |
| `s == "abc"` | strings are not comparable (`LYC225`) | restructure; compare numbers or `bool` only |
| `x += 1` | no compound assignment | `x = x + 1` |
| `pass` | no empty blocks (`LYC104`) | put a real statement in the block |
| `break` / `continue` | not in the language | restructure with `if` or a helper function |
| `i32` value mixed with `i64` | no coercion, no casts (`LYC221`) | one integer width throughout the expression |
| `str(n)`, `len(a)`, `f"{x}"`, `import`, methods, classes | no stdlib, no modules, no methods in v0 | free functions taking `T` or `&T`; array length comes from the type `[T; N]` |
| `&p.x` / `&a[0]` / `&f()` | `&` needs a plain variable name (`LYC222`) | bind to a `let` first, then borrow that name |
| `return r` where `r: &T` borrows a local | dangling reference | return owned values only |
| tabs | `LYC003` | spaces only |
| untyped `let` / `def` | parse error (`LYC102`) | annotate every binding, parameter, and return |

## Error quick-fix table

| Code | Meaning | Fix |
|------|---------|-----|
| `LYC001` | unexpected character / bad escape | use only `\n \t \\ \"` escapes |
| `LYC002` | unterminated string | close the string on the same line |
| `LYC003` | tab character | convert indentation to spaces |
| `LYC004` | dedent to an unknown column | align with a previous indent level |
| `LYC101` | unexpected token | only `struct`/`def` at top level; calls are `name(args)` |
| `LYC102` | missing token | add the token named in the message (often `:` or a type) |
| `LYC104` | empty block | add at least one statement |
| `LYC105` | bad assignment target | assign to a name, `p.field`, or `a[i]` |
| `LYC201` | mismatch / missing struct field / literal too big / untyped empty array | match the annotation; fill every field; annotate with `i64` or `[T; N]` |
| `LYC202` | unknown type | use a primitive or a struct declared in this file |
| `LYC203` | unknown variable | declare it first |
| `LYC205` | unknown function | define it in the same file |
| `LYC206` | wrong argument count | match the `def` exactly |
| `LYC207` | return type mismatch | return the declared type; no coercion |
| `LYC208` | missing return | return on every path; `if` needs `else` to count |
| `LYC209` | unknown field | use a field declared on the struct |
| `LYC210` | unknown struct | declare `struct Name:` in this file |
| `LYC211` | illegal operator for type | arithmetic on numbers only; `%` on integers only |
| `LYC212` | cannot index | index `[T; N]` values; index must be `i32` |
| `LYC213` | array length mismatch | literal length must equal `N` |
| `LYC214` | no `main` | add `def main() -> i32:` |
| `LYC215` | bad `main` signature | exactly `def main() -> i32:`, no parameters |
| `LYC216` | duplicate name | rename; `let` names must be unique within a block |
| `LYC217` | assign to immutable | declare `let mut` |
| `LYC218` | use after move | borrow with `&T`, or stop using the old binding |
| `LYC219` | move while borrowed | end the borrow's block first |
| `LYC220` | mutate while borrowed | end the borrow's block first |
| `LYC221` | mixed types in binary operator | same type on both sides; no casts |
| `LYC222` | bad borrow target | `&` only on a variable name |
| `LYC223` | borrow after move | borrow before moving, or do not move |
| `LYC225` | illegal comparison | ordering on numbers only; `==`/`!=` on numbers and `bool` |
| `LYC226` | `if` condition not `bool` | write a comparison, e.g. `if x != 0:` |
| `LYC227` | `while` condition not `bool` | write a comparison |
| `LYC301` | clang failed / internal error | install `clang`; otherwise it is a compiler bug |

## Canonical programs

Fibonacci, result via exit code (`55`):

```lyca
def fib(n: i32) -> i32:
    if n <= 1:
        return n
    return fib(n - 1) + fib(n - 2)

def main() -> i32:
    return fib(10)
```

Iterative factorial, exit code `120`:

```lyca
def fact(n: i32) -> i32:
    let mut acc: i32 = 1
    let mut i: i32 = 1
    while i <= n:
        acc = acc * i
        i = i + 1
    return acc

def main() -> i32:
    return fact(5)
```

Struct passed by borrow so the caller keeps using it, exit code `10`:

```lyca
struct Pair:
    a: i32
    b: i32

def sum(p: &Pair) -> i32:
    return p.a + p.b

def main() -> i32:
    let p: Pair = Pair { a: 3, b: 4 }
    let s: i32 = sum(&p)
    return s + p.a
```

Fixed-size array accumulation, exit code `19`:

```lyca
def main() -> i32:
    let mut a: [i32; 4] = [1, 2, 3, 4]
    a[0] = 10
    let mut s: i32 = 0
    for i in 0..4:
        s = s + a[i]
    return s
```

Results that do not fit an exit code: print a message and return `0`. Prints `FizzBuzz`:

```lyca
def fizzbuzz(n: i32) -> i32:
    if n % 15 == 0:
        print("FizzBuzz")
        return 0
    if n % 3 == 0:
        print("Fizz")
        return 0
    if n % 5 == 0:
        print("Buzz")
        return 0
    print("plain")
    return n

def main() -> i32:
    return fizzbuzz(15)
```

## Final checklist before emitting code

1. `def main() -> i32:` exactly; every function fully annotated; every path returns.
2. Every `let` has a type; anything reassigned is `let mut`.
3. Conditions are `bool`; comparisons never chain.
4. Same numeric type on both sides of every operator; no casts exist.
5. Numbers are never printed — returned from `main` (exit code `0..255`) or replaced by a message plus `return 0`.
6. `string`, arrays, and structs move on use as a value; pass `&T` when the caller keeps the value.
7. Spaces only, one file, no imports, no stdlib beyond `print`.
