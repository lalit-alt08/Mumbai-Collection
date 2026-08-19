import { useNavigate } from "react-router-dom";
import {
  addToCart as addToWooCart,
  updateCartItem,
  removeCartItem,
} from "../../services/storeApi";
import { useCart } from "../../context/CartContext";
import { Minus, Plus, ChevronRight, Truck, PackageX, AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { useState } from "react";

function ProductInfo({ product }) {
  const navigate = useNavigate();
  const { cart, refreshCart } = useCart();
  const [loading, setLoading] = useState(false);

  const cartItem = cart?.items?.find(
    (item) => Number(item.id) === Number(product.id)
  );

  // Accurate stock limit calculation
  const maxStock =
    product.manage_stock && product.stock_quantity !== null
      ? Number(product.stock_quantity)
      : product.stock_status === "outofstock"
      ? 0
      : 99;

  const currentQuantity = cartItem?.quantity || 0;
  const isOutOfStock =
    product.stock_status === "outofstock" ||
    (product.manage_stock && product.stock_quantity !== null && product.stock_quantity <= 0);

  const isMaxReached = currentQuantity >= maxStock && maxStock > 0;

  const handleAddToCart = async () => {
    if (isOutOfStock || isMaxReached) return;
    try {
      setLoading(true);
      await addToWooCart(product.id);
      await refreshCart();
    } catch (error) {
      console.error("Add to cart error:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateQuantity = async (newQuantity) => {
    if (loading) return;

    // Strict client-side stock limit check
    if (newQuantity > maxStock) {
      return;
    }

    try {
      setLoading(true);
      if (newQuantity <= 0) {
        await removeCartItem(cartItem.key);
      } else {
        await updateCartItem(cartItem.key, newQuantity);
      }
    } catch (error) {
      console.log("Cart updated with server state:", error.response?.data || error.message);
    } finally {
      await refreshCart().catch(() => {});
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
      <div className="rounded-[24px] bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.04)] md:p-6 space-y-4">
        <div>
          <h1 className="text-[22px] font-bold leading-snug text-[#1F2937] md:text-[26px]">
            {product.name}
          </h1>

          {/* Stock Availability Badge */}
          <div className="mt-2.5">
            {isOutOfStock ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700 border border-rose-200">
                <ShieldAlert size={14} /> Out of Stock
              </span>
            ) : maxStock <= 5 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800 border border-amber-200">
                <AlertTriangle size={14} className="text-amber-600 animate-pulse" />
                ⚡ Only {maxStock} left in stock - Order soon!
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 border border-emerald-200">
                <CheckCircle2 size={14} /> In Stock ({maxStock} available in Vasai shop)
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 pt-4">
          <div>
            <div className="mb-1 flex items-end gap-3">
              <span className="text-[32px] font-extrabold leading-none text-[#1F2937]">
                ₹{product.price}
              </span>
              {isOnSale && (
                <>
                  <span className="mb-1.5 text-[16px] font-medium text-[#6B7280] line-through">
                    ₹{product.regular_price}
                  </span>
                  <span className="mb-1.5 rounded-md bg-[#FF8A00] px-1.5 py-0.5 text-[11px] font-bold text-white">
                    {discountPercent}% OFF
                  </span>
                </>
              )}
            </div>
            <p className="text-[11px] text-[#6B7280]">(Inclusive of all taxes)</p>
          </div>

          {/* Desktop Add to Cart Button */}
          <div className="hidden lg:flex flex-col items-end">
            {!cartItem ? (
              <button
                onClick={handleAddToCart}
                disabled={loading || isOutOfStock}
                className="flex h-[40px] px-8 items-center justify-center rounded-xl bg-[#FF8A00] text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(255,138,0,0.2)] transition-all hover:bg-[#FF7300] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isOutOfStock ? "Out of Stock" : "ADD"}
              </button>
            ) : (
              <div className="flex flex-col items-end gap-1">
                <div className="flex h-[40px] w-[120px] items-center justify-between rounded-xl bg-[#FF8A00] px-1.5 text-white shadow-[0_4px_12px_rgba(255,138,0,0.2)]">
                  <button
                    disabled={loading}
                    className="flex h-[32px] w-[32px] items-center justify-center rounded-lg bg-white/20 transition hover:bg-white/30 disabled:opacity-50"
                    onClick={() => handleUpdateQuantity(cartItem.quantity - 1)}
                  >
                    <Minus size={16} />
                  </button>
                  <span className="text-[15px] font-bold">{cartItem.quantity}</span>
                  <button
                    disabled={loading || isMaxReached}
                    title={isMaxReached ? `Only ${maxStock} items available in stock` : "Add one more"}
                    className="flex h-[32px] w-[32px] items-center justify-center rounded-lg bg-white/20 transition hover:bg-white/30 disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={() => handleUpdateQuantity(cartItem.quantity + 1)}
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {isMaxReached && (
                  <span className="text-[10px] font-bold text-amber-700">
                    Max stock ({maxStock}) added
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Service Cards Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col items-center justify-center gap-3 rounded-[20px] border border-gray-100 bg-white p-5 text-center shadow-[0_4px_12px_rgba(0,0,0,0.03)] transition-colors hover:bg-gray-50">
          <PackageX size={32} className="text-[#FF8A00]" strokeWidth={1.5} />
          <span className="text-[13px] font-bold text-[#1F2937]">No Return or Exchange</span>
        </div>
        <div className="flex flex-col items-center justify-center gap-3 rounded-[20px] border border-gray-100 bg-white p-5 text-center shadow-[0_4px_12px_rgba(0,0,0,0.03)] transition-colors hover:bg-gray-50">
          <Truck size={32} className="text-[#FF8A00]" strokeWidth={1.5} />
          <span className="text-[13px] font-bold text-[#1F2937]">Fast Local Delivery</span>
        </div>
      </div>

      {/* Floating View Cart Pill (Mobile only when items exist) */}
      {cart?.items?.length > 0 && (
        <div
          className="fixed left-1/2 z-[110] flex w-max -translate-x-1/2 items-center justify-between gap-6 rounded-full bg-[#FF8A00] p-1.5 pl-2 pr-1.5 shadow-[0_12px_40px_rgba(255,138,0,0.3)] animate-[fadeIn_0.3s_ease-out] md:hidden"
          style={{ bottom: "calc(96px + env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-white p-1">
              <img src={cart.items[0].images?.[0]?.src} alt="" className="h-full w-full object-contain" />
            </div>
            <div className="flex flex-col pr-2">
              <span className="text-[12px] font-bold text-white leading-none">View Cart</span>
              <span className="text-[10px] font-medium text-white/90 mt-0.5">
                {cart.items_count} item{cart.items_count > 1 ? "s" : ""}
              </span>
            </div>
          </div>
          <button
            onClick={() => navigate("/cart")}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white text-[#FF8A00] transition-transform hover:scale-105"
          >
            <ChevronRight size={18} strokeWidth={3} />
          </button>
        </div>
      )}

      {/* Sticky Bottom Purchase Bar (Mobile) */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[100] w-full border-t border-gray-200 bg-white px-4 pt-3.5 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] lg:hidden"
        style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom))", marginBottom: "0" }}
      >
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
          <div className="flex flex-col flex-shrink-0">
            <span className="mb-0.5 text-[22px] font-black leading-none tracking-tight text-[#1F2937]">
              ₹{product.price}
            </span>
            {isMaxReached ? (
              <span className="text-[10px] font-bold text-amber-700">Max stock ({maxStock})</span>
            ) : (
              <span className="text-[10px] font-medium leading-none text-[#FF8A00]">
                {maxStock <= 5 ? `Only ${maxStock} left` : "In stock"}
              </span>
            )}
          </div>

          <div className="flex w-[65%] gap-3 md:w-[45%] lg:w-[35%]">
            {!cartItem ? (
              <button
                onClick={handleAddToCart}
                disabled={loading || isOutOfStock}
                className="flex h-[46px] w-full items-center justify-center gap-2 rounded-full bg-[#FF8A00] text-[15px] font-bold text-white transition-all hover:bg-[#FF7300] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isOutOfStock ? "Out of Stock" : "Add to Cart"}
              </button>
            ) : (
              <div className="flex h-[46px] w-full items-center justify-between rounded-full bg-[#FF8A00] px-1.5 text-white shadow-sm">
                <button
                  disabled={loading}
                  className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-white/20 transition hover:bg-white/30"
                  onClick={() => handleUpdateQuantity(cartItem.quantity - 1)}
                >
                  <Minus size={18} />
                </button>
                <span className="text-[16px] font-bold">{cartItem.quantity}</span>
                <button
                  disabled={loading || isMaxReached}
                  title={isMaxReached ? `Only ${maxStock} items available in stock` : "Add one more"}
                  className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-white/20 transition hover:bg-white/30 disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={() => handleUpdateQuantity(cartItem.quantity + 1)}
                >
                  <Plus size={18} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes fadeIn {
          from { opacity: 0; transform: translate(-50%, 10px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `,
        }}
      />
    </>
  );
}

export default ProductInfo;