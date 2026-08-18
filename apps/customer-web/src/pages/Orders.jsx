import { Link, useNavigate } from "react-router-dom";
import { Package, ArrowLeft, ShoppingBag, ChevronRight } from "lucide-react";
import { useAuth } from "../context/AuthContext";

function Orders() {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-[#FFF9F0] px-4 py-8 md:py-12">
      <div className="mx-auto max-w-4xl rounded-[24px] border border-gray-100 bg-white p-6 shadow-sm md:p-10">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between border-b border-gray-100 pb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/account")}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-600 transition hover:bg-[#FF8A00] hover:text-white"
            >
              <ArrowLeft size={18} />
            </button>
            <h1 className="text-xl font-bold text-[#1E1E1E] md:text-2xl">My Orders</h1>
          </div>

          <Link
            to="/"
            className="rounded-full bg-orange-50 px-4 py-2 text-xs font-bold text-[#FF8A00] transition hover:bg-orange-100"
          >
            Shop More
          </Link>
        </div>

        {/* Empty / Orders State */}
        <div className="py-12 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-orange-50 text-[#FF8A00]">
            <ShoppingBag size={36} />
          </div>

          <h2 className="text-lg font-bold text-[#1E1E1E]">Recent Orders</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
            Orders placed under {user?.email || "your account"} will be listed here with live delivery status.
          </p>

          <div className="mt-8 flex justify-center gap-3">
            <Link
              to="/track-order"
              className="rounded-xl border border-gray-200 px-6 py-3 text-sm font-bold text-gray-700 transition hover:bg-gray-50"
            >
              Track an Order
            </Link>
            <Link
              to="/"
              className="rounded-xl bg-[#FF8A00] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#FF7300] active:scale-95"
            >
              Start Shopping &rarr;
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Orders;
