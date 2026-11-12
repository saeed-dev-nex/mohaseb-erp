import { invoicesAPI } from "../services/api";

// Offline queue for quick invoices (IndexedDB).
//
// Scope is deliberately narrow: only quick-invoice *creation* is queued.
// Each queued payload carries the idempotency key that was generated for
// its draft, so when the queue flushes after reconnect — or a submit is
// retried by hand — the server returns the original invoice instead of
// issuing a duplicate (see IdempotentSubmission on the backend).

export type QueuedQuickInvoice = {
  key: string;
  payload: Record<string, unknown>;
  queuedAt: number;
};

const DB_NAME = "mohaseb-offline";
const STORE = "quick-invoice-queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export function enqueueQuickInvoice(entry: QueuedQuickInvoice): Promise<void> {
  return withStore("readwrite", (store) => store.put(entry)).then(
    () => undefined,
  );
}

export function listQueuedQuickInvoices(): Promise<QueuedQuickInvoice[]> {
  return withStore("readonly", (store) => store.getAll()).then((items) =>
    (items as QueuedQuickInvoice[]).sort((a, b) => a.queuedAt - b.queuedAt),
  );
}

export function removeQueuedQuickInvoice(key: string): Promise<void> {
  return withStore("readwrite", (store) => store.delete(key)).then(
    () => undefined,
  );
}

export async function countQueuedQuickInvoices(): Promise<number> {
  const items = await listQueuedQuickInvoices().catch(() => []);
  return items.length;
}

// Send every queued invoice, oldest first. Returns the invoice numbers
// that were accepted. Stops at the first network failure (still offline);
// server rejections keep their item queued so nothing is silently lost.
export async function flushQuickInvoiceQueue(): Promise<string[]> {
  const items = await listQueuedQuickInvoices().catch(
    () => [] as QueuedQuickInvoice[],
  );
  const flushed: string[] = [];
  for (const item of items) {
    try {
      const { data } = await invoicesAPI.quickCreate(item.payload);
      await removeQueuedQuickInvoice(item.key);
      if (data?.invoice?.invoice_number) {
        flushed.push(String(data.invoice.invoice_number));
      }
    } catch (e) {
      if (!(e as { response?: unknown })?.response) break;
    }
  }
  return flushed;
}
