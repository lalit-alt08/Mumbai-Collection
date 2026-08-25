import { useParams, Link } from "react-router-dom";
import {
  CheckCircle2,
  Package,
  CreditCard,
  Calendar,
  Home,
  MapPin,
  ArrowRight,
} from "lucide-react";

function OrderSuccess() {
  const { id } = useParams();

  return (
    <main className="relative min-h-[calc(100vh-80px)] w-full overflow-hidden bg-[#F7F7FB]">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,rgba(124,58,237,0.08),transparent_45%)]" />

      {/* Full-width content area */}
      <div className="relative z-10 flex w-full justify-center px-3 py-6 sm:px-5 sm:py-8 lg:min-h-[calc(100vh-80px)] lg:items-center lg:px-8 lg:py-8">

        <div className="w-full max-w-[960px] animate-[slideUp_0.3s_ease-out]">

          {/* MAIN CARD */}
          <section className="overflow-hidden rounded-[24px] border border-gray-100 bg-white shadow-[0_12px_40px_rgba(31,41,55,0.06)] sm:rounded-[28px]">

            <div className="grid lg:grid-cols-[0.9fr_1.1fr]">

              {/* LEFT SIDE */}
              <div className="flex flex-col justify-center px-5 py-7 text-center sm:px-8 sm:py-8 lg:border-r lg:border-gray-100 lg:px-10 lg:py-10 lg:text-left">

                {/* Success Icon */}
                <div className="mb-4 flex justify-center lg:justify-start">
                  <div className="relative flex h-[62px] w-[62px] items-center justify-center rounded-full bg-[#F1ECFF] sm:h-[66px] sm:w-[66px]">
                    <CheckCircle2
                      size={34}
                      className="text-[#7C3AED]"
                      strokeWidth={2.3}
                    />
                  </div>
                </div>

                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C3AED]">
                  Order #{id}
                </p>

                <h1 className="text-[25px] font-black leading-tight tracking-[-0.02em] text-[#1F2937] sm:text-[29px]">
                  Order placed
                  <br className="hidden lg:block" />
                  successfully! 🎉
                </h1>

                <p className="mx-auto mt-2.5 max-w-[380px] text-[13px] leading-5 text-[#6B7280] sm:text-sm sm:leading-6 lg:mx-0">
                  Thank you for shopping with Mumbai Collection.
                  Your order is confirmed and is now being processed.
                </p>

                {/* Delivery Badge */}
                <div className="mt-5 flex w-fit items-center gap-2 self-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-700 lg:self-start">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Estimated delivery: 20–30 mins
                </div>
              </div>

              {/* RIGHT SIDE */}
              <div className="px-4 py-5 sm:px-7 sm:py-7 lg:px-9 lg:py-9">

                {/* Order Summary */}
                <div className="rounded-2xl border border-gray-100 bg-[#FAFAFC] px-4">

                  <SummaryRow
                    icon={<Package size={17} />}
                    label="Order Number"
                    value={`#${id}`}
                  />

                  <SummaryRow
                    icon={
                      <span className="h-2.5 w-2.5 rounded-full bg-[#7C3AED]" />
                    }
                    label="Status"
                    value={
                      <span className="rounded-full border border-[#C4B5FD]/50 bg-[#F1ECFF] px-2.5 py-1 text-[11px] font-extrabold text-[#7C3AED]">
                        Processing
                      </span>
                    }
                  />

                  <SummaryRow
                    icon={<CreditCard size={17} />}
                    label="Payment"
                    value="Cash on Delivery"
                  />

                  <SummaryRow
                    icon={<Calendar size={17} />}
                    label="Est. Delivery"
                    value={
                      <span className="font-extrabold text-emerald-600">
                        20–30 mins
                      </span>
                    }
                    last
                  />
                </div>

                {/* Short message */}
                <p className="mt-3 text-center text-[11px] leading-4 text-gray-400">
                  Our local team will begin packing and dispatching your order shortly.
                </p>

                {/* Buttons */}
                <div className="mt-4 space-y-2">

                  {/* Track */}
                  <Link
                    to={`/orders/${id}/track`}
                    className="group flex h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-[#7C3AED] px-4 text-sm font-extrabold text-white shadow-[0_5px_16px_rgba(124,58,237,0.22)] transition-all hover:bg-[#6D35D9] active:scale-[0.99]"
                  >
                    <MapPin size={18} strokeWidth={2.3} />

                    <span>Track Live Order</span>

                    <ArrowRight
                      size={16}
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  </Link>

                  {/* Continue Shopping */}
                  <Link
                    to="/"
                    className="flex h-[42px] w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-bold text-gray-700 transition-all hover:bg-gray-50 active:scale-[0.99]"
                  >
                    <Home size={17} />

                    <span>Continue Shopping</span>
                  </Link>
                </div>

                {/* Support */}
                <p className="mt-3 text-center text-[10px] text-gray-400">
                  Need help?{" "}
                  <Link
                    to="/contact"
                    className="font-bold text-[#7C3AED] hover:underline"
                  >
                    Contact Support
                  </Link>
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes slideUp {
              from {
                opacity: 0;
                transform: translateY(8px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
          `,
        }}
      />
    </main>
  );
}

function SummaryRow({ icon, label, value, last = false }) {
  return (
    <div
      className={`flex min-h-[52px] items-center justify-between gap-3 ${
        !last ? "border-b border-gray-200/70" : ""
      }`}
    >
      <div className="flex min-w-0 items-center gap-2.5 text-xs font-medium text-gray-500">
        <span className="flex w-[18px] shrink-0 items-center justify-center text-[#7C3AED]">
          {icon}
        </span>

        <span>{label}</span>
      </div>

      <div className="shrink-0 text-right text-xs font-extrabold text-gray-900">
        {value}
      </div>
    </div>
  );
}

export default OrderSuccess;