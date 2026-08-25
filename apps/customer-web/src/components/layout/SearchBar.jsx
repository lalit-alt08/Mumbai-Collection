import { Search, Loader2, ShoppingCart } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { searchProducts } from "../../services/productService";

function SearchBar() {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const searchRef = useRef(null);

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
    if (!query.trim()) {
      setProducts([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await searchProducts(query);
        setProducts(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error("Product search error:", error);
        setProducts([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div ref={searchRef} className="relative w-full">
      <div className="relative flex items-center w-full">
        {/* Compact Lavender Outline Search Icon */}
        <Search
          size={18}
          strokeWidth={2.2}
          className="absolute left-3.5 sm:left-4 text-[#8B5CF6] pointer-events-none transition-colors"
        />

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for products, categories..."
          className="
            h-[42px]
            sm:h-[46px]
            md:h-[44px]
            lg:h-[46px]
            w-full
            rounded-full
            border-2
            border-[#DDD6FE]
            bg-white
            pl-10
            sm:pl-11
            pr-10
            text-xs
            sm:text-sm
            md:text-[14px]
            font-medium
            text-[#1E1E1E]
            outline-none
            shadow-xs
            transition-all
            duration-200
            placeholder:text-[#94A3B8]
            focus:border-[#8B5CF6]
            focus:ring-3
            focus:ring-[#8B5CF6]/15
          "
        />

        {/* Loading Spinner */}
        {isLoading && (
          <Loader2
            size={16}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-[#8B5CF6]"
          />
        )}
      </div>

      {/* Autocomplete Results Dropdown */}
      {query && !isLoading && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[60vh] overflow-y-auto overflow-x-hidden rounded-[22px] border border-[#EDE9FE] bg-white shadow-[0_16px_50px_rgba(0,0,0,0.12)] animate-[fadeIn_0.15s_ease-out]">
          {/* Dropdown Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white/95 px-4 py-2.5 text-xs font-bold text-gray-500 backdrop-blur-sm">
            <span>Suggestions</span>
            <span className="text-[#8B5CF6]">{products.length} found</span>
          </div>

          {products.length > 0 ? (
            <div className="flex flex-col divide-y divide-gray-100">
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
                    className="group flex cursor-pointer items-center justify-between bg-white px-4 py-3 transition-colors hover:bg-[#F9F7FF]"
                  >
                    <div className="flex flex-1 items-center gap-3 pr-2 min-w-0">
                      {/* Image */}
                      <div className="flex h-12 w-12 sm:h-14 sm:w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#FAFBFD] p-1 border border-gray-100">
                        <img
                          src={product.images?.[0]?.src}
                          alt={product.name}
                          className="h-full w-full object-contain mix-blend-multiply"
                        />
                      </div>

                      {/* Info */}
                      <div className="flex flex-col justify-center min-w-0">
                        <h3 className="line-clamp-1 text-xs sm:text-sm font-bold text-[#111827]">
                          {product.name}
                        </h3>

                        {categoryName && (
                          <div className="mt-0.5 flex items-center">
                            <span className="rounded-md bg-[#EDE9FE] px-1.5 py-0.2 text-[10px] font-bold text-[#6D28D9]">
                              {categoryName}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Price & CTA */}
                    <div className="flex flex-col items-end shrink-0 pl-2">
                      <span className="text-xs sm:text-sm font-extrabold text-[#111827]">
                        ₹{product.price}
                      </span>
                      <div className="mt-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#EDE9FE] text-[#7C3AED] transition-colors group-hover:bg-[#7C3AED] group-hover:text-white">
                        <ShoppingCart size={12} strokeWidth={2.5} />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-[#FAF8FF] text-gray-400">
                <Search size={18} />
              </div>
              <p className="text-xs sm:text-sm font-bold text-[#111827]">No products found</p>
              <p className="text-[11px] text-gray-500 mt-0.5">Try searching with a different keyword</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SearchBar;