import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Layout Translate Spike",
    description:
      "Technical spike for layout-preserving Japanese translation on fixtures and opt-in sites.",
    permissions: ["storage", "tabs", "scripting"],
    // Fixture pages stay pre-granted for the replayable proofs. Every other site
    // is opt-in per origin from the popup, so the extension holds no standing
    // access to pages the user has not explicitly enabled.
    host_permissions: ["http://localhost/*", "http://127.0.0.1/*"],
    optional_host_permissions: ["http://*/*", "https://*/*"],
    action: {
      default_title: "Layout Translate",
    },
  },
});
