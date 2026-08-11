import { updateCartItem, removeCartItem } from "../services/storeApi";
import { useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { ArrowLeft, Share, Gift, Truck } from "lucide-react";

function Cart() {
  const navigate = useNavigate();
  const { cart, loading, refreshCart } = useCart();
  const { isAuthenticated } = useAuth();

  if (loading)
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-[15px] font-medium text-[#666666]">Loading...</div>
      </div>
    );

  if (!cart || cart.items.length === 0) {
    return (
      <div className="mx-auto flex max-w-[700px] flex-col items-center justify-center px-6 py-20 text-center">
        <h1 className="mb-4 text-[24px] font-bold text-[#1E1E1E]">
          Your Cart is Empty
        </h1>
        <p className="mb-8 text-[#666666]">
          Looks like you haven't added anything to your cart yet.
        </p>
        <button
          onClick={() => navigate("/")}
          className="rounded-full bg-[#3E8E2E] px-8 py-3.5 font-semibold text-white transition-all hover:bg-[#2F7424] active:scale-95 shadow-[0_4px_20px_rgba(62,142,46,0.2)]"
        >
          Start Shopping
        </button>
      </div>
    );
  }

  // Calculate values safely
  const discount = cart.totals?.total_discount
    ? Number(cart.totals.total_discount) / 100
    : 0;
  const delivery = cart.totals?.total_shipping
    ? Number(cart.totals.total_shipping) / 100
    : 0;
  const tax = cart.totals?.total_tax ? Number(cart.totals.total_tax) / 100 : 0;
  const total = Number(cart.totals.total_price) / 100;

  // Try to use items subtotal if available, else fallback
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
    <div className="mx-auto w-full max-w-[700px] pb-[120px] md:pt-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between rounded-[22px] bg-white px-4 py-4 shadow-[0_8px_30px_rgba(0,0,0,0.03)] md:mb-6">
        <button
          onClick={() => navigate(-1)}
          className="p-2 -ml-2 text-[#1E1E1E] transition-colors hover:bg-gray-50 rounded-full"
        >
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-[18px] font-bold text-[#1E1E1E]">My Cart</h1>
        <button className="p-2 -mr-2 text-[#1E1E1E] transition-colors hover:bg-gray-50 rounded-full">
          <Share size={20} />
        </button>
      </div>

      <div className="space-y-5">
        {/* Savings Card */}
        {discount > 0 && (
          <div className="flex items-center gap-3 rounded-[22px] bg-[#EEF4FF] p-4 shadow-[0_8px_30px_rgba(0,0,0,0.03)]">
            <Gift className="text-blue-600" size={20} />
            <span className="text-[14px] font-semibold text-blue-700">
              You saved ₹{discount} on this order
            </span>
          </div>
        )}

        {/* Delivery Card */}
        <div className="rounded-[22px] bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.05)]">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F6F7F4]">
              <Truck size={22} className="text-[#3E8E2E]" />
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-[#1E1E1E]">
                Delivery in 20-30 mins
              </h3>
              <p className="text-[13px] font-medium text-[#666666] mt-0.5">
                Shipment of {cart.items_count} item
                {cart.items_count !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        </div>

        {/* Product List */}
        <div className="space-y-4">
          {cart.items.map((item) => {
            const price = Number(item.prices.price) / 100;
            const regularPrice = item.prices.regular_price
              ? Number(item.prices.regular_price) / 100
              : price;

            return (
              <div
                key={item.key}
                className="flex items-center gap-4 rounded-[22px] bg-white p-4 shadow-[0_8px_30px_rgba(0,0,0,0.05)] transition-all duration-300 hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)] hover:-translate-y-0.5"
              >
                <div className="flex h-[90px] w-[90px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[18px] border border-[#ECECEC] bg-white p-1.5">
                  <img
                    src={item.images?.[0]?.src}
                    alt={item.name}
                    className="h-full w-full object-contain"
                  />
                </div>

                <div className="flex flex-1 flex-col justify-between py-1 h-[90px]">
                  <div>
                    <h2 className="line-clamp-2 text-[14px] font-semibold leading-snug text-[#1E1E1E]">
                      {item.name}
                    </h2>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-[16px] font-bold text-[#1E1E1E]">
                        ₹{price}
                      </span>
                      {regularPrice > price && (
                        <span className="text-[12px] font-medium text-[#666666] line-through">
                          ₹{regularPrice}
                        </span>
                      )}
                    </div>

                    <div className="flex h-[36px] w-[86px] items-center justify-between rounded-full bg-[#3E8E2E] px-1 text-white shadow-sm">
                      <button
                        onClick={async () => {
                          if (item.quantity === 1) {
                            await removeCartItem(item.key);
                          } else {
                            await updateCartItem(item.key, item.quantity - 1);
                          }
                          await refreshCart();
                        }}
                        className="flex h-full w-8 items-center justify-center text-lg active:scale-95 transition-transform"
                      >
                        −
                      </button>
                      <span className="text-[14px] font-bold">
                        {item.quantity}
                      </span>
                      <button
                        onClick={async () => {
                          await updateCartItem(item.key, item.quantity + 1);
                          await refreshCart();
                        }}
                        className="flex h-full w-8 items-center justify-center text-lg active:scale-95 transition-transform"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bill Details */}
        <div className="rounded-[22px] bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.05)]">
          <h3 className="mb-4 text-[16px] font-bold text-[#1E1E1E]">
            Bill Details
          </h3>

          <div className="space-y-3.5 text-[14px] text-[#666666]">
            <div className="flex justify-between items-center">
              <span>Items Total</span>
              <span className="font-medium text-[#1E1E1E]">₹{itemsTotal}</span>
            </div>

            {discount > 0 && (
              <div className="flex justify-between items-center text-blue-600">
                <span>Discount</span>
                <span className="font-medium">-₹{discount}</span>
              </div>
            )}

            <div className="flex justify-between items-center">
              <span>Delivery Charge</span>
              {delivery === 0 ? (
                <span className="font-bold text-[#3E8E2E]">FREE</span>
              ) : (
                <span className="font-medium text-[#1E1E1E]">₹{delivery}</span>
              )}
            </div>

            {tax > 0 && (
              <div className="flex justify-between items-center">
                <span>Tax</span>
                <span className="font-medium text-[#1E1E1E]">₹{tax}</span>
              </div>
            )}

            <hr className="my-4 border-[#E8E8E8]" />

            <div className="flex justify-between items-center text-[16px] font-bold text-[#1E1E1E]">
              <span>Grand Total</span>
              <span>₹{total}</span>
            </div>
          </div>
        </div>

        {/* Order Summary Savings */}
        {discount > 0 && (
          <div className="rounded-[16px] bg-[#EEF4FF] p-4 text-center text-[13px] font-semibold text-blue-700 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
            You saved ₹{discount} on this order
          </div>
        )}

        {/* Policy Card */}
        <div className="rounded-[22px] bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.05)]">
          <h3 className="mb-2 text-[14px] font-bold text-[#1E1E1E]">
            Cancellation Policy
          </h3>
          <p className="text-[13px] text-[#666666] leading-relaxed">
            Orders cannot be cancelled once packed for delivery. In case of
            unexpected delays, a refund will be provided, if applicable.
          </p>
        </div>
      </div>

      {/* Floating Checkout Bar */}
      <div className="fixed bottom-[18px] left-1/2 z-50 flex h-[78px] w-[calc(100%-32px)] max-w-[700px] -translate-x-1/2 items-center justify-between rounded-[30px] bg-white px-5 shadow-[0_12px_40px_rgba(0,0,0,0.12)] border border-[#ECECEC]">
        <div className="flex flex-col pl-1">
          <span className="text-[11px] font-bold text-[#666666] tracking-wider mb-0.5">
            TOTAL
          </span>
          <span className="text-[20px] font-bold text-[#1E1E1E] leading-none">
            ₹{total}
          </span>
        </div>

        <button
          onClick={() => {
            if (!isAuthenticated) {
              alert(
                "Please login or create an account to continue to checkout.",
              );
              navigate("/login");
              return;
            }

            navigate("/checkout");
          }}
          className="flex h-[52px] w-[55%] items-center justify-center rounded-[20px] bg-[#3E8E2E] text-[15px] font-bold text-white transition-all duration-300 hover:bg-[#2F7424] hover:shadow-[0_4px_20px_rgba(62,142,46,0.25)] active:scale-95"
        >
          Proceed to Checkout &rarr;
        </button>
      </div>
    </div>
  );
}

export default Cart;
