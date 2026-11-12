import React, { useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { setTokens, setCurrentUser } from "../features/authSlice";
import api, { API_BASE_URL } from "../services/api";
import { queryClient } from "../lib/queryClient";
import PasswordInput from "../components/PasswordInput";

const Login = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const dispatch = useDispatch();
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await axios.post(
        `${API_BASE_URL}token/`,
        {
          username,
          password,
        },
        { withCredentials: true, headers: { "X-Client-Type": "web" } },
      );

      // For the web client the backend returns no refresh token in the body;
      // it is stored in an httpOnly cookie instead.
      queryClient.clear();
      dispatch(setCurrentUser(null));
      dispatch(
        setTokens({
          access: response.data.access,
        }),
      );

      // Fetch current user info (role, etc.)
      try {
        const meRes = await api.get("users/me/", {
          headers: { Authorization: `Bearer ${response.data.access}` },
        });
        dispatch(setCurrentUser(meRes.data));
      } catch (_) {}

      navigate("/");
    } catch (err) {
      setError("نام کاربری یا رمز عبور اشتباه است.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      data-theme={localStorage.getItem("app-theme") || "dark"}
      className="login-page min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 relative overflow-hidden"
      dir="rtl"
    >
      {/* Decorative background elements */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob"></div>
      <div className="absolute top-[20%] right-[-10%] w-96 h-96 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000"></div>
      <div className="absolute bottom-[-20%] left-[20%] w-96 h-96 bg-indigo-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-4000"></div>

      <div className="relative z-10 w-full max-w-md p-8 bg-white/10 backdrop-blur-lg border border-white/20 rounded-3xl shadow-[0_8px_32px_0_rgba(0,0,0,0.37)]">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">
            محاسب پرو
          </h1>
          <p className="text-blue-200/80 text-sm">
            ورود به سیستم مدیریت مالی و فاکتور
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-xl text-red-100 text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-blue-100 mb-2">
              نام کاربری
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-transparent text-white placeholder-blue-200/50 transition-all outline-none"
              placeholder="نام کاربری خود را وارد کنید"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-blue-100 mb-2">
              رمز عبور
            </label>
            <PasswordInput
              value={password}
              dir="ltr"
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-transparent text-white placeholder-blue-200/50 transition-all outline-none"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-semibold shadow-lg shadow-blue-500/30 transform transition-all active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center"
          >
            {loading ? (
              <svg
                className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
            ) : (
              "ورود به حساب"
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
