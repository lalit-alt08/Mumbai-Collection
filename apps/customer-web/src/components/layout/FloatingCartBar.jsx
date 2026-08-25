import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useCart } from "../../context/CartContext";

function FloatingCartBar() {
  const { cart } = useCart();
  const location = useLocation();
  const path = location.pathname;

  const isHomePage = path === "/";
  const isProductPage = path.startsWith("/product");

  // 1. Scroll-direction listener strictly for the Homepage (/)
  // All React hooks MUST be called unconditionally at the top level of the component!
  const [isVisible, setIsVisible] = useState(true);
  const lastScrollYRef = useRef(0);
  const tickingRef = useRef(false);

  useEffect(() => {
    if (!isHomePage) {
      setIsVisible(true);
      return;
    }

    lastScrollYRef.current = window.scrollY;

    const handleScroll = () => {
      if (!tickingRef.current) {
        window.requestAnimationFrame(() => {
          const currentScrollY = window.scrollY;
          const prevScrollY = lastScrollYRef.current;
          const delta = currentScrollY - prevScrollY;

          // Always show when near top of the homepage
          if (currentScrollY <= 25) {
            setIsVisible(true);
          } else if (delta > 8 && currentScrollY > 60) {
            // Scrolling down -> smoothly translate down / hide
            setIsVisible(false);
          } else if (delta < -8) {
            // Scrolling up -> smoothly bring back into view
            setIsVisible(true);
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
  }, [isHomePage]);

  // 2. Hide on checkout, cart, success, error, tracking, account, setup, support, and wishlist pages
  const hideOnPages = [
    "/cart",
    "/checkout",
    "/order-success",
    "/order-failed",
    "/track-order",
    "/orders",
    "/profile-setup",
    "/account",
    "/profile",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/contact",
    "/support",
    "/favorites",
  ];

  const hasItems = cart && cart.items && cart.items.length > 0;
  const totalItems = hasItems
    ? cart.items.reduce((total, item) => total + (Number(item.quantity) || 0), 0)
    : 0;

  if (hideOnPages.some((p) => path.startsWith(p)) || !hasItems || totalItems === 0) {
    return null;
  }

  const totalPrice =
    hasItems && cart.totals ? Number(cart.totals.total_price) / 100 : 0;
  const firstItemImage = hasItems ? cart.items[0]?.images?.[0]?.src : null;

  // Responsive bottom positioning:
  // On product pages below 'lg' (1024px), the fixed bottom purchase bar is visible at bottom-0 (~76px + safe-area).
  // On other pages below 'lg' (1024px), the BottomNav is visible at bottom-0 (~60px + safe-area).
  // So FloatingCartBar floats cleanly above them on mobile/tablet, and at bottom-8 on desktop.
  const bottomPositionClass = isProductPage
    ? "bottom-[calc(84px+env(safe-area-inset-bottom,0px))] md:bottom-8"
    : "bottom-[calc(76px+env(safe-area-inset-bottom,0px))] md:bottom-8";

  // Translate transformation based on scroll state:
  // On Mobile: smoothly shifts down slightly when scrolling down.
  // On Desktop: stays securely floating slightly above the bottom at md:bottom-8 with zero downward drift (md:translate-y-0).
  const visibilityClass = isHomePage
    ? isVisible
      ? "translate-y-0 opacity-100"
      : "translate-y-10 sm:translate-y-12 md:translate-y-0 opacity-100"
    : "translate-y-0 opacity-100";

  return (
    <aside
      aria-label="Floating cart summary"
      className={`fixed left-1/2 z-50 w-[92%] max-w-[360px] -translate-x-1/2 transition-all duration-300 ease-in-out ${bottomPositionClass} ${visibilityClass}`}
    >
      <Link
        to="/cart"
        className="flex w-full items-center justify-between overflow-hidden rounded-full bg-[#7C3AED] p-2 pr-4 shadow-[0_12px_40px_rgba(124,58,237,0.35)] transition-all hover:scale-[1.02] hover:bg-[#6C35E8] active:scale-[0.98]"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-white p-1">
            {firstItemImage ? (
              <img
                src={firstItemImage}
                alt=""
                className="h-full w-full rounded-full object-contain"
              />
            ) : (
              <div className="h-full w-full rounded-full bg-gray-100" />
            )}
          </div>
          <div className="flex flex-col text-white">
            <span className="text-[11px] font-medium text-purple-100 leading-tight">
              {totalItems} item{totalItems > 1 ? "s" : ""}
            </span>
            <span className="text-[14px] font-bold leading-tight">₹{totalPrice}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 font-bold text-white text-[13px]">
          <span>View Cart</span>
          <ChevronRight size={16} strokeWidth={2.5} />
        </div>
      </Link>
    </aside>
  );
}

export default FloatingCartBar;
