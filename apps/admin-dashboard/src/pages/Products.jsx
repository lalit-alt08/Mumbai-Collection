import { useEffect, useState, useRef } from "react";
import {
  Boxes,
  Search,
  Edit2,
  Trash2,
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
} from "lucide-react";
import { getProducts, updateProduct, deleteProduct, createProduct, uploadProductImage } from "../services/adminApi";

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

  // Deletion state
  const [deletingId, setDeletingId] = useState(null);
  const [deleteConfirmProduct, setDeleteConfirmProduct] = useState(null);

  // Add Product Modal & Upload state
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
        stock_status: stockFilter !== "all" && stockFilter !== "low" ? stockFilter : undefined,
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
  }, [debouncedSearch, stockFilter, page]);

  const handleFilterChange = (filterId) => {
    setStockFilter(filterId);
    setPage(1);
  };

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
      showToast("Product price and stock updated successfully!");
      await fetchProductList();
      setEditingId(null);
    } catch (err) {
      showToast(err.response?.data?.message || err.message || "Failed to update product.", "error");
    } finally {
      setSavingId(null);
    }
  };

  const handleDeleteProduct = async (product) => {
    if (!product) return;
    try {
      setDeletingId(product.id);
      await deleteProduct(product.id);
      showToast(`Product "${product.name}" deleted from store and customer panel.`);
      setDeleteConfirmProduct(null);
      setProducts((prev) => prev.filter((p) => p.id !== product.id));
      setTotalProducts((t) => Math.max(0, t - 1));
    } catch (err) {
      showToast(err.response?.data?.message || err.message || "Failed to delete product.", "error");
    } finally {
      setDeletingId(null);
    }
  };

  const handleImageFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show local preview immediately
    const previewUrl = URL.createObjectURL(file);
    setImagePreview(previewUrl);

    try {
      setUploadingImage(true);
      const res = await uploadProductImage(file);
      if (res.success && res.url) {
        setNewProduct((prev) => ({ ...prev, image_url: res.url }));
        showToast("Image uploaded to WordPress media library!");
      }
    } catch (err) {
      showToast("Failed to upload image: " + (err.response?.data?.message || err.message), "error");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleCreateProduct = async (e) => {
    e.preventDefault();
    if (!newProduct.name || !newProduct.regular_price) {
      showToast("Product name and regular price are required.", "error");
      return;
    }

    try {
      setCreating(true);
      await createProduct(newProduct);
      showToast(`Product "${newProduct.name}" created successfully!`);
      setShowAddModal(false);
      setNewProduct({
        name: "",
        regular_price: "",
        sale_price: "",
        stock_quantity: 15,
        description: "",
        image_url: "",
      });
      setImagePreview("");
      await fetchProductList();
    } catch (err) {
      showToast("Failed to create product: " + (err.response?.data?.message || err.message), "error");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Floating Toast Notification */}
      {toast && (
        <div className="fixed top-6 right-6 z-[120] flex items-center gap-2.5 rounded-2xl bg-gray-900 px-5 py-3 text-xs font-bold text-white shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300">
          {toast.type === "success" ? (
            <CheckCircle2 size={16} className="text-emerald-400" />
          ) : (
            <AlertCircle size={16} className="text-rose-400" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 md:text-3xl">
            Inventory & Stock Manager
          </h1>
          <p className="text-xs font-medium text-gray-500 mt-1">
            Server-side stock control, instant price editing, and WordPress media upload
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchProductList}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold text-gray-700 shadow-sm transition hover:bg-gray-50"
          >
            <RotateCcw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Filter and Server Search Bar */}
      <div className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-sm border border-gray-100 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex overflow-x-auto pb-1 scrollbar-none gap-2">
          {[
            { id: "all", label: "All Items" },
            { id: "instock", label: "In Stock" },
            { id: "outofstock", label: "Out of Stock" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleFilterChange(tab.id)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-xs font-bold transition ${
                stockFilter === tab.id
                  ? "bg-[#1E1E1E] text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Server Search */}
        <div className="relative w-full sm:w-80">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search all products (server-side)..."
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
        ) : products.length === 0 ? (
          <div className="p-12 text-center text-xs font-medium text-gray-500">
            No products match current criteria.
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
                {products.map((p) => {
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
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleStartEdit(p)}
                              className="rounded-xl border border-gray-200 px-3.5 py-1.5 text-[11px] font-bold text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition"
                            >
                              <Edit2 size={12} className="inline mr-1 text-[#FF8A00]" /> Edit Price / Stock
                            </button>

                            <button
                              onClick={() => setDeleteConfirmProduct(p)}
                              title="Delete Product"
                              className="flex h-7 w-7 items-center justify-center rounded-xl border border-rose-100 bg-rose-50/60 text-rose-500 hover:bg-rose-100 hover:text-rose-700 transition"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
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
        {!loading && !error && totalProducts > 0 && (
          <div className="flex flex-col gap-3 border-t border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between text-xs text-gray-500 font-medium">
            <div>
              Showing <span className="font-bold text-gray-800">{(page - 1) * perPage + 1}</span> to{" "}
              <span className="font-bold text-gray-800">
                {Math.min(page * perPage, totalProducts)}
              </span>{" "}
              of <span className="font-bold text-gray-800">{totalProducts}</span> products
            </div>

            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="flex items-center gap-1 rounded-xl border border-gray-200 px-3.5 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ChevronLeft size={14} /> Previous
              </button>

              <span className="px-2 font-bold text-gray-800">
                Page {page} of {totalPages}
              </span>

              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="flex items-center gap-1 rounded-xl border border-gray-200 px-3.5 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add New Product Modal with File Upload */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
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

                {/* Direct Image Upload to WordPress */}
                <div>
                  <label className="font-bold text-gray-700 block mb-1">Product Photo</label>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handleImageFileSelect}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={uploadingImage}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3 font-bold text-gray-700 hover:bg-gray-100 transition disabled:opacity-50"
                  >
                    {uploadingImage ? (
                      <>
                        <Loader2 size={14} className="animate-spin text-[#FF8A00]" /> Uploading...
                      </>
                    ) : (
                      <>
                        <Upload size={14} className="text-[#FF8A00]" /> Choose Image File
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Image Preview */}
              {(imagePreview || newProduct.image_url) && (
                <div className="flex items-center gap-3 rounded-2xl bg-gray-50 p-3 border border-gray-100">
                  <div className="h-14 w-14 overflow-hidden rounded-xl bg-white border border-gray-200 p-1 flex-shrink-0">
                    <img
                      src={imagePreview || newProduct.image_url}
                      alt="Preview"
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <span className="text-[11px] font-bold text-gray-700 block">Uploaded to WordPress Media</span>
                    <span className="text-[10px] text-gray-400 truncate block">{newProduct.image_url || "Processing..."}</span>
                  </div>
                </div>
              )}

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
                  disabled={creating || uploadingImage}
                  className="rounded-xl bg-[#FF8A00] px-6 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#FF7300] disabled:opacity-50"
                >
                  {creating ? "Creating Product..." : "Create Product"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Product Confirmation Modal */}
      {deleteConfirmProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 border border-rose-100 mb-4">
              <Trash2 size={24} />
            </div>

            <div className="text-center space-y-2">
              <h3 className="text-lg font-black text-gray-900">
                Delete Product Permanently?
              </h3>
              <p className="text-xs text-gray-500 leading-relaxed">
                Are you sure you want to delete <span className="font-bold text-gray-900">"{deleteConfirmProduct.name}"</span>?
              </p>
              <div className="rounded-2xl bg-rose-50/60 p-3 border border-rose-100 text-left text-[11px] text-rose-700 space-y-1 mt-3">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle size={13} /> Immediate Store-Wide Removal
                </div>
                <p className="text-rose-600/90 text-[10.5px]">
                  This product will be permanently deleted from WooCommerce and will immediately disappear from the Customer Web catalog.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-5 border-t border-gray-100 mt-5">
              <button
                type="button"
                disabled={deletingId === deleteConfirmProduct.id}
                onClick={() => setDeleteConfirmProduct(null)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingId === deleteConfirmProduct.id}
                onClick={() => handleDeleteProduct(deleteConfirmProduct)}
                className="flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50 transition"
              >
                {deletingId === deleteConfirmProduct.id ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 size={14} /> Delete Product
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Products;
