import { createRoot } from "react-dom/client";
import axios from "axios";
import { attachStaleConnectionRetry } from "./utils/resilientAxios.js";
import "./index.css";
import App from "./App.jsx";
import ErrorBoundary from "./components/layout/ErrorBoundary.jsx";

// Protect all direct axios calls across customer-web from stale idle socket drops
attachStaleConnectionRetry(axios);

// Lock orientation to portrait when running as an installed standalone app (Blinkit/Zepto behavior on Android)
if (typeof window !== "undefined") {
  const enforcePortraitLock = () => {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;

    if (isStandalone && window.screen?.orientation?.lock) {
      window.screen.orientation.lock("portrait-primary").catch(() => {
        window.screen.orientation.lock("portrait").catch(() => {});
      });
    }
  };

  enforcePortraitLock();
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      enforcePortraitLock();
    }
  });
}

import { CartProvider } from "./context/CartContext";
import { AuthProvider } from "./context/AuthContext";
import { FavoritesProvider } from "./context/FavoritesContext";
import { GoogleOAuthProvider } from "@react-oauth/google";

const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  "477688999568-t4mnenlkrvhs6qd90sffptr6ht00v2u8.apps.googleusercontent.com";

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
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
