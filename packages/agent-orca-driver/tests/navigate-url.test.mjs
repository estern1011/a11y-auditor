/**
 * /navigate URL scheme allow-list. The point is that a compromised endpoint
 * can't get the daemon to load file:// or chrome:// URLs as a local-file-read
 * primitive — http/https/data only.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { isAllowedNavigationUrl } from "../dist/src/server.js";

const allowed = [
  "http://example.com",
  "https://example.com/path?q=1",
  "data:text/html,<h1>hi</h1>",
];
const rejected = [
  "file:///etc/passwd",
  "chrome://settings",
  "chrome-extension://abc/page.html",
  "javascript:alert(1)",
  "ftp://example.com",
  "about:blank",
  "",
  "not a url",
];

for (const url of allowed) {
  test(`allowed: ${url}`, () => assert.equal(isAllowedNavigationUrl(url), true));
}
for (const url of rejected) {
  test(`rejected: ${url}`, () => assert.equal(isAllowedNavigationUrl(url), false));
}
