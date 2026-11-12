import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { getBanners } from "../../services/productService.js";
import { resolveMediaUrl } from "../../utils/imageUtils.js";

/**
 * Mobile-only homepage banner (3:1 / recommended 1200x400 source image)
 * Displayed strictly on mobile view right after the top Category bar on the homepage.
 */
export default function MobileThinBanner({ banner: initialBanner = null }) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(max-width: 767px)").matches;
  });
  const [banner, setBanner] = useState(initialBanner);
  const [loading, setLoading] = useState(() => !initialBanner && isMobile);

  // Monitor viewport match
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 767px)");
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const fetchThinBanner = useCallback(async (force = false) => {
    if (initialBanner && !force) {
      setBanner(initialBanner);
      setLoading(false);
      return;
    }
    try {
      const res = await getBanners({ force });
      const thin = res?.thin_banner;
      if (thin && thin.is_active !== false && thin.image) {
        setBanner(thin);
      } else {
        setBanner(null);
      }
    } catch {
      // Preserve current banner if a background refresh fails; do NOT wipe out existing UI!
      setBanner((prev) => prev);
    } finally {
      setLoading(false);
    }
  }, [initialBanner]);

  useEffect(() => {
    if (!isMobile) return;
    fetchThinBanner(false);

    let refreshDebounce = null;
    const triggerDebouncedRefresh = () => {
      if (refreshDebounce) clearTimeout(refreshDebounce);
      refreshDebounce = setTimeout(() => {
        fetchThinBanner(true);
      }, 150);
    };

    // Refresh banner when user returns to the page
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        triggerDebouncedRefresh();
      }
    };
    const handlePageShow = (event) => {
      // Only refresh on bfcache restores (back/forward navigation), avoiding redundant reload on initial page load
      if (event?.persisted) {
        triggerDebouncedRefresh();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      if (refreshDebounce) clearTimeout(refreshDebounce);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [isMobile, fetchThinBanner]);

  // Completely omit from desktop DOM to avoid eager high-priority downloads
  if (!isMobile) {
    return null;
  }

  if (loading) {
    return (
      <div className="w-full aspect-[3/1] rounded-[14px] sm:rounded-[18px] bg-transparent animate-pulse" />
    );
  }

  if (!banner || !banner.image || banner.is_active === false) {
    return null;
  }

  const imageSrc = resolveMediaUrl(banner.image);

  return (
    <div className="w-full overflow-hidden rounded-[14px] sm:rounded-[18px] bg-[#F0F8E8]">
      {banner.link ? (
        <Link to={banner.link} className="block w-full">
          <img
            src={imageSrc}
            alt={banner.title || "Welcome to Mumbai Collection"}
            className="w-full aspect-[3/1] object-cover bg-[#F0F8E8]"
            loading="eager"
            fetchPriority="high"
          />
        </Link>
      ) : (
        <img
          src={imageSrc}
          alt={banner.title || "Welcome to Mumbai Collection"}
          className="w-full aspect-[3/1] object-cover bg-[#F0F8E8]"
          loading="eager"
          fetchPriority="high"
        />
      )}
    </div>
  );
}
