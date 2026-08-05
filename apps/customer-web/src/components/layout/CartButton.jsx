import { Link } from "react-router-dom";
import { ShoppingCart } from "lucide-react";
import { useCart } from "../../context/CartContext";

function CartButton() {
  const { cart } = useCart();

  const count =
    cart?.items?.reduce((total, item) => total + item.quantity, 0) || 0;

  return (
    <Link
      to="/cart"
      className="
        relative
        flex
        flex-shrink-0
        items-center
        gap-2
        rounded-xl
        bg-green-600
        px-3
        py-2.5
        text-sm
        font-medium
        text-white
        transition
        hover:bg-green-700
        sm:px-4
        md:px-5
        md:py-3
      "
    >
      <ShoppingCart size={20} />

      <span className="hidden sm:block">Cart</span>

      {count > 0 && (
        <span
          className="
            absolute
            -right-2
            -top-2
            flex
            h-5
            w-5
            items-center
            justify-center
            rounded-full
            bg-red-500
            text-[11px]
            font-bold
            text-white
          "
        >
          {count}
        </span>
      )}
    </Link>
  );
}

export default CartButton;