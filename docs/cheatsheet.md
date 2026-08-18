# Ferra cheatsheet

One-page reference for v0. See the [language tour](language-tour.md) for explanations and the [cookbook](cookbook.md) for full programs.

## File and CLI

```
file.fe                 # source
ferra build file.fe -o out
./out                   # native binary; main() -> i32 is the exit code
```

Spaces only. Comments: `# ...`. Extension: `.fe`. No REPL, no modules, one file.

## Skeleton

```ferra
def main() -> i32:
    print("hello")
    return 0
```

`main` takes no parameters and must return `i32`.

## Types

| Type | Copy? | Notes |
|------|-------|-------|
| `i32` `i64` `f32` `f64` `bool` | yes | no implicit casts |
| `string` | no | move; literals `"..."` |
| `[T; N]` | no | length is part of the type |
| `Name` (struct) | no | nominal |
| `&T` | yes | shared borrow |

```ferra
let a: i32 = 10
let b: i64 = 10          # literal becomes i64 from context
let x: f64 = 1.5
let ok: bool = true
let s: string = "hi\n"
let a3: [i32; 3] = [1, 2, 3]
```

## Bindings

```ferra
let x: i32 = 1           # immutable
let mut y: i32 = 2
y = y + 1
```

Every `let` needs a type. Assignment to a non-`mut` binding is `FER217`.

## Functions

```ferra
def add(a: i32, b: i32) -> i32:
    return a + b
```

Types on every parameter and the return. Every path must `return`. Recursion is allowed. No methods, no closures, no first-class functions.

## Control flow

```ferra
if n == 0:
    return 1
elif n == 1:
    return 2
else:
    return 3

while i < 10:
    i = i + 1

for i in 0..4:           # i32, half-open [0, 4)
    s = s + i
```

Conditions must be `bool`. No `break` / `continue` / `pass`. No chained comparisons (`0 < n < 10` is illegal).

## Operators

| Kind | Ops |
|------|-----|
| Arithmetic | `+ - * / %`  (`%` integer-only; both sides same type) |
| Compare | `== != < > <= >=`  (ordering: numbers; `==`/`!=`: numbers and `bool`) |
| Boolean | `and` `or` `not` (short-circuit) |
| Unary | `-` on numbers |
| Borrow | `&x` where `x` is a local name |

No string `+`, no bitwise ops, no `+=`.

## Structs and arrays

```ferra
struct Point:
    x: i32
    y: i32

let mut p: Point = Point { x: 0, y: 1 }
p.x = p.x + 1
let mut a: [i32; 3] = [1, 2, 3]
a[0] = 8
```

No methods, no inheritance. Field order in a literal can differ from the definition; every field once.

## Ownership

```ferra
let s: string = "hi"
let t: string = s        # moves s; using s is FER218
let r: &string = &s      # borrow; s stays usable
print(s)                 # print takes &string, so this does not move
```

Copy types (`i32`, floats, `bool`, `&T`) can be used freely. Move types (`string`, arrays, structs) move on pass-by-value.

## Builtin

```ferra
print("hi")              # def print(s: &string) -> i32
```

Writes `s` plus a newline. Return value is `0`. That is the only builtin in v0.

## Common errors

| Code | Meaning |
|------|---------|
| `FER003` | tab character |
| `FER207` | type mismatch / no coercion |
| `FER208` | missing `return` on a path |
| `FER217` | assign to immutable `let` |
| `FER218` | use after move |
| `FER220` | mutate while borrowed |

Full list: [error-reference.md](error-reference.md).
