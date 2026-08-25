import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * Controlled SPA Scroll Restoration
 *
 * 1. Sets history.scrollRestoration = "manual" to eliminate erratic asynchronous browser scroll jumps.
 * 2. On PUSH/REPLACE navigations: always scrolls to top (0, 0).
 * 3. On POP (Back/Forward) transitions:
 *    - If landing on a Product Details page (/product/*) or Home (/): always scrolls to top (0, 0).
 *    - If landing on Category (/category/*) or other listing pages: restores previously saved scroll offset.
 */
function ScrollToTop() {
  const location = useLocation();
  const navType = useNavigationType();
  const scrollPositions = useRef(new Map());
  const prevKeyRef = useRef(location.key);

  // Initialize manual scroll restoration once on mount
  useEffect(() => {
    if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  // Save previous page scroll position before location changes
  useEffect(() => {
    const handleScroll = () => {
      if (prevKeyRef.current) {
        scrollPositions.current.set(prevKeyRef.current, window.scrollY);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Handle scroll positioning on route transition
  useEffect(() => {
    const pathname = location.pathname;
    const isProductPage = pathname.startsWith("/product");
    const isHomePage = pathname === "/";

    if (navType === "PUSH" || navType === "REPLACE") {
      // New navigation: always start from top
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    } else if (navType === "POP") {
      if (isProductPage || isHomePage) {
        // Product Details and Home always start from top on Back navigation
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      } else {
        // Other pages (e.g. Category, Search) restore saved position if available
        const savedY = scrollPositions.current.get(location.key) || 0;
        window.scrollTo({ top: savedY, left: 0, behavior: "instant" });
      }
    }

    prevKeyRef.current = location.key;
  }, [location.pathname, location.key, navType]);

  return null;
}

export default ScrollToTop;
