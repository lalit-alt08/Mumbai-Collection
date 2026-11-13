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
  ShieldCheck,
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
    <div className="min-h-screen bg-[#F0F8E8] text-[#1E293B] pb-24 lg:pb-16">
      {/* ================= STICKY APP-BAR ================= */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[#C9D2DF] bg-[#F0F8E8]/95 px-4 py-3.5 backdrop-blur-md sm:px-6 md:px-8">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            aria-label="Go back"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#BAC7D8] bg-[#FFFFFF] text-[#1E293B] shadow-[0_3px_8px_rgba(30,41,59,0.15)] transition hover:border-[#22499F] hover:text-[#22499F] active:scale-95 cursor-pointer"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-[17px] font-extrabold leading-tight tracking-[-0.01em] text-[#17233A] sm:text-lg">
              Return & Refund Policy
            </h1>
            <p className="text-[12px] font-medium text-[#60718A]">
              Mumbai Collection • Vasai Quick Store
            </p>
          </div>
        </div>

        <a
          href="https://wa.me/918793601567?text=Hi%20Mumbai%20Collection,%20I%20have%20a%20question%20regarding%20returns."
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full bg-[#1F9D55] px-4 py-2 text-xs font-extrabold text-[#FFFFFF] shadow-[0_3px_9px_rgba(31,157,85,0.25)] transition hover:bg-[#167B3B] active:scale-95"
        >
          <MessageCircle size={14} />
          <span>Need Help?</span>
        </a>
      </header>

      {/* ================= CONTENT CONTAINER ================= */}
      <div className="mx-auto max-w-3xl px-4 pt-4 sm:px-6 md:pt-6 space-y-5 sm:space-y-6">
        
        {/* Quick Highlights / 3 Core Rules Banner */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex items-center gap-3 rounded-2xl border border-[#C9D2DF] bg-[#FFFFFF] p-4 shadow-[0_4px_11px_rgba(30,41,59,0.12)]">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#22499F]/15 text-[#22499F] border border-[#22499F]/30">
              <MessageCircle size={19} />
            </div>
            <div>
              <span className="block text-[13px] font-extrabold text-[#1E293B]">1. Store Check</span>
              <span className="block text-[12px] font-medium text-[#60718A]">Prior WhatsApp verification</span>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-[#C9D2DF] bg-[#FFFFFF] p-4 shadow-[0_4px_11px_rgba(30,41,59,0.12)]">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#25D366]/15 text-[#25D366] border border-[#25D366]/30">
              <Clock size={19} />
            </div>
            <div>
              <span className="block text-[13px] font-extrabold text-[#1E293B]">2. 72-Hour Window</span>
              <span className="block text-[12px] font-medium text-[#60718A]">Report within 3 days of delivery</span>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-[#C9D2DF] bg-[#FFFFFF] p-4 shadow-[0_4px_11px_rgba(30,41,59,0.12)]">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
              <PackageCheck size={19} />
            </div>
            <div>
              <span className="block text-[13px] font-extrabold text-[#1E293B]">3. Original Box</span>
              <span className="block text-[12px] font-medium text-[#60718A]">Sealed & untouched pack</span>
            </div>
          </div>
        </div>

        {/* ================= 1. CONTACT STORE FOR RETURN VERIFICATION CARD ================= */}
        <div className="rounded-[22px] border border-[#C9D2DF] bg-[#FFFFFF] p-5 shadow-[0_6px_16px_rgba(30,41,59,0.13)] sm:p-6 space-y-4">
          <div className="flex items-center gap-3 border-b border-[#E2E8F0]/60 pb-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#22499F]/15 text-[#22499F] border border-[#22499F]/30">
              <MessageCircle size={20} />
            </div>
            <div>
              <h2 className="text-[17px] font-extrabold leading-tight tracking-[-0.015em] text-[#17233A] sm:text-lg">
                1. Contact Store to Verify Return Eligibility
              </h2>
              <p className="text-[13px] text-[#60718A] font-medium">
                Prior store confirmation is required before initiating any return or exchange
              </p>
            </div>
          </div>

          <p className="text-[15px] text-[#43546D] leading-7">
            Because Mumbai Collection carries <strong className="text-[#1E293B]">toys, games, electronics, and stationery</strong> with varying manufacturer policies, please <strong className="text-[#22499F]">contact our store team directly</strong> before sending any product back. Our staff must verify your item's eligibility to process an exchange or return.
          </p>

          {/* 3 Clear Verification Steps Box */}
          <div className="rounded-2xl border border-[#C4D6B8] bg-[#F4FAEF] p-4 sm:p-5 space-y-3">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#22499F] flex items-center gap-2">
              <AlertCircle size={15} />
              How to Verify in 3 Simple Steps:
            </h3>

            <div className="space-y-2.5 text-xs sm:text-sm text-[#475569]">
              <div className="flex items-start gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E2E8F0] text-[11px] font-black text-[#22499F]">1</span>
                <p>Have your <strong className="text-[#1E293B]">Order ID</strong> ready (from My Orders or your SMS/Email receipt).</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E2E8F0] text-[11px] font-black text-[#22499F]">2</span>
                <p>Take <strong className="text-[#1E293B]">clear photos or an unboxing video</strong> showing the product, outer box, and factory seal.</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E2E8F0] text-[11px] font-black text-[#22499F]">3</span>
                <p>Send them to our Vasai team on WhatsApp or call us at <strong className="text-[#1E293B]">+91 87936 01567</strong> within <strong className="text-[#1E293B]">72 hours of delivery</strong>.</p>
              </div>
            </div>

            <div className="pt-2">
              <a
                href="https://wa.me/918793601567?text=Hi%20Mumbai%20Collection,%20I%20want%20to%20verify%20whether%20my%20product%20is%20eligible%20for%20return/replacement."
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1F9D55] px-5 py-2.5 text-xs font-extrabold text-[#FFFFFF] shadow-[0_3px_9px_rgba(31,157,85,0.25)] transition hover:bg-[#167B3B] active:scale-95 sm:text-sm"
              >
                <MessageCircle size={16} />
                <span>Verify on WhatsApp (+91 87936 01567)</span>
              </a>
            </div>
          </div>
        </div>

        {/* ================= 2. THE "COMPLETE UNTOUCHED CONDITION" CHECKLIST ================= */}
        <div className="rounded-[22px] border border-[#C9D2DF] bg-[#FFFFFF] p-5 shadow-[0_6px_16px_rgba(30,41,59,0.13)] sm:p-6 space-y-4">
          <div className="flex items-center gap-3 border-b border-[#E2E8F0]/60 pb-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#22499F]/15 text-[#22499F] border border-[#22499F]/30">
              <PackageCheck size={20} />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[#1E293B] tracking-tight">
                2. "Complete Untouched Condition" Requirement
              </h2>
              <p className="text-xs text-[#94A3B8] font-medium">
                Strict quality verification standards for all returns and exchanges
              </p>
            </div>
          </div>

          <p className="text-sm text-[#475569] leading-relaxed">
            To ensure genuine quality, hygiene, and product safety, returned products must pass our <strong className="text-[#1E293B]">Untouched Condition Inspection</strong> at the retail store:
          </p>

          {/* Dual Column Checklist */}
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            {/* Accepted / Eligible */}
          <div className="rounded-2xl border border-[#82CAA0] bg-[#EFFAF2] p-4 sm:p-4.5 space-y-3">
              <div className="flex items-center gap-2 text-xs sm:text-sm font-black text-emerald-400 uppercase tracking-wide">
                <CheckCircle2 size={17} className="text-emerald-400 shrink-0" />
                Eligible for Return / Exchange
              </div>
              <ul className="space-y-2.5 text-xs sm:text-sm text-[#475569]">
                <li className="flex items-start gap-2.5">
                  <span className="text-emerald-400 font-bold shrink-0 mt-0.5">✓</span>
                  <span><strong className="text-[#1E293B]">Sealed & Unopened:</strong> Factory seals, blister packs, and shrink wrap fully intact.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="text-emerald-400 font-bold shrink-0 mt-0.5">✓</span>
                  <span><strong className="text-[#1E293B]">Original Brand Box:</strong> Outer retail box free from tears, heavy dents, or tape.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="text-emerald-400 font-bold shrink-0 mt-0.5">✓</span>
                  <span><strong className="text-[#1E293B]">All Tags Intact:</strong> Barcode, price tags, brand labels, and serial numbers attached.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="text-emerald-400 font-bold shrink-0 mt-0.5">✓</span>
                  <span><strong className="text-[#1E293B]">All Parts Included:</strong> Charging cables, manuals, foam inserts, and accessories present.</span>
                </li>
              </ul>
            </div>

            {/* Rejected / Ineligible */}
          <div className="rounded-2xl border border-[#E8A0AB] bg-[#FFF4F5] p-4 sm:p-4.5 space-y-3">
              <div className="flex items-center gap-2 text-xs sm:text-sm font-black text-rose-400 uppercase tracking-wide">
                <XCircle size={17} className="text-rose-400 shrink-0" />
                Not Eligible for Return
              </div>
              <ul className="space-y-2.5 text-xs sm:text-sm text-[#475569]">
                <li className="flex items-start gap-2.5">
                  <span className="text-rose-400 font-bold shrink-0 mt-0.5">✕</span>
                  <span><strong className="text-[#1E293B]">Used or Played With:</strong> Scratches, dirt, peeled stickers, or broken plastic seals.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="text-rose-400 font-bold shrink-0 mt-0.5">✕</span>
                  <span><strong className="text-[#1E293B]">Missing Box:</strong> Products returned without their original manufacturer carton.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="text-rose-400 font-bold shrink-0 mt-0.5">✕</span>
                  <span><strong className="text-[#1E293B]">Customer Damage:</strong> Drops, water spills, burnt circuits, or improper charging.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="text-rose-400 font-bold shrink-0 mt-0.5">✕</span>
                  <span><strong className="text-[#1E293B]">Late Claims:</strong> Requests made after the 72-hour delivery window has passed.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* ================= DIRECT SUPPORT & ACTION FOOTER ================= */}
        <div className="rounded-[22px] border border-[#C9D2DF] bg-[#FFFFFF] p-5 text-center shadow-[0_6px_16px_rgba(30,41,59,0.13)] sm:p-7 space-y-3.5">
          <h3 className="text-base sm:text-lg font-bold text-[#1E293B]">
            Have Questions About an Existing Order?
          </h3>
          <p className="text-xs sm:text-sm text-[#475569] max-w-md mx-auto leading-relaxed">
            Our Vasai support team is available Monday to Sunday, 10:00 AM – 9:30 PM.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <a
              href="https://wa.me/918793601567?text=Hi%20Mumbai%20Collection,%20I%20would%20like%20to%20request%20a%20return/replacement%20for%20my%20order."
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-[#25D366] px-5 py-2.5 text-xs sm:text-sm font-bold text-[#FFFFFF] transition hover:bg-[#20bd5a] active:scale-95 shadow-sm"
            >
              <MessageCircle size={16} />
              <span>WhatsApp Support</span>
            </a>

            <Link
              to="/orders"
              className="inline-flex items-center gap-2 rounded-full bg-[#FFFFFF] border border-[#E2E8F0] px-5 py-2.5 text-xs sm:text-sm font-bold text-[#1E293B] transition hover:bg-[#22499F] hover:text-[#FFFFFF] active:scale-95"
            >
              <Truck size={16} />
              <span>View My Orders</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReturnPolicy;
