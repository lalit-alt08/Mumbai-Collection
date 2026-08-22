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
        setProducts(data);
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div ref={searchRef} className="relative w-full">
      <Search
        size={20}
        className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
      />

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search products..."
        className="
          w-full
          rounded-full
          border
          border-[#CCCCCC]
          bg-white
          py-3.5
          pl-12
          pr-12
          text-sm
          text-[#1E1E1E]
          outline-none
          shadow-[0_4px_24px_rgba(0,0,0,0.02)]
          transition-all
          duration-300
          placeholder:text-[#666666]
          focus:border-[#7C3AED]
          focus:ring-4
          focus:ring-[#7C3AED]/20
          animate-[breathingGlow_2s_infinite_alternate]
          focus:animate-none
          focus:shadow-[0_0_20px_rgba(124,58,237,0.3)]
          md:text-base
        "
      />

      {/* Loading Spinner */}
      {isLoading && (
        <Loader2
          size={20}
          className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-[#7C3AED]"
        />
      )}

      {query && !isLoading && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[60vh] overflow-y-auto overflow-x-hidden rounded-[20px] border border-[#ECECEC] bg-white shadow-2xl animate-[fadeIn_0.15s_ease-out]">
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#ECECEC] bg-white/95 px-4 py-3 text-[13px] font-medium backdrop-blur-sm">
            <span className="text-[#666666]">🔥 Top Suggestions</span>
            <span className="cursor-pointer text-[#7C3AED] hover:underline">
              View all results &rarr;
            </span>
          </div>

          {products.length > 0 ? (
            <div className="flex flex-col">
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
                    className="group flex cursor-pointer items-center justify-between border-b border-[#ECECEC] bg-white px-4 py-4 transition-colors duration-200 hover:bg-[#F1ECFF]"
                  >
                    <div className="flex flex-1 items-center gap-4 pr-2">
                      {/* LEFT: Image */}
                      <div className="flex h-[72px] w-[72px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-[#F7F8FA] p-1">
                        <img
                          src={product.images?.[0]?.src}
                          alt={product.name}
                          className="h-full w-full object-contain mix-blend-multiply"
                        />
                      </div>

                      {/* CENTER: Info */}
                      <div className="flex flex-col justify-center">
                        <h3 className="line-clamp-2 text-[14px] font-semibold text-[#1E1E1E] leading-snug">
                          {product.name}
                        </h3>
                        
                        {categoryName && (
                          <div className="mt-1.5 flex items-center">
                            <span className="rounded-[6px] bg-[#F1ECFF] px-2 py-0.5 text-[11px] font-semibold text-[#7C3AED]">
                              {categoryName}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* RIGHT: Price & CTA */}
                    <div className="flex flex-col items-end flex-shrink-0">
                      <span className="text-[15px] font-bold text-[#7C3AED]">
                        ₹{product.price}
                      </span>
                      <div className="mt-2 flex h-8 w-8 items-center justify-center rounded-full bg-[#F1ECFF] text-[#7C3AED] transition-all duration-200 group-hover:bg-[#7C3AED] group-hover:text-white">
                        <ShoppingCart size={14} strokeWidth={2.5} />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-10 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#F7F8FA]">
                <Search size={24} className="text-[#999999]" />
              </div>
              <p className="text-[15px] font-semibold text-[#1E1E1E]">No products found</p>
              <p className="mt-1 text-[13px] text-[#666666]">Try another keyword</p>
            </div>
          )}
          
          <style dangerouslySetInnerHTML={{__html: `
            @keyframes fadeIn {
              from { opacity: 0; transform: scale(0.98); }
              to { opacity: 1; transform: scale(1); }
            }
            @keyframes breathingGlow {
              0% { box-shadow: 0 4px 15px rgba(124, 58, 237, 0.05); border-color: #CCCCCC; }
              100% { box-shadow: 0 4px 25px rgba(124, 58, 237, 0.35); border-color: rgba(124, 58, 237, 0.6); }
            }
          `}} />
        </div>
      )}
    </div>
  );
}

export default SearchBar;