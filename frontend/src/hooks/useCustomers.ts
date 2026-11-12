// Stage 8: TanStack Query hooks replacing customersSlice (stage 7/8
// migration). Semantics mirror the old thunks one-to-one: mutation
// rejections carry `err.response.data` (or the same Persian fallback
// string) so existing try/catch + alert code behaves identically, and
// cache updates reproduce the slice reducers (create prepends, update
// replaces by id, delete filters) across every cached list variant.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customersAPI } from "../services/api";
import type { Id, Params, Payload } from "../services/api";

export interface Customer {
  id: number;
  [key: string]: unknown;
}

export const customerKeys = {
  all: ["customers"] as const,
  list: (params: Params = {}) => ["customers", params] as const,
};

// Mirrors the thunks' rejectWithValue(err.response?.data || fallback).
function apiError(err: unknown, fallback: string): unknown {
  const data = (err as { response?: { data?: unknown } } | null)?.response
    ?.data;
  return data || fallback;
}

export function useCustomers(params: Params = {}) {
  return useQuery({
    queryKey: customerKeys.list(params),
    queryFn: async (): Promise<Customer[]> => {
      try {
        const res = await customersAPI.list(params);
        return res.data as Customer[];
      } catch (err) {
        throw apiError(err, "خطا در دریافت مشتریان");
      }
    },
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Payload): Promise<Customer> => {
      try {
        const res = await customersAPI.create(data);
        return res.data as Customer;
      } catch (err) {
        throw apiError(err, "خطا در ایجاد مشتری");
      }
    },
    onSuccess: (created) => {
      qc.setQueriesData<Customer[]>({ queryKey: customerKeys.all }, (old) =>
        Array.isArray(old) ? [created, ...old] : old,
      );
    },
  });
}

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: Id;
      data: Payload;
    }): Promise<Customer> => {
      try {
        const res = await customersAPI.update(id, data);
        return res.data as Customer;
      } catch (err) {
        throw apiError(err, "خطا در ویرایش مشتری");
      }
    },
    onSuccess: (updated) => {
      qc.setQueriesData<Customer[]>({ queryKey: customerKeys.all }, (old) =>
        Array.isArray(old)
          ? old.map((c) => (c.id === updated.id ? updated : c))
          : old,
      );
    },
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: Id): Promise<Id> => {
      try {
        await customersAPI.delete(id);
        return id;
      } catch (err) {
        throw apiError(err, "خطا در حذف مشتری");
      }
    },
    onSuccess: (deletedId) => {
      qc.setQueriesData<Customer[]>({ queryKey: customerKeys.all }, (old) =>
        Array.isArray(old) ? old.filter((c) => c.id !== deletedId) : old,
      );
    },
  });
}
