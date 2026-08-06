import { useEffect, useState } from "react";
import { getCart, getCheckout } from "../services/storeApi";
import BillingForm from "../components/checkout/BillingForm";

function Checkout() {
  const [checkout, setCheckout] = useState(null);
  const [cart, setCart] = useState(null);

  useEffect(() => {
    const loadCheckout = async () => {
      try {
        const cartData = await getCart();
        setCart(cartData);

        const checkoutData = await getCheckout();
        setCheckout(checkoutData);
      } catch (error) {
        console.error(error);
      }
    };

    loadCheckout();
  }, []);

  if (!cart || !checkout) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <h2>Loading...</h2>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-8 p-6 lg:grid-cols-3">
      {/* LEFT */}
      <div className="lg:col-span-2">
        <h1 className="mb-6 text-3xl font-bold">Checkout</h1>

        <BillingForm />
           
      </div>

      {/* RIGHT */}
      <div>
        <div className="rounded-xl border p-6">
          <h2 className="mb-5 text-xl font-bold">Order Summary</h2>

          {cart.items.map((item) => (
            <div key={item.key} className="mb-4 flex items-center gap-3">
              <img
                src={item.images?.[0]?.src}
                alt={item.name}
                className="h-16 w-16 rounded-lg object-contain"
              />

              <div className="flex-1">
                <h3 className="text-sm font-medium">{item.name}</h3>

                <p className="text-sm text-gray-500">Qty: {item.quantity}</p>
              </div>

              <div className="font-semibold">
                ₹{Number(item.totals.line_total) / 100}
              </div>
            </div>
          ))}

          <hr className="my-5" />

          <div className="flex justify-between text-lg">
            <span>Items</span>
            <span>{cart.items_count}</span>
          </div>

          <div className="mt-3 flex justify-between text-xl font-bold">
            <span>Total</span>

            <span>₹{Number(cart.totals.total_price) / 100}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Checkout;
