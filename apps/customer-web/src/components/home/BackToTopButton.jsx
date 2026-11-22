import { useEffect, useState, useRef } from "react";
import { ArrowUp } from "lucide-react";
import { triggerHaptic } from "../../utils/haptics";

/**
 * Floating "Back to top" capsule pill component.
 * - Hides while actively scrolling to avoid visual clutter and accidental taps.
 * - Fades in smoothly after user pauses scrolling (400ms debounce) past threshold.
 * - Anchors 12px below the rested header so it is never cut off by the Category bar.
 * - Automatically hidden when any modal or dialog is open.
 */
export default function BackToTopButton({ threshold = 250 }) {
  const [visible, setVisible] = useState(false);
  const [buttonTop, setButtonTop] = useState(120);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const scrollTimeoutRef = useRef(null);

  // 1. Hide when modal/dialog is open
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

  // 2. Hide while scrolling; reveal 400ms after scrolling stops, positioned cleanly below rested header
  useEffect(() => {
    const handleScroll = () => {
      // Immediately hide while active scrolling is happening
      setVisible(false);

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // 400ms after user pauses scrolling, calculate rested header bottom and show if past threshold
      scrollTimeoutRef.current = setTimeout(() => {
        if (window.scrollY > threshold) {
          const header = document.getElementById("storefront-header");
          const headerBottom = header
            ? Math.round(header.getBoundingClientRect().bottom)
            : 80;
          setButtonTop(headerBottom + 12);
          setVisible(true);
        }
      }, 400);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [threshold]);

  const scrollToTop = () => {
    triggerHaptic("selection");
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const isShown = visible && !isModalOpen;

  return (
    <div
      className={`fixed left-1/2 -translate-x-1/2 z-40 transition-all duration-300 ease-out ${
        isShown
          ? "opacity-100 translate-y-0 pointer-events-auto"
          : "opacity-0 -translate-y-2 pointer-events-none"
      }`}
      style={{
        top: `${buttonTop}px`,
      }}
    >
      <button
        type="button"
        onClick={scrollToTop}
        aria-label="Back to top"
        className="group flex min-h-10 items-center gap-2 rounded-full bg-[#22499F] hover:bg-[#1B3B82] text-[#FFFFFF] px-4 py-2 shadow-lg border border-[#22499F] transition-all active:scale-95 cursor-pointer"
      >
        <span className="flex items-center justify-center h-5 w-5 rounded-full border border-current transition-colors">
          <ArrowUp size={13} strokeWidth={3} />
        </span>
        <span className="text-xs font-bold tracking-tight whitespace-nowrap">
          Back to top
        </span>
      </button>
    </div>
  );
}
