import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import Cookies from "js-cookie";
import {
  businessesAPI,
  BUSINESS_STORAGE_KEY,
  type Business,
} from "../services/api";

/**
 * Current-business context (ERP phase 0). The selected business id is
 * kept in localStorage; the axios interceptor attaches it as the
 * X-Business-Id header, and switching invalidates every query so all
 * lists re-scope to the newly selected business.
 */
type BusinessContextValue = {
  businesses: Business[];
  current: Business | null;
  loading: boolean;
  switchTo: (id: number) => void;
  refresh: () => Promise<void>;
};

const BusinessContext = createContext<BusinessContextValue>({
  businesses: [],
  current: null,
  loading: true,
  switchTo: () => {},
  refresh: async () => {},
});

export const useBusiness = () => useContext(BusinessContext);

const readStoredId = (): number | null => {
  try {
    const raw = window.localStorage.getItem(BUSINESS_STORAGE_KEY);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
};

export const BusinessProvider = ({ children }: { children: ReactNode }) => {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(readStoredId);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const refresh = useCallback(async () => {
    // Without a session there is nothing to fetch; asking anyway
    // produces a 401 that the auth layer would try to "repair".
    if (!Cookies.get("access_token")) {
      setBusinesses([]);
      setLoading(false);
      return;
    }
    try {
      const { data } = await businessesAPI.list();
      setBusinesses(data);
      setCurrentId((previous) => {
        if (previous && data.some((b) => b.id === previous)) return previous;
        const fallback = data[0]?.id ?? null;
        try {
          if (fallback) {
            window.localStorage.setItem(BUSINESS_STORAGE_KEY, String(fallback));
          } else {
            window.localStorage.removeItem(BUSINESS_STORAGE_KEY);
          }
        } catch {
          /* Storage may be unavailable. */
        }
        return fallback;
      });
    } catch {
      // Not logged in yet, or the endpoint is unreachable: stay empty;
      // the app keeps its pre-ERP single-business behaviour.
      setBusinesses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const switchTo = useCallback(
    (id: number) => {
      setCurrentId(id);
      try {
        window.localStorage.setItem(BUSINESS_STORAGE_KEY, String(id));
      } catch {
        /* Storage may be unavailable. */
      }
      void queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const value = useMemo<BusinessContextValue>(
    () => ({
      businesses,
      current: businesses.find((b) => b.id === currentId) ?? null,
      loading,
      switchTo,
      refresh,
    }),
    [businesses, currentId, loading, switchTo, refresh],
  );

  return (
    <BusinessContext.Provider value={value}>
      {children}
    </BusinessContext.Provider>
  );
};
