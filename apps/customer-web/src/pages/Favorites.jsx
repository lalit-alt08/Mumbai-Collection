import { Heart, ShoppingBag, ArrowLeft, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useFavorites } from "../context/FavoritesContext";
import ProductCard from "../components/product/ProductCard";

function Favorites() {
  const navigate = useNavigate();
  const { favorites, loading } = useFavorites();

  return (
    <div className="min-h-screen bg-[#F8F9FD] text-[#111827] px-4 pt-4 pb-28 sm:px-6 md:pt-6 md:pb-16">
      <div className="mx-auto max-w-7xl space-y-4 sm:space-y-6">
        {/* ────────────────────────────────────────────────────────── */}
        {/* COMPACT TOP BAR WITH BACK BUTTON                           */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 border-b border-gray-200/80 pb-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label="Go Back"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#1F2937] shadow-xs border border-gray-200 transition-all hover:border-[#7C3AED]/40 hover:bg-[#F5F3FF] hover:text-[#7C3AED] active:scale-95 cursor-pointer"
            >
              <ArrowLeft size={17} strokeWidth={2.4} />
            </button>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-[#111827] sm:text-2xl">
                My Wishlist
              </h1>
              <p className="text-xs font-semibold text-[#4B5563] mt-0.5">
                {favorites.length} saved item{favorites.length === 1 ? "" : "s"} ready for shopping
              </p>
            </div>
          </div>

          <button
            onClick={() => navigate("/")}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-extrabold text-[#7C3AED] shadow-xs transition-all hover:border-[#7C3AED]/40 hover:bg-[#F5F3FF] cursor-pointer"
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
                className="h-72 rounded-[20px] bg-gray-100 animate-pulse border border-gray-200"
              />
            ))}
          </div>
        ) : favorites.length === 0 ? (
          /* Empty State */
          <div className="flex min-h-[45vh] flex-col items-center justify-center rounded-[22px] bg-white p-8 text-center shadow-[0_4px_24px_rgba(0,0,0,0.02)] border border-gray-200/90">
            <div className="mb-3.5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#EDE9FE] text-[#7C3AED] shadow-xs">
              <Heart size={30} className="fill-[#7C3AED]" />
            </div>
            <h2 className="text-base sm:text-lg font-extrabold text-[#111827]">
              No saved favorites yet
            </h2>
            <p className="max-w-sm text-xs font-semibold text-[#4B5563] mt-1 mb-5">
              Tap the heart icon on any product in our store to save items you love for later.
            </p>
            <button
              onClick={() => navigate("/")}
              className="inline-flex items-center gap-2 rounded-full bg-[#7C3AED] px-7 py-2.5 text-xs sm:text-sm font-extrabold text-white shadow-[0_4px_16px_rgba(124,58,237,0.25)] transition-all hover:bg-[#6C35E8] active:scale-95 cursor-pointer"
            >
              <ShoppingBag size={16} />
              <span>Start Shopping</span>
            </button>
          </div>
        ) : (
          /* Favorites Grid */
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {favorites.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Favorites;
