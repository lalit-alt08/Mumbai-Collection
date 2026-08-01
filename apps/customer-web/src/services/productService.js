import axios from "axios";

const API = "http://localhost:5000/api";

export const getProducts = async () => {
  const response = await axios.get(`${API}/products`);
  return response.data;
};