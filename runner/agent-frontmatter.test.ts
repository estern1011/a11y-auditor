import { describe, test, expect } from "bun:test";
import { readFile } from "node:fs/promises";

import { agentPath, loadAgentFile, parseAgentFile } from "./agent-frontmatter.ts";

// Each of the three agent files authored in .claude/agents/ must parse
// without mutation — the runner is a strict second consumer of the same
// frontmatter the Claude Code skill reads, and any divergence would manifest
// as "runner sees different tools than the skill does" bugs.
const REAL_AGENTS = [
  "baseline-collector",
  "keyboard-walker",
  "visual-cross-referencer",
] as const;

describe("parseAgentFile — real agent files", () => {
  for (const agentId of REAL_AGENTS) {
    test(`parses ${agentId}.md without mutation`, async () => {
      const raw = await readFile(agentPath(agentId), "utf8");
      const parsed = parseAgentFile(raw);

      expect(parsed.frontmatter.name).toBe(agentId);
      expect(parsed.frontmatter.description.length).toBeGreaterThan(40);
      expect(parsed.frontmatter.tools).toEqual(["Bash", "Read", "Grep"]);
      // None of the three agent .md files declare `model:` today; default is
      // applied in runAgent. Confirm we surfaced undefined, not an empty string.
      expect(parsed.frontmatter.model).toBeUndefined();

      // System prompt body must be the markdown after the fence — sanity-check
      // the presence of a recognizable heading so we know we're not swallowing
      // the body into the frontmatter block.
      expect(parsed.systemPrompt).toMatch(/^#\s/);
    });
  }
});

describe("loadAgentFile", () => {
  test("resolves real agent files regardless of cwd", async () => {
    const prevCwd = process.cwd();
    try {
      process.chdir("/tmp");
      const parsed = await loadAgentFile("baseline-collector");
      expect(parsed.frontmatter.name).toBe("baseline-collector");
    } finally {
      process.chdir(prevCwd);
    }
  });
});

describe("parseAgentFile — edge cases", () => {
  test("parses model when present", () => {
    const raw = [
      "---",
      "name: test",
      "description: a test agent",
      "tools: Bash, Read",
      "model: claude-sonnet-4-5",
      "---",
      "",
      "# Body",
      "prompt text",
      "",
    ].join("\n");
    const p = parseAgentFile(raw);
    expect(p.frontmatter.model).toBe("claude-sonnet-4-5");
    expect(p.frontmatter.tools).toEqual(["Bash", "Read"]);
  });

  test("trims whitespace inside comma-separated tools", () => {
    const raw = [
      "---",
      "name: t",
      "description: d",
      "tools: Bash,   Read ,Grep",
      "---",
      "body",
      "",
    ].join("\n");
    const p = parseAgentFile(raw);
    expect(p.frontmatter.tools).toEqual(["Bash", "Read", "Grep"]);
  });

  test("omits tools field when absent", () => {
    const raw = ["---", "name: t", "description: d", "---", "body", ""].join("\n");
    expect(parseAgentFile(raw).frontmatter.tools).toBeUndefined();
  });

  test("throws on missing leading fence", () => {
    expect(() => parseAgentFile("name: t\n---\nbody\n")).toThrow(/leading '---'/);
  });

  test("throws on missing closing fence", () => {
    expect(() => parseAgentFile("---\nname: t\ndescription: d\nbody\n")).toThrow(
      /closing '---'/,
    );
  });

  test("throws on frontmatter line missing ':'", () => {
    const raw = ["---", "name: t", "description: d", "malformed_line", "---", "b", ""].join("\n");
    expect(() => parseAgentFile(raw)).toThrow(/missing ':'/);
  });

  test("throws when required 'name' missing", () => {
    const raw = ["---", "description: d", "---", "b", ""].join("\n");
    expect(() => parseAgentFile(raw)).toThrow(/missing required 'name'/);
  });

  test("throws when required 'description' missing", () => {
    const raw = ["---", "name: t", "---", "b", ""].join("\n");
    expect(() => parseAgentFile(raw)).toThrow(/missing required 'description'/);
  });

  test("rejects unknown frontmatter keys (permission-widening typos)", () => {
    // Regression: a silent accept of `toools:` would leave
    // `frontmatter.tools` undefined and let runAgent fall back to the
    // full claude_code preset — the opposite of what the agent author
    // intended. Codex P2 on the initial review insisted on loud-failing
    // unknown keys so the typo surfaces before we ship a tool-permission
    // drift to production.
    const raw = [
      "---",
      "name: t",
      "description: d",
      "toools: Bash, Read",
      "---",
      "body",
      "",
    ].join("\n");
    let caught: Error | undefined;
    try {
      parseAgentFile(raw);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toMatch(/unknown key 'toools'/);
    expect(caught?.message).toMatch(/widens agent tool permissions/);
  });
});
