import { useState, useEffect, useRef } from "react";
import { ArrowLeft, Heart, Share2, ChevronLeft, ChevronRight, Check } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useFavorites } from "../../context/FavoritesContext";
import { getCatalogImageUrl, getFullImageUrl, PRODUCT_PLACEHOLDER_URL } from "../../utils/imageUtils";
import { triggerHaptic } from "../../utils/haptics";

function ProductGallery({ product }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const { isFavorited, toggleFavorite } = useFavorites();

  // Reset selected image when navigating to a new product
  useEffect(() => {
    setSelectedIndex(0);
  }, [product?.id]);

  const images = product?.images && product.images.length > 0
    ? product.images
    : [{ src: PRODUCT_PLACEHOLDER_URL }];

  const favorited = isFavorited(product?.id);
  const safeIndex = Math.min(selectedIndex, images.length - 1);

  const [shareFeedback, setShareFeedback] = useState(null);
  const shareTimerRef = useRef(null);

  // Touch / Swipe Gesture Tracking
  const [touchDelta, setTouchDelta] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isHorizontalSwipe = useRef(null);

  useEffect(() => {
    return () => {
      if (shareTimerRef.current) {
        clearTimeout(shareTimerRef.current);
      }
    };
  }, []);

  const handleShare = async () => {
    const shareUrl = window.location.href;
    const shareData = {
      title: product?.name || "Mumbai Collection",
      url: shareUrl,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        if (err.name === "AbortError") return;
      }
    }

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = shareUrl;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setShareFeedback("Link copied to clipboard!");
      if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
      shareTimerRef.current = setTimeout(() => {
        setShareFeedback(null);
        shareTimerRef.current = null;
      }, 2500);
    } catch {
      setShareFeedback("Failed to copy link");
      if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
      shareTimerRef.current = setTimeout(() => {
        setShareFeedback(null);
        shareTimerRef.current = null;
      }, 2500);
    }
  };

  const handleBack = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (
      window.history.state &&
      typeof window.history.state.idx === "number" &&
      window.history.state.idx > 0
    ) {
      navigate(-1);
    } else {
      navigate("/", { replace: true });
    }
  };

  const handleToggleFav = async () => {
    const res = await toggleFavorite(product);
    if (res?.requiresAuth) {
      navigate("/login");
    }
  };

  const handlePrev = () => {
    setSelectedIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
    triggerHaptic("selection");
  };

  const handleNext = () => {
    setSelectedIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
    triggerHaptic("selection");
  };

  // Touch Swipe Handlers for Finger Scrolling
  const handleTouchStart = (e) => {
    if (images.length <= 1) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isHorizontalSwipe.current = null;
    setIsSwiping(true);
    setTouchDelta(0);
  };

  const handleTouchMove = (e) => {
    if (images.length <= 1 || !touchStartX.current) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = currentX - touchStartX.current;
    const diffY = currentY - touchStartY.current;

    // Detect gesture direction on initial movement
    if (isHorizontalSwipe.current === null) {
      if (Math.abs(diffX) > 8 || Math.abs(diffY) > 8) {
        isHorizontalSwipe.current = Math.abs(diffX) > Math.abs(diffY);
      }
    }

    // Only drag horizontally if user isn't scrolling vertically
    if (isHorizontalSwipe.current) {
      let delta = diffX;
      // Rubber-band resistance at boundaries
      if ((safeIndex === 0 && delta > 0) || (safeIndex === images.length - 1 && delta < 0)) {
        delta = delta * 0.35;
      }
      setTouchDelta(delta);
    }
  };

  const handleTouchEnd = () => {
    if (images.length <= 1) return;
    setIsSwiping(false);
    const threshold = 45; // Minimum px to trigger image slide

    if (isHorizontalSwipe.current) {
      if (touchDelta < -threshold && safeIndex < images.length - 1) {
        setSelectedIndex((prev) => prev + 1);
        triggerHaptic("selection");
      } else if (touchDelta > threshold && safeIndex > 0) {
        setSelectedIndex((prev) => prev - 1);
        triggerHaptic("selection");
      }
    }

    setTouchDelta(0);
    touchStartX.current = 0;
    touchStartY.current = 0;
    isHorizontalSwipe.current = null;
  };

  return (
    <div className="relative flex w-full flex-col bg-white pb-6 pt-0 lg:rounded-[24px] lg:pt-8 shadow-[0_8px_30px_rgba(0,0,0,0.03)] rounded-b-[32px] border border-gray-100/80">
      {/* Floating Action Icons */}
      <div
        className="absolute left-4 right-4 z-20 flex items-center justify-between lg:left-6 lg:right-6"
        style={{ top: "max(1rem, calc(var(--safe-area-top, env(safe-area-inset-top, 0px)) + 0.5rem))" }}
      >
        <button
          type="button"
          onClick={handleBack}
          aria-label="Go back"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[#111F36]/95 text-white shadow-[0_4px_12px_rgba(0,0,0,0.4)] border border-[#1E3252] backdrop-blur-md transition-transform hover:scale-105 active:scale-95 cursor-pointer"
        >
          <ArrowLeft size={20} strokeWidth={2.5} />
        </button>
        <div className="flex items-center gap-2.5">
          {/* Wishlist Heart Button */}
          <button
            onClick={handleToggleFav}
            aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#111F36]/95 text-white shadow-[0_4px_12px_rgba(0,0,0,0.4)] border border-[#1E3252] backdrop-blur-md transition-all hover:scale-110 active:scale-125 cursor-pointer"
          >
            <Heart
              size={20}
              className={`transition-all duration-300 ${
                favorited
                  ? "fill-[#42D6E8] text-[#42D6E8] scale-110"
                  : "text-white hover:text-[#42D6E8]"
              }`}
            />
          </button>

          {/* Share Button */}
          <button
            onClick={handleShare}
            aria-label="Share product"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#111F36]/95 text-white shadow-[0_4px_12px_rgba(0,0,0,0.4)] border border-[#1E3252] backdrop-blur-md transition-transform hover:scale-105 active:scale-95 cursor-pointer"
          >
            {shareFeedback ? <Check size={18} className="text-[#42D6E8]" /> : <Share2 size={19} />}
          </button>
        </div>
      </div>

      {/* Share Toast Notification */}
      {shareFeedback && (
        <div className="absolute top-16 right-4 z-30 flex items-center gap-1.5 rounded-xl bg-[#111F36] border border-[#1E3252] px-3 py-1.5 text-[11px] font-semibold text-white shadow-lg backdrop-blur-md animate-[fadeIn_0.2s_ease-out]">
          <Check size={13} className="text-[#42D6E8]" />
          <span>{shareFeedback}</span>
        </div>
      )}

      {/* Main Image Slider with Real-Time Finger Drag & Swipe Gestures */}
      <div
        className="relative mx-auto mt-14 aspect-square w-full max-w-[420px] overflow-hidden select-none touch-pan-y"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {/* Horizontal Sliding Track that moves with user finger */}
        <div
          className={`flex h-full w-full ${isSwiping ? "transition-none" : "transition-transform duration-300 ease-out"}`}
          style={{
            transform: `translateX(calc(-${safeIndex * 100}% + ${touchDelta}px))`,
          }}
        >
          {images.map((img, idx) => (
            <div
              key={img.id || idx}
              className="flex h-full w-full shrink-0 items-center justify-center p-4"
            >
              <img
                src={getFullImageUrl(img)}
                alt={img.alt || img.name || product?.name || `Product image ${idx + 1}`}
                width="420"
                height="420"
                draggable={false}
                className="h-full w-full object-contain select-none pointer-events-none transition-transform duration-500"
                decoding="async"
                loading={idx === 0 ? "eager" : "lazy"}
                onError={(e) => {
                  if (e.currentTarget.getAttribute("data-fallback") !== "true") {
                    e.currentTarget.setAttribute("data-fallback", "true");
                    e.currentTarget.src = PRODUCT_PLACEHOLDER_URL;
                  }
                }}
              />
            </div>
          ))}
        </div>

        {/* Floating Indicator Dots on Mobile */}
        {images.length > 1 && (
          <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-[#0B1425]/75 px-2.5 py-1 backdrop-blur-xs z-10">
            {images.map((_, dotIdx) => (
              <span
                key={dotIdx}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  safeIndex === dotIdx ? "w-4 bg-[#42D6E8]" : "w-1.5 bg-white/40"
                }`}
              />
            ))}
          </div>
        )}

        {/* Gallery Navigation Arrows (when multiple images exist) */}
        {images.length > 1 && (
          <>
            <button
              onClick={handlePrev}
              aria-label="Previous image"
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-[#111F36]/90 text-white shadow-md border border-[#1E3252] backdrop-blur-xs transition-all hover:bg-[#162744] hover:scale-110 active:scale-95 cursor-pointer"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={handleNext}
              aria-label="Next image"
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-[#111F36]/90 text-white shadow-md border border-[#1E3252] backdrop-blur-xs transition-all hover:bg-[#162744] hover:scale-110 active:scale-95 cursor-pointer"
            >
              <ChevronRight size={20} />
            </button>
          </>
        )}
      </div>

      {/* Multi-Image Thumbnails */}
      {images.length > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2.5 px-4">
          {images.map((img, index) => {
            const isSelected = safeIndex === index;
            const thumbUrl = getCatalogImageUrl(img);
            return (
              <button
                key={img.id || index}
                onClick={() => {
                  if (index !== selectedIndex) {
                    setSelectedIndex(index);
                    triggerHaptic("selection");
                  }
                }}
                aria-label={`View image ${index + 1}`}
                className={`relative flex h-16 w-16 sm:h-18 sm:w-18 items-center justify-center rounded-xl overflow-hidden bg-[#080F1C] p-1 transition-all duration-300 cursor-pointer ${
                  isSelected
                    ? "border-2 border-[#42D6E8] ring-2 ring-[#42D6E8]/25 shadow-xs scale-105"
                    : "border border-[#1E3252] opacity-60 hover:opacity-100 hover:border-[#42D6E8]/60"
                }`}
              >
                <img
                  src={thumbUrl}
                  alt={img.alt || img.name || `Thumbnail ${index + 1}`}
                  width="72"
                  height="72"
                  className="h-full w-full object-contain"
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    if (e.currentTarget.getAttribute("data-fallback") !== "true") {
                      e.currentTarget.setAttribute("data-fallback", "true");
                      e.currentTarget.src = PRODUCT_PLACEHOLDER_URL;
                    }
                  }}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ProductGallery;
