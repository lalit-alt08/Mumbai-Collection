import { Link } from "react-router-dom";
import { FileCheck, ArrowLeft, AlertCircle, ShoppingBag, Truck, ShieldAlert } from "lucide-react";

function Terms() {
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
            <FileCheck size={16} /> Terms of Service
          </div>
          <h1 className="text-2xl font-extrabold text-[#1E1E1E] md:text-3xl">
            Terms & Conditions
          </h1>
          <p className="mt-2 text-sm text-[#666666]">
            Effective Date: August 2026 • Mumbai Collection, Vasai
          </p>
        </div>

        <div className="space-y-8 text-sm leading-relaxed text-[#4A4A4A] md:text-[15px]">
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E1E1E] md:text-lg">
              <ShoppingBag size={18} className="text-[#FF8A00]" /> 1. Overview & General Terms
            </h2>
            <p>
              These Terms & Conditions govern your access and use of the <strong>Mumbai Collection</strong> website and services. By visiting our site or purchasing products from us, you agree to be bound by these terms. We reserve the right to update these terms at any time.
            </p>
          </section>

          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E1E1E] md:text-lg">
              <AlertCircle size={18} className="text-[#FF8A00]" /> 2. Product Pricing & Accuracy
            </h2>
            <p>
              All prices listed on Mumbai Collection are in Indian Rupees (INR ₹) and include applicable Goods and Services Tax (GST). While we strive for exact product representations, actual garment colors or packaging may vary slightly due to screen resolutions and lighting during photography.
            </p>
          </section>

          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E1E1E] md:text-lg">
              <Truck size={18} className="text-[#FF8A00]" /> 3. Orders & Cash on Delivery (COD)
            </h2>
            <p>
              We offer Cash on Delivery (COD) for local deliveries in the Vasai/Virar/Mumbai region and courier-eligible PIN codes across India. By placing a COD order, you agree to be available at the designated address with the exact cash amount upon delivery. Refusing delivery without a valid reason may result in suspension of COD privileges on your account.
            </p>
          </section>

          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E1E1E] md:text-lg">
              <ShieldAlert size={18} className="text-[#FF8A00]" /> 4. Governing Law & Jurisdiction
            </h2>
            <p>
              Any disputes arising out of transactions on this platform shall be subject to the exclusive jurisdiction of the competent courts in Vasai / Palghar district, Maharashtra, India.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

export default Terms;
