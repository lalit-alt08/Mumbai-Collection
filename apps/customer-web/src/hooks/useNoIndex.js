import { useEffect } from "react";

/**
 * Hook to inject <meta name="robots" content="noindex, nofollow" /> on private/sensitive customer routes
 * (Cart, Checkout, Account, Orders, Auth, NotFound/Soft-404) to prevent indexing while preserving clean history.
 *
 * @param {boolean} [enabled=true] - Whether to activate the noindex directive
 */
export function useNoIndex(enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    let metaTag = document.querySelector('meta[name="robots"]');
    let created = false;

    if (!metaTag) {
      metaTag = document.createElement("meta");
      metaTag.name = "robots";
      document.head.appendChild(metaTag);
      created = true;
    }

    const previousContent = metaTag.content;
    metaTag.content = "noindex, nofollow";

    // Clean up any canonical tags on confirmed 404 / noindex pages to avoid conflicting indexing signals
    const existingCanonical = document.querySelector('link[rel="canonical"]');
    if (existingCanonical) {
      existingCanonical.remove();
    }

    return () => {
      if (created && metaTag.parentNode) {
        metaTag.parentNode.removeChild(metaTag);
      } else if (metaTag) {
        metaTag.content = previousContent || "index, follow";
      }
      // Note: We deliberately do NOT restore previous canonical tags on unmount.
      // Each route owns its canonical lifecycle via usePageCanonical.
    };
  }, [enabled]);
}

export default useNoIndex;
