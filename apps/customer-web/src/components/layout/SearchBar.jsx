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
        placeholder="Search for toys, stationery, cosmetics..."
        className="w-full rounded-xl border border-gray-300 py-3 pl-12 pr-4 outline-none transition-all focus:border-green-500 focus:ring-2 focus:ring-green-200"
      />
    </div>
  );
}

export default SearchBar;