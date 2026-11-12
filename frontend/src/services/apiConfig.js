// Keep the browser's scheme and production port (including HTTPS proxies).
export function resolveApiBaseURL(configured, location) {
  const url = configured
    ? new URL(configured, location.href)
    : new URL("/api/", location.href);
  if (!configured && ["5173", "4173"].includes(location.port))
    url.port = "8000";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

// A failed request can arrive after another request already rotated the cookie.
export function createAccessRefresher({ getAccess, refresh, saveAccess }) {
  let pending;
  return async (failedAccess) => {
    const current = getAccess();
    if (current && current !== failedAccess) return current;
    if (!pending) {
      pending = Promise.resolve()
        .then(refresh)
        .then((data) => {
          if (typeof data?.access !== "string" || !data.access.trim()) {
            throw new Error("Invalid token refresh response");
          }
          saveAccess(data.access);
          return data.access;
        })
        .finally(() => {
          pending = undefined;
        });
    }
    return pending;
  };
}
