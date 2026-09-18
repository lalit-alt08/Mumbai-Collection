
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import ErrorBoundary from "./components/layout/ErrorBoundary.jsx";

import { CartProvider } from "./context/CartContext";
import { AuthProvider } from "./context/AuthContext";
import { FavoritesProvider } from "./context/FavoritesContext";
import { GoogleOAuthProvider } from "@react-oauth/google";

// Prevent mobile gesture/pinch auto-zoom
if (typeof window !== "undefined") {
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener("gesturechange", (e) => e.preventDefault());
  document.addEventListener("gestureend", (e) => e.preventDefault());
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || ""}>
      <AuthProvider>
        <CartProvider>
          <FavoritesProvider>
            <App />
          </FavoritesProvider>
        </CartProvider>
      </AuthProvider>
    </GoogleOAuthProvider>
  </ErrorBoundary>
);