import { useParams, Link } from "react-router-dom";
import { CheckCircle2, Package, CreditCard, Calendar, Home, MapPin } from "lucide-react";

function OrderSuccess() {
  const { id } = useParams();

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#F7F8F5] px-4 py-12">
      {/* Background radial gradient */}
      <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-[#FFF0DD]/60 via-transparent to-transparent"></div>

      <div className="relative z-10 w-full max-w-[600px] animate-[slideUp_0.4s_ease-out]">
        <div className="overflow-hidden rounded-[24px] bg-white p-6 shadow-[0_10px_35px_rgba(0,0,0,0.06)] sm:p-10">
          
          {/* Animated Success Icon */}
          <div className="mb-6 flex justify-center">
            <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-[#FFF0DD] animate-[popIn_0.5s_cubic-bezier(0.175,0.885,0.32,1.275)]">
              <div className="absolute inset-0 animate-ping rounded-full bg-[#FF8A00]/20 opacity-75"></div>
              <CheckCircle2 size={48} className="z-10 text-[#FF8A00]" strokeWidth={2} />
            </div>
          </div>

          {/* Heading */}
          <div className="text-center">
            <h1 className="mb-3 text-[26px] font-extrabold text-[#1F2937] sm:text-[30px]">
              Order Placed Successfully! 🎉
            </h1>
            <p className="mx-auto max-w-[90%] text-[15px] leading-relaxed text-[#6B7280]">
              Thank you for shopping with Mumbai Collection. Your order has been confirmed and is now being processed.
            </p>
          </div>

          {/* Order Info Card */}
          <div className="mt-8 rounded-[20px] border border-gray-100 bg-[#F9FAF8] p-5">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-[#6B7280]">
                  <Package size={18} />
                  <span className="text-[14.5px] font-medium">Order Number</span>
                </div>
                <span className="text-[15px] font-bold text-[#1F2937]">#{id}</span>
              </div>
              <div className="h-[1px] w-full bg-gray-200/60"></div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-[#6B7280]">
                  <div className="ml-[5px] h-2 w-2 rounded-full bg-[#FF8A00]"></div>
                  <span className="ml-[-3px] text-[14.5px] font-medium">Status</span>
                </div>
                <span className="rounded-lg bg-[#FFF0DD] px-2.5 py-1 text-[13px] font-bold text-[#FF8A00]">
                  Processing
                </span>
              </div>
              <div className="h-[1px] w-full bg-gray-200/60"></div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-[#6B7280]">
                  <CreditCard size={18} />
                  <span className="text-[14.5px] font-medium">Payment</span>
                </div>
                <span className="text-[15px] font-bold text-[#1F2937]">Cash on Delivery</span>
              </div>
              <div className="h-[1px] w-full bg-gray-200/60"></div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-[#6B7280]">
                  <Calendar size={18} />
                  <span className="text-[14.5px] font-medium">Est. Delivery</span>
                </div>
                <span className="text-[15px] font-bold text-[#1F2937]">2–4 Days</span>
              </div>
            </div>
          </div>

          {/* Message */}
          <div className="mt-6 text-center">
            <p className="text-[13.5px] leading-relaxed text-[#6B7280]">
              We've received your order and our team will start preparing it shortly. You'll receive updates as your order progresses.
            </p>
          </div>

          {/* Actions */}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/"
              className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#FF8A00] px-6 text-[15px] font-bold text-white shadow-[0_6px_20px_rgba(255,138,0,0.25)] transition-all hover:bg-[#FF7300] active:scale-[0.98]"
            >
              <Home size={20} />
              Continue Shopping
            </Link>
            <button
              disabled
              className="flex h-[52px] flex-1 cursor-not-allowed items-center justify-center gap-2 rounded-xl border-2 border-[#FF8A00] bg-white px-6 text-[15px] font-bold text-[#FF8A00] opacity-70 transition-all"
            >
              <MapPin size={20} />
              Track Order <span className="ml-1 rounded bg-orange-50 px-1.5 py-0.5 text-[10px] text-[#FF8A00] font-semibold">Coming Soon</span>
            </button>
          </div>
        </div>

        {/* Footer Support Text */}
        <div className="mt-8 text-center text-[13px] text-[#6B7280]">
          Need help? <a href="#" className="font-bold text-[#FF8A00] transition-colors hover:text-[#FF7300] hover:underline">Contact Mumbai Collection Support</a>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes popIn {
          0% { transform: scale(0.5); opacity: 0; }
          60% { transform: scale(1.1); }
          100% { transform: scale(1); opacity: 1; }
        }
      `}} />
    </div>
  );
}

export default OrderSuccess;