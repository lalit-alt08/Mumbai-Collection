import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { Home, LayoutGrid, Package, User } from "lucide-react";

function BottomNav() {
  const location = useLocation();
  const path = location.pathname;

  // 1. Determine whether BottomNav should be completely hidden on specific dedicated-action pages
  const hideOnPages = [
    "/cart",
    "/checkout",
    "/order-success",
    "/order-failed",
    "/track-order",
    "/product",
  ];

  // Also hide on order tracking sub-routes like /orders/:id/track
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
      id: "orders",
      label: "Orders",
      to: "/orders",
      icon: Package,
      isActive: path.startsWith("/orders") || path.startsWith("/account/orders"),
    },
    {
      id: "profile",
      label: "Profile",
      to: "/account",
      icon: User,
      isActive:
        (path.startsWith("/account") ||
          path.startsWith("/profile") ||
          path.startsWith("/login") ||
          path.startsWith("/register")) &&
        !path.startsWith("/account/orders"),
    },
  ];

  return (
    <nav
      aria-label="Mobile Navigation"
      className={`fixed bottom-0 left-0 right-0 z-40 rounded-t-[24px] border-t border-gray-200/70 bg-white/95 backdrop-blur-md shadow-[0_-4px_25px_rgba(0,0,0,0.05)] transition-transform duration-300 ease-in-out lg:hidden ${
        isVisible ? "translate-y-0" : "translate-y-[120%]"
      }`}
      style={{
        paddingBottom: "max(8px, env(safe-area-inset-bottom, 8px))",
      }}
    >
      <div className="mx-auto flex h-14 max-w-lg items-center justify-around px-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = item.isActive;

          return (
            <Link
              key={item.id}
              to={item.to}
              className={`group flex flex-1 flex-col items-center justify-center gap-1 py-1 transition-all duration-150 active:scale-95 ${
                active ? "text-[#7C3AED]" : "text-[#6B7280] hover:text-[#7C3AED]"
              }`}
            >
              <div
                className={`relative flex items-center justify-center transition-transform duration-200 ${
                  active ? "scale-105" : "group-hover:scale-105"
                }`}
              >
                <Icon
                  size={20}
                  strokeWidth={active ? 2.5 : 1.8}
                  className={`transition-colors ${
                    active ? "text-[#7C3AED] fill-[#7C3AED]/15" : "text-[#6B7280]"
                  }`}
                />
              </div>

              <span
                className={`text-[11px] tracking-tight transition-colors ${
                  active ? "font-bold text-[#7C3AED]" : "font-medium text-[#6B7280]"
                }`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default BottomNav;
