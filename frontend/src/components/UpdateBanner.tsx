import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { appUpdateAPI } from "../services/api";

/** Slim banner for the superuser when an approved-pending style
 * update is waiting: the new version exists, its changes are one
 * click away in Settings, and nothing installs without approval. */
const UpdateBanner = () => {
  const user = useSelector((state: any) => state.auth.currentUser);
  const isSuperuser = Boolean(user?.is_superuser);
  const [info, setInfo] = useState<{
    latest: string;
    sha: string;
  } | null>(null);

  useEffect(() => {
    if (!isSuperuser) return undefined;
    let active = true;
    appUpdateAPI
      .status(true)
      .then(({ data }) => {
        if (!active || !data?.available || !(data.behind > 0)) return;
        try {
          const dismissed = window.localStorage.getItem(
            "mohaseb:update-dismissed",
          );
          if (dismissed === data.remote_sha) return;
        } catch {
          /* Storage unavailable; still show the banner. */
        }
        setInfo({
          latest: data.latest_version || "",
          sha: data.remote_sha || "",
        });
      })
      .catch(() => {
        /* The banner is a convenience; Settings does the real check. */
      });
    return () => {
      active = false;
    };
  }, [isSuperuser]);

  if (!isSuperuser || !info) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem("mohaseb:update-dismissed", info.sha);
    } catch {
      /* Ignore; the banner will return next session. */
    }
    setInfo(null);
  };

  const goToUpdates = () => {
    try {
      window.localStorage.setItem("mohaseb:settings-tab", "update");
    } catch {
      /* Settings will open on its default tab. */
    }
  };

  return (
    <div className="mx-6 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 shadow-sm">
      <span aria-hidden="true">⬆️</span>
      <p className="min-w-0 flex-1">
        نسخهٔ جدید محاسب پرو
        {info.latest ? ` (${info.latest})` : ""} آمادهٔ نصب است. تغییراتش را
        ببینید و هر وقت سامانه خلوت بود نصبش کنید.
      </p>
      <Link
        to="/settings"
        onClick={goToUpdates}
        className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
      >
        مشاهدهٔ تغییرات و نصب
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="بستن اعلان آپدیت"
        className="text-xs opacity-60 hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
};

export default UpdateBanner;
