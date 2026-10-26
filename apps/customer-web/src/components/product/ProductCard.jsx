import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { getLiveProductStockByIds } from "../../services/productService";
import { Heart } from "lucide-react";
import {
  addToCart as addToWooCart,
  updateCartItem,
  removeCartItem,
} from "../../services/storeApi";
import { useCart } from "../../context/CartContext";
import { triggerHaptic } from "../../utils/haptics";
import HapticTapTarget from "../common/HapticTapTarget";
import { useFavorites } from "../../context/FavoritesContext";
import { getCatalogImageUrl, PRODUCT_PLACEHOLDER_URL } from "../../utils/imageUtils";
import {
  cleanProductTitle,
  getCartFailureMessage,
  parseCartStockError,
  getProductStock,
  getRemainingStock,
} from "../../utils/productUtils";

function ProductCard({ product }) {
  const navigate = useNavigate();
  const { cart, refreshCart, updateCart } = useCart();
  const { isFavorited, toggleFavorite } = useFavorites();
  const [updatingCart, setUpdatingCart] = useState(false);
  const [stockOverride, setStockOverride] = useState(null);
  const [cartError, setCartError] = useState("");

  useEffect(() => {
    setStockOverride(null);
  }, [product?.id, product?.manage_stock, product?.stock_quantity, product?.stock_status]);

  const primaryImage = product?.images?.[0];
  const cardImageUrl = getCatalogImageUrl(primaryImage);
  const cardImageAlt = primaryImage?.alt || primaryImage?.name || product?.name || "Product image";

  const favorited = isFavorited(product?.id);

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
    <div className="flex h-full flex-col justify-between rounded-[18px] sm:rounded-[20px] border border-[#1E3252]/80 bg-[#111F36] p-2.5 sm:p-3.5 shadow-[0_4px_20px_rgba(0,0,0,0.3)] transition-all duration-300 hover:-translate-y-[3px] hover:border-[#42D6E8]/60 hover:shadow-[0_10px_30px_rgba(66,214,232,0.15)]">
      <div
        onClick={() => navigate(`/product/${product.id}`)}
        className="cursor-pointer flex flex-col"
      >
        {/* Fixed Aspect Image Viewport */}
        <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[12px] sm:rounded-[14px] p-1.5 bg-[#080F1C] border border-[#1E3252]">
          <img
            src={cardImageUrl}
            alt={cardImageAlt}
            width="300"
            height="300"
            className="h-full w-full object-contain transition-transform duration-300 hover:scale-105"
            loading="lazy"
            decoding="async"
            onError={(e) => {
              if (e.currentTarget.getAttribute("data-fallback") !== "true") {
                e.currentTarget.setAttribute("data-fallback", "true");
                e.currentTarget.src = PRODUCT_PLACEHOLDER_URL;
              }
            }}
          />

          {/* Discount Badge */}
          {isOnSale && discountPercent > 0 && (
            <div className="absolute top-1.5 left-1.5 z-10 rounded-md bg-[#42D6E8] px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] font-black text-[#061220] shadow-xs">
              {discountPercent}% OFF
            </div>
          )}

          {/* Heart Favorite Button */}
          <button
            onClick={handleToggleFav}
            aria-label={favorited ? "Remove from wishlist" : "Add to wishlist"}
            className="absolute top-1.5 right-1.5 z-10 flex h-7 w-7 sm:h-7.5 sm:w-7.5 items-center justify-center rounded-full bg-[#111F36]/90 text-white shadow-xs border border-[#1E3252] backdrop-blur-xs transition-all hover:scale-110 active:scale-125 cursor-pointer"
          >
            <Heart
              size={14}
              className={`transition-colors ${
                favorited
                  ? "fill-[#42D6E8] text-[#42D6E8]"
                  : "text-gray-400 hover:text-[#42D6E8]"
              }`}
            />
          </button>

          {isOutOfStock && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-[12px] sm:rounded-[14px]">
              <span className="rounded-full bg-red-600 px-2 py-0.5 text-[9px] sm:text-[10px] font-bold text-white shadow-sm">
                Out of Stock
              </span>
            </div>
          )}
        </div>

        {/* Product Title with Locked 2-Line Height */}
        <h2 className="mt-2 line-clamp-2 h-[34px] sm:h-[38px] text-[12px] sm:text-[13px] font-bold leading-tight text-white group-hover:text-[#42D6E8] transition-colors">
          {cleanProductTitle(product.name)}
        </h2>
      </div>

      {/* Bottom Sticky Action Area */}
      <div className="mt-auto pt-1.5 flex flex-col gap-1">
        {/* Low Stock Indicator with Locked Height */}
        <div className="min-h-[14px] flex items-center">
          {cartError ? (
            <span role="alert" className="line-clamp-2 text-[10px] font-semibold text-rose-400 leading-tight">
              {cartError}
            </span>
          ) : isOutOfStock || isMaxReached ? (
            <span className="text-[9px] sm:text-[10px] font-bold text-amber-400 leading-none">
              Out of stock
            </span>
          ) : remainingStock <= 5 && remainingStock > 0 ? (
            <span className="text-[9px] sm:text-[10px] font-bold text-orange-400 leading-none">
              ⚡ Only {remainingStock} left
            </span>
          ) : null}
        </div>

        {/* Pricing & Add to Cart Action Row */}
        <div className="flex items-center justify-between gap-1 h-[34px]">
          <div className="flex items-baseline gap-1 min-w-0">
            <span className="text-[15px] sm:text-[17px] font-extrabold text-white">
              ₹{currentPrice}
            </span>
            {isOnSale && (
              <span className="text-[10px] text-[#6E84A3] line-through font-medium truncate">
                ₹{regularPrice}
              </span>
            )}
          </div>

          <div className="flex items-center justify-end flex-shrink-0">
            {isOutOfStock ? (
              cartItem ? (
                <HapticTapTarget radius="9999px">
                  <button
                    type="button"
                    disabled={updatingCart}
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (updatingCart) return;
                      try {
                        setUpdatingCart(true);
                        const updatedCart = await removeCartItem(cartItem.key);
                        if (updatedCart) {
                          triggerHaptic("light");
                          updateCart(updatedCart);
                        }
                      } catch (error) {
                        setCartError(getCartFailureMessage(error));
                        await refreshStock();
                        await refreshCart().catch(() => {});
                      } finally {
                        setUpdatingCart(false);
                      }
                    }}
                    title="Item is sold out. Tap to remove from cart."
                    className="h-[30px] sm:h-[32px] rounded-full border border-rose-400/40 bg-rose-950/40 px-2 sm:px-2.5 text-[11px] font-bold text-rose-400 transition-all hover:bg-rose-900/60 active:scale-95 cursor-pointer flex items-center gap-1 shadow-xs"
                  >
                    Sold Out <span className="text-[11px] font-black leading-none">✕</span>
                  </button>
                </HapticTapTarget>
              ) : (
                <button
                  type="button"
                  disabled
                  className="h-[30px] sm:h-[32px] min-w-[58px] sm:min-w-[64px] rounded-full border border-[#1E3252] bg-[#0E1A2E] px-2.5 sm:px-3 text-xs font-bold text-[#6E84A3] cursor-not-allowed select-none"
                >
                  Sold Out
                </button>
              )
            ) : !cartItem ? (
              <HapticTapTarget radius="9999px">
                <button
                  disabled={updatingCart}
                  onClick={async () => {
                    if (updatingCart) return;
                    setCartError("");
                    try {
                      setUpdatingCart(true);
                      const updatedCart = await addToWooCart(product.id);
                      if (updatedCart) {
                        triggerHaptic("medium");
                        updateCart(updatedCart);
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
                      setUpdatingCart(false);
                    }
                  }}
                  className="h-[30px] sm:h-[32px] min-w-[58px] sm:min-w-[64px] rounded-full border border-[#42D6E8] bg-[#111F36] px-2.5 sm:px-3 text-xs font-bold text-[#42D6E8] transition-all duration-200 hover:bg-[#42D6E8] hover:text-[#061220] hover:shadow-[0_4px_14px_rgba(66,214,232,0.3)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  ADD
                </button>
              </HapticTapTarget>
            ) : (
              <div className="flex h-[30px] sm:h-[32px] items-center rounded-full bg-[#42D6E8] text-[#061220] shadow-[0_4px_14px_rgba(66,214,232,0.3)]">
                <HapticTapTarget className="h-full" radius="9999px">
                  <button
                    onClick={async () => {
                      if (updatingCart) return;
                      try {
                        setUpdatingCart(true);
                        let updatedCart;
                        if (cartItem.quantity <= 1) {
                          updatedCart = await removeCartItem(cartItem.key);
                        } else {
                          updatedCart = await updateCartItem(cartItem.key, cartItem.quantity - 1);
                        }
                        if (updatedCart) {
                          triggerHaptic("light");
                          updateCart(updatedCart);
                        }
                      } catch (error) {
                        setCartError(getCartFailureMessage(error));
                        await refreshStock();
                        await refreshCart().catch(() => {});
                      } finally {
                        setUpdatingCart(false);
                      }
                    }}
                    disabled={updatingCart}
                    className="flex h-full w-6 sm:w-7 items-center justify-center rounded-l-full transition-colors hover:bg-[#2CC4D8] disabled:opacity-50 cursor-pointer text-xs font-bold text-[#061220]"
                  >
                    −
                  </button>
                </HapticTapTarget>

                <span className="flex w-4 sm:w-5 items-center justify-center text-xs font-extrabold text-[#061220]">
                  {cartItem.quantity}
                </span>

                <HapticTapTarget className="h-full" radius="9999px">
                  <button
                    onClick={async () => {
                      if (updatingCart || isMaxReached) return;
                      try {
                        setUpdatingCart(true);
                        const updatedCart = await updateCartItem(cartItem.key, cartItem.quantity + 1);
                        if (updatedCart) {
                          triggerHaptic("light");
                          updateCart(updatedCart);
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
                        await refreshCart().catch(() => {});
                      } finally {
                        setUpdatingCart(false);
                      }
                    }}
                    disabled={updatingCart || isMaxReached || isOutOfStock}
                    title={isOutOfStock || isMaxReached ? "Out of stock" : `Only ${remainingStock} more available`}
                    className="flex h-full w-6 sm:w-7 items-center justify-center rounded-r-full transition-colors hover:bg-[#2CC4D8] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-xs font-bold text-[#061220]"
                  >
                    +
                  </button>
                </HapticTapTarget>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProductCard;
