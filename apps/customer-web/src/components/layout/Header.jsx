import SearchBar from "./SearchBar";
import { ShoppingCart, User } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";

function Header() {
  const { cart } = useCart();
  const { user } = useAuth();
  const location = useLocation();

  const isAuthPage = [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
  ].some((p) => location.pathname.startsWith(p));

  const totalQuantity =
    cart?.items?.reduce(
      (total, item) => total + Number(item.quantity || 0),
      0
    ) || 0;

  const isRecentlyViewedPage = location.pathname === "/recently-viewed";
  // Clean, razor-sharp, solid midnight surface with crisp high-contrast border
  const surfaceClasses = "bg-[#111F36] border border-[#263E63]";

  if (isAuthPage) {
    return null;
  }

  return (
    <header
      className="sticky top-[var(--network-banner-height,0px)] z-50 w-full px-3 pb-2 sm:px-4 sm:pt-5 sm:pb-2.5 md:px-8 md:pt-6 md:pb-3 transition-[top] duration-200"
      style={{
        paddingTop: "max(12px, calc(var(--safe-area-top, env(safe-area-inset-top, 0px)) + 8px))",
      }}
    >
      <div className="relative mx-auto max-w-7xl">
        {/* ================= SEARCH BAR & CONTROLS ROW ================= */}
        <div className={`relative flex items-center gap-2.5 sm:gap-3 md:gap-3.5 lg:gap-4 ${isRecentlyViewedPage ? "justify-end" : ""}`}>
          {!isRecentlyViewedPage && (
            <div className="flex-1 min-w-0">
              <SearchBar />
            </div>
          )}

        {/* ================= SHOPPING CART — SEPARATE CIRCULAR BUTTON OUTSIDE SEARCHBOX ================= */}
        {!isRecentlyViewedPage && (
          <Link
            to="/cart"
            aria-label="Cart"
            className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${surfaceClasses} text-[#42D6E8] shadow-[0_2px_8px_rgba(0,0,0,0.45)] transition-all hover:bg-[#162744] hover:border-[#42D6E8]/70 hover:shadow-[0_4px_16px_rgba(66,214,232,0.25)] active:scale-95 cursor-pointer`}
          >
            <ShoppingCart size={21} strokeWidth={2.1} />

            {totalQuantity > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-[#42D6E8] px-1 text-[9px] font-black text-[#061220] shadow-sm ring-2 ring-[#0B1425]">
                {totalQuantity > 99 ? "99+" : totalQuantity}
              </span>
            )}
          </Link>
        )}

        {/* ================= USER PROFILE BUTTON (Desktop Only) ================= */}
        <Link
          to={user ? "/account" : "/login"}
          aria-label={user ? "Account" : "Login"}
          className={`hidden md:flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${surfaceClasses} text-[#42D6E8] shadow-[0_2px_8px_rgba(0,0,0,0.45)] transition-all hover:bg-[#162744] hover:border-[#42D6E8]/70 hover:shadow-[0_4px_16px_rgba(66,214,232,0.25)] active:scale-95 cursor-pointer`}
        >
          <User size={19} strokeWidth={2.2} />
        </Link>
      </div>
      </div>
    </header>
  );
}

export default Header;
