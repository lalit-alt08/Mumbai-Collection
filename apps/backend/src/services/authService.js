import api from "../config/woocommerce.js";

export const createCustomer = async (customerData) => {
  const response = await api.post("customers", customerData);
  return response.data;
};

export const getCustomerByEmail = async (email) => {
  const response = await api.get("customers", {
    email,
  });

  return response.data;
};