import React, { Suspense, lazy } from "react";
import type { ReactNode } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { useSelector } from "react-redux";
import { hasModule } from "./utils/modules";
import type { ModuleName } from "./utils/modules";
const Login = lazy(() => import("./pages/Login"));
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

function App() {
  return (
    <Router>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />

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
      </Suspense>
    </Router>
  );
}

export default App;
