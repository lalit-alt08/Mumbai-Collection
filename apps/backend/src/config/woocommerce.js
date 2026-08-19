import WooCommerceRestApiModule from "@woocommerce/woocommerce-rest-api";
import { httpsAgent } from "./httpAgent.js";
import dotenv from "dotenv";

dotenv.config();

const WooCommerceRestApi = WooCommerceRestApiModule.default;

const api = new WooCommerceRestApi({
  url: process.env.WOOCOMMERCE_URL,
  consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
  consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
  version: "wc/v3",

  axiosConfig: {
    httpsAgent,
    timeout: 8000,
  },
});

export default api;