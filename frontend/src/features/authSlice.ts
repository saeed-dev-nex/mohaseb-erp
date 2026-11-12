import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import Cookies from "js-cookie";

export type AuthUser = {
  id?: number;
  username?: string;
  role?: string;
  is_superuser?: boolean;
  is_staff?: boolean;
  [key: string]: unknown;
};

type AuthState = {
  accessToken: string | null;
  isAuthenticated: boolean;
  currentUser: AuthUser | null;
};

// Try to restore stored user info
let storedUser: AuthUser | null = null;
try {
  const raw = localStorage.getItem("mohaseb_user");
  if (raw) storedUser = JSON.parse(raw) as AuthUser;
} catch {
  /* Stored user info is a convenience only. */
}

const initialState: AuthState = {
  accessToken: Cookies.get("access_token") || null,
  isAuthenticated: !!Cookies.get("access_token"),
  currentUser: storedUser, // { id, username, role, is_superuser, is_staff, ... }
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setTokens: (state, action: PayloadAction<{ access: string }>) => {
      const { access } = action.payload;
      // Use sameSite: 'lax' and no secure flag for LAN HTTP compatibility.
      // The refresh token is NOT stored here anymore: the backend keeps it
      // in an httpOnly cookie that scripts cannot read.
      Cookies.set("access_token", access, { sameSite: "lax" });
      Cookies.remove("refresh_token"); // clean up tokens stored by older versions
      state.accessToken = access;
      state.isAuthenticated = true;
    },
    setCurrentUser: (state, action: PayloadAction<AuthUser | null>) => {
      state.currentUser = action.payload;
      localStorage.setItem("mohaseb_user", JSON.stringify(action.payload));
    },
    logout: (state) => {
      Cookies.remove("access_token");
      Cookies.remove("refresh_token");
      localStorage.removeItem("mohaseb_user");
      state.accessToken = null;
      state.isAuthenticated = false;
      state.currentUser = null;
    },
  },
});

export const { setTokens, setCurrentUser, logout } = authSlice.actions;
export default authSlice.reducer;
