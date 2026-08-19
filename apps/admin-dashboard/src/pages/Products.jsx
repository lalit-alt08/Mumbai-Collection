import { useEffect, useState } from "react";
import {
  Boxes,
  Search,
  Plus,
  Edit2,
  Check,
  X,
  AlertTriangle,
  RotateCcw,
  Tag,
  IndianRupee,
  Layers,
} from "lucide-react";
import { getProducts, updateProduct, createProduct } from "../services/adminApi";

function Products() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [stockFilter, setStockFilter] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ regular_price: "", stock_quantity: "" });
  const [savingId, setSavingId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: "",
    regular_price: "",
    sale_price: "",
    stock_quantity: 15,
    description: "",
    image_url: "",
  });
  const [creating, setCreating] = useState(false);

  const fetchProductList = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await getProducts();
      if (res.success) {
        setProducts(res.products || []);
      }
    } catch (err) {
      console.error("Fetch products error:", err);
      setError("Failed to load catalog products.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProductList();
  }, []);

  const handleStartEdit = (p) => {
    setEditingId(p.id);
    setEditForm({
      regular_price: p.regular_price || p.price || "",
      stock_quantity: p.stock_quantity !== null ? p.stock_quantity : 0,
    });
  };

  const handleSaveEdit = async (productId) => {
    try {
      setSavingId(productId);
      await updateProduct(productId, {
        regular_price: editForm.regular_price,
        stock_quantity: editForm.stock_quantity,
      });
      await fetchProductList();
      setEditingId(null);
    } catch (err) {
      alert("Failed to update product: " + (err.response?.data?.message || err.message));
    } finally {
      setSavingId(null);
    }
  };

  const handleCreateProduct = async (e) => {
    e.preventDefault();
    if (!newProduct.name || !newProduct.regular_price) {
      alert("Product name and price are required.");
      return;
    }

    try {
      setCreating(true);
      await createProduct(newProduct);
      setShowAddModal(false);
      setNewProduct({
        name: "",
        regular_price: "",
        sale_price: "",
        stock_quantity: 15,
        description: "",
        image_url: "",
      });
      await fetchProductList();
    } catch (err) {
      alert("Failed to create product: " + (err.response?.data?.message || err.message));
    } finally {
      setCreating(false);
    }
  };

  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      !searchQuery ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (stockFilter === "low") {
      return p.stock_quantity !== null && p.stock_quantity <= 5 && p.stock_quantity > 0;
    }
    if (stockFilter === "outofstock") {
      return p.stock_status === "outofstock" || p.stock_quantity === 0;
    }
    if (stockFilter === "instock") {
      return p.stock_status === "instock" && (p.stock_quantity === null || p.stock_quantity > 5);
    }

    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 md:text-3xl">
            Inventory & Stock Manager
          </h1>
          <p className="text-xs font-medium text-gray-500 mt-1">
            Real-time stock control, quick price editing, and catalog management for Vasai shop
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchProductList}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold text-gray-700 shadow-sm transition hover:bg-gray-50"
          >
            <RotateCcw size={14} /> Refresh
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 rounded-xl bg-[#FF8A00] px-5 py-2.5 text-xs font-bold text-white shadow-[0_4px_16px_rgba(255,138,0,0.3)] transition hover:bg-[#FF7300] active:scale-95"
          >
            <Plus size={15} /> Add New Product
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-sm border border-gray-100 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex overflow-x-auto pb-1 scrollbar-none gap-2">
          {[
            { id: "all", label: "All Items", count: products.length },
            {
              id: "instock",
              label: "In Stock",
              count: products.filter((p) => p.stock_status === "instock" && (p.stock_quantity === null || p.stock_quantity > 5)).length,
            },
            {
              id: "low",
              label: "Low Stock (< 5)",
              count: products.filter((p) => p.stock_quantity !== null && p.stock_quantity <= 5 && p.stock_quantity > 0).length,
            },
            {
              id: "outofstock",
              label: "Out of Stock",
              count: products.filter((p) => p.stock_status === "outofstock" || p.stock_quantity === 0).length,
            },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStockFilter(tab.id)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-xs font-bold transition ${
                stockFilter === tab.id
                  ? "bg-[#1E1E1E] text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                  stockFilter === tab.id ? "bg-white/20 text-white" : "bg-gray-200 text-gray-700"
                }`}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-80">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by product name, SKU..."
            className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-4 text-xs font-medium text-gray-800 placeholder-gray-400 focus:border-[#FF8A00] focus:bg-white focus:outline-none transition"
          />
        </div>
      </div>

      {/* Products Table with Inline Editing */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm border border-gray-100">
        {loading ? (
          <div className="p-12 text-center text-xs font-semibold text-gray-500">
            Loading products from WooCommerce...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-xs font-semibold text-red-600">{error}</div>
        ) : filteredProducts.length === 0 ? (
          <div className="p-12 text-center text-xs font-medium text-gray-500">
            No products match current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-gray-100 bg-gray-50/50 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">
                <tr>
                  <th className="py-3.5 px-4">Product Info</th>
                  <th className="py-3.5 px-4">SKU / ID</th>
                  <th className="py-3.5 px-4">Price (₹)</th>
                  <th className="py-3.5 px-4">Stock Level</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Quick Stock Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-medium">
                {filteredProducts.map((p) => {
                  const isEditing = editingId === p.id;
                  const isLow = p.stock_quantity !== null && p.stock_quantity <= 5 && p.stock_quantity > 0;
                  const isOut = p.stock_status === "outofstock" || p.stock_quantity === 0;

                  return (
                    <tr key={p.id} className="hover:bg-gray-50/60 transition">
                      {/* Product Thumbnail & Title */}
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-white p-1">
                            {p.image ? (
                              <img src={p.image} alt={p.name} className="h-full w-full object-contain" />
                            ) : (
                              <Boxes size={20} className="text-gray-400" />
                            )}
                          </div>
                          <div>
                            <h4 className="line-clamp-1 font-bold text-gray-900">{p.name}</h4>
                            <div className="text-[10px] text-gray-400">
                              {p.categories.map((c) => c.name).join(", ") || "General"}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* SKU */}
                      <td className="py-4 px-4 font-mono text-gray-500">{p.sku}</td>

                      {/* Price (Editable) */}
                      <td className="py-4 px-4">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <span className="font-bold text-gray-400">₹</span>
                            <input
                              type="number"
                              value={editForm.regular_price}
                              onChange={(e) =>
                                setEditForm((prev) => ({ ...prev, regular_price: e.target.value }))
                              }
                              className="h-8 w-20 rounded-lg border border-[#FF8A00] px-2 text-xs font-bold text-gray-900 focus:outline-none"
                            />
                          </div>
                        ) : (
                          <div className="flex items-baseline gap-1">
                            <span className="font-black text-gray-900 text-sm">₹{p.price}</span>
                            {p.regular_price > p.price && (
                              <span className="text-[10px] text-gray-400 line-through">
                                ₹{p.regular_price}
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Stock Quantity (Editable) */}
                      <td className="py-4 px-4">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editForm.stock_quantity}
                            onChange={(e) =>
                              setEditForm((prev) => ({ ...prev, stock_quantity: e.target.value }))
                            }
                            className="h-8 w-20 rounded-lg border border-[#FF8A00] px-2 text-xs font-bold text-gray-900 focus:outline-none"
                          />
                        ) : (
                          <span className="font-bold text-gray-800">
                            {p.stock_quantity !== null ? `${p.stock_quantity} units` : "Managed in Store"}
                          </span>
                        )}
                      </td>

                      {/* Stock Status Badge */}
                      <td className="py-4 px-4">
                        {isOut ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-bold text-rose-700 border border-rose-200">
                            Out of Stock
                          </span>
                        ) : isLow ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700 border border-amber-200">
                            <AlertTriangle size={11} /> Low Stock ({p.stock_quantity})
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                            In Stock
                          </span>
                        )}
                      </td>

                      {/* Action Controls */}
                      <td className="py-4 px-4 text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              disabled={savingId === p.id}
                              onClick={() => handleSaveEdit(p.id)}
                              className="flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                            >
                              <Check size={13} /> {savingId === p.id ? "Saving..." : "Save"}
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="rounded-xl border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-100"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleStartEdit(p)}
                            className="rounded-xl border border-gray-200 px-3.5 py-1.5 text-[11px] font-bold text-gray-700 hover:bg-gray-50 transition"
                          >
                            <Edit2 size={12} className="inline mr-1 text-[#FF8A00]" /> Edit Price / Stock
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add New Product Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              <div>
                <h3 className="text-lg font-black text-gray-900">Add New In-Store Product</h3>
                <p className="text-xs text-gray-500 font-medium">Add stationery, toys, or art supplies</p>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateProduct} className="my-5 space-y-4 text-xs">
              <div>
                <label className="font-bold text-gray-700 block mb-1">Product Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Faber-Castell 24 Tri Colour Pencils"
                  value={newProduct.name}
                  onChange={(e) => setNewProduct((prev) => ({ ...prev, name: e.target.value }))}
                  className="h-10 w-full rounded-xl border border-gray-200 px-3 font-medium focus:border-[#FF8A00] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-gray-700 block mb-1">Regular Price (₹) *</label>
                  <input
                    type="number"
                    required
                    placeholder="299"
                    value={newProduct.regular_price}
                    onChange={(e) => setNewProduct((prev) => ({ ...prev, regular_price: e.target.value }))}
                    className="h-10 w-full rounded-xl border border-gray-200 px-3 font-medium focus:border-[#FF8A00] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="font-bold text-gray-700 block mb-1">Sale Price (₹)</label>
                  <input
                    type="number"
                    placeholder="249 (optional)"
                    value={newProduct.sale_price}
                    onChange={(e) => setNewProduct((prev) => ({ ...prev, sale_price: e.target.value }))}
                    className="h-10 w-full rounded-xl border border-gray-200 px-3 font-medium focus:border-[#FF8A00] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-gray-700 block mb-1">Initial Stock Count</label>
                  <input
                    type="number"
                    value={newProduct.stock_quantity}
                    onChange={(e) => setNewProduct((prev) => ({ ...prev, stock_quantity: e.target.value }))}
                    className="h-10 w-full rounded-xl border border-gray-200 px-3 font-medium focus:border-[#FF8A00] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="font-bold text-gray-700 block mb-1">Image URL</label>
                  <input
                    type="url"
                    placeholder="https://..."
                    value={newProduct.image_url}
                    onChange={(e) => setNewProduct((prev) => ({ ...prev, image_url: e.target.value }))}
                    className="h-10 w-full rounded-xl border border-gray-200 px-3 font-medium focus:border-[#FF8A00] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-gray-100 pt-4 mt-6">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-xl border border-gray-200 px-5 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-xl bg-[#FF8A00] px-6 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#FF7300] disabled:opacity-50"
                >
                  {creating ? "Creating Product..." : "Create Product"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Products;
