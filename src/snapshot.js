import { ChromeCleanError, missingPermission } from "./errors.js";
import { candidateFromUrl, normalizeHost } from "./resolve-arg.js";

const historyQuery = { text: "", startTime: 0, maxResults: 0 };

export class ChromeSnapshot {
  constructor(api) {
    if (!api?.permissions?.getAll) {
      throw new ChromeCleanError("CHROME_UNAVAILABLE", "Run chrome-clean in a Chrome extension page or service worker.");
    }
    if (api.extension?.inIncognitoContext) {
      throw new ChromeCleanError("UNSUPPORTED_CONTEXT", "This version runs in the regular Chrome profile.");
    }
    this.api = api;
    this.reads = new Map();
  }

  once(name, read) {
    if (!this.reads.has(name)) this.reads.set(name, Promise.resolve().then(read));
    return this.reads.get(name);
  }

  permissions() {
    return this.once("permissions", () => this.api.permissions.getAll());
  }

  async has(name) {
    return (await this.permissions()).permissions?.includes(name) ?? false;
  }

  async require(name, namespace = name) {
    if (!(await this.has(name)) || !this.api[namespace]) {
      throw missingPermission("The extension needs the '" + name + "' permission.");
    }
  }

  async hasCookieAccess() {
    const permissions = await this.permissions();
    return this.api.cookies && permissions.permissions?.includes("cookies") &&
      permissions.origins?.some(origin => origin === "<all_urls>" || /^(?:https?|\*):\/\//.test(origin));
  }

  async readTabs(query = {}) {
    return (await this.api.tabs.query(query)).filter(tab => !tab.incognito && Number.isInteger(tab.id));
  }

  tabs() {
    return this.once("tabs", () => this.readTabs());
  }

  async canReadTabUrls() {
    const permissions = await this.permissions();
    return permissions.permissions?.includes("tabs") ||
      permissions.origins?.some(origin => origin === "<all_urls>" || /^(?:https?|\*):\/\//.test(origin)) ||
      (await this.tabs()).some(tab => candidateFromUrl(tab.url));
  }

  async context(selector) {
    const tokens = [...(selector.include ?? []), ...(selector.exclude ?? [])];
    const needsActive = tokens.some(token => token.kind === "active");
    const needsOpen = tokens.some(token => token.kind === "open");
    if (!needsActive && !needsOpen) return { active: null, open: [] };
    if (!this.api.tabs?.query) throw missingPermission("The 'active' and 'open' selectors need access to tab URLs.");

    const [activeTab] = needsActive
      ? await this.once("active", () => this.readTabs({ active: true, lastFocusedWindow: true }))
      : [];
    const open = needsOpen ? (await this.tabs()).map(tab => candidateFromUrl(tab.url)).filter(Boolean) : [];
    const active = candidateFromUrl(activeTab?.url);

    if (!active && open.length === 0 && !(await this.canReadTabUrls())) {
      throw missingPermission("Provide access to tab URLs through 'tabs', host permissions or activeTab.");
    }
    return {
      active,
      activeId: active ? activeTab.id : undefined,
      activeWindowId: active ? activeTab.windowId : undefined,
      open
    };
  }

  readHistory() {
    return this.api.history.search(historyQuery);
  }

  history() {
    return this.once("history", () => this.readHistory());
  }

  async partitionKeys() {
    return this.once("partitionKeys", async () => {
      if (!this.api.cookies?.getPartitionKey || !this.api.tabs?.query) return [];
      const tabs = (await this.tabs()).filter(tab => candidateFromUrl(tab.url));
      const results = await Promise.allSettled(tabs.map(tab =>
        this.api.cookies.getPartitionKey({ tabId: tab.id, frameId: 0 })
      ));
      const keys = new Map();
      for (const result of results) {
        const key = result.status === "fulfilled" ? result.value?.partitionKey ?? result.value : null;
        if (key?.topLevelSite) keys.set(JSON.stringify(key), key);
      }
      return [...keys.values()];
    });
  }

  async readCookies() {
    const keys = await this.partitionKeys();
    const groups = await Promise.all([
      this.api.cookies.getAll({}),
      ...keys.map(partitionKey => this.api.cookies.getAll({ partitionKey }))
    ]);
    const unique = new Map();
    for (const cookie of groups.flat()) {
      // Keep only metadata used to select and verify removals.
      const { domain, name, path, secure, hostOnly, storeId, partitionKey } = cookie;
      const key = JSON.stringify([domain, name, path, storeId, partitionKey?.topLevelSite, partitionKey?.hasCrossSiteAncestor]);
      unique.set(key, { domain, name, path, secure, hostOnly, storeId, partitionKey });
    }
    return [...unique.values()];
  }

  cookies() {
    return this.once("cookies", () => this.readCookies());
  }

  origins() {
    return this.once("origins", async () => {
      const candidates = [];
      let authorizedSource = false;
      if (this.api.tabs?.query && await this.canReadTabUrls()) {
        authorizedSource = true;
        candidates.push(...(await this.tabs()).map(tab => candidateFromUrl(tab.url)).filter(Boolean));
      }
      if (this.api.history?.search && await this.has("history")) {
        authorizedSource = true;
        candidates.push(...(await this.history()).map(entry => candidateFromUrl(entry.url)).filter(Boolean));
      }
      if (await this.hasCookieAccess()) {
        authorizedSource = true;
        for (const cookie of await this.cookies()) {
          const host = normalizeHost(cookie.domain);
          candidates.push(candidateFromUrl("https://" + host));
          if (!cookie.secure) candidates.push(candidateFromUrl("http://" + host));
        }
      }
      if (!authorizedSource) {
        throw missingPermission("Origin discovery needs access to tab URLs, history, or cookies with host permissions.");
      }
      return candidates.filter(Boolean);
    });
  }
}
