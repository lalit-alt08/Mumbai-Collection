import { useNavigate } from "react-router-dom";
import {
  addToCart as addToWooCart,
  updateCartItem,
  removeCartItem,
} from "../../services/storeApi";
import { useCart } from "../../context/CartContext";

function ProductCard({ product }) {
  const navigate = useNavigate();

  const { cart, refreshCart } = useCart();

  const cartItem = cart?.items?.find(
    (item) => Number(item.id) === Number(product.id)
  );

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 transition hover:shadow-md">
      <div
        onClick={() => navigate(`/product/${product.id}`)}
        className="cursor-pointer"
      >
        <img
          src={product.images?.[0]?.src}
          alt={product.name}
          className="aspect-square w-full object-contain"
        />

        <h2 className="mt-3 line-clamp-2 text-sm font-medium md:text-base">
          {product.name}
        </h2>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-lg font-bold">₹{product.price}</p>

        {!cartItem ? (
          <button
            onClick={async () => {
              try {
                await addToWooCart(product.id);
                await refreshCart();
              } catch (error) {
                console.error(error);
              }
            }}
            className="rounded-lg border border-green-600 px-5 py-2 text-sm font-semibold text-green-600 transition hover:bg-green-600 hover:text-white"
          >
            ADD
          </button>
        ) : (
          <div className="flex items-center rounded-lg bg-green-600 text-white">
            <button
              onClick={async () => {
                try {
                  if (cartItem.quantity <= 1) {
                    await removeCartItem(cartItem.key);
                  } else {
                    await updateCartItem(
                      cartItem.key,
                      cartItem.quantity - 1
                    );
                  }

                  await refreshCart();
                } catch (error) {
                  console.error(error);
                }
              }}
              className="px-3 py-2"
            >
              −
            </button>

            <span className="px-2 text-sm font-semibold">
              {cartItem.quantity}
            </span>

            <button
              onClick={async () => {
                try {
                  await updateCartItem(
                    cartItem.key,
                    cartItem.quantity + 1
                  );

                  await refreshCart();
                } catch (error) {
                  console.error(error);
                }
              }}
              className="px-3 py-2"
            >
              +
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ProductCard;