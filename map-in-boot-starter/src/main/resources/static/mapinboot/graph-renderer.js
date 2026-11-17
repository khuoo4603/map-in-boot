(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const NODE_WIDTH = 220;
  const NODE_HEIGHT = 82;
  const NODE_GAP_X = 280;
  const NODE_GAP_Y = 112;
  const NODE_PADDING = 32;
  const NODE_TYPES = Object.freeze([
    "APPLICATION", "SERVLET", "ENDPOINT", "HANDLER", "SECURITY_CHAIN",
    "FILTER", "AUTHENTICATION", "AUTHORIZATION", "SECURITY_DATA", "BUSINESS_SECURITY_STATE"
  ]);
  const EDGE_TYPES = Object.freeze([
    "FLOWS_TO", "MATCHED_BY", "FILTERED_BY", "SECURED_BY", "READS_SECURITY_DATA",
    "WRITES_SECURITY_DATA", "CONVERTS_TO_AUTHORITY", "USES_FOR_AUTHORIZATION", "SECURITY_STATE"
  ]);
  const nodeTypeNames = {
    APPLICATION: "애플리케이션",
    SERVLET: "Servlet",
    ENDPOINT: "Endpoint",
    HANDLER: "Handler",
    SECURITY_CHAIN: "Security Chain",
    FILTER: "Filter",
    AUTHENTICATION: "Authentication",
    AUTHORIZATION: "Authorization",
    SECURITY_DATA: "Security Data",
    BUSINESS_SECURITY_STATE: "Business Security State"
  };
  const nodeStyles = {
    APPLICATION: "#4ade80",
    SERVLET: "#67e8f9",
    ENDPOINT: "#93c5fd",
    HANDLER: "#c4b5fd",
    SECURITY_CHAIN: "#fbbf24",
    FILTER: "#fb923c",
    AUTHENTICATION: "#f9a8d4",
    AUTHORIZATION: "#fda4af",
    SECURITY_DATA: "#a7f3d0",
    BUSINESS_SECURITY_STATE: "#bef264"
  };
  const edgeStyles = {
    FLOWS_TO: { color: "#7dd3fc", dash: "none" },
    MATCHED_BY: { color: "#c4b5fd", dash: "6 4" },
    FILTERED_BY: { color: "#fbbf24", dash: "2 4" },
    SECURED_BY: { color: "#fb7185", dash: "8 3 2 3" },
    READS_SECURITY_DATA: { color: "#60a5fa", dash: "3 3" },
    WRITES_SECURITY_DATA: { color: "#a78bfa", dash: "1 3" },
    CONVERTS_TO_AUTHORITY: { color: "#f0abfc", dash: "10 2" },
    USES_FOR_AUTHORIZATION: { color: "#f59e0b", dash: "5 2" },
    SECURITY_STATE: { color: "#86efac", dash: "12 3" }
  };
  const detailKeys = {
    APPLICATION: ["applicationVersion", "applicationClass"],
    SERVLET: ["servletClass", "registrationKind"],
    ENDPOINT: ["handler"],
    HANDLER: ["handler"],
    SECURITY_CHAIN: ["chainKey", "matcherCondition", "chainOrder"],
    FILTER: ["registrationKind", "filterClass", "filterOrder"],
    AUTHENTICATION: ["authenticationKind", "provider"],
    AUTHORIZATION: ["factType", "authorizationKind", "pathOutcome", "coverage"],
    SECURITY_DATA: ["dataType", "securityKind", "usage"],
    BUSINESS_SECURITY_STATE: ["stateAction", "stateKind", "pathOutcome", "coverage"]
  };

  function stringValue(value, fallback) {
    return value === null || value === undefined || value === "" ? fallback : String(value);
  }

  function copyAttributes(attributes) {
    if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return {};
    return Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, stringValue(value, "")]));
  }

  function copyEvidenceIds(evidenceIds) {
    return Array.isArray(evidenceIds) ? evidenceIds.map((id) => String(id)) : [];
  }

  function normalize(snapshot) {
    const nodes = [];
    const nodeIds = new Set();
    let invalidNodes = 0;
    const rawNodes = snapshot && Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
    rawNodes.forEach((node) => {
      if (!node || typeof node.id !== "string" || !node.id || !NODE_TYPES.includes(node.type) || nodeIds.has(node.id)) {
        invalidNodes += 1;
        return;
      }
      nodeIds.add(node.id);
      nodes.push({
        id: node.id,
        type: node.type,
        serviceId: stringValue(node.serviceId, ""),
        label: stringValue(node.label, "이름 미확인"),
        attributes: copyAttributes(node.attributes),
        evidenceIds: copyEvidenceIds(node.evidenceIds)
      });
    });

    const edges = [];
    const edgeIds = new Set();
    let invalidEdges = 0;
    const rawEdges = snapshot && Array.isArray(snapshot.edges) ? snapshot.edges : [];
    rawEdges.forEach((edge) => {
      if (!edge || typeof edge.id !== "string" || !edge.id || edgeIds.has(edge.id)
        || !EDGE_TYPES.includes(edge.type) || !nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) {
        invalidEdges += 1;
        return;
      }
      edgeIds.add(edge.id);
      edges.push({
        id: edge.id,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        type: edge.type,
        attributes: copyAttributes(edge.attributes),
        confidence: stringValue(edge.confidence, "UNKNOWN"),
        evidenceIds: copyEvidenceIds(edge.evidenceIds)
      });
    });
    return { nodes, edges, invalidNodes, invalidEdges };
  }

  function filterGraph(graph, filters = {}) {
    const query = stringValue(filters.query, "").trim().toLowerCase();
    const nodeType = stringValue(filters.nodeType, "");
    const edgeType = stringValue(filters.edgeType, "");
    const nodes = graph.nodes.filter((node) => {
      if (nodeType && node.type !== nodeType) return false;
      if (!query) return true;
      if (node.type !== "ENDPOINT") return false;
      const attributes = node.attributes || {};
      return [node.label, attributes.httpMethod, attributes.path, attributes.handler]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = graph.edges.filter((edge) => {
      if (edgeType && edge.type !== edgeType) return false;
      return nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId);
    });
    return {
      ...graph,
      nodes,
      edges,
      filters: { query, nodeType, edgeType },
      hiddenNodes: graph.nodes.length - nodes.length,
      hiddenEdges: graph.edges.length - edges.length
    };
  }

  function shorten(value, limit) {
    const text = stringValue(value, "");
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 1))}…`;
  }

  function nodeDisplay(node) {
    const attributes = node.attributes;
    const keys = detailKeys[node.type] || [];
    const details = keys
      .filter((key) => attributes[key])
      .map((key) => `${key}=${attributes[key]}`)
      .slice(0, 2);
    if (node.type === "ENDPOINT") {
      const endpoint = [attributes.httpMethod, attributes.path].filter(Boolean).join(" ");
      return {
        primary: endpoint || node.label,
        detail: attributes.handler || "handler 미확인"
      };
    }
    return {
      primary: node.label,
      detail: details.join(" · ") || "속성 확인 필요"
    };
  }

  function createElement(name) {
    return document.createElementNS(SVG_NS, name);
  }

  function addText(parent, className, x, y, value) {
    const text = createElement("text");
    text.setAttribute("class", className);
    text.setAttribute("x", String(x));
    text.setAttribute("y", String(y));
    text.textContent = value;
    parent.appendChild(text);
    return text;
  }

  function positionsFor(nodes, supplied) {
    const positions = {};
    nodes.forEach((node, index) => {
      const candidate = supplied && supplied[node.id];
      positions[node.id] = candidate && Number.isFinite(candidate.x) && Number.isFinite(candidate.y)
        ? { x: candidate.x, y: candidate.y }
        : {
          x: NODE_PADDING + (index % 3) * NODE_GAP_X,
          y: NODE_PADDING + Math.floor(index / 3) * NODE_GAP_Y
        };
    });
    return positions;
  }

  function graphSize(positions, bounds) {
    const values = Object.values(positions);
    const width = values.length === 0
      ? 640
      : Math.max(640, ...values.map((position) => position.x + NODE_WIDTH + NODE_PADDING));
    const height = values.length === 0
      ? 360
      : Math.max(360, ...values.map((position) => position.y + NODE_HEIGHT + NODE_PADDING));
    return {
      width: bounds && Number.isFinite(bounds.width) ? Math.max(width, bounds.width) : width,
      height: bounds && Number.isFinite(bounds.height) ? Math.max(height, bounds.height) : height
    };
  }

  function port(position, right, yOffset) {
    return {
      x: position.x + (right ? NODE_WIDTH : 0),
      y: position.y + NODE_HEIGHT / 2 + yOffset
    };
  }

  function edgePath(source, target, parallelIndex) {
    const forward = source.x <= target.x;
    const offset = (parallelIndex || 0) * 10;
    const start = port(source, forward, offset);
    const end = port(target, !forward, -offset);
    const distance = Math.max(48, Math.abs(end.x - start.x) * 0.45);
    const controlStart = { x: start.x + (forward ? distance : -distance), y: start.y };
    const controlEnd = { x: end.x - (forward ? distance : -distance), y: end.y };
    return `M ${start.x} ${start.y} C ${controlStart.x} ${controlStart.y}, ${controlEnd.x} ${controlEnd.y}, ${end.x} ${end.y}`;
  }

  function routedPath(route, fallback) {
    const points = [];
    const sections = route && Array.isArray(route.sections) ? route.sections : [];
    sections.forEach((section, index) => {
      const start = section.startPoint;
      const end = section.endPoint;
      if (index === 0 && start && Number.isFinite(start.x) && Number.isFinite(start.y)) points.push(start);
      (section.bendPoints || []).forEach((point) => {
        if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) points.push(point);
      });
      if (end && Number.isFinite(end.x) && Number.isFinite(end.y)) points.push(end);
    });
    return points.length > 1
      ? points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")
      : fallback;
  }

  const areaDefinitions = [
    {
      id: "servlet-entry",
      label: "서블릿 컨테이너·진입",
      matches: (node) => ["APPLICATION", "SERVLET"].includes(node.type)
    },
    {
      id: "servlet-filter",
      label: "서블릿 필터",
      matches: (node) => node.type === "FILTER" && node.attributes.registrationKind === "SERVLET"
    },
    {
      id: "spring-security",
      label: "스프링 시큐리티",
      matches: (node) => node.type === "SECURITY_CHAIN"
        || (node.type === "FILTER" && node.attributes.registrationKind === "SECURITY")
    },
    {
      id: "servlet-handler",
      label: "서블릿·핸들러",
      matches: (node) => ["ENDPOINT", "HANDLER"].includes(node.type)
    },
    {
      id: "authentication-authorization",
      label: "인증·인가·보안정보",
      matches: (node) => ["AUTHENTICATION", "AUTHORIZATION", "SECURITY_DATA", "BUSINESS_SECURITY_STATE"].includes(node.type)
    }
  ];

  function renderAreas(graph, positions, layer) {
    if (!layer) return [];
    layer.replaceChildren();
    const areas = [];
    areaDefinitions.forEach((definition) => {
      const members = graph.nodes.filter(definition.matches).map((node) => ({ node, position: positions[node.id] }))
        .filter((item) => item.position);
      if (members.length === 0) return;
      const left = Math.min(...members.map((item) => item.position.x)) - 22;
      const top = Math.min(...members.map((item) => item.position.y)) - 30;
      const right = Math.max(...members.map((item) => item.position.x + NODE_WIDTH)) + 22;
      const bottom = Math.max(...members.map((item) => item.position.y + NODE_HEIGHT)) + 22;
      const group = createElement("g");
      group.setAttribute("class", "graph-area");
      group.setAttribute("data-area-id", definition.id);
      const box = createElement("rect");
      box.setAttribute("class", "graph-area-box");
      box.setAttribute("x", String(left));
      box.setAttribute("y", String(top));
      box.setAttribute("width", String(right - left));
      box.setAttribute("height", String(bottom - top));
      group.appendChild(box);
      addText(group, "graph-area-label", left + 12, top + 18, definition.label);
      layer.appendChild(group);
      areas.push({ id: definition.id, label: definition.label, nodeIds: members.map((item) => item.node.id) });
    });
    return areas;
  }

  function render(graph, layers, options = {}) {
    const positions = positionsFor(graph.nodes, options.positions);
    const size = graphSize(positions, options.bounds);
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const selection = options.selection || null;
    const relatedNodeIds = options.related && options.related.nodeIds instanceof Set
      ? options.related.nodeIds
      : new Set();
    const relatedEdgeIds = options.related && options.related.edgeIds instanceof Set
      ? options.related.edgeIds
      : new Set();
    const edgePairCounts = new Map();
    const edgeElements = [];
    const nodeElements = [];
    const areas = renderAreas(graph, positions, layers.areaLayer);
    layers.edgeLayer.replaceChildren();
    layers.nodeLayer.replaceChildren();
    layers.svg.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
    layers.svg.setAttribute("data-layout-mode", options.layoutMode || "initial");
    if (layers.viewport) layers.viewport.setAttribute("data-layout-mode", options.layoutMode || "initial");

    graph.edges.forEach((edge) => {
      const source = positions[edge.sourceId];
      const target = positions[edge.targetId];
      if (!source || !target) return;
      const pairKey = `${edge.sourceId}\u0000${edge.targetId}`;
      const parallelIndex = edgePairCounts.get(pairKey) || 0;
      edgePairCounts.set(pairKey, parallelIndex + 1);
      const style = edgeStyles[edge.type];
      const path = createElement("path");
      path.setAttribute("class", "graph-edge");
      path.setAttribute("d", routedPath(options.edgeRoutes && options.edgeRoutes[edge.id], edgePath(source, target, parallelIndex)));
      path.setAttribute("data-edge-id", edge.id);
      path.setAttribute("data-edge-type", edge.type);
      path.setAttribute("data-source-id", edge.sourceId);
      path.setAttribute("data-target-id", edge.targetId);
      path.setAttribute("data-confidence", edge.confidence);
      path.setAttribute("data-evidence-ids", edge.evidenceIds.join(","));
      path.setAttribute("tabindex", "0");
      path.setAttribute("role", "button");
      path.setAttribute("aria-label", `${edge.type} ${edge.sourceId} → ${edge.targetId}`);
      path.setAttribute("data-selected", String(Boolean(selection && selection.kind === "edge" && selection.id === edge.id)));
      path.setAttribute("data-related", String(!selection || relatedEdgeIds.has(edge.id)));
      path.setAttribute("stroke", style.color);
      path.setAttribute("stroke-dasharray", style.dash);
      path.setAttribute("marker-end", "url(#graph-arrow)");
      if (options.onEdgeClick) path.addEventListener("click", (event) => {
        if (event && event.stopPropagation) event.stopPropagation();
        options.onEdgeClick(edge.id, path);
      });
      if (options.onEdgeFocus) path.addEventListener("focus", () => options.onEdgeFocus(edge.id, path));
      if (options.onEdgeBlur) path.addEventListener("blur", () => options.onEdgeBlur(edge.id, path));
      if (options.onEdgeHover) path.addEventListener("mouseenter", () => options.onEdgeHover(edge.id, path));
      if (options.onEdgeLeave) path.addEventListener("mouseleave", () => options.onEdgeLeave(edge.id, path));
      path.addEventListener("keydown", (event) => {
        if (!event || (event.key !== "Enter" && event.key !== " ")) return;
        if (event.preventDefault) event.preventDefault();
        if (options.onEdgeClick) options.onEdgeClick(edge.id, path);
      });
      layers.edgeLayer.appendChild(path);
      edgeElements.push(path);

      const label = createElement("text");
      label.setAttribute("class", "graph-edge-label");
      label.setAttribute("data-edge-id", edge.id);
      label.setAttribute("data-selected", String(Boolean(selection && selection.kind === "edge" && selection.id === edge.id)));
      label.setAttribute("data-related", String(!selection || relatedEdgeIds.has(edge.id)));
      label.setAttribute("x", String((source.x + target.x + NODE_WIDTH) / 2));
      label.setAttribute("y", String((source.y + target.y + NODE_HEIGHT) / 2 - 6 - parallelIndex * 8));
      label.setAttribute("fill", style.color);
      label.textContent = edge.type;
      layers.edgeLayer.appendChild(label);
    });

    graph.nodes.forEach((node) => {
      const position = positions[node.id];
      const style = nodeStyles[node.type];
      const display = nodeDisplay(node);
      const group = createElement("g");
      group.setAttribute("class", "graph-node");
      group.setAttribute("transform", `translate(${position.x} ${position.y})`);
      group.setAttribute("data-node-id", node.id);
      group.setAttribute("data-node-type", node.type);
      group.setAttribute("data-evidence-ids", node.evidenceIds.join(","));
      group.setAttribute("data-selected", String(Boolean(selection && selection.kind === "node" && selection.id === node.id)));
      group.setAttribute("data-related", String(!selection || relatedNodeIds.has(node.id)));
      group.setAttribute("tabindex", "0");
      group.setAttribute("role", "button");
      group.setAttribute("aria-label", `${nodeTypeNames[node.type]} ${node.type} ${node.label}`);
      if (options.onNodeClick) group.addEventListener("click", (event) => {
        if (event && event.stopPropagation) event.stopPropagation();
        options.onNodeClick(node.id, group);
      });
      if (options.onNodeFocus) group.addEventListener("focus", () => options.onNodeFocus(node.id, group));
      if (options.onNodeBlur) group.addEventListener("blur", () => options.onNodeBlur(node.id, group));
      if (options.onNodeHover) group.addEventListener("mouseenter", () => options.onNodeHover(node.id, group));
      if (options.onNodeLeave) group.addEventListener("mouseleave", () => options.onNodeLeave(node.id, group));
      group.addEventListener("keydown", (event) => {
        if (!event || (event.key !== "Enter" && event.key !== " ")) return;
        if (event.preventDefault) event.preventDefault();
        if (options.onNodeClick) options.onNodeClick(node.id, group);
      });

      const card = createElement("rect");
      card.setAttribute("class", "graph-node-card");
      card.setAttribute("width", String(NODE_WIDTH));
      card.setAttribute("height", String(NODE_HEIGHT));
      card.setAttribute("rx", "6");
      card.setAttribute("stroke", style);
      group.appendChild(card);
      const mark = createElement("rect");
      mark.setAttribute("class", "graph-node-mark");
      mark.setAttribute("x", "14");
      mark.setAttribute("y", "12");
      mark.setAttribute("width", "8");
      mark.setAttribute("height", "8");
      mark.setAttribute("rx", "2");
      mark.setAttribute("fill", style);
      group.appendChild(mark);
      addText(group, "graph-node-type", 30, 20, node.type);
      addText(group, "graph-node-label", 14, 45, shorten(display.primary, 33));
      addText(group, "graph-node-detail", 14, 65, shorten(display.detail, 38));

      const input = createElement("circle");
      input.setAttribute("class", "graph-port graph-port-in");
      input.setAttribute("cx", "0");
      input.setAttribute("cy", String(NODE_HEIGHT / 2));
      input.setAttribute("r", "4");
      input.setAttribute("data-port", "in");
      group.appendChild(input);
      const output = createElement("circle");
      output.setAttribute("class", "graph-port graph-port-out");
      output.setAttribute("cx", String(NODE_WIDTH));
      output.setAttribute("cy", String(NODE_HEIGHT / 2));
      output.setAttribute("r", "4");
      output.setAttribute("data-port", "out");
      group.appendChild(output);
      layers.nodeLayer.appendChild(group);
      nodeElements.push(group);
    });

    layers.svg.hidden = graph.nodes.length === 0;
    return { positions, width: size.width, height: size.height, nodes: graph.nodes, edges: graph.edges, invalidNodes: graph.invalidNodes, invalidEdges: graph.invalidEdges, nodeElements, edgeElements, nodeById, areas };
  }

  window.MapInBootGraph = {
    nodeTypes: NODE_TYPES,
    edgeTypes: EDGE_TYPES,
    normalize,
    filter: filterGraph,
    render,
    nodeDisplay
  };
})();
