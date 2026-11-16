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
  const sidebar = document.querySelector("#sidebar");
  const toggle = document.querySelector("#sidebar-toggle");
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
  const inspector = document.querySelector("#inspector");
  const graphPopover = document.querySelector("#graph-popover");
  const endpointSearch = document.querySelector("#endpoint-search");
  const endpointResults = document.querySelector("#endpoint-results");
  const nodeFilter = document.querySelector("#node-filter");
  const edgeFilter = document.querySelector("#edge-filter");
  const filterStatus = document.querySelector("#graph-filter-status");
  const notice = document.querySelector("#shell-notice");
  const graphRenderer = window.MapInBootGraph;
  const layoutClient = window.MapInBootLayout;
  const navigationClient = window.MapInBootNavigation;
  const inspectorClientType = window.MapInBootInspector;
  const state = {
    pinned: false,
    hovered: false,
    view: "all-flow",
    status: null,
    snapshot: null,
    snapshotState: "not-requested",
    error: null,
    snapshotError: null,
    graph: null,
    graphRender: null,
    layout: null,
    layoutState: "not-requested",
    layoutRequestId: 0,
    layoutError: null,
    visibleGraph: null,
    filters: { query: "", nodeType: "", edgeType: "" },
    selection: null,
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
      onSelect: selectGraphElement
    })
    : null;

  function executionPhaseLabel(phase) {
    return phaseNames[phase] || "확인 불가";
  }

  function requestMessage(status, resource) {
    const code = Number(status);
    if (code === 401) return resource === "snapshot" ? "Snapshot 인증 필요" : "인증 필요";
    if (code === 403) return resource === "snapshot" ? "Snapshot 관리자 권한 필요" : "관리자 권한 필요";
    if (code === 404) return resource === "snapshot" ? "보존 Snapshot 없음" : "상태 조회 경로 없음";
    return resource === "snapshot" ? "Snapshot 조회 실패" : "상태 조회 실패";
  }

  function sidebarState() {
    if (state.pinned) return "pinned-expanded";
    if (state.hovered) return "hover-expanded";
    return "collapsed";
  }

  function renderSidebarState() {
    const current = sidebarState();
    sidebar.dataset.sidebarState = current;
    toggle.setAttribute("aria-expanded", String(state.pinned));
    toggle.setAttribute("aria-label", state.pinned ? "메뉴 접기" : "메뉴 펼치기");
    toggle.querySelector(".sidebar-label").textContent = state.pinned ? "메뉴 접기" : "메뉴 펼치기";
  }

  function showNotice(message, kind) {
    notice.textContent = message;
    notice.dataset.kind = kind || "";
    notice.hidden = false;
  }

  function selectView(view) {
    if (!viewNames[view]) return;
    state.view = view;
    title.textContent = viewNames[view];
    renderStatus();
    document.querySelectorAll(".nav-item").forEach((item) => {
      const active = item.dataset.view === view;
      item.classList.toggle("is-active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
    showNotice(`${viewNames[view]} 화면 선택`);
    if (navigation) navigation.apply();
  }

  function capturedTime(value) {
    if (!value) return "조회 전";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("ko-KR");
  }

  function snapshotLabel() {
    if (state.snapshotState === "loaded") return "보존 Snapshot 있음";
    if (state.snapshotState === "missing") return "보존 Snapshot 없음";
    if (state.snapshotState === "loading") return "Snapshot 조회 중";
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
    state.graphRender = null;
    state.visibleGraph = null;
    state.selection = null;
    if (navigation) navigation.setGraph(null);
    if (inspectorClient) {
      inspectorClient.hideHover();
      inspectorClient.render({ graph: null, visibleGraph: null, snapshot: state.snapshot, selection: null });
    }
    if (graphSvg) graphSvg.hidden = true;
    if (graphEmpty) graphEmpty.hidden = false;
    if (filterStatus) filterStatus.textContent = "Graph 없음";
    if (message) graphStateMessage.textContent = message;
  }

  function filterValues() {
    return {
      query: endpointSearch ? endpointSearch.value : "",
      nodeType: nodeFilter ? nodeFilter.value : "",
      edgeType: edgeFilter ? edgeFilter.value : ""
    };
  }

  function renderSearchResults(graph) {
    if (!endpointResults) return;
    endpointResults.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = state.filters.query ? "검색 결과 선택" : "검색어를 입력하세요";
    endpointResults.appendChild(placeholder);
    const matches = state.filters.query
      ? graph.nodes.filter((node) => node.type === "ENDPOINT")
      : [];
    matches.forEach((node) => {
      const option = document.createElement("option");
      const attributes = node.attributes || {};
      option.value = node.id;
      option.textContent = [attributes.httpMethod, attributes.path].filter(Boolean).join(" ") || node.label;
      endpointResults.appendChild(option);
    });
    endpointResults.value = "";
    endpointResults.disabled = matches.length === 0;
  }

  function graphElement(kind, id) {
    if (!state.graph || !id) return null;
    const collection = kind === "node" ? state.graph.nodes : kind === "edge" ? state.graph.edges : [];
    return collection.find((item) => item.id === id) || null;
  }

  function clearSelection() {
    state.selection = null;
    if (inspectorClient) inspectorClient.hideHover();
    if (state.graph && state.graph.nodes.length > 0) {
      renderGraphView(state.layout ? "elk" : "initial");
    } else if (inspectorClient) {
      inspectorClient.render({ graph: state.graph, visibleGraph: state.visibleGraph, snapshot: state.snapshot, selection: null });
    }
  }

  function selectGraphElement(kind, id) {
    if (!graphElement(kind, id)) return null;
    state.selection = { kind, id };
    if (inspectorClient) inspectorClient.hideHover();
    renderGraphView(state.layout ? "elk" : "initial");
    return state.selection;
  }

  function showGraphHover(kind, id, anchor) {
    if (!inspectorClient || !state.graph) return;
    inspectorClient.showHover({ graph: state.graph, snapshot: state.snapshot, kind, id, anchor });
  }

  function hideGraphHover() {
    if (inspectorClient) inspectorClient.hideHover();
  }

  function setInspectorTab(tab) {
    if (inspectorClient) inspectorClient.setTab(tab);
  }

  function renderGraphView(layoutMode) {
    const positions = state.layout
      ? state.layout.positions
      : state.graphRender && state.graphRender.positions;
    const visibleGraph = graphRenderer.filter(state.graph, filterValues());
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
      ? inspectorClient.related(state.graph, state.selection)
      : { nodeIds: new Set(), edgeIds: new Set() };
    const result = graphRenderer.render(visibleGraph, {
      svg: graphSvg,
      viewport: graphViewport,
      areaLayer: graphAreas,
      edgeLayer: graphEdges,
      nodeLayer: graphNodes,
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
    if (inspectorClient) {
      inspectorClient.render({
        graph: state.graph,
        visibleGraph,
        snapshot: state.snapshot,
        selection: state.selection
      });
    }
    renderSearchResults(visibleGraph);
    if (navigation) {
      navigation.setGraph(visibleGraph, positions || result.positions, state.layout && {
        width: state.layout.width,
        height: state.layout.height
      });
    }
    const active = Boolean(state.filters.query || state.filters.nodeType || state.filters.edgeType);
    if (filterStatus) {
      filterStatus.textContent = !active
        ? `전체 Graph · ${visibleGraph.nodes.length}개 Node · ${visibleGraph.edges.length}개 Edge`
        : visibleGraph.nodes.length === 0 && state.filters.query
          ? "검색 결과 없음 · Snapshot 원본은 유지됩니다."
          : `필터 적용 · ${visibleGraph.nodes.length}개 Node · ${visibleGraph.edges.length}개 Edge · 숨김 Node ${visibleGraph.hiddenNodes}개 · Edge ${visibleGraph.hiddenEdges}개`;
    }
    graphEmpty.hidden = visibleGraph.nodes.length > 0;
    graphSvg.hidden = visibleGraph.nodes.length === 0;
    if (visibleGraph.nodes.length === 0) {
      graphStateMessage.textContent = active
        ? state.filters.query ? "검색 결과 없음 · Snapshot 원본은 유지됩니다." : "필터 결과가 없습니다."
        : "보존 Snapshot에 Graph Node가 없습니다.";
    } else if (active) {
      graphStateMessage.textContent = `필터 적용 · 숨김 Node ${visibleGraph.hiddenNodes}개 · Edge ${visibleGraph.hiddenEdges}개`;
    } else if (visibleGraph.invalidNodes || visibleGraph.invalidEdges) {
      graphStateMessage.textContent = `유효하지 않은 Graph 요소 ${visibleGraph.invalidNodes + visibleGraph.invalidEdges}개를 표시에서 제외했습니다.`;
    } else {
      graphStateMessage.textContent = layoutMode === "elk"
        ? "ELK.js 좌→우 자동 배치 완료"
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
    state.snapshot = snapshot;
    state.graph = graph;
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
    if (!state.graph || state.graph.nodes.length === 0) return Promise.resolve(null);
    const requestId = ++state.layoutRequestId;
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
    return layoutClient.layout(state.graph).then((layout) => {
      if (requestId !== state.layoutRequestId || layout.stale) return layout;
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
          : `필터 적용 · 숨김 Node ${state.visibleGraph.hiddenNodes}개 · Edge ${state.visibleGraph.hiddenEdges}개`;
      }
      showNotice(`Graph 자동 배치 완료 · ${state.graph.nodes.length}개 Node`, "success");
      return layout;
    }).catch((error) => {
      if (requestId !== state.layoutRequestId) return null;
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
    document.querySelector("#service-name").textContent = snapshot && snapshot.serviceId
      ? snapshot.serviceId
      : "main-service";
    document.querySelector("#snapshot-time").textContent = capturedTime(persistedTime || (snapshot && snapshot.capturedAt));
  }

  async function fetchJson(url, resource) {
    const response = await fetch(url, {
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
    const button = document.querySelector("#refresh-button");
    button.disabled = true;
    state.error = null;
    state.snapshotError = null;
    state.status = null;
    state.snapshot = null;
    state.snapshotState = "loading";
    state.layout = null;
    state.layoutState = "not-requested";
    state.layoutError = null;
    state.layoutRequestId += 1;
    if (endpointSearch) endpointSearch.value = "";
    if (endpointResults) {
      endpointResults.value = "";
      endpointResults.disabled = true;
    }
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
          state.snapshotState = error.status === 404 ? "missing" : "denied";
        }
      } else {
        state.snapshotState = "missing";
      }
      updateHeader();
      renderStatus();
      if (state.snapshotState === "loaded") {
        renderGraph(state.snapshot);
        layoutGraph();
      }
      showNotice(
        state.snapshotError ? requestMessage(state.snapshotError.status, "snapshot")
          : state.snapshotState === "missing" ? "상태 조회 완료 · 보존 Snapshot 없음"
            : "상태 및 Snapshot 조회 완료",
        state.snapshotError ? "error" : "success"
      );
    } catch (error) {
      state.error = error;
      state.snapshotState = "unavailable";
      resetGraph();
      updateHeader();
      renderStatus();
      showNotice(requestMessage(error.status, "status"), "error");
    } finally {
      button.disabled = false;
    }
  }

  toggle.addEventListener("click", () => {
    state.pinned = !state.pinned;
    if (state.pinned) state.hovered = false;
    renderSidebarState();
  });
  sidebar.addEventListener("pointerenter", () => {
    if (!state.pinned) {
      state.hovered = true;
      renderSidebarState();
    }
  });
  sidebar.addEventListener("pointerleave", () => {
    if (!state.pinned) {
      state.hovered = false;
      renderSidebarState();
    }
  });
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => selectView(item.dataset.view));
  });
  document.querySelector("#help-button").addEventListener("click", (event) => {
    const expanded = event.currentTarget.getAttribute("aria-expanded") === "true";
    event.currentTarget.setAttribute("aria-expanded", String(!expanded));
    showNotice("메뉴는 포인터로 임시 확장하고, 펼치기 버튼으로 고정할 수 있습니다.");
  });
  document.querySelector("#settings-button").addEventListener("click", (event) => {
    const expanded = event.currentTarget.getAttribute("aria-expanded") === "true";
    event.currentTarget.setAttribute("aria-expanded", String(!expanded));
    showNotice("현재 설정에서는 사이드바 고정 상태만 사용할 수 있습니다.");
  });
  document.querySelector("#refresh-button").addEventListener("click", loadStatus);
  if (endpointSearch) endpointSearch.addEventListener("input", applyGraphFilter);
  if (endpointResults) endpointResults.addEventListener("change", () => {
    if (endpointResults.value && navigation) navigation.focusNode(endpointResults.value);
  });
  if (nodeFilter) nodeFilter.addEventListener("change", applyGraphFilter);
  if (edgeFilter) edgeFilter.addEventListener("change", applyGraphFilter);
  const searchReset = document.querySelector("#search-reset");
  if (searchReset) searchReset.addEventListener("click", () => {
    if (endpointSearch) endpointSearch.value = "";
    if (endpointResults) {
      endpointResults.value = "";
      endpointResults.disabled = true;
    }
    if (nodeFilter) nodeFilter.value = "";
    if (edgeFilter) edgeFilter.value = "";
    applyGraphFilter();
  });
  if (graphCanvas) graphCanvas.addEventListener("click", (event) => {
    const target = event && event.target;
    if (target && target.closest && (target.closest(".graph-node") || target.closest(".graph-edge"))) return;
    clearSelection();
  });
  if (document.addEventListener) document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideGraphHover();
      clearSelection();
    }
  });

  renderSidebarState();
  renderStatus();
  window.MapInBootUi = {
    state,
    selectView,
    renderSidebarState,
    executionPhaseLabel,
    requestMessage,
    loadStatus,
    normalizeGraph: graphRenderer && graphRenderer.normalize,
    filterGraph: graphRenderer && graphRenderer.filter,
    renderGraph,
    layoutGraph,
    applyGraphFilter,
    selectGraphElement,
    clearSelection,
    showGraphHover,
    hideGraphHover,
    setInspectorTab,
    focusEndpoint: (nodeId) => navigation && navigation.focusNode(nodeId),
    navigation,
    inspector: inspectorClient
  };
  loadStatus();
})();
