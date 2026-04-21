import { readFile } from "node:fs/promises";

export interface AgentFrontmatter {
  name: string;
  description: string;
  /** Tool names parsed from the comma-separated `tools:` field. Empty array means the field was absent. */
  tools: string[];
  /** Optional model override; when absent the runner falls back to its default. */
  model?: string;
  /** Everything after the closing `---`, i.e. the agent's system prompt. */
  systemPrompt: string;
}

const FRONTMATTER_DELIMITER = "---";

// Minimal YAML-subset parser that handles the shape the Claude Code agent .md
// files use: top-level scalars (`key: value`), plus a comma-separated `tools`
// list. We intentionally don't pull in a full YAML library — the frontmatter is
// authored by humans who already follow this shape, and a loose parser would
// silently accept invalid frontmatter we'd rather reject.
export function parseAgentFrontmatter(source: string): AgentFrontmatter {
  if (!source.startsWith(FRONTMATTER_DELIMITER)) {
    throw new Error("agent file missing leading '---' frontmatter delimiter");
  }

  // Find the closing delimiter. We look for a line that is exactly `---` so a
  // stray `---` inside a description string doesn't confuse us.
  const lines = source.split("\n");
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === FRONTMATTER_DELIMITER) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    throw new Error("agent file missing closing '---' frontmatter delimiter");
  }

  const fm: Record<string, string> = {};
  for (let i = 1; i < closeIdx; i++) {
    const line = lines[i];
    if (!line || /^\s*$/.test(line)) continue;
    const sep = line.indexOf(":");
    if (sep === -1) {
      throw new Error(`frontmatter line missing ':': ${line}`);
    }
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    fm[key] = value;
  }

  const name = fm.name;
  const description = fm.description;
  if (!name) throw new Error("agent frontmatter missing 'name'");
  if (!description) throw new Error("agent frontmatter missing 'description'");

  const tools = fm.tools
    ? fm.tools
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
    : [];

  const model = fm.model && fm.model.length > 0 ? fm.model : undefined;

  // Everything after the closing `---` and the optional blank line is the body
  // the agent receives as its system prompt. We keep the original newlines so
  // the prompt reads identically to the on-disk file.
  const body = lines
    .slice(closeIdx + 1)
    .join("\n")
    .replace(/^\n+/, "");

  return { name, description, tools, model, systemPrompt: body };
}

export async function readAgentFrontmatter(path: string): Promise<AgentFrontmatter> {
  const raw = await readFile(path, "utf8");
  return parseAgentFrontmatter(raw);
}
