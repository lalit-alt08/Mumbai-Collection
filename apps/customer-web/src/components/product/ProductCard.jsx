import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { Heart } from "lucide-react";
import {
  addToCart as addToWooCart,
  updateCartItem,
  removeCartItem,
} from "../../services/storeApi";
import { useCart } from "../../context/CartContext";
import { useFavorites } from "../../context/FavoritesContext";

function ProductCard({ product }) {
  const navigate = useNavigate();
  const { cart, refreshCart } = useCart();
  const { isFavorited, toggleFavorite } = useFavorites();
  const [updatingCart, setUpdatingCart] = useState(false);

  const favorited = isFavorited(product?.id);

  const cartItem = cart?.items?.find(
    (item) => Number(item.id) === Number(product.id)
  );

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

  // Dynamic Discount Calculation
  const regularPrice = Number(product.regular_price || product.price || 0);
  const currentPrice = Number(product.price || product.sale_price || 0);
  const isOnSale = Boolean(
    regularPrice > currentPrice &&
    currentPrice > 0 &&
    regularPrice > 0
  );
  const discountPercent = isOnSale
    ? Math.round(((regularPrice - currentPrice) / regularPrice) * 100)
    : 0;

  const handleToggleFav = async (e) => {
    e.stopPropagation();
    const res = await toggleFavorite(product);
    if (res?.requiresAuth) {
      navigate("/login");
    }
  };

  return (
    <div className="flex h-full flex-col justify-between rounded-[18px] sm:rounded-[20px] border border-gray-200/90 bg-white p-2.5 sm:p-3.5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] transition-all duration-300 hover:-translate-y-[3px] hover:shadow-[0_10px_30px_rgba(124,58,237,0.07)]">
      <div
        onClick={() => navigate(`/product/${product.id}`)}
        className="cursor-pointer flex flex-col"
      >
        {/* Fixed Aspect Image Viewport */}
        <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[12px] sm:rounded-[14px] p-1.5 bg-[#FAFBFD]">
          <img
            src={product.images?.[0]?.src}
            alt={product.name}
            className="h-full w-full object-contain transition-transform duration-300 hover:scale-105"
            loading="lazy"
          />

          {/* Discount Badge */}
          {isOnSale && discountPercent > 0 && (
            <div className="absolute top-1.5 left-1.5 z-10 rounded-md bg-[#7C3AED] px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] font-black text-white shadow-xs">
              {discountPercent}% OFF
            </div>
          )}

          {/* Heart Favorite Button */}
          <button
            onClick={handleToggleFav}
            aria-label={favorited ? "Remove from wishlist" : "Add to wishlist"}
            className="absolute top-1.5 right-1.5 z-10 flex h-7 w-7 sm:h-7.5 sm:w-7.5 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow-xs backdrop-blur-xs transition-all hover:scale-110 active:scale-125 cursor-pointer"
          >
            <Heart
              size={14}
              className={`transition-colors ${
                favorited
                  ? "fill-[#7C3AED] text-[#7C3AED]"
                  : "text-gray-400 hover:text-[#7C3AED]"
              }`}
            />
          </button>

          {isOutOfStock && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-[12px] sm:rounded-[14px]">
              <span className="rounded-full bg-red-600 px-2 py-0.5 text-[9px] sm:text-[10px] font-bold text-white shadow-sm">
                Out of Stock
              </span>
            </div>
          )}
        </div>

        {/* Product Title with Locked 2-Line Height */}
        <h2 className="mt-2 line-clamp-2 h-[34px] sm:h-[38px] text-[12px] sm:text-[13px] font-bold leading-tight text-[#111827]">
          {product.name}
        </h2>
      </div>

      {/* Bottom Sticky Action Area */}
      <div className="mt-auto pt-1.5 flex flex-col gap-1">
        {/* Low Stock Indicator with Locked Height */}
        <div className="h-[14px] flex items-center">
          {maxStock <= 5 && maxStock > 0 ? (
            <span className="text-[9px] sm:text-[10px] font-bold text-amber-700 leading-none">
              ⚡ Only {maxStock} left
            </span>
          ) : null}
        </div>

        {/* Pricing & Add to Cart Action Row */}
        <div className="flex items-center justify-between gap-1 h-[34px]">
          <div className="flex items-baseline gap-1 min-w-0">
            <span className="text-[15px] sm:text-[17px] font-extrabold text-[#111827]">
              ₹{currentPrice}
            </span>
            {isOnSale && (
              <span className="text-[10px] text-gray-400 line-through font-medium truncate">
                ₹{regularPrice}
              </span>
            )}
          </div>

          <div className="flex items-center justify-end flex-shrink-0">
            {!cartItem ? (
              <button
                disabled={updatingCart || isOutOfStock}
                onClick={async () => {
                  if (updatingCart || isOutOfStock) return;
                  try {
                    setUpdatingCart(true);
                    await addToWooCart(product.id);
                    await refreshCart();
                  } catch (error) {
                    console.error(error);
                  } finally {
                    setUpdatingCart(false);
                  }
                }}
                className="h-[30px] sm:h-[32px] min-w-[58px] sm:min-w-[64px] rounded-full border border-[#7C3AED] bg-white px-2.5 sm:px-3 text-xs font-bold text-[#7C3AED] transition-all duration-200 hover:bg-[#7C3AED] hover:text-white hover:shadow-[0_4px_14px_rgba(124,58,237,0.2)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isOutOfStock ? "Sold Out" : "ADD"}
              </button>
            ) : (
              <div className="flex h-[30px] sm:h-[32px] items-center rounded-full bg-[#7C3AED] text-white shadow-[0_4px_14px_rgba(124,58,237,0.2)]">
                <button
                  onClick={async () => {
                    if (updatingCart) return;
                    try {
                      setUpdatingCart(true);
                      if (cartItem.quantity <= 1) {
                        await removeCartItem(cartItem.key);
                      } else {
                        await updateCartItem(cartItem.key, cartItem.quantity - 1);
                      }
                      await refreshCart();
                    } catch (error) {
                      console.error(error);
                    } finally {
                      setUpdatingCart(false);
                    }
                  }}
                  disabled={updatingCart}
                  className="flex h-full w-6 sm:w-7 items-center justify-center rounded-l-full transition-colors hover:bg-[#6C35E8] disabled:opacity-50 cursor-pointer text-xs font-bold"
                >
                  −
                </button>

                <span className="flex w-4 sm:w-5 items-center justify-center text-xs font-extrabold">
                  {cartItem.quantity}
                </span>

                <button
                  onClick={async () => {
                    if (updatingCart || isMaxReached) return;
                    try {
                      setUpdatingCart(true);
                      await updateCartItem(cartItem.key, cartItem.quantity + 1);
                      await refreshCart();
                    } catch (error) {
                      console.error(error);
                    } finally {
                      setUpdatingCart(false);
                    }
                  }}
                  disabled={updatingCart || isMaxReached}
                  title={isMaxReached ? `Only ${maxStock} units in stock` : "Add one more"}
                  className="flex h-full w-6 sm:w-7 items-center justify-center rounded-r-full transition-colors hover:bg-[#6C35E8] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-xs font-bold"
                >
                  +
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProductCard;
