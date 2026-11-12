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
    <div className="store-product-card flex h-full flex-col justify-between rounded-[18px] sm:rounded-[20px] border border-[#E2E8F0]/80 bg-[#FFFFFF] p-3 sm:p-3.5 shadow-[0_2px_12px_rgba(0,0,0,0.06)] transition-all duration-300 hover:-translate-y-[3px] hover:border-[#22499F]/60 hover:shadow-[0_8px_24px_rgba(34,73,159,0.12)]">
      <div
        onClick={() => navigate(`/product/${product.id}`)}
        className="cursor-pointer flex flex-col"
      >
        {/* Fixed Aspect Image Viewport */}
        <div className="store-product-image relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[14px] sm:rounded-[16px] p-2 bg-[#F8FAF6] border border-[#E2E8F0]">
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
            <div className="absolute top-1.5 left-1.5 z-10 rounded-md bg-[#F4B54B] px-1.5 sm:px-2 py-0.5 text-xs font-black text-[#1E293B] shadow-xs">
              {discountPercent}% OFF
            </div>
          )}

          {/* Heart Favorite Button */}
          <button
            onClick={handleToggleFav}
            aria-label={favorited ? "Remove from wishlist" : "Add to wishlist"}
            className="absolute top-1.5 right-1.5 z-10 flex h-7.5 w-7.5 sm:h-8 sm:w-8 items-center justify-center rounded-full bg-[#FFFFFF]/90 text-[#64748B] shadow-xs border border-[#E2E8F0] backdrop-blur-xs transition-all hover:scale-110 active:scale-125 cursor-pointer"
          >
            <Heart
              size={15}
              className={`transition-colors ${
                favorited
                  ? "fill-[#F4B54B] text-[#F4B54B]"
                  : "text-gray-400 hover:text-[#22499F]"
              }`}
            />
          </button>

          {isOutOfStock && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-[14px] sm:rounded-[16px]">
              <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-[11px] sm:text-xs font-bold text-white shadow-sm">
                Out of Stock
              </span>
            </div>
          )}
        </div>

        {/* Product Title with Locked 2-Line Height */}
        <h2 className="mt-2.5 line-clamp-2 min-h-[40px] sm:min-h-[44px] h-[40px] sm:h-[44px] text-[14px] sm:text-[15px] font-semibold leading-snug text-[#1E293B] group-hover:text-[#22499F] transition-colors">
          {cleanProductTitle(product.name)}
        </h2>
      </div>

      {/* Bottom Sticky Action Area */}
      <div className="mt-auto pt-1.5 flex flex-col gap-1">
        {/* Low Stock Indicator with Locked Height */}
        <div className="min-h-[18px] flex items-center">
          {cartError ? (
            <span role="alert" className="line-clamp-2 text-xs font-medium text-rose-400 leading-tight">
              {cartError}
            </span>
          ) : isOutOfStock || isMaxReached ? (
            <span className="text-xs font-semibold text-amber-400 leading-tight">
              Out of stock
            </span>
          ) : remainingStock <= 5 && remainingStock > 0 ? (
            <span className="text-xs font-semibold text-orange-400 leading-tight">
              ⚡ Only {remainingStock} left
            </span>
          ) : null}
        </div>

        {/* Pricing & Add to Cart Action Row */}
        <div className="flex items-center justify-between gap-1 h-[36px] sm:h-[38px]">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="text-[16px] sm:text-[18px] font-extrabold text-[#1E293B]">
              ₹{currentPrice}
            </span>
            {isOnSale && (
              <span className="text-[11.5px] sm:text-xs text-[#64748B] line-through font-medium truncate">
                ₹{regularPrice}
              </span>
            )}
          </div>

          <div className="flex items-center justify-end flex-shrink-0">
            {isOutOfStock ? (
              cartItem ? (
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
                    aria-label={`Remove sold out ${product.name} from cart`}
                    className="sold-out-remove h-[32px] sm:h-[34px] rounded-full border border-rose-400/40 bg-rose-950/40 px-2 sm:px-2.5 text-xs font-semibold text-rose-400 transition-all hover:bg-rose-900/60 active:scale-95 cursor-pointer flex items-center gap-1 shadow-xs"
                  >
                    Sold Out <span className="text-xs font-black leading-none">✕</span>
                  </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="h-[32px] sm:h-[34px] min-w-[60px] sm:min-w-[66px] rounded-full border border-[#E2E8F0] bg-[#FFFFFF] px-2.5 sm:px-3 text-xs sm:text-[13px] font-semibold text-[#64748B] cursor-not-allowed select-none"
                >
                  Sold Out
                </button>
              )
            ) : !cartItem ? (
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
                  className="h-[32px] sm:h-[34px] min-w-[64px] sm:min-w-[70px] rounded-full border border-[#22499F] bg-[#22499F] px-2.5 sm:px-3 text-xs sm:text-[13px] font-extrabold tracking-wide text-white transition-all duration-200 hover:bg-[#1B3B82] hover:shadow-[0_4px_14px_rgba(34,73,159,0.35)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-xs"
                >
                  ADD
                </button>
            ) : (
              <div className="flex h-[32px] sm:h-[34px] items-center rounded-full bg-[#22499F] text-[#FFFFFF] shadow-[0_4px_14px_rgba(66,214,232,0.3)]">
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
                    className="flex h-full w-7 sm:w-8 items-center justify-center rounded-l-full transition-colors hover:bg-[#1B3B82] disabled:opacity-50 cursor-pointer text-sm font-black text-[#FFFFFF]"
                  >
                    −
                  </button>

                <span className="flex w-4 sm:w-5 items-center justify-center text-[13px] sm:text-sm font-extrabold text-[#FFFFFF]">
                  {cartItem.quantity}
                </span>

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
                    className="flex h-full w-6 sm:w-7 items-center justify-center rounded-r-full transition-colors hover:bg-[#1B3B82] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-sm font-black text-[#FFFFFF]"
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
