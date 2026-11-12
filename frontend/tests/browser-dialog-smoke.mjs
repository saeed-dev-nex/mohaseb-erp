// Manual browser harness: synthetic data only, every mutation deliberately
// fails after a delay. No API requests, credentials or real customer data.
// Run from frontend: node tests/browser-dialog-smoke.mjs
import { createServer } from "vite";

const fixtureApi = `
  const services = [{ id: 1, title: 'خدمت آزمایشی', default_main_price: 100000,
    default_extra_price: 0, default_commission: 0, is_active: true }];
  const cheques = [{ id: 1, cheque_number: '123', bank_name: 'بانک آزمایشی',
    amount: 100000, due_date: '2030-01-01', issue_date: '2026-10-23',
    status: 'pending', type: 'incoming', customer: null }];
  const counts = { create: 0, update: 0, delete: 0 };
  const fail = (operation) => async () => {
    counts[operation]++;
    document.getElementById('request-counts').textContent = JSON.stringify(counts);
    await new Promise(resolve => setTimeout(resolve, 2000));
    throw { response: { data: { detail: 'خطای آزمایشی: عملیات انجام نشد' } } };
  };
  const mutations = { create: fail('create'), update: fail('update'), delete: fail('delete'), patch: fail('update') };
  export const servicesAPI = { list: async () => ({ data: services }), ...mutations };
  export const chequesAPI = { list: async () => ({ data: cheques }), ...mutations };
  export const customersAPI = { list: async () => ({ data: [] }), ...mutations };
`;
const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import Services from '/src/pages/Services.tsx';
  import Cheques from '/src/pages/Cheques.tsx';
  import '/src/index.css';
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function App() {
    const [page, setPage] = React.useState('services');
    return <QueryClientProvider client={client}>
      <nav><button onClick={() => setPage('services')}>صفحه خدمات</button> | <button onClick={() => setPage('cheques')}>صفحه چک‌ها</button></nav>
      <p>محیط آزمایشی مستقل — تمام ذخیره‌ها و حذف‌ها عمداً شکست می‌خورند.</p>
      <output id="request-counts">{JSON.stringify({ create: 0, update: 0, delete: 0 })}</output>
      {page === 'services' ? <Services /> : <Cheques />}
    </QueryClientProvider>;
  }
  createRoot(document.getElementById('root')).render(<App />);
`;

const server = await createServer({
  server: { host: "127.0.0.1", port: 4175, strictPort: true, open: false },
  plugins: [
    {
      name: "isolated-dialog-smoke",
      enforce: "pre",
      resolveId(id) {
        if (id === "/__dialog_smoke__.tsx") return id;
      },
      load(id) {
        if (id === "/__dialog_smoke__.tsx") return entry;
        if (id.replaceAll("\\", "/").endsWith("/src/services/api.ts"))
          return fixtureApi;
      },
      configureServer(dev) {
        dev.middlewares.use("/dialog-smoke", async (_req, res) => {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(
            await dev.transformIndexHtml(
              "/dialog-smoke",
              `<!doctype html><html lang="fa" dir="rtl"><body class="bg-slate-900 text-white p-6"><div id="root"></div><script type="module" src="/__dialog_smoke__.tsx"></script></body></html>`,
            ),
          );
        });
      },
    },
  ],
});
await server.listen();
console.log("Synthetic dialog smoke: http://127.0.0.1:4175/dialog-smoke");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await server.close();
    process.exit(0);
  });
