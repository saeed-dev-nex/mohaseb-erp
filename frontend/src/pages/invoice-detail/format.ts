import { toJalali } from "../../utils/persian";
import { formatMoney } from "../../lib/money";

export const fmt = (n: number | string | null | undefined) => formatMoney(n);

export const persianDate = (dateStr?: string | null) =>
  toJalali(dateStr, "long");
