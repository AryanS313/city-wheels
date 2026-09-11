import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: { three: ["three"], physics: ["cannon-es", "earcut"] },
      },
    },
  },
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
});
