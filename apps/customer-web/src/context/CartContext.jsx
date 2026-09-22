import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { getCart, clearCartSession } from "../services/storeApi";
import { useAuth } from "./AuthContext";
import { useLocation } from "react-router-dom";

const CartContext = createContext();

export function CartProvider({ children }) {
  const { user } = useAuth();
  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);

  // Monotonically increasing epoch counter: discards stale in-flight responses across session switches
  const sessionEpochRef = useRef(0);
  const prevUserIdRef = useRef(user?.id ?? null);
  const isInitialMountRef = useRef(true);

  const refreshCart = useCallback(async () => {
    const requestEpoch = sessionEpochRef.current;
    try {
      const data = await getCart();
      // If user session changed while this request was in flight, discard response
      if (sessionEpochRef.current !== requestEpoch) {
        return null;
      }
      setCart(data);
      return data;
    } catch (err) {
      if (sessionEpochRef.current !== requestEpoch) {
        return null;
      }
      throw err;
    } finally {
      if (sessionEpochRef.current === requestEpoch) {
        setLoading(false);
      }
    }
  }, []);

  const updateCart = useCallback((newCart) => {
    if (newCart) {
      setCart(newCart);
      setLoading(false);
    }
  }, []);

  const clearCart = useCallback(() => {
    sessionEpochRef.current += 1;
    clearCartSession();
    setCart(null);
    setLoading(false);
  }, []);

  // Account Isolation: Clear stale cart on logout or Account A -> Account B switch
  useEffect(() => {
    const currentUserId = user?.id ?? null;

    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }

    if (prevUserIdRef.current !== currentUserId) {
      prevUserIdRef.current = currentUserId;

      // Invalidate any in-flight requests from the previous session
      sessionEpochRef.current += 1;

      // 1. Purge stale WooCommerce session and tokens
      clearCartSession();

      // 2. Clear React memory state immediately
      setCart(null);

      // 3. If transitioning to an authenticated user, fetch their isolated cart
      if (currentUserId) {
        setLoading(true);
        refreshCart().catch(() => {});
      } else {
        setLoading(false);
      }
    }
  }, [user?.id, refreshCart]);

  return (
    <CartContext.Provider
      value={{
        cart,
        setCart,
        updateCart,
        clearCart,
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
  const { user } = useAuth();
  const location = useLocation();
  const hasAttemptedRef = useRef(false);
  const prevUserIdRef = useRef(user?.id ?? null);

  useEffect(() => {
    const currentUserId = user?.id ?? null;
    if (prevUserIdRef.current !== currentUserId) {
      prevUserIdRef.current = currentUserId;
      hasAttemptedRef.current = false;
    }

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
  }, [location.pathname, cart, refreshCart, user?.id, loading, setLoading]);

  return null;
}