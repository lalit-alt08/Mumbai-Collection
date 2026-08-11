import WooCommerceRestApiModule from "@woocommerce/woocommerce-rest-api";
import https from "https";
import dotenv from "dotenv";

dotenv.config();

const WooCommerceRestApi = WooCommerceRestApiModule.default;

const httpsAgent =
  process.env.NODE_ENV === "development"
    ? new https.Agent({
        rejectUnauthorized: false,
      })
    : undefined;

const api = new WooCommerceRestApi({
  url: process.env.WOOCOMMERCE_URL,
  consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
  consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
  version: "wc/v3",

  axiosConfig: {
    httpsAgent,
  },
});

export default api;