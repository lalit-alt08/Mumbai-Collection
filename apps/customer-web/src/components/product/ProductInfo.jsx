import { useNavigate } from "react-router-dom";
import {
  addToCart as addToWooCart,
  updateCartItem,
  removeCartItem,
} from "../../services/storeApi";
import { useCart } from "../../context/CartContext";

function ProductInfo({ product }) {
  const navigate = useNavigate();
  const { cart, refreshCart } = useCart();

  const cartItem = cart?.items?.find(
    (item) => Number(item.id) === Number(product.id)
  );

  const handleAddToCart = async () => {
    try {
      await addToWooCart(product.id);
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

      {!cartItem ? (
        <button
          onClick={handleAddToCart}
          className="w-full rounded-xl bg-green-600 py-3 font-semibold text-white transition hover:bg-green-700"
        >
          Add to Cart
        </button>
      ) : (
        <div className="flex w-full items-center justify-center rounded-xl bg-green-600 text-white">
          <button
            className="px-5 py-3 text-xl"
            onClick={async () => {
              if (cartItem.quantity === 1) {
                await removeCartItem(cartItem.key);
              } else {
                await updateCartItem(
                  cartItem.key,
                  cartItem.quantity - 1
                );
              }

              await refreshCart();
            }}
          >
            −
          </button>

          <span className="px-6 text-lg font-bold">
            {cartItem.quantity}
          </span>

          <button
            className="px-5 py-3 text-xl"
            onClick={async () => {
              await updateCartItem(
                cartItem.key,
                cartItem.quantity + 1
              );

              await refreshCart();
            }}
          >
            +
          </button>
        </div>
      )}

      <button
        onClick={() => navigate("/cart")}
        className="w-full rounded-xl border border-green-600 py-3 font-semibold text-green-600 transition hover:bg-green-50"
      >
        Buy Now
      </button>
    </div>
  );
}

export default ProductInfo;