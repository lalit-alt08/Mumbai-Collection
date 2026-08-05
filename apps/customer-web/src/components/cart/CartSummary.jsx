import { useNavigate } from "react-router-dom";
// import useCartStore from "../../store/cartstore";
import calculateSubtotal from "../../utils/calculateSubtotal";

function CartSummary() {
  const cart = useCartStore((state) => state.cart);
  const subtotal = calculateSubtotal(cart);
  const navigate = useNavigate();

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm lg:sticky lg:top-24 md:p-6">
      <h2 className="mb-5 text-lg font-bold md:text-xl">
        Order Summary
      </h2>

      <div className="mb-3 flex items-center justify-between text-sm md:text-base">
        <span>Subtotal</span>
        <span className="font-medium">₹{subtotal}</span>
      </div>

      <div className="mb-3 flex items-center justify-between text-sm md:text-base">
        <span>Delivery</span>
        <span className="font-semibold text-green-600">FREE</span>
      </div>

      <hr className="my-4" />

      <div className="flex items-center justify-between text-lg font-bold md:text-xl">
        <span>Total</span>
        <span>₹{subtotal}</span>
      </div>

      <button
        onClick={() => navigate("/checkout")}
        className="mt-6 w-full rounded-xl bg-green-600 py-3 text-sm font-semibold text-white transition hover:bg-green-700 md:text-base"
      >
        Proceed to Checkout
      </button>
    </div>
  );
}

export default CartSummary;