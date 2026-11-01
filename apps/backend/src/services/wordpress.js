import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";
import { shouldRetryUpstreamRead } from "../utils/upstreamReadRetry.js";

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
  // Origin-lock: ensure the request is only sent to the configured WORDPRESS_URL origin
  if (config.url && /^https?:\/\//i.test(config.url)) {
    const configuredOrigin = new URL(process.env.WORDPRESS_URL || "http://localhost").origin;
    const requestOrigin = new URL(config.url).origin;
    if (configuredOrigin !== requestOrigin) {
      throw new Error(
        `[WordPress Service] Outbound request origin ${requestOrigin} does not match configured WORDPRESS_URL origin ${configuredOrigin}`
      );
    }
  }
  if (process.env.MUMBAI_INTERNAL_API_KEY) {
    config.headers = config.headers || {};
    if (!config.headers["X-Mumbai-Internal-Key"]) {
      config.headers["X-Mumbai-Internal-Key"] = process.env.MUMBAI_INTERNAL_API_KEY;
    }
  }
  return config;
});

// Retry only read-only upstream calls. A failed write may already have been applied
// by WordPress even when the response is lost, so mutation calls are not replayed.
wp.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    if (!shouldRetryUpstreamRead(error)) {
      return Promise.reject(error);
    }

    config._retry = true;
    return wp(config);
  }
);

export default wp;
