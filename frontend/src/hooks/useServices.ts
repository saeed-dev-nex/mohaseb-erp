// Stage 8: TanStack Query hooks replacing servicesSlice. Same contract
// as useCustomers (rejection payloads and cache transforms mirror the
// old thunks/reducers; note create APPENDS here, as the slice did).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { servicesAPI } from "../services/api";
import type { Id, Params, Payload } from "../services/api";

export interface Service {
  id: number;
  [key: string]: unknown;
}

export const serviceKeys = {
  all: ["services"] as const,
  list: (params: Params = {}) => ["services", params] as const,
};

// Mirrors the thunks' rejectWithValue(err.response?.data || fallback).
function apiError(err: unknown, fallback: string): unknown {
  const data = (err as { response?: { data?: unknown } } | null)?.response
    ?.data;
  return data || fallback;
}

export function useServices(params: Params = {}) {
  return useQuery({
    queryKey: serviceKeys.list(params),
    queryFn: async (): Promise<Service[]> => {
      try {
        const res = await servicesAPI.list(params);
        return res.data as Service[];
      } catch (err) {
        throw apiError(err, "خطا در دریافت خدمات");
      }
    },
  });
}

export function useCreateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Payload): Promise<Service> => {
      try {
        const res = await servicesAPI.create(data);
        return res.data as Service;
      } catch (err) {
        throw apiError(err, "خطا در ایجاد خدمت");
      }
    },
    onSuccess: (created) => {
      qc.setQueriesData<Service[]>({ queryKey: serviceKeys.all }, (old) =>
        Array.isArray(old) ? [...old, created] : old,
      );
    },
  });
}

export function useUpdateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: Id;
      data: Payload;
    }): Promise<Service> => {
      try {
        const res = await servicesAPI.update(id, data);
        return res.data as Service;
      } catch (err) {
        throw apiError(err, "خطا در ویرایش خدمت");
      }
    },
    onSuccess: (updated) => {
      qc.setQueriesData<Service[]>({ queryKey: serviceKeys.all }, (old) =>
        Array.isArray(old)
          ? old.map((s) => (s.id === updated.id ? updated : s))
          : old,
      );
    },
  });
}

export function useDeleteService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: Id): Promise<Id> => {
      try {
        await servicesAPI.delete(id);
        return id;
      } catch (err) {
        throw apiError(err, "خطا در حذف خدمت");
      }
    },
    onSuccess: (deletedId) => {
      qc.setQueriesData<Service[]>({ queryKey: serviceKeys.all }, (old) =>
        Array.isArray(old) ? old.filter((s) => s.id !== deletedId) : old,
      );
    },
  });
}
