//import useCartStore from "../../store/cartstore";

function CartItem({ item }) {
  const increaseQuantity = useCartStore((state) => state.increaseQuantity);
  const decreaseQuantity = useCartStore((state) => state.decreaseQuantity);
  const removeItem = useCartStore((state) => state.removeItem);

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-white p-4 shadow-sm sm:flex-row sm:items-center">
      <img
        src={item.images?.[0]?.src}
        alt={item.name}
        className="mx-auto h-24 w-24 rounded-lg object-contain sm:mx-0 sm:h-28 sm:w-28"
      />

      <div className="flex-1">
        <h2 className="text-base font-semibold md:text-lg">
          {item.name}
        </h2>

        <p className="mt-1 text-lg font-bold text-green-600">
          ₹{item.price}
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">

          <div className="flex items-center gap-3">
            <button
              onClick={() => decreaseQuantity(item.id)}
              className="h-9 w-9 rounded-lg border text-lg font-bold hover:bg-gray-100"
            >
              −
            </button>

            <span className="w-6 text-center font-semibold">
              {item.quantity}
            </span>

            <button
              onClick={() => increaseQuantity(item.id)}
              className="h-9 w-9 rounded-lg border text-lg font-bold hover:bg-gray-100"
            >
              +
            </button>
          </div>

          <button
            onClick={() => removeItem(item.id)}
            className="text-sm font-medium text-red-600 hover:underline"
          >
            Remove
          </button>

        </div>
      </div>
    </div>
  );
}

export default CartItem;