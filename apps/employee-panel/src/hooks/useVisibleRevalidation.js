import { useEffect, useRef } from "react";

/**
 * Revalidates page data when the app wakes from background/sleep,
 * returns from bfcache (persisted pageshow), or reconnects online.
 * Prevents overlapping in-flight calls and respects page busy states.
 *
 * @param {Function} onRevalidate - Callback to fetch fresh data.
 * @param {Function} [isBusy] - Optional function returning true if a fetch is already in flight.
 */
export function useVisibleRevalidation(onRevalidate, isBusy) {
  const onRevalidateRef = useRef(onRevalidate);
  onRevalidateRef.current = onRevalidate;
  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const triggerRevalidation = async () => {
      if (document.visibilityState !== "visible") return;
      if (inFlightRef.current) return;
      if (typeof isBusyRef.current === "function" && isBusyRef.current()) return;
      if (typeof onRevalidateRef.current !== "function") return;

      try {
        inFlightRef.current = true;
        await onRevalidateRef.current();
      } catch (_) {
        // Handled by the page's own error boundary / state
      } finally {
        inFlightRef.current = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void triggerRevalidation();
      }
    };

    const handlePageShow = (event) => {
      // Restrict strictly to back-forward cache restores (bfcache); ordinary page loads already mount
      if (event?.persisted) {
        void triggerRevalidation();
      }
    };

    const handleOnline = () => {
      if (document.visibilityState === "visible") {
        void triggerRevalidation();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("online", handleOnline);
    };
  }, []);
}

export default useVisibleRevalidation;
