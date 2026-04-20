import { describe, test, expect } from "bun:test";
import { resolve } from "node:path";

import { absolutizeArtifacts, flattenSrTranscript } from "./collect.ts";
import { detectNeedsAuth } from "../../collect.ts";

// ---------------------------------------------------------------------------
// absolutizeArtifacts
// ---------------------------------------------------------------------------

describe("absolutizeArtifacts", () => {
  test("resolves valid relative paths inside outDir", () => {
    const out = absolutizeArtifacts(
      { html: "artifacts/html.html", axe: "artifacts/axe.json" },
      "/tmp/run-1",
    );
    expect(out.html).toBe(resolve("/tmp/run-1/artifacts/html.html"));
    expect(out.axe).toBe(resolve("/tmp/run-1/artifacts/axe.json"));
  });

  test("rejects paths that escape the run dir via ..", () => {
    expect(() =>
      absolutizeArtifacts({ evil: "../../etc/passwd" }, "/tmp/run-1"),
    ).toThrow(/escapes run dir/);
  });

  test("rejects paths containing a NUL byte", () => {
    expect(() =>
      absolutizeArtifacts({ evil: "artifacts/\0hidden" }, "/tmp/run-1"),
    ).toThrow(/escapes run dir/);
  });

  test("returns an empty object for no inputs", () => {
    expect(absolutizeArtifacts({}, "/tmp/run-1")).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// flattenSrTranscript
// ---------------------------------------------------------------------------

describe("flattenSrTranscript", () => {
  test("labels each SR bucket with its source", () => {
    const lines = flattenSrTranscript(
      {
        onLoad: [{ spoken: "Welcome" }],
        tabSequence: [{ spoken: "Search, button" }],
        landmarks: [{ name: "main", role: "landmark" }],
        headings: [{ spoken: "News, heading level 1" }],
        links: [{ name: "Home", role: "link" }],
      },
      "discover",
    );
    const texts = lines.map((l) => l.text);
    expect(texts).toContain("[onLoad] Welcome");
    expect(texts).toContain("[tab] Search, button");
    expect(texts).toContain("[landmark] main, landmark");
    expect(texts).toContain("[heading] News, heading level 1");
    expect(texts).toContain("[link] Home, link");
  });

  test("skips entries with no spoken/name/role", () => {
    const lines = flattenSrTranscript(
      { tabSequence: [{ spoken: "" }, { name: "", role: "", state: [] }, { spoken: "ok" }] },
      "discover",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("[tab] ok");
  });

  test("attributes lines to the given phase", () => {
    const lines = flattenSrTranscript(
      { onLoad: [{ spoken: "Welcome" }] },
      "baseline",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].phase).toBe("baseline");
    expect(lines[0].channel).toBe("sr");
  });

  test("returns empty array when sr is undefined", () => {
    expect(flattenSrTranscript(undefined, "discover")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// detectNeedsAuth
// ---------------------------------------------------------------------------

describe("detectNeedsAuth", () => {
  test("returns true for /login paths", () => {
    expect(detectNeedsAuth({ url: "https://example.com/login", html: "<p>hi</p>" })).toBe(true);
    expect(detectNeedsAuth({ url: "https://example.com/sign-in", html: "" })).toBe(true);
    expect(detectNeedsAuth({ url: "https://example.com/account/login", html: "" })).toBe(true);
  });

  test("returns true when a password input is present", () => {
    expect(
      detectNeedsAuth({
        url: "https://example.com/",
        html: '<form><input type="password" name="pw"></form>',
      }),
    ).toBe(true);
    expect(
      detectNeedsAuth({
        url: "https://example.com/",
        html: "<input type=password>",
      }),
    ).toBe(true);
  });

  test("returns false for plain / without password input", () => {
    expect(
      detectNeedsAuth({
        url: "https://example.com/",
        html: '<main><input type="text"></main>',
      }),
    ).toBe(false);
  });

  test("returns false for non-auth subpaths", () => {
    expect(detectNeedsAuth({ url: "https://example.com/about", html: "" })).toBe(false);
    expect(detectNeedsAuth({ url: "https://example.com/products/loginboost", html: "" })).toBe(false);
  });
});
