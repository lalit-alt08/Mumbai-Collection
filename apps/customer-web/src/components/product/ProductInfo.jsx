import { useNavigate } from "react-router-dom";
import {
  addToCart as addToWooCart,
  updateCartItem,
  removeCartItem,
} from "../../services/storeApi";
import { useCart } from "../../context/CartContext";
import { ShoppingCart, Minus, Plus, ChevronRight, Truck, PackageX } from "lucide-react";
import { useState } from "react";

function ProductInfo({ product }) {
  const navigate = useNavigate();
  const { cart, refreshCart } = useCart();
  const [loading, setLoading] = useState(false);

  const cartItem = cart?.items?.find(
    (item) => Number(item.id) === Number(product.id)
  );

  const handleAddToCart = async () => {
    try {
      setLoading(true);
      await addToWooCart(product.id);
      await refreshCart();
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateQuantity = async (newQuantity) => {
    try {
      setLoading(true);
      if (newQuantity === 0) {
        await removeCartItem(cartItem.key);
      } else {
        await updateCartItem(cartItem.key, newQuantity);
      }
      await refreshCart();
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const categoryName = product.categories?.[0]?.name;
  const isOnSale = product.regular_price && product.price && product.regular_price !== product.price;
  const discountPercent = isOnSale 
    ? Math.round(((product.regular_price - product.price) / product.regular_price) * 100)
    : 0;

  const shortDesc = product.short_description || "";
  const weight = product.weight ? `${product.weight} kg` : null;
  const inStock = product.stock_status === "instock" || product.stock_quantity > 0;

  return (
    <>
      {/* 2. Main Product Info Card */}
      <div className="rounded-[24px] bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.04)] md:p-6">
        
        <h1 className="mb-4 text-[22px] font-bold leading-snug text-[#1F2937] md:text-[26px]">
          {product.name}
        </h1>

        <div className="flex items-center justify-between">
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
                  <span className="mb-1.5 rounded-md bg-[#3E8E2E] px-1.5 py-0.5 text-[11px] font-bold text-white">
                    {discountPercent}% OFF
                  </span>
                </>
              )}
            </div>
            <p className="text-[11px] text-[#6B7280]">(Inclusive of all taxes)</p>
          </div>

          {/* Desktop Add to Cart Button */}
          <div className="hidden lg:block w-[110px]">
            {!cartItem ? (
              <button
                onClick={handleAddToCart}
                disabled={loading || !inStock}
                className="flex h-[36px] w-full items-center justify-center rounded-xl bg-[#3E8E2E] text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(62,142,46,0.2)] transition-all hover:bg-[#2F7424] active:scale-[0.98] disabled:opacity-50"
              >
                ADD
              </button>
            ) : (
              <div className="flex h-[36px] w-full items-center justify-between rounded-xl bg-[#3E8E2E] px-1 text-white shadow-[0_4px_12px_rgba(62,142,46,0.2)]">
                <button
                  disabled={loading}
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-lg bg-white/20 transition hover:bg-white/30"
                  onClick={() => handleUpdateQuantity(cartItem.quantity - 1)}
                >
                  <Minus size={16} />
                </button>
                <span className="text-[14px] font-bold">{cartItem.quantity}</span>
                <button
                  disabled={loading}
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-lg bg-white/20 transition hover:bg-white/30"
                  onClick={() => handleUpdateQuantity(cartItem.quantity + 1)}
                >
                  <Plus size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4. Service Cards Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col items-center justify-center gap-3 rounded-[20px] border border-gray-100 bg-white p-5 text-center shadow-[0_4px_12px_rgba(0,0,0,0.03)] transition-colors hover:bg-gray-50">
          <PackageX size={32} className="text-[#3E8E2E]" strokeWidth={1.5} />
          <span className="text-[13px] font-bold text-[#1F2937]">No Return or Exchange</span>
        </div>
        <div className="flex flex-col items-center justify-center gap-3 rounded-[20px] border border-gray-100 bg-white p-5 text-center shadow-[0_4px_12px_rgba(0,0,0,0.03)] transition-colors hover:bg-gray-50">
          <Truck size={32} className="text-[#3E8E2E]" strokeWidth={1.5} />
          <span className="text-[13px] font-bold text-[#1F2937]">Fast Delivery</span>
        </div>
      </div>

      {/* Floating View Cart Pill (Mobile only when items exist) */}
      {cart?.items?.length > 0 && (
        <div className="fixed left-1/2 z-[110] flex w-max -translate-x-1/2 items-center justify-between gap-6 rounded-full bg-[#3E8E2E] p-1.5 pl-2 pr-1.5 shadow-[0_12px_40px_rgba(62,142,46,0.3)] animate-[fadeIn_0.3s_ease-out] md:hidden" style={{ bottom: 'calc(96px + env(safe-area-inset-bottom))' }}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-white p-1">
              <img src={cart.items[0].images?.[0]?.src} alt="" className="h-full w-full object-contain" />
            </div>
            <div className="flex flex-col pr-2">
              <span className="text-[12px] font-bold text-white leading-none">View Cart</span>
              <span className="text-[10px] font-medium text-white/90 mt-0.5">{cart.items_count} item{cart.items_count > 1 ? 's' : ''}</span>
            </div>
          </div>
          <button onClick={() => navigate("/cart")} className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white text-[#3E8E2E] transition-transform hover:scale-105">
            <ChevronRight size={18} strokeWidth={3} />
          </button>
        </div>
      )}

      {/* Sticky Bottom Purchase Bar */}
      <div 
        className="fixed bottom-0 left-0 right-0 z-[100] w-full border-t border-gray-200 bg-white px-4 pt-4 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] lg:hidden"
        style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom))', marginBottom: '0' }}
      >
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
          <div className="flex flex-col flex-shrink-0">
            <span className="mb-1 text-[24px] font-black leading-none tracking-tight text-[#1F2937]">₹{product.price}</span>
            <span className="text-[10px] font-medium leading-none text-[#3E8E2E]">Inclusive of all taxes</span>
          </div>
          <div className="flex w-[65%] gap-4 md:w-[45%] lg:w-[35%]">
            {!cartItem ? (
              <button
                onClick={handleAddToCart}
                disabled={loading || !inStock}
                className="flex h-[48px] w-full items-center justify-center gap-2 rounded-full bg-[#3E8E2E] text-[16px] font-bold text-white transition-all hover:bg-[#2F7424] active:scale-[0.98] disabled:opacity-50"
              >
                Add to Cart
              </button>
            ) : (
              <div className="flex h-[48px] w-full items-center justify-between rounded-full bg-[#3E8E2E] px-1.5 text-white">
                <button
                  disabled={loading}
                  className="flex h-[40px] w-[40px] items-center justify-center rounded-full bg-white/20 transition hover:bg-white/30"
                  onClick={() => handleUpdateQuantity(cartItem.quantity - 1)}
                >
                  <Minus size={20} />
                </button>
                <span className="text-[18px] font-bold">{cartItem.quantity}</span>
                <button
                  disabled={loading}
                  className="flex h-[40px] w-[40px] items-center justify-center rounded-full bg-white/20 transition hover:bg-white/30"
                  onClick={() => handleUpdateQuantity(cartItem.quantity + 1)}
                >
                  <Plus size={20} />
                </button>
              </div>
            )}
            <button
              onClick={() => navigate("/cart")}
              className="hidden h-[40px] w-full items-center justify-center rounded-full border border-[#3E8E2E] bg-white text-[14px] font-bold text-[#3E8E2E] transition-colors hover:bg-[#EEF7EA] md:flex"
            >
              Buy Now
            </button>
          </div>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fadeIn {
          from { opacity: 0; transform: translate(-50%, 10px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `}} />
    </>
  );
}

export default ProductInfo;