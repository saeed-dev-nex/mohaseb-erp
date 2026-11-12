import React, { useState } from "react";

/**
 * Password field with a show/hide eye toggle. Drop-in replacement for
 * <input type="password">: every input prop (value, onChange, className,
 * placeholder, dir, required, autoComplete...) is forwarded untouched; the
 * wrapper only adds the toggle button and reserves space for it.
 *
 * The clearance is PHYSICAL (pl-11, button pinned left), not logical:
 * callers pass dir="ltr" for the secret itself while the page is RTL, so
 * a logical pe-11 reserved space on the opposite side and the text slid
 * under the button.
 */
const PasswordInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className = "", ...props }, ref) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        {...props}
        ref={ref}
        type={visible ? "text" : "password"}
        className={`${className} pl-11`}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "مخفی کردن رمز" : "نمایش رمز"}
        title={visible ? "مخفی کردن رمز" : "نمایش رمز"}
        className="absolute inset-y-0 left-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-200 transition-colors"
      >
        {visible ? "🙈" : "👁️"}
      </button>
    </div>
  );
});

export default PasswordInput;
