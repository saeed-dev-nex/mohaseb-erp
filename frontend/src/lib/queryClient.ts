// Stage 8: TanStack Query client for server state.
// Defaults mirror the pre-migration Redux behavior: data is revalidated
// on every mount (staleTime 0, like the old fetch-on-mount effects),
// window-focus refetch stays off (desktop LAN app; the slices never did
// it), and one retry covers transient LAN hiccups.
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
