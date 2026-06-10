/**
 * Automated accessibility checker — axe-core injection.
 *
 * Used by the daemon's /audit endpoint. Same-process Playwright Page; no
 * cross-CDP-channel issues. Returns axe violations + incomplete + counts
 * plus an optional aria-snapshot of the scoped tree.
 *
 * Methodology (which axe rules to run, how to triage incompletes, WCAG
 * taxonomy) is intentionally NOT here — that's the orchestrator's job.
 */

import type { Page } from "playwright";
import type { Result } from "axe-core";
import { AxeBuilder } from "@axe-core/playwright";

// Volume caps. axe doesn't bound the size of node.html on its own — for a
// page that puts megabytes of inline SVG, a single violating node can balloon
// the response. Same for the aria-snapshot tree on a large SPA. Truncating
// here keeps any one /audit response bounded so a hostile/runaway page can't
// wedge an orchestrator that streams JSON into a fixed buffer.
const MAX_NODE_HTML = 2_000;     // chars per axe node.html
const MAX_TREE_CHARS = 200_000;  // chars for the aria-snapshot tree

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) + `… [truncated, ${value.length - max} chars elided]` : value;
}

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
    const tree = selector
      ? await page.locator(selector).ariaSnapshot({ mode: "ai" })
      : await page.ariaSnapshot({ mode: "ai" });
    output.tree = truncate(tree, MAX_TREE_CHARS);
  }

  return output;
}

function formatResult(r: Result) {
  return {
    id: r.id,
    impact: r.impact,
    description: r.description,
    help: r.help,
    helpUrl: r.helpUrl,
    wcag: r.tags.filter((t) => t.startsWith("wcag") || t.startsWith("best-practice")),
    nodes: r.nodes.map((n) => ({
      html: truncate(n.html, MAX_NODE_HTML),
      target: n.target,
      failureSummary: n.failureSummary,
    })),
  };
}
