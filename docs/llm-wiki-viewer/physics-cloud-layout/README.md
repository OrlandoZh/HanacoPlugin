# LLM Wiki Viewer Physics Cloud Layout Upgrade Plan

## Goal

Add an optional physics-driven graph layout to `llm-wiki-viewer`, using the idea-cloud reference plugin as an implementation reference.

The upgrade should preserve the current LLM Wiki viewer features:

- source opening through Hana routes
- right-side reading drawer
- community filtering
- search
- confidence filters
- minimap and viewport controls
- learning queue
- generated static HTML compatibility

The physics layout is an additional viewing mode, not a replacement for the current wash atlas layout.

## Reference

Reference plugin copied here:

```text
plugins/llm-wiki-viewer/reference/idea-cloud-physics/
```

Useful reference files:

- `reference/idea-cloud-physics/assets/app.js`
  - `buildGraph()`
  - `initPhysicsIfNeeded()`
  - `physicsTick()`
  - `applyPhysicsToDOM()`
  - drag handlers
- `reference/idea-cloud-physics/assets/styles.css`
  - `.graph-panel`
  - `.graph-stage`
  - `.graph-lines`
  - `.graph-node`
- `reference/idea-cloud-physics/lib/rating.js`
  - useful only as a scoring reference, not directly needed for wiki graph layout

## What To Reuse

Reuse the physics ideas, not the Draft business logic.

Good candidates:

- O(n^2) pairwise repulsion for small and medium graphs
- spring attraction along real graph edges
- center force
- boundary bounce
- velocity damping
- max velocity cap
- drag-to-pointer behavior
- drag wake-up when simulation settles
- optional cluster force, adapted from tags to LLM Wiki `community`

Do not reuse:

- Draft heatmap logic
- `capture-ideas` / `evaluate-ideas`
- idea storage APIs
- nearest-neighbor fake edge generation
- Draft settings page structure

## Current Viewer Architecture

Current graph runtime lives in the upstream LLM Wiki templates mirrored by this plugin:

```text
~/.hanako/skills/obsidian-wiki-manager/references/llm-wiki/templates/graph-styles/wash/
```

Key files:

- `graph-wash.js`: runtime rendering, selection, drawer, queue, viewport
- `graph-wash-helpers.js`: data normalization, static atlas layout, visible snapshot, viewport helpers
- `header.html`: graph shell and controls

The current layout is static:

- `deriveAtlasLayout()` assigns percentage coordinates by community rings
- `renderCanvas()` writes `node.style.left/top`
- edges are SVG paths derived from `atlasNodePoint(node)`
- viewport pan/zoom is applied through layer transforms

The upgrade should attach physics after `visible.nodes` and `visible.edges` are resolved.

## Proposed Design

### Layout Modes

Add a layout mode state:

```js
state.ui.layoutMode = "atlas"; // "atlas" | "physics"
```

The default remains `atlas`.

Add a compact toolbar control:

```text
布局: 舆图 / 点云
```

### Physics Activation Rules

Enable physics only when:

- `layoutMode === "physics"`
- visible node count is at most 200 by default
- data mode is `normal`
- graph is not empty

Fallback to atlas when:

- visible node count is too large
- user selects overview density mode with very large graphs
- browser cannot run animation smoothly

Recommended thresholds:

```js
const PHYSICS_NODE_LIMIT = 200;
const PHYSICS_EDGE_LIMIT = 800;
```

### Data Mapping

Input:

- `visible.nodes`
- `visible.edges`

Initial node positions:

- use current atlas `node.x` / `node.y` as the seed
- convert percentage coordinates to pixels using atlas viewport dimensions

Edges:

- use existing LLM Wiki edges only
- do not synthesize nearest-neighbor edges

Community clustering:

- adapt the reference `clusterK` force
- attract nodes sharing the same `community`
- optional extra attraction for `type === "topic"` and its connected source/entity nodes

### DOM Strategy

Keep current DOM:

- `.node` buttons remain the clickable units
- `edgeLayer` remains SVG
- drawer behavior remains unchanged

Change only position update:

- atlas mode: render static coordinates
- physics mode: render seed coordinates, then simulation updates `left/top`

For edges, keep current curved path style but recompute path from simulated node positions.

### Persistence

Optional but recommended:

- store user-adjusted node positions in `localStorage`
- namespace by wiki title/path and visible filter scope
- key shape:

```text
<storageNamespace>:physicsPositions:<scopeHash>
```

This lets manual drag layout survive refresh without editing wiki files.

## Implementation Phases

### Phase 1: Extract Physics Runtime

Create a small runtime module inside the graph template set:

```text
graph-physics.js
```

Responsibilities:

- build simulation nodes from visible graph
- run tick loop
- expose `start()`, `stop()`, `relinkDom()`, `updateConfig()`
- support mouse and touch drag

Keep it independent from Draft plugin code.

### Phase 2: Add Viewer Integration

Modify `graph-wash.js`:

- add `layoutMode` to UI state
- stop physics when leaving graph or changing layout mode
- call physics start after `renderCanvas()` when mode is `physics`
- pause or stop physics during major filter/search/community changes
- preserve `selectNode()`, `highlightNeighborhood()`, and drawer actions

### Phase 3: Edge Path Recompute

Add a node-position accessor:

```js
function getRenderedNodePoint(nodeId)
```

In atlas mode, return existing `atlasNodePoint(node)`.

In physics mode, return simulated pixel or normalized coordinates.

Update `makePath()` or add `makeRenderedPath()` so SVG edges follow dragged nodes.

### Phase 4: Controls And Safety

Add UI:

- layout toggle
- "settle" or "reheat" button if useful
- optional reduced-motion guard

Safety:

- disable physics above node/edge thresholds
- if physics disabled by threshold, show a small note in the canvas subtitle
- respect `prefers-reduced-motion`

### Phase 5: Optional Position Persistence

Persist positions only after drag end or after the simulation settles.

Do not write positions back to `graph-data.json`.

## Risks

- O(n^2) repulsion can become expensive on large graphs.
- Existing minimap expects static atlas coordinates; physics mode needs either live minimap updates or a simple fallback.
- Current curved path rendering uses normalized atlas coordinates; physics mode needs careful coordinate conversion under pan/zoom.
- Node drag should not accidentally trigger `selectNode()` or source opening; keep the reference plugin's `dragMoved` guard.
- Generated static HTML should still work without Hana server.

## Recommended First PR Scope

Keep the first implementation narrow:

- add `graph-physics.js`
- add a layout toggle
- support visible graphs up to 120 nodes
- support drag and live edge updates
- do not persist positions yet
- leave minimap in atlas mode or update it from live positions only if simple

This makes the change useful while keeping rollback easy.
