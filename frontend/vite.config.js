import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { repositoryFonts } from "./build/fonts.js";

const appVersion = readFileSync(
  new URL("../VERSION", import.meta.url),
  "utf8",
).trim();

// The channel (branch) the app was built from, so the UI can show whether
// it is running a beta or main build. An explicit VITE_APP_CHANNEL wins
// (e.g. builds from a tarball without .git); otherwise the current git
// branch is used. A detached HEAD has no branch name, so it yields "" and
// the UI simply shows no channel badge.
function detectAppChannel() {
  const fromEnv = (process.env.VITE_APP_CHANNEL || "").trim();
  if (fromEnv) {
    return fromEnv;
  }
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return branch === "HEAD" ? "" : branch;
  } catch {
    return "";
  }
}

const appChannel = detectAppChannel();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_CHANNEL__: JSON.stringify(appChannel),
  },
  plugins: [react(), repositoryFonts()],
  server: {
    host: "0.0.0.0", // Listen on all network interfaces (LAN)
    port: 5173,
  },
  preview: {
    host: "0.0.0.0", // Listen on all network interfaces (LAN)
    port: 4173,
    headers: {
      "Cache-Control": "no-cache",
    },
  },
});
