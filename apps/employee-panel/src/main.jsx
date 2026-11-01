import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.jsx";
import { EmployeeAuthProvider } from "./context/EmployeeAuthContext.jsx";
import ErrorBoundary from "./components/common/ErrorBoundary.jsx";

// Register Service Worker for PWA Counter Tablet and background Web Push alerts
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <EmployeeAuthProvider>
          <App />
        </EmployeeAuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
