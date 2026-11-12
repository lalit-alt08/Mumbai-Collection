import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { getBanners } from "../../services/productService.js";
import { resolveMediaUrl } from "../../utils/imageUtils.js";

/**
 * Mobile-only homepage banner (3:1 / recommended 1200x400 source image/video)
 * Displayed strictly on mobile view right after the top Category bar on the homepage.
 * Supports static image or looping muted inline MP4 video with poster fallback.
 */
export default function MobileThinBanner({ banner: initialBanner = null }) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(max-width: 767px)").matches;
  });
  const [banner, setBanner] = useState(initialBanner);
  const [loading, setLoading] = useState(() => !initialBanner && isMobile);

  // Video playback states
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const [hasEnteredView, setHasEnteredView] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isPlaybackFailed, setIsPlaybackFailed] = useState(false);

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

  const isVideoMode = banner?.media_type === "video" && Boolean(banner?.video_url);
  const canObserveVideo = isMobile && !loading && Boolean(banner?.image) && isVideoMode;
  const videoSrc = canObserveVideo && hasEnteredView && !isPlaybackFailed
    ? resolveMediaUrl(banner.video_url)
    : "";

  // Reset playback failure/ready state if banner media changes
  useEffect(() => {
    setIsVideoReady(false);
    setIsPlaybackFailed(false);
  }, [banner?.video_url, banner?.image, banner?.media_type]);

  // Attach video source only when the mobile banner enters view
  useEffect(() => {
    if (!canObserveVideo || !containerRef.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setHasEnteredView(true);
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        const visible = Boolean(entry?.isIntersecting);
        setIsInView(visible);
        if (visible) {
          setHasEnteredView(true);
        }
      },
      { threshold: 0.15 }
    );

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [canObserveVideo]);

  // Start playback after the source mounts, and pause while the banner is out of view.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;
    let cancelled = false;
    const syncPlayback = () => {
      if (!isInView || document.visibilityState === "hidden") {
        video.pause();
      } else {
        video.muted = true;
        video.play()?.catch((err) => {
          if (cancelled || videoRef.current !== video || err.name === "AbortError") return;
          setIsPlaybackFailed(true);
        });
      }
    };
    syncPlayback();
    document.addEventListener("visibilitychange", syncPlayback);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", syncPlayback);
    };
  }, [videoSrc, isInView]);

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

  const posterSrc = resolveMediaUrl(banner.image);
  const showVideo = Boolean(videoSrc);

  const bannerVisual = (
    <>
      {/* 1. Poster Image (Visible immediately and retained if autoplay is unavailable) */}
      <img
        src={posterSrc}
        alt={banner.title || "Welcome to Mumbai Collection"}
        className="absolute inset-0 w-full h-full object-cover bg-[#F0F8E8]"
        loading="eager"
        fetchPriority="high"
      />

      {/* 2. Video Player (Source attached when entering view; plays muted inline) */}
      {showVideo && (
        <video
          key={videoSrc}
          ref={videoRef}
          src={videoSrc}
          poster={posterSrc}
          preload="metadata"
          playsInline
          muted
          loop
          onPlaying={() => {
            setIsVideoReady(true);
            setIsPlaybackFailed(false);
          }}
          onError={() => {
            setIsPlaybackFailed(true);
          }}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            isVideoReady ? "opacity-100" : "opacity-0"
          }`}
        />
      )}

    </>
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-[3/1] overflow-hidden rounded-[14px] sm:rounded-[18px] bg-[#F0F8E8]"
    >
      {banner.link ? (
        <Link to={banner.link} aria-label={banner.title || "Welcome to Mumbai Collection"} className="absolute inset-0 block">
          {bannerVisual}
        </Link>
      ) : (
        <div className="absolute inset-0">{bannerVisual}</div>
      )}

    </div>
  );
}
