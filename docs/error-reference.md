# Error reference

Every Lyca diagnostic has a code `LYCnnn`. The compiler prints the code, a message, `file:line:col`, the source line, a caret, and sometimes a hint.

```
error[LYC207]: type mismatch: expected i32, found bool
 --> t.lyca:2:12
  |
2 |     return true
  |            ^^^^
  |
  = hint: Lyca does not coerce types
```

Fix the source at that location. There are no warnings in v0; anything listed here is fatal.

## Lexer

### LYC001 — unexpected character / bad escape

Triggered by a character that is not in the language, or an unknown `\` escape inside a string.

Legal escapes: `\n`, `\t`, `\\`, `\"`.

Fix: remove the character, or use a legal escape.

### LYC002 — unterminated string

A `"` string ran to a newline or EOF without a closing `"`. Strings cannot span lines.

Fix: close the string on the same line.

### LYC003 — tabs

A tab character appeared in the file. Indentation and alignment must be spaces.

Fix: convert tabs to spaces.

### LYC004 — inconsistent indentation

A line dedented to a column that is not an earlier indent level.

```lyca
def main() -> i32:
    if true:
        return 1
  return 0          # 2 spaces; previous levels were 0 and 4
```

Fix: align with a previous indent (usually 4-space steps).

## Parser

### LYC101 — unexpected token

The parser saw something that cannot start the current construct. Common cases:

- Top-level code that is not `def` or `struct`
- Empty struct body
- Calling a non-name (`(f)()`)
- Garbage in an expression

Fix: look at `expected ...` in the message. Top-level items must be functions or structs.

### LYC102 — expected token X, found Y

A required token was missing, e.g. `:` after `def main() -> i32`, `indent` after that colon, `ident` for a name.

```lyca
def main( -> i32:    # missing parameter or ')'
```

Fix: add the token named in the message.

### LYC104 — empty block

An indented block contained no statements. Lyca has no `pass`.

Fix: put at least one statement in the block (`return`, `let`, …).

### LYC105 — invalid assignment target

The left-hand side of `=` is not a name, field, or index.

```lyca
1 = 2
```

Fix: assign to a `let mut` binding, `p.field`, or `a[i]`.

## Types and names

### LYC201 — type mismatch (general)

Expected type and found type differ, a struct literal is missing a field, an empty array has no type, or an integer literal does not fit in `i32`.

Fix: match the annotation; fill in every struct field; annotate empty arrays; use `i64` for large integers.

### LYC202 — unknown type

A type name is not `i32`/`i64`/`f32`/`f64`/`bool`/`string` and not a struct declared in this file.

Fix: spell the type correctly or declare the struct.

### LYC203 — unknown variable

A name is not a parameter or `let` in an enclosing block.

Fix: declare it, or fix the spelling.

### LYC205 — unknown function

Call to a name that is not a `def` in this file and not the builtin `print`.

Fix: define the function in the same `.lyca` file (v0 is single-file).

### LYC206 — wrong number of arguments

The call's arity does not match the `def`.

Fix: pass exactly the parameters listed on the function.

### LYC207 — return type mismatch

`return expr` does not have the function's declared return type.

```lyca
def main() -> i32:
    return true     # LYC207
```

Fix: return a value of the declared type. No coercion.

### LYC208 — missing return

Not every path returns. `if` without `else` does not cover the function. `while`/`for` may run zero times, so they never count as a return.

Fix: add `return` after the branches, or return in both `if` and `else`.

### LYC209 — unknown field / field on non-struct

`p.foo` where `foo` is not a field, or the receiver is not a struct (or `&Struct`).

Fix: use a field declared on the struct.

### LYC210 — unknown struct

`Point { ... }` or a value whose type should be a struct that was never declared.

Fix: declare `struct Point:` in the same file.

### LYC211 — illegal operator for this type

Examples: `-true`, `"a" + "b"`, `%` on `f64`.

Fix: use arithmetic only on `i32`/`i64`/`f32`/`f64`; `%` only on integers.

### LYC212 — cannot index

`x[i]` where `x` is not an array (or `&` array).

Fix: index `[T; N]` values only. The index must be `i32`.

### LYC213 — array length mismatch

```lyca
let a: [i32; 2] = [1, 2, 3]
```

Fix: make the literal's length equal `N`.

### LYC214 — no main

The file has no `def main`.

Fix: add `def main() -> i32:` and return an exit code.

### LYC215 — bad main signature

`main` has parameters or a return type other than `i32`.

Fix: use exactly `def main() -> i32`.

### LYC216 — duplicate name

Two functions, two structs, two fields, two parameters, or two `let`s in the same block share a name. Also used for a struct named like a primitive (`i32`).

Fix: rename one of them. Shadowing across nested blocks is allowed; the inner `let` cannot reuse a name already in **that** block.

## Ownership

### LYC217 — assign to immutable

Assignment to a binding declared `let` without `mut`, including field/index assignment through that binding.

Fix: `let mut x: T = ...`.

### LYC218 — use of moved value

A move-type name was used after being moved (assignment, pass-by-value, return, or reading a move field).

Fix: borrow (`&s` / pass to a `&T` parameter) or stop using the old name.

### LYC219 — move while borrowed

Moving a value that still has a live `&` borrow.

```lyca
let s: string = "hi"
let r: &string = &s
let t: string = s    # LYC219
```

Fix: wait until the borrow's block ends, or do not move.

### LYC220 — mutate while borrowed

Assigning to a borrowed binding.

Fix: end the borrow's scope first, or do not mutate.

### LYC221 — no implicit conversion

A binary operator saw two different types (usually `i32` vs `i64`).

Fix: use the same type on both sides. No casts in v0.

### LYC222 — cannot borrow this expression

`&` applied to something other than a variable name (`&p.x`, `&a[0]`, `&foo()`).

Fix: bind it to a `let`, then `&name`.

### LYC223 — borrow after move

`&s` (or implicit borrow of `s`) after `s` was moved.

Fix: borrow before moving, or do not move.

### LYC225 — illegal comparison

Ordering (`< > <= >=`) on `bool`, `string`, arrays, structs, or refs. `==`/`!=` on those composite types is also rejected except `bool`.

Fix: compare numbers (and equality on `bool`).

### LYC226 — if condition is not bool

`if 1:` / `if x:` where `x: i32`.

Fix: write a comparison, e.g. `if x != 0:`.

### LYC227 — while condition is not bool

Same as LYC226 for `while`.

## Codegen / toolchain

### LYC301 — clang failed / internal error

`clang` could not be launched, returned non-zero on the generated `.ll`, or the compiler hit a missing local during IR emission.

Fix: install `clang` and confirm `clang -v` works. If the message is `internal compiler error`, that is a compiler bug; the `.ll` path in the message (when clang failed) is worth inspecting.

---

### LYC224 — unsupported reference operation

Returning a reference, mutable reference bindings, nested references, aggregate reference storage, mutation through a shared reference, or moving a non-Copy value through a reference. Use owned return values and immutable local borrows.

### LYC228 — recursive value layout

A struct contains itself, directly or through other structs/arrays. Heap indirection is not implemented; use a nonrecursive representation.

### LYC229 — unsupported Python boundary type

Public extension functions and Python declarations accept scalars, strings, or fixed arrays of numeric/bool elements, optionally borrowed as parameters. Structs and nested arrays are internal-only. Prefix an internal helper's name with `_`, or expose supported arguments.

### LYC230 — loop-carried move

A loop tries to move a binding created outside that loop. Borrow it, or construct an owned value inside each iteration.

### LYC231 — constant index out of bounds

A literal index is negative or outside the array length. Dynamic indices are checked at runtime and raise an error before memory access.

Codes not used in v0 (reserved): `LYC103`, `LYC204`.

## Runtime failures

Bounds failures raise `IndexError` through a Python extension. Invalid signed integer division/remainder raises `ArithmeticError`. Native programs print the source line number and exit 1. Python import/call/conversion errors preserve the original Python exception; embedded executables print it and exit 1.
