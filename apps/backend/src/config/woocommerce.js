import WooCommerceRestApiModule from "@woocommerce/woocommerce-rest-api";
import { httpsAgent } from "./httpAgent.js";
import "./env.js";

const WooCommerceRestApi = WooCommerceRestApiModule.default;
const configuredTimeout = Number.parseInt(process.env.WOOCOMMERCE_API_TIMEOUT_MS, 10);
const woocommerceTimeoutMs =
  Number.isInteger(configuredTimeout) && configuredTimeout >= 8000 && configuredTimeout <= 60000
    ? configuredTimeout
    : 15000;

const api = new WooCommerceRestApi({
  url: process.env.WOOCOMMERCE_URL || "https://mumbai-collection.local",
  consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY || "ck_mock",
  consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET || "cs_mock",
  version: "wc/v3",

  axiosConfig: {
    httpsAgent,
    // WooCommerce can take longer than the customer-facing API, especially
    // when an employee status change needs a read followed by a write.
    timeout: woocommerceTimeoutMs,
  },
});

export default api;
