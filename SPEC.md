# SPEC — Layout-Preserving AI Translation Extension

**Status:** Draft for Technical Spike / MVP implementation  
**Date:** 2026-08-12  
**Working title:** Layout-Preserving Translation Extension  
**Primary source focus:** Japanese websites  
**Output languages:** English (EN), Vietnamese (VI)  
**Primary surface:** Chromium browser extension  

---

## 1. Product summary

Build a browser extension for company web projects—especially Japanese-language websites—that lets a user translate the current application into **English or Vietnamese** while preserving the original visual composition as closely as practical.

The product is **not** a generic “replace Japanese strings with translated strings” tool. Its core problem is:

> **Semantic translation under visual constraints.**

The user should be able to look at the same visual position where Japanese content originally appeared and immediately understand the corresponding EN/VI content at that location.

### Primary product goal

- Auto-detect the source language, with Japanese as the primary target source.
- Let the user choose output language: **EN** or **VI**.
- Use an OpenAI model for context-aware translation.
- Preserve the original **visual anchor / visual region** of translated UI text.
- Minimize layout displacement, sibling movement, unexpected wrapping, overflow, component resizing, and page-level reflow.
- If a full translation does not fit, adapt the **translation before adapting the layout**.
- If the translation still cannot fit safely, constrain the translated text in-place and expose the full translation through tooltip/popover.
- Continue translating when the user navigates through menus/routes/pages in the same application without requiring re-activation.

### Core product principle

> Japanese text at position X should become understandable EN/VI text at approximately position X, without materially changing the surrounding UI composition.

### Explicit non-goal

The product does **not** promise zero-pixel layout change for every website and every browser edge case. The realistic target is **high visual stability with graceful, deterministic fallback behavior**.

---

## 2. Core use cases, user stories

### UC-01 — Translate the current Japanese page

**As a user**, I want to enable translation and choose EN or VI so that I can understand the current Japanese page without leaving the website.

**Acceptance:**
- Source language is auto-detected.
- User chooses `EN` or `VI`.
- Visible supported DOM text is translated.
- Original application remains interactive.

### UC-02 — Understand navigation without layout breakage

**As a user**, I want Japanese header/menu/tab labels translated in the same visual positions so that I can understand where each action leads without the navigation bar being pushed, wrapped, or resized significantly.

**Examples:**
- `お問い合わせはこちら` → `Contact Us` instead of a long literal phrase.
- `会社情報` → `Company` where navigation space is constrained.

### UC-03 — Translate compact controls

**As a user**, I want buttons, badges, tabs, breadcrumbs, and labels translated without changing the shape of the surrounding UI.

**Fallback order:**
1. Full context-aware translation.
2. Shorter semantic translation.
3. Conventional UI wording.
4. Constrained display with ellipsis/clamp.
5. Full translation via tooltip/popover.

### UC-04 — Read long content safely

**As a user**, I want paragraphs/descriptions translated naturally, while allowing limited height/wrapping changes when that does not damage the page composition.

Long-form content uses **soft layout constraints** rather than the hard constraints used for navigation and controls.

### UC-05 — Translate tables without widening the table

**As a user**, I want table headers/cells translated without causing columns or the overall table to expand unexpectedly.

Preferred fallback:
- compact translation;
- ellipsis in the original cell region;
- full value on hover/focus.

### UC-06 — Continue translation while navigating

**As a user**, after enabling translation I want menu clicks, SPA route changes, lazy-loaded content, dialogs, and dynamically inserted supported text to continue translating automatically.

The user should not need to reopen the extension for each route.

### UC-07 — Switch EN / VI

**As a user**, I want to switch between EN and VI so that the same page can be understood in either language.

Switching language should restore/use original source text as the translation source, not translate EN → VI or VI → EN from an already translated DOM value.

### UC-08 — Recover the original Japanese

**As a user**, I want to turn translation off and restore the original Japanese text without reloading the application where feasible.

### UC-09 — See full text when constrained

**As a user**, when translated text must be truncated to preserve the layout, I want hover/focus/click access to the full translation.

Tooltip/popover must not itself reflow the original application.

### UC-10 — Project-specific quality

**As a project/team**, I want optional per-project rules (selectors, exclusions, glossary, component overrides) so that internal company applications can achieve higher quality than a purely generic translator.

---

## 3. Product Shape

### User-facing shape

A lightweight browser extension with a compact popup:

```text
┌─────────────────────────────┐
│ Translation                 │
│                             │
│ Status     [ ON / OFF ]     │
│ Output     [ EN | VI ]      │
│                             │
│ Restore original            │
└─────────────────────────────┘
```

The popup is intentionally small. Translation behavior happens directly in the current page.

### Runtime shape

```text
Extension UI
    │
    ├── Translation ON/OFF
    └── Output language EN/VI
             │
             ▼
      Translation State
             │
             ▼
      Content Script Engine
             │
   ┌─────────┼──────────┐
   │         │          │
Extract   Measure    Observe
DOM       Layout     Changes
   │         │          │
   └─────────┼──────────┘
             ▼
      Translation Batch
             │
             ▼
       Company Backend
             │
             ▼
          OpenAI
             │
             ▼
  Full + compact translation
             │
             ▼
       Rendering Policy
             │
     ┌───────┴────────┐
     │                │
    Fit            Not fit
     │                │
  Render       compact / clamp
                       │
                    tooltip
```

### Product shape by component class

| Component | Default policy | Primary goal |
|---|---|---|
| Header / Navigation | Hard preserve | Preserve sibling positions and one-line layout |
| Button | Hard preserve | Preserve button dimensions |
| Tab | Hard preserve | Preserve tab row and active-indicator geometry |
| Badge / Tag | Hard preserve | Preserve compact size |
| Table header/cell | Hard preserve | Preserve table/column geometry |
| Form label | Hard/medium | Preserve field alignment |
| Heading | Medium preserve | Allow limited wrapping; preserve hierarchy |
| Card description | Medium preserve | Preserve card/grid alignment |
| Paragraph / article body | Soft preserve | Prioritize readability and semantics |
| Warning / legal / security text | Semantic-critical | Never silently lose critical meaning |

### Out of shape for MVP

- Text embedded in images.
- Canvas-rendered text.
- PDF translation.
- OCR.
- Cross-origin iframe content that the extension cannot legally/technically access.
- Universal support for every custom WebGL/canvas application.

---

## 4. Design Laws

These laws are higher priority than implementation convenience.

### Law 1 — Preserve the visual anchor

A translated string should remain associated with the same original visual region.

The system optimizes for **spatial correspondence**, not literal character count.

### Law 2 — Adapt language before layout

When text is too long:

```text
Full translation
   ↓
Short semantic translation
   ↓
UI-specific wording
   ↓
Constrained text + tooltip
   ↓
Small policy-approved visual adjustment
```

Do not immediately resize containers, restructure flex/grid, or aggressively shrink fonts.

### Law 3 — Semantics cannot be sacrificed blindly

A translation that fits perfectly but changes the meaning materially is a failure.

Critical content—including warnings, security actions, legal text, financial values, confirmation messages, and destructive actions—must not be silently shortened into ambiguity.

### Law 4 — Layout stability is component-aware

There is no single “fit” rule for the whole page.

- Navigation/button/table: hard constraints.
- Heading/card: medium constraints.
- Paragraph/article: soft constraints.

### Law 5 — Full meaning remains accessible

If full translated text cannot be displayed in-place, the user must still be able to access it through tooltip/popover/focus/click behavior.

### Law 6 — Do not mutate structural CSS by default

The extension should not rewrite the site's layout to make translation fit.

Allowed, policy-controlled tools include:
- `text-overflow` / ellipsis;
- `line-clamp`;
- max line rules;
- temporary measurement styles;
- very small typography adjustment where explicitly allowed;
- isolated tooltip/popover layers.

Avoid by default:
- changing grid/flex structure;
- changing parent widths;
- global margin/padding changes;
- `transform: scaleX(...)` to squeeze text;
- large font-size reduction.

### Law 7 — Original text is the source of truth

Always retain the original Japanese/source text and metadata.

Language switching must translate from the original source, not from a previous translation.

### Law 8 — Dynamic pages are first-class

SPA route changes and dynamic DOM updates are normal behavior, not edge behavior.

### Law 9 — Generic engine, project adapters

The base engine should work generically, but company projects may provide rules for:
- include/exclude selectors;
- glossary;
- component classification overrides;
- special handling;
- domain-level policies.

### Law 10 — Do not claim impossible guarantees

The product should state “minimal visual displacement / preserved visual anchor” rather than “zero layout shift for every edge case.”

---

## 5. Technical architecture

### 5.1 High-level architecture

```text
┌───────────────────────────────────────────────────────┐
│ Browser Extension                                    │
│                                                       │
│ ┌──────────────┐      ┌────────────────────────────┐ │
│ │ Popup / UI   │      │ Background Service Worker │ │
│ │ ON/OFF EN/VI │◄────►│ state / auth / messaging │ │
│ └──────┬───────┘      └─────────────┬──────────────┘ │
│        │                             │                │
│        ▼                             │                │
│ ┌───────────────────────────────────▼──────────────┐ │
│ │ Content Script / Page Translation Engine        │ │
│ │                                                  │ │
│ │ Extract → classify → snapshot → batch → render  │ │
│ │             │                         │          │ │
│ │       MutationObserver          Layout validator │ │
│ └──────────────────────┬───────────────────────────┘ │
└────────────────────────┼─────────────────────────────┘
                         │ HTTPS
                         ▼
┌───────────────────────────────────────────────────────┐
│ Company Translation Backend                           │
│                                                       │
│ auth → sanitize → batch → cache → OpenAI → validate  │
│                            │                          │
│                  structured translation response      │
└───────────────────────────────────────────────────────┘
```

### 5.2 Extension responsibilities

**Popup/UI**
- ON/OFF.
- EN/VI selection.
- Restore original.
- Basic status/error state.

**Content script**
- Traverse supported DOM text.
- Exclude non-translatable/unsafe nodes.
- Capture visual/layout evidence.
- Classify component type.
- Generate stable per-element translation IDs.
- Send translation batches.
- Render translations.
- Validate fit and layout displacement.
- Apply fallback policy.
- Attach tooltip/popover for constrained content.
- Watch DOM and SPA changes.

**Background service worker**
- Coordinate privileged extension operations.
- Maintain messaging boundary.
- Manage backend auth/session integration.
- Load/persist extension settings.
- Avoid relying on in-memory state that must survive service-worker suspension.

### 5.3 Backend responsibilities

- Keep OpenAI credentials outside the extension bundle.
- Authenticate extension requests.
- Validate/sanitize payloads.
- Optional sensitive-data masking.
- Apply project glossary and translation policy.
- Batch OpenAI calls.
- Use structured output.
- Return full + compact candidates where useful.
- Apply request/rate limits.
- Optional cache with security/retention policy.
- Observability without logging sensitive page content by default.

### 5.4 Translation request model

Example conceptual request:

```json
{
  "targetLanguage": "vi",
  "page": {
    "title": "...",
    "urlScope": "project-a.company.jp"
  },
  "items": [
    {
      "id": "node-123",
      "source": "お問い合わせはこちら",
      "componentType": "navigation",
      "context": {
        "parentText": "...",
        "sectionHeading": "..."
      },
      "visual": {
        "width": 118,
        "height": 32,
        "lineCount": 1,
        "whiteSpace": "nowrap"
      },
      "constraints": {
        "preferCompact": true,
        "allowWrap": false
      }
    }
  ]
}
```

Conceptual response:

```json
{
  "items": [
    {
      "id": "node-123",
      "full": "Liên hệ với chúng tôi",
      "compact": "Liên hệ",
      "semanticCritical": false
    }
  ]
}
```

### 5.5 Render and validation loop

```text
Original DOM
    ↓
Capture source + geometry
    ↓
Translate
    ↓
Try full translation
    ↓
Measure
    ├── fits → accept
    └── fails
          ↓
       try compact
          ↓
       measure
          ├── fits → accept
          └── fails
                ↓
      constrain original visual region
                ↓
       ellipsis / line clamp
                ↓
       full text tooltip/popover
```

### 5.6 What counts as a layout failure

Hard failures:
- text overlaps another visible element;
- component becomes unusable;
- unexpected horizontal page scrolling is introduced;
- navigation wraps when policy forbids it;
- table width expands beyond policy;
- important sibling positions move materially;
- translated text renders outside its allowed visual region;
- critical content becomes ambiguous or inaccessible.

Soft failures:
- small pixel shifts within tolerance;
- paragraph gains a limited extra line when allowed;
- small heading size/height change allowed by policy.

### 5.7 State behavior

Recommended MVP behavior:
- Target language (`EN` / `VI`) persists as a user preference.
- Translation ON/OFF persists for the active tab/session so SPA navigation and reload in the same tab remain translated.
- Opening an unrelated tab does not automatically translate by default.
- “Always translate this domain/project” is a later optional setting.

### 5.8 Site/project adapter

```ts
interface ProjectRule {
  matches: string[];
  includeSelectors?: string[];
  excludeSelectors?: string[];
  glossary?: Record<string, string>;
  componentOverrides?: Record<string, ComponentType>;
  policyOverrides?: Record<string, Partial<ComponentPolicy>>;
}
```

This is a first-class architectural concept, learned in part from the practical site-adaptation patterns exposed by Immersive Translate.

---

## 6. Tech stack

### Browser extension

- **WXT** — extension framework/build system.
- **TypeScript** — primary language.
- **Manifest V3** — Chromium extension platform.
- **React** — popup/settings UI only.
- **Native DOM APIs** for page translation logic:
  - `TreeWalker` / DOM traversal;
  - `MutationObserver`;
  - `ResizeObserver` where useful;
  - `getBoundingClientRect()`;
  - `getComputedStyle()`;
  - `document.fonts.ready` for font-sensitive measurements where appropriate.
- **chrome.storage / WXT storage** — persistent extension state.
- **chrome.runtime messaging** — communication between extension contexts.

### Backend

- **Node.js + TypeScript**.
- **OpenAI official JS/TS SDK**.
- **OpenAI Responses API**.
- **Structured Outputs / JSON Schema** for deterministic response shape.
- **Zod** or equivalent runtime validation.
- HTTP API (framework may be Fastify/Hono/Express; not architecture-critical).
- Cache: memory first; Redis only when scale/retention policy justifies it.

### Testing

- **Vitest** — unit tests.
- **Playwright** — browser/E2E, fixture navigation, geometry assertions.
- Screenshot comparison / visual regression fixtures.
- Representative Japanese test pages/components.

### Package management / quality

- `pnpm` recommended.
- ESLint / formatting according to company standard.
- TypeScript strict mode.

### Model strategy

Do **not** hard-code architecture to a particular OpenAI model name.

Model selection should be configurable and benchmarked for:
- JP → EN semantic quality;
- JP → VI semantic quality;
- compact UI translation quality;
- latency;
- cost;
- structured response reliability.

---

## 7. Struct extraction strategy

“Struct” means the minimum page structure required to translate text correctly **and** preserve visual position.

### 7.1 Extract text, not arbitrary HTML

Default candidates:
- visible text nodes;
- links;
- headings;
- button text;
- labels;
- tabs;
- table headers/cells;
- placeholders and selected accessibility attributes when explicitly supported.

Default exclusions:
- `script`, `style`, `noscript`;
- code/preformatted blocks unless enabled;
- URLs;
- raw IDs/version strings;
- hidden/inert content;
- extension-owned tooltip nodes;
- user-entered editable values by default;
- elements matched by project exclusions.

### 7.2 Source object

Each candidate becomes a `TranslationAnchor`:

```ts
interface TranslationAnchor {
  id: string;
  sourceText: string;
  node: Text | Element;
  element: HTMLElement;
  componentType: ComponentType;
  context: TranslationContext;
  visualSnapshot: VisualSnapshot;
  policy: ComponentPolicy;
}
```

### 7.3 Visual snapshot

Capture before mutation:

```ts
interface VisualSnapshot {
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  lineCount?: number;
  typography: {
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    lineHeight: string;
    letterSpacing: string;
  };
  layout: {
    display: string;
    whiteSpace: string;
    overflow: string;
    textOverflow: string;
    maxWidth: string;
  };
  parentRect?: DOMRectLike;
  siblingRects?: DOMRectLike[];
}
```

### 7.4 Context extraction

Translation meaning can depend on context. Collect a bounded amount of:
- element tag/role;
- parent semantic role;
- nearby text;
- section heading;
- page title;
- selected class/id hints only where safe/useful;
- component type;
- available width/height and wrap policy.

Do not send the entire DOM to the model.

### 7.5 Component classification

Use layered classification:

1. Explicit project override.
2. Semantic HTML/ARIA role.
3. DOM/CSS heuristics.
4. Generic fallback (`paragraph`, `inline`, `unknown`).

Example classifications:
- `navigation`
- `button`
- `tab`
- `badge`
- `heading`
- `table-cell`
- `form-label`
- `card-description`
- `paragraph`
- `critical-message`

### 7.6 Batch extraction

Do not send one request per node.

Batch by:
- route/section;
- component neighborhood;
- target language;
- token/text limit;
- project rule;
- request latency budget.

Every item carries a stable ID so model responses map back to the correct anchor.

### 7.7 Dynamic extraction

Use `MutationObserver` to detect newly inserted/changed supported content.

Requirements:
- debounce mutation bursts;
- ignore mutations created by the extension itself;
- deduplicate already translated anchors;
- restore source tracking when application frameworks re-render nodes;
- re-run only the affected region where possible.

---

## 8. From Evidence to Graph

This section adapts the requested “Evidence to Graph” concept to the translation/layout domain.

### Evidence

The engine observes measurable evidence:

- DOM hierarchy;
- source text;
- semantic tag/role;
- computed CSS;
- bounding boxes;
- line count;
- parent/sibling geometry;
- project rules;
- route/URL;
- before/after geometry;
- overflow status;
- translation candidate used.

### Layout relationship graph

For harder layouts, the evidence can be represented conceptually as a **Layout Constraint Graph**.

**Nodes**
- translation anchor;
- parent container;
- important sibling;
- row/grid group;
- viewport.

**Edges**
- `contained_by`
- `shares_row_with`
- `aligned_with`
- `can_push`
- `depends_on_size_of`
- `overlay_of`

Example:

```text
[Logo] ──shares_row── [Title] ──can_push── [Navigation]
                         │
                    contained_by
                         │
                      [Header]
```

Before/after measurements are attached to graph nodes/edges to determine whether a translation caused meaningful displacement.

### MVP decision

Do **not** build a heavyweight graph engine first.

MVP can represent these relationships with lightweight parent/sibling snapshots. Promote this into an explicit graph only if POC data shows that causal layout reasoning is required for complex flex/grid cases.

---

## 9. Separate Discussed vs verified

Every significant spec item should use one of these statuses:

- **DECIDED** — product/architecture decision accepted for the current implementation.
- **VERIFIED** — confirmed by official documentation or technical experiment.
- **HYPOTHESIS** — reasonable technical assumption that requires a spike/test.
- **OPEN** — unresolved decision requiring product/security/engineering input.

### Current status table

| Item | Status | Notes |
|---|---|---|
| Output EN/VI | DECIDED | User-selectable |
| Source auto-detect | DECIDED | Japanese is primary focus |
| OpenAI translation | DECIDED | Backend mediated |
| Preserve visual anchor | DECIDED | Core product law |
| Zero layout shift guarantee | REJECTED | Not realistic for all web edge cases |
| Full → compact → clamp/tooltip fallback | DECIDED | Core rendering policy |
| Component-aware policies | DECIDED | Hard/medium/soft preserve |
| Generic engine + project adapters | DECIDED | Required for quality |
| SPA/dynamic translation | DECIDED | Core use case |
| Manifest V3 content scripts/service worker/storage model | VERIFIED | Chrome official docs |
| Site selectors/exclusions and URL-change rules are practical patterns | VERIFIED | Immersive Translate public docs |
| Multi-paragraph AI translation/batching is practical | VERIFIED | Immersive Translate prompt docs |
| Keep OpenAI API key out of extension code | VERIFIED | OpenAI production guidance |
| Exact acceptable layout tolerance | HYPOTHESIS | Calibrate in spike |
| Best DOM mutation strategy for React/Vue | HYPOTHESIS | Must test on real projects |
| Best EN/VI model | HYPOTHESIS | Benchmark |
| Persistent server-side translation cache | OPEN | Security/retention decision |
| Sending internal/PII page content to model | OPEN | Requires company policy/security approval |
| Ask Atlas behavior | OPEN | Not defined in current product requirements |

---

## 10. Roadmap

### Phase 0 — Research & technical spike

Goal: validate the hardest assumptions before freezing production implementation.

Build test fixtures for:
- flex header/navigation;
- buttons/tabs/badges;
- cards/grid;
- tables;
- form labels;
- modal/popover;
- long paragraphs;
- React/Vue-style re-render;
- SPA route changes;
- delayed web font loading;
- EN and VI.

Measure:
- anchor shift;
- sibling displacement;
- overflow;
- line changes;
- translation quality;
- retry frequency;
- latency.

### Phase 1 — Extension foundation

- WXT + TypeScript + MV3.
- Popup ON/OFF, EN/VI.
- Content script.
- Service worker.
- Extension state.
- Restore original.
- Backend skeleton.

### Phase 2 — Translation core

- DOM extraction.
- Component classification v1.
- Batched OpenAI translation.
- Structured response.
- Project glossary foundation.
- Original-text registry.

### Phase 3 — Visual-anchor engine

- Geometry snapshot.
- Hard/medium/soft component policy.
- Overflow detection.
- Full → compact fallback.
- Ellipsis/line-clamp + tooltip.
- Sibling displacement checks.

### Phase 4 — Dynamic application support

- MutationObserver.
- SPA route detection.
- Debounce/deduplication.
- Framework re-render recovery.
- Persist translation state within active tab/session.

### Phase 5 — Project adaptation & security

- Domain/project rules.
- include/exclude selectors.
- component overrides.
- terminology/glossary.
- sensitive-data masking.
- backend auth/rate limits.
- audit/observability policy.

### Phase 6 — Quality & scale

- translation/eval dataset;
- model benchmarking;
- cache strategy;
- visual regression suite;
- broader browser support if required;
- optional per-domain auto-translate.

---

## 11. CLI MVP

The CLI is **not an end-user product surface**. It is a developer/research harness used to validate translation and layout behavior before or alongside the extension.

### Purpose

- Run repeatable fixture tests.
- Capture before/after geometry.
- Inspect extracted anchors.
- Exercise backend translation without manually opening the popup.
- Generate machine-readable audit output for CI.

### Suggested commands

```bash
# inspect supported text and component classification
pnpm cli scan ./fixtures/header.html

# translate a fixture in Playwright
pnpm cli translate ./fixtures/header.html --to en
pnpm cli translate ./fixtures/header.html --to vi

# run geometry/layout audit
pnpm cli audit ./fixtures/header.html --to vi

# run the representative test suite
pnpm cli benchmark --suite ./fixtures/representative
```

### Example audit output

```json
{
  "criticalBreaks": 0,
  "anchors": 42,
  "withinTolerance": 40,
  "truncated": 2,
  "maxSiblingShiftPx": 3.2,
  "overflows": 0
}
```

### CLI MVP non-goal

Do not build a general-purpose website translation CLI for customers. The CLI exists to make the browser engine testable and reproducible.

---

## 12. Website MVP

“Website MVP” in this specification means the **browser-extension experience running against real company websites**.

### User surface

- Chrome/Edge first.
- Popup:
  - Translation ON/OFF.
  - EN/VI selector.
  - Restore original.
- Current page translates in-place.
- Route/menu changes continue translating automatically in the same tab.

### Supported content for MVP

- normal visible DOM text;
- headings;
- links/navigation;
- buttons;
- tabs;
- badges;
- table text;
- form labels;
- cards;
- paragraphs;
- dynamically inserted DOM text.

### Supported visual policies for MVP

1. Navigation.
2. Button.
3. Heading.
4. Card/description.
5. Table cell/header.
6. Paragraph.

Tabs/badges/form labels can reuse the closest policy initially.

### Required MVP fallback

```text
full translation
   → compact translation
      → constrained text
         → tooltip/popover full translation
```

### Not supported in MVP

- OCR/images;
- canvas/WebGL text;
- PDF;
- translation inside inaccessible cross-origin frames;
- automatic modification of application business logic;
- guaranteed perfect rendering for every third-party site.

---

## 13. Ask Atlas

**Status: OPEN / placeholder.**

“Ask Atlas” has not been defined in the translation-extension requirements discussed so far. It should **not be silently invented as an MVP feature**.

If “Atlas” is intended to become an internal developer assistant, the most useful future role would be **translation/layout diagnostics**, for example:

- “Why was this element truncated?”
- “Which component policy applied?”
- “What was the original Japanese text?”
- “Which compact translation candidate was selected?”
- “Which sibling moved after translation?”
- “Which project rule matched this element?”

Possible future diagnostic record:

```json
{
  "anchorId": "node-123",
  "source": "お問い合わせはこちら",
  "full": "Liên hệ với chúng tôi",
  "displayed": "Liên hệ...",
  "policy": "navigation",
  "fallback": "ellipsis-tooltip",
  "reason": "full_and_compact_overflow"
}
```

**Current decision:** do not include Ask Atlas in MVP implementation until its product meaning is explicitly defined.

---

## 14. Main Risk

### Risk 1 — “Preserve layout” becomes an impossible absolute promise

**Severity:** Critical  
**Mitigation:** define visual-anchor preservation plus measurable tolerance, not zero-pixel guarantee.

### Risk 2 — Japanese → EN/VI expansion breaks intrinsic flex/grid layouts

**Severity:** Critical  
**Mitigation:** component policies, compact translation, constrained region, sibling validation, project overrides.

### Risk 3 — Semantic shortening loses important meaning

**Severity:** Critical  
**Mitigation:** semantic-critical content classification; never silently truncate critical actions/messages; human/eval dataset.

### Risk 4 — React/Vue/framework re-render overwrites translated DOM

**Severity:** High  
**Mitigation:** preserve source registry, observe mutations, reapply idempotently, test real project frameworks.

### Risk 5 — Extension creates MutationObserver loops

**Severity:** High  
**Mitigation:** mark extension-owned mutations/nodes, suspend/ignore known writes, deduplicate anchors.

### Risk 6 — Font fallback changes geometry, especially VI

**Severity:** High  
**Mitigation:** wait for fonts where necessary, measure rendered pixels rather than characters, test Vietnamese glyph coverage, allow project font policy if approved.

### Risk 7 — Translation latency creates flicker or partially translated UI

**Severity:** High  
**Mitigation:** batch requests, cache safe results, translate viewport/priority UI first if needed, avoid blanking source before response.

### Risk 8 — Internal/confidential data is sent externally

**Severity:** Critical  
**Mitigation:** company backend, domain allowlist, explicit security approval, sensitive-data masking, no persistent raw-content logs by default.

### Risk 9 — Generic rules fail on project-specific markup

**Severity:** High  
**Mitigation:** generic engine + project adapters and selector overrides.

### Risk 10 — Tooltip is inaccessible on keyboard/touch

**Severity:** Medium  
**Mitigation:** support focus/click/popover behavior, not hover only.

### Risk 11 — Overengineering an explicit layout graph too early

**Severity:** Medium  
**Mitigation:** start with lightweight snapshots/relationships; promote to graph only when evidence demands it.

---

## 15. Research

### 15.1 Chrome Extensions

Verified from official Chrome documentation:

- Manifest V3 is the current extension platform model.
- Content scripts are the page-facing context for reading/interacting with DOM content.
- Background logic uses an extension service worker in MV3.
- Service-worker lifecycle means durable state should not depend on process memory.
- `chrome.storage` is available for extension state.
- Permissions/host access should be declared deliberately and minimized.
- Messages from content scripts should be treated as less trusted and validated.

References:
- https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3
- https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- https://developer.chrome.com/docs/extensions/reference/api/storage
- https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions

### 15.2 WXT

Verified from WXT documentation:

- WXT is designed for browser-extension development and generates the manifest from configuration/entrypoints.
- TypeScript and a structured entrypoint model fit this project well.
- WXT provides storage integration while retaining access to standard browser APIs.

References:
- https://wxt.dev/
- https://wxt.dev/guide/essentials/config/manifest
- https://wxt.dev/storage

### 15.3 OpenAI

Verified from official OpenAI documentation:

- Responses API is a current primary API surface for model responses.
- Structured Outputs can enforce a schema for translation responses.
- Production guidance explicitly recommends keeping API keys secure and not exposing them in code/public repositories.
- Caching and rate/cost controls should be considered for production systems.

References:
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/production-best-practices
- https://developers.openai.com/api/docs/guides/text-generation

### 15.4 Immersive Translate benchmark

Useful verified patterns from public Immersive Translate documentation:

1. **Main-content vs whole-page behavior**  
   Their default strategy avoids some navigation/header/special content because translating those areas can affect aesthetics/functionality. This reinforces that our stricter requirement—translate UI while preserving its anchor—requires an explicit layout engine.

2. **Site adaptation**  
   Public docs expose `selectors`, `excludeSelectors`, site matching, style overrides and inheritance/add-remove patterns. This validates the need for a generic engine plus project/site adapters.

3. **Dynamic URL observation**  
   Public advanced configuration includes URL-change observation/delay concepts, supporting our SPA auto-translation direction.

4. **Multi-paragraph AI translation**  
   Their prompt documentation describes multi-paragraph translation, reinforcing batched rather than one-node-per-request translation.

5. **Different objective from this product**  
   Immersive Translate often optimizes reading and can expand/unclamp content. Our product instead prioritizes spatial correspondence and constrains UI translation when necessary.

References:
- https://immersivetranslate.com/docs/faq/
- https://immersivetranslate.com/docs/advanced/
- https://immersivetranslate.com/docs/prompts/

### 15.5 Required technical spike

Research is not complete until these are tested in code:

- React/Next/Vue DOM re-render behavior.
- MutationObserver loop avoidance.
- Flex/grid/intrinsic-size header behavior.
- `fit-content` and `space-between` displacement.
- Web font loading and Vietnamese fallback metrics.
- Best measurement point/timing.
- Full vs compact translation success rate.
- Batch size vs latency/quality.
- Visual tolerance calibration.
- Tooltip/focus behavior on real components.

---

## 16. Decisions & open questions

### Decisions

1. **Primary source focus:** Japanese websites.
2. **Output languages:** EN and VI, user selectable.
3. **Source detection:** automatic.
4. **Translation provider:** OpenAI via company backend.
5. **Core objective:** semantic translation + visual-anchor preservation.
6. **No universal zero-shift guarantee.**
7. **Full translation is attempted first.**
8. **Compact semantic translation is the first fallback.**
9. **Ellipsis/line-clamp + full tooltip/popover is an official fallback.**
10. **Component policies are required.**
11. **Hard-preserve compact UI; soft-preserve long-form content.**
12. **Do not modify structural CSS by default.**
13. **Do not use aggressive font shrinking or horizontal scaling as primary solutions.**
14. **Original source text must be retained.**
15. **Language switching always uses original source.**
16. **SPA/dynamic content must auto-translate while translation remains active.**
17. **Generic engine + optional site/project adapter.**
18. **OpenAI key must not live in the extension bundle.**
19. **WXT + TypeScript + Manifest V3 is the recommended extension stack.**
20. **React is for extension UI, not translated-page DOM management.**
21. **Native DOM measurement APIs drive layout validation.**
22. **Batch translation is preferred over one request per node.**
23. **Heavyweight Layout Constraint Graph is deferred until evidence requires it.**
24. **Ask Atlas is not part of current MVP until defined.**

### Open questions that do not block the requirement definition

These should be resolved by technical spike or company policy, not by more product brainstorming.

#### OQ-01 — Exact visual tolerance

Provisional POC target:
- zero critical overlap/broken-component cases;
- hard-preserve anchor/sibling shift target around `≤ 3–5 px` for representative desktop fixtures;
- no unexpected horizontal page overflow;
- no forbidden line-count increase;
- full text accessible whenever constrained.

The exact threshold must be calibrated against real company pages.

#### OQ-02 — Security/data approval

- Which internal domains are allowed?
- Which content may be sent to OpenAI?
- Is PII masking mandatory before all requests?
- Is persistent backend caching allowed?

#### OQ-03 — Exact OpenAI model

Choose through benchmark; keep configurable.

#### OQ-04 — Browser targets

MVP recommendation: Chrome/Edge Chromium. Firefox/Safari later unless business requirements require them earlier.

#### OQ-05 — Domain persistence behavior

MVP recommendation: translation stays active in the same tab/session; “always translate this domain” is optional later.

#### OQ-06 — Ask Atlas

Requires a separate definition if it is intended to be a product feature rather than a spec-template heading.

---

## 17. Current MVP Definition

### MVP objective

Prove that Japanese company web applications can be translated into **EN or VI in-place** with materially better visual stability than naïve text replacement, especially for compact UI components.

### MVP user flow

```text
1. User opens a supported Japanese website.
2. User opens extension.
3. Input source is auto-detected.
4. User selects EN or VI.
5. User turns Translation ON.
6. Extension translates visible supported content.
7. Full translation is rendered when it fits.
8. Compact translation is used when full text does not fit.
9. If compact text still does not fit, the original visual region is preserved,
   text is constrained, and full translation is available via tooltip/popover.
10. User clicks another menu/SPA route.
11. New content is translated automatically.
12. User can switch EN/VI or restore Japanese.
```

### MVP component coverage

Must prove at least:
- header/navigation;
- button;
- heading;
- card/grid;
- table;
- paragraph;
- SPA dynamic content.

### MVP architecture

```text
WXT + TypeScript + Manifest V3
        │
        ├── React popup
        ├── Content script
        │     ├── extraction
        │     ├── component classification
        │     ├── visual snapshot
        │     ├── render/measure
        │     ├── overflow fallback
        │     └── MutationObserver
        │
        ├── Service worker
        └── extension storage
                │
                ▼
        Node.js/TypeScript backend
                │
                ▼
             OpenAI
```

### MVP success criteria

#### Functional

- User can select EN/VI.
- Translation ON/OFF works.
- Original Japanese can be restored.
- Same-tab SPA navigation continues translating automatically.
- No manual re-activation per menu/page.

#### Translation

- Representative UI strings preserve intended meaning.
- Compact variants remain semantically acceptable.
- Critical messages are never silently reduced into ambiguous text.

#### Visual

- No critical overlap in the representative test suite.
- No unexpected page-level horizontal overflow caused by translation.
- Compact UI remains spatially associated with the original Japanese anchor.
- Hard-preserve components do not materially displace important siblings.
- Truncated items expose the complete translation.

#### Engineering

- OpenAI key is not shipped in the extension.
- Translation requests are batched.
- Extension-owned DOM mutations do not create an infinite observer loop.
- State survives service-worker lifecycle behavior appropriately.
- Layout behavior is covered by repeatable Playwright fixtures/tests.

### MVP non-goals

- Perfect translation/layout for every website on the internet.
- OCR/image translation.
- Canvas/WebGL translation.
- PDF translation.
- Full multilingual output beyond EN/VI.
- End-user CLI.
- Ask Atlas.
- Automatic global CSS repair.
- Guaranteed zero-pixel layout displacement.

### MVP technical-spike exit gate

Do not claim the MVP architecture validated until the spike demonstrates:

1. Header/navigation translation with stable siblings.
2. VI expansion fallback works without breaking the component.
3. Table cells stay constrained.
4. Card/grid remains visually coherent.
5. React/Vue-style dynamic re-render can be handled idempotently.
6. SPA route changes auto-translate.
7. Full → compact → tooltip fallback works deterministically.
8. Geometry metrics and screenshots can be reproduced in automated tests.

---

## Final product statement

> **A context-aware browser translation extension that converts Japanese web applications to English or Vietnamese while preserving the spatial relationship between translated content and the original UI. It minimizes layout displacement through component-aware translation, visual measurement, semantic shortening, and constrained rendering; when full translated content cannot fit safely, the translation remains anchored in-place and the full meaning stays accessible through tooltip/popover.**
