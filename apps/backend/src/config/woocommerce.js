import WooCommerceRestApiModule from "@woocommerce/woocommerce-rest-api";
import axios from "axios";
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

// Override _request to forward axios options (e.g. signal, timeout) directly to axios
api._request = function (method, endpoint, data, params = {}, extraConfig = {}) {
  const url = this._getUrl(endpoint, params);
  const headers = {
    Accept: "application/json",
  };
  if (typeof process !== "undefined" && Object.prototype.toString.call(process) === "[object process]") {
    headers["User-Agent"] = "WooCommerce REST API - JS Client/" + this.classVersion;
  }
  let options = {
    url,
    method,
    responseEncoding: this.encoding,
    timeout: this.timeout,
    responseType: "json",
    headers,
  };
  if (this.isHttps) {
    if (this.queryStringAuth) {
      options.params = {
        consumer_key: this.consumerKey,
        consumer_secret: this.consumerSecret,
      };
    } else {
      options.auth = {
        username: this.consumerKey,
        password: this.consumerSecret,
      };
    }
    options.params = { ...options.params, ...params };
  } else {
    options.params = this._getOAuth().authorize({
      url,
      method,
    });
  }
  if (data) {
    options.headers["Content-Type"] = "application/json;charset=utf-8";
    options.data = JSON.stringify(data);
  }
  const mergedHeaders = {
    ...headers,
    ...(this.axiosConfig?.headers || {}),
    ...(extraConfig.headers || {}),
  };
  options = {
    ...options,
    ...this.axiosConfig,
    ...extraConfig,
    headers: mergedHeaders,
  };
  return axios(options);
};

// Augment api.get to accept extraConfig (signal, timeout, etc.)
api.get = function (endpoint, params = {}, extraConfig = {}) {
  return this._request("get", endpoint, null, params, extraConfig);
};

export default api;
