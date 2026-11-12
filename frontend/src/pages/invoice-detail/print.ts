export const buildPrintCSS = (size: string) => {
  // Chromium does not know the "A6" keyword in @page size (it silently
  // falls back to Letter), so A6 is given as explicit dimensions.
  const pageSize = size === "a4" ? "A4" : size === "a6" ? "105mm 148mm" : "A5";
  // The print area is laid out with rem-based (screen) sizes, so on small
  // paper it overflows to a second page. Scale it down with zoom so a
  // normal invoice fits exactly one page: A5 measured to need <= 0.78
  // for a tall invoice (6 items + vehicle + both signatures + footer);
  // 0.72 leaves headroom for slightly longer ones.
  const zoom = size === "a6" ? 0.5 : size === "a5" ? 0.72 : 1;
  return `
    @media print {
      @page { size: ${pageSize}; margin: 8mm; }
      body * { visibility: hidden !important; }
      #invoice-print-area, #invoice-print-area * { visibility: visible !important; }
      #invoice-print-area {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        /* With RTL, left + right + width:100% is over-constrained. Chrome
           resolves that conflict differently while applying custom print scale. */
        width: auto;
        max-width: 100%;
        box-sizing: border-box;
        margin: 0;
        background: white; color: #111;
        padding: 0;
        ${zoom !== 1 ? `zoom: ${zoom};` : ""}
        font-family: Vazirmatn, sans-serif;
        font-size: ${size === "a6" ? "9px" : size === "a5" ? "10px" : "12px"};
        direction: rtl;
      }
      .no-print { display: none !important; }
      .print-payment-notes, .print-payment-notes * { color: #111 !important; background: transparent !important; }
      .print-table th, .print-table td { border: 1px solid #ddd; padding: 4px 6px; }
      .print-table { border-collapse: collapse; width: 100%; }
      .print-header { background: transparent !important; color: #111 !important; border: 1px solid #111 !important; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .print-header * { color: #111 !important; }
    }
  `;
};
