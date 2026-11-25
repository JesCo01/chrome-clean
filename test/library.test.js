import assert from "node:assert/strict";
import { test } from "node:test";
import { createChromeClean, ChromeCleanError } from "../src/index.js";

const page = (id, url, windowId = 1, extra = {}) => ({ id, url, windowId, ...extra });
const cookie = (domain, extra = {}) => ({
  domain, name: "sid", path: "/", hostOnly: !domain.startsWith("."),
  storeId: "0", secure: true, ...extra
});

function mockChrome({
  permissions = ["browsingData", "tabs", "history", "cookies"],
  origins = ["<all_urls>"],
  tabs = [],
  history = [],
  cookies = []
} = {}) {
  const calls = [];
  let currentTabs = [...tabs];
  let currentHistory = [...history];
  let currentCookies = [...cookies];

  function cookieMatches(item, details) {
    if (details.partitionKey?.topLevelSite !== item.partitionKey?.topLevelSite) return false;
    if (details.name && details.name !== item.name) return false;
    if (!details.url) return true;
    const url = new URL(details.url);
    const domain = item.domain.replace(/^\./, "");
    return (url.hostname === domain || (!item.hostOnly && url.hostname.endsWith("." + domain))) &&
      (url.pathname === item.path || url.pathname.startsWith(item.path.endsWith("/") ? item.path : item.path + "/"));
  }

  const api = {
    permissions: {
      getAll: async () => ({ permissions, origins }),
      contains: async ({ origins: requested }) => requested.every(host =>
        origins.includes("<all_urls>") || origins.includes(host)
      )
    },
    browsingData: { remove: async (options, types) => calls.push(["data", options, types]) },
    history: {
      search: async () => currentHistory.map(url => ({ url })),
      deleteUrl: async ({ url }) => {
        calls.push(["history", url]);
        currentHistory = currentHistory.filter(entry => entry !== url);
      }
    },
    cookies: {
      getAll: async details => currentCookies.filter(item => cookieMatches(item, details)),
      remove: async details => {
        calls.push(["cookie", details]);
        currentCookies = currentCookies.filter(item => !cookieMatches(item, details));
      }
    },
    tabs: {
      query: async query => query.active ? currentTabs.filter(tab => tab.active) : [...currentTabs],
      remove: async id => {
        calls.push(["tab", id]);
        currentTabs = currentTabs.filter(tab => tab.id !== id);
      },
      create: async options => {
        calls.push(["blank", options]);
        currentTabs.push(page(99, options.url, options.windowId));
      }
    },
    windows: {
      remove: async id => {
        calls.push(["window", id]);
        currentTabs = currentTabs.filter(tab => tab.windowId !== id);
      },
      create: async options => {
        calls.push(["blank window", options]);
        currentTabs.push(page(100, options.url, 100));
      }
    }
  };
  return {
    api, calls, cleaner: createChromeClean(api),
    setTabs: updated => { currentTabs = updated; },
    getCookies: () => currentCookies
  };
}

test("an invalid selector or pipeline is rejected before mutations", async () => {
  const { cleaner, calls } = mockChrome({ tabs: [page(1, "https://example.com")] });
  await assert.rejects(cleaner.clean(), { code: "INVALID_SELECTOR" });
  await assert.rejects(cleaner.clearCookies(null), { code: "INVALID_SELECTOR" });
  await assert.rejects(cleaner.clearHistory(0), { code: "INVALID_SELECTOR" });
  await assert.rejects(cleaner.run([["closeTabs", "*"], ["clearCache"]]),
    { code: "INVALID_SELECTOR", index: 1 });
  assert.deepEqual(calls, []);
});

test("global and timed browser operations return declared types", async () => {
  const { cleaner, calls } = mockChrome({ permissions: ["browsingData"] });
  assert.equal(await cleaner.clearCookies("*"), null);
  assert.equal(await cleaner.clearCache("*"), true);
  const before = Date.now();
  assert.deepEqual(await cleaner.clean(5), { tabs: 0, cookies: null, history: null, cache: true, storage: true });
  assert.equal(calls[0][1].since, 0);
  assert.ok(calls[2][1].since >= before - 300_000);
  assert.ok(calls[2][1].since <= Date.now() - 300_000);
  assert.equal(calls.length, 6);
});

test("an exact origin needs no discovery permissions", async () => {
  const { cleaner, calls } = mockChrome({ permissions: ["browsingData"], origins: [] });
  assert.equal(await cleaner.clearCache("https://example.com:8443"), true);
  assert.deepEqual(calls, [["data", { since: 0, origins: ["https://example.com:8443"] }, { cache: true }]]);
});

test("missing discovery differs from an authorized search with no results", async () => {
  const withoutSources = mockChrome({ permissions: ["browsingData"], origins: [] });
  await assert.rejects(withoutSources.cleaner.clearCache("portal"), { code: "MISSING_PERMISSION" });
  const withHistory = mockChrome({ permissions: ["browsingData", "history"], origins: [] });
  assert.equal(await withHistory.cleaner.clearCache("portal"), false);
  assert.deepEqual(withoutSources.calls, []);
  assert.deepEqual(withHistory.calls, []);
});

test("exact inverse origins delegate safely to Chrome", async () => {
  const { cleaner, calls } = mockChrome({ permissions: ["browsingData"], origins: [] });
  assert.equal(await cleaner.clearCache("!https://example.com"), true);
  assert.deepEqual(calls, [["data", { since: 0, excludeOrigins: ["https://example.com"] }, { cache: true }]]);
});

test("broad cache exclusions only remove positively known origins", async () => {
  const { cleaner, calls } = mockChrome({
    permissions: ["browsingData", "tabs"],
    tabs: [page(1, "https://mail.example.com"), page(2, "http://other.test:8080/path")]
  });
  assert.equal(await cleaner.clearCache("!example.com"), true);
  assert.equal(await cleaner.clearCache("!unknown.test"), false);
  assert.deepEqual(calls, [["data", { since: 0, origins: ["http://other.test:8080"] }, { cache: true }]]);
});

test("history matches full URLs for regex and hostnames for domains", async () => {
  const blocked = "https://other.test/?ref=portal.example.com";
  const { cleaner, calls } = mockChrome({
    history: ["https://portal.example.com/checkout", blocked, "https://portal.example.com/help"]
  });
  assert.equal(await cleaner.clearHistory(/^https:\/\/.+\/checkout$/), 1);
  assert.equal(await cleaner.clearHistory("example.com"), 1);
  assert.deepEqual(calls, [
    ["history", "https://portal.example.com/checkout"], ["history", "https://portal.example.com/help"]
  ]);
});

test("cookie exclusions preserve a shared parent domain", async () => {
  const { cleaner, getCookies } = mockChrome({
    cookies: [cookie(".example.com"), cookie("mail.example.com"), cookie("other.test")]
  });
  assert.equal(await cleaner.clearCookies("!mail.example.com"), 1);
  assert.deepEqual(getCookies().map(item => item.domain), [".example.com", "mail.example.com"]);
});

test("ambiguous cookie removal is rejected before calling Chrome's remove", async () => {
  const { cleaner, calls } = mockChrome({
    cookies: [cookie(".example.com"), cookie("app.example.com")]
  });
  await assert.rejects(cleaner.clearCookies("app.example.com"), { code: "AMBIGUOUS_COOKIE" });
  assert.deepEqual(calls, []);
});

test("partitioned cookies discovered from a tab use their own partition key", async () => {
  const partitionKey = { topLevelSite: "https://top.test", hasCrossSiteAncestor: true };
  const { api, cleaner, calls } = mockChrome({
    tabs: [page(1, "https://top.test")],
    cookies: [cookie("app.example.com", { partitionKey })]
  });
  api.cookies.getPartitionKey = async () => ({ partitionKey });
  assert.equal(await cleaner.clearCookies("app.example.com"), 1);
  assert.deepEqual(calls[0][1].partitionKey, partitionKey);
});

test("closeTabs protects internal and incognito tabs and applies regex to the URL", async () => {
  const { cleaner, calls } = mockChrome({ tabs: [
    page(1, "https://example.com/checkout"), page(2, "https://example.com/help"),
    page(3, "chrome-extension://private/login.html"), page(4, "chrome://newtab/"),
    page(5, "https://private.test/login", 2, { incognito: true })
  ] });
  assert.equal(await cleaner.closeTabs(/checkout|login/), 1);
  assert.deepEqual(calls, [["tab", 1]]);
});

test("closeTabs keeps Chrome open if it would close the last window", async () => {
  const { cleaner, calls } = mockChrome({ tabs: [page(1, "https://example.com")] });
  assert.equal(await cleaner.closeTabs(1), 1);
  assert.deepEqual(calls, [["blank", { url: "about:blank", active: false, windowId: 1 }], ["tab", 1]]);
});

test("closeTabs creates a blank tab if the only other tab closes during execution", async () => {
  const browser = mockChrome({ tabs: [page(1, "https://example.com"), page(2, "about:blank", 2)] });
  const query = browser.api.tabs.query;
  let reads = 0;
  browser.api.tabs.query = async options => {
    if (++reads === 3) browser.setTabs([page(1, "https://example.com")]);
    return query(options);
  };
  assert.equal(await browser.cleaner.closeTabs(1), 1);
  assert.deepEqual(browser.calls, [["blank", { url: "about:blank", active: false, windowId: 1 }], ["tab", 1]]);
});

test("closeWindows skips mixed windows and protects the final browser window", async () => {
  const mixed = mockChrome({ tabs: [
    page(1, "https://example.com", 1), page(2, "https://other.test", 1),
    page(3, "https://app.example.com", 2), page(4, "about:blank", 3)
  ] });
  assert.equal(await mixed.cleaner.closeWindows("example.com"), 1);
  assert.deepEqual(mixed.calls, [["window", 2]]);
  const last = mockChrome({ tabs: [page(1, "https://example.com")] });
  assert.equal(await last.cleaner.closeWindows("*"), 1);
  assert.deepEqual(last.calls, [["blank window", { url: "about:blank", focused: false }], ["window", 1]]);
});

test("active applies only to the selected tab or window", async () => {
  const { cleaner, calls } = mockChrome({ tabs: [
    page(1, "https://example.com", 1, { active: true }),
    page(2, "https://other.test", 1),
    page(3, "https://third.test", 2)
  ] });
  assert.equal(await cleaner.closeTabs("active"), 1);
  assert.deepEqual(calls, [["tab", 1]]);
});

test("an unresolved exclusion never falls back to an unfiltered cleanup", async () => {
  const { cleaner, calls } = mockChrome({
    tabs: [page(1, "https://example.com")],
    history: ["https://example.com"],
    cookies: [cookie("example.com")]
  });
  assert.equal(await cleaner.closeTabs("!unknown.test"), 0);
  assert.equal(await cleaner.clearHistory(["*", "!unknown.test"]), 0);
  assert.equal(await cleaner.clearCookies("!unknown.test"), 0);
  assert.deepEqual(calls, []);
});

test("a tab that navigates after planning is revalidated", async () => {
  const { api, cleaner, calls } = mockChrome({ tabs: [] });
  let reads = 0;
  api.tabs.query = async () => [page(1, ++reads === 1 ? "https://example.com" : "https://other.test")];
  assert.equal(await cleaner.closeTabs("example.com"), 0);
  assert.deepEqual(calls, []);
});

test("run preserves context before closing and preserves repeated operations", async () => {
  const { cleaner, calls } = mockChrome({ tabs: [page(1, "https://example.com"), page(2, "about:blank")] });
  assert.deepEqual(await cleaner.run([
    ["tabs", "example.com"], ["cache", "open"], ["clearCache", "https://example.com"]
  ]), [
    { op: "closeTabs", result: 1 }, { op: "clearCache", result: true }, { op: "clearCache", result: true }
  ]);
  assert.equal(calls[0][0], "tab");
  assert.deepEqual(calls[1][1].origins, ["https://example.com"]);
});

test("run preflights permissions before mutating and reports partial execution without leaking raw messages", async () => {
  const blocked = mockChrome({ permissions: ["tabs"], tabs: [page(1, "https://example.com")] });
  await assert.rejects(blocked.cleaner.run([["tabs", 1], ["cache", "*"]]),
    { code: "MISSING_PERMISSION", index: 1, completed: [] });
  assert.deepEqual(blocked.calls, []);

  const partial = mockChrome({ tabs: [page(1, "https://example.com"), page(2, "about:blank")] });
  partial.api.browsingData.remove = async () => { throw new Error("private test URL"); };
  await assert.rejects(partial.cleaner.run([["tabs", 1], ["cache", "*"], ["history", 30]]), error => {
    assert.ok(error instanceof ChromeCleanError);
    assert.equal(error.code, "CHROME_OPERATION_FAILED");
    assert.equal(error.index, 1);
    assert.deepEqual(error.completed, [{ op: "closeTabs", result: 1 }]);
    assert.doesNotMatch(error.message, /private/);
    return true;
  });
  assert.deepEqual(partial.calls, [["tab", 1]]);
});

test("failure inside a clean step preserves its partial result", async () => {
  const { api, cleaner } = mockChrome({ tabs: [page(1, "https://example.com"), page(2, "about:blank")] });
  api.browsingData.remove = async () => { throw new Error("failure"); };
  await assert.rejects(cleaner.run([["clean", "*"]]), {
    index: 0,
    completed: [],
    partial: { tabs: 1 }
  });
});
