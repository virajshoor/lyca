# Type system

**Author:** Viraj Shoor

Ferra is statically typed. Every function parameter, return, and `let` binding has an explicit type. The compiler rejects the program if any expression does not match its expected type. There is no type inference beyond integer/float literals taking the type of their context, and there is no implicit conversion between named types.

## Types

```
T ::= i32 | i64 | f32 | f64 | bool | string
    | [T; N]
    | StructName
    | &T
```

`N` is a non-negative integer literal. `[i32; 2]` and `[i32; 3]` are different types.

User structs are nominal: `Point` is not interchangeable with another struct that also has `x: i32, y: i32`.

## Literal typing

- `123` has type `i32` unless the expected type is `i64`.
- An `i32` literal that does not fit in signed 32-bit is an error (`FER201`); use an `i64` annotation.
- `1.5` has type `f64` unless the expected type is `f32`.
- `"..."` has type `string`.
- `[1, 2, 3]` has element type taken from context (the `let` annotation) or defaults to `i32` for the elements. Length must match `[T; N]`.

Context is the annotation, the parameter type, or the return type. A bare `1 + 2` in a `-> i32` function is `i32`. Mixing `i32` and `i64` is always an error.

## No coercion

These are illegal:

```ferra
let x: i64 = 1
return x          # FER207: expected i32, found i64  (if main -> i32)

let a: i32 = 1
let b: i64 = 2
let c: i64 = a + b   # FER221
```

`if 1:` is illegal (`FER226`). Only `bool` is a condition. `while 1:` is `FER227`.

There are no casts in v0. Pick one type and stay on it.

## Copy vs move

A type is **Copy** if assigning or passing it does not invalidate the source:

- Copy: `i32`, `i64`, `f32`, `f64`, `bool`, `&T`
- Move: `string`, `[T; N]`, struct types

```ferra
let a: i32 = 1
let b: i32 = a    # a is still usable

let s: string = "hi"
let t: string = s # s is moved; using s is FER218
```

Reading a **Copy field** of a struct (`p.x` where `x: i32`) does not move `p`. Reading a **move field** marks the whole struct as moved. Indexing an array of Copy elements does not move the array; indexing an array of move elements does.

## Borrowing

`&T` is a shared, immutable borrow. `&x` is only legal when `x` is a variable name (not `p.x` or `a[i]` in v0).

```ferra
let s: string = "hi"
let r: &string = &s
```

You may also write `let r: &string = s`; the compiler inserts a borrow when the expected type is `&T` and the value has type `T`.

Call sites do the same: a parameter of type `&T` will borrow an argument of type `T` instead of moving it. That is why `print(s)` does not consume `s`.

Refs are Copy: `let r2: &string = r` copies the reference and both borrow the same owner.

### Rules

1. **No use after move.** Once a move-type binding is moved, any use is `FER218`.
2. **No borrow after move.** `&s` after `s` was moved is `FER223`.
3. **No move while borrowed.** If a live `&T` points at `s`, moving `s` is `FER219`.
4. **No mutate while borrowed.** Assigning to `s` (or to a field/index of `s`) while borrowed is `FER220`.
5. **Immutability.** `let x` cannot be assigned; `let mut x` can, subject to (4).

### Lifetimes (v0)

Ferra does not do non-lexical lifetimes. A borrow created by `let r: &T = &s` lasts until `r` goes out of scope (end of the current indented block). Temporary borrows at a call site last for that statement only.

```ferra
def main() -> i32:
    let mut s: string = "a"
    if true:
        let r: &string = &s
        print(r)
        # s = "b"   # FER220, r is still in scope
    s = "b"         # ok, r is gone
    print(s)
    return 0
```

There is no `&mut T` in v0. Mutation goes through the owned `let mut` binding when no borrows are live.

## Passing arguments

- Param `T` (owned, move type): the argument is moved.
- Param `T` (Copy): the argument is copied.
- Param `&T`: the argument is borrowed (explicit `&x` or implicit if it has type `T`).

Returning a move type moves the local out of the function. Returning `&T` that borrows a local is not checked as a dangling-ref error in v0 if you somehow construct it — do not return a borrow of a local. The only safe `&T` values to return would have to borrow something that outlives the function; v0 has no such globals besides string literals. **Do not return `&T` from user functions in v0.** `print` takes `&string`; it does not return one.

## Why this model

No garbage collector. String literals live in static storage; the type system still treats `string` as move-only so the same rules will apply when heap strings exist. Structs and arrays are stack-allocated and copied/moved as whole values. Predictable, C-like codegen: load and store, no runtime.

## Disallowed in v0 (and the error)

| Attempt | Result |
|---------|--------|
| Omit a type on `let` or `def` | parse error (`FER102`) |
| `i32` + `i64` | `FER221` |
| `if x:` where `x: i32` | `FER226` |
| Use `s` after `let t: string = s` | `FER218` |
| `s = "x"` while `&s` is live | `FER220` |
| `&p.x` | `FER222` |
| Assign to `let x` (no `mut`) | `FER217` |
| Two types with the same name | `FER216` |
| `main` with params or non-`i32` return | `FER215` |
| Missing `main` | `FER214` |
