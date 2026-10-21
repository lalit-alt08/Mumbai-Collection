import { useEffect, useMemo, useRef } from "react";
import { getLiveProductStockByIds } from "../services/productService";

const REFRESH_INTERVAL_MS = 30_000;
const WAKE_COOLDOWN_MS = 15_000;

/** Keep visible catalog stock fresh while an installed PWA is open or resumed. */
export function useLiveProductStock(products, setProducts) {
  const productsRef = useRef(products);
  const setterRef = useRef(setProducts);
  const lastRefreshAt = useRef(0);

  useEffect(() => { productsRef.current = products; }, [products]);
  useEffect(() => { setterRef.current = setProducts; }, [setProducts]);

  const idsKey = useMemo(() => {
    const list = Array.isArray(products) ? products : products ? [products] : [];
    return [...new Set(list.map((product) => Number(product?.id)).filter((id) => Number.isSafeInteger(id) && id > 0))]
      .sort((a, b) => a - b)
      .join(",");
  }, [products]);

  useEffect(() => {
    if (!idsKey) return undefined;
    let disposed = false;
    let requestId = 0;

    const refresh = async (force = false) => {
      if (document.visibilityState !== "visible") return;
      if (!force && Date.now() - lastRefreshAt.current < WAKE_COOLDOWN_MS) return;
      const currentRequest = ++requestId;
      lastRefreshAt.current = Date.now();
      try {
        const latest = await getLiveProductStockByIds(idsKey.split(",").map(Number));
        if (disposed || currentRequest !== requestId || latest.length === 0) return;
        const stockById = new Map(latest.map((item) => [Number(item.id), item]));
        setterRef.current((current) => {
          if (Array.isArray(current)) {
            return current.map((product) => {
              const stock = stockById.get(Number(product?.id));
              return stock ? { ...product, ...stock } : product;
            });
          }
          const stock = stockById.get(Number(current?.id));
          return stock ? { ...current, ...stock } : current;
        });
      } catch {
        // A temporary network failure should not blank the catalog or block checkout.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh(true);
    };
    const onPageShow = () => refresh(true);
    const interval = window.setInterval(() => refresh(), REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    refresh(true);

    return () => {
      disposed = true;
      requestId += 1;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [idsKey]);
}

export default useLiveProductStock;
