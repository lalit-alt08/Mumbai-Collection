function ProductCard({ product }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-lg transition">
      <img
        src={product.images[0]?.src}
        alt={product.name}
        className="h-40 w-full object-contain"
      />

      <h2 className="mt-3 text-lg font-semibold">{product.name}</h2>

      <p className="mt-1 text-2xl font-bold text-green-600">
        ₹{product.price}
      </p>

      <p className="text-sm text-gray-500">
        Stock: {product.stock_quantity}
      </p>

      <button className="mt-4 w-full rounded-lg bg-green-600 py-2 text-white hover:bg-green-700">
        Add to Cart
      </button>
    </div>
  );
}

export default ProductCard;