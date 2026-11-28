import { useEffect, useState } from "react";
import { BANNERS_RECOVERY_DELAY_MS, getBanners } from "../services/productService.js";

const REFRESH_INTERVAL_MS = 5 * 60_000;

export function useHomepageBanners() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let mounted = true;
    let pending = null;
    let queuedRefresh = false;
    let timer;

    const refresh = async (force = false) => {
      if (!mounted || document.visibilityState === "hidden") return;
      if (pending !== null) {
        if (!pending && force) queuedRefresh = true;
        return;
      }
      clearTimeout(timer);
      pending = force;
      let needsRecovery = true;
      try {
        const next = await getBanners({ force });
        if (mounted) setData(next);
        needsRecovery = next.degraded === true;
      } catch {
        if (mounted) setData((current) => current ?? {});
      } finally {
        pending = null;
        if (mounted) {
          const revalidate = queuedRefresh || needsRecovery;
          const delay = queuedRefresh ? 0 : needsRecovery ? BANNERS_RECOVERY_DELAY_MS : REFRESH_INTERVAL_MS;
          queuedRefresh = false;
          timer = setTimeout(() => refresh(revalidate), delay);
        }
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    const onPageShow = (event) => {
      if (event.persisted) onVisible();
    };

    void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      mounted = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return data;
}
