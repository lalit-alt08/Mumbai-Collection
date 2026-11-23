import { useNavigate, Link } from "react-router-dom";
import {
  addToCart as addToWooCart,
  updateCartItem,
  removeCartItem,
} from "../../services/storeApi";
import { useCart } from "../../context/CartContext";
import { Star, Minus, Plus, Truck, PackageX, AlertTriangle, CheckCircle2, ShieldAlert, ShoppingCart } from "lucide-react";
import { useEffect, useState } from "react";
import ProductWhatsAppSupport from "./ProductWhatsAppSupport";
import { triggerHaptic } from "../../utils/haptics";
import HapticTapTarget from "../common/HapticTapTarget";
import {
  cleanProductTitle,
  getCartFailureMessage,
  parseCartStockError,
  getProductStock,
  getRemainingStock,
} from "../../utils/productUtils";
import { getLiveProductStockByIds } from "../../services/productService";

function ProductInfo({ product }) {
  const navigate = useNavigate();
  const { cart, refreshCart, updateCart } = useCart();
  const [loading, setLoading] = useState(false);
  const [stockOverride, setStockOverride] = useState(null);
  const [cartError, setCartError] = useState("");

  useEffect(() => {
    setStockOverride(null);
  }, [product?.id, product?.manage_stock, product?.stock_quantity, product?.stock_status]);

  const cartItems = cart?.items || [];
  const totalCartItems = cartItems.reduce(
    (total, item) => total + (Number(item.quantity) || 0),
    0
  );
  const hasAnyCartItems = totalCartItems > 0;

  const cartItem = cartItems.find(
    (item) => Number(item.id) === Number(product.id)
  );
  const isThisProductInCart = Boolean(cartItem && cartItem.quantity > 0);

  const stockProduct = stockOverride?.id === product.id
    ? { ...product, ...stockOverride }
    : product;
  const { maxStock, isOutOfStock } = getProductStock(stockProduct, cartItem);
  const currentQuantity = cartItem?.quantity || 0;
  const remainingStock = getRemainingStock(stockProduct, currentQuantity, cartItem);
  const isMaxReached = currentQuantity >= maxStock && maxStock > 0;

  const refreshStock = async () => {
    try {
      const [latestProduct] = await getLiveProductStockByIds([product.id]);
      if (latestProduct) {
        setStockOverride(latestProduct);
      }
    } catch {
      // Keep the current stock display if the refresh itself is unavailable.
    }
  };

  const handleAddToCart = async () => {
    if (isOutOfStock || isMaxReached) return;
    if (product?.type === "variable") {
      setCartError("This item has options that must be selected before adding to cart.");
      return;
    }
    setCartError("");
    try {
      setLoading(true);
      const updated = await addToWooCart(product.id);
      if (updated) {
        triggerHaptic("medium");
        updateCart(updated);
      }
    } catch (error) {
      const stockInfo = parseCartStockError(error);
      if (stockInfo.isStockError) {
        const remaining = stockInfo.remaining ?? 0;
        setStockOverride({
          id: product.id,
          manage_stock: true,
          stock_quantity: remaining,
          stock_status: remaining > 0 ? "instock" : "outofstock",
          isAuthoritativeZero: remaining <= 0,
        });
        setCartError(getCartFailureMessage(error));
      } else {
        await refreshStock();
        const freshCart = await refreshCart().catch(() => null);
        const isInCart = freshCart?.items?.some(
          (item) => Number(item.id) === Number(product.id)
        );
        if (!isInCart) {
          setCartError(getCartFailureMessage(error));
        } else {
          setCartError("");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateQuantity = async (newQuantity) => {
    if (loading) return;
    setCartError("");

    // Strict client-side stock limit check
    if (newQuantity > maxStock) {
      return;
    }

    try {
      setLoading(true);
      let updated;
      if (newQuantity <= 0) {
        updated = await removeCartItem(cartItem.key);
      } else {
        updated = await updateCartItem(cartItem.key, newQuantity);
      }
      if (updated) {
        triggerHaptic("light");
        updateCart(updated);
      }
    } catch (error) {
      const stockInfo = parseCartStockError(error);
      if (stockInfo.isStockError) {
        const remaining = stockInfo.remaining ?? 0;
        setStockOverride({
          id: product.id,
          manage_stock: true,
          stock_quantity: remaining,
          stock_status: remaining > 0 ? "instock" : "outofstock",
          isAuthoritativeZero: remaining <= 0,
        });
      }
      setCartError(getCartFailureMessage(error));
      await refreshStock();
      await refreshCart().catch(() => {});
    } finally {
      setLoading(false);
    }
  };

  const isOnSale = product.regular_price && product.price && product.regular_price !== product.price;
  const discountPercent = isOnSale
    ? Math.round(((product.regular_price - product.price) / product.regular_price) * 100)
    : 0;

  return (
    <>
      {/* Main Product Info Card */}
      <div className="rounded-[24px] border border-[#C9D2DF] bg-[#FFFFFF] p-5 shadow-[0_7px_18px_rgba(30,41,59,0.16)] md:p-6 space-y-4">
        <div>
          <h1 className="text-[23px] font-extrabold leading-[1.18] tracking-[-0.02em] text-[#17233A] md:text-[28px]">
            {cleanProductTitle(product.name)}
          </h1>

          {/* Star Rating & Review Link */}
          <div className="mt-2 flex items-center gap-3">
            {Number(product.rating_count) > 0 ? (
              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById("product-reviews");
                  if (el) {
                    el.scrollIntoView({ behavior: "smooth" });
                  }
                }}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#64748B] hover:text-[#22499F] transition cursor-pointer"
              >
                <div className="inline-flex items-center gap-1 rounded-md bg-[#FFFFFF] px-2 py-0.5 border border-[#E2E8F0]">
                  <Star size={13} className="fill-amber-400 text-amber-400" />
                  <span className="font-extrabold text-[#22499F] text-xs">
                    {Number(product.average_rating) > 0 ? Number(product.average_rating).toFixed(1) : "5.0"}
                  </span>
                </div>
                <span className="text-[#64748B] hover:underline">
                  ({product.rating_count} review{Number(product.rating_count) > 1 ? "s" : ""})
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById("product-reviews");
                  if (el) {
                    el.scrollIntoView({ behavior: "smooth" });
                  }
                }}
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#50617B] hover:text-[#22499F] transition cursor-pointer"
              >
                <Star size={12} className="text-[#64748B]" />
                <span>No reviews yet • Be the first to review</span>
              </button>
            )}
          </div>

          {/* Stock Availability Badge */}
          <div className="mt-3">
            {isOutOfStock ? (
              <span className="store-out-of-stock inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-extrabold tracking-[0.01em]">
                <ShieldAlert size={14} /> Out of Stock
              </span>
            ) : isMaxReached ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3.5 py-1.5 text-xs font-bold text-amber-800">
                <AlertTriangle size={14} aria-hidden="true" />
                Max available in cart ({currentQuantity})
              </span>
            ) : remainingStock <= 5 ? (
              <span className="store-low-stock inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold">
                <AlertTriangle size={14} aria-hidden="true" />
                Only {remainingStock} left in stock
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#B7C8E3] bg-[#F5F8FF] px-3.5 py-1.5 text-xs font-bold text-[#22499F]">
                <CheckCircle2 size={14} /> {stockProduct.manage_stock ? `In Stock (${remainingStock} available in Vasai shop)` : "In Stock"}
              </span>
            )}
            {cartError && (
              <p role="alert" className="mt-2 text-xs font-semibold text-rose-400">
                {cartError}
              </p>
            )}
          </div>
        </div>

        <div className="product-price-purchase-row flex min-w-0 items-center justify-between border-t border-[#CBD5E1] pt-4">
          <div className="product-price-details min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-end gap-x-2 gap-y-1 sm:gap-x-3">
              <span className="text-[30px] sm:text-[34px] font-black leading-none tracking-[-0.035em] text-[#17233A] whitespace-nowrap">
                ₹{product.price}
              </span>
              {isOnSale && (
                <>
                  <span className="mb-0.5 shrink-0 text-[14px] sm:text-[16px] font-medium text-[#64748B] line-through whitespace-nowrap">
                    ₹{product.regular_price}
                  </span>
                  <span className="mb-0.5 shrink-0 rounded-md bg-[#22499F] px-2 py-1 text-[10px] sm:text-[11px] font-extrabold tracking-[0.02em] text-[#FFFFFF] whitespace-nowrap">
                    {discountPercent}% OFF
                  </span>
                </>
              )}
            </div>
            <p className="text-[12px] font-medium text-[#596B86]">Inclusive of all taxes</p>
          </div>

          {/* Action Area: Desktop Add/Stepper */}
          <div className="product-purchase-actions hidden lg:flex shrink-0 items-center gap-2.5 sm:gap-3">
            {/* Desktop Add to Cart / Quantity Stepper */}
            <div className="flex flex-col items-end">
              {isOutOfStock ? (
                cartItem ? (
                  <HapticTapTarget radius="12px">
                    <button
                      type="button"
                      onClick={() => handleUpdateQuantity(0)}
                      disabled={loading}
                      className="flex h-[40px] px-5 items-center justify-center rounded-xl border border-rose-800/50 bg-rose-950/40 text-[13px] font-bold text-rose-300 shadow-xs transition-all hover:bg-rose-900/50 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                    >
                      Sold Out — Remove
                    </button>
                  </HapticTapTarget>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="store-out-of-stock flex h-[40px] px-8 items-center justify-center rounded-xl text-[14px] font-bold cursor-not-allowed select-none"
                  >
                    Out of Stock
                  </button>
                )
              ) : !cartItem ? (
                <HapticTapTarget radius="12px">
                  <button
                    onClick={handleAddToCart}
                    disabled={loading}
                    className="flex h-[40px] px-6 items-center justify-center rounded-xl border border-[#22499F]/70 bg-[#F0F8E8] text-[14px] font-bold text-[#22499F] shadow-xs transition-all duration-100 ease-out hover:bg-[#22499F] hover:text-[#FFFFFF] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:ring-2 focus-visible:ring-[#22499F]"
                  >
                    ADD
                  </button>
                </HapticTapTarget>
              ) : (
                <div className="flex flex-col items-end gap-1">
                  <div className="flex h-[40px] w-[120px] items-center justify-between rounded-xl bg-[#22499F] px-1.5 text-[#FFFFFF] shadow-[0_4px_16px_rgba(66,214,232,0.3)]">
                    <HapticTapTarget radius="8px">
                      <button
                        disabled={loading}
                        className="flex h-[32px] w-[32px] items-center justify-center rounded-lg bg-black/15 transition-transform duration-100 ease-out hover:bg-black/25 active:scale-[0.92] disabled:opacity-50 cursor-pointer"
                        onClick={() => handleUpdateQuantity(cartItem.quantity - 1)}
                      >
                        <Minus size={16} />
                      </button>
                    </HapticTapTarget>
                    <span className="text-[15px] font-black">{cartItem.quantity}</span>
                    <HapticTapTarget radius="8px">
                      <button
                        disabled={loading || isMaxReached}
                        title={isMaxReached ? `Only ${maxStock} items available in stock` : "Add one more"}
                        className="flex h-[32px] w-[32px] items-center justify-center rounded-lg bg-black/15 transition-transform duration-100 ease-out hover:bg-black/25 active:scale-[0.92] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        onClick={() => handleUpdateQuantity(cartItem.quantity + 1)}
                      >
                        <Plus size={16} />
                      </button>
                    </HapticTapTarget>
                  </div>
                  {isMaxReached && (
                    <span className="text-[10px] font-bold text-amber-400">
                      Max stock ({maxStock}) added
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Service Cards Grid */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          to="/return-policy"
          className="flex min-h-[112px] flex-col items-center justify-center gap-2.5 rounded-2xl border border-[#C9D2DF] bg-[#FFFFFF] p-4 text-center shadow-[0_4px_12px_rgba(30,41,59,0.12)] transition-all hover:-translate-y-0.5 hover:border-[#22499F]/70 hover:shadow-[0_6px_16px_rgba(34,73,159,0.16)] cursor-pointer group"
        >
          <PackageX size={25} className="text-[#22499F] transition-transform group-hover:scale-105" strokeWidth={1.9} />
          <span className="text-[13px] font-extrabold leading-snug text-[#1E293B] group-hover:text-[#22499F] transition-colors">No Return or Exchange</span>
        </Link>
        <div className="flex min-h-[112px] flex-col items-center justify-center gap-2.5 rounded-2xl border border-[#C9D2DF] bg-[#FFFFFF] p-4 text-center shadow-[0_4px_12px_rgba(30,41,59,0.12)]">
          <Truck size={25} className="text-[#22499F]" strokeWidth={1.9} />
          <span className="text-[13px] font-extrabold leading-snug text-[#1E293B]">Local Delivery</span>
        </div>
      </div>

      {/* Ask on WhatsApp Support Section */}
      <ProductWhatsAppSupport product={product} />

      {/* Sticky Bottom Purchase Bar (Mobile & Split-Screen < lg) */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[100] w-full rounded-t-[24px] sm:rounded-t-[28px] border-t border-[#E2E8F0] bg-[#F0F8E8]/95 backdrop-blur-md px-4 pt-3.5 shadow-[0_-8px_24px_rgba(0,0,0,0.15)] lg:hidden"
        style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom))", marginBottom: "0" }}
      >
        {!hasAnyCartItems ? (
          /* State 1: Cart is empty (0 items) -> ₹price · Add to cart */
          <div className="mx-auto flex w-full max-w-lg items-center justify-between gap-3">
            <div className="flex flex-col flex-shrink-0 pl-1">
              <span className="text-[22px] font-black leading-none tracking-tight text-[#1E293B]">
                ₹{product.price}
              </span>
              {isOutOfStock ? (
                <span className="text-[10px] font-bold text-rose-500 mt-0.5">Out of stock</span>
              ) : isMaxReached ? (
                <span className="text-[10px] font-bold text-amber-600 mt-0.5">All in cart</span>
              ) : remainingStock <= 5 ? (
                <span className="text-[10px] font-bold text-orange-500 mt-0.5">
                  Only {remainingStock} left
                </span>
              ) : (
                <span className="text-[10px] font-semibold text-[#22499F] mt-0.5">
                  In stock
                </span>
              )}
            </div>

            <div className="flex items-center justify-end">
              {isOutOfStock ? (
                <button
                  type="button"
                  disabled
                  className="store-out-of-stock flex h-[44px] min-w-[140px] items-center justify-center rounded-full px-5 text-[14px] font-bold cursor-not-allowed select-none"
                >
                  Out of Stock
                </button>
              ) : (
                <HapticTapTarget radius="9999px">
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    disabled={loading}
                    className="flex h-[44px] min-w-[140px] items-center justify-center gap-2 rounded-full bg-[#22499F] px-6 text-[14px] font-black text-[#FFFFFF] shadow-[0_4px_16px_rgba(34,73,159,0.3)] transition-transform duration-100 ease-out hover:bg-[#1B3B82] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:ring-2 focus-visible:ring-[#22499F]"
                  >
                    Add to cart
                  </button>
                </HapticTapTarget>
              )}
            </div>
          </div>
        ) : !isThisProductInCart ? (
          /* State 2: Cart has other products -> [Cart Icon + Badge (Left)] [Add to cart (Right, Pill)] */
          <div className="mx-auto flex w-full max-w-lg items-center gap-3">
            {/* Left: Cart Button with Count Badge (Image 2 design) */}
            <HapticTapTarget className="flex-shrink-0" radius="16px">
              <button
                type="button"
                onClick={() => navigate("/cart")}
                aria-label={`View cart (${totalCartItems} ${totalCartItems === 1 ? "item" : "items"})`}
                className="product-cart-nav-btn relative flex h-[46px] w-[58px] items-center justify-center rounded-2xl border-2 border-[#C9D2DF] bg-white text-[#1E293B] shadow-xs transition-all duration-100 ease-out hover:bg-[#F8FAFC] active:scale-[0.95] cursor-pointer focus-visible:ring-2 focus-visible:ring-[#22499F]"
              >
                <div className="relative flex items-center justify-center">
                  <ShoppingCart size={22} className="text-[#1E293B]" strokeWidth={2.2} />
                  <span
                    className="product-cart-nav-badge absolute -top-2.5 -right-3 flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-[#E11D48] px-1 text-[11px] font-black leading-none text-white ring-2 ring-white shadow-xs"
                  >
                    {totalCartItems > 99 ? "99+" : totalCartItems}
                  </span>
                </div>
              </button>
            </HapticTapTarget>

            {/* Right: Add to cart button (pill shaped, theme matching) */}
            {isOutOfStock ? (
              <button
                type="button"
                disabled
                className="store-out-of-stock flex-1 flex h-[46px] items-center justify-center rounded-full px-5 text-[15px] font-bold cursor-not-allowed select-none"
              >
                Out of Stock
              </button>
            ) : (
              <HapticTapTarget className="flex-1 min-w-0" radius="9999px">
                <button
                  type="button"
                  onClick={handleAddToCart}
                  disabled={loading}
                  className="flex h-[46px] w-full items-center justify-center gap-2 rounded-full bg-[#22499F] px-6 text-[15px] font-black text-[#FFFFFF] shadow-[0_4px_16px_rgba(34,73,159,0.3)] transition-transform duration-100 ease-out hover:bg-[#1B3B82] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:ring-2 focus-visible:ring-[#22499F]"
                >
                  Add to cart
                </button>
              </HapticTapTarget>
            )}
          </div>
        ) : (
          /* State 3: This product is already in the cart -> − 1 + · View cart · 1 item */
          <div className="mx-auto flex w-full max-w-lg items-center gap-3">
            {isOutOfStock ? (
              <HapticTapTarget className="flex-shrink-0" radius="9999px">
                <button
                  type="button"
                  onClick={() => handleUpdateQuantity(0)}
                  disabled={loading}
                  className="flex h-[44px] items-center justify-center rounded-full border border-rose-300 bg-rose-50 px-4 text-[13px] font-bold text-rose-700 shadow-xs transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                >
                  Sold Out — Remove
                </button>
              </HapticTapTarget>
            ) : (
              <div className="flex h-[44px] min-w-[124px] max-w-[136px] flex-shrink-0 items-center justify-between rounded-full border-2 border-[#22499F] bg-white px-1.5 text-[#22499F] shadow-xs">
                <HapticTapTarget radius="9999px">
                  <button
                    type="button"
                    disabled={loading}
                    aria-label="Decrease quantity"
                    className="flex h-[32px] w-[32px] items-center justify-center rounded-full hover:bg-[#F5F8FF] active:scale-[0.92] text-[#22499F] transition-transform cursor-pointer disabled:opacity-50"
                    onClick={() => handleUpdateQuantity(cartItem.quantity - 1)}
                  >
                    <Minus size={16} />
                  </button>
                </HapticTapTarget>
                <span className="text-[15px] font-black text-[#17233A] px-1">
                  {cartItem.quantity}
                </span>
                <HapticTapTarget radius="9999px">
                  <button
                    type="button"
                    disabled={loading || isMaxReached}
                    aria-label="Increase quantity"
                    title={isMaxReached ? `Only ${maxStock} items available in stock` : "Add one more"}
                    className="flex h-[32px] w-[32px] items-center justify-center rounded-full hover:bg-[#F5F8FF] active:scale-[0.92] text-[#22499F] transition-transform cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={() => handleUpdateQuantity(cartItem.quantity + 1)}
                  >
                    <Plus size={16} />
                  </button>
                </HapticTapTarget>
              </div>
            )}

            <HapticTapTarget className="flex-1 min-w-0" radius="9999px">
              <button
                type="button"
                onClick={() => navigate("/cart")}
                className="flex h-[44px] w-full items-center justify-center gap-1.5 rounded-full bg-[#22499F] px-4 text-[14px] font-black text-[#FFFFFF] shadow-[0_4px_16px_rgba(34,73,159,0.3)] transition-transform duration-100 ease-out hover:bg-[#1B3B82] active:scale-[0.98] cursor-pointer whitespace-nowrap"
              >
                <span>
                  View cart · {totalCartItems} {totalCartItems === 1 ? "item" : "items"}
                </span>
              </button>
            </HapticTapTarget>
          </div>
        )}
      </div>
    </>
  );
}

export default ProductInfo;
