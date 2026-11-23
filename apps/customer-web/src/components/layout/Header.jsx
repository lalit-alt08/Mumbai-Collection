import SearchBar from "./SearchBar";
import { User, ArrowLeft } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { triggerHaptic } from "../../utils/haptics";
import HapticTapTarget from "../common/HapticTapTarget";
import { useState, useEffect, useRef } from "react";
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
  const [isSearchVisible, setIsSearchVisible] = useState(true);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const lastScrollYRef = useRef(0);
  const tickingRef = useRef(false);

  // Focus detection: keep search bar visible strictly when an input is actively focused
  useEffect(() => {
    const handleFocusIn = (e) => {
      const target = e.target;
      if (
        target &&
        (target.tagName === "INPUT" || target.getAttribute("role") === "searchbox")
      ) {
        setIsInputFocused(true);
        setIsSearchVisible(true);
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

  // Scroll listener for Homepage: search stays visible only when at the top of the page
  useEffect(() => {
    if (!isHomePage) {
      setIsSearchVisible(true);
      return;
    }

    const handleScroll = () => {
      if (isInputFocused) {
        setIsSearchVisible(true);
        return;
      }

      if (!tickingRef.current) {
        window.requestAnimationFrame(() => {
          const currentScrollY = window.scrollY;

          // Only show when reaching near the top of the homepage (<= 60px)
          if (currentScrollY <= 60) {
            setIsSearchVisible(true);
          } else {
            // Scrolled down -> stay cleanly collapsed without jitter
            setIsSearchVisible(false);
          }

          lastScrollYRef.current = Math.max(0, currentScrollY);
          tickingRef.current = false;
        });
        tickingRef.current = true;
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [isHomePage, isInputFocused]);

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

  const showSearchRow = !isHomePage || isSearchVisible || isInputFocused;

  return (
    <header
      id="storefront-header"
      className={`sticky top-[var(--network-banner-height,0px)] z-50 w-full ${headerBgClass} px-3 sm:px-4 md:px-8 transition-[top,padding,box-shadow] duration-300 ${
        showSearchRow ? "pb-2 sm:pt-5 sm:pb-2.5 md:pt-6 md:pb-3" : "pb-1 sm:pb-1.5"
      }`}
      style={{
        paddingTop: "max(8px, calc(var(--safe-area-top, env(safe-area-inset-top, 0px)) + 4px))",
      }}
    >
      <div className="relative mx-auto max-w-7xl">
        {/* ================= COLLAPSIBLE TOP AREA (LOGO + SEARCH ROW VIA CSS GRID) ================= */}
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
            isHomePage
              ? showSearchRow
                ? "grid-rows-[1fr] opacity-100"
                : "grid-rows-[0fr] opacity-0 pointer-events-none"
              : "grid-rows-[1fr] opacity-100"
          }`}
        >
          <div className="overflow-hidden min-h-0">
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
          <div className="mt-1 pt-0.5">
            <CategoryIconBar categories={categories} />
          </div>
        )}
      </div>
    </header>
  );
}

export default Header;
