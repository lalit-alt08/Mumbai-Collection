import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useCart } from "../../context/CartContext";

function FloatingCartBar() {
  const { cart } = useCart();
  const location = useLocation();

  // Hide everywhere except Home page
  if (location.pathname !== "/") {
    return null;
  }

  const hasItems = cart && cart.items && cart.items.length > 0;
  const totalItems = hasItems
    ? cart.items.reduce((total, item) => total + item.quantity, 0)
    : 0;
  const totalPrice =
    hasItems && cart.totals ? Number(cart.totals.total_price) / 100 : 0;
  const firstItemImage = hasItems ? cart.items[0]?.images?.[0]?.src : null;

  return (
    <div
      className={`fixed left-1/2 z-50 w-[90%] max-w-[340px] -translate-x-1/2 transition-all duration-300 ${
        hasItems ? "bottom-10 opacity-100 md:bottom-12" : "-bottom-24 opacity-0 pointer-events-none"
      }`}
    >
      <Link
        to="/cart"
        className="flex w-full items-center justify-between overflow-hidden rounded-full bg-[#3E8E2E] p-1.5 pr-3 shadow-[0_12px_40px_rgba(62,142,46,0.25)] transition-transform hover:scale-[1.02]"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-white p-1">
            {firstItemImage ? (
              <img
                src={firstItemImage}
                alt="Cart Item"
                className="h-full w-full rounded-full object-contain"
              />
            ) : (
              <div className="h-full w-full rounded-full bg-gray-100" />
            )}
          </div>
          <div className="flex flex-col text-white">
            <span className="text-[11px] font-medium text-green-100">
              {totalItems} item{totalItems > 1 ? "s" : ""}
            </span>
            <span className="text-[14px] font-bold">₹{totalPrice}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 font-semibold text-white">
          <span className="text-[14px]">View Cart</span>
          <ChevronRight size={18} />
        </div>
      </Link>
    </div>
  );
}

export default FloatingCartBar;
