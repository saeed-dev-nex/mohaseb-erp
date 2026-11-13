import test from "node:test";
import assert from "node:assert/strict";
import { isPasswordValid, passwordChecks } from "../src/lib/passwordPolicy.js";

test("password policy mirrors the backend complexity rules", () => {
  assert.equal(isPasswordValid("Str0ng!Pass"), true);
  assert.equal(isPasswordValid("weak"), false);
  assert.equal(isPasswordValid("alllowercase1!"), false); // no upper
  assert.equal(isPasswordValid("ALLUPPERCASE1!"), false); // no lower
  assert.equal(isPasswordValid("NoDigits!Here"), false); // no digit
  assert.equal(isPasswordValid("NoSpecial123"), false); // no special
  assert.equal(isPasswordValid("Ab1!"), false); // too short
  const checks = passwordChecks("Abcdef1!");
  assert.equal(checks.length, 5);
  assert.ok(checks.every((check) => check.ok));
});
