import axios from "axios";
import Cookies from "js-cookie";
import { createAccessRefresher, resolveApiBaseURL } from "./apiConfig";
import { queryClient } from "../lib/queryClient";

// Stage 7 (gradual TypeScript migration): shared shapes for the API layer.
// Payloads stay intentionally loose (`Record<string, unknown>` / FormData)
// while ids and params are typed; response bodies are typed by callers
// as pages migrate.

export type Id = number | string;
export type Params = Record<string, unknown>;
export type Payload = Record<string, unknown> | FormData;

export const API_BASE_URL: string = resolveApiBaseURL(
  import.meta.env.VITE_API_URL,
  window.location,
);

const api = axios.create({ baseURL: API_BASE_URL });
const refreshAccess = createAccessRefresher({
  getAccess: () => Cookies.get("access_token"),
  refresh: async () =>
    (
      await axios.post(
        `${API_BASE_URL}token/refresh/`,
        {},
        {
          withCredentials: true,
          headers: { "X-Client-Type": "web" },
          timeout: 15000,
        },
      )
    ).data,
  saveAccess: (access: string) =>
    Cookies.set("access_token", access, { sameSite: "lax" }),
});

// Request interceptor - attach token
api.interceptors.request.use((config) => {
  const token = Cookies.get("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response interceptor - handle 401 with refresh.
// The refresh token lives in an httpOnly cookie set by the backend, so the
// refresh call is credentialed and sends no token from JavaScript storage.
api.interceptors.response.use(
  (response) => response,
  async (error: any) => {
    if (
      error.response?.status === 401 &&
      !error.config?.url?.includes("token/") &&
      !error.config?._retriedAfterRefresh
    ) {
      error.config._retriedAfterRefresh = true;
      try {
        const failedAccess = String(
          error.config.headers?.Authorization || "",
        ).replace(/^Bearer /, "");
        const access = await refreshAccess(failedAccess);
        error.config.headers.Authorization = `Bearer ${access}`;
        return api.request(error.config);
      } catch {
        Cookies.remove("access_token");
        Cookies.remove("refresh_token");
        localStorage.removeItem("mohaseb_user");
        queryClient.clear();
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  },
);

// ---- Auth ----
export const authAPI = {
  // Blacklists the refresh token on the server and clears its httpOnly cookie.
  logout: () =>
    api.post(
      "token/logout/",
      {},
      { withCredentials: true, headers: { "X-Client-Type": "web" } },
    ),
};

// ---- Customers ----
export const customersAPI = {
  list: (params: Params = {}) => api.get("customers/", { params }),
  detail: (id: Id) => api.get(`customers/${id}/`),
  create: (data: Payload) => api.post("customers/", data),
  update: (id: Id, data: Payload) => api.put(`customers/${id}/`, data),
  patch: (id: Id, data: Payload) => api.patch(`customers/${id}/`, data),
  delete: (id: Id) => api.delete(`customers/${id}/`),
  invoices: (id: Id) => api.get(`customers/${id}/invoices/`),
  searchByVehicle: (params: Params) =>
    api.get("customers/search_by_vehicle/", { params }),
};

// ---- Services ----
export const servicesAPI = {
  list: (params: Params = {}) => api.get("services/", { params }),
  create: (data: Payload) => api.post("services/", data),
  update: (id: Id, data: Payload) => api.put(`services/${id}/`, data),
  patch: (id: Id, data: Payload) => api.patch(`services/${id}/`, data),
  delete: (id: Id) => api.delete(`services/${id}/`),
};

export const servicePackagesAPI = {
  list: (params: Params = {}) => api.get("service-packages/", { params }),
  create: (data: Payload) => api.post("service-packages/", data),
  update: (id: Id, data: Payload) => api.put(`service-packages/${id}/`, data),
  delete: (id: Id) => api.delete(`service-packages/${id}/`),
};

// ---- Invoices ----
export const invoicesAPI = {
  list: (params: Params = {}) => api.get("invoices/", { params }),
  detail: (id: Id) => api.get(`invoices/${id}/`),
  create: (data: Payload) => api.post("invoices/", data),
  update: (id: Id, data: Payload) => api.put(`invoices/${id}/`, data),
  patch: (id: Id, data: Payload) => api.patch(`invoices/${id}/`, data),
  delete: (id: Id) => api.delete(`invoices/${id}/`),
  markPaid: (id: Id) => api.post(`invoices/${id}/mark_paid/`),
  markCommissionPaid: (id: Id, commission_paid: boolean = true) =>
    api.post(`invoices/${id}/mark_commission_paid/`, { commission_paid }),
  cancel: (id: Id) => api.post(`invoices/${id}/cancel/`),
  changeStatus: (id: Id, newStatus: string) =>
    api.patch(`invoices/${id}/change_status/`, { status: newStatus }),
  overdue: () => api.get("invoices/overdue/"),
  report: (params: Params = {}) => api.get("invoices/report/", { params }),
  stats: () => api.get("invoices/stats/"),
  filterOptions: () => api.get("invoices/filter_options/"),
  exportExcel: (params: Params = {}) =>
    api.get("invoices/export_excel/", { params, responseType: "blob" }),
  exportCsv: (params: Params = {}) =>
    api.get("invoices/export_csv/", { params, responseType: "blob" }),
  quickCreate: (data: Payload) => api.post("invoices/quick_create/", data),
  requestEdit: (id: Id) => api.post(`invoices/${id}/request-edit/`),
  editRequests: () => api.get("invoices/edit-requests/"),
  reviewEditRequest: (invoiceId: Id, requestId: Id, decision: string) =>
    api.post(`invoices/${invoiceId}/review-edit-request/`, {
      request_id: requestId,
      decision,
    }),
  payments: (id: Id) => api.get(`invoices/${id}/payments/`),
  addPayment: (id: Id, data: Payload) =>
    api.post(`invoices/${id}/payments/`, data),
  updatePayment: (invoiceId: Id, paymentId: Id, data: Payload) =>
    api.patch(`invoices/${invoiceId}/payments/${paymentId}/`, data),
  deletePayment: (invoiceId: Id, paymentId: Id) =>
    api.delete(`invoices/${invoiceId}/payments/${paymentId}/`),
  history: (id: Id) => api.get(`invoices/${id}/history/`),
  restoreVersion: (id: Id, auditId: Id) =>
    api.post(`invoices/${id}/restore-version/`, { audit_id: auditId }),
};

export const auditAPI = {
  list: (params: Params = {}) => api.get("audit/", { params }),
};

// ---- Documents ----
export const documentsAPI = {
  list: (params: Params = {}) => api.get("documents/", { params }),
  detail: (id: Id) => api.get(`documents/${id}/`),
  download: (id: Id) =>
    api.get<Blob>(`documents/${id}/download/`, { responseType: "blob" }),
  preview: (id: Id) =>
    api.get<Blob>(`documents/${id}/preview/`, { responseType: "blob" }),
  create: (formData: FormData) =>
    api.post("documents/", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  update: (id: Id, formData: FormData) =>
    api.patch(`documents/${id}/`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  delete: (id: Id) => api.delete(`documents/${id}/`),
  customerFolderFiles: (customerId: Id) =>
    api.get(`documents/customer_folder_files/?customer=${customerId}`),
};

export const downloadDocumentFile = async (
  id: Id,
  fallbackName: string = "document",
): Promise<void> => {
  const response = await documentsAPI.download(id);
  const disposition = response.headers["content-disposition"] || "";
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plainName = disposition.match(/filename="([^"]+)"/i)?.[1];
  let name = plainName || fallbackName;
  if (encodedName) {
    try {
      name = decodeURIComponent(encodedName);
    } catch {
      /* Keep the fallback name. */
    }
  }
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Let the browser consume the blob before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
};

// ---- Dashboard ----
export const dashboardAPI = {
  stats: () => api.get("dashboard/stats/"),
  reminders: (days: number = 7) => api.get(`dashboard/reminders/?days=${days}`),
};

// ---- Business Profile / Branding ----
export const profileAPI = {
  get: () => api.get("profile/"),
  update: (formData: FormData) =>
    api.patch("profile/update_profile/", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
};

export const socialNetworksAPI = {
  create: (formData: FormData) =>
    api.post("social-networks/", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  update: (id: Id, formData: FormData) =>
    api.patch(`social-networks/${id}/`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  delete: (id: Id) => api.delete(`social-networks/${id}/`),
};

// ---- Expense Categories ----
export const expenseCategoriesAPI = {
  list: () => api.get("expense-categories/"),
  create: (data: Payload) => api.post("expense-categories/", data),
  update: (id: Id, data: Payload) => api.put(`expense-categories/${id}/`, data),
  delete: (id: Id) => api.delete(`expense-categories/${id}/`),
};

// ---- Expenses ----
export const expensesAPI = {
  list: (params: Params = {}) => api.get("expenses/", { params }),
  create: (data: Payload) => api.post("expenses/", data),
  update: (id: Id, data: Payload) => api.put(`expenses/${id}/`, data),
  delete: (id: Id) => api.delete(`expenses/${id}/`),
  summary: (params: Params = {}) => api.get("expenses/summary/", { params }),
};

// ---- Staff ----
export const staffAPI = {
  list: (params: Params = {}) => api.get("staff/", { params }),
  create: (data: Payload) => api.post("staff/", data),
  update: (id: Id, data: Payload) => api.put(`staff/${id}/`, data),
  delete: (id: Id) => api.delete(`staff/${id}/`),
  performance: (id: Id, params: Params = {}) =>
    api.get(`staff/${id}/performance/`, { params }),
};

// ---- Backup ----
export const backupAPI = {
  download: () => api.get("backup/download/", { responseType: "blob" }),
  restore: (data: Payload) => api.post("backup/restore/", data),
};

// ---- Backup Config (scheduled & path-based) ----
export const backupConfigAPI = {
  get: () => api.get("backup-config/"),
  update: (data: Payload) => api.patch("backup-config/update_config/", data),
  browseFolders: (path: string = "") =>
    api.get("backup-config/browse_folders/", { params: { path } }),
  runBackup: (data: Payload = {}) =>
    api.post("backup-config/run_backup/", data),
  runBackupDownload: (data: Payload = {}) =>
    api.post("backup-config/run_backup/", data, { responseType: "blob" }),
  checkAuto: () => api.post("backup-config/check_auto/"),
  testCloud: (data: Payload = {}) =>
    api.post("backup-config/test_cloud/", data),
  listCloud: () => api.get("backup-config/list_cloud/"),
  uploadLatest: () => api.post("backup-config/upload_latest/"),
  restoreCloud: (data: Payload) =>
    api.post("backup-config/restore_cloud/", data),
};

// ---- Database (PostgreSQL migration wizard) ----
// ---- App updates (superuser-approved, in-app) ----
export const appUpdateAPI = {
  status: (quick = false) =>
    api.get("app-update/", { params: quick ? { quick: 1 } : {} }),
  check: () => api.post("app-update/check/", {}),
  apply: () => api.post("app-update/apply/", {}),
};

export const databaseConfigAPI = {
  get: () => api.get("database-config/"),
  testConnection: (data: Payload) =>
    api.post("database-config/test_connection/", data),
  startMigration: (data: Payload) =>
    api.post("database-config/start_migration/", data),
  rollback: () => api.post("database-config/rollback/", {}),
};

export const invoiceSettingsAPI = {
  get: () => api.get("invoice-settings/"),
  update: (data: Payload) => api.patch("invoice-settings/update_config/", data),
};

export const welcomeAPI = {
  getConfig: () => api.get("welcome-settings/config/"),
  updateConfig: (data: Payload) => api.patch("welcome-settings/config/", data),
  users: () => api.get("welcome-settings/users/"),
  personal: () => api.get("welcome-settings/personal/"),
  savePersonal: (data: Payload) => api.post("welcome-settings/personal/", data),
  removePersonal: (user_id: Id) =>
    api.delete("welcome-settings/personal/", { data: { user_id } }),
  today: () => api.post("welcome-settings/today/"),
};

export const chatAPI = {
  list: (params: Params = {}) => api.get("chat/", { params }),
  create: (formData: FormData) =>
    api.post("chat/", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  remove: (id: Id) => api.delete(`chat/${id}/`),
  users: () => api.get("chat/users/"),
  unread: () => api.get("chat/unread/"),
  markRead: () => api.post("chat/mark_read/"),
  download: (id: Id) =>
    api.get(`chat/${id}/download/`, { responseType: "blob" }),
};

export const chatSocketURL = (): string => {
  const apiURL = new URL(API_BASE_URL, window.location.href);
  apiURL.protocol = apiURL.protocol === "https:" ? "wss:" : "ws:";
  apiURL.pathname = `${apiURL.pathname.replace(/\/api\/?$/, "").replace(/\/$/, "")}/ws/chat/`;
  apiURL.search = "";
  return apiURL.toString();
};

export const chatSocketProtocols = (): string[] => {
  const access = Cookies.get("access_token");
  return access ? ["mohaseb-chat", access] : ["mohaseb-chat"];
};

export const alertsSocketURL = (): string => {
  const apiURL = new URL(API_BASE_URL, window.location.href);
  apiURL.protocol = apiURL.protocol === "https:" ? "wss:" : "ws:";
  apiURL.pathname = `${apiURL.pathname.replace(/\/api\/?$/, "").replace(/\/$/, "")}/ws/alerts/`;
  apiURL.search = "";
  return apiURL.toString();
};

export const alertsSocketProtocols = (): string[] => {
  const access = Cookies.get("access_token");
  return access ? ["mohaseb-alerts", access] : ["mohaseb-alerts"];
};

// ---- Vehicle Types ----
export const vehicleTypesAPI = {
  list: () => api.get("vehicle-types/"),
  create: (data: Payload) => api.post("vehicle-types/", data),
  delete: (id: Id) => api.delete(`vehicle-types/${id}/`),
};

// ---- User Management (admin only) ----
export const usersAPI = {
  list: () => api.get("users/"),
  me: () => api.get("users/me/"),
  create: (data: Payload) => api.post("users/", data),
  update: (id: Id, data: Payload) => api.patch(`users/${id}/`, data),
  delete: (id: Id) => api.delete(`users/${id}/`),
  getModuleAccess: (id: Id) => api.get(`users/${id}/module_access/`),
  setModuleAccess: (id: Id, data: Payload) =>
    api.put(`users/${id}/module_access/`, data),
  setRole: (userId: Id, role: string) =>
    api.post("users/set_role/", { user_id: userId, role }),
  performanceSummary: (range: string) =>
    api.get("users/performance-summary/", { params: { range } }),
  performance: (id: Id, range: string) =>
    api.get(`users/${id}/performance/`, { params: { range } }),
};

// ---- Cheques ----
export const chequesAPI = {
  list: (params: Params = {}) => api.get("cheques/", { params }),
  create: (data: Payload) => api.post("cheques/", data),
  update: (id: Id, data: Payload) => api.put(`cheques/${id}/`, data),
  patch: (id: Id, data: Payload) => api.patch(`cheques/${id}/`, data),
  delete: (id: Id) => api.delete(`cheques/${id}/`),
};

export default api;
