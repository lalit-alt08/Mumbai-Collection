import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { Home, LayoutGrid, Package, ShoppingCart } from "lucide-react";
import { triggerHaptic } from "../../utils/haptics";
import HapticTapTarget from "../common/HapticTapTarget";
import { useCart } from "../../context/CartContext";

function BottomNav() {
  const location = useLocation();
  const path = location.pathname;
  const { cart } = useCart();

  const totalQuantity =
    cart?.items?.reduce(
      (total, item) => total + Number(item.quantity || 0),
      0
    ) || 0;

  // 1. Determine whether BottomNav should be completely hidden on specific dedicated-action pages
  const hideOnPages = [
    "/cart",
    "/checkout",
    "/order-success",
    "/order-failed",
    "/track-order",
    "/product",
    "/terms",
    "/return-policy",
    "/privacy-policy",
    "/shipping-policy",
  ];

  const isOrderTrackRoute = path.includes("/track");
  const shouldHideCompletely =
    isOrderTrackRoute || hideOnPages.some((p) => path.startsWith(p));

  // 2. Scroll-direction listener specifically for the Homepage (/)
  const isHomePage = path === "/";
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

          // Always show when near top of the page
          if (currentScrollY <= 25) {
            setIsVisible(true);
          } else if (delta > 8 && currentScrollY > 60) {
            // Scrolling down -> hide smoothly
            setIsVisible(false);
          } else if (delta < -8) {
            // Scrolling up -> show
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

  if (shouldHideCompletely) {
    return null;
  }

  // 3. Navigation items & active state detection
  const navItems = [
    {
      id: "home",
      label: "Home",
      to: "/",
      icon: Home,
      isActive: path === "/",
    },
    {
      id: "categories",
      label: "Categories",
      to: "/categories",
      icon: LayoutGrid,
      isActive: path.startsWith("/categor"),
    },
    {
      id: "cart",
      label: "Cart",
      to: "/cart",
      icon: ShoppingCart,
      isActive: path.startsWith("/cart"),
      badge: totalQuantity > 0 ? (totalQuantity > 99 ? "99+" : totalQuantity) : null,
    },
    {
      id: "orders",
      label: "Orders",
      to: "/orders",
      icon: Package,
      isActive: path.startsWith("/orders") || path.startsWith("/account/orders"),
    },
  ];

  return (
    <nav
      aria-label="Mobile Navigation"
      className={`fixed bottom-0 left-0 right-0 z-40 rounded-t-[24px] border-t border-[#E2E8F0] ${
        path === "/" ? "bg-[#FFFFFF]/95" : "bg-[#FFFFFF]/95"
      } backdrop-blur-md shadow-[0_-4px_20px_rgba(0,0,0,0.08)] transition-transform duration-300 ease-in-out lg:hidden ${
        isVisible ? "translate-y-0" : "translate-y-[120%]"
      }`}
      style={{
        paddingBottom: "max(8px, env(safe-area-inset-bottom, 8px))",
        touchAction: "manipulation",
      }}
    >
      <div className="mx-auto flex h-[58px] max-w-lg items-center justify-around px-2 select-none">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = item.isActive;

          return (
            <HapticTapTarget
              key={item.id}
              className="flex flex-1 self-stretch"
              enabled={!active}
            >
              <Link
                to={item.to}
                onClick={() => {
                  if (!active) {
                    triggerHaptic("selection");
                  }
                }}
                style={{ touchAction: "manipulation" }}
                className={`group flex flex-1 flex-col items-center justify-center py-1 transition-all duration-150 active:scale-95 select-none ${
                  active ? "text-[#22499F]" : "text-[#64748B] hover:text-[#22499F]"
                }`}
              >
                <div
                  className={`relative flex h-6 w-6 items-center justify-center transition-transform duration-200 ${
                    active ? "scale-105" : "group-hover:scale-105"
                  }`}
                >
                  <Icon
                    size={21}
                    strokeWidth={active ? 2.5 : 2.0}
                    className={`transition-colors shrink-0 ${
                      active ? "text-[#22499F] fill-[#22499F]/20" : "text-[#64748B]"
                    }`}
                  />
                  {item.badge && (
                    <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#F4B54B] px-1 text-[9px] font-black text-[#1E293B] shadow-sm ring-2 ring-[#FFFFFF]">
                      {item.badge}
                    </span>
                  )}
                </div>

                <span
                  className={`mt-1 text-[12px] tracking-tight leading-none text-center transition-colors ${
                    active ? "font-extrabold text-[#22499F]" : "font-semibold text-[#64748B]"
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            </HapticTapTarget>
          );
        })}
      </div>
    </nav>
  );
}

export default BottomNav;
