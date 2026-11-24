import { useSyncExternalStore } from "react";
import safeStorage from "./safeStorage.js";

export const THEME_STORAGE_KEY = "mumbai_storefront_theme";
const listeners = new Set();

export function getSystemTheme() {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

export function readThemePreference() {
  const stored = safeStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "dark" || stored === "light" || stored === "system") {
    return stored;
  }
  return "system";
}

export function resolveActiveTheme(preference) {
  if (preference === "dark") return "dark";
  if (preference === "light") return "light";
  return getSystemTheme();
}

let currentPreference = readThemePreference();
let currentTheme = resolveActiveTheme(currentPreference);

export function applyStorefrontTheme(preference) {
  currentPreference = (preference === "dark" || preference === "light" || preference === "system")
    ? preference
    : "system";
  currentTheme = resolveActiveTheme(currentPreference);

  if (typeof document !== "undefined") {
    document.documentElement.dataset.storeTheme = currentTheme;
    document.documentElement.dataset.storeThemePreference = currentPreference;
    document.documentElement.style.colorScheme = currentTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      currentTheme === "dark" ? "#1F272E" : "#F0F8E8"
    );
  }
  return currentTheme;
}

export function setStorefrontTheme(preference) {
  applyStorefrontTheme(preference);
  safeStorage.setItem(THEME_STORAGE_KEY, currentPreference);
  listeners.forEach((listener) => listener());
}

if (typeof window !== "undefined") {
  applyStorefrontTheme(currentPreference);

  // Listen to OS-level system dark/light mode changes in real-time
  if (window.matchMedia) {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = () => {
      if (currentPreference === "system") {
        applyStorefrontTheme("system");
        listeners.forEach((listener) => listener());
      }
    };
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleSystemChange);
    } else if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(handleSystemChange);
    }
  }

  // Synchronize across open browser tabs
  window.addEventListener("storage", (event) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) {
      applyStorefrontTheme(readThemePreference());
      listeners.forEach((listener) => listener());
    }
  });
}

// Hook returning active resolved theme: "light" | "dark"
export function useStorefrontTheme() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => currentTheme,
    () => "light"
  );
}

// Hook returning user preference: "system" | "light" | "dark"
export function useStorefrontThemePreference() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => currentPreference,
    () => "system"
  );
}
