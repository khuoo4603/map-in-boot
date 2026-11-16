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
  const graphEdges = document.querySelector("#graph-edges");
  const graphNodes = document.querySelector("#graph-nodes");
  const notice = document.querySelector("#shell-notice");
  const graphRenderer = window.MapInBootGraph;
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
    graphRender: null
  };

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
    if (graphSvg) graphSvg.hidden = true;
    if (graphEmpty) graphEmpty.hidden = false;
    if (message) graphStateMessage.textContent = message;
  }

  function renderGraph(snapshot) {
    if (!graphRenderer || !graphSvg || !graphViewport || !graphEdges || !graphNodes) {
      resetGraph("Graph 렌더러를 불러올 수 없습니다.");
      return null;
    }
    const graph = graphRenderer.normalize(snapshot);
    state.graph = graph;
    if (graph.nodes.length === 0) {
      resetGraph(graph.invalidNodes > 0 ? "유효한 Graph Node가 없어 표시할 수 없습니다." : "보존 Snapshot에 Graph Node가 없습니다.");
      state.graph = graph;
      return graph;
    }
    const result = graphRenderer.render(graph, {
      svg: graphSvg,
      viewport: graphViewport,
      edgeLayer: graphEdges,
      nodeLayer: graphNodes
    });
    state.graphRender = result;
    graphEmpty.hidden = true;
    graphSvg.hidden = false;
    graphStateMessage.textContent = graph.invalidNodes || graph.invalidEdges
      ? `유효하지 않은 Graph 요소 ${graph.invalidNodes + graph.invalidEdges}개를 표시에서 제외했습니다.`
      : "보존 Snapshot Graph 표시 완료";
    return result;
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
      if (state.snapshotState === "loaded") renderGraph(state.snapshot);
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
    renderGraph
  };
  loadStatus();
})();
