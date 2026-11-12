import test from "node:test";
import assert from "node:assert/strict";
import {
  createAccessRefresher,
  resolveApiBaseURL,
} from "../src/services/apiConfig.js";
import { startVisibilityPoll } from "../src/utils/visibilityPoll.js";

test("API base preserves production protocol/port, supports relative config and dev/preview ports", () => {
  for (const [configured, page, expected] of [
    [
      undefined,
      "https://example.test:8443/customers/42",
      "https://example.test:8443/api/",
    ],
    [undefined, "http://192.0.2.1:5173/login", "http://192.0.2.1:8000/api/"],
    [undefined, "https://example.test:4173/", "https://example.test:8000/api/"],
    [
      "/api",
      "https://example.test:8443/login",
      "https://example.test:8443/api/",
    ],
    [
      "../gateway/api/",
      "https://example.test/app/login",
      "https://example.test/gateway/api/",
    ],
    [
      "https://api.example.test/v1/api",
      "https://example.test/",
      "https://api.example.test/v1/api/",
    ],
  ])
    assert.equal(resolveApiBaseURL(configured, new URL(page)), expected);
});

test("parallel 401s rotate once and late failures reuse the already refreshed access", async () => {
  let access = "old";
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const refresh = createAccessRefresher({
    getAccess: () => access,
    refresh: async () => {
      calls++;
      await gate;
      return { access: "rotated" };
    },
    saveAccess: (value) => {
      access = value;
    },
  });
  const requests = Array.from({ length: 8 }, () => refresh("old"));
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await Promise.all(requests), Array(8).fill("rotated"));
  assert.equal(await refresh("old"), "rotated");
  assert.equal(calls, 1);
});

test("malformed refresh responses never save access and a failed flight can retry", async () => {
  let calls = 0;
  const saved = [];
  const refresh = createAccessRefresher({
    getAccess: () => "old",
    refresh: async () =>
      ++calls === 1 ? { detail: "invalid" } : { access: "new" },
    saveAccess: (value) => saved.push(value),
  });
  await assert.rejects(refresh("old"), /Invalid token refresh/);
  assert.deepEqual(saved, []);
  assert.equal(await refresh("old"), "new");
});

test("visibility polling uses 15s/60s intervals, never overlaps, aborts and suppresses rescheduling on teardown", async () => {
  let visibility;
  let pending;
  let calls = 0;
  let signal;
  const timers = new Map();
  let sequence = 0;
  const document = {
    hidden: false,
    addEventListener: (_, callback) => {
      visibility = callback;
    },
    removeEventListener: () => {
      visibility = undefined;
    },
  };
  const stop = startVisibilityPoll(
    async (value) => {
      signal = value;
      calls++;
      await new Promise((resolve) => {
        pending = resolve;
      });
    },
    {
      document,
      setTimeout: (callback, delay) => {
        const id = ++sequence;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  visibility();
  visibility();
  assert.equal(calls, 1);
  pending();
  await new Promise(setImmediate);
  assert.equal([...timers.values()][0].delay, 15000);
  document.hidden = true;
  visibility();
  assert.equal([...timers.values()][0].delay, 60000);
  document.hidden = false;
  visibility();
  assert.equal(calls, 2);
  stop();
  assert.equal(signal.aborted, true);
  pending();
  await new Promise(setImmediate);
  assert.equal(timers.size, 0);
  assert.equal(visibility, undefined);
});
