import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { usersAPI } from "../services/api";
import { ALL_MODULES, MODULE_LABELS, ceilingFor } from "../utils/modules";
import PasswordInput from "../components/PasswordInput";
import type { ModuleName } from "../utils/modules";
import { Button } from "../components/ui";

type RoleInfo = {
  label: string;
  color: string;
  icon: string;
};

const ROLE_LABELS: Record<string, RoleInfo> = {
  admin: {
    label: "مدیر ارشد",
    color: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    icon: "👑",
  },
  manager: {
    label: "مدیر",
    color: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    icon: "🔑",
  },
  operator: {
    label: "اپراتور",
    color: "bg-green-500/20 text-green-300 border-green-500/30",
    icon: "👤",
  },
};

const ROLE_OPTIONS = [
  { value: "operator", label: "اپراتور (دسترسی عادی)", icon: "👤" },
  { value: "manager", label: "مدیر (دسترسی ادمین)", icon: "🔑" },
  { value: "admin", label: "مدیر ارشد (کنترل کامل)", icon: "👑" },
];

type UserRow = {
  id: number;
  username: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  role: string;
  is_active: boolean;
  date_joined?: string | null;
};

type UserForm = {
  username: string;
  password: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  is_active: boolean;
};

type ModuleAccessMap = Record<ModuleName, boolean>;

const emptyForm: UserForm = {
  username: "",
  password: "",
  first_name: "",
  last_name: "",
  email: "",
  role: "operator",
  is_active: true,
};

const blankAccess = (): ModuleAccessMap =>
  Object.fromEntries(ALL_MODULES.map((m) => [m, true])) as ModuleAccessMap;

export default function UsersPage() {
  const currentUser = useSelector((s: any) => s.auth.currentUser);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<UserRow | null>(null);
  const [formError, setFormError] = useState("");
  // Stage 6: module-access editor state (null = not loaded for this user)
  const [accessForm, setAccessForm] = useState<ModuleAccessMap | null>(null);
  const [accessMode, setAccessMode] = useState("default");

  const isAdmin = currentUser?.is_superuser;

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await usersAPI.list();
      setUsers(res.data);
    } catch (e) {
      if (e.response?.status === 403) {
        setError("فقط مدیر ارشد می‌تواند به این صفحه دسترسی داشته باشد.");
      } else {
        setError("خطا در بارگذاری کاربران.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    window.addEventListener("mohaseb:data-changed", load);
    return () => window.removeEventListener("mohaseb:data-changed", load);
  }, []);

  const openCreate = () => {
    setEditingUser(null);
    setForm(emptyForm);
    setFormError("");
    setAccessForm(null);
    setAccessMode("default");
    setShowModal(true);
  };

  const openEdit = (user: UserRow) => {
    setEditingUser(user);
    setForm({
      username: user.username,
      password: "",
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      email: user.email || "",
      role: user.role,
      is_active: user.is_active,
    });
    setFormError("");
    setAccessForm(null);
    setAccessMode("default");
    setShowModal(true);
    // Stage 6: load the user's module restriction row (null = role default)
    usersAPI
      .getModuleAccess(user.id)
      .then(({ data }) => {
        if (data.access) {
          setAccessForm(data.access);
          setAccessMode("custom");
        } else {
          setAccessForm(blankAccess());
          setAccessMode("default");
        }
      })
      .catch(() => {});
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!form.username.trim()) {
      setFormError("نام کاربری الزامی است");
      return;
    }
    if (!editingUser && !form.password.trim()) {
      setFormError("رمز عبور برای کاربر جدید الزامی است");
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        username: form.username.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        is_active: form.is_active,
        is_superuser: form.role === "admin",
        is_staff: form.role === "admin" || form.role === "manager",
      };
      if (form.password.trim()) payload.password = form.password.trim();

      if (editingUser) {
        await usersAPI.update(editingUser.id, payload);
        // Stage 6: persist module access (custom row, or {} to clear it)
        if (accessForm) {
          await usersAPI.setModuleAccess(
            editingUser.id,
            accessMode === "custom" ? accessForm : {},
          );
        }
      } else {
        await usersAPI.create(payload);
      }
      setShowModal(false);
      load();
    } catch (e) {
      const data = e.response?.data;
      if (data?.username) setFormError("این نام کاربری قبلاً استفاده شده است.");
      else setFormError("خطا در ذخیره‌سازی. لطفاً دوباره تلاش کنید.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (userId: number) => {
    try {
      await usersAPI.delete(userId);
      setDeleteConfirm(null);
      load();
    } catch (e) {
      alert(e.response?.data?.error || "خطا در حذف کاربر");
    }
  };

  const handleToggleActive = async (user: UserRow) => {
    try {
      await usersAPI.update(user.id, { is_active: !user.is_active });
      load();
    } catch (_) {}
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center p-12 bg-slate-800/50 rounded-2xl border border-slate-700">
          <div className="text-5xl mb-4">🔒</div>
          <h2 className="text-xl font-bold text-white mb-2">دسترسی محدود</h2>
          <p className="text-slate-400">
            فقط مدیر ارشد می‌تواند کاربران را مدیریت کند.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">🔐 مدیریت کاربران</h2>
          <p className="text-slate-400 text-sm mt-1">
            تعریف کارمند با نام کاربری و رمز ورود اختصاصی برای نظارت بر رفتار
            کارکنان
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          + کاربر جدید
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-500/20 border border-red-500/30 rounded-xl text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Info box */}
      <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl text-sm text-blue-300 flex gap-3 items-start">
        <span className="text-lg mt-0.5">ℹ️</span>
        <div>
          <p className="font-semibold mb-1">راهنمای سطوح دسترسی</p>
          <p>
            👤 <strong>اپراتور:</strong> می‌تواند فاکتور صادر کند و مشتریان را
            مدیریت کند
          </p>
          <p>
            🔑 <strong>مدیر:</strong> دسترسی به همه بخش‌ها + مدیریت هزینه‌ها و
            گزارشات
          </p>
          <p>
            👑 <strong>مدیر ارشد:</strong> کنترل کامل شامل مدیریت کاربران و
            تنظیمات سیستم
          </p>
        </div>
      </div>

      {/* Users Table */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-700/30 text-slate-400 border-b border-slate-700/50">
                <th className="text-right px-4 py-3.5 text-slate-400 font-medium">
                  کاربر
                </th>
                <th className="text-right px-4 py-3.5 text-slate-400 font-medium">
                  نام کاربری
                </th>
                <th className="text-right px-4 py-3.5 text-slate-400 font-medium">
                  سطح دسترسی
                </th>
                <th className="text-right px-4 py-3.5 text-slate-400 font-medium">
                  وضعیت
                </th>
                <th className="text-right px-4 py-3.5 text-slate-400 font-medium">
                  تاریخ ایجاد
                </th>
                <th className="px-4 py-3.5 text-slate-400 font-medium text-center">
                  عملیات
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user, idx) => {
                const role = ROLE_LABELS[user.role] || ROLE_LABELS.operator;
                const isMe = user.id === currentUser?.id;
                return (
                  <tr
                    key={user.id}
                    className={`border-b border-slate-700/30 transition-colors hover:bg-slate-700/20
                      ${idx % 2 === 0 ? "" : "bg-slate-800/20"}`}
                  >
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-9 h-9 rounded-full bg-gradient-to-br from-slate-600 to-slate-700
                          flex items-center justify-center text-white font-bold text-sm border border-slate-600"
                        >
                          {(
                            user.first_name?.[0] ||
                            user.username[0] ||
                            "?"
                          ).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-white font-medium">
                            {user.first_name || user.last_name
                              ? `${user.first_name} ${user.last_name}`.trim()
                              : user.username}
                          </p>
                          {user.email && (
                            <p className="text-slate-500 text-xs">
                              {user.email}
                            </p>
                          )}
                        </div>
                        {isMe && (
                          <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-[10px] rounded-full border border-blue-500/30">
                            شما
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <code className="text-slate-300 bg-slate-900/50 px-2 py-1 rounded-lg text-xs">
                        {user.username}
                      </code>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${role.color}`}
                      >
                        <span>{role.icon}</span>
                        {role.label}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <button
                        onClick={() => !isMe && handleToggleActive(user)}
                        disabled={isMe}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border
                          transition-all duration-200
                          ${
                            user.is_active
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/30"
                              : "bg-red-500/20 text-red-300 border-red-500/30 hover:bg-red-500/30"
                          } ${isMe ? "cursor-default opacity-70" : "cursor-pointer"}`}
                        title={isMe ? "نمی‌توانید وضعیت خود را تغییر دهید" : ""}
                      >
                        <span>{user.is_active ? "✅" : "❌"}</span>
                        {user.is_active ? "فعال" : "غیرفعال"}
                      </button>
                    </td>
                    <td className="px-4 py-3.5 text-slate-400 text-xs">
                      {user.date_joined
                        ? new Date(user.date_joined).toLocaleDateString("fa-IR")
                        : "-"}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-center gap-2">
                        <Link
                          to={`/users/${user.id}/performance`}
                          className="px-3 py-1.5 bg-slate-700/50 hover:bg-violet-500/20 text-slate-300 hover:text-violet-300
                            rounded-lg text-xs font-medium transition-all duration-200 border border-slate-600/50
                            hover:border-violet-500/30 flex items-center gap-1.5"
                        >
                          📊 عملکرد
                        </Link>
                        <button
                          onClick={() => openEdit(user)}
                          className="px-3 py-1.5 bg-slate-700/50 hover:bg-blue-500/20 text-slate-300 hover:text-blue-300
                            rounded-lg text-xs font-medium transition-all duration-200 border border-slate-600/50
                            hover:border-blue-500/30 flex items-center gap-1.5"
                        >
                          ✏️ ویرایش
                        </button>
                        {!isMe && (
                          <button
                            onClick={() => setDeleteConfirm(user)}
                            className="px-3 py-1.5 bg-slate-700/50 hover:bg-red-500/20 text-slate-300 hover:text-red-300
                              rounded-lg text-xs font-medium transition-all duration-200 border border-slate-600/50
                              hover:border-red-500/30 flex items-center gap-1.5"
                          >
                            🗑️ حذف
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {users.length === 0 && !loading && (
            <div className="text-center py-16 text-slate-500">
              <p className="text-3xl mb-3">👤</p>
              <p>هنوز کاربری تعریف نشده است</p>
            </div>
          )}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="p-6 border-b border-slate-700 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">
                {editingUser ? "✏️ ویرایش کاربر" : "➕ کاربر جدید"}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400
                  hover:text-white flex items-center justify-center transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-xl text-red-300 text-sm">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    نام
                  </label>
                  <input
                    type="text"
                    value={form.first_name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, first_name: e.target.value }))
                    }
                    className="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-xl text-white
                      placeholder-slate-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                    placeholder="نام"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    نام خانوادگی
                  </label>
                  <input
                    type="text"
                    value={form.last_name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, last_name: e.target.value }))
                    }
                    className="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-xl text-white
                      placeholder-slate-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                    placeholder="نام خانوادگی"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  نام کاربری <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, username: e.target.value }))
                  }
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-xl text-white
                    placeholder-slate-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                  placeholder="مثال: operator1"
                  dir="ltr"
                  required
                  disabled={!!editingUser}
                />
                {editingUser && (
                  <p className="text-slate-500 text-xs mt-1">
                    نام کاربری قابل تغییر نیست
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  رمز عبور{" "}
                  {!editingUser && <span className="text-red-400">*</span>}
                  {editingUser && (
                    <span className="text-slate-500 text-xs mr-2">
                      (خالی = بدون تغییر)
                    </span>
                  )}
                </label>
                <PasswordInput
                  value={form.password}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, password: e.target.value }))
                  }
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-xl text-white
                    placeholder-slate-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                  placeholder="••••••••"
                  dir="ltr"
                  required={!editingUser}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  ایمیل
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, email: e.target.value }))
                  }
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-xl text-white
                    placeholder-slate-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                  placeholder="email@example.com"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  سطح دسترسی
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {ROLE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() =>
                        setForm((f) => ({ ...f, role: opt.value }))
                      }
                      className={`p-3 rounded-xl border text-xs font-medium transition-all duration-200
                        flex flex-col items-center gap-1 text-center
                        ${
                          form.role === opt.value
                            ? "bg-purple-500/20 border-purple-500/50 text-purple-300"
                            : "bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-300"
                        }`}
                    >
                      <span className="text-lg">{opt.icon}</span>
                      <span>{opt.label.split(" ")[0]}</span>
                    </button>
                  ))}
                </div>
                <p className="text-slate-500 text-xs mt-2">
                  {ROLE_OPTIONS.find((o) => o.value === form.role)?.label}
                </p>
              </div>

              {editingUser && accessForm && (
                <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-slate-300 text-sm font-medium">
                      🔐 دسترسی ماژول‌ها
                    </p>
                    {accessMode === "custom" && (
                      <button
                        type="button"
                        onClick={() => {
                          setAccessMode("default");
                          setAccessForm(blankAccess());
                        }}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        بازنشانی به پیش‌فرض نقش
                      </button>
                    )}
                  </div>
                  <p className="text-slate-500 text-xs">
                    {accessMode === "default"
                      ? "این کاربر از دسترسی پیش‌فرض نقش خود پیروی می‌کند؛ با برداشتن تیک هر ماژول، دسترسی اختصاصی ساخته می‌شود."
                      : "دسترسی اختصاصی فعال است؛ ماژول‌های بدون تیک برای این کاربر بسته می‌شوند."}{" "}
                    ماژول‌های خاکستری سقف نقش کاربرند و قابل اعطا نیستند.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {ALL_MODULES.map((m) => {
                      const allowed = ceilingFor(form.role).includes(m);
                      return (
                        <label
                          key={m}
                          className={`flex items-center gap-2 p-2 rounded-lg border text-xs
                            ${
                              allowed
                                ? "bg-slate-800 border-slate-600 text-slate-300 cursor-pointer"
                                : "bg-slate-800/40 border-slate-700/50 text-slate-600 cursor-not-allowed"
                            }`}
                        >
                          <input
                            type="checkbox"
                            disabled={!allowed}
                            checked={allowed && !!accessForm[m]}
                            onChange={(e) => {
                              setAccessForm(
                                (f) =>
                                  ({
                                    ...f,
                                    [m]: e.target.checked,
                                  }) as ModuleAccessMap,
                              );
                              setAccessMode("custom");
                            }}
                            className="accent-purple-500"
                          />
                          {MODULE_LABELS[m]}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-xl border border-slate-700">
                <div>
                  <p className="text-slate-300 text-sm font-medium">
                    وضعیت حساب
                  </p>
                  <p className="text-slate-500 text-xs">
                    کاربر غیرفعال نمی‌تواند وارد سیستم شود
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setForm((f) => ({ ...f, is_active: !f.is_active }))
                  }
                  className={`w-12 h-6 rounded-full transition-all duration-300 relative
                    ${form.is_active ? "bg-emerald-500" : "bg-slate-600"}`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-300
                    ${form.is_active ? "right-0.5" : "left-0.5"}`}
                  />
                </button>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 bg-gradient-to-l from-purple-600 to-indigo-600
                    hover:from-purple-700 hover:to-indigo-700 text-white rounded-xl font-medium text-sm
                    transition-all duration-200 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ذخیره...
                    </>
                  ) : editingUser ? (
                    "💾 ذخیره تغییرات"
                  ) : (
                    "✅ ایجاد کاربر"
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-5 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl
                    font-medium text-sm transition-colors"
                >
                  انصراف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-red-500/30 rounded-2xl p-6 w-full max-w-sm shadow-2xl text-center">
            <div className="text-4xl mb-4">⚠️</div>
            <h3 className="text-lg font-bold text-white mb-2">حذف کاربر</h3>
            <p className="text-slate-400 text-sm mb-6">
              آیا مطمئن هستید که می‌خواهید کاربر{" "}
              <strong className="text-white">{deleteConfirm.username}</strong>{" "}
              را حذف کنید؟ این عمل قابل بازگشت نیست.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleDelete(deleteConfirm.id)}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium text-sm transition-colors"
              >
                بله، حذف شود
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl font-medium text-sm transition-colors"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
