import React, { useCallback, useEffect, useRef, useState } from "react";
import { accountSecurityAPI } from "../services/api";

interface CaptchaFieldProps {
  /** Called whenever the challenge or answer changes. */
  onChange: (challengeId: string, answer: string) => void;
  dark?: boolean;
}

/**
 * Built-in image CAPTCHA: fetches a challenge from the backend and
 * reports (id, answer) upward. The challenge is one-shot server-side,
 * so parents should call the exposed refresh after a failed submit —
 * simplest via `key` remount or the refresh button rendered here.
 */
const CaptchaField: React.FC<CaptchaFieldProps> = ({ onChange, dark }) => {
  const [challenge, setChallenge] = useState<{
    id: string;
    image: string;
  } | null>(null);
  const [answer, setAnswer] = useState("");
  const [failed, setFailed] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const load = useCallback(async () => {
    try {
      const res = await accountSecurityAPI.captcha();
      setChallenge(res.data);
      setAnswer("");
      onChangeRef.current(res.data.id, "");
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const inputClass = dark
    ? "w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-transparent text-white placeholder-blue-200/50 transition-all outline-none"
    : "w-full px-4 py-3 bg-slate-800/60 border border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-100 placeholder-slate-500 transition-all outline-none";

  return (
    <div>
      <label
        className={`block text-sm font-medium mb-2 ${dark ? "text-blue-100" : "text-slate-300"}`}
      >
        کد امنیتی تصویر
      </label>
      <div className="flex items-center gap-3">
        {challenge ? (
          <img
            src={challenge.image}
            alt="کپچا"
            className="h-[50px] w-[130px] rounded-lg border border-white/10 shrink-0"
          />
        ) : (
          <div className="h-[50px] w-[130px] rounded-lg bg-slate-700/50 flex items-center justify-center text-xs text-slate-400 shrink-0">
            {failed ? "خطا در بارگذاری" : "در حال بارگذاری…"}
          </div>
        )}
        <button
          type="button"
          onClick={load}
          title="تصویر تازه"
          className={`px-3 py-2 rounded-lg text-sm ${dark ? "bg-white/10 text-white hover:bg-white/20" : "bg-slate-700 text-slate-200 hover:bg-slate-600"}`}
        >
          ↻
        </button>
        <input
          type="text"
          value={answer}
          dir="ltr"
          autoComplete="off"
          onChange={(e) => {
            setAnswer(e.target.value);
            if (challenge) onChange(challenge.id, e.target.value);
          }}
          className={`${inputClass} text-center tracking-[0.3em] uppercase`}
          placeholder="ABCD"
        />
      </div>
    </div>
  );
};

export default CaptchaField;
