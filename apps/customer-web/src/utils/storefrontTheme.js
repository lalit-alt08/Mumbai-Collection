import { useSyncExternalStore } from "react";
import safeStorage from "./safeStorage.js";

export const THEME_STORAGE_KEY = "mumbai_storefront_theme";
const listeners = new Set();
const readTheme = () => safeStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
let currentTheme = readTheme();

export function applyStorefrontTheme(theme) {
  currentTheme = theme === "dark" ? "dark" : "light";
  if (typeof document !== "undefined") {
    document.documentElement.dataset.storeTheme = currentTheme;
    document.documentElement.style.colorScheme = currentTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", currentTheme === "dark" ? "#1F272E" : "#F0F8E8");
  }
  return currentTheme;
}

export function setStorefrontTheme(theme) {
  const value = applyStorefrontTheme(theme);
  safeStorage.setItem(THEME_STORAGE_KEY, value);
  listeners.forEach((listener) => listener());
}

if (typeof window !== "undefined") {
  applyStorefrontTheme(currentTheme);
  window.addEventListener("storage", (event) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) {
      applyStorefrontTheme(readTheme());
      listeners.forEach((listener) => listener());
    }
  });
}

export function useStorefrontTheme() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => currentTheme,
    () => "light",
  );
}
