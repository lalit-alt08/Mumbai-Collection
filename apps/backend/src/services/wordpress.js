import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";

const wp = axios.create({
  baseURL: process.env.WORDPRESS_URL,
  timeout: 8000,
  // NOTE: Do NOT add `auth` here. All mumbai-auth.php endpoints use
  // mumbai_internal_server_permission which checks X-Mumbai-Internal-Key only.
  // Adding Basic Auth causes WordPress Core to run wp_authenticate_application_password()
  // BEFORE the route callback, which rejects anything that isn't a proper WP App Password.
  httpsAgent,
});

// Automatically attach internal API key for server-to-server trust boundary
wp.interceptors.request.use((config) => {
  if (process.env.MUMBAI_INTERNAL_API_KEY) {
    config.headers = config.headers || {};
    if (!config.headers["X-Mumbai-Internal-Key"]) {
      config.headers["X-Mumbai-Internal-Key"] = process.env.MUMBAI_INTERNAL_API_KEY;
    }
  }
  return config;
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