import { useState } from "react";
import { updateCartItem, removeCartItem } from "../../services/storeApi";

export function useStockAlert({ cart, refreshCart, setError, navigate }) {
  const [stockAlertOpen, setStockAlertOpen] = useState(false);
  const [stockAlertItems, setStockAlertItems] = useState([]);
  const [removingStockItems, setRemovingStockItems] = useState(false);

  const handleRemoveUnavailableAndContinue = async () => {
    if (removingStockItems) return;
    try {
      setRemovingStockItems(true);
      if (Array.isArray(stockAlertItems) && stockAlertItems.length > 0) {
        for (const item of stockAlertItems) {
          let targetKey = item.key;
          if (!targetKey && cart?.items) {
            const matched = cart.items.find(
              (c) =>
                (item.id && Number(c.id) === Number(item.id)) ||
                c.name === item.name
            );
            if (matched) targetKey = matched.key;
          }
          if (targetKey) {
            try {
              const available = Number(item.available);
              const requested = Number(item.requested);
              if (Number.isFinite(available) && available > 0 && available < requested) {
                await updateCartItem(targetKey, available);
              } else {
                await removeCartItem(targetKey);
              }
            } catch {
              // continue with remaining items
            }
          }
        }
      }
      await refreshCart().catch(() => {});
      setStockAlertOpen(false);
      setStockAlertItems([]);
      setError("");
    } catch {
      setError("Failed to update cart. Please return to your cart.");
    } finally {
      setRemovingStockItems(false);
    }
  };

  const handleReturnToCart = () => {
    setStockAlertOpen(false);
    navigate("/cart");
  };

  return {
    stockAlertOpen,
    setStockAlertOpen,
    stockAlertItems,
    setStockAlertItems,
    removingStockItems,
    handleRemoveUnavailableAndContinue,
    handleReturnToCart,
  };
}
