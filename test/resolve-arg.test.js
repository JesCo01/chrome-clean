import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateFromUrl, matches, resolveArg } from "../src/resolve-arg.js";

const context = { active: null, open: [] };
const testSite = (operation, selector, url) =>
  matches(resolveArg(operation, selector), candidateFromUrl(url), context, operation);

test("only an explicit star selects the whole profile", () => {
  assert.deepEqual(resolveArg("clean", "*"), { kind: "all" });
  for (const input of [undefined, null, "", " ", [], [undefined], "!*", "**", true, {}]) {
    assert.throws(() => resolveArg("clean", input), { code: "INVALID_SELECTOR" });
  }
});

test("positive integers are minutes for data and IDs for closing", () => {
  assert.deepEqual(resolveArg("clearHistory", 15, 1_000_000), { kind: "time", since: 100_000 });
  assert.deepEqual(resolveArg("closeTabs", [12, 15]).include, [
    { kind: "id", value: 12 }, { kind: "id", value: 15 }
  ]);
  for (const input of [0, -1, 1.25, NaN, Infinity, [15], 20]) {
    assert.throws(() => resolveArg("clearCache", input, 1_000_000), { code: "INVALID_SELECTOR" });
  }
  assert.throws(() => resolveArg("closeWindows", 2 ** 31), { code: "INVALID_SELECTOR" });
});

test("domain, wildcard and keyword selectors use hostname labels", () => {
  assert.equal(testSite("clearCache", "example.com", "https://app.example.com"), true);
  assert.equal(testSite("clearCache", "example.com", "https://otherexample.com"), false);
  assert.equal(testSite("clearCache", "*.example.com", "https://example.com"), false);
  assert.equal(testSite("clearCache", "*.example.com", "https://app.example.com"), true);
  assert.equal(testSite("clearCache", "portal", "https://good.test/?next=portal"), false);
  assert.equal(testSite("clearCache", "portal", "https://portal.good.test"), true);
});

test("international names and exact origins are normalized", () => {
  assert.equal(testSite("clearCache", "bücher.example", "https://xn--bcher-kva.example"), true);
  assert.equal(testSite("clearCache", "https://example.com:8443", "https://example.com:8443/path"), true);
  assert.equal(testSite("clearCache", "https://example.com:8443", "https://example.com"), false);
  for (const input of ["https://user:pass@example.com", "file:///example", "https://example.com/path", "https://example.com/?x=1"]) {
    assert.throws(() => resolveArg("clearCache", input), { code: "INVALID_SELECTOR" });
  }
});

test("expressions look at URLs for history and tabs, and at hostnames for data", () => {
  const url = "https://example.com/checkout";
  const re = /checkout/g;
  for (const op of ["clearHistory", "closeTabs", "closeWindows"]) {
    const selector = resolveArg(op, re);
    assert.equal(matches(selector, candidateFromUrl(url), context, op), true);
    assert.equal(matches(selector, candidateFromUrl(url), context, op), true);
  }
  assert.equal(testSite("clearCache", re, url), false);
  assert.equal(testSite("closeTabs", /checkout/y, url), false);
  assert.equal(re.lastIndex, 0);
});

test("mixed lists union inclusions and subtract exclusions", () => {
  const selector = ["example.com", "alt.test", "!mail.example.com"];
  assert.equal(testSite("clearHistory", selector, "https://app.example.com"), true);
  assert.equal(testSite("clearHistory", selector, "https://mail.example.com"), false);
  assert.equal(testSite("clearHistory", selector, "https://alt.test"), true);
  assert.equal(testSite("clearHistory", selector, "https://other.test"), false);
});
