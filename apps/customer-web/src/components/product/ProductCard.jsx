import { useNavigate } from "react-router-dom";
import useCartStore from "../../store/cartstore";

function ProductCard({ product }) {
  const navigate = useNavigate();

  const cart = useCartStore((state) => state.cart);
  const addToCart = useCartStore((state) => state.addToCart);
  const increaseQuantity = useCartStore((state) => state.increaseQuantity);
  const decreaseQuantity = useCartStore((state) => state.decreaseQuantity);

  const cartItem = cart.find((item) => item.id === product.id);

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

        <p className="text-lg font-bold">
          ₹{product.price}
        </p>

        {!cartItem ? (
          <button
            onClick={() => addToCart(product)}
            className="rounded-lg border border-green-600 px-5 py-2 text-sm font-semibold text-green-600 transition hover:bg-green-600 hover:text-white"
          >
            ADD
          </button>
        ) : (
          <div className="flex items-center rounded-lg bg-green-600 text-white">

            <button
              onClick={() => decreaseQuantity(product.id)}
              className="px-3 py-2"
            >
              −
            </button>

            <span className="px-2 text-sm font-semibold">
              {cartItem.quantity}
            </span>

            <button
              onClick={() => increaseQuantity(product.id)}
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