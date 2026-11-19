(() => {
  "use strict";

  const tabs = [
    { id: "properties", label: "속성" },
    { id: "connections", label: "연결 노드" },
    { id: "relations", label: "연결 관계" }
  ];
  const graphDisplay = window.MapInBootGraph || {};
  const nodeTypeNames = graphDisplay.nodeTypeNames || {
    APPLICATION: "애플리케이션",
    SERVLET: "서블릿",
    ENDPOINT: "API",
    HANDLER: "핸들러",
    SECURITY_CHAIN: "보안 체인",
    FILTER: "필터",
    AUTHENTICATION: "인증",
    AUTHORIZATION: "인가",
    SECURITY_DATA: "보안 정보",
    BUSINESS_SECURITY_STATE: "업무 보안 상태"
  };
  const edgeTypeNames = graphDisplay.edgeTypeNames || {
    FLOWS_TO: "흐름",
    MATCHED_BY: "적용 체인",
    FILTERED_BY: "적용 필터",
    SECURED_BY: "보호 근거",
    READS_SECURITY_DATA: "보안정보 읽음",
    WRITES_SECURITY_DATA: "보안정보 기록",
    CONVERTS_TO_AUTHORITY: "권한 변환",
    USES_FOR_AUTHORIZATION: "인가 사용",
    SECURITY_STATE: "보안 상태"
  };
  const nodeTypeLabel = (type) => nodeTypeNames[type] || type;
  const edgeTypeLabel = (type) => edgeTypeNames[type] || type;
  const nodeDisplay = graphDisplay.nodeDisplay || ((item) => ({ primary: item.label, detail: "" }));
  const shortenReference = graphDisplay.handlerDisplay || ((value) => String(value || ""));

  function valueOf(value, fallback = "확인할 수 없음") {
    return value === null || value === undefined || value === "" ? fallback : String(value);
  }

  const attributeNames = {
    httpMethod: "HTTP Method",
    path: "경로",
    handler: "핸들러",
    registrationKind: "등록 구분",
    filterClass: "Filter 클래스",
    filterOrder: "Filter 순서",
    chainKey: "Chain 식별자",
    chainOrder: "Chain 순서",
    matcherCondition: "매칭 조건",
    operation: "작업",
    apiType: "API 유형",
    apiName: "API 이름",
    apiOwner: "API 소유자",
    apiDescriptor: "API 서명",
    sourceKind: "원천 구분",
    mappingKind: "매핑 구분",
    observationKind: "관찰 구분",
    principalType: "Principal 유형",
    claimName: "Claim 이름",
    verificationKind: "검증 구분",
    codeLocation: "코드 위치",
    usage: "사용 방식",
    securityKind: "보안 구분",
    dataType: "데이터 유형"
  };
  const attributeValueNames = {
    READ: "읽기",
    DECLARE: "선언",
    CREATE: "생성",
    VERIFY_CONFIGURATION: "검증 구성",
    PRINCIPAL: "Principal",
    SPRING_SECURITY_JWT: "Spring Security JWT",
    AUTHORITY: "권한",
    JWT: "JWT",
    SECURITY: "보안",
    SERVLET: "서블릿",
    CONFIGURATION: "구성"
  };

  function attributeLabel(key) {
    return attributeNames[key] || key;
  }

  function attributeValue(key, value) {
    const text = valueOf(value);
    if (["handler", "filterClass", "applicationClass", "servletClass", "matcherClass", "provider", "principalType", "apiOwner"].includes(key)) {
      return shortenReference(value);
    }
    return attributeValueNames[text] ? `${attributeValueNames[text]} (${text})` : text;
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

  function relatedFindings(snapshot, selection, controllerGroups = []) {
    const findings = snapshot && Array.isArray(snapshot.findings) ? snapshot.findings : [];
    if (!selection) return [];
    if (selection.kind === "controller-group") {
      const group = controllerGroups.find((candidate) => candidate.id === selection.id);
      if (!group) return [];
      const nodeIds = new Set([...(group.handlerIds || []), ...(group.endpointIds || [])].map(String));
      const edgeIds = new Set((group.edgeIds || []).map(String));
      return findings.filter((finding) => copyIds(finding && finding.nodeIds).some((id) => nodeIds.has(id))
        || copyIds(finding && finding.edgeIds).some((id) => edgeIds.has(id)));
    }
    const field = selection.kind === "node" ? "nodeIds" : "edgeIds";
    return findings.filter((finding) => copyIds(finding && finding[field]).includes(selection.id));
  }

  function evidenceMap(snapshot) {
    const entries = snapshot && Array.isArray(snapshot.evidence) ? snapshot.evidence : [];
    return new Map(entries
      .filter((entry) => entry && entry.id !== undefined && entry.id !== null)
      .map((entry) => [String(entry.id), entry]));
  }

  function directRelations(graph, selection, controllerGroups = []) {
    if (!graph || !selection) return [];
    if (selection.kind === "edge") {
      return graph.edges.filter((edge) => edge.id === selection.id);
    }
    if (selection.kind === "controller-group") {
      const group = controllerGroups.find((candidate) => candidate.id === selection.id);
      if (!group) return [];
      const nodeIds = new Set([...(group.handlerIds || []), ...(group.endpointIds || [])]);
      return graph.edges.filter((edge) => nodeIds.has(edge.sourceId) || nodeIds.has(edge.targetId));
    }
    return graph.edges.filter((edge) => edge.sourceId === selection.id || edge.targetId === selection.id);
  }

  function related(graph, selection, controllerGroups = []) {
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
    const selectedNode = selection.kind === "node" && graph.nodes.find((node) => node.id === selection.id);
    if (selectedNode && selectedNode.type === "ENDPOINT" && window.MapInBootFlow
      && typeof window.MapInBootFlow.deriveEndpointGraph === "function") {
      const detail = window.MapInBootFlow.deriveEndpointGraph(graph, selection.id);
      detail.nodes.forEach((node) => nodeIds.add(node.id));
      detail.edges.forEach((edge) => edgeIds.add(edge.id));
      return { nodeIds, edgeIds };
    }
    if (selection.kind === "controller-group") {
      const group = controllerGroups.find((candidate) => candidate.id === selection.id);
      if (!group) return { nodeIds, edgeIds };
      nodeIds.add(selection.id);
      [...(group.handlerIds || []), ...(group.endpointIds || [])].forEach((id) => nodeIds.add(id));
      graph.edges.forEach((edge) => {
        if (!nodeIds.has(edge.sourceId) && !nodeIds.has(edge.targetId)) return;
        edgeIds.add(edge.id);
        nodeIds.add(edge.sourceId);
        nodeIds.add(edge.targetId);
      });
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
    const onOpenDetail = options.onOpenDetail || (() => {});
    let activeTab = "properties";
    let current = { graph: null, visibleGraph: null, snapshot: null, selection: null, controllerGroups: [] };

    function setHidden(element, hidden) {
      if (!element) return;
      element.hidden = hidden;
      element.setAttribute("aria-hidden", String(hidden));
    }

    function selectedItem(graph, selection, controllerGroups = []) {
      if (!graph || !selection) return null;
      if (selection.kind === "controller-group") {
        return controllerGroups.find((group) => group.id === selection.id) || null;
      }
      const collection = selection.kind === "node" ? graph.nodes : graph.edges;
      return collection.find((item) => item.id === selection.id) || null;
    }

    function selectedLabel(selection, item) {
      if (!item) return "확인할 수 없음";
      if (selection.kind === "controller-group") return item.controllerName || item.controllerFqcn;
      if (selection.kind === "node") {
        const attributes = item.attributes || {};
        if (item.type === "ENDPOINT") {
          return [attributes.httpMethod, attributes.path].filter(Boolean).join(" ") || item.label;
        }
        return nodeDisplay(item).primary || item.label;
      }
      return edgeTypeLabel(item.type);
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

    function appendFindings(parent, snapshot, selection, controllerGroups) {
      const findings = relatedFindings(snapshot, selection, controllerGroups);
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
      entries.forEach(([key, value]) => appendRow(parent, attributeLabel(key), attributeValue(key, value)));
    }

    function appendNodeButton(parent, node, direction) {
      const button = appendElement(parent, "button", "inspector-link");
      button.setAttribute("type", "button");
      button.setAttribute("data-node-id", node.id);
      button.textContent = `${direction} · ${nodeTypeLabel(node.type)} · ${selectedLabel({ kind: "node" }, node)}`;
      button.addEventListener("click", () => onSelect("node", node.id));
      return button;
    }

    function renderProperties(parent, graph, item, selection, snapshot) {
      appendHeading(parent, "기본 속성");
      if (selection.kind === "controller-group") {
        if (item.type === "AUTHORIZATION" || item.type === "SECURITY_DATA") {
          appendRow(parent, "유형", item.type === "AUTHORIZATION" ? "인가 근거" : "보안정보 사용");
          appendRow(parent, "소속", item.controllerName);
          appendRow(parent, "원본 Fact", (item.nodeIds || []).length);
          appendHeading(parent, "포함된 원본 Fact");
          (item.nodeIds || []).forEach((id) => {
            const node = graph.nodes.find((candidate) => candidate.id === id);
            if (!node) return;
            const block = appendElement(parent, "div", "inspector-relation");
            appendNodeButton(block, node, "원본");
            appendAttributes(block, node.attributes);
            appendEvidence(block, snapshot, node.evidenceIds);
          });
          appendFindings(parent, snapshot, selection, current.controllerGroups);
          return;
        }
        appendRow(parent, "유형", "Controller");
        appendRow(parent, "Controller FQCN", item.controllerFqcn);
        appendRow(parent, "API", (item.endpointIds || []).length);
        appendRow(parent, "Handler Method", (item.handlerMethods || []).length);
        appendHeading(parent, "포함 Handler Method");
        if (!item.handlerMethods || item.handlerMethods.length === 0) appendEmpty(parent, "Handler Method 없음");
        (item.handlerMethods || []).forEach((method) => appendElement(parent, "p", "inspector-help", method));
        appendHeading(parent, "포함 Endpoint");
        if (!item.endpointIds || item.endpointIds.length === 0) appendEmpty(parent, "Endpoint 없음");
        const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
        (item.endpointIds || []).forEach((id) => {
          const node = nodes.get(id);
          if (node) appendNodeButton(parent, node, "Endpoint");
        });
        return;
      }
      if (selection.kind === "node") {
        const display = nodeDisplay(item);
        appendRow(parent, "Node ID", item.id);
        appendRow(parent, "유형", nodeTypeLabel(item.type));
        appendRow(parent, "Service ID", item.serviceId);
        appendRow(parent, "이름", display.primary || item.label);
        appendRow(parent, "설명", display.detail || "확인할 수 없음");
        if (item.type === "ENDPOINT") appendRow(parent, "API", selectedLabel(selection, item));
        appendAttributes(parent, item.attributes);
        appendFindings(parent, snapshot, selection, current.controllerGroups);
        appendEvidence(parent, snapshot, item.evidenceIds);
        return;
      }
      appendRow(parent, "Edge ID", item.id);
      appendRow(parent, "유형", edgeTypeLabel(item.type));
      appendRow(parent, "출발 Node ID", item.sourceId);
      appendRow(parent, "도착 Node ID", item.targetId);
      appendRow(parent, "Confidence", item.confidence);
      appendAttributes(parent, item.attributes);
      appendFindings(parent, snapshot, selection, current.controllerGroups);
      appendEvidence(parent, snapshot, item.evidenceIds);
      const model = current.displayModel;
      const bundleId = model && model.edgeToDisplay[item.id];
      const edgeIds = bundleId && model.displayToEdges[bundleId] || [];
      if (edgeIds.length > 1) {
        appendHeading(parent, "함께 표시한 원본 관계");
        edgeIds.forEach((id) => {
          const button = appendElement(parent, "button", "inspector-link", id);
          button.setAttribute("type", "button");
          button.setAttribute("data-edge-id", id);
          button.addEventListener("click", () => onSelect("edge", id));
        });
      }
    }

    function renderConnections(parent, graph, item, selection) {
      appendHeading(parent, "연결 노드");
      if (selection.kind === "controller-group") {
        const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
        const ids = [...(item.handlerIds || []), ...(item.endpointIds || [])];
        ids.forEach((id) => {
          const node = nodes.get(id);
          if (node) appendNodeButton(parent, node, node.type === "ENDPOINT" ? "Endpoint" : "Handler");
        });
        if (ids.length === 0) appendEmpty(parent, "연결 노드 없음");
        return;
      }
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
      const relations = directRelations(graph, selection, current.controllerGroups);
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
        relations.forEach((edge) => appendRow(parent, edge.id, edgeTypeLabel(edge.type)));
      }
    }

    function appendRelation(parent, edge, selection, nodes, direct = true) {
      const block = appendElement(parent, "div", "inspector-relation");
      appendRow(block, "Edge ID", edge.id);
      const open = appendElement(block, "button", "inspector-link", "원본 관계 보기");
      open.setAttribute("type", "button");
      open.setAttribute("data-edge-id", edge.id);
      open.addEventListener("click", () => onSelect("edge", edge.id));
      appendRow(block, "관계 유형", edgeTypeLabel(edge.type));
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
      const relations = directRelations(graph, selection, current.controllerGroups);
      if (relations.length === 0) appendEmpty(parent, "연결 관계 없음");
      relations.forEach((edge) => appendRelation(parent, edge, selection, nodes));

      if (selection.kind !== "node") return;
      const directIds = new Set(relations.map((edge) => edge.id));
      const referencedIds = new Set();
      relatedFindings(snapshot, selection, current.controllerGroups).forEach((finding) => copyIds(finding.edgeIds).forEach((id) => referencedIds.add(id)));
      const referenced = graph.edges.filter((edge) => referencedIds.has(edge.id) && !directIds.has(edge.id));
      if (referenced.length === 0) return;
      appendHeading(parent, "Finding 참조 관계");
      appendElement(parent, "p", "inspector-help", "선택 Node의 Finding이 참조한 Edge이며 직접 연결로 해석하지 않음");
      referenced.forEach((edge) => appendRelation(parent, edge, selection, nodes, false));
    }

    function render({ graph, visibleGraph, snapshot, selection, controllerGroups = [], displayModel = null }) {
      current = { graph, visibleGraph, snapshot, selection, controllerGroups, displayModel };
      setHidden(inspector, !selection);
      if (!selection) {
        if (inspector) inspector.replaceChildren();
        return null;
      }
      const item = selectedItem(graph, selection, controllerGroups);
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
      const groupType = item.type === "AUTHORIZATION" ? "인가 근거"
        : item.type === "SECURITY_DATA" ? "보안정보 사용" : "Controller";
      appendElement(header, "span", "inspector-badge", selection.kind === "node"
        ? "노드" : selection.kind === "controller-group" ? groupType : "엣지");
      const heading = appendElement(header, "div", "inspector-heading");
      appendElement(heading, "strong", "inspector-title", selectedLabel(selection, item));
      appendElement(heading, "span", "inspector-subtitle", selection.kind === "node"
        ? nodeTypeLabel(item.type) : selection.kind === "controller-group" ? groupType : edgeTypeLabel(item.type));
      const close = appendElement(header, "button", "inspector-close", "닫기");
      close.setAttribute("type", "button");
      close.setAttribute("aria-label", "Inspector 닫기");
      close.addEventListener("click", onClear);
      if (selection.kind === "node" && item.type === "ENDPOINT") {
        const detailAction = appendElement(header, "button", "inspector-detail-action", "기능별 상세 보기");
        detailAction.setAttribute("type", "button");
        detailAction.setAttribute("data-endpoint-id", item.id);
        detailAction.addEventListener("click", () => onOpenDetail(item.id));
      }

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
      else renderProperties(body, graph, item, selection, snapshot);
      return item;
    }

    function setTab(tab) {
      if (!tabs.some((candidate) => candidate.id === tab)) return;
      activeTab = tab;
      if (current.selection) render(current);
    }

    function hoverText(graph, snapshot, kind, id) {
      const selection = { kind, id };
      const item = selectedItem(graph, selection, current.controllerGroups);
      if (!item) return null;
      const lines = [];
      if (kind === "controller-group") {
        lines.push(item.controllerName || item.controllerFqcn);
        lines.push(`Controller · API ${(item.endpointIds || []).length}개 · Handler Method ${(item.handlerMethods || []).length}개`);
      } else if (kind === "node") {
        const display = nodeDisplay(item);
        lines.push(display.primary || selectedLabel(selection, item));
        lines.push(`${nodeTypeLabel(item.type)} · ${display.detail || item.id}`);
      } else {
        lines.push(`${edgeTypeLabel(item.type)} · ${item.id}`);
        lines.push(`${item.sourceId} → ${item.targetId}`);
        lines.push(`Confidence · ${item.confidence}`);
      }
      lines.push(relatedFindings(snapshot, selection, current.controllerGroups).length > 0 ? "관련 Finding 있음" : "관련 Finding 없음");
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
