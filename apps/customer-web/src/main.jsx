
import { createRoot } from "react-dom/client";
import axios from "axios";
import { attachStaleConnectionRetry } from "./utils/resilientAxios.js";
import "./index.css";
import App from "./App.jsx";
import ErrorBoundary from "./components/layout/ErrorBoundary.jsx";

// Protect all direct axios calls across customer-web from stale idle socket drops
attachStaleConnectionRetry(axios);

import { CartProvider } from "./context/CartContext";
import { AuthProvider } from "./context/AuthContext";
import { FavoritesProvider } from "./context/FavoritesContext";

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <AuthProvider>
      <CartProvider>
        <FavoritesProvider>
          <App />
        </FavoritesProvider>
      </CartProvider>
    </AuthProvider>
  </ErrorBoundary>
);
