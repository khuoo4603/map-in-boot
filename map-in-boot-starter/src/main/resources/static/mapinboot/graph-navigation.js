(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const NODE_WIDTH = 220;
  const NODE_HEIGHT = 82;
  const MIN_ZOOM = 0.2;
  const MAX_ZOOM = 2.5;
  const DEFAULT_CANVAS = { width: 960, height: 540 };

  function finite(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function graphBounds(nodes, positions, fallback) {
    const values = (nodes || [])
      .map((node) => positions && positions[node.id])
      .filter((position) => position && finite(position.x, null) !== null && finite(position.y, null) !== null);
    if (values.length === 0) return fallback || { x: 0, y: 0, width: 640, height: 360 };
    let left = values[0].x;
    let top = values[0].y;
    let right = values[0].x + NODE_WIDTH;
    let bottom = values[0].y + NODE_HEIGHT;
    values.slice(1).forEach((position) => {
      left = Math.min(left, position.x);
      top = Math.min(top, position.y);
      right = Math.max(right, position.x + NODE_WIDTH);
      bottom = Math.max(bottom, position.y + NODE_HEIGHT);
    });
    return { x: left, y: top, width: Math.max(NODE_WIDTH, right - left), height: Math.max(NODE_HEIGHT, bottom - top) };
  }

  function normalizedBounds(bounds, fallback) {
    if (!bounds) return fallback;
    return {
      x: finite(bounds.x, 0),
      y: finite(bounds.y, 0),
      width: Math.max(1, finite(bounds.width, fallback.width)),
      height: Math.max(1, finite(bounds.height, fallback.height))
    };
  }

  function canvasSize(svg) {
    const rect = svg && typeof svg.getBoundingClientRect === "function" ? svg.getBoundingClientRect() : null;
    return {
      width: Math.max(1, finite(svg && svg.clientWidth, finite(rect && rect.width, DEFAULT_CANVAS.width))),
      height: Math.max(1, finite(svg && svg.clientHeight, finite(rect && rect.height, DEFAULT_CANVAS.height)))
    };
  }

  function create(options) {
    const svg = options.svg;
    const viewport = options.viewport;
    const surface = options.surface || svg;
    const minimap = options.minimap;
    const minimapSvg = options.minimapSvg;
    const minimapNodes = options.minimapNodes;
    const minimapViewport = options.minimapViewport;
    const state = {
      zoom: 1,
      panX: 0,
      panY: 0,
      canvasWidth: DEFAULT_CANVAS.width,
      canvasHeight: DEFAULT_CANVAS.height,
      graph: null,
      positions: {},
      graphBounds: null,
      visibleBounds: null,
      dragging: false
    };
    let pointer = null;
    let minimapGraph = null;
    let minimapPositions = null;

    function currentPoint(event) {
      const rect = svg && typeof svg.getBoundingClientRect === "function"
        ? svg.getBoundingClientRect()
        : { left: 0, top: 0 };
      return {
        x: finite(event && event.clientX, finite(event && event.offsetX, 0)) - finite(rect.left, 0),
        y: finite(event && event.clientY, finite(event && event.offsetY, 0)) - finite(rect.top, 0)
      };
    }

    function nodeTarget(target) {
      if (!target) return false;
      if (typeof target.closest === "function" && (target.closest(".graph-node") || target.closest(".graph-minimap"))) return true;
      const className = typeof target.getAttribute === "function" ? target.getAttribute("class") : "";
      return typeof className === "string" && className.split(/\s+/).some((name) => name === "graph-node" || name === "graph-minimap");
    }

    function updateMiniMap() {
      if (!minimap || !minimapSvg || !minimapNodes || !minimapViewport || !state.graph || state.graph.nodes.length === 0) {
        if (minimap) minimap.hidden = true;
        minimapGraph = null;
        minimapPositions = null;
        return;
      }
      const bounds = normalizedBounds(state.graphBounds, graphBounds(state.graph.nodes, state.positions));
      minimap.hidden = false;
      minimapSvg.setAttribute("viewBox", `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
      if (state.graph !== minimapGraph || state.positions !== minimapPositions) {
        minimapNodes.replaceChildren();
        state.graph.nodes.forEach((node) => {
          const position = state.positions[node.id];
          if (!position) return;
          const rect = document.createElementNS(SVG_NS, "rect");
          rect.setAttribute("class", "graph-minimap-node");
          rect.setAttribute("data-node-id", node.id);
          rect.setAttribute("x", String(position.x));
          rect.setAttribute("y", String(position.y));
          rect.setAttribute("width", String(NODE_WIDTH));
          rect.setAttribute("height", String(NODE_HEIGHT));
          rect.setAttribute("rx", "4");
          rect.setAttribute("fill", "#4ade80");
          minimapNodes.appendChild(rect);
        });
        minimapGraph = state.graph;
        minimapPositions = state.positions;
      }
      minimapViewport.setAttribute("x", String(-state.panX / state.zoom));
      minimapViewport.setAttribute("y", String(-state.panY / state.zoom));
      minimapViewport.setAttribute("width", String(state.canvasWidth / state.zoom));
      minimapViewport.setAttribute("height", String(state.canvasHeight / state.zoom));
    }

    function apply() {
      const size = canvasSize(svg);
      state.canvasWidth = size.width;
      state.canvasHeight = size.height;
      svg.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
      viewport.setAttribute("transform", `translate(${state.panX} ${state.panY}) scale(${state.zoom})`);
      svg.setAttribute("data-zoom", String(state.zoom));
      svg.setAttribute("data-pan-x", String(state.panX));
      svg.setAttribute("data-pan-y", String(state.panY));
      updateMiniMap();
      return state;
    }

    function setGraph(graph, positions, bounds) {
      state.graph = graph || null;
      state.positions = positions || {};
      state.graphBounds = state.graph
        ? normalizedBounds(bounds, graphBounds(state.graph.nodes, state.positions))
        : null;
      state.visibleBounds = state.graph
        ? graphBounds(state.graph.nodes, state.positions, state.graphBounds)
        : null;
      return apply();
    }

    function zoomAt(nextZoom, x, y) {
      const pointX = finite(x, state.canvasWidth / 2);
      const pointY = finite(y, state.canvasHeight / 2);
      const clamped = clamp(finite(nextZoom, state.zoom), MIN_ZOOM, MAX_ZOOM);
      const graphX = (pointX - state.panX) / state.zoom;
      const graphY = (pointY - state.panY) / state.zoom;
      state.zoom = clamped;
      state.panX = pointX - graphX * state.zoom;
      state.panY = pointY - graphY * state.zoom;
      return apply();
    }

    function zoomBy(factor, x, y) {
      return zoomAt(state.zoom * factor, x, y);
    }

    function fit() {
      if (!state.visibleBounds) return apply();
      const padding = 32;
      const availableWidth = Math.max(1, state.canvasWidth - padding * 2);
      const availableHeight = Math.max(1, state.canvasHeight - padding * 2);
      state.zoom = clamp(Math.min(
        availableWidth / state.visibleBounds.width,
        availableHeight / state.visibleBounds.height
      ), MIN_ZOOM, MAX_ZOOM);
      state.panX = (state.canvasWidth - state.visibleBounds.width * state.zoom) / 2 - state.visibleBounds.x * state.zoom;
      state.panY = (state.canvasHeight - state.visibleBounds.height * state.zoom) / 2 - state.visibleBounds.y * state.zoom;
      return apply();
    }

    function reset() {
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      return apply();
    }

    function panBy(deltaX, deltaY) {
      state.panX += finite(deltaX, 0);
      state.panY += finite(deltaY, 0);
      return apply();
    }

    function focusNode(nodeId) {
      const position = state.positions[nodeId];
      if (!position) return apply();
      state.panX = state.canvasWidth / 2 - (position.x + NODE_WIDTH / 2) * state.zoom;
      state.panY = state.canvasHeight / 2 - (position.y + NODE_HEIGHT / 2) * state.zoom;
      return apply();
    }

    surface.addEventListener("pointerdown", (event) => {
      if (nodeTarget(event.target)) return;
      const point = currentPoint(event);
      pointer = { x: point.x, y: point.y };
      state.dragging = true;
      if (typeof surface.setPointerCapture === "function" && event.pointerId !== undefined) {
        surface.setPointerCapture(event.pointerId);
      }
      if (typeof event.preventDefault === "function") event.preventDefault();
    });
    surface.addEventListener("pointermove", (event) => {
      if (!pointer) return;
      const point = currentPoint(event);
      panBy(point.x - pointer.x, point.y - pointer.y);
      pointer = point;
      if (typeof event.preventDefault === "function") event.preventDefault();
    });
    const finishPan = (event) => {
      pointer = null;
      state.dragging = false;
      if (typeof surface.releasePointerCapture === "function" && event && event.pointerId !== undefined) {
        surface.releasePointerCapture(event.pointerId);
      }
    };
    surface.addEventListener("pointerup", finishPan);
    surface.addEventListener("pointercancel", finishPan);
    svg.addEventListener("wheel", (event) => {
      if (typeof event.preventDefault === "function") event.preventDefault();
      const point = currentPoint(event);
      zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15, point.x, point.y);
    }, { passive: false });
    if (options.zoomIn) options.zoomIn.addEventListener("click", () => zoomBy(1.2));
    if (options.zoomOut) options.zoomOut.addEventListener("click", () => zoomBy(1 / 1.2));
    if (options.fit) options.fit.addEventListener("click", fit);
    if (options.reset) options.reset.addEventListener("click", reset);
    if (typeof window.addEventListener === "function") window.addEventListener("resize", apply);

    return {
      state,
      setGraph,
      apply,
      fit,
      reset,
      panBy,
      focusNode,
      zoomAt,
      zoomBy
    };
  }

  window.MapInBootNavigation = {
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    boundsFor: graphBounds,
    create
  };
})();
