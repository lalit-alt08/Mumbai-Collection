import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getProductById } from "../services/productService";

import ProductGallery from "../components/product/ProductGallery";
import ProductInfo from "../components/product/ProductInfo";
import ProductDescription from "../components/product/ProductDescription";
import ProductReviews from "../components/product/ProductReviews";
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
      } catch {
        setProduct(null);
      } finally {
        setLoading(false);
      }
    };

    loadProduct();
  }, [id]);

  // Dynamic SEO Title & Meta Description
  useEffect(() => {
    if (product?.name) {
      document.title = `${product.name} | Mumbai Collection`;

      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) {
        const cleanDesc = product.short_description
          ? product.short_description.replace(/<[^>]+>/g, "").trim().slice(0, 160)
          : `Buy ${product.name} online at Mumbai Collection, Vasai. Best prices and fast delivery.`;
        metaDesc.setAttribute("content", cleanDesc);
      }
    }
    return () => {
      document.title = "Mumbai Collection | Toys & Stationery Store";
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) {
        metaDesc.setAttribute(
          "content",
          "Shop toys, stationery, school supplies, and everyday essentials at Mumbai Collection in Vasai."
        );
      }
    };
  }, [product]);

  // Product JSON-LD Structured Data Schema for Search Engines
  useEffect(() => {
    if (!product) return;

    const scriptId = "product-jsonld";
    let script = document.getElementById(scriptId);
    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.type = "application/ld+json";
      document.head.appendChild(script);
    }

    const schema = {
      "@context": "https://schema.org/",
      "@type": "Product",
      name: product.name,
      image: product.images?.[0]?.src || product.image || "",
      description: product.short_description
        ? product.short_description.replace(/<[^>]+>/g, "").trim()
        : product.name,
      sku: product.sku || String(product.id),
      offers: {
        "@type": "Offer",
        priceCurrency: "INR",
        price: product.price || product.regular_price || "0",
        availability:
          product.in_stock !== false
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
        seller: {
          "@type": "Organization",
          name: "Mumbai Collection",
        },
      },
    };
    script.textContent = JSON.stringify(schema);

    return () => {
      const el = document.getElementById(scriptId);
      if (el) el.remove();
    };
  }, [product]);

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
      <div className="flex min-h-[60vh] flex-col items-center justify-center bg-[#F7F7FB] px-4 text-center">
        <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-white shadow-sm">
          <span className="text-4xl">🛍️</span>
        </div>
        <h2 className="mb-2 text-2xl font-bold text-[#1F2937]">Product Not Found</h2>
        <p className="mb-8 text-[#6B7280]">The product you are looking for does not exist or has been removed.</p>
        <button
          onClick={() => navigate("/")}
          className="rounded-full bg-[#7C3AED] px-8 py-3 font-semibold text-white shadow-[0_4px_16px_rgba(124,58,237,0.25)] transition-all hover:bg-[#6C35E8] active:scale-95 cursor-pointer"
        >
          Return Home
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F7FB] text-[#1F2937]">
      <div className="mx-auto w-full max-w-3xl pb-32 lg:max-w-7xl lg:px-8 lg:pb-12">
        <section key={product.id} className="lg:grid lg:grid-cols-[45%_1fr] lg:gap-10 lg:pt-8">
          <div className="lg:sticky lg:top-8 h-fit z-10 w-full">
            <ProductGallery product={product} />
          </div>
          <div className="p-4 space-y-4 lg:p-0 z-20 w-full">
            <ProductInfo product={product} />
            <ProductDescription product={product} />
            <ProductReviews productId={product.id} />
            <RelatedProducts product={product} />
          </div>
        </section>
      </div>
    </div>
  );
}

export default ProductDetails;