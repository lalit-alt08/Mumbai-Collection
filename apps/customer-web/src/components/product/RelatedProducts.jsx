import { useEffect, useState } from "react";
import { getRelatedProducts } from "../../services/productService";
import ProductCard from "./ProductCard";

function RelatedProducts({ product }) {
  const [products, setProducts] = useState([]);

  useEffect(() => {
    const loadRelatedProducts = async () => {
      if (!product.categories?.length) return;

      const data = await getRelatedProducts(
        product.categories[0].id,
        product.id
      );

      setProducts(data);
    };

    loadRelatedProducts();
  }, [product]);

  if (!products.length) return null;

  return (
    <section className="rounded-[24px] bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.04)] md:p-6 border border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[15px] sm:text-[16px] font-bold uppercase tracking-wide text-[#1F2937]">
          You may also like
        </h2>
        <span className="text-xs text-gray-500 font-medium">
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