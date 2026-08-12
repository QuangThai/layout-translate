import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Layout Translate Spike",
    description:
      "Fixture-only technical spike for layout-preserving Japanese translation.",
    permissions: ["storage", "tabs"],
    host_permissions: ["http://localhost/*", "http://127.0.0.1/*"],
    action: {
      default_title: "Layout Translate",
    },
  },
});
