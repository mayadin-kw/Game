import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  base: "/Game/",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: resolve(__dirname, "dev-index.html"),
      output: {
        entryFileNames: "app.js",
        chunkFileNames: "[name].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) {
            return "app.css";
          }

          return "[name][extname]";
        },
      },
    },
    assetsDir: "",
  },
});
