import { useState, useRef, useEffect } from "react";
import {
  Package,
  LayoutGrid,
  ExternalLink,
  Link2,
  Search,
  ChevronDown,
  Check,
  X,
} from "lucide-react";

export function DestinationLinkSelector({
  banner,
  index,
  products = [],
  categories = [],
  loadingLookups = false,
  onUpdateLink,
}) {
  const currentLink = (banner?.link || "").trim();

  // Determine current mode: "product" | "category" | "custom"
  const [mode, setMode] = useState(() => {
    if (currentLink.startsWith("/category/")) return "category";
    if (currentLink.startsWith("/product/") || currentLink.startsWith("/products/")) return "product";
    return currentLink ? "custom" : "product";
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [isChangingProduct, setIsChangingProduct] = useState(false);
  const [customLinkVal, setCustomLinkVal] = useState(currentLink);
  const [isCatDropOpen, setIsCatDropOpen] = useState(false);
  const catDropRef = useRef(null);

  useEffect(() => {
    setCustomLinkVal(banner?.link || "");
  }, [banner?.link]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (catDropRef.current && !catDropRef.current.contains(e.target)) {
        setIsCatDropOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Match selected product from link
  const productMatch = currentLink.match(/^\/products?\/(\d+)/);
  const selectedProdId = productMatch ? Number(productMatch[1]) : null;
  const selectedProduct = selectedProdId
    ? products.find((p) => Number(p.id) === selectedProdId) || {
        id: selectedProdId,
        name: `Product #${selectedProdId}`,
        price: null,
      }
    : null;

  // Match selected category from link
  const catMatch = currentLink.match(/^\/category\/(.+)$/);
  const selectedCatVal = catMatch ? catMatch[1].toLowerCase().trim() : "";
  const selectedCategory = selectedCatVal
    ? categories.find(
        (c) =>
          String(c.id) === selectedCatVal ||
          String(c.slug).toLowerCase() === selectedCatVal
      ) || { id: selectedCatVal, name: `Category (${selectedCatVal})`, slug: selectedCatVal }
    : null;

  // Filtered products list for search
  const filteredProducts = products.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      p.name?.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q) ||
      String(p.id).includes(q)
    );
  });

  const handleSelectProduct = (prod) => {
    setIsChangingProduct(false);
    setSearchQuery("");
    onUpdateLink(`/product/${prod.id}`, prod.name);
  };

  const handleSelectCategory = (catValue) => {
    if (!catValue) {
      onUpdateLink("");
      return;
    }
    const cat = categories.find((c) => String(c.slug || c.id) === String(catValue));
    onUpdateLink(`/category/${cat?.slug || catValue}`, cat?.name ? `${cat.name} Special` : undefined);
  };

  const handleModeChange = (newMode) => {
    setMode(newMode);
    if (newMode === "product") {
      if (!currentLink.startsWith("/product/")) {
        const first = products[0];
        if (first) {
          onUpdateLink(`/product/${first.id}`, first.name);
        } else {
          setIsChangingProduct(true);
        }
      }
    } else if (newMode === "category") {
      if (!currentLink.startsWith("/category/")) {
        const first = categories[0];
        if (first) onUpdateLink(`/category/${first.slug || first.id}`, `${first.name} Special`);
      }
    }
  };

  return (
    <div className="space-y-2 rounded-2xl border border-gray-200/90 bg-gray-50/60 p-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <label className="text-[11px] font-black uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
          <Link2 size={13} className="text-emerald-600" />
          Destination Target
        </label>

        {/* 3 Mode Pills */}
        <div className="inline-flex items-center rounded-xl bg-gray-200/80 p-0.5 border border-gray-200">
          <button
            type="button"
            onClick={() => handleModeChange("product")}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
              mode === "product"
                ? "bg-white text-emerald-800 shadow-2xs font-black"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <Package size={12} />
            Specific Product
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("category")}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
              mode === "category"
                ? "bg-white text-emerald-800 shadow-2xs font-black"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <LayoutGrid size={12} />
            Category
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("custom")}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
              mode === "custom"
                ? "bg-white text-emerald-800 shadow-2xs font-black"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <ExternalLink size={12} />
            Custom Link
          </button>
        </div>
      </div>

      {/* Mode A: Specific Product Selector */}
      {mode === "product" && (
        <div className="space-y-2">
          {selectedProduct && !isChangingProduct ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-white p-2.5 shadow-2xs">
              <div className="flex items-center gap-2.5 min-w-0">
                {selectedProduct.image ? (
                  <img
                    src={selectedProduct.image}
                    alt=""
                    className="h-10 w-10 rounded-lg object-contain bg-gray-50 border border-gray-200 p-0.5 flex-shrink-0"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
                    <Package size={20} />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-black text-gray-900 truncate">
                      {selectedProduct.name}
                    </span>
                    {selectedProduct.stock_status === "outofstock" && (
                      <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-rose-50 text-rose-700 border border-rose-200">
                        Out of stock
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500 font-medium flex items-center gap-1.5 mt-0.5">
                    {selectedProduct.price && (
                      <span className="font-extrabold text-emerald-700">₹{selectedProduct.price}</span>
                    )}
                    <span>• ID #{selectedProduct.id}</span>
                    <span className="font-mono text-gray-400">/product/{selectedProduct.id}</span>
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsChangingProduct(true)}
                className="flex-shrink-0 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-700 transition cursor-pointer"
              >
                Change Product
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Type product name or SKU to search..."
                  className="w-full rounded-xl border border-gray-300 bg-white pl-8 pr-8 py-2 text-xs font-medium text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
                  autoFocus={isChangingProduct}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              <div className="max-h-52 overflow-y-auto rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 shadow-xs">
                {filteredProducts.length === 0 ? (
                  <div className="p-4 text-center text-xs text-gray-400">
                    {loadingLookups ? "Loading products..." : `No products found matching "${searchQuery}"`}
                  </div>
                ) : (
                  filteredProducts.map((p) => {
                    const isSelected = selectedProdId === Number(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSelectProduct(p)}
                        className={`w-full text-left p-2.5 flex items-center justify-between gap-2.5 hover:bg-emerald-50/60 transition cursor-pointer ${
                          isSelected ? "bg-emerald-50" : ""
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {p.image ? (
                            <img
                              src={p.image}
                              alt=""
                              className="h-8 w-8 rounded-md object-contain bg-gray-50 border border-gray-200 p-0.5 flex-shrink-0"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded-md bg-gray-100 text-gray-400 flex items-center justify-center flex-shrink-0">
                              <Package size={14} />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-gray-900 truncate">
                              {p.name}
                            </p>
                            <p className="text-[10px] text-gray-500 flex items-center gap-1.5">
                              {p.price && <span className="font-bold text-emerald-700">₹{p.price}</span>}
                              <span>• ID #{p.id}</span>
                              {p.sku && <span>• {p.sku}</span>}
                            </p>
                          </div>
                        </div>

                        {isSelected && (
                          <Check size={14} className="text-emerald-600 flex-shrink-0" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              {selectedProduct && isChangingProduct && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setIsChangingProduct(false);
                      setSearchQuery("");
                    }}
                    className="text-[11px] font-bold text-gray-500 hover:text-gray-800 underline cursor-pointer"
                  >
                    Keep current: "{selectedProduct.name}"
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Mode B: Category Selector — Custom Styled Dropdown */}
      {mode === "category" && (
        <div className="relative" ref={catDropRef}>
          <button
            type="button"
            onClick={() => setIsCatDropOpen((prev) => !prev)}
            className="w-full flex items-center justify-between gap-2 rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-xs font-bold text-gray-900 outline-none hover:border-emerald-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition cursor-pointer"
          >
            <span className="truncate">
              {selectedCategory
                ? `${selectedCategory.name} (${selectedCategory.count ?? 0} products)`
                : "-- Choose Category --"}
            </span>
            <ChevronDown
              size={14}
              className={`shrink-0 text-gray-500 transition-transform duration-200 ${isCatDropOpen ? "rotate-180" : ""}`}
            />
          </button>

          {isCatDropOpen && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1.5 w-full rounded-xl bg-white border border-gray-200 shadow-xl overflow-hidden max-h-60 overflow-y-auto divide-y divide-gray-50 animate-in fade-in zoom-in-95 duration-150">
              <button
                type="button"
                onClick={() => { handleSelectCategory(""); setIsCatDropOpen(false); }}
                className="w-full text-left px-3.5 py-2.5 text-xs font-semibold text-gray-400 hover:bg-gray-50 transition cursor-pointer"
              >
                -- Choose Category --
              </button>
              {categories.map((cat) => {
                const val = String(cat.slug || cat.id);
                const isSelected =
                  selectedCategory &&
                  (String(selectedCategory.slug) === val || String(selectedCategory.id) === val);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => { handleSelectCategory(val); setIsCatDropOpen(false); }}
                    className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-xs transition cursor-pointer text-left ${
                      isSelected
                        ? "bg-emerald-50 text-emerald-900 font-extrabold"
                        : "text-gray-700 font-semibold hover:bg-gray-50"
                    }`}
                  >
                    <span className="truncate">
                      {cat.name} ({cat.count || 0} products)
                    </span>
                    {isSelected && <Check size={13} className="text-emerald-600 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Mode C: Custom Link */}
      {mode === "custom" && (
        <div>
          <input
            type="text"
            value={customLinkVal}
            onChange={(e) => setCustomLinkVal(e.target.value)}
            onBlur={() => {
              if (customLinkVal !== banner.link) {
                onUpdateLink(customLinkVal);
              }
            }}
            placeholder="e.g. /favorites or /categories"
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
          />
        </div>
      )}

      {/* Destination Preview Chip */}
      <div className="flex items-center justify-between text-[11px] text-gray-500 bg-white/90 rounded-xl px-3 py-1.5 border border-gray-200/80 flex-wrap gap-2">
        <div className="flex items-center gap-1.5 truncate">
          <span className="font-extrabold text-gray-700">Landing Path:</span>
          <code className="text-emerald-700 font-mono font-bold bg-emerald-50 px-1.5 py-0.5 rounded text-[10px] border border-emerald-200">
            {banner.link || "(No link assigned)"}
          </code>
          {mode === "product" && selectedProduct && (
            <span className="text-gray-600 truncate text-[10px]">
              (Opens "{selectedProduct.name}")
            </span>
          )}
          {mode === "category" && selectedCategory && (
            <span className="text-gray-600 truncate text-[10px]">
              (Opens "{selectedCategory.name}")
            </span>
          )}
        </div>

        {banner.link && (
          <a
            href={banner.link.startsWith("http") ? banner.link : `http://localhost:5173${banner.link}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 hover:text-emerald-800 transition"
            title="Open destination in Customer Web"
          >
            <span>Test Link</span>
            <ExternalLink size={10} />
          </a>
        )}
      </div>
    </div>
  );
}
