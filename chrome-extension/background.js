const WINDOW_ID_KEY = 'quick_invoice_window_id';
const WINDOW_BOUNDS_KEY = 'quick_invoice_window_bounds';

const getLocal = (key) => new Promise((resolve) => {
  chrome.storage.local.get([key], (data) => resolve(data[key]));
});

const setLocal = (key, value) => new Promise((resolve) => {
  chrome.storage.local.set({ [key]: value }, resolve);
});

async function getQuickInvoiceWindow() {
  const windowId = await getLocal(WINDOW_ID_KEY);
  if (typeof windowId !== 'number') return null;
  try {
    return await chrome.windows.get(windowId);
  } catch {
    await chrome.storage.local.remove(WINDOW_ID_KEY);
    return null;
  }
}

async function toggleQuickInvoiceWindow() {
  const existing = await getQuickInvoiceWindow();
  if (existing) {
    if (existing.state === 'minimized') {
      await chrome.windows.update(existing.id, { state: 'normal', focused: true });
    } else if (existing.focused) {
      await chrome.windows.update(existing.id, { state: 'minimized' });
    } else {
      await chrome.windows.update(existing.id, { focused: true });
    }
    return;
  }

  const bounds = await getLocal(WINDOW_BOUNDS_KEY) || {};
  const windowOptions = {
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    focused: true,
    width: Math.max(400, bounds.width || 480),
    height: Math.max(560, bounds.height || 760),
  };
  if (Number.isInteger(bounds.left)) windowOptions.left = bounds.left;
  if (Number.isInteger(bounds.top)) windowOptions.top = bounds.top;

  const created = await chrome.windows.create(windowOptions);
  await setLocal(WINDOW_ID_KEY, created.id);
}

chrome.action.onClicked.addListener(() => {
  toggleQuickInvoiceWindow().catch((error) => console.error('Quick invoice window error:', error));
});

chrome.windows.onBoundsChanged.addListener(async (changedWindow) => {
  if (changedWindow.state === 'minimized') return;
  const windowId = await getLocal(WINDOW_ID_KEY);
  if (windowId !== changedWindow.id) return;
  await setLocal(WINDOW_BOUNDS_KEY, {
    left: changedWindow.left,
    top: changedWindow.top,
    width: changedWindow.width,
    height: changedWindow.height,
  });
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const currentId = await getLocal(WINDOW_ID_KEY);
  if (currentId === windowId) await chrome.storage.local.remove(WINDOW_ID_KEY);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'MINIMIZE_QUICK_INVOICE') return false;

  getLocal(WINDOW_ID_KEY)
    .then((windowId) => {
      if (typeof windowId !== 'number') return;
      return chrome.windows.update(windowId, { state: 'minimized' });
    })
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false }));
  return true;
});
