import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";

const wp = axios.create({
  baseURL: process.env.WORDPRESS_URL,
  timeout: 8000,

  auth: {
    username: process.env.WP_USERNAME,
    password: process.env.WP_APPLICATION_PASSWORD,
  },

  httpsAgent,
});

// Automatically retry once if a socket was closed by the web server
wp.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    if (!config || config._retry) {
      return Promise.reject(error);
    }

    if (
      error.code === "ECONNRESET" ||
      error.code === "ETIMEDOUT" ||
      error.message?.includes("socket hang up")
    ) {
      config._retry = true;
      return wp(config);
    }

    return Promise.reject(error);
  }
);

export default wp;