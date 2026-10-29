import { useEffect, useState } from "react";
import { getProductsByIds } from "../../services/productService";
import ProductCard from "../product/ProductCard";
import { useLiveProductStock } from "../../hooks/useLiveProductStock";

function CartCrossSells({ items = [] }) {
  const [products, setProducts] = useState([]);
  useLiveProductStock(products, setProducts);
  const cartIdsKey = [...new Set(items.map((item) => Number(item.id)).filter((id) => Number.isSafeInteger(id) && id > 0))]
    .slice(0, 12)
    .join(",");

  useEffect(() => {
    let active = true;
    setProducts([]);
    const cartIds = cartIdsKey ? cartIdsKey.split(",").map(Number) : [];
    if (cartIds.length === 0) return () => { active = false; };

    const loadCrossSells = async () => {
      try {
        const cartProducts = await getProductsByIds(cartIds, { details: "cross-sells" });
        const candidates = [...new Set(cartProducts.flatMap((product) =>
          Array.isArray(product.cross_sell_ids) ? product.cross_sell_ids.map(Number) : []
        ))]
          .filter((id) => Number.isSafeInteger(id) && id > 0 && !cartIds.includes(id))
          .slice(0, 12);
        if (candidates.length === 0) return;

        const suggested = await getProductsByIds(candidates);
        const suggestionsById = new Map(suggested.map((product) => [Number(product.id), product]));
        const ordered = candidates.map((id) => suggestionsById.get(id)).filter(Boolean).slice(0, 4);
        if (active) setProducts(ordered);
      } catch {
        if (active) setProducts([]);
      }
    };

    loadCrossSells();
    return () => { active = false; };
  }, [cartIdsKey]);

  if (products.length === 0) return null;

  return (
    <section className="rounded-[22px] border border-[#1E3252]/80 bg-[#111F36] p-4 shadow-[0_6px_22px_rgba(0,0,0,0.2)] sm:p-5">
      <div className="mb-4">
        <h2 className="text-sm font-extrabold text-[#F1F5F9] sm:text-base">Goes well with your cart</h2>
        <p className="mt-1 text-xs font-medium text-[#8FA4BE]">Store-selected additions you can add in one tap</p>
      </div>
      <div className="flex snap-x gap-3 overflow-x-auto pb-2 pt-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible lg:grid-cols-4">
        {products.map((product) => (
          <div key={product.id} className="flex h-full w-[160px] shrink-0 snap-start flex-col sm:w-auto">
            <ProductCard product={product} />
          </div>
        ))}
      </div>
    </section>
  );
}

export default CartCrossSells;
