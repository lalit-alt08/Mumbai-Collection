import { useState } from "react";
import { Link } from "react-router-dom";
import { Search, Package, MapPin, CheckCircle2, Clock, ArrowLeft } from "lucide-react";

function TrackOrder() {
  const [orderId, setOrderId] = useState("");
  const [searched, setSearched] = useState(false);

  const handleTrack = (e) => {
    e.preventDefault();
    if (orderId.trim()) {
      setSearched(true);
    }
  };

  return (
    <div className="min-h-screen bg-[#FFF9F0] px-4 py-8 md:py-12">
      <div className="mx-auto max-w-2xl rounded-[24px] border border-gray-100 bg-white p-6 shadow-sm md:p-10">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[#FF8A00] transition hover:text-[#FF7300]"
        >
          <ArrowLeft size={16} /> Back to Home
        </Link>

        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-[#FF8A00]">
            <Package size={28} />
          </div>
          <h1 className="text-2xl font-extrabold text-[#1E1E1E]">Track Your Order</h1>
          <p className="mt-1.5 text-sm text-gray-500">
            Enter your Order ID (from your confirmation screen or SMS) to check delivery status.
          </p>
        </div>

        {/* Search Form */}
        <form onSubmit={handleTrack} className="mb-8 flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">#</span>
            <input
              type="text"
              required
              value={orderId}
              onChange={(e) => {
                setOrderId(e.target.value.replace(/\D/g, ""));
                setSearched(false);
              }}
              placeholder="e.g. 1042"
              className="h-12 w-full rounded-xl border border-gray-200 bg-gray-50 pl-8 pr-4 text-sm font-medium text-gray-900 outline-none transition focus:border-[#FF8A00] focus:bg-white focus:ring-2 focus:ring-[#FF8A00]/10"
            />
          </div>

          <button
            type="submit"
            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#FF8A00] px-6 text-sm font-bold text-white shadow-sm transition hover:bg-[#FF7300] active:scale-95"
          >
            <Search size={16} /> Track
          </button>
        </form>

        {/* Tracking Result Mock / Display */}
        {searched && (
          <div className="rounded-2xl border border-orange-100 bg-[#FFFDF9] p-6 animate-[fadeIn_0.3s_ease]">
            <div className="mb-4 flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Order</span>
                <div className="text-lg font-bold text-[#1E1E1E]">#{orderId}</div>
              </div>
              <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-[#FF8A00]">
                Processing & Packing
              </span>
            </div>

            {/* Stepper */}
            <div className="space-y-6 pt-2">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FF8A00] text-white">
                  <CheckCircle2 size={16} />
                </div>
                <div>
                  <div className="text-sm font-bold text-[#1E1E1E]">Order Confirmed</div>
                  <div className="text-xs text-gray-500">Your order has been received by Mumbai Collection.</div>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100 text-[#FF8A00]">
                  <Clock size={16} />
                </div>
                <div>
                  <div className="text-sm font-bold text-[#1E1E1E]">Packing at Vasai Store</div>
                  <div className="text-xs text-gray-500">Our team is packing your items for dispatch.</div>
                </div>
              </div>

              <div className="flex items-start gap-3 opacity-40">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400">
                  <MapPin size={16} />
                </div>
                <div>
                  <div className="text-sm font-bold text-gray-700">Out for Delivery</div>
                  <div className="text-xs text-gray-400">Handed to local delivery agent / courier.</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default TrackOrder;
