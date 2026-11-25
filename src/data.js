import { ChromeCleanError, missingPermission } from "./errors.js";
import { candidateFromUrl, domainMatches, isComplement, matches, matchToken, normalizeHost } from "./resolve-arg.js";

const storageData = {
  localStorage: true,
  indexedDB: true,
  cacheStorage: true,
  serviceWorkers: true,
  fileSystems: true
};

const dataTypes = {
  clearCookies: { cookies: true },
  clearHistory: { history: true },
  clearCache: { cache: true },
  clearStorage: storageData
};

export async function prepareData(snapshot, operation, selector) {
  if (selector.kind !== "filter") {
    await snapshot.require("browsingData");
    const since = selector.kind === "time" ? selector.since : 0;
    return async () => {
      await snapshot.api.browsingData.remove({ since }, dataTypes[operation]);
      return operation === "clearCache" || operation === "clearStorage" ? true : null;
    };
  }
  if (operation === "clearHistory") {
    await snapshot.require("history");
    const context = await snapshot.context(selector);
    return () => clearHistory(snapshot, selector, context);
  }
  if (operation === "clearCookies") {
    if (!(await snapshot.hasCookieAccess())) {
      throw missingPermission("Selective cookie cleanup needs 'cookies' and matching host permissions.");
    }
    const context = await snapshot.context(selector);
    await snapshot.partitionKeys();
    return () => clearCookies(snapshot, selector, context);
  }

  await snapshot.require("browsingData");
  const context = await snapshot.context(selector);
  const options = await originOptions(snapshot, operation, selector, context);
  return async () => {
    if (!options) return false;
    await snapshot.api.browsingData.remove(options, dataTypes[operation]);
    return true;
  };
}

async function originOptions(snapshot, operation, selector, context) {
  const { include, exclude } = selector;
  const complement = isComplement(selector);
  if (complement && exclude.length > 0 && exclude.every(token => token.kind === "origin")) {
    return { since: 0, excludeOrigins: [...new Set(exclude.map(token => token.value))] };
  }

  const knownOrigins = include.filter(token => token.kind === "origin").map(token => candidateFromUrl(token.value));
  const usesContextOnly = include.length > 0 && include.every(token => ["origin", "active", "open"].includes(token.kind));
  if (usesContextOnly) {
    if (include.some(token => token.kind === "active") && context.active) knownOrigins.push(context.active);
    if (include.some(token => token.kind === "open")) knownOrigins.push(...context.open);
  } else {
    knownOrigins.push(...await snapshot.origins());
  }

  if (complement && exclude.length && !knownOrigins.some(site =>
    exclude.some(token => matchToken(token, site, context, operation))
  )) return null;

  const origins = [...new Set(knownOrigins
    .filter(site => matches(selector, site, context, operation))
    .map(site => site.origin))];
  return origins.length ? { since: 0, origins } : null;
}

async function clearHistory(snapshot, selector, context) {
  const entries = await snapshot.readHistory();
  const sites = entries.map(({ url }) => [url, candidateFromUrl(url)]).filter(([, site]) => site);
  if (isComplement(selector) && !sites.some(([, site]) =>
    selector.exclude.some(token => matchToken(token, site, context, "clearHistory"))
  )) return 0;
  const urls = new Set(sites
    .filter(([, site]) => matches(selector, site, context, "clearHistory"))
    .map(([url]) => url));
  for (const url of urls) await snapshot.api.history.deleteUrl({ url });
  return urls.size;
}

function cookieKey(cookie) {
  return JSON.stringify([
    cookie.domain, cookie.name, cookie.path, cookie.storeId,
    cookie.partitionKey?.topLevelSite, cookie.partitionKey?.hasCrossSiteAncestor
  ]);
}

function protectedSharedCookie(cookie, excludes, context) {
  if (cookie.hostOnly) return false;
  const host = normalizeHost(cookie.domain);
  return excludes.some(token => {
    if (token.kind === "domain" || token.kind === "origin") {
      const protectedHost = token.kind === "origin" ? candidateFromUrl(token.value).host : token.value;
      return domainMatches(protectedHost, host);
    }
    if (token.kind === "active") return context.active && domainMatches(context.active.host, host);
    if (token.kind === "open") return context.open.some(site => domainMatches(site.host, host));
    // A name pattern cannot prove that an unseen subdomain is unaffected.
    return ["glob", "keyword", "regexp"].includes(token.kind);
  });
}

async function clearCookies(snapshot, selector, context) {
  const cookies = await snapshot.readCookies();
  const eligible = cookie => ({
    host: normalizeHost(cookie.domain)
  });
  const excluded = cookie => protectedSharedCookie(cookie, selector.exclude, context) ||
    selector.exclude.some(token => matchToken(token, eligible(cookie), context, "clearCookies"));
  if (isComplement(selector) && !cookies.some(excluded)) return 0;

  let removed = 0;
  for (const cookie of cookies) {
    if (excluded(cookie) || !matches(selector, eligible(cookie), context, "clearCookies")) continue;
    if (await deleteCookie(snapshot, cookie)) removed++;
  }
  return removed;
}

async function deleteCookie(snapshot, cookie) {
  const host = normalizeHost(cookie.domain);
  const cookies = snapshot.api.cookies;
  const schemes = cookie.secure ? ["https"] : ["https", "http"];
  for (const scheme of schemes) {
    const url = new URL(scheme + "://" + host);
    url.pathname = cookie.path;
    const details = { url: url.href, name: cookie.name, storeId: cookie.storeId };
    if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;

    if (!await snapshot.api.permissions.contains({ origins: [url.origin + "/*"] })) continue;
    const before = await cookies.getAll(details);
    const targetKey = cookieKey(cookie);
    if (!before.some(item => cookieKey(item) === targetKey)) continue;
    if (before.some(item => cookieKey(item) !== targetKey)) {
      throw new ChromeCleanError("AMBIGUOUS_COOKIE", "Chrome cannot remove a cookie without also targeting another cookie with the same name and matching path.");
    }
    await cookies.remove(details);
    const after = await cookies.getAll(details);
    if (after.some(item => cookieKey(item) === targetKey)) {
      throw new ChromeCleanError("COOKIE_REMAINED", "A targeted cookie remained after removal.");
    }
    return true;
  }
  return false;
}
