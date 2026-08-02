import useCartStore from "../../store/cartstore";
import calculateSubtotal from "../../utils/calculateSubtotal";

function CartSummary() {
  const cart = useCartStore((state) => state.cart);

  const subtotal = calculateSubtotal(cart);

  return (
    <div className="sticky top-24 rounded-xl border bg-white p-6 shadow-sm">
      <h2 className="mb-6 text-xl font-bold">
        Order Summary
      </h2>

      <div className="mb-3 flex justify-between">
        <span>Subtotal</span>
        <span>₹{subtotal}</span>
      </div>

      <div className="mb-3 flex justify-between">
        <span>Delivery</span>
        <span className="text-green-600 font-semibold">
          FREE
        </span>
      </div>

      <hr className="my-4" />

      <div className="flex justify-between text-xl font-bold">
        <span>Total</span>
        <span>₹{subtotal}</span>
      </div>

      <button className="mt-6 w-full rounded-xl bg-green-600 py-3 font-semibold text-white hover:bg-green-700">
        Proceed to Checkout
      </button>
    </div>
  );
}

export default CartSummary;