import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

class Element {
  children = [];
  selectors = new Map();
  listeners = {};
  style = {};
  dataset = {};
  value = "";
  className = "";
  textContent = "";
  addEventListener(name, callback) {
    this.listeners[name] = callback;
  }
  append(...children) {
    this.children.push(...children);
  }
  appendChild(child) {
    this.append(child);
  }
  replaceChildren(...children) {
    this.children = children;
  }
  querySelector(selector) {
    if (!this.selectors.has(selector))
      this.selectors.set(selector, new Element());
    return this.selectors.get(selector);
  }
  querySelectorAll() {
    return [];
  }
  cloneNode() {
    return new Element();
  }
  set innerHTML(_) {
    throw new Error("Untrusted markup must never be parsed");
  }
}

async function popup(kind) {
  const stores = { local: {}, session: {} };
  const storageArea = (name) => ({
    get: (keys, callback) => {
      const value = Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((key) => [
          key,
          stores[name][key],
        ]),
      );
      if (callback) callback(value);
      else return Promise.resolve(value);
    },
    set: (values, callback) => {
      Object.assign(stores[name], values);
      if (callback) callback();
      else return Promise.resolve();
    },
    remove: (key, callback) => {
      delete stores[name][key];
      if (callback) callback();
      else return Promise.resolve();
    },
  });
  const elements = new Map();
  const document = {
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    querySelectorAll: () => [],
    createElement: () => new Element(),
    addEventListener() {},
  };
  document.getElementById("item-row-template").content = {
    firstElementChild: new Element(),
  };
  const timers = [];
  const context = vm.createContext({
    document,
    Intl,
    console,
    chrome: {
      storage: { local: storageArea("local"), session: storageArea("session") },
    },
    browser: {
      storage: { local: storageArea("local"), session: storageArea("session") },
    },
    setTimeout: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
    fetch: async () => {
      throw new Error("Unexpected fetch");
    },
  });
  vm.runInContext(
    readFileSync(
      new URL(`../../${kind}-extension/popup.js`, import.meta.url),
      "utf8",
    ),
    context,
  );
  await new Promise(setImmediate); // Finish the logged-out startup before seeding synthetic auth.
  return { context, stores, document, timers };
}

for (const kind of ["chrome", "firefox"]) {
  for (const remember of [false, true]) {
    test(`${kind}: two consecutive renewals persist rotated refresh in ${remember ? "local" : "session"} storage`, async () => {
      const { context, stores } = await popup(kind);
      const area = remember ? "local" : "session";
      stores[area].access_token = "access-0";
      stores[area].refresh_token = "refresh-0";
      let renewals = 0;
      let endpointCalls = 0;
      context.fetch = async (url, options) => {
        if (url.endsWith("token/refresh/")) {
          assert.equal(JSON.parse(options.body).refresh, `refresh-${renewals}`);
          renewals++;
          return {
            ok: true,
            json: async () => ({
              access: `access-${renewals}`,
              refresh: `refresh-${renewals}`,
            }),
          };
        }
        endpointCalls++;
        if (endpointCalls % 2) return { status: 401 };
        assert.equal(
          options.headers.Authorization,
          `Bearer access-${renewals}`,
        );
        return { ok: true, json: async () => ({ success: true }) };
      };
      await context.apiRequest("services/");
      await context.apiRequest("services/");
      assert.equal(renewals, 2);
      assert.equal(stores[area].refresh_token, "refresh-2");
      assert.equal(stores[area].access_token, "access-2");
      assert.deepEqual(stores[remember ? "session" : "local"], {});
    });
  }

  test(`${kind}: permission errors after renewal remain failures`, async () => {
    const { context, stores } = await popup(kind);
    stores.local.refresh_token = "refresh";
    let calls = 0;
    context.fetch = async (url) =>
      url.endsWith("token/refresh/")
        ? {
            ok: true,
            json: async () => ({ access: "new", refresh: "rotated" }),
          }
        : ++calls === 1
          ? { status: 401 }
          : {
              status: 403,
              ok: false,
              json: async () => ({ detail: "Denied" }),
            };
    await assert.rejects(context.apiRequest("services/"), /Denied/);
  });

  test(`${kind}: draft, customer and service markup stays literal DOM text/values`, async () => {
    const { context, document, timers } = await popup(kind);
    const payload = '\"><img src=x onerror=alert(1)>';
    context.addItemRow({ title: payload, mainPrice: payload, qty: payload });
    const row = document.getElementById("items-container").children[0];
    assert.equal(row.querySelector(".item-title").value, payload);
    assert.equal(row.querySelector(".item-main-price").value, payload);
    context.apiRequest = async () => [{ name: payload, phone: payload }];
    await document
      .getElementById("customer-name")
      .listeners.input({ target: { value: "search" } });
    await timers.pop()();
    const customer = document.getElementById("customer-suggestions")
      .children[0];
    assert.equal(customer.children[0].textContent, payload);
    assert.equal(customer.children[1].textContent, payload);
    context.serviceFixture = payload;
    vm.runInContext(
      "services = [{ is_active: true, title: serviceFixture, default_main_price: 1 }]",
      context,
    );
    row
      .querySelector(".item-title")
      .listeners.input({ target: { value: "img" } });
    await timers.pop()();
    assert.equal(
      row.querySelector(".svc-suggestions").children[0].children[0].textContent,
      payload,
    );
    row.querySelector(".svc-picker-toggle").listeners.click();
    assert.equal(
      row.querySelector(".svc-picker-list").children[0].children[0].textContent,
      payload,
    );
    const html = readFileSync(
      new URL(`../../${kind}-extension/popup.html`, import.meta.url),
      "utf8",
    );
    assert.ok(html.includes('<template id="item-row-template">'));
  });
}
