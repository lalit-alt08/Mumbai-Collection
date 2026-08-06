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
    <section>
      <h2 className="mb-8 text-[22px] font-bold text-[#1E1E1E]">
        Related Products
      </h2>

      <div className="grid grid-cols-2 gap-5 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
        {products.map((item) => (
          <ProductCard
            key={item.id}
            product={item}
          />
        ))}
      </div>
    </section>
  );
}

export default RelatedProducts;