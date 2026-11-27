(() => {
  "use strict";

  const viewNames = {
    "all-flow": "전체 Flow Map",
    "feature-flow": "기능별 상세 Flow Map",
    "security-flow": "전체 취약점 진단 Flow Map",
    "security-detail": "기능별 상세 취약점 확인"
  };
  const title = document.querySelector("#view-title");
  const viewState = document.querySelector("#view-state");
  const graphCanvas = document.querySelector("#graph-canvas");
  const mapToolbar = document.querySelector(".map-toolbar");
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
  const graphMinimap = document.querySelector("#graph-minimap");
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
  const spotlight = window.MapInBootSpotlight;
  const settingsPanel = document.querySelector("#settings-panel");
  const settingsCloseButton = document.querySelector("#settings-close");
  const showAreasSetting = document.querySelector("#setting-show-areas");
  const showEdgeLabelsSetting = document.querySelector("#setting-show-edge-labels");
  const showMinimapSetting = document.querySelector("#setting-show-minimap");
  const flowNodeDurationSetting = document.querySelector("#setting-flow-node-duration");
  const flowSpeedSetting = document.querySelector("#setting-flow-speed");
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
    if (findingRule) {
      Array.from(findingRule.children).forEach((option) => {
        if (option.value) option.textContent = graphRenderer.findingRuleLabel(option.value);
      });
    }
  }
  const layoutClient = window.MapInBootLayout;
  const navigationClient = window.MapInBootNavigation;
  const inspectorClientType = window.MapInBootInspector;
  const requestFlowControls = document.querySelector("#request-flow-controls");
  const requestFlowStart = document.querySelector("#request-flow-start");
  const requestFlowPause = document.querySelector("#request-flow-pause");
  const requestFlowReset = document.querySelector("#request-flow-reset");
  const requestFlowStatus = document.querySelector("#request-flow-status");
  const requestFlowDetailToggle = document.querySelector("#request-flow-detail-toggle");
  const requestFlowDetailClose = document.querySelector("#request-flow-detail-close");
  const requestFlowPopoverCount = document.querySelector("#request-flow-popover-count");
  const requestFlowDetails = document.querySelector("#request-flow-details");
  const requestFlowStepTitle = document.querySelector("#request-flow-step-title");
  const requestFlowStepDescription = document.querySelector("#request-flow-step-description");
  const requestFlowNavigation = document.querySelector("#request-flow-navigation");
  const requestFlowPrevious = document.querySelector("#request-flow-previous");
  const requestFlowNext = document.querySelector("#request-flow-next");
  const requestFlowEducation = document.querySelector("#request-flow-education");
  const requestFlowDot = document.querySelector("#request-flow-dot");
  let noticeTimer = null;
  let settingsPanelTimer = null;
  const state = {
    view: "all-flow",
    status: null,
    snapshot: null,
    snapshotState: "not-requested",
    error: null,
    statusError: null,
    snapshotError: null,
    graph: null,
    displayIds: null,
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
    requestFlowSettings: { nodeHoldDuration: 1500, speed: 1 },
    loading: false,
    selection: null,
    inspectorDismissed: false,
    hoverEdgeId: null,
    graphHover: null,
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
    requestFlowSignature: null,
    navigation: null
  };
  let requestFlowActiveNodeId = null;
  let requestFlowActiveNode = null;
  let requestFlowActiveEdges = [];
  let handlingRequestFlowFailure = false;
  let requestFlowDetailsOpen = false;

  const requestFlowController = requestFlowClient && requestFlowControls
    ? requestFlowClient.createController({
      nodeHoldDuration: state.requestFlowSettings.nodeHoldDuration,
      speed: state.requestFlowSettings.speed,
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
    return graphRenderer ? graphRenderer.analysisStatusLabel(phase) : "확인 불가";
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

  // 재생 상태와 독립적인 상세 팝오버 표시
  function setRequestFlowDetails(open, returnFocus = false) {
    requestFlowDetailsOpen = Boolean(open && requestFlowController && requestFlowController.state().step);
    setHidden(requestFlowDetails, !requestFlowDetailsOpen);
    if (requestFlowDetailToggle) requestFlowDetailToggle.setAttribute("aria-expanded", String(requestFlowDetailsOpen));
    if (returnFocus && requestFlowDetailToggle && typeof requestFlowDetailToggle.focus === "function") requestFlowDetailToggle.focus();
  }

  function setRequestFlowVisibility(visible) {
    const nextVisible = Boolean(visible);
    if (requestFlowControls) requestFlowControls.hidden = !nextVisible;
    if (requestFlowEducation) {
      setHidden(requestFlowEducation, !nextVisible);
      requestFlowEducation.setAttribute("aria-hidden", String(!nextVisible));
    }
    if (!nextVisible) {
      setRequestFlowDetails(false);
      setRequestFlowNode(null);
      setRequestFlowEdge(null);
      if (requestFlowDot) setHidden(requestFlowDot, true);
    }
  }

  function findRequestFlowNode(anchorId) {
    const pending = [
      ...(graphNodes && graphNodes.children ? Array.from(graphNodes.children) : []),
      ...(graphFlowProjection && graphFlowProjection.children ? Array.from(graphFlowProjection.children) : [])
    ];
    const candidates = [];
    while (pending.length) {
      const element = pending.shift();
      candidates.push(element);
      pending.push(...Array.from(element.children || []));
    }
    const directMatch = candidates.find((element) => [
      element.getAttribute("data-node-id"),
      element.getAttribute("data-projection-id"),
      element.getAttribute("data-composite-item-id"),
      ...(element.getAttribute("data-projection-node-ids") || "").split(",")
    ].includes(anchorId));
    if (directMatch) return directMatch;
    const includesAnchor = (element) => {
      const identifiers = [
        ...(element.getAttribute("data-node-ids") || "").split(","),
        ...(element.getAttribute("data-handler-ids") || "").split(","),
        ...(element.getAttribute("data-endpoint-ids") || "").split(","),
        ...(element.getAttribute("data-runtime-component-ids") || "").split(",")
      ];
      return identifiers.includes(anchorId);
    };
    return candidates.find((element) => (element.getAttribute("class") || "").split(/\s+/)
      .includes("graph-composite-item") && includesAnchor(element))
      || candidates.find(includesAnchor) || null;
  }

  // 재생 단계에 맞는 실제 또는 교육용 표시 Node만 부분 갱신
  function setRequestFlowNode(anchorId) {
    const nextId = anchorId || null;
    if (requestFlowActiveNode) requestFlowActiveNode.removeAttribute("data-request-flow-active");
    requestFlowActiveNodeId = nextId;
    requestFlowActiveNode = null;
    if (!nextId) return;
    requestFlowActiveNode = findRequestFlowNode(nextId);
    if (requestFlowActiveNode) requestFlowActiveNode.setAttribute("data-request-flow-active", "true");
  }

  function setRequestFlowEdge(path) {
    requestFlowActiveEdges.forEach((element) => element.removeAttribute("data-request-flow-active"));
    requestFlowActiveEdges = [];
    if (!path) return;
    const paths = Array.isArray(path) ? path : [path];
    const classNames = (element) => (element.getAttribute("class") || "").split(/\s+/);
    paths.forEach((entry) => {
      const item = entry.element || entry;
      requestFlowActiveEdges.push(item);
      if (!classNames(item).includes("graph-edge-flow-route")) return;
      const edgeIds = new Set((item.getAttribute("data-edge-ids") || item.getAttribute("data-edge-id") || "")
        .split(",").filter(Boolean));
      Array.from(graphEdges && graphEdges.children || []).forEach((element) => {
        if (!classNames(element).some((name) => name === "graph-edge-branch" || name === "graph-edge-trunk")) return;
        const ids = (element.getAttribute("data-edge-ids") || element.getAttribute("data-edge-id") || "")
          .split(",").filter(Boolean);
        if (ids.some((id) => edgeIds.has(id))) requestFlowActiveEdges.push(element);
      });
    });
    requestFlowActiveEdges = Array.from(new Set(requestFlowActiveEdges));
    requestFlowActiveEdges.forEach((element) => element.setAttribute("data-request-flow-active", "true"));
  }

  function requestFlowPath(transition) {
    if (!transition) return null;
    const pending = [graphEdges, graphNodes, graphFlowProjection].filter(Boolean);
    const paths = [];
    while (pending.length) {
      const element = pending.shift();
      if (element.tagName === "path") paths.push(element);
      pending.push(...Array.from(element.children || []));
    }
    const displayModel = state.layout && state.layout.plan && state.layout.plan.displayModel;
    if (transition.kind !== "display") return null;
    const routing = state.layout && state.layout.plan && state.layout.plan.overviewRouting;
    const relationIds = transition.relationIds || [transition.relationId];
    const byId = new Map(paths.flatMap((path) =>
      (path.getAttribute("data-segment-ids") || path.getAttribute("data-segment-id") || "")
        .split(",").filter(Boolean).map((id) => [id, path])));
    const segments = new Map((routing && routing.segments || []).map((segment) => [segment.id, segment]));
    const result = [];
    for (const relationId of relationIds) {
      const route = routing && routing.routesByRelationId[relationId];
      if (!route || !route.orderedSegmentIds.length) return null;
      let current = route.sourcePort;
      for (const id of route.orderedSegmentIds) {
        const segment = segments.get(id);
        const path = byId.get(id);
        if (!segment || !path || typeof path.getTotalLength !== "function"
          || typeof path.getPointAtLength !== "function") return null;
        const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        const forward = distance(current, segment.from) <= distance(current, segment.to);
        const start = forward ? segment.from : segment.to;
        try {
          const renderedStart = path.getPointAtLength(0);
          const reverse = distance(renderedStart, start) > distance(renderedStart, forward ? segment.to : segment.from);
          const routePath = { element: path, requestFlowReverse: reverse,
            getTotalLength: () => path.getTotalLength(), getPointAtLength: (length) => path.getPointAtLength(length) };
          if (typeof path.getScreenCTM === "function") routePath.getScreenCTM = () => path.getScreenCTM();
          result.push(routePath);
        } catch { return null; }
        current = forward ? segment.to : segment.from;
      }
    }
    return result.length ? result : null;
  }

  // 실제 내용이 바뀐 단계 텍스트만 DOM과 접근성 트리에 반영
  function setRequestFlowText(element, value) {
    if (!element) return;
    const nextText = value === null || value === undefined ? "" : String(value);
    if (element.textContent !== nextText) element.textContent = nextText;
  }

  // 학습 흐름 빛 점과 현재 상태를 SVG Edge 경로에 맞춰 갱신
  function renderRequestFlowUpdate(flowState) {
    const currentState = flowState || { status: "idle", stepIndex: 0, progress: 0, step: null };
    const step = currentState.step;
    const steps = Array.isArray(currentState.steps) ? currentState.steps : state.requestFlowSteps;
    const hasSteps = steps.length > 0;
    const inDetail = isEndpointDetailView() && Boolean(state.selectedEndpointId || state.detailApiId);
    const filterEducation = step && step.filterEducation;
    const path = currentState.phase === "EDGE_TRAVEL" ? requestFlowPath(currentState.transition) : null;
    setRequestFlowEdge(path);
    const transition = currentState.transition;
    let point = path && requestFlowClient && requestFlowClient.pathPointAt
      ? requestFlowClient.pathPointAt(path, currentState.progress, transition.length,
        requestFlowDot && requestFlowDot.parentNode) : null;
    if (currentState.phase === "EDGE_TRAVEL" && transition && transition.kind === "internal") {
      point = { x: transition.from.x + (transition.to.x - transition.from.x) * currentState.progress,
        y: transition.from.y + (transition.to.y - transition.from.y) * currentState.progress };
    }
    if ((currentState.phase === "NODE_HOLD" || currentState.phase === "COMPLETE") && step) point = step.position;
    const isPathMissing = currentState.phase === "EDGE_TRAVEL" && !point;
    const pathUnavailable = currentState.phase === "PATH_UNAVAILABLE" || isPathMissing;
    const statusState = pathUnavailable ? "unavailable"
      : currentState.status === "running" ? currentState.phase === "EDGE_TRAVEL" ? "moving" : "running"
        : currentState.status === "paused" ? "paused"
          : currentState.status === "complete" ? "complete" : "idle";
    const statusLabels = {
      idle: "시작 전",
      running: "진행 중",
      moving: "이동 중",
      paused: "일시정지",
      complete: "완료",
      unavailable: "경로 확인 불가"
    };
    setRequestFlowText(requestFlowStatus, statusLabels[statusState]);
    if (requestFlowStatus && requestFlowStatus.getAttribute("data-state") !== statusState) {
      requestFlowStatus.setAttribute("data-state", statusState);
    }
    if (!step && requestFlowDetailsOpen) setRequestFlowDetails(false);
    setHidden(requestFlowDetails, !requestFlowDetailsOpen);
    setHidden(requestFlowNavigation, !hasSteps);
    const count = hasSteps ? `${currentState.stepIndex + 1} / ${steps.length}` : "0 / 0";
    setRequestFlowText(requestFlowPopoverCount, count);
    const names = { "security-chain": "보안 필터 체인", "dispatcher-servlet": "DispatcherServlet",
      "endpoint-mapping": "API 매핑", "education-handler-mapping": "요청 매핑 탐색",
      "education-handler-adapter": "핸들러 실행 준비" };
    let title = step && (names[step.id] || step.label) || "표시할 단계가 없습니다.";
    title = String(title).replace(/^(?:확인된 )?(?:Servlet Filter|Security Filter|SecurityFilterChain|API Endpoint|Handler) · /, "")
      .replace(/\b(?:[a-z_$][\w$]*\.)+([A-Z_$][\w$]*)/g, "$1").replace(/\([^)]*\)/g, "");
    if (title.includes("|") || /\b[0-9a-f]{32,}\b/i.test(title)) {
      title = step && step.id.startsWith("security") ? "보안 필터 체인" : "처리 단계";
    }
    setRequestFlowText(requestFlowStepTitle, title);
    const processing = filterEducation && filterEducation.processing;
    const processSentence = processing && (processing.endsWith("수 있음")
      ? processing.replace(/수 있음$/, "수 있습니다.") : `${processing}할 수 있습니다.`);
    const description = filterEducation && filterEducation.role && processSentence
      ? `${filterEducation.role}하는 역할을 합니다. ${processSentence}` : step && step.description || "";
    setRequestFlowText(requestFlowStepDescription, String(description)
      .replace(/https?:\/\/\S+/g, "관련 정보")
      .replace(/\b(?:[a-z_$][\w$]*\.)+([A-Z_$][\w$]*)/g, "$1")
      .replace(/\b[\w.$-]+(?:\|[\w.$/:-]+)+/g, "해당 처리 구성")
      .replace(/(?<![\w])\/(?:[\w{}:.-]+\/?)+/g, "요청 경로")
      .replace(/\b[0-9a-f]{32,}\b/gi, "구성 정보"));
    if (requestFlowDetailToggle) requestFlowDetailToggle.disabled = !step;
    if (requestFlowStart) requestFlowStart.disabled = currentState.status === "running" || !hasSteps;
    if (requestFlowPause) requestFlowPause.disabled = currentState.status !== "running";
    if (requestFlowReset) requestFlowReset.disabled = !hasSteps;
    if (requestFlowPrevious) requestFlowPrevious.disabled = !hasSteps || currentState.stepIndex <= 0;
    if (requestFlowNext) requestFlowNext.disabled = !hasSteps || currentState.stepIndex >= steps.length - 1;
    setRequestFlowNode(inDetail && step && ["NODE_HOLD", "COMPLETE"].includes(currentState.phase)
      ? step.displayItemId || step.anchorId : null);
    if (!requestFlowDot || !inDetail || !step || !point) {
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
    state.requestFlowSignature = null;
    let cause = error && error.message ? error.message : String(error || "원인 확인 불가");
    if (!handlingRequestFlowFailure) {
      handlingRequestFlowFailure = true;
      try {
        if (requestFlowController) requestFlowController.setSteps([]);
      } catch (resetError) {
        const resetCause = resetError && resetError.message ? resetError.message : String(resetError);
        cause = `${cause}; 학습 흐름 정리 실패: ${resetCause}`;
      } finally {
        handlingRequestFlowFailure = false;
      }
    }
    try {
      setRequestFlowNode(null);
      setRequestFlowVisibility(false);
    } catch (hideError) {
      const hideCause = hideError && hideError.message ? hideError.message : String(hideError);
      cause = `${cause}; 학습 흐름 숨김 실패: ${hideCause}`;
    }
    showNotice(`학습 흐름 준비 실패: ${cause}`, "error");
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
    state.requestFlowSignature = null;
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
    const displayModel = state.layout.plan && state.layout.plan.displayModel;
    const positions = {
      ...(state.layout.positions || {}),
      ...Object.fromEntries((state.layout.plan && state.layout.plan.projection && state.layout.plan.projection.nodes || [])
        .map((node) => [node.id, node.position]))
    };
    if (displayModel && displayModel.itemById) {
      const itemPosition = (id) => {
        const item = displayModel.itemById[id];
        return item && item.bounds ? { x: item.bounds.x + item.bounds.width / 2,
          y: item.bounds.y + item.bounds.height / 2 } : null;
      };
      Object.entries(displayModel.originalNodeToItemIds || {}).forEach(([id, itemIds]) => {
        const position = itemIds.map(itemPosition).find(Boolean);
        if (position) positions[id] = position;
      });
      Object.entries(displayModel.projectionToItemIds || {}).forEach(([id, itemIds]) => {
        const position = itemIds.map(itemPosition).find(Boolean);
        if (position) positions[id] = position;
      });
      Object.entries(displayModel.runtimeComponentToItemIds || {}).forEach(([id, itemIds]) => {
        const position = itemIds.map(itemPosition).find(Boolean);
        if (position) positions[id] = position;
      });
    }
    const steps = requestFlowClient.buildSteps({
      graph: state.viewGraph,
      index: state.flowIndex,
      endpointId: isFindingDetailView() ? state.detailApiId : state.selectedEndpointId,
      positions,
      projection: state.layout.plan && state.layout.plan.projection,
      snapshot: state.snapshot,
      displayModel
    });
    steps.forEach((step) => {
      if (!step.transition || step.transition.kind === "internal") return;
      const path = requestFlowPath(step.transition);
      if (!path) return;
      try {
        const paths = Array.isArray(path) ? path : [path];
        const length = paths.reduce((total, item) => total + item.getTotalLength(), 0);
        step.transition.length = Number.isFinite(length) && length > 0 ? length : null;
      } catch {
        step.transition.length = null;
      }
    });
    const signature = JSON.stringify({
      view: state.view,
      endpointId: isFindingDetailView() ? state.detailApiId : state.selectedEndpointId,
      steps
    });
    const currentFlow = requestFlowController.state();
    const sameFlow = state.requestFlowSignature === signature && currentFlow.steps.length === steps.length;
    state.requestFlowSteps = sameFlow ? currentFlow.steps : steps;
    state.requestFlowPositions = positions;
    state.requestFlowSignature = signature;
    if (!sameFlow) requestFlowController.setSteps(steps);
    setRequestFlowVisibility(true);
    renderRequestFlowSafely(sameFlow ? currentFlow : requestFlowController.state());
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
        const findingEvidence = new Set(ids);
        const mappings = state.flowIndex && Array.isArray(state.flowIndex.validEdges)
          ? state.flowIndex.validEdges : Array.from(edgesById.values());
        const directMappings = mappings.filter((edge) => edge.type === "FLOWS_TO"
          && nodesById.get(edge.sourceId)?.type === "ENDPOINT"
          && nodesById.get(edge.targetId)?.type === "HANDLER"
          && edge.confidence === "CONFIRMED"
          && (edge.evidenceIds || []).some((id) => findingEvidence.has(id)));
        const directEndpointIds = new Set(directMappings.map((edge) => edge.sourceId));
        if (directEndpointIds.size === 1) addEndpoint(Array.from(directEndpointIds)[0]);
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
          const handlerIds = new Set((state.flowIndex && state.flowIndex.handlers || [])
            .filter((handler) => handler.attributes && handlers.has(handler.attributes.handler))
            .map((handler) => handler.id));
          // Finding 근거 Fact의 Handler 식별자를 공통 FLOWS_TO 인덱스로 Endpoint에 투영
          const matches = new Map(Array.from(handlerIds).flatMap((handlerId) =>
            (state.flowIndex && state.flowIndex.endpointsForHandler
              ? state.flowIndex.endpointsForHandler(handlerId) : [])
              .map((mapping) => [mapping.endpoint.id, mapping.endpoint])));
          if (handlerIds.size === 1 && matches.size === 1) addEndpoint(Array.from(matches.values())[0].id);
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
      button.textContent = `${entry.finding.title || "진단 항목"} · ${graphRenderer.findingRuleLabel(entry.finding.ruleId)} · ${graphRenderer.confidenceLabel(entry.finding.confidence)}`;
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

  // 교육 상태 판정에 사용할 현재 상세 Endpoint의 확인된 첫 매칭 Chain
  function filterEducationChainId() {
    const endpointId = isFindingDetailView() ? state.detailApiId
      : isDetailView() ? state.selectedEndpointId : null;
    if (!endpointId || !state.flowIndex || !state.flowIndex.firstMatchedChain) return null;
    const match = state.flowIndex.firstMatchedChain(endpointId);
    return match && match.status === "CONFIRMED" && match.chain ? match.chain.id : null;
  }

  function selectView(view, preserveFeatureSelection = false) {
    if (!viewNames[view]) return;
    const viewChanged = state.view !== view;
    if (viewChanged) state.graphHover = null;
    if (viewChanged && spotlight && spotlight.isActive()) spotlight.close({ restoreFocus: false });
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
    if (graphGuides) setHidden(graphGuides, !state.display.areas);
    if (graphCanvas) graphCanvas.dataset.showEdgeLabels = String(state.display.edgeLabels);
    if (navigation && navigation.setMiniMapVisible) navigation.setMiniMapVisible(state.display.minimap);
    [[showAreasSetting, state.display.areas], [showEdgeLabelsSetting, state.display.edgeLabels],
      [showMinimapSetting, state.display.minimap]]
      .forEach(([setting, checked]) => {
        if (!setting) return;
        setting.checked = checked;
        setting.setAttribute("aria-checked", String(checked));
      });
  }

  function setPanel(panel, button, open) {
    if (!panel || !button) return;
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  }

  function isSettingsPanelOpen() {
    return Boolean(settingsPanel && settingsPanel.dataset.open === "true");
  }

  function finishSettingsPanelClose() {
    if (isSettingsPanelOpen() || !settingsPanel) return;
    if (settingsPanelTimer !== null) {
      clearTimeout(settingsPanelTimer);
      settingsPanelTimer = null;
    }
    settingsPanel.hidden = true;
  }

  function setSettingsPanel(open, restoreFocus = true) {
    if (!settingsPanel || !settingsButton) return;
    if (open && spotlight && spotlight.isActive()) spotlight.close({ restoreFocus: false });
    const wasOpen = isSettingsPanelOpen();
    if (settingsPanelTimer !== null) {
      clearTimeout(settingsPanelTimer);
      settingsPanelTimer = null;
    }
    settingsButton.setAttribute("aria-expanded", String(open));
    if (open) {
      settingsPanel.hidden = false;
      settingsPanel.inert = false;
      settingsPanel.dataset.open = "true";
      settingsPanel.setAttribute("aria-hidden", "false");
      if (settingsCloseButton && settingsCloseButton.focus) settingsCloseButton.focus();
      return;
    }

    settingsPanel.dataset.open = "false";
    settingsPanel.inert = true;
    settingsPanel.setAttribute("aria-hidden", "true");
    const reducedMotion = window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (wasOpen && !reducedMotion) settingsPanelTimer = setTimeout(finishSettingsPanelClose, 180);
    else settingsPanel.hidden = true;
    if (wasOpen && restoreFocus && settingsButton.focus) settingsButton.focus();
  }

  function closeSettingsPanel() {
    if (isSettingsPanelOpen()) setSettingsPanel(false, false);
    else if (settingsPanel) {
      settingsPanel.inert = true;
      settingsPanel.setAttribute("aria-hidden", "true");
    }
    if (settingsButton) settingsButton.setAttribute("aria-expanded", "false");
    finishSettingsPanelClose();
  }

  function closeHeaderPanels() {
    setPanel(helpPanel, helpButton, false);
    setSettingsPanel(false, false);
  }

  function toggleHeaderPanel(panel, button, otherPanel, otherButton) {
    const open = panel === settingsPanel ? !isSettingsPanelOpen() : Boolean(panel && panel.hidden);
    if (otherPanel === settingsPanel) setSettingsPanel(false, false);
    else setPanel(otherPanel, otherButton, false);
    if (panel === settingsPanel) setSettingsPanel(open);
    else setPanel(panel, button, open);
  }

  function settingsFocusableElements() {
    return [settingsCloseButton, showAreasSetting, showEdgeLabelsSetting, showMinimapSetting,
      flowNodeDurationSetting, flowSpeedSetting]
      .filter((element) => element && !element.disabled);
  }

  function isWithinElement(element, container) {
    let current = element;
    while (current) {
      if (current === container) return true;
      current = current.parentNode;
    }
    return false;
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
    state.graphHover = null;
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
      const mapping = state.flowIndex && state.flowIndex.handlerFor(state.detailApiId);
      const handler = mapping && mapping.status === "CONFIRMED" ? mapping.node : null;
      const handlerName = handler && handler.attributes && handler.attributes.handler;
      const evidenceIds = new Set(Array.isArray(entry.finding.evidenceIds) ? entry.finding.evidenceIds : []);
      if (handlerName && evidenceIds.size > 0 && ["STATE_BYPASS", "OBJECT_BINDING"].includes(entry.finding.ruleId)) {
        const type = entry.finding.ruleId === "STATE_BYPASS" ? "BUSINESS_SECURITY_STATE" : "AUTHORIZATION";
        const factTypes = entry.finding.ruleId === "STATE_BYPASS"
          ? ["BUSINESS_STATE_EVALUATION"] : ["OBJECT_AUTHORIZATION_REQUIREMENT", "OBJECT_ACCESS_PATH"];
        // 선택 Endpoint의 확정 FLOWS_TO 대상 Handler와 동일한 실제 근거 Fact만 보강
        const candidates = graph.nodes.filter((node) => node.type === type
          && node.attributes && node.attributes.handler === handlerName && factTypes.includes(node.attributes.factType)
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
    if (spotlight && spotlight.isActive()) spotlight.close({ restoreFocus: false });
    state.findingModalId = id;
    state.findingModalTrigger = trigger && trigger.parentNode ? trigger : findingTrigger(id) || state.findingModalTrigger || null;
    const scope = findingImpact(entry, isFindingDetailView() ? state.viewGraph : state.graph);
    const endpoint = state.flowIndex && state.flowIndex.nodeById.get(state.detailApiId);
    inspectorClient.renderFindingModal({
      graph: state.graph,
      snapshot: state.snapshot,
      entry,
      displayIds: state.displayIds,
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
      button.textContent = `${entry.finding.title || "진단 항목"} · ${graphRenderer.findingRuleLabel(entry.finding.ruleId)} · ${graphRenderer.confidenceLabel(entry.finding.confidence)} · 연결 위치 확인 불가`;
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
    if (!id) return null;
    if (kind === "runtime-component") {
      return state.snapshot && state.snapshot.runtimeArchitecture
        && Array.isArray(state.snapshot.runtimeArchitecture.components)
        ? state.snapshot.runtimeArchitecture.components.find((item) => item.id === id) || null : null;
    }
    if (kind === "runtime-relationship") {
      return state.snapshot && state.snapshot.runtimeArchitecture
        && Array.isArray(state.snapshot.runtimeArchitecture.relationships)
        ? state.snapshot.runtimeArchitecture.relationships.find((item) => item.id === id) || null : null;
    }
    if (!state.graph) return null;
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
    return (plan.controllerGroups || []).concat(plan.displayModel
      ? [...(plan.displayModel.groups || []), ...(plan.displayModel.composites || []),
        ...(plan.displayModel.composites || []).flatMap((card) => card.items || [])]
      : []);
  }

  function graphRelated(graph, focus) {
    const plan = state.layout && state.layout.plan;
    return inspectorClient && focus
      ? inspectorClient.related(graph, focus, displayGroups(), state.snapshot, plan && plan.displayModel,
        plan && plan.overviewRouting)
      : { nodeIds: new Set(), edgeIds: new Set() };
  }

  function updateGraphEmphasis() {
    const graph = state.visibleGraph || state.viewGraph || state.graph;
    const focus = state.selection;
    if (!graphRenderer || !state.graphRender || !graph || !graphRenderer.updateEmphasis) return;
    const related = graphRelated(graph, focus);
    graphRenderer.updateEmphasis(state.graphRender, graph, focus, related);
  }

  function clearSelection() {
    state.selection = null;
    state.graphHover = null;
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

  function selectGraphElement(kind, id, segmentEdgeIds = null, segmentId = null) {
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
    state.graphHover = null;
    if (selectedKind === "node" && item.type === "ENDPOINT" && isDetailView()
      && state.selectedEndpointId !== item.id) return openEndpointDetail(item.id);
    state.selection = { kind: selectedKind, id: selectedId };
    if (selectedKind === "edge" && Array.isArray(segmentEdgeIds) && segmentEdgeIds.length > 1) {
      state.selection.segmentEdgeIds = segmentEdgeIds.slice();
    }
    if (selectedKind === "edge" && segmentId) state.selection.segmentId = segmentId;
    state.graphHover = null;
    state.inspectorDismissed = false;
    if (inspectorClient) inspectorClient.hideHover();
    renderGraphView(state.layout ? "elk" : "initial", true);
    return state.selection;
  }

  function showGraphHover(kind, id, anchor) {
    if (!inspectorClient || !(state.viewGraph || state.graph)) return;
    state.graphHover = { kind, id };
    inspectorClient.showHover({ graph: state.viewGraph || state.graph, snapshot: state.snapshot, kind, id, anchor,
      displayIds: state.displayIds, controllerGroups: displayGroups() });
  }

  function hideGraphHover() {
    state.graphHover = null;
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
            displayIds: state.displayIds,
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
            displayIds: state.displayIds,
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
          : graphElement(state.selection.kind, state.selection.id);
      if (!visibleItem) {
        state.selection = null;
        if (inspectorClient) inspectorClient.hideHover();
      }
    }
    const related = inspectorClient
      ? inspectorClient.related(viewGraph, state.selection, displayGroups(), state.snapshot,
        state.layout && state.layout.plan && state.layout.plan.displayModel,
        state.layout && state.layout.plan && state.layout.plan.overviewRouting)
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
      view: state.view,
      layoutMode,
      edgeLabelMode: isDetailView() || isFindingDetailView() ? "detail" : "overview",
      displayEdgeLabels: state.display.edgeLabels,
      selection: state.selection,
      related,
      findings,
      displayIds: state.displayIds,
      findingSections: findingSectionsForState(viewGraph),
      selectedFindingId: state.selectedFindingId,
      onFindingClick: (id, trigger) => selectFinding(id, trigger),
      onFindingSectionClick: (id, trigger) => openFindingModal(id, trigger),
      onNodeClick: (id) => selectGraphElement("node", id),
      onNodeFocus: (id, anchor) => showGraphHover("node", id, anchor),
      onNodeBlur: hideGraphHover,
      onNodeHover: (id, anchor) => showGraphHover("node", id, anchor),
      onNodeLeave: hideGraphHover,
      onRuntimeComponentClick: (id) => selectGraphElement("runtime-component", id),
      onRuntimeComponentFocus: (id, anchor) => showGraphHover("runtime-component", id, anchor),
      onRuntimeComponentBlur: hideGraphHover,
      onRuntimeComponentHover: (id, anchor) => showGraphHover("runtime-component", id, anchor),
      onRuntimeComponentLeave: hideGraphHover,
      onRuntimeRelationshipClick: (id) => selectGraphElement("runtime-relationship", id),
      onRuntimeRelationshipFocus: (id, anchor) => showGraphHover("runtime-relationship", id, anchor),
      onRuntimeRelationshipBlur: hideGraphHover,
      onRuntimeRelationshipHover: (id, anchor) => showGraphHover("runtime-relationship", id, anchor),
      onRuntimeRelationshipLeave: hideGraphHover,
      onControllerGroupClick: (id) => selectGraphElement("controller-group", id),
      onControllerGroupFocus: (id, anchor) => showGraphHover("controller-group", id, anchor),
      onControllerGroupBlur: hideGraphHover,
      onControllerGroupHover: (id, anchor) => showGraphHover("controller-group", id, anchor),
      onControllerGroupLeave: hideGraphHover,
      onEdgeClick: (id, _anchor, edgeIds, segmentId) => selectGraphElement("edge", id, edgeIds, segmentId),
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
        inspectorClient.render({ graph: viewGraph, visibleGraph, snapshot: state.snapshot, selection: null, displayIds: state.displayIds });
      } else {
        inspectorClient.render({
          graph: viewGraph,
          visibleGraph,
          snapshot: state.snapshot,
          displayIds: state.displayIds,
          selection: state.inspectorDismissed ? null : state.selection,
          view: state.view,
          findingId: isFindingDetailView() ? state.selectedFindingId : null,
          onShowFinding: () => selectFinding(state.selectedFindingId),
          onOpenFindingEndpoint: (endpointId) => openEndpointDetail(endpointId, state.selectedFindingId),
          controllerGroups: displayGroups(),
          displayModel: state.layout && state.layout.plan && state.layout.plan.displayModel,
          overviewRouting: !isDetailView() && state.layout && state.layout.plan && state.layout.plan.overviewRouting,
          detailedFlow: isEndpointDetailView(),
          endpointChainId: filterEducationChainId()
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
      const detailAreas = layoutPlan && layoutPlan.detailBlueprint;
      const areaBounds = layoutPlan ? [
        ...(detailAreas ? (detailAreas.regions || []).map((region) => region.bounds) : [
          ...(layoutPlan.lanes || []).map((lane) => lane.bounds),
          ...(layoutPlan.chainGroups || []).map((group) => ({
            left: group.left, top: group.top, right: group.right, bottom: group.bottom
          })),
          layoutPlan.educationArea
        ]),
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
        ...((result && Array.isArray(result.runtimeBlueprintNodes)) ? result.runtimeBlueprintNodes : []),
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
    state.displayIds = graphRenderer.createDisplayIds(graph);
    state.flowIndex = flowClient ? flowClient.createIndex(graph, snapshot && snapshot.evidence) : null;
    state.findingIndex = graphRenderer.indexFindings(snapshot, graph);
    indexFindingApis();
    state.selectedFindingId = previousFindingId
      && state.findingIndex.some((item) => item.finding.id === previousFindingId) ? previousFindingId : null;
    state.findingReturnId = null;
    state.detailApiId = state.flowIndex && state.flowIndex.nodeById.has(previousDetailApiId)
      && state.flowIndex.nodeById.get(previousDetailApiId).type === "ENDPOINT" ? previousDetailApiId : "";
    if (findingRule) {
      const knownRules = new Set(Object.keys(graphRenderer.findingRuleNames));
      Array.from(findingRule.children).filter((option) => option.dataset && option.dataset.extraRule).forEach((option) => option.remove());
      const extraRules = new Set(state.findingIndex.map(({ finding }) => finding.ruleId).filter((id) => id && !knownRules.has(id)));
      Array.from(extraRules).sort().forEach((id, index) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = `기타 진단 유형 ${index + 1}`;
        option.dataset.extraRule = "true";
        findingRule.appendChild(option);
      });
    }
    state.selectedEndpointId = null;
    state.selection = null;
    state.graphHover = null;
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
      graph.detailEndpointId || "",
      graph.runtimeArchitecture && graph.runtimeArchitecture.architectureFingerprint || "",
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
      showNotice(`Graph 표시 실패: ${displayCause} · 학습 흐름 준비 실패: ${flowCause}`, "error");
    } else if (displayError) {
      showNotice(`Graph 표시 실패: ${displayCause}`, "error");
    } else if (!flowError && layout.plan && layout.plan.overviewRouting
      && layout.plan.overviewRouting.unresolved.length > 0) {
      showNotice(`표시할 수 없는 관계 ${layout.plan.overviewRouting.unresolved.length}건 · Inspector에서 원본 근거 확인`, "error");
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
      detailEndpointId: isFindingDetailView() ? state.detailApiId : isDetailView() ? state.selectedEndpointId : "",
      runtimeArchitecture: state.snapshot && state.snapshot.runtimeArchitecture || null,
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
        event.stopPropagation();
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
  function findUiElement(roots, predicate) {
    const candidates = Array.isArray(roots) ? roots : [roots];
    for (const root of candidates) {
      if (!root) continue;
      const visit = (element) => {
        if (predicate(element)) return element;
        for (const child of Array.from(element.children || [])) {
          const match = visit(child);
          if (match) return match;
        }
        return null;
      };
      const match = visit(root);
      if (match) return match;
    }
    return null;
  }

  function findUiElements(root, predicate) {
    const found = [];
    if (!root) return found;
    const visit = (element) => {
      if (predicate(element)) found.push(element);
      Array.from(element.children || []).forEach(visit);
    };
    visit(root);
    return found;
  }

  function hasUiClass(element, className) {
    return Boolean(element && element.getAttribute && (element.getAttribute("class") || "")
      .split(/\s+/).includes(className));
  }

  function graphNodeTarget(id) {
    const compositeItem = findUiElements(graphNodes, (element) => hasUiClass(element, "graph-composite-item")
      && (element.getAttribute("data-node-ids") || "").split(",").includes(id))[0];
    return compositeItem || findUiElement(graphNodes, (element) => hasUiClass(element, "graph-node")
      && (element.getAttribute("data-node-id") === id
        || (element.getAttribute("data-node-ids") || "").split(",").includes(id)));
  }

  function graphEdgeTarget(id) {
    return findUiElement(graphEdges, (element) => hasUiClass(element, "graph-edge")
      && (element.getAttribute("data-edge-id") === id
        || (element.getAttribute("data-edge-ids") || "").split(",").includes(id)));
  }

  function firstTutorialGraphNode() {
    const nodes = state.visibleGraph && state.visibleGraph.nodes || [];
    const preferred = ["ENDPOINT", "SECURITY_CHAIN", "FILTER"];
    const ordered = [...nodes.filter((node) => preferred.includes(node.type)), ...nodes];
    return ordered.map((node) => graphNodeTarget(node.id)).find(Boolean) || null;
  }

  function firstInspectorEvidence() {
    if (!inspector || inspector.hidden || !state.selection || !state.graph
      || !["node", "edge"].includes(state.selection.kind)) return null;
    const collection = state.selection.kind === "node" ? state.graph.nodes : state.graph.edges;
    const item = collection.find((candidate) => candidate.id === state.selection.id);
    const ids = item && Array.isArray(item.evidenceIds) ? item.evidenceIds : [];
    const evidence = new Set((state.snapshot && Array.isArray(state.snapshot.evidence) ? state.snapshot.evidence : [])
      .map((item) => item && item.id).filter((id) => id !== undefined && id !== null).map(String));
    const index = ids.findIndex((id) => evidence.has(String(id)));
    if (index < 0) return null;
    return findUiElements(inspector, (element) => hasUiClass(element, "inspector-evidence"))[index] || null;
  }

  function temporaryFilterHooks(target) {
    let wasOpen = null;
    let previousScrollTop = null;
    return {
      target,
      prepare: ({ target: element }) => {
        if (!filterPanel || !isWithinElement(element, filterPanel)) return true;
        wasOpen = !filterPanel.hidden;
        previousScrollTop = filterPanel.scrollTop || 0;
        if (!wasOpen) {
          // 상세 화면의 검색 목록·입력·선택 위치를 임시 패널 개방 전 상태로 복원
          const endpointState = isDetailView() && endpointOptions && endpointSearch ? {
            hidden: endpointOptions.hidden,
            expanded: endpointSearch.getAttribute("aria-expanded"),
            value: endpointSearch.value,
            optionIndex: state.featureEndpointOptionIndex,
            options: Array.from(endpointOptions.children || [])
          } : null;
          setFilterPanel(true, false);
          if (endpointState) {
            endpointOptions.replaceChildren(...endpointState.options);
            setHidden(endpointOptions, endpointState.hidden);
            if (endpointState.expanded === null) endpointSearch.removeAttribute("aria-expanded");
            else endpointSearch.setAttribute("aria-expanded", endpointState.expanded);
            endpointSearch.value = endpointState.value;
            state.featureEndpointOptionIndex = endpointState.optionIndex;
          }
        }
        if (element !== filterPanel) {
          const panelRect = filterPanel.getBoundingClientRect();
          const targetRect = element.getBoundingClientRect();
          const visibleTop = panelRect.top + (Number(filterPanel.clientTop) || 0);
          const visibleBottom = visibleTop + (Number(filterPanel.clientHeight) || panelRect.height);

          // 좁은 화면에서 패널 내부의 하단 대상도 Spotlight 프레임 안에 들어오도록 스크롤
          if (targetRect.height > visibleBottom - visibleTop) {
            filterPanel.scrollTop += targetRect.top - visibleTop;
          } else if (targetRect.top < visibleTop) {
            filterPanel.scrollTop -= visibleTop - targetRect.top;
          } else if (targetRect.bottom > visibleBottom) {
            filterPanel.scrollTop += targetRect.bottom - visibleBottom;
          }
        }
        return !filterPanel.hidden;
      },
      cleanup: () => {
        if (wasOpen === null) return;
        setFilterPanel(wasOpen, false);
        if (previousScrollTop !== null) filterPanel.scrollTop = previousScrollTop;
        wasOpen = null;
        previousScrollTop = null;
      }
    };
  }

  function selectedTutorialFinding() {
    return state.findingIndex.find((entry) => entry.finding.id === state.selectedFindingId) || null;
  }

  function findingHasEvidence(entry) {
    const evidence = new Set((state.snapshot && Array.isArray(state.snapshot.evidence) ? state.snapshot.evidence : [])
      .map((item) => item && item.id).filter((id) => id !== undefined && id !== null).map(String));
    return Boolean(entry && Array.isArray(entry.finding.evidenceIds)
      && entry.finding.evidenceIds.some((id) => evidence.has(String(id))));
  }

  function findingHasLocation(entry) {
    if (!entry || !state.graph) return false;
    const nodeIds = new Set(state.graph.nodes.map((node) => node.id));
    const edgeIds = new Set(state.graph.edges.map((edge) => edge.id));
    return entry.nodeIds.some((id) => nodeIds.has(id)) || entry.edgeIds.some((id) => edgeIds.has(id));
  }

  function findingInspectorAvailable(entry) {
    if (!entry || !isFindingDetailView() || state.inspectorDismissed) return false;
    if (!state.selection) return true;
    if (state.selection.kind === "node") return entry.nodeIds.includes(state.selection.id);
    if (state.selection.kind === "edge") return entry.edgeIds.includes(state.selection.id);
    return false;
  }

  // 실제 Finding Inspector를 임시 표시하고 학습 단계 이탈 시 기존 화면 복원
  function findingInspectorStep(titleText, description, targetRegion, isAvailable) {
    let previewOpened = false;
    let previousScroll = 0;
    const entry = () => selectedTutorialFinding();
    const isCurrentFinding = (current) => current && inspector
      && inspector.getAttribute("data-selection-kind") === "finding"
      && inspector.getAttribute("data-selection-id") === current.finding.id;
    const regionTarget = (current) => {
      if (!isCurrentFinding(current)) return inspector;
      if (targetRegion === "header") return findUiElement(inspector, (element) => hasUiClass(element, "inspector-header"));
      if (targetRegion === "evidence") {
        const ids = current.finding.evidenceIds || [];
        const evidence = new Set((state.snapshot && Array.isArray(state.snapshot.evidence) ? state.snapshot.evidence : [])
          .map((item) => item && item.id).filter((id) => id !== undefined && id !== null).map(String));
        const index = ids.findIndex((id) => evidence.has(String(id)));
        return index < 0 ? null : findUiElements(inspector, (element) => hasUiClass(element, "inspector-evidence"))[index] || null;
      }
      if (targetRegion === "guide") {
        const guides = findUiElements(inspector, (element) => hasUiClass(element, "inspector-help"));
        return guides[guides.length - 1] || null;
      }
      if (targetRegion === "location") {
        return findUiElement(inspector, (element) => (hasUiClass(element, "inspector-link")
          && (element.getAttribute("data-node-id") || element.getAttribute("data-edge-id")))
          || (hasUiClass(element, "inspector-detail-action") && element.getAttribute("data-endpoint-id")));
      }
      return inspector;
    };
    return {
      title: titleText,
      description,
      target: () => regionTarget(entry()),
      valid: () => findingInspectorAvailable(entry()) && isAvailable(entry()),
      prepare: () => {
        const current = entry();
        if (!current || !inspectorClient || !inspector) return false;
        if (isCurrentFinding(current)) return true;
        if (!findingInspectorAvailable(current)) return false;
        previousScroll = inspector.scrollTop;
        inspectorClient.renderFinding({
          graph: state.graph,
          snapshot: state.snapshot,
          entry: current,
          displayIds: state.displayIds,
          onReturn: () => selectView("security-flow"),
          onOpenEndpoint: (endpointId) => openEndpointDetail(endpointId, current.finding.id)
        });
        previewOpened = true;
        return !inspector.hidden;
      },
      cleanup: () => {
        if (!previewOpened) return;
        previewOpened = false;
        if (isFindingDetailView()) renderGraphView(state.layout ? "elk" : "initial", true);
        if (inspector) inspector.scrollTop = previousScroll;
      }
    };
  }

  function findingMarker(entry) {
    if (!entry) return null;
    return findUiElement([graphFindingSections, graphFindingSectionTitles, graphNodes, graphEdges], (element) =>
      hasUiClass(element, "finding-marker") && element.getAttribute("data-finding-id") === entry.finding.id);
  }

  function findingListItem(entry) {
    if (!entry) return null;
    return findUiElement(findingList, (element) => element.tagName === "button"
      && element.getAttribute("data-finding-id") === entry.finding.id);
  }

  function firstVisibleFinding() {
    return state.findingIndex.find((entry) => findingMarker(entry) || findingListItem(entry)) || null;
  }

  function findingAreaTarget(entry) {
    if (!entry) return null;
    const nodeIds = new Set(entry.nodeIds);
    const relatedNode = findUiElement(graphNodes, (element) => hasUiClass(element, "graph-node")
      && element.getAttribute("data-has-finding") === "true" && nodeIds.has(element.getAttribute("data-node-id")));
    return relatedNode || findingMarker(entry) || findingListItem(entry);
  }

  function findingRelatedGraphTarget(entry) {
    if (!entry || !state.visibleGraph) return null;
    for (const id of entry.nodeIds) {
      if (state.visibleGraph.nodes.some((node) => node.id === id)) {
        const target = graphNodeTarget(id);
        if (target) return target;
      }
    }
    for (const id of entry.edgeIds) {
      if (state.visibleGraph.edges.some((edge) => edge.id === id)) {
        const target = graphEdgeTarget(id);
        if (target) return target;
      }
    }
    return null;
  }

  function confirmedChainTarget() {
    if (!isDetailView() || !state.selectedEndpointId || !state.flowIndex
      || typeof state.flowIndex.firstMatchedChain !== "function") return null;
    const match = state.flowIndex.firstMatchedChain(state.selectedEndpointId);
    if (!match || match.status !== "CONFIRMED" || !match.chain) return null;
    const chain = graphNodeTarget(match.chain.id);
    if (chain) return chain;
    if (!state.flowIndex.securityFiltersForChain) return null;
    const registered = state.flowIndex.securityFiltersForChain(match.chain.id);
    for (const edge of registered && registered.edges || []) {
      const filter = state.flowIndex.nodeById.get(edge.targetId);
      if (filter && filter.type === "FILTER" && filter.attributes.registrationKind === "SECURITY") {
        const target = graphNodeTarget(filter.id);
        if (target) return target;
      }
    }
    return null;
  }

  // 현재 화면과 실제 데이터에 존재하는 Spotlight 단계 구성
  function currentScreenTutorial() {
    if (state.view === "all-flow") {
      const filterHooks = temporaryFilterHooks(() => filterPanel);
      return [
        {
          target: () => mapToolbar,
          title: "그래프 탐색",
          description: "축소·확대, 전체 맞춤, 보기 초기화, 필터로 Graph를 탐색합니다. Canvas를 드래그해 화면을 이동할 수 있습니다."
        },
        {
          ...filterHooks,
          title: "검색과 필터",
          description: "Endpoint 검색, 노드 유형, 관계 유형으로 표시 대상을 좁히고 검색 초기화로 조건을 되돌립니다.",
          valid: () => Boolean(filterPanel && endpointSearch && nodeFilter && edgeFilter)
        },
        {
          target: firstTutorialGraphNode,
          title: "보안 구성 요소",
          description: "Endpoint는 API, Chain은 보안 체인, Filter는 등록된 필터 Node입니다. 미등록 표준 필터 참고 항목은 실제 등록 Node와 구분합니다.",
          valid: () => Boolean(firstTutorialGraphNode())
        },
        {
          target: () => inspector,
          title: "상세 정보 확인",
          description: "이미 선택한 Node의 Inspector에서 속성·연결·관계·Evidence를 확인합니다. 이 단계는 선택을 바꾸지 않습니다.",
          valid: () => Boolean(state.selection && ["node", "controller-group"].includes(state.selection.kind)
            && inspector && !inspector.hidden
            && inspector.getAttribute("data-selection-id") === state.selection.id)
        },
        {
          target: () => graphMinimap,
          title: "전체 위치 파악",
          description: "미니맵의 사각형은 현재 화면 위치이고 배경은 전체 Graph입니다. 표시 설정은 이 안내에서 바꾸지 않습니다.",
          valid: () => Boolean(state.display.minimap && state.visibleGraph && state.visibleGraph.nodes.length > 0
            && graphMinimap && !graphMinimap.hidden)
        }
      ];
    }
    if (state.view === "feature-flow") {
      const filterHooks = temporaryFilterHooks(() => endpointSearch);
      const endpointDescription = sortedEndpoints().length > 0
        ? "필터 패널에서 Endpoint를 검색하고 실제 Snapshot 목록에서 선택합니다. 현재 선택된 API는 안내가 임의로 변경하지 않습니다."
        : "현재 Snapshot에 선택 가능한 Endpoint가 없습니다. Endpoint 검색·선택 UI는 그대로 두며 임의의 API를 지정하지 않습니다.";
      return [
        {
          ...filterHooks,
          title: "분석할 API",
          description: endpointDescription,
          valid: () => isDetailView() && Boolean(endpointSearch)
        },
        {
          target: confirmedChainTarget,
          title: "적용된 보안 체인",
          description: "확인된 첫 매칭 SecurityFilterChain과 등록된 Security Filter만 안내합니다. Servlet Filter 등록과 SecurityFilterChain 내부 Filter 구성은 구분하며, 미확인 순서는 확정 결과가 아닙니다.",
          valid: () => Boolean(confirmedChainTarget())
        },
        {
          target: () => requestFlowControls,
          title: "요청 전달 과정",
          description: "SecurityContext에는 현재 Authentication이 담기고, HttpServletRequest는 HTTP 요청 객체입니다. Snapshot에서 확인한 관계와 일반적인 Servlet 처리 원리를 함께 보여주며, 실제 요청별 Trace나 처리 결과를 나타내지 않습니다.",
          valid: () => Boolean(requestFlowControls && !requestFlowControls.hidden && state.requestFlowSteps.length > 0)
        },
        {
          target: () => requestFlowDetailToggle,
          title: "현재 단계 상세",
          description: "상세 버튼에서 현재 단계의 설명과 이전·다음 단계를 확인합니다.",
          valid: () => Boolean(requestFlowDetailToggle && !requestFlowDetailToggle.disabled)
        },
        {
          target: firstInspectorEvidence,
          title: "판단 근거",
          description: "Evidence 카드에서 저장된 표시 ID(있을 때), 출처와 확인 위치를 확인합니다. 인증정보 조회 근거만으로 USES_FOR_AUTHORIZATION 인가 관계를 판단하지 않습니다.",
          valid: () => Boolean(isDetailView() && state.selection && ["node", "edge"].includes(state.selection.kind)
            && firstInspectorEvidence())
        }
      ];
    }
    if (state.view === "security-flow") {
      const filterHooks = temporaryFilterHooks(() => findingFields);
      const firstFinding = () => firstVisibleFinding();
      const hasRuleAndConfidenceFilters = () => Boolean(findingRule && findingConfidence && findingFields && !findingFields.hidden);
      return [
        {
          ...temporaryFilterHooks(() => {
            const entry = firstFinding();
            return entry && findingAreaTarget(entry);
          }),
          title: "발견된 보안 문제",
          description: "실제 Finding 목록과 Graph 표시는 Snapshot 참조를 기준으로 확인합니다. 연결 위치가 없으면 별도 마커를 만들지 않습니다.",
          valid: () => Boolean(firstFinding() && findingAreaTarget(firstFinding()))
        },
        {
          ...filterHooks,
          title: "판단 상태 구분",
          description: "유형 7개와 CONFIRMED·LIKELY·UNKNOWN 필터를 사용합니다. CONFIRMED는 근거가 확인된 분석 판단, LIKELY는 검토 필요, UNKNOWN은 근거 부족이며 심각도나 실시간 탐지 수치가 아닙니다.",
          valid: hasRuleAndConfidenceFilters
        },
        {
          ...temporaryFilterHooks(() => {
            const entry = firstFinding();
            return findingMarker(entry) || findingListItem(entry);
          }),
          title: "취약점 선택",
          description: "실제 Finding 항목을 선택하면 해당 Finding의 판단과 영향 대상을 확인할 수 있습니다. 이 안내는 항목을 대신 선택하지 않습니다.",
          valid: () => Boolean(firstFinding() && (findingMarker(firstFinding()) || findingListItem(firstFinding())))
        },
        {
          target: () => findingRelatedGraphTarget(firstFinding()),
          title: "관계 확인",
          description: "선택 Finding이 실제로 참조하는 Node 또는 Edge만 강조합니다. 연결이 없거나 현재 Graph에서 확인되지 않으면 이 단계는 제외됩니다.",
          valid: () => Boolean(findingRelatedGraphTarget(firstFinding()))
        }
      ];
    }
    if (state.view === "security-detail") {
      if (state.findingIndex.length === 0) {
        return [{
          target: () => inspector,
          title: "보존된 취약점 없음",
          description: "현재 Snapshot에는 Finding이 없습니다. 보안 MAP에서 저장된 진단 결과를 확인할 수 있으며, 이 안내는 임의의 Finding을 만들지 않습니다.",
          valid: () => isFindingDetailView() && Boolean(inspector && !inspector.hidden)
        }];
      }
      const hasGuide = (entry) => typeof entry.finding.guide === "string" && entry.finding.guide.trim().length > 0;
      return [
        findingInspectorStep("판단 내용", "실제 Finding의 제목·Rule ID·판단 신뢰도를 확인합니다. Confidence는 근거에 따른 판단 상태입니다.", "header", () => true),
        findingInspectorStep("확인된 근거", "Evidence 카드의 저장된 표시 ID(있을 때), 출처와 코드·설정 위치를 확인합니다. 표시 ID를 임의로 만들지 않습니다.", "evidence", findingHasEvidence),
        findingInspectorStep("개발자 점검 가이드", "Finding에 저장된 점검 가이드입니다. 안내만 제공하며 보안 정책이나 설정을 자동으로 바꾸지 않습니다.", "guide", hasGuide),
        findingInspectorStep("관련 위치 이동", "실제 Finding이 참조하는 Node·Edge 또는 Endpoint 이동 항목을 확인합니다. 근거로 연결되지 않은 Graph 요소는 표시하지 않습니다.", "location", findingHasLocation)
      ];
    }
    return [];
  }

  helpButton.addEventListener("click", (event) => {
    if (spotlight && spotlight.isActive()) {
      event.stopPropagation();
      spotlight.restart();
      return;
    }
    if (event && event.stopPropagation) event.stopPropagation();
    if (helpPanel && !helpPanel.hidden) setPanel(helpPanel, helpButton, false);
    if (!spotlight) {
      showNotice("화면 안내를 불러오지 못했습니다. 페이지를 새로고침해 주세요.", "error");
      return;
    }
    try {
      if (!spotlight.start(currentScreenTutorial(), { trigger: helpButton })) {
        showNotice("현재 화면에서 안내할 수 있는 항목이 없습니다.", "info");
      }
    } catch (error) {
      const cause = error && error.message ? error.message : "원인 확인 불가";
      showNotice(`화면 안내를 시작하지 못했습니다: ${cause}`, "error");
    }
  });
  settingsButton.addEventListener("click", () => {
    if (spotlight && spotlight.isActive()) spotlight.close({ restoreFocus: false });
    toggleHeaderPanel(settingsPanel, settingsButton, helpPanel, helpButton);
  });
  if (settingsCloseButton) settingsCloseButton.addEventListener("click", () => setSettingsPanel(false));
  if (settingsPanel) settingsPanel.addEventListener("transitionend", (event) => {
    if (event.propertyName === "transform") finishSettingsPanelClose();
  });
  // Drawer 내부의 Escape와 Tab 순환을 다른 Graph 단축키와 분리
  if (settingsPanel) settingsPanel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setSettingsPanel(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = settingsFocusableElements();
    if (focusable.length === 0) {
      event.preventDefault();
      if (settingsPanel.focus) settingsPanel.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && event.target === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && event.target === last) {
      event.preventDefault();
      first.focus();
    }
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
  if (flowNodeDurationSetting) flowNodeDurationSetting.addEventListener("change", () => {
    const nodeHoldDuration = Number(flowNodeDurationSetting.value);
    if (![500, 1000, 1500, 2000, 3000, 5000].includes(nodeHoldDuration)) return;
    state.requestFlowSettings.nodeHoldDuration = nodeHoldDuration;
    if (requestFlowController) requestFlowController.setPlaybackSettings({ nodeHoldDuration });
  });
  if (flowSpeedSetting) flowSpeedSetting.addEventListener("change", () => {
    const speed = Number(flowSpeedSetting.value);
    if (![0.5, 1, 1.5, 2].includes(speed)) return;
    state.requestFlowSettings.speed = speed;
    if (requestFlowController) requestFlowController.setPlaybackSettings({ speed });
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
  if (requestFlowDetailToggle) requestFlowDetailToggle.addEventListener("click", () => {
    setRequestFlowDetails(!requestFlowDetailsOpen);
    if (requestFlowDetailsOpen && requestFlowDetailClose && typeof requestFlowDetailClose.focus === "function") requestFlowDetailClose.focus();
  });
  if (requestFlowDetailClose) requestFlowDetailClose.addEventListener("click", () => setRequestFlowDetails(false, true));
  if (requestFlowStart && requestFlowController) requestFlowStart.addEventListener("click", () => requestFlowController.play());
  if (requestFlowPause && requestFlowController) requestFlowPause.addEventListener("click", () => requestFlowController.pause());
  if (requestFlowReset && requestFlowController) requestFlowReset.addEventListener("click", () => requestFlowController.reset());
  if (requestFlowPrevious && requestFlowController) requestFlowPrevious.addEventListener("click", () => {
    const current = requestFlowController.state();
    requestFlowController.seekToStep(current.stepIndex - 1);
  });
  if (requestFlowNext && requestFlowController) requestFlowNext.addEventListener("click", () => {
    const current = requestFlowController.state();
    requestFlowController.seekToStep(current.stepIndex + 1);
  });
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
    if (isSettingsPanelOpen()) {
      const target = event && event.target;
      if (!isWithinElement(target, settingsButton) && !isWithinElement(target, settingsPanel)) {
        setSettingsPanel(false);
      }
    }
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
      if (spotlight && spotlight.isActive()) {
        event.preventDefault();
        spotlight.close();
        return;
      }
      if (requestFlowDetailsOpen) {
        event.preventDefault();
        setRequestFlowDetails(false, true);
        return;
      }
      if (isSettingsPanelOpen()) {
        event.preventDefault();
        setSettingsPanel(false);
        return;
      }
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
    setFilterPanel,
    closeSettingsPanel,
    navigation,
    inspector: inspectorClient
  };
  loadStatus();
})();
