import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getProductById } from "../services/productService";

import ProductGallery from "../components/product/ProductGallery";
import ProductInfo from "../components/product/ProductInfo";
import ProductDescription from "../components/product/ProductDescription";
import RelatedProducts from "../components/product/RelatedProducts";

function ProductDetails() {
  const { id } = useParams();

  const [product, setProduct] = useState(null);

  useEffect(() => {
    const loadProduct = async () => {
      const data = await getProductById(id);
      setProduct(data);
    };

    loadProduct();
  }, [id]);

  if (!product) {
    return <p className="text-center py-20">Loading...</p>;
  }

  return (
    <div className="space-y-10">

      <section className="grid gap-10 lg:grid-cols-[1fr_0.9fr]">

        <ProductGallery product={product} />

        <ProductInfo product={product} />

      </section>

      <ProductDescription product={product} />

      <RelatedProducts product={product} />

    </div>
  );
}

export default ProductDetails;