import { useEffect } from "react";
import { Heart, ShoppingBag, ArrowLeft,
  ChevronLeft, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { triggerHaptic } from '../utils/haptics';
import { useFavorites } from "../context/FavoritesContext";
import ProductCard from "../components/product/ProductCard";
import { useLiveProductStock } from "../hooks/useLiveProductStock";

function Favorites() {
  const navigate = useNavigate();
  const {
    favorites,
    loading,
    loadingMore,
    favoritePage,
    favoriteTotalPages,
    favoriteTotal,
    updateLoadedFavorites,
    loadFullFavorites,
    loadMoreFavorites,
  } = useFavorites();
  useLiveProductStock(favorites.slice(-24), updateLoadedFavorites);

  useEffect(() => {
    if (typeof loadFullFavorites === "function") {
      loadFullFavorites();
    }
  }, [loadFullFavorites]);

  return (
    <div className="min-h-screen bg-[#F0F8E8] text-[#1E293B] px-4 pt-4 pb-28 sm:px-6 md:pt-6 md:pb-16">
      <div className="mx-auto max-w-7xl space-y-4 sm:space-y-6">
        {/* TOP BAR / NAVIGATION (Pill Design) */}
        <div className="mb-4 sm:mb-6 flex items-center justify-between gap-2.5 sm:gap-3">
          {/* Left: Circular Back Button */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic("light");
              navigate(-1);
            }}
            aria-label="Go Back"
            className="flex h-12 w-12 sm:h-[52px] sm:w-[52px] shrink-0 items-center justify-center rounded-full bg-[#FFFFFF]/90 backdrop-blur-md text-[#1E293B] border border-[#E2E8F0] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.06)] transition-all hover:bg-[#FFFFFF] hover:border-[#22499F]/40 hover:text-[#22499F] active:scale-95 cursor-pointer"
          >
            <ChevronLeft size={23} strokeWidth={2.5} />
          </button>

          {/* Center: Capsule utilizing available space with clear typography */}
          <div className="flex-1 min-w-0 flex items-center justify-center rounded-full bg-[#FFFFFF]/95 backdrop-blur-md border border-[#E2E8F0] px-5 sm:px-7 py-2.5 sm:py-3 min-h-[48px] sm:min-h-[52px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.12),0_2px_10px_rgba(0,0,0,0.06)]">
            <h1 className="text-[19px] sm:text-[20px] font-extrabold text-[#1E293B] tracking-[-0.01em] leading-normal antialiased select-none">
              My Wishlist
            </h1>
          </div>

          {/* Right: Continue Shopping Button */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic("light");
              navigate("/");
            }}
            aria-label="Continue Shopping"
            className="flex h-12 sm:h-[52px] shrink-0 items-center justify-center rounded-full bg-[#22499F] px-4.5 sm:px-5.5 text-xs sm:text-sm font-extrabold text-[#FFFFFF] shadow-[0_2px_10px_rgba(34,73,159,0.3)] transition-all hover:bg-[#1B3B82] active:scale-95 cursor-pointer whitespace-nowrap"
          >
            <span>Shop More</span>
          </button>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* MAIN CONTENT / PRODUCTS GRID                               */}
        {/* ────────────────────────────────────────────────────────── */}
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="h-72 rounded-[20px] bg-[#FFFFFF] animate-pulse border border-[#E2E8F0]/60"
              />
            ))}
          </div>
        ) : favorites.length === 0 ? (
          /* Empty State */
          <div className="flex min-h-[45vh] flex-col items-center justify-center rounded-[22px] bg-[#FFFFFF] p-8 text-center shadow-lg border border-[#E2E8F0]/80">
            <div className="mb-3.5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#FFFFFF] text-pink-400 shadow-xs border border-[#E2E8F0]">
              <Heart size={30} className="fill-pink-400 text-pink-400" />
            </div>
            <h2 className="text-base sm:text-lg font-extrabold text-[#1E293B]">
              No saved favorites yet
            </h2>
            <p className="max-w-sm text-xs font-semibold text-[#64748B] mt-1 mb-5">
              Tap the heart icon on any product in our store to save items you love for later.
            </p>
            <button
              onClick={() => navigate("/")}
              className="inline-flex items-center gap-2 rounded-full bg-[#22499F] px-7 py-2.5 text-xs sm:text-sm font-black text-[#FFFFFF] shadow-lg transition-all hover:bg-[#1B3B82] active:scale-95 cursor-pointer"
            >
              <ShoppingBag size={16} />
              <span>Start Shopping</span>
            </button>
          </div>
        ) : (
          /* Favorites Grid */
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
              {favorites.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
            {favoritePage < favoriteTotalPages && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={loadMoreFavorites}
                  disabled={loadingMore}
                  className="rounded-full border border-[#22499F]/60 bg-[#FFFFFF] px-6 py-2.5 text-sm font-extrabold text-[#22499F] transition hover:bg-[#FFFFFF] disabled:cursor-wait disabled:opacity-60"
                >
                  {loadingMore ? "Loading…" : "Load more favorites"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default Favorites;
