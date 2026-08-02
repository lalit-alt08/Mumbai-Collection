import useCartStore from "../../store/cartstore";

function CartItem({ item }) {
  const increaseQuantity = useCartStore((state) => state.increaseQuantity);

  const decreaseQuantity = useCartStore((state) => state.decreaseQuantity);

  const removeItem = useCartStore((state) => state.removeItem);
  return (
    <div className="flex items-center gap-4 rounded-xl border bg-white p-4 shadow-sm">
      <img
        src={item.images?.[0]?.src}
        alt={item.name}
        className="h-24 w-24 rounded-lg object-contain"
      />

      <div className="flex-1">
        <h2 className="text-lg font-semibold">{item.name}</h2>

        <p className="mt-1 text-green-600 font-bold">₹{item.price}</p>

        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => decreaseQuantity(item.id)}
            className="h-9 w-9 rounded-lg border text-lg font-bold hover:bg-gray-100"
          >
            −
          </button>

          <span className="text-lg font-semibold">{item.quantity}</span>

          <button
            onClick={() => increaseQuantity(item.id)}
            className="h-9 w-9 rounded-lg border text-lg font-bold hover:bg-gray-100"
          >
            +
          </button>
          <button
            onClick={() => removeItem(item.id)}
            className="mt-4 text-sm font-medium text-red-600 hover:underline"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

export default CartItem;
