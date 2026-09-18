import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.jsx";
import { AdminAuthProvider } from "./context/AdminAuthContext.jsx";
import ErrorBoundary from "./components/common/ErrorBoundary.jsx";

// Prevent mobile gesture/pinch auto-zoom
if (typeof window !== "undefined") {
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener("gesturechange", (e) => e.preventDefault());
  document.addEventListener("gestureend", (e) => e.preventDefault());
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AdminAuthProvider>
          <App />
        </AdminAuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);