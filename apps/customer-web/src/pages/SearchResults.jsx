import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import ProductCard from "../components/product/ProductCard";
import { searchProducts } from "../services/productService";

const RESULTS_PER_PAGE = 20;

function SearchResults() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = (searchParams.get("q") || "").trim();
  const parsedPage = Number.parseInt(searchParams.get("page") || "1", 10);
  const page = Number.isFinite(parsedPage) ? Math.max(1, Math.min(10000, parsedPage)) : 1;
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    if (query.length < 2) {
      setProducts([]);
      setTotal(0);
      setTotalPages(0);
      setLoading(false);
      setError("");
      return () => controller.abort();
    }

    setLoading(true);
    setError("");
    searchProducts(query, {
      page,
      perPage: RESULTS_PER_PAGE,
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        setProducts(Array.isArray(data?.products) ? data.products : []);
        setTotal(Number(data?.total) || 0);
        setTotalPages(Number(data?.totalPages) || 0);
      })
      .catch((requestError) => {
        if (controller.signal.aborted) return;
        setProducts([]);
        setTotal(0);
        setTotalPages(0);
        setError(requestError?.response?.data?.message || "Search couldn’t load. Check your connection and try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [query, page, retryCount]);

  const updatePage = (nextPage) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextPage <= 1) next.delete("page");
      else next.set("page", String(nextPage));
      return next;
    });
  };

  const firstResult = total === 0 ? 0 : (page - 1) * RESULTS_PER_PAGE + 1;
  const lastResult = Math.min(page * RESULTS_PER_PAGE, total);

  return (
    <main className="min-h-screen w-full bg-[#0B1425] px-4 pb-28 pt-4 text-white sm:px-6 md:pt-7">
      <div className="mx-auto max-w-7xl space-y-4 sm:space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-[#1E3252]/80 pb-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#42D6E8]">Store search</p>
            <h1 className="mt-1 text-xl font-extrabold tracking-tight sm:text-2xl">
              Results for “{query || "…"}”
            </h1>
          </div>
          <p className="pb-0.5 text-xs font-medium text-[#8FA4BE]">
            {loading ? "Searching…" : `${total} ${total === 1 ? "product" : "products"} found`}
          </p>
        </header>

        {query.length < 2 ? (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-[#1E3252] bg-[#111F36] p-8 text-center">
            <Search size={24} className="mb-3 text-[#42D6E8]" />
            <h2 className="font-bold">Enter at least 2 characters</h2>
            <p className="mt-1 text-sm text-[#8FA4BE]">Use the search box above to find products.</p>
          </div>
        ) : loading ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="aspect-[0.72] animate-pulse rounded-2xl border border-[#1E3252] bg-[#111F36]" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-400/30 bg-[#111F36] p-8 text-center">
            <p role="alert" className="mb-4 text-sm text-rose-200">{error}</p>
            <button
              type="button"
              onClick={() => setRetryCount((count) => count + 1)}
              className="rounded-full bg-[#42D6E8] px-5 py-2.5 text-sm font-bold text-[#061220]"
            >
              Retry search
            </button>
          </div>
        ) : products.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-[#1E3252] bg-[#111F36] p-8 text-center">
            <Search size={24} className="mb-3 text-[#8FA4BE]" />
            <h2 className="font-bold">No products found</h2>
            <p className="mt-1 text-sm text-[#8FA4BE]">Try another search term.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
              {products.map((product) => (
                <div key={product.id} className="min-w-0">
                  <ProductCard product={product} />
                </div>
              ))}
            </div>
            {totalPages > 1 && (
              <nav aria-label="Search result pages" className="flex flex-col items-center justify-center gap-3 pt-3 sm:flex-row sm:justify-between">
                <p className="text-xs text-[#8FA4BE]">Showing {firstResult}–{lastResult} of {total}</p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => updatePage(page - 1)}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#263E63] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ArrowLeft size={16} /> Previous
                  </button>
                  <span className="text-xs font-semibold text-[#8FA4BE]">Page {page} of {totalPages}</span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => updatePage(page + 1)}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#263E63] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next <ArrowRight size={16} />
                  </button>
                </div>
              </nav>
            )}
          </>
        )}
      </div>
    </main>
  );
}

export default SearchResults;
