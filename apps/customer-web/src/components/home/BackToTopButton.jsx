import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { triggerHaptic } from "../../utils/haptics";

/**
 * Floating "Back to top" capsule pill component matching reference UI.
 * Floats near the top center below the sticky header when user scrolls down.
 */
export default function BackToTopButton({ threshold = 250 }) {
  const [visible, setVisible] = useState(false);
  const [headerBottom, setHeaderBottom] = useState(160);

  useEffect(() => {
    let ticking = false;
    let frameId;
    const header = document.getElementById("storefront-header");
    const updateHeaderPosition = () => {
      if (header) setHeaderBottom(Math.max(0, header.getBoundingClientRect().bottom));
    };

    const handleScroll = () => {
      if (!ticking) {
        frameId = window.requestAnimationFrame(() => {
          setVisible(window.scrollY > threshold);
          updateHeaderPosition();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", updateHeaderPosition);
    const observer = header && typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateHeaderPosition) : null;
    if (observer) observer.observe(header);
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", updateHeaderPosition);
      observer?.disconnect();
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, [threshold]);

  const scrollToTop = () => {
    triggerHaptic("selection");
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  if (!visible) return null;

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-50 pointer-events-auto transition-opacity duration-300 ease-out animate-[fadeInDown_0.2s_ease-out]"
      style={{ top: `${headerBottom + 8}px` }}
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
