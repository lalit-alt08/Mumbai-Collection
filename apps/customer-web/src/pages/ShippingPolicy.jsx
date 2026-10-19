import { Link } from "react-router-dom";
import { Truck, Clock, MapPin, CheckCircle2, ArrowLeft } from "lucide-react";

function ShippingPolicy() {
  return (
    <div className="min-h-screen bg-[#0B1425] px-4 py-8 md:py-12">
      <div className="mx-auto max-w-4xl rounded-[24px] border border-[#1E3252] bg-[#111F36] p-6 shadow-sm md:p-12 text-[#F1F5F9]">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[#42D6E8] transition hover:text-[#67E8F9]"
        >
          <ArrowLeft size={16} /> Back to Home
        </Link>

        <div className="mb-8 border-b border-[#1E3252] pb-6">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#132B45] border border-[#1E3252] px-4 py-1.5 text-xs font-bold text-[#67E8F9]">
            <Truck size={16} /> Fast & Reliable Dispatch
          </div>
          <h1 className="text-2xl font-extrabold text-[#F1F5F9] md:text-3xl">
            Shipping & Delivery Policy
          </h1>
          <p className="mt-2 text-sm text-[#8FA4BE]">
            Delivering from our Vasai Store directly to your home
          </p>
        </div>

        <div className="space-y-8 text-sm leading-relaxed text-[#8FA4BE] md:text-[15px]">
          {/* Timeline Table */}
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-[#F1F5F9] md:text-lg">
              <Clock size={18} className="text-[#42D6E8]" /> Estimated Delivery Timelines
            </h2>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-[#42D6E8]/40 bg-[#132B45]/60 p-4 text-center">
                <div className="text-xs font-bold uppercase tracking-wider text-[#67E8F9]">Vasai Local Area</div>
                <div className="mt-2 text-xl font-extrabold text-[#F1F5F9]">1 – 2 Days</div>
                <p className="mt-1 text-xs text-[#8FA4BE]">Vasai West & East, Nalasopara, Naigaon, Virar</p>
              </div>

              <div className="rounded-2xl border border-[#1E3252] bg-[#080F1C]/60 p-4 text-center">
                <div className="text-xs font-bold uppercase tracking-wider text-[#8FA4BE]">Mumbai & Maharashtra</div>
                <div className="mt-2 text-xl font-extrabold text-[#F1F5F9]">2 – 4 Days</div>
                <p className="mt-1 text-xs text-[#6E84A3]">Standard surface & express courier</p>
              </div>

              <div className="rounded-2xl border border-[#1E3252] bg-[#080F1C]/60 p-4 text-center">
                <div className="text-xs font-bold uppercase tracking-wider text-[#8FA4BE]">Rest of India</div>
                <div className="mt-2 text-xl font-extrabold text-[#F1F5F9]">4 – 7 Days</div>
                <p className="mt-1 text-xs text-[#6E84A3]">All serviceable 6-digit PIN codes</p>
              </div>
            </div>
          </section>

          {/* Shipping Charges */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#F1F5F9] md:text-lg">
              <CheckCircle2 size={18} className="text-[#42D6E8]" /> Shipping Charges & Free Delivery
            </h2>
            <ul className="list-inside list-disc space-y-1.5 pl-2 text-[#8FA4BE]">
              <li><strong className="text-[#F1F5F9]">Free Delivery</strong> on all local orders in the Vasai region for orders above ₹499.</li>
              <li>Standard delivery charges of ₹40 – ₹70 may apply on low-value orders or distant PIN codes.</li>
              <li>Final shipping fees (if any) are transparently displayed on your Checkout page before you place the order.</li>
            </ul>
          </section>

          {/* Order Tracking */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#F1F5F9] md:text-lg">
              <MapPin size={18} className="text-[#42D6E8]" /> Order Tracking & Delivery Updates
            </h2>
            <p>
              Once your order is packed and dispatched from Mumbai Collection, you will receive a confirmation message with the delivery agent/courier details. You can also track your order status anytime through the <Link to="/track-order" className="font-bold text-[#42D6E8] hover:text-[#67E8F9] underline">Track My Order</Link> page.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

export default ShippingPolicy;
