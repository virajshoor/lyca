import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CheckedProgram, LycaType, FnInfo } from "./typechecker";

export type PythonConfig = { executable: string; include: string; suffix: string; link: string[]; paths: string[]; version: string };

export function pythonConfig(executable: string): PythonConfig {
  const script = `import json, os, shlex, sys, sysconfig
if sys.version_info < (3, 10) or sys.implementation.name != 'cpython' or sysconfig.get_config_var('Py_GIL_DISABLED'):
    raise RuntimeError('Lyca requires GIL-enabled CPython 3.10+')
v = sysconfig.get_config_var
framework = v('PYTHONFRAMEWORK')
if framework:
    library = os.path.join(v('PYTHONFRAMEWORKPREFIX'), framework + '.framework', 'Versions', v('VERSION'), framework)
else:
    library = os.path.join(v('LIBDIR'), v('LDLIBRARY'))
link = [library] + shlex.split((v('LIBS') or '') + ' ' + (v('SYSLIBS') or ''))
if not framework:
    link += ['-Wl,-rpath,' + v('LIBDIR')]
print(json.dumps(dict(executable=sys.executable, include=sysconfig.get_path('include'), suffix=v('EXT_SUFFIX'), link=link, paths=sys.path, version=sys.version.split()[0])))`;
  const r = spawnSync(executable, ["-c", script], { encoding: "utf8" });
  if (r.error || r.status !== 0) throw new Error(`cannot configure Python: ${r.error?.message ?? r.stderr.trim()}`);
  return JSON.parse(r.stdout) as PythonConfig;
}

function shape(t: LycaType): { c: string; kind: number; count: number } {
  if (t.kind === "ref") return shape(t.inner);
  if (t.kind === "array") return { ...shape(t.element), count: t.size };
  const types: Record<string, [string, number]> = { i32: ["int32_t", 1], i64: ["int64_t", 2], f32: ["float", 3], f64: ["double", 4], bool: ["uint8_t", 5], string: ["LycaString", 6] };
  const [c, kind] = types[t.kind]!;
  return { c, kind, count: -1 };
}

function variable(t: LycaType, name: string): string {
  const s = shape(t);
  return `${s.c} ${name}${s.count >= 0 ? `[${Math.max(1, s.count)}]` : ""} = {0};`;
}

function from(t: LycaType, object: string, destination: string): string {
  const s = shape(t);
  return `lyca_from_python(ctx, ${object}, &${destination}, ${s.kind}, ${s.count})`;
}

function to(t: LycaType, pointer: string): string {
  const s = shape(t);
  return `lyca_to_python(${pointer}, ${s.kind}, ${s.count})`;
}

function declaration(fn: FnInfo): string {
  return `extern void lyca_export_${fn.name}(void *, void *${fn.params.map(() => ", const void *").join("")});`;
}

function wrapper(fn: FnInfo): string {
  return `${declaration(fn)}
static PyObject *wrap_${fn.name}(PyObject *self, PyObject *args) {
    (void)self;
    if (PyTuple_GET_SIZE(args) != ${fn.params.length}) {
        PyErr_SetString(PyExc_TypeError, "${fn.name} expects ${fn.params.length} positional arguments");
        return NULL;
    }
    LycaContext *ctx = calloc(1, sizeof(*ctx));
    if (!ctx) return PyErr_NoMemory();
    if (setjmp(ctx->jump)) { lyca_destroy(ctx); return NULL; }
    ${fn.params.map((p, i) => variable(p.type, `a${i}`)).join("\n    ")}
    ${variable(fn.ret, "out")}
    ${fn.params.map((p, i) => `if (${from(p.type, `PyTuple_GET_ITEM(args, ${i})`, `a${i}`)} < 0) { lyca_destroy(ctx); return NULL; }`).join("\n    ")}
    lyca_export_${fn.name}(ctx, &out${fn.params.map((_, i) => `, &a${i}`).join("")});
    PyObject *result = ${to(fn.ret, "&out")};
    lyca_destroy(ctx);
    return result;
}`;
}

function foreign(fn: FnInfo): string {
  return `void lyca_py_${fn.name}(void *context, void *out${fn.params.map((_, i) => `, const void *a${i}`).join("")}) {
    LycaContext *ctx = context;
    PyObject *module = NULL, *callable = NULL, *args = NULL, *result = NULL;
    module = PyImport_ImportModule(${JSON.stringify(fn.pythonModule)});
    if (!module) goto fail;
    callable = PyObject_GetAttrString(module, "${fn.name}");
    if (!callable) goto fail;
    args = PyTuple_New(${fn.params.length});
    if (!args) goto fail;
    ${fn.params.map((p, i) => `{
        PyObject *item = ${to(p.type, `a${i}`)};
        if (!item) goto fail;
        PyTuple_SET_ITEM(args, ${i}, item);
    }`).join("\n    ")}
    result = PyObject_CallObject(callable, args);
    if (!result) goto fail;
    if (lyca_from_python(ctx, result, out, ${shape(fn.ret).kind}, ${shape(fn.ret).count}) < 0) goto fail;
    Py_DECREF(result); Py_DECREF(args); Py_DECREF(callable); Py_DECREF(module);
    return;
fail:
    Py_XDECREF(result); Py_XDECREF(args); Py_XDECREF(callable); Py_XDECREF(module);
    longjmp(ctx->jump, 1);
}`;
}

export function pythonBridge(checked: CheckedProgram, moduleName: string, config: PythonConfig): string {
  const out = [readFileSync(join(__dirname, "runtime/python.c"), "utf8")];
  for (const fn of checked.fns.values()) if (fn.pythonModule) out.push(foreign(fn));
  if (checked.target === "python") {
    const exports = [...checked.fns.values()].filter(f => f.name !== "print" && !f.pythonModule && !f.name.startsWith("_"));
    out.push(...exports.map(wrapper));
    out.push(`static PyMethodDef methods[] = {
${exports.map(f => `    {"${f.name}", wrap_${f.name}, METH_VARARGS, NULL},`).join("\n")}
    {NULL, NULL, 0, NULL}
};
static struct PyModuleDef module = {PyModuleDef_HEAD_INIT, "${moduleName}", NULL, 0, methods, NULL, NULL, NULL, NULL};
PyMODINIT_FUNC PyInit_${moduleName}(void) { return PyModule_Create(&module); }`);
  } else {
    out.push(`${declaration(checked.fns.get("main")!)}
int main(void) {
    PyConfig config;
    PyConfig_InitPythonConfig(&config);
    config.parse_argv = 0;
    PyStatus status = PyConfig_SetBytesString(&config, &config.program_name, ${JSON.stringify(config.executable)});
    if (PyStatus_Exception(status)) { PyConfig_Clear(&config); Py_ExitStatusException(status); }
    status = Py_InitializeFromConfig(&config);
    PyConfig_Clear(&config);
    if (PyStatus_Exception(status)) Py_ExitStatusException(status);
    PyObject *path = PySys_GetObject("path");
    ${config.paths.map(p => `{
        PyObject *entry = PyUnicode_DecodeFSDefault(${JSON.stringify(p)});
        if (!entry || PyList_Append(path, entry) < 0) { Py_XDECREF(entry); PyErr_Print(); Py_FinalizeEx(); return 1; }
        Py_DECREF(entry);
    }`).join("\n    ")}
    LycaContext *ctx = calloc(1, sizeof(*ctx));
    if (!ctx) { PyErr_NoMemory(); PyErr_Print(); Py_FinalizeEx(); return 1; }
    if (setjmp(ctx->jump)) { PyErr_Print(); lyca_destroy(ctx); Py_FinalizeEx(); return 1; }
    int32_t result = 0;
    lyca_export_main(ctx, &result);
    lyca_destroy(ctx);
    if (Py_FinalizeEx() < 0) return 1;
    return result;
}`);
  }
  return out.join("\n\n");
}
