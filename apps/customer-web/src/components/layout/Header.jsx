import { Link } from "react-router-dom";

function Header() {
  return (
    <header className="sticky top-0 z-50 border-b bg-white">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link
          to="/"
          className="text-2xl font-bold text-green-600"
        >
          Mumbai Collection
        </Link>

        <nav className="flex items-center gap-6">
          <Link
            to="/"
            className="hover:text-green-600"
          >
            Home
          </Link>

          <Link
            to="/cart"
            className="rounded-lg bg-green-600 px-4 py-2 text-white"
          >
            Cart
          </Link>
        </nav>
      </div>
    </header>
  );
}

export default Header;