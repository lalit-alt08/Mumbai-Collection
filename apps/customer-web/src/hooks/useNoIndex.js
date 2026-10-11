import { useEffect } from "react";

/**
 * Hook to inject <meta name="robots" content="noindex, nofollow" /> on private/sensitive customer routes
 * (Cart, Checkout, Account, Orders, Auth, NotFound/Soft-404) to prevent indexing while preserving clean history.
 */
export function useNoIndex() {
  useEffect(() => {
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

    return () => {
      if (created && metaTag.parentNode) {
        metaTag.parentNode.removeChild(metaTag);
      } else if (metaTag) {
        metaTag.content = previousContent || "index, follow";
      }
    };
  }, []);
}

export default useNoIndex;
