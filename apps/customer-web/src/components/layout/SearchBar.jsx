import { Search } from "lucide-react";

function SearchBar() {
  return (
    <div className="relative w-full">
      <Search
        size={20}
        className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
      />

      <input
        type="text"
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
    </div>
  );
}

export default SearchBar;