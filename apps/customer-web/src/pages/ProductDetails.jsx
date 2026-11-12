import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getProductById } from "../services/productService";
import { recordRecentlyViewedProduct } from "../utils/recentlyViewedProducts.js";

import ProductGallery from "../components/product/ProductGallery";
import ProductInfo from "../components/product/ProductInfo";
import ProductDescription from "../components/product/ProductDescription";
import ProductReviews from "../components/product/ProductReviews";
import RelatedProducts from "../components/product/RelatedProducts";
import { useLiveProductStock } from "../hooks/useLiveProductStock";

const SESSION_SCROLL_PREFIX = "mc_product_scroll_";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes idle expiration

function getSavedProductScroll(productId) {
  if (typeof window === "undefined" || !productId) return null;
  try {
    const raw = sessionStorage.getItem(`${SESSION_SCROLL_PREFIX}${productId}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data.scrollY !== "number") return null;
    if (Date.now() - (data.timestamp || 0) > SESSION_TIMEOUT_MS) {
      sessionStorage.removeItem(`${SESSION_SCROLL_PREFIX}${productId}`);
      return null;
    }
    return data;
  } catch (_) {
    return null;
  }
}

function ProductDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  useLiveProductStock(product, setProduct);

  const abortControllerRef = useRef(null);
  const activeIdRef = useRef(id);
  activeIdRef.current = id;

  const savedScrollRef = useRef(getSavedProductScroll(id));
  const hasRestoredScrollRef = useRef(false);

  useEffect(() => {
    savedScrollRef.current = getSavedProductScroll(id);
    hasRestoredScrollRef.current = false;
  }, [id]);

  // Restore scroll position once product data is loaded & rendered
  useEffect(() => {
    if (!product || hasRestoredScrollRef.current) return;
    const targetY = savedScrollRef.current?.scrollY;
    if (typeof targetY === "number" && targetY > 0) {
      hasRestoredScrollRef.current = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.scrollTo({ top: targetY, left: 0, behavior: "instant" });
        });
      });
    }
  }, [product]);

  // Continuously record scroll position and timestamp for current product in sessionStorage
  useEffect(() => {
    let ticking = false;
    const savePosition = () => {
      if (window.scrollY > 0 && id) {
        try {
          sessionStorage.setItem(
            `${SESSION_SCROLL_PREFIX}${id}`,
            JSON.stringify({
              scrollY: Math.round(window.scrollY),
              timestamp: Date.now(),
            })
          );
        } catch (_) {}
      }
    };

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          savePosition();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      savePosition();
      window.removeEventListener("scroll", handleScroll);
    };
  }, [id]);

  useEffect(() => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const currentId = id;

    const loadProduct = async () => {
      setLoading(true);
      try {
        const data = await getProductById(currentId, { signal: controller.signal });
        if (controller.signal.aborted || activeIdRef.current !== currentId) return;
        setProduct(data);
      } catch (err) {
        if (controller.signal.aborted || err.name === "CanceledError" || err.code === "ERR_CANCELED") return;
        if (activeIdRef.current !== currentId) return;
        setProduct(null);
      } finally {
        if (!controller.signal.aborted && activeIdRef.current === currentId) {
          setLoading(false);
        }
      }
    };

    loadProduct();

    return () => {
      controller.abort();
    };
  }, [id]);

  useEffect(() => {
    if (product?.id) recordRecentlyViewedProduct(product.id);
  }, [product?.id]);

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
      <div className="min-h-screen bg-[#F0F8E8] pb-24">
        <div className="h-[450px] w-full animate-pulse bg-[#FFFFFF] border-b border-[#E2E8F0]/60 lg:rounded-b-[32px]"></div>
        <div className="mx-auto max-w-3xl p-4 space-y-4 lg:max-w-7xl lg:px-8 mt-6">
          <div className="h-10 w-3/4 animate-pulse rounded-2xl bg-[#FFFFFF] border border-[#E2E8F0]/60 shadow-sm"></div>
          <div className="h-40 w-full animate-pulse rounded-[24px] bg-[#FFFFFF] border border-[#E2E8F0]/60 shadow-sm"></div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center bg-[#F0F8E8] px-4 text-center">
        <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-[#FFFFFF] border border-[#E2E8F0] shadow-sm">
          <span className="text-4xl">🛍️</span>
        </div>
        <h2 className="mb-2 text-2xl font-bold text-[#1E293B]">Product Not Found</h2>
        <p className="mb-8 text-[#64748B]">The product you are looking for does not exist or has been removed.</p>
        <button
          onClick={() => navigate("/")}
          className="rounded-full bg-[#22499F] px-8 py-3 font-semibold text-[#FFFFFF] shadow-[0_4px_16px_rgba(66,214,232,0.25)] transition-all hover:bg-[#1B3B82] active:scale-95 cursor-pointer font-extrabold"
        >
          Return Home
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F8E8] text-[#1E293B]">
      <div className="mx-auto w-full max-w-3xl pb-32 lg:max-w-7xl lg:px-8 lg:pb-12">
        <section key={product.id} className="lg:grid lg:grid-cols-[45%_1fr] lg:gap-10 lg:pt-8">
          <div className="lg:sticky lg:top-8 h-fit z-10 w-full">
            <ProductGallery product={product} />
          </div>
          <div className="p-4 space-y-4 lg:p-0 z-20 w-full">
            <ProductInfo product={product} />
            <ProductDescription product={product} />
            <RelatedProducts product={product} />
            <ProductReviews productId={product.id} />
          </div>
        </section>
      </div>
    </div>
  );
}

export default ProductDetails;
