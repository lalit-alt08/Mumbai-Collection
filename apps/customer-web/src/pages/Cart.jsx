import useCartStore from "../store/cartstore";
import CartItem from "../components/cart/CartItem";
import CartSummary from "../components/cart/CartSummary";

function Cart() {
  const cart = useCartStore((state) => state.cart);

  if (cart.length === 0) {
    return (
      <div className="py-20 text-center">
        <h1 className="text-3xl font-bold">Your Cart is Empty 🛒</h1>

        <p className="mt-3 text-gray-500">Start shopping to add products.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <h1 className="mb-6 text-3xl font-bold">Shopping Cart</h1>

        {cart.map((item) => (
          <CartItem key={item.id} item={item} />
        ))}
      </div>

      <CartSummary />
    </div>
  );
}

export default Cart;
