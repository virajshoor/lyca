export type Span = {
  line: number;
  col: number;
  endLine: number;
  endCol: number;
};

export class CompileError extends Error {
  constructor(
    public code: string,
    message: string,
    public span: Span,
    public filename: string,
    public source: string,
    public hint?: string,
  ) {
    super(message);
    this.name = "CompileError";
  }

  format(): string {
    const lines = this.source.split(/\r?\n/);
    const line = lines[this.span.line - 1] ?? "";
    const n = String(this.span.line);
    const pad = " ".repeat(n.length);
    const from = Math.max(0, this.span.col - 1);
    const to =
      this.span.line === this.span.endLine
        ? Math.max(from + 1, this.span.endCol - 1)
        : Math.max(from + 1, line.length);
    const caret = " ".repeat(from) + "^".repeat(Math.max(1, to - from));
    const hint = this.hint ? `\n${pad} |\n  = hint: ${this.hint}` : "";
    return [
      `error[${this.code}]: ${this.message}`,
      ` --> ${this.filename}:${this.span.line}:${this.span.col}`,
      `${pad} |`,
      `${n} | ${line}`,
      `${pad} | ${caret}`,
      hint,
    ].join("\n");
  }
}

export function spanOf(
  line: number,
  col: number,
  endLine = line,
  endCol = col + 1,
): Span {
  return { line, col, endLine, endCol };
}
