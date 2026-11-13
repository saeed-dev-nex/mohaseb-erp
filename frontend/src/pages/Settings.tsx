import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSelector } from "react-redux";
import { Spinner } from "../components/ui";
import {
  profileAPI,
  socialNetworksAPI,
  invoiceSettingsAPI,
  welcomeAPI,
} from "../services/api";
import { F, Section, inp } from "./settings/shared";
import { ServicePackagesSection } from "./settings/ServicePackagesSection";
import { ShortcutsSection } from "./settings/ShortcutsSection";
import { BackupTab } from "./settings/BackupTab";
import { DatabaseTab } from "./settings/DatabaseTab";
import { UpdateTab } from "./settings/UpdateTab";
import { BusinessesTab } from "./settings/BusinessesTab";
import { RegistrationCodesTab } from "./settings/RegistrationCodesTab";
import { ServerFolderPicker } from "./settings/ServerFolderPicker";

type ProfileForm = {
  name: string;
  subtitle: string;
  phone: string;
  mobile: string;
  address: string;
  website: string;
  footer_text: string;
  tax_id: string;
  customer_documents_path: string;
};

type InvoiceCfg = {
  office_card_fee_threshold: number | string;
  show_discount_field: boolean;
  show_tax_field: boolean;
  show_seller_signature: boolean;
  show_buyer_signature: boolean;
  enable_invoice_clone: boolean;
};

type WelcomeCfg = {
  enabled: boolean;
  global_message: string;
};

type WelcomeUser = {
  id: number;
  name: string;
};

type PersonalGreeting = {
  user_id: number;
  name: string;
  message: string;
};

type SocialLink = {
  id: number;
  name: string;
  url: string;
  logo_url?: string | null;
};

type SocialForm = {
  id: number | null;
  name: string;
  url: string;
  logo: File | null;
};

const Settings = () => {
  const isSuperuser = useSelector(
    (state: any) => state.auth.currentUser?.is_superuser,
  );
  const isManager = useSelector(
    (state: any) =>
      !!(
        state.auth.currentUser?.is_staff || state.auth.currentUser?.is_superuser
      ),
  );
  const [form, setForm] = useState<ProfileForm>({
    name: "",
    subtitle: "",
    phone: "",
    mobile: "",
    address: "",
    website: "",
    footer_text: "",
    tax_id: "",
    customer_documents_path: "",
  });
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [activeTab, setActiveTab] = useState(() => {
    // The layout's update banner deep-links here via this one-shot key.
    try {
      const wanted = window.localStorage.getItem("mohaseb:settings-tab");
      if (wanted) {
        window.localStorage.removeItem("mohaseb:settings-tab");
        return wanted;
      }
    } catch {
      /* Storage may be unavailable; fall through to the default tab. */
    }
    return "brand";
  });
  const settingsTabs = [
    { id: "brand", label: "برند و تماس", icon: "🎨", visible: true },
    {
      id: "businesses",
      label: "کسب‌وکارها",
      icon: "🏢",
      visible: isSuperuser,
    },
    {
      id: "licenses",
      label: "کدهای ثبت‌نام",
      icon: "🎟️",
      visible: isSuperuser,
    },
    { id: "invoice", label: "تنظیمات فاکتور", icon: "🧾", visible: isManager },
    { id: "packages", label: "پکیج‌های خدمات", icon: "📦", visible: true },
    {
      id: "shortcuts",
      label: "میانبرهای صفحه‌کلید",
      icon: "⌨️",
      visible: true,
    },
    {
      id: "welcome",
      label: "خوش‌آمدگویی روزانه",
      icon: "🎉",
      visible: isManager,
    },
    {
      id: "storage",
      label: "مدارک و مسیرها",
      icon: "📁",
      visible: isSuperuser,
    },
    { id: "backup", label: "پشتیبان‌گیری", icon: "💾", visible: isSuperuser },
    {
      id: "database",
      label: "پایگاه داده",
      icon: "🗄️",
      visible: isSuperuser,
    },
    {
      id: "update",
      label: "به‌روزرسانی",
      icon: "⬆️",
      visible: isSuperuser,
    },
  ].filter((t) => t.visible);
  const [invoiceCfg, setInvoiceCfg] = useState<InvoiceCfg>({
    office_card_fee_threshold: 0,
    show_discount_field: true,
    show_tax_field: true,
    show_seller_signature: true,
    show_buyer_signature: true,
    enable_invoice_clone: true,
  });
  const [invoiceCfgSaving, setInvoiceCfgSaving] = useState(false);
  const [invoiceCfgMsg, setInvoiceCfgMsg] = useState("");
  const [welcomeCfg, setWelcomeCfg] = useState<WelcomeCfg>({
    enabled: false,
    global_message: "",
  });
  const [welcomeUsers, setWelcomeUsers] = useState<WelcomeUser[]>([]);
  const [personalGreetings, setPersonalGreetings] = useState<
    PersonalGreeting[]
  >([]);
  const [personalUserId, setPersonalUserId] = useState("");
  const [personalMessage, setPersonalMessage] = useState("");
  const [welcomeSaving, setWelcomeSaving] = useState(false);
  const [welcomeMsg, setWelcomeMsg] = useState("");
  const [personalSaving, setPersonalSaving] = useState(false);
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>([]);
  const [socialForm, setSocialForm] = useState<SocialForm>({
    id: null,
    name: "",
    url: "",
    logo: null,
  });
  const [socialSaving, setSocialSaving] = useState(false);
  const [socialError, setSocialError] = useState("");
  const socialLogoInputRef = useRef<HTMLInputElement>(null);
  const [docsPickerOpen, setDocsPickerOpen] = useState(false);

  // On small screens the tab row scrolls horizontally — keep the
  // active tab visible instead of leaving it off-screen.
  useEffect(() => {
    document.querySelector('[aria-current="page"]')?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [activeTab]);

  useEffect(() => {
    Promise.all([
      profileAPI.get(),
      invoiceSettingsAPI.get().catch(() => ({ data: {} })),
      isManager
        ? welcomeAPI.getConfig().catch(() => ({ data: {} }))
        : Promise.resolve({ data: {} }),
      isManager
        ? welcomeAPI.users().catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
      isManager
        ? welcomeAPI.personal().catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
    ])
      .then(([pRes, iRes, wRes, wuRes, wpRes]) => {
        const profile = Array.isArray(pRes.data) ? pRes.data[0] : pRes.data;
        if (profile) {
          setForm({
            name: profile.name || "",
            subtitle: profile.subtitle || "",
            phone: profile.phone || "",
            mobile: profile.mobile || "",
            address: profile.address || "",
            website: profile.website || "",
            footer_text: profile.footer_text || "",
            tax_id: profile.tax_id || "",
            customer_documents_path: profile.customer_documents_path || "",
          });
          setSocialLinks(profile.social_links || []);
          if (profile.logo_url) setLogoPreview(profile.logo_url);
        }
        if (iRes.data && Object.keys(iRes.data).length)
          setInvoiceCfg((prev) => ({ ...prev, ...iRes.data }));
        setWelcomeCfg((prev) => ({ ...prev, ...wRes.data }));
        setWelcomeUsers(wuRes.data || []);
        setPersonalGreetings(wpRes.data || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isManager, isSuperuser]);

  const set = (k: keyof ProfileForm, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files[0];
    if (file) {
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
    }
  };

  const handleSocialSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!socialForm.name.trim() || !socialForm.url.trim()) return;
    setSocialSaving(true);
    setSocialError("");
    const body = new FormData();
    body.append("name", socialForm.name.trim());
    body.append("url", socialForm.url.trim());
    if (socialForm.logo) body.append("logo", socialForm.logo);
    try {
      const { data } = socialForm.id
        ? await socialNetworksAPI.update(socialForm.id, body)
        : await socialNetworksAPI.create(body);
      setSocialLinks((previous) =>
        socialForm.id
          ? previous.map((item) => (item.id === data.id ? data : item))
          : [...previous, data],
      );
      setSocialForm({ id: null, name: "", url: "", logo: null });
      if (socialLogoInputRef.current) socialLogoInputRef.current.value = "";
    } catch (error) {
      setSocialError(
        error.response?.data?.url?.[0] ||
          error.response?.data?.name?.[0] ||
          error.response?.data?.logo?.[0] ||
          "ذخیره شبکهٔ اجتماعی انجام نشد.",
      );
    } finally {
      setSocialSaving(false);
    }
  };

  const handleSocialEdit = (item: SocialLink) => {
    setSocialForm({ id: item.id, name: item.name, url: item.url, logo: null });
    if (socialLogoInputRef.current) socialLogoInputRef.current.value = "";
  };
  const handleSocialDelete = async (id: number) => {
    try {
      await socialNetworksAPI.delete(id);
      setSocialLinks((previous) => previous.filter((item) => item.id !== id));
      if (socialForm.id === id) {
        setSocialForm({ id: null, name: "", url: "", logo: null });
        if (socialLogoInputRef.current) socialLogoInputRef.current.value = "";
      }
    } catch {
      setSocialError("حذف شبکهٔ اجتماعی انجام نشد.");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => {
      if (k !== "customer_documents_path" || isSuperuser) fd.append(k, v);
    });
    if (logoFile) fd.append("logo", logoFile);
    try {
      await profileAPI.update(fd);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      alert("خطا در ذخیره: " + JSON.stringify(e.response?.data || e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveInvoiceConfig = async () => {
    setInvoiceCfgSaving(true);
    try {
      const { data } = await invoiceSettingsAPI.update({
        office_card_fee_threshold:
          Number(invoiceCfg.office_card_fee_threshold) || 0,
        show_discount_field: Boolean(invoiceCfg.show_discount_field),
        show_tax_field: Boolean(invoiceCfg.show_tax_field),
        show_seller_signature: Boolean(invoiceCfg.show_seller_signature),
        show_buyer_signature: Boolean(invoiceCfg.show_buyer_signature),
        enable_invoice_clone: invoiceCfg.enable_invoice_clone !== false,
      });
      setInvoiceCfg((prev) => ({ ...prev, ...data }));
      setInvoiceCfgMsg("✅ تنظیمات واریزی ذخیره شد");
    } catch (error) {
      setInvoiceCfgMsg(
        error.response?.data?.detail || "❌ ذخیره تنظیمات واریزی انجام نشد",
      );
    } finally {
      setInvoiceCfgSaving(false);
      setTimeout(() => setInvoiceCfgMsg(""), 4000);
    }
  };

  const handleSaveWelcomeConfig = async () => {
    setWelcomeSaving(true);
    try {
      const { data } = await welcomeAPI.updateConfig(welcomeCfg);
      setWelcomeCfg(data);
      setWelcomeMsg("تنظیمات پیام خوش‌آمدگویی ذخیره شد.");
    } catch (error) {
      setWelcomeMsg(error.response?.data?.detail || "ذخیره تنظیمات انجام نشد.");
    } finally {
      setWelcomeSaving(false);
      window.setTimeout(() => setWelcomeMsg(""), 4000);
    }
  };

  const handleSavePersonalGreeting = async () => {
    if (!personalUserId || !personalMessage.trim()) return;
    setPersonalSaving(true);
    try {
      await welcomeAPI.savePersonal({
        user_id: Number(personalUserId),
        message: personalMessage.trim(),
      });
      const { data } = await welcomeAPI.personal();
      setPersonalGreetings(data);
      setPersonalMessage("");
      setWelcomeMsg("پیام شخصی ذخیره شد.");
    } catch (error) {
      setWelcomeMsg(
        error.response?.data?.message?.[0] || "ذخیره پیام شخصی انجام نشد.",
      );
    } finally {
      setPersonalSaving(false);
      window.setTimeout(() => setWelcomeMsg(""), 4000);
    }
  };

  const handleRemovePersonalGreeting = async (userId: number) => {
    try {
      await welcomeAPI.removePersonal(userId);
      setPersonalGreetings((previous) =>
        previous.filter((item) => item.user_id !== userId),
      );
    } catch {
      setWelcomeMsg("حذف پیام شخصی انجام نشد.");
    }
  };

  if (loading)
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">🎨 تنظیمات</h2>
          <p className="text-slate-400 text-sm mt-0.5">
            شخصی‌سازی برند، لوگو و اطلاعات فروشگاه
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm transition-all flex items-center gap-2 disabled:opacity-60"
        >
          {saving ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            "✅"
          )}
          ذخیره تنظیمات
        </button>
      </div>

      {saved && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm px-4 py-3 rounded-xl flex items-center gap-2">
          ✅ تنظیمات با موفقیت ذخیره شد
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* Vertical tab sidebar */}
        <aside className="w-full md:w-56 shrink-0 md:sticky md:top-6">
          <nav
            className="flex md:flex-col gap-1.5 overflow-x-auto md:overflow-visible pb-1 md:pb-0 [mask-image:linear-gradient(to_left,transparent,black_20px,black_calc(100%-20px),transparent)] md:[mask-image:none]"
            aria-label="بخش‌های تنظیمات"
          >
            {settingsTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                aria-current={activeTab === t.id ? "page" : undefined}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm whitespace-nowrap text-right transition-all border ${
                  activeTab === t.id
                    ? "bg-blue-600/15 border-blue-500/40 text-blue-300 font-medium"
                    : "bg-slate-800/50 border-slate-700/50 text-slate-300 hover:bg-slate-700/40"
                }`}
              >
                <span className="text-base">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="flex-1 min-w-0 w-full space-y-6">
          {activeTab === "brand" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Branding */}
              <Section title="برند و لوگو" icon="🎨">
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="w-20 h-20 rounded-2xl bg-slate-700/50 border-2 border-dashed border-slate-600 flex items-center justify-center overflow-hidden shrink-0">
                      {logoPreview ? (
                        <img
                          src={logoPreview}
                          alt="Logo"
                          className="w-full h-full object-cover rounded-xl"
                        />
                      ) : (
                        <span className="text-3xl">💎</span>
                      )}
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-slate-400 mb-1.5">
                        لوگو (PNG/JPG)
                      </label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoChange}
                        className="block w-full text-sm text-slate-400 file:mr-3 file:py-1.5 file:px-4 file:rounded-lg file:border-0 file:text-sm file:bg-blue-600 file:text-white hover:file:bg-blue-700 file:cursor-pointer file:transition-all"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <F label="نام مجموعه">
                      <input
                        className={inp}
                        value={form.name}
                        onChange={(e) => set("name", e.target.value)}
                        placeholder="نام فروشگاه"
                      />
                    </F>
                    <F label="زیرعنوان">
                      <input
                        className={inp}
                        value={form.subtitle}
                        onChange={(e) => set("subtitle", e.target.value)}
                        placeholder="سیستم مدیریت مالی"
                      />
                    </F>
                  </div>
                  <F label="شناسه مالیاتی">
                    <input
                      className={inp}
                      value={form.tax_id}
                      onChange={(e) => set("tax_id", e.target.value)}
                      placeholder="شناسه مالیاتی (اختیاری)"
                    />
                  </F>
                </div>
              </Section>

              {/* Contact */}
              <Section title="اطلاعات تماس" icon="📞">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <F label="تلفن ثابت">
                      <input
                        className={inp}
                        value={form.phone}
                        onChange={(e) => set("phone", e.target.value)}
                        placeholder="021-12345678"
                      />
                    </F>
                    <F label="موبایل">
                      <input
                        className={inp}
                        value={form.mobile}
                        onChange={(e) => set("mobile", e.target.value)}
                        placeholder="09121234567"
                      />
                    </F>
                  </div>
                  <F label="آدرس">
                    <textarea
                      className={inp}
                      rows={2}
                      value={form.address}
                      onChange={(e) => set("address", e.target.value)}
                      placeholder="آدرس مجموعه"
                    />
                  </F>
                  <F label="وب‌سایت">
                    <input
                      className={inp}
                      value={form.website}
                      onChange={(e) => set("website", e.target.value)}
                      placeholder="https://example.com"
                    />
                  </F>
                  <div className="space-y-3 border-t border-slate-700/50 pt-4">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-200">
                        شبکه‌های اجتماعی
                      </h4>
                      <p className="mt-1 text-xs text-slate-400">
                        نام، نشانی و لوگوی دلخواهتان را اضافه کنید؛ این موارد در
                        نسخهٔ چاپی فاکتور نیز نمایش داده می‌شوند.
                      </p>
                    </div>
                    {socialLinks.length > 0 && (
                      <div className="space-y-2">
                        {socialLinks.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-700/15 p-3"
                          >
                            {item.logo_url ? (
                              <img
                                src={item.logo_url}
                                alt={`لوگوی ${item.name}`}
                                className="h-9 w-9 shrink-0 rounded-lg border border-slate-600/50 bg-white object-contain p-1"
                              />
                            ) : (
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-700 text-lg">
                                🌐
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-slate-200">
                                {item.name}
                              </p>
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                                dir="ltr"
                                className="block truncate text-left text-xs text-blue-400 hover:underline"
                              >
                                {item.url}
                              </a>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleSocialEdit(item)}
                              className="rounded-lg px-2 py-1 text-xs text-blue-400 hover:bg-blue-500/10"
                            >
                              ویرایش
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSocialDelete(item.id)}
                              className="rounded-lg px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10"
                            >
                              حذف
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <form
                      onSubmit={handleSocialSubmit}
                      className="grid gap-3 rounded-xl border border-dashed border-slate-600/60 p-3 sm:grid-cols-2"
                    >
                      <F
                        label={
                          socialForm.id
                            ? "ویرایش نام شبکه"
                            : "نام شبکهٔ اجتماعی"
                        }
                      >
                        <input
                          className={inp}
                          maxLength={80}
                          required
                          value={socialForm.name}
                          onChange={(event) =>
                            setSocialForm((previous) => ({
                              ...previous,
                              name: event.target.value,
                            }))
                          }
                          placeholder="مثلاً لینکدین یا وبلاگ"
                        />
                      </F>
                      <F label="نشانی کامل">
                        <input
                          className={`${inp} text-left`}
                          dir="ltr"
                          type="url"
                          maxLength={500}
                          required
                          value={socialForm.url}
                          onChange={(event) =>
                            setSocialForm((previous) => ({
                              ...previous,
                              url: event.target.value,
                            }))
                          }
                          placeholder="https://example.com/your-page"
                        />
                      </F>
                      <F label="لوگو (تصویر اختیاری)">
                        <input
                          ref={socialLogoInputRef}
                          type="file"
                          accept="image/*"
                          onChange={(event) =>
                            setSocialForm((previous) => ({
                              ...previous,
                              logo: event.target.files?.[0] || null,
                            }))
                          }
                          className="block w-full text-xs text-slate-400 file:ml-2 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:text-slate-200"
                        />
                        <span className="text-[11px] text-slate-500">
                          در ویرایش، خالی گذاشتن این مورد لوگوی فعلی را نگه
                          می‌دارد.
                        </span>
                      </F>
                      <div className="flex items-end gap-2">
                        <button
                          type="submit"
                          disabled={
                            socialSaving ||
                            !socialForm.name.trim() ||
                            !socialForm.url.trim()
                          }
                          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {socialSaving
                            ? "در حال ذخیره…"
                            : socialForm.id
                              ? "ذخیره تغییرات"
                              : "افزودن شبکه"}
                        </button>
                        {socialForm.id && (
                          <button
                            type="button"
                            onClick={() => {
                              setSocialForm({
                                id: null,
                                name: "",
                                url: "",
                                logo: null,
                              });
                              if (socialLogoInputRef.current)
                                socialLogoInputRef.current.value = "";
                            }}
                            className="rounded-xl border border-slate-600 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700/50"
                          >
                            انصراف
                          </button>
                        )}
                      </div>
                      {socialError && (
                        <p
                          role="alert"
                          className="text-xs text-rose-400 sm:col-span-2"
                        >
                          {socialError}
                        </p>
                      )}
                    </form>
                  </div>
                </div>
              </Section>
            </div>
          )}

          {activeTab === "invoice" && isManager && (
            <Section title="تنظیمات فاکتور" icon="🧾">
              <div className="space-y-3">
                <p className="text-sm font-medium text-slate-200">
                  نمایش فیلدهای خلاصه مالی
                </p>
                <label className="flex items-center gap-3 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={invoiceCfg.show_discount_field}
                    onChange={(e) =>
                      setInvoiceCfg((prev) => ({
                        ...prev,
                        show_discount_field: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 accent-blue-500"
                  />{" "}
                  نمایش فیلد تخفیف
                </label>
                <label className="flex items-center gap-3 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={invoiceCfg.show_tax_field}
                    onChange={(e) =>
                      setInvoiceCfg((prev) => ({
                        ...prev,
                        show_tax_field: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 accent-blue-500"
                  />{" "}
                  نمایش فیلد مالیات
                </label>
                <p className="border-t border-slate-700/50 pt-3 text-sm font-medium text-slate-200">
                  بخش مهر و امضا در فاکتور
                </p>
                <label className="flex items-center gap-3 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={invoiceCfg.show_seller_signature}
                    onChange={(e) =>
                      setInvoiceCfg((prev) => ({
                        ...prev,
                        show_seller_signature: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 accent-blue-500"
                  />{" "}
                  نمایش مهر و امضای فروشنده
                </label>
                <label className="flex items-center gap-3 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={invoiceCfg.show_buyer_signature}
                    onChange={(e) =>
                      setInvoiceCfg((prev) => ({
                        ...prev,
                        show_buyer_signature: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 accent-blue-500"
                  />{" "}
                  نمایش امضای خریدار
                </label>
                <p className="border-t border-slate-700/50 pt-3 text-sm font-medium text-slate-200">
                  قابلیت‌های صدور فاکتور
                </p>
                <label className="flex items-center gap-3 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={invoiceCfg.enable_invoice_clone !== false}
                    onChange={(e) =>
                      setInvoiceCfg((prev) => ({
                        ...prev,
                        enable_invoice_clone: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 accent-blue-500"
                  />{" "}
                  فعال بودن «صدور مشابه» فاکتور
                </label>
                <p className="text-[11px] text-slate-500 -mt-1">
                  با خاموش کردن، دکمهٔ صدور مشابه از صفحهٔ فاکتور و لیست
                  فاکتورها حذف می‌شود و بارگذاری فاکتور مشابه انجام نمی‌شود.
                </p>
                <F label="حداقل مبلغ فاکتور برای محاسبهٔ واریزی (تومان)">
                  <input
                    type="number"
                    min="0"
                    step="100000"
                    className={inp}
                    value={invoiceCfg.office_card_fee_threshold}
                    onChange={(event) =>
                      setInvoiceCfg((prev) => ({
                        ...prev,
                        office_card_fee_threshold: event.target.value,
                      }))
                    }
                  />
                </F>
                <p className="text-xs text-slate-400">
                  اگر کارت پرداخت «کارت دفتر» باشد و جمع خدمات از این مبلغ بیشتر
                  شود، ردیف واریزی با نرخ ۱۰٬۰۰۰ تومان به‌ازای هر یک‌میلیون
                  تومان (۱٪) خودکار ثبت می‌شود. صفر یعنی غیرفعال.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleSaveInvoiceConfig}
                    disabled={invoiceCfgSaving}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50"
                  >
                    {invoiceCfgSaving
                      ? "در حال ذخیره..."
                      : "ذخیره تنظیمات فاکتور"}
                  </button>
                  {invoiceCfgMsg && (
                    <span role="status" className="text-xs text-slate-300">
                      {invoiceCfgMsg}
                    </span>
                  )}
                </div>
              </div>
            </Section>
          )}

          {activeTab === "packages" && <ServicePackagesSection />}

          {activeTab === "shortcuts" && <ShortcutsSection />}

          {activeTab === "welcome" && isManager && (
            <Section title="پیام خوش‌آمدگویی روزانه" icon="🎉">
              <div className="space-y-5">
                <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-700/50 bg-slate-700/20 p-4">
                  <span>
                    <span className="block text-sm font-medium text-slate-100">
                      نمایش پیام در اولین ورود روزانه
                    </span>
                    <span className="mt-1 block text-xs text-slate-400">
                      پس از نمایش، پیام تا روز بعد دوباره به همان کاربر نشان
                      داده نمی‌شود.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={welcomeCfg.enabled}
                    onChange={(event) =>
                      setWelcomeCfg((previous) => ({
                        ...previous,
                        enabled: event.target.checked,
                      }))
                    }
                    className="h-5 w-5 accent-blue-600"
                  />
                </label>
                <F label="پیام عمومی برای همهٔ کاربران">
                  <textarea
                    className={inp}
                    rows={3}
                    maxLength={5000}
                    value={welcomeCfg.global_message}
                    onChange={(event) =>
                      setWelcomeCfg((previous) => ({
                        ...previous,
                        global_message: event.target.value,
                      }))
                    }
                    placeholder="مثلاً: روز خوبی داشته باشید و پرانرژی شروع کنید!"
                  />
                </F>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleSaveWelcomeConfig}
                    disabled={welcomeSaving}
                    className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {welcomeSaving ? "در حال ذخیره…" : "ذخیره پیام عمومی"}
                  </button>
                  <span role="status" className="text-xs text-slate-500">
                    پیام شخصی کاربر، در صورت ثبت، جایگزین پیام عمومی او می‌شود.
                  </span>
                </div>

                <div className="border-t border-slate-700/50 pt-5">
                  <h4 className="mb-3 text-sm font-semibold text-slate-100">
                    پیام شخصی برای یک کاربر
                  </h4>
                  <div className="grid gap-3 sm:grid-cols-[minmax(10rem,1fr)_2fr_auto] sm:items-end">
                    <F label="کاربر">
                      <select
                        className={inp}
                        value={personalUserId}
                        onChange={(event) =>
                          setPersonalUserId(event.target.value)
                        }
                      >
                        <option value="">انتخاب کاربر…</option>
                        {welcomeUsers.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.name}
                          </option>
                        ))}
                      </select>
                    </F>
                    <F label="متن پیام شخصی">
                      <textarea
                        className={inp}
                        rows={2}
                        maxLength={5000}
                        value={personalMessage}
                        onChange={(event) =>
                          setPersonalMessage(event.target.value)
                        }
                        placeholder="پیام مخصوص این کاربر"
                      />
                    </F>
                    <button
                      type="button"
                      onClick={handleSavePersonalGreeting}
                      disabled={
                        personalSaving ||
                        !personalUserId ||
                        !personalMessage.trim()
                      }
                      className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {personalSaving ? "در حال ذخیره…" : "ذخیره پیام شخصی"}
                    </button>
                  </div>
                  {personalGreetings.length > 0 && (
                    <ul className="mt-4 space-y-2">
                      {personalGreetings.map((item) => (
                        <li
                          key={item.user_id}
                          className="flex items-start justify-between gap-3 rounded-xl border border-slate-700/50 bg-slate-700/15 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-200">
                              {item.name}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-400">
                              {item.message}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              handleRemovePersonalGreeting(item.user_id)
                            }
                            className="shrink-0 rounded-lg px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10"
                          >
                            حذف
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {welcomeMsg && (
                  <p role="status" className="text-sm text-emerald-600">
                    {welcomeMsg}
                  </p>
                )}
              </div>
            </Section>
          )}

          {/* Invoice Footer */}
          {activeTab === "invoice" && (
            <Section title="متن پاورقی فاکتور" icon="📄">
              <F label="این متن در پایین فاکتورهای چاپی نمایش داده می‌شود">
                <textarea
                  className={inp}
                  rows={3}
                  value={form.footer_text}
                  onChange={(e) => set("footer_text", e.target.value)}
                  placeholder="مثال: از اعتماد شما سپاسگزاریم. برای پیگیری سفارش با شماره زیر تماس بگیرید."
                />
              </F>
            </Section>
          )}

          {/* Customer Documents Path */}
          {activeTab === "storage" && isSuperuser && (
            <Section title="مسیر ذخیره مدارک مشتریان" icon="📁">
              <div className="space-y-3">
                <F label="مسیر پوشه اصلی مدارک (روی سرور)">
                  <div className="flex gap-2">
                    <input
                      className={`${inp} min-w-0 flex-1`}
                      value={form.customer_documents_path}
                      readOnly
                      placeholder="پوشه‌ای از سیستم سرور انتخاب کنید"
                      dir="ltr"
                    />
                    {isSuperuser && (
                      <button
                        type="button"
                        onClick={() => setDocsPickerOpen(true)}
                        className="shrink-0 rounded-xl border border-blue-500/40 bg-blue-600/20 px-4 py-2 text-sm text-blue-200 hover:bg-blue-600/30"
                      >
                        انتخاب پوشه
                      </button>
                    )}
                  </div>
                  {!isSuperuser && (
                    <p className="text-slate-600 text-xs">
                      برای تغییر این مسیر، از حساب مدیر ارشد وارد شوید.
                    </p>
                  )}
                </F>
                <p className="text-slate-500 text-xs leading-relaxed">
                  📌 برای هر مشتری یک پوشه با فرمت{" "}
                  <span className="font-mono text-slate-400 bg-slate-700/50 px-1 rounded">
                    [ID]_[نام]
                  </span>{" "}
                  ایجاد می‌شود. اگر این مسیر تنظیم شود، فایل‌های آپلود شده
                  به‌صورت خودکار در این پوشه‌ها کپی می‌شوند.
                </p>
              </div>
            </Section>
          )}

          {/* ── Backup Section ── */}
          {activeTab === "backup" && isSuperuser && (
            <BackupTab isSuperuser={isSuperuser} />
          )}

          {/* ── Database Section ── */}
          {activeTab === "database" && isSuperuser && (
            <DatabaseTab isSuperuser={isSuperuser} />
          )}

          {/* ── App Update Section ── */}
          {activeTab === "update" && isSuperuser && (
            <UpdateTab isSuperuser={isSuperuser} />
          )}

          {/* ── Businesses (ERP) Section ── */}
          {activeTab === "businesses" && isSuperuser && (
            <BusinessesTab isSuperuser={isSuperuser} />
          )}

          {/* ── Registration codes (licenses) Section ── */}
          {activeTab === "licenses" && isSuperuser && <RegistrationCodesTab />}
          <ServerFolderPicker
            open={docsPickerOpen}
            title="مدارک مشتریان"
            onClose={() => setDocsPickerOpen(false)}
            onConfirm={(path) => {
              set("customer_documents_path", path);
              setDocsPickerOpen(false);
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default Settings;
