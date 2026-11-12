import React from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";

// ---- Stat Card ----
type StatCardProps = {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  color?: "blue" | "green" | "yellow" | "red" | "purple";
  sub?: ReactNode;
};

export const StatCard = ({
  label,
  value,
  icon,
  color = "blue",
  sub,
}: StatCardProps) => {
  const colors: Record<string, string> = {
    blue: "from-blue-500/20 to-blue-600/10 border-blue-500/20 text-blue-400",
    green:
      "from-green-500/20 to-green-600/10 border-green-500/20 text-green-400",
    yellow:
      "from-yellow-500/20 to-yellow-600/10 border-yellow-500/20 text-yellow-400",
    red: "from-red-500/20 to-red-600/10 border-red-500/20 text-red-400",
    purple:
      "from-purple-500/20 to-purple-600/10 border-purple-500/20 text-purple-400",
  };

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br p-6 ${colors[color]}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-slate-400 text-sm mb-1">{label}</p>
          <p className="text-white text-2xl font-bold">{value}</p>
          {sub && <p className="text-slate-500 text-xs mt-1">{sub}</p>}
        </div>
        <span className="text-3xl opacity-80">{icon}</span>
      </div>
    </div>
  );
};

// ---- Status Badge ----
export const StatusBadge = ({ status }: { status: string }) => {
  const map: Record<string, { label: string; cls: string }> = {
    draft: {
      label: "پیش‌نویس",
      cls: "bg-slate-500/20 text-slate-400 border-slate-500/30",
    },
    pending: {
      label: "در انتظار",
      cls: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    },
    paid: {
      label: "پرداخت شده",
      cls: "bg-green-500/20 text-green-400 border-green-500/30",
    },
    commission_paid: {
      label: "کارمزد پرداخت شده",
      cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    },
    cancelled: {
      label: "لغو شده",
      cls: "bg-red-500/20 text-red-400 border-red-500/30",
    },
  };
  const { label, cls } = map[status] || { label: status, cls: "" };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${cls}`}
    >
      {label}
    </span>
  );
};

// ---- Loading Spinner ----
export const Spinner = ({ size = "md" }: { size?: "sm" | "md" | "lg" }) => {
  const sizes: Record<string, string> = {
    sm: "h-4 w-4",
    md: "h-8 w-8",
    lg: "h-12 w-12",
  };
  return (
    <div className="flex items-center justify-center p-8">
      <svg
        className={`animate-spin text-blue-500 ${sizes[size]}`}
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    </div>
  );
};

// ---- Empty State ----
type EmptyStateProps = {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
};

export const EmptyState = ({
  icon = "📭",
  title,
  description,
}: EmptyStateProps) => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <span className="text-5xl mb-4">{icon}</span>
    <h3 className="text-slate-300 text-lg font-semibold mb-2">{title}</h3>
    {description && (
      <p className="text-slate-500 text-sm max-w-sm">{description}</p>
    )}
  </div>
);

// ---- Modal ----
export const ErrorNotice = ({ message }: { message?: string }) =>
  message ? (
    <div
      role="alert"
      className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
    >
      {message}
    </div>
  ) : null;

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  dismissible?: boolean;
};

export const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  size = "md",
  dismissible = true,
}: ModalProps) => {
  const titleId = `modal-title-${React.useId()}`;
  const modalRootRef = React.useRef<HTMLDivElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  const dismissibleRef = React.useRef(dismissible);

  React.useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  }, [onClose, dismissible]);

  React.useEffect(() => {
    if (!isOpen) return;

    const previousFocus =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : null;
    previousFocusRef.current = previousFocus;

    const modalRoot = modalRootRef.current;
    if (!modalRoot) return;

    const backgroundElements = Array.from(document.body.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element !== modalRoot,
    );
    const previousBackgroundState = backgroundElements.map((element) => ({
      element,
      inert: (element as HTMLElement & { inert?: boolean }).inert ?? false,
      ariaHidden: element.getAttribute("aria-hidden"),
    }));

    backgroundElements.forEach((element) => {
      (element as HTMLElement & { inert?: boolean }).inert = true;
      element.setAttribute("aria-hidden", "true");
    });

    const focusable = modalRoot.querySelector<HTMLElement>(
      '[autofocus], button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    (focusable || dialogRef.current)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        dismissibleRef.current
      ) {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousBackgroundState.forEach(({ element, inert, ariaHidden }) => {
        (element as HTMLElement & { inert?: boolean }).inert = inert;
        if (ariaHidden === null) {
          element.removeAttribute("aria-hidden");
        } else {
          element.setAttribute("aria-hidden", ariaHidden);
        }
      });

      const previousFocusElement = previousFocusRef.current;
      if (previousFocusElement && document.contains(previousFocusElement)) {
        previousFocusElement.focus();
      }
      previousFocusRef.current = null;
    };
  }, [isOpen]);

  if (!isOpen || typeof document === "undefined") return null;
  const sizes: Record<string, string> = {
    sm: "max-w-md",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
  };
  return createPortal(
    <div
      ref={modalRootRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => {
          if (dismissible) onClose();
        }}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative w-full ${sizes[size]} bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto`}
      >
        <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
          <h2 id={titleId} className="text-white text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={!dismissible}
            aria-label="بستن"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-all"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
};

// ---- Input Field ----
type InputFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode;
  error?: ReactNode;
};

export const InputField = ({ label, error, ...props }: InputFieldProps) => {
  const generatedId = `input-${React.useId()}`;
  const fieldId = props.id || generatedId;
  const errorId = `${fieldId}-error`;
  const describedBy = [props["aria-describedby"], error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-1.5">
      {label && (
        <label
          htmlFor={fieldId}
          className="block text-sm font-medium text-slate-300"
        >
          {label}
        </label>
      )}
      <input
        {...props}
        id={fieldId}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={describedBy || undefined}
        className={`w-full px-4 py-2.5 bg-slate-700/50 border rounded-xl text-white placeholder-slate-500
          focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all
          ${error ? "border-red-500/50" : "border-slate-600/50"} ${props.className || ""}`}
      />
      {error && (
        <p id={errorId} className="text-red-400 text-xs">
          {error}
        </p>
      )}
    </div>
  );
};

// ---- Select Field ----
type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: ReactNode;
  error?: ReactNode;
  children?: ReactNode;
};

export const SelectField = ({
  label,
  error,
  children,
  ...props
}: SelectFieldProps) => {
  const generatedId = `select-${React.useId()}`;
  const fieldId = props.id || generatedId;
  const errorId = `${fieldId}-error`;
  const describedBy = [props["aria-describedby"], error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-1.5">
      {label && (
        <label
          htmlFor={fieldId}
          className="block text-sm font-medium text-slate-300"
        >
          {label}
        </label>
      )}
      <select
        {...props}
        id={fieldId}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={describedBy || undefined}
        className={`w-full px-4 py-2.5 bg-slate-700/50 border rounded-xl text-white
          focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all
          ${error ? "border-red-500/50" : "border-slate-600/50"} ${props.className || ""}`}
      >
        {children}
      </select>
      {error && (
        <p id={errorId} className="text-red-400 text-xs">
          {error}
        </p>
      )}
    </div>
  );
};

// ---- Button ----
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "success" | "danger" | "ghost" | "outline";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  children?: ReactNode;
};

export const Button = ({
  children,
  variant = "primary",
  size = "md",
  loading,
  ...props
}: ButtonProps) => {
  const variants: Record<string, string> = {
    primary:
      "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg shadow-blue-500/25",
    success:
      "bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg shadow-green-500/25",
    danger:
      "bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white shadow-lg shadow-red-500/25",
    ghost:
      "bg-slate-700/50 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-600/50",
    outline:
      "border border-blue-500/50 text-blue-400 hover:bg-blue-500/10 hover:border-blue-500",
  };
  const sizes: Record<string, string> = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-5 py-2.5 text-sm",
    lg: "px-6 py-3 text-base",
  };
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      aria-busy={loading ? true : props["aria-busy"]}
      className={`inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all duration-200
        active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed
        ${variants[variant]} ${sizes[size]} ${props.className || ""}`}
    >
      {loading && (
        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {loading && (
        <span className="sr-only" role="status" aria-live="polite">
          در حال بارگذاری
        </span>
      )}
      {children}
    </button>
  );
};

// ---- Price formatter ----
export const formatPrice = (
  amount: number | string | null | undefined,
): string => {
  if (!amount && amount !== 0) return "---";
  return new Intl.NumberFormat("fa-IR").format(amount as number) + " تومان";
};

// ---- Confirm Dialog ----
type ConfirmDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  message: ReactNode;
  loading?: boolean;
  error?: string;
};

export const ConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  loading,
  error,
}: ConfirmDialogProps) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title={title}
    size="sm"
    dismissible={!loading}
  >
    <p className="text-slate-300 text-sm mb-6">{message}</p>
    <ErrorNotice message={error} />
    <div className="flex gap-3 justify-end">
      <Button variant="ghost" onClick={onClose} disabled={loading}>
        انصراف
      </Button>
      <Button variant="danger" onClick={onConfirm} loading={loading}>
        تأیید
      </Button>
    </div>
  </Modal>
);
