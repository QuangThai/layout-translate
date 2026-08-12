import type {
  ContentCommand,
  ExtensionState,
  TargetLanguage,
  TranslationResult,
  TranslationStatus,
} from "../shared/contracts";
import { classifyElement, containsJapanese, preserveModeFor } from "../shared/classification";
import { hasOverflow, measureElement, type GeometrySnapshot } from "../shared/geometry";
import { mockTranslateBatch } from "../shared/mock-translation";

interface SourceRecord {
  anchorId: string;
  node: Text;
  element: HTMLElement;
  source: string;
  prefix: string;
  suffix: string;
  component: ReturnType<typeof classifyElement>;
  mode: ReturnType<typeof preserveModeFor>;
  originalStyle: string | null;
  originalTitle: string | null;
  translation?: TranslationResult;
  translatedTarget?: TargetLanguage;
  displayedText?: string;
  fallback?: "full" | "compact" | "ellipsis-tooltip";
  beforeGeometry?: GeometrySnapshot;
  slot: number;
}

export type ContentStatusReporter = (
  status: TranslationStatus,
  translatedAnchors: number,
  error?: string,
) => void | Promise<void>;

function splitWhitespace(value: string): { core: string; prefix: string; suffix: string } {
  const prefix = value.match(/^\s*/u)?.[0] ?? "";
  const suffix = value.match(/\s*$/u)?.[0] ?? "";
  return { core: value.slice(prefix.length, value.length - suffix.length || undefined), prefix, suffix };
}

function nodeSlot(node: Text): number {
  const parent = node.parentElement;
  return parent ? Array.prototype.indexOf.call(parent.childNodes, node) : -1;
}

function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest("script, style, noscript, template")) return false;
  if (element.getAttribute("aria-hidden") === "true") return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

export class PageTranslationEngine {
  private readonly records = new Map<string, SourceRecord>();
  private readonly recordByNode = new WeakMap<Text, SourceRecord>();
  private readonly recordByElementSlot = new WeakMap<HTMLElement, Map<number, SourceRecord>>();
  private readonly sourceByElementSlot = new WeakMap<HTMLElement, Map<number, string>>();
  private readonly styleSnapshots = new WeakMap<HTMLElement, { style: string | null; title: string | null }>();
  private nextAnchor = 1;
  private observer?: MutationObserver;
  private scanTimer?: number;
  private translating = false;
  private enabled = false;
  private targetLanguage: TargetLanguage = "en";
  private stopped = false;
  private originalPushState?: History["pushState"];
  private originalReplaceState?: History["replaceState"];

  constructor(
    private readonly root: Document,
    private readonly reportStatus: ContentStatusReporter = () => undefined,
  ) {}

  start(): void {
    if (this.observer) return;
    this.stopped = false;
    this.observer = new MutationObserver(() => this.scheduleScan());
    this.observer.observe(this.root.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    this.installRouteHooks();
    void this.reportStatus("inactive", 0);
  }

  stop(): void {
    this.stopped = true;
    this.observer?.disconnect();
    this.observer = undefined;
    if (this.scanTimer !== undefined) window.clearTimeout(this.scanTimer);
    this.restoreOriginal();
    this.removeRouteHooks();
  }

  handleCommand(command: ContentCommand): void {
    switch (command.type) {
      case "SYNC_STATE":
        this.targetLanguage = command.state.targetLanguage;
        this.setEnabled(command.state.enabled);
        break;
      case "SET_ENABLED":
        this.setEnabled(command.enabled);
        break;
      case "SET_TARGET_LANGUAGE":
        this.setTargetLanguage(command.targetLanguage);
        break;
      case "RESTORE_ORIGINAL":
        this.restoreOriginal();
        break;
    }
  }

  private setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      void this.reportStatus("scanning", this.records.size);
      this.scheduleScan();
    } else {
      this.restoreOriginal();
    }
  }

  private setTargetLanguage(targetLanguage: TargetLanguage): void {
    this.targetLanguage = targetLanguage;
    for (const record of this.records.values()) record.translatedTarget = undefined;
    if (this.enabled) this.scheduleScan();
  }

  private scheduleScan(): void {
    if (!this.enabled || this.stopped || this.scanTimer !== undefined) return;
    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = undefined;
      void this.scanAndTranslate();
    }, 40);
  }

  private async scanAndTranslate(): Promise<void> {
    if (!this.enabled || this.translating || this.stopped) return;
    this.translating = true;
    try {
      const recordCountBeforeCollect = this.records.size;
      await this.collectRecords();
      const pending = [...this.records.values()].filter(
        (record) => record.translatedTarget !== this.targetLanguage,
      );
      if (pending.length === 0) {
        if (this.records.size !== recordCountBeforeCollect) {
          await this.reportStatus("rendered", this.records.size);
        }
        return;
      }
      await this.reportStatus("translating", this.records.size);
      const results = await mockTranslateBatch(
        pending.map((record) => ({
          anchorId: record.anchorId,
          source: record.source,
          component: record.component,
        })),
        this.targetLanguage,
      );
      const resultById = new Map(results.map((result) => [result.anchorId, result]));
      for (const record of pending) {
        const result = resultById.get(record.anchorId);
        if (!result) continue;
        record.translation = result;
        record.translatedTarget = this.targetLanguage;
        this.renderRecord(record);
      }
      await this.reportStatus("rendered", this.records.size);
    } catch (error) {
      await this.reportStatus(
        "error",
        this.records.size,
        error instanceof Error ? error.message : "Translation failed",
      );
    } finally {
      this.translating = false;
    }
  }

  private async collectRecords(): Promise<void> {
    for (const record of [...this.records.values()]) {
      if (!record.node.isConnected || !record.element.isConnected) this.removeRecord(record);
    }

    const walker = this.root.createTreeWalker(this.root.body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let current: Node | null = walker.nextNode();
    while (current) {
      if (current.nodeType === Node.TEXT_NODE) nodes.push(current as Text);
      current = walker.nextNode();
    }

    for (const node of nodes) {
      const element = node.parentElement;
      if (!element || !isVisible(element)) continue;
      const { core, prefix, suffix } = splitWhitespace(node.data);
      if (!core) continue;
      const slot = nodeSlot(node);
      const existingRecord = this.recordByNode.get(node);
      const savedSource = this.sourceByElementSlot.get(element)?.get(slot);
      const previousRecord = this.recordByElementSlot.get(element)?.get(slot);
      const knownProjection = previousRecord
        ? [
            previousRecord.source,
            previousRecord.translation?.full,
            previousRecord.translation?.compact,
          ].includes(core)
        : false;
      const currentIsNewSource =
        containsJapanese(core) &&
        savedSource !== undefined &&
        core !== savedSource &&
        !knownProjection;

      if (existingRecord && !currentIsNewSource) continue;

      if (currentIsNewSource && previousRecord) this.removeRecord(previousRecord);

      const source = currentIsNewSource ? core : savedSource ?? core;
      if (!containsJapanese(source)) continue;

      const component = classifyElement(element);
      const record: SourceRecord = {
        anchorId: `anchor-${this.nextAnchor++}`,
        node,
        element,
        source,
        prefix,
        suffix,
        component,
        mode: preserveModeFor(component, element),
        originalStyle: element.getAttribute("style"),
        originalTitle: element.getAttribute("title"),
        beforeGeometry: measureElement(element),
        slot,
      };
      const slots = this.sourceByElementSlot.get(element) ?? new Map<number, string>();
      slots.set(slot, source);
      this.sourceByElementSlot.set(element, slots);
      this.styleSnapshots.set(element, { style: record.originalStyle, title: record.originalTitle });
      this.recordByNode.set(node, record);
      const recordsForElement = this.recordByElementSlot.get(element) ?? new Map<number, SourceRecord>();
      recordsForElement.set(slot, record);
      this.recordByElementSlot.set(element, recordsForElement);
      this.records.set(record.anchorId, record);
    }
  }

  private renderRecord(record: SourceRecord): void {
    if (!record.translation || !record.node.isConnected) return;
    this.restorePresentation(record);
    this.preserveHardRegion(record);
    this.setNodeText(record, record.translation.full);
    if (record.mode === "soft" || record.mode === "medium") {
      record.displayedText = record.translation.full;
      record.fallback = "full";
      return;
    }

    if (!hasOverflow(measureElement(record.element))) {
      record.displayedText = record.translation.full;
      record.fallback = "full";
      return;
    }

    if (record.mode === "critical") {
      record.element.style.overflow = "hidden";
      record.element.style.textOverflow = "ellipsis";
      record.element.style.whiteSpace = "nowrap";
      record.element.title = record.translation.full;
      record.displayedText = record.translation.full;
      record.fallback = "ellipsis-tooltip";
      return;
    }

    this.setNodeText(record, record.translation.compact);
    if (!hasOverflow(measureElement(record.element))) {
      record.displayedText = record.translation.compact;
      record.fallback = "compact";
      return;
    }

    this.setNodeText(record, record.translation.full);
    record.element.style.overflow = "hidden";
    record.element.style.textOverflow = "ellipsis";
    record.element.style.whiteSpace = "nowrap";
    record.element.title = record.translation.full;
    record.displayedText = record.translation.full;
    record.fallback = "ellipsis-tooltip";
  }

  private preserveHardRegion(record: SourceRecord): void {
    if (!(record.mode === "hard" || record.mode === "critical") || !record.beforeGeometry || record.beforeGeometry.width <= 0) return;

    const width = `${record.beforeGeometry.width}px`;
    const computed = window.getComputedStyle(record.element);
    if (computed.display === "inline") record.element.style.display = "inline-block";
    record.element.style.boxSizing = "border-box";
    record.element.style.width = width;
    record.element.style.maxWidth = width;

    if (["navigation", "button", "tab", "badge"].includes(record.component)) {
      const height = `${record.beforeGeometry.height}px`;
      record.element.style.height = height;
      record.element.style.maxHeight = height;
    }
  }

  private setNodeText(record: SourceRecord, value: string): void {
    record.node.data = `${record.prefix}${value}${record.suffix}`;
  }

  private removeRecord(record: SourceRecord): void {
    this.restorePresentation(record);
    this.records.delete(record.anchorId);
    this.recordByNode.delete(record.node);
    const recordsForElement = this.recordByElementSlot.get(record.element);
    recordsForElement?.delete(record.slot);
    if (recordsForElement?.size === 0) this.recordByElementSlot.delete(record.element);
    const sourcesForElement = this.sourceByElementSlot.get(record.element);
    sourcesForElement?.delete(record.slot);
    if (sourcesForElement?.size === 0) this.sourceByElementSlot.delete(record.element);
  }

  private restorePresentation(record: SourceRecord): void {
    const snapshot = this.styleSnapshots.get(record.element);
    if (!snapshot) return;
    if (snapshot.style === null) record.element.removeAttribute("style");
    else record.element.setAttribute("style", snapshot.style);
    if (snapshot.title === null) record.element.removeAttribute("title");
    else record.element.setAttribute("title", snapshot.title);
  }

  private restoreOriginal(): void {
    this.enabled = false;
    for (const record of this.records.values()) {
      if (record.node.isConnected) record.node.data = `${record.prefix}${record.source}${record.suffix}`;
      this.restorePresentation(record);
      record.translatedTarget = undefined;
      record.translation = undefined;
      record.fallback = undefined;
    }
    void this.reportStatus("restored", this.records.size);
  }

  private installRouteHooks(): void {
    const notify = () => this.scheduleScan();
    window.addEventListener("popstate", notify);
    window.addEventListener("hashchange", notify);
    this.originalPushState = history.pushState;
    this.originalReplaceState = history.replaceState;
    history.pushState = (...args) => {
      const result = this.originalPushState?.apply(history, args);
      notify();
      return result;
    };
    history.replaceState = (...args) => {
      const result = this.originalReplaceState?.apply(history, args);
      notify();
      return result;
    };
  }

  private removeRouteHooks(): void {
    if (this.originalPushState) history.pushState = this.originalPushState;
    if (this.originalReplaceState) history.replaceState = this.originalReplaceState;
  }
}
