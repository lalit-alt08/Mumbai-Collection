import { useState } from "react";
import { ChevronDown } from "lucide-react";

function ProductDescription({ product }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!product.description) return null;

  return (
    <section className="rounded-[24px] bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.04)] md:p-6 border border-gray-100">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between outline-none"
      >
        <h2 className="text-[15px] font-bold uppercase tracking-wide text-[#1F2937]">
          About the Product
        </h2>
        <ChevronDown
          size={20}
          className={`text-[#1F2937] transition-transform duration-300 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div
          className="prose prose-sm mt-4 max-w-none text-[#6B7280] prose-p:leading-relaxed prose-headings:text-[#1F2937] prose-a:text-[#3E8E2E] prose-strong:text-[#1F2937] animate-[fadeIn_0.3s_ease-out]"
          dangerouslySetInnerHTML={{
            __html: product.description,
          }}
        />
      )}
    </section>
  );
}

export default ProductDescription;