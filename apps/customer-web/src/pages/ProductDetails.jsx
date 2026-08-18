import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getProductById } from "../services/productService";

import ProductGallery from "../components/product/ProductGallery";
import ProductInfo from "../components/product/ProductInfo";
import ProductDescription from "../components/product/ProductDescription";
import RelatedProducts from "../components/product/RelatedProducts";

function ProductDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProduct = async () => {
      setLoading(true);
      try {
        const data = await getProductById(id);
        setProduct(data);
      } catch (error) {
        console.error(error);
        setProduct(null);
      } finally {
        setLoading(false);
      }
    };

    loadProduct();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F7F8F5] pb-24">
        <div className="h-[450px] w-full animate-pulse bg-white lg:rounded-b-[32px]"></div>
        <div className="mx-auto max-w-3xl p-4 space-y-4 lg:max-w-7xl lg:px-8 mt-6">
          <div className="h-10 w-3/4 animate-pulse rounded-2xl bg-white shadow-sm"></div>
          <div className="h-40 w-full animate-pulse rounded-[24px] bg-white shadow-sm"></div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center bg-[#F7F8F5] px-4 text-center">
        <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-white shadow-sm">
          <span className="text-4xl">🛍️</span>
        </div>
        <h2 className="mb-2 text-2xl font-bold text-[#1F2937]">Product Not Found</h2>
        <p className="mb-8 text-[#6B7280]">The product you are looking for does not exist or has been removed.</p>
        <button
          onClick={() => navigate("/")}
          className="rounded-full bg-[#FF8A00] px-8 py-3 font-semibold text-white shadow-[0_4px_16px_rgba(255,138,0,0.25)] transition-all hover:bg-[#FF7300] active:scale-95"
        >
          Return Home
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F8F5] text-[#1F2937]">
      <div className="mx-auto w-full max-w-3xl pb-32 lg:max-w-7xl lg:px-8 lg:pb-12">
        <section className="lg:grid lg:grid-cols-[45%_1fr] lg:gap-10 lg:pt-8">
          <div className="lg:sticky lg:top-8 h-fit z-10 w-full">
            <ProductGallery product={product} />
          </div>
          <div className="p-4 space-y-4 lg:p-0 z-20 w-full">
            <ProductInfo product={product} />
            <ProductDescription product={product} />
            <RelatedProducts product={product} />
          </div>
        </section>
      </div>
    </div>
  );
}

export default ProductDetails;