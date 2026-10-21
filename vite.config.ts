import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // three.js is most of the bundle; keep it in its own long-cached file
    rollupOptions: { output: { manualChunks: { three: ["three"] } } },
    chunkSizeWarningLimit: 700,
  },
});
