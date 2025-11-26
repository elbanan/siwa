/**
 * Global client-side providers.
 *
 * NextAuth's SessionProvider must wrap any component that calls useSession().
 * In App Router, layout.tsx is a Server Component by default, so we put
 * providers into a separate Client Component.
 */

"use client";

import { SessionProvider } from "next-auth/react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type Theme = "light";
type ThemeContextType = {
  theme: Theme;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  toggleTheme: () => { },
});

export function useTheme() {
  return useContext(ThemeContext);
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const theme: Theme = "light";

  useEffect(() => {
    // Always set light theme
    document.documentElement.setAttribute("data-theme", "light");
    localStorage.removeItem("theme"); // Clean up any stored theme preference
  }, []);

  const value = useMemo(
    () => ({
      theme,
      toggleTheme: () => { }, // No-op since we only support light theme
    }),
    [theme]
  );

  return (
    <SessionProvider>
      <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
    </SessionProvider>
  );
}
