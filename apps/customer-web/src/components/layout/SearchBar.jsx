import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { searchProducts } from "../../services/productService";

function SearchBar() {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState([]);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!query.trim()) {
      setProducts([]);
      return;
    }

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

    const timer = setTimeout(async () => {
      try {
        const data = await searchProducts(query);
        setProducts(data);
      } catch (error) {
        console.error(error);
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
          rounded-xl
          border
          border-gray-300
          bg-white
          py-3
          pl-12
          pr-4
          text-sm
          outline-none
          transition-all
          placeholder:text-gray-400
          focus:border-green-500
          focus:ring-2
          focus:ring-green-200
          md:text-base
        "
      />

      {query && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border bg-white shadow-lg">
          {products.length > 0 ? (
            products.map((product) => (
              <Link
                key={product.id}
                to={`/product/${product.id}`}
                onClick={() => {
                  setQuery("");
                  setProducts([]);
                }}
                className="flex items-center gap-3 border-b p-3 transition hover:bg-gray-50"
              >
                <img
                  src={product.images?.[0]?.src}
                  alt={product.name}
                  className="h-14 w-14 rounded-lg object-cover"
                />

                <div className="flex-1">
                  <h3 className="line-clamp-1 text-sm font-medium">
                    {product.name}
                  </h3>

                  <p className="mt-1 font-semibold text-green-600">
                    ₹{product.price}
                  </p>
                </div>
              </Link>
            ))
          ) : (
            <div className="p-4 text-center text-sm text-gray-500">
              No products found
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SearchBar;
