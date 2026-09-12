import { useEffect, useState } from "react";
import { getCart, getCheckout, getStoreHours } from "../services/storeApi";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ShoppingBag, Clock, AlertTriangle, ShieldAlert } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import BillingForm from "../components/checkout/BillingForm";
import { getCatalogImageUrl } from "../utils/imageUtils";

function Checkout() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [checkout, setCheckout] = useState(null);
  const [cart, setCart] = useState(null);
  const [storeHours, setStoreHours] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState(false);

  const loadCheckout = async () => {
    try {
      setLoading(true);
      setError("");
      setAuthError(false);

      // Phase 1: Initialize cart & WooCommerce session/nonce first (store hours runs in parallel)
      const [cartData, storeHoursData] = await Promise.all([
        getCart(),
        getStoreHours().catch(() => ({ is_open: true })),
      ]);
      setCart(cartData);
      setStoreHours(storeHoursData);

      // Phase 2: Session & Nonce are established, safely fetch checkout schema
      const checkoutData = await getCheckout();
      setCheckout(checkoutData);
    } catch (err) {
      const is401 = err?.response?.status === 401;
      if (is401) {
        setAuthError(true);
        setError("Your session has expired. Please log in again to proceed to checkout.");
      } else {
        setError(err?.response?.data?.message || "Unable to load your checkout session. Please try again.");
      }
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

  if (authError) {
    return (
      <div className="mx-auto flex max-w-[500px] flex-col items-center justify-center px-6 py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-800 font-bold border border-amber-200">
          <ShieldAlert size={28} />
        </div>
        <h2 className="mt-4 text-xl font-bold text-[#1E1E1E]">Session Expired</h2>
        <p className="mt-2 text-sm text-gray-500">
          Your login session has expired. Please log in again to continue to checkout.
        </p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => navigate("/login", { state: { from: "/checkout" } })}
            className="rounded-full bg-[#7C3AED] px-7 py-3 text-xs font-extrabold text-white shadow-[0_4px_16px_rgba(124,58,237,0.25)] hover:bg-[#6C35E8] active:scale-95 transition cursor-pointer"
          >
            Log In
          </button>
        </div>
      </div>
    );
  }

  if (error || !cart || !checkout) {
    return (
      <div className="mx-auto flex max-w-[500px] flex-col items-center justify-center px-6 py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-700 font-bold border border-rose-200">
          <AlertTriangle size={28} />
        </div>
        <h2 className="mt-4 text-xl font-bold text-[#1E1E1E]">Checkout Unavailable</h2>
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

  if (!cart.items || cart.items.length === 0) {
    return (
      <div className="mx-auto flex max-w-[500px] flex-col items-center justify-center px-6 py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-600 font-bold border border-gray-200">
          <ShoppingBag size={28} />
        </div>
        <h2 className="mt-4 text-xl font-bold text-[#1E1E1E]">Your Cart is Empty</h2>
        <p className="mt-2 text-sm text-gray-500">
          Add items to your cart before proceeding to checkout.
        </p>
        <div className="mt-6">
          <button
            onClick={() => navigate("/")}
            className="rounded-full bg-[#7C3AED] px-7 py-3 text-xs font-extrabold text-white shadow-[0_4px_16px_rgba(124,58,237,0.25)] hover:bg-[#6C35E8] active:scale-95 transition cursor-pointer"
          >
            Start Shopping
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
          (Number(item.totals?.line_subtotal) ||
            Number(item.totals?.line_total) ||
            0),
        0,
      ) / 100;

  const MIN_ORDER_VALUE = 500;
  if (itemsTotal < MIN_ORDER_VALUE) {
    const shortfall = Math.max(0, MIN_ORDER_VALUE - itemsTotal);
    return (
      <div className="mx-auto flex max-w-[520px] flex-col items-center justify-center px-6 py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-800 font-black text-lg border border-amber-200 shadow-xs">
          ₹500
        </div>
        <h2 className="mt-4 text-xl font-extrabold text-[#1E1E1E]">
          Minimum Order Value Not Met
        </h2>
        <p className="mt-2 text-sm font-semibold text-gray-600">
          A minimum product order value of <span className="font-extrabold text-gray-900">₹500</span> is required to place an order.
        </p>
        <p className="mt-1.5 text-xs font-bold text-amber-800">
          Please add <span className="font-extrabold text-amber-950 underline decoration-amber-500 decoration-2">₹{shortfall}</span> more of products to your cart.
        </p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => navigate("/cart")}
            className="rounded-full bg-[#7C3AED] px-7 py-3 text-xs font-extrabold text-white shadow-[0_4px_16px_rgba(124,58,237,0.25)] hover:bg-[#6C35E8] active:scale-95 transition cursor-pointer"
          >
            Return to Cart
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-6 md:py-6">

      {/* Header */}
      <div className="mb-5 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#1F2937] shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-100/80 transition-transform hover:scale-105 active:scale-95 cursor-pointer"
        >
          <ArrowLeft size={20} strokeWidth={2.4} />
        </button>

        <h1 className="text-xl font-extrabold tracking-tight text-[#1E1E1E] sm:text-2xl">
          Checkout
        </h1>
      </div>

      {/* Store Closed Informational Banner */}
      {storeHours && storeHours.is_open === false && (
        <div className="mb-5 rounded-[18px] border border-amber-200 bg-amber-50/90 p-4 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-white flex-shrink-0">
              <Clock size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-black text-amber-950">
                Store Closed for New Orders
              </h3>
              <p className="mt-0.5 text-xs text-amber-800 font-medium leading-relaxed">
                {storeHours.message || "We are currently closed for new orders."}
              </p>
              {storeHours.next_opening?.label && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-100/80 px-3 py-1 text-[11px] font-bold text-amber-900 border border-amber-300/60">
                  <span>Ordering resumes:</span>
                  <span className="font-extrabold underline">{storeHours.next_opening.label}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
                      src={getCatalogImageUrl(item)}
                      alt={item.name || "Order item"}
                      className="h-full w-full object-contain"
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-[13px] font-semibold text-[#1E1E1E] truncate">
                      {item.name}
                    </h3>
                    <p className="text-[11px] text-[#666666]">
                      Qty: {item.quantity}
                    </p>
                  </div>

                  <div className="text-right">
                    <span className="text-[13px] font-bold text-[#1E1E1E]">
                      ₹{(Number(item.totals?.line_total) || 0) / 100}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <hr className="my-4 border-[#ECECEC]" />

            {/* Pricing Breakdown */}
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between text-[#666666]">
                <span>Items Subtotal</span>
                <span>₹{itemsTotal}</span>
              </div>

              {discount > 0 && (
                <div className="flex justify-between text-emerald-600 font-medium">
                  <span>Discount</span>
                  <span>-₹{discount}</span>
                </div>
              )}

              <div className="flex justify-between text-[#666666]">
                <span>Delivery</span>
                <span>{delivery === 0 ? "Free" : `₹${delivery}`}</span>
              </div>

              {tax > 0 && (
                <div className="flex justify-between text-[#666666]">
                  <span>Tax</span>
                  <span>₹{tax}</span>
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
          <BillingForm storeHours={storeHours} onStoreClosed={() => setStoreHours((prev) => ({ ...(prev || {}), is_open: false }))} />
        </div>

      </div>
    </div>
  );
}

export default Checkout;