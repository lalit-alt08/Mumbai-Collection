import api from "../config/woocommerce.js";

export const fetchProducts = async () => {
  const response = await api.get("products");
  return response.data;
};