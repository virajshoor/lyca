# Compiler architecture

The Ferra compiler is a TypeScript program (`src/`) that runs on Node.js. It does not load a native LLVM library. It writes LLVM IR as text and runs `clang` on that text.

```
.fe source
    │
    ▼
 lexer      src/lexer
    │  Token[]  (incl. indent / dedent / newline)
    ▼
 parser     src/parser     → AST (src/ast)
    │
    ▼
 typecheck  src/typechecker
    │  ownership + types
    ▼
 codegen    src/codegen    → LLVM IR string
    │
    ▼
 clang file.ll -o binary
```

`src/compile.ts` is the driver. `src/cli/index.ts` is the `ferra` command (`node:util` `parseArgs`, no extra CLI package).

## Why not llvm-bindings

`llvm-bindings` (and similar native addons) must be compiled against a specific LLVM version. That fails often on macOS/Homebrew and in CI. Emitting `.ll` and calling `clang` is the same backend pipeline LLVM itself uses, with zero native Node addons. The IR is ordinary LLVM 15+ opaque-pointer IR (`ptr`).

## Directories

| Path | Role |
|------|------|
| `src/lexer` | Hand-written scanner. Keywords, numbers, strings, operators, Python-style `indent`/`dedent`. |
| `src/parser` | Recursive-descent parser. One token of lookahead. Newlines inside `()`, `[]`, `{}` are skipped. |
| `src/ast` | Discriminated unions for types, expressions, statements, decls. |
| `src/typechecker` | Resolves types, enforces annotations, tracks move/borrow state per local. |
| `src/codegen` | Walks the checked AST and concatenates LLVM IR. Locals are `alloca` + load/store (no SSA construction). |
| `src/cli` | `ferra build <file> -o <out>`. |
| `src/diagnostics.ts` | `CompileError` with `code`, span, source snippet, optional hint. |
| `tests/` | Vitest: lexer, parser, typechecker, plus e2e (`clang` + run). |

## Lexer

`lex(source, filename): Token[]`

- Tracks an indent stack. A deeper indent emits `indent`; a shallower one emits one `dedent` per matched level. A depth that does not match a previous level is `FER004`.
- Blank lines and `#` comment-only lines do not change indent.
- Tabs are `FER003`.
- `1..10` is `int`, `..`, `int` — the second `.` prevents float lexing.
- EOF inserts remaining `dedent`s and one `eof` token.

## Parser

`parse(tokens, source, filename): Program`

Grammar (informal):

```
program   ::= (fn | struct)*
fn        ::= "def" ident "(" params ")" "->" type ":" block
struct    ::= "struct" ident ":" NEWLINE INDENT (ident ":" type NEWLINE)+ DEDENT
block     ::= ":" NEWLINE INDENT stmt+ DEDENT
stmt      ::= let | return | if | while | for | assign | expr
let       ::= "let" "mut"? ident ":" type "=" expr
if        ::= "if" expr block ("elif" expr block)* ("else" block)?
for       ::= "for" ident "in" expr ".." expr block
```

Expression precedence, tightest last: `or`, `and`, `not`, comparisons (one operator, not chained), `+ -`, `* / %`, unary `-` and `&`, postfix call/index/field.

On failure it throws `CompileError` (`FER101`, `FER102`, `FER104`, `FER105`).

## Type checker

`typecheck(ast, source, filename): CheckedProgram`

1. Collect struct names, then resolve field types (so structs can refer to earlier structs; recursive structs are not useful without indirection).
2. Install builtin `print(s: &string) -> i32`.
3. Collect function signatures (enables recursion).
4. Require `main() -> i32`.
5. Walk each function body with a stack of scopes. Each local has `{ type, mut, state: owned|moved, borrowCount, borrowedFrom? }`.

Moves happen when a move-type name is used as an rvalue. Field/index **places** do not move the parent unless the projected value itself is a move type.

There is no separate typed AST. Codegen re-resolves types from annotations and from LLVM types of allocas.

## Codegen

Each Ferra function becomes an LLVM `define`. Parameters are stored into allocas so the rest of the function is load/store.

- `i32`/`i64`/`f32`/`f64`/`bool` → `i32`/`i64`/`float`/`double`/`i1`
- `string` and `&string` → `%String = { ptr, i64 }`
- struct → `%Name = type { ... }`
- `[T; N]` → `[N x T]`

`print` is emitted as an LLVM function that `extractvalue`s the pointer and calls `puts`.

`if`/`while`/`for` use explicit labels and `br`. `and`/`or` short-circuit through a stack slot (no `phi`).

String literals become `private unnamed_addr constant [N x i8]` arrays; codegen GEP's to the first byte.

After IR is written to `output.ll`, `compileFile` runs:

```
clang output.ll -o output -Wno-override-module
```

`FER301` is a clang failure or an internal codegen bug.

## Adding a language feature

1. Token, if needed, in `src/lexer`.
2. AST node in `src/ast`.
3. Parse it in `src/parser`.
4. Type rules and error code in `src/typechecker`; add the code to `docs/error-reference.md`.
5. LLVM emission in `src/codegen`.
6. Tests for valid and invalid programs, including span checks on errors.
7. `npm test` (includes e2e if `clang` is present).

## Tests

```
npm test
```

Vitest runs `tests/*.test.ts`. E2E compiles `examples/fib.fe` and `examples/hello.fe` with the real clang pipeline and checks exit code `55` and stdout `Hello, World!`.
