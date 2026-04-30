"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type Theme = "light" | "dark";

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
}

type ThemeToggleProps = {
  className?: string;
  hideOnMailRoute?: boolean;
};

export function ThemeToggle({ className, hideOnMailRoute = false }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const stored = window.localStorage.getItem("mailpilot-theme");
    const initial = stored === "light" || stored === "dark" ? stored : getSystemTheme();
    applyTheme(initial);
    setTimeout(() => {
      setTheme(initial);
      setMounted(true);
    }, 0);
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
    window.localStorage.setItem("mailpilot-theme", next);
  }

  if (!mounted) return null;
  if (hideOnMailRoute && pathname.startsWith("/mail")) return null;

  const isLight = theme === "light";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={
        className ??
        "fixed right-4 top-4 z-50 rounded-full border border-gray-300 bg-white p-2 text-gray-900 shadow-sm hover:bg-gray-100"
      }
      aria-label={isLight ? "Dunkelmodus aktivieren" : "Hellmodus aktivieren"}
      title={isLight ? "Dunkelmodus" : "Hellmodus"}
    >
      {isLight ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5 text-amber-500 transition-colors duration-200"
          fill="none"
        >
          <circle cx="12" cy="12" r="4.1" fill="currentColor" />
          <g fill="currentColor">
            <rect x="11.45" y="1.9" width="1.1" height="3.1" rx=".55" />
            <rect x="11.45" y="19.0" width="1.1" height="3.1" rx=".55" />
            <rect x="19.0" y="11.45" width="3.1" height="1.1" rx=".55" />
            <rect x="1.9" y="11.45" width="3.1" height="1.1" rx=".55" />
            <rect x="17.45" y="4.2" width="1.1" height="3.1" rx=".55" transform="rotate(45 18 5.75)" />
            <rect x="5.45" y="16.2" width="1.1" height="3.1" rx=".55" transform="rotate(45 6 17.75)" />
            <rect x="16.2" y="17.45" width="3.1" height="1.1" rx=".55" transform="rotate(45 17.75 18)" />
            <rect x="4.2" y="5.45" width="3.1" height="1.1" rx=".55" transform="rotate(45 5.75 6)" />
          </g>
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5 text-indigo-400 transition-colors duration-200"
          fill="none"
        >
          <path
            d="M14.7 3.2c-3.95 1.1-6.82 4.73-6.82 9.03 0 4.3 2.87 7.93 6.82 9.03-5.17.79-9.7-3.17-9.7-8.65s4.53-9.44 9.7-8.65Z"
            fill="currentColor"
          />
          <circle cx="17.7" cy="6.1" r="1.1" fill="#a5b4fc" />
          <circle cx="19.6" cy="9" r=".7" fill="#c7d2fe" />
        </svg>
      )}
    </button>
  );
}
