import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, "framework-app.ts"),
      fileName: "framework-app",
      formats: ["es"],
    },
    outDir: resolve(import.meta.dirname, "../.output/framework-fixture"),
    sourcemap: false,
  },
});
