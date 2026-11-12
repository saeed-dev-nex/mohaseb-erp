import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Exercise real React markup with the existing build tool. Server rendering
// cannot mount portals: keep their children in place for these composition
// checks. Browser focus/inert behaviour is deliberately not simulated here.
async function loadComponents(relative, extraExports = "", environment = {}) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relative, import.meta.url))],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    packages: "external",
    logLevel: "silent",
    plugins: [
      {
        name: "render-dialog-fixtures",
        setup(plugin) {
          plugin.onResolve({ filter: /^react-dom$/ }, () => ({
            path: "portal",
            namespace: "fixture",
          }));
          plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "export const createPortal = children => children; export default { createPortal };",
          }));
          plugin.onResolve({ filter: /\/services\/api$/ }, () => ({
            path: "api",
            namespace: "api-fixture",
          }));
          plugin.onLoad({ filter: /.*/, namespace: "api-fixture" }, () => ({
            contents:
              "export const chequesAPI = globalThis.__api?.chequesAPI ?? {}; export const customersAPI = {}; export const servicesAPI = globalThis.__api?.servicesAPI ?? {};",
          }));
          if (extraExports)
            plugin.onLoad(
              { filter: /pages[\\/](Services|Cheques)\.tsx$/ },
              async ({ path }) => ({
                contents: `${await readFile(path, "utf8")}\nexport { ${extraExports} };`,
                loader: "tsx",
              }),
            );
        },
      },
    ],
  });
  const module = { exports: {} };
  const require = createRequire(new URL("../package.json", import.meta.url));
  vm.runInNewContext(result.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: (name) => environment.modules?.[name] ?? require(name),
    __api: environment.api,
    document: { body: {} },
  });
  return module.exports;
}

const ui = await loadComponents("../src/components/ui.tsx");
const { ServiceModal } = await loadComponents(
  "../src/pages/Services.tsx",
  "ServiceModal",
);
const { ChequeModal } = await loadComponents(
  "../src/pages/Cheques.tsx",
  "ChequeModal",
);
const render = (Component, props) =>
  renderToStaticMarkup(React.createElement(Component, props));
const noOp = () => {};

for (const [name, Component, props] of [
  ["service", ServiceModal, { initial: null, onSave: noOp, onClose: noOp }],
  [
    "cheque",
    ChequeModal,
    { initial: null, customers: [], onSave: noOp, onClose: noOp },
  ],
  [
    "confirmation",
    ui.ConfirmDialog,
    {
      isOpen: true,
      title: "حذف",
      message: "اطمینان دارید؟",
      onConfirm: noOp,
      onClose: noOp,
    },
  ],
]) {
  test(`${name}: failure is rendered inside the dialog, not the inert page`, () => {
    const html = render(Component, { ...props, error: "عملیات انجام نشد" });
    assert.match(html, /role="dialog"/);
    assert.match(
      html.slice(html.indexOf('role="dialog"')),
      /role="alert"[^>]*>.*عملیات انجام نشد/s,
    );
  });

  test(`${name}: pending request disables cancellation and modal close`, () => {
    const html = render(Component, { ...props, saving: true, loading: true });
    const close = html.match(/<button[^>]*aria-label="بستن"[^>]*>/)?.[0];
    assert.match(close ?? "", /disabled=""/);
    assert.match(html, /<button[^>]*disabled=""[^>]*>انصراف<\/button>/);
  });

  test(`${name}: idle dialog remains dismissible without an empty alert`, () => {
    const html = render(Component, props);
    assert.doesNotMatch(html, /role="alert"/);
    const close = html.match(/<button[^>]*aria-label="بستن"[^>]*>/)?.[0];
    assert.ok(close && !close.includes("disabled"));
  });
}

test("service: visible field labels are associated with their input controls", () => {
  const html = render(ServiceModal, {
    initial: null,
    onSave: noOp,
    onClose: noOp,
  });
  const labels = [...html.matchAll(/<label[^>]*for="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.equal(labels.length, 6);
  for (const id of labels)
    assert.ok(html.includes(`id="${id}"`), `missing control for ${id}`);
});

// Isolate the page callbacks using deterministic hook state. These tests invoke
// the real async handlers twice in the same tick (before a React re-render);
// they do not pretend to test browser scheduling or DOM interactions.
function hookState(firstState, overrides = {}) {
  const slots = [];
  let cursor = 0;
  return {
    reset: () => {
      cursor = 0;
    },
    react: {
      ...React,
      useEffect: noOp,
      useRef: (initial) => {
        const index = cursor++;
        return (slots[index] ??= { current: initial });
      },
      useState: (initial) => {
        const index = cursor++;
        if (!(index in slots))
          slots[index] =
            index in overrides
              ? overrides[index]
              : index === 0 && firstState
                ? firstState
                : initial;
        return [
          slots[index],
          (value) => {
            slots[index] =
              typeof value === "function" ? value(slots[index]) : value;
          },
        ];
      },
    },
  };
}

function findElement(element, predicate) {
  if (!React.isValidElement(element)) return null;
  if (predicate(element)) return element;
  for (const child of React.Children.toArray(element.props.children)) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

for (const page of ["Services", "Cheques"]) {
  for (const operation of ["save", "delete"]) {
    test(`${page}: ${operation} sends once while pending, exposes failure and permits retry`, async () => {
      const row = {
        id: 1,
        title: "خدمت آزمایشی",
        cheque_number: "123",
        bank_name: "آزمایشی",
        amount: 1000,
        status: "pending",
        due_date: "2030-01-01",
      };
      const hooks = hookState(
        page === "Cheques" ? [row] : null,
        page === "Cheques" ? { 2: false } : {},
      );
      let requests = 0;
      let rejectRequest;
      const request = () => {
        requests++;
        return new Promise((_resolve, reject) => {
          rejectRequest = reject;
        });
      };
      const api = { create: request, update: request, delete: request };
      const queryClient = { setQueriesData: noOp, invalidateQueries: noOp };
      const query = {
        useQueryClient: () => queryClient,
        useQuery: () => ({ data: [row], isFetching: false }),
        useMutation: (options) => ({ mutateAsync: options.mutationFn }),
      };
      const { default: Page } = await loadComponents(
        `../src/pages/${page}.tsx`,
        "",
        {
          modules: { react: hooks.react, "@tanstack/react-query": query },
          api: { chequesAPI: api, servicesAPI: api },
        },
      );
      const tree = () => {
        hooks.reset();
        return Page();
      };
      const open = findElement(
        tree(),
        (element) =>
          element.type === "button" &&
          (operation === "save"
            ? String(element.props.children).includes(
                page === "Services" ? "افزودن خدمت" : "ثبت چک جدید",
              )
            : element.props.title === "حذف" ||
              String(element.props.children).includes("حذف")),
      );
      assert.ok(open, "operation control exists");
      open.props.onClick();
      const dialog = () =>
        findElement(
          tree(),
          (element) =>
            typeof element.type === "function" &&
            (operation === "save"
              ? /^(ServiceModal|ChequeModal)$/.test(element.type.name)
              : element.type.name === "ConfirmDialog"),
        );
      const invoke = () =>
        operation === "save"
          ? dialog().props.onSave({ title: "آزمایشی", amount: 1000 })
          : dialog().props.onConfirm();
      const first = invoke();
      const second = invoke();
      assert.equal(requests, 1);
      dialog().props.onClose();
      assert.ok(dialog(), "cannot dismiss a pending operation");
      rejectRequest({ response: { data: { detail: "خطای آزمایشی" } } });
      await Promise.all([first, second]);
      assert.equal(dialog().props.error, "خطای آزمایشی");
      const retry = invoke();
      assert.equal(requests, 2);
      rejectRequest({ response: { data: { detail: "دوباره تلاش کنید" } } });
      await retry;
      assert.equal(dialog().props.error, "دوباره تلاش کنید");
      dialog().props.onClose();
      assert.equal(dialog(), null);
      open.props.onClick();
      assert.equal(
        dialog().props.error,
        "",
        "opening a new operation clears the previous error",
      );
    });
  }
}

test("Services: initial load failure is not an empty list and offers a working retry", async () => {
  const hooks = hookState();
  let retries = 0;
  const { default: Page } = await loadComponents(
    "../src/pages/Services.tsx",
    "",
    {
      modules: {
        react: hooks.react,
        "@tanstack/react-query": {
          useQueryClient: () => ({}),
          useQuery: () => ({
            data: undefined,
            error: "دریافت انجام نشد",
            isFetching: false,
            refetch: () => {
              retries++;
            },
          }),
          useMutation: () => ({}),
        },
      },
    },
  );
  hooks.reset();
  const element = Page();
  assert.equal(
    findElement(
      element,
      (item) => item.type === "p" && item.props.children === "خدمتی تعریف نشده",
    ),
    null,
  );
  const notice = findElement(
    element,
    (item) => item.type.name === "ErrorNotice",
  );
  assert.equal(notice.props.message, "دریافت انجام نشد");
  const retry = findElement(
    element,
    (item) => item.props.children === "تلاش دوباره",
  );
  retry.props.onClick();
  assert.equal(retries, 1);
});
