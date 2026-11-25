import { cp, mkdir } from "node:fs/promises";

const output = new URL("../dist/extension/", import.meta.url);
await mkdir(output, { recursive: true });
await cp(new URL("../examples/extension/", import.meta.url), output, { recursive: true });
await cp(new URL("../src/", import.meta.url), new URL("lib/", output), { recursive: true });
console.log("Extension built in dist/extension.");
