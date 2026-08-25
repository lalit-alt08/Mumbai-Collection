import { useState, useEffect } from "react";
import { ArrowLeft, Heart, Share2, ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useFavorites } from "../../context/FavoritesContext";

function ProductGallery({ product }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const { isFavorited, toggleFavorite } = useFavorites();

  // Reset selected image when navigating to a new product
  useEffect(() => {
    setSelectedIndex(0);
  }, [product?.id]);

  const images = product?.images && product.images.length > 0
    ? product.images
    : [{ src: "https://via.placeholder.com/400?text=Product+Image" }];

  const favorited = isFavorited(product?.id);
  const safeIndex = Math.min(selectedIndex, images.length - 1);
  const currentImage = images[safeIndex] || images[0];

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

  const handleBack = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Check if there is valid in-app router history in this session
    if (
      window.history.state &&
      typeof window.history.state.idx === "number" &&
      window.history.state.idx > 0
    ) {
      navigate(-1);
    } else {
      // Safe fallback when product page is opened directly from URL/bookmark
      navigate("/", { replace: true });
    }
  };

  const handleToggleFav = async () => {
    const res = await toggleFavorite(product);
    if (res?.requiresAuth) {
      navigate("/login");
    }
  };

  const handlePrev = () => {
    setSelectedIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
  };

  const handleNext = () => {
    setSelectedIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
  };

  return (
    <div className="relative flex w-full flex-col bg-white pb-6 pt-0 lg:rounded-[24px] lg:pt-8 shadow-[0_8px_30px_rgba(0,0,0,0.03)] rounded-b-[32px] border border-gray-100/80">
      {/* Floating Action Icons */}
      <div className="absolute left-4 right-4 top-4 z-10 flex items-center justify-between lg:left-6 lg:right-6 lg:top-6">
        <button
          type="button"
          onClick={handleBack}
          aria-label="Go back"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-[#1F2937] shadow-[0_4px_12px_rgba(0,0,0,0.08)] backdrop-blur-md transition-transform hover:scale-105 cursor-pointer"
        >
          <ArrowLeft size={20} strokeWidth={2.5} />
        </button>
        <div className="flex items-center gap-2.5">
          {/* Wishlist Heart Button */}
          <button
            onClick={handleToggleFav}
            aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-[#1F2937] shadow-[0_4px_12px_rgba(0,0,0,0.08)] backdrop-blur-md transition-all hover:scale-105 active:scale-125 cursor-pointer"
          >
            <Heart
              size={20}
              className={`transition-all duration-300 ${
                favorited
                  ? "fill-[#7C3AED] text-[#7C3AED] scale-110"
                  : "text-[#1F2937] hover:text-[#7C3AED]"
              }`}
            />
          </button>

          {/* Share Button */}
          <button
            onClick={handleShare}
            aria-label="Share product"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-[#1F2937] shadow-[0_4px_12px_rgba(0,0,0,0.08)] backdrop-blur-md transition-transform hover:scale-105 cursor-pointer"
          >
            <Share2 size={19} />
          </button>
        </div>
      </div>

      {/* Main Image Container */}
      <div className="relative mx-auto mt-14 flex aspect-square w-full max-w-[420px] items-center justify-center p-4">
        <img
          src={currentImage.src}
          alt={currentImage.name || product.name}
          className="h-full w-full object-contain transition-transform duration-500 hover:scale-105"
          loading="lazy"
        />

        {/* Gallery Navigation Arrows (when multiple images exist) */}
        {images.length > 1 && (
          <>
            <button
              onClick={handlePrev}
              aria-label="Previous image"
              className="absolute left-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-gray-700 shadow-md backdrop-blur-xs transition-all hover:bg-white hover:scale-110 cursor-pointer"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={handleNext}
              aria-label="Next image"
              className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-gray-700 shadow-md backdrop-blur-xs transition-all hover:bg-white hover:scale-110 cursor-pointer"
            >
              <ChevronRight size={20} />
            </button>
          </>
        )}
      </div>

      {/* Multi-Image Thumbnails (2 or 3 images) */}
      {images.length > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2.5 px-4">
          {images.map((img, index) => {
            const isSelected = safeIndex === index;
            return (
              <button
                key={img.id || index}
                onClick={() => setSelectedIndex(index)}
                aria-label={`View image ${index + 1}`}
                className={`relative flex h-16 w-16 sm:h-18 sm:w-18 items-center justify-center rounded-xl overflow-hidden bg-[#FAFBFD] p-1 transition-all duration-300 cursor-pointer ${
                  isSelected
                    ? "border-2 border-[#7C3AED] ring-2 ring-[#7C3AED]/20 shadow-xs scale-105"
                    : "border border-gray-200 opacity-60 hover:opacity-100 hover:border-gray-300"
                }`}
              >
                <img
                  src={img.src}
                  alt={`Thumbnail ${index + 1}`}
                  className="h-full w-full object-contain"
                  loading="lazy"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ProductGallery;