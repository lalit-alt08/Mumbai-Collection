import { Search, Loader2, ChevronRight, X, AlertCircle } from "lucide-react";
import { useEffect, useRef, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { searchProducts } from "../../services/productService";
import { cleanProductTitle } from "../../utils/productUtils";

/**
 * Safely highlights matching search tokens in text without dangerouslySetInnerHTML.
 */
function HighlightMatch({ text = "", query = "" }) {
  if (!text) return null;
  const trimmed = query.trim();
  if (!trimmed) return <>{text}</>;

  const tokens = trimmed
    .split(/\s+/)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter((t) => t.length >= 2);

  if (tokens.length === 0) return <>{text}</>;

  const regex = new RegExp(`(${tokens.join("|")})`, "gi");
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, index) => {
        const isMatch = tokens.some((t) => new RegExp(`^${t}$`, "i").test(part));
        if (isMatch) {
          return (
            <span key={index} className="text-[#42D6E8] font-black">
              {part}
            </span>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

function SearchBar() {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState([]);
  const [totalResults, setTotalResults] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [imageErrors, setImageErrors] = useState({});

  const navigate = useNavigate();
  const searchRef = useRef(null);
  const inputRef = useRef(null);
  const listboxRef = useRef(null);
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef(null);
  const isDismissedRef = useRef(false);

  // Unmount abort cleanup
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Close dropdown on outside click WITHOUT wiping user input
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        isDismissedRef.current = true;
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const executeSearch = useCallback(async (searchQuery) => {
    const normalized = searchQuery.trim();
    const requestId = ++requestIdRef.current;

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    if (normalized.length < 2) {
      setProducts([]);
      setTotalResults(0);
      setIsLoading(false);
      setHasError(false);
      return;
    }

    setIsLoading(true);
    setHasError(false);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const data = await searchProducts(normalized, {
        page: 1,
        perPage: 8,
        signal: controller.signal,
      });

      if (requestId !== requestIdRef.current || controller.signal.aborted) return;

      const receivedProducts = Array.isArray(data?.products) ? data.products : [];
      setProducts(receivedProducts);
      setTotalResults(Number(data?.total) || receivedProducts.length);

      // Do NOT unconditionally reopen if dismissed or if the input is not focused
      const isContainerFocused =
        document.activeElement === inputRef.current ||
        Boolean(searchRef.current?.contains(document.activeElement));
      const shouldOpen = !isDismissedRef.current && isContainerFocused && normalized.length >= 2;
      setIsOpen(shouldOpen);
      setActiveIndex(-1);
    } catch (error) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      setHasError(true);
      setProducts([]);
      setTotalResults(0);
      const isContainerFocused =
        document.activeElement === inputRef.current ||
        Boolean(searchRef.current?.contains(document.activeElement));
      const shouldOpen = !isDismissedRef.current && isContainerFocused && normalized.length >= 2;
      setIsOpen(shouldOpen);
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    }
  }, []);

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim().length >= 2) {
        executeSearch(query);
      } else {
        setProducts([]);
        setTotalResults(0);
        setHasError(false);
        if (query.trim().length === 0) {
          setIsOpen(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [query, executeSearch]);

  const openFullResults = () => {
    const normalized = query.trim();
    if (normalized.length < 2) return;
    isDismissedRef.current = true;
    setIsOpen(false);
    setActiveIndex(-1);
    navigate(`/search?q=${encodeURIComponent(normalized)}`);
  };

  const clearInput = () => {
    // Immediately abort any active search request
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    requestIdRef.current++;
    isDismissedRef.current = true;

    setQuery("");
    setProducts([]);
    setTotalResults(0);
    setIsLoading(false);
    setHasError(false);
    setIsOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event) => {
    if (!isOpen && query.trim().length >= 2 && event.key !== "Escape") {
      isDismissedRef.current = false;
      setIsOpen(true);
    }

    if (event.key === "Escape") {
      event.preventDefault();
      isDismissedRef.current = true;
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        isDismissedRef.current = false;
        setIsOpen(true);
        return;
      }
      setActiveIndex((prev) => {
        const next = prev < products.length - 1 ? prev + 1 : 0;
        const itemEl = document.getElementById(`search-suggestion-${next}`);
        itemEl?.scrollIntoView({ block: "nearest" });
        return next;
      });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) return;
      setActiveIndex((prev) => {
        const next = prev > 0 ? prev - 1 : products.length - 1;
        const itemEl = document.getElementById(`search-suggestion-${next}`);
        itemEl?.scrollIntoView({ block: "nearest" });
        return next;
      });
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && products[activeIndex]) {
        const selected = products[activeIndex];
        isDismissedRef.current = true;
        setIsOpen(false);
        setActiveIndex(-1);
        navigate(`/product/${selected.id}`);
      } else {
        openFullResults();
      }
    }
  };

  const handleImageError = (id) => {
    setImageErrors((prev) => ({ ...prev, [id]: true }));
  };

  const surfaceClasses = "bg-[#111F36] border border-[#263E63]";

  return (
    <div ref={searchRef} className="static md:relative w-full">
      {/* Search Input Capsule */}
      <div
        className={`w-full rounded-full ${surfaceClasses} shadow-[0_2px_8px_rgba(0,0,0,0.45)] transition-all duration-200 hover:border-[#385A8A] focus-within:border-[#42D6E8] focus-within:ring-2 focus-within:ring-[#42D6E8]/20`}
      >
        <div className="relative flex items-center w-full h-11 px-3.5 sm:px-4">
          {/* Cyan Outline Search Icon */}
          <Search
            size={18}
            strokeWidth={2.3}
            className="text-[#42D6E8] shrink-0 pointer-events-none transition-colors"
            aria-hidden="true"
          />

          <input
            ref={inputRef}
            id="store-search-input"
            type="text"
            role="combobox"
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            aria-controls="search-autocomplete-listbox"
            aria-autocomplete="list"
            aria-activedescendant={
              activeIndex >= 0 ? `search-suggestion-${activeIndex}` : undefined
            }
            aria-label="Search products"
            value={query}
            onChange={(e) => {
              const nextVal = e.target.value;
              // Immediately abort pending requests and invalidate requestId on keystroke
              abortControllerRef.current?.abort();
              abortControllerRef.current = null;
              requestIdRef.current++;
              isDismissedRef.current = false;
              setActiveIndex(-1);
              // Clear stale suggestions immediately on every keystroke so previous results
              // cannot be clicked or keyboard-selected while the new request is in-flight
              setProducts([]);
              setTotalResults(0);

              setQuery(nextVal);
              if (nextVal.trim().length < 2) {
                setIsLoading(false);
                setHasError(false);
                setIsOpen(false);
              }
            }}
            onFocus={() => {
              isDismissedRef.current = false;
              if (query.trim().length >= 2 && (products.length > 0 || hasError || isLoading)) {
                setIsOpen(true);
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search for products..."
            className="
              h-full
              w-full
              bg-transparent
              border-0
              outline-none
              focus-visible:outline-none
              pl-2.5
              pr-14
              text-[13.5px]
              sm:text-sm
              md:text-[14.5px]
              font-semibold
              text-white
              placeholder:text-[#94A3B8]
              focus:outline-none
              focus:ring-0
            "
          />

          {/* Right Controls: Spinner & Clear Button */}
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {isLoading && (
              <Loader2
                size={16}
                className="animate-spin text-[#42D6E8] motion-reduce:animate-none"
                aria-label="Loading suggestions"
              />
            )}
            {query.length > 0 && (
              <button
                type="button"
                onClick={clearInput}
                aria-label="Clear search text"
                className="flex h-6 w-6 items-center justify-center rounded-full text-[#8FA4BE] hover:bg-[#1A2E4E] hover:text-white transition-colors"
              >
                <X size={14} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Autocomplete Results Dropdown */}
      {isOpen && query.trim().length >= 2 && (
        <div
          ref={listboxRef}
          id="search-autocomplete-listbox"
          role="listbox"
          aria-label="Product suggestions"
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[min(65vh,480px)] overflow-y-auto overflow-x-hidden rounded-[22px] border border-[#1E3252] bg-[#111F36] shadow-[0_16px_50px_rgba(0,0,0,0.6)] animate-[fadeIn_0.15s_ease-out] motion-reduce:animate-none"
        >
          {/* Dropdown Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#1E3252] bg-[#111F36]/95 px-4 py-2.5 text-[12.5px] sm:text-[13px] font-extrabold text-[#94A3B8] tracking-tight backdrop-blur-sm">
            <span>Product suggestions</span>
            {!isLoading && !hasError && (
              <span className="text-[#42D6E8] font-black text-[12.5px] sm:text-[13px]">{totalResults} found</span>
            )}
          </div>

          {/* Error State with Retry Button */}
          {hasError ? (
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-rose-500/10 text-rose-400">
                <AlertCircle size={18} />
              </div>
              <p className="text-xs sm:text-sm font-bold text-white">Couldn’t load suggestions</p>
              <p className="text-[11px] text-[#8FA4BE] mt-0.5">Please check your connection</p>
              <button
                type="button"
                onClick={() => {
                  isDismissedRef.current = false;
                  executeSearch(query);
                }}
                className="mt-3 rounded-full bg-[#1A2E4E] border border-[#263E63] px-3.5 py-1 text-xs font-bold text-[#42D6E8] hover:bg-[#203960] transition-colors"
              >
                Retry
              </button>
            </div>
          ) : isLoading && products.length === 0 ? (
            /* Loading State */
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <Loader2
                size={22}
                className="animate-spin text-[#42D6E8] mb-2 motion-reduce:animate-none"
              />
              <p className="text-xs text-[#8FA4BE]">Searching products...</p>
            </div>
          ) : products.length > 0 ? (
            /* Suggestions List */
            <>
              <div className="flex flex-col divide-y divide-[#1E3252]">
                {products.map((product, index) => {
                  const categoryName = product.categories?.[0]?.name;
                  const isSelected = activeIndex === index;
                  const imgUrl = product.images?.[0]?.src;
                  const hasImgError = imageErrors[product.id];

                  return (
                    <Link
                      key={product.id}
                      id={`search-suggestion-${index}`}
                      role="option"
                      aria-selected={isSelected}
                      to={`/product/${product.id}`}
                      onClick={() => {
                        isDismissedRef.current = true;
                        setIsOpen(false);
                        setActiveIndex(-1);
                      }}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={`group flex cursor-pointer items-center justify-between px-4 py-3 transition-colors ${
                        isSelected ? "bg-[#162744]" : "bg-[#111F36] hover:bg-[#162744]"
                      }`}
                    >
                      <div className="flex flex-1 items-center gap-3 pr-2 min-w-0">
                        {/* Thumbnail Image */}
                        <div className="flex h-12 w-12 sm:h-14 sm:w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#080F1C] p-1 border border-[#1E3252]">
                          {imgUrl && !hasImgError ? (
                            <img
                              src={imgUrl}
                              alt={product.name || ""}
                              onError={() => handleImageError(product.id)}
                              className="h-full w-full object-contain"
                              loading="lazy"
                            />
                          ) : (
                            <Search size={16} className="text-[#8FA4BE]/50" />
                          )}
                        </div>

                        {/* Title & Category Info */}
                        <div className="flex flex-col justify-center min-w-0">
                          <h3
                            className={`line-clamp-2 text-[13.5px] sm:text-[14.5px] font-extrabold leading-[1.3] tracking-tight transition-colors ${
                              isSelected ? "text-[#42D6E8]" : "text-[#F1F5F9] group-hover:text-[#42D6E8]"
                            }`}
                          >
                            <HighlightMatch
                              text={cleanProductTitle(product.name)}
                              query={query}
                            />
                          </h3>

                          {categoryName && (
                            <div className="mt-1 flex items-center">
                              <span className="rounded-md bg-[#132B45] px-2 py-0.5 text-[11px] font-extrabold text-[#42D6E8] border border-[#1E3E63]/80 tracking-wide">
                                {categoryName}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Price & Navigation Indicator */}
                      <div className="flex flex-col items-end shrink-0 pl-2">
                        <span className="text-[14px] sm:text-[15px] font-black text-white tabular-nums tracking-tight">
                          ₹{product.price}
                        </span>
                        <div
                          className={`mt-1.5 flex h-6.5 w-6.5 items-center justify-center rounded-full transition-colors ${
                            isSelected
                              ? "bg-[#42D6E8] text-[#061220]"
                              : "bg-[#132B45] text-[#42D6E8] group-hover:bg-[#42D6E8] group-hover:text-[#061220]"
                          }`}
                          aria-hidden="true"
                        >
                          <ChevronRight size={14} strokeWidth={2.5} />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>

              {/* View All Results Button */}
              <button
                type="button"
                onClick={openFullResults}
                className="w-full border-t border-[#1E3252] bg-[#0E1A2E] px-4 py-3 text-left text-[13px] sm:text-sm font-extrabold text-[#42D6E8] hover:bg-[#162744] transition-colors flex items-center justify-between cursor-pointer"
              >
                <span>View all {totalResults} results for “{query.trim()}”</span>
                <ChevronRight size={15} strokeWidth={2.5} className="shrink-0" />
              </button>
            </>
          ) : (
            /* Empty State */
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-[#162744] text-[#8FA4BE]">
                <Search size={18} />
              </div>
              <p className="text-xs sm:text-sm font-bold text-white">No products found</p>
              <p className="text-[11px] text-[#8FA4BE] mt-0.5">
                Try searching with a different keyword
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SearchBar;
