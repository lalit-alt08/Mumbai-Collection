import { triggerHaptic } from '../utils/haptics';
import { useNavigate } from "react-router-dom";
import {
  Phone,
  MapPin,
  Clock,
  ArrowLeft,
  ChevronLeft,
  MessageCircle,
  ExternalLink,
  HelpCircle,
} from "lucide-react";

function Contact() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#F0F8E8] text-[#1E293B] px-4 pt-3 pb-28 sm:px-6 md:pt-6 md:pb-16">
      <div className="mx-auto max-w-2xl space-y-3.5 sm:space-y-4">
        {/* TOP BAR / NAVIGATION (Pill Design) */}
        <div className="mb-4 sm:mb-6 flex items-center justify-between gap-2.5 sm:gap-3">
          {/* Left: Circular Back Button */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic("light");
              navigate(-1);
            }}
            aria-label="Go Back"
            className="flex h-12 w-12 sm:h-[52px] sm:w-[52px] shrink-0 items-center justify-center rounded-full bg-[#FFFFFF]/90 backdrop-blur-md text-[#1E293B] border border-[#E2E8F0] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.06)] transition-all hover:bg-[#FFFFFF] hover:border-[#22499F]/40 hover:text-[#22499F] active:scale-95 cursor-pointer"
          >
            <ChevronLeft size={23} strokeWidth={2.5} />
          </button>

          {/* Center: Capsule utilizing available space with clear typography */}
          <div className="flex-1 min-w-0 flex items-center justify-center rounded-full bg-[#FFFFFF]/95 backdrop-blur-md border border-[#E2E8F0] px-5 sm:px-7 py-2.5 sm:py-3 min-h-[48px] sm:min-h-[52px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.12),0_2px_10px_rgba(0,0,0,0.06)]">
            <h1 className="text-[17px] sm:text-[19px] font-extrabold text-[#1E293B] tracking-[-0.01em] leading-normal antialiased select-none truncate">
              Help & Support
            </h1>
          </div>

          {/* Right Spacer for optical balance */}
          <div className="w-12 sm:w-[52px] shrink-0" aria-hidden="true" />
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* DIRECT CONTACT CHANNELS CARD                               */}
        {/* ────────────────────────────────────────────────────────── */}
        <section className="rounded-[20px] border border-[#E2E8F0]/80 bg-[#FFFFFF] p-4 sm:p-5 shadow-lg space-y-3.5">
          <div className="flex items-center gap-2.5 border-b border-[#E2E8F0]/60 pb-2.5">
            <div className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0]">
              <HelpCircle size={17} strokeWidth={2.2} />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-extrabold text-[#1E293B]">
                Store Contact Channels
              </h2>
              <p className="text-xs font-medium text-[#64748B]">
                Reach our team directly for instant order & delivery help
              </p>
            </div>
          </div>

          <div className="space-y-2.5">
            {/* WhatsApp Support (Click to chat) */}
            <a
              href="https://wa.me/918793601567?text=Hi%20Mumbai%20Collection,%20I%20need%20help%20with%20my%20order"
              target="_blank"
              rel="noopener noreferrer"
              className="support-whatsapp group flex items-center justify-between rounded-xl border border-[#25D366]/35 bg-[#0B2518]/70 p-3.5 transition-all hover:border-[#25D366]/70 hover:bg-[#0D2E1E] shadow-[0_4px_20px_rgba(37,211,102,0.06)] active:scale-[0.99]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#25D366] text-[#FFFFFF] font-bold shadow-xs shadow-[#25D366]/20">
                  <MessageCircle size={19} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-xs sm:text-sm font-extrabold text-[#1E293B] group-hover:text-white transition-colors">
                      WhatsApp Quick Help
                    </h3>
                    <span className="rounded bg-[#051C10] border border-[#25D366]/40 px-1.5 py-0.2 text-[9px] font-extrabold text-[#25D366] uppercase tracking-wide">
                      Fastest
                    </span>
                  </div>
                  <p className="text-xs font-bold text-[#25D366] mt-0.5">
                    +91 87936 01567
                  </p>
                  <p className="text-xs font-medium text-[#64748B] mt-0.5">
                    Instant reply for order tracking & item inquiries
                  </p>
                </div>
              </div>
              <ExternalLink
                size={16}
                className="text-[#25D366] transition-transform group-hover:translate-x-0.5 group-hover:text-[#4ADE80] shrink-0"
              />
            </a>

            {/* Direct Phone Call */}
            <a
              href="tel:+918793601567"
              className="group flex items-center justify-between rounded-xl border border-[#E2E8F0] bg-[#F0F8E8] p-3.5 transition-all hover:bg-[#FFFFFF] hover:border-[#22499F]/50 active:scale-[0.99]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFFFFF] text-[#22499F] shadow-xs border border-[#E2E8F0]">
                  <Phone size={18} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs sm:text-sm font-bold text-[#1E293B] group-hover:text-[#22499F] transition-colors">
                    Phone Call Support
                  </h3>
                  <p className="text-xs font-bold text-[#1E293B] mt-0.5">
                    +91 87936 01567
                  </p>
                  <p className="text-xs font-medium text-[#64748B]">
                    Direct Vasai retail store line
                  </p>
                </div>
              </div>
              <span className="text-xs font-bold text-[#22499F] group-hover:underline">
                Call Now
              </span>
            </a>



            {/* Store Address & Operating Hours */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <div className="flex items-start gap-2.5 rounded-xl border border-[#E2E8F0] bg-[#F0F8E8] p-3">
                <MapPin size={16} className="mt-0.5 shrink-0 text-[#22499F]" />
                <div className="text-xs">
                  <span className="font-extrabold text-[#1E293B]">Vasai Store Address</span>
                  <p className="text-[#64748B] font-medium mt-0.5 leading-snug">
                    Mumbai Collection Retail Store<br />
                    Vasai, Maharashtra – 401202
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border border-[#E2E8F0] bg-[#F0F8E8] p-3">
                <Clock size={16} className="mt-0.5 shrink-0 text-[#22499F]" />
                <div className="text-xs">
                  <span className="font-extrabold text-[#1E293B]">Store Hours</span>
                  <p className="text-[#64748B] font-medium mt-0.5 leading-snug">
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
