import { useEffect, useState } from "react";
import { getCart } from "../services/storeApi";

function Cart() {
  const [cart, setCart] = useState(null);

  useEffect(() => {
    const fetchCart = async () => {
      try {
        const data = await getCart();
        setCart(data);
      } catch (error) {
        console.error(error);
      }
    };

    fetchCart();
  }, []);

  if (!cart) return <h2>Loading...</h2>;

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="mb-6 text-3xl font-bold">Shopping Cart</h1>

      {cart.items.length === 0 ? (
        <h2>Your cart is empty.</h2>
      ) : (
        <>
          {cart.items.map((item) => (
            <div
              key={item.key}
              className="mb-4 flex items-center gap-4 rounded-xl border p-4"
            >
              <img
                src={item.images[0]?.src}
                alt={item.name}
                className="h-24 w-24 object-contain"
              />

              <div className="flex-1">
                <h2 className="font-semibold">{item.name}</h2>

                <p>Qty: {item.quantity}</p>

                <p className="font-bold">
                  ₹{item.totals.line_total / 100}
                </p>
              </div>
            </div>
          ))}

          <div className="mt-8 rounded-xl border p-5">
            <h2 className="text-xl font-bold">
              Total : ₹{cart.totals.total_price / 100}
            </h2>
          </div>
        </>
      )}
    </div>
  );
}

export default Cart;