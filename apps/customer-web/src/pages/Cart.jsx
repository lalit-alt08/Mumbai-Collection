import { useState, useRef, useEffect, useCallback } from "react";
import { updateCartItem, removeCartItem, addToCart, getStoreProductById } from "../services/storeApi";
import { getProductById } from "../services/productService";
import { useNavigate, useLocation } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { ArrowLeft, Share, Check, ShoppingBag } from "lucide-react";
import CartItem from "../components/cart/CartItem";
import CartSummary from "../components/cart/CartSummary";
import SharedCartModal from "../components/cart/SharedCartModal";
import { buildCartShareUrl, parseSharedCartItems } from "../utils/cartShareUtils";

function Cart() {
  const navigate = useNavigate();
  const location = useLocation();
  const { cart, loading, refreshCart, updateCart } = useCart();
  const { isAuthenticated } = useAuth();
  const [updatingKey, setUpdatingKey] = useState(null);
  const [shareFeedback, setShareFeedback] = useState(null);
  const shareTimerRef = useRef(null);

  // Shared Cart State
  const [sharedModalOpen, setSharedModalOpen] = useState(false);
  const [sharedItems, setSharedItems] = useState([]);
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [verifyingShared, setVerifyingShared] = useState(false);
  const [sharedError, setSharedError] = useState("");
  const sharedHandledRef = useRef(false);

  useEffect(() => {
    return () => {
      if (shareTimerRef.current) {
        clearTimeout(shareTimerRef.current);
      }
    };
  }, []);

  // Check for shared cart query parameter on mount / navigation
  const checkSharedQuery = useCallback(async () => {
    if (sharedHandledRef.current) return;

    const parsed = parseSharedCartItems(location.search);
    if (!parsed || parsed.length === 0) return;

    sharedHandledRef.current = true;
    setSharedItems(parsed);
    setSharedModalOpen(true);
    setVerifyingShared(true);
    setSharedError("");

    try {
      const results = await Promise.allSettled(
        parsed.map(async ({ id, quantity, variationId, variation }) => {
          const product = await getProductById(id);
          if (!product || !product.id) return null;

          const isVariable =
            product.type === "variable" ||
            (Array.isArray(product.variations) && product.variations.length > 0);

          // Simple products: no variation ID or variation attributes needed
          if (!isVariable) {
            const isOutOfStock =
              product.stock_status === "outofstock" ||
              (product.manage_stock &&
                product.stock_quantity !== null &&
                product.stock_quantity <= 0);

            const maxStock =
              product.manage_stock && product.stock_quantity !== null
                ? Number(product.stock_quantity)
                : isOutOfStock
                ? 0
                : 99;

            return {
              product,
              quantity: Math.min(quantity, maxStock > 0 ? maxStock : quantity),
              variationId: null,
              variation: [],
              isAvailable: !isOutOfStock,
              outOfStockMessage: isOutOfStock ? "Currently out of stock" : "",
            };
          }

          // Variable product: verify exact variation identity, attributes, and stock
          // 1. A variable product MUST have variation details in the shared URL
          if (!variationId && (!variation || variation.length === 0)) {
            return {
              product,
              quantity,
              variationId: null,
              variation: [],
              isAvailable: false,
              outOfStockMessage: "Configuration required for variable product",
            };
          }

          // 2. Fetch authoritative variation definitions from WooCommerce Store API
          let matchedVariation = null;
          let variationError = "";

          try {
            const storeProduct = await getStoreProductById(id);
            const storeVariations = Array.isArray(storeProduct?.variations)
              ? storeProduct.variations
              : [];

            // Helper to normalize attribute slugs/names and values for resilient matching
            const norm = (s) =>
              String(s || "")
                .toLowerCase()
                .trim()
                .replace(/^pa_/, "")
                .replace(/^attribute_pa_/, "")
                .replace(/^attribute_/, "");

            if (variationId) {
              // Locate variation by authoritative ID
              const found = storeVariations.find(
                (v) => Number(v.id) === Number(variationId)
              );

              if (!found) {
                variationError = "Selected variation is no longer available.";
              } else if (Array.isArray(variation) && variation.length > 0) {
                // Cross-validate that the provided attributes actually match this variation
                const varAttrs = Array.isArray(found.attributes)
                  ? found.attributes
                  : [];

                const allMatch = variation.every((sharedAttr) => {
                  const sName = norm(sharedAttr.attribute);
                  const sVal = norm(sharedAttr.value);
                  const matchedAttr = varAttrs.find((va) => {
                    const vaName = norm(va.name || va.attribute);
                    const vaVal = norm(va.value || va.option);
                    // In WooCommerce, an empty variation value represents 'Any attribute'
                    return vaName === sName && (vaVal === "" || vaVal === sVal);
                  });
                  return Boolean(matchedAttr);
                });

                if (!allMatch) {
                  variationError = "Selected variation is no longer available.";
                } else {
                  matchedVariation = found;
                }
              } else {
                matchedVariation = found;
              }
            } else if (Array.isArray(variation) && variation.length > 0) {
              // If variationId was omitted, resolve by exact attribute signature
              const found = storeVariations.find((v) => {
                const varAttrs = Array.isArray(v.attributes) ? v.attributes : [];
                return variation.every((sharedAttr) => {
                  const sName = norm(sharedAttr.attribute);
                  const sVal = norm(sharedAttr.value);
                  const matchedAttr = varAttrs.find((va) => {
                    const vaName = norm(va.name || va.attribute);
                    const vaVal = norm(va.value || va.option);
                    return vaName === sName && (vaVal === "" || vaVal === sVal);
                  });
                  return Boolean(matchedAttr);
                });
              });

              if (found) {
                matchedVariation = found;
              } else {
                variationError = "Selected variation is no longer available.";
              }
            }
          } catch {
            // If Store API lookup blips, fall back to parent catalog product.variations list
            if (
              variationId &&
              Array.isArray(product.variations) &&
              !product.variations.includes(Number(variationId))
            ) {
              variationError = "Selected variation is no longer available.";
            }
          }

          if (variationError) {
            return {
              product,
              quantity,
              variationId,
              variation,
              isAvailable: false,
              outOfStockMessage: variationError,
            };
          }

          // Check stock on the specific matched variation if resolved, else parent
          const targetStockObj = matchedVariation || product;
          const isVarOutOfStock =
            targetStockObj.stock_status === "outofstock" ||
            (targetStockObj.manage_stock &&
              targetStockObj.stock_quantity !== null &&
              targetStockObj.stock_quantity <= 0);

          const maxStock =
            targetStockObj.manage_stock && targetStockObj.stock_quantity !== null
              ? Number(targetStockObj.stock_quantity)
              : isVarOutOfStock
              ? 0
              : 99;

          return {
            product,
            quantity: Math.min(quantity, maxStock > 0 ? maxStock : quantity),
            variationId: matchedVariation?.id || variationId || null,
            variation: Array.isArray(variation) ? variation : [],
            isAvailable: !isVarOutOfStock,
            outOfStockMessage: isVarOutOfStock ? "Currently out of stock" : "",
          };
        })
      );

      const resolved = results
        .filter((r) => r.status === "fulfilled" && r.value !== null)
        .map((r) => r.value);

      setCatalogProducts(resolved);
      if (resolved.length === 0) {
        setSharedError("None of the shared items are currently available.");
      }
    } catch {
      setSharedError("Could not verify some shared items. Please try again.");
    } finally {
      setVerifyingShared(false);
    }
  }, [location.search]);

  useEffect(() => {
    checkSharedQuery();
  }, [checkSharedQuery]);

  const handleShareCart = async () => {
    if (!cart?.items || cart.items.length === 0) {
      setShareFeedback("Your cart is empty");
      if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
      shareTimerRef.current = setTimeout(() => {
        setShareFeedback(null);
        shareTimerRef.current = null;
      }, 2500);
      return;
    }

    const shareUrl = buildCartShareUrl(cart.items);
    const count = cart.items.length;
    const shareData = {
      title: "My Cart - Mumbai Collection",
      text: `Check out these ${count} item${count === 1 ? "" : "s"} from Mumbai Collection!`,
      url: shareUrl,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        if (err.name === "AbortError") return;
      }
    }

    // Fallback: Copy link to clipboard
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = shareUrl;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setShareFeedback("Cart link copied!");
      if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
      shareTimerRef.current = setTimeout(() => {
        setShareFeedback(null);
        shareTimerRef.current = null;
      }, 2500);
    } catch {
      setShareFeedback("Failed to copy link");
      if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
      shareTimerRef.current = setTimeout(() => {
        setShareFeedback(null);
        shareTimerRef.current = null;
      }, 2500);
    }
  };

  const handleApplySharedItems = async ({ replace = false }) => {
    const availableItems = catalogProducts.filter((item) => item.isAvailable);
    if (availableItems.length === 0) {
      throw new Error("No available items to add.");
    }

    try {
      // If replacing, remove all existing items from the cart first
      if (replace && cart?.items && cart.items.length > 0) {
        for (const existingItem of cart.items) {
          try {
            await removeCartItem(existingItem.key);
          } catch {
            // ignore individual removal error and continue
          }
        }
      }

      // Add each shared available item sequentially via WooCommerce Store API
      let lastCartState = null;
      for (const item of availableItems) {
        try {
          const res = await addToCart(
            item.product.id,
            item.quantity,
            Array.isArray(item.variation) && item.variation.length > 0
              ? item.variation
              : []
          );
          if (res) lastCartState = res;
        } catch {
          // continue with remaining items if one fails
        }
      }

      if (lastCartState) {
        updateCart(lastCartState);
      } else {
        await refreshCart().catch(() => {});
      }

      // Remove the items query from the URL cleanly without reloading
      navigate("/cart", { replace: true });
    } catch (err) {
      setSharedError("Some items could not be added. Please try again.");
      throw err;
    }
  };

  const handleDecreaseQuantity = async (item) => {
    if (updatingKey) return;
    try {
      setUpdatingKey(item.key);
      let updated;
      if (item.quantity <= 1) {
        updated = await removeCartItem(item.key);
      } else {
        updated = await updateCartItem(item.key, item.quantity - 1);
      }
      if (updated) {
        updateCart(updated);
      }
    } catch {
      await refreshCart().catch(() => {});
    } finally {
      setUpdatingKey(null);
    }
  };

  const handleIncreaseQuantity = async (item) => {
    if (updatingKey) return;
    try {
      setUpdatingKey(item.key);
      const updated = await updateCartItem(item.key, item.quantity + 1);
      if (updated) {
        updateCart(updated);
      }
    } catch {
      await refreshCart().catch(() => {});
    } finally {
      setUpdatingKey(null);
    }
  };

  const MIN_ORDER_VALUE = 500;

  const handleCheckout = () => {
    if (itemsTotal < MIN_ORDER_VALUE) return;
    if (!isAuthenticated) {
      navigate("/login", { state: { from: "/checkout" } });
      return;
    }
    navigate("/checkout");
  };

  const hasSharedBanner = Boolean(
    !sharedModalOpen && sharedItems.length > 0 && location.search.includes("items=")
  );

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-[15px] font-medium text-[#666666]">Loading cart...</div>
      </div>
    );
  }

  const isCartEmpty = !cart || !cart.items || cart.items.length === 0;

  // Calculate values safely
  const discount = cart?.totals?.total_discount
    ? Number(cart.totals.total_discount) / 100
    : 0;
  const delivery = cart?.totals?.total_shipping
    ? Number(cart.totals.total_shipping) / 100
    : 0;
  const tax = cart?.totals?.total_tax ? Number(cart.totals.total_tax) / 100 : 0;
  const total = Number(cart?.totals?.total_price || 0) / 100;

  const itemsTotal = cart?.totals?.total_items
    ? Number(cart.totals.total_items) / 100
    : (cart?.items || []).reduce(
        (acc, item) =>
          acc +
          (Number(item.totals?.line_subtotal) ||
            Number(item.totals?.line_total) ||
            0),
        0
      ) / 100;

  return (
    <div className="mx-auto w-full max-w-[700px] pb-[120px] md:pt-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between rounded-[22px] bg-white px-4 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.03)] md:mb-6">
        <button
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#1F2937] shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-100/80 transition-transform hover:scale-105 active:scale-95 cursor-pointer"
        >
          <ArrowLeft size={20} strokeWidth={2.4} />
        </button>
        <h1 className="text-[18px] font-bold text-[#1E1E1E]">My Cart</h1>
        <div className="relative">
          <button
            onClick={handleShareCart}
            aria-label="Share cart"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#1F2937] shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-100/80 transition-transform hover:scale-105 active:scale-95 cursor-pointer"
          >
            {shareFeedback ? (
              <Check size={18} className="text-emerald-600" />
            ) : (
              <Share size={18} strokeWidth={2.2} />
            )}
          </button>
          {shareFeedback && (
            <div className="absolute right-0 top-12 z-20 whitespace-nowrap rounded-xl bg-gray-900/90 px-3 py-1.5 text-[11px] font-semibold text-white shadow-lg backdrop-blur-md animate-[fadeIn_0.2s_ease-out] flex items-center gap-1.5">
              <Check size={13} className="text-emerald-400" />
              <span>{shareFeedback}</span>
            </div>
          )}
        </div>
      </div>

      {/* Shared Cart Top Prompt Banner (When modal closed but URL still has query) */}
      {hasSharedBanner && (
        <div className="mb-4 rounded-2xl bg-gradient-to-r from-purple-50 via-white to-purple-50 border border-[#7C3AED]/25 p-4 shadow-sm flex items-center justify-between gap-3 animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#7C3AED]/10 text-[#7C3AED]">
              <ShoppingBag size={20} />
            </div>
            <div>
              <p className="text-xs font-bold text-[#1F2937]">
                Someone shared a cart with you
              </p>
              <p className="text-[11px] text-gray-500 font-medium">
                {sharedItems.length} item{sharedItems.length === 1 ? "" : "s"} ready to review
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSharedModalOpen(true)}
              className="rounded-xl bg-[#7C3AED] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#6C35E8] transition active:scale-95 cursor-pointer"
            >
              View Items
            </button>
            <button
              onClick={() => navigate("/cart", { replace: true })}
              className="rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 transition cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {isCartEmpty ? (
        <div className="mx-auto flex max-w-[700px] flex-col items-center justify-center px-6 py-20 text-center">
          <h1 className="mb-4 text-[24px] font-bold text-[#1E1E1E]">
            Your Cart is Empty
          </h1>
          <p className="mb-8 text-[#666666]">
            Looks like you haven&apos;t added anything to your cart yet.
          </p>
          <button
            onClick={() => navigate("/")}
            className="rounded-full bg-[#7C3AED] px-8 py-3.5 font-semibold text-white transition-all hover:bg-[#6C35E8] active:scale-95 shadow-[0_4px_20px_rgba(124,58,237,0.2)] cursor-pointer"
          >
            Start Shopping
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Product Items List */}
          <div className="space-y-4">
            {cart.items.map((item) => (
              <CartItem
                key={item.key}
                item={item}
                updatingKey={updatingKey}
                onDecrease={handleDecreaseQuantity}
                onIncrease={handleIncreaseQuantity}
              />
            ))}
          </div>

          {/* Bill Summary, Policies & Floating Bar */}
          <CartSummary
            cart={cart}
            itemsTotal={itemsTotal}
            discount={discount}
            delivery={delivery}
            tax={tax}
            total={total}
            canCheckout={itemsTotal >= MIN_ORDER_VALUE}
            shortfall={Math.max(0, MIN_ORDER_VALUE - itemsTotal)}
            minOrderValue={MIN_ORDER_VALUE}
            onCheckout={handleCheckout}
          />
        </div>
      )}

      {/* Shared Cart Modal Dialog */}
      <SharedCartModal
        isOpen={sharedModalOpen}
        onClose={() => setSharedModalOpen(false)}
        sharedItems={sharedItems}
        catalogProducts={catalogProducts}
        loading={verifyingShared}
        error={sharedError}
        onAddToCart={handleApplySharedItems}
        hasExistingCart={Boolean(cart?.items && cart.items.length > 0)}
        existingCartCount={cart?.items?.length || 0}
      />
    </div>
  );
}

export default Cart;
