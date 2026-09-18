import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.jsx";
import { EmployeeAuthProvider } from "./context/EmployeeAuthContext.jsx";
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
        <EmployeeAuthProvider>
          <App />
        </EmployeeAuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
