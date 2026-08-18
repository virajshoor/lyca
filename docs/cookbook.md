# Ferra cookbook

**Author:** Viraj Shoor

Worked programs you can compile today. Each snippet is a complete `.fe` file unless noted. Build with:

```bash
node dist/cli/index.js build file.fe -o /tmp/out
/tmp/out
echo $?
```

`main` returns an `i32` that becomes the process exit code. On Unix the shell only shows `0..255`, so examples that need a larger result `print` a message and return `0`.

## Hello, World

```ferra
def main() -> i32:
    print("Hello, World!")
    return 0
```

`print` takes `&string`. A string literal is borrowed automatically.

## Exit codes as results

`examples/fib.fe` returns `fib(10)` from `main`, so `echo $?` prints `55`.

```ferra
def fib(n: i32) -> i32:
    if n <= 1:
        return n
    return fib(n - 1) + fib(n - 2)

def main() -> i32:
    return fib(10)
```

Use this pattern for small integer results. For anything else, print and return `0`.

## Factorial (iterative)

```ferra
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

Expected exit code: `120`. There is no `+=`; write `acc = acc * i`.

## Sum a range

`for i in start..end` is half-open: `0..4` yields `0, 1, 2, 3`.

```ferra
def main() -> i32:
    let mut s: i32 = 0
    for i in 0..10:
        s = s + i
    return s
```

Expected exit code: `45`. The loop variable is a mutable `i32` local for the body. There is no `break` or `continue`.

## GCD

```ferra
def gcd(a: i32, b: i32) -> i32:
    let mut x: i32 = a
    let mut y: i32 = b
    while y != 0:
        let t: i32 = y
        y = x % y
        x = t
    return x

def main() -> i32:
    return gcd(48, 18)
```

Expected exit code: `6`. `%` is integer-only and both sides must be the same integer type.

## Absolute value and branches

Every `if` path that is supposed to return must actually `return`. An `if` without `else` does not cover the rest of the function.

```ferra
def abs(x: i32) -> i32:
    if x < 0:
        return -x
    return x

def main() -> i32:
    return abs(-7)
```

Expected exit code: `7`. Conditions must be `bool`: `if x:` is `FER226`.

## Structs as records

```ferra
struct Point:
    x: i32
    y: i32

def manhattan(p: Point) -> i32:
    let mut ax: i32 = p.x
    if ax < 0:
        ax = -ax
    let mut ay: i32 = p.y
    if ay < 0:
        ay = -ay
    return ax + ay

def main() -> i32:
    let p: Point = Point { x: 3, y: -4 }
    return manhattan(p)
```

Expected exit code: `7`. `manhattan` takes `Point` by value, so `p` is moved into the call and cannot be used afterward. To keep the value, take `&Point` (or copy the fields out first — `i32` fields are Copy).

## Borrow a struct instead of moving it

```ferra
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

Expected exit code: `10`. `p` is still alive after `sum(&p)` because the parameter is a borrow.

## Fixed-size arrays

```ferra
def main() -> i32:
    let mut a: [i32; 4] = [1, 2, 3, 4]
    a[0] = 10
    let mut s: i32 = 0
    for i in 0..4:
        s = s + a[i]
    return s
```

Expected exit code: `19`. `[i32; 3]` and `[i32; 4]` are different types. The index must be `i32`. There are no slices.

## Fizz / buzz with strings

Ferra has no string concatenation. Print one of several literals.

```ferra
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

Prints `FizzBuzz` and exits `0`. Integer results that do not fit in an exit code should follow this print-and-return-0 pattern.

## Recursion vs a loop

Both are legal. Recursion is a good fit when the definition is already recursive (Fibonacci). Prefer a `while` or `for` when you are accumulating, because v0 has no tail-call guarantee.

```ferra
def pow2(n: i32) -> i32:
    if n == 0:
        return 1
    return 2 * pow2(n - 1)

def main() -> i32:
    return pow2(3)
```

Expected exit code: `8`.

## Ownership pitfalls

### Use after move

```ferra
def main() -> i32:
    let s: string = "hi"
    let t: string = s
    print(t)
    # print(s)    # FER218
    return 0
```

Fix: borrow (`let r: &string = &s`) or do not alias the owned value.

### Mutate while borrowed

```ferra
def main() -> i32:
    let mut s: string = "a"
    if true:
        let r: &string = &s
        print(r)
        # s = "b"  # FER220 while r is in scope
    s = "b"
    print(s)
    return 0
```

Borrows of locals last until the end of the binding's block, not until last use.

### `print` does not consume

```ferra
def main() -> i32:
    let s: string = "ok"
    print(s)
    print(s)
    return 0
```

This is legal: `print` takes `&string`, so each call borrows for that statement only.

## What you cannot do in v0

These come up often if you are arriving from Python or JavaScript:

| Want | In Ferra v0 |
|------|-------------|
| `print(n)` for an integer | not possible; `print` is `&string` only |
| `"a" + "b"` | no string concat |
| `0 < n < 10` | compare twice: `n > 0 and n < 10` |
| `if n:` | `if n != 0:` |
| `pass` | put a real statement in the block |
| `break` / `continue` | restructure with `if` / extra functions |
| `i32` + `i64` | stay on one integer width |
| methods on structs | free functions that take `T` or `&T` |
| modules / multiple files | one `.fe` file per program |
| heap `Box`, slices, generics | not in v0 |

## Next

- [Language tour](language-tour.md) — syntax in order
- [Type system](type-system.md) — Copy vs move, borrows
- [Error reference](error-reference.md) — every `FERnnn`
- [FAQ](faq.md) — short answers to common questions
