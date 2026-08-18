import { Link } from "react-router-dom";
import { Truck, Clock, MapPin, CheckCircle2, ArrowLeft } from "lucide-react";

function ShippingPolicy() {
  return (
    <div className="min-h-screen bg-[#FFF9F0] px-4 py-8 md:py-12">
      <div className="mx-auto max-w-4xl rounded-[24px] border border-gray-100 bg-white p-6 shadow-sm md:p-12">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[#FF8A00] transition hover:text-[#FF7300]"
        >
          <ArrowLeft size={16} /> Back to Home
        </Link>

        <div className="mb-8 border-b border-gray-100 pb-6">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-orange-50 px-4 py-1.5 text-xs font-bold text-[#FF8A00]">
            <Truck size={16} /> Fast & Reliable Dispatch
          </div>
          <h1 className="text-2xl font-extrabold text-[#1E1E1E] md:text-3xl">
            Shipping & Delivery Policy
          </h1>
          <p className="mt-2 text-sm text-[#666666]">
            Delivering from our Vasai Store directly to your home
          </p>
        </div>

        <div className="space-y-8 text-sm leading-relaxed text-[#4A4A4A] md:text-[15px]">
          {/* Timeline Table */}
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-[#1E1E1E] md:text-lg">
              <Clock size={18} className="text-[#FF8A00]" /> Estimated Delivery Timelines
            </h2>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-orange-100 bg-orange-50/50 p-4 text-center">
                <div className="text-xs font-bold uppercase tracking-wider text-[#FF8A00]">Vasai Local Area</div>
                <div className="mt-2 text-xl font-extrabold text-[#1E1E1E]">1 – 2 Days</div>
                <p className="mt-1 text-xs text-gray-500">Vasai West & East, Nalasopara, Naigaon, Virar</p>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 text-center">
                <div className="text-xs font-bold uppercase tracking-wider text-gray-600">Mumbai & Maharashtra</div>
                <div className="mt-2 text-xl font-extrabold text-[#1E1E1E]">2 – 4 Days</div>
                <p className="mt-1 text-xs text-gray-500">Standard surface & express courier</p>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 text-center">
                <div className="text-xs font-bold uppercase tracking-wider text-gray-600">Rest of India</div>
                <div className="mt-2 text-xl font-extrabold text-[#1E1E1E]">4 – 7 Days</div>
                <p className="mt-1 text-xs text-gray-500">All serviceable 6-digit PIN codes</p>
              </div>
            </div>
          </section>

          {/* Shipping Charges */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E1E1E] md:text-lg">
              <CheckCircle2 size={18} className="text-[#FF8A00]" /> Shipping Charges & Free Delivery
            </h2>
            <ul className="list-inside list-disc space-y-1.5 pl-2 text-gray-600">
              <li><strong>Free Delivery</strong> on all local orders in the Vasai region for orders above ₹499.</li>
              <li>Standard delivery charges of ₹40 – ₹70 may apply on low-value orders or distant PIN codes.</li>
              <li>Final shipping fees (if any) are transparently displayed on your Checkout page before you place the order.</li>
            </ul>
          </section>

          {/* Order Tracking */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E1E1E] md:text-lg">
              <MapPin size={18} className="text-[#FF8A00]" /> Order Tracking & Delivery Updates
            </h2>
            <p>
              Once your order is packed and dispatched from Mumbai Collection, you will receive a confirmation message with the delivery agent/courier details. You can also track your order status anytime through the <Link to="/track-order" className="font-bold text-[#FF8A00] underline">Track My Order</Link> page.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

export default ShippingPolicy;
