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
  const graphEdges = document.querySelector("#graph-edges");
  const graphNodes = document.querySelector("#graph-nodes");
  const inspector = document.querySelector("#inspector");
  const graphPopover = document.querySelector("#graph-popover");
  const endpointSearch = document.querySelector("#endpoint-search");
  const endpointFilterLabel = document.querySelector("#endpoint-filter-label-text");
  const endpointOptions = document.querySelector("#endpoint-options");
  const nodeFilterField = document.querySelector("#node-filter-field");
  const nodeFilter = document.querySelector("#node-filter");
  const edgeFilterField = document.querySelector("#edge-filter-field");
  const edgeFilter = document.querySelector("#edge-filter");
  const findingFields = document.querySelector("#finding-filter-fields");
  const findingRule = document.querySelector("#finding-rule");
  const findingConfidence = document.querySelector("#finding-confidence");
  const findingList = document.querySelector("#finding-list");
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
    selectedFindingId: null,
    flowIndex: null,
    viewGraph: null,
    graphRender: null,
    layout: null,
    layoutState: "not-requested",
    layoutRequestId: 0,
    layoutError: null,
    visibleGraph: null,
    filters: { query: "", nodeType: "", edgeType: "" },
    allEndpointQuery: "",
    featureEndpointQuery: "",
    featureEndpointOptionIndex: -1,
    display: { areas: true, edgeLabels: true, minimap: true },
    loading: false,
    selection: null,
    hoverEdgeId: null,
    selectedEndpointId: null,
    viewVersion: 0,
    requestFlowSteps: [],
    requestFlowPositions: {},
    navigation: null
  };

  const requestFlowController = requestFlowClient && requestFlowControls
    ? requestFlowClient.createController({
      reducedMotion: Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches),
      onUpdate: renderRequestFlowUpdate,
      onStateChange: renderRequestFlowUpdate
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
      reset: document.querySelector("#reset-view")
    })
    : null;
  state.navigation = navigation;

  const inspectorClient = inspectorClientType && inspector
    ? inspectorClientType.create({
      inspector,
      popover: graphPopover,
      surface: graphCanvas,
      onClear: clearSelection,
      onSelect: selectGraphElement,
      onOpenDetail: openEndpointDetail
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
    if (!nextVisible && requestFlowDot) setHidden(requestFlowDot, true);
  }

  // 교육용 빛 점과 단계 상태를 실제 Graph 좌표에 맞춰 갱신
  function renderRequestFlowUpdate(flowState) {
    const currentState = flowState || { status: "idle", stepIndex: 0, progress: 0, step: null };
    const statusLabel = currentState.status === "running" && currentState.step
      ? `진행 중 · ${currentState.step.label}`
      : currentState.status === "paused"
        ? "일시정지"
        : currentState.status === "complete"
          ? "완료"
          : "시작 전";
    const message = `교육용 예시 · 실제 요청 추적 아님 · ${statusLabel}`;
    if (requestFlowStatus && requestFlowStatus.textContent !== message) requestFlowStatus.textContent = message;
    if (requestFlowStart) requestFlowStart.disabled = currentState.status === "running";
    if (requestFlowPause) requestFlowPause.disabled = currentState.status !== "running";
    if (requestFlowReset) requestFlowReset.disabled = state.requestFlowSteps.length === 0;
    if (!requestFlowDot || !isDetailView() || !state.selectedEndpointId || !currentState.step) {
      if (requestFlowDot) setHidden(requestFlowDot, true);
      return;
    }
    const step = currentState.step;
    if (!step.anchorId) {
      setHidden(requestFlowDot, true);
      return;
    }
    const target = state.requestFlowPositions[step.anchorId] || step.position;
    if (!target) {
      setHidden(requestFlowDot, true);
      return;
    }
    let origin = null;
    for (let index = currentState.stepIndex - 1; index >= 0; index -= 1) {
      const previous = state.requestFlowSteps[index];
      if (!previous || !previous.anchorId) continue;
      origin = state.requestFlowPositions[previous.anchorId] || previous.position;
      if (origin) break;
    }
    const progress = Number.isFinite(currentState.progress) ? currentState.progress : 1;
    const point = origin && progress < 1
      ? { x: origin.x + (target.x - origin.x) * progress, y: origin.y + (target.y - origin.y) * progress }
      : target;
    requestFlowDot.setAttribute("cx", String(point.x));
    requestFlowDot.setAttribute("cy", String(point.y));
    setHidden(requestFlowDot, false);
  }

  function resetRequestFlow() {
    state.requestFlowSteps = [];
    state.requestFlowPositions = {};
    if (requestFlowController) requestFlowController.setSteps([]);
    setRequestFlowVisibility(false);
  }

  function prepareRequestFlow() {
    if (!requestFlowController || !isDetailView() || !state.selectedEndpointId
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
      endpointId: state.selectedEndpointId,
      positions,
      projection: state.layout.plan && state.layout.plan.projection
    });
    state.requestFlowSteps = steps;
    state.requestFlowPositions = positions;
    requestFlowController.setSteps(steps);
    setRequestFlowVisibility(true);
    renderRequestFlowUpdate(requestFlowController.state());
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
    if (nextOpen && endpointSearch && typeof endpointSearch.focus === "function") {
      endpointSearch.focus();
      if (isDetailView()) renderEndpointOptions(state.featureEndpointQuery);
    }
    if (!nextOpen && returnFocus && typeof filterToggle.focus === "function") filterToggle.focus();
  }

  function isDetailView() {
    return state.view === "feature-flow";
  }

  function endpointDetails(endpoint) {
    const endpointAttributes = endpoint && endpoint.attributes && typeof endpoint.attributes === "object"
      ? endpoint.attributes : {};
    const method = String(endpointAttributes.httpMethod || "").trim().toUpperCase();
    const path = String(endpointAttributes.path || endpoint.label || "").trim();
    const handler = String(endpointAttributes.handler || "").trim();
    const label = `${method} ${path}`.trim() || String(endpoint.id || "");
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
    state.selection = endpoint ? { kind: "node", id: endpoint.id } : null;
    setEndpointInputValue(endpoint);
  }

  function applyFilterView() {
    const detail = isDetailView();
    if (findingFields) setHidden(findingFields, state.view !== "security-flow");
    if (endpointFilterLabel) endpointFilterLabel.textContent = detail ? "API 선택" : "Endpoint 검색";
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
    if (nodeFilterField) setHidden(nodeFilterField, detail);
    if (edgeFilterField) setHidden(edgeFilterField, detail);
  }

  function selectEndpointOption(endpointId) {
    const endpoint = sortedEndpoints().find((item) => item.id === endpointId);
    if (!endpoint) return null;
    state.selectedEndpointId = endpoint.id;
    state.selection = { kind: "node", id: endpoint.id };
    state.featureEndpointQuery = "";
    setEndpointInputValue(endpoint);
    closeEndpointOptions();
    if (!isDetailView()) {
      selectView("feature-flow");
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

  function viewGraphForState() {
    if (!state.graph) return null;
    if (!isDetailView()) return state.graph;
    if (!state.selectedEndpointId || !flowClient || !flowClient.deriveEndpointGraph) return null;
    return flowClient.deriveEndpointGraph(state.graph, state.selectedEndpointId);
  }

  function detailMatchChainId() {
    if (!isDetailView() || !state.selectedEndpointId || !state.flowIndex) return null;
    const match = state.flowIndex.firstMatchedChain(state.selectedEndpointId);
    return match.status === "CONFIRMED" ? match.chain.id : null;
  }

  function selectView(view) {
    if (!viewNames[view]) return;
    state.view = view;
    if (view === "all-flow" || view === "feature-flow") state.selectedFindingId = null;
    if (!isDetailView()) {
      state.selectedEndpointId = null;
      state.selection = null;
    } else {
      ensureFeatureEndpoint();
    }
    applyFilterView();
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
  function openEndpointDetail(endpointId) {
    const endpoint = graphElement("node", endpointId);
    if (!endpoint || endpoint.type !== "ENDPOINT") return null;
    state.selectedEndpointId = endpointId;
    state.selection = { kind: "node", id: endpointId };
    selectView("feature-flow");
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
    resetRequestFlow();
    state.graph = null;
    state.findingIndex = [];
    state.selectedFindingId = null;
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
    if (graphSvg) setHidden(graphSvg, true);
    if (graphEmpty) graphEmpty.hidden = false;
    if (filterStatus) filterStatus.textContent = "Graph 없음";
    if (message) graphStateMessage.textContent = message;
  }

  function filterValues() {
    if (isDetailView()) return { query: "", nodeType: "", edgeType: "" };
    return {
      query: endpointSearch ? endpointSearch.value : "",
      nodeType: nodeFilter ? nodeFilter.value : "",
      edgeType: edgeFilter ? edgeFilter.value : ""
    };
  }

  function selectFinding(id) {
    const entry = state.findingIndex.find((item) => item.finding.id === id);
    if (!entry) return;
    if (state.selection) clearSelection();
    state.selectedFindingId = id;
    showNotice(`선택: ${entry.finding.title || id}`);
  }

  // 위치가 없거나 현재 필터에 가려진 Finding 접근 경로
  function renderFindingList(findings, visibleGraph) {
    if (!findingList) return;
    findingList.replaceChildren();
    const visibleNodes = new Set(visibleGraph.nodes.map((node) => node.id));
    const visibleEdges = new Set(visibleGraph.edges.map((edge) => edge.id));
    findings.forEach((entry) => {
      const hidden = entry.nodeIds.some((id) => !visibleNodes.has(id))
        || entry.edgeIds.some((id) => !visibleEdges.has(id));
      if (!entry.unlocated && !entry.missing && !hidden) return;
      const button = document.createElement("button");
      button.setAttribute("type", "button");
      const status = entry.unlocated || entry.missing ? "연결 위치 확인 불가" : "필터로 숨겨진 항목";
      const confidence = { CONFIRMED: "확정", LIKELY: "검토 필요", UNKNOWN: "확인 불가" }[entry.finding.confidence] || "확인 불가";
      button.textContent = `${entry.finding.title || entry.finding.id} · ${entry.finding.ruleId || ""} · ${confidence} · ${status}`;
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
    if (!plan || isDetailView()) return [];
    return (plan.controllerGroups || []).concat(plan.displayModel ? plan.displayModel.groups : []);
  }

  function clearSelection() {
    state.selection = null;
    state.selectedFindingId = null;
    if (inspectorClient) inspectorClient.hideHover();
    if (state.viewGraph && state.viewGraph.nodes.length > 0) {
      renderGraphView(state.layout ? "elk" : "initial", true);
    } else if (inspectorClient) {
      inspectorClient.render({ graph: state.viewGraph || state.graph, visibleGraph: state.visibleGraph, snapshot: state.snapshot, selection: null });
    }
  }

  function selectGraphElement(kind, id) {
    const item = graphElement(kind, id);
    if (!item) return null;
    state.selectedFindingId = null;
    if (kind === "node" && item.type === "ENDPOINT" && isDetailView()
      && state.selectedEndpointId !== item.id) return openEndpointDetail(item.id);
    state.selection = { kind, id };
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

  function renderGraphView(layoutMode, selectionOnly = false) {
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
      if (graphAreas) graphAreas.replaceChildren();
      if (graphFlowProjection) graphFlowProjection.replaceChildren();
      if (graphGuides) graphGuides.replaceChildren();
      if (graphEdges) graphEdges.replaceChildren();
      if (graphNodes) graphNodes.replaceChildren();
      if (inspectorClient) {
        inspectorClient.render({
          graph: viewGraph || state.graph,
          visibleGraph: emptyGraph,
          snapshot: state.snapshot,
          selection: null
        });
      }
      if (navigation) navigation.setGraph(emptyGraph, {}, null);
      if (filterStatus) filterStatus.textContent = isDetailView() ? "Endpoint 선택 필요" : "Graph 없음";
      graphEmpty.hidden = false;
      setHidden(graphSvg, true);
      if (isDetailView() && !state.selectedEndpointId) {
        graphStateMessage.textContent = "선택할 수 있는 Endpoint가 없습니다.";
      } else if (isDetailView()) {
        graphStateMessage.textContent = "선택한 Endpoint의 실제 관계를 확인할 수 없습니다.";
      }
      return null;
    }
    const visibleGraph = isDetailView()
      ? { ...viewGraph, filters: { query: "", nodeType: "", edgeType: "" } }
      : graphRenderer.filter(state.graph, currentFilters);
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
    const result = graphRenderer.render(visibleGraph, {
      svg: graphSvg,
      viewport: graphViewport,
      areaLayer: graphAreas,
      projectionLayer: graphFlowProjection,
      guideLayer: graphGuides,
      edgeLayer: graphEdges,
      nodeLayer: graphNodes
    }, {
      positions,
      edgeRoutes: state.layout && state.layout.edgeRoutes,
      bounds: state.layout && { width: state.layout.width, height: state.layout.height },
      layoutPlan: state.layout && state.layout.plan,
      detailMode: isDetailView(),
      flowIndex: state.flowIndex,
      layoutMode,
      edgeLabelMode: isDetailView() ? "detail" : "overview",
      displayEdgeLabels: state.display.edgeLabels,
      selection: state.selection,
      related,
      findings,
      onFindingClick: selectFinding,
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
    });
    state.visibleGraph = visibleGraph;
    state.filters = visibleGraph.filters;
    state.graphRender = result;
    if (inspectorClient) {
      inspectorClient.render({
        graph: viewGraph,
        visibleGraph,
        snapshot: state.snapshot,
        selection: state.selection,
        controllerGroups: displayGroups(),
        displayModel: !isDetailView() && state.layout && state.layout.plan && state.layout.plan.displayModel
      });
    }
    if (navigation) {
      const renderedPositions = result && result.positions ? result.positions : positions || {};
      const projectionNodes = state.layout && state.layout.plan && state.layout.plan.projection
        && Array.isArray(state.layout.plan.projection.nodes) ? state.layout.plan.projection.nodes : [];
      const projectionPositions = projectionNodes.length > 0
        ? Object.fromEntries(projectionNodes.map((node) => [node.id, node.position]))
        : {};
      const fitPositions = { ...renderedPositions, ...projectionPositions };
      const presentationNodes = [
        ...((result && Array.isArray(result.displayNodes)) ? result.displayNodes : visibleGraph.nodes),
        ...projectionNodes.map((node) => ({ ...node, kind: "education" }))
      ];
      const sameItems = (left, right) => left.length === right.length
        && left.every((item, index) => item.id === right[index].id);
      const unchanged = selectionOnly && previousGraph
        && sameItems(previousGraph.nodes, visibleGraph.nodes) && sameItems(previousGraph.edges, visibleGraph.edges);
      if (unchanged) navigation.apply();
      else navigation.setGraph(visibleGraph, { ...renderedPositions, ...projectionPositions }, state.layout && {
        width: state.layout.width,
        height: state.layout.height
      }, fitPositions, presentationNodes);
    }
    const active = isDetailView()
      ? Boolean(currentFilters.query || currentFilters.nodeType || currentFilters.edgeType)
      : Boolean(state.filters.query || state.filters.nodeType || state.filters.edgeType);
    if (filterStatus) {
      filterStatus.textContent = isDetailView() && active
        ? "상세 MAP에서는 검색·필터 조건을 적용하지 않습니다."
        : !active
        ? "Graph 표시 준비 완료"
        : visibleGraph.nodes.length === 0 && state.filters.query
          ? "검색 결과 없음 · Snapshot 원본은 유지됩니다."
          : "필터 적용";
    }
    graphEmpty.hidden = visibleGraph.nodes.length > 0;
    setHidden(graphSvg, visibleGraph.nodes.length === 0);
    if (visibleGraph.nodes.length === 0) {
      graphStateMessage.textContent = active && !isDetailView()
        ? state.filters.query ? "검색 결과 없음 · Snapshot 원본은 유지됩니다." : "필터 결과가 없습니다."
        : "보존 Snapshot에 Graph Node가 없습니다.";
    } else if (isDetailView() && active) {
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
    const graph = graphRenderer.normalize(snapshot);
    resetRequestFlow();
    state.snapshot = snapshot;
    state.graph = graph;
    state.findingIndex = graphRenderer.indexFindings(snapshot, graph);
    state.selectedFindingId = null;
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
    state.flowIndex = flowClient ? flowClient.createIndex(graph) : null;
    state.selectedEndpointId = null;
    state.selection = null;
    state.viewVersion += 1;
    state.layoutRequestId += 1;
    state.viewGraph = null;
    state.layout = null;
    state.layoutState = "not-requested";
    state.layoutError = null;
    if (graph.nodes.length === 0) {
      resetGraph(graph.invalidNodes > 0 ? "유효한 Graph Node가 없어 표시할 수 없습니다." : "보존 Snapshot에 Graph Node가 없습니다.");
      state.graph = graph;
      state.findingIndex = graphRenderer.indexFindings(snapshot, graph);
      if (state.view === "security-flow") renderGraphView("initial");
      return graph;
    }
    return renderGraphView("initial");
  }

  function applyGraphFilter() {
    if (!state.graph) return null;
    renderGraphView(state.layout ? "elk" : "initial");
    if (state.filters.query && state.visibleGraph.nodes.length === 0) showNotice("검색 결과 없음");
    return state.visibleGraph;
  }

  function layoutGraph() {
    const viewGraph = state.viewGraph || viewGraphForState();
    state.viewGraph = viewGraph;
    if (!viewGraph || viewGraph.nodes.length === 0) return Promise.resolve(null);
    const requestId = ++state.layoutRequestId;
    const viewVersion = state.viewVersion;
    const requestedView = state.view;
    const requestedEndpointId = state.selectedEndpointId;
    state.layoutState = "loading";
    state.layoutError = null;
    graphCanvas.dataset.layoutState = "loading";
    showNotice("Graph 자동 배치 중", "loading");
    if (!layoutClient) {
      state.layoutState = "unavailable";
      graphCanvas.dataset.layoutState = "unavailable";
      showNotice("ELK.js 자동 배치 자원을 불러오지 못했습니다.", "error");
      return Promise.resolve(null);
    }
    return layoutClient.layout(viewGraph).then((layout) => {
      if (requestId !== state.layoutRequestId
        || viewVersion !== state.viewVersion
        || requestedView !== state.view
        || requestedEndpointId !== state.selectedEndpointId
        || layout.stale) return { ...layout, stale: true };
      state.layout = layout;
      renderGraphView("elk");
      graphSvg.setAttribute("data-layout-mode", "elk");
      graphViewport.setAttribute("data-layout-mode", "elk");
      state.layoutState = "loaded";
      state.layoutError = null;
      graphCanvas.dataset.layoutState = "loaded";
      graphEmpty.hidden = true;
      setHidden(graphSvg, false);
      if (navigation) navigation.fit();
      prepareRequestFlow();
      if (state.filters.query || state.filters.nodeType || state.filters.edgeType) {
        graphStateMessage.textContent = state.visibleGraph.nodes.length === 0
          ? "필터 결과가 없습니다."
          : "필터 적용 · 조건에 맞는 Graph 요소만 표시합니다.";
      }
      showNotice("Graph 자동 배치 완료", "success");
      return layout;
    }).catch((error) => {
      if (requestId !== state.layoutRequestId
        || viewVersion !== state.viewVersion
        || requestedView !== state.view
        || requestedEndpointId !== state.selectedEndpointId) return null;
      state.layoutState = "failed";
      state.layoutError = error.message || "원인 확인 불가";
      graphCanvas.dataset.layoutState = "failed";
      graphStateMessage.textContent = "Graph 자동 배치에 실패하여 초기 배치를 유지합니다.";
      showNotice(`Graph 자동 배치 실패: ${error.message || "원인 확인 불가"}`, "error");
      return null;
    });
  }

  function updateHeader() {
    const persistedTime = state.status && state.status.persistedCapturedAt;
    const snapshot = state.snapshot;
    const serviceId = snapshot && snapshot.serviceId
      ? snapshot.serviceId
      : state.status && state.status.serviceId;
    document.querySelector("#service-name").textContent = serviceId || "서비스 미확인";
    document.querySelector("#snapshot-time").textContent = capturedTime(persistedTime || (snapshot && snapshot.capturedAt));
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
    if (navigation) navigation.reset();
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
        if (previousView === "feature-flow") {
          state.selectedEndpointId = previousEndpointId
            && graphElement("node", previousEndpointId)?.type === "ENDPOINT"
            ? previousEndpointId
            : null;
          ensureFeatureEndpoint();
          if (state.selectedEndpointId) {
            state.selection = previousSelection && graphElement(previousSelection.kind, previousSelection.id)
              ? previousSelection
              : { kind: "node", id: state.selectedEndpointId };
          }
          applyFilterView();
          renderGraphView("initial");
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
  if (findingRule) findingRule.addEventListener("change", () => renderGraphView(state.layout ? "elk" : "initial", true));
  if (findingConfidence) findingConfidence.addEventListener("change", () => renderGraphView(state.layout ? "elk" : "initial", true));
  const searchReset = document.querySelector("#search-reset");
  if (searchReset) searchReset.addEventListener("click", () => {
    if (isDetailView()) {
      state.featureEndpointQuery = "";
      ensureFeatureEndpoint();
      renderEndpointOptions("");
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
    if (!event.persisted && typeof layoutClient.terminate === "function") layoutClient.terminate();
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
