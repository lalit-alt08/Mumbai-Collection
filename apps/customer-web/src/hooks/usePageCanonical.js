import { useEffect } from "react";

/**
 * Route-level canonical URL manager.
 * Ensures exactly one canonical tag matching the active route exists in <head>.
 * When the route unmounts, the tag is completely removed so it never carries
 * over to subsequent pages or conflicting error states.
 *
 * @param {string|null|undefined} canonicalUrl - Full URL (e.g. "https://mumbaicollections.in/product/7510") or null to omit
 */
export function usePageCanonical(canonicalUrl) {
  useEffect(() => {
    if (!canonicalUrl) {
      const existing = document.querySelector('link[rel="canonical"]');
      if (existing) existing.remove();
      return;
    }

    let link = document.querySelector('link[rel="canonical"]');
    let created = false;

    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
      created = true;
    }

    link.setAttribute("href", canonicalUrl);

    return () => {
      // Clean up canonical tag on unmount so no previous URL lingers on the next route
      if (link && link.parentNode) {
        link.parentNode.removeChild(link);
      }
    };
  }, [canonicalUrl]);
}

export default usePageCanonical;
