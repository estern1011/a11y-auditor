import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Minimal YAML-subset frontmatter parser used by the runner to hand the same
// .claude/agents/<id>.md files to the Agent SDK that the Claude Code skill
// already reads. We only support the shape these agent files actually use
// today:
//   - a leading `---` line
//   - one `key: value` per line (no multi-line scalars, no lists, no nesting)
//   - a trailing `---` line
//   - anything after is the prose body (the agent's system prompt)
//
// Anything richer (anchors, block scalars, JSON flow) would be over-engineering
// for three hand-authored markdown files. If we ever need it we can pull in a
// real YAML parser.

export interface AgentFrontmatter {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
}

export interface ParsedAgentFile {
  frontmatter: AgentFrontmatter;
  systemPrompt: string;
}

const AGENTS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".claude",
  "agents",
);

export function agentPath(agentId: string): string {
  return resolve(AGENTS_DIR, `${agentId}.md`);
}

export function parseAgentFile(raw: string): ParsedAgentFile {
  // Normalize CRLF to LF so splitting is predictable on all hosts.
  const text = raw.replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) {
    throw new Error("agent file is missing leading '---' frontmatter fence");
  }

  const rest = text.slice(4);
  const closeIdx = rest.indexOf("\n---\n");
  if (closeIdx === -1) {
    throw new Error("agent file is missing closing '---' frontmatter fence");
  }

  const frontmatterBlock = rest.slice(0, closeIdx);
  const body = rest.slice(closeIdx + "\n---\n".length).replace(/^\n+/, "");

  // Known frontmatter keys the runner honors. Anything else (e.g. a typo
  // like `toools:`) is silently accepted as-is by a permissive parser, and
  // the derived `frontmatter.tools` ends up undefined — which then causes
  // runAgent to fall back to the full `claude_code` preset tool set instead
  // of the allowlist the agent file intended. That's a permission widening
  // we want to fail fast on, not quietly accept.
  const KNOWN_KEYS = new Set(["name", "description", "tools", "model"]);

  const fields: Record<string, string> = {};
  for (const line of frontmatterBlock.split("\n")) {
    if (!line.trim()) continue;
    const idx = line.indexOf(":");
    if (idx === -1) {
      throw new Error(`agent frontmatter line missing ':': ${line}`);
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!KNOWN_KEYS.has(key)) {
      throw new Error(
        `agent frontmatter has unknown key '${key}' — expected one of ${[...KNOWN_KEYS].join(", ")}. Did you mean 'tools'? A typo here silently widens agent tool permissions.`,
      );
    }
    fields[key] = value;
  }

  if (!fields.name) throw new Error("agent frontmatter missing required 'name'");
  if (!fields.description) {
    throw new Error("agent frontmatter missing required 'description'");
  }

  const tools = fields.tools
    ? fields.tools
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : undefined;

  return {
    frontmatter: {
      name: fields.name,
      description: fields.description,
      tools,
      model: fields.model || undefined,
    },
    systemPrompt: body,
  };
}

export async function loadAgentFile(agentId: string): Promise<ParsedAgentFile> {
  const raw = await readFile(agentPath(agentId), "utf8");
  return parseAgentFile(raw);
}
