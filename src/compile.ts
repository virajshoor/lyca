import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { codegen } from "./codegen";
import { CompileError } from "./diagnostics";
import { lex } from "./lexer";
import { parse } from "./parser";
import { typecheck } from "./typechecker";

export function compileSource(source: string, filename: string): string {
  const tokens = lex(source, filename);
  const ast = parse(tokens, source, filename);
  const checked = typecheck(ast, source, filename);
  return codegen(checked, filename);
}

export function compileFile(path: string, output: string): void {
  const filename = path;
  const source = readFileSync(path, "utf8");
  const ir = compileSource(source, filename);
  const absOut = resolve(output);
  mkdirSync(dirname(absOut), { recursive: true });
  const ll = absOut + ".ll";
  writeFileSync(ll, ir);
  const r = spawnSync("clang", [ll, "-o", absOut, "-Wno-override-module"], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new CompileError(
      "LYC301",
      `clang failed to compile LLVM IR${r.stderr ? ":\n" + r.stderr : ""}`,
      { line: 1, col: 1, endLine: 1, endCol: 1 },
      filename,
      source,
      "install clang and ensure it can compile LLVM IR (.ll files)",
    );
  }
}

export { CompileError };
