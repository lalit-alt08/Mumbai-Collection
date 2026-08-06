import { Link } from "react-router-dom";
import { ShoppingCart } from "lucide-react";
import { useCart } from "../../context/CartContext";

function CartButton() {
  const { cart } = useCart();

  const totalItems =
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
        rounded-[16px]
        bg-green-600
        px-4
        py-3
        text-sm
        font-semibold
        text-white
        transition-all
        duration-300
        hover:-translate-y-[2px]
        hover:bg-green-700
        hover:shadow-lg
        hover:shadow-green-600/30
        md:px-5
      "
    >
      <ShoppingCart size={20} />

      <span className="hidden sm:block">Cart</span>

      {totalItems > 0 && (
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
          {totalItems}
        </span>
      )}
    </Link>
  );
}

export default CartButton;