import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],

  server: {
    proxy: {
      "/api/store": {
        target: "https://mumbai-collection.local",
        changeOrigin: true,
        secure: false,

        rewrite: (path) =>
          path.replace("/api/store", "/wp-json/wc/store/v1"),

        /*
         * Fix: WordPress's access-control-expose-headers does not include
         * 'Nonce', so the browser's CORS policy silently drops it before
         * Axios can read it in storeApi.js. The nonce variable stays "",
         * every POST to add-item sends Nonce: "" and WooCommerce returns
         * 401 woocommerce_rest_missing_nonce.
         *
         * The Vite proxy intercepts the response server-side (no CORS
         * restrictions here) and patches the expose header list to also
         * include Nonce, so the browser can read it correctly.
         */
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            const expose =
              proxyRes.headers["access-control-expose-headers"] || "";

            const parts = expose
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);

            if (!parts.map((p) => p.toLowerCase()).includes("nonce")) {
              parts.push("Nonce");
            }
            if (!parts.map((p) => p.toLowerCase()).includes("nonce-timestamp")) {
              parts.push("Nonce-Timestamp");
            }

            proxyRes.headers["access-control-expose-headers"] =
              parts.join(", ");
          });
        },
      },
    },
  },
});