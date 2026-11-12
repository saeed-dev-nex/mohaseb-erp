import { configureStore } from "@reduxjs/toolkit";
import authReducer from "./features/authSlice";
import { queryClient } from "./lib/queryClient";

// Stage 8: customers/services/invoices server state moved to TanStack
// Query (see src/hooks/); Redux now holds session/UI state only.
export const store = configureStore({
  reducer: {
    auth: authReducer,
  },
});

// Server-state keys are shared across accounts: discard them at the boundary.
let previousAuth = store.getState().auth;
store.subscribe(() => {
  const next = store.getState().auth;
  if (
    (previousAuth.isAuthenticated && !next.isAuthenticated) ||
    previousAuth.currentUser?.id !== next.currentUser?.id
  )
    queryClient.clear();
  previousAuth = next;
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;
