import { useState } from "react";
import { ChevronDown } from "lucide-react";
import DOMPurify from "dompurify";

function ProductDescription({ product }) {
  const [isOpen, setIsOpen] = useState(false);

  const rawDescription = product?.description || product?.short_description;
  if (!rawDescription) return null;

  const sanitizedHtml = DOMPurify.sanitize(rawDescription, {
    USE_PROFILES: { html: true },
  });

  return (
    <section className="rounded-[24px] bg-[#FFFFFF] border border-[#E2E8F0]/80 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.25)] md:p-6">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between outline-none cursor-pointer"
      >
        <h2 className="text-[15px] font-bold uppercase tracking-wide text-[#1E293B]">
          About the Product
        </h2>
        <ChevronDown
          size={20}
          className={`text-[#22499F] transition-transform duration-300 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div
          className="prose prose-sm mt-4 max-w-none text-[#64748B] prose-p:leading-relaxed prose-headings:text-[#1E293B] prose-a:text-[#22499F] prose-strong:text-[#1E293B]"
          dangerouslySetInnerHTML={{
            __html: sanitizedHtml,
          }}
        />
      )}
    </section>
  );
}

export default ProductDescription;