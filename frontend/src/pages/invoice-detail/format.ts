import { toJalali } from "../../utils/persian";

export const fmt = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("fa-IR").format(Number(n) || 0) + " تومان";

export const persianDate = (dateStr?: string | null) =>
  toJalali(dateStr, "long");
