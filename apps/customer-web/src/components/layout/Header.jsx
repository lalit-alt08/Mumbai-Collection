import SearchBar from "./SearchBar";
import { User, ArrowLeft } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { triggerHaptic } from "../../utils/haptics";
import HapticTapTarget from "../common/HapticTapTarget";
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import CategoryIconBar from "../home/CategoryIconBar";
import { getCachedCategories, getCategoriesSWR } from "../../services/productService";
import { useStorefrontTheme } from "../../utils/storefrontTheme.js";

function Header() {
  const { user } = useAuth();
  const theme = useStorefrontTheme();
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
  const [isInputFocused, setIsInputFocused] = useState(false);
  const searchAreaRef = useRef(null);
  const [searchAreaHeight, setSearchAreaHeight] = useState(0);

  // Focus detection: keep search bar visible strictly when an input is actively focused
  useEffect(() => {
    const handleFocusIn = (e) => {
      const target = e.target;
      if (
        target &&
        (target.tagName === "INPUT" || target.getAttribute("role") === "searchbox")
      ) {
        setIsInputFocused(true);
      }
    };
    const handleFocusOut = (e) => {
      const target = e.target;
      if (
        target &&
        (target.tagName === "INPUT" || target.getAttribute("role") === "searchbox")
      ) {
        setIsInputFocused(false);
      }
    };

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, []);

  // Preserve the header's layout height while its search area scrolls above the
  // viewport. Resizing the header at a scroll threshold can trigger browser
  // scroll anchoring and repeatedly cross that same threshold on iOS.
  useLayoutEffect(() => {
    const searchArea = searchAreaRef.current;
    if (!isHomePage || !searchArea) return;

    const measure = () => setSearchAreaHeight(searchArea.getBoundingClientRect().height);
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(searchArea);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [isHomePage]);

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
      className={`sticky z-50 w-full ${headerBgClass} px-3 sm:px-4 md:px-8 pb-2 sm:pb-2.5 md:pb-3`}
      style={{
        top: isHomePage && !isInputFocused
          ? `calc(var(--network-banner-height, 0px) - ${searchAreaHeight}px)`
          : "var(--network-banner-height, 0px)",
        paddingTop: "max(8px, calc(var(--safe-area-top, env(safe-area-inset-top, 0px)) + 4px))",
      }}
    >
      <div className="relative mx-auto max-w-7xl">
        {/* Search keeps its layout space so scrolling cannot move its own threshold. */}
        <div ref={searchAreaRef} className="grid relative z-20">
          <div className="min-h-0 overflow-visible">
            {/* ================= CENTERED BRAND LOGO ABOVE SEARCH BAR ================= */}
            {!isSearchPage && !isRecentlyViewedPage && (
              <div className="mb-2 sm:mb-2.5 flex items-center justify-center">
                <Link
                  to="/"
                  onClick={() => triggerHaptic("light")}
                  aria-label="Mumbai Collection Home"
                  className="inline-flex max-w-[82%] items-center justify-center shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22499F]/50 rounded-lg"
                >
                  <img
                    src={theme === "dark" ? "/logo-dark.png" : "/logo-light.png"}
                    alt="Mumbai Collection"
                    width={912}
                    height={182}
                    fetchPriority="high"
                    decoding="async"
                    className="h-11 sm:h-12 md:h-14 w-auto max-w-full object-contain select-none"
                  />
                </Link>
              </div>
            )}

            {/* ================= SEARCH BAR & CONTROLS ROW ================= */}
            <div
              className={`relative flex items-center gap-2.5 pb-1 sm:gap-3 md:gap-3.5 lg:gap-4 ${
                isRecentlyViewedPage ? "justify-end" : ""
              }`}
            >
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
          </div>
        </div>

        {/* ================= CATEGORY BAR UNDER SEARCH ON HOMEPAGE (Always visible & sticks on scroll) ================= */}
        {isHomePage && (
          <div className="mt-1 pt-0.5 relative z-10">
            <CategoryIconBar categories={categories} />
          </div>
        )}
      </div>
    </header>
  );
}

export default Header;
