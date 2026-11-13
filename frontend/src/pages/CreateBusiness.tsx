import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { businessesAPI, type BusinessTemplate } from "../services/api";
import { useBusiness } from "../lib/business";
import { formatApiError } from "../utils/apiError";

/** First-business setup for self-registered customers. */
const CreateBusiness = () => {
  const navigate = useNavigate();
  const { refresh } = useBusiness();
  const [templates, setTemplates] = useState<BusinessTemplate[]>([]);
  const [name, setName] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [personType, setPersonType] = useState<"individual" | "legal">(
    "individual",
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    businessesAPI
      .templates()
      .then((res) => {
        setTemplates(res.data);
        if (res.data.length > 0) setTemplateKey(res.data[0].key);
      })
      .catch(() => setError("دریافت قالب‌های کسب‌وکار از سرور ناموفق بود."));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await businessesAPI.create({
        name: name.trim(),
        template_key: templateKey,
        person_type: personType,
      });
      await refresh();
      navigate("/");
    } catch (err) {
      setError(formatApiError(err, "ساخت کسب‌وکار ناموفق بود."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">
          راه‌اندازی کسب‌وکار
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          نام و صنف کسب‌وکارتان را انتخاب کنید؛ حساب‌ها، خدمات و تنظیمات اولیه
          بر اساس همان صنف ساخته می‌شود.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/40 rounded-xl text-rose-200 text-sm">
          خطا: {error}
        </div>
      )}

      <form
        onSubmit={submit}
        className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-6 space-y-6"
      >
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            نام کسب‌وکار
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 text-slate-100 outline-none"
            placeholder="مثلاً: فروشگاه رضایی"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            نوع شخصیت
          </label>
          <div className="flex gap-3">
            {[
              { value: "individual", label: "حقیقی" },
              { value: "legal", label: "حقوقی (شرکت)" },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  setPersonType(option.value as "individual" | "legal")
                }
                className={`px-4 py-2.5 rounded-xl border text-sm transition-all ${
                  personType === option.value
                    ? "bg-blue-600/20 border-blue-500/50 text-blue-200"
                    : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700/60"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            صنف و قالب شروع
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {templates.map((template) => (
              <button
                key={template.key}
                type="button"
                onClick={() => setTemplateKey(template.key)}
                className={`text-right p-4 rounded-xl border transition-all ${
                  templateKey === template.key
                    ? "bg-blue-600/15 border-blue-500/60"
                    : "bg-slate-800/70 border-slate-700 hover:border-slate-500"
                }`}
              >
                <div className="font-medium text-slate-100">
                  {template.title}
                </div>
                <div className="text-xs text-slate-400 mt-1 leading-5">
                  {template.description}
                </div>
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !name.trim() || !templateKey}
          className="w-full py-3.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-semibold shadow-lg shadow-blue-500/20 transition-all active:scale-[0.99] disabled:opacity-60"
        >
          {loading ? "در حال راه‌اندازی…" : "ساخت کسب‌وکار و شروع"}
        </button>
      </form>
    </div>
  );
};

export default CreateBusiness;
