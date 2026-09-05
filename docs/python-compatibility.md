# Python compatibility

Ferra supports **typed function calls in both directions**. Python-like syntax alone does not provide Python source compatibility. Existing Python packages execute in the selected CPython interpreter; their Python code is not recompiled by Ferra.

## Python imports Ferra

```ferra
# kernels.fe — main is not required in an extension
def add(x: i32, y: i32) -> i32:
    return x + y

def sum3(a: &[i32; 3]) -> i32:
    return a[0] + a[1] + a[2]
```

```bash
npm run build
node dist/cli/index.js build kernels.fe --target python -o build/kernels
PYTHONPATH=build python3 -c 'import kernels; print(kernels.sum3([1, 2, 3]))'
```

`-o` is a path **without an extension**. The compiler adds CPython's `EXT_SUFFIX`. `--module NAME` overrides the import name, which otherwise comes from the output basename. For normal imports, keep the filename stem and module name equal. To rename a module, change both. Functions whose names begin with `_` remain internal; other locally defined functions become positional-only Python functions. Python declarations are not re-exported. Unsupported public signatures fail during type checking.

## Ferra calls Python

Declare the actual module and function name with a typed signature:

```ferra
extern python "math" def sqrt(x: f64) -> f64
extern python "builtins" def str(n: i32) -> string

def main() -> i32:
    print(str(42))
    if sqrt(81.0) == 9.0:
        return 0
    return 1
```

Build normally. The declaration triggers an embedded-Python executable automatically:

```bash
node dist/cli/index.js build program.fe -o build/program --python /path/to/venv/bin/python
```

Imports use CPython's import machinery. Module lookup happens at call time; Python's module cache is reused. Function attributes are looked up on each call, so monkey patches remain visible. Declarations support positional calls, one return value, and dotted module names. They do not expose Python object handles, methods, keyword arguments, async calls, or arbitrary containers. Write a small Python adapter module for those APIs and declare the adapter's typed functions.

## Values at the boundary

| Ferra type | Accepted Python value | Returned Python value |
|---|---|---|
| `i32`, `i64` | Integer/index-protocol value within range; `bool` rejected | `int` |
| `f32`, `f64` | Numeric float-convertible value; `bool` rejected; finite f32 overflow rejected | `float` |
| `bool` | Python `bool` | `bool` |
| `string` | Python `str`, valid UTF-8 encoding | Python `str` |
| `[T; N]`, where T is numeric/bool | Sequence of exactly N valid elements | New Python `list` |
| `&T` parameter | Same conversion as T; native callee borrows the converted storage | Reference returns unsupported |

Arrays copy. NumPy integer scalars work through the index protocol; numeric ndarrays can be copied through the sequence protocol. No NumPy build dependency or zero-copy claim. Multidimensional arrays, structured dtypes, arbitrary object arrays, structs, and nested Ferra arrays require adapters or future support.

Native operations do not implicitly coerce numeric types. The table describes explicit Python-boundary conversion rules. Float conversion rounds to the destination precision; NaN and infinities are preserved. Integer overflow raises `OverflowError`; wrong types raise `TypeError`; wrong array lengths raise `ValueError`.

## Runtime ownership and errors

The wrapper holds the GIL for the whole call. Python calls use CPython's normal reference counting and garbage collector. Native Ferra arithmetic, structs, and arrays retain native execution.

Each outer extension call owns a private runtime context. Python-derived strings are copied into that context and freed when the call returns or fails. An embedded executable keeps its context until `main` ends. Strings retain their storage across nested Ferra functions, so owned string returns remain valid. **Peak string memory is proportional to all copied strings produced during that outer call**, not only strings still in use. Long-running string-heavy workloads need finer-grained ownership before this becomes a suitable runtime.

Python exceptions propagate unchanged from extension calls. Native bounds/division failures become Python exceptions. Embedded programs print exceptions and exit 1. The C wrapper catches a nonlocal jump at its own call boundary and releases the context; generated LLVM functions own no cleanup-required heap resources. Any future runtime feature that adds such resources must add context cleanup or replace this unwinding design first.

## Environment and portability

- GIL-enabled CPython 3.10+; PyPy and free-threaded CPython are rejected.
- macOS and Linux, host architecture, matching Python headers and library.
- Build with the same interpreter/environment used to import the extension. These are version-specific CPython extensions, not `abi3` wheels.
- Embedded builds retain paths from the selected interpreter and depend on its installed library. They are not relocatable Python bundles.
- Core native builds neither inspect nor link Python unless Python declarations are present.
- Subinterpreter compatibility, GIL release, Windows packaging, and wheel publishing are not currently promised.

Use `npm run test:python` to require the Python integration checks. `FERRA_PYTHON=/path/to/python` selects the test interpreter. The default test command reports Python tests as skipped when Python is unavailable; CI requires them.
