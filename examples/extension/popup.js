import { clearCache } from "./lib/index.js";

const form = document.getElementById("form");
const origin = document.getElementById("origin");
const status = document.getElementById("status");
const button = form.querySelector("button");

form.addEventListener("submit", async event => {
  event.preventDefault();
  button.disabled = true;
  status.textContent = "Clearing cache…";
  try {
    const changed = await clearCache(origin.value);
    status.textContent = changed ? "Chrome completed the cache request." : "No matching origins.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
