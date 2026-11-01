import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useCart } from "../../context/CartContext";
import { getCatalogImageUrl } from "../../utils/imageUtils";

function FloatingCartBar() {
  const { cart } = useCart();
  const location = useLocation();
  const path = location.pathname;

  const isHomePage = path === "/";
  const isProductPage = path.startsWith("/product");

  // 1. Scroll-direction listener strictly for the Homepage (/)
  // All React hooks MUST be called unconditionally at the top level of the component!
  const [isVisible, setIsVisible] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const lastScrollYRef = useRef(0);
  const tickingRef = useRef(false);

  // Hide floating cart when any modal/dialog is open
  useEffect(() => {
    const checkModal = () => {
      const hasOpenModal =
        document.body.dataset.modalOpen === "true" ||
        !!document.querySelector('[role="dialog"], [aria-modal="true"], [data-modal="true"]');
      setIsModalOpen(hasOpenModal);
    };

    checkModal();

    const handleModalEvent = (e) => {
      if (typeof e.detail?.open === "boolean") {
        setIsModalOpen(e.detail.open);
      } else {
        checkModal();
      }
    };

    window.addEventListener("mc-modal-state", handleModalEvent);

    const observer = new MutationObserver(() => {
      checkModal();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["role", "aria-modal", "data-modal", "data-modal-open"],
    });

    return () => {
      window.removeEventListener("mc-modal-state", handleModalEvent);
      observer.disconnect();
    };
  }, []);

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
    "/return-policy",
    "/shipping-policy",
    "/terms",
    "/privacy-policy",
  ];

  const hasItems = cart && cart.items && cart.items.length > 0;
  const totalItems = hasItems
    ? cart.items.reduce((total, item) => total + (Number(item.quantity) || 0), 0)
    : 0;

  if (isModalOpen || hideOnPages.some((p) => path.startsWith(p)) || !hasItems || totalItems === 0) {
    return null;
  }

  const firstItemImage = hasItems ? getCatalogImageUrl(cart.items[0]) : null;
  const firstItemAlt = hasItems ? cart.items[0]?.name || "Cart item" : "Cart item";

  // Responsive bottom positioning:
  // On product pages below 'lg' (1024px), the fixed bottom purchase bar is visible at bottom-0 (~76px + safe-area).
  // On other pages below 'lg' (1024px), the BottomNav is visible at bottom-0 (~60px + safe-area).
  // Align breakpoint with BottomNav (lg:hidden): FloatingCartBar floats above BottomNav on phone & tablet (<1024px), and at bottom-8 on desktop (>=1024px).
  const bottomPositionClass = isProductPage
    ? "bottom-[calc(84px+env(safe-area-inset-bottom,0px))] lg:bottom-8"
    : "bottom-[calc(76px+env(safe-area-inset-bottom,0px))] lg:bottom-8";

  // Translate transformation based on scroll state:
  // On Mobile & Tablet (<1024px): smoothly shifts down slightly when scrolling down on homepage.
  // On Desktop (>=1024px): stays securely floating slightly above the bottom at lg:bottom-8 with zero downward drift (lg:translate-y-0).
  const visibilityClass = isHomePage
    ? isVisible
      ? "translate-y-0 opacity-100"
      : "translate-y-10 sm:translate-y-12 lg:translate-y-0 opacity-100"
    : "translate-y-0 opacity-100";

  return (
    <aside
      aria-label="Floating cart summary"
      className={`fixed left-1/2 z-50 w-auto -translate-x-1/2 transition-all duration-300 ease-in-out ${bottomPositionClass} ${visibilityClass}`}
    >
      <Link
        to="/cart"
        className="group flex min-w-[255px] max-w-[295px] items-center justify-between gap-3.5 rounded-full bg-gradient-to-r from-[#174F6D] via-[#14445F] to-[#113B53] border border-[#2B7A9E]/45 p-1.5 pl-2 pr-3 shadow-[0_8px_24px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] transition-all hover:scale-[1.02] hover:border-[#3891BA]/60 active:scale-[0.98]"
      >
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#081220] p-0.5 border border-[#1E4362] shadow-xs">
          {firstItemImage ? (
            <img
              src={firstItemImage}
              alt={firstItemAlt}
              className="h-full w-full rounded-full object-contain"
            />
          ) : (
            <div className="h-full w-full rounded-full bg-[#081220]" />
          )}
        </div>

        <div className="flex flex-col text-left min-w-0 flex-1">
          <span className="text-[14px] font-bold text-white leading-tight truncate">
            View cart
          </span>
          <span className="text-[11.5px] font-semibold text-[#8FE3D9] leading-tight">
            {totalItems} {totalItems === 1 ? "Item" : "Items"}
          </span>
        </div>

        <div className="flex h-7.5 w-7.5 flex-shrink-0 items-center justify-center rounded-full bg-white/15 text-white ml-0.5 transition-colors group-hover:bg-white/25">
          <ChevronRight size={16} strokeWidth={2.8} />
        </div>
      </Link>
    </aside>
  );
}

export default FloatingCartBar;
