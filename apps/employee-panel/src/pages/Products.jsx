import { useEffect, useState, useRef } from "react";
import {
  Boxes,
  Search,
  Edit2,
  Check,
  X,
  AlertTriangle,
  RotateCcw,
  Upload,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Plus,
} from "lucide-react";
import {
  getProducts,
  updateProduct,
  createProduct,
  uploadProductImage,
} from "../services/employeeApi.js";

function Products() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [stockFilter, setStockFilter] = useState("all");

  // Pagination state
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalProducts, setTotalProducts] = useState(0);
  const perPage = 20;

  // Inline editing state
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ regular_price: "", stock_quantity: "" });
  const [savingId, setSavingId] = useState(null);

  // Add Product Modal & Upload state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: "",
    regular_price: "",
    sale_price: "",
    stock_quantity: 10,
    description: "",
    image_url: "",
  });
  const [creating, setCreating] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imagePreview, setImagePreview] = useState("");
  const fileInputRef = useRef(null);

  // Toast Notification state
  const [toast, setToast] = useState(null);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  // Debounce search input by 400ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setPage(1);
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchProductList = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await getProducts({
        page,
        per_page: perPage,
        search: debouncedSearch || undefined,
        stock_status: stockFilter !== "all" ? stockFilter : undefined,
      });
      if (res.success) {
        setProducts(res.products || []);
        setTotalProducts(res.total || res.products?.length || 0);
        setTotalPages(res.totalPages || Math.ceil((res.total || 1) / perPage) || 1);
      }
    } catch (err) {
      console.error("Fetch products error:", err);
      setError(err.response?.data?.message || err.message || "Failed to load catalog products.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProductList();
  }, [page, debouncedSearch, stockFilter]);

  const handleStartEdit = (product) => {
    setEditingId(product.id);
    setEditForm({
      regular_price: product.regular_price || product.price || "",
      stock_quantity: product.stock_quantity ?? 0,
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm({ regular_price: "", stock_quantity: "" });
  };

  const handleSaveEdit = async (productId) => {
    try {
      setSavingId(productId);
      const updateData = {};

      if (editForm.regular_price !== "") {
        const numPrice = Number(editForm.regular_price);
        if (isNaN(numPrice) || numPrice < 0) {
          showToast("Price must be a valid positive number.", "error");
          setSavingId(null);
          return;
        }
        updateData.regular_price = String(numPrice);
      }

      if (editForm.stock_quantity !== "") {
        const numStock = Number(editForm.stock_quantity);
        if (isNaN(numStock) || numStock < 0 || !Number.isInteger(numStock)) {
          showToast("Stock must be a non-negative integer.", "error");
          setSavingId(null);
          return;
        }
        updateData.stock_quantity = numStock;
      }

      const res = await updateProduct(productId, updateData);
      if (res.success) {
        setProducts((prev) =>
          prev.map((p) =>
            p.id === productId
              ? {
                  ...p,
                  price: editForm.regular_price !== "" ? editForm.regular_price : p.price,
                  regular_price: editForm.regular_price !== "" ? editForm.regular_price : p.regular_price,
                  stock_quantity: editForm.stock_quantity !== "" ? Number(editForm.stock_quantity) : p.stock_quantity,
                  stock_status: Number(editForm.stock_quantity) > 0 ? "instock" : "outofstock",
                }
              : p
          )
        );
        showToast("Product updated successfully!");
        setEditingId(null);
      }
    } catch (err) {
      console.error("Save product error:", err);
      showToast(err.response?.data?.message || "Failed to update product.", "error");
    } finally {
      setSavingId(null);
    }
  };

  const handleImageFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate type and size (10MB)
    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!validTypes.includes(file.type)) {
      showToast("Only JPG, PNG, WebP, and GIF images are allowed.", "error");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showToast("Image file size must be less than 10MB.", "error");
      return;
    }

    setImagePreview(URL.createObjectURL(file));

    try {
      setUploadingImage(true);
      const res = await uploadProductImage(file);
      if (res.success && res.url) {
        setNewProduct((prev) => ({ ...prev, image_url: res.url }));
        showToast("Image uploaded to WordPress Media Library!");
      }
    } catch (err) {
      console.error("Upload error:", err);
      showToast(err.response?.data?.message || "Failed to upload image.", "error");
      setImagePreview("");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleCreateProduct = async (e) => {
    e.preventDefault();
    if (!newProduct.name.trim()) {
      showToast("Product name is required.", "error");
      return;
    }

    if (!newProduct.regular_price || Number(newProduct.regular_price) <= 0) {
      showToast("Please enter a valid regular price.", "error");
      return;
    }

    try {
      setCreating(true);
      const res = await createProduct(newProduct);
      if (res.success) {
        showToast("New product created successfully!");
        setShowAddModal(false);
        setNewProduct({
          name: "",
          regular_price: "",
          sale_price: "",
          stock_quantity: 10,
          description: "",
          image_url: "",
        });
        setImagePreview("");
        fetchProductList();
      }
    } catch (err) {
      console.error("Create product error:", err);
      showToast(err.response?.data?.message || "Failed to create product.", "error");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-6 right-6 z-50 flex items-center gap-2.5 rounded-2xl px-5 py-3.5 text-xs font-bold text-white shadow-xl animate-in slide-in-from-top duration-300 ${
            toast.type === "error"
              ? "bg-rose-600 shadow-rose-600/30"
              : "bg-emerald-600 shadow-emerald-600/30"
          }`}
        >
          {toast.type === "error" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-black tracking-tight text-gray-900 flex items-center gap-2">
            <Boxes size={22} className="text-emerald-600" />
            Product Inventory & Quick Stock
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Quickly adjust in-store prices, update shelf quantities, and register incoming stock.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchProductList}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold text-gray-700 shadow-sm hover:bg-gray-50 transition cursor-pointer"
          >
            <RotateCcw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-500 transition cursor-pointer"
          >
            <Plus size={16} />
            + Add In-Store Product
          </button>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        {/* Filter Pills */}
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: "all", label: "All Items" },
            { id: "instock", label: "In Stock" },
            { id: "outofstock", label: "Out of Stock" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setStockFilter(tab.id);
                setPage(1);
              }}
              className={`rounded-xl px-3.5 py-2 text-xs font-bold transition cursor-pointer ${
                stockFilter === tab.id
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-300"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search Bar */}
        <div className="relative w-full sm:w-72">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title, SKU..."
            className="w-full rounded-xl border border-gray-200 bg-gray-50/50 py-2 pl-9 pr-4 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 transition"
          />
        </div>
      </div>

      {/* Main Inventory Table */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex h-72 items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <Loader2 size={24} className="animate-spin text-emerald-600" />
              <p className="text-xs font-bold text-gray-400">Loading catalog...</p>
            </div>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-rose-600">
            <p className="text-sm font-bold">{error}</p>
            <button
              onClick={fetchProductList}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500 transition"
            >
              <RotateCcw size={14} /> Retry
            </button>
          </div>
        ) : products.length === 0 ? (
          <div className="py-16 text-center text-xs font-medium text-gray-400">
            No products found matching your search.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-gray-100 bg-gray-50/75 text-[11px] font-bold uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-6 py-3.5">Product</th>
                  <th className="px-6 py-3.5">SKU / ID</th>
                  <th className="px-6 py-3.5">Price (₹)</th>
                  <th className="px-6 py-3.5">Stock Level</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5 text-right">Quick Stock Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
                {products.map((product) => {
                  const isEditing = editingId === product.id;
                  const isSaving = savingId === product.id;
                  const stock = product.stock_quantity ?? 0;
                  const isOutOfStock = product.stock_status === "outofstock" || stock <= 0;
                  const isLowStock = !isOutOfStock && stock <= 5;

                  return (
                    <tr key={product.id} className="hover:bg-gray-50/80 transition">
                      {/* Product Thumbnail & Title */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={product.image || product.images?.[0]?.src || "https://placehold.co/50x50?text=Item"}
                            alt={product.name}
                            className="h-12 w-12 rounded-xl object-cover bg-gray-100 border border-gray-200 shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="font-bold text-gray-900 truncate max-w-xs sm:max-w-sm">
                              {product.name}
                            </p>
                            <p className="text-[11px] text-gray-400 truncate">
                              {product.categories?.map((c) => c.name).join(", ") || "General"}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* SKU / ID */}
                      <td className="px-6 py-4 font-mono text-gray-500">
                        {product.sku || `#${product.id}`}
                      </td>

                      {/* Regular Price (Editable) */}
                      <td className="px-6 py-4">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <span className="text-gray-400 font-bold">₹</span>
                            <input
                              type="number"
                              value={editForm.regular_price}
                              onChange={(e) =>
                                setEditForm({ ...editForm, regular_price: e.target.value })
                              }
                              className="w-20 rounded-lg border border-emerald-500 px-2 py-1 text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-emerald-500/20"
                            />
                          </div>
                        ) : (
                          <span className="font-bold text-gray-900">
                            ₹{product.regular_price || product.price || 0}
                          </span>
                        )}
                      </td>

                      {/* Stock Quantity (Editable) */}
                      <td className="px-6 py-4">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editForm.stock_quantity}
                            onChange={(e) =>
                              setEditForm({ ...editForm, stock_quantity: e.target.value })
                            }
                            className="w-16 rounded-lg border border-emerald-500 px-2 py-1 text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-emerald-500/20"
                          />
                        ) : (
                          <span className="font-bold text-gray-900">{stock} units</span>
                        )}
                      </td>

                      {/* Stock Status Badge */}
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                            isOutOfStock
                              ? "bg-rose-50 text-rose-700 border border-rose-200"
                              : isLowStock
                              ? "bg-amber-50 text-amber-700 border border-amber-200"
                              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          }`}
                        >
                          {isOutOfStock ? "Out of Stock" : isLowStock ? "Low Stock (<=5)" : "In Stock"}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4 text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleSaveEdit(product.id)}
                              disabled={isSaving}
                              className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 transition cursor-pointer disabled:opacity-50"
                            >
                              {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                              Save
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50 transition cursor-pointer"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleStartEdit(product)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:border-emerald-300 hover:text-emerald-600 transition cursor-pointer"
                          >
                            <Edit2 size={12} />
                            Edit Stock / Price
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

        {/* Pagination Bar */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/50 px-6 py-4">
            <p className="text-xs text-gray-500 font-medium">
              Showing <span className="font-bold text-gray-900">{(page - 1) * perPage + 1}</span> to{" "}
              <span className="font-bold text-gray-900">
                {Math.min(page * perPage, totalProducts)}
              </span>{" "}
              of <span className="font-bold text-gray-900">{totalProducts}</span> products
            </p>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition cursor-pointer"
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <span className="text-xs font-bold text-gray-700 px-2">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                disabled={page >= totalPages}
                className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition cursor-pointer"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add New Product Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 sm:p-8 shadow-2xl border border-gray-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              <div>
                <h3 className="text-lg font-black text-gray-900">Add In-Store Product</h3>
                <p className="text-xs text-gray-500">
                  Register new shelf item directly to Mumbai Collection catalog
                </p>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateProduct} className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Product Title *
                </label>
                <input
                  type="text"
                  required
                  value={newProduct.name}
                  onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                  placeholder="e.g. Traditional Bandhani Saree"
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                    Regular Price (₹) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="1"
                    value={newProduct.regular_price}
                    onChange={(e) => setNewProduct({ ...newProduct, regular_price: e.target.value })}
                    placeholder="999"
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                    Sale Price (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={newProduct.sale_price}
                    onChange={(e) => setNewProduct({ ...newProduct, sale_price: e.target.value })}
                    placeholder="Optional"
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Initial Stock Units
                </label>
                <input
                  type="number"
                  min="0"
                  value={newProduct.stock_quantity}
                  onChange={(e) =>
                    setNewProduct({ ...newProduct, stock_quantity: Number(e.target.value) })
                  }
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
                />
              </div>

              {/* Photo Upload */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Product Image (WordPress Media Upload)
                </label>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageFileChange}
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                />

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingImage}
                    className="flex items-center gap-2 rounded-xl border border-dashed border-emerald-400 bg-emerald-50/50 px-4 py-3 text-xs font-bold text-emerald-700 hover:bg-emerald-50 transition cursor-pointer disabled:opacity-50"
                  >
                    {uploadingImage ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Uploading to WP Media...
                      </>
                    ) : (
                      <>
                        <Upload size={14} />
                        Choose Photo
                      </>
                    )}
                  </button>

                  {imagePreview && (
                    <img
                      src={imagePreview}
                      alt="Preview"
                      className="h-12 w-12 rounded-xl object-cover border border-gray-200 bg-gray-100"
                    />
                  )}
                </div>
                {newProduct.image_url && (
                  <p className="mt-1 text-[11px] text-emerald-600 font-medium truncate">
                    ✓ Uploaded: {newProduct.image_url}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-xs font-bold text-gray-600 hover:bg-gray-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || uploadingImage}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 transition cursor-pointer disabled:opacity-50"
                >
                  {creating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Create Product
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
