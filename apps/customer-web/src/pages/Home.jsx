import { useEffect, useState } from "react";
import HeroBanner from "../components/home/HeroBanner";
import CategoryGrid from "../components/category/CategoryGrid";
import ProductCard from "../components/product/ProductCard";
import { getProducts } from "../services/productService";

function Home() {
  const [products, setProducts] = useState([]);

  useEffect(() => {
    const loadProducts = async () => {
      const data = await getProducts();
      setProducts(data);
    };

    loadProducts();
  }, []);

  return (
    <div className="space-y-12 md:space-y-16">

      <HeroBanner />

      <CategoryGrid />

      <section>
        <h2 className="mb-6 text-[22px] font-bold text-[#1E1E1E]">
          Featured Products
        </h2>

        <div className="grid grid-cols-2 gap-5 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
            />
          ))}
        </div>
      </section>

    </div>
  );
}

export default Home;