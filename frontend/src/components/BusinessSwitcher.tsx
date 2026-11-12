import { useBusiness } from "../lib/business";

/**
 * Current-business switcher (ERP phase 0). Renders only when the user
 * belongs to at least one business; with several, it is a select that
 * re-scopes the whole app (the axios interceptor sends the id as the
 * X-Business-Id header and queries are invalidated on switch).
 */
const BusinessSwitcher = () => {
  const { businesses, current, switchTo } = useBusiness();

  if (businesses.length === 0 || !current) return null;

  if (businesses.length === 1) {
    return (
      <span
        className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-slate-300 border border-slate-700/50 bg-slate-800/40 max-w-56"
        title={current.template_title}
      >
        <span aria-hidden>🏢</span>
        <span className="truncate">{current.name}</span>
      </span>
    );
  }

  return (
    <label className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-slate-700/50 bg-slate-800/40">
      <span aria-hidden>🏢</span>
      <select
        aria-label="کسب‌وکار جاری"
        className="bg-transparent text-sm text-slate-200 focus:outline-none max-w-44 sm:max-w-56 truncate"
        value={current.id}
        onChange={(event) => switchTo(Number(event.target.value))}
      >
        {businesses.map((business) => (
          <option
            key={business.id}
            value={business.id}
            className="bg-slate-800 text-slate-100"
          >
            {business.name}
          </option>
        ))}
      </select>
    </label>
  );
};

export default BusinessSwitcher;
