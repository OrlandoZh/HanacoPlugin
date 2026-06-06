# Implementation Notes

## Reference Engine Summary

The reference plugin implements a force-directed layout in plain browser JavaScript.

Core constants:

```js
const PHYS = {
  MIN_DIST: 28,
  SETTLE_VEL: 0.04,
  DRAG_DAMPING_OFFSET: 0.16,
  TIME_STEP: 1,
};
```

Forces:

- center force: `(center - node) * centerK`
- pairwise repulsion: `repulsionK / distance^2`
- edge spring: `springK * (distance - restLength)`
- optional same-tag cluster attraction
- boundary bounce with `boundaryK`

Interaction:

- mousedown/touchstart on node starts drag
- pointer position is converted into graph-stage coordinates
- dragged node snaps to pointer and wakes simulation
- mouseup/touchend releases node

## Adaptation For LLM Wiki

### Node Shape

Reference node:

```js
{
  x, y, vx, vy,
  weight,
  entry,
  el
}
```

Suggested wiki node:

```js
{
  id,
  x, y, vx, vy,
  weight,
  type,
  community,
  el
}
```

### Edge Shape

Reference edge:

```js
{ a, b, line }
```

Suggested wiki edge:

```js
{
  sourceId,
  targetId,
  sourceIndex,
  targetIndex,
  edge,
  pathEl
}
```

Use paths instead of lines, because current graph uses curved confidence-styled SVG paths.

### Position Units

The reference uses pixels internally and writes percentage back to DOM.

Keep that approach:

1. Convert atlas `x/y` percent to simulation pixels.
2. Simulate in pixels.
3. Write node `left/top` as percent.
4. Rebuild SVG paths using percent-space or normalized atlas-space consistently.

## Suggested Files

In the LLM Wiki graph template set:

```text
templates/graph-styles/wash/graph-physics.js
templates/graph-styles/wash/graph-wash.js
templates/graph-styles/wash/header.html
```

In plugin route rewriting:

```text
routes/viewer.js
```

Make sure `build-graph-html.sh` copies `graph-physics.js` next to `graph-wash.js`.

## Minimal API Sketch

```js
window.WikiGraphPhysics = {
  createPhysicsLayout(options) {
    return {
      start(),
      stop(),
      relinkDom(),
      updateVisible(visible),
      updateConfig(config),
      getPoint(nodeId),
      isDragging()
    };
  }
};
```

Options should include:

- `atlas`
- `nodeLayer`
- `edgeLayer`
- `getVisible`
- `getNodeById`
- `makePath`
- `onNodeClick`
- `onHover`
- `onLeave`

## Acceptance Checks

- Atlas layout still works by default.
- Physics mode renders with no blank canvas.
- Dragging a node moves connected edges.
- Releasing a node does not accidentally open source.
- Search/filter/community changes rebuild or relink the simulation safely.
- Source button still opens Markdown through `/wiki-file/...`.
- Large graphs fall back to atlas layout.
- Static `knowledge-graph.html` still works when opened locally.
