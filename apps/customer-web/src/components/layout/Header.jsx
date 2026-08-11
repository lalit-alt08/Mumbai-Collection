import SearchBar from "./SearchBar";
import DeliveryInfo from "./DeliveryInfo";
import Logo from "./Logo";

import { User, ShoppingCart } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";

function Header() {
  const { cart } = useCart();
  const { user } = useAuth();

  const totalQuantity =
    cart?.items?.reduce(
      (total, item) => total + Number(item.quantity || 0),
      0,
    ) || 0;

  return (
    <header className="sticky top-0 z-50 bg-white/95 shadow-[0_4px_30px_rgba(0,0,0,0.03)] backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 py-3 md:px-8 md:py-4">
        {/* ================= MOBILE ================= */}
        <div className="flex items-center justify-between md:hidden">
          <Logo />

          <div className="flex items-center gap-2">
            {/* ACCOUNT */}
            <Link
              to={user ? "/account" : "/login"}
              aria-label={user ? "Account" : "Login"}
              className="flex h-11 w-11 items-center justify-center rounded-full text-[#1E1E1E] transition hover:bg-gray-100"
            >
              <User size={24} strokeWidth={2} />
            </Link>

            {/* CART */}
            <Link
              to="/cart"
              aria-label="Cart"
              className="relative flex h-10 w-10 items-center justify-center rounded-full text-[#1E1E1E] transition hover:bg-gray-100"
            >
              <ShoppingCart size={23} strokeWidth={2} />

              {totalQuantity > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#3E8E2E] px-1 text-[11px] font-bold text-white">
                  {totalQuantity > 99 ? "99+" : totalQuantity}
                </span>
              )}
            </Link>
          </div>
        </div>

        {/* MOBILE SEARCH */}
        <div className="mt-3 md:hidden">
          <SearchBar />
        </div>

        {/* MOBILE DELIVERY */}
        <div className="mt-3 md:hidden">
          <DeliveryInfo />
        </div>

        {/* ================= DESKTOP ================= */}
        <div className="hidden md:flex md:items-center md:gap-6">
          {/* LOGO */}
          <Logo />

          {/* DELIVERY */}
          <DeliveryInfo />

          {/* SEARCH */}
          <div className="flex-1">
            <SearchBar />
          </div>

          {/* ACCOUNT + CART */}
          <div className="flex items-center">
            {/* ACCOUNT */}
            <Link
              to={user ? "/account" : "/login"}
              aria-label={user ? "Account" : "Login"}
              className="flex h-11 w-11 items-center justify-center rounded-full text-[#1E1E1E] transition hover:bg-gray-100"
            >
              <User size={24} strokeWidth={2} />
            </Link>

            {/* DIVIDER */}
            <div className="mx-3 h-7 w-px bg-[#E8E8E8]" />

            {/* CART */}
            <Link
              to="/cart"
              aria-label="Cart"
              className="relative flex h-11 w-11 items-center justify-center rounded-full text-[#1E1E1E] transition hover:bg-gray-100"
            >
              <ShoppingCart size={24} strokeWidth={2} />

              {totalQuantity > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#3E8E2E] px-1 text-[11px] font-bold text-white">
                  {totalQuantity > 99 ? "99+" : totalQuantity}
                </span>
              )}
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;
