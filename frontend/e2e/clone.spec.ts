import { expect, test } from "@playwright/test";
import { apiGet, login, seedIds } from "./helpers";

// «صدور مشابه» opens the full form prefilled from the source invoice;
// saving must create a NEW invoice (new id/number) with the same money.
test("clone invoice keeps items and totals under a new number", async ({
  page,
}) => {
  const { cloneSourceId } = seedIds();
  await login(page);

  const source = await apiGet(page, `/api/invoices/${cloneSourceId}/`);

  await page.goto(`/invoices/${cloneSourceId}`);
  await page.locator("a", { hasText: "صدور مشابه" }).click();
  await page.waitForURL(new RegExp(`/invoices/new\\?clone=${cloneSourceId}`), {
    timeout: 20_000,
  });

  // Prefill is applied atomically: once the source's plate reaches the
  // form, the customer is set too (both come from the same state update).
  await expect(page.locator("input[placeholder='12']").first()).toHaveValue(
    "77",
    { timeout: 20_000 },
  );
  await expect(page.locator("body")).toContainText("مشتری نسخه");

  await page.locator("button", { hasText: "ثبت فاکتور" }).first().click();
  await page.waitForURL(/\/invoices\/\d+/, { timeout: 20_000 });
  const newId = Number(page.url().match(/\/invoices\/(\d+)/)![1]);
  expect(newId).not.toBe(cloneSourceId);

  const clone = await apiGet(page, `/api/invoices/${newId}/`);
  expect(clone.invoice_number).not.toBe(source.invoice_number);
  expect(Number(clone.final_amount)).toBe(Number(source.final_amount));
  expect(clone.items).toHaveLength(source.items.length);
});
