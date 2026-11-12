const WINDOW_ID_KEY = 'quick_invoice_window_id';
const WINDOW_BOUNDS_KEY = 'quick_invoice_window_bounds';

async function getQuickInvoiceWindow() {
  const stored = await browser.storage.local.get(WINDOW_ID_KEY);
  const windowId = stored[WINDOW_ID_KEY];
  if (typeof windowId !== 'number') return null;
  try {
    return await browser.windows.get(windowId);
  } catch {
    await browser.storage.local.remove(WINDOW_ID_KEY);
    return null;
  }
}

async function toggleQuickInvoiceWindow() {
  const existing = await getQuickInvoiceWindow();
  if (existing) {
    if (existing.state === 'minimized') {
      await browser.windows.update(existing.id, { state: 'normal', focused: true });
    } else if (existing.focused) {
      await browser.windows.update(existing.id, { state: 'minimized' });
    } else {
      await browser.windows.update(existing.id, { focused: true });
    }
    return;
  }

  const stored = await browser.storage.local.get(WINDOW_BOUNDS_KEY);
  const bounds = stored[WINDOW_BOUNDS_KEY] || {};
  const options = {
    url: browser.runtime.getURL('popup.html'),
    type: 'popup',
    focused: true,
    width: Math.max(400, bounds.width || 480),
    height: Math.max(560, bounds.height || 760),
    titlePreface: 'محاسب پرو · ',
  };
  if (Number.isInteger(bounds.left)) options.left = bounds.left;
  if (Number.isInteger(bounds.top)) options.top = bounds.top;

  const created = await browser.windows.create(options);
  await browser.storage.local.set({ [WINDOW_ID_KEY]: created.id });
}

browser.browserAction.onClicked.addListener(() => {
  toggleQuickInvoiceWindow().catch((error) => console.error('Quick invoice window error:', error));
});

browser.windows.onFocusChanged.addListener(async (focusedWindowId) => {
  const stored = await browser.storage.local.get(WINDOW_ID_KEY);
  const windowId = stored[WINDOW_ID_KEY];
  if (typeof windowId !== 'number' || focusedWindowId === windowId) return;

  try {
    const invoiceWindow = await browser.windows.get(windowId);
    if (invoiceWindow.state === 'minimized') return;
    await browser.storage.local.set({
      [WINDOW_BOUNDS_KEY]: {
        left: invoiceWindow.left,
        top: invoiceWindow.top,
        width: invoiceWindow.width,
        height: invoiceWindow.height,
      },
    });
  } catch {
    // The invoice window may have closed while focus was changing.
  }
});

browser.windows.onRemoved.addListener(async (windowId) => {
  const stored = await browser.storage.local.get(WINDOW_ID_KEY);
  if (stored[WINDOW_ID_KEY] === windowId) {
    await browser.storage.local.remove(WINDOW_ID_KEY);
  }
});

browser.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'MINIMIZE_QUICK_INVOICE') return undefined;
  return getQuickInvoiceWindow()
    .then((window) => window && browser.windows.update(window.id, { state: 'minimized' }))
    .then(() => ({ ok: true }))
    .catch(() => ({ ok: false }));
});
