/*
 * Hana Code Atlas Viewer overlay
 *
 * Adds a restrained pixel-farm treatment to stable UA controls without
 * changing the locked Viewer bundle or its React state. Icon paths come from
 * Pixelarticons by Gerrit Halfmann (MIT), retrieved through Iconify.
 */
(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const ICONS = {
    overview: "M4 20h16v2H4zm16-10h2v10h-2zM2 10h2v10H2zm2-2h2v2H4zm2-2h2v2H6zm2-2h2v2H8zm2-2h4v2h-4zm4 2h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zM8 14h2v6H8zm2-2h4v2h-4zm4 2h2v6h-2z",
    learn: "M2 3h9v2H2zM0 19h11v2H0zM13 3h9v2h-9zm0 16h11v2H13zM11 5h2v18h-2zM0 5h2v14H0zm22 0h2v14h-2zm-7 2h5v2h-5zm0 4h5v2h-5zm0 4h2v2h-2z",
    deep: "M4 2h16v2H4zm0 18h16v2H4zM2 4h2v16H2zm18 0h2v16h-2zM7 11h2v6H7zm4-4h2v10h-2zm4 6h2v4h-2z",
    files: "M4 4h6v2H4zm0 14h16v2H4zM20 8h2v10h-2zM2 6h2v12H2zm8 0h10v2H10z",
    classes: "M8 5h2v2H8zM6 7h2v2H6zM4 9h2v2H4zm-2 2h2v2H2zm2 2h2v2H4zm2 2h2v2H6zm2 2h2v2H8zm8-12h-2v2h2zm2 2h-2v2h2zm2 2h-2v2h2zm2 2h-2v2h2zm-2 2h-2v2h2zm-2 2h-2v2h2zm-2 2h-2v2h2z",
    path: "M6 2h10v2H6zM4 4h2v2H4zm14 0h-2v2h2zM6 17h2v2H6zm2 2h2v2H8zm2 2h2v2h-2zm-6-7h2v3H4zM2 6h2v8H2zm18 0h-2v3h2zM9 6h4v2H9zM7 8h2v4H7zm2 4h4v2H9zm4-4h2v4h-2zm3 5h2v2h-2zm-2 2h2v6h-2zm8 0h2v6h-2zm-4-4h2v2h-2zm2 2h2v2h-2zm-4 6h6v2h-6zm2-2h2v2h-2z",
  };

  const TITLE_TARGETS = new Map([
    ["高层次架构视图", { icon: "overview", group: "persona" }],
    ["完整仪表盘与导览学习", { icon: "learn", group: "persona" }],
    ["代码聚焦与对话", { icon: "deep", group: "persona" }],
    ["仅文件 — 架构级依赖（快速）", { icon: "files", group: "detail" }],
    ["文件 + 类 — 代码结构及继承关系", { icon: "classes", group: "detail" }],
    ["查找节点间路径 (P)", { icon: "path", group: "action" }],
  ]);

  const EXACT_TEXT = new Map([
    ["Dependency Path Finder", "依赖路径查找"],
    ["Find the shortest path between two nodes in the dependency graph.", "查找依赖图中两个节点之间的最短路径。"],
    ["From Node", "起点节点"],
    ["To Node", "终点节点"],
    ["Select a node...", "选择节点…"],
    ["Find Path", "查找路径"],
    ["Searching...", "正在查找…"],
    ["No path found between these nodes.", "未找到这两个节点之间的路径。"],
    ["Diff OFF", "差异 关"],
    ["Diff ON", "差异 开"],
  ]);

  function createIcon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.classList.add("hca-pixel-icon");
    svg.dataset.icon = name;

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", ICONS[name]);
    svg.append(path);
    return svg;
  }

  function decorateButton(button, target) {
    if (!(button instanceof HTMLButtonElement)) return;

    button.dataset.hcaIcon = target.icon;
    button.classList.add("hca-farm-button");
    if (!button.querySelector(":scope > .hca-pixel-icon")) {
      button.prepend(createIcon(target.icon));
    }

    if (target.group === "action") {
      button.classList.add("hca-farm-action");
    } else {
      button.parentElement?.classList.add("hca-farm-toolbar", `hca-farm-toolbar--${target.group}`);
    }
  }

  function decorateSidebarButtons() {
    const sidebar = document.querySelector("aside");
    if (!sidebar) return;
    for (const button of sidebar.querySelectorAll("button")) {
      const label = button.textContent?.trim();
      if (label === "文件") decorateButton(button, { icon: "files", group: "sidebar" });
    }
  }

  function translateExactText() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const raw = node.nodeValue || "";
      const trimmed = raw.trim();
      const translated = EXACT_TEXT.get(trimmed);
      if (translated) node.nodeValue = raw.replace(trimmed, translated);
      if (/^Path Found \(\d+ nodes\)$/.test(trimmed)) {
        node.nodeValue = raw.replace(trimmed, trimmed.replace(/^Path Found/, "已找到路径").replace(/nodes\)$/, "个节点)"));
      }
    }
  }

  function translateControlTitles() {
    for (const button of document.querySelectorAll("button[title]")) {
      const title = button.getAttribute("title") || "";
      if (title === "Filter graph (F)") button.title = "筛选图谱 (F)";
      if (/^Hide .+ nodes$/.test(title)) button.title = title.replace(/^Hide /, "隐藏 ").replace(/ nodes$/, " 节点");
      if (/^Show .+ nodes$/.test(title)) button.title = title.replace(/^Show /, "显示 ").replace(/ nodes$/, " 节点");
    }

    const pathHeading = [...document.querySelectorAll("h2")].find((heading) => heading.textContent?.trim() === "依赖路径查找");
    const closeButton = pathHeading?.parentElement?.parentElement?.querySelector("button");
    if (closeButton instanceof HTMLButtonElement && !closeButton.textContent?.trim()) {
      closeButton.title = "关闭";
      closeButton.setAttribute("aria-label", "关闭依赖路径查找");
    }
  }

  function decorate() {
    document.documentElement.lang = "zh-CN";
    translateExactText();
    translateControlTitles();
    for (const button of document.querySelectorAll("button[title]")) {
      const target = TITLE_TARGETS.get(button.getAttribute("title") || "");
      if (target) decorateButton(button, target);
    }
    decorateSidebarButtons();
  }

  let scheduled = false;
  function scheduleDecorate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      decorate();
    });
  }

  const observer = new MutationObserver((records) => {
    scheduleDecorate();
    if (records.some((record) => record.type === "childList" && record.addedNodes.length > 0)) {
      setTimeout(decorate, 50);
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "title"],
  });
  document.addEventListener("click", () => {
    scheduleDecorate();
    for (const delay of [50, 250, 750]) setTimeout(decorate, delay);
  }, true);
  scheduleDecorate();
})();
