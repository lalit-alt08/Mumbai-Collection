import { Link, useNavigate } from "react-router-dom";
import { Truck, Clock, MapPin, CheckCircle2, ChevronLeft } from "lucide-react";
import { triggerHaptic } from "../utils/haptics";

function ShippingPolicy() {
  const navigate = useNavigate();

  const handleBack = () => {
    if (window.history.length > 2) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  return (
    <div className="min-h-screen bg-[#F0F8E8] text-[#1E293B] px-4 pt-4 pb-24 sm:px-6 md:pt-8 md:pb-16">
      <div className="mx-auto max-w-4xl space-y-4 sm:space-y-6">
        {/* ================= TOP BAR / NAVIGATION (Pill Design) ================= */}
        <div className="flex items-center justify-between gap-2.5 sm:gap-3">
          {/* Left: Circular Back Button */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic("light");
              handleBack();
            }}
            aria-label="Go back"
            className="flex h-12 w-12 sm:h-[52px] sm:w-[52px] shrink-0 items-center justify-center rounded-full bg-[#FFFFFF]/90 backdrop-blur-md text-[#1E293B] border border-[#E2E8F0] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.06)] transition-all hover:bg-[#FFFFFF] hover:border-[#22499F]/40 hover:text-[#22499F] active:scale-95 cursor-pointer"
          >
            <ChevronLeft size={23} strokeWidth={2.5} />
          </button>

          {/* Center: Capsule Pill */}
          <div className="flex-1 min-w-0 flex items-center justify-center rounded-full bg-[#FFFFFF]/95 backdrop-blur-md border border-[#E2E8F0] px-4 sm:px-7 py-2.5 sm:py-3 min-h-[48px] sm:min-h-[52px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.12),0_2px_10px_rgba(0,0,0,0.06)]">
            <h1 className="text-[16px] sm:text-[19px] font-extrabold text-[#1E293B] tracking-[-0.01em] leading-normal antialiased select-none truncate">
              Shipping & Delivery
            </h1>
          </div>

          {/* Symmetrical Spacer */}
          <div className="w-12 sm:w-[52px] shrink-0" aria-hidden="true" />
        </div>

        <div className="policy-page-card rounded-[24px] border border-[#C9D2DF] bg-[#FFFFFF] p-6 shadow-[0_8px_20px_rgba(30,41,59,0.15)] md:p-12 text-[#1E293B]">

        <div className="mb-8 border-b border-[#E2E8F0] pb-6">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#AFC3E3] bg-[#F5F8FF] px-4 py-1.5 text-xs font-extrabold text-[#22499F]">
            <Truck size={16} /> Fast & Reliable Dispatch
          </div>
          <h1 className="text-[28px] font-black tracking-[-0.03em] text-[#17233A] md:text-3xl">
            Shipping & Delivery Policy
          </h1>
          <p className="mt-2 text-[15px] font-medium text-[#60718A]">
            Delivering from our Vasai Store directly to your home
          </p>
        </div>

        <div className="policy-reading space-y-8 text-[15px] leading-7 text-[#52647E] md:text-[16px]">
          {/* Timeline Table */}
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-[#1E293B] md:text-lg">
              <Clock size={18} className="text-[#22499F]" /> Estimated Delivery Timelines
            </h2>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-[#22499F]/40 bg-[#FFFFFF]/60 p-4 text-center">
                <div className="text-xs font-bold uppercase tracking-wider text-[#22499F]">Vasai Local Area</div>
                <div className="mt-2 text-xl font-extrabold text-[#1E293B]">Same Day Delivery</div>
                <p className="mt-1 text-xs text-[#64748B]">Vasai West & East, Nalasopara, Naigaon, Virar</p>
              </div>

              <div className="rounded-2xl border border-[#E2E8F0] bg-[#F0F8E8]/60 p-4 text-center">
                <div className="text-xs font-bold uppercase tracking-wider text-[#64748B]">Mumbai & Maharashtra</div>
                <div className="mt-2 text-xl font-extrabold text-[#1E293B]">2 – 4 Days</div>
                <p className="mt-1 text-xs text-[#64748B]">Standard surface & express courier</p>
              </div>

              <div className="rounded-2xl border border-[#E2E8F0] bg-[#F0F8E8]/60 p-4 text-center">
                <div className="text-xs font-bold uppercase tracking-wider text-[#64748B]">Rest of India</div>
                <div className="mt-2 text-xl font-extrabold text-[#1E293B]">4 – 7 Days</div>
                <p className="mt-1 text-xs text-[#64748B]">All serviceable 6-digit PIN codes</p>
              </div>
            </div>
          </section>

          {/* Shipping Charges */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E293B] md:text-lg">
              <CheckCircle2 size={18} className="text-[#22499F]" /> Shipping Charges & Free Delivery
            </h2>
            <ul className="list-inside list-disc space-y-1.5 pl-2 text-[#64748B]">
              <li><strong className="text-[#1E293B]">Free Delivery</strong> on all local orders in the Vasai region for orders above ₹499.</li>
              <li>Standard delivery charges of ₹40 – ₹70 may apply on low-value orders or distant PIN codes.</li>
              <li>Final shipping fees (if any) are transparently displayed on your Checkout page before you place the order.</li>
            </ul>
          </section>

          {/* Order Tracking */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E293B] md:text-lg">
              <MapPin size={18} className="text-[#22499F]" /> Order Tracking & Delivery Updates
            </h2>
            <p>
              Once your order is packed and dispatched from Mumbai Collection, you will receive a confirmation message with the delivery agent/courier details. You can also track your order status anytime through the <Link to="/track-order" className="font-bold text-[#22499F] hover:text-[#22499F] underline">Track My Order</Link> page.
            </p>
          </section>
        </div>
      </div>
      </div>
    </div>
  );
}

export default ShippingPolicy;
