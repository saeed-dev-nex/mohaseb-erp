// Stage 8: TanStack Query hooks replacing invoicesSlice. The list is an
// infinite query mirroring the slice's paginated accumulation: pages
// append with id-dedup, `count` comes from the paginated payload, and a
// plain-array payload (pagination is opt-in on the backend) is treated
// as a single full page exactly like the slice did. Mutations reproduce
// the slice reducers across every cached page: create prepends to the
// first page, update replaces by id, markPaid/cancel flip `status`,
// delete filters. Rejection values mirror rejectWithValue.
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { invoicesAPI } from "../services/api";
import type { Id, Params, Payload } from "../services/api";

export interface Invoice {
  id: number;
  status?: string;
  [key: string]: unknown;
}

export interface InvoicePage {
  results: Invoice[];
  count?: number;
  next?: string | null;
}

type InvoicePageData = Invoice[] | InvoicePage;
type InvoiceInfiniteData = InfiniteData<InvoicePageData, number>;

export const invoiceKeys = {
  all: ["invoices"] as const,
  list: (filters: Params = {}) => ["invoices", filters] as const,
};

// Mirrors the thunks' rejectWithValue(err.response?.data || fallback).
function apiError(err: unknown, fallback: string): unknown {
  const data = (err as { response?: { data?: unknown } } | null)?.response
    ?.data;
  return data || fallback;
}

function pageItems(page: InvoicePageData): Invoice[] {
  return Array.isArray(page) ? page : (page.results ?? []);
}

function mapPage(
  page: InvoicePageData,
  fn: (items: Invoice[]) => Invoice[],
): InvoicePageData {
  return Array.isArray(page)
    ? fn(page)
    : { ...page, results: fn(page.results ?? []) };
}

// Apply a list transform to every cached invoices list; `firstPageOnly`
// restricts it to page 1 of each infinite query (the create case).
function transformInvoiceLists(
  qc: QueryClient,
  fn: (items: Invoice[]) => Invoice[],
  firstPageOnly = false,
) {
  qc.setQueriesData<InvoiceInfiniteData>(
    { queryKey: invoiceKeys.all },
    (old) => {
      if (!old || !Array.isArray(old.pages)) return old;
      return {
        ...old,
        pages: old.pages.map((page, idx) =>
          firstPageOnly && idx > 0 ? page : mapPage(page, fn),
        ),
      };
    },
  );
}

export function useInvoicesInfinite(filters: Params = {}) {
  const query = useInfiniteQuery({
    queryKey: invoiceKeys.list(filters),
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<InvoicePageData> => {
      try {
        const res = await invoicesAPI.list({ ...filters, page: pageParam });
        return res.data as InvoicePageData;
      } catch (err) {
        throw apiError(err, "خطا در دریافت فاکتورها");
      }
    },
    getNextPageParam: (lastPage, pages) =>
      Array.isArray(lastPage)
        ? undefined
        : lastPage?.next
          ? pages.length + 1
          : undefined,
  });

  // Flatten pages with the slice's id-dedup accumulation.
  const pages = query.data?.pages ?? [];
  const seen = new Set<number>();
  const list: Invoice[] = [];
  for (const page of pages) {
    for (const item of pageItems(page)) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        list.push(item);
      }
    }
  }
  const lastPage = pages[pages.length - 1];
  const count =
    lastPage && !Array.isArray(lastPage) && typeof lastPage.count === "number"
      ? lastPage.count
      : list.length;

  return {
    ...query,
    list,
    count,
    // Slice-compatible names used by the invoices page.
    loading: query.isLoading,
    loadingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage,
  };
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Payload): Promise<Invoice> => {
      try {
        const res = await invoicesAPI.create(data);
        return res.data as Invoice;
      } catch (err) {
        throw apiError(err, "خطا در ثبت فاکتور");
      }
    },
    onSuccess: (created) => {
      transformInvoiceLists(qc, (items) => [created, ...items], true);
    },
  });
}

export function useUpdateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: Id;
      data: Payload;
    }): Promise<Invoice> => {
      try {
        const res = await invoicesAPI.update(id, data);
        return res.data as Invoice;
      } catch (err) {
        throw apiError(err, "خطا در ویرایش فاکتور");
      }
    },
    onSuccess: (updated) => {
      transformInvoiceLists(qc, (items) =>
        items.map((inv) => (inv.id === updated.id ? updated : inv)),
      );
    },
  });
}

export function useMarkInvoicePaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: Id): Promise<Id> => {
      try {
        await invoicesAPI.markPaid(id);
        return id;
      } catch (err) {
        throw apiError(err, "خطا");
      }
    },
    onSuccess: (paidId) => {
      transformInvoiceLists(qc, (items) =>
        items.map((inv) =>
          inv.id === paidId
            ? {
                ...inv,
                status: "paid",
                paid_amount: inv.final_amount,
                remaining_amount: 0,
              }
            : inv,
        ),
      );
    },
  });
}

export function useCancelInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: Id): Promise<Id> => {
      try {
        await invoicesAPI.cancel(id);
        return id;
      } catch (err) {
        throw apiError(err, "خطا");
      }
    },
    onSuccess: (cancelledId) => {
      transformInvoiceLists(qc, (items) =>
        items.map((inv) =>
          inv.id === cancelledId ? { ...inv, status: "cancelled" } : inv,
        ),
      );
    },
  });
}

export function useDeleteInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: Id): Promise<Id> => {
      try {
        await invoicesAPI.delete(id);
        return id;
      } catch (err) {
        throw apiError(err, "خطا در حذف فاکتور");
      }
    },
    onSuccess: (deletedId) => {
      transformInvoiceLists(qc, (items) =>
        items.filter((inv) => inv.id !== deletedId),
      );
    },
  });
}
