import api from "../config/woocommerce.js";
import { uploadMedia } from "../services/wordpressMediaService.js";

/**
 * Product Input Validation Helper
 */
export const validateProductInput = ({
  name,
  regular_price,
  sale_price,
  stock_quantity,
  stock_status,
}) => {
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      return "Product name must be a non-empty string.";
    }

    if (name.trim().length > 200) {
      return "Product name cannot exceed 200 characters.";
    }
  }

  if (regular_price !== undefined) {
    const price = Number(regular_price);

    if (!Number.isFinite(price) || price < 0) {
      return "Regular price must be a valid non-negative number.";
    }
  }

  if (sale_price !== undefined && sale_price !== "") {
    const salePrice = Number(sale_price);

    if (!Number.isFinite(salePrice) || salePrice < 0) {
      return "Sale price must be a valid non-negative number.";
    }

    if (
      regular_price !== undefined &&
      salePrice > Number(regular_price)
    ) {
      return "Sale price cannot be greater than regular price.";
    }
  }

  if (stock_quantity !== undefined && stock_quantity !== null && stock_quantity !== "") {
    const stock = Number(stock_quantity);

    if (!Number.isInteger(stock) || stock < 0) {
      return "Stock quantity must be a non-negative integer.";
    }
  }

  if (stock_status !== undefined) {
    const allowedStockStatuses = [
      "instock",
      "outofstock",
      "onbackorder",
    ];

    if (!allowedStockStatuses.includes(stock_status)) {
      return "Invalid stock status.";
    }
  }

  return null;
};

/**
 * Get Products for Inventory Manager with Server-Side Pagination & Search
 */
export const getAdminProducts = async (req, res) => {
  try {
    const { category, search, page = 1, per_page = 20, stock_status } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limit = Math.min(100, Math.max(1, Number(per_page) || 20));

    const queryParams = {
      page: pageNum,
      per_page: limit,
      orderby: "date",
      order: "desc",
    };

    if (category && category !== "all") {
      queryParams.category = category;
    }

    const ALLOWED_STOCK_STATUSES = ["instock", "outofstock", "onbackorder"];
    if (stock_status && ALLOWED_STOCK_STATUSES.includes(stock_status)) {
      queryParams.stock_status = stock_status;
    }

    if (search && search.trim()) {
      queryParams.search = search.trim();
    }

    const response = await api.get("products", queryParams);
    const products = Array.isArray(response.data) ? response.data : [];

    const totalProducts = Number(response.headers["x-wp-total"]) || products.length;
    const totalPages = Number(response.headers["x-wp-totalpages"]) || Math.ceil(totalProducts / limit) || 1;

    const formatted = products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      sku: p.sku || `MC-${p.id}`,
      price: p.price,
      regular_price: p.regular_price,
      sale_price: p.sale_price,
      stock_quantity: p.stock_quantity,
      manage_stock: p.manage_stock,
      stock_status: p.stock_status,
      categories: p.categories?.map((c) => ({ id: c.id, name: c.name, slug: c.slug })) || [],
      image: p.images?.[0]?.src || null,
      images: (p.images || []).map((img) => img.src),
      date_created: p.date_created,
    }));

    res.json({
      success: true,
      page: pageNum,
      per_page: limit,
      total: totalProducts,
      totalPages,
      count: formatted.length,
      products: formatted,
    });
  } catch (error) {
    console.error("Get admin products error:", error.response?.data || error.message);
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to load products.",
      products: [],
    });
  }
};

/**
 * Update Product Price and Stock Quantity
 */
export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { regular_price, sale_price, stock_quantity, stock_status, name } = req.body;

    const validationError = validateProductInput({
      name,
      regular_price,
      sale_price,
      stock_quantity,
      stock_status,
    });

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const updatePayload = {};

    if (name !== undefined) updatePayload.name = name.trim();
    if (regular_price !== undefined) updatePayload.regular_price = String(regular_price);
    if (sale_price !== undefined) updatePayload.sale_price = sale_price ? String(sale_price) : "";
    if (stock_quantity !== undefined && stock_quantity !== null && stock_quantity !== "") {
      const stockNum = Number(stock_quantity);
      updatePayload.manage_stock = true;
      updatePayload.stock_quantity = stockNum;
      updatePayload.stock_status = stockNum > 0 ? "instock" : "outofstock";
    } else if (stock_status !== undefined) {
      updatePayload.stock_status = stock_status;
    }

    const response = await api.put(`products/${encodeURIComponent(id)}`, updatePayload);

    res.json({
      success: true,
      message: `Product #${id} updated successfully.`,
      product: response.data,
    });
  } catch (error) {
    console.error("Update product error:", error.response?.data || error.message);
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to update product.",
    });
  }
};

/**
 * Permanently Delete Product from WooCommerce Catalog
 */
export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const numericId = Number(id);
    if (!id || isNaN(numericId) || numericId <= 0) {
      return res.status(400).json({
        success: false,
        message: "A valid numeric Product ID is required.",
      });
    }

    const response = await api.delete(`products/${encodeURIComponent(numericId)}`, {
      force: true,
    });

    res.json({
      success: true,
      message: `Product #${id} permanently deleted from store catalog.`,
      product: response.data,
    });
  } catch (error) {
    console.error("Delete product error:", error.response?.data || error.message);
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to delete product.",
    });
  }
};

/**
 * Upload Product Image to WordPress Media Library (Delegates to wordpressMediaService)
 */
export const uploadProductImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image file provided.",
      });
    }

    const { id, url } = await uploadMedia(req.file);

    res.json({
      success: true,
      url,
      id,
    });
  } catch (error) {
    console.error("Admin media upload error:", error.response?.data || error.message);
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message:
        error.response?.data?.message ||
        error.message ||
        "Failed to upload image to WordPress Media Library.",
      code: error.response?.data?.code || "media_upload_error",
    });
  }
};

/**
 * Create New Product
 */
export const createProduct = async (req, res) => {
  try {
    const {
      name,
      regular_price,
      sale_price,
      stock_quantity,
      category_ids,
      categories,
      image_url,
      images,
      description,
      short_description,
      sku,
    } = req.body;

    if (!name || regular_price === undefined || regular_price === null || regular_price === "") {
      return res.status(400).json({
        success: false,
        message: "Product name and regular price are required.",
      });
    }

    const validationError = validateProductInput({
      name,
      regular_price,
      sale_price,
      stock_quantity,
    });

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const finalStock =
      stock_quantity !== undefined && stock_quantity !== null && stock_quantity !== ""
        ? Number(stock_quantity)
        : 10;

    const catList = Array.isArray(category_ids)
      ? category_ids
      : Array.isArray(categories)
      ? categories
      : [];

    const imgList = Array.isArray(images) && images.length > 0
      ? images.map((img) => (typeof img === "string" ? { src: img } : img))
      : image_url
      ? [{ src: image_url }]
      : [];

    const payload = {
      name: name.trim(),
      type: "simple",
      regular_price: String(regular_price),
      sale_price: sale_price ? String(sale_price) : "",
      description: description || "",
      short_description: short_description || "",
      manage_stock: true,
      stock_quantity: finalStock,
      stock_status: finalStock > 0 ? "instock" : "outofstock",
      categories: catList.map((id) => (typeof id === "object" ? id : { id: Number(id) })),
      images: imgList,
    };

    if (sku && String(sku).trim()) {
      payload.sku = String(sku).trim();
    }

    const response = await api.post("products", payload);

    res.status(201).json({
      success: true,
      message: "Product created successfully.",
      product: response.data,
    });
  } catch (error) {
    console.error("Create product error:", error.response?.data || error.message);
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to create product.",
    });
  }
};
