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
    <section className="rounded-[24px] bg-[#111F36] border border-[#1E3252]/80 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.25)] md:p-6">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between outline-none cursor-pointer"
      >
        <h2 className="text-[15px] font-bold uppercase tracking-wide text-[#F1F5F9]">
          About the Product
        </h2>
        <ChevronDown
          size={20}
          className={`text-[#42D6E8] transition-transform duration-300 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div
          className="prose prose-sm mt-4 max-w-none text-[#8FA4BE] prose-p:leading-relaxed prose-headings:text-[#F1F5F9] prose-a:text-[#42D6E8] prose-strong:text-[#F1F5F9]"
          dangerouslySetInnerHTML={{
            __html: sanitizedHtml,
          }}
        />
      )}
    </section>
  );
}

export default ProductDescription;