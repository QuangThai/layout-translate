import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import "./style.css";

import {
  DEFAULT_EXTENSION_STATE,
  type ExtensionState,
  type RuntimeMessage,
  type RuntimeResponse,
  type TargetLanguage,
} from "../../src/shared/contracts";

function statusLabel(state: ExtensionState): string {
  if (state.lastError) return state.lastError;
  if (state.status === "unsupported") return "Japanese source not detected";
  if (state.status === "translating") return "Translating fixture text";
  if (state.status === "rendered") return "Anchors preserved where possible";
  if (state.status === "restored") return "Original Japanese restored";
  if (state.status === "scanning") return "Scanning visible DOM";
  return state.enabled ? "Ready on this tab" : "Translation is off";
}

function Popup() {
  const [state, setState] = useState<ExtensionState>(DEFAULT_EXTENSION_STATE);
  const [busy, setBusy] = useState(true);

  async function send(message: RuntimeMessage) {
    setBusy(true);
    try {
      const response = (await browser.runtime.sendMessage(
        message,
      )) as RuntimeResponse;
      if ("state" in response && response.state) setState(response.state);
    } catch (error) {
      setState((current) => ({
        ...current,
        lastError: error instanceof Error ? error.message : "Runtime unavailable",
      }));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void send({ type: "GET_STATE" });
  }, []);

  function chooseLanguage(targetLanguage: TargetLanguage) {
    if (targetLanguage === state.targetLanguage) return;
    void send({ type: "SET_TARGET_LANGUAGE", targetLanguage });
  }

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <div>
          <p className="eyebrow">LAYOUT / TRANSLATE</p>
          <h1>Keep the page in place.</h1>
        </div>
        <span className={`status-dot ${state.enabled ? "is-on" : ""}`} />
      </header>

      <section className="status-panel" aria-live="polite">
        <span className="status-kicker">STATUS</span>
        <strong>{statusLabel(state)}</strong>
      </section>

      <section className="control-group" aria-label="Translation controls">
        <div className="control-row">
          <span className="control-label">Translate page</span>
          <button
            className={`toggle ${state.enabled ? "is-on" : ""}`}
            type="button"
            aria-pressed={state.enabled}
            disabled={busy}
            onClick={() => void send({ type: "SET_ENABLED", enabled: !state.enabled })}
          >
            <span className="toggle-thumb" />
            <span>{state.enabled ? "ON" : "OFF"}</span>
          </button>
        </div>

        <div className="control-row language-row">
          <span className="control-label">Output language</span>
          <div className="language-switch" role="group" aria-label="Output language">
            {(["en", "vi"] as const).map((language) => (
              <button
                className={state.targetLanguage === language ? "is-selected" : ""}
                type="button"
                aria-pressed={state.targetLanguage === language}
                disabled={busy}
                key={language}
                onClick={() => chooseLanguage(language)}
              >
                {language.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </section>

      <button
        className="restore-button"
        type="button"
        disabled={busy}
        onClick={() => void send({ type: "RESTORE_ORIGINAL" })}
      >
        <span>Restore original Japanese</span>
        <span aria-hidden="true">↗</span>
      </button>

      <footer className="popup-footer">
        <span>Fixture mode</span>
        <span>v0.1 spike</span>
      </footer>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Popup root element is missing");
createRoot(root).render(<Popup />);
