import PlateInput from "./PlateInput";
import SearchableSelect from "./SearchableSelect";
import { Field, Section, inputCls } from "./FormSection";
import { MOTO_BRANDS, isMotoPlate } from "../lib/vehicle";
import {
  currentJalaliYear,
  jalaliYearRange,
  toPersianKeyboard,
} from "../utils/persian";

const YEAR_OPTIONS = jalaliYearRange(1360, currentJalaliYear());

export type VehicleValues = {
  vehicle_plate: string;
  vehicle_vin: string;
  vehicle_model: string;
  vehicle_type: string;
  vehicle_year: string;
};

export type VehicleFieldName =
  "vehicle_vin" | "vehicle_model" | "vehicle_type" | "vehicle_year";

export type PlateSuggestionInfo = {
  invoice_number: string;
  customer_name: string;
  final_amount: number;
};

type Props = {
  values: VehicleValues;
  // Atomic plate update (the parent also resets vehicle_type when the
  // car/motorcycle kind flips).
  onPlateChange: (v: string) => void;
  onFieldChange: (name: VehicleFieldName, value: string) => void;
  vehicleTypes: { id?: number; name: string }[];
  onCreateVehicleType: (
    name: string,
  ) => Promise<{ value: string; label: string } | null | undefined>;
  creatingVehicleType: boolean;
  plateSuggestion: PlateSuggestionInfo | null;
  onUsePlateSuggestion: () => void;
  onDismissPlateSuggestion: () => void;
  formatAmount: (n: number | string | null | undefined) => string;
};

// The vehicle section of the invoice form: plate (with the reuse
// suggestion bar), VIN, type/brand, model and Jalali build year.
// Car vs motorcycle is derived from the plate format.
export const VehicleInfoFields = ({
  values,
  onPlateChange,
  onFieldChange,
  vehicleTypes,
  onCreateVehicleType,
  creatingVehicleType,
  plateSuggestion,
  onUsePlateSuggestion,
  onDismissPlateSuggestion,
  formatAmount,
}: Props) => {
  const isMoto = isMotoPlate(values.vehicle_plate || "");
  return (
    <Section
      title={isMoto ? "اطلاعات موتورسیکلت" : "اطلاعات خودرو"}
      icon={isMoto ? "🏍️" : "🚗"}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Plate */}
        <Field label="شماره پلاک" className="md:col-span-2">
          <PlateInput value={values.vehicle_plate} onChange={onPlateChange} />
        </Field>

        {plateSuggestion && (
          <div className="md:col-span-2 flex flex-wrap items-center gap-3 rounded-xl border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-200">
            <span>
              🔁 برای این پلاک، فاکتور {plateSuggestion.invoice_number} برای «
              {plateSuggestion.customer_name}» ثبت شده (
              {formatAmount(plateSuggestion.final_amount)})
            </span>
            <button
              type="button"
              onClick={onUsePlateSuggestion}
              className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium transition-all"
            >
              استفاده از همان مشخصات و ردیف‌ها
            </button>
            <button
              type="button"
              onClick={onDismissPlateSuggestion}
              className="text-teal-300/70 hover:text-teal-200 text-xs"
            >
              ✕ صرف‌نظر
            </button>
          </div>
        )}

        {/* VIN */}
        <Field label="شماره شاسی (VIN)">
          <input
            type="text"
            placeholder="17 کاراکتر"
            value={values.vehicle_vin}
            onChange={(e) => onFieldChange("vehicle_vin", e.target.value)}
            className={inputCls}
            dir="ltr"
            maxLength={17}
          />
        </Field>

        {/* Vehicle / Moto Type */}
        <Field label={isMoto ? "برند و مدل موتور" : "نوع خودرو"}>
          {isMoto ? (
            <SearchableSelect
              key="moto-type"
              value={values.vehicle_type}
              onChange={(v) => onFieldChange("vehicle_type", String(v))}
              options={MOTO_BRANDS}
              placeholder="— انتخاب یا افزودن برند/مدل —"
              searchPlaceholder="جستجو در موتورسیکلت‌ها..."
              emptyText="موتوری یافت نشد"
              creatable
              onCreateOption={onCreateVehicleType}
              creating={creatingVehicleType}
              createLabel={(name) => (
                <>
                  <span className="text-slate-400">افزودن: </span>
                  <span className="font-medium">«{name}»</span>
                  <span className="text-xs text-emerald-600 mr-2">
                    (ذخیره خودکار)
                  </span>
                </>
              )}
            />
          ) : (
            <SearchableSelect
              key="car-type"
              value={values.vehicle_type}
              onChange={(v) => onFieldChange("vehicle_type", String(v))}
              options={vehicleTypes.map((vt) => ({
                value: vt.name,
                label: vt.name,
              }))}
              placeholder="— انتخاب یا افزودن نوع —"
              searchPlaceholder="جستجو یا افزودن نوع خودرو..."
              creatable
              onCreateOption={onCreateVehicleType}
              creating={creatingVehicleType}
              createLabel={(name) => (
                <>
                  <span className="text-slate-400">افزودن نوع جدید: </span>
                  <span className="font-medium">«{name}»</span>
                  <span className="text-xs text-emerald-600 mr-2">
                    (ذخیره خودکار)
                  </span>
                </>
              )}
            />
          )}
        </Field>

        {/* Vehicle Model (text) */}
        <Field label={isMoto ? "اطلاعات تکمیلی موتور" : "نام / مدل خودرو"}>
          <input
            type="text"
            placeholder={
              isMoto
                ? "مثال: رنگ، سال، موتور ویژه"
                : "مثال: پراید، سمند، پژو ۲۰۶"
            }
            value={values.vehicle_model}
            onChange={(e) =>
              onFieldChange("vehicle_model", toPersianKeyboard(e.target.value))
            }
            className={inputCls}
          />
        </Field>

        {/* Model Year — Jalali */}
        <Field label="سال ساخت (شمسی)">
          <SearchableSelect
            value={values.vehicle_year || ""}
            onChange={(v) => onFieldChange("vehicle_year", String(v))}
            options={YEAR_OPTIONS.map((y) => ({
              value: String(y),
              label: String(y),
            }))}
            placeholder="— انتخاب سال —"
            searchPlaceholder="جستجوی سال..."
          />
        </Field>
      </div>
    </Section>
  );
};
