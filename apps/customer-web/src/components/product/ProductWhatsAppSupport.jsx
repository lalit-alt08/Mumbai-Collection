import { getProductWhatsAppUrl } from "../../config/support.js";

function WhatsAppIcon({ className = "h-4 w-4" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

function ProductWhatsAppSupport({ product }) {
  const whatsappUrl = getProductWhatsAppUrl();

  return (
    <div className="rounded-[22px] border border-[#A9DDB8] bg-[#F5FCF6] p-5 shadow-[0_6px_16px_rgba(28,104,57,0.14)] sm:rounded-[26px] sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-5">
        {/* Left: Icon & Text Info */}
        <div className="flex items-center gap-4 sm:gap-4.5 min-w-0">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#8ED9A5] bg-[#E5F8EA] shadow-[0_2px_6px_rgba(28,104,57,0.12)]">
            <WhatsAppIcon className="h-6 w-6 text-[#167B3B]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-[16px] font-extrabold leading-snug tracking-[-0.01em] text-[#173022] sm:text-[17px]">
              Have questions about this product?
            </h3>
            <p className="mt-1.5 text-[13px] font-medium leading-normal text-[#486353] sm:mt-2 sm:text-[14px]">
              Get quick help from our store team on WhatsApp
            </p>
          </div>
        </div>

        {/* Right: CTA Button */}
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-12 w-full shrink-0 items-center justify-center gap-2.5 rounded-xl bg-[#1F9D55] px-6 py-3 text-[14px] font-extrabold text-[#FFFFFF] shadow-[0_4px_12px_rgba(31,157,85,0.28)] transition-all duration-200 hover:bg-[#167B3B] hover:shadow-[0_6px_16px_rgba(22,123,59,0.35)] active:scale-[0.98] cursor-pointer sm:w-auto sm:rounded-full sm:text-[15px]"
        >
          <WhatsAppIcon className="h-5 w-5 shrink-0" />
          <span>Chat on WhatsApp</span>
        </a>
      </div>
    </div>
  );
}

export default ProductWhatsAppSupport;
