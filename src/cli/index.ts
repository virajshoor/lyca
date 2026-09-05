#!/usr/bin/env node
import { parseArgs } from "node:util";
import { CompileError, CompileOptions, compileFile } from "../compile";

function help(): string {
  return `Ferra compiler

Usage:
  ferra build <file.fe> -o <output> [--opt 0|1|2|3]
  ferra build <file.fe> -o <output-stem> --target python [--module NAME] [--python PATH]

Options:
  -o, --output   Native output path or Python extension path without suffix
  --opt          LLVM optimization level (default: 2; 0 for faster debug builds)
  --target       native (default) or python
  --python       CPython executable for extension/embedded builds (default: python3)
  --module       Python import name (default: output basename)
  -h, --help     Show this help
`;
}

function main(): void {
  try {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      options: {
        output: { type: "string", short: "o" },
        help: { type: "boolean", short: "h", default: false },
        opt: { type: "string", default: "2" },
        target: { type: "string", default: "native" },
        python: { type: "string", default: "python3" },
        module: { type: "string" },
      },
      allowPositionals: true,
    });
    if (values.help || positionals.length === 0) {
      process.stdout.write(help());
      process.exitCode = values.help ? 0 : 1;
      return;
    }
    if (positionals.length !== 2 || positionals[0] !== "build" || !values.output) throw new Error("expected ferra build <file.fe> -o <output>");
    if (!/^[0-3]$/.test(values.opt!)) throw new Error("--opt must be 0, 1, 2, or 3");
    if (values.target !== "native" && values.target !== "python") throw new Error("--target must be native or python");
    const output = compileFile(positionals[1]!, values.output, {
      opt: Number(values.opt) as CompileOptions["opt"],
      target: values.target,
      python: values.python,
      moduleName: values.module,
    });
    process.stdout.write(output + "\n");
  } catch (e) {
    process.stderr.write(e instanceof CompileError ? e.format() + "\n" : `error: ${(e as Error).message}\n`);
    process.exitCode = 1;
  }
}

main();
