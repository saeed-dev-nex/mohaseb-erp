// Stage 6: per-module access vocabulary, mirroring backend api.module_access.
// A user's effective modules come from /api/users/me/ (`modules` field).
// Restriction rows can only remove modules below the role ceiling — the
// backend enforces this; the helpers here only drive UI visibility.

export type ModuleName =
  | "invoices"
  | "customers"
  | "services"
  | "expenses"
  | "cheques"
  | "reports"
  | "chat"
  | "staff"
  | "settings"
  | "users"
  | "backup";

export const ALL_MODULES: ModuleName[] = [
  "invoices",
  "customers",
  "services",
  "expenses",
  "cheques",
  "reports",
  "chat",
  "staff",
  "settings",
  "users",
  "backup",
];

export const MODULE_LABELS: Record<ModuleName, string> = {
  invoices: "فاکتورها",
  customers: "مشتریان",
  services: "خدمات",
  expenses: "هزینه‌ها",
  cheques: "چک‌ها",
  reports: "گزارشات",
  chat: "گفتگو",
  staff: "پرسنل",
  settings: "تنظیمات",
  users: "مدیریت کاربران",
  backup: "بکاپ",
};

const RESOURCE_MODULES: ModuleName[] = [
  "invoices",
  "customers",
  "services",
  "expenses",
  "cheques",
  "reports",
  "chat",
  "staff",
];

// The most a role can ever reach; a restriction row can only go below this.
export function ceilingFor(role: string | null | undefined): ModuleName[] {
  if (role === "admin") return ALL_MODULES;
  if (role === "manager") return [...RESOURCE_MODULES, "settings"];
  return RESOURCE_MODULES;
}

// Apply the role ceiling even to older or stale session module arrays.
export function hasModule(
  user:
    | {
        modules?: unknown;
        is_superuser?: boolean;
        is_staff?: boolean;
        role?: string;
      }
    | null
    | undefined,
  module: string | null | undefined,
): boolean {
  if (!module) return true;
  if (!user) return false;
  if (user.is_superuser) return true;
  if (module === "users" || module === "backup") return false;
  const role =
    user.is_staff || user.role === "manager" ? "manager" : "operator";
  if (!ceilingFor(role).includes(module as ModuleName)) return false;
  const mods = user?.modules;
  if (!Array.isArray(mods)) return true;
  return mods.includes(module);
}
