import SearchBar from "./SearchBar";
import { User, ArrowLeft } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { triggerHaptic } from "../../utils/haptics";
import HapticTapTarget from "../common/HapticTapTarget";

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
  // Seamlessly mix the page color all the way to the top status bar with no visible border
  const headerBgClass = isHomePage
    ? "bg-gradient-to-b from-[#1B3459] via-[#162A48] to-[#132238]"
    : "bg-[#0B1425]";

  // Clean, razor-sharp, solid midnight surface with crisp high-contrast border
  const surfaceClasses = "bg-[#111F36] border border-[#263E63]";

  if (isAuthPage) {
    return null;
  }

  return (
    <header
      className={`sticky top-[var(--network-banner-height,0px)] z-50 w-full ${headerBgClass} px-3 pb-2.5 sm:px-4 sm:pt-5 sm:pb-3 md:px-8 md:pt-6 md:pb-3.5 transition-[top] duration-200`}
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
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${surfaceClasses} text-[#F1F5F9] shadow-[0_2px_8px_rgba(0,0,0,0.45)] transition-all hover:bg-[#162744] hover:text-[#42D6E8] hover:border-[#42D6E8]/70 active:scale-95 cursor-pointer`}
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
              className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${surfaceClasses} text-[#42D6E8] shadow-[0_2px_8px_rgba(0,0,0,0.45)] transition-all hover:bg-[#162744] hover:border-[#42D6E8]/70 hover:shadow-[0_4px_16px_rgba(66,214,232,0.25)] active:scale-95 cursor-pointer`}
            >
              <User size={20} strokeWidth={2.2} />
            </Link>
          </HapticTapTarget>
        )}


      </div>
      </div>
    </header>
  );
}

export default Header;
