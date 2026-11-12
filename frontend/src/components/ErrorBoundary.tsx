import React from "react";
import type { ErrorInfo, ReactNode } from "react";

// Top-level safety net: shows a polite Persian fallback instead of a blank
// page (or, previously, a raw stack trace) when a render error happens.
type ErrorBoundaryProps = { children?: ReactNode };
type ErrorBoundaryState = { hasError: boolean };

class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep details in the console for support/debugging only.
    console.error("خطای غیرمنتظره در رابط کاربری", error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex min-h-screen items-center justify-center bg-slate-950 px-4"
          dir="rtl"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-slate-100">
            <h1 className="mb-3 text-lg font-bold">خطای غیرمنتظره‌ای رخ داد</h1>
            <p className="mb-6 text-sm leading-7 text-slate-300">
              مشکلی در نمایش این صفحه پیش آمده است. اطلاعات شما روی سرور محفوظ
              است؛ لطفاً صفحه را دوباره بارگذاری کنید و اگر مشکل ادامه داشت، با
              پشتیبانی در میان بگذارید.
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              بارگذاری دوباره
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
