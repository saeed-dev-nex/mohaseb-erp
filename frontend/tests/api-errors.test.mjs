import test from "node:test";
import assert from "node:assert/strict";
import { formatApiError } from "../src/utils/apiError.js";

test("API errors accept Axios validation bodies and unwrapped query-hook errors", () => {
  const body = {
    title: ["عنوان الزامی است"],
    items: [{ amount: ["مبلغ معتبر نیست"] }],
  };
  assert.equal(
    formatApiError({ response: { data: body } }, "خطا"),
    "عنوان الزامی است مبلغ معتبر نیست",
  );
  assert.equal(formatApiError(body, "خطا"), "عنوان الزامی است مبلغ معتبر نیست");
  assert.equal(formatApiError("  اجازه ندارید  ", "خطا"), "اجازه ندارید");
  assert.equal(
    formatApiError({ detail: "تکراری", non_field_errors: ["تکراری"] }, "خطا"),
    "تکراری",
  );
});

test("empty/HTML/network failures use the safe fallback instead of debug output", () => {
  for (const value of [
    null,
    undefined,
    "",
    "  ",
    {},
    [],
    new Error("private request URL"),
    { response: { data: "<html><body>Debug traceback</body></html>" } },
  ]) {
    assert.equal(formatApiError(value, "عملیات انجام نشد"), "عملیات انجام نشد");
  }
});

test("recursive validation bodies are bounded and do not crash error rendering", () => {
  const circular = { detail: "نامعتبر" };
  circular.self = circular;
  assert.equal(formatApiError(circular, "خطا"), "نامعتبر");
});
