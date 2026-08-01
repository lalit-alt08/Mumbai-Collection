import WooCommerceRestApiModule from "@woocommerce/woocommerce-rest-api";
import dotenv from "dotenv";

dotenv.config();

const WooCommerceRestApi = WooCommerceRestApiModule.default;

const api = new WooCommerceRestApi({
  url: process.env.WOOCOMMERCE_URL,
  consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
  consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
  version: "wc/v3",
});

export default api;