import { Link } from "react-router-dom";
import { Home } from "lucide-react";
import { useNoIndex } from "../hooks/useNoIndex";

function NotFound() {
  useNoIndex();
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center bg-[#0B1425] px-4 text-center">
      <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-[#132B45] text-[#42D6E8] border border-[#1E3252] shadow-lg">
        <span className="text-4xl">🔍</span>
      </div>

      <h1 className="text-3xl font-extrabold text-[#F1F5F9] md:text-4xl">
        Page Not Found
      </h1>

      <p className="mt-2 max-w-md text-sm text-[#8FA4BE]">
        Sorry, the page you are looking for doesn't exist or has been moved.
      </p>

      <Link
        to="/"
        className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#42D6E8] px-8 py-3.5 text-sm font-black text-[#061220] shadow-lg transition hover:bg-[#2CC4D8] hover:text-[#061220] active:scale-95"
      >
        <Home size={18} /> Return to Home
      </Link>
    </div>
  );
}

export default NotFound;