import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const SESSION_CATEGORIES_KEY = "mc_categories_scroll_session";
const SESSION_PRODUCT_PREFIX = "mc_product_scroll_";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes idle expiration

function hasValidCategoriesSession() {
  if (typeof window === "undefined") return false;
  try {
    const raw = sessionStorage.getItem(SESSION_CATEGORIES_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || typeof data.scrollY !== "number" || data.scrollY <= 0) return false;
    if (Date.now() - (data.timestamp || 0) > SESSION_TIMEOUT_MS) {
      sessionStorage.removeItem(SESSION_CATEGORIES_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function hasValidProductSession(productId) {
  if (typeof window === "undefined" || !productId) return false;
  try {
    const raw = sessionStorage.getItem(`${SESSION_PRODUCT_PREFIX}${productId}`);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || typeof data.scrollY !== "number" || data.scrollY <= 0) return false;
    if (Date.now() - (data.timestamp || 0) > SESSION_TIMEOUT_MS) {
      sessionStorage.removeItem(`${SESSION_PRODUCT_PREFIX}${productId}`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Controlled SPA Scroll Restoration
 *
 * 1. Sets history.scrollRestoration = "manual" to eliminate erratic asynchronous browser scroll jumps.
 * 2. On PUSH/REPLACE navigations: always scrolls to top (0, 0), EXCEPT if navigating to /categories or an already-visited /product/:id with an active in-session scroll offset.
 * 3. On POP (Back/Forward) transitions:
 *    - If landing on an in-session Category or Product page, lets the page restore its offset.
 *    - If landing on Home (/): always scrolls to top (0, 0).
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
    const productMatch = pathname.match(/^\/products?\/([^\/]+)/);
    const productId = productMatch ? productMatch[1] : null;
    const isProductPage = Boolean(productId);
    const isHomePage = pathname === "/";
    const isCategoriesPage = pathname === "/categories";

    const hasActiveProductSession = isProductPage && hasValidProductSession(productId);
    const hasActiveCategoriesSession = isCategoriesPage && hasValidCategoriesSession();

    if (navType === "PUSH" || navType === "REPLACE") {
      if (hasActiveCategoriesSession || hasActiveProductSession) {
        // Active session: Component will smoothly restore saved position once data renders
      } else {
        // New navigation or unvisited product: always start from top
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      }
    } else if (navType === "POP") {
      if (hasActiveCategoriesSession || hasActiveProductSession) {
        // Active session restoration handled by page
      } else if (isHomePage) {
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      } else if (isProductPage) {
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      } else {
        // Other pages restore saved position if available
        const savedY = scrollPositions.current.get(location.key) || 0;
        window.scrollTo({ top: savedY, left: 0, behavior: "instant" });
      }
    }

    prevKeyRef.current = location.key;
  }, [location.pathname, location.key, navType]);

  return null;
}

export default ScrollToTop;
