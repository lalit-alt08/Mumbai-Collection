import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { getCart, addToCart, updateCartItem, clearCartSession } from "../services/storeApi";
import { useAuth } from "./AuthContext";
import { useLocation } from "react-router-dom";
import { orchestrateCartMerge } from "../utils/cartMerge";
import { getCartItemIdentity } from "../utils/cartMerge";
import { safeSessionStorage } from "../utils/safeStorage";

const CartContext = createContext();

export function CartProvider({ children }) {
  const { user, checkoutExpiredUserId, clearCheckoutRecovery } = useAuth();
  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cartMergeNotice, setCartMergeNotice] = useState(null);

  // Monotonically increasing epoch counter: discards stale in-flight responses across session switches
  const sessionEpochRef = useRef(0);
  const prevUserIdRef = useRef(user?.id ?? null);
  const isInitialMountRef = useRef(true);
  const retryMergeRef = useRef(null);
  const mergingEpochRef = useRef(null);
  const recoveryOwnerRef = useRef(checkoutExpiredUserId || null);

  const saveRecoveryDraft = (owner, items) => {
    if (!owner) return;
    safeSessionStorage.setJSON("checkout_cart_draft", {
      owner: String(owner), timestamp: Date.now(),
      items: (items || []).map(({ id, variation_id, variation, quantity }) => ({ id, variation_id, variation, quantity })),
    });
  };

  const updateRecoveryQuantity = useCallback((key, quantity) => {
    if (!checkoutExpiredUserId || user?.id) return;
    setCart((previous) => {
      if (!previous?.items) return previous;
      const items = previous.items.map((item) => item.key === key ? { ...item, quantity } : item).filter((item) => item.quantity > 0);
      saveRecoveryDraft(checkoutExpiredUserId, items);
      return { ...previous, items, recoveryDraft: true };
    });
  }, [checkoutExpiredUserId, user?.id]);

  const retryCartMerge = useCallback(() => {
    void retryMergeRef.current?.();
  }, []);

  const clearCartMergeNotice = useCallback(() => {
    setCartMergeNotice(null);
  }, []);

  const refreshCart = useCallback(async () => {
    if (recoveryOwnerRef.current && !prevUserIdRef.current) {
      setLoading(false);
      return null;
    }
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

  // Account Isolation & Guest-to-Customer Cart Merge:
  useEffect(() => {
    const currentUserId = user?.id ?? null;
    const prevUserId = prevUserIdRef.current;

    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }

    if (prevUserId !== currentUserId) {
      prevUserIdRef.current = currentUserId;
      sessionEpochRef.current += 1;
      const currentEpoch = sessionEpochRef.current;

      // Scenario 1: Logout (User -> null) - full purge
      if (!currentUserId) {
        retryMergeRef.current = null;
        clearCartSession();
        if (checkoutExpiredUserId && String(prevUserId) === String(checkoutExpiredUserId)) {
          recoveryOwnerRef.current = String(prevUserId);
          saveRecoveryDraft(prevUserId, cart?.items);
          setLoading(false);
          return;
        }
        recoveryOwnerRef.current = null;
        safeSessionStorage.removeItem("checkout_cart_draft");
        setCart(null);
        setLoading(false);
        setCartMergeNotice(null);
        return;
      }

      const recoveryOwner = recoveryOwnerRef.current || checkoutExpiredUserId;
      if (!prevUserId && recoveryOwner) {
        recoveryOwnerRef.current = null;
        clearCheckoutRecovery();
        clearCartSession();
        const draft = safeSessionStorage.getJSON("checkout_cart_draft", null);
        if (String(currentUserId) !== String(recoveryOwner)) safeSessionStorage.removeItem("checkout_cart_draft");
        setCart(null);
        setLoading(true);
        refreshCart().then((serverCart) => {
          if (sessionEpochRef.current !== currentEpoch) return;
          if (String(currentUserId) !== String(recoveryOwner) || !draft || Date.now() - draft.timestamp > 30 * 60 * 1000) return;
          safeSessionStorage.removeItem("checkout_cart_draft");
          const expected = new Map((draft.items || []).map((item) => [getCartItemIdentity(item), Number(item.quantity)]));
          const actual = new Map((serverCart?.items || []).map((item) => [getCartItemIdentity(item), Number(item.quantity)]));
          if (expected.size !== actual.size || [...expected].some(([key, quantity]) => actual.get(key) !== quantity)) {
            setCartMergeNotice({ failedItems: [{ name: "Your cart changed while you were signed out. Please review it before checkout." }], retryable: false });
          }
        }).catch(() => {
          if (sessionEpochRef.current === currentEpoch) setCartMergeNotice({ failedItems: [{ name: "We could not reload your cart. Please try again." }], retryable: false });
        });
        return;
      }

      // Scenario 2: Account Switch (User A -> User B) - full purge for account isolation
      if (prevUserId && currentUserId && prevUserId !== currentUserId) {
        retryMergeRef.current = null;
        clearCartSession();
        setCart(null);
        setLoading(true);
        setCartMergeNotice(null);
        refreshCart().catch(() => {});
        return;
      }

      // Scenario 3: Guest -> Logged-In Customer (null -> User A)
      // Preserve guest cart items by capturing them and merging into the authenticated account
      const guestItems = cart?.items || [];

      const mergeAndRefresh = async () => {
        if (mergingEpochRef.current === currentEpoch) return;
        mergingEpochRef.current = currentEpoch;
        setLoading(true);
        const isSessionValid = () =>
          sessionEpochRef.current === currentEpoch &&
          prevUserIdRef.current === currentUserId;

        try {
          const result = await orchestrateCartMerge({
            guestItems,
            api: {
              refreshCart,
              addToCart,
              updateCartItem,
            },
            isSessionValid,
          });

          if (result.cancelled || !isSessionValid()) {
            return;
          }

          if (result.serverCart) {
            setCart(result.serverCart);
          }

          if (result.failedItems && result.failedItems.length > 0) {
            setCartMergeNotice({
              failedItems: result.failedItems,
              retryable: true,
              timestamp: Date.now(),
            });
          } else {
            retryMergeRef.current = null;
            setCartMergeNotice(null);
          }
        } catch (_) {
          if (isSessionValid()) setCartMergeNotice({ failedItems: guestItems.map((item) => ({ name: item.name || `Product #${item.id}` })), retryable: true });
        } finally {
          if (mergingEpochRef.current === currentEpoch) mergingEpochRef.current = null;
          if (isSessionValid()) {
            setLoading(false);
          }
        }
      };

      retryMergeRef.current = mergeAndRefresh;
      mergeAndRefresh();
    }
  }, [user?.id, checkoutExpiredUserId, refreshCart, cart?.items]);

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
        cartMergeNotice,
        clearCartMergeNotice,
        retryCartMerge,
        updateRecoveryQuantity,
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