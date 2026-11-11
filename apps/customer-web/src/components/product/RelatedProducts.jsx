import { useEffect, useState } from "react";
import { getProductsByIds, getRelatedProducts } from "../../services/productService";
import { getProductStock } from "../../utils/productUtils";
import ProductCard from "./ProductCard";
import { useLiveProductStock } from "../../hooks/useLiveProductStock";

function RelatedProducts({ product }) {
  const [products, setProducts] = useState([]);
  useLiveProductStock(products, setProducts);

  const productId = product?.id;
  const primaryCategoryId =
    typeof product?.categories?.[0] === "object"
      ? product?.categories?.[0]?.id
      : product?.categories?.[0];
  const configuredIds = Array.isArray(product?.upsell_ids) && product.upsell_ids.length > 0
    ? product.upsell_ids
    : Array.isArray(product?.cross_sell_ids)
      ? product.cross_sell_ids
      : [];
  const configuredIdsKey = [...new Set(configuredIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0 && id !== Number(productId)))]
    .slice(0, 8)
    .join(",");

  useEffect(() => {
    const controller = new AbortController();
    let isMounted = true;
    setProducts([]);

    const loadRelatedProducts = async () => {
      if (!productId) return;

      try {
        const curatedIds = configuredIdsKey ? configuredIdsKey.split(",").map(Number) : [];
        if (curatedIds.length > 0) {
          const curatedProducts = await getProductsByIds(curatedIds, { signal: controller.signal });
          if (controller.signal.aborted || !isMounted) return;
          const productById = new Map(curatedProducts.map((item) => [Number(item.id), item]));
          const orderedCurated = curatedIds
            .map((id) => productById.get(id))
            .filter((item) => item && !getProductStock(item).isOutOfStock);
          if (isMounted && !controller.signal.aborted && orderedCurated.length > 0) {
            setProducts(orderedCurated.slice(0, 6));
            return;
          }
        }

        let data = [];
        if (primaryCategoryId) {
          data = await getRelatedProducts(
            primaryCategoryId,
            productId,
            { signal: controller.signal }
          );
        }

        let inStock = (Array.isArray(data) ? data : [])
          .filter((item) => !getProductStock(item).isOutOfStock);

        // Fallback: If category has no other in-stock products, fetch store recommendations
        if (inStock.length === 0) {
          const fallbackData = await getRelatedProducts(
            undefined,
            productId,
            { signal: controller.signal }
          );
          if (isMounted && !controller.signal.aborted) {
            inStock = (Array.isArray(fallbackData) ? fallbackData : [])
              .filter((item) => !getProductStock(item).isOutOfStock);
          }
        }

        if (isMounted && !controller.signal.aborted) {
          setProducts(inStock.slice(0, 6));
        }
      } catch (err) {
        if (controller.signal.aborted || err.name === "CanceledError" || err.code === "ERR_CANCELED") return;
        if (isMounted) setProducts([]);
      }
    };

    loadRelatedProducts();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [productId, primaryCategoryId, configuredIdsKey]);

  if (!products.length) return null;

  return (
    <section className="rounded-[24px] bg-[#FFFFFF] border border-[#E2E8F0]/80 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.25)] md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[15px] sm:text-[16px] font-bold uppercase tracking-wide text-[#1E293B]">
          You may also like
        </h2>
        <span className="text-xs text-[#64748B] font-medium">
          {products.length} item{products.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {products.map((item) => (
          <div key={item.id} className="min-w-0 h-full flex flex-col">
            <ProductCard product={item} />
          </div>
        ))}
      </div>
    </section>
  );
}

export default RelatedProducts;
