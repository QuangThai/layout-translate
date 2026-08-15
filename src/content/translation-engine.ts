import type {
  ContentCommand,
  ExtensionState,
  TargetLanguage,
  TranslationResult,
  TranslationStatus,
} from "../shared/contracts";
import { classifyElement, containsJapanese, preserveModeFor } from "../shared/classification";
import { hasOverflow, measureElement, type GeometrySnapshot } from "../shared/geometry";
import { detectSourceLanguage, type SourceLanguage } from "../shared/language-detection";
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
  translation?: TranslationResult;
  translatedTarget?: TargetLanguage;
  displayedText?: string;
  fallback?: "full" | "compact" | "ellipsis-tooltip";
  beforeGeometry?: GeometrySnapshot;
  slot: number;
}

interface OwnedStyleMutation {
  originalValue: string;
  originalPriority: string;
  appliedValue: string;
  appliedPriority: string;
}

interface OwnedAttributeMutation {
  originalValue: string | null;
  appliedValue: string;
}

interface PresentationState {
  styles: Map<string, OwnedStyleMutation>;
  attributes: Map<"title" | "aria-label", OwnedAttributeMutation>;
}

export type ContentStatusReporter = (
  status: TranslationStatus,
  translatedAnchors: number,
  error?: string,
) => void | Promise<void>;

export type BatchTranslator = (
  requests: Array<{ anchorId: string; source: string; component: ReturnType<typeof classifyElement> }>,
  targetLanguage: TargetLanguage,
) => Promise<TranslationResult[]>;

// A real provider answers in seconds, so one request for the whole page leaves
// it untouched for the sum of every batch. Smaller batches issued together let
// the first visible text land while the rest is still in flight.
export const TRANSLATION_CHUNK_SIZE = 12;
export const TRANSLATION_CONCURRENCY = 4;

interface TranslationGroup {
  request: { anchorId: string; source: string; component: ReturnType<typeof classifyElement> };
  records: SourceRecord[];
}

export interface GroupableRecord {
  anchorId: string;
  source: string;
  component: ReturnType<typeof classifyElement>;
  /** Viewport-relative top edge; `null` when the element is not laid out. */
  top: number | null;
}

export function chunkItems<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size));
  }
  return chunks;
}

/**
 * Collapses repeated strings into one request item and orders the work so what
 * the reader is already looking at is translated first. A page usually repeats
 * labels across navigation, tables, and cards, and every duplicate would
 * otherwise cost a separate provider translation.
 */
export function buildTranslationGroups<T extends GroupableRecord>(
  records: readonly T[],
  viewportHeight: number,
): Array<{ request: { anchorId: string; source: string; component: T["component"] }; members: T[] }> {
  const groups = new Map<string, { request: { anchorId: string; source: string; component: T["component"] }; members: T[]; order: number }>();
  for (const record of records) {
    const key = `${record.component} ${record.source}`;
    const existing = groups.get(key);
    if (existing) {
      existing.members.push(record);
      continue;
    }
    const top = record.top;
    const visible = top !== null && top >= 0 && top <= viewportHeight;
    groups.set(key, {
      request: { anchorId: record.anchorId, source: record.source, component: record.component },
      members: [record],
      order: visible ? top : viewportHeight + Math.abs(top ?? Number.MAX_SAFE_INTEGER / 2),
    });
  }
  return [...groups.values()]
    .sort((left, right) => left.order - right.order)
    .map(({ request, members }) => ({ request, members }));
}

/**
 * Runs chunks with a bounded number in flight. Workers never reject, so every
 * in-flight chunk settles before the caller sees the failure and can undo the
 * partial work.
 */
export async function runChunksWithConcurrency<T>(
  chunks: readonly T[],
  concurrency: number,
  handler: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const state: { failure?: unknown } = {};
  const worker = async (): Promise<void> => {
    while (state.failure === undefined) {
      const item = chunks[next++];
      if (item === undefined) return;
      try {
        await handler(item);
      } catch (error) {
        // Keep the first failure: a later chunk failing for a knock-on reason
        // would otherwise replace the diagnostic that explains the pass.
        if (state.failure === undefined) state.failure = error ?? new Error("Translation chunk failed");
        return;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, chunks.length)) }, () => worker()),
  );
  if (state.failure !== undefined) throw state.failure;
}

export function correlateTranslationResults(
  expectedAnchorIds: readonly string[],
  results: readonly TranslationResult[],
): Map<string, TranslationResult> {
  const expected = new Set(expectedAnchorIds);
  if (expected.size !== expectedAnchorIds.length || results.length !== expectedAnchorIds.length) {
    throw new Error("Translation backend returned an incomplete or mismatched response");
  }

  const resultById = new Map<string, TranslationResult>();
  for (const result of results) {
    if (!expected.has(result.anchorId) || resultById.has(result.anchorId)) {
      throw new Error("Translation backend returned an incomplete or mismatched response");
    }
    resultById.set(result.anchorId, result);
  }
  return resultById;
}

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

function hasIntrinsicLayoutAncestor(element: HTMLElement): boolean {
  let current = element.parentElement;
  while (current && current !== document.body) {
    const display = window.getComputedStyle(current).display;
    if (["flex", "inline-flex", "grid", "inline-grid"].includes(display)) return true;
    current = current.parentElement;
  }
  return false;
}

export class PageTranslationEngine {
  private readonly records = new Map<string, SourceRecord>();
  private readonly recordByNode = new WeakMap<Text, SourceRecord>();
  private readonly recordByElementSlot = new WeakMap<HTMLElement, Map<number, SourceRecord>>();
  private readonly sourceByElementSlot = new WeakMap<HTMLElement, Map<number, string>>();
  private readonly presentationStates = new WeakMap<HTMLElement, PresentationState>();
  private readonly ownWriteCounts = new WeakMap<Text, number>();
  private nextAnchor = 1;
  private observer?: MutationObserver;
  private scanTimer?: number;
  private translating = false;
  private rescanRequested = false;
  private translationVersion = 0;
  private enabled = false;
  private targetLanguage: TargetLanguage = "en";
  private stopped = false;
  private originalPushState?: History["pushState"];
  private originalReplaceState?: History["replaceState"];
  private fontSet?: FontFaceSet;
  private fontEventHandler?: EventListener;

  constructor(
    private readonly root: Document,
    private readonly reportStatus: ContentStatusReporter = () => undefined,
    private readonly translateBatch: BatchTranslator = (requests, targetLanguage) =>
      mockTranslateBatch(requests, targetLanguage),
  ) {}

  start(): void {
    if (this.observer) return;
    this.stopped = false;
    this.observer = new MutationObserver((mutations) => {
      let pageOwned = false;
      for (const mutation of mutations) {
        const own = mutation.type === "characterData" && this.isOwnWrite(mutation.target);
        if (!own) pageOwned = true;
      }
      if (!pageOwned) return;
      this.translationVersion += 1;
      this.scheduleScan();
    });
    this.observer.observe(this.root.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    this.installFontHooks();
    this.installRouteHooks();
    void this.reportStatus("inactive", 0);
  }

  stop(): void {
    this.stopped = true;
    this.translationVersion += 1;
    this.rescanRequested = false;
    this.observer?.disconnect();
    this.observer = undefined;
    if (this.scanTimer !== undefined) window.clearTimeout(this.scanTimer);
    this.removeFontHooks();
    this.restoreOriginal();
    this.removeRouteHooks();
  }

  handleCommand(command: ContentCommand): void {
    switch (command.type) {
      case "SYNC_STATE":
        this.setTargetLanguage(command.state.targetLanguage);
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
    if (this.targetLanguage === targetLanguage) return;
    this.targetLanguage = targetLanguage;
    this.translationVersion += 1;
    for (const record of this.records.values()) record.translatedTarget = undefined;
    if (this.enabled) this.scheduleScan();
  }

  private scheduleScan(): void {
    if (!this.enabled || this.stopped) return;
    if (this.translating) {
      this.rescanRequested = true;
      return;
    }
    if (this.scanTimer !== undefined) return;
    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = undefined;
      void this.scanAndTranslate();
    }, 40);
  }

  private async scanAndTranslate(): Promise<void> {
    if (!this.enabled || this.translating || this.stopped) return;
    this.translating = true;
    const scanVersion = this.translationVersion;
    const requestedLanguage = this.targetLanguage;
    try {
      await this.waitForFonts();
      if (!this.isCurrentTranslation(scanVersion, requestedLanguage)) return;
      const recordCountBeforeCollect = this.records.size;
      const detectedSourceLanguage = await this.collectRecords();
      if (!this.isCurrentTranslation(scanVersion, requestedLanguage)) return;
      if (detectedSourceLanguage !== "ja") {
        await this.reportStatus("unsupported", this.records.size);
        return;
      }
      const pending = [...this.records.values()].filter(
        (record) => record.translatedTarget !== requestedLanguage,
      );
      if (pending.length === 0) {
        if (this.records.size !== recordCountBeforeCollect) {
          await this.reportStatus("rendered", this.records.size);
        }
        return;
      }
      await this.reportStatus("translating", this.records.size);
      if (!this.isCurrentTranslation(scanVersion, requestedLanguage)) return;
      const rendered: SourceRecord[] = [];
      try {
        await this.translateGroups(
          chunkItems(this.groupPendingRecords(pending), TRANSLATION_CHUNK_SIZE),
          requestedLanguage,
          scanVersion,
          rendered,
        );
      } catch (error) {
        // Batches now render as they arrive, so a later failure would otherwise
        // leave the page half translated. Revert this pass instead.
        for (const record of rendered) this.revertRecord(record);
        throw error;
      }
      if (!this.isCurrentTranslation(scanVersion, requestedLanguage)) return;
      await this.reportStatus("rendered", this.records.size);
    } catch (error) {
      if (this.isCurrentTranslation(scanVersion, requestedLanguage)) {
        await this.reportStatus(
          "error",
          this.records.size,
          error instanceof Error ? error.message : "Translation failed",
        );
      }
    } finally {
      this.translating = false;
      if (this.rescanRequested) {
        this.rescanRequested = false;
        this.scheduleScan();
      }
    }
  }

  private groupPendingRecords(pending: readonly SourceRecord[]): TranslationGroup[] {
    const viewportHeight = window.innerHeight || this.root.documentElement.clientHeight || 0;
    return buildTranslationGroups(
      pending.map((record) => ({
        anchorId: record.anchorId,
        source: record.source,
        component: record.component,
        top: record.element.isConnected ? record.element.getBoundingClientRect().top : null,
        record,
      })),
      viewportHeight,
    ).map((group) => ({
      request: group.request,
      records: group.members.map((member) => member.record),
    }));
  }

  private async translateGroups(
    chunks: readonly TranslationGroup[][],
    requestedLanguage: TargetLanguage,
    scanVersion: number,
    rendered: SourceRecord[],
  ): Promise<void> {
    await runChunksWithConcurrency(chunks, TRANSLATION_CONCURRENCY, async (current) => {
      const results = await this.translateBatch(
        current.map((group) => group.request),
        requestedLanguage,
      );
      // A stale response must not paint over a newer language or a restore.
      if (!this.isCurrentTranslation(scanVersion, requestedLanguage)) return;
      const resultById = correlateTranslationResults(
        current.map((group) => group.request.anchorId),
        results,
      );
      for (const group of current) {
        const result = resultById.get(group.request.anchorId);
        if (!result) {
          throw new Error("Translation backend returned an incomplete or mismatched response");
        }
        for (const record of group.records) {
          record.translation = { anchorId: record.anchorId, full: result.full, compact: result.compact };
          record.translatedTarget = requestedLanguage;
          this.renderRecord(record);
          rendered.push(record);
        }
      }
    });
  }

  private revertRecord(record: SourceRecord): void {
    if (record.node.isConnected) this.writeOwnedText(record.node, `${record.prefix}${record.source}${record.suffix}`);
    this.restorePresentation(record);
    record.translatedTarget = undefined;
    record.translation = undefined;
    record.fallback = undefined;
    record.displayedText = undefined;
  }

  private isCurrentTranslation(scanVersion: number, requestedLanguage: TargetLanguage): boolean {
    return this.enabled
      && !this.stopped
      && this.translationVersion === scanVersion
      && this.targetLanguage === requestedLanguage;
  }

  private async collectRecords(): Promise<SourceLanguage> {
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

    const contexts = nodes.map((node) => {
      const element = node.parentElement;
      if (!element || !isVisible(element)) return undefined;
      const { core, prefix, suffix } = splitWhitespace(node.data);
      if (!core) return undefined;
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
      return { node, element, core, prefix, suffix, slot, existingRecord, savedSource, previousRecord, knownProjection };
    }).filter((context): context is NonNullable<typeof context> => context !== undefined);

    const sourceLanguage = detectSourceLanguage(
      contexts.map((context) => context.knownProjection && context.previousRecord ? context.previousRecord.source : context.core).join("\n"),
      this.root.documentElement.lang,
    );

    for (const context of contexts) {
      const { node, element, core, prefix, suffix, slot, existingRecord, savedSource, previousRecord, knownProjection } = context;
      const currentIsNewSource =
        containsJapanese(core) &&
        savedSource !== undefined &&
        core !== savedSource &&
        !knownProjection;

      if (existingRecord && !currentIsNewSource) {
        if (!knownProjection && !containsJapanese(core)) this.removeRecord(existingRecord);
        continue;
      }

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
        beforeGeometry: measureElement(element),
        slot,
      };
      const slots = this.sourceByElementSlot.get(element) ?? new Map<number, string>();
      slots.set(slot, source);
      this.sourceByElementSlot.set(element, slots);
      this.recordByNode.set(node, record);
      const recordsForElement = this.recordByElementSlot.get(element) ?? new Map<number, SourceRecord>();
      recordsForElement.set(slot, record);
      this.recordByElementSlot.set(element, recordsForElement);
      this.records.set(record.anchorId, record);
    }

    return sourceLanguage;
  }

  private installFontHooks(): void {
    const fonts = this.root.fonts;
    if (!fonts) return;
    this.fontSet = fonts;
    this.fontEventHandler = () => {
      this.translationVersion += 1;
      for (const record of this.records.values()) record.translatedTarget = undefined;
      this.scheduleScan();
    };
    fonts.addEventListener("loadingdone", this.fontEventHandler);
    fonts.addEventListener("loadingerror", this.fontEventHandler);
  }

  private removeFontHooks(): void {
    if (this.fontSet && this.fontEventHandler) {
      this.fontSet.removeEventListener("loadingdone", this.fontEventHandler);
      this.fontSet.removeEventListener("loadingerror", this.fontEventHandler);
    }
    this.fontSet = undefined;
    this.fontEventHandler = undefined;
  }

  private async waitForFonts(): Promise<void> {
    const fonts = this.root.fonts;
    if (!fonts) return;
    try {
      await fonts.ready;
    } catch {
      // Translation should continue even when a page font fails to load.
    }
  }

  private renderRecord(record: SourceRecord): void {
    if (!record.translation || !record.node.isConnected) return;
    this.restorePresentation(record);
    this.preserveHardRegion(record);
    const mediumRegionPreserved = this.preserveMediumRegion(record);
    this.setNodeText(record, record.translation.full);
    if (record.mode === "soft" || (record.mode === "medium" && !mediumRegionPreserved)) {
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
      this.setOwnedStyle(record.element, "overflow", "hidden");
      this.setOwnedStyle(record.element, "text-overflow", "ellipsis");
      this.setOwnedStyle(record.element, "white-space", "nowrap");
      this.setOwnedAttribute(record.element, "title", record.translation.full);
      this.setOwnedAttribute(record.element, "aria-label", record.translation.full);
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
    this.setOwnedStyle(record.element, "overflow", "hidden");
    this.setOwnedStyle(record.element, "text-overflow", "ellipsis");
    this.setOwnedStyle(record.element, "white-space", "nowrap");
    this.setOwnedAttribute(record.element, "title", record.translation.full);
    this.setOwnedAttribute(record.element, "aria-label", record.translation.full);
    record.displayedText = record.translation.full;
    record.fallback = "ellipsis-tooltip";
  }

  private preserveMediumRegion(record: SourceRecord): boolean {
    // Headings participate in normal flow as well as flex/grid sizing; card
    // copy is constrained only when it sits inside an intrinsic layout group.
    if (
      record.mode !== "medium" ||
      !record.beforeGeometry ||
      record.beforeGeometry.height <= 0 ||
      !["heading", "card"].includes(record.component) ||
      (record.component === "card" && !hasIntrinsicLayoutAncestor(record.element))
    ) {
      return false;
    }

    const height = `${record.beforeGeometry.height}px`;
    this.setOwnedStyle(record.element, "box-sizing", "border-box");
    this.setOwnedStyle(record.element, "height", height);
    this.setOwnedStyle(record.element, "max-height", height);
    return true;
  }

  private preserveHardRegion(record: SourceRecord): void {
    if (!(record.mode === "hard" || record.mode === "critical") || !record.beforeGeometry || record.beforeGeometry.width <= 0) return;

    const width = `${record.beforeGeometry.width}px`;
    const computed = window.getComputedStyle(record.element);
    if (computed.display === "inline") this.setOwnedStyle(record.element, "display", "inline-block");
    this.setOwnedStyle(record.element, "box-sizing", "border-box");
    this.setOwnedStyle(record.element, "width", width);
    this.setOwnedStyle(record.element, "max-width", width);

    if (["navigation", "button", "tab", "badge"].includes(record.component)) {
      const height = `${record.beforeGeometry.height}px`;
      this.setOwnedStyle(record.element, "height", height);
      this.setOwnedStyle(record.element, "max-height", height);
    }
  }

  private setNodeText(record: SourceRecord, value: string): void {
    this.writeOwnedText(record.node, `${record.prefix}${value}${record.suffix}`);
  }

  /**
   * Writes text this engine owns and remembers the pending mutation record it
   * will produce. Rendering now happens while later batches are still in
   * flight, so an unmarked write would let the observer treat the engine's own
   * output as a page change and invalidate the pass that produced it.
   */
  private writeOwnedText(node: Text, value: string): void {
    if (node.data === value) return;
    this.ownWriteCounts.set(node, (this.ownWriteCounts.get(node) ?? 0) + 1);
    node.data = value;
  }

  private isOwnWrite(target: Node): boolean {
    const pending = this.ownWriteCounts.get(target as Text);
    if (!pending) return false;
    if (pending === 1) this.ownWriteCounts.delete(target as Text);
    else this.ownWriteCounts.set(target as Text, pending - 1);
    return true;
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

  private getPresentationState(element: HTMLElement): PresentationState {
    const existing = this.presentationStates.get(element);
    if (existing) return existing;
    const state: PresentationState = {
      styles: new Map(),
      attributes: new Map(),
    };
    this.presentationStates.set(element, state);
    return state;
  }

  private setOwnedStyle(element: HTMLElement, property: string, value: string, priority = ""): void {
    const state = this.getPresentationState(element);
    const existing = state.styles.get(property);
    if (existing) {
      existing.appliedValue = value;
      existing.appliedPriority = priority;
    } else {
      const originalValue = element.style.getPropertyValue(property);
      const originalPriority = element.style.getPropertyPriority(property);
      if (originalValue === value && originalPriority === priority) return;
      state.styles.set(property, {
        originalValue,
        originalPriority,
        appliedValue: value,
        appliedPriority: priority,
      });
    }
    element.style.setProperty(property, value, priority);
  }

  private setOwnedAttribute(
    element: HTMLElement,
    attribute: "title" | "aria-label",
    value: string,
  ): void {
    const state = this.getPresentationState(element);
    const existing = state.attributes.get(attribute);
    if (existing) {
      existing.appliedValue = value;
    } else {
      const originalValue = element.getAttribute(attribute);
      if (originalValue === value) return;
      state.attributes.set(attribute, { originalValue, appliedValue: value });
    }
    element.setAttribute(attribute, value);
  }

  private restorePresentation(record: SourceRecord): void {
    const state = this.presentationStates.get(record.element);
    if (!state) return;

    for (const [property, mutation] of state.styles) {
      const currentValue = record.element.style.getPropertyValue(property);
      const currentPriority = record.element.style.getPropertyPriority(property);
      if (currentValue !== mutation.appliedValue || currentPriority !== mutation.appliedPriority) continue;
      if (mutation.originalValue === "") record.element.style.removeProperty(property);
      else record.element.style.setProperty(property, mutation.originalValue, mutation.originalPriority);
    }

    for (const [attribute, mutation] of state.attributes) {
      if (record.element.getAttribute(attribute) !== mutation.appliedValue) continue;
      if (mutation.originalValue === null) record.element.removeAttribute(attribute);
      else record.element.setAttribute(attribute, mutation.originalValue);
    }

    state.styles.clear();
    state.attributes.clear();
  }

  private restoreOriginal(): void {
    this.enabled = false;
    this.translationVersion += 1;
    this.rescanRequested = false;
    for (const record of this.records.values()) {
      if (record.node.isConnected) this.writeOwnedText(record.node, `${record.prefix}${record.source}${record.suffix}`);
      this.restorePresentation(record);
      record.translatedTarget = undefined;
      record.translation = undefined;
      record.fallback = undefined;
    }
    void this.reportStatus("restored", this.records.size);
  }

  private installRouteHooks(): void {
    const notify = () => {
      this.translationVersion += 1;
      this.scheduleScan();
    };
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
