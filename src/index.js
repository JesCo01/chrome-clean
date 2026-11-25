import { ChromeCleanError, invalid } from "./errors.js";
import { resolveArg } from "./resolve-arg.js";
import { ChromeSnapshot } from "./snapshot.js";
import { prepareClosing } from "./closing.js";
import { prepareData } from "./data.js";

export { ChromeCleanError } from "./errors.js";

const operationNames = new Map([
  ["closeTabs", "closeTabs"], ["tabs", "closeTabs"],
  ["closeWindows", "closeWindows"], ["windows", "closeWindows"],
  ["clearCookies", "clearCookies"], ["cookies", "clearCookies"],
  ["clearHistory", "clearHistory"], ["history", "clearHistory"],
  ["clearCache", "clearCache"], ["cache", "clearCache"],
  ["clearStorage", "clearStorage"], ["storage", "clearStorage"],
  ["clean", "clean"]
]);
const cleanSteps = [
  ["tabs", "closeTabs"],
  ["cookies", "clearCookies"],
  ["history", "clearHistory"],
  ["cache", "clearCache"],
  ["storage", "clearStorage"]
];

function operationError(error, op, index, completed) {
  const known = error instanceof ChromeCleanError;
  const result = new ChromeCleanError(
    known ? error.code : "CHROME_OPERATION_FAILED",
    known ? error.message : "Chrome rejected the " + op + " operation."
  );
  result.op = op;
  if (index !== undefined) result.index = index;
  if (completed !== undefined) result.completed = completed;
  return result;
}

async function prepare(snapshot, op, selector) {
  if (op === "closeTabs" || op === "closeWindows") return prepareClosing(snapshot, op, selector);
  if (op !== "clean") return prepareData(snapshot, op, selector);

  const steps = await Promise.all(cleanSteps.map(async ([key, operation]) => {
    if (operation === "closeTabs" && selector.kind === "time") return [key, operation, async () => 0];
    const action = await prepare(snapshot, operation, selector);
    return [key, operation, action];
  }));
  return async () => {
    const result = {};
    for (const [key, operation, action] of steps) {
      try {
        result[key] = await action();
      } catch (error) {
        throw operationError(error, operation, undefined, result);
      }
    }
    return result;
  };
}

export function createChromeClean(api = globalThis.chrome) {
  let queue = Promise.resolve();

  function enqueue(action) {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  }

  function execute(op, input) {
    return enqueue(async () => {
      try {
        const selector = resolveArg(op, input);
        const action = await prepare(new ChromeSnapshot(api), op, selector);
        return await action();
      } catch (error) {
        if (error instanceof ChromeCleanError && error.op) throw error;
        throw operationError(error, op);
      }
    });
  }

  function run(steps) {
    return enqueue(async () => {
      if (!Array.isArray(steps) || steps.length === 0) throw invalid("Provide at least one [operation, selector] pair.");
      const now = Date.now();
      const normalized = Array.from(steps, (step, index) => {
        const op = Array.isArray(step) ? operationNames.get(step[0]) : undefined;
        if (!op || step.length !== 2) {
          throw operationError(invalid("Every step must contain a supported operation and a selector."), "run", index, []);
        }
        try {
          return [op, resolveArg(op, step[1], now)];
        } catch (error) {
          throw operationError(error, op, index, []);
        }
      });
      const snapshot = new ChromeSnapshot(api);
      const plan = await Promise.all(normalized.map(async ([op, selector], index) => {
        try {
          return [op, await prepare(snapshot, op, selector)];
        } catch (error) {
          throw operationError(error, op, index, []);
        }
      }));
      const completed = [];
      for (const [index, [op, action]] of plan.entries()) {
        try {
          completed.push({ op, result: await action() });
        } catch (error) {
          const failure = operationError(error, error?.op ?? op, index, completed);
          if (op === "clean" && error?.completed) failure.partial = error.completed;
          throw failure;
        }
      }
      return completed;
    });
  }

  return {
    clearCookies: selector => execute("clearCookies", selector),
    clearHistory: selector => execute("clearHistory", selector),
    clearCache: selector => execute("clearCache", selector),
    clearStorage: selector => execute("clearStorage", selector),
    closeTabs: selector => execute("closeTabs", selector),
    closeWindows: selector => execute("closeWindows", selector),
    clean: selector => execute("clean", selector),
    run
  };
}

export const {
  clearCookies, clearHistory, clearCache, clearStorage, closeTabs, closeWindows, clean, run
} = createChromeClean();
