import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import path from "node:path";

const apiTarget = process.env.VITE_API_TARGET || "http://localhost:3011";

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      imports: ["vue", "vue-router", "pinia"],
      resolvers: [ElementPlusResolver()],
      dts: "auto-imports.d.ts",
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: "components.d.ts",
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/echarts/") || id.includes("/vue-echarts/")) {
            return "charts";
          }
          if (id.includes("/zrender/")) {
            return "zrender";
          }
          if (id.includes("/viewerjs/") || id.includes("/artplayer/") || id.includes("/html-to-image/") || id.includes("/qrcode/")) {
            return "media-tools";
          }
          if (id.includes("/exceljs/") || id.includes("/jszip/") || id.includes("/uuid/")) {
            return "excel-tools";
          }
          if (id.includes("/marked/") || id.includes("/dompurify/")) {
            return "markdown-tools";
          }
          return undefined;
        },
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: "modern",
        silenceDeprecations: ["legacy-js-api", "color-functions", "global-builtin", "import"],
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/uploads": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/filestore": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
