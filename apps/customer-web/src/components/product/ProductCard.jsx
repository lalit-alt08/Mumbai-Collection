import useCartStore from "../../store/cartstore.js";

function ProductCard({ product }) {
  const addToCart = useCartStore((state) => state.addToCart);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm hover:shadow-md transition hover:shadow-lg md:p-4">
      <img
        src={product.images[0]?.src}
        alt={product.name}
        className="mx-auto h-32 w-full object-contain sm:h-36 md:h-40"
      />

      <h2 className="mt-3 line-clamp-2 text-sm font-semibold md:text-base">
        {product.name}
      </h2>

      <p className="mt-2 text-lg font-bold text-green-600 md:text-2xl">
        ₹{product.price}
      </p>

      <p className="text-xs text-gray-500 md:text-sm">
        Stock: {product.stock_quantity}
      </p>

      <button
        onClick={() => addToCart(product)}
        className="mt-4 w-full rounded-lg bg-green-600 py-2 text-sm font-medium text-white transition hover:bg-green-700 md:text-base"
      >
        Add to Cart
      </button>
    </div>
  );
}

export default ProductCard;
