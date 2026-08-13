import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { createApp, h, ref } from "vue";

function ReactFixture() {
  const [rerendered, setRerendered] = useState(false);
  return React.createElement(
    React.Fragment,
    null,
    React.createElement("p", { className: "section-label" }, "REACT RERENDER"),
    React.createElement(
      "p",
      { id: "react-copy" },
      rerendered ? "新しい通知" : "利用規約",
    ),
    React.createElement(
      "button",
      {
        id: "react-rerender",
        className: "secondary-action",
        type: "button",
        onClick: () => setRerendered(true),
      },
      "Re-render React",
    ),
  );
}

const reactRoot = document.querySelector<HTMLElement>("#react-root");
if (reactRoot) {
  createRoot(reactRoot).render(
    React.createElement(StrictMode, null, React.createElement(ReactFixture)),
  );
  document.documentElement.dataset.reactReady = "true";
}

const vueRoot = document.querySelector<HTMLElement>("#vue-root");
if (vueRoot) {
  createApp({
    setup() {
      const rerendered = ref(false);
      return () => h("div", null, [
        h("p", { class: "section-label" }, "VUE RERENDER"),
        h("p", { id: "vue-copy" }, rerendered.value ? "新しい通知" : "会社情報"),
        h(
          "button",
          {
            id: "vue-rerender",
            class: "secondary-action",
            type: "button",
            onClick: () => { rerendered.value = true; },
          },
          "Re-render Vue",
        ),
      ]);
    },
  }).mount(vueRoot);
  document.documentElement.dataset.vueReady = "true";
}
