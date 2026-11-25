export class ChromeCleanError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "ChromeCleanError";
    this.code = code;
  }
}

export function invalid(message) {
  return new ChromeCleanError("INVALID_SELECTOR", message);
}

export function missingPermission(message) {
  return new ChromeCleanError("MISSING_PERMISSION", message);
}
