import { CompileError, Span, spanOf } from "../diagnostics";

export type TokenKind =
  | "ident"
  | "int"
  | "float"
  | "string"
  | "extern"
  | "python"
  | "def"
  | "if"
  | "else"
  | "elif"
  | "for"
  | "while"
  | "return"
  | "struct"
  | "let"
  | "mut"
  | "in"
  | "true"
  | "false"
  | "and"
  | "or"
  | "not"
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "=="
  | "!="
  | "<"
  | ">"
  | "<="
  | ">="
  | "="
  | ":"
  | "."
  | ","
  | "("
  | ")"
  | "["
  | "]"
  | "{"
  | "}"
  | ";"
  | "->"
  | "&"
  | ".."
  | "newline"
  | "indent"
  | "dedent"
  | "eof";

export type Token = {
  kind: TokenKind;
  value: string;
  span: Span;
};

const KEYWORDS: Record<string, TokenKind> = {
  extern: "extern",
  python: "python",
  def: "def",
  if: "if",
  else: "else",
  elif: "elif",
  for: "for",
  while: "while",
  return: "return",
  struct: "struct",
  let: "let",
  mut: "mut",
  in: "in",
  true: "true",
  false: "false",
  and: "and",
  or: "or",
  not: "not",
};

const twoKinds: Record<string, TokenKind> = {
  "==": "==",
  "!=": "!=",
  "<=": "<=",
  ">=": ">=",
  "->": "->",
  "..": "..",
};

const one: Record<string, TokenKind> = {
  "+": "+",
  "-": "-",
  "*": "*",
  "/": "/",
  "%": "%",
  "<": "<",
  ">": ">",
  "=": "=",
  ":": ":",
  ".": ".",
  ",": ",",
  "(": "(",
  ")": ")",
  "[": "[",
  "]": "]",
  "{": "{",
  "}": "}",
  ";": ";",
  "&": "&",
};

function isIdentStart(c: string): boolean {
  return (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_";
}

function isIdent(c: string): boolean {
  return isIdentStart(c) || isDigit(c);
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

export function lex(source: string, filename: string): Token[] {
  const tokens: Token[] = [];
  const indents = [0];
  let i = 0;
  let line = 1;
  let col = 1;
  let atLineStart = true;
  const brackets: string[] = [];

  const fail = (code: string, msg: string, sl: number, sc: number, hint?: string) => {
    throw new CompileError(code, msg, spanOf(sl, sc), filename, source, hint);
  };

  const push = (kind: TokenKind, value: string, sl: number, sc: number, el: number, ec: number) => {
    tokens.push({ kind, value, span: { line: sl, col: sc, endLine: el, endCol: ec } });
  };

  const peek = (n = 0) => source[i + n] ?? "";

  while (i < source.length) {
    if (atLineStart) {
      const sl = line;
      const sc = col;
      let spaces = 0;
      while (peek() === " ") {
        spaces++;
        i++;
        col++;
      }
      if (peek() === "\t") {
        fail(
          "LYC003",
          "tabs are not allowed; use spaces for indentation",
          line,
          col,
          "Lyca uses space-only indentation, like Python with expandtabs disabled",
        );
      }
      if (peek() === "#" || peek() === "\n" || peek() === "\r" || i >= source.length) {
        // blank or comment-only line: do not emit indent tokens
      } else {
        const current = indents[indents.length - 1]!;
        if (brackets.length > 0) {
          // Continuation indentation has no block meaning.
        } else if (spaces > current) {
          indents.push(spaces);
          push("indent", "", sl, sc, line, col);
        } else if (spaces < current) {
          while (indents[indents.length - 1]! > spaces) {
            indents.pop();
            push("dedent", "", sl, sc, line, col);
          }
          if (indents[indents.length - 1] !== spaces) {
            fail(
              "LYC004",
              "inconsistent indentation",
              sl,
              1,
              "dedent must match a previous indent level",
            );
          }
        }
        atLineStart = false;
        continue;
      }
    }

    const c = peek();
    if (c === "") break;

    if (c === "\r") {
      i++;
      continue;
    }

    if (c === "\n") {
      if (brackets.length === 0) push("newline", "\n", line, col, line, col + 1);
      i++;
      line++;
      col = 1;
      atLineStart = true;
      continue;
    }

    if (c === " ") {
      i++;
      col++;
      continue;
    }

    if (c === "\t") {
      fail("LYC003", "tabs are not allowed; use spaces for indentation", line, col);
    }

    if (c === "#") {
      while (i < source.length && peek() !== "\n") {
        i++;
        col++;
      }
      continue;
    }

    const sl = line;
    const sc = col;

    if (c === '"') {
      i++;
      col++;
      let value = "";
      while (i < source.length && peek() !== '"' && peek() !== "\n") {
        if (peek() === "\\") {
          i++;
          col++;
          const e = peek();
          const map: Record<string, string> = { n: "\n", t: "\t", "\\": "\\", '"': '"' };
          if (!(e in map)) {
            fail("LYC001", `unknown string escape '\\${e}'`, line, col - 1);
          }
          value += map[e];
          i++;
          col++;
        } else {
          value += peek();
          i++;
          col++;
        }
      }
      if (peek() !== '"') {
        fail("LYC002", "unterminated string literal", sl, sc, "close the string with '\"'");
      }
      i++;
      col++;
      push("string", value, sl, sc, line, col);
      continue;
    }

    if (isDigit(c)) {
      let raw = "";
      while (isDigit(peek())) {
        raw += peek();
        i++;
        col++;
      }
      if (peek() === "." && peek(1) !== "." && isDigit(peek(1))) {
        raw += ".";
        i++;
        col++;
        while (isDigit(peek())) {
          raw += peek();
          i++;
          col++;
        }
        push("float", raw, sl, sc, line, col);
      } else {
        push("int", raw, sl, sc, line, col);
      }
      continue;
    }

    if (isIdentStart(c)) {
      const start = i;
      while (isIdent(peek())) {
        i++;
        col++;
      }
      const raw = source.slice(start, i);
      const kind = Object.hasOwn(KEYWORDS, raw) ? KEYWORDS[raw]! : "ident";
      push(kind, raw, sl, sc, line, col);
      continue;
    }

    const two = c + peek(1);

    if (twoKinds[two]) {
      i += 2;
      col += 2;
      push(twoKinds[two], two, sl, sc, line, col);
      continue;
    }


    if (one[c]) {
      if ("([{".includes(c)) brackets.push(c);
      if (")]}".includes(c)) {
        const want = { ")": "(", "]": "[", "}": "{" }[c];
        if (brackets.pop() !== want) fail("LYC001", "mismatched closing bracket", sl, sc);
      }
      i++;
      col++;
      push(one[c], c, sl, sc, line, col);
      continue;
    }

    fail("LYC001", `unexpected character ${JSON.stringify(c)}`, sl, sc);
  }

  if (!atLineStart && tokens[tokens.length - 1]?.kind !== "newline") {
    push("newline", "\n", line, col, line, col);
  }
  while (indents.length > 1) {
    indents.pop();
    push("dedent", "", line, col, line, col);
  }
  push("eof", "", line, col, line, col);
  return tokens;
}
