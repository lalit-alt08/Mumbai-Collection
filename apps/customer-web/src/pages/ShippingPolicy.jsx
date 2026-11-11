import { Link } from "react-router-dom";
import { Truck, Clock, MapPin, CheckCircle2, ArrowLeft } from "lucide-react";

function ShippingPolicy() {
  return (
    <div className="min-h-screen bg-[#F0F8E8] px-4 py-8 md:py-12">
      <div className="mx-auto max-w-4xl rounded-[24px] border border-[#E2E8F0] bg-[#FFFFFF] p-6 shadow-sm md:p-12 text-[#1E293B]">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[#22499F] transition hover:text-[#22499F]"
        >
          <ArrowLeft size={16} /> Back to Home
        </Link>

        <div className="mb-8 border-b border-[#E2E8F0] pb-6">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#FFFFFF] border border-[#E2E8F0] px-4 py-1.5 text-xs font-bold text-[#22499F]">
            <Truck size={16} /> Fast & Reliable Dispatch
          </div>
          <h1 className="text-2xl font-extrabold text-[#1E293B] md:text-3xl">
            Shipping & Delivery Policy
          </h1>
          <p className="mt-2 text-sm text-[#64748B]">
            Delivering from our Vasai Store directly to your home
          </p>
        </div>

        <div className="space-y-8 text-sm leading-relaxed text-[#64748B] md:text-[15px]">
          {/* Timeline Table */}
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-[#1E293B] md:text-lg">
              <Clock size={18} className="text-[#22499F]" /> Estimated Delivery Timelines
            </h2>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-[#22499F]/40 bg-[#FFFFFF]/60 p-4 text-center">
                <div className="text-xs font-bold uppercase tracking-wider text-[#22499F]">Vasai Local Area</div>
                <div className="mt-2 text-xl font-extrabold text-[#1E293B]">1 – 2 Days</div>
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
  );
}

export default ShippingPolicy;
