import { useState } from "react";
import { addToCart as addToWooCart } from "../../services/storeApi";
import { useCart } from "../../context/CartContext";

function ProductInfo({ product }) {
  const { refreshCart } = useCart();

  const [quantity, setQuantity] = useState(1);

  const increase = () => {
    if (quantity < product.stock_quantity) {
      setQuantity((q) => q + 1);
    }
  };

  const decrease = () => {
    if (quantity > 1) {
      setQuantity((q) => q - 1);
    }
  };

  const handleAddToCart = async () => {
    try {
      await addToWooCart(product.id, quantity);
      await refreshCart();
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{product.name}</h1>

        <p className="mt-2 text-sm text-gray-500">
          SKU: {product.sku || "N/A"}
        </p>
      </div>

      <div className="flex items-end gap-3">
        <span className="text-4xl font-bold text-green-600">
          ₹{product.price}
        </span>

        {product.regular_price !== product.price && (
          <span className="text-xl text-gray-400 line-through">
            ₹{product.regular_price}
          </span>
        )}
      </div>

      <div>
        {product.stock_quantity > 0 ? (
          <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
            In Stock ({product.stock_quantity})
          </span>
        ) : (
          <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-700">
            Out of Stock
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center rounded-lg border">
          <button onClick={decrease} className="px-4 py-3 text-xl">
            −
          </button>

          <span className="w-12 text-center font-semibold">
            {quantity}
          </span>

          <button onClick={increase} className="px-4 py-3 text-xl">
            +
          </button>
        </div>

        <button
          onClick={handleAddToCart}
          className="flex-1 rounded-xl bg-green-600 py-3 font-semibold text-white transition hover:bg-green-700"
        >
          Add to Cart
        </button>
      </div>

      <button className="w-full rounded-xl border border-green-600 py-3 font-semibold text-green-600 transition hover:bg-green-50">
        Buy Now
      </button>
    </div>
  );
}

export default ProductInfo;