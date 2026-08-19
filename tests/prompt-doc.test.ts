import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compile";

// Every ```lyca block in prompt.md must be a complete, compilable program.
// Write intentionally-invalid snippets as commented-out lines inside a valid
// program, or as inline code, so this invariant keeps holding.
const md = readFileSync("prompt.md", "utf8");
const blocks = [...md.matchAll(/^```lyca\n([\s\S]*?)^```/gm)].map((m) => m[1]!);

describe("prompt.md examples", () => {
  it("contains lyca examples", () => {
    expect(blocks.length).toBeGreaterThan(5);
  });

  for (const [i, src] of blocks.entries()) {
    it(`example ${i + 1} compiles`, () => {
      expect(() => compileSource(src, `prompt.md:block-${i + 1}`)).not.toThrow();
    });
  }
});
