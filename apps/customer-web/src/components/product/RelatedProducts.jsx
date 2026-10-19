import { useEffect, useState } from "react";
import { getProductsByIds, getRelatedProducts } from "../../services/productService";
import { getProductStock } from "../../utils/productUtils";
import ProductCard from "./ProductCard";

function RelatedProducts({ product }) {
  const [products, setProducts] = useState([]);

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
    let isMounted = true;
    setProducts([]);

    const loadRelatedProducts = async () => {
      if (!productId) return;

      try {
        const curatedIds = configuredIdsKey ? configuredIdsKey.split(",").map(Number) : [];
        if (curatedIds.length > 0) {
          const curatedProducts = await getProductsByIds(curatedIds);
          const productById = new Map(curatedProducts.map((item) => [Number(item.id), item]));
          const orderedCurated = curatedIds
            .map((id) => productById.get(id))
            .filter((item) => item && !getProductStock(item).isOutOfStock);
          if (isMounted && orderedCurated.length > 0) {
            setProducts(orderedCurated.slice(0, 6));
            return;
          }
        }

        if (!primaryCategoryId) return;
        const data = await getRelatedProducts(
          primaryCategoryId,
          productId
        );
        if (isMounted) {
          const inStock = (Array.isArray(data) ? data : [])
            .filter((item) => !getProductStock(item).isOutOfStock);
          setProducts(inStock.slice(0, 6));
        }
      } catch {
        if (isMounted) setProducts([]);
      }
    };

    loadRelatedProducts();
    return () => {
      isMounted = false;
    };
  }, [productId, primaryCategoryId, configuredIdsKey]);

  if (!products.length) return null;

  return (
    <section className="rounded-[24px] bg-[#111F36] border border-[#1E3252]/80 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.25)] md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[15px] sm:text-[16px] font-bold uppercase tracking-wide text-[#F1F5F9]">
          You may also like
        </h2>
        <span className="text-xs text-[#8FA4BE] font-medium">
          {products.length} item{products.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 pt-1 snap-x [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] sm:grid sm:grid-cols-2 lg:grid-cols-3 sm:gap-4 sm:overflow-visible">
        {products.map((item) => (
          <div key={item.id} className="w-[175px] sm:w-auto flex-shrink-0 snap-start h-full flex flex-col">
            <ProductCard product={item} />
          </div>
        ))}
      </div>
    </section>
  );
}

export default RelatedProducts;
