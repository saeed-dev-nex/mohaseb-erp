import React, { Suspense, lazy, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { useSelector } from "react-redux";
import { hasModule } from "./utils/modules";
import { setupAPI } from "./services/api";
import type { ModuleName } from "./utils/modules";
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const CreateBusiness = lazy(() => import("./pages/CreateBusiness"));
const SetupWizard = lazy(() => import("./pages/SetupWizard"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Customers = lazy(() => import("./pages/Customers"));
const CustomerDetail = lazy(() => import("./pages/CustomerDetail"));
const Services = lazy(() => import("./pages/Services"));
const Invoices = lazy(() => import("./pages/Invoices"));
const InvoiceForm = lazy(() => import("./pages/InvoiceForm"));
const InvoiceDetail = lazy(() => import("./pages/InvoiceDetail"));
const Reports = lazy(() => import("./pages/Reports"));
const Settings = lazy(() => import("./pages/Settings"));
const Expenses = lazy(() => import("./pages/Expenses"));
const Cheques = lazy(() => import("./pages/Cheques"));
const StaffPage = lazy(() => import("./pages/StaffPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const UserPerformancePage = lazy(() => import("./pages/UserPerformancePage"));
const Chat = lazy(() => import("./pages/Chat"));
const AccountingPage = lazy(() => import("./pages/AccountingPage"));
const InventoryPage = lazy(() => import("./pages/InventoryPage"));
const PayrollPage = lazy(() => import("./pages/PayrollPage"));
const TaxPage = lazy(() => import("./pages/TaxPage"));
const AssetsPage = lazy(() => import("./pages/AssetsPage"));
const Layout = lazy(() => import("./components/Layout"));

const PageLoader = () => (
  <div
    className="flex min-h-screen items-center justify-center bg-slate-950"
    dir="rtl"
  >
    <div
      className="h-9 w-9 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"
      aria-label="در حال بارگذاری"
    />
  </div>
);

const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const isAuthenticated = useSelector(
    (state: any) => state.auth.isAuthenticated,
  );
  return isAuthenticated ? children : <Navigate to="/login" replace />;
};

// Stage 6: route-level module gate mirroring the backend's per-module
// permissions; users without the module land back on the dashboard.
const ModuleRoute = ({
  module,
  children,
}: {
  module: ModuleName;
  children: ReactNode;
}) => {
  const currentUser = useSelector((state: any) => state.auth.currentUser);
  return hasModule(currentUser, module) ? (
    children
  ) : (
    <Navigate to="/" replace />
  );
};

// First-run gate: while no superuser exists, every path leads to the
// setup wizard. A failed status probe is retried briefly (the page can
// load a second before the backend finishes starting); if it stays
// unreachable the gate stays undecided ("unknown") and renders the app
// without bouncing /setup to /login on a guess.
const SetupGate = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<
    "checking" | "setup" | "ready" | "unknown"
  >("checking");
  const location = useLocation();
  useEffect(() => {
    let alive = true;
    (async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const res = await setupAPI.status();
          if (alive) setState(res.data.needs_setup ? "setup" : "ready");
          return;
        } catch {
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 800));
          }
        }
      }
      if (alive) setState("unknown");
    })();
    return () => {
      alive = false;
    };
  }, []);
  if (state === "checking") return <PageLoader />;
  if (state === "setup" && location.pathname !== "/setup") {
    return <Navigate to="/setup" replace />;
  }
  if (state === "ready" && location.pathname === "/setup") {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

function App() {
  return (
    <Router>
      <Suspense fallback={<PageLoader />}>
        <SetupGate>
          <Routes>
            <Route path="/setup" element={<SetupWizard />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="create-business" element={<CreateBusiness />} />

              {/* Customers */}
              <Route
                path="customers"
                element={
                  <ModuleRoute module="customers">
                    <Customers />
                  </ModuleRoute>
                }
              />
              <Route
                path="customers/:id"
                element={
                  <ModuleRoute module="customers">
                    <CustomerDetail />
                  </ModuleRoute>
                }
              />

              {/* Services */}
              <Route
                path="services"
                element={
                  <ModuleRoute module="services">
                    <Services />
                  </ModuleRoute>
                }
              />

              {/* Invoices */}
              <Route
                path="invoices"
                element={
                  <ModuleRoute module="invoices">
                    <Invoices />
                  </ModuleRoute>
                }
              />
              <Route
                path="invoices/new"
                element={
                  <ModuleRoute module="invoices">
                    <InvoiceForm />
                  </ModuleRoute>
                }
              />
              <Route
                path="invoices/:id"
                element={
                  <ModuleRoute module="invoices">
                    <InvoiceDetail />
                  </ModuleRoute>
                }
              />
              <Route
                path="invoices/:id/edit"
                element={
                  <ModuleRoute module="invoices">
                    <InvoiceForm />
                  </ModuleRoute>
                }
              />

              {/* Reports */}
              <Route
                path="reports"
                element={
                  <ModuleRoute module="reports">
                    <Reports />
                  </ModuleRoute>
                }
              />

              {/* Expenses */}
              <Route
                path="expenses"
                element={
                  <ModuleRoute module="expenses">
                    <Expenses />
                  </ModuleRoute>
                }
              />

              {/* Cheques */}
              <Route
                path="cheques"
                element={
                  <ModuleRoute module="cheques">
                    <Cheques />
                  </ModuleRoute>
                }
              />

              {/* Accounting (ERP phase 1) */}
              <Route
                path="accounting"
                element={
                  <ModuleRoute module="accounting">
                    <AccountingPage />
                  </ModuleRoute>
                }
              />

              {/* Inventory & purchasing (ERP phase 2) */}
              <Route
                path="inventory"
                element={
                  <ModuleRoute module="inventory">
                    <InventoryPage />
                  </ModuleRoute>
                }
              />

              {/* Personnel & payroll (ERP phase 3) */}
              <Route
                path="payroll"
                element={
                  <ModuleRoute module="payroll">
                    <PayrollPage />
                  </ModuleRoute>
                }
              />

              {/* Tax (ERP phase 4) */}
              <Route
                path="tax"
                element={
                  <ModuleRoute module="tax">
                    <TaxPage />
                  </ModuleRoute>
                }
              />

              {/* Fixed assets (ERP phase 4) */}
              <Route
                path="assets"
                element={
                  <ModuleRoute module="assets">
                    <AssetsPage />
                  </ModuleRoute>
                }
              />

              {/* Staff */}
              <Route
                path="staff"
                element={
                  <ModuleRoute module="staff">
                    <StaffPage />
                  </ModuleRoute>
                }
              />

              {/* Users (admin only) */}
              <Route
                path="users"
                element={
                  <ModuleRoute module="users">
                    <UsersPage />
                  </ModuleRoute>
                }
              />
              <Route
                path="users/:id/performance"
                element={
                  <ModuleRoute module="users">
                    <UserPerformancePage />
                  </ModuleRoute>
                }
              />
              <Route
                path="chat"
                element={
                  <ModuleRoute module="chat">
                    <Chat />
                  </ModuleRoute>
                }
              />

              {/* Settings */}
              <Route
                path="settings"
                element={
                  <ModuleRoute module="settings">
                    <Settings />
                  </ModuleRoute>
                }
              />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SetupGate>
      </Suspense>
    </Router>
  );
}

export default App;
