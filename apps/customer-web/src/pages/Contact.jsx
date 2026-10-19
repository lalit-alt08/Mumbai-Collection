import { useNavigate } from "react-router-dom";
import {
  Phone,
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
    <div className="min-h-screen bg-[#0B1425] text-[#F1F5F9] px-4 pt-3 pb-28 sm:px-6 md:pt-6 md:pb-16">
      <div className="mx-auto max-w-2xl space-y-3.5 sm:space-y-4">
        {/* ────────────────────────────────────────────────────────── */}
        {/* COMPACT TOP BAR                                            */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Go Back"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#111F36] text-[#F1F5F9] shadow-xs border border-[#1E3252] transition-all hover:border-[#42D6E8]/50 hover:bg-[#162744] hover:text-[#42D6E8] active:scale-95 cursor-pointer"
          >
            <ArrowLeft size={17} strokeWidth={2.4} />
          </button>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-[#F1F5F9] sm:text-xl md:text-2xl">
              Help & Customer Support
            </h1>
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* DIRECT CONTACT CHANNELS CARD                               */}
        {/* ────────────────────────────────────────────────────────── */}
        <section className="rounded-[20px] border border-[#1E3252]/80 bg-[#111F36] p-4 sm:p-5 shadow-lg space-y-3.5">
          <div className="flex items-center gap-2.5 border-b border-[#1E3252]/60 pb-2.5">
            <div className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg bg-[#132B45] text-[#42D6E8] border border-[#1E3252]">
              <HelpCircle size={17} strokeWidth={2.2} />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-extrabold text-[#F1F5F9]">
                Store Contact Channels
              </h2>
              <p className="text-[11px] font-medium text-[#8FA4BE]">
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
              className="group flex items-center justify-between rounded-xl border border-[#1E3252] bg-[#132B45] p-3.5 transition-all hover:border-[#42D6E8]/50 hover:bg-[#162744] shadow-xs active:scale-[0.99]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#42D6E8] text-[#061220] font-bold shadow-xs">
                  <MessageCircle size={19} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-xs sm:text-sm font-extrabold text-[#F1F5F9]">
                      WhatsApp Quick Help
                    </h3>
                    <span className="rounded bg-[#080F1C] border border-[#1E3252] px-1.5 py-0.2 text-[9px] font-bold text-[#67E8F9] uppercase">
                      Fastest
                    </span>
                  </div>
                  <p className="text-xs font-bold text-[#67E8F9] mt-0.5">
                    +91 87936 01567
                  </p>
                  <p className="text-[11px] font-medium text-[#8FA4BE] mt-0.5">
                    Instant reply for order tracking & item inquiries
                  </p>
                </div>
              </div>
              <ExternalLink
                size={16}
                className="text-[#42D6E8] transition-transform group-hover:translate-x-0.5 shrink-0"
              />
            </a>

            {/* Direct Phone Call */}
            <a
              href="tel:+918793601567"
              className="group flex items-center justify-between rounded-xl border border-[#1E3252] bg-[#080F1C] p-3.5 transition-all hover:bg-[#162744] hover:border-[#42D6E8]/50 active:scale-[0.99]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#132B45] text-[#42D6E8] shadow-xs border border-[#1E3252]">
                  <Phone size={18} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs sm:text-sm font-bold text-[#F1F5F9] group-hover:text-[#42D6E8] transition-colors">
                    Phone Call Support
                  </h3>
                  <p className="text-xs font-bold text-[#F1F5F9] mt-0.5">
                    +91 87936 01567
                  </p>
                  <p className="text-[11px] font-medium text-[#8FA4BE]">
                    Direct Vasai retail store line
                  </p>
                </div>
              </div>
              <span className="text-xs font-bold text-[#42D6E8] group-hover:underline">
                Call Now
              </span>
            </a>



            {/* Store Address & Operating Hours */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <div className="flex items-start gap-2.5 rounded-xl border border-[#1E3252] bg-[#080F1C] p-3">
                <MapPin size={16} className="mt-0.5 shrink-0 text-[#42D6E8]" />
                <div className="text-xs">
                  <span className="font-extrabold text-[#F1F5F9]">Vasai Store Address</span>
                  <p className="text-[#8FA4BE] font-medium mt-0.5 leading-snug">
                    Mumbai Collection Retail Store<br />
                    Vasai, Maharashtra – 401202
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border border-[#1E3252] bg-[#080F1C] p-3">
                <Clock size={16} className="mt-0.5 shrink-0 text-[#42D6E8]" />
                <div className="text-xs">
                  <span className="font-extrabold text-[#F1F5F9]">Store Hours</span>
                  <p className="text-[#8FA4BE] font-medium mt-0.5 leading-snug">
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
