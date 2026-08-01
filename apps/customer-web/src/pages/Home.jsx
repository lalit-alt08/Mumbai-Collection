import { useEffect, useState } from "react";
import ProductCard from "../components/product/ProductCard";
import { getProducts } from "../services/productService";
import HeroBanner from "../layouts/HeroBanner";

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
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <HeroBanner/>
      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
        />
      ))}
    </div>
  );
}

export default Home;