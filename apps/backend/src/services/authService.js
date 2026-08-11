import axios from "axios";

const API = "http://localhost:5000/api/auth";

export const login = async (email, password) => {
  const response = await axios.post(
    `${API}/login`,
    {
      email,
      password,
    },
    {
      withCredentials: true,
    }
  );

  return response.data;
};