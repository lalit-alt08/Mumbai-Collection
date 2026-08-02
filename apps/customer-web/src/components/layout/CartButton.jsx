import { Link } from "react-router-dom";
import { ShoppingCart } from "lucide-react";
import useCartStore from "../../store/cartstore";

function CartButton() {
  const cart = useCartStore((state) => state.cart);

  console.log("Cart:", cart);

  return (
    <Link
      to="/cart"
      className="relative flex items-center gap-2 rounded-xl bg-green-600 px-5 py-3 text-white"
    >
      <ShoppingCart size={20} />
      <span>Cart</span>

      <span className="ml-2 rounded-full bg-red-500 px-2 py-1 text-xs">
        {cart.length}
      </span>
    </Link>
  );
}

export default CartButton;