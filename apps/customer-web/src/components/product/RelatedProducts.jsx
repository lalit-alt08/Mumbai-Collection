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
    <section className="py-4">
      <h2 className="mb-4 text-[16px] font-bold text-[#1F2937]">
        You may also like
      </h2>
      <div className="flex gap-4 overflow-x-auto pb-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] md:grid md:grid-cols-4 md:overflow-visible">
        {products.map((item) => (
          <div key={item.id} className="w-[160px] flex-shrink-0 md:w-auto">
            <ProductCard product={item} />
          </div>
        ))}
      </div>
    </section>
  );
}

export default RelatedProducts;