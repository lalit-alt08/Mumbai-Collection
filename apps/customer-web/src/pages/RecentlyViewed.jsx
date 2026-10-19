import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import ProductCard from "../components/product/ProductCard";
import { getProductsByIds } from "../services/productService";
import { getRecentlyViewedProductIds } from "../utils/recentlyViewedProducts.js";

function RecentlyViewed() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const ids = getRecentlyViewedProductIds();
    const loadProducts = async () => {
      try {
        const chunks = [];
        for (let index = 0; index < ids.length; index += 12) chunks.push(ids.slice(index, index + 12));
        const results = await Promise.all(chunks.map((chunk) => getProductsByIds(chunk)));
        if (!isMounted) return;
        const byId = new Map(results.flat().map((product) => [String(product.id), product]));
        setProducts(ids.map((id) => byId.get(String(id))).filter(Boolean));
      } catch {
        if (isMounted) setProducts([]);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    loadProducts();
    return () => { isMounted = false; };
  }, []);

  return (
    <main className="min-h-screen bg-[#0B1425] px-4 pt-4 pb-28 text-white sm:px-6 md:pt-8 md:pb-16">
      <div className="mx-auto max-w-7xl space-y-4 sm:space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              aria-label="Back to home"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[#1E3252] bg-[#111F36] text-white shadow-xs transition-all hover:border-[#42D6E8] hover:bg-[#162744] hover:text-[#42D6E8] active:scale-95"
            >
              <ArrowLeft size={17} strokeWidth={2.2} />
            </Link>
            <h1 className="text-lg font-bold tracking-tight text-white sm:text-xl">Recently Viewed</h1>
          </div>
          <span className="rounded-full border border-[#1E3E63] bg-[#132B45] px-3 py-1 text-xs font-bold text-[#42D6E8]">
            {loading ? "Loading…" : `${products.length} ${products.length === 1 ? "item" : "items"}`}
          </span>
        </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3.5 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
          {[1, 2, 3, 4, 5, 6].map((item) => (
            <div key={item} className="h-72 animate-pulse rounded-[20px] border border-[#1E3252]/60 bg-[#111F36] p-3.5 shadow-xs">
              <div className="mb-3 aspect-square w-full rounded-[14px] bg-[#080F1C]" />
              <div className="mb-2 h-4 w-3/4 rounded bg-[#162744]" />
              <div className="h-4 w-1/2 rounded bg-[#162744]" />
            </div>
          ))}
        </div>
      ) : products.length ? (
        <div className="grid grid-cols-2 gap-3.5 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
      ) : (
        <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-[24px] border border-[#1E3252] bg-[#111F36] p-8 text-center shadow-[0_8px_30px_rgba(0,0,0,0.3)]">
          <p className="text-sm text-[#8FA4BE]">No recently viewed products are available right now.</p>
          <Link to="/" className="mt-4 inline-flex rounded-full bg-[#42D6E8] px-5 py-2.5 text-xs font-bold text-[#061220]">Browse products</Link>
        </div>
      )}
      </div>
    </main>
  );
}

export default RecentlyViewed;
