(() => {
  "use strict";

  const tabs = [
    { id: "properties", label: "속성" },
    { id: "connections", label: "연결 노드" },
    { id: "relations", label: "연결 관계" }
  ];
  const nodeTypeNames = {
    APPLICATION: "Application",
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

  function valueOf(value, fallback = "확인할 수 없음") {
    return value === null || value === undefined || value === "" ? fallback : String(value);
  }

  function appendElement(parent, tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.setAttribute("class", className);
    if (text !== undefined) element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function appendRow(parent, label, value) {
    const row = appendElement(parent, "div", "inspector-row");
    appendElement(row, "span", "inspector-label", label);
    appendElement(row, "span", "inspector-value", valueOf(value));
    return row;
  }

  function appendHeading(parent, text) {
    return appendElement(parent, "h3", "inspector-section-title", text);
  }

  function appendEmpty(parent, text) {
    appendElement(parent, "p", "inspector-empty", text);
  }

  function copyIds(values) {
    return Array.isArray(values) ? values.map((value) => String(value)) : [];
  }

  function relatedFindings(snapshot, selection) {
    const findings = snapshot && Array.isArray(snapshot.findings) ? snapshot.findings : [];
    if (!selection) return [];
    const field = selection.kind === "node" ? "nodeIds" : "edgeIds";
    return findings.filter((finding) => copyIds(finding && finding[field]).includes(selection.id));
  }

  function evidenceMap(snapshot) {
    const entries = snapshot && Array.isArray(snapshot.evidence) ? snapshot.evidence : [];
    return new Map(entries
      .filter((entry) => entry && entry.id !== undefined && entry.id !== null)
      .map((entry) => [String(entry.id), entry]));
  }

  function directRelations(graph, selection) {
    if (!graph || !selection) return [];
    if (selection.kind === "edge") {
      return graph.edges.filter((edge) => edge.id === selection.id);
    }
    return graph.edges.filter((edge) => edge.sourceId === selection.id || edge.targetId === selection.id);
  }

  function related(graph, selection) {
    const nodeIds = new Set();
    const edgeIds = new Set();
    if (!graph || !selection) return { nodeIds, edgeIds };
    if (selection.kind === "edge") {
      const edge = graph.edges.find((candidate) => candidate.id === selection.id);
      if (edge) {
        edgeIds.add(edge.id);
        nodeIds.add(edge.sourceId);
        nodeIds.add(edge.targetId);
      }
      return { nodeIds, edgeIds };
    }
    nodeIds.add(selection.id);
    graph.edges.forEach((edge) => {
      if (edge.sourceId !== selection.id && edge.targetId !== selection.id) return;
      edgeIds.add(edge.id);
      nodeIds.add(edge.sourceId === selection.id ? edge.targetId : edge.sourceId);
    });
    return { nodeIds, edgeIds };
  }

  function create(options = {}) {
    const inspector = options.inspector;
    const popover = options.popover;
    const surface = options.surface;
    const onClear = options.onClear || (() => {});
    const onSelect = options.onSelect || (() => {});
    let activeTab = "properties";
    let current = { graph: null, visibleGraph: null, snapshot: null, selection: null };

    function setHidden(element, hidden) {
      if (!element) return;
      element.hidden = hidden;
      element.setAttribute("aria-hidden", String(hidden));
    }

    function selectedItem(graph, selection) {
      if (!graph || !selection) return null;
      const collection = selection.kind === "node" ? graph.nodes : graph.edges;
      return collection.find((item) => item.id === selection.id) || null;
    }

    function selectedLabel(selection, item) {
      if (!item) return "확인할 수 없음";
      if (selection.kind === "node") {
        const attributes = item.attributes || {};
        if (item.type === "ENDPOINT") {
          return [attributes.httpMethod, attributes.path].filter(Boolean).join(" ") || item.label;
        }
        return item.label;
      }
      return item.type;
    }

    function appendEvidence(parent, snapshot, ids) {
      appendHeading(parent, "Evidence");
      const evidenceIds = copyIds(ids);
      if (evidenceIds.length === 0) {
        appendEmpty(parent, "Evidence 없음");
        return;
      }
      const byId = evidenceMap(snapshot);
      evidenceIds.forEach((id) => {
        const evidence = byId.get(id);
        const block = appendElement(parent, "div", "inspector-evidence");
        appendRow(block, "Evidence ID", id);
        if (!evidence) {
          appendRow(block, "상태", "확인할 수 없음");
          return;
        }
        appendRow(block, "Source", evidence.source);
        appendRow(block, "Location", evidence.location);
        appendRow(block, "Summary", evidence.summary);
      });
    }

    function appendFindings(parent, snapshot, selection) {
      const findings = relatedFindings(snapshot, selection);
      appendHeading(parent, "Finding 참조");
      appendElement(parent, "p", "inspector-finding-state", findings.length > 0 ? "관련 Finding 있음" : "관련 Finding 없음");
      findings.forEach((finding) => {
        const block = appendElement(parent, "div", "inspector-finding");
        appendRow(block, "Finding ID", finding.id);
        appendRow(block, "Rule ID", finding.ruleId);
        appendRow(block, "제목", finding.title);
      });
    }

    function appendAttributes(parent, attributes) {
      const entries = attributes && typeof attributes === "object" && !Array.isArray(attributes)
        ? Object.entries(attributes)
        : [];
      appendHeading(parent, "추가 속성");
      if (entries.length === 0) {
        appendEmpty(parent, "추가 속성 없음");
        return;
      }
      entries.forEach(([key, value]) => appendRow(parent, key, value));
    }

    function appendNodeButton(parent, node, direction) {
      const button = appendElement(parent, "button", "inspector-link");
      button.setAttribute("type", "button");
      button.setAttribute("data-node-id", node.id);
      button.textContent = `${direction} · ${node.id} · ${selectedLabel({ kind: "node" }, node)}`;
      button.addEventListener("click", () => onSelect("node", node.id));
      return button;
    }

    function renderProperties(parent, item, selection, snapshot) {
      appendHeading(parent, "기본 속성");
      if (selection.kind === "node") {
        appendRow(parent, "Node ID", item.id);
        appendRow(parent, "유형", item.type);
        appendRow(parent, "Service ID", item.serviceId);
        appendRow(parent, "이름", item.label);
        appendRow(parent, "Endpoint", selectedLabel(selection, item));
        appendAttributes(parent, item.attributes);
        appendFindings(parent, snapshot, selection);
        appendEvidence(parent, snapshot, item.evidenceIds);
        return;
      }
      appendRow(parent, "Edge ID", item.id);
      appendRow(parent, "유형", item.type);
      appendRow(parent, "출발 Node ID", item.sourceId);
      appendRow(parent, "도착 Node ID", item.targetId);
      appendRow(parent, "Confidence", item.confidence);
      appendAttributes(parent, item.attributes);
      appendFindings(parent, snapshot, selection);
      appendEvidence(parent, snapshot, item.evidenceIds);
    }

    function renderConnections(parent, graph, item, selection) {
      appendHeading(parent, "연결 노드");
      if (selection.kind === "edge") {
        const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
        const source = nodes.get(item.sourceId);
        const target = nodes.get(item.targetId);
        if (source) appendNodeButton(parent, source, "출발");
        if (target) appendNodeButton(parent, target, "도착");
        if (!source && !target) appendEmpty(parent, "연결 노드 확인할 수 없음");
        return;
      }
      const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
      const relations = directRelations(graph, selection);
      const seen = new Set();
      relations.forEach((edge) => {
        const otherId = edge.sourceId === item.id ? edge.targetId : edge.sourceId;
        if (seen.has(otherId)) return;
        seen.add(otherId);
        const node = nodes.get(otherId);
        if (node) appendNodeButton(parent, node, edge.sourceId === item.id ? "나감" : "들어옴");
      });
      if (seen.size === 0) appendEmpty(parent, "연결 노드 없음");
      appendHeading(parent, "직접 연결 Edge");
      if (relations.length === 0) {
        appendEmpty(parent, "연결 관계 없음");
      } else {
        relations.forEach((edge) => appendRow(parent, edge.id, edge.type));
      }
    }

    function appendRelation(parent, edge, selection, nodes, direct = true) {
      const block = appendElement(parent, "div", "inspector-relation");
      appendRow(block, "Edge ID", edge.id);
      appendRow(block, "EdgeType", edge.type);
      if (selection.kind === "node") {
        appendRow(block, "방향", direct
          ? edge.sourceId === selection.id ? "나감" : "들어옴"
          : "직접 연결 아님");
      } else {
        appendRow(block, "방향", `${edge.sourceId} → ${edge.targetId}`);
      }
      appendRow(block, "Confidence", edge.confidence);
      appendRow(block, "출발 Node", nodes.has(edge.sourceId) ? edge.sourceId : "확인할 수 없음");
      appendRow(block, "도착 Node", nodes.has(edge.targetId) ? edge.targetId : "확인할 수 없음");
      appendAttributes(block, edge.attributes);
      appendEvidence(block, current.snapshot, edge.evidenceIds);
    }

    function renderRelations(parent, graph, item, selection, snapshot) {
      appendHeading(parent, "연결 관계");
      const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
      const relations = directRelations(graph, selection);
      if (relations.length === 0) appendEmpty(parent, "연결 관계 없음");
      relations.forEach((edge) => appendRelation(parent, edge, selection, nodes));

      if (selection.kind !== "node") return;
      const directIds = new Set(relations.map((edge) => edge.id));
      const referencedIds = new Set();
      relatedFindings(snapshot, selection).forEach((finding) => copyIds(finding.edgeIds).forEach((id) => referencedIds.add(id)));
      const referenced = graph.edges.filter((edge) => referencedIds.has(edge.id) && !directIds.has(edge.id));
      if (referenced.length === 0) return;
      appendHeading(parent, "Finding 참조 관계");
      appendElement(parent, "p", "inspector-help", "선택 Node의 Finding이 참조한 Edge이며 직접 연결로 해석하지 않음");
      referenced.forEach((edge) => appendRelation(parent, edge, selection, nodes, false));
    }

    function render({ graph, visibleGraph, snapshot, selection }) {
      current = { graph, visibleGraph, snapshot, selection };
      setHidden(inspector, !selection);
      if (!selection) {
        if (inspector) inspector.replaceChildren();
        return null;
      }
      const item = selectedItem(graph, selection);
      if (!item) {
        setHidden(inspector, true);
        if (inspector) inspector.replaceChildren();
        return null;
      }
      if (inspector) {
        inspector.replaceChildren();
        inspector.setAttribute("data-selection-kind", selection.kind);
        inspector.setAttribute("data-selection-id", selection.id);
      }

      const header = appendElement(inspector, "div", "inspector-header");
      appendElement(header, "span", "inspector-badge", selection.kind === "node" ? "Node" : "Edge");
      const heading = appendElement(header, "div", "inspector-heading");
      appendElement(heading, "strong", "inspector-title", selectedLabel(selection, item));
      appendElement(heading, "span", "inspector-subtitle", `${selection.kind === "node" ? item.type : item.id}`);
      const close = appendElement(header, "button", "inspector-close", "닫기");
      close.setAttribute("type", "button");
      close.setAttribute("aria-label", "Inspector 닫기");
      close.addEventListener("click", onClear);

      const tabBar = appendElement(inspector, "div", "inspector-tabs");
      tabs.forEach((tab) => {
        const button = appendElement(tabBar, "button", "inspector-tab", tab.label);
        button.setAttribute("type", "button");
        button.setAttribute("data-tab", tab.id);
        button.setAttribute("aria-selected", String(activeTab === tab.id));
        button.addEventListener("click", () => setTab(tab.id));
      });
      const body = appendElement(inspector, "div", "inspector-body");
      if (activeTab === "connections") renderConnections(body, graph, item, selection);
      else if (activeTab === "relations") renderRelations(body, graph, item, selection, snapshot);
      else renderProperties(body, item, selection, snapshot);
      return item;
    }

    function setTab(tab) {
      if (!tabs.some((candidate) => candidate.id === tab)) return;
      activeTab = tab;
      if (current.selection) render(current);
    }

    function hoverText(graph, snapshot, kind, id) {
      const selection = { kind, id };
      const item = selectedItem(graph, selection);
      if (!item) return null;
      const lines = [];
      if (kind === "node") {
        lines.push(selectedLabel(selection, item));
        lines.push(`${nodeTypeNames[item.type] || item.type} · ${item.id}`);
      } else {
        lines.push(`${item.type} · ${item.id}`);
        lines.push(`${item.sourceId} → ${item.targetId}`);
        lines.push(`Confidence · ${item.confidence}`);
      }
      lines.push(relatedFindings(snapshot, selection).length > 0 ? "관련 Finding 있음" : "관련 Finding 없음");
      return { item, lines };
    }

    function showHover({ graph, snapshot, kind, id, anchor }) {
      const content = hoverText(graph, snapshot, kind, id);
      if (!content || !popover) return;
      popover.replaceChildren();
      content.lines.forEach((line, index) => appendElement(popover, "div", index === 0 ? "popover-title" : "popover-line", line));
      setHidden(popover, false);
      const surfaceRect = surface && surface.getBoundingClientRect ? surface.getBoundingClientRect() : { left: 0, top: 0, width: 960, height: 540 };
      const anchorRect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : surfaceRect;
      const width = 280;
      const height = Math.max(84, 30 + content.lines.length * 20);
      const left = Math.max(8, Math.min(surfaceRect.width - width - 8, anchorRect.right - surfaceRect.left + 10));
      const top = Math.max(8, Math.min(surfaceRect.height - height - 8, anchorRect.top - surfaceRect.top));
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
    }

    function hideHover() {
      setHidden(popover, true);
      if (popover) popover.replaceChildren();
    }

    hideHover();
    setHidden(inspector, true);
    return { render, related, setTab, showHover, hideHover };
  }

  window.MapInBootInspector = { create, related };
})();
