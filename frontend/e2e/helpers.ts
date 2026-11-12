import { expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Seeded by e2e/seed.py (test-only account on a throwaway database).
export const E2E_USERNAME = "e2e";
export const E2E_PASSWORD = "e2e-password";

export function seedIds(): { tallId: number; cloneSourceId: number } {
  const file = path.resolve(process.cwd(), "e2e", ".tmp", "seed.json");
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

export async function login(page: Page) {
  await page.goto("/login");
  await page.fill("input[name='username'], input[type='text']", E2E_USERNAME);
  await page.fill("input[type='password']", E2E_PASSWORD);
  await page.click("button[type='submit']");
  // Dashboard is ready once the quick-invoice FAB is rendered.
  await expect(page.locator("button[title='فاکتور سریع']")).toBeVisible({
    timeout: 20_000,
  });
}

export async function apiGet(page: Page, pathName: string) {
  const cookies = await page.context().cookies();
  const access = cookies.find((c) => c.name === "access_token")?.value;
  expect(access, "access_token cookie after login").toBeTruthy();
  const res = await page.request.get(pathName, {
    headers: {
      Authorization: `Bearer ${access}`,
      "X-Client-Type": "extension",
    },
  });
  expect(res.ok(), `GET ${pathName}`).toBeTruthy();
  return res.json();
}
