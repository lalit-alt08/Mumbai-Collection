import { useEffect } from "react";
import { Heart, ShoppingBag, ArrowLeft, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
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
    <div className="min-h-screen bg-[#0B1425] text-[#F1F5F9] px-4 pt-4 pb-28 sm:px-6 md:pt-6 md:pb-16">
      <div className="mx-auto max-w-7xl space-y-4 sm:space-y-6">
        {/* ────────────────────────────────────────────────────────── */}
        {/* COMPACT TOP BAR WITH BACK BUTTON                           */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 border-b border-[#1E3252]/80 pb-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label="Go Back"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[#111F36] text-[#F1F5F9] shadow-xs border border-[#1E3252] transition-all hover:border-[#42D6E8]/50 hover:bg-[#162744] hover:text-[#42D6E8] active:scale-95 cursor-pointer"
            >
              <ArrowLeft size={17} strokeWidth={2.4} />
            </button>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-[#F1F5F9] sm:text-2xl">
                My Wishlist
              </h1>
              <p className="text-xs font-semibold text-[#8FA4BE] mt-0.5">
                {favoriteTotal} saved item{favoriteTotal === 1 ? "" : "s"} ready for shopping
              </p>
            </div>
          </div>

          <button
            onClick={() => navigate("/")}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-[#1E3252] bg-[#111F36] px-4 py-2 text-xs font-extrabold text-[#67E8F9] shadow-xs transition-all hover:bg-[#42D6E8] hover:text-[#061220] cursor-pointer"
          >
            <span>Continue Shopping</span>
            <ArrowRight size={14} />
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
                className="h-72 rounded-[20px] bg-[#111F36] animate-pulse border border-[#1E3252]/60"
              />
            ))}
          </div>
        ) : favorites.length === 0 ? (
          /* Empty State */
          <div className="flex min-h-[45vh] flex-col items-center justify-center rounded-[22px] bg-[#111F36] p-8 text-center shadow-lg border border-[#1E3252]/80">
            <div className="mb-3.5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#132B45] text-pink-400 shadow-xs border border-[#1E3252]">
              <Heart size={30} className="fill-pink-400 text-pink-400" />
            </div>
            <h2 className="text-base sm:text-lg font-extrabold text-[#F1F5F9]">
              No saved favorites yet
            </h2>
            <p className="max-w-sm text-xs font-semibold text-[#8FA4BE] mt-1 mb-5">
              Tap the heart icon on any product in our store to save items you love for later.
            </p>
            <button
              onClick={() => navigate("/")}
              className="inline-flex items-center gap-2 rounded-full bg-[#42D6E8] px-7 py-2.5 text-xs sm:text-sm font-black text-[#061220] shadow-lg transition-all hover:bg-[#2CC4D8] active:scale-95 cursor-pointer"
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
                  className="rounded-full border border-[#42D6E8]/60 bg-[#111F36] px-6 py-2.5 text-sm font-extrabold text-[#67E8F9] transition hover:bg-[#162744] disabled:cursor-wait disabled:opacity-60"
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
