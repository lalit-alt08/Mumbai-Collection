import { Link } from "react-router-dom";
import { Home } from "lucide-react";
import { useNoIndex } from "../hooks/useNoIndex";

function NotFound() {
  useNoIndex();
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center bg-[#F0F8E8] px-4 text-center">
      <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0] shadow-lg">
        <span className="text-4xl">🔍</span>
      </div>

      <h1 className="text-3xl font-extrabold text-[#1E293B] md:text-4xl">
        Page Not Found
      </h1>

      <p className="mt-2 max-w-md text-sm text-[#64748B]">
        Sorry, the page you are looking for doesn't exist or has been moved.
      </p>

      <Link
        to="/"
        className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#22499F] px-8 py-3.5 text-sm font-black text-[#FFFFFF] shadow-lg transition hover:bg-[#1B3B82] hover:text-[#FFFFFF] active:scale-95"
      >
        <Home size={18} /> Return to Home
      </Link>
    </div>
  );
}

export default NotFound;