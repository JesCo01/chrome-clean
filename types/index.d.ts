export type DataSelector = string | number | RegExp | readonly (string | RegExp)[];
export type ClosingSelector = string | number | RegExp | readonly (string | number | RegExp)[];

export interface CleanResult {
  tabs: number;
  cookies: number | null;
  history: number | null;
  cache: boolean;
  storage: boolean;
}

export type RunStep =
  | readonly ["tabs" | "closeTabs" | "windows" | "closeWindows", ClosingSelector]
  | readonly ["cookies" | "clearCookies" | "history" | "clearHistory" | "cache" | "clearCache" |
      "storage" | "clearStorage" | "clean", DataSelector];

export type RunResult =
  | { op: "closeTabs" | "closeWindows"; result: number }
  | { op: "clearCookies" | "clearHistory"; result: number | null }
  | { op: "clearCache" | "clearStorage"; result: boolean }
  | { op: "clean"; result: CleanResult };

export class ChromeCleanError extends Error {
  code: string;
  op?: RunResult["op"] | "run";
  index?: number;
  completed?: RunResult[] | Partial<CleanResult>;
  partial?: Partial<CleanResult>;
  constructor(code: string, message: string, options?: ErrorOptions);
}

export interface ChromeClean {
  clearCookies(selector: DataSelector): Promise<number | null>;
  clearHistory(selector: DataSelector): Promise<number | null>;
  clearCache(selector: DataSelector): Promise<boolean>;
  clearStorage(selector: DataSelector): Promise<boolean>;
  closeTabs(selector: ClosingSelector): Promise<number>;
  closeWindows(selector: ClosingSelector): Promise<number>;
  clean(selector: DataSelector): Promise<CleanResult>;
  run(steps: readonly RunStep[]): Promise<RunResult[]>;
}

export function createChromeClean(api?: object): ChromeClean;

export const clearCookies: ChromeClean["clearCookies"];
export const clearHistory: ChromeClean["clearHistory"];
export const clearCache: ChromeClean["clearCache"];
export const clearStorage: ChromeClean["clearStorage"];
export const closeTabs: ChromeClean["closeTabs"];
export const closeWindows: ChromeClean["closeWindows"];
export const clean: ChromeClean["clean"];
export const run: ChromeClean["run"];
