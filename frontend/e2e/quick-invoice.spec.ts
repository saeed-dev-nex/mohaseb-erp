import { expect, test } from "@playwright/test";
import { apiGet, login } from "./helpers";

// Money math of the quick-invoice wizard: PriceInput amounts are typed
// in thousand-Toman, so 500 becomes 500,000 on the invoice; the final
// amount must be items + commission exactly.
test("quick invoice totals: items + commission, thousand-Toman inputs", async ({
  page,
}) => {
  await login(page);

  await page.click("button[title='فاکتور سریع']");
  const modal = page.locator("div.fixed.inset-0.z-\\[100\\]");
  await expect(modal).toBeVisible();

  // Step 1 — customer.
  await modal
    .locator("input[placeholder*='نام مشتری']")
    .fill("مشتری سریع آزمایشی");
  await page.locator("button", { hasText: "مرحله بعد" }).click();

  // Step 2 — one service row: main price 500 (= 500,000 Toman).
  const titleInput = modal.locator("input[placeholder*='عنوان خدمت']").first();
  await expect(titleInput).toBeVisible();
  await titleInput.fill("خدمت آزمایشی");
  // Step 2 holds exactly one row: number inputs are main price, extra
  // price, quantity — in DOM order.
  await modal.locator("input[type='number']").nth(0).fill("500");
  await page.locator("button", { hasText: "مرحله بعد" }).click();

  // Step 3 — commission is mandatory: 50 (= 50,000 Toman).
  await expect(modal.locator("[data-commission] input")).toBeVisible();
  await modal.locator("[data-commission] input").fill("50");
  await page.locator("button", { hasText: "مرحله بعد" }).click();

  // Step 4 — mark paid and issue.
  await page.locator("button", { hasText: "پرداخت شده" }).click();
  await modal.locator("[data-submit]").click();

  // Success screen → go to the created invoice's detail page.
  await page.locator("button", { hasText: "رفتن به جزئیات فاکتور" }).click();
  await page.waitForURL(/\/invoices\/\d+/, { timeout: 20_000 });
  const id = Number(page.url().match(/\/invoices\/(\d+)/)![1]);

  const invoice = await apiGet(page, `/api/invoices/${id}/`);
  expect(Number(invoice.total_amount)).toBe(500_000);
  expect(Number(invoice.commission_total)).toBe(50_000);
  expect(Number(invoice.final_amount)).toBe(550_000);
  expect(invoice.status).toBe("paid");
});
