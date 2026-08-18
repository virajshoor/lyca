#!/usr/bin/env node
import { parseArgs } from "node:util";
import { CompileError, compileFile } from "../compile";

function help(): string {
  return `Ferra compiler

Usage:
  ferra build <file.fe> -o <output>
  ferra --help

Options:
  -o, --output    Output path for the native binary
  -h, --help      Show this help
`;
}

function main(): void {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    process.stdout.write(help());
    process.exit(positionals.length === 0 && !values.help ? 1 : 0);
  }

  const [cmd, file] = positionals;
  if (cmd !== "build" || !file) {
    process.stderr.write("error: expected `ferra build <file.fe> -o <output>`\n");
    process.exit(1);
  }
  if (!values.output) {
    process.stderr.write("error: missing -o <output>\n");
    process.exit(1);
  }

  try {
    compileFile(file, values.output);
  } catch (e) {
    if (e instanceof CompileError) {
      process.stderr.write(e.format() + "\n");
      process.exit(1);
    }
    throw e;
  }
}

main();
