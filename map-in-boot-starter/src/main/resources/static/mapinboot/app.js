(() => {
  "use strict";

  const viewNames = {
    "all-flow": "전체 Flow Map",
    "feature-flow": "기능별 상세 Flow Map",
    "security-flow": "전체 취약점 진단 Flow Map",
    "security-detail": "기능별 상세 취약점 확인"
  };
  const phaseNames = {
    NOT_STARTED: "대기",
    RUNNING: "실행 중",
    COLLECTING: "수집 중",
    ANALYZING: "분석 중",
    PARTIAL: "부분 완료",
    COMPLETED: "완료",
    FAILED: "실패"
  };
  const title = document.querySelector("#view-title");
  const viewState = document.querySelector("#view-state");
  const graphCanvas = document.querySelector("#graph-canvas");
  const graphEmpty = document.querySelector("#graph-empty");
  const graphStateMessage = document.querySelector("#graph-state-message");
  const graphSvg = document.querySelector("#graph-svg");
  const graphViewport = document.querySelector("#graph-viewport");
  const graphAreas = document.querySelector("#graph-areas");
  const graphFlowProjection = document.querySelector("#graph-flow-projection");
  const graphGuides = document.querySelector("#graph-guides");
  const graphFindingSections = document.querySelector("#graph-finding-sections");
  const graphFindingSectionTitles = document.querySelector("#graph-finding-section-titles");
  const graphEdges = document.querySelector("#graph-edges");
  const graphNodes = document.querySelector("#graph-nodes");
  const inspector = document.querySelector("#inspector");
  const findingModal = document.querySelector("#finding-modal");
  const findingModalTitle = document.querySelector("#finding-modal-title");
  const findingModalClose = document.querySelector("#finding-modal-close");
  const graphPopover = document.querySelector("#graph-popover");
  const endpointSearch = document.querySelector("#endpoint-search");
  const endpointFilter = document.querySelector("#endpoint-filter-label");
  const endpointFilterLabel = document.querySelector("#endpoint-filter-label-text");
  const endpointOptions = document.querySelector("#endpoint-options");
  const nodeFilterField = document.querySelector("#node-filter-field");
  const nodeFilter = document.querySelector("#node-filter");
  const edgeFilterField = document.querySelector("#edge-filter-field");
  const edgeFilter = document.querySelector("#edge-filter");
  const unconnectedNodeField = document.querySelector("#unconnected-node-field");
  const includeUnconnectedNodes = document.querySelector("#include-unconnected-nodes");
  const findingFields = document.querySelector("#finding-filter-fields");
  const findingRule = document.querySelector("#finding-rule");
  const findingConfidence = document.querySelector("#finding-confidence");
  const findingList = document.querySelector("#finding-list");
  const findingApiFields = document.querySelector("#finding-api-fields");
  const findingApiSelect = document.querySelector("#finding-api-select");
  const detailFindingList = document.querySelector("#detail-finding-list");
  const searchReset = document.querySelector("#search-reset");
  const filterToggle = document.querySelector("#filter-toggle");
  const filterPanel = document.querySelector("#map-filter-panel");
  const filterStatus = document.querySelector("#graph-filter-status");
  const notice = document.querySelector("#shell-notice");
  const refreshButton = document.querySelector("#refresh-button");
  const helpButton = document.querySelector("#help-button");
  const settingsButton = document.querySelector("#settings-button");
  const helpPanel = document.querySelector("#help-panel");
  const settingsPanel = document.querySelector("#settings-panel");
  const showAreasSetting = document.querySelector("#setting-show-areas");
  const showEdgeLabelsSetting = document.querySelector("#setting-show-edge-labels");
  const showMinimapSetting = document.querySelector("#setting-show-minimap");
  const flowClient = window.MapInBootFlow;
  const requestFlowClient = window.MapInBootRequestFlow;
  const graphRenderer = window.MapInBootGraph;
  if (graphRenderer) {
    [[nodeFilter, graphRenderer.nodeTypes, graphRenderer.nodeTypeLabel],
      [edgeFilter, graphRenderer.edgeTypes, graphRenderer.edgeTypeLabel]].forEach(([select, types, label]) => {
      if (!select) return;
      types.forEach((type) => {
        const option = document.createElement("option");
        option.value = type;
        option.textContent = label(type);
        select.appendChild(option);
      });
    });
  }
  const layoutClient = window.MapInBootLayout;
  const navigationClient = window.MapInBootNavigation;
  const inspectorClientType = window.MapInBootInspector;
  const requestFlowControls = document.querySelector("#request-flow-controls");
  const requestFlowStart = document.querySelector("#request-flow-start");
  const requestFlowPause = document.querySelector("#request-flow-pause");
  const requestFlowReset = document.querySelector("#request-flow-reset");
  const requestFlowStatus = document.querySelector("#request-flow-status");
  const requestFlowEducation = document.querySelector("#request-flow-education");
  const requestFlowDot = document.querySelector("#request-flow-dot");
  let noticeTimer = null;
  const state = {
    view: "all-flow",
    status: null,
    snapshot: null,
    snapshotState: "not-requested",
    error: null,
    statusError: null,
    snapshotError: null,
    graph: null,
    findingIndex: [],
    findingApiIndex: { endpointsByFinding: new Map(), findingsByEndpoint: new Map() },
    selectedFindingId: null,
    findingReturnId: null,
    detailApiId: "",
    flowIndex: null,
    viewGraph: null,
    graphRender: null,
    layout: null,
    layoutState: "not-requested",
    layoutRequestId: 0,
    layoutError: null,
    visibleGraph: null,
    filters: { query: "", nodeType: "", edgeType: "" },
    includeUnconnectedNodes: false,
    allEndpointQuery: "",
    featureEndpointQuery: "",
    featureEndpointOptionIndex: -1,
    display: { areas: true, edgeLabels: true, minimap: true },
    loading: false,
    selection: null,
    inspectorDismissed: false,
    hoverEdgeId: null,
    selectedEndpointId: null,
    viewVersion: 0,
    snapshotGeneration: 0,
    viewGraphCache: new Map(),
    layoutCache: new Map(),
    pendingViewPreparations: new Map(),
    preparingViewKey: null,
    findingModalId: null,
    findingModalTrigger: null,
    requestFlowSteps: [],
    requestFlowPositions: {},
    navigation: null
  };
  let requestFlowActiveNodeId = null;
  let requestFlowActiveNode = null;
  let requestFlowActiveRender = null;
  let handlingRequestFlowFailure = false;

  const requestFlowController = requestFlowClient && requestFlowControls
    ? requestFlowClient.createController({
      reducedMotion: Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches),
      onUpdate: renderRequestFlowSafely
    })
    : null;

  const navigation = navigationClient && graphSvg && graphViewport
    ? navigationClient.create({
      svg: graphSvg,
      viewport: graphViewport,
      surface: graphCanvas,
      minimap: document.querySelector("#graph-minimap"),
      minimapSvg: document.querySelector("#graph-minimap-svg"),
      minimapNodes: document.querySelector("#graph-minimap-nodes"),
      minimapViewport: document.querySelector("#graph-minimap-viewport"),
      zoomIn: document.querySelector("#zoom-in"),
      zoomOut: document.querySelector("#zoom-out"),
      fit: document.querySelector("#fit-graph"),
      reset: document.querySelector("#reset-view"),
      lockToggle: document.querySelector("#screen-lock-toggle")
    })
    : null;
  state.navigation = navigation;

  const inspectorClient = inspectorClientType && inspector
    ? inspectorClientType.create({
      inspector,
      findingModalTitle,
      findingModalConfidence: document.querySelector("#finding-modal-confidence"),
      findingModalRule: document.querySelector("#finding-modal-rule"),
      findingModalContent: document.querySelector("#finding-modal-content"),
      popover: graphPopover,
      surface: graphCanvas,
      onClear: clearSelection,
      onSelect: selectGraphElement,
      onOpenDetail: openEndpointDetail,
      onOpenFindingEndpoint: (endpointId) => openEndpointDetail(endpointId, state.selectedFindingId),
      onCopy: showNotice
    })
    : null;

  function executionPhaseLabel(phase) {
    return phaseNames[phase] || "확인 불가";
  }

  // SVG 표시 상태를 hidden 속성으로 동기화
  function setHidden(element, hidden) {
    if (!element) return;
    if (typeof element.toggleAttribute === "function") {
      element.toggleAttribute("hidden", Boolean(hidden));
      return;
    }
    if (hidden) element.setAttribute("hidden", "");
    else element.removeAttribute("hidden");
  }

  function setRequestFlowVisibility(visible) {
    const nextVisible = Boolean(visible);
    if (requestFlowControls) requestFlowControls.hidden = !nextVisible;
    if (requestFlowEducation) {
      setHidden(requestFlowEducation, !nextVisible);
      requestFlowEducation.setAttribute("aria-hidden", String(!nextVisible));
    }
    if (!nextVisible) {
      setRequestFlowNode(null);
      if (requestFlowDot) setHidden(requestFlowDot, true);
    }
  }

  function findRequestFlowNode(anchorId) {
    const candidates = [
      ...(graphNodes && graphNodes.children ? graphNodes.children : []),
      ...(graphFlowProjection && graphFlowProjection.children ? graphFlowProjection.children : [])
    ];
    return candidates.find((element) => {
      const identifiers = [
        element.getAttribute("data-node-id"),
        element.getAttribute("data-projection-id"),
        ...(element.getAttribute("data-node-ids") || "").split(","),
        ...(element.getAttribute("data-handler-ids") || "").split(","),
        ...(element.getAttribute("data-endpoint-ids") || "").split(",")
      ];
      return identifiers.includes(anchorId);
    }) || null;
  }

  // 재생 단계에 맞는 실제 또는 교육용 표시 Node만 부분 갱신
  function setRequestFlowNode(anchorId) {
    const render = state.graphRender;
    const nextId = anchorId || null;
    if (requestFlowActiveNodeId === nextId && requestFlowActiveRender === render) return;
    if (requestFlowActiveNode) requestFlowActiveNode.removeAttribute("data-request-flow-active");
    requestFlowActiveNodeId = nextId;
    requestFlowActiveNode = null;
    requestFlowActiveRender = render;
    if (!nextId) return;
    requestFlowActiveNode = findRequestFlowNode(nextId);
    if (requestFlowActiveNode) requestFlowActiveNode.setAttribute("data-request-flow-active", "true");
  }

  function requestFlowPath(transition) {
    if (!transition) return null;
    const layer = transition.kind === "projection" ? graphFlowProjection : graphEdges;
    const paths = Array.from(layer?.children ?? []);
    return paths.find((path) => {
      if (path.tagName !== "path" || typeof path.getTotalLength !== "function"
        || typeof path.getPointAtLength !== "function") return false;
      if (transition.kind === "projection") {
        return path.getAttribute("data-projection-edge-id") === transition.edgeId;
      }
      const ids = (path.getAttribute("data-edge-ids") || path.getAttribute("data-edge-id") || "").split(",");
      return ids.includes(transition.edgeId);
    }) || null;
  }

  // 교육용 빛 점과 현재 상태를 SVG Edge 경로에 맞춰 갱신
  function renderRequestFlowUpdate(flowState) {
    const currentState = flowState || { status: "idle", stepIndex: 0, progress: 0, step: null };
    const step = currentState.step;
    const nextStep = currentState.nextStep;
    const path = currentState.phase === "EDGE_TRAVEL" ? requestFlowPath(currentState.transition) : null;
    const point = path && requestFlowClient && requestFlowClient.pathPointAt
      ? requestFlowClient.pathPointAt(path, currentState.progress, currentState.transition.length)
      : null;
    const isPathMissing = currentState.phase === "EDGE_TRAVEL" && !point;
    const statusLabel = currentState.status === "running"
      ? currentState.phase === "NODE_HOLD" ? `진행 중 · ${step && step.label || "단계"}`
        : currentState.phase === "EDGE_TRAVEL" ? isPathMissing ? `경로 확인 불가 · ${nextStep && nextStep.label || "다음 단계"}`
          : `이동 중 · ${nextStep && nextStep.label || "다음 단계"}`
          : currentState.phase === "PATH_UNAVAILABLE" ? `경로 확인 불가 · ${nextStep && nextStep.label || "다음 단계"}`
            : currentState.phase === "STEP_NOTICE" ? `진행 중 · ${step && step.label || "확인 단계"}` : "진행 중"
      : currentState.status === "paused"
        ? currentState.phase === "EDGE_TRAVEL" && isPathMissing
          ? `일시정지 · 경로 확인 불가 · ${nextStep && nextStep.label || "다음 단계"}`
          : `일시정지 · ${currentState.phase === "EDGE_TRAVEL" ? nextStep && nextStep.label || "다음 단계" : step && step.label || "현재 단계"}`
        : currentState.status === "complete"
          ? `완료${step && step.label ? ` · ${step.label}` : ""}`
          : "시작 전";
    const message = `교육용 예시 · 실제 요청 추적 아님 · ${statusLabel}`;
    if (requestFlowStatus && requestFlowStatus.textContent !== message) requestFlowStatus.textContent = message;
    if (requestFlowStart) requestFlowStart.disabled = currentState.status === "running";
    if (requestFlowPause) requestFlowPause.disabled = currentState.status !== "running";
    if (requestFlowReset) requestFlowReset.disabled = state.requestFlowSteps.length === 0;
    const inDetail = isEndpointDetailView() && Boolean(state.selectedEndpointId || state.detailApiId);
    setRequestFlowNode(inDetail && currentState.phase === "NODE_HOLD" && step ? step.anchorId : null);
    if (!requestFlowDot || !inDetail || !step || currentState.phase !== "EDGE_TRAVEL" || !point) {
      if (requestFlowDot) setHidden(requestFlowDot, true);
      return;
    }
    requestFlowDot.setAttribute("cx", String(point.x));
    requestFlowDot.setAttribute("cy", String(point.y));
    setHidden(requestFlowDot, false);
  }

  function reportRequestFlowFailure(error) {
    state.requestFlowSteps = [];
    state.requestFlowPositions = {};
    let cause = error && error.message ? error.message : String(error || "원인 확인 불가");
    if (!handlingRequestFlowFailure) {
      handlingRequestFlowFailure = true;
      try {
        if (requestFlowController) requestFlowController.setSteps([]);
      } catch (resetError) {
        const resetCause = resetError && resetError.message ? resetError.message : String(resetError);
        cause = `${cause}; 교육용 흐름 정리 실패: ${resetCause}`;
      } finally {
        handlingRequestFlowFailure = false;
      }
    }
    try {
      setRequestFlowNode(null);
      setRequestFlowVisibility(false);
    } catch (hideError) {
      const hideCause = hideError && hideError.message ? hideError.message : String(hideError);
      cause = `${cause}; 교육용 흐름 숨김 실패: ${hideCause}`;
    }
    showNotice(`교육용 흐름 준비 실패: ${cause}`, "error");
  }

  function renderRequestFlowSafely(flowState) {
    if (handlingRequestFlowFailure) return;
    try {
      renderRequestFlowUpdate(flowState);
    } catch (error) {
      reportRequestFlowFailure(error);
    }
  }

  function resetRequestFlow() {
    state.requestFlowSteps = [];
    state.requestFlowPositions = {};
    if (requestFlowController) requestFlowController.setSteps([]);
    setRequestFlowNode(null);
    setRequestFlowVisibility(false);
  }

  function prepareRequestFlow() {
    if (!requestFlowController || !isEndpointDetailView() || !(state.selectedEndpointId || state.detailApiId)
      || !state.viewGraph || !state.layout || !requestFlowClient) {
      resetRequestFlow();
      return;
    }
    const positions = {
      ...(state.layout.positions || {}),
      ...Object.fromEntries((state.layout.plan && state.layout.plan.projection && state.layout.plan.projection.nodes || [])
        .map((node) => [node.id, node.position]))
    };
    const steps = requestFlowClient.buildSteps({
      graph: state.viewGraph,
      index: state.flowIndex,
      endpointId: isFindingDetailView() ? state.detailApiId : state.selectedEndpointId,
      positions,
      projection: state.layout.plan && state.layout.plan.projection
    });
    steps.forEach((step) => {
      if (!step.transition) return;
      const path = requestFlowPath(step.transition);
      if (!path) return;
      try {
        const length = path.getTotalLength();
        step.transition.length = Number.isFinite(length) && length > 0 ? length : null;
      } catch {
        step.transition.length = null;
      }
    });
    state.requestFlowSteps = steps;
    state.requestFlowPositions = positions;
    requestFlowController.setSteps(steps);
    setRequestFlowVisibility(true);
    renderRequestFlowSafely(requestFlowController.state());
  }

  function requestMessage(status, resource) {
    const code = typeof status === "number"
      ? status
      : typeof status === "string" && status.trim() ? Number(status) : null;
    if (code === 401) return resource === "snapshot" ? "Snapshot 인증 필요" : "인증 필요";
    if (code === 403) return resource === "snapshot" ? "Snapshot 관리자 권한 필요" : "관리자 권한 필요";
    if (code === 404) return resource === "snapshot" ? "보존 Snapshot 없음" : "상태 조회 불가";
    if (code >= 500 && code <= 599) return "서버 오류";
    if (!Number.isFinite(code) || code <= 0) return "연결 오류";
    return resource === "snapshot" ? "Snapshot 조회 실패" : "상태 조회 실패";
  }

  function errorState(error, resource) {
    const code = error && Number(error.status);
    if (!Number.isFinite(code) || code <= 0) return "connection-error";
    if (code === 404) return resource === "snapshot" ? "missing" : "status-unavailable";
    if (code === 401 || code === 403) return "denied";
    if (code >= 500 && code <= 599) return "server-error";
    return "unavailable";
  }

  function hideNotice() {
    if (noticeTimer !== null) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }
    notice.textContent = "";
    notice.dataset.kind = "";
    notice.hidden = true;
  }

  function showNotice(message, kind) {
    if (noticeTimer !== null) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }
    if (!message) {
      hideNotice();
      return;
    }
    notice.textContent = message;
    notice.dataset.kind = kind || "";
    notice.hidden = false;
    const duration = kind === "loading" ? 0 : kind === "error" ? 4800 : 2600;
    if (duration > 0) noticeTimer = setTimeout(hideNotice, duration);
  }

  function setFilterPanel(open, returnFocus = true) {
    if (!filterToggle || !filterPanel) return;
    const nextOpen = Boolean(open);
    filterPanel.hidden = !nextOpen;
    filterToggle.setAttribute("aria-expanded", String(nextOpen));
    filterToggle.setAttribute("aria-label", nextOpen ? "필터 닫기" : "필터 열기");
    filterToggle.dataset.active = String(nextOpen);
    if (nextOpen && isFindingDetailView()) renderFindingApiOptions();
    const focusTarget = isFindingDetailView() ? findingApiSelect : endpointSearch;
    if (nextOpen && focusTarget && typeof focusTarget.focus === "function") {
      focusTarget.focus();
      if (isDetailView()) renderEndpointOptions(state.featureEndpointQuery);
    }
    if (!nextOpen && returnFocus && typeof filterToggle.focus === "function") filterToggle.focus();
  }

  function isDetailView() {
    return state.view === "feature-flow";
  }

  function isFindingDetailView() {
    return state.view === "security-detail";
  }

  function isEndpointDetailView() {
    return isDetailView() || isFindingDetailView();
  }

  function endpointDetails(endpoint) {
    const endpointAttributes = endpoint && endpoint.attributes && typeof endpoint.attributes === "object"
      ? endpoint.attributes : {};
    const method = String(endpointAttributes.httpMethod || "").trim().toUpperCase();
    const path = String(endpointAttributes.path || "").trim();
    const handler = String(endpointAttributes.handler || "").trim();
    const label = `${method} ${path}`.trim()
      || (graphRenderer && graphRenderer.nodeDisplay ? graphRenderer.nodeDisplay(endpoint).primary : "이름 확인 불가");
    return { label, handler, searchText: `${label} ${handler}`.toLocaleLowerCase() };
  }

  function sortedEndpoints() {
    if (!state.graph || !Array.isArray(state.graph.nodes)) return [];
    return state.graph.nodes.filter((node) => node.type === "ENDPOINT").slice().sort((left, right) => {
      const leftDetails = endpointDetails(left);
      const rightDetails = endpointDetails(right);
      return leftDetails.label.localeCompare(rightDetails.label)
        || leftDetails.handler.localeCompare(rightDetails.handler)
        || String(left.id).localeCompare(String(right.id));
    });
  }

  // 실제 Graph 참조에서 Finding별 Endpoint 후보를 한 번 구성
  function indexFindingApis() {
    const nodesById = state.flowIndex && state.flowIndex.nodeById
      ? state.flowIndex.nodeById : new Map((state.graph && state.graph.nodes || []).map((node) => [node.id, node]));
    const edgesById = state.flowIndex && state.flowIndex.edgeById
      ? state.flowIndex.edgeById : new Map((state.graph && state.graph.edges || []).map((edge) => [edge.id, edge]));
    const endpointsByFinding = new Map();
    const findingsByEndpoint = new Map();
    const endpoints = state.flowIndex && state.flowIndex.endpoints
      ? state.flowIndex.endpoints : Array.from(nodesById.values()).filter((node) => node.type === "ENDPOINT");
    const evidence = state.snapshot && Array.isArray(state.snapshot.evidence) ? state.snapshot.evidence : [];
    const evidenceById = state.flowIndex && state.flowIndex.evidenceById
      ? state.flowIndex.evidenceById : new Map(evidence.filter((item) => item && item.id).map((item) => [item.id, item]));
    state.findingIndex.forEach((entry) => {
      const endpointIds = new Set();
      const addEndpoint = (id) => {
        const node = nodesById.get(id);
        if (node && node.type === "ENDPOINT") endpointIds.add(id);
      };
      entry.nodeIds.forEach(addEndpoint);
      entry.edgeIds.forEach((id) => {
        const edge = edgesById.get(id);
        if (!edge) return;
        addEndpoint(edge.sourceId);
        addEndpoint(edge.targetId);
      });
      if (endpointIds.size === 0) {
        const ids = Array.isArray(entry.finding.evidenceIds) ? entry.finding.evidenceIds : [];
        const findingEvidence = new Set(ids.filter((id) => evidenceById.has(id)));
        const direct = endpoints.filter((endpoint) => (endpoint.evidenceIds || []).some((id) => {
          const evidence = evidenceById.get(id);
          const attrs = endpoint.attributes || {};
          return findingEvidence.has(id) && evidence && evidence.source === "RUNTIME"
            && attrs.httpMethod && attrs.path && attrs.handler
            && evidence.summary === `등록 Endpoint: ${attrs.httpMethod} ${attrs.path}`
            && String(evidence.location || "").endsWith(`:${attrs.handler}`);
        }));
        if (direct.length === 1) addEndpoint(direct[0].id);
        if (endpointIds.size === 0 && ["STATE_BYPASS", "OBJECT_BINDING"].includes(entry.finding.ruleId)) {
          const type = entry.finding.ruleId === "STATE_BYPASS" ? "BUSINESS_SECURITY_STATE" : "AUTHORIZATION";
          const handlers = new Set(Array.from(nodesById.values()).filter((node) => node.type === type
            && node.attributes && node.attributes.handler
            && (entry.finding.ruleId === "STATE_BYPASS"
              ? node.attributes.factType === "BUSINESS_STATE_EVALUATION"
              : ["OBJECT_AUTHORIZATION_REQUIREMENT", "OBJECT_ACCESS_PATH"].includes(node.attributes.factType))
            && (node.evidenceIds || []).length > 0
            && node.evidenceIds.every((id) => findingEvidence.has(id)))
            .map((node) => node.attributes.handler));
          const matches = endpoints.filter((endpoint) => endpoint.attributes && handlers.has(endpoint.attributes.handler));
          if (handlers.size === 1 && matches.length === 1) addEndpoint(matches[0].id);
        }
      }
      const ids = Array.from(endpointIds);
      endpointsByFinding.set(entry, ids);
      ids.forEach((id) => {
        const matches = findingsByEndpoint.get(id) || [];
        matches.push(entry);
        findingsByEndpoint.set(id, matches);
      });
    });
    state.findingApiIndex = { endpointsByFinding, findingsByEndpoint };
  }

  // 실제 Node 및 직접 참조 Edge 끝점의 Endpoint만 Finding과 연결
  function findingEndpointIds(entry) {
    return entry ? state.findingApiIndex.endpointsByFinding.get(entry) || [] : [];
  }

  function findingsForEndpoint(endpointId) {
    if (!endpointId) return [];
    return state.findingApiIndex.findingsByEndpoint.get(endpointId) || [];
  }

  function renderDetailFindingList() {
    if (!detailFindingList) return;
    detailFindingList.replaceChildren();
    if (!state.detailApiId) {
      const note = document.createElement("p");
      note.setAttribute("class", "finding-api-empty");
      const selected = state.findingIndex.find((entry) => entry.finding.id === state.selectedFindingId);
      note.textContent = selected && findingEndpointIds(selected).length === 0
        ? "선택한 Finding에 확인된 API 연결이 없습니다. 근거와 가이드는 계속 확인할 수 있습니다."
        : "API를 선택하면 연결된 Finding을 볼 수 있습니다.";
      detailFindingList.appendChild(note);
      return;
    }
    const matches = findingsForEndpoint(state.detailApiId);
    if (matches.length === 0) {
      const note = document.createElement("p");
      note.setAttribute("class", "finding-api-empty");
      note.textContent = "선택한 API에 연결된 Finding이 없습니다.";
      detailFindingList.appendChild(note);
      return;
    }
    matches.forEach((entry) => {
      const button = document.createElement("button");
      button.setAttribute("type", "button");
      button.setAttribute("data-finding-id", entry.finding.id);
      button.setAttribute("aria-pressed", String(entry.finding.id === state.selectedFindingId));
      const confidence = { CONFIRMED: "확정", LIKELY: "검토 필요", UNKNOWN: "확인 불가" }[entry.finding.confidence] || "확인 불가";
      button.textContent = `${entry.finding.title || entry.finding.id} · ${entry.finding.ruleId || ""} · ${confidence}`;
      button.addEventListener("click", () => selectFinding(entry.finding.id));
      detailFindingList.appendChild(button);
    });
  }

  function renderFindingApiOptions() {
    if (!findingApiSelect || !state.graph) {
      if (detailFindingList) detailFindingList.replaceChildren();
      return;
    }
    const endpoints = sortedEndpoints();
    const linkedIds = new Set(state.findingApiIndex.findingsByEndpoint.keys());
    const candidates = endpoints.filter((endpoint) => linkedIds.has(endpoint.id));
    findingApiSelect.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = candidates.length > 0 ? "API 선택"
      : endpoints.length === 0 ? "Snapshot에 API 없음"
        : "취약점이 연결된 API 없음";
    findingApiSelect.appendChild(placeholder);
    candidates.forEach((endpoint) => {
      const option = document.createElement("option");
      const count = findingsForEndpoint(endpoint.id).length;
      option.value = endpoint.id;
      option.textContent = `${endpointDetails(endpoint).label} · Finding ${count}건`;
      findingApiSelect.appendChild(option);
    });
    findingApiSelect.value = state.detailApiId;
    renderDetailFindingList();
  }

  function applyFindingApiSelection() {
    const matches = findingsForEndpoint(state.detailApiId);
    if (matches.some((entry) => entry.finding.id === state.selectedFindingId)) {
      renderGraphView(state.layout ? "elk" : "initial", true);
      return;
    }
    state.selectedFindingId = matches.length ? matches[0].finding.id : null;
    state.selection = null;
    invalidateView();
    state.viewGraph = viewGraphForState();
    renderGraphView("initial");
    if (state.viewGraph && state.viewGraph.nodes.length > 0) void layoutGraph();
  }

  function selectedEndpoint() {
    return sortedEndpoints().find((endpoint) => endpoint.id === state.selectedEndpointId) || null;
  }

  function setEndpointInputValue(endpoint) {
    if (!endpointSearch) return;
    endpointSearch.value = endpoint ? endpointDetails(endpoint).label : "";
  }

  function closeEndpointOptions() {
    state.featureEndpointOptionIndex = -1;
    if (endpointOptions) {
      setHidden(endpointOptions, true);
      endpointOptions.replaceChildren();
      endpointOptions.removeAttribute("aria-activedescendant");
    }
    if (endpointSearch) endpointSearch.setAttribute("aria-expanded", "false");
  }

  // 기능별 상세 API 선택 목록을 실제 Snapshot Endpoint에서 구성
  function renderEndpointOptions(query = "") {
    if (!endpointOptions || !isDetailView()) return;
    const term = String(query || "").trim().toLocaleLowerCase();
    const matches = sortedEndpoints().filter((endpoint) => endpointDetails(endpoint).searchText.includes(term));
    endpointOptions.replaceChildren();
    setHidden(endpointOptions, false);
    if (endpointSearch) endpointSearch.setAttribute("aria-expanded", "true");
    if (matches.length === 0) {
      const empty = document.createElement("div");
      empty.setAttribute("class", "endpoint-options-empty");
      empty.setAttribute("role", "option");
      empty.setAttribute("aria-disabled", "true");
      empty.textContent = sortedEndpoints().length === 0 ? "Snapshot에 Endpoint가 없습니다." : "검색 결과가 없습니다.";
      endpointOptions.appendChild(empty);
      return;
    }
    matches.forEach((endpoint, index) => {
      const details = endpointDetails(endpoint);
      const option = document.createElement("div");
      option.setAttribute("class", "endpoint-option");
      option.setAttribute("role", "option");
      option.setAttribute("id", `endpoint-option-${endpoint.id}`);
      option.setAttribute("aria-selected", String(endpoint.id === state.selectedEndpointId));
      option.setAttribute("data-active", String(index === state.featureEndpointOptionIndex));
      option.dataset.endpointId = endpoint.id;
      option.tabIndex = -1;
      const label = document.createElement("span");
      label.textContent = details.label;
      option.appendChild(label);
      if (details.handler) {
        const detail = document.createElement("span");
        detail.setAttribute("class", "endpoint-option-detail");
        detail.textContent = details.handler;
        option.appendChild(detail);
      }
      option.addEventListener("click", () => selectEndpointOption(endpoint.id));
      endpointOptions.appendChild(option);
    });
  }

  function ensureFeatureEndpoint() {
    const endpoints = sortedEndpoints();
    if (state.selectedEndpointId && endpoints.some((endpoint) => endpoint.id === state.selectedEndpointId)) return;
    const endpoint = endpoints[0] || null;
    state.selectedEndpointId = endpoint ? endpoint.id : null;
    setEndpointInputValue(endpoint);
  }

  function applyFilterView() {
    const detail = isDetailView();
    const findingDetail = isFindingDetailView();
    if (unconnectedNodeField) setHidden(unconnectedNodeField, state.view !== "all-flow");
    if (includeUnconnectedNodes) includeUnconnectedNodes.checked = state.includeUnconnectedNodes;
    if (findingFields) setHidden(findingFields, state.view !== "security-flow");
    if (findingApiFields) setHidden(findingApiFields, !findingDetail);
    if (filterPanel) {
      filterPanel.dataset.view = state.view;
      filterPanel.setAttribute("aria-label", {
        "all-flow": "전체 Flow Map 필터",
        "feature-flow": "기능별 상세 API 선택",
        "security-flow": "취약점 MAP 필터",
        "security-detail": "상세 취약점 API 선택"
      }[state.view]);
    }
    if (searchReset) searchReset.textContent = detail ? "API 검색 초기화"
      : findingDetail ? "API 선택 초기화"
        : state.view === "security-flow" ? "취약점 필터 초기화" : "검색 초기화";
    if (endpointFilterLabel) {
      endpointFilterLabel.textContent = detail ? "API 선택" : "Endpoint 검색";
      setHidden(endpointFilterLabel, findingDetail);
    }
    if (endpointFilter) setHidden(endpointFilter, findingDetail);
    if (endpointSearch) {
      endpointSearch.setAttribute("placeholder", detail ? "Method·Path·Handler 검색" : "Method·Path·Handler");
      endpointSearch.setAttribute("type", detail ? "text" : "search");
      if (detail) {
        endpointSearch.setAttribute("role", "combobox");
        endpointSearch.setAttribute("aria-autocomplete", "list");
        endpointSearch.setAttribute("aria-controls", "endpoint-options");
        endpointSearch.setAttribute("aria-expanded", "false");
        setEndpointInputValue(selectedEndpoint());
      } else {
        endpointSearch.value = state.allEndpointQuery;
        endpointSearch.removeAttribute("role");
        endpointSearch.setAttribute("aria-expanded", "false");
        closeEndpointOptions();
      }
    }
    if (nodeFilterField) setHidden(nodeFilterField, detail || findingDetail);
    if (edgeFilterField) setHidden(edgeFilterField, detail || findingDetail);
    if (findingDetail) renderFindingApiOptions();
  }

  function selectEndpointOption(endpointId) {
    const endpoint = sortedEndpoints().find((item) => item.id === endpointId);
    if (!endpoint) return null;
    state.selectedEndpointId = endpoint.id;
    state.selection = null;
    state.inspectorDismissed = true;
    state.featureEndpointQuery = "";
    setEndpointInputValue(endpoint);
    closeEndpointOptions();
    if (!isDetailView()) {
      selectView("feature-flow");
      state.inspectorDismissed = true;
      return endpoint;
    }
    invalidateView();
    state.viewGraph = viewGraphForState();
    renderGraphView("initial");
    if (state.viewGraph && state.viewGraph.nodes.length > 0) void layoutGraph();
    return endpoint;
  }

  function invalidateView() {
    state.viewVersion += 1;
    state.layoutRequestId += 1;
    state.layout = null;
    state.layoutState = "not-requested";
    state.layoutError = null;
    state.graphRender = null;
    if (graphCanvas) graphCanvas.dataset.layoutState = "not-requested";
    resetRequestFlow();
  }

  function cacheGet(cache, key) {
    if (!cache.has(key)) return null;
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
  }

  function cacheSet(cache, key, value, limit) {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > limit) cache.delete(cache.keys().next().value);
    return value;
  }

  function sameGraphItems(left, right) {
    return left.length === right.length && left.every((item, index) => item.id === right[index].id);
  }

  function currentViewGraphKey() {
    const viewSelection = isDetailView() ? state.selectedEndpointId
      : isFindingDetailView() ? state.detailApiId || `finding:${state.selectedFindingId || "none"}` : "";
    return `${state.snapshotGeneration}|${state.view}|${viewSelection}|${state.view === "all-flow" && state.includeUnconnectedNodes}`;
  }

  function hydratePreparedView(result) {
    const nodes = result.nodeIds.map((id) => state.flowIndex.nodeById.get(id)).filter(Boolean);
    const edges = result.edgeIds.map((id) => state.flowIndex.edgeById.get(id)).filter(Boolean);
    const viewGraph = {
      ...state.graph,
      nodes,
      edges,
      invalidNodes: 0,
      invalidEdges: 0,
      filters: { query: "", nodeType: "", edgeType: "" }
    };
    if (result.task === "connectedGraph") {
      viewGraph.unconnectedNodeCount = result.unconnectedNodeCount;
      return viewGraph;
    }
    const match = result.match || {};
    const handler = result.handler || {};
    viewGraph.sourceGraph = state.graph;
    viewGraph.endpointId = result.endpointId;
    viewGraph.index = state.flowIndex;
    viewGraph.match = {
      status: match.status,
      reason: match.reason,
      chain: match.chainId ? state.flowIndex.nodeById.get(match.chainId) || null : null,
      edge: match.edgeId ? state.flowIndex.edgeById.get(match.edgeId) || null : null
    };
    viewGraph.handler = {
      status: handler.status,
      reason: handler.reason,
      node: handler.nodeId ? state.flowIndex.nodeById.get(handler.nodeId) || null : null
    };
    viewGraph.securityFilters = (result.securityFilterIds || [])
      .map((id) => state.flowIndex.nodeById.get(id)).filter(Boolean);
    viewGraph.relationIds = edges.map((edge) => edge.id);
    return viewGraph;
  }

  function requestPreparedView(key, task, endpointId) {
    if (state.pendingViewPreparations.has(key) || !layoutClient || !layoutClient.prepareGraph) return;
    const generation = state.snapshotGeneration;
    state.preparingViewKey = key;
    const request = layoutClient.prepareGraph(state.graph, generation, key, task, endpointId);
    state.pendingViewPreparations.set(key, request);
    request.then((result) => {
      state.pendingViewPreparations.delete(key);
      if (generation !== state.snapshotGeneration) return;
      if (result.generation !== generation || result.viewKey !== key || result.stale || result.task !== task) {
        if (currentViewGraphKey() === key) throw new Error("Graph 전처리 결과가 요청과 일치하지 않습니다.");
        if (state.preparingViewKey === key) state.preparingViewKey = null;
        return;
      }
      const graph = hydratePreparedView(result);
      cacheSet(state.viewGraphCache, key, graph, 12);
      if (currentViewGraphKey() !== key) {
        if (state.preparingViewKey === key) state.preparingViewKey = null;
        return;
      }
      state.preparingViewKey = null;
      state.viewGraph = graph;
      renderGraphView("initial");
      if (graph.nodes.length > 0) void layoutGraph();
    }).catch(() => {
      state.pendingViewPreparations.delete(key);
      if (generation !== state.snapshotGeneration) return;
      const graph = task === "connectedGraph"
        ? flowClient.deriveConnectedGraph(state.graph, state.flowIndex)
        : flowClient.deriveEndpointGraph(state.graph, endpointId, state.flowIndex);
      cacheSet(state.viewGraphCache, key, graph, 12);
      if (currentViewGraphKey() !== key) {
        if (state.preparingViewKey === key) state.preparingViewKey = null;
        return;
      }
      state.preparingViewKey = null;
      state.viewGraph = graph;
      renderGraphView("initial");
      if (graph.nodes.length > 0) void layoutGraph();
    });
  }

  function viewGraphForState() {
    if (!state.graph) return null;
    const key = currentViewGraphKey();
    const cached = cacheGet(state.viewGraphCache, key);
    if (cached) return cached;
    const threshold = layoutClient && layoutClient.preprocessThreshold || 2400;
    const endpointId = isDetailView() ? state.selectedEndpointId : isFindingDetailView() ? state.detailApiId : "";
    const endpoint = endpointId && state.flowIndex && state.flowIndex.nodeById.get(endpointId);
    if (state.graph.nodes.length >= threshold
      && state.view === "all-flow" && !state.includeUnconnectedNodes && flowClient && flowClient.deriveConnectedGraph) {
      requestPreparedView(key, "connectedGraph", "");
      return null;
    }
    if (state.graph.nodes.length >= threshold && endpoint && endpoint.type === "ENDPOINT"
      && (isDetailView() || isFindingDetailView()) && flowClient && flowClient.deriveEndpointGraph) {
      requestPreparedView(key, "endpointGraph", endpointId);
      return null;
    }
    let graph;
    if (state.view === "all-flow") {
      graph = state.includeUnconnectedNodes || !flowClient || !flowClient.deriveConnectedGraph
        ? state.graph
        : flowClient.deriveConnectedGraph(state.graph, state.flowIndex);
    } else if (isFindingDetailView()) {
      const endpoint = state.flowIndex && state.flowIndex.nodeById.get(state.detailApiId);
      if (!endpoint || endpoint.type !== "ENDPOINT" || !flowClient || !flowClient.deriveEndpointGraph) return null;
      graph = flowClient.deriveEndpointGraph(state.graph, endpoint.id, state.flowIndex);
    } else if (isDetailView()) {
      if (!state.selectedEndpointId || !flowClient || !flowClient.deriveEndpointGraph) return null;
      graph = flowClient.deriveEndpointGraph(state.graph, state.selectedEndpointId, state.flowIndex);
    } else {
      graph = state.graph;
    }
    return cacheSet(state.viewGraphCache, key, graph, 12);
  }

  function detailMatchChainId() {
    if (!isDetailView() || !state.selectedEndpointId || !state.flowIndex) return null;
    const match = state.flowIndex.firstMatchedChain(state.selectedEndpointId);
    return match.status === "CONFIRMED" ? match.chain.id : null;
  }

  function selectView(view, preserveFeatureSelection = false) {
    if (!viewNames[view]) return;
    const viewChanged = state.view !== view;
    if (viewChanged && navigation) navigation.setLocked(false);
    if (viewChanged) state.inspectorDismissed = false;
    if (view !== "security-detail") closeFindingModal(false);
    if (view === "security-flow" || view === "security-detail") {
      if (state.findingReturnId && state.findingIndex.some((item) => item.finding.id === state.findingReturnId)) {
        state.selectedFindingId = state.findingReturnId;
      }
      state.findingReturnId = null;
    }
    state.view = view;
    if (view === "security-detail") {
      const selected = state.findingIndex.find((entry) => entry.finding.id === state.selectedFindingId);
      if (selected) {
        const ids = findingEndpointIds(selected);
        if (!ids.includes(state.detailApiId)) state.detailApiId = ids[0] || "";
      } else {
        const first = sortedEndpoints().find((endpoint) => findingsForEndpoint(endpoint.id).length);
        state.detailApiId = first ? first.id : "";
        const matches = findingsForEndpoint(state.detailApiId);
        state.selectedFindingId = matches.length ? matches[0].finding.id : state.findingIndex[0]?.finding.id || null;
      }
    }
    if (!isDetailView()) {
      state.selectedEndpointId = null;
      state.selection = null;
    } else {
      if (viewChanged && view === "feature-flow" && !preserveFeatureSelection) state.selection = null;
      ensureFeatureEndpoint();
    }
    applyFilterView();
    if (isFindingDetailView()) setFilterPanel(false, false);
    invalidateView();
    state.viewGraph = viewGraphForState();
    title.textContent = viewNames[view];
    renderStatus();
    document.querySelectorAll(".header-nav-item").forEach((item) => {
      const active = item.dataset.view === view;
      item.classList.toggle("is-active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
    renderGraphView("initial");
    if (state.viewGraph && state.viewGraph.nodes.length > 0) void layoutGraph();
    if (navigation) navigation.apply();
  }

  // 선택 Endpoint의 실제 상세 MAP으로 명시적 진입
  function openEndpointDetail(endpointId, returnFindingId = null) {
    const endpoint = graphElement("node", endpointId);
    if (!endpoint || endpoint.type !== "ENDPOINT") return null;
    state.findingReturnId = returnFindingId;
    state.selectedEndpointId = endpointId;
    state.selection = { kind: "node", id: endpointId };
    state.inspectorDismissed = false;
    selectView("feature-flow", true);
    return state.viewGraph;
  }

  function returnToAllMap() {
    state.selectedEndpointId = null;
    state.selection = null;
    selectView("all-flow");
  }

  function applyDisplaySettings() {
    if (graphAreas) setHidden(graphAreas, !state.display.areas);
    if (graphFlowProjection) setHidden(graphFlowProjection, !state.display.areas);
    if (graphGuides) setHidden(graphGuides, !state.display.areas);
    if (graphCanvas) graphCanvas.dataset.showEdgeLabels = String(state.display.edgeLabels);
    if (navigation && navigation.setMiniMapVisible) navigation.setMiniMapVisible(state.display.minimap);
  }

  function setPanel(panel, button, open) {
    if (!panel || !button) return;
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  }

  function closeHeaderPanels() {
    setPanel(helpPanel, helpButton, false);
    setPanel(settingsPanel, settingsButton, false);
  }

  function toggleHeaderPanel(panel, button, otherPanel, otherButton) {
    const open = Boolean(panel && panel.hidden);
    setPanel(otherPanel, otherButton, false);
    setPanel(panel, button, open);
  }

  function capturedTime(value) {
    if (!value) return "조회 전";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("ko-KR");
  }

  function snapshotLabel() {
    if (state.statusError) return requestMessage(state.statusError.status, "status");
    if (state.snapshotState === "loaded") return "보존 Snapshot 있음";
    if (state.snapshotState === "missing") return "보존 Snapshot 없음";
    if (state.snapshotState === "loading") return "Snapshot 조회 중";
    if (state.snapshotState === "server-error") return "Snapshot 서버 오류";
    if (state.snapshotState === "connection-error") return "Snapshot 연결 오류";
    if (state.snapshotState === "status-unavailable") return "상태 조회 불가";
    if (state.snapshotState === "unavailable") return "Snapshot 확인 불가";
    if (state.snapshotState === "denied") return "Snapshot 접근 제한";
    return "Snapshot 조회 전";
  }

  function renderStatus() {
    const phase = state.status ? executionPhaseLabel(state.status.phase) : "조회 전";
    const phaseCode = state.status ? String(state.status.phase || "").toLowerCase() : "unavailable";
    const errorCode = state.status && state.status.errorCode ? ` · 오류 코드 ${state.status.errorCode}` : "";
    viewState.textContent = `${phase} · ${snapshotLabel()}${errorCode}`;
    viewState.dataset.state = phaseCode;
    graphCanvas.dataset.graphState = state.snapshotState;
    if (state.snapshotState === "loaded") {
      graphStateMessage.textContent = "보존 Snapshot 조회 완료 · Graph 표시 준비 중.";
      return;
    }
    if (state.snapshotError) {
      graphStateMessage.textContent = requestMessage(state.snapshotError.status, "snapshot");
      return;
    }
    if (state.error) {
      graphStateMessage.textContent = requestMessage(state.error.status, "status");
      return;
    }
    if (state.status && state.status.phase === "PARTIAL") {
      graphStateMessage.textContent = "분석이 부분 완료되어 확인 가능한 보존 결과만 표시합니다.";
      return;
    }
    graphStateMessage.textContent = state.status ? "보존 Snapshot이 없습니다." : "Snapshot 조회 후 Graph를 표시합니다.";
  }

  function resetGraph(message) {
    closeFindingModal(false);
    resetRequestFlow();
    state.graph = null;
    state.findingIndex = [];
    state.findingApiIndex = { endpointsByFinding: new Map(), findingsByEndpoint: new Map() };
    state.selectedFindingId = null;
    state.findingReturnId = null;
    state.detailApiId = "";
    if (findingApiSelect) findingApiSelect.replaceChildren();
    if (detailFindingList) detailFindingList.replaceChildren();
    if (findingList) findingList.replaceChildren();
    state.flowIndex = null;
    state.viewGraph = null;
    state.graphRender = null;
    state.visibleGraph = null;
    state.selection = null;
    state.selectedEndpointId = null;
    state.viewVersion += 1;
    state.layoutRequestId += 1;
    state.layout = null;
    state.layoutState = "not-requested";
    if (navigation) navigation.setGraph(null);
    if (inspectorClient) {
      inspectorClient.hideHover();
      inspectorClient.render({ graph: null, visibleGraph: null, snapshot: state.snapshot, selection: null });
    }
    if (graphFlowProjection) graphFlowProjection.replaceChildren();
    if (graphGuides) graphGuides.replaceChildren();
    if (graphFindingSections) graphFindingSections.replaceChildren();
    if (graphFindingSectionTitles) graphFindingSectionTitles.replaceChildren();
    if (graphSvg) setHidden(graphSvg, true);
    if (graphEmpty) graphEmpty.hidden = false;
    if (filterStatus) filterStatus.textContent = "Graph 없음";
    if (message) graphStateMessage.textContent = message;
  }

  function filterValues() {
    if (isDetailView() || isFindingDetailView()) return { query: "", nodeType: "", edgeType: "" };
    return {
      query: endpointSearch ? endpointSearch.value : "",
      nodeType: nodeFilter ? nodeFilter.value : "",
      edgeType: edgeFilter ? edgeFilter.value : ""
    };
  }

  function findingImpact(entry, graph) {
    if (!entry || !graph) return { nodeIds: [], edgeIds: [] };
    const graphNodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const graphEdges = new Map(graph.edges.map((edge) => [edge.id, edge]));
    const nodeIds = new Set(entry.nodeIds.filter((id) => graphNodes.has(id)));
    const edgeIds = new Set(entry.edgeIds.filter((id) => graphEdges.has(id)));
    edgeIds.forEach((id) => {
      const edge = graphEdges.get(id);
      if (graphNodes.has(edge.sourceId)) nodeIds.add(edge.sourceId);
      if (graphNodes.has(edge.targetId)) nodeIds.add(edge.targetId);
    });
    if (nodeIds.size === 0 && edgeIds.size === 0 && findingEndpointIds(entry).includes(state.detailApiId)
      && graphNodes.has(state.detailApiId)) nodeIds.add(state.detailApiId);

    if (nodeIds.size === 0 && edgeIds.size === 0) {
      const endpoint = graphNodes.get(state.detailApiId);
      const handler = endpoint && endpoint.attributes && endpoint.attributes.handler;
      const evidenceIds = new Set(Array.isArray(entry.finding.evidenceIds) ? entry.finding.evidenceIds : []);
      if (handler && evidenceIds.size > 0 && ["STATE_BYPASS", "OBJECT_BINDING"].includes(entry.finding.ruleId)) {
        const type = entry.finding.ruleId === "STATE_BYPASS" ? "BUSINESS_SECURITY_STATE" : "AUTHORIZATION";
        const factTypes = entry.finding.ruleId === "STATE_BYPASS"
          ? ["BUSINESS_STATE_EVALUATION"] : ["OBJECT_AUTHORIZATION_REQUIREMENT", "OBJECT_ACCESS_PATH"];
        const candidates = graph.nodes.filter((node) => node.type === type
          && node.attributes && node.attributes.handler === handler && factTypes.includes(node.attributes.factType)
          && Array.isArray(node.evidenceIds) && node.evidenceIds.length > 0
          && node.evidenceIds.every((id) => evidenceIds.has(id)));
        if (candidates.length === 1) nodeIds.add(candidates[0].id);
      }
      if (nodeIds.size === 0 && edgeIds.size === 0 && entry.finding.ruleId === "FILTER_ORDER"
        && graph.match && graph.match.status === "CONFIRMED" && state.flowIndex) {
        const registered = state.flowIndex.securityFiltersForChain(graph.match.chain.id);
        const candidates = registered.edges.filter((edge) => {
          const filter = state.flowIndex.nodeById.get(edge.targetId);
          const relatedEvidence = new Set([...(edge.evidenceIds || []), ...(filter && filter.evidenceIds || [])]);
          const order = filter && state.flowIndex.filterOrderInfo(edge, filter);
          return filter && filter.attributes.registrationKind === "SECURITY"
            && order && order.status !== "UNKNOWN"
            && Array.from(evidenceIds).some((id) => relatedEvidence.has(id));
        });
        if (candidates.length === 1) {
          edgeIds.add(candidates[0].id);
          nodeIds.add(candidates[0].sourceId);
          nodeIds.add(candidates[0].targetId);
        }
      }
    }
    return {
      nodeIds: graph.nodes.filter((node) => nodeIds.has(node.id)).map((node) => node.id),
      edgeIds: graph.edges.filter((edge) => edgeIds.has(edge.id)).map((edge) => edge.id)
    };
  }

  function findingSectionsForState(graph = state.viewGraph) {
    if (!isFindingDetailView() || !state.detailApiId || !graph) return [];
    return findingsForEndpoint(state.detailApiId).map((entry) => ({
      finding: entry.finding,
      ...findingImpact(entry, graph),
      selected: entry.finding.id === state.selectedFindingId
    })).filter((section) => section.nodeIds.length > 0);
  }

  function modalFocusableElements() {
    if (!findingModal) return [];
    const found = [];
    const visit = (element) => {
      const tag = String(element.tagName || "").toLowerCase();
      const tabIndex = element.getAttribute && element.getAttribute("tabindex");
      const focusable = ["button", "input", "select", "textarea", "a"].includes(tag)
        || tabIndex !== null && Number(tabIndex) >= 0;
      if (focusable && !element.disabled && !element.hidden) found.push(element);
      for (const child of Array.from(element.children || [])) visit(child);
    };
    visit(findingModal);
    return found;
  }

  function findingTrigger(id) {
    const roots = [graphFindingSections, graphFindingSectionTitles, graphNodes, graphEdges, detailFindingList, findingList];
    const search = (element) => {
      if (!element) return null;
      if (element.getAttribute && element.getAttribute("data-finding-id") === id) return element;
      for (const child of element.children || []) {
        const match = search(child);
        if (match) return match;
      }
      return null;
    };
    for (const root of roots) {
      const match = search(root);
      if (match) return match;
    }
    return null;
  }

  function closeFindingModal(restoreFocus = true) {
    if (!findingModal || findingModal.hidden) return;
    findingModal.hidden = true;
    const findingId = state.findingModalId;
    const trigger = state.findingModalTrigger && state.findingModalTrigger.parentNode
      ? state.findingModalTrigger : findingTrigger(findingId);
    state.findingModalId = null;
    state.findingModalTrigger = null;
    if (restoreFocus && trigger && typeof trigger.focus === "function") trigger.focus();
  }

  function openFindingModal(id, trigger = null, focus = true) {
    const entry = state.findingIndex.find((item) => item.finding.id === id);
    if (!findingModal || !inspectorClient || !entry) return null;
    state.findingModalId = id;
    state.findingModalTrigger = trigger && trigger.parentNode ? trigger : findingTrigger(id) || state.findingModalTrigger || null;
    const scope = findingImpact(entry, isFindingDetailView() ? state.viewGraph : state.graph);
    const endpoint = state.flowIndex && state.flowIndex.nodeById.get(state.detailApiId);
    inspectorClient.renderFindingModal({
      graph: state.graph,
      snapshot: state.snapshot,
      entry,
      apiLabel: endpoint ? endpointDetails(endpoint).label : "",
      nodeIds: scope.nodeIds,
      edgeIds: scope.edgeIds,
      onOpenEndpoint: (endpointId) => openEndpointDetail(endpointId, id)
    });
    findingModal.setAttribute("role", "dialog");
    findingModal.setAttribute("aria-modal", "true");
    findingModal.setAttribute("aria-labelledby", "finding-modal-title");
    findingModal.hidden = false;
    if (focus && findingModalClose && typeof findingModalClose.focus === "function") findingModalClose.focus();
    return entry;
  }

  function selectFinding(id, trigger = null) {
    const entry = state.findingIndex.find((item) => item.finding.id === id);
    if (!entry) return;
    const wasFindingDetail = isFindingDetailView();
    const previousApiId = state.detailApiId;
    const previousFindingId = state.selectedFindingId;
    const hadSelection = Boolean(state.selection);
    const endpointIds = findingEndpointIds(entry);
    if (!endpointIds.includes(state.detailApiId)) state.detailApiId = endpointIds[0] || "";
    state.selectedFindingId = id;
    state.findingReturnId = null;
    state.selection = null;
    if (endpointIds.length === 0 && !wasFindingDetail) {
      if (previousFindingId !== id || hadSelection) renderGraphView(state.layout ? "elk" : "initial", true);
      openFindingModal(id, trigger);
      return;
    }
    if (wasFindingDetail && previousApiId === state.detailApiId) {
      if (previousFindingId !== id || hadSelection) renderGraphView(state.layout ? "elk" : "initial", true);
      openFindingModal(id, trigger);
      return;
    }
    selectView("security-detail");
    openFindingModal(id, trigger);
  }

  // 위치가 없거나 현재 필터에 가려진 Finding 접근 경로
  function renderFindingList(findings, visibleGraph) {
    if (!findingList) return;
    findingList.replaceChildren();
    findings.forEach((entry) => {
      if (!entry.unlocated && !entry.missing) return;
      const button = document.createElement("button");
      button.setAttribute("type", "button");
      button.setAttribute("data-finding-id", entry.finding.id);
      const confidence = { CONFIRMED: "확정", LIKELY: "검토 필요", UNKNOWN: "확인 불가" }[entry.finding.confidence] || "확인 불가";
      button.textContent = `${entry.finding.title || entry.finding.id} · ${entry.finding.ruleId || ""} · ${confidence} · 연결 위치 확인 불가`;
      button.addEventListener("click", () => selectFinding(entry.finding.id));
      findingList.appendChild(button);
    });
    if (state.view === "security-flow" && state.findingIndex.length === 0) {
      findingList.textContent = state.snapshot && Array.isArray(state.snapshot.findings)
        ? "보존된 Finding 없음" : "Finding 데이터 확인 불가";
    } else if (findings.some((entry) => entry.unlocated || entry.missing)) {
      const note = document.createElement("p");
      note.textContent = "연결 위치 확인 여부는 판단 신뢰도와 무관합니다.";
      findingList.appendChild(note);
    }
  }

  function graphElement(kind, id) {
    if (!state.graph || !id) return null;
    if (kind === "controller-group") {
      const groups = displayGroups();
      return Array.isArray(groups) ? groups.find((group) => group.id === id) || null : null;
    }
    const collection = kind === "node" ? state.graph.nodes : kind === "edge" ? state.graph.edges : [];
    return collection.find((item) => item.id === id) || null;
  }

  function displayGroups() {
    const plan = state.layout && state.layout.plan;
    if (!plan || isDetailView() || isFindingDetailView()) return [];
    return (plan.controllerGroups || []).concat(plan.displayModel ? plan.displayModel.groups : []);
  }

  function clearSelection() {
    state.selection = null;
    state.inspectorDismissed = true;
    if (inspectorClient) inspectorClient.hideHover();
    if (inspectorClient && inspectorClient.close) inspectorClient.close();
    try {
      if (state.viewGraph && state.viewGraph.nodes.length > 0) {
        renderGraphView(state.layout ? "elk" : "initial", true);
      } else if (isFindingDetailView()) {
        renderGraphView("initial");
      }
    } catch (error) {
      const cause = error && error.message ? error.message : "원인 확인 불가";
      showNotice(`Graph 표시 갱신 실패: ${cause}`, "error");
    }
  }

  function selectGraphElement(kind, id) {
    let selectedKind = kind;
    let selectedId = id;
    if (isFindingDetailView() && kind === "node") {
      const group = displayGroups().find((candidate) =>
        (candidate.nodeIds || []).includes(id) || (candidate.handlerIds || []).includes(id));
      if (group) {
        selectedKind = "controller-group";
        selectedId = group.id;
      }
    }
    const item = graphElement(selectedKind, selectedId);
    if (!item) return null;
    if (selectedKind === "node" && item.type === "ENDPOINT" && isDetailView()
      && state.selectedEndpointId !== item.id) return openEndpointDetail(item.id);
    state.selection = { kind: selectedKind, id: selectedId };
    state.inspectorDismissed = false;
    if (inspectorClient) inspectorClient.hideHover();
    renderGraphView(state.layout ? "elk" : "initial", true);
    return state.selection;
  }

  function showGraphHover(kind, id, anchor) {
    if (!inspectorClient || !(state.viewGraph || state.graph)) return;
    inspectorClient.showHover({ graph: state.viewGraph || state.graph, snapshot: state.snapshot, kind, id, anchor });
  }

  function hideGraphHover() {
    if (inspectorClient) inspectorClient.hideHover();
  }

  function setInspectorTab(tab) {
    if (inspectorClient) inspectorClient.setTab(tab);
  }

  // 보존 Snapshot과 Finding 목록의 빈 상태를 구분
  function findingPrompt() {
    if (state.snapshotState === "loaded") {
      if (!state.snapshot || !Array.isArray(state.snapshot.findings)) {
        return { title: "Finding 데이터 확인 불가", description: "보존 Snapshot에서 Finding 목록을 확인할 수 없습니다." };
      }
      if (state.snapshot.findings.length === 0) {
        return { title: "보존된 Finding 없음", description: "보존 Snapshot에 Finding이 없습니다." };
      }
      if (isFindingDetailView() && state.detailApiId && findingsForEndpoint(state.detailApiId).length === 0) {
        return { title: "연결 Finding 없음", description: "선택한 API에 연결된 Finding이 없습니다." };
      }
      if (isFindingDetailView() && !state.selectedFindingId) {
        const linkedApis = state.findingIndex.some((entry) => findingEndpointIds(entry).length > 0);
        return linkedApis
          ? { title: "Finding 선택 필요", description: state.detailApiId
            ? "선택한 API에 연결된 Finding을 선택하세요."
            : "취약점 연결 API를 선택하거나 보안 MAP에서 Finding을 선택하세요." }
          : { title: "연결 API 없음", description: "실제 Finding에 연결된 API가 없습니다. 보안 MAP에서 Finding의 근거를 확인하세요." };
      }
      return { title: "Finding 선택 필요", description: "보안 MAP에서 확인할 Finding을 선택하세요." };
    }
    if (state.snapshotState === "missing") {
      return { title: "보존 Snapshot 없음", description: "보존된 Snapshot이 없어 Finding을 확인할 수 없습니다." };
    }
    if (state.snapshotError) {
      return { title: "Finding 조회 실패", description: requestMessage(state.snapshotError.status, "snapshot") };
    }
    if (state.statusError || state.error) {
      return { title: "Finding 조회 실패", description: requestMessage(state.statusError?.status, "status") };
    }
    return { title: "Finding 조회 전", description: "보존 Snapshot을 확인한 뒤 Finding을 선택할 수 있습니다." };
  }

  function renderGraphView(layoutMode, selectionOnly = false) {
    if (isFindingDetailView()) renderFindingApiOptions();
    const previousGraph = state.visibleGraph;
    const viewGraph = viewGraphForState();
    state.viewGraph = viewGraph;
    const currentFilters = filterValues();
    const positions = state.layout
      ? state.layout.positions
      : state.graphRender && state.graphRender.positions;
    const findings = state.view === "security-flow" ? state.findingIndex.filter(({ finding }) =>
      (!findingRule || !findingRule.value || finding.ruleId === findingRule.value)
      && (!findingConfidence || !findingConfidence.value || finding.confidence === findingConfidence.value)) : [];
    if (!viewGraph || viewGraph.nodes.length === 0) {
      const emptyGraph = viewGraph || {
        nodes: [],
        edges: [],
        invalidNodes: 0,
        invalidEdges: 0,
        filters: { query: "", nodeType: "", edgeType: "" }
      };
      state.visibleGraph = emptyGraph;
      renderFindingList(findings, emptyGraph);
      state.filters = emptyGraph.filters || { query: "", nodeType: "", edgeType: "" };
      state.selection = null;
      state.graphRender = null;
      setRequestFlowNode(null);
      if (graphAreas) graphAreas.replaceChildren();
      if (graphFlowProjection) graphFlowProjection.replaceChildren();
      if (graphGuides) graphGuides.replaceChildren();
      if (graphFindingSections) graphFindingSections.replaceChildren();
      if (graphFindingSectionTitles) graphFindingSectionTitles.replaceChildren();
      if (graphEdges) graphEdges.replaceChildren();
      if (graphNodes) graphNodes.replaceChildren();
      if (inspectorClient) {
        if (isFindingDetailView()) {
          inspectorClient.renderFinding({
            graph: state.graph,
            snapshot: state.snapshot,
            entry: state.findingIndex.find((item) => item.finding.id === state.selectedFindingId) || null,
            emptyPrompt: findingPrompt(),
            onReturn: () => selectView("security-flow"),
            onOpenEndpoint: (endpointId) => openEndpointDetail(endpointId, state.selectedFindingId),
            dismissed: state.inspectorDismissed
          });
        } else {
          inspectorClient.render({
            graph: viewGraph || state.graph,
            visibleGraph: emptyGraph,
            snapshot: state.snapshot,
            selection: null
          });
        }
      }
      if (navigation) navigation.setGraph(emptyGraph, {}, null);
      if (filterStatus) filterStatus.textContent = isFindingDetailView()
        ? state.preparingViewKey === currentViewGraphKey() ? "Graph 관계 계산 중"
          : state.selectedFindingId ? "확인된 연결 API 없음" : "Finding 선택 필요"
        : isDetailView() ? "Endpoint 선택 필요" : "Graph 없음";
      graphEmpty.hidden = false;
      setHidden(graphSvg, true);
      if (requestFlowController) renderRequestFlowSafely(requestFlowController.state());
      if (isFindingDetailView()) {
        if (state.preparingViewKey === currentViewGraphKey()) graphStateMessage.textContent = "선택한 API의 실제 Graph 관계를 준비하고 있습니다.";
        else if (state.selectedFindingId) graphStateMessage.textContent = "확인된 API가 없어 전체 처리 Flow를 표시하지 않습니다. Finding 근거는 상세 창에서 확인할 수 있습니다.";
        else graphStateMessage.textContent = findingPrompt().description;
      } else if (isDetailView() && !state.selectedEndpointId) {
        graphStateMessage.textContent = "선택할 수 있는 Endpoint가 없습니다.";
      } else if (isDetailView()) {
        graphStateMessage.textContent = "선택한 Endpoint의 실제 관계를 확인할 수 없습니다.";
      } else if (state.view === "all-flow" && state.graph && state.graph.nodes.length > 0) {
        graphStateMessage.textContent = "실제 Edge로 연결된 Node가 없습니다. 필터에서 미연결 Node를 포함할 수 있습니다.";
      }
      return null;
    }
    const visibleGraph = isDetailView() || isFindingDetailView()
      ? { ...viewGraph, filters: { query: "", nodeType: "", edgeType: "" } }
      : graphRenderer.filter(viewGraph, currentFilters);
    renderFindingList(findings, visibleGraph);
    if (state.selection) {
      const visibleItem = state.selection.kind === "node"
        ? visibleGraph.nodes.find((node) => node.id === state.selection.id)
        : state.selection.kind === "edge"
          ? visibleGraph.edges.find((edge) => edge.id === state.selection.id)
          : graphElement("controller-group", state.selection.id);
      if (!visibleItem) {
        state.selection = null;
        if (inspectorClient) inspectorClient.hideHover();
      }
    }
    const related = inspectorClient
      ? inspectorClient.related(viewGraph, state.selection, displayGroups())
      : { nodeIds: new Set(), edgeIds: new Set() };
    const renderLayers = {
      svg: graphSvg,
      viewport: graphViewport,
      areaLayer: graphAreas,
      projectionLayer: graphFlowProjection,
      guideLayer: graphGuides,
      edgeLayer: graphEdges,
      nodeLayer: graphNodes,
      findingLayer: graphFindingSections,
      findingTitleLayer: graphFindingSectionTitles
    };
    const renderOptions = {
      positions,
      edgeRoutes: state.layout && state.layout.edgeRoutes,
      bounds: state.layout && { width: state.layout.width, height: state.layout.height },
      layoutPlan: state.layout && state.layout.plan,
      detailMode: isDetailView() || isFindingDetailView(),
      findingDetailMode: isFindingDetailView(),
      flowIndex: state.flowIndex,
      layoutMode,
      edgeLabelMode: isDetailView() || isFindingDetailView() ? "detail" : "overview",
      displayEdgeLabels: state.display.edgeLabels,
      selection: state.selection,
      related,
      findings,
      findingSections: findingSectionsForState(viewGraph),
      selectedFindingId: state.selectedFindingId,
      onFindingClick: (id, trigger) => selectFinding(id, trigger),
      onFindingSectionClick: (id, trigger) => openFindingModal(id, trigger),
      onNodeClick: (id) => selectGraphElement("node", id),
      onNodeFocus: (id, anchor) => showGraphHover("node", id, anchor),
      onNodeBlur: hideGraphHover,
      onNodeHover: (id, anchor) => showGraphHover("node", id, anchor),
      onNodeLeave: hideGraphHover,
      onControllerGroupClick: (id) => selectGraphElement("controller-group", id),
      onControllerGroupFocus: (id, anchor) => showGraphHover("controller-group", id, anchor),
      onControllerGroupBlur: hideGraphHover,
      onControllerGroupHover: (id, anchor) => showGraphHover("controller-group", id, anchor),
      onControllerGroupLeave: hideGraphHover,
      onEdgeClick: (id) => selectGraphElement("edge", id),
      onEdgeFocus: (id, anchor) => showGraphHover("edge", id, anchor),
      onEdgeBlur: hideGraphHover,
      onEdgeHover: (id, anchor) => showGraphHover("edge", id, anchor),
      onEdgeLeave: hideGraphHover
    };
    const unchanged = selectionOnly && previousGraph
      && sameGraphItems(previousGraph.nodes, visibleGraph.nodes)
      && sameGraphItems(previousGraph.edges, visibleGraph.edges);
    const result = unchanged && state.graphRender && graphRenderer.updateState
      ? graphRenderer.updateState(state.graphRender, visibleGraph, renderOptions, renderLayers)
      : graphRenderer.render(visibleGraph, renderLayers, renderOptions);
    state.visibleGraph = visibleGraph;
    state.filters = visibleGraph.filters;
    state.graphRender = result;
    if (requestFlowController) renderRequestFlowSafely(requestFlowController.state());
    if (inspectorClient) {
      if (isFindingDetailView() && !state.selection) {
        inspectorClient.render({ graph: viewGraph, visibleGraph, snapshot: state.snapshot, selection: null });
      } else {
        inspectorClient.render({
          graph: viewGraph,
          visibleGraph,
          snapshot: state.snapshot,
          selection: state.inspectorDismissed ? null : state.selection,
          view: state.view,
          findingId: isFindingDetailView() ? state.selectedFindingId : null,
          onShowFinding: () => selectFinding(state.selectedFindingId),
          onOpenFindingEndpoint: (endpointId) => openEndpointDetail(endpointId, state.selectedFindingId),
          controllerGroups: displayGroups(),
          displayModel: !isDetailView() && state.layout && state.layout.plan && state.layout.plan.displayModel
        });
      }
    }
    if (navigation) {
      const renderedPositions = result && result.positions ? result.positions : positions || {};
      const projectionNodes = (!isFindingDetailView() || Boolean(state.detailApiId)) && state.layout && state.layout.plan && state.layout.plan.projection
        && Array.isArray(state.layout.plan.projection.nodes) ? state.layout.plan.projection.nodes : [];
      const projectionPositions = projectionNodes.length > 0
        ? Object.fromEntries(projectionNodes.map((node) => [node.id, {
          ...node.position,
          width: node.width,
          height: node.height
        }]))
        : {};
      const fitPositions = { ...renderedPositions, ...projectionPositions };
      const layoutPlan = state.layout && state.layout.plan;
      const areaBounds = layoutPlan ? [
        ...(layoutPlan.lanes || []).map((lane) => lane.bounds),
        ...(layoutPlan.chainGroups || []).map((group) => ({
          left: group.left,
          top: group.top,
          right: group.right,
          bottom: group.bottom
        })),
        layoutPlan.educationArea,
        ...(layoutPlan.findingSectionLayouts || []).map((section) => section.bounds)
      ].filter((bounds) => bounds && [bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite)) : [];
      areaBounds.forEach((bounds, index) => {
        fitPositions[`presentation-area-${index}`] = {
          x: bounds.left,
          y: bounds.top,
          width: bounds.right - bounds.left,
          height: bounds.bottom - bounds.top
        };
      });
      const presentationNodes = [
        ...((result && Array.isArray(result.displayNodes)) ? result.displayNodes : visibleGraph.nodes),
        ...projectionNodes.map((node) => ({ ...node, kind: "education" }))
      ];
      if (unchanged) navigation.apply();
      else navigation.setGraph(visibleGraph, { ...renderedPositions, ...projectionPositions }, state.layout && {
        width: state.layout.width,
        height: state.layout.height
      }, fitPositions, presentationNodes);
    }
    const active = isDetailView() || isFindingDetailView()
      ? Boolean(currentFilters.query || currentFilters.nodeType || currentFilters.edgeType)
      : Boolean(state.filters.query || state.filters.nodeType || state.filters.edgeType);
    if (filterStatus) {
      filterStatus.textContent = (isDetailView() || isFindingDetailView()) && active
        ? "상세 MAP에서는 검색·필터 조건을 적용하지 않습니다."
        : state.preparingViewKey === currentViewGraphKey()
          ? "Graph 관계 계산 중"
        : state.view === "all-flow" && !state.includeUnconnectedNodes && viewGraph.unconnectedNodeCount > 0
          ? `미연결 Node ${viewGraph.unconnectedNodeCount}개 숨김`
        : !active
        ? "Graph 표시 준비 완료"
        : visibleGraph.nodes.length === 0 && state.filters.query
          ? "검색 결과 없음 · Snapshot 원본은 유지됩니다."
          : "필터 적용";
    }
    graphEmpty.hidden = visibleGraph.nodes.length > 0;
    setHidden(graphSvg, visibleGraph.nodes.length === 0);
    if (visibleGraph.nodes.length === 0) {
      graphStateMessage.textContent = active && !(isDetailView() || isFindingDetailView())
        ? state.filters.query ? "검색 결과 없음 · Snapshot 원본은 유지됩니다." : "필터 결과가 없습니다."
        : "보존 Snapshot에 Graph Node가 없습니다.";
    } else if ((isDetailView() || isFindingDetailView()) && active) {
      graphStateMessage.textContent = "상세 MAP에서는 검색·필터 조건을 적용하지 않습니다.";
    } else if (active) {
      graphStateMessage.textContent = "필터 적용 · 조건에 맞는 Graph 요소만 표시합니다.";
    } else if (visibleGraph.invalidNodes || visibleGraph.invalidEdges) {
      graphStateMessage.textContent = `유효하지 않은 Graph 요소 ${visibleGraph.invalidNodes + visibleGraph.invalidEdges}개를 표시에서 제외했습니다.`;
    } else {
      graphStateMessage.textContent = layoutMode === "elk"
        ? "ELK.js 요청 처리 Lane 배치 완료"
        : "보존 Snapshot Graph 표시 완료";
    }
    return result;
  }

  function renderGraph(snapshot) {
    if (!graphRenderer || !graphSvg || !graphViewport || !graphEdges || !graphNodes) {
      resetGraph("Graph 렌더러를 불러올 수 없습니다.");
      return null;
    }
    const previousFindingId = state.selectedFindingId;
    const previousDetailApiId = state.detailApiId;
    const previousModalId = state.findingModalId;
    const modalWasOpen = Boolean(findingModal && !findingModal.hidden);
    const graph = graphRenderer.normalize(snapshot);
    state.snapshotGeneration += 1;
    state.viewGraphCache.clear();
    state.layoutCache.clear();
    state.pendingViewPreparations.clear();
    state.preparingViewKey = null;
    resetRequestFlow();
    state.snapshot = snapshot;
    state.graph = graph;
    state.flowIndex = flowClient ? flowClient.createIndex(graph, snapshot && snapshot.evidence) : null;
    state.findingIndex = graphRenderer.indexFindings(snapshot, graph);
    indexFindingApis();
    state.selectedFindingId = previousFindingId
      && state.findingIndex.some((item) => item.finding.id === previousFindingId) ? previousFindingId : null;
    state.findingReturnId = null;
    state.detailApiId = state.flowIndex && state.flowIndex.nodeById.has(previousDetailApiId)
      && state.flowIndex.nodeById.get(previousDetailApiId).type === "ENDPOINT" ? previousDetailApiId : "";
    if (findingRule) {
      const knownRules = new Set(["CHAIN_MISSING", "CHAIN_ORDER", "PUBLIC_ENDPOINT", "METHOD_MISMATCH", "FILTER_ORDER", "OBJECT_BINDING", "STATE_BYPASS"]);
      Array.from(findingRule.children).filter((option) => option.dataset && option.dataset.extraRule).forEach((option) => option.remove());
      const extraRules = new Set(state.findingIndex.map(({ finding }) => finding.ruleId).filter((id) => id && !knownRules.has(id)));
      extraRules.forEach((id) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = id;
        option.dataset.extraRule = "true";
        findingRule.appendChild(option);
      });
    }
    state.selectedEndpointId = null;
    state.selection = null;
    state.viewVersion += 1;
    state.layoutRequestId += 1;
    state.viewGraph = null;
    state.layout = null;
    state.layoutState = "not-requested";
    state.layoutError = null;
    if (previousModalId && !state.findingIndex.some((item) => item.finding.id === previousModalId)) {
      closeFindingModal(false);
    }
    if (graph.nodes.length === 0) {
      resetGraph(graph.invalidNodes > 0 ? "유효한 Graph Node가 없어 표시할 수 없습니다." : "보존 Snapshot에 Graph Node가 없습니다.");
      state.graph = graph;
      state.findingIndex = graphRenderer.indexFindings(snapshot, graph);
      indexFindingApis();
      if (state.view === "security-flow" || isFindingDetailView()) renderGraphView("initial");
      return graph;
    }
    const result = renderGraphView("initial");
    if (modalWasOpen && previousModalId && state.findingIndex.some((item) => item.finding.id === previousModalId)) {
      openFindingModal(previousModalId, null, false);
    }
    return result;
  }

  function applyGraphFilter() {
    if (!state.graph) return null;
    renderGraphView(state.layout ? "elk" : "initial");
    if (state.filters.query && state.visibleGraph.nodes.length === 0) showNotice("검색 결과 없음");
    return state.visibleGraph;
  }

  function layoutCacheKey(graph) {
    const findingSections = (graph.findingSections || []).map((section) => [
      section.finding && section.finding.id,
      (section.nodeIds || []).slice().sort()
    ]).sort((left, right) => String(left[0]).localeCompare(String(right[0])));
    return `${state.snapshotGeneration}|${JSON.stringify([
      "presentation-bounds-v2",
      graph.presentationContext || "overview",
      graph.nodes.map((node) => node.id),
      graph.edges.map((edge) => edge.id),
      findingSections
    ])}`;
  }

  function applySuccessfulLayout(layout, cacheKey, showLayoutNotice) {
    state.layout = layout;
    if (cacheKey) cacheSet(state.layoutCache, cacheKey, layout, 8);
    state.layoutState = "loaded";
    state.layoutError = null;
    if (graphCanvas) graphCanvas.dataset.layoutState = "loaded";

    let displayError = null;
    try {
      renderGraphView("elk");
      if (graphSvg) graphSvg.setAttribute("data-layout-mode", "elk");
      if (graphViewport) graphViewport.setAttribute("data-layout-mode", "elk");
      if (graphEmpty) graphEmpty.hidden = true;
      setHidden(graphSvg, false);
      if (navigation) navigation.fit({ allowLocked: true });
      if (state.filters.query || state.filters.nodeType || state.filters.edgeType) {
        graphStateMessage.textContent = state.visibleGraph.nodes.length === 0
          ? "필터 결과가 없습니다."
          : "필터 적용 · 조건에 맞는 Graph 요소만 표시합니다.";
      }
    } catch (error) {
      displayError = error;
      const cause = error && error.message ? error.message : "원인 확인 불가";
      if (graphStateMessage) graphStateMessage.textContent = `Graph 표시 실패: ${cause}`;
    }

    let flowError = null;
    if (requestFlowController) {
      try {
        prepareRequestFlow();
      } catch (error) {
        flowError = error;
        reportRequestFlowFailure(error);
      }
    }

    const displayCause = displayError && displayError.message ? displayError.message : "원인 확인 불가";
    const flowCause = flowError && flowError.message ? flowError.message : "원인 확인 불가";
    if (displayError && flowError) {
      showNotice(`Graph 표시 실패: ${displayCause} · 교육용 흐름 준비 실패: ${flowCause}`, "error");
    } else if (displayError) {
      showNotice(`Graph 표시 실패: ${displayCause}`, "error");
    } else if (!flowError && showLayoutNotice) {
      showNotice("Graph 자동 배치 완료", "success");
    }
    return layout;
  }

  function layoutGraph() {
    const viewGraph = state.viewGraph || viewGraphForState();
    state.viewGraph = viewGraph;
    if (!viewGraph || viewGraph.nodes.length === 0) return Promise.resolve(null);
    const layoutSections = isFindingDetailView() ? findingSectionsForState(viewGraph).map((section) => ({
      finding: { id: section.finding.id },
      nodeIds: section.nodeIds
    })) : [];
    const layoutGraph = {
      ...viewGraph,
      presentationContext: isDetailView() || isFindingDetailView() ? "detail" : "overview",
      findingSections: layoutSections
    };
    const requestId = ++state.layoutRequestId;
    const viewVersion = state.viewVersion;
    const requestedView = state.view;
    const requestedEndpointId = state.selectedEndpointId;
    const requestedFindingId = state.selectedFindingId;
    const cacheKey = layoutCacheKey(layoutGraph);
    const cachedLayout = cacheGet(state.layoutCache, cacheKey);
    const showLayoutNotice = requestedView !== "security-flow";
    if (cachedLayout) {
      applySuccessfulLayout(cachedLayout, null, false);
      return Promise.resolve(cachedLayout);
    }
    state.layoutState = "loading";
    state.layoutError = null;
    graphCanvas.dataset.layoutState = "loading";
    if (showLayoutNotice) showNotice("Graph 자동 배치 중", "loading");
    if (!layoutClient) {
      state.layoutState = "unavailable";
      graphCanvas.dataset.layoutState = "unavailable";
      showNotice("ELK.js 자동 배치 자원을 불러오지 못했습니다.", "error");
      return Promise.resolve(null);
    }
    function handleLayoutFailure(error) {
      if (requestId !== state.layoutRequestId
        || viewVersion !== state.viewVersion
        || requestedView !== state.view
        || requestedEndpointId !== state.selectedEndpointId
        || requestedFindingId !== state.selectedFindingId) return null;
      state.layoutState = "failed";
      state.layoutError = error.message || "원인 확인 불가";
      graphCanvas.dataset.layoutState = "failed";
      graphStateMessage.textContent = "Graph 자동 배치에 실패하여 초기 배치를 유지합니다.";
      showNotice(`Graph 자동 배치 실패: ${error.message || "원인 확인 불가"}`, "error");
      return null;
    }

    let layoutPromise;
    try {
      layoutPromise = layoutClient.layout(layoutGraph);
    } catch (error) {
      return Promise.resolve(handleLayoutFailure(error));
    }
    return Promise.resolve(layoutPromise).then((layout) => {
      if (requestId !== state.layoutRequestId
        || viewVersion !== state.viewVersion
        || requestedView !== state.view
        || requestedEndpointId !== state.selectedEndpointId
        || requestedFindingId !== state.selectedFindingId
        || layout.stale) return { ...layout, stale: true };
      return applySuccessfulLayout(layout, cacheKey, showLayoutNotice);
    }, handleLayoutFailure);
  }

  function updateHeader() {
    const persistedTime = state.status && state.status.persistedCapturedAt;
    const snapshot = state.snapshot;
    const serviceId = snapshot && snapshot.serviceId
      ? snapshot.serviceId
      : state.status && state.status.serviceId;
    document.querySelector("#service-name").textContent = serviceId || "서비스 미확인";
    const time = state.snapshotState === "loaded" && snapshot ? snapshot.capturedAt || persistedTime : null;
    const validTime = time && !Number.isNaN(new Date(time).getTime());
    document.querySelector("#snapshot-time").textContent = `Snapshot 버전: ${validTime ? capturedTime(time) : "확인 불가"}`;
  }

  async function fetchJson(url, resource) {
    const response = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      const error = new Error(requestMessage(response.status, resource));
      error.status = response.status;
      error.resource = resource;
      throw error;
    }
    return response.json();
  }

  async function loadStatus() {
    if (state.loading) return;
    const previousView = state.view;
    const previousEndpointId = state.selectedEndpointId;
    const previousSelection = state.selection;
    const previousInspectorDismissed = state.inspectorDismissed;
    const previousFindingId = state.selectedFindingId;
    const previousDetailApiId = state.detailApiId;
    const previousFindingReturnId = state.findingReturnId;
    const previousModalId = state.findingModalId;
    const previousModalWasOpen = Boolean(findingModal && !findingModal.hidden);
    state.loading = true;
    refreshButton.disabled = true;
    state.error = null;
    state.statusError = null;
    state.snapshotError = null;
    state.status = null;
    state.snapshot = null;
    state.snapshotState = "loading";
    state.layout = null;
    state.layoutState = "not-requested";
    state.layoutError = null;
    state.layoutRequestId += 1;
    state.allEndpointQuery = "";
    if (endpointSearch) endpointSearch.value = "";
    if (nodeFilter) nodeFilter.value = "";
    if (edgeFilter) edgeFilter.value = "";
    if (navigation) {
      navigation.setLocked(false);
      navigation.reset();
    }
    closeFindingModal(false);
    resetGraph("Snapshot 조회 중");
    renderStatus();
    showNotice("상태 조회 중", "loading");
    try {
      state.status = await fetchJson("/mapinboot/api/status", "status");
      if (state.status.persistedSnapshotPresent) {
        try {
          state.snapshot = await fetchJson("/mapinboot/api/snapshot", "snapshot");
          state.snapshotState = "loaded";
        } catch (error) {
          state.snapshotError = error;
          state.snapshotState = errorState(error, "snapshot");
        }
      } else {
        state.snapshotState = "missing";
      }
      updateHeader();
      renderStatus();
      let layoutFailed = false;
      if (state.snapshotState === "loaded") {
        renderGraph(state.snapshot);
        state.inspectorDismissed = previousInspectorDismissed;
        state.selectedFindingId = previousFindingId
          && state.findingIndex.some((item) => item.finding.id === previousFindingId)
          ? previousFindingId : null;
        const restoredFinding = state.findingIndex.find((item) => item.finding.id === state.selectedFindingId);
        const restoredEndpointIds = findingEndpointIds(restoredFinding);
        if (restoredFinding) {
          state.detailApiId = restoredEndpointIds.includes(previousDetailApiId)
            ? previousDetailApiId : restoredEndpointIds[0] || "";
        } else {
          state.detailApiId = findingsForEndpoint(previousDetailApiId).length ? previousDetailApiId : "";
        }
        if (previousView === "security-detail" && restoredFinding && !state.detailApiId) {
          state.view = "security-flow";
          applyFilterView();
        }
        state.findingReturnId = previousFindingReturnId
          && state.findingIndex.some((item) => item.finding.id === previousFindingReturnId)
          ? previousFindingReturnId : null;
        if (previousView === "security-detail" || previousView === "security-flow") {
          renderGraphView("initial");
        }
        if (previousView === "feature-flow") {
          state.selectedEndpointId = previousEndpointId
            && graphElement("node", previousEndpointId)?.type === "ENDPOINT"
            ? previousEndpointId
            : null;
          state.inspectorDismissed = previousInspectorDismissed;
          ensureFeatureEndpoint();
          if (state.selectedEndpointId && !previousInspectorDismissed && previousSelection
            && graphElement(previousSelection.kind, previousSelection.id)) {
            state.selection = previousSelection;
          } else {
            state.selection = null;
          }
          applyFilterView();
          renderGraphView("initial");
        }
        if (previousModalWasOpen && previousModalId
          && state.findingIndex.some((item) => item.finding.id === previousModalId)) {
          openFindingModal(previousModalId, null, false);
        }
        await layoutGraph();
        layoutFailed = state.layoutState === "failed" || state.layoutState === "unavailable";
      }
      if (!layoutFailed) {
        showNotice(
          state.snapshotError ? requestMessage(state.snapshotError.status, "snapshot")
            : state.snapshotState === "missing" ? "상태 조회 완료 · 보존 Snapshot 없음"
              : "상태 및 Snapshot 조회 완료",
          state.snapshotError ? "error" : "success"
        );
      }
    } catch (error) {
      state.error = error;
      state.statusError = error;
      state.snapshotState = errorState(error, "status");
      resetGraph();
      updateHeader();
      renderStatus();
      showNotice(requestMessage(error.status, "status"), "error");
    } finally {
      state.loading = false;
      refreshButton.disabled = false;
    }
  }

  document.querySelectorAll(".header-nav-item").forEach((item) => {
    item.addEventListener("click", () => selectView(item.dataset.view));
  });
  if (findingModalClose) findingModalClose.addEventListener("click", () => closeFindingModal());
  if (findingModal) {
    findingModal.addEventListener("click", (event) => {
      if (event.target === findingModal) closeFindingModal();
    });
    findingModal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeFindingModal();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = modalFocusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        findingModal.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && event.target === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (event.target === last || event.target === findingModal)) {
        event.preventDefault();
        first.focus();
      }
    });
  }
  helpButton.addEventListener("click", () => {
    toggleHeaderPanel(helpPanel, helpButton, settingsPanel, settingsButton);
  });
  settingsButton.addEventListener("click", () => {
    toggleHeaderPanel(settingsPanel, settingsButton, helpPanel, helpButton);
  });
  refreshButton.addEventListener("click", loadStatus);
  if (filterToggle && filterPanel) filterToggle.addEventListener("click", () => {
    setFilterPanel(filterPanel.hidden);
  });
  if (showAreasSetting) showAreasSetting.addEventListener("change", () => {
    state.display.areas = showAreasSetting.checked;
    applyDisplaySettings();
  });
  if (showEdgeLabelsSetting) showEdgeLabelsSetting.addEventListener("change", () => {
    state.display.edgeLabels = showEdgeLabelsSetting.checked;
    applyDisplaySettings();
  });
  if (showMinimapSetting) showMinimapSetting.addEventListener("change", () => {
    state.display.minimap = showMinimapSetting.checked;
    applyDisplaySettings();
  });
  if (endpointSearch) endpointSearch.addEventListener("input", () => {
    if (!isDetailView()) {
      state.allEndpointQuery = endpointSearch.value;
      applyGraphFilter();
      return;
    }
    state.featureEndpointQuery = endpointSearch.value;
    state.featureEndpointOptionIndex = -1;
    renderEndpointOptions(state.featureEndpointQuery);
  });
  if (endpointSearch) endpointSearch.addEventListener("focus", () => {
    if (isDetailView()) renderEndpointOptions(state.featureEndpointQuery);
  });
  if (endpointSearch) endpointSearch.addEventListener("keydown", (event) => {
    if (!isDetailView() || !endpointOptions || endpointOptions.hidden) return;
    const options = endpointOptions.children.filter
      ? endpointOptions.children.filter((item) => item.dataset && item.dataset.endpointId)
      : Array.from(endpointOptions.children || []).filter((item) => item.dataset && item.dataset.endpointId);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.featureEndpointOptionIndex = Math.min(state.featureEndpointOptionIndex + 1, options.length - 1);
      renderEndpointOptions(state.featureEndpointQuery);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      state.featureEndpointOptionIndex = Math.max(state.featureEndpointOptionIndex - 1, 0);
      renderEndpointOptions(state.featureEndpointQuery);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = options[state.featureEndpointOptionIndex] || options[0];
      if (option && option.dataset.endpointId) selectEndpointOption(option.dataset.endpointId);
    } else if (event.key === "Escape") {
      event.preventDefault();
      state.featureEndpointQuery = "";
      setEndpointInputValue(selectedEndpoint());
      closeEndpointOptions();
    }
  });
  if (nodeFilter) nodeFilter.addEventListener("change", applyGraphFilter);
  if (edgeFilter) edgeFilter.addEventListener("change", applyGraphFilter);
  if (includeUnconnectedNodes) includeUnconnectedNodes.addEventListener("change", () => {
    if (state.view !== "all-flow") return;
    state.includeUnconnectedNodes = includeUnconnectedNodes.checked;
    invalidateView();
    state.viewGraph = viewGraphForState();
    renderGraphView("initial");
    if (state.viewGraph && state.viewGraph.nodes.length > 0) void layoutGraph();
  });
  if (findingRule) findingRule.addEventListener("change", () => renderGraphView(state.layout ? "elk" : "initial", true));
  if (findingConfidence) findingConfidence.addEventListener("change", () => renderGraphView(state.layout ? "elk" : "initial", true));
  if (findingApiSelect) findingApiSelect.addEventListener("change", () => {
    if (!isFindingDetailView()) return;
    state.detailApiId = findingApiSelect.value || "";
    applyFindingApiSelection();
  });
  if (searchReset) searchReset.addEventListener("click", () => {
    if (isDetailView()) {
      state.featureEndpointQuery = "";
      ensureFeatureEndpoint();
      renderEndpointOptions("");
      return;
    }
    if (isFindingDetailView()) {
      const selected = state.findingIndex.find((entry) => entry.finding.id === state.selectedFindingId);
      state.detailApiId = selected ? findingEndpointIds(selected)[0] || "" : "";
      renderFindingApiOptions();
      renderGraphView(state.layout ? "elk" : "initial", true);
      return;
    }
    if (state.view === "all-flow" && state.includeUnconnectedNodes) {
      state.includeUnconnectedNodes = false;
      if (includeUnconnectedNodes) includeUnconnectedNodes.checked = false;
      invalidateView();
      state.viewGraph = viewGraphForState();
      renderGraphView("initial");
      if (state.viewGraph && state.viewGraph.nodes.length > 0) void layoutGraph();
      return;
    }
    state.allEndpointQuery = "";
    if (endpointSearch) endpointSearch.value = "";
    if (nodeFilter) nodeFilter.value = "";
    if (edgeFilter) edgeFilter.value = "";
    if (findingRule) findingRule.value = "";
    if (findingConfidence) findingConfidence.value = "";
    applyGraphFilter();
  });
  if (requestFlowStart && requestFlowController) requestFlowStart.addEventListener("click", () => requestFlowController.play());
  if (requestFlowPause && requestFlowController) requestFlowPause.addEventListener("click", () => requestFlowController.pause());
  if (requestFlowReset && requestFlowController) requestFlowReset.addEventListener("click", () => requestFlowController.reset());
  if (document.addEventListener && requestFlowController) document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") requestFlowController.pause();
  });
  if (window.addEventListener && layoutClient) window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    if (typeof layoutClient.terminate === "function") layoutClient.terminate();
    if (requestFlowController) requestFlowController.destroy();
  });
  if (window.addEventListener && requestFlowController) window.addEventListener("resize", () => {
    if (isDetailView()) requestFlowController.pause();
  });
  if (document.addEventListener) document.addEventListener("click", (event) => {
    if (!filterPanel || filterPanel.hidden) return;
    const target = event && event.target;
    if (target && target.closest
      && (target.closest(".map-filter-panel") || target.closest(".map-filter-toggle"))) return;
    setFilterPanel(false, false);
  });
  if (graphCanvas) graphCanvas.addEventListener("click", (event) => {
    const target = event && event.target;
    if (target && target.closest
      && (target.closest(".graph-node") || target.closest(".graph-edge") || target.closest(".map-toolbar")
        || target.closest(".request-flow-controls"))) return;
    clearSelection();
  });
  if (document.addEventListener) document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeHeaderPanels();
      hideGraphHover();
      clearSelection();
      setFilterPanel(false);
    }
  });

  applyFilterView();
  applyDisplaySettings();
  renderStatus();
  window.MapInBootUi = {
    state,
    selectView,
    applyDisplaySettings,
    executionPhaseLabel,
    requestMessage,
    loadStatus,
    normalizeGraph: graphRenderer && graphRenderer.normalize,
    filterGraph: graphRenderer && graphRenderer.filter,
    renderGraph,
    layoutGraph,
    applyGraphFilter,
    selectGraphElement,
    openEndpointDetail,
    returnToAllMap,
    requestFlow: requestFlowController,
    clearSelection,
    showGraphHover,
    hideGraphHover,
    showNotice,
    hideNotice,
    setInspectorTab,
    focusEndpoint: (nodeId) => navigation && navigation.focusNode(nodeId),
    navigation,
    inspector: inspectorClient
  };
  loadStatus();
})();
