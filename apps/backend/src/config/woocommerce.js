import WooCommerceRestApiModule from "@woocommerce/woocommerce-rest-api";
import { httpsAgent } from "./httpAgent.js";
import "./env.js";

const WooCommerceRestApi = WooCommerceRestApiModule.default;

const api = new WooCommerceRestApi({
  url: process.env.WOOCOMMERCE_URL || "https://mumbai-collection.local",
  consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY || "ck_mock",
  consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET || "cs_mock",
  version: "wc/v3",

  axiosConfig: {
    httpsAgent,
    timeout: 8000,
  },
});

export default api;