# Language tour

**Author:** Viraj Shoor

Lyca source files use the `.lyca` extension. A program is a sequence of `struct` and `def` items. Execution starts at `main`.

## Layout

Blocks are indentation-based. Use spaces, never tabs. A colon `:` introducing a block must be followed by a newline and an indented body.

```lyca
def abs(x: i32) -> i32:
    if x < 0:
        return -x
    return x
```

Comments run from `#` to end of line.

## Types

| Type | Meaning | Copy? |
|------|---------|-------|
| `i32` | 32-bit signed integer | yes |
| `i64` | 64-bit signed integer | yes |
| `f32` | 32-bit float | yes |
| `f64` | 64-bit float | yes |
| `bool` | `true` / `false` | yes |
| `string` | UTF-8 text, owned | no |
| `[T; N]` | Array of `N` values of type `T` | no |
| `Point` | User struct | no |
| `&T` | Shared borrow of `T` | yes |

There is no `None`, no optional, no dynamic `Any`, and no implicit conversion between these types.

Integer literals default to `i32` unless the expected type is `i64`:

```lyca
let a: i32 = 10
let b: i64 = 10
```

Float literals default to `f64` unless the expected type is `f32`.

String literals use double quotes. Escapes: `\n`, `\t`, `\\`, `\"`.

## Variables

Every `let` needs a type annotation.

```lyca
let x: i32 = 1
let mut y: i32 = 2
y = y + 1
```

Without `mut`, assignment is an error (`LYC217`).

## Functions

Parameter types and the return type are mandatory. Recursion is allowed.

```lyca
def add(a: i32, b: i32) -> i32:
    return a + b
```

Call syntax is `name(args)`. There are no methods and no first-class function values in v0.

Every path through a function must `return` a value (`LYC208`). `if` without `else` does not count as covering a path.

`main` is special:

```lyca
def main() -> i32:
    return 0
```

No parameters. Return type `i32`. That integer is the process exit code (Unix: `0..255` visible to the shell).

## Builtin: `print`

```lyca
def print(s: &string) -> i32
```

Declared by the compiler, not in user source. It prints `s` plus a newline via libc `puts`. The return value is `0`.

If you pass a `string` where `&string` is expected, Lyca inserts a borrow. These are equivalent:

```lyca
print("hi")
print(&s)
print(s)
```

The last form does **not** move `s`.

## Control flow

### if / elif / else

The condition must be `bool`. There is no truthiness.

```lyca
if n == 0:
    return 1
elif n == 1:
    return 2
else:
    return 3
```

`elif` is parsed as `else: if ...`. Comparisons do not chain: `0 < n < 10` is a type error because `(0 < n)` is `bool`.

### while

```lyca
let mut i: i32 = 0
while i < 10:
    i = i + 1
```

### for-range

`for name in start..end:` iterates `i32` values in the half-open interval `[start, end)`. `name` is a mutable `i32` local for the loop body.

```lyca
let mut s: i32 = 0
for i in 0..4:
    s = s + i
# s == 6
```

No `break` / `continue` in v0.

## Operators

Boolean: `and`, `or`, `not` (short-circuit `and` / `or`).

Arithmetic (same numeric type on both sides): `+ - * / %`. `%` is integer-only.

Comparison: `== != < > <= >=`. Ordering is for numbers only. `==` / `!=` also work on `bool`.

Unary `-` on numbers.

There is no `+` for strings. There are no bitwise operators.

## Structs

```lyca
struct Point:
    x: i32
    y: i32

def origin() -> Point:
    return Point { x: 0, y: 0 }

def main() -> i32:
    let mut p: Point = origin()
    p.x = p.x + 1
    return p.x
```

No methods, no inheritance, no `self`. Field order in the literal does not have to match the struct definition; every field must be present exactly once.

## Arrays

```lyca
let mut a: [i32; 3] = [1, 2, 3]
a[0] = 8
let x: i32 = a[1]
```

The index expression must be `i32`. Length is part of the type: `[i32; 2]` is not `[i32; 3]`. No slices in v0.

## Ownership in one page

Copy types (`i32`, `i64`, `f32`, `f64`, `bool`, `&T`) can be used freely.

Move types (`string`, arrays, structs) are moved on use as a value:

```lyca
let s: string = "hi"
let t: string = s   # moves s
print(t)
# print(s)          # LYC218 use of moved value
```

Borrow instead of moving:

```lyca
let s: string = "hi"
let r: &string = &s
print(r)
print(s)            # still valid
```

You cannot move or mutate a value while a borrow of it is live. Borrows of locals last until the end of the binding's block. See [type-system.md](type-system.md).

## A complete file

```lyca
struct Pair:
    a: i32
    b: i32

def sum(p: Pair) -> i32:
    return p.a + p.b

def main() -> i32:
    let p: Pair = Pair { a: 3, b: 4 }
    return sum(p)
```

`sum` takes `Pair` by value, so `p` is moved into the call. After `sum(p)`, `p` is dead.
