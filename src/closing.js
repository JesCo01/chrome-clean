import { missingPermission } from "./errors.js";
import { candidateFromUrl, isComplement, matches, matchToken } from "./resolve-arg.js";

function tabSite(tab, id = tab.id) {
  return candidateFromUrl(tab.url, id);
}

function windowGroups(tabs) {
  const groups = new Map();
  for (const tab of tabs) {
    if (!Number.isInteger(tab.windowId)) continue;
    if (!groups.has(tab.windowId)) groups.set(tab.windowId, []);
    groups.get(tab.windowId).push(tab);
  }
  return groups;
}

export async function prepareClosing(snapshot, operation, selector) {
  if (!snapshot.api.tabs?.query || !(await snapshot.canReadTabUrls())) {
    throw missingPermission("Tab or window cleanup needs access to tab URLs so protected pages can be preserved.");
  }
  const context = await snapshot.context(selector);
  const tabs = await snapshot.tabs();
  const byWindow = operation === "closeWindows";
  const targetContext = byWindow ? { ...context, activeId: context.activeWindowId } : context;
  if (isComplement(selector) && !tabs.some(tab => {
    const site = tabSite(tab, byWindow ? tab.windowId : tab.id);
    return site && selector.exclude.some(token => matchToken(token, site, targetContext, operation));
  })) return async () => 0;

  if (byWindow) {
    if (!snapshot.api.windows?.remove) throw missingPermission("The Chrome windows API is unavailable.");
    return prepareWindows(snapshot, selector, targetContext, tabs);
  }
  const eligible = tab => {
    const site = tabSite(tab);
    return site && matches(selector, site, context, operation);
  };
  const targets = new Map(tabs.filter(eligible).map(tab => [tab.id, tab.url]));
  return async () => {
    if (targets.size === 0) return 0;
    const current = await snapshot.readTabs();
    const stillEligible = tab => targets.get(tab.id) === tab.url && eligible(tab);
    const toClose = current.filter(stillEligible);
    let closed = 0;
    for (const tab of toClose) {
      const latest = await snapshot.readTabs();
      const liveTab = latest.find(candidate => candidate.id === tab.id && stillEligible(candidate));
      if (!liveTab) continue;
      if (latest.length === 1) {
        await snapshot.api.tabs.create({ url: "about:blank", active: false, windowId: liveTab.windowId });
      }
      try {
        await snapshot.api.tabs.remove(tab.id);
        closed++;
      } catch (error) {
        if ((await snapshot.readTabs()).some(candidate => candidate.id === tab.id)) throw error;
      }
    }
    return closed;
  };
}

function prepareWindows(snapshot, selector, context, tabs) {
  const eligible = (windowId, entries) => entries.every(tab => {
    const site = tabSite(tab, windowId);
    return site && matches(selector, site, context, "closeWindows");
  });
  const originals = windowGroups(tabs);
  const targets = [...originals].filter(([id, entries]) => eligible(id, entries)).map(([id]) => id);
  return async () => {
    if (targets.length === 0) return 0;
    const groups = windowGroups(await snapshot.readTabs());
    const stillEligible = (windowId, entries) => entries?.length && eligible(windowId, entries) &&
      entries.every(tab => originals.get(windowId).some(original => original.id === tab.id && original.url === tab.url));
    const closeIds = targets.filter(id => stillEligible(id, groups.get(id)));
    let closed = 0;
    for (const id of closeIds) {
      const latest = windowGroups(await snapshot.readTabs());
      if (!stillEligible(id, latest.get(id))) continue;
      if (latest.size === 1) {
        await snapshot.api.windows.create({ url: "about:blank", focused: false });
      }
      try {
        await snapshot.api.windows.remove(id);
        closed++;
      } catch (error) {
        if ((await snapshot.readTabs()).some(tab => tab.windowId === id)) throw error;
      }
    }
    return closed;
  };
}
