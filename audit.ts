#!/usr/bin/env bun
/**
 * Automated accessibility checker.
 *
 * Core: runAxeAudit() takes a Playwright Page and runs axe-core + a11y tree.
 * Used by vo-server's /audit endpoint (same process, no CDP issues).
 *
 * CLI: thin wrapper that hits vo-driver's /audit HTTP endpoint.
 *
 * Usage:
 *   bun audit.ts [selector] [options]
 *   bun audit.ts ".modal-dialog"
 *   bun audit.ts --tags wcag2a,wcag2aa
 *   bun audit.ts --port 7483 "form#checkout"
 */

import type { Page } from "playwright";
import type { Result } from "axe-core";
import AxeBuilder from "@axe-core/playwright";
import { DEFAULT_PORT, CLI_TIMEOUT_MS } from "./vo-core.ts";

// ---------------------------------------------------------------------------
// Audit options
// ---------------------------------------------------------------------------

export interface AuditOptions {
  selector?: string;
  tags?: string[];
  rules?: string[];
  disableRules?: string[];
  includeTree?: boolean;
}

export interface AuditResult {
  url: string;
  selector: string;
  axe: {
    violations: ReturnType<typeof formatResult>[];
    incomplete: ReturnType<typeof formatResult>[];
    passes: number;
    inapplicable: number;
  };
  tree?: string;
}

// ---------------------------------------------------------------------------
// Core audit — runs in-process with vo-driver's Page
// ---------------------------------------------------------------------------

export async function runAxeAudit(page: Page, options: AuditOptions = {}): Promise<AuditResult> {
  const { selector, tags = [], rules = [], disableRules = [], includeTree = true } = options;

  let builder = new AxeBuilder({ page });

  if (selector) builder = builder.include(selector);
  if (tags.length > 0) builder = builder.withTags(tags);
  if (rules.length > 0) builder = builder.withRules(rules);
  if (disableRules.length > 0) builder = builder.disableRules(disableRules);

  const results = await builder.analyze();

  const output: AuditResult = {
    url: page.url(),
    selector: selector || "(full page)",
    axe: {
      violations: results.violations.map(formatResult),
      incomplete: results.incomplete.map(formatResult),
      passes: results.passes.length,
      inapplicable: results.inapplicable.length,
    },
  };

  if (includeTree) {
    if (selector) {
      output.tree = await page.locator(selector).ariaSnapshot({ mode: "ai" });
    } else {
      output.tree = await page.ariaSnapshot({ mode: "ai" });
    }
  }

  return output;
}

// ---------------------------------------------------------------------------
// Format axe results for agent consumption
// ---------------------------------------------------------------------------

function formatResult(r: Result) {
  return {
    id: r.id,
    impact: r.impact ?? undefined,
    description: r.description,
    help: r.help,
    helpUrl: r.helpUrl,
    wcag: r.tags.filter((t) => t.startsWith("wcag") || t.startsWith("best-practice")),
    nodes: r.nodes.map((n) => ({
      html: n.html,
      target: n.target,
      failureSummary: n.failureSummary,
    })),
  };
}

// ---------------------------------------------------------------------------
// CLI — hits vo-driver's /audit HTTP endpoint
// ---------------------------------------------------------------------------

const USAGE = `Usage: bun audit.ts [selector] [options]

Arguments:
  selector              CSS selector to scope the audit (default: full page)

Options:
  --port <port>         vo-driver HTTP port (default: ${DEFAULT_PORT})
  --tags <tags>         Comma-separated axe tags (e.g. wcag2a,wcag2aa,best-practice)
  --rules <rules>       Comma-separated axe rules to run
  --disable <rules>     Comma-separated axe rules to skip
  --no-tree             Skip accessibility tree snapshot
  --help                Show this help`;

if (import.meta.main) {
  const args = process.argv.slice(2);
  let port = DEFAULT_PORT;
  let selector: string | undefined;
  let tags: string[] = [];
  let rules: string[] = [];
  let disableRules: string[] = [];
  let includeTree = true;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--port":
        port = parseInt(args[++i], 10);
        break;
      case "--tags":
        tags = args[++i].split(",");
        break;
      case "--rules":
        rules = args[++i].split(",");
        break;
      case "--disable":
        disableRules = args[++i].split(",");
        break;
      case "--no-tree":
        includeTree = false;
        break;
      case "--help":
      case "-h":
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        if (!args[i].startsWith("--") && !selector) {
          selector = args[i];
        }
    }
  }

  const body: AuditOptions = {};
  if (selector) body.selector = selector;
  if (tags.length > 0) body.tags = tags;
  if (rules.length > 0) body.rules = rules;
  if (disableRules.length > 0) body.disableRules = disableRules;
  if (!includeTree) body.includeTree = false;

  const base = `http://127.0.0.1:${port}`;
  try {
    const r = await fetch(`${base}/audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CLI_TIMEOUT_MS),
    });
    const d: Record<string, unknown> = await r.json();
    if (!r.ok) {
      console.error(`Error: ${typeof d.error === "string" ? d.error : r.statusText}`);
      process.exit(1);
    }
    console.log(JSON.stringify(d, null, 2));
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
