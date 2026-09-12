import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { getCart } from "../services/storeApi";
import { useLocation } from "react-router-dom";

const CartContext = createContext();

export function CartProvider({ children }) {
  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshCart = useCallback(async () => {
    try {
      const data = await getCart();
      setCart(data);
      return data;
    } catch (err) {
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Removed the unconditional initial fetch.
  // The cart is now fetched automatically by CartRouteManager when the user visits a non-auth page.

  return (
    <CartContext.Provider
      value={{
        cart,
        loading,
        refreshCart,
        setLoading, // expose setLoading so CartRouteManager can stop loading on auth pages
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);

export function CartRouteManager() {
  const { cart, loading, refreshCart, setLoading } = useCart();
  const location = useLocation();
  const hasAttemptedRef = useRef(false);

  useEffect(() => {
    const isAuthPage = [
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password",
    ].some((p) => location.pathname.startsWith(p));

    // If we're on an auth page, don't fetch the cart to prevent 502/unnecessary requests.
    if (isAuthPage) {
      if (loading) {
        setLoading(false);
      }
      return;
    }

    // Only fetch if we haven't fetched it yet for this session.
    // If the cart is null, it means it hasn't been fetched.
    if (!cart && !hasAttemptedRef.current) {
      hasAttemptedRef.current = true;
      setLoading(true);
      refreshCart().catch(() => {});
    }
  }, [location.pathname, cart, refreshCart]);

  return null;
}