import { describe, test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAgentFrontmatter } from "./frontmatter.ts";

const AGENTS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".claude",
  "agents",
);

describe("parseAgentFrontmatter (real .claude/agents/*.md)", () => {
  test("baseline-collector.md parses with expected tools list", async () => {
    const md = await readFile(`${AGENTS_DIR}/baseline-collector.md`, "utf8");
    const fm = parseAgentFrontmatter(md);
    expect(fm.name).toBe("baseline-collector");
    expect(fm.tools).toEqual(["Bash", "Read", "Grep"]);
    expect(fm.model).toBeUndefined();
    // systemPrompt body should start with the H1 of the agent file.
    expect(fm.systemPrompt.split("\n")[0]).toBe("# Baseline Collector");
    // description is non-trivial prose, not empty.
    expect(fm.description.length).toBeGreaterThan(50);
  });

  test("keyboard-walker.md parses", async () => {
    const md = await readFile(`${AGENTS_DIR}/keyboard-walker.md`, "utf8");
    const fm = parseAgentFrontmatter(md);
    expect(fm.name).toBe("keyboard-walker");
    expect(fm.tools).toEqual(["Bash", "Read", "Grep"]);
    expect(fm.systemPrompt.startsWith("# Keyboard Walker")).toBe(true);
  });

  test("visual-cross-referencer.md parses", async () => {
    const md = await readFile(`${AGENTS_DIR}/visual-cross-referencer.md`, "utf8");
    const fm = parseAgentFrontmatter(md);
    expect(fm.name).toBe("visual-cross-referencer");
    expect(fm.tools).toEqual(["Bash", "Read", "Grep"]);
    expect(fm.systemPrompt.startsWith("# Visual Cross-Referencer")).toBe(true);
  });
});

describe("parseAgentFrontmatter error paths", () => {
  test("throws when leading '---' is missing", () => {
    expect(() => parseAgentFrontmatter("no frontmatter here\n")).toThrow(/missing leading '---'/);
  });

  test("throws when closing '---' is missing", () => {
    expect(() => parseAgentFrontmatter("---\nname: x\n")).toThrow(/missing closing '---'/);
  });

  test("throws when required keys are absent", () => {
    expect(() => parseAgentFrontmatter("---\nname: x\n---\nbody\n")).toThrow(
      /missing 'description'/,
    );
  });

  test("picks up optional model override", () => {
    const fm = parseAgentFrontmatter(
      "---\nname: n\ndescription: d\nmodel: claude-sonnet-4-5-20250929\n---\nbody\n",
    );
    expect(fm.model).toBe("claude-sonnet-4-5-20250929");
  });

  test("tools default to empty when field absent", () => {
    const fm = parseAgentFrontmatter("---\nname: n\ndescription: d\n---\nbody\n");
    expect(fm.tools).toEqual([]);
  });
});
