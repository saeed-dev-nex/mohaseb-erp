import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { repositoryFonts, FONT_NAMES } from "../build/fonts.js";

const workerSource = readFileSync(
  new URL("../public/service-worker.js", import.meta.url),
  "utf8",
);
function worker() {
  const handlers = {};
  const writes = [];
  const deleted = [];
  const entries = new Map();
  const cache = {
    put: async (key, value) => {
      writes.push(key);
      entries.set(key, value);
    },
    match: async (key) => entries.get(key),
    addAll: async () => {},
  };
  const context = vm.createContext({
    URL,
    Response,
    self: {
      location: { origin: "https://app.test" },
      addEventListener: (name, fn) => {
        handlers[name] = fn;
      },
      skipWaiting() {},
      clients: { claim() {} },
    },
    caches: {
      open: async () => cache,
      keys: async () => ["mohaseb-pro-shell-v3.1.0", "other-app"],
      delete: async (name) => deleted.push(name),
    },
    fetch: async () =>
      new Response("static", {
        headers: { "content-type": "text/javascript" },
      }),
  });
  vm.runInContext(workerSource, context);
  return { context, handlers, writes, deleted, entries };
}
const request = (path, extras = {}) => ({
  url: `https://app.test${path}`,
  method: "GET",
  mode: "cors",
  headers: new Headers(),
  ...extras,
});

test("worker never handles API/media/authenticated responses, even navigations or offline requests", () => {
  const { handlers } = worker();
  for (const item of [
    request("/api/customers/"),
    request("/media/private.pdf"),
    request("/api/chat/", { mode: "navigate" }),
    request("/customers/42", {
      headers: new Headers({ Authorization: "Bearer secret" }),
      mode: "navigate",
    }),
    request("/assets/index.js?token=secret"),
    request("/unknown/private"),
    request("/favicon.svg", { method: "POST" }),
    request("/assets/index.js", {
      url: "https://another.test/assets/index.js",
    }),
  ]) {
    let handled = false;
    handlers.fetch({
      request: item,
      respondWith: () => {
        handled = true;
      },
    });
    assert.equal(handled, false, item.url);
  }
});

test("worker caches only static assets/shell and rejects private replies or missing chunk HTML", async () => {
  const { context, handlers, writes } = worker();
  const dispatch = async (item) => {
    let result;
    handlers.fetch({
      request: item,
      respondWith: (promise) => {
        result = promise;
      },
    });
    return result;
  };
  await dispatch(request("/assets/app-123.js"));
  assert.deepEqual(writes, ["/assets/app-123.js"]);
  context.fetch = async () =>
    new Response("{}", {
      headers: {
        "content-type": "text/javascript",
        "cache-control": "private",
      },
    });
  await dispatch(request("/assets/private.js"));
  context.fetch = async () =>
    new Response("<html>fallback</html>", {
      headers: { "content-type": "text/html" },
    });
  assert.equal((await dispatch(request("/assets/missing.js"))).status, 404);
  await dispatch(request("/customers/42", { mode: "navigate" }));
  assert.deepEqual(writes, ["/assets/app-123.js", "/index.html"]);
  context.fetch = async () => {
    throw new Error("offline");
  };
  assert.equal(
    (await dispatch(request("/invoices/42", { mode: "navigate" }))).status,
    200,
  );
  assert.deepEqual(writes, ["/assets/app-123.js", "/index.html"]);
});

test("activation removes old application caches containing authenticated data", async () => {
  const { handlers, deleted } = worker();
  let pending;
  handlers.activate({
    waitUntil: (value) => {
      pending = value;
    },
  });
  await pending;
  assert.deepEqual(deleted, ["mohaseb-pro-shell-v3.1.0"]);
});

test("all CSS/service-worker fonts emit from repository sources and dev serves exact bytes", () => {
  const plugin = repositoryFonts();
  const emitted = [];
  plugin.generateBundle.call({ emitFile: (asset) => emitted.push(asset) });
  const css = readFileSync(
    new URL("../src/fonts.css", import.meta.url),
    "utf8",
  );
  let middleware;
  plugin.configureServer({
    middlewares: {
      use: (callback) => {
        middleware = callback;
      },
    },
  });
  for (const name of FONT_NAMES) {
    const expected = readFileSync(
      new URL(`../public/fonts/${name}`, import.meta.url),
    );
    assert.deepEqual(
      emitted.find((asset) => asset.fileName === `fonts/${name}`).source,
      expected,
    );
    assert.ok(css.includes(`/fonts/${name}`));
    assert.ok(workerSource.includes(`/fonts/${name}`));
    let body;
    const headers = {};
    middleware(
      { method: "GET", url: `/fonts/${name}` },
      {
        setHeader: (key, value) => {
          headers[key] = value;
        },
        end: (value) => {
          body = value;
        },
      },
      () => assert.fail("Font was not served"),
    );
    assert.equal(headers["Content-Type"], "font/woff2");
    assert.deepEqual(body, expected);
    assert.equal(expected.subarray(0, 4).toString(), "wOF2");
  }
  let passed = false;
  middleware({ method: "GET", url: "/fonts/not-public.txt" }, {}, () => {
    passed = true;
  });
  assert.equal(passed, true);
});

test(
  "production build includes exact font bytes, CSS URLs and the current safe service worker",
  {
    skip: !existsSync(new URL("../dist/index.html", import.meta.url)),
  },
  () => {
    for (const name of FONT_NAMES) {
      assert.deepEqual(
        readFileSync(new URL(`../dist/fonts/${name}`, import.meta.url)),
        readFileSync(new URL(`../public/fonts/${name}`, import.meta.url)),
      );
    }
    const assets = new URL("../dist/assets/", import.meta.url);
    const css = readdirSync(assets)
      .filter((name) => name.endsWith(".css"))
      .map((name) => readFileSync(new URL(name, assets), "utf8"))
      .join("\n");
    for (const name of FONT_NAMES) assert.ok(css.includes(`/fonts/${name}`));
    assert.equal(
      readFileSync(
        new URL("../dist/service-worker.js", import.meta.url),
        "utf8",
      ),
      workerSource,
    );
  },
);
