import { useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft,
  RotateCcw,
  Clock,
  PackageCheck,
  AlertCircle,
  CheckCircle2,
  XCircle,
  MessageCircle,
  Store,
  Sparkles,
  CreditCard,
  Box,
  Truck,
  ChevronRight,
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

  const categories = [
    {
      name: "Toys, Board Games & Kids",
      badge: "72h Replacement",
      badgeColor: "bg-purple-100 text-purple-700",
      rule: "Free replacement for broken parts, transit damage, or missing components. Must be in unopened outer box with untouched factory seal.",
      icon: "🧸",
    },
    {
      name: "PlayStation & Gaming Gear",
      badge: "72h Tech Replacement",
      badgeColor: "bg-blue-100 text-blue-700",
      rule: "Replacement only for Dead-on-Arrival (DOA) or functional factory defects. Must include all cables, manuals, untouched packaging & matching serials.",
      icon: "🎮",
    },
    {
      name: "Stationery & Art Supplies",
      badge: "72h Easy Swap",
      badgeColor: "bg-emerald-100 text-emerald-700",
      rule: "Immediate replacement if markers are dried out, sketchbooks bent, or wrong shade received. Items must be completely unused & in original plastic wrapper.",
      icon: "🎨",
    },
    {
      name: "Electronics, Cables & Audio",
      badge: "72h Verification",
      badgeColor: "bg-amber-100 text-amber-700",
      rule: "Functional defects covered. Must include original box, blister pack, and all accessories. Physical drop damage or water exposure is not eligible.",
      icon: "🔌",
    },
    {
      name: "Gifts, Clocks & Novelties",
      badge: "72h Damage Cover",
      badgeColor: "bg-rose-100 text-rose-700",
      rule: "Full replacement for glass cracks, transit dents, or defects. Share a quick unboxing picture to trigger instant local doorstep replacement.",
      icon: "🎁",
    },
    {
      name: "Hygiene & Personal Care",
      badge: "Non-Returnable",
      badgeColor: "bg-gray-100 text-gray-600",
      rule: "Socks, personal grooming items, and unsealed consumables are non-returnable once opened due to strict health and sanitation regulations.",
      icon: "🛡️",
    },
  ];

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
          href="https://wa.me/919876543210?text=Hi%20Mumbai%20Collection,%20I%20have%20a%20question%20regarding%20returns."
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
        {/* ================= HERO HIGHLIGHT BANNER ================= */}
        <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-[#7C3AED] via-[#6D28D9] to-[#4C1D95] p-5 text-white shadow-[0_12px_32px_rgba(124,58,237,0.2)] sm:p-7">
          <div className="relative z-10 space-y-3">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-purple-100 backdrop-blur-md">
              <Clock size={13} className="text-amber-300" />
              Blinkit-Speed 72-Hour Guarantee
            </div>

            <h2 className="text-xl font-black tracking-tight sm:text-2xl md:text-3xl leading-snug">
              Fast, Transparent & Hassle-Free Returns
            </h2>

            <p className="text-xs sm:text-sm text-purple-100 max-w-2xl leading-relaxed">
              Because we are your local Vasai store, you never have to wait days for customer support. Report any eligible issue within <strong>72 hours of delivery</strong> in <strong>100% untouched condition</strong> for instant doorstep pickup, replacement, or refund.
            </p>

            {/* 4 Quick Badges */}
            <div className="grid grid-cols-2 gap-2 pt-2 sm:grid-cols-4 sm:gap-3">
              <div className="rounded-xl bg-white/10 p-2.5 backdrop-blur-xs border border-white/10">
                <p className="text-[11px] font-medium text-purple-200">Window</p>
                <p className="text-sm font-black text-white">72 Hours</p>
              </div>
              <div className="rounded-xl bg-white/10 p-2.5 backdrop-blur-xs border border-white/10">
                <p className="text-[11px] font-medium text-purple-200">Condition</p>
                <p className="text-sm font-black text-white">100% Untouched</p>
              </div>
              <div className="rounded-xl bg-white/10 p-2.5 backdrop-blur-xs border border-white/10">
                <p className="text-[11px] font-medium text-purple-200">Pickup</p>
                <p className="text-sm font-black text-white">Vasai Doorstep</p>
              </div>
              <div className="rounded-xl bg-white/10 p-2.5 backdrop-blur-xs border border-white/10">
                <p className="text-[11px] font-medium text-purple-200">Refunds</p>
                <p className="text-sm font-black text-white">Instant UPI</p>
              </div>
            </div>
          </div>

          {/* Decorative Background Circles */}
          <div className="pointer-events-none absolute -right-12 -bottom-12 h-56 w-56 rounded-full bg-purple-500/20 blur-2xl" />
          <div className="pointer-events-none absolute -top-8 right-12 h-32 w-32 rounded-full bg-amber-400/10 blur-xl" />
        </div>

        {/* ================= 1. THE 72-HOUR RULE CARD ================= */}
        <div className="rounded-[20px] border border-gray-100 bg-white p-5 shadow-xs sm:p-6 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <Clock size={19} />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">
                1. The 72-Hour Reporting Window
              </h3>
              <p className="text-xs text-gray-500">
                Timeframe starts immediately upon delivery confirmation
              </p>
            </div>
          </div>

          <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
            All return, replacement, or damage claims must be initiated within <strong>72 hours (3 days)</strong> of the delivery timestamp recorded by our courier partner.
          </p>

          <div className="rounded-xl bg-amber-50/70 p-3.5 border border-amber-100 text-xs text-amber-900 leading-relaxed flex items-start gap-2.5">
            <AlertCircle size={16} className="shrink-0 text-amber-600 mt-0.5" />
            <span>
              <strong>Why 72 hours?</strong> Being a local Vasai quick store, prompt reporting allows us to dispatch our local delivery agent for a same-day doorstep inspection and replacement before distributor batches sell out.
            </span>
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
                  <span><strong>Reported After 72 Hours:</strong> Requests initiated after the 72-hour window has lapsed.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* ================= 3. CATEGORY SPECIFIC MATRIX ================= */}
        <div className="rounded-[20px] border border-gray-100 bg-white p-5 shadow-xs sm:p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Box size={19} />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">
                3. Category-Specific Return Guidelines
              </h3>
              <p className="text-xs text-gray-500">
                Tailored rules for Mumbai Collection's product categories
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {categories.map((cat, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-gray-100 bg-gray-50/50 p-3.5 space-y-1.5 transition hover:border-purple-200 hover:bg-white"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-xs sm:text-sm text-gray-900">
                    <span>{cat.icon}</span>
                    <span>{cat.name}</span>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cat.badgeColor}`}
                  >
                    {cat.badge}
                  </span>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">
                  {cat.rule}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* ================= 4. STEP-BY-STEP RETURN TIMELINE (BLINKIT STYLE) ================= */}
        <div className="rounded-[20px] border border-gray-100 bg-white p-5 shadow-xs sm:p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <RotateCcw size={19} />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">
                4. How to Raise a Return or Replacement (4 Simple Steps)
              </h3>
              <p className="text-xs text-gray-500">
                Average resolution time: under 4 hours across Vasai-Virar
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 space-y-1.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#7C3AED] text-xs font-black text-white">
                1
              </div>
              <h4 className="text-xs font-bold text-gray-900">Raise in 72h</h4>
              <p className="text-[11px] text-gray-600 leading-normal">
                Open <Link to="/orders" className="text-[#7C3AED] font-semibold underline">My Orders</Link> or tap WhatsApp button with your Order ID.
              </p>
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 space-y-1.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#7C3AED] text-xs font-black text-white">
                2
              </div>
              <h4 className="text-xs font-bold text-gray-900">Share Visual Proof</h4>
              <p className="text-[11px] text-gray-600 leading-normal">
                Send 2 clear photos or a 10-second unboxing video showing the intact seal or defect.
              </p>
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 space-y-1.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#7C3AED] text-xs font-black text-white">
                3
              </div>
              <h4 className="text-xs font-bold text-gray-900">Doorstep Pickup</h4>
              <p className="text-[11px] text-gray-600 leading-normal">
                Our Vasai delivery agent visits your doorstep to verify the untouched condition.
              </p>
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 space-y-1.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#7C3AED] text-xs font-black text-white">
                4
              </div>
              <h4 className="text-xs font-bold text-gray-900">Instant Resolution</h4>
              <p className="text-[11px] text-gray-600 leading-normal">
                Immediate item replacement handed over, or 100% refund initiated via UPI/source.
              </p>
            </div>
          </div>
        </div>

        {/* ================= 5. VASAI STORE WALK-IN ADVANTAGE ================= */}
        <div className="rounded-[20px] border border-purple-200 bg-gradient-to-r from-purple-50 via-white to-purple-50 p-5 shadow-xs sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#7C3AED] text-white shadow-xs">
              <Store size={20} />
            </div>
            <div>
              <div className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-[#7C3AED]">
                <Sparkles size={11} /> Local Vasai Advantage
              </div>
              <h3 className="text-sm sm:text-base font-bold text-gray-900">
                Instant In-Store Walk-in Exchange
              </h3>
              <p className="text-xs text-gray-600 mt-0.5">
                Don't want to wait for pickup? Walk into our physical retail store in Vasai with your digital order confirmation for an immediate on-the-spot swap!
              </p>
            </div>
          </div>

          <Link
            to="/contact"
            className="shrink-0 rounded-full bg-[#7C3AED] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#6D28D9] active:scale-95 shadow-xs flex items-center gap-1.5"
          >
            Find Our Store <ChevronRight size={14} />
          </Link>
        </div>

        {/* ================= 6. REFUNDS & TIMELINES ================= */}
        <div className="rounded-[20px] border border-gray-100 bg-white p-5 shadow-xs sm:p-6 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <CreditCard size={19} />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">
                5. Refund Modes & Timelines
              </h3>
              <p className="text-xs text-gray-500">
                Direct and transparent processing with zero deduction fees
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 pt-1">
            <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 space-y-1">
              <p className="text-xs font-bold text-gray-800">UPI / Wallets</p>
              <p className="text-xs text-emerald-600 font-semibold">Instant to 4 Hours</p>
              <p className="text-[11px] text-gray-500">Google Pay, PhonePe, Paytm after pickup verification.</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 space-y-1">
              <p className="text-xs font-bold text-gray-800">Cards & Net Banking</p>
              <p className="text-xs text-blue-600 font-semibold">24 to 48 Hours</p>
              <p className="text-[11px] text-gray-500">Standard bank settlement back to original card.</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 space-y-1">
              <p className="text-xs font-bold text-gray-800">Cash on Delivery (COD)</p>
              <p className="text-xs text-purple-600 font-semibold">Instant UPI / Store Credit</p>
              <p className="text-[11px] text-gray-500">Directly transferred to your preferred UPI ID.</p>
            </div>
          </div>
        </div>

        {/* ================= 7. DIRECT SUPPORT & ACTION FOOTER ================= */}
        <div className="rounded-[20px] border border-gray-100 bg-white p-5 text-center shadow-xs sm:p-7 space-y-3">
          <h3 className="text-base font-bold text-gray-900">
            Have Questions About an Existing Order?
          </h3>
          <p className="text-xs sm:text-sm text-gray-600 max-w-md mx-auto">
            Our Vasai support team is available Monday to Sunday, 10:00 AM – 9:30 PM.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <a
              href="https://wa.me/919876543210?text=Hi%20Mumbai%20Collection,%20I%20would%20like%20to%20request%20a%20return/replacement%20for%20my%20order."
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
