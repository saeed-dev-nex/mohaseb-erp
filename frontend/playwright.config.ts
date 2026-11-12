import { defineConfig } from "@playwright/test";
import path from "node:path";

// End-to-end suite against a throwaway full stack: a temporary SQLite
// database (migrated + seeded by e2e/seed.py) served by Daphne together
// with the production frontend build. See e2e/README.md.
const tmpDir = path.resolve(process.cwd(), "e2e", ".tmp");
const PORT = 8931;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.spec.ts",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
  },
  webServer: {
    command: [
      `rm -rf "${tmpDir}"`,
      `mkdir -p "${tmpDir}"`,
      "cd ../backend",
      "python3 manage.py migrate --noinput",
      "python3 ../frontend/e2e/seed.py",
      `python3 -m daphne -b 127.0.0.1 -p ${PORT} core.asgi:application`,
    ].join(" && "),
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DJANGO_SECRET_KEY: "e2e-only-not-a-real-secret",
      DJANGO_DEBUG: "true",
      DJANGO_DB_PATH: path.join(tmpDir, "db.sqlite3"),
      DJANGO_MEDIA_ROOT: path.join(tmpDir, "media"),
      DJANGO_SERVE_FRONTEND: "true",
    },
  },
});
