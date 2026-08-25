import { createContext, useContext, useEffect, useState } from "react";
import { getCart } from "../services/storeApi";

const CartContext = createContext();

export function CartProvider({ children }) {
  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshCart = async () => {
    try {
      const data = await getCart();
      setCart(data);
      return data;
    } catch (err) {
      console.error("Cart refresh failed:", err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshCart().catch((err) => {
      console.warn("Initial cart fetch skipped:", err?.message || err);
    });
  }, []);

  return (
    <CartContext.Provider
      value={{
        cart,
        loading,
        refreshCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);