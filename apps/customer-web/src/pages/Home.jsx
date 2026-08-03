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
    <div className="space-y-8">

      <HeroBanner />

      <CategoryGrid />

      <section>
        <h2 className="mb-5 text-xl font-bold md:text-2xl">
          Featured Products
        </h2>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
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