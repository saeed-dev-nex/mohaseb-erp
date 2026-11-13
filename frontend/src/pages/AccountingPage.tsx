import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  accountingAPI,
  type Account,
  type JournalEntry,
  type TrialBalanceRow,
} from "../services/api";
import { useBusiness } from "../lib/business";
import JalaliDatePicker from "../components/JalaliDatePicker";
import { toJalali } from "../utils/persian";
import { Button, EmptyState, Spinner } from "../components/ui";
import { Section } from "../components/FormSection";

const fmt = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("fa-IR").format(Number(n) || 0);

const inp =
  "w-full px-3 py-2.5 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all";

type LineDraft = {
  account: number | "";
  description: string;
  debit: string;
  credit: string;
};

const emptyLine = (): LineDraft => ({
  account: "",
  description: "",
  debit: "",
  credit: "",
});

type Tab = "entries" | "chart" | "trial";

export default function AccountingPage() {
  const { current } = useBusiness();
  const [tab, setTab] = useState<Tab>("entries");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [entryDate, setEntryDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [entryDesc, setEntryDesc] = useState("");
  const [entryRef, setEntryRef] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine()]);
  const [trial, setTrial] = useState<{
    rows: TrialBalanceRow[];
    total_debit: number;
    total_credit: number;
    is_balanced: boolean;
  } | null>(null);
  const [ledger, setLedger] = useState<{
    accountTitle: string;
    rows: {
      entry_number: number;
      date: string;
      description: string;
      party_name: string;
      debit: number;
      credit: number;
      balance: number;
    }[];
  } | null>(null);
  const [newAccount, setNewAccount] = useState({
    code: "",
    title: "",
    parent: "" as number | "",
    nature: "debit" as "debit" | "credit",
  });

  const load = useCallback(async () => {
    if (!current) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [accountsRes, entriesRes] = await Promise.all([
        accountingAPI.accounts(),
        accountingAPI.entries(),
      ]);
      setAccounts(accountsRes.data);
      const data = entriesRes.data as unknown as
        JournalEntry[] | { results: JournalEntry[] };
      setEntries(Array.isArray(data) ? data : data.results);
    } catch {
      setMessage("خطا در دریافت اطلاعات حسابداری");
    } finally {
      setLoading(false);
    }
  }, [current]);

  useEffect(() => {
    load();
  }, [load]);

  const postableAccounts = useMemo(
    () => accounts.filter((a) => a.level >= 3 && a.is_active),
    [accounts],
  );

  const totalDebit = lines.reduce((s, l) => s + (parseInt(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseInt(l.credit) || 0), 0);
  const balanced = totalDebit > 0 && totalDebit === totalCredit;

  const openEditor = (entry?: JournalEntry) => {
    if (entry) {
      setEditing(entry);
      setEntryDate(entry.date);
      setEntryDesc(entry.description);
      setEntryRef(entry.reference);
      setLines(
        entry.lines.map((l) => ({
          account: l.account,
          description: l.description,
          debit: l.debit ? String(l.debit) : "",
          credit: l.credit ? String(l.credit) : "",
        })),
      );
    } else {
      setEditing(null);
      setEntryDate(new Date().toISOString().slice(0, 10));
      setEntryDesc("");
      setEntryRef("");
      setLines([emptyLine(), emptyLine()]);
    }
    setEditorOpen(true);
  };

  const saveEntry = async (postAfter: boolean) => {
    const payload = {
      date: entryDate,
      description: entryDesc,
      reference: entryRef,
      lines: lines
        .filter((l) => l.account !== "")
        .map((l) => ({
          account: l.account,
          description: l.description,
          debit: parseInt(l.debit) || 0,
          credit: parseInt(l.credit) || 0,
        })),
    };
    try {
      const res = editing
        ? await accountingAPI.updateEntry(editing.id, payload)
        : await accountingAPI.createEntry(payload);
      if (postAfter) await accountingAPI.postEntry(res.data.id);
      setMessage(postAfter ? "سند ثبت نهایی شد." : "پیش‌نویس سند ذخیره شد.");
      setEditorOpen(false);
      load();
    } catch (err) {
      const data = (err as { response?: { data?: unknown } })?.response?.data;
      setMessage(`خطا در ذخیرهٔ سند: ${JSON.stringify(data ?? "")}`);
    }
  };

  const actOnEntry = async (
    entry: JournalEntry,
    kind: "post" | "unpost" | "delete",
  ) => {
    try {
      if (kind === "post") await accountingAPI.postEntry(entry.id);
      if (kind === "unpost") await accountingAPI.unpostEntry(entry.id);
      if (kind === "delete") await accountingAPI.deleteEntry(entry.id);
      setMessage("انجام شد.");
      load();
    } catch {
      setMessage("خطا در انجام عملیات روی سند");
    }
  };

  const loadTrial = async () => {
    try {
      const res = await accountingAPI.trialBalance();
      setTrial(res.data);
    } catch {
      setMessage("خطا در دریافت تراز آزمایشی");
    }
  };

  const openLedger = async (row: TrialBalanceRow) => {
    try {
      const res = await accountingAPI.ledger(row.account);
      const data = res.data as unknown as {
        account: Account;
        rows: typeof ledger extends null
          ? never
          : NonNullable<typeof ledger>["rows"];
      };
      setLedger({
        accountTitle: `${data.account.code} — ${data.account.title}`,
        rows: data.rows,
      });
    } catch {
      setMessage("خطا در دریافت دفتر معین");
    }
  };

  const seedChart = async () => {
    try {
      const res = await accountingAPI.seedChart();
      setMessage(
        `کدینگ استاندارد: ${fmt(res.data.created)} حساب جدید، ${fmt(res.data.existing)} موجود.`,
      );
      load();
    } catch {
      setMessage("خطا در ثبت کدینگ استاندارد");
    }
  };

  const createAccount = async () => {
    if (!newAccount.code || !newAccount.title) return;
    try {
      await accountingAPI.createAccount({
        code: newAccount.code,
        title: newAccount.title,
        parent: newAccount.parent === "" ? null : newAccount.parent,
        nature: newAccount.nature,
      });
      setNewAccount({ code: "", title: "", parent: "", nature: "debit" });
      setMessage("حساب جدید ساخته شد.");
      load();
    } catch {
      setMessage("خطا در ساخت حساب (کد تکراری؟)");
    }
  };

  if (!current) {
    return (
      <EmptyState
        icon="📒"
        title="کسب‌وکاری انتخاب نشده است"
        description="برای کار با حسابداری، ابتدا از نوبار یک کسب‌وکار انتخاب کنید."
      />
    );
  }
  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-white">
          حسابداری — {current.name}
        </h1>
        <div className="flex gap-2">
          {(
            [
              ["entries", "اسناد"],
              ["chart", "کدینگ حساب‌ها"],
              ["trial", "تراز آزمایشی"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                if (key === "trial") loadTrial();
              }}
              className={`px-4 py-2 rounded-xl text-sm transition-all ${
                tab === key
                  ? "bg-blue-600 text-white"
                  : "bg-slate-700/60 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {message && (
        <p
          className={`text-sm rounded-xl px-3 py-2 border ${
            message.startsWith("خطا")
              ? "text-rose-300 bg-rose-500/10 border-rose-500/20"
              : "text-emerald-300 bg-emerald-500/10 border-emerald-500/20"
          }`}
        >
          {message}
        </p>
      )}

      {tab === "entries" && (
        <Section title="اسناد حسابداری" icon="🧾">
          <div className="flex justify-end mb-4">
            <Button
              type="button"
              variant="primary"
              onClick={() => openEditor()}
            >
              + سند جدید
            </Button>
          </div>
          {editorOpen && (
            <div className="mb-5 rounded-2xl border border-blue-500/30 bg-slate-800/60 p-4 space-y-4">
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    تاریخ سند
                  </label>
                  <JalaliDatePicker value={entryDate} onChange={setEntryDate} />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    شرح سند
                  </label>
                  <input
                    className={inp}
                    value={entryDesc}
                    onChange={(e) => setEntryDesc(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    شماره مرجع / عطف
                  </label>
                  <input
                    className={inp}
                    value={entryRef}
                    onChange={(e) => setEntryRef(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                {lines.map((line, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-2 items-center"
                  >
                    <select
                      className={`${inp} col-span-4`}
                      value={line.account}
                      onChange={(e) => {
                        const next = [...lines];
                        next[idx] = {
                          ...line,
                          account: e.target.value ? Number(e.target.value) : "",
                        };
                        setLines(next);
                      }}
                    >
                      <option value="">انتخاب حساب معین…</option>
                      {postableAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.title}
                        </option>
                      ))}
                    </select>
                    <input
                      className={`${inp} col-span-3`}
                      placeholder="شرح سطر"
                      value={line.description}
                      onChange={(e) => {
                        const next = [...lines];
                        next[idx] = { ...line, description: e.target.value };
                        setLines(next);
                      }}
                    />
                    <input
                      className={`${inp} col-span-2`}
                      placeholder="بدهکار"
                      inputMode="numeric"
                      value={line.debit}
                      onChange={(e) => {
                        const next = [...lines];
                        next[idx] = {
                          ...line,
                          debit: e.target.value.replace(/[^0-9]/g, ""),
                          credit: "",
                        };
                        setLines(next);
                      }}
                    />
                    <input
                      className={`${inp} col-span-2`}
                      placeholder="بستانکار"
                      inputMode="numeric"
                      value={line.credit}
                      onChange={(e) => {
                        const next = [...lines];
                        next[idx] = {
                          ...line,
                          credit: e.target.value.replace(/[^0-9]/g, ""),
                          debit: "",
                        };
                        setLines(next);
                      }}
                    />
                    <button
                      type="button"
                      className="col-span-1 text-rose-300 text-sm"
                      onClick={() =>
                        setLines(lines.filter((_, i) => i !== idx))
                      }
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-blue-300 text-sm"
                  onClick={() => setLines([...lines, emptyLine()])}
                >
                  + افزودن سطر
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="text-slate-300">
                  جمع بدهکار: {fmt(totalDebit)}
                </span>
                <span className="text-slate-300">
                  جمع بستانکار: {fmt(totalCredit)}
                </span>
                <span
                  className={balanced ? "text-emerald-300" : "text-amber-300"}
                >
                  {balanced
                    ? "سند تراز است ✓"
                    : `اختلاف: ${fmt(Math.abs(totalDebit - totalCredit))}`}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => saveEntry(false)}
                >
                  ذخیره پیش‌نویس
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={!balanced}
                  onClick={() => saveEntry(true)}
                >
                  ذخیره و ثبت نهایی
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditorOpen(false)}
                >
                  انصراف
                </Button>
              </div>
            </div>
          )}
          {entries.length === 0 ? (
            <EmptyState
              icon="🧾"
              title="سندی ثبت نشده است"
              description="با دکمهٔ «سند جدید» اولین سند حسابداری را ثبت کنید."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 text-right border-b border-slate-700">
                    <th className="py-2 px-2">شماره</th>
                    <th className="py-2 px-2">تاریخ</th>
                    <th className="py-2 px-2">شرح</th>
                    <th className="py-2 px-2">بدهکار</th>
                    <th className="py-2 px-2">بستانکار</th>
                    <th className="py-2 px-2">وضعیت</th>
                    <th className="py-2 px-2">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr
                      key={entry.id}
                      className="border-b border-slate-800 text-slate-200"
                    >
                      <td className="py-2 px-2">{fmt(entry.number)}</td>
                      <td className="py-2 px-2">{toJalali(entry.date)}</td>
                      <td className="py-2 px-2">{entry.description || "—"}</td>
                      <td className="py-2 px-2">{fmt(entry.total_debit)}</td>
                      <td className="py-2 px-2">{fmt(entry.total_credit)}</td>
                      <td className="py-2 px-2">
                        <span
                          className={
                            entry.status === "posted"
                              ? "text-emerald-300"
                              : "text-amber-300"
                          }
                        >
                          {entry.status_display}
                        </span>
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex gap-2 text-xs">
                          {entry.status === "draft" && (
                            <>
                              <button
                                type="button"
                                className="text-blue-300"
                                onClick={() => openEditor(entry)}
                              >
                                ویرایش
                              </button>
                              <button
                                type="button"
                                className="text-emerald-300"
                                onClick={() => actOnEntry(entry, "post")}
                              >
                                ثبت نهایی
                              </button>
                              <button
                                type="button"
                                className="text-rose-300"
                                onClick={() => actOnEntry(entry, "delete")}
                              >
                                حذف
                              </button>
                            </>
                          )}
                          {entry.status === "posted" && (
                            <button
                              type="button"
                              className="text-amber-300"
                              onClick={() => actOnEntry(entry, "unpost")}
                            >
                              برگرداندن به پیش‌نویس
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {tab === "chart" && (
        <Section title="کدینگ حساب‌ها" icon="🌳">
          <div className="flex justify-end mb-4">
            <Button type="button" variant="outline" onClick={seedChart}>
              ثبت کدینگ استاندارد
            </Button>
          </div>
          <div className="space-y-1 mb-5">
            {accounts.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 text-sm text-slate-200"
                style={{ paddingInlineStart: `${(a.level - 1) * 22}px` }}
              >
                <span className="text-slate-400 font-mono">{a.code}</span>
                <span>{a.title}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-700/70 text-slate-300">
                  {a.level_label}
                </span>
                <span className="text-[11px] text-slate-500">
                  {a.nature === "debit" ? "بدهکار" : "بستانکار"}
                </span>
              </div>
            ))}
          </div>
          <div className="grid sm:grid-cols-5 gap-2 items-end">
            <input
              className={inp}
              placeholder="کد"
              value={newAccount.code}
              onChange={(e) =>
                setNewAccount({ ...newAccount, code: e.target.value })
              }
            />
            <input
              className={inp}
              placeholder="عنوان حساب"
              value={newAccount.title}
              onChange={(e) =>
                setNewAccount({ ...newAccount, title: e.target.value })
              }
            />
            <select
              className={inp}
              value={newAccount.parent}
              onChange={(e) =>
                setNewAccount({
                  ...newAccount,
                  parent: e.target.value ? Number(e.target.value) : "",
                })
              }
            >
              <option value="">بدون والد (گروه)</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.title}
                </option>
              ))}
            </select>
            <select
              className={inp}
              value={newAccount.nature}
              onChange={(e) =>
                setNewAccount({
                  ...newAccount,
                  nature: e.target.value as "debit" | "credit",
                })
              }
            >
              <option value="debit">ماهیت بدهکار</option>
              <option value="credit">ماهیت بستانکار</option>
            </select>
            <Button type="button" variant="primary" onClick={createAccount}>
              ساخت حساب
            </Button>
          </div>
        </Section>
      )}

      {tab === "trial" && (
        <Section title="تراز آزمایشی (اسناد ثبت‌شده)" icon="⚖️">
          {!trial ? (
            <Spinner />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 text-right border-b border-slate-700">
                      <th className="py-2 px-2">کد</th>
                      <th className="py-2 px-2">حساب</th>
                      <th className="py-2 px-2">گردش بدهکار</th>
                      <th className="py-2 px-2">گردش بستانکار</th>
                      <th className="py-2 px-2">مانده بدهکار</th>
                      <th className="py-2 px-2">مانده بستانکار</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trial.rows.map((row) => (
                      <tr
                        key={row.account}
                        className="border-b border-slate-800 text-slate-200 cursor-pointer hover:bg-slate-800/50"
                        onClick={() => openLedger(row)}
                      >
                        <td className="py-2 px-2 font-mono text-slate-400">
                          {row.code}
                        </td>
                        <td className="py-2 px-2">{row.title}</td>
                        <td className="py-2 px-2">{fmt(row.total_debit)}</td>
                        <td className="py-2 px-2">{fmt(row.total_credit)}</td>
                        <td className="py-2 px-2">{fmt(row.balance_debit)}</td>
                        <td className="py-2 px-2">{fmt(row.balance_credit)}</td>
                      </tr>
                    ))}
                    <tr className="text-white font-bold">
                      <td className="py-2 px-2" colSpan={2}>
                        جمع {trial.is_balanced ? "— تراز ✓" : "— ناتراز!"}
                      </td>
                      <td className="py-2 px-2">{fmt(trial.total_debit)}</td>
                      <td className="py-2 px-2">{fmt(trial.total_credit)}</td>
                      <td className="py-2 px-2" colSpan={2}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {ledger && (
                <div className="mt-5">
                  <h3 className="text-sm font-bold text-white mb-2">
                    دفتر معین: {ledger.accountTitle}
                  </h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-400 text-right border-b border-slate-700">
                        <th className="py-2 px-2">سند</th>
                        <th className="py-2 px-2">تاریخ</th>
                        <th className="py-2 px-2">شرح</th>
                        <th className="py-2 px-2">بدهکار</th>
                        <th className="py-2 px-2">بستانکار</th>
                        <th className="py-2 px-2">مانده</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.rows.map((row, i) => (
                        <tr
                          key={i}
                          className="border-b border-slate-800 text-slate-200"
                        >
                          <td className="py-2 px-2">{fmt(row.entry_number)}</td>
                          <td className="py-2 px-2">{toJalali(row.date)}</td>
                          <td className="py-2 px-2">{row.description}</td>
                          <td className="py-2 px-2">{fmt(row.debit)}</td>
                          <td className="py-2 px-2">{fmt(row.credit)}</td>
                          <td className="py-2 px-2">{fmt(row.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Section>
      )}
    </div>
  );
}
