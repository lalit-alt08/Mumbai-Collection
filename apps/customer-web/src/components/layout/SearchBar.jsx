import { Search, Loader2, ShoppingCart } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { searchProducts } from "../../services/productService";
import { cleanProductTitle } from "../../utils/productUtils";

function SearchBar() {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const location = useLocation();
  const isHomePage = location.pathname === "/";

  const searchRef = useRef(null);
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setQuery("");
        setProducts([]);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const normalizedQuery = query.trim();
    const requestId = ++requestIdRef.current;

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    if (normalizedQuery.length < 2) {
      setProducts([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const timer = setTimeout(async () => {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      try {
        const data = await searchProducts(normalizedQuery, { signal: controller.signal });
        if (requestId !== requestIdRef.current || controller.signal.aborted) return;
        setProducts(Array.isArray(data) ? data : []);
      } catch (error) {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return;
        setProducts([]);
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
          abortControllerRef.current = null;
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      abortControllerRef.current?.abort();
    };
  }, [query]);

  const surfaceClasses = isHomePage
    ? "bg-[#0E1A2E]/90 border border-[#1E3252]/50"
    : "bg-[#0B1425]/95 border border-[#1E3252]/50";

  return (
    <div ref={searchRef} className="w-full">
      {/* Search Input Capsule */}
      <div
        className={`w-full rounded-full ${surfaceClasses} backdrop-blur-md shadow-[0_4px_20px_rgba(0,0,0,0.35)] transition-all duration-200 focus-within:border-[#42D6E8]/70 focus-within:shadow-[0_4px_20px_rgba(66,214,232,0.15)]`}
      >
        <div className="relative flex items-center w-full h-11 px-3.5 sm:px-4">
          {/* Cyan Outline Search Icon */}
          <Search
            size={18}
            strokeWidth={2.2}
            className="text-[#42D6E8] shrink-0 pointer-events-none transition-colors"
          />

          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for products..."
            className="
              h-full
              w-full
              bg-transparent
              border-0
              outline-none
              pl-2.5
              pr-7
              text-xs
              sm:text-sm
              md:text-[14px]
              font-medium
              text-white
              placeholder:text-[#8FA4BE]
              focus:outline-none
              focus:ring-0
            "
          />

          {/* Loading Spinner */}
          {isLoading && (
            <Loader2
              size={16}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-[#42D6E8]"
            />
          )}
        </div>
      </div>

      {/* Autocomplete Results Dropdown */}
      {query && !isLoading && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[60vh] overflow-y-auto overflow-x-hidden rounded-[22px] border border-[#1E3252] bg-[#111F36] shadow-[0_16px_50px_rgba(0,0,0,0.6)] animate-[fadeIn_0.15s_ease-out]">
          {/* Dropdown Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#1E3252] bg-[#111F36]/95 px-4 py-2.5 text-xs font-bold text-[#8FA4BE] backdrop-blur-sm">
            <span>Product suggestions</span>
            <span className="text-[#42D6E8]">{products.length} found</span>
          </div>

          {products.length > 0 ? (
            <div className="flex flex-col divide-y divide-[#1E3252]">
              {products.map((product) => {
                const categoryName = product.categories?.[0]?.name;
                return (
                  <Link
                    key={product.id}
                    to={`/product/${product.id}`}
                    onClick={() => {
                      setQuery("");
                      setProducts([]);
                    }}
                    className="group flex cursor-pointer items-center justify-between bg-[#111F36] px-4 py-3 transition-colors hover:bg-[#162744]"
                  >
                    <div className="flex flex-1 items-center gap-3 pr-2 min-w-0">
                      {/* Image */}
                      <div className="flex h-12 w-12 sm:h-14 sm:w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#080F1C] p-1 border border-[#1E3252]">
                        <img
                          src={product.images?.[0]?.src}
                          alt={product.name}
                          className="h-full w-full object-contain"
                        />
                      </div>

                      {/* Info */}
                      <div className="flex flex-col justify-center min-w-0">
                        <h3 className="line-clamp-2 text-xs sm:text-sm font-bold leading-snug text-white group-hover:text-[#42D6E8] transition-colors">
                          {cleanProductTitle(product.name)}
                        </h3>

                        {categoryName && (
                          <div className="mt-0.5 flex items-center">
                            <span className="rounded-md bg-[#132B45] px-1.5 py-0.2 text-[10px] font-bold text-[#67E8F9] border border-[#1E3E63]">
                              {categoryName}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Price & CTA */}
                    <div className="flex flex-col items-end shrink-0 pl-2">
                      <span className="text-xs sm:text-sm font-extrabold text-white">
                        ₹{product.price}
                      </span>
                      <div className="mt-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#132B45] text-[#42D6E8] transition-colors group-hover:bg-[#42D6E8] group-hover:text-[#061220]">
                        <ShoppingCart size={12} strokeWidth={2.5} />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-[#162744] text-gray-400">
                <Search size={18} />
              </div>
              <p className="text-xs sm:text-sm font-bold text-white">No products found</p>
              <p className="text-[11px] text-[#6E84A3] mt-0.5">Try searching with a different keyword</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SearchBar;
