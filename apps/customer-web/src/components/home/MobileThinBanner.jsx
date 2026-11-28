import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { resolveMediaUrl } from "../../utils/imageUtils.js";
import { createBannerVideoRetryManager } from "../../utils/bannerVideoRetry.js";

/**
 * Mobile-only homepage banner (3:1 / recommended 1200x400 source image/video)
 * Displayed strictly on mobile view right after the top Category bar on the homepage.
 * Supports static image or looping muted inline MP4 video with poster fallback.
 */
export default function MobileThinBanner({ banner, loading }) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(max-width: 767px)").matches;
  });

  // Video playback states
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const retryManagerRef = useRef(null);
  if (!retryManagerRef.current) {
    retryManagerRef.current = createBannerVideoRetryManager({
      onScheduleRetry: () => {
        if (typeof navigator !== "undefined" && navigator.onLine === false) return;
        setAttemptEpoch(retryManagerRef.current.getPlaybackEpoch());
        setIsPlaybackFailed(false);
      },
      onResetState: () => {
        setAttemptEpoch(retryManagerRef.current.getPlaybackEpoch());
        setIsVideoReady(false);
        setIsPlaybackFailed(false);
      },
    });
  }
  const [hasEnteredView, setHasEnteredView] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const [isDeferredVideoReady, setIsDeferredVideoReady] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  );
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isPlaybackFailed, setIsPlaybackFailed] = useState(false);
  const [attemptEpoch, setAttemptEpoch] = useState(0);
  const mediaIdentity = `${banner?.video_url || ""}|${banner?.image || ""}|${banner?.media_type || ""}`;
  const currentMediaRef = useRef(mediaIdentity);
  currentMediaRef.current = mediaIdentity;

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return undefined;
    const update = (event) => setReduceMotion(event.matches);
    if (media.addEventListener) media.addEventListener("change", update);
    else media.addListener(update);
    return () => {
      if (media.removeEventListener) media.removeEventListener("change", update);
      else media.removeListener(update);
    };
  }, []);

  // Monitor viewport match
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 767px)");
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const isVideoMode = banner?.media_type === "video" && Boolean(banner?.video_url);
  const saveData = typeof navigator !== "undefined" && navigator.connection?.saveData === true;
  const canObserveVideo = isMobile && !loading && banner?.is_active !== false &&
    Boolean(banner?.image) && isVideoMode && !reduceMotion && !saveData;
  const videoSrc = canObserveVideo && hasEnteredView && isDeferredVideoReady && !isPlaybackFailed
    ? resolveMediaUrl(banner.video_url)
    : "";

  // Let the poster render and the initial page requests settle before loading video.
  useEffect(() => {
    if (!canObserveVideo || isDeferredVideoReady || typeof window === "undefined") return undefined;

    let settledTimer = null;
    const unlockVideo = () => {
      if (settledTimer) window.clearTimeout(settledTimer);
      setIsDeferredVideoReady(true);
    };

    const scheduleAfterLoad = () => {
      settledTimer = window.setTimeout(unlockVideo, 2500);
    };

    if (document.readyState === "complete") {
      scheduleAfterLoad();
    } else {
      window.addEventListener("load", scheduleAfterLoad, { once: true });
    }

    return () => {
      if (settledTimer) window.clearTimeout(settledTimer);
      window.removeEventListener("load", scheduleAfterLoad);
    };
  }, [canObserveVideo, isDeferredVideoReady]);

  // Unified failure recovery with exponential backoff, retry cap, and dual-error deduplication
  const scheduleRetryOrGiveUp = useCallback((reason = "error", epoch = undefined) => {
    if (epoch !== retryManagerRef.current?.getPlaybackEpoch()) return;
    setIsVideoReady(false);
    setIsPlaybackFailed(true);
    retryManagerRef.current?.handleFailure({ reason, epoch });
  }, []);

  // Reset playback failure/ready state if banner media changes
  useEffect(() => {
    retryManagerRef.current?.reset();
  }, [banner?.video_url, banner?.image, banner?.media_type]);

  // Re-attempt video playback when device returns online or recovers connectivity
  useEffect(() => {
    const handleOnline = () => {
      retryManagerRef.current?.reset();
    };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
      retryManagerRef.current?.dispose();
    };
  }, []);

  // Attach video source only when the mobile banner enters view
  useEffect(() => {
    if (!canObserveVideo || !isDeferredVideoReady || !containerRef.current) return;
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
  }, [canObserveVideo, isDeferredVideoReady]);

  // Start playback after the source mounts, and pause while the banner is out of view.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;
    let cancelled = false;
    const playbackEpoch = attemptEpoch;
    const playbackMedia = mediaIdentity;

    // Defensively enforce muted properties on DOM element
    video.muted = true;
    video.defaultMuted = true;

    const syncPlayback = () => {
      if (!isInView || document.visibilityState === "hidden") {
        video.pause();
      } else {
        video.muted = true;
        video.defaultMuted = true;
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch((err) => {
            if (cancelled || videoRef.current !== video || playbackMedia !== currentMediaRef.current || err.name === "AbortError") return;
            // On mobile devices, autoplay can be temporarily prevented prior to first user touch (NotAllowedError).
            // Do NOT permanently discard the video on NotAllowedError; keep it mounted so user scroll/touch can engage it.
            if (err.name !== "NotAllowedError") {
              scheduleRetryOrGiveUp(err.name || "play_rejection", playbackEpoch);
            }
          });
        }
      }
    };
    syncPlayback();
    document.addEventListener("visibilitychange", syncPlayback);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", syncPlayback);
    };
  }, [videoSrc, isInView, scheduleRetryOrGiveUp, attemptEpoch, mediaIdentity]);

  // Seamless engagement on user scroll or touch if mobile autoplay was initially held back
  useEffect(() => {
    if (!canObserveVideo || isVideoReady || isPlaybackFailed) return;
    const playbackEpoch = attemptEpoch;
    const playbackMedia = mediaIdentity;
    let cancelled = false;
    const resumeOnInteraction = () => {
      const video = videoRef.current;
      if (video && video.paused && isInView) {
        video.muted = true;
        video.defaultMuted = true;
        const p = video.play();
        if (p && typeof p.then === "function") {
          p.then(() => {
            if (cancelled || videoRef.current !== video || playbackMedia !== currentMediaRef.current || playbackEpoch !== retryManagerRef.current?.getPlaybackEpoch()) return;
            retryManagerRef.current?.handleSuccess();
            setIsVideoReady(true);
            setIsPlaybackFailed(false);
          }).catch((err) => {
            if (cancelled || videoRef.current !== video || playbackMedia !== currentMediaRef.current) return;
            if (err?.name !== "NotAllowedError" && err?.name !== "AbortError") {
              scheduleRetryOrGiveUp(err?.name || "interaction_play_rejection", playbackEpoch);
            }
          });
        }
      }
    };
    window.addEventListener("touchstart", resumeOnInteraction, { passive: true });
    window.addEventListener("scroll", resumeOnInteraction, { passive: true });
    return () => {
      cancelled = true;
      window.removeEventListener("touchstart", resumeOnInteraction);
      window.removeEventListener("scroll", resumeOnInteraction);
    };
  }, [canObserveVideo, isVideoReady, isPlaybackFailed, isInView, scheduleRetryOrGiveUp, attemptEpoch, mediaIdentity]);

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
        decoding="async"
      />

      {/* 2. Video Player (Source attached when entering view; plays muted inline) */}
      {showVideo && (
        <video
          key={`${videoSrc}:${attemptEpoch}`}
          ref={videoRef}
          src={videoSrc}
          poster={posterSrc}
          autoPlay
          playsInline
          muted
          loop
          preload="metadata"
          onPlaying={(event) => {
            if (event.currentTarget !== videoRef.current || mediaIdentity !== currentMediaRef.current || attemptEpoch !== retryManagerRef.current?.getPlaybackEpoch()) return;
            retryManagerRef.current?.handleSuccess();
            setIsVideoReady(true);
            setIsPlaybackFailed(false);
          }}
          onError={(event) => {
            if (event.currentTarget !== videoRef.current || mediaIdentity !== currentMediaRef.current) return;
            scheduleRetryOrGiveUp("media_onError", attemptEpoch);
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
