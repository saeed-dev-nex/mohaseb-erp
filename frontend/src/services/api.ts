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

// Request interceptor - attach token (+ current ERP business, if any)
export const BUSINESS_STORAGE_KEY = "mohaseb-erp:business-id";
api.interceptors.request.use((config) => {
  const token = Cookies.get("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  try {
    // An explicitly-set business header wins: queued offline invoices
    // flush under the business they were drafted in, not whichever
    // business happens to be selected when the flush runs.
    if (!config.headers["X-Business-Id"]) {
      const businessId = window.localStorage.getItem(BUSINESS_STORAGE_KEY);
      if (businessId) config.headers["X-Business-Id"] = businessId;
    }
  } catch {
    /* Storage may be unavailable; the request just stays unscoped. */
  }
  return config;
});

// Response interceptor - handle 401 with refresh.
// The refresh token lives in an httpOnly cookie set by the backend, so the
// refresh call is credentialed and sends no token from JavaScript storage.
const clearSessionAndRedirect = () => {
  Cookies.remove("access_token");
  Cookies.remove("refresh_token");
  localStorage.removeItem("mohaseb_user");
  localStorage.removeItem(BUSINESS_STORAGE_KEY);
  queryClient.clear();
  // Redirecting while already on a public page would reload it
  // and re-fire the failing request — an infinite loop that
  // also burns the token-refresh throttle.
  const path = window.location.pathname;
  if (path !== "/login" && path !== "/setup") {
    window.location.href = "/login";
  }
};

api.interceptors.response.use(
  (response) => response,
  async (error: any) => {
    const failedAccess = String(
      error.config?.headers?.Authorization || "",
    ).replace(/^Bearer /, "");
    if (
      error.response?.status === 401 &&
      failedAccess &&
      !error.config?.url?.includes("token/") &&
      !error.config?._retriedAfterRefresh
    ) {
      error.config._retriedAfterRefresh = true;
      let access: string;
      try {
        access = await refreshAccess(failedAccess);
      } catch (refreshError: any) {
        // Only a definitive refusal (400/401) means the session is
        // dead. A network error or a 5xx — the backend restarts
        // routinely for updates and DB switches — must NOT log the
        // user out: the httpOnly refresh cookie is still valid and
        // the next attempt may well succeed.
        const refreshStatus = refreshError?.response?.status;
        if (refreshStatus === 400 || refreshStatus === 401) {
          clearSessionAndRedirect();
        }
        return Promise.reject(error);
      }
      error.config.headers.Authorization = `Bearer ${access}`;
      try {
        return await api.request(error.config);
      } catch (retryError: any) {
        // Even the freshly-issued token was rejected: the session is
        // unrecoverable, so tear it down instead of leaving a zombie
        // "logged in" shell whose every call fails.
        if (retryError?.response?.status === 401) {
          clearSessionAndRedirect();
        }
        return Promise.reject(retryError);
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
  quickCreate: (data: Payload, config?: Record<string, unknown>) =>
    api.post("invoices/quick_create/", data, config),
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

// ---- Businesses (ERP multi-business core) ----
export interface FiscalYear {
  id: number;
  business: number;
  title: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  is_closed: boolean;
}

export interface InvoiceExtraField {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  options?: string[];
}

export interface InvoiceProfile {
  vehicle: boolean;
  extras: InvoiceExtraField[];
}

export interface Business {
  id: number;
  name: string;
  template_key: string;
  template_title: string;
  terminology: Record<string, string>;
  invoice_profile: InvoiceProfile;
  person_type: "legal" | "individual";
  legal_name: string;
  national_id: string;
  economic_code: string;
  registration_number: string;
  phone: string;
  address: string;
  effective_modules: string[];
  current_fiscal_year: FiscalYear | null;
  my_role: string | null;
  is_active: boolean;
}

export interface BusinessTemplate {
  key: string;
  title: string;
  description: string;
  modules: string[];
  terminology: Record<string, string>;
  invoice_profile: InvoiceProfile;
  catalog: { title: string; default_main_price: number }[];
}

export const businessesAPI = {
  list: () => api.get<Business[]>("businesses/"),
  create: (data: Partial<Business>) => api.post<Business>("businesses/", data),
  templates: () => api.get<BusinessTemplate[]>("business-templates/"),
  fiscalYears: (businessId: number) =>
    api.get<FiscalYear[]>(`businesses/${businessId}/fiscal-years/`),
  addFiscalYear: (businessId: number, data: Partial<FiscalYear>) =>
    api.post<FiscalYear>(`businesses/${businessId}/fiscal-years/`, data),
  applyChart: (businessId: number) =>
    api.post<{ created: number; existing: number }>(
      `businesses/${businessId}/apply-chart/`,
      {},
    ),
  importLegacy: (businessId: number, payload: unknown) =>
    api.post<{
      customers_created: number;
      customers_matched: number;
      services_created: number;
      staff_created: number;
      staff_matched: number;
      invoices_created: number;
      invoices_skipped: number;
      items_created: number;
    }>(`businesses/${businessId}/import-legacy/`, { payload }),
  applyCatalog: (businessId: number) =>
    api.post<{ created: number; existing: number }>(
      `businesses/${businessId}/apply-catalog/`,
      {},
    ),
  members: (businessId: number) => api.get(`businesses/${businessId}/members/`),
  addMember: (businessId: number, data: { username: string; role: string }) =>
    api.post(`businesses/${businessId}/members/`, data),
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

// ---- Accounting (ERP phase 1) ----
export interface Account {
  id: number;
  business: number;
  code: string;
  title: string;
  parent: number | null;
  parent_code: string | null;
  level: number;
  level_label: string;
  nature: "debit" | "credit";
  is_active: boolean;
  is_system: boolean;
}

export interface JournalLine {
  id?: number;
  account: number;
  account_code?: string;
  account_title?: string;
  party?: number | null;
  party_name?: string;
  description: string;
  debit: number;
  credit: number;
}

export interface JournalEntry {
  id: number;
  business: number;
  fiscal_year: number;
  number: number;
  date: string;
  description: string;
  reference: string;
  status: "draft" | "posted";
  status_display: string;
  lines: JournalLine[];
  total_debit: number;
  total_credit: number;
  is_balanced: boolean;
  created_by_name: string;
}

export interface TrialBalanceRow {
  account: number;
  code: string;
  title: string;
  nature: string;
  total_debit: number;
  total_credit: number;
  balance_debit: number;
  balance_credit: number;
}

export const accountingAPI = {
  accounts: () => api.get<Account[]>("accounts/"),
  createAccount: (data: Partial<Account>) =>
    api.post<Account>("accounts/", data),
  deleteAccount: (id: number) => api.delete(`accounts/${id}/`),
  seedChart: () =>
    api.post<{ created: number; existing: number }>(
      "accounting/seed-chart/",
      {},
    ),
  entries: (params: Params = {}) => api.get("journal-entries/", { params }),
  getEntry: (id: number) => api.get<JournalEntry>(`journal-entries/${id}/`),
  createEntry: (data: Payload) =>
    api.post<JournalEntry>("journal-entries/", data),
  updateEntry: (id: number, data: Payload) =>
    api.put<JournalEntry>(`journal-entries/${id}/`, data),
  deleteEntry: (id: number) => api.delete(`journal-entries/${id}/`),
  postEntry: (id: number) =>
    api.post<JournalEntry>(`journal-entries/${id}/post/`, {}),
  unpostEntry: (id: number) =>
    api.post<JournalEntry>(`journal-entries/${id}/unpost/`, {}),
  trialBalance: (fiscalYear?: number) =>
    api.get<{
      rows: TrialBalanceRow[];
      total_debit: number;
      total_credit: number;
      is_balanced: boolean;
    }>("accounting/trial-balance/", {
      params: fiscalYear ? { fiscal_year: fiscalYear } : {},
    }),
  ledger: (account: number, fiscalYear?: number) =>
    api.get("accounting/ledger/", {
      params: { account, ...(fiscalYear ? { fiscal_year: fiscalYear } : {}) },
    }),
};

// ---- Inventory & purchasing (ERP phase 2) ----
export interface Warehouse {
  id: number;
  business: number;
  name: string;
  is_default: boolean;
  is_active: boolean;
}

export interface Product {
  id: number;
  business: number;
  code: string;
  name: string;
  unit: string;
  barcode: string;
  average_cost: number;
  sale_price: number;
  is_active: boolean;
  current_stock: number;
  stock_value: number;
}

export interface PurchaseLine {
  id?: number;
  product: number;
  product_name?: string;
  product_code?: string;
  quantity: number;
  unit_price: number;
  total?: number;
}

export interface PurchaseInvoice {
  id: number;
  business: number;
  fiscal_year: number;
  supplier: number;
  supplier_name: string;
  number: number;
  date: string;
  description: string;
  status: "draft" | "posted";
  status_display: string;
  vat_amount: number;
  journal_entry: number | null;
  lines: PurchaseLine[];
  total: number;
}

export const inventoryAPI = {
  warehouses: () => api.get<Warehouse[]>("warehouses/"),
  products: () => api.get<Product[]>("products/"),
  createProduct: (data: Partial<Product>) =>
    api.post<Product>("products/", data),
  updateProduct: (id: number, data: Partial<Product>) =>
    api.patch<Product>(`products/${id}/`, data),
  deleteProduct: (id: number) => api.delete(`products/${id}/`),
  purchases: () => api.get("purchases/"),
  createPurchase: (data: Payload) =>
    api.post<PurchaseInvoice>("purchases/", data),
  updatePurchase: (id: number, data: Payload) =>
    api.put<PurchaseInvoice>(`purchases/${id}/`, data),
  deletePurchase: (id: number) => api.delete(`purchases/${id}/`),
  postPurchase: (id: number) =>
    api.post<PurchaseInvoice>(`purchases/${id}/post/`, {}),
  unpostPurchase: (id: number) =>
    api.post<PurchaseInvoice>(`purchases/${id}/unpost/`, {}),
  kardex: (product: number) =>
    api.get("inventory/kardex/", { params: { product } }),
  adjust: (data: Payload) => api.post("inventory/adjust/", data),
};

// ---- Personnel & payroll (ERP phase 3) ----
export interface EmploymentProfile {
  id: number;
  business: number;
  staff: number;
  staff_name: string;
  personnel_code: string;
  national_id: string;
  insurance_number: string;
  bank_iban: string;
  contract_type: string;
  contract_type_display: string;
  base_salary: number;
  housing_allowance: number;
  food_allowance: number;
  child_allowance_each: number;
  children_count: number;
  is_insured: boolean;
  is_active: boolean;
}

export interface Payslip {
  id: number;
  period: number;
  profile: number;
  staff_name: string;
  personnel_code: string;
  days_worked: number;
  overtime_hours: number;
  other_additions: number;
  other_deductions: number;
  base_pay: number;
  housing: number;
  food: number;
  child: number;
  overtime_pay: number;
  gross: number;
  insurance_base: number;
  insurance_employee: number;
  insurance_employer: number;
  taxable_income: number;
  tax: number;
  net: number;
}

export interface PayrollPeriod {
  id: number;
  business: number;
  year: number;
  month: number;
  status: "draft" | "finalized";
  status_display: string;
  journal_entry: number | null;
  payslip_count: number;
  totals: {
    gross: number;
    net: number;
    tax: number;
    insurance_employee: number;
    insurance_employer: number;
  };
}

export const payrollAPI = {
  settings: () => api.get("payroll/settings/"),
  updateSettings: (data: Payload) => api.patch("payroll/settings/", data),
  profiles: () => api.get<EmploymentProfile[]>("employment-profiles/"),
  createProfile: (data: Payload) =>
    api.post<EmploymentProfile>("employment-profiles/", data),
  updateProfile: (id: number, data: Payload) =>
    api.patch<EmploymentProfile>(`employment-profiles/${id}/`, data),
  deleteProfile: (id: number) => api.delete(`employment-profiles/${id}/`),
  periods: () => api.get("payroll-periods/"),
  createPeriod: (data: Payload) =>
    api.post<PayrollPeriod>("payroll-periods/", data),
  deletePeriod: (id: number) => api.delete(`payroll-periods/${id}/`),
  generate: (id: number) => api.post(`payroll-periods/${id}/generate/`, {}),
  finalize: (id: number) =>
    api.post<PayrollPeriod>(`payroll-periods/${id}/finalize/`, {}),
  unfinalize: (id: number) =>
    api.post<PayrollPeriod>(`payroll-periods/${id}/unfinalize/`, {}),
  payslips: (periodId: number) =>
    api.get<Payslip[]>(`payroll-periods/${periodId}/payslips/`),
  updatePayslip: (id: number, data: Payload) =>
    api.patch<Payslip>(`payslips/${id}/`, data),
  exportBank: (periodId: number) =>
    api.get(`payroll-periods/${periodId}/export-bank/`, {
      responseType: "blob",
    }),
  exportInsurance: (periodId: number) =>
    api.get(`payroll-periods/${periodId}/export-insurance/`, {
      responseType: "blob",
    }),
};

// ---- First-run setup wizard ----
export const setupAPI = {
  status: () =>
    api.get<{ needs_setup: boolean; engine: string; source: string }>(
      "setup/status/",
    ),
  testDatabase: (data: Payload) => api.post("setup/test-database/", data),
  configureDatabase: (data: Payload) =>
    api.post<{ started: boolean; restart_required: boolean }>(
      "setup/configure-database/",
      data,
    ),
  createAdmin: (data: Payload) =>
    api.post<{ created: boolean; username: string }>("setup/admin/", data),
};

// ---- Self-service registration (license-gated) & account security ----
export interface RegistrationCode {
  id: number;
  code_hint: string;
  note: string;
  status: "available" | "used" | "expired" | "revoked";
  created_by_username: string;
  created_at: string;
  expires_at: string | null;
  used_at: string | null;
  used_by_username: string;
  revoked: boolean;
}

export const registrationCodesAPI = {
  list: () => api.get<RegistrationCode[]>("registration-codes/"),
  generate: (data: { count: number; note?: string; valid_days?: number }) =>
    api.post<{ codes: string[] }>("registration-codes/", data),
  revoke: (id: number) =>
    api.post<RegistrationCode>(`registration-codes/${id}/revoke/`, {}),
};

export const registrationAPI = {
  checkCode: (code: string) =>
    api.post<{ valid: boolean }>("registration/check-code/", { code }),
  register: (data: Payload) => api.post("registration/register/", data),
  verifyEmail: (data: { username: string; code: string }) =>
    api.post("registration/verify-email/", data),
  resendCode: (username: string) =>
    api.post("registration/resend-code/", { username }),
};

export const accountSecurityAPI = {
  captcha: () => api.get<{ id: string; image: string }>("auth/captcha/"),
  forgotPassword: (data: Payload) => api.post("auth/forgot-password/", data),
  resetPassword: (data: Payload) => api.post("auth/reset-password/", data),
  otpRequest: (identifier: string) =>
    api.post("auth/otp/request/", { identifier }),
  otpVerify: (data: { identifier: string; code: string }) =>
    api.post<{ access: string; refresh?: string }>("auth/otp/verify/", data, {
      withCredentials: true,
      headers: { "X-Client-Type": "web" },
    }),
  changePassword: (data: { current_password: string; new_password: string }) =>
    api.post<{ changed: boolean; access: string; refresh?: string }>(
      "auth/change-password/",
      data,
      { withCredentials: true, headers: { "X-Client-Type": "web" } },
    ),
};

// ---- Tax & fixed assets (ERP phase 4) ----
export interface VatReport {
  year: number;
  season: number;
  sales_count: number;
  sales_base: number;
  output_vat: number;
  purchases_count: number;
  purchases_base: number;
  input_vat: number;
  payable: number;
}

export interface SeasonalRow {
  party: number | null;
  party_name: string;
  national_id: string;
  side: "sale" | "purchase";
  count: number;
  amount: number;
  vat: number;
}

export interface MoadianSubmission {
  id: number;
  invoice: number;
  invoice_number: string;
  customer_name: string;
  status: "queued" | "sent" | "failed";
  status_display: string;
  unique_id: string;
  note: string;
  submitted_at: string | null;
}

export interface FixedAsset {
  id: number;
  business: number;
  code: string;
  name: string;
  category: string;
  category_display: string;
  purchase_date: string;
  cost: number;
  salvage_value: number;
  useful_life_years: number;
  accumulated_depreciation: number;
  depreciated_months: number;
  monthly_depreciation: number;
  book_value: number;
  is_active: boolean;
}

export interface DepreciationRun {
  id: number;
  year: number;
  month: number;
  total_amount: number;
  journal_entry: number | null;
  lines: {
    id: number;
    asset: number;
    asset_name: string;
    asset_code: string;
    amount: number;
  }[];
  created_at: string;
}

export const taxAPI = {
  settings: () => api.get("tax/settings/"),
  updateSettings: (data: Payload) => api.patch("tax/settings/", data),
  vatReport: (year: number, season: number) =>
    api.get<VatReport>("tax/vat-report/", { params: { year, season } }),
  seasonal: (year: number, season: number) =>
    api.get<{ rows: SeasonalRow[] }>("tax/seasonal/", {
      params: { year, season },
    }),
  seasonalCsv: (year: number, season: number) =>
    api.get("tax/seasonal/", {
      params: { year, season, export: "csv" },
      responseType: "blob",
    }),
  submissions: () => api.get("moadian-submissions/"),
  queue: (invoice: number) =>
    api.post<MoadianSubmission>("moadian-submissions/queue/", { invoice }),
  markSent: (id: number, data: Payload = {}) =>
    api.post<MoadianSubmission>(`moadian-submissions/${id}/mark-sent/`, data),
  markFailed: (id: number, data: Payload = {}) =>
    api.post<MoadianSubmission>(`moadian-submissions/${id}/mark-failed/`, data),
};

export const assetsAPI = {
  list: () => api.get<FixedAsset[]>("fixed-assets/"),
  create: (data: Payload) => api.post<FixedAsset>("fixed-assets/", data),
  update: (id: number, data: Payload) =>
    api.patch<FixedAsset>(`fixed-assets/${id}/`, data),
  delete: (id: number) => api.delete(`fixed-assets/${id}/`),
  runs: () => api.get("depreciation-runs/"),
  run: (data: Payload) => api.post<DepreciationRun>("depreciation-runs/", data),
  deleteRun: (id: number) => api.delete(`depreciation-runs/${id}/`),
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
