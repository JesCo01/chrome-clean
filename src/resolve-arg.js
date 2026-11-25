import { invalid } from "./errors.js";

const closingOperations = new Set(["closeTabs", "closeWindows"]);

export function webUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

export function normalizeHost(host) {
  return host.toLowerCase().replace(/^\./, "").replace(/\.$/, "");
}

export function domainMatches(host, domain) {
  return host === domain || host.endsWith("." + domain);
}

export function resolveArg(operation, input, now = Date.now()) {
  if (typeof input === "number" && !closingOperations.has(operation)) {
    const duration = input * 60_000;
    const since = now - duration;
    if (!Number.isSafeInteger(input) || input <= 0 || !Number.isSafeInteger(since) || since <= 0) {
      throw invalid("Use a positive integer number of minutes within the available date range.");
    }
    return { kind: "time", since };
  }

  const items = Array.isArray(input) ? input : [input];
  if (items.length === 0) throw invalid("The selector list must not be empty.");
  const include = [];
  const exclude = [];
  for (const item of items) {
    const negated = typeof item === "string" && item.trim().startsWith("!");
    const value = negated ? item.trim().slice(1).trim() : item;
    const token = parseToken(value, operation);
    if (negated && token.kind === "all") throw invalid("The global selector cannot be excluded.");
    (negated ? exclude : include).push(token);
  }

  if (include.length === 1 && include[0].kind === "all" && exclude.length === 0) return { kind: "all" };
  return { kind: "filter", include, exclude };
}

function parseToken(value, operation) {
  if (Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647 && closingOperations.has(operation)) {
    return { kind: "id", value };
  }
  if (value instanceof RegExp) {
    return { kind: "regexp", value: new RegExp(value.source, value.flags) };
  }
  if (typeof value !== "string" || !value.trim()) {
    throw invalid("Supply a selector. Use '*' explicitly for the whole profile.");
  }

  const text = value.trim().toLowerCase();
  if (text === "*") return { kind: "all" };
  if (text === "active" || text === "open") return { kind: text };

  if (text.includes("://")) {
    const url = webUrl(text);
    if (!url || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw invalid("A web origin must contain only a scheme, hostname and optional port.");
    }
    return { kind: "origin", value: url.origin };
  }

  if (text.includes("*")) {
    if (!/^[a-z0-9.*-]+$/i.test(text) || !/[a-z0-9]/i.test(text)) throw invalid("Invalid hostname wildcard.");
    const pattern = text.replace(/\./g, "\\.").replace(/\*/g, ".*");
    return { kind: "glob", value: new RegExp("^" + pattern + "$", "i") };
  }

  if (!/^[\p{L}\p{N}._-]+$/u.test(text) || text.startsWith(".")) throw invalid("Invalid hostname or keyword.");
  if (text.includes(".")) {
    const url = webUrl("https://" + text);
    if (!url || normalizeHost(url.hostname).split(".").some(label => !label)) throw invalid("Invalid hostname.");
    return { kind: "domain", value: normalizeHost(url.hostname) };
  }
  return { kind: "keyword", value: text };
}

export function candidateFromUrl(raw, id) {
  const url = webUrl(raw);
  return url && { id, url: url.href, host: normalizeHost(url.hostname), origin: url.origin };
}

export function matchToken(token, candidate, context, operation) {
  const { kind, value } = token;
  switch (kind) {
    case "all": return true;
    case "id": return candidate.id === value;
    case "origin": return candidate.origin
      ? candidate.origin === value
      : candidate.host === normalizeHost(new URL(value).hostname);
    case "domain": return domainMatches(candidate.host, value);
    case "keyword": return candidate.host.includes(value);
    case "glob": return value.test(candidate.host);
    case "regexp":
      value.lastIndex = 0;
      return value.test(closingOperations.has(operation) || operation === "clearHistory" ? candidate.url : candidate.host);
    case "active":
      if (closingOperations.has(operation)) return candidate.id === context.activeId;
      return context.active && (candidate.origin ? candidate.origin === context.active.origin : candidate.host === context.active.host);
    case "open":
      return context.open.some(site => candidate.origin ? site.origin === candidate.origin : site.host === candidate.host);
  }
}

export function matches(selector, candidate, context, operation) {
  if (selector.kind === "all") return true;
  const match = token => matchToken(token, candidate, context, operation);
  return (selector.include.length === 0 || selector.include.some(match)) && !selector.exclude.some(match);
}

export function isComplement(selector) {
  return selector.kind === "filter" &&
    (selector.include.length === 0 || selector.include.some(token => token.kind === "all"));
}
