import React, { useState } from "react";
import { useSelector } from "react-redux";
import { Link, useLocation } from "react-router-dom";
import { useBusiness } from "../lib/business";
import ChangePasswordModal from "./ChangePasswordModal";

/**
 * Account-level banners under the navbar:
 * - password is older than the policy window → suggest a change;
 * - signed-in customer without any business yet → start setup.
 */
const AccountBanners: React.FC = () => {
  const user = useSelector((state: any) => state.auth.currentUser);
  const { businesses, loading } = useBusiness();
  const location = useLocation();
  const [changeOpen, setChangeOpen] = useState(false);

  if (!user) return null;

  const passwordDue = !!user.password_change_due;
  const noBusiness =
    !loading &&
    businesses.length === 0 &&
    !user.is_superuser &&
    location.pathname !== "/create-business";

  if (!passwordDue && !noBusiness) return null;

  return (
    <>
      {passwordDue && (
        <div className="mx-6 mt-4 p-4 bg-amber-500/10 border border-amber-500/40 rounded-xl flex flex-wrap items-center gap-3">
          <p className="text-sm text-amber-200 flex-1 min-w-[220px]">
            رمز عبورتان بیش از ۹۰ روز است که تغییر نکرده؛ برای امنیت حساب، بهتر
            است آن را عوض کنید.
          </p>
          <button
            type="button"
            onClick={() => setChangeOpen(true)}
            className="px-4 py-2 bg-amber-600/80 hover:bg-amber-600 text-white rounded-lg text-sm font-medium"
          >
            تغییر رمز عبور
          </button>
        </div>
      )}
      {noBusiness && (
        <div className="mx-6 mt-4 p-4 bg-blue-500/10 border border-blue-500/40 rounded-xl flex flex-wrap items-center gap-3">
          <p className="text-sm text-blue-200 flex-1 min-w-[220px]">
            هنوز کسب‌وکاری نساخته‌اید؛ با چند کلیک کسب‌وکارتان را راه بیندازید.
          </p>
          <Link
            to="/create-business"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium"
          >
            راه‌اندازی کسب‌وکار
          </Link>
        </div>
      )}
      <ChangePasswordModal
        open={changeOpen}
        onClose={() => setChangeOpen(false)}
      />
    </>
  );
};

export default AccountBanners;
