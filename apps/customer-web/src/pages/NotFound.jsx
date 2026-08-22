import { Link } from "react-router-dom";
import { Home, ArrowLeft } from "lucide-react";

function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center bg-[#F7F7FB] px-4 text-center">
      <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-[#F1ECFF] text-[#7C3AED] shadow-sm">
        <span className="text-4xl">🔍</span>
      </div>

      <h1 className="text-3xl font-extrabold text-[#1E1E1E] md:text-4xl">
        Page Not Found
      </h1>

      <p className="mt-2 max-w-md text-sm text-[#666666]">
        Sorry, the page you are looking for doesn't exist or has been moved.
      </p>

      <Link
        to="/"
        className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#7C3AED] px-8 py-3.5 text-sm font-bold text-white shadow-[0_4px_16px_rgba(124,58,237,0.25)] transition hover:bg-[#6C35E8] active:scale-95"
      >
        <Home size={18} /> Return to Home
      </Link>
    </div>
  );
}

export default NotFound;