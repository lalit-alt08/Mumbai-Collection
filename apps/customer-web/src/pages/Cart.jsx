import useCartStore from "../store/cartstore";
import CartItem from "../components/cart/CartItem";
import CartSummary from "../components/cart/CartSummary";

function Cart() {
  const cart = useCartStore((state) => state.cart);

  if (cart.length === 0) {
    return (
      <div className="py-16 text-center md:py-20">
        <h1 className="text-2xl font-bold md:text-3xl">
          Your Cart is Empty 🛒
        </h1>

        <p className="mt-3 text-sm text-gray-500 md:text-base">
          Start shopping to add products.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <h1 className="mb-4 text-2xl font-bold md:mb-6 md:text-3xl">
          Shopping Cart
        </h1>

        {cart.map((item) => (
          <CartItem
            key={item.id}
            item={item}
          />
        ))}
      </div>

      <div className="lg:sticky lg:top-24 h-fit">
        <CartSummary />
      </div>
    </div>
  );
}

export default Cart;