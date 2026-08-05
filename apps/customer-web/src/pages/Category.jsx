import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getProductsByCategory } from "../services/productService";
import ProductCard from "../components/product/ProductCard";

function Category() {
  const { categoryId } = useParams();

  const [products, setProducts] = useState([]);

  useEffect(() => {
    const loadProducts = async () => {
      const data = await getProductsByCategory(categoryId);
      setProducts(data);
    };

    loadProducts();
  }, [categoryId]);

  return (
    <div>
      <h1 className="mb-6 text-3xl font-bold">
        Category Products
      </h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {products.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
          />
        ))}
      </div>
    </div>
  );
}

export default Category;