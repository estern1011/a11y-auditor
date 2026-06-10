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
    if (selector) {
      output.tree = await page.locator(selector).ariaSnapshot({ mode: "ai" });
    } else {
      output.tree = await page.ariaSnapshot({ mode: "ai" });
    }
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
      html: n.html,
      target: n.target,
      failureSummary: n.failureSummary,
    })),
  };
}
