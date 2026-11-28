import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";

import { Swiper, SwiperSlide } from "swiper/react";
import { Autoplay, Pagination } from "swiper/modules";

import "swiper/css";
import "swiper/css/pagination";

import { resolveMediaUrl } from "../../utils/imageUtils.js";
import { createBannerVideoRetryManager } from "../../utils/bannerVideoRetry.js";

function HeroVideoSlide({
  videoUrl,
  isActive,
  isHeroInView,
  reduceMotion,
  posterNode,
}) {
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

  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isPlaybackFailed, setIsPlaybackFailed] = useState(false);
  const [attemptEpoch, setAttemptEpoch] = useState(0);
  const currentVideoRef = useRef(videoUrl);
  currentVideoRef.current = videoUrl;

  const shouldPlay = isActive && isHeroInView && !reduceMotion;

  useEffect(() => {
    if (!shouldPlay) retryManagerRef.current?.reset();
  }, [shouldPlay]);

  const scheduleRetryOrGiveUp = useCallback((reason = "error", epoch = undefined) => {
    if (epoch !== retryManagerRef.current?.getPlaybackEpoch()) return;
    setIsVideoReady(false);
    setIsPlaybackFailed(true);
    retryManagerRef.current?.handleFailure({ reason, epoch });
  }, []);

  useEffect(() => {
    retryManagerRef.current?.reset();
  }, [videoUrl]);

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

  const videoSrc =
    shouldPlay && !isPlaybackFailed && videoUrl
      ? resolveMediaUrl(videoUrl)
      : "";

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;
    let cancelled = false;
    const playbackEpoch = attemptEpoch;
    const playbackMedia = videoUrl;

    video.muted = true;
    video.defaultMuted = true;

    const syncPlayback = () => {
      if (!shouldPlay || document.visibilityState === "hidden") {
        video.pause();
      } else {
        video.muted = true;
        video.defaultMuted = true;
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch((err) => {
            if (
              cancelled ||
              videoRef.current !== video ||
              playbackMedia !== currentVideoRef.current ||
              err.name === "AbortError"
            ) {
              return;
            }
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
  }, [videoSrc, shouldPlay, scheduleRetryOrGiveUp, attemptEpoch, videoUrl]);

  useEffect(() => {
    if (!videoSrc || isVideoReady || isPlaybackFailed) return;
    const playbackEpoch = attemptEpoch;
    const playbackMedia = videoUrl;
    let cancelled = false;

    const resumeOnInteraction = () => {
      const video = videoRef.current;
      if (video && video.paused && shouldPlay) {
        video.muted = true;
        video.defaultMuted = true;
        const p = video.play();
        if (p && typeof p.then === "function") {
          p.then(() => {
            if (
              cancelled ||
              videoRef.current !== video ||
              playbackMedia !== currentVideoRef.current ||
              playbackEpoch !== retryManagerRef.current?.getPlaybackEpoch()
            ) {
              return;
            }
            retryManagerRef.current?.handleSuccess();
            setIsVideoReady(true);
            setIsPlaybackFailed(false);
          }).catch((err) => {
            if (cancelled || videoRef.current !== video || playbackMedia !== currentVideoRef.current) return;
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
  }, [videoSrc, isVideoReady, isPlaybackFailed, shouldPlay, scheduleRetryOrGiveUp, attemptEpoch, videoUrl]);

  return (
    <div className="relative w-full overflow-hidden rounded-[18px] sm:rounded-[22px]">
      {posterNode}
      {videoSrc && (
        <video
          key={`${videoSrc}-${attemptEpoch}`}
          ref={videoRef}
          src={videoSrc}
          autoPlay={shouldPlay}
          muted
          loop
          playsInline
          preload="metadata"
          disablePictureInPicture
          controlsList="nodownload noplaybackrate"
          aria-hidden="true"
          onPlaying={(event) => {
            if (event.currentTarget !== videoRef.current ||
                videoUrl !== currentVideoRef.current ||
                attemptEpoch !== retryManagerRef.current?.getPlaybackEpoch()) return;
            retryManagerRef.current?.handleSuccess();
            setIsVideoReady(true);
            setIsPlaybackFailed(false);
          }}
          onError={(event) => {
            if (event.currentTarget !== videoRef.current || videoUrl !== currentVideoRef.current) return;
            scheduleRetryOrGiveUp("media_error", attemptEpoch);
          }}
          className={`pointer-events-none absolute inset-0 h-full w-full rounded-[18px] sm:rounded-[22px] object-cover transition-opacity duration-300 ${
            isVideoReady ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </div>
  );
}

function HeroBanner({ data }) {
  const loading = data === null;
  const banners = (data?.banners ?? [])
    .filter((banner) => banner && banner.is_active !== false &&
      (banner.desktop_image || banner.mobile_image || (banner.media_type === "video" && banner.video_url)))
    .slice(0, 3);
  const [failedImages, setFailedImages] = useState({});
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [isHeroInView, setIsHeroInView] = useState(true);
  const containerRef = useRef(null);
  const [reduceMotion, setReduceMotion] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches));

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

  useEffect(() => {
    if (!containerRef.current || typeof IntersectionObserver === "undefined") {
      setIsHeroInView(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsHeroInView(Boolean(entry?.isIntersecting));
      },
      { threshold: 0.15 }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [loading, banners.length]);

  useEffect(() => {
    if (data?.success && !data.degraded) setFailedImages({});
  }, [data]);

  if (loading) {
    return (
      <div className="w-full aspect-[16/7] sm:aspect-[16/6] md:max-h-[300px] lg:max-h-[340px] rounded-[18px] sm:rounded-[22px] bg-[#FFFFFF] border border-[#E2E8F0]/60 animate-pulse" />
    );
  }

  // If no live banners are configured, do not render static placeholders
  if (banners.length === 0) {
    return null;
  }

  const isMultiSlide = banners.length > 1;

  return (
    <div ref={containerRef} className="w-full">
      <Swiper
        modules={isMultiSlide ? [Autoplay, Pagination] : []}
        autoplay={
          isMultiSlide && !reduceMotion
            ? {
                delay: 5000,
                disableOnInteraction: false,
              }
            : false
        }
        pagination={
          isMultiSlide
            ? {
                clickable: true,
              }
            : false
        }
        speed={700}
        loop={isMultiSlide}
        onSwiper={(swiper) => setActiveSlideIndex(swiper.realIndex ?? swiper.activeIndex ?? 0)}
        onSlideChange={(swiper) => setActiveSlideIndex(swiper.realIndex ?? swiper.activeIndex ?? 0)}
        className="overflow-hidden rounded-[18px] sm:rounded-[22px] shadow-xs md:shadow-sm"
      >
        {banners.map((item, index) => {
          const rawDesktop = item.desktop_image || item.mobile_image;
          const rawMobile = item.mobile_image || item.desktop_image;
          const desktopSrc = resolveMediaUrl(rawDesktop);
          const mobileSrc = resolveMediaUrl(rawMobile);
          const hasDistinctImages = Boolean(desktopSrc && mobileSrc && desktopSrc !== mobileSrc);
          const imageKey = `${item.id}:${desktopSrc}:${mobileSrc}`;
          const isVideoSlide = item.media_type === "video" && Boolean(item.video_url);

          const BannerImage = (!desktopSrc && !mobileSrc) || failedImages[imageKey] ? (
            <div className="aspect-[16/7] sm:aspect-[16/6] md:max-h-[300px] lg:max-h-[340px] flex items-center justify-center bg-gray-100 text-gray-600">
              {item.title || "Promotion"}
            </div>
          ) : hasDistinctImages ? (
            <picture className="block w-full">
              {/* Mobile Viewport (< 640px) */}
              <source media="(max-width: 639px)" srcSet={mobileSrc} />
              {/* Desktop / Tablet Viewport (>= 640px) */}
              <source media="(min-width: 640px)" srcSet={desktopSrc} />
              <img
                src={desktopSrc}
                alt={item.title || "Mumbai Collection Promotional Banner"}
                width="1600"
                height="700"
                loading={index === 0 ? "eager" : "lazy"}
                decoding="async"
                onError={() => setFailedImages((current) => ({ ...current, [imageKey]: true }))}
                fetchPriority={index === 0 ? "high" : "auto"}
                className="aspect-[16/7] sm:aspect-[16/6] md:max-h-[300px] lg:max-h-[340px] w-full rounded-[18px] sm:rounded-[22px] object-cover"
              />
            </picture>
          ) : (
            <img
              src={desktopSrc || mobileSrc}
              alt={item.title || "Mumbai Collection Promotional Banner"}
              width="1600"
              height="700"
              loading={index === 0 ? "eager" : "lazy"}
              decoding="async"
              onError={() => setFailedImages((current) => ({ ...current, [imageKey]: true }))}
              fetchPriority={index === 0 ? "high" : "auto"}
              className="aspect-[16/7] sm:aspect-[16/6] md:max-h-[300px] lg:max-h-[340px] w-full rounded-[18px] sm:rounded-[22px] object-cover"
            />
          );

          const SlideContent = isVideoSlide ? (
            <HeroVideoSlide
              videoUrl={item.video_url}
              isActive={index === activeSlideIndex}
              isHeroInView={isHeroInView}
              reduceMotion={reduceMotion}
              posterNode={BannerImage}
            />
          ) : (
            BannerImage
          );

          return (
            <SwiperSlide
              key={item.id || index}
              data-swiper-autoplay={isVideoSlide ? 12000 : undefined}
            >
              {item.link ? (
                <Link to={item.link} className="block w-full cursor-pointer focus:outline-none">
                  {SlideContent}
                </Link>
              ) : (
                <div className="block w-full">{SlideContent}</div>
              )}
            </SwiperSlide>
          );
        })}
      </Swiper>
    </div>
  );
}

export default HeroBanner;
