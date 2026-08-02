import { Link } from "react-router-dom";
import { ShoppingCart } from "lucide-react";

function CartButton() {
  return (
    <Link
      to="/cart"
      className="relative flex items-center gap-2 rounded-xl bg-green-600 px-5 py-3 text-white transition hover:bg-green-700"
    >
      <ShoppingCart size={20} />

      <span className="font-medium">
        Cart
      </span>

      <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
        0
      </span>
    </Link>
  );
}

export default CartButton;