import { updateCartItem, removeCartItem } from "../services/storeApi";
import { useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";

function Cart() {
  const navigate = useNavigate();
  const { cart, loading, refreshCart } = useCart();

  if (loading) return <h2>Loading...</h2>;

  if (!cart || cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <h1 className="mb-6 text-3xl font-bold">Shopping Cart</h1>
        <h2>Your cart is empty.</h2>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-3xl font-bold">Shopping Cart</h1>

      {cart.items.map((item) => (
        <div
          key={item.key}
          className="mb-4 flex items-center gap-4 rounded-xl border p-4"
        >
          <img
            src={item.images?.[0]?.src}
            alt={item.name}
            className="h-24 w-24 rounded-lg object-contain"
          />

          <div className="flex-1">
            <h2 className="font-semibold">{item.name}</h2>

            <p className="mt-1 font-bold">₹{Number(item.prices.price) / 100}</p>

            <div className="mt-3 flex items-center rounded-lg bg-green-600 w-fit text-white">
              <button
                onClick={async () => {
                  if (item.quantity === 1) {
                    await removeCartItem(item.key);
                  } else {
                    await updateCartItem(item.key, item.quantity - 1);
                  }

                  await refreshCart();
                }}
                className="px-3 py-2"
              >
                −
              </button>

              <span className="px-3 font-semibold">{item.quantity}</span>

              <button
                onClick={async () => {
                  await updateCartItem(item.key, item.quantity + 1);

                  await refreshCart();
                }}
                className="px-3 py-2"
              >
                +
              </button>
            </div>
          </div>

          <div className="text-right">
            <p className="font-bold text-lg">
              ₹{Number(item.totals.line_total) / 100}
            </p>
          </div>
        </div>
      ))}

      <div className="mt-8 rounded-xl border p-5">
        <div className="flex justify-between text-lg">
          <span>Items</span>
          <span>{cart.items_count}</span>
        </div>

        <div className="mt-2 flex justify-between text-lg">
          <span>Total</span>
          <span className="font-bold">
            ₹{Number(cart.totals.total_price) / 100}
          </span>
        </div>

        <button
          onClick={() => navigate("/checkout")}
          className="mt-6 w-full rounded-xl bg-green-600 py-3 font-semibold text-white hover:bg-green-700"
        >
          Proceed to Checkout
        </button>
      </div>
    </div>
  );
}

export default Cart;
