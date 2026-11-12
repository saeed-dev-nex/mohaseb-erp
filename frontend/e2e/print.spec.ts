import { expect, test } from "@playwright/test";
import { login, seedIds } from "./helpers";

// Print regression: the seeded tall invoice (6 items) used to spill to
// two A5 pages; the print zoom fix must keep it on exactly one page.
test("tall invoice prints on a single A5 page", async ({ page }) => {
  const { tallId } = seedIds();
  await login(page);

  await page.goto(`/invoices/${tallId}`);
  await expect(page.locator("#invoice-print-area")).toBeVisible({
    timeout: 20_000,
  });

  const pdf = await page.pdf({
    preferCSSPageSize: true,
    printBackground: true,
  });
  const text = pdf.toString("latin1");
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((m) =>
    Number(m[1]),
  );
  expect(counts.length).toBeGreaterThan(0);
  expect(Math.max(...counts)).toBe(1);
});
