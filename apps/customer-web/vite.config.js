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
      },
    },
  },
});