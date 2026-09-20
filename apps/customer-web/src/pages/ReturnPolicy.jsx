import { useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft,
  Clock,
  PackageCheck,
  AlertCircle,
  CheckCircle2,
  XCircle,
  MessageCircle,
  Truck,
} from "lucide-react";

function ReturnPolicy() {
  const navigate = useNavigate();

  const handleBack = () => {
    if (window.history.length > 2) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F8FA] text-[#1E1E1E] pb-24 lg:pb-16">
      {/* ================= STICKY APP-BAR ================= */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-100 bg-white/95 px-4 py-3 backdrop-blur-md sm:px-6 md:px-8">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            aria-label="Go back"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition hover:bg-gray-200 active:scale-95 cursor-pointer"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-base font-bold text-[#1E1E1E] sm:text-lg leading-tight">
              Return & Refund Policy
            </h1>
            <p className="text-[11px] font-medium text-gray-500">
              Mumbai Collection • Vasai Quick Store
            </p>
          </div>
        </div>

        <a
          href="https://wa.me/918793601567?text=Hi%20Mumbai%20Collection,%20I%20have%20a%20question%20regarding%20returns."
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full bg-[#25D366]/10 px-3 py-1.5 text-xs font-bold text-[#128C7E] transition hover:bg-[#25D366]/20 active:scale-95"
        >
          <MessageCircle size={14} />
          <span className="hidden xs:inline">Need Help?</span>
        </a>
      </header>

      {/* ================= CONTENT CONTAINER ================= */}
      <div className="mx-auto max-w-4xl px-4 pt-4 sm:px-6 md:pt-6 space-y-5">
        {/* ================= 1. CONTACT STORE FOR RETURN VERIFICATION CARD ================= */}
        <div className="rounded-[20px] border border-gray-100 bg-white p-5 shadow-xs sm:p-6 space-y-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#EDE9FE] text-[#6D28D9]">
              <MessageCircle size={19} />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">
                1. Contact Store to Verify Return Eligibility
              </h3>
              <p className="text-xs text-gray-500">
                Prior store confirmation required before initiating any return or exchange
              </p>
            </div>
          </div>

          <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
            Please <strong>contact our store directly to verify whether the product is returnable or not</strong>. Because Mumbai Collection carries toys, games, stationery, and collectibles with varying manufacturer return and exchange policies, our store team must confirm return eligibility before an item can be accepted for return or replacement.
          </p>

          <div className="rounded-xl bg-purple-50/70 p-3.5 border border-purple-100 text-xs text-[#5B21B6] leading-relaxed flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertCircle size={16} className="shrink-0 text-[#7C3AED] mt-0.5" />
              <span>
                <strong>How to verify:</strong> Message or call our Vasai store team at <strong>+91 87936 01567</strong> with your Order ID and photos of the product. Our team will verify whether the product is eligible for return or exchange within 72 hours of delivery.
              </span>
            </div>
            <a
              href="https://wa.me/918793601567?text=Hi%20Mumbai%20Collection,%20I%20want%20to%20verify%20whether%20my%20product%20is%20returnable%20or%20not."
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#25D366] px-4 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-[#20bd5a] active:scale-95 shrink-0 self-start sm:self-auto"
            >
              <MessageCircle size={14} />
              <span>Verify on WhatsApp</span>
            </a>
          </div>
        </div>

        {/* ================= 2. THE "COMPLETE UNTOUCHED CONDITION" CHECKLIST ================= */}
        <div className="rounded-[20px] border border-gray-100 bg-white p-5 shadow-xs sm:p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-[#7C3AED]">
              <PackageCheck size={19} />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">
                2. "Complete Untouched Condition" Requirement
              </h3>
              <p className="text-xs text-gray-500">
                Strict quality verification standards for returns & exchanges
              </p>
            </div>
          </div>

          <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
            To prevent fraud and maintain the highest safety and hygiene standards for our customers, returned items must pass our <strong>Untouched Condition Inspection</strong>:
          </p>

          {/* Dual Column Checklist */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Accepted / Eligible */}
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3.5 space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 uppercase tracking-wide">
                <CheckCircle2 size={15} className="text-emerald-600" />
                Eligible for Return / Swap
              </div>
              <ul className="space-y-2 text-xs text-emerald-950">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">•</span>
                  <span><strong>Sealed & Unopened:</strong> Factory seals, blister packs, and shrink wrap must remain fully intact.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">•</span>
                  <span><strong>Original Brand Box:</strong> Outer box must be free from tears, heavy dents, or customer-applied tape.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">•</span>
                  <span><strong>All Tags Intact:</strong> Barcode stickers, price tags, brand labels, and serial numbers untouched.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">•</span>
                  <span><strong>Complete Accessories:</strong> All cables, manuals, foam inserts, and freebies present.</span>
                </li>
              </ul>
            </div>

            {/* Rejected / Ineligible */}
            <div className="rounded-xl border border-rose-100 bg-rose-50/40 p-3.5 space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-rose-800 uppercase tracking-wide">
                <XCircle size={15} className="text-rose-600" />
                Not Eligible for Return
              </div>
              <ul className="space-y-2 text-xs text-rose-950">
                <li className="flex items-start gap-2">
                  <span className="text-rose-600 font-bold">•</span>
                  <span><strong>Tested or Used:</strong> Items showing scratches, signs of usage, or broken plastic seals.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-rose-600 font-bold">•</span>
                  <span><strong>Missing Original Box:</strong> Items returned without their original manufacturer retail carton.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-rose-600 font-bold">•</span>
                  <span><strong>Customer Damage:</strong> Physical drops, water spills, burnt circuits, or improper handling after delivery.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-rose-600 font-bold">•</span>
                  <span><strong>Unverified or Late Claims:</strong> Items returned without prior store verification or requested after the 72-hour window.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* ================= DIRECT SUPPORT & ACTION FOOTER ================= */}
        <div className="rounded-[20px] border border-gray-100 bg-white p-5 text-center shadow-xs sm:p-7 space-y-3">
          <h3 className="text-base font-bold text-gray-900">
            Have Questions About an Existing Order?
          </h3>
          <p className="text-xs sm:text-sm text-gray-600 max-w-md mx-auto">
            Our Vasai support team is available Monday to Sunday, 10:00 AM – 9:30 PM.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <a
              href="https://wa.me/918793601567?text=Hi%20Mumbai%20Collection,%20I%20would%20like%20to%20request%20a%20return/replacement%20for%20my%20order."
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-[#25D366] px-5 py-2.5 text-xs font-bold text-white transition hover:bg-[#1EBE5D] active:scale-95 shadow-sm"
            >
              <MessageCircle size={16} /> WhatsApp Support
            </a>

            <Link
              to="/orders"
              className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-5 py-2.5 text-xs font-bold text-gray-800 transition hover:bg-gray-200 active:scale-95"
            >
              <Truck size={16} /> View My Orders
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReturnPolicy;
