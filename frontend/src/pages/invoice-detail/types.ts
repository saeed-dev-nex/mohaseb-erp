export type InvoicePayment = {
  id: number;
  amount: number;
  method: string;
  method_display?: string;
  paid_at: string;
  reference?: string | null;
  note?: string | null;
  created_by_name?: string | null;
};

export type PaymentFormData = {
  amount: string | number;
  method: string;
  reference: string;
  note: string;
};

export type InvoiceItem = {
  id?: number;
  service_title_snapshot?: string | null;
  service_title?: string | null;
  notes?: string | null;
  quantity: number;
  main_price: number;
  extra_price: number;
  line_total: number;
};

export type InvoiceData = {
  id: number;
  invoice_number: string;
  status: string;
  commission_paid?: boolean;
  customer?: number | null;
  customer_name?: string | null;
  date: string;
  created_at?: string | null;
  due_date?: string | null;
  paper_size?: string;
  card_payment_source?: string | null;
  can_edit?: boolean;
  edit_request_status?: string | null;
  green_card_owner_name?: string | null;
  green_card_owner_national_id?: string | null;
  vehicle_plate?: string | null;
  vehicle_type?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: string | null;
  vehicle_vin?: string | null;
  description?: string | null;
  items?: InvoiceItem[];
  payments?: InvoicePayment[];
  discount?: number;
  tax?: number;
  commission_total?: number;
  final_amount?: number;
  rounding_enabled?: boolean;
  rounding_amount?: number;
  rounding_target?: number | null;
  rounding_show_amount?: boolean;
  rounding_cleared?: boolean;
  paid_amount?: number;
  remaining_amount?: number;
};

export type BusinessProfile = {
  name?: string;
  subtitle?: string | null;
  phone?: string | null;
  mobile?: string | null;
  address?: string | null;
  website?: string | null;
  footer_text?: string | null;
  logo_url?: string | null;
  social_links?: {
    id: number;
    name: string;
    url: string;
    logo_url?: string | null;
  }[];
};

export type CustomerInfo = {
  phone?: string | null;
  email?: string | null;
};

export type InvoiceFields = {
  show_discount_field: boolean;
  show_tax_field: boolean;
  show_seller_signature: boolean;
  show_buyer_signature: boolean;
  enable_invoice_clone: boolean;
};
