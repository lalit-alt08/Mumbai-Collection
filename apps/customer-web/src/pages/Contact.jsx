import { useNavigate } from "react-router-dom";
import {
  Phone,
  Mail,
  MapPin,
  Clock,
  ArrowLeft,
  MessageCircle,
  ExternalLink,
  HelpCircle,
} from "lucide-react";

function Contact() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#F8F9FD] text-[#111827] px-4 pt-3 pb-28 sm:px-6 md:pt-6 md:pb-16">
      <div className="mx-auto max-w-2xl space-y-3.5 sm:space-y-4">
        {/* ────────────────────────────────────────────────────────── */}
        {/* COMPACT TOP BAR                                            */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Go Back"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#1F2937] shadow-xs border border-gray-200 transition-all hover:border-[#7C3AED]/40 hover:bg-[#F5F3FF] hover:text-[#7C3AED] active:scale-95 cursor-pointer"
          >
            <ArrowLeft size={17} strokeWidth={2.4} />
          </button>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-[#111827] sm:text-xl md:text-2xl">
              Help & Customer Support
            </h1>
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* DIRECT CONTACT CHANNELS CARD                               */}
        {/* ────────────────────────────────────────────────────────── */}
        <section className="rounded-[20px] border border-gray-200/90 bg-white p-4 sm:p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] space-y-3.5">
          <div className="flex items-center gap-2.5 border-b border-gray-100 pb-2.5">
            <div className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg bg-[#EDE9FE] text-[#6D28D9]">
              <HelpCircle size={17} strokeWidth={2.2} />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-extrabold text-[#111827]">
                Store Contact Channels
              </h2>
              <p className="text-[11px] font-medium text-gray-500">
                Reach our team directly for instant order & delivery help
              </p>
            </div>
          </div>

          <div className="space-y-2.5">
            {/* WhatsApp Support (Click to chat) */}
            <a
              href="https://wa.me/919876543210?text=Hi%20Mumbai%20Collection,%20I%20need%20help%20with%20my%20order"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between rounded-xl border border-emerald-200/90 bg-emerald-50/60 p-3.5 transition-all hover:bg-emerald-50 hover:border-emerald-300 hover:shadow-xs active:scale-[0.99]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
                  <MessageCircle size={19} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-xs sm:text-sm font-extrabold text-emerald-950">
                      WhatsApp Quick Help
                    </h3>
                    <span className="rounded bg-emerald-200/80 px-1.5 py-0.2 text-[9px] font-bold text-emerald-900 uppercase">
                      Fastest
                    </span>
                  </div>
                  <p className="text-xs font-bold text-emerald-800 mt-0.5">
                    +91 98765 43210
                  </p>
                  <p className="text-[11px] font-medium text-emerald-700 mt-0.5">
                    Instant reply for order tracking & item inquiries
                  </p>
                </div>
              </div>
              <ExternalLink
                size={16}
                className="text-emerald-600 transition-transform group-hover:translate-x-0.5 shrink-0"
              />
            </a>

            {/* Direct Phone Call */}
            <a
              href="tel:+919876543210"
              className="group flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50/70 p-3.5 transition-all hover:bg-[#F5F3FF] hover:border-[#7C3AED]/40 active:scale-[0.99]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EDE9FE] text-[#6D28D9] shadow-xs">
                  <Phone size={18} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs sm:text-sm font-bold text-[#111827] group-hover:text-[#6D28D9] transition-colors">
                    Phone Call Support
                  </h3>
                  <p className="text-xs font-bold text-gray-800 mt-0.5">
                    +91 98765 43210
                  </p>
                  <p className="text-[11px] font-medium text-gray-500">
                    Direct Vasai retail store line
                  </p>
                </div>
              </div>
              <span className="text-xs font-bold text-[#7C3AED] group-hover:underline">
                Call Now
              </span>
            </a>

            {/* Email Support */}
            <a
              href="mailto:support@mumbaicollection.in"
              className="group flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50/70 p-3.5 transition-all hover:bg-[#F5F3FF] hover:border-[#7C3AED]/40 active:scale-[0.99]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EDE9FE] text-[#6D28D9] shadow-xs">
                  <Mail size={18} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs sm:text-sm font-bold text-[#111827] group-hover:text-[#6D28D9] transition-colors">
                    Email Support
                  </h3>
                  <p className="text-xs font-bold text-gray-800 mt-0.5 truncate">
                    support@mumbaicollection.in
                  </p>
                  <p className="text-[11px] font-medium text-gray-500">
                    Queries answered within 24 hours
                  </p>
                </div>
              </div>
              <span className="text-xs font-bold text-[#7C3AED] group-hover:underline">
                Send Email
              </span>
            </a>

            {/* Store Address & Operating Hours */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <div className="flex items-start gap-2.5 rounded-xl border border-gray-200/90 bg-gray-50/60 p-3">
                <MapPin size={16} className="mt-0.5 shrink-0 text-[#7C3AED]" />
                <div className="text-xs">
                  <span className="font-extrabold text-[#111827]">Vasai Store Address</span>
                  <p className="text-gray-600 font-medium mt-0.5 leading-snug">
                    Mumbai Collection Retail Store<br />
                    Vasai, Maharashtra – 401202
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border border-gray-200/90 bg-gray-50/60 p-3">
                <Clock size={16} className="mt-0.5 shrink-0 text-[#7C3AED]" />
                <div className="text-xs">
                  <span className="font-extrabold text-[#111827]">Store Hours</span>
                  <p className="text-gray-600 font-medium mt-0.5 leading-snug">
                    Monday – Sunday<br />
                    10:00 AM – 9:30 PM (Daily)
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Contact;
