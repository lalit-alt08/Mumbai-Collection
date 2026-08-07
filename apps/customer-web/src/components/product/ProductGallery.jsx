import { useState } from "react";
import { ArrowLeft, Heart, Share2, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";

function ProductGallery({ product }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: product.name,
          url: window.location.href,
        });
      } catch (err) {
        console.error("Error sharing", err);
      }
    }
  };

  return (
    <div className="relative flex w-full flex-col bg-white pb-8 pt-0 lg:rounded-[24px] lg:pt-8 shadow-[0_8px_30px_rgba(0,0,0,0.03)] rounded-b-[32px]">
      {/* Floating Action Icons */}
      <div className="absolute left-4 right-4 top-4 z-10 flex items-center justify-between lg:left-6 lg:right-6 lg:top-6">
        <button
          onClick={() => navigate(-1)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-[#1F2937] shadow-[0_4px_12px_rgba(0,0,0,0.1)] backdrop-blur-md transition-transform hover:scale-105"
        >
          <ArrowLeft size={20} strokeWidth={2.5} />
        </button>
        <div className="flex items-center gap-3">
          <button className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-[#1F2937] shadow-[0_4px_12px_rgba(0,0,0,0.1)] backdrop-blur-md transition-transform hover:scale-105">
            <Heart size={20} />
          </button>
          <button className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-[#1F2937] shadow-[0_4px_12px_rgba(0,0,0,0.1)] backdrop-blur-md transition-transform hover:scale-105">
            <Search size={20} />
          </button>
          <button
            onClick={handleShare}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-[#1F2937] shadow-[0_4px_12px_rgba(0,0,0,0.1)] backdrop-blur-md transition-transform hover:scale-105"
          >
            <Share2 size={20} />
          </button>
        </div>
      </div>

      {/* Main Image */}
      <div className="relative mx-auto mt-14 flex aspect-square w-full max-w-[400px] items-center justify-center p-4">
        <img
          src={product.images?.[selectedIndex]?.src}
          alt={product.name}
          className="h-full w-full object-contain transition-transform duration-500 hover:scale-105"
          loading="lazy"
        />
      </div>

      {/* Image Indicators (Dots) */}
      {product.images && product.images.length > 1 && (
        <div className="mt-4 flex justify-center gap-1.5">
          {product.images.map((_, index) => (
            <button
              key={index}
              onClick={() => setSelectedIndex(index)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                selectedIndex === index
                  ? "w-6 bg-[#3E8E2E]"
                  : "w-1.5 bg-[#D1D5DB]"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default ProductGallery;