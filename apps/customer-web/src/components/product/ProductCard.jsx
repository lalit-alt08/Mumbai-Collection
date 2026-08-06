import { useNavigate } from "react-router-dom";
import {
  addToCart as addToWooCart,
  updateCartItem,
  removeCartItem,
} from "../../services/storeApi";
import { useCart } from "../../context/CartContext";

function ProductCard({ product }) {
  const navigate = useNavigate();

  const { cart, refreshCart } = useCart();

  const cartItem = cart?.items?.find(
    (item) => Number(item.id) === Number(product.id)
  );

  return (
    <div className="flex h-full flex-col justify-between rounded-[20px] border border-[#ECECEC] bg-white p-4 shadow-[0_4px_24px_rgba(0,0,0,0.02)] transition-all duration-300 hover:-translate-y-[4px] hover:shadow-[0_12px_40px_rgba(0,0,0,0.06)]">
      <div
        onClick={() => navigate(`/product/${product.id}`)}
        className="cursor-pointer"
      >
        <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-[14px] p-2">
          <img
            src={product.images?.[0]?.src}
            alt={product.name}
            className="h-full w-full object-contain transition-transform duration-300 hover:scale-105"
          />
        </div>

        <h2 className="mt-4 line-clamp-2 text-[15px] font-medium leading-snug text-[#1E1E1E]">
          {product.name}
        </h2>
      </div>

      <div className="mt-5 flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <p className="text-[20px] font-bold text-[#1E1E1E]">₹{product.price}</p>
        </div>

        {!cartItem ? (
          <button
            onClick={async () => {
              try {
                await addToWooCart(product.id);
                await refreshCart();
              } catch (error) {
                console.error(error);
              }
            }}
            className="rounded-full border border-[#3E8E2E] bg-white px-6 py-2 text-sm font-semibold text-[#3E8E2E] transition-all duration-300 hover:bg-[#3E8E2E] hover:text-white hover:shadow-[0_4px_20px_rgba(62,142,46,0.2)]"
          >
            ADD
          </button>
        ) : (
          <div className="flex h-[38px] items-center rounded-full bg-[#3E8E2E] text-white shadow-[0_4px_20px_rgba(62,142,46,0.2)]">
            <button
              onClick={async () => {
                try {
                  if (cartItem.quantity <= 1) {
                    await removeCartItem(cartItem.key);
                  } else {
                    await updateCartItem(
                      cartItem.key,
                      cartItem.quantity - 1
                    );
                  }

                  await refreshCart();
                } catch (error) {
                  console.error(error);
                }
              }}
              className="flex h-full w-8 items-center justify-center rounded-l-full transition-colors hover:bg-[#2F7424]"
            >
              −
            </button>

            <span className="flex w-6 items-center justify-center text-sm font-medium">
              {cartItem.quantity}
            </span>

            <button
              onClick={async () => {
                try {
                  await updateCartItem(
                    cartItem.key,
                    cartItem.quantity + 1
                  );

                  await refreshCart();
                } catch (error) {
                  console.error(error);
                }
              }}
              className="flex h-full w-8 items-center justify-center rounded-r-full transition-colors hover:bg-[#2F7424]"
            >
              +
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ProductCard;