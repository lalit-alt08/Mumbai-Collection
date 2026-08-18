import { Link } from "react-router-dom";
import { RotateCcw, CheckCircle, HelpCircle, ArrowLeft } from "lucide-react";

function ReturnPolicy() {
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
            <RotateCcw size={16} /> Customer Protection
          </div>
          <h1 className="text-2xl font-extrabold text-[#1E1E1E] md:text-3xl">
            Return & Refund Policy
          </h1>
          <p className="mt-2 text-sm text-[#666666]">
            Hassle-free replacement and support for our customers
          </p>
        </div>

        <div className="space-y-8 text-sm leading-relaxed text-[#4A4A4A] md:text-[15px]">
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E1E1E] md:text-lg">
              <CheckCircle size={18} className="text-[#FF8A00]" /> 7-Day Replacement & Return Policy
            </h2>
            <p>
              We want you to be completely satisfied with your purchase from <strong>Mumbai Collection</strong>. If you receive an item that is defective, damaged in transit, or has an incorrect size/variant, you may request an exchange or return within <strong>7 days</strong> of delivery.
            </p>
          </section>

          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E1E1E] md:text-lg">
              <RotateCcw size={18} className="text-[#FF8A00]" /> Return Conditions
            </h2>
            <ul className="list-inside list-disc space-y-1.5 pl-2 text-gray-600">
              <li>The product must be unused, unwashed, and in its original packaging with tags intact.</li>
              <li>Innerwear, socks, and personal care items are non-returnable due to hygiene regulations.</li>
              <li>In-store exchange is also available directly at our Vasai shop with your digital order receipt.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E1E1E] md:text-lg">
              <HelpCircle size={18} className="text-[#FF8A00]" /> How to Initiate a Return or Exchange
            </h2>
            <p>
              Simply contact our customer support team via WhatsApp at <strong>+91 98765 43210</strong> or email us at <strong>support@mumbaicollection.in</strong> with your Order Number and photos of the item. Our team will arrange a pickup or guide you through the process.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

export default ReturnPolicy;
