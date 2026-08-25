import SearchBar from "./SearchBar";
import Logo from "./Logo";
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

  return (
    <header className="sticky top-0 z-50 w-full bg-white rounded-b-[18px] sm:rounded-b-[22px] border-b border-[#EDE9FE] shadow-[0_2px_14px_rgba(124,58,237,0.03)]">
      <div className="mx-auto max-w-7xl px-3 py-1.5 sm:px-4 sm:py-2 md:px-8 md:py-2.5">
        {/* ================= MOBILE VIEW (< md) ================= */}
        <div className="flex flex-col gap-1.5 md:hidden">
          {/* Mobile Top Row: Centered Tightly-Cropped Logo */}
          <div className="flex w-full items-center justify-center py-1">
            <Logo className="h-14 xs:h-16 sm:h-18 w-auto max-w-[360px] sm:max-w-[420px]" />
          </div>

          {/* Mobile Second Row: Search Bar + Cart beside it (Hidden on auth pages like Login) */}
          {!isAuthPage && (
            <div className="flex w-full items-center gap-2">
              <div className="flex-1 min-w-0">
                <SearchBar />
              </div>

              {/* Shopping Cart Icon with Badge */}
              <Link
                to="/cart"
                aria-label="Cart"
                className="relative flex h-[40px] w-[36px] shrink-0 items-center justify-center text-[#111D35] transition-colors hover:text-[#8B5CF6] active:scale-95"
              >
                <ShoppingCart size={22} strokeWidth={2.1} />

                {totalQuantity > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#7C3AED] px-1 text-[8.5px] font-black text-white shadow-xs ring-2 ring-white">
                    {totalQuantity > 99 ? "99+" : totalQuantity}
                  </span>
                )}
              </Link>
            </div>
          )}
        </div>

        {/* ================= DESKTOP & TABLET VIEW (>= md) ================= */}
        <div
          className={`hidden md:flex md:items-center ${
            isAuthPage ? "justify-center" : "md:gap-3.5 lg:gap-5"
          } w-full`}
        >
          {/* 1. LOGO — CENTERED IN ITS SPACE & ENLARGED */}
          <div className="flex items-center justify-center shrink-0 min-w-[210px] lg:min-w-[250px] px-2">
            <Logo className="h-13 md:h-14 lg:h-[58px] xl:h-[62px] w-auto max-w-[260px]" />
          </div>

          {!isAuthPage && (
            <>
              {/* 2. VERTICAL DIVIDER */}
              <div className="h-8 lg:h-9 w-[1.5px] bg-[#E2E8F0] shrink-0 rounded-full" />

              {/* 3. SEARCH BAR — MAIN FOCUS */}
              <div className="flex-1 min-w-0">
                <SearchBar />
              </div>

              {/* 4. VERTICAL DIVIDER */}
              <div className="h-7 lg:h-8 w-[1.5px] bg-[#E2E8F0] shrink-0 rounded-full" />

              {/* 5. SHOPPING CART + NOTIFICATION BADGE */}
              <Link
                to="/cart"
                aria-label="Cart"
                className="relative flex items-center justify-center p-1 text-[#111D35] transition-colors hover:text-[#8B5CF6] active:scale-95 shrink-0"
              >
                <ShoppingCart size={23} strokeWidth={2.1} />

                {totalQuantity > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-[#7C3AED] text-[9px] font-black text-white shadow-sm ring-2 ring-white">
                    {totalQuantity > 99 ? "99+" : totalQuantity}
                  </span>
                )}
              </Link>

              {/* 6. VERTICAL DIVIDER */}
              <div className="h-7 lg:h-8 w-[1.5px] bg-[#E2E8F0] shrink-0 rounded-full" />

              {/* 7. USER PROFILE BUTTON (Desktop Only) */}
              <Link
                to={user ? "/account" : "/login"}
                aria-label={user ? "Account" : "Login"}
                className="flex h-9 w-9 md:h-10 md:w-10 shrink-0 items-center justify-center rounded-[12px] md:rounded-[14px] border-2 border-[#DDD6FE] bg-white text-[#8B5CF6] shadow-xs transition-all hover:bg-[#FAF8FF] hover:border-[#8B5CF6] hover:shadow-[0_4px_14px_rgba(139,92,246,0.12)] active:scale-95"
              >
                <User size={19} strokeWidth={2.2} />
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export default Header;
