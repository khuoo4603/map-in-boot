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
  const graphEdges = document.querySelector("#graph-edges");
  const graphNodes = document.querySelector("#graph-nodes");
  const flowSummary = document.querySelector("#flow-summary");
  const standardFilterReference = document.querySelector("#standard-filter-reference");
  const detailReturnAll = document.querySelector("#detail-return-all");
  const inspector = document.querySelector("#inspector");
  const graphPopover = document.querySelector("#graph-popover");
  const endpointSearch = document.querySelector("#endpoint-search");
  const nodeFilter = document.querySelector("#node-filter");
  const edgeFilter = document.querySelector("#edge-filter");
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
  const standardFiltersClient = window.MapInBootStandardFilters;
  const graphRenderer = window.MapInBootGraph;
  const layoutClient = window.MapInBootLayout;
  const navigationClient = window.MapInBootNavigation;
  const inspectorClientType = window.MapInBootInspector;
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
    flowIndex: null,
    viewGraph: null,
    graphRender: null,
    layout: null,
    layoutState: "not-requested",
    layoutRequestId: 0,
    layoutError: null,
    visibleGraph: null,
    filters: { query: "", nodeType: "", edgeType: "" },
    display: { areas: true, edgeLabels: true, minimap: true },
    loading: false,
    selection: null,
    selectedEndpointId: null,
    viewVersion: 0,
    navigation: null
  };

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

  // 전체 Flow의 실제 관계 확인 범위 요약
  function renderFlowSummary() {
    if (!flowSummary) return;
    if (!state.flowIndex) {
      flowSummary.textContent = "";
      flowSummary.hidden = true;
      return;
    }
    const summary = state.flowIndex.summary();
    flowSummary.textContent = [
      `Endpoint ${summary.endpointCount}개`,
      `첫 적용 Chain 확인 ${summary.matchedEndpointCount}개`,
      `Security Filter ${summary.securityFilterCount}개`,
      `Servlet Filter ${summary.servletFilterCount}개`,
      `Handler 대응 ${summary.handlerMatchCount}개`,
      `확인 불가 ${summary.uncertainCount}개`
    ].join(" · ");
    flowSummary.hidden = false;
  }

  // 표준 Filter 참고층을 실제 Graph와 분리한 DOM으로 갱신
  function renderStandardFilterReference(chainId = null) {
    if (!standardFilterReference) return;
    if (!state.graph || !standardFiltersClient) {
      standardFilterReference.replaceChildren();
      standardFilterReference.hidden = true;
      return;
    }
    const statuses = standardFiltersClient.classify(
      state.graph,
      state.snapshot && state.snapshot.analysisStatus,
      chainId
    );
    standardFilterReference.replaceChildren();
    const title = document.createElement("p");
    title.className = "standard-filter-reference-title";
    title.textContent = "Spring Security 7 표준 필터 참고";
    standardFilterReference.appendChild(title);
    const list = document.createElement("ul");
    list.className = "standard-filter-reference-list";
    statuses.forEach((status) => {
      const item = document.createElement("li");
      item.className = "standard-filter-reference-item";
      item.dataset.status = status.status;
      item.textContent = `${status.name} · ${status.statusLabel}`;
      item.setAttribute("aria-label", `${status.fqcn} · ${status.statusLabel}`);
      const otherChainRegistrations = (status.registrations || []).filter((registration) =>
        registration.pathStatus === "CURRENT_PATH_NOT_APPLIED"
      );
      otherChainRegistrations.forEach((registration) => {
        const detail = document.createElement("span");
        detail.className = "standard-filter-registration";
        detail.textContent = `다른 Chain ${registration.chainId || "확인 불가"} · 현재 경로 미적용`;
        item.appendChild(detail);
      });
      list.appendChild(item);
    });
    standardFilterReference.appendChild(list);
    standardFilterReference.hidden = false;
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
    if (nextOpen && endpointSearch && typeof endpointSearch.focus === "function") endpointSearch.focus();
    if (!nextOpen && returnFocus && typeof filterToggle.focus === "function") filterToggle.focus();
  }

  function isDetailView() {
    return state.view === "feature-flow";
  }

  function invalidateView() {
    state.viewVersion += 1;
    state.layoutRequestId += 1;
    state.layout = null;
    state.layoutState = "not-requested";
    state.layoutError = null;
    state.graphRender = null;
    if (graphCanvas) graphCanvas.dataset.layoutState = "not-requested";
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
    if (!isDetailView()) {
      state.selectedEndpointId = null;
      state.selection = null;
    } else if (!state.selectedEndpointId) {
      state.selection = null;
    }
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
    if (graphAreas) graphAreas.hidden = !state.display.areas;
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
      graphStateMessage.textContent = "보존 Snapshot 조회 완료 · Graph는 다음 단계에서 표시됩니다.";
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
    state.graph = null;
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
    if (graphSvg) graphSvg.hidden = true;
    if (graphEmpty) graphEmpty.hidden = false;
    if (detailReturnAll) detailReturnAll.hidden = true;
    if (filterStatus) filterStatus.textContent = "Graph 없음";
    renderFlowSummary();
    renderStandardFilterReference();
    if (message) graphStateMessage.textContent = message;
  }

  function filterValues() {
    return {
      query: endpointSearch ? endpointSearch.value : "",
      nodeType: nodeFilter ? nodeFilter.value : "",
      edgeType: edgeFilter ? edgeFilter.value : ""
    };
  }

  function graphElement(kind, id) {
    if (!state.graph || !id) return null;
    const collection = kind === "node" ? state.graph.nodes : kind === "edge" ? state.graph.edges : [];
    return collection.find((item) => item.id === id) || null;
  }

  function clearSelection() {
    state.selection = null;
    if (inspectorClient) inspectorClient.hideHover();
    if (state.viewGraph && state.viewGraph.nodes.length > 0) {
      renderGraphView(state.layout ? "elk" : "initial");
    } else if (inspectorClient) {
      inspectorClient.render({ graph: state.viewGraph || state.graph, visibleGraph: state.visibleGraph, snapshot: state.snapshot, selection: null });
    }
  }

  function selectGraphElement(kind, id) {
    const item = graphElement(kind, id);
    if (!item) return null;
    if (kind === "node" && item.type === "ENDPOINT" && isDetailView()
      && state.selectedEndpointId !== item.id) return openEndpointDetail(item.id);
    state.selection = { kind, id };
    if (inspectorClient) inspectorClient.hideHover();
    renderGraphView(state.layout ? "elk" : "initial");
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

  function renderGraphView(layoutMode) {
    const viewGraph = viewGraphForState();
    state.viewGraph = viewGraph;
    const currentFilters = filterValues();
    const positions = state.layout
      ? state.layout.positions
      : state.graphRender && state.graphRender.positions;
    if (!viewGraph || viewGraph.nodes.length === 0) {
      const emptyGraph = viewGraph || {
        nodes: [],
        edges: [],
        invalidNodes: 0,
        invalidEdges: 0,
        filters: { query: "", nodeType: "", edgeType: "" }
      };
      state.visibleGraph = emptyGraph;
      state.filters = emptyGraph.filters;
      state.selection = null;
      state.graphRender = null;
      if (graphAreas) graphAreas.replaceChildren();
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
      if (detailReturnAll) detailReturnAll.hidden = !isDetailView();
      if (filterStatus) filterStatus.textContent = isDetailView() ? "Endpoint 선택 필요" : "Graph 없음";
      graphEmpty.hidden = false;
      graphSvg.hidden = true;
      renderFlowSummary();
      renderStandardFilterReference(detailMatchChainId());
      if (isDetailView() && !state.selectedEndpointId) {
        graphStateMessage.textContent = "전체 MAP에서 Endpoint를 선택하세요.";
      } else if (isDetailView()) {
        graphStateMessage.textContent = "선택한 Endpoint의 실제 관계를 확인할 수 없습니다.";
      }
      return null;
    }
    const visibleGraph = isDetailView()
      ? { ...viewGraph, filters: { query: "", nodeType: "", edgeType: "" } }
      : graphRenderer.filter(state.graph, currentFilters);
    if (state.selection) {
      const visibleItem = state.selection.kind === "node"
        ? visibleGraph.nodes.find((node) => node.id === state.selection.id)
        : visibleGraph.edges.find((edge) => edge.id === state.selection.id);
      if (!visibleItem) {
        state.selection = null;
        if (inspectorClient) inspectorClient.hideHover();
      }
    }
    const related = inspectorClient
      ? inspectorClient.related(viewGraph, state.selection)
      : { nodeIds: new Set(), edgeIds: new Set() };
    const result = graphRenderer.render(visibleGraph, {
      svg: graphSvg,
      viewport: graphViewport,
      areaLayer: graphAreas,
      edgeLayer: graphEdges,
      nodeLayer: graphNodes
    }, {
      positions,
      edgeRoutes: state.layout && state.layout.edgeRoutes,
      bounds: state.layout && { width: state.layout.width, height: state.layout.height },
      layoutMode,
      selection: state.selection,
      related,
      onNodeClick: (id) => selectGraphElement("node", id),
      onNodeFocus: (id, anchor) => showGraphHover("node", id, anchor),
      onNodeBlur: hideGraphHover,
      onNodeHover: (id, anchor) => showGraphHover("node", id, anchor),
      onNodeLeave: hideGraphHover,
      onEdgeClick: (id) => selectGraphElement("edge", id),
      onEdgeFocus: (id, anchor) => showGraphHover("edge", id, anchor),
      onEdgeBlur: hideGraphHover,
      onEdgeHover: (id, anchor) => showGraphHover("edge", id, anchor),
      onEdgeLeave: hideGraphHover
    });
    state.visibleGraph = visibleGraph;
    state.filters = visibleGraph.filters;
    state.graphRender = result;
    renderFlowSummary();
    renderStandardFilterReference(detailMatchChainId());
    if (inspectorClient) {
      inspectorClient.render({
        graph: viewGraph,
        visibleGraph,
        snapshot: state.snapshot,
        selection: state.selection
      });
    }
    if (navigation) {
      navigation.setGraph(visibleGraph, positions || result.positions, state.layout && {
        width: state.layout.width,
        height: state.layout.height
      });
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
    graphSvg.hidden = visibleGraph.nodes.length === 0;
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
        ? "ELK.js 좌→우 자동 배치 완료"
        : "보존 Snapshot Graph 표시 완료";
    }
    if (detailReturnAll) detailReturnAll.hidden = !isDetailView();
    return result;
  }

  function renderGraph(snapshot) {
    if (!graphRenderer || !graphSvg || !graphViewport || !graphEdges || !graphNodes) {
      resetGraph("Graph 렌더러를 불러올 수 없습니다.");
      return null;
    }
    const graph = graphRenderer.normalize(snapshot);
    state.snapshot = snapshot;
    state.graph = graph;
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
      return graph;
    }
    return renderGraphView("initial");
  }

  function applyGraphFilter() {
    if (!state.graph || state.graph.nodes.length === 0) return null;
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
      graphSvg.hidden = false;
      if (navigation) navigation.fit();
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
  if (endpointSearch) endpointSearch.addEventListener("input", applyGraphFilter);
  if (nodeFilter) nodeFilter.addEventListener("change", applyGraphFilter);
  if (edgeFilter) edgeFilter.addEventListener("change", applyGraphFilter);
  const searchReset = document.querySelector("#search-reset");
  if (searchReset) searchReset.addEventListener("click", () => {
    if (endpointSearch) endpointSearch.value = "";
    if (nodeFilter) nodeFilter.value = "";
    if (edgeFilter) edgeFilter.value = "";
    applyGraphFilter();
  });
  if (detailReturnAll) detailReturnAll.addEventListener("click", returnToAllMap);
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
      && (target.closest(".graph-node") || target.closest(".graph-edge") || target.closest(".map-toolbar"))) return;
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
