import { useNavigate, Link } from "react-router-dom";
import {
  addToCart as addToWooCart,
  updateCartItem,
  removeCartItem,
} from "../../services/storeApi";
import { useCart } from "../../context/CartContext";
import { Star, Minus, Plus, Truck, PackageX, AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
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

  const cartItem = cart?.items?.find(
    (item) => Number(item.id) === Number(product.id)
  );

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
      <div className="rounded-[24px] bg-[#111F36] border border-[#1E3252]/80 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.25)] md:p-6 space-y-4">
        <div>
          <h1 className="text-[22px] font-bold leading-snug text-[#F1F5F9] md:text-[26px]">
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
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#8FA4BE] hover:text-[#42D6E8] transition cursor-pointer"
              >
                <div className="inline-flex items-center gap-1 rounded-md bg-[#132B45] px-2 py-0.5 border border-[#1E3252]">
                  <Star size={13} className="fill-amber-400 text-amber-400" />
                  <span className="font-extrabold text-[#42D6E8] text-xs">
                    {Number(product.average_rating) > 0 ? Number(product.average_rating).toFixed(1) : "5.0"}
                  </span>
                </div>
                <span className="text-[#8FA4BE] hover:underline">
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
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#6E84A3] hover:text-[#42D6E8] transition cursor-pointer"
              >
                <Star size={12} className="text-[#4B6282]" />
                <span>No reviews yet • Be the first to review</span>
              </button>
            )}
          </div>

          {/* Stock Availability Badge */}
          <div className="mt-2.5">
            {isOutOfStock || isMaxReached ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-950/40 px-3 py-1 text-xs font-bold text-rose-300 border border-rose-800/60">
                <ShieldAlert size={14} /> Out of Stock
              </span>
            ) : remainingStock <= 5 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-950/40 px-3 py-1 text-xs font-bold text-orange-400 border border-orange-500/40">
                <AlertTriangle size={14} className="text-orange-400 animate-pulse" />
                ⚡ Only {remainingStock} left in stock - Order soon!
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#132B45] px-3 py-1 text-xs font-bold text-[#42D6E8] border border-[#1E3252]">
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

        <div className="flex items-center justify-between border-t border-[#1E3252]/70 pt-4">
          <div>
            <div className="mb-1 flex items-end gap-3">
              <span className="text-[32px] font-extrabold leading-none text-white">
                ₹{product.price}
              </span>
              {isOnSale && (
                <>
                  <span className="mb-1.5 text-[16px] font-medium text-[#6E84A3] line-through">
                    ₹{product.regular_price}
                  </span>
                  <span className="mb-1.5 rounded-md bg-[#42D6E8] px-1.5 py-0.5 text-[11px] font-black text-[#061220]">
                    {discountPercent}% OFF
                  </span>
                </>
              )}
            </div>
            <p className="text-[11px] text-[#6E84A3]">(Inclusive of all taxes)</p>
          </div>

          {/* Desktop Add to Cart Button */}
          <div className="hidden lg:flex flex-col items-end">
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
                  className="flex h-[40px] px-8 items-center justify-center rounded-xl bg-[#0E1A2E] text-[14px] font-bold text-[#6E84A3] cursor-not-allowed border border-[#1E3252] select-none"
                >
                  Out of Stock
                </button>
              )
            ) : !cartItem ? (
              <HapticTapTarget radius="12px">
                <button
                  onClick={handleAddToCart}
                  disabled={loading}
                  className="flex h-[40px] px-8 items-center justify-center rounded-xl bg-[#42D6E8] text-[14px] font-black text-[#061220] shadow-[0_4px_16px_rgba(66,214,232,0.3)] transition-transform duration-100 ease-out hover:bg-[#2CC4D8] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:ring-2 focus-visible:ring-[#42D6E8]"
                >
                  ADD
                </button>
              </HapticTapTarget>
            ) : (
              <div className="flex flex-col items-end gap-1">
                <div className="flex h-[40px] w-[120px] items-center justify-between rounded-xl bg-[#42D6E8] px-1.5 text-[#061220] shadow-[0_4px_16px_rgba(66,214,232,0.3)]">
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

      {/* Service Cards Grid */}
      <div className="grid grid-cols-2 gap-2.5">
        <Link
          to="/return-policy"
          className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-[#1E3252]/80 bg-[#111F36] p-3.5 text-center shadow-[0_4px_12px_rgba(0,0,0,0.15)] transition-all hover:border-[#42D6E8]/60 hover:bg-[#162744] cursor-pointer group"
        >
          <PackageX size={24} className="text-[#42D6E8] transition-transform group-hover:scale-105" strokeWidth={1.75} />
          <span className="text-xs font-bold text-[#F1F5F9] group-hover:text-[#42D6E8] transition-colors">No Return or Exchange</span>
        </Link>
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-[#1E3252]/80 bg-[#111F36] p-3.5 text-center shadow-[0_4px_12px_rgba(0,0,0,0.15)] transition-all hover:border-[#42D6E8]/60 hover:bg-[#162744]">
          <Truck size={24} className="text-[#42D6E8]" strokeWidth={1.75} />
          <span className="text-xs font-bold text-[#F1F5F9]">Fast Local Delivery</span>
        </div>
      </div>

      {/* Ask on WhatsApp Support Section */}
      <ProductWhatsAppSupport product={product} />

      {/* Sticky Bottom Purchase Bar (Mobile & Split-Screen < lg) */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[100] w-full border-t border-[#1E3252] bg-[#0B1425]/95 backdrop-blur-md px-4 pt-3.5 shadow-[0_-8px_24px_rgba(0,0,0,0.5)] lg:hidden"
        style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom))", marginBottom: "0" }}
      >
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
          <div className="flex flex-col flex-shrink-0">
            <span className="mb-0.5 text-[22px] font-black leading-none tracking-tight text-white">
              ₹{product.price}
            </span>
            {isOutOfStock ? (
              <span className="text-[10px] font-bold text-rose-400">Out of stock</span>
            ) : isMaxReached ? (
              <span className="text-[10px] font-bold text-amber-400">All in cart</span>
            ) : remainingStock <= 5 ? (
              <span className="text-[10px] font-bold leading-none text-orange-400">
                ⚡ Only {remainingStock} left
              </span>
            ) : (
              <span className="text-[10px] font-medium leading-none text-[#42D6E8]">
                In stock
              </span>
            )}
          </div>

          <div className="flex w-[65%] gap-3 md:w-[45%] lg:w-[35%]">
            {isOutOfStock ? (
              cartItem ? (
                <HapticTapTarget className="flex w-full" radius="9999px">
                  <button
                    type="button"
                    onClick={() => handleUpdateQuantity(0)}
                    disabled={loading}
                    className="flex h-[46px] w-full items-center justify-center gap-2 rounded-full border border-rose-800/50 bg-rose-950/40 text-[14px] font-bold text-rose-300 transition-all hover:bg-rose-900/50 active:scale-[0.98] disabled:opacity-50 cursor-pointer shadow-xs"
                  >
                    Sold Out — Remove
                  </button>
                </HapticTapTarget>
              ) : (
                <button
                  type="button"
                  disabled
                  className="flex h-[46px] w-full items-center justify-center rounded-full bg-[#0E1A2E] text-[15px] font-bold text-[#6E84A3] cursor-not-allowed border border-[#1E3252] select-none"
                >
                  Out of Stock
                </button>
              )
            ) : !cartItem ? (
              <HapticTapTarget className="flex w-full" radius="9999px">
                <button
                  onClick={handleAddToCart}
                  disabled={loading}
                  className="flex h-[46px] w-full items-center justify-center gap-2 rounded-full bg-[#42D6E8] text-[15px] font-black text-[#061220] transition-transform duration-100 ease-out hover:bg-[#2CC4D8] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_4px_16px_rgba(66,214,232,0.3)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[#42D6E8]"
                >
                  Add to Cart
                </button>
              </HapticTapTarget>
            ) : (
              <div className="flex h-[46px] w-full items-center justify-between rounded-full bg-[#42D6E8] px-1.5 text-[#061220] shadow-sm">
                <HapticTapTarget radius="9999px">
                  <button
                    disabled={loading}
                    className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-black/15 transition-transform duration-100 ease-out hover:bg-black/25 active:scale-[0.92] cursor-pointer"
                    onClick={() => handleUpdateQuantity(cartItem.quantity - 1)}
                  >
                    <Minus size={18} />
                  </button>
                </HapticTapTarget>
                <span className="text-[16px] font-black">{cartItem.quantity}</span>
                <HapticTapTarget radius="9999px">
                  <button
                    disabled={loading || isMaxReached}
                    title={isMaxReached ? `Only ${maxStock} items available in stock` : "Add one more"}
                    className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-black/15 transition-transform duration-100 ease-out hover:bg-black/25 active:scale-[0.92] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    onClick={() => handleUpdateQuantity(cartItem.quantity + 1)}
                  >
                    <Plus size={18} />
                  </button>
                </HapticTapTarget>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default ProductInfo;
