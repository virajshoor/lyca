#!/usr/bin/env python3
"""Build the 'Coding in Lyca' PDF book. Author: Viraj Shoor."""

from __future__ import annotations

import argparse
from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    ListFlowable,
    ListItem,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)

AUTHOR = "Viraj Shoor"
TITLE = "Coding in Lyca"
SUBTITLE = "A practical guide to writing native programs in Lyca v0"
YEAR = "2026"

INK = HexColor("#1b2430")
MUTED = HexColor("#5b6570")
COPPER = HexColor("#c45c26")
STEEL = HexColor("#243044")
PAPER = HexColor("#f7f3ea")
CODE_BG = HexColor("#f4efe4")
RULE = HexColor("#d8d0c4")
LINK = HexColor("#1f4d7a")


def styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    s: dict[str, ParagraphStyle] = {}
    s["title"] = ParagraphStyle(
        "BookTitle",
        parent=base["Title"],
        fontName="Times-Bold",
        fontSize=36,
        leading=40,
        textColor=white,
        alignment=TA_LEFT,
        spaceAfter=8,
    )
    s["subtitle"] = ParagraphStyle(
        "BookSubtitle",
        parent=base["Normal"],
        fontName="Times-Italic",
        fontSize=14,
        leading=18,
        textColor=HexColor("#f0e6d8"),
        alignment=TA_LEFT,
        spaceAfter=24,
    )
    s["cover_author"] = ParagraphStyle(
        "CoverAuthor",
        parent=base["Normal"],
        fontName="Times-Bold",
        fontSize=16,
        leading=20,
        textColor=white,
        alignment=TA_LEFT,
    )
    s["cover_meta"] = ParagraphStyle(
        "CoverMeta",
        parent=base["Normal"],
        fontName="Times-Roman",
        fontSize=11,
        leading=14,
        textColor=HexColor("#e8dccb"),
        alignment=TA_LEFT,
    )
    s["h1"] = ParagraphStyle(
        "H1",
        parent=base["Heading1"],
        fontName="Times-Bold",
        fontSize=20,
        leading=24,
        textColor=STEEL,
        spaceBefore=6,
        spaceAfter=12,
        borderPadding=0,
    )
    s["h2"] = ParagraphStyle(
        "H2",
        parent=base["Heading2"],
        fontName="Times-Bold",
        fontSize=14,
        leading=18,
        textColor=COPPER,
        spaceBefore=14,
        spaceAfter=8,
    )
    s["body"] = ParagraphStyle(
        "Body",
        parent=base["Normal"],
        fontName="Times-Roman",
        fontSize=11,
        leading=15,
        textColor=INK,
        alignment=TA_JUSTIFY,
        spaceAfter=9,
    )
    s["body_left"] = ParagraphStyle(
        "BodyLeft",
        parent=s["body"],
        alignment=TA_LEFT,
    )
    s["caption"] = ParagraphStyle(
        "Caption",
        parent=base["Normal"],
        fontName="Times-Italic",
        fontSize=9,
        leading=12,
        textColor=MUTED,
        spaceBefore=2,
        spaceAfter=10,
    )
    s["code"] = ParagraphStyle(
        "Code",
        parent=base["Code"],
        fontName="Courier",
        fontSize=8.5,
        leading=11,
        textColor=INK,
        leftIndent=0,
        spaceBefore=0,
        spaceAfter=0,
    )
    s["toc_entry"] = ParagraphStyle(
        "TocEntry",
        parent=base["Normal"],
        fontName="Times-Roman",
        fontSize=12,
        leading=18,
        textColor=INK,
    )
    s["footer"] = ParagraphStyle(
        "Footer",
        parent=base["Normal"],
        fontName="Times-Italic",
        fontSize=8,
        textColor=MUTED,
        alignment=TA_LEFT,
    )
    s["page_num"] = ParagraphStyle(
        "PageNum",
        parent=base["Normal"],
        fontName="Times-Roman",
        fontSize=8,
        textColor=MUTED,
        alignment=TA_RIGHT,
    )
    s["quote"] = ParagraphStyle(
        "Quote",
        parent=base["Normal"],
        fontName="Times-Italic",
        fontSize=11,
        leading=15,
        textColor=STEEL,
        leftIndent=18,
        rightIndent=12,
        spaceBefore=6,
        spaceAfter=12,
    )
    s["li"] = ParagraphStyle(
        "Li",
        parent=s["body_left"],
        fontSize=11,
        leading=15,
        spaceAfter=3,
    )
    return s


def code_block(text: str, st: dict[str, ParagraphStyle]) -> Table:
    inner = Preformatted(text.strip("\n") + "\n", st["code"])
    tbl = Table([[inner]], colWidths=[6.5 * inch])
    tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
                ("BOX", (0, 0), (-1, -1), 0.4, RULE),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return tbl


def bullets(items: list[str], st: dict[str, ParagraphStyle]) -> ListFlowable:
    return ListFlowable(
        [ListItem(Paragraph(item, st["li"]), leftIndent=12, bulletColor=COPPER) for item in items],
        bulletType="bullet",
        start="circle",
        leftIndent=16,
        spaceAfter=10,
    )


def draw_cover(canvas, doc) -> None:
    canvas.saveState()
    w, h = letter
    canvas.setFillColor(STEEL)
    canvas.rect(0, 0, w, h, fill=1, stroke=0)
    canvas.setFillColor(COPPER)
    canvas.rect(0, 0, 0.35 * inch, h, fill=1, stroke=0)
    canvas.setFillColor(HexColor("#1a2230"))
    canvas.rect(0, 0, w, 1.35 * inch, fill=1, stroke=0)
    canvas.setFillColor(COPPER)
    canvas.rect(0, 1.35 * inch, w, 4, fill=1, stroke=0)
    canvas.setFillColor(HexColor("#c9b8a4"))
    canvas.setFont("Times-Italic", 9)
    canvas.drawString(0.9 * inch, 0.7 * inch, f"{YEAR}  ·  Written by {AUTHOR}")
    canvas.restoreState()


def draw_body(canvas, doc) -> None:
    canvas.saveState()
    w, h = letter
    canvas.setStrokeColor(COPPER)
    canvas.setLineWidth(1.5)
    canvas.line(0.75 * inch, h - 0.55 * inch, w - 0.75 * inch, h - 0.55 * inch)
    canvas.setFillColor(MUTED)
    canvas.setFont("Times-Italic", 8)
    canvas.drawString(0.75 * inch, h - 0.48 * inch, f"{TITLE}  ·  {AUTHOR}")
    canvas.setFont("Times-Roman", 8)
    canvas.drawRightString(w - 0.75 * inch, h - 0.48 * inch, "Lyca v0")
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.4)
    canvas.line(0.75 * inch, 0.55 * inch, w - 0.75 * inch, 0.55 * inch)
    canvas.setFillColor(MUTED)
    canvas.setFont("Times-Roman", 8)
    canvas.drawString(0.75 * inch, 0.38 * inch, AUTHOR)
    canvas.drawRightString(w - 0.75 * inch, 0.38 * inch, str(doc.page))
    canvas.restoreState()


def build_story(st: dict[str, ParagraphStyle]) -> list:
    story: list = []
    P = lambda t, k="body": Paragraph(t, st[k])
    H1 = lambda t: Paragraph(t, st["h1"])
    H2 = lambda t: Paragraph(t, st["h2"])
    C = lambda src: code_block(src, st)

    # Cover text sits on the steel cover template
    story.append(Spacer(1, 2.4 * inch))
    story.append(Paragraph(TITLE, st["title"]))
    story.append(Paragraph(SUBTITLE, st["subtitle"]))
    story.append(Spacer(1, 0.35 * inch))
    story.append(Paragraph(f"by {AUTHOR}", st["cover_author"]))
    story.append(Spacer(1, 0.15 * inch))
    story.append(Paragraph("Language designer and author of Lyca", st["cover_meta"]))
    story.append(Paragraph("Python-like syntax. Explicit types. Native LLVM output.", st["cover_meta"]))
    story.append(NextPageTemplate("body"))
    story.append(PageBreak())

    story.append(H1("About this book"))
    story.append(
        P(
            f"This book teaches you how to write programs in Lyca, a small, statically typed "
            f"language created by {AUTHOR}. Lyca looks like Python so you can read it at a glance: "
            "indentation, <font face='Courier'>def</font>, <font face='Courier'>if</font>, "
            "<font face='Courier'>for</font>, <font face='Courier'>return</font>. It does not behave "
            "like Python. Types are mandatory, there is no implicit coercion, and there is no garbage "
            "collector. A move-and-borrow checker keeps memory deterministic. The compiler emits LLVM IR; "
            "<font face='Courier'>clang</font> turns that IR into a native binary."
        )
    )
    story.append(
        P(
            "v0 is intentionally small. One source file, one <font face='Courier'>main</font>, a handful "
            "of types, structs, fixed-size arrays, and a single builtin named "
            "<font face='Courier'>print</font>. That is enough to write real programs, to learn the "
            "ownership rules, and to see native code come out the other end."
        )
    )
    story.append(Paragraph(f"— {AUTHOR}, {YEAR}", st["quote"]))

    story.append(H1("Contents"))
    toc = [
        "1.  What Lyca is",
        "2.  Install the compiler",
        "3.  Your first program",
        "4.  Anatomy of a Lyca file",
        "5.  Types and literals",
        "6.  Variables and mutability",
        "7.  Functions",
        "8.  Control flow",
        "9.  Operators",
        "10. Structs",
        "11. Arrays",
        "12. Ownership and borrowing",
        "13. Printing and exit codes",
        "14. Worked programs",
        "15. Reading compiler errors",
        "16. What v0 cannot do yet",
        "17. A one-page cheatsheet",
        "About the author",
    ]
    for line in toc:
        story.append(Paragraph(line, st["toc_entry"]))
    story.append(Spacer(1, 0.2 * inch))
    story.append(PageBreak())

    story.append(H1("1. What Lyca is"))
    story.append(
        P(
            "Lyca is a compiled language. You write a <font face='Courier'>.lyca</font> file, run the "
            "compiler, and get a native executable. There is no REPL in v0 and no virtual machine. "
            "The pipeline is lexer, parser, type checker (including ownership), LLVM IR, then "
            "<font face='Courier'>clang</font>."
        )
    )
    story.append(
        P(
            "The design goal is a language that an LLM can draft correctly on the first try because "
            "the syntax is familiar, and that a human can trust because the type system refuses to "
            "guess. If two types do not match, the program does not compile. If a value was moved, "
            "you cannot use it again. If a condition is not a <font face='Courier'>bool</font>, it "
            "is not a condition."
        )
    )
    story.append(H2("What you will need"))
    story.append(
        bullets(
            [
                "Node.js 18 or newer, to run the compiler",
                "<font face='Courier'>clang</font> on your <font face='Courier'>PATH</font> (Apple Clang or LLVM Clang)",
                "A text editor that inserts spaces, not tabs",
            ],
            st,
        )
    )
    story.append(
        P(
            "<font face='Courier'>llc</font> is not required. Lyca writes a <font face='Courier'>.ll</font> "
            "file and asks <font face='Courier'>clang</font> to assemble and link it."
        )
    )

    story.append(H1("2. Install the compiler"))
    story.append(C(
        """git clone https://github.com/virajshoor/lyca.git
cd lyca
npm install
npm run build
npm test"""
    ))
    story.append(Paragraph("Clone, build, and run the test suite.", st["caption"]))
    story.append(
        P(
            "The CLI is <font face='Courier'>node dist/cli/index.js</font>. After a successful build "
            "you can also <font face='Courier'>npm link</font> and run <font face='Courier'>lyca</font> "
            "directly. Throughout this book the long form is used so the commands work from a fresh clone."
        )
    )
    story.append(C("node dist/cli/index.js --help"))
    story.append(
        P(
            "Expected usage is <font face='Courier'>lyca build &lt;file.lyca&gt; -o &lt;output&gt;</font>. "
            "That command writes LLVM IR to <font face='Courier'>output.ll</font> and a native binary "
            "to <font face='Courier'>output</font>."
        )
    )

    story.append(H1("3. Your first program"))
    story.append(
        P(
            "Create <font face='Courier'>hello.lyca</font>. Every Lyca program needs "
            "<font face='Courier'>def main() -&gt; i32</font>. The integer you return is the process "
            "exit code."
        )
    )
    story.append(C(
        """def main() -> i32:
    print("Hello, World!")
    return 0"""
    ))
    story.append(Paragraph("hello.lyca — the smallest useful Lyca program.", st["caption"]))
    story.append(C(
        """node dist/cli/index.js build hello.lyca -o hello
./hello"""
    ))
    story.append(
        P(
            "Stdout is <font face='Courier'>Hello, World!</font> followed by a newline. The exit "
            "code is <font face='Courier'>0</font>. Indentation must be spaces. Every function, "
            "including <font face='Courier'>main</font>, needs a return type. "
            "<font face='Courier'>print</font> is a builtin that takes a string (or a borrow of one) "
            "and writes it to stdout."
        )
    )
    story.append(H2("Fibonacci as an exit code"))
    story.append(
        P(
            "The bundled example <font face='Courier'>examples/fib.lyca</font> returns "
            "<font face='Courier'>fib(10)</font> from <font face='Courier'>main</font>. The process "
            "exit code is therefore 55 — a convenient way to check a small integer result without "
            "formatting numbers, which v0 cannot do yet."
        )
    )
    story.append(C(
        """def fib(n: i32) -> i32:
    if n <= 1:
        return n
    return fib(n - 1) + fib(n - 2)

def main() -> i32:
    return fib(10)"""
    ))
    story.append(C(
        """node dist/cli/index.js build examples/fib.lyca -o /tmp/fib
/tmp/fib
echo $?
# 55"""
    ))

    story.append(H1("4. Anatomy of a Lyca file"))
    story.append(
        P(
            "A program is a sequence of <font face='Courier'>struct</font> and "
            "<font face='Courier'>def</font> items. There is no top-level executable code. Execution "
            "starts at <font face='Courier'>main</font>. Comments run from "
            "<font face='Courier'>#</font> to the end of the line. Blocks are indentation-based: a "
            "colon that introduces a block must be followed by a newline and an indented body. "
            "Lyca has no <font face='Courier'>pass</font>; an empty block is an error."
        )
    )
    story.append(C(
        """# comments look like this

struct Pair:
    a: i32
    b: i32

def sum(p: Pair) -> i32:
    return p.a + p.b

def main() -> i32:
    let p: Pair = Pair { a: 3, b: 4 }
    return sum(p)"""
    ))
    story.append(
        P(
            "<font face='Courier'>sum</font> takes <font face='Courier'>Pair</font> by value, so "
            "<font face='Courier'>p</font> is moved into the call and cannot be used afterward. "
            "Chapter 12 covers that rule in full."
        )
    )

    story.append(H1("5. Types and literals"))
    story.append(
        P(
            "Every binding, parameter, and return value has an explicit type. The compiler does not "
            "infer function signatures. Integer and float literals take the type of their context; "
            "there is no other inference, and no implicit conversion between named types."
        )
    )
    story.append(C(
        """let a: i32 = 10
let b: i64 = 10          # the literal becomes i64 from context
let x: f64 = 1.5
let y: f32 = 1.5
let ok: bool = true
let s: string = "hi\\n"
let a3: [i32; 3] = [1, 2, 3]"""
    ))
    story.append(
        P(
            "Copy types can be used freely: <font face='Courier'>i32</font>, "
            "<font face='Courier'>i64</font>, <font face='Courier'>f32</font>, "
            "<font face='Courier'>f64</font>, <font face='Courier'>bool</font>, and "
            "<font face='Courier'>&amp;T</font>. Move types cannot: "
            "<font face='Courier'>string</font>, arrays, and structs. "
            "<font face='Courier'>[i32; 2]</font> and <font face='Courier'>[i32; 3]</font> are "
            "different types. User structs are nominal: two structs with the same fields are still "
            "different types."
        )
    )
    story.append(
        P(
            "String literals use double quotes. Legal escapes are <font face='Courier'>\\n</font>, "
            "<font face='Courier'>\\t</font>, <font face='Courier'>\\\\</font>, and "
            "<font face='Courier'>\\\"</font>. Strings cannot span lines."
        )
    )
    story.append(H2("No coercion"))
    story.append(
        P(
            "Mixing <font face='Courier'>i32</font> and <font face='Courier'>i64</font> is always "
            "an error. Returning <font face='Courier'>true</font> from "
            "<font face='Courier'>main</font> is a type mismatch. "
            "<font face='Courier'>if 1:</font> is illegal because only "
            "<font face='Courier'>bool</font> is a condition. There are no casts in v0. Pick one "
            "type and stay on it."
        )
    )

    story.append(H1("6. Variables and mutability"))
    story.append(
        P(
            "Every <font face='Courier'>let</font> needs a type annotation. Bindings are immutable "
            "unless you write <font face='Courier'>let mut</font>. Assignment to a plain "
            "<font face='Courier'>let</font> is <font face='Courier'>LYC217</font>."
        )
    )
    story.append(C(
        """def main() -> i32:
    let x: i32 = 1
    let mut y: i32 = 2
    y = y + 1
    return x + y"""
    ))
    story.append(
        P(
            "There is no <font face='Courier'>+=</font>. Write <font face='Courier'>y = y + 1</font>. "
            "You also cannot mutate a value while a borrow of it is live; that is "
            "<font face='Courier'>LYC220</font>."
        )
    )

    story.append(H1("7. Functions"))
    story.append(
        P(
            "Parameter types and the return type are mandatory. Recursion is allowed. There are no "
            "methods, no closures, and no first-class function values in v0. Call syntax is "
            "<font face='Courier'>name(args)</font>."
        )
    )
    story.append(C(
        """def add(a: i32, b: i32) -> i32:
    return a + b

def abs(x: i32) -> i32:
    if x < 0:
        return -x
    return x"""
    ))
    story.append(
        P(
            "Every path through a function must <font face='Courier'>return</font> a value "
            "(<font face='Courier'>LYC208</font>). An <font face='Courier'>if</font> without "
            "<font face='Courier'>else</font> does not cover the rest of the function, which is why "
            "<font face='Courier'>abs</font> still needs a <font face='Courier'>return x</font> after "
            "the <font face='Courier'>if</font>."
        )
    )
    story.append(H2("main is special"))
    story.append(
        P(
            "<font face='Courier'>main</font> takes no parameters and must return "
            "<font face='Courier'>i32</font>. Missing <font face='Courier'>main</font> is "
            "<font face='Courier'>LYC214</font>. A <font face='Courier'>main</font> with parameters "
            "or a non-<font face='Courier'>i32</font> return is <font face='Courier'>LYC215</font>. "
            "On Unix the shell only reports exit codes 0 through 255, so return small integers from "
            "<font face='Courier'>main</font> or print a message and return 0."
        )
    )

    story.append(H1("8. Control flow"))
    story.append(H2("if / elif / else"))
    story.append(
        P(
            "The condition must be <font face='Courier'>bool</font>. There is no truthiness. "
            "Comparisons do not chain: <font face='Courier'>0 &lt; n &lt; 10</font> is a type error "
            "because <font face='Courier'>(0 &lt; n)</font> is <font face='Courier'>bool</font>. "
            "Write <font face='Courier'>n &gt; 0 and n &lt; 10</font>."
        )
    )
    story.append(C(
        """if n == 0:
    return 1
elif n == 1:
    return 2
else:
    return 3"""
    ))
    story.append(H2("while"))
    story.append(C(
        """let mut i: i32 = 0
while i < 10:
    i = i + 1"""
    ))
    story.append(H2("for-range"))
    story.append(
        P(
            "<font face='Courier'>for name in start..end:</font> iterates "
            "<font face='Courier'>i32</font> values in the half-open interval "
            "<font face='Courier'>[start, end)</font>. The name is an immutable "
            "<font face='Courier'>i32</font> local for the loop body. There is no "
            "<font face='Courier'>break</font> or <font face='Courier'>continue</font> in v0."
        )
    )
    story.append(C(
        """let mut s: i32 = 0
for i in 0..4:
    s = s + i
# s == 6"""
    ))

    story.append(H1("9. Operators"))
    story.append(
        P(
            "Arithmetic requires the same numeric type on both sides: "
            "<font face='Courier'>+ - * / %</font>. Remainder is integer-only. Comparison: "
            "<font face='Courier'>== != &lt; &gt; &lt;= &gt;=</font>. Ordering is for numbers; "
            "equality also works on <font face='Courier'>bool</font>. Boolean operators are "
            "<font face='Courier'>and</font>, <font face='Courier'>or</font>, and "
            "<font face='Courier'>not</font>, with short-circuit <font face='Courier'>and</font> / "
            "<font face='Courier'>or</font>. Unary <font face='Courier'>-</font> negates numbers."
        )
    )
    story.append(
        P(
            "There is no <font face='Courier'>+</font> for strings and there are no bitwise operators. "
            "To borrow a local, write <font face='Courier'>&amp;x</font> where "
            "<font face='Courier'>x</font> is a variable name."
        )
    )

    story.append(H1("10. Structs"))
    story.append(
        P(
            "Structs are records. No methods, no inheritance, no <font face='Courier'>self</font>. "
            "Field order in a literal does not have to match the definition; every field must appear "
            "exactly once."
        )
    )
    story.append(C(
        """struct Point:
    x: i32
    y: i32

def origin() -> Point:
    return Point { x: 0, y: 0 }

def main() -> i32:
    let mut p: Point = origin()
    p.x = p.x + 1
    return p.x"""
    ))
    story.append(
        P(
            "Reading a Copy field such as <font face='Courier'>p.x</font> does not move "
            "<font face='Courier'>p</font>. Reading a move field marks the whole struct as moved. "
            "You cannot write <font face='Courier'>&amp;p.x</font> in v0; borrow the whole local, "
            "or copy a Copy field out."
        )
    )
    story.append(H2("Pass by borrow to keep the value"))
    story.append(C(
        """struct Pair:
    a: i32
    b: i32

def sum(p: &Pair) -> i32:
    return p.a + p.b

def main() -> i32:
    let p: Pair = Pair { a: 3, b: 4 }
    let s: i32 = sum(&p)
    return s + p.a"""
    ))
    story.append(Paragraph("Exit code 10. p stays alive after sum(&amp;p).", st["caption"]))

    story.append(H1("11. Arrays"))
    story.append(
        P(
            "Arrays have a fixed length that is part of the type. The index expression must be "
            "<font face='Courier'>i32</font>. There are no slices in v0."
        )
    )
    story.append(C(
        """def main() -> i32:
    let mut a: [i32; 4] = [1, 2, 3, 4]
    a[0] = 10
    let mut s: i32 = 0
    for i in 0..4:
        s = s + a[i]
    return s"""
    ))
    story.append(Paragraph("Exit code 19. Indexing Copy elements does not move the array.", st["caption"]))

    story.append(H1("12. Ownership and borrowing"))
    story.append(
        P(
            "This is the part that is not Python. Copy types can be assigned and passed without "
            "invalidating the source. Move types are moved on use as a value."
        )
    )
    story.append(C(
        """let a: i32 = 1
let b: i32 = a           # a is still usable

let s: string = "hi"
let t: string = s        # s is moved; using s is LYC218"""
    ))
    story.append(
        P(
            "Borrow instead of moving. <font face='Courier'>&amp;T</font> is a shared, immutable "
            "borrow. <font face='Courier'>&amp;x</font> is only legal when "
            "<font face='Courier'>x</font> is a variable name."
        )
    )
    story.append(C(
        """def main() -> i32:
    let s: string = "hi"
    let r: &string = &s
    print(r)
    print(s)             # still valid
    return 0"""
    ))
    story.append(H2("The five rules"))
    story.append(
        bullets(
            [
                "<b>No use after move.</b> Once a move-type binding is moved, any use is LYC218.",
                "<b>No borrow after move.</b> <font face='Courier'>&amp;s</font> after a move is LYC223.",
                "<b>No move while borrowed.</b> If a live <font face='Courier'>&amp;T</font> points at s, moving s is LYC219.",
                "<b>No mutate while borrowed.</b> Assigning to s while borrowed is LYC220.",
                "<b>Immutability.</b> <font face='Courier'>let x</font> cannot be assigned; <font face='Courier'>let mut x</font> can, subject to the previous rule.",
            ],
            st,
        )
    )
    story.append(
        P(
            "v0 does not do non-lexical lifetimes. A borrow created by "
            "<font face='Courier'>let r: &amp;T = &amp;s</font> lasts until "
            "<font face='Courier'>r</font> goes out of scope — the end of the current indented block "
            "— not until last use. Temporary borrows at a call site last for that statement only. "
            "There is no <font face='Courier'>&amp;mut T</font>; mutation goes through the owned "
            "<font face='Courier'>let mut</font> binding when no borrows are live."
        )
    )
    story.append(C(
        """def main() -> i32:
    let mut s: string = "a"
    if true:
        let r: &string = &s
        print(r)
        # s = "b"        # LYC220, r is still in scope
    s = "b"              # ok, r is gone
    print(s)
    return 0"""
    ))
    story.append(
        P(
            "Do not return <font face='Courier'>&amp;T</font> from user functions in v0. The only "
            "safe borrows to return would have to outlive the function; v0 has no such globals besides "
            "string literals. The v0 checker uses conservative lexical lifetime rules; it is not a full Rust lifetime system."
        )
    )
    story.append(H2("print does not consume"))
    story.append(
        P(
            "<font face='Courier'>print</font> takes <font face='Courier'>&amp;string</font>. If you "
            "pass an owned <font face='Courier'>string</font>, the compiler inserts a borrow for that "
            "statement. That is why you can print the same string twice."
        )
    )
    story.append(C(
        """def main() -> i32:
    let s: string = "ok"
    print(s)
    print(s)
    return 0"""
    ))

    story.append(H1("13. Printing and exit codes"))
    story.append(
        P(
            "The only builtin is <font face='Courier'>def print(s: &amp;string) -&gt; i32</font>. It "
            "writes <font face='Courier'>s</font> plus a newline through the native runtime and returns 0 on success. You cannot "
            "<font face='Courier'>print(n)</font> for an integer. There is no "
            "<font face='Courier'>str(n)</font> and no string concatenation."
        )
    )
    story.append(
        P(
            "Two patterns cover v0 I/O. For a small integer result, return it from "
            "<font face='Courier'>main</font> and inspect <font face='Courier'>$?</font>. For a "
            "human-readable result, print a literal and return 0."
        )
    )

    story.append(H1("14. Worked programs"))
    story.append(
        P(
            "Each program below is complete. Compile with "
            "<font face='Courier'>node dist/cli/index.js build file.lyca -o /tmp/out</font> and run "
            "<font face='Courier'>/tmp/out</font>."
        )
    )
    story.append(H2("Factorial"))
    story.append(C(
        """def fact(n: i32) -> i32:
    let mut acc: i32 = 1
    let mut i: i32 = 1
    while i <= n:
        acc = acc * i
        i = i + 1
    return acc

def main() -> i32:
    return fact(5)"""
    ))
    story.append(Paragraph("Exit code 120.", st["caption"]))
    story.append(H2("Sum a range"))
    story.append(C(
        """def main() -> i32:
    let mut s: i32 = 0
    for i in 0..10:
        s = s + i
    return s"""
    ))
    story.append(Paragraph("Exit code 45. The range 0..10 yields 0 through 9.", st["caption"]))
    story.append(H2("GCD"))
    story.append(C(
        """def gcd(a: i32, b: i32) -> i32:
    let mut x: i32 = a
    let mut y: i32 = b
    while y != 0:
        let t: i32 = y
        y = x % y
        x = t
    return x

def main() -> i32:
    return gcd(48, 18)"""
    ))
    story.append(Paragraph("Exit code 6.", st["caption"]))
    story.append(H2("Manhattan distance"))
    story.append(C(
        """struct Point:
    x: i32
    y: i32

def manhattan(p: Point) -> i32:
    let mut ax: i32 = p.x
    if ax < 0:
        ax = -ax
    let mut ay: i32 = p.y
    if ay < 0:
        ay = -ay
    return ax + ay

def main() -> i32:
    let p: Point = Point { x: 3, y: -4 }
    return manhattan(p)"""
    ))
    story.append(Paragraph("Exit code 7. manhattan takes Point by value, so p is moved.", st["caption"]))
    story.append(H2("FizzBuzz of one number"))
    story.append(C(
        """def fizzbuzz(n: i32) -> i32:
    if n % 15 == 0:
        print("FizzBuzz")
        return 0
    if n % 3 == 0:
        print("Fizz")
        return 0
    if n % 5 == 0:
        print("Buzz")
        return 0
    print("plain")
    return n

def main() -> i32:
    return fizzbuzz(15)"""
    ))
    story.append(Paragraph('Prints "FizzBuzz" and exits 0.', st["caption"]))
    story.append(H2("Powers of two by recursion"))
    story.append(C(
        """def pow2(n: i32) -> i32:
    if n == 0:
        return 1
    return 2 * pow2(n - 1)

def main() -> i32:
    return pow2(3)"""
    ))
    story.append(
        Paragraph(
            "Exit code 8. Recursion is legal. Prefer a loop when you are accumulating; v0 has no tail-call guarantee.",
            st["caption"],
        )
    )

    story.append(H1("15. Reading compiler errors"))
    story.append(
        P(
            "Every diagnostic has a code <font face='Courier'>LYCnnn</font>, a message, a "
            "<font face='Courier'>file:line:col</font> span, the source line, a caret, and sometimes "
            "a hint. There are no warnings in v0; anything the compiler prints is fatal. If type "
            "checking fails, nothing is written."
        )
    )
    story.append(C(
        """error[LYC207]: type mismatch: expected i32, found bool
 --> hello.lyca:2:12
  |
2 |     return true
  |            ^^^^
  |
  = hint: Lyca does not coerce types"""
    ))
    story.append(
        P(
            "Fix the source at that location and rebuild. Common codes while you learn: "
            "<font face='Courier'>LYC003</font> tab character, <font face='Courier'>LYC207</font> "
            "type mismatch, <font face='Courier'>LYC208</font> missing return, "
            "<font face='Courier'>LYC217</font> assign to immutable "
            "<font face='Courier'>let</font>, <font face='Courier'>LYC218</font> use after move, "
            "<font face='Courier'>LYC220</font> mutate while borrowed. The full list lives in "
            "<font face='Courier'>docs/error-reference.md</font>."
        )
    )

    story.append(H1("16. What v0 cannot do yet"))
    story.append(
        P(
            "If you are arriving from Python or JavaScript, these are the gaps that surprise people. "
            "They are not bugs; they are the current language."
        )
    )
    story.append(
        bullets(
            [
                "No printing of integers: <font face='Courier'>print</font> is <font face='Courier'>&amp;string</font> only.",
                "No string concatenation and no interpolating strings.",
                "No chained comparisons, no truthiness, no <font face='Courier'>pass</font>.",
                "No <font face='Courier'>break</font> or <font face='Courier'>continue</font>.",
                "No mixing integer widths, no casts.",
                "No methods, classes, inheritance, or first-class functions.",
                "No Lyca modules, Lyca imports, or multi-file programs; typed Python declarations are optional.",
                "No heap types, slices, generics, or <font face='Courier'>&amp;mut T</font>.",
                "No REPL.",
            ],
            st,
        )
    )
    story.append(
        P(
            "The native ownership rules exist so heap types can be added later without a garbage collector. "
            "String literals live in static storage; the type system still treats "
            "<font face='Courier'>string</font> as move-only so the same rules will apply when heap "
            "strings exist. Structs and arrays are stack-allocated and copied or moved as whole values."
        )
    )

    story.append(H1("17. A one-page cheatsheet"))
    story.append(C(
        """# build
node dist/cli/index.js build file.lyca -o out

# skeleton
def main() -> i32:
    print("hello")
    return 0

# bindings
let x: i32 = 1
let mut y: i32 = 2
y = y + 1

# types
i32 i64 f32 f64 bool string [T; N] StructName &T

# control
if cond: ... elif cond: ... else: ...
while cond: ...
for i in start..end: ...     # half-open i32 range

# operators
+ - * / %    == != < > <= >=    and or not    -x    &x

# ownership
# Copy:  i32 i64 f32 f64 bool &T
# Move:  string, arrays, structs
print(s)                     # borrows, does not move
let t: string = s            # moves s"""
    ))

    story.append(PageBreak())
    story.append(H1("About the author"))
    story.append(
        P(
            f"<b>{AUTHOR}</b> designed Lyca and wrote this book. The language, the compiler, "
            "the documentation, and the examples in this repository are his work. Lyca is released "
            f"under the MIT License. Copyright (c) {YEAR} {AUTHOR}."
        )
    )
    story.append(
        P(
            "The source lives at <font face='Courier'>https://github.com/virajshoor/lyca</font>. "
            "Bug reports and small patches are welcome. Read the language tour and error reference "
            "before sending a change; tests live in <font face='Courier'>tests/</font> and should "
            "cover both a valid program and the diagnostic you care about."
        )
    )
    story.append(Spacer(1, 0.35 * inch))
    story.append(Paragraph(f"{TITLE}", st["h2"]))
    story.append(Paragraph(f"Written by {AUTHOR}", st["body_left"]))
    story.append(Paragraph(f"Lyca v0  ·  {YEAR}", st["body_left"]))
    return story


def main() -> None:
    parser = argparse.ArgumentParser(description=f"Build '{TITLE}' by {AUTHOR}")
    parser.add_argument(
        "-o",
        "--output",
        default=str(Path(__file__).resolve().parent.parent / "docs" / "book" / "coding-in-lyca.pdf"),
        help="Output PDF path",
    )
    args = parser.parse_args()
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)

    st = styles()
    page = letter
    margin = 0.75 * inch
    cover_frame = Frame(0.9 * inch, 1.7 * inch, page[0] - 1.65 * inch, page[1] - 2.6 * inch, id="cover")
    body_frame = Frame(margin, 0.7 * inch, page[0] - 2 * margin, page[1] - 1.45 * inch, id="body")
    doc = BaseDocTemplate(
        str(out),
        pagesize=page,
        title=TITLE,
        author=AUTHOR,
        creator=f"{TITLE} · {AUTHOR}",
        subject=SUBTITLE,
    )
    doc.addPageTemplates(
        [
            PageTemplate(id="cover", frames=[cover_frame], onPage=draw_cover),
            PageTemplate(id="body", frames=[body_frame], onPage=draw_body),
        ]
    )
    doc.build(build_story(st))
    print(f"Wrote {out} ({out.stat().st_size} bytes) by {AUTHOR}")


if __name__ == "__main__":
    main()
