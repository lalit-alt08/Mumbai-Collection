import SearchBar from "./SearchBar";
import { User, ArrowLeft } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { triggerHaptic } from "../../utils/haptics";
import HapticTapTarget from "../common/HapticTapTarget";
import { useState, useEffect } from "react";
import CategoryIconBar from "../home/CategoryIconBar";
import { getCachedCategories, getCategoriesSWR } from "../../services/productService";

function Header() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const isAuthPage = [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
  ].some((p) => location.pathname.startsWith(p));

  const isRecentlyViewedPage = location.pathname === "/recently-viewed";
  const isHomePage = location.pathname === "/";
  const isSearchPage = location.pathname.startsWith("/search");

  const [categories, setCategories] = useState(() => getCachedCategories() || []);

  useEffect(() => {
    if (isHomePage) {
      const cached = getCategoriesSWR((fresh) => {
        if (Array.isArray(fresh) && fresh.length > 0) setCategories(fresh);
      });
      if (Array.isArray(cached) && cached.length > 0) {
        setCategories(cached);
      }
    }
  }, [isHomePage]);

  // Seamlessly mix the page color all the way to the top status bar with no visible border
  const headerBgClass = isHomePage
    ? "bg-gradient-to-b from-[#F0F8E8] via-[#F0F8E8] to-[#F0F8E8]"
    : "bg-[#F0F8E8]";

  // Clean, razor-sharp, solid surface with crisp border
  const surfaceClasses = "bg-[#FFFFFF] border border-[#E2E8F0] shadow-xs";

  if (isAuthPage) {
    return null;
  }

  return (
    <header
      id="storefront-header"
      className={`sticky top-[var(--network-banner-height,0px)] z-50 w-full ${headerBgClass} px-3 pb-2 sm:px-4 sm:pt-5 sm:pb-2.5 md:px-8 md:pt-6 md:pb-3 transition-[top,padding,box-shadow] duration-200`}
      style={{
        paddingTop: "max(12px, calc(var(--safe-area-top, env(safe-area-inset-top, 0px)) + 8px))",
      }}
    >
      <div className="relative mx-auto max-w-7xl">
        {/* ================= SEARCH BAR & CONTROLS ROW ================= */}
        <div className={`relative flex items-center gap-2.5 sm:gap-3 md:gap-3.5 lg:gap-4 ${isRecentlyViewedPage ? "justify-end" : ""}`}>
          {/* ================= CIRCULAR BACK BUTTON (Search page) ================= */}
          {isSearchPage && (
            <HapticTapTarget className="h-11 w-11 shrink-0" radius="9999px">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("light");
                  if (window.history.state && window.history.state.idx > 0) {
                    navigate(-1);
                  } else {
                    navigate("/");
                  }
                }}
                aria-label="Back"
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${surfaceClasses} text-[#1E293B] shadow-xs transition-all hover:bg-[#F0F8E8] hover:text-[#22499F] hover:border-[#22499F]/70 active:scale-95 cursor-pointer`}
              >
                <ArrowLeft size={20} strokeWidth={2.2} />
              </button>
            </HapticTapTarget>
          )}

          {!isRecentlyViewedPage && (
            <div className="flex-1 min-w-0">
              <SearchBar />
            </div>
          )}

          {/* ================= USER PROFILE — SEPARATE CIRCULAR BUTTON OUTSIDE SEARCHBOX ================= */}
          {!isRecentlyViewedPage && (
            <HapticTapTarget className="h-11 w-11 shrink-0" radius="9999px">
              <Link
                to={user ? "/account" : "/login"}
                onClick={() => triggerHaptic("light")}
                aria-label={user ? "Profile" : "Sign In"}
                className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${surfaceClasses} text-[#22499F] shadow-xs transition-all hover:bg-[#F0F8E8] hover:border-[#22499F]/70 active:scale-95 cursor-pointer`}
              >
                <User size={20} strokeWidth={2.2} />
              </Link>
            </HapticTapTarget>
          )}
        </div>

        {/* ================= CATEGORY BAR UNDER SEARCH ON HOMEPAGE (Always visible & sticks on scroll) ================= */}
        {isHomePage && (
          <div className="mt-1.5 pt-0.5">
            <CategoryIconBar categories={categories} />
          </div>
        )}
      </div>
    </header>
  );
}

export default Header;
