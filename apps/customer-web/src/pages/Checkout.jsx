import { useEffect, useState } from "react";
import { getCart, getCheckout } from "../services/storeApi";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ShoppingBag } from "lucide-react";
import BillingForm from "../components/checkout/BillingForm";

function Checkout() {
  const navigate = useNavigate();

  const [checkout, setCheckout] = useState(null);
  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadCheckout = async () => {
    try {
      setLoading(true);
      setError("");
      const [cartData, checkoutData] = await Promise.all([
        getCart(),
        getCheckout(),
      ]);
      setCart(cartData);
      setCheckout(checkoutData);
    } catch (err) {
      console.error("Checkout load error:", err);
      setError("Unable to load your checkout session. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCheckout();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-[15px] font-medium text-[#666666]">
          Loading secure checkout...
        </div>
      </div>
    );
  }

  if (error || !cart || !checkout) {
    return (
      <div className="mx-auto flex max-w-[500px] flex-col items-center justify-center px-6 py-20 text-center">
        <h2 className="text-xl font-bold text-[#1E1E1E]">Checkout Unavailable</h2>
        <p className="mt-2 text-sm text-gray-500">
          {error || "Could not retrieve your cart items for checkout."}
        </p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => navigate("/cart")}
            className="rounded-full border border-gray-200 px-6 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50"
          >
            View Cart
          </button>
          <button
            onClick={loadCheckout}
            className="rounded-full bg-[#7C3AED] px-6 py-2.5 text-xs font-bold text-white hover:bg-[#6C35E8]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const discount = cart.totals?.total_discount
    ? Number(cart.totals.total_discount) / 100
    : 0;

  const delivery = cart.totals?.total_shipping
    ? Number(cart.totals.total_shipping) / 100
    : 0;

  const tax = cart.totals?.total_tax
    ? Number(cart.totals.total_tax) / 100
    : 0;

  const total = Number(cart.totals.total_price) / 100;

  const itemsTotal = cart.totals?.total_items
    ? Number(cart.totals.total_items) / 100
    : cart.items.reduce(
        (acc, item) =>
          acc +
          (Number(item.totals.line_subtotal) ||
            Number(item.totals.line_total) ||
            0),
        0,
      ) / 100;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-6 md:py-6">

      {/* Header */}
      <div className="mb-5 flex w-fit items-center rounded-[18px] bg-white px-3 py-3 shadow-[0_5px_20px_rgba(0,0,0,0.04)]">
        <button
          onClick={() => navigate(-1)}
          className="-ml-1 rounded-full p-2 text-[#1E1E1E] transition hover:bg-gray-50"
        >
          <ArrowLeft size={21} />
        </button>

        <h1 className="ml-1 text-[17px] font-bold text-[#1E1E1E]">
          Checkout
        </h1>
      </div>

      {/* 
        Mobile:
        Order Summary → Checkout Form

        Desktop:
        Checkout Form | Order Summary
      */}
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-6">

        {/* ORDER SUMMARY */}
        <div className="order-1 lg:order-2 lg:sticky lg:top-5">
          <div className="rounded-[20px] border border-[#C4B5FD]/40 bg-white p-5 shadow-[0_6px_24px_rgba(124,58,237,0.07)]">

            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#7C3AED]">
                <ShoppingBag size={18} className="text-white" />
              </div>

              <h2 className="text-[17px] font-bold text-[#1E1E1E]">
                Order Summary
              </h2>
            </div>

            {/* Products */}
            <div className="space-y-3">
              {cart.items.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center gap-3"
                >
                  <div className="flex h-[58px] w-[58px] flex-shrink-0 items-center justify-center rounded-[10px] border border-[#ECECEC] bg-white p-1">
                    <img
                      src={item.images?.[0]?.src}
                      alt={item.name}
                      className="h-full w-full object-contain"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-[#1E1E1E]">
                      {item.name}
                    </h3>

                    <p className="mt-1 text-[12px] text-[#777777]">
                      Qty:{" "}
                      <span className="font-medium text-[#1E1E1E]">
                        {item.quantity}
                      </span>
                    </p>
                  </div>

                  <div className="text-[14px] font-bold text-[#1E1E1E]">
                    ₹{Number(item.totals.line_total) / 100}
                  </div>
                </div>
              ))}
            </div>

            <hr className="my-4 border-[#ECECEC]" />

            <div className="space-y-2.5 text-[13px] text-[#666666]">

              <div className="flex items-center justify-between">
                <span>Items Subtotal</span>
                <span className="font-medium text-[#1E1E1E]">
                  ₹{itemsTotal}
                </span>
              </div>

              {discount > 0 && (
                <div className="flex items-center justify-between text-blue-600">
                  <span>Discount</span>
                  <span className="font-medium">
                    -₹{discount}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span>Delivery</span>

                {delivery === 0 ? (
                  <span className="font-bold text-[#7C3AED]">
                    FREE
                  </span>
                ) : (
                  <span className="font-medium text-[#1E1E1E]">
                    ₹{delivery}
                  </span>
                )}
              </div>

              {tax > 0 && (
                <div className="flex items-center justify-between">
                  <span>Tax</span>
                  <span className="font-medium text-[#1E1E1E]">
                    ₹{tax}
                  </span>
                </div>
              )}
            </div>

            <hr className="my-4 border-[#ECECEC]" />

            <div className="flex items-center justify-between">
              <span className="text-[15px] font-bold text-[#1E1E1E]">
                Grand Total
              </span>

              <span className="text-[22px] font-extrabold text-[#7C3AED]">
                ₹{total}
              </span>
            </div>
          </div>
        </div>

        {/* CHECKOUT FORM */}
        <div className="order-2 min-w-0 lg:order-1">
          <BillingForm />
        </div>

      </div>
    </div>
  );
}

export default Checkout;