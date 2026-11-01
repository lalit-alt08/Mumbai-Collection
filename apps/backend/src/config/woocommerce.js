import WooCommerceRestApiModule from "@woocommerce/woocommerce-rest-api";
import { httpsAgent } from "./httpAgent.js";
import "./env.js";

const WooCommerceRestApi = WooCommerceRestApiModule.default;
const configuredTimeout = Number.parseInt(process.env.WOOCOMMERCE_API_TIMEOUT_MS, 10);
const woocommerceTimeoutMs =
  Number.isInteger(configuredTimeout) && configuredTimeout >= 8000 && configuredTimeout <= 60000
    ? configuredTimeout
    : 15000;

const isProduction = process.env.NODE_ENV === "production";
const wooUrl = process.env.WOOCOMMERCE_URL || (isProduction ? "" : "https://mumbai-collection.local");
const wooKey = process.env.WOOCOMMERCE_CONSUMER_KEY || (isProduction ? "" : "ck_mock");
const wooSecret = process.env.WOOCOMMERCE_CONSUMER_SECRET || (isProduction ? "" : "cs_mock");

if (isProduction) {
  if (!wooUrl || wooUrl.includes(".local") || !wooKey || wooKey.includes("mock") || !wooSecret || wooSecret.includes("mock")) {
    throw new Error(
      "[WooCommerce Config] Production environment must specify valid non-mock WOOCOMMERCE_URL, WOOCOMMERCE_CONSUMER_KEY, and WOOCOMMERCE_CONSUMER_SECRET."
    );
  }
}

const api = new WooCommerceRestApi({
  url: wooUrl,
  consumerKey: wooKey,
  consumerSecret: wooSecret,
  version: "wc/v3",

  axiosConfig: {
    httpsAgent,
    // WooCommerce can take longer than the customer-facing API, especially
    // when an employee status change needs a read followed by a write.
    timeout: woocommerceTimeoutMs,
  },
});

export default api;
