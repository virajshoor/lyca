import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { codegen } from "./codegen";
import { CompileError, spanOf } from "./diagnostics";
import { lex } from "./lexer";
import { parse } from "./parser";
import { typecheck } from "./typechecker";
import { pythonBridge, pythonConfig } from "./python";

export type CompileOptions = {
  target?: "native" | "python";
  opt?: 0 | 1 | 2 | 3;
  python?: string;
  moduleName?: string;
};

export function compileSource(source: string, filename: string, options: CompileOptions = {}): string {
  const ast = parse(lex(source, filename), source, filename);
  return codegen(typecheck(ast, source, filename, options.target), filename);
}

// Returns the actual artifact path (Python adds the selected interpreter's extension suffix).
export function compileFile(path: string, output: string, options: CompileOptions = {}): string {
  const source = readFileSync(path, "utf8");
  const fail = (message: string, hint?: string): never => {
    throw new CompileError("LYC301", message, spanOf(1, 1), path, source, hint);
  };
  const target = options.target ?? "native";
  const opt = options.opt ?? 2;
  if (!["native", "python"].includes(target) || ![0, 1, 2, 3].includes(opt)) fail("invalid target or optimization level");
  const ast = parse(lex(source, path), source, path);
  const checked = typecheck(ast, source, path, target);
  const ir = codegen(checked, path);
  const needsPython = target === "python" || [...checked.fns.values()].some(f => f.pythonModule);
  if (needsPython && process.platform !== "darwin" && process.platform !== "linux") fail("Python integration currently supports macOS and Linux");
  let python;
  if (needsPython) {
    try { python = pythonConfig(options.python ?? "python3"); }
    catch (e) { fail((e as Error).message, "select a CPython installation with development headers using --python"); }
  }
  const moduleName = options.moduleName ?? basename(output);
  if (target === "python" && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(moduleName)) fail("Python module name must be an identifier", "use --module NAME and give -o a path without an extension");
  const absOut = resolve(output + (target === "python" ? python!.suffix : ""));
  if ([absOut, absOut + ".ll", absOut + ".c"].includes(resolve(path))) fail("output would overwrite the source file");
  mkdirSync(dirname(absOut), { recursive: true });
  const stage = mkdtempSync(join(dirname(absOut), ".lyca-"));
  try {
    const ll = join(stage, "program.ll"), binary = join(stage, "artifact");
    writeFileSync(ll, ir);
    const runtime = python ? join(stage, "bridge.c") : join(__dirname, "runtime/native.c");
    if (python) writeFileSync(runtime, pythonBridge(checked, moduleName, python));
    const usesRuntime = python || ir.includes("call void @lyca_fail") || ir.includes("call i32 @lyca_print");
    const args = [ll, ...(usesRuntime ? [runtime] : []), `-O${opt}`, "-Wno-override-module", "-o", binary];
    if (python) args.push("-I", python.include);
    if (target === "python") {
      args.push("-fPIC", ...(process.platform === "darwin" ? ["-bundle", "-undefined", "dynamic_lookup"] : ["-shared"]));
    } else if (python) args.push(...python.link);
    const r = spawnSync("clang", args, { encoding: "utf8" });
    if (r.error || r.status !== 0) fail(`clang failed to compile LLVM IR: ${r.error?.message ?? r.stderr}`, "check clang and Python development headers; existing output was preserved");
    renameSync(ll, absOut + ".ll");
    if (python) renameSync(runtime, absOut + ".c");
    renameSync(binary, absOut);
    return absOut;
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

export { CompileError };
