import { useState } from "react";

function ProductGallery({ product }) {
  const [selectedImage, setSelectedImage] = useState(
    product.images?.[0]?.src
  );

  return (
    <div className="space-y-4">

      {/* Main Image */}
      <div className="overflow-hidden rounded-2xl border bg-white p-6">
        <img
          src={selectedImage}
          alt={product.name}
          className="aspect-square w-full object-contain transition-transform duration-300 hover:scale-105"
        />
      </div>

      {/* Thumbnails */}
      {product.images.length > 1 && (
        <div className="grid grid-cols-4 gap-3">
          {product.images.map((image) => (
            <button
              key={image.id}
              onClick={() => setSelectedImage(image.src)}
              className={`overflow-hidden rounded-xl border p-2 transition
                ${
                  selectedImage === image.src
                    ? "border-green-600"
                    : "border-gray-200"
                }`}
            >
              <img
                src={image.src}
                alt=""
                className="aspect-square w-full object-contain"
              />
            </button>
          ))}
        </div>
      )}

    </div>
  );
}

export default ProductGallery;