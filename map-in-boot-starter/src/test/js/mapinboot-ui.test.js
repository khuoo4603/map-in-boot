import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const indexHtml = readFileSync("map-in-boot-starter/src/main/resources/static/mapinboot/index.html", "utf8");
const appCss = readFileSync("map-in-boot-starter/src/main/resources/static/mapinboot/app.css", "utf8");
const appJs = readFileSync("map-in-boot-starter/src/main/resources/static/mapinboot/app.js", "utf8");

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (typeof listener !== "function") return;
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    dispatchEvent(event) {
      const current = event || {};
      if (!current.type) throw new Error("Event type is required");
      if (!current.target) current.target = this;
      if (current.bubbles === undefined) current.bubbles = true;
      if (!current.stopPropagation) current.stopPropagation = () => { current.cancelBubble = true; };
      if (!current.preventDefault) current.preventDefault = () => { current.defaultPrevented = true; };
      current.currentTarget = this;
      for (const listener of [...(listeners.get(current.type) || [])]) listener.call(this, current);
      if (current.bubbles && !current.cancelBubble && this.parentNode && typeof this.parentNode.dispatchEvent === "function") {
        this.parentNode.dispatchEvent(current);
      }
      return !current.defaultPrevented;
    }
  };
}

function createElement(tagName = "div") {
  const attributes = {};
  const children = [];
  const element = {
    attributes,
    children,
    tagName,
    parentNode: null,
    classList: { toggle() {} },
    dataset: {},
    hidden: false,
    textContent: "",
    value: "",
    checked: false,
    focused: false,
    clientWidth: 960,
    clientHeight: 540,
    style: {},
    append(...items) { items.forEach((item) => { item.parentNode = this; children.push(item); }); },
    appendChild(item) { item.parentNode = this; children.push(item); return item; },
    focus() { this.focused = true; },
    replaceChildren(...items) {
      children.forEach((child) => { child.parentNode = null; });
      children.length = 0;
      items.forEach((item) => { item.parentNode = this; children.push(item); });
    },
    getAttribute(name) { return attributes[name] || null; },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(attributes, name); },
    setAttribute(name, value) {
      attributes[name] = value;
      if (name === "hidden") this.hidden = true;
    },
    removeAttribute(name) {
      delete attributes[name];
      if (name === "hidden") this.hidden = false;
    },
    toggleAttribute(name, force) {
      const present = force === undefined ? !this.hasAttribute(name) : Boolean(force);
      if (present) this.setAttribute(name, "");
      else this.removeAttribute(name);
      return present;
    },
    getBoundingClientRect() {
      return {
        left: 0,
        top: 0,
        width: this.clientWidth,
        height: this.clientHeight,
        right: this.clientWidth,
        bottom: this.clientHeight
      };
    },
    closest(selector) {
      let current = this;
      while (current) {
        const className = current.getAttribute && current.getAttribute("class");
        if (selector.startsWith(".") && className && className.split(/\s+/).includes(selector.slice(1))) return current;
        current = current.parentNode;
      }
      return null;
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    querySelector() { return createElement(); }
  };
  Object.assign(element, createEventTarget());
  return element;
}

function loadUi({ fetchImpl, timers } = {}) {
  const ids = [
    "view-title", "view-state", "shell-notice", "help-button", "settings-button", "refresh-button",
    "help-panel", "settings-panel", "setting-show-areas", "setting-show-edge-labels", "setting-show-minimap",
    "graph-canvas",
    "graph-empty", "graph-state-message", "graph-svg", "graph-viewport", "graph-areas", "graph-flow-projection", "graph-guides",
    "graph-edges", "graph-nodes", "service-name", "snapshot-time", "endpoint-search", "endpoint-filter-label",
    "endpoint-options", "node-filter-field", "node-filter", "edge-filter-field", "edge-filter", "search-reset", "filter-toggle", "map-filter-panel", "zoom-in", "zoom-out", "fit-graph",
    "reset-view", "graph-filter-status", "graph-minimap", "graph-minimap-svg",
    "graph-minimap-nodes", "graph-minimap-viewport", "inspector", "graph-popover",
    "request-flow-controls", "request-flow-start", "request-flow-pause", "request-flow-reset",
    "request-flow-status", "request-flow-education", "request-flow-dot"
  ];
  const elements = new Map(ids.map((id) => [id, createElement()]));
  elements.get("help-panel").hidden = true;
  elements.get("settings-panel").hidden = true;
  elements.get("map-filter-panel").hidden = true;
  elements.get("endpoint-options").hidden = true;
  elements.get("request-flow-controls").hidden = true;
  ["graph-svg", "request-flow-education", "request-flow-dot"].forEach((id) => {
    elements.get(id).setAttribute("hidden", "");
  });
  const navigationViews = ["all-flow", "feature-flow", "security-flow", "security-detail"];
  const navigation = navigationViews.map((view) => ({
    dataset: { view },
    attributes: {},
    classList: { toggle() {} },
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name] || null; },
    removeAttribute(name) { delete this.attributes[name]; }
  }));
  navigation.forEach((item) => Object.assign(item, createEventTarget()));
  const document = Object.assign(createEventTarget(), {
    querySelector(selector) {
      return selector.startsWith("#") ? elements.get(selector.slice(1)) : createElement();
    },
    querySelectorAll(selector) {
      return selector === ".header-nav-item" ? navigation : [];
    },
    createElement(tagName) {
      return createElement(tagName);
    },
    createElementNS(_namespace, tagName) {
      return createElement(tagName);
    },
  });
  let activeFetch = fetchImpl || (() => new Promise(() => {}));
  const window = Object.assign(createEventTarget(), {});
  const layoutCalls = [];
  class FakeElk {
    constructor(options) {
      this.options = options;
    }

    layout(graph) {
      layoutCalls.push(graph);
      return Promise.resolve({
        width: 960,
        height: 720,
        children: graph.children.map((child, index) => ({
          id: child.id,
          x: 410 - index * 17,
          y: 58 + index * 37
        })),
        edges: graph.edges.map((edge, index) => ({
          id: edge.id,
          sections: [{
            startPoint: { x: 100 + index, y: 80 },
            endPoint: { x: 260 + index, y: 200 },
            bendPoints: [{ x: 180 + index, y: 140 }]
          }]
        }))
      });
    }

    terminateWorker() {}
  }
  window.ELK = FakeElk;
  const context = vm.createContext({
    console,
    document,
    window,
    fetch: (...args) => activeFetch(...args),
    setTimeout: timers ? timers.setTimeout : setTimeout,
    clearTimeout: timers ? timers.clearTimeout : clearTimeout
  });
  ["graph-flow.js", "request-flow-animation.js", "graph-standard-filters.js", "graph-renderer.js", "graph-inspector.js", "layout-client.js", "graph-navigation.js", "app.js"].forEach((file) => {
    vm.runInContext(
      readFileSync(`map-in-boot-starter/src/main/resources/static/mapinboot/${file}`, "utf8"),
      context
    );
  });
  return {
    ui: window.MapInBootUi,
    elements,
    layoutApi: window.MapInBootLayout,
    navigationApi: window.MapInBootNavigation,
    layoutCalls,
    navigation,
    document,
    window,
    setFetch(fetchFunction) { activeFetch = fetchFunction; }
  };
}

function textOf(element) {
  return [element.textContent || "", ...element.children.map(textOf)].join(" ");
}

function findAllByClass(element, className) {
  const matches = [];
  if (element.getAttribute && (element.getAttribute("class") || "").split(/\s+/).includes(className)) matches.push(element);
  element.children.forEach((child) => matches.push(...findAllByClass(child, className)));
  return matches;
}

function createFakeClock() {
  let currentTime = 0;
  let nextId = 1;
  const frames = new Map();
  return {
    now: () => currentTime,
    requestFrame(callback) {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      frames.delete(id);
    },
    tick(milliseconds) {
      currentTime += milliseconds;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(currentTime));
    },
    activeCount() {
      return frames.size;
    }
  };
}

test("Header에 로고·네비게이션·구분선·원형 액션이 정해진 순서로 존재하고 Sidebar가 없음", () => {
  assert.match(indexHtml, /class="header-logo"[^>]+src="\/mapinboot\/assets\/mapinboot_logo_transparent\.png"/);
  assert.doesNotMatch(indexHtml, /id="sidebar"|id="sidebar-toggle"|class="sidebar/);
  const views = [...indexHtml.matchAll(/class="header-nav-item[^\"]*"[^>]+data-view="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(views, ["all-flow", "feature-flow", "security-flow", "security-detail"]);
  assert.equal((indexHtml.match(/class="header-divider"/g) || []).length, 1);
  const actionOrder = ["refresh-button", "help-button", "settings-button"];
  const actionPositions = actionOrder.map((id) => indexHtml.indexOf(`id="${id}"`));
  assert.ok(actionPositions[0] < actionPositions[1] && actionPositions[1] < actionPositions[2]);
  actionOrder.forEach((id) => {
    const start = indexHtml.indexOf(`id="${id}"`);
    const end = indexHtml.indexOf(`</button>`, start);
    assert.match(indexHtml.slice(start, end), /<svg/);
    assert.match(indexHtml.slice(start, end), /data-tooltip=/);
  });
  assert.match(appCss, /\.header-action\[data-tooltip\]:hover::after/);
  assert.match(appCss, /\.header-action\[data-tooltip\]:focus-visible::after/);
});

test("Header 메타는 브랜드 옆에 있고 Graph 제목 영역은 제목만 가짐", () => {
  const headerStart = indexHtml.indexOf('<header class="app-header">');
  const headerEnd = indexHtml.indexOf("</header>", headerStart);
  const header = indexHtml.slice(headerStart, headerEnd);

  assert.ok(header.indexOf('id="service-name"') < header.indexOf('class="header-nav"'));
  assert.match(header, /class="header-meta"/);
  assert.match(header, /id="snapshot-time"/);
  assert.match(header, /id="view-state"/);
  assert.match(indexHtml, /id="view-title" class="sr-only">전체 Flow Map<\/h1>/);
});

test("Graph 배경·외곽선과 토스트 위치가 기능 영역 기준으로 정의됨", () => {
  assert.match(appCss, /radial-gradient\(/);
  assert.match(appCss, /\.graph-canvas[^\n]*border:\s*0/);
  assert.match(appCss, /\.graph-navigation-tools\s*\{[^}]*position:\s*relative/s);
  assert.match(appCss, /\.shell-notice\s*\{[^}]*position:\s*absolute/s);
  assert.match(indexHtml, /class="graph-filter-status sr-only"/);
  assert.doesNotMatch(indexHtml, /id="graph-dot-pattern"/);
});

test("Header 아래 Graph Surface가 단일 MAP이고 툴바가 Surface 내부 오버레이임", () => {
  const surfaceStart = indexHtml.indexOf('<div class="graph-surface" id="graph-canvas"');
  const toolbarStart = indexHtml.indexOf('<div class="graph-tools map-toolbar"', surfaceStart);
  assert.ok(surfaceStart >= 0);
  assert.ok(toolbarStart > surfaceStart);
  assert.doesNotMatch(indexHtml, /class="map-toolbar-title"/);
  assert.doesNotMatch(indexHtml, /class="view-heading"/);
  assert.match(appCss, /\.map-toolbar\s*\{/);
  assert.match(appCss, /\.main-content[^}]*padding:\s*0/);
  assert.match(appCss, /background-image:\s*radial-gradient\([^;]*\.22/);
});

test("MAP에 통계 문구와 표준 Filter 참고 패널을 렌더링하지 않음", () => {
  assert.doesNotMatch(indexHtml, /id="flow-summary"|class="flow-summary"/);
  assert.doesNotMatch(indexHtml, /id="standard-filter-reference"|class="standard-filter-reference"/);
  assert.doesNotMatch(appCss, /\.flow-summary|\.standard-filter-reference/);
  assert.doesNotMatch(appJs, /renderFlowSummary|renderStandardFilterReference|flowSummary|standardFilterReference/);
    assert.doesNotMatch(appJs, /Graph는 다음 단계에서 표시됩니다\./);
});

test("SVG Graph 표시 상태는 hidden 속성을 실제로 제거하고 재설정함", () => {
  const { ui, elements } = loadUi();
  assert.equal(elements.get("graph-svg").hasAttribute("hidden"), true);

  ui.renderGraph(graphFixture());
  assert.equal(elements.get("graph-svg").hasAttribute("hidden"), false);
  assert.equal(elements.get("graph-nodes").children.length, 10);
  assert.equal(elements.get("graph-edges").children.filter((child) => child.attributes.class === "graph-edge").length, 9);

  elements.get("endpoint-search").value = "없는 Endpoint";
  ui.applyGraphFilter();
  assert.equal(elements.get("graph-svg").hasAttribute("hidden"), true);

  elements.get("endpoint-search").value = "";
  ui.renderGraph(graphFixture());
  assert.equal(elements.get("graph-svg").hasAttribute("hidden"), false);
});

test("MAP 기본 툴바는 좌측 상단 5개 조작만 노출하고 검색 결과 Select를 제거함", () => {
  assert.match(appCss, /--header-height:\s*clamp\(60px/);
  assert.match(appCss, /\.map-toolbar\s*\{[^}]*left:\s*clamp\(/s);
  assert.match(indexHtml, /id="view-title" class="sr-only"/);
  assert.doesNotMatch(indexHtml, /class="map-toolbar-title"/);
  assert.doesNotMatch(indexHtml, /id="endpoint-results"|검색 결과/);
  assert.doesNotMatch(appJs, /endpointResults|renderSearchResults/);
  assert.equal((indexHtml.match(/class="graph-tool-button(?:\s|\")/g) || []).length, 5);
  assert.match(indexHtml, /id="filter-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="map-filter-panel"/);
  assert.match(indexHtml, /id="map-filter-panel"[^>]*hidden/);
});

test("기능별 상세의 별도 전체 MAP 복귀 버튼과 화면 안내 문구를 생성하지 않음", () => {
  assert.doesNotMatch(indexHtml, /id="detail-return-all"/);
  assert.doesNotMatch(appCss, /\.detail-return-all/);
  assert.doesNotMatch(appJs, /detailReturnAll/);
  assert.doesNotMatch(appJs, /전체 MAP에서 Endpoint를 선택하세요\./);
  assert.doesNotMatch(appJs, /Graph는 다음 단계에서 표시됩니다\./);
});

test("MAP 툴바·알림·필터 패널과 필터·설정 아이콘의 기준 위치를 유지함", () => {
  const surfaceStart = indexHtml.indexOf('<div class="graph-surface" id="graph-canvas"');
  const toolbarStart = indexHtml.indexOf('<div class="graph-tools map-toolbar"', surfaceStart);
  const noticeStart = indexHtml.indexOf('<div class="shell-notice" id="shell-notice"', surfaceStart);
  const settingsStart = indexHtml.indexOf('id="settings-button"');
  const settingsEnd = indexHtml.indexOf("</button>", settingsStart);
  assert.ok(noticeStart > toolbarStart);
  assert.match(indexHtml.slice(noticeStart - 100, noticeStart), /<\/div>\s*<\/div>\s*<\/div>\s*$/);
  assert.match(appCss, /\.map-toolbar\s*\{[^}]*width:\s*max-content/);
  assert.match(appCss, /\.shell-notice\s*\{[^}]*top:\s*clamp\(12px[^}]*right:\s*clamp\(16px[^}]*pointer-events:\s*none/s);
  assert.match(appCss, /\.map-filter-panel\s*\{[^}]*right:\s*0;\s*left:\s*auto;[^}]*width:\s*min\(260px/s);
  assert.match(indexHtml, /<svg class="filter-icon" viewBox="0 0 24 24"/);
  assert.match(appCss, /\.map-filter-button \.filter-icon, #settings-button \.header-icon\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;[^}]*aspect-ratio:\s*1 \/ 1/s);
  assert.match(indexHtml.slice(settingsStart, settingsEnd), /<svg class="header-icon" viewBox="0 0 24 24"/);
  assert.doesNotMatch(indexHtml.slice(settingsStart, settingsEnd), /transform=/);
});

test("필터 버튼은 패널을 열고 닫으며 기존 값과 검색 초기화 동작을 유지함", async () => {
  const { ui, elements, document } = loadUi();
  const filterToggle = elements.get("filter-toggle");
  const filterPanel = elements.get("map-filter-panel");
  filterPanel.setAttribute("class", "map-filter-panel");
  elements.get("endpoint-search").parentNode = filterPanel;
  elements.get("node-filter").parentNode = filterPanel;
  elements.get("edge-filter").parentNode = filterPanel;
  elements.get("search-reset").parentNode = filterPanel;

  assert.equal(filterPanel.hidden, true);
  assert.equal(filterToggle.getAttribute("aria-expanded"), null);
  filterToggle.dispatchEvent({ type: "click" });
  assert.equal(filterPanel.hidden, false);
  assert.equal(filterToggle.getAttribute("aria-expanded"), "true");
  assert.equal(elements.get("endpoint-search").focused, true);

  elements.get("endpoint-search").value = "get /orders";
  elements.get("node-filter").value = "ENDPOINT";
  elements.get("edge-filter").value = "SECURED_BY";
  filterToggle.dispatchEvent({ type: "click" });
  assert.equal(filterPanel.hidden, true);
  assert.equal(elements.get("endpoint-search").value, "get /orders");
  assert.equal(elements.get("node-filter").value, "ENDPOINT");
  assert.equal(elements.get("edge-filter").value, "SECURED_BY");
  assert.equal(filterToggle.focused, true);

  filterToggle.dispatchEvent({ type: "click" });
  elements.get("endpoint-search").dispatchEvent({ type: "click" });
  assert.equal(filterPanel.hidden, false);
  document.dispatchEvent({ type: "click", target: createElement() });
  assert.equal(filterPanel.hidden, true);

  filterToggle.dispatchEvent({ type: "click" });
  document.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(filterPanel.hidden, true);
  assert.equal(filterToggle.focused, true);

  filterToggle.dispatchEvent({ type: "click" });
  elements.get("search-reset").dispatchEvent({ type: "click" });
  assert.equal(elements.get("endpoint-search").value, "");
  assert.equal(elements.get("node-filter").value, "");
  assert.equal(elements.get("edge-filter").value, "");
});

test("토스트는 새 상태로 교체되고 loading만 유지되며 자동 해제됨", () => {
  let nextId = 0;
  const callbacks = new Map();
  const timers = {
    setTimeout(callback) {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      callbacks.delete(id);
    },
    run(id) {
      const callback = callbacks.get(id);
      callbacks.delete(id);
      if (callback) callback();
    },
    latest() {
      return Math.max(...callbacks.keys());
    }
  };
  const { ui, elements, navigation } = loadUi({ timers });
  ui.hideNotice();
  ui.showNotice("첫 알림", "info");
  const firstTimer = timers.latest();
  ui.showNotice("조회 중", "loading");
  timers.run(firstTimer);
  assert.equal(elements.get("shell-notice").hidden, false);
  assert.equal(elements.get("shell-notice").textContent, "조회 중");

  ui.showNotice("완료", "success");
  const successTimer = timers.latest();
  timers.run(successTimer);
  assert.equal(elements.get("shell-notice").hidden, true);
  assert.equal(elements.get("shell-notice").textContent, "");

  ui.showNotice("페이지 이동 전 알림", "info");
  navigation[1].dispatchEvent({ type: "click" });
  assert.equal(elements.get("shell-notice").textContent, "페이지 이동 전 알림");
});

test("Header 네비게이션 클릭은 기존 화면 ID와 활성 접근성 상태를 변경함", () => {
  const { ui, elements, navigation } = loadUi();
  assert.equal(navigation.length, 4);
  navigation[2].dispatchEvent({ type: "click" });
  assert.equal(ui.state.view, "security-flow");
  assert.equal(elements.get("view-title").textContent, "전체 취약점 진단 Flow Map");
  assert.equal(navigation[2].getAttribute("aria-current"), "page");
  assert.equal(navigation[0].getAttribute("aria-current"), null);
});

test("MAP 오버레이 툴바 조작은 Graph Pan 상태를 시작하지 않음", () => {
  const { ui, elements } = loadUi();
  const toolbar = createElement();
  toolbar.setAttribute("class", "map-toolbar");
  elements.get("graph-canvas").append(toolbar);

  toolbar.dispatchEvent({ type: "pointerdown", pointerId: 1, clientX: 20, clientY: 20 });

  assert.equal(ui.navigation.state.dragging, false);

  ui.renderGraph(graphFixture());
  elements.get("graph-nodes").children[2].dispatchEvent({ type: "click" });
  assert.equal(ui.state.selection.id, "node-2");
  toolbar.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selection.id, "node-2");
});

test("도움말·설정 패널과 실제 Graph 표시 설정이 동작하고 새로고침 중복 요청을 막음", () => {
  const calls = [];
  const { ui, elements } = loadUi({
    fetchImpl: (url, options) => {
      calls.push({ url, options });
      return new Promise(() => {});
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "GET");
  elements.get("refresh-button").dispatchEvent({ type: "click" });
  assert.equal(calls.length, 1);

  elements.get("help-button").dispatchEvent({ type: "click" });
  assert.equal(elements.get("help-panel").hidden, false);
  assert.equal(elements.get("help-button").getAttribute("aria-expanded"), "true");
  elements.get("settings-button").dispatchEvent({ type: "click" });
  assert.equal(elements.get("help-panel").hidden, true);
  assert.equal(elements.get("settings-panel").hidden, false);
  assert.equal(elements.get("settings-button").getAttribute("aria-expanded"), "true");

  elements.get("setting-show-areas").checked = false;
  elements.get("setting-show-areas").dispatchEvent({ type: "change" });
  assert.equal(elements.get("graph-areas").hasAttribute("hidden"), true);
  elements.get("setting-show-edge-labels").checked = false;
  elements.get("setting-show-edge-labels").dispatchEvent({ type: "change" });
  assert.equal(elements.get("graph-canvas").dataset.showEdgeLabels, "false");
  elements.get("setting-show-minimap").checked = false;
  elements.get("setting-show-minimap").dispatchEvent({ type: "change" });
  assert.equal(ui.navigation.state.minimapVisible, false);
});

test("실행 단계와 HTTP 상태를 사용자 문구로 구분함", () => {
  const { ui } = loadUi();

  assert.equal(ui.executionPhaseLabel("NOT_STARTED"), "대기");
  assert.equal(ui.executionPhaseLabel("RUNNING"), "실행 중");
  assert.equal(ui.executionPhaseLabel("PARTIAL"), "부분 완료");
  assert.equal(ui.executionPhaseLabel("COMPLETED"), "완료");
  assert.equal(ui.executionPhaseLabel("FAILED"), "실패");
  assert.equal(ui.requestMessage(401, "status"), "인증 필요");
  assert.equal(ui.requestMessage(403, "snapshot"), "Snapshot 관리자 권한 필요");
  assert.equal(ui.requestMessage(404, "snapshot"), "보존 Snapshot 없음");
  assert.equal(ui.requestMessage(404, "status"), "상태 조회 불가");
  assert.equal(ui.requestMessage(500, "snapshot"), "서버 오류");
  assert.equal(ui.requestMessage(null, "status"), "연결 오류");
});

const nodeTypes = [
  "APPLICATION", "SERVLET", "ENDPOINT", "HANDLER", "SECURITY_CHAIN",
  "FILTER", "AUTHENTICATION", "AUTHORIZATION", "SECURITY_DATA", "BUSINESS_SECURITY_STATE"
];
const edgeTypes = [
  "FLOWS_TO", "MATCHED_BY", "FILTERED_BY", "SECURED_BY", "READS_SECURITY_DATA",
  "WRITES_SECURITY_DATA", "CONVERTS_TO_AUTHORITY", "USES_FOR_AUTHORIZATION", "SECURITY_STATE"
];

function graphFixture() {
  const nodes = nodeTypes.map((type, index) => ({
    id: `node-${index}`,
    type,
    serviceId: "orders",
    label: type === "ENDPOINT" ? "GET /orders/<script>alert(1)</script>" : `${type} label`,
    attributes: type === "ENDPOINT"
      ? { httpMethod: "GET", path: "/orders/<script>alert(1)</script>", handler: "OrderController#list" }
      : type === "FILTER"
        ? { registrationKind: "SERVLET", filterClass: "AuditFilter" }
      : { evidenceKind: "runtime", typeValue: type },
    evidenceIds: [`evidence-${index}`]
  }));
  const edges = edgeTypes.map((type, index) => ({
    id: `edge-${index}`,
    sourceId: `node-${index}`,
    targetId: `node-${(index + 1) % nodeTypes.length}`,
    type,
    attributes: { relation: type },
    confidence: "CONFIRMED",
    evidenceIds: [`evidence-${index}`]
  }));
  return {
    nodes,
    edges,
    evidence: nodeTypes.map((_type, index) => ({
      id: `evidence-${index}`,
      source: "RUNTIME",
      location: `orders://node/${index}`,
      summary: `runtime evidence ${index}`
    })),
    findings: [{
      id: "finding-1",
      ruleId: "RULE-1",
      title: "실제 참조 Finding",
      description: "UI-06에서는 존재 여부만 표시",
      confidence: "UNKNOWN",
      nodeIds: ["node-2"],
      edgeIds: ["edge-3"],
      evidenceIds: ["evidence-2"],
      guide: "후속 단계"
    }]
  };
}

function flowGraphFixture() {
  const node = (id, type, label, attributes = {}) => ({
    id,
    type,
    serviceId: "orders",
    label,
    attributes,
    evidenceIds: [`evidence-${id}`]
  });
  const edge = (id, sourceId, targetId, type, attributes = {}, confidence = "CONFIRMED") => ({
    id,
    sourceId,
    targetId,
    type,
    attributes,
    confidence,
    evidenceIds: [`evidence-${id}`]
  });
  return {
    nodes: [
      node("endpoint-a", "ENDPOINT", "GET /orders", { httpMethod: "GET", path: "/orders", handler: "OrderController#list" }),
      node("endpoint-b", "ENDPOINT", "GET /accounts", { httpMethod: "GET", path: "/accounts", handler: "AccountController#list" }),
      node("handler-a", "HANDLER", "OrderController#list", { handler: "OrderController#list" }),
      node("handler-b", "HANDLER", "AccountController#list", { handler: "AccountController#list" }),
      node("chain-a", "SECURITY_CHAIN", "chain-a", { chainKey: "chain-a", chainOrder: "1", proxyBeanName: "springSecurityFilterChain" }),
      node("chain-b", "SECURITY_CHAIN", "chain-b", { chainKey: "chain-b", chainOrder: "2", proxyBeanName: "springSecurityFilterChain" }),
      node("security-filter-1", "FILTER", "SecurityFilterOne", { registrationKind: "SECURITY", filterClass: "com.example.SecurityFilterOne", chainKey: "chain-a", chainOrder: "1", filterOrder: "1" }),
      node("security-filter-2", "FILTER", "SecurityFilterTwo", { registrationKind: "SECURITY", filterClass: "com.example.SecurityFilterTwo", chainKey: "chain-a", chainOrder: "1", filterOrder: "2" }),
      node("servlet-1", "SERVLET", "DispatcherServlet", { servletClass: "org.springframework.web.servlet.DispatcherServlet" }),
      node("servlet-filter-1", "FILTER", "AuditFilter", { registrationKind: "SERVLET", filterClass: "com.example.AuditFilter", filterOrder: "1" })
    ],
    edges: [
      edge("match-a", "endpoint-a", "chain-a", "MATCHED_BY", { chainKey: "chain-a", chainOrder: "1" }),
      edge("match-b", "endpoint-b", "chain-b", "MATCHED_BY", { chainKey: "chain-b", chainOrder: "2" }),
      edge("security-filtered-1", "chain-a", "security-filter-1", "FILTERED_BY", { registrationKind: "SECURITY", filterOrder: "1" }),
      edge("security-filtered-2", "chain-a", "security-filter-2", "FILTERED_BY", { registrationKind: "SECURITY", filterOrder: "2" }),
      edge("servlet-filtered-1", "servlet-1", "servlet-filter-1", "FILTERED_BY", { registrationKind: "SERVLET", filterOrder: "1" })
    ],
    analysisStatus: { "security-chain": "READY", "security-filter-registration-analysis": "READY" }
  };
}

function standardFilterGraphFixture() {
  const graph = flowGraphFixture();
  graph.nodes.find((node) => node.id === "security-filter-1").attributes.filterClass =
    "org.springframework.security.web.csrf.CsrfFilter";
  graph.nodes.find((node) => node.id === "security-filter-2").attributes.filterClass =
    "org.springframework.security.web.context.SecurityContextHolderFilter";
  graph.nodes.push({
    id: "security-filter-3",
    type: "FILTER",
    serviceId: "orders",
    label: "CsrfFilter (다른 Chain)",
    attributes: {
      registrationKind: "SECURITY",
      filterClass: "org.springframework.security.web.csrf.CsrfFilter",
      chainKey: "chain-b",
      chainOrder: "2",
      filterOrder: "1"
    },
    evidenceIds: ["evidence-security-filter-3"]
  });
  graph.edges.push({
    id: "security-filtered-3",
    sourceId: "chain-b",
    targetId: "security-filter-3",
    type: "FILTERED_BY",
    attributes: { registrationKind: "SECURITY", filterOrder: "1" },
    confidence: "CONFIRMED",
    evidenceIds: ["evidence-security-filtered-3"]
  });
  graph.nodes.push({
    id: "custom-csrf-filter",
    type: "FILTER",
    serviceId: "orders",
    label: "Custom CsrfFilter",
    attributes: { registrationKind: "SECURITY", filterClass: "com.example.CsrfFilter", chainKey: "chain-a", filterOrder: "3" },
    evidenceIds: ["evidence-custom-csrf-filter"]
  });
  return graph;
}

function detailGraphFixture() {
  const graph = flowGraphFixture();
  const node = (id, type, label, attributes = {}) => ({
    id,
    type,
    serviceId: "orders",
    label,
    attributes,
    evidenceIds: [`evidence-${id}`]
  });
  const edge = (id, sourceId, targetId, type, attributes = {}) => ({
    id,
    sourceId,
    targetId,
    type,
    attributes,
    confidence: "CONFIRMED",
    evidenceIds: [`evidence-${id}`]
  });
  graph.nodes.push(
    node("authorization-a", "AUTHORIZATION", "Order authorization", { authorizationKind: "ROLE" }),
    node("security-data-a", "SECURITY_DATA", "Order security data", { dataType: "ACCOUNT" }),
    node("authorization-b", "AUTHORIZATION", "Account authorization", { authorizationKind: "ROLE" })
  );
  graph.edges.push(
    edge("secured-a", "handler-a", "authorization-a", "SECURED_BY", { authorizationKind: "ROLE" }),
    edge("reads-a", "authorization-a", "security-data-a", "READS_SECURITY_DATA", { usage: "READ" }),
    edge("uses-a", "authorization-a", "authorization-a", "USES_FOR_AUTHORIZATION", { usage: "DECISION" }),
    edge("secured-b", "handler-b", "authorization-b", "SECURED_BY", { authorizationKind: "ROLE" })
  );
  return graph;
}

function laneGraphFixture() {
  const node = (id, type, label, attributes = {}) => ({
    id,
    type,
    serviceId: "orders",
    label,
    attributes,
    evidenceIds: [`evidence-${id}`]
  });
  const edge = (id, sourceId, targetId, type, attributes = {}) => ({
    id,
    sourceId,
    targetId,
    type,
    attributes,
    confidence: "CONFIRMED",
    evidenceIds: [`evidence-${id}`]
  });
  const nodes = [];
  const edges = [];
  const chains = ["chain-1", "chain-2", "chain-3"];
  chains.forEach((id, index) => nodes.push(node(id, "SECURITY_CHAIN", id, { chainOrder: String(index + 1), matcherCondition: `PATH /group/${index}` })));
  for (let index = 0; index < 17; index += 1) {
    const handler = `Item${index}Controller#read`;
    nodes.push(node(`endpoint-${index}`, "ENDPOINT", `GET /api/items/${index}`, {
      httpMethod: "GET",
      path: `/api/items/${index}`,
      handler
    }));
    nodes.push(node(`handler-${index}`, "HANDLER", handler, { handler }));
    if (index < 13) edges.push(edge(`matched-${index}`, `endpoint-${index}`, chains[index % chains.length], "MATCHED_BY", {
      chainOrder: String((index % chains.length) + 1)
    }));
  }
  for (let index = 0; index < 46; index += 1) {
    const chainId = chains[index % chains.length];
    const filterId = `filter-${index}`;
    nodes.push(node(filterId, "FILTER", `SecurityFilter${index}`, {
      registrationKind: "SECURITY",
      filterClass: `org.springframework.security.web.Filter${index}`,
      filterOrder: String(Math.floor(index / chains.length) + 1),
      chainKey: chainId
    }));
    edges.push(edge(`filtered-${index}`, chainId, filterId, "FILTERED_BY", {
      registrationKind: "SECURITY",
      filterOrder: String(Math.floor(index / chains.length) + 1)
    }));
  }
  return { nodes, edges };
}

function endpointCountGraph(count) {
  const node = (id, type, label, attributes = {}) => ({
    id, type, serviceId: "orders", label, attributes, evidenceIds: [`evidence-${id}`]
  });
  const edge = (id, sourceId, targetId, type, attributes = {}) => ({
    id, sourceId, targetId, type, attributes, confidence: "CONFIRMED", evidenceIds: [`evidence-${id}`]
  });
  const nodes = [node("count-chain", "SECURITY_CHAIN", "Count chain", { chainOrder: "1", matcherCondition: "PATH /count" })];
  const edges = [];
  for (let index = 0; index < count; index += 1) {
    const handler = `com.example.CountController#method${index}(java.lang.String)`;
    nodes.push(
      node(`count-endpoint-${index}`, "ENDPOINT", `GET /count/${index}`, {
        httpMethod: "GET", path: `/count/${index}`, handler
      }),
      node(`count-handler-${index}`, "HANDLER", handler, { handler })
    );
    edges.push(edge(`count-match-${index}`, `count-endpoint-${index}`, "count-chain", "MATCHED_BY", {
      chainOrder: "1"
    }));
  }
  return { nodes, edges };
}

function wrappedFilterGraph(servletCount, securityCount) {
  const node = (id, type, label, attributes = {}) => ({
    id, type, serviceId: "orders", label, attributes, evidenceIds: [`evidence-${id}`]
  });
  const edge = (id, sourceId, targetId, type, attributes = {}) => ({
    id, sourceId, targetId, type, attributes, confidence: "CONFIRMED", evidenceIds: [`evidence-${id}`]
  });
  const nodes = [
    node("servlet", "SERVLET", "DispatcherServlet", { servletClass: "org.springframework.web.servlet.DispatcherServlet" }),
    node("chain", "SECURITY_CHAIN", "Chain", { chainOrder: "1", matcherCondition: "PATH /orders" })
  ];
  const edges = [];
  for (let index = 0; index < servletCount; index += 1) {
    const id = `servlet-filter-${index}`;
    nodes.push(node(id, "FILTER", `ServletFilter${index}`, {
      registrationKind: "SERVLET", filterClass: `com.example.ServletFilter${index}`, filterOrder: String(index + 1)
    }));
    edges.push(edge(`servlet-edge-${index}`, "servlet", id, "FILTERED_BY", {
      registrationKind: "SERVLET", filterOrder: String(index + 1)
    }));
  }
  for (let index = 0; index < securityCount; index += 1) {
    const id = `security-filter-${index}`;
    nodes.push(node(id, "FILTER", `SecurityFilter${index}`, {
      registrationKind: "SECURITY", filterClass: `com.example.SecurityFilter${index}`,
      chainKey: "chain", filterOrder: String(index + 1)
    }));
    edges.push(edge(`security-edge-${index}`, "chain", id, "FILTERED_BY", {
      registrationKind: "SECURITY", filterOrder: String(index + 1)
    }));
  }
  return { nodes, edges };
}

test("Spring Security 7 표준 Filter 판정이 FQCN·보존 Snapshot 상태·Chain 적용을 구분함", () => {
  const { window } = loadUi();
  const graph = standardFilterGraphFixture();
  const before = JSON.stringify(graph);
  const api = window.MapInBootStandardFilters;
  const ready = api.classify(graph, graph.analysisStatus);
  const readyByName = new Map(ready.map((item) => [item.fqcn, item]));

  assert.equal(readyByName.get("org.springframework.security.web.csrf.CsrfFilter").status, "REGISTERED");
  assert.equal(readyByName.get("org.springframework.security.web.context.SecurityContextHolderFilter").status, "REGISTERED");
  assert.equal(readyByName.get("org.springframework.security.web.access.intercept.AuthorizationFilter").status, "UNREGISTERED_REFERENCE");
  assert.equal(readyByName.get("com.example.CsrfFilter"), undefined);

  const detail = api.classify(graph, graph.analysisStatus, "chain-a");
  const detailByName = new Map(detail.map((item) => [item.fqcn, item]));
  assert.equal(detailByName.get("org.springframework.security.web.csrf.CsrfFilter").status, "CURRENT_PATH_APPLIED");
  assert.equal(detailByName.get("org.springframework.security.web.csrf.CsrfFilter").registrations
    .find((registration) => registration.chainId === "chain-b").pathStatus, "CURRENT_PATH_NOT_APPLIED");

  const partial = api.classify(graph, { "security-chain": "PARTIAL", "security-filter-registration-analysis": "READY" });
  assert.equal(new Map(partial.map((item) => [item.fqcn, item]))
    .get("org.springframework.security.web.access.intercept.AuthorizationFilter").status, "UNKNOWN");
  assert.equal(JSON.stringify(graph), before);
});

test("표준 Filter 판정이 실제 Graph·ELK·MiniMap 배열에 편입되지 않음", async () => {
  const { ui, elements, layoutCalls, window } = loadUi();
  const snapshot = standardFilterGraphFixture();
  ui.renderGraph(snapshot);
  await ui.layoutGraph();

  const statuses = window.MapInBootStandardFilters.classify(snapshot, snapshot.analysisStatus);
  assert.equal(statuses.some((item) => item.status === "UNREGISTERED_REFERENCE"), true);
  assert.equal(statuses.some((item) => item.status === "REGISTERED"), true);
  assert.equal(ui.state.graph.nodes.some((node) => node.id.startsWith("standard-filter-")), false);
  assert.equal(layoutCalls[0].children.length, snapshot.nodes.length);
  assert.equal(elements.get("graph-minimap-nodes").children.length,
    snapshot.nodes.length + ui.state.layout.plan.projection.nodes.length);
});

test("Endpoint 상세 파생 Graph가 실제 Chain·Filter·보안 관계만 보존하고 합성 Edge를 만들지 않음", () => {
  const { window } = loadUi();
  const normalized = window.MapInBootGraph.normalize(detailGraphFixture());
  const before = JSON.stringify(normalized);
  const detail = window.MapInBootFlow.deriveEndpointGraph(normalized, "endpoint-a");
  const nodeIds = Array.from(detail.nodes, (node) => node.id);
  const edgeIds = Array.from(detail.edges, (edge) => edge.id);

  assert.deepEqual(nodeIds, [
    "endpoint-a", "handler-a", "chain-a", "security-filter-1", "security-filter-2",
    "authorization-a", "security-data-a"
  ]);
  assert.deepEqual(edgeIds, [
    "match-a", "security-filtered-1", "security-filtered-2", "secured-a", "reads-a", "uses-a"
  ]);
  assert.equal(detail.match.status, "CONFIRMED");
  assert.equal(detail.nodes.find((node) => node.id === "endpoint-a"), normalized.nodes.find((node) => node.id === "endpoint-a"));
  assert.equal(detail.edges.find((edge) => edge.id === "secured-a"), normalized.edges.find((edge) => edge.id === "secured-a"));
  assert.equal(detail.edges.some((edge) => edge.sourceId === "endpoint-a" && edge.targetId === "handler-a"), false);
  assert.equal(nodeIds.includes("endpoint-b"), false);
  assert.equal(nodeIds.includes("chain-b"), false);
  assert.equal(nodeIds.includes("security-filter-3"), false);
  assert.equal(detail.edges.every((edge) => nodeIds.includes(edge.sourceId) && nodeIds.includes(edge.targetId)), true);
  assert.equal(JSON.stringify(normalized), before);
});

test("Endpoint 상세 Graph는 고정 깊이를 넘는 확인된 보안정보를 포함하되 다른 Endpoint·Chain으로 확산하지 않음", () => {
  const { window } = loadUi();
  const graph = detailGraphFixture();
  const node = (id, type, label) => ({
    id, type, serviceId: "orders", label, attributes: {}, evidenceIds: [`evidence-${id}`]
  });
  const edge = (id, sourceId, targetId, type) => ({
    id, sourceId, targetId, type, attributes: {}, confidence: "CONFIRMED", evidenceIds: [`evidence-${id}`]
  });
  graph.nodes.push(
    node("security-data-b", "SECURITY_DATA", "Data B"),
    node("security-data-c", "SECURITY_DATA", "Data C"),
    node("security-data-d", "SECURITY_DATA", "Data D"),
    node("security-data-e", "SECURITY_DATA", "Data E"),
    node("unrelated-endpoint", "ENDPOINT", "GET /unrelated"),
    node("unrelated-chain", "SECURITY_CHAIN", "Chain unrelated")
  );
  graph.edges.push(
    edge("reads-b", "security-data-a", "security-data-b", "READS_SECURITY_DATA"),
    edge("reads-c", "security-data-b", "security-data-c", "READS_SECURITY_DATA"),
    edge("reads-d", "security-data-c", "security-data-d", "READS_SECURITY_DATA"),
    edge("reads-e", "security-data-d", "security-data-e", "READS_SECURITY_DATA"),
    edge("unrelated-support", "security-data-e", "unrelated-endpoint", "SECURED_BY"),
    edge("unrelated-chain-edge", "security-data-e", "unrelated-chain", "SECURED_BY")
  );
  const detail = window.MapInBootFlow.deriveEndpointGraph(window.MapInBootGraph.normalize(graph), "endpoint-a");
  const ids = new Set(detail.nodes.map((item) => item.id));
  assert.equal(ids.has("security-data-e"), true);
  assert.equal(ids.has("unrelated-endpoint"), false);
  assert.equal(ids.has("unrelated-chain"), false);
  assert.equal(detail.edges.some((item) => item.id === "reads-e"), true);
  assert.equal(detail.edges.some((item) => item.id === "unrelated-support"), false);
});

test("MATCHED_BY가 없거나 복수·불확실한 Endpoint 상세는 임의 Chain을 선택하지 않음", () => {
  const { window } = loadUi();
  const raw = detailGraphFixture();
  raw.edges = raw.edges.filter((edge) => edge.id !== "match-a");
  raw.edges.push({
    id: "match-a-uncertain",
    sourceId: "endpoint-a",
    targetId: "chain-a",
    type: "MATCHED_BY",
    attributes: { chainKey: "chain-a" },
    confidence: "UNKNOWN",
    evidenceIds: []
  });
  raw.edges.push({
    id: "match-a-second",
    sourceId: "endpoint-a",
    targetId: "chain-b",
    type: "MATCHED_BY",
    attributes: { chainKey: "chain-b" },
    confidence: "CONFIRMED",
    evidenceIds: []
  });
  const detail = window.MapInBootFlow.deriveEndpointGraph(window.MapInBootGraph.normalize(raw), "endpoint-a");
  const nodeIds = Array.from(detail.nodes, (node) => node.id);

  assert.equal(detail.match.status, "UNCERTAIN");
  assert.deepEqual(nodeIds, ["endpoint-a", "handler-a", "authorization-a", "security-data-a"]);
  assert.equal(detail.edges.some((edge) => edge.type === "MATCHED_BY"), false);
  assert.equal(detail.edges.some((edge) => edge.type === "FILTERED_BY"), false);
  assert.equal(detail.edges.some((edge) => edge.id === "secured-a"), true);
  assert.equal(detail.edges.some((edge) => edge.id === "reads-a"), true);
});

test("기능별 상세 직접 진입은 첫 API를 선택하고 별도 복귀 버튼 없이 상단 메뉴를 유지함", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(detailGraphFixture());

  ui.selectView("feature-flow");
  await ui.layoutGraph();
  assert.equal(ui.state.selectedEndpointId, "endpoint-b");
  assert.equal(ui.state.visibleGraph.nodes.some((node) => node.id === "endpoint-b"), true);
  assert.equal(elements.get("node-filter-field").hidden, true);
  assert.equal(elements.get("edge-filter-field").hidden, true);

  ui.selectView("all-flow");
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();

  assert.equal(ui.state.view, "feature-flow");
  assert.equal(ui.state.selectedEndpointId, "endpoint-a");
  assert.deepEqual(Array.from(ui.state.visibleGraph.nodes, (node) => node.id), [
    "endpoint-a", "handler-a", "chain-a", "security-filter-1", "security-filter-2",
    "authorization-a", "security-data-a"
  ]);
  assert.equal(elements.get("endpoint-search").value, "GET /orders");
  ui.openEndpointDetail("endpoint-b");
  await ui.layoutGraph();
  assert.deepEqual(Array.from(ui.state.visibleGraph.nodes, (node) => node.id), [
    "endpoint-b", "handler-b", "chain-b", "authorization-b"
  ]);
  assert.equal(ui.state.visibleGraph.nodes.some((node) => node.id === "security-filter-1"), false);
  ui.returnToAllMap();
  assert.equal(ui.state.view, "all-flow");
  assert.equal(ui.state.selectedEndpointId, null);
});

test("기능별 상세 API 드롭다운은 Method·Path·Handler 검색과 선택 전환을 제공함", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(detailGraphFixture());
  ui.selectView("feature-flow");
  await ui.layoutGraph();

  assert.equal(elements.get("endpoint-options").hidden, true);
  elements.get("filter-toggle").dispatchEvent({ type: "click" });
  assert.equal(elements.get("node-filter-field").hidden, true);
  assert.equal(elements.get("edge-filter-field").hidden, true);
  assert.equal(elements.get("endpoint-options").hidden, false);
  assert.match(elements.get("endpoint-search").getAttribute("role"), /combobox/);

  elements.get("endpoint-search").value = "accountcontroller";
  elements.get("endpoint-search").dispatchEvent({ type: "input" });
  const option = elements.get("endpoint-options").children.find((item) => item.dataset.endpointId === "endpoint-b");
  assert.ok(option);
  option.dispatchEvent({ type: "click" });
  await ui.layoutGraph();
  assert.equal(ui.state.selectedEndpointId, "endpoint-b");
  assert.equal(elements.get("endpoint-search").value, "GET /accounts");
  assert.equal(ui.state.visibleGraph.nodes.some((node) => node.id === "authorization-b"), true);
  assert.equal(ui.state.visibleGraph.nodes.some((node) => node.id === "authorization-a"), false);
});

test("상세 MAP의 실제 READS·USES 관계와 표준 Filter 판정을 분리 유지함", async () => {
  const { ui, elements, window } = loadUi();
  const snapshot = detailGraphFixture();
  snapshot.analysisStatus = { "security-chain": "READY", "security-filter-registration-analysis": "READY" };
  snapshot.nodes.find((node) => node.id === "security-filter-1").attributes.filterClass =
    "org.springframework.security.web.csrf.CsrfFilter";
  snapshot.nodes.find((node) => node.id === "security-filter-2").attributes.filterClass =
    "org.springframework.security.web.context.SecurityContextHolderFilter";
  snapshot.nodes.push({
    id: "security-filter-b",
    type: "FILTER",
    serviceId: "orders",
    label: "CsrfFilter (다른 Chain)",
    attributes: {
      registrationKind: "SECURITY",
      filterClass: "org.springframework.security.web.csrf.CsrfFilter",
      chainKey: "chain-b",
      filterOrder: "1"
    },
    evidenceIds: ["evidence-security-filter-b"]
  });
  snapshot.edges.push({
    id: "security-filtered-b",
    sourceId: "chain-b",
    targetId: "security-filter-b",
    type: "FILTERED_BY",
    attributes: { registrationKind: "SECURITY", filterOrder: "1" },
    confidence: "CONFIRMED",
    evidenceIds: ["evidence-security-filtered-b"]
  });
  snapshot.evidence = ["reads-a", "uses-a"].map((id) => ({
    id,
    source: "RUNTIME",
    location: `orders://${id}`,
    summary: `${id} 근거`
  }));

  ui.renderGraph(snapshot);
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();
  const detailNodeIds = Array.from(ui.state.visibleGraph.nodes, (node) => node.id);
  assert.equal(detailNodeIds.includes("security-filter-b"), false);
  const standardStatuses = window.MapInBootStandardFilters.classify(snapshot, snapshot.analysisStatus, "chain-a");
  const csrfStatus = standardStatuses.find((item) =>
    item.fqcn === "org.springframework.security.web.csrf.CsrfFilter");
  assert.equal(csrfStatus.status, "CURRENT_PATH_APPLIED");
  assert.equal(csrfStatus.registrations.some((registration) => registration.pathStatus === "CURRENT_PATH_NOT_APPLIED"), true);

  ui.selectGraphElement("edge", "reads-a");
  assert.match(textOf(elements.get("inspector")), /reads-a/);
  assert.match(textOf(elements.get("inspector")), /보안정보 읽음/);
  ui.selectGraphElement("edge", "uses-a");
  assert.match(textOf(elements.get("inspector")), /uses-a/);
  assert.match(textOf(elements.get("inspector")), /인가 사용/);

  elements.get("endpoint-search").value = "not-in-detail";
  ui.applyGraphFilter();
  assert.equal(ui.state.visibleGraph.nodes.length, detailNodeIds.length);
  assert.doesNotMatch(elements.get("graph-state-message").textContent, /검색·필터 조건을 적용하지 않습니다/);
});

test("Edge가 적은 Graph와 다른 Chain의 대량 Filter에서도 상세 ELK 입력 범위를 제한함", async () => {
  const { ui, layoutCalls } = loadUi();
  const graph = detailGraphFixture();
  for (let index = 0; index < 61; index += 1) {
    graph.nodes.push({
      id: `identity-filter-${index}`,
      type: "FILTER",
      serviceId: "identity",
      label: `Identity Filter ${index}`,
      attributes: {
        registrationKind: "SECURITY",
        filterClass: "com.example.IdentityFilter",
        chainKey: "chain-b",
        filterOrder: String(index + 1)
      },
      evidenceIds: []
    });
    graph.edges.push({
      id: `identity-filtered-${index}`,
      sourceId: "chain-b",
      targetId: `identity-filter-${index}`,
      type: "FILTERED_BY",
      attributes: { registrationKind: "SECURITY", filterOrder: String(index + 1) },
      confidence: "CONFIRMED",
      evidenceIds: []
    });
  }

  ui.renderGraph(graph);
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();

  assert.equal(ui.state.visibleGraph.nodes.length, 7);
  assert.equal(ui.state.visibleGraph.nodes.some((node) => node.id === "identity-filter-60"), false);
  assert.equal(layoutCalls.at(-1).children.length, 7);
});

test("Request 교육 단계가 확정 Chain·Filter 순서·Handler만 실제 Anchor로 사용함", () => {
  const { window } = loadUi();
  const animationFixture = detailGraphFixture();
  animationFixture.nodes.push(
    {
      id: "security-filter-3",
      type: "FILTER",
      serviceId: "orders",
      label: "SecurityFilterThree",
      attributes: { registrationKind: "SECURITY", chainKey: "chain-a", filterOrder: "3" },
      evidenceIds: []
    },
    {
      id: "other-chain-filter",
      type: "FILTER",
      serviceId: "orders",
      label: "OtherChainFilter",
      attributes: { registrationKind: "SECURITY", chainKey: "chain-b", filterOrder: "1" },
      evidenceIds: []
    }
  );
  animationFixture.edges.push(
    {
      id: "security-filtered-3",
      sourceId: "chain-a",
      targetId: "security-filter-3",
      type: "FILTERED_BY",
      attributes: { registrationKind: "SECURITY", filterOrder: "3" },
      confidence: "CONFIRMED",
      evidenceIds: []
    },
    {
      id: "other-chain-filtered",
      sourceId: "chain-b",
      targetId: "other-chain-filter",
      type: "FILTERED_BY",
      attributes: { registrationKind: "SECURITY", filterOrder: "1" },
      confidence: "CONFIRMED",
      evidenceIds: []
    }
  );
  const normalized = window.MapInBootGraph.normalize(animationFixture);
  const index = window.MapInBootFlow.createIndex(normalized);
  const before = JSON.stringify(normalized);
  const steps = window.MapInBootRequestFlow.buildSteps({
    graph: normalized,
    index,
    positions: {
      "chain-a": { x: 100, y: 100 },
      "security-filter-1": { x: 200, y: 100 },
      "security-filter-2": { x: 300, y: 100 },
      "handler-a": { x: 400, y: 100 }
    }
  });
  const actualAnchors = Array.from(steps
    .filter((step) => step.kind === "actual"), (step) => step.anchorId);

  assert.deepEqual(actualAnchors, ["servlet-filter-1", "chain-a", "security-filter-1", "security-filter-2", "security-filter-3", "servlet-1", "endpoint-a", "handler-a"]);
  assert.equal(steps.some((step) => step.label.includes("HTTP 요청 수신")), true);
  assert.equal(steps.some((step) => step.label.includes("동기 처리 스레드")), true);
  assert.equal(steps.some((step) => step.label.includes("응답 복귀")), true);
  assert.equal(steps.some((step) => step.anchorId === "chain-b"), false);
  assert.equal(steps.some((step) => step.anchorId === "other-chain-filter"), false);
  assert.equal(steps.some((step) => step.label.includes("Thread ID")), false);
  assert.equal(JSON.stringify(normalized), before);

  const uncertain = detailGraphFixture();
  uncertain.nodes.push({
    id: "unknown-order-filter",
    type: "FILTER",
    serviceId: "orders",
    label: "Unknown order filter",
    attributes: { registrationKind: "SECURITY", chainKey: "chain-a", filterClass: "com.example.Unknown" },
    evidenceIds: []
  });
  uncertain.edges.push({
    id: "unknown-order-filtered",
    sourceId: "chain-a",
    targetId: "unknown-order-filter",
    type: "FILTERED_BY",
    attributes: { registrationKind: "SECURITY" },
    confidence: "CONFIRMED",
    evidenceIds: []
  });
  const uncertainGraph = window.MapInBootGraph.normalize(uncertain);
  const uncertainSteps = window.MapInBootRequestFlow.buildSteps({
    graph: uncertainGraph,
    index: window.MapInBootFlow.createIndex(uncertainGraph),
    positions: {}
  });
  assert.equal(Array.from(uncertainSteps, (step) => step.anchorId).includes("security-filter-1"), false);
  assert.equal(uncertainSteps.some((step) => step.label.includes("순서 확인 불가")), true);
});

test("Request 교육 Controller가 Fake Clock에서 단일 RAF·일시정지·재시작·초기화·완료를 보장함", () => {
  const { window } = loadUi();
  const clock = createFakeClock();
  const updates = [];
  const controller = window.MapInBootRequestFlow.createController({
    clock,
    stepDuration: 100,
    onUpdate: (state) => updates.push(state)
  });
  controller.setSteps([
    { id: "step-a", label: "A", kind: "education" },
    { id: "step-b", label: "B", kind: "actual", anchorId: "node-b" },
    { id: "step-c", label: "C", kind: "education" }
  ]);

  assert.equal(controller.state().status, "idle");
  assert.equal(controller.activeFrameCount(), 0);
  controller.play();
  assert.equal(controller.state().status, "running");
  assert.equal(clock.activeCount(), 1);
  controller.play();
  assert.equal(clock.activeCount(), 1);
  clock.tick(50);
  controller.pause();
  assert.equal(controller.state().status, "paused");
  assert.equal(clock.activeCount(), 0);
  const pausedProgress = controller.state().progress;
  clock.tick(100);
  assert.equal(controller.state().progress, pausedProgress);
  controller.play();
  assert.equal(clock.activeCount(), 1);
  controller.reset();
  assert.equal(controller.state().status, "idle");
  assert.equal(controller.state().stepIndex, 0);
  assert.equal(clock.activeCount(), 0);
  controller.play();
  clock.tick(400);
  assert.equal(controller.state().status, "complete");
  assert.equal(controller.activeFrameCount(), 0);
  assert.equal(updates.some((state) => state.status === "complete"), true);
});

test("Request 교육 reduced-motion은 RAF 없이 마지막 단계와 키보드 가능한 상태를 제공함", () => {
  const { window } = loadUi();
  const clock = createFakeClock();
  const controller = window.MapInBootRequestFlow.createController({
    clock,
    reducedMotion: true,
    stepDuration: 100
  });
  controller.setSteps([
    { id: "step-a", label: "A", kind: "education" },
    { id: "step-b", label: "B", kind: "actual", anchorId: "node-b" }
  ]);
  controller.play();

  assert.equal(controller.state().status, "complete");
  assert.equal(controller.state().stepIndex, 1);
  assert.equal(controller.activeFrameCount(), 0);
  assert.equal(clock.activeCount(), 0);
});

test("Request 교육은 상세 MAP에서만 표시되고 View 복귀·문서 숨김·재조회 시 정리됨", async () => {
  const { ui, elements, document, window } = loadUi();
  const snapshot = detailGraphFixture();
  ui.renderGraph(snapshot);
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();

  assert.equal(elements.get("request-flow-controls").hidden, false);
  assert.equal(elements.get("request-flow-education").hasAttribute("hidden"), false);
  assert.match(elements.get("request-flow-status").textContent, /교육용 예시/);
  assert.equal(ui.requestFlow.state().status, "idle");

  ui.requestFlow.setSteps([{ id: "visible-dot", kind: "actual", anchorId: "endpoint-a", position: { x: 10, y: 20 } }]);
  ui.requestFlow.play();
  assert.equal(elements.get("request-flow-dot").hasAttribute("hidden"), false);
  ui.requestFlow.setSteps([]);
  assert.equal(elements.get("request-flow-dot").hasAttribute("hidden"), true);
  ui.requestFlow.setSteps([{ id: "visible-dot", kind: "actual", anchorId: "endpoint-a", position: { x: 10, y: 20 } }]);

  const sourceNodeIds = Array.from(ui.state.graph.nodes, (node) => node.id);
  const sourceEdgeIds = Array.from(ui.state.graph.edges, (edge) => edge.id);
  elements.get("request-flow-start").dispatchEvent({ type: "click" });
  assert.equal(ui.requestFlow.state().status, "running");
  ui.navigation.zoomAt(2, 480, 270);
  assert.deepEqual(Array.from(ui.state.graph.nodes, (node) => node.id), sourceNodeIds);
  assert.deepEqual(Array.from(ui.state.graph.edges, (edge) => edge.id), sourceEdgeIds);
  assert.equal(elements.get("graph-minimap-nodes").children.length,
    ui.state.graphRender.displayNodes.length + ui.state.layout.plan.projection.nodes.length);
  window.dispatchEvent({ type: "resize" });
  assert.equal(ui.requestFlow.state().status, "paused");
  document.visibilityState = "hidden";
  document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(ui.requestFlow.state().status, "paused");
  ui.returnToAllMap();
  assert.equal(elements.get("request-flow-controls").hidden, true);
  assert.equal(elements.get("request-flow-education").hasAttribute("hidden"), true);
  assert.equal(ui.requestFlow.activeFrameCount(), 0);

  ui.renderGraph(snapshot);
  assert.equal(elements.get("request-flow-controls").hidden, true);
  assert.equal(elements.get("request-flow-education").hasAttribute("hidden"), true);
  assert.equal(ui.requestFlow.activeFrameCount(), 0);
});

test("View·Endpoint 전환 중 늦게 도착한 ELK 결과가 최신 Graph·Inspector·MiniMap을 덮지 않음", async () => {
  const { ui, layoutApi } = loadUi();
  ui.renderGraph(detailGraphFixture());
  const pending = [];
  layoutApi.layout = (graph) => new Promise((resolve) => pending.push({ graph, resolve }));

  const allLayout = ui.layoutGraph();
  ui.openEndpointDetail("endpoint-a");
  ui.openEndpointDetail("endpoint-b");
  ui.selectView("all-flow");
  assert.equal(pending.length, 4);

  const createResult = (graph, marker) => ({
    width: 960,
    height: 720,
    positions: Object.fromEntries(graph.nodes.map((node, index) => [node.id, { x: marker + index, y: index }])),
    edgeRoutes: Object.fromEntries(graph.edges.map((edge) => [edge.id, { sections: [] }]))
  });
  pending[0].resolve(createResult(pending[0].graph, 10));
  pending[1].resolve(createResult(pending[1].graph, 20));
  pending[2].resolve(createResult(pending[2].graph, 30));
  pending[3].resolve(createResult(pending[3].graph, 40));
  await Promise.all([allLayout, ...pending.map(({ graph }) => graph)]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(ui.state.view, "all-flow");
  assert.equal(ui.state.selectedEndpointId, null);
  assert.ok(ui.state.layout.positions["endpoint-a"]);
  assert.equal(ui.state.visibleGraph.nodes.length, detailGraphFixture().nodes.length);
  assert.equal(ui.navigation.state.graphBounds.width, 960);
});

test("Flow 인덱스가 실제 관계·등록 종류·순서 불확실성을 분리하고 원본을 보존함", () => {
  const { window } = loadUi();
  const graph = flowGraphFixture();
  graph.nodes.push({
    id: "unknown-filter",
    type: "FILTER",
    serviceId: "orders",
    label: "UnknownFilter",
    attributes: { registrationKind: "UNKNOWN", filterClass: "com.example.UnknownFilter", filterOrder: "0" },
    evidenceIds: []
  });
  graph.edges.push({
    id: "ambiguous-match",
    sourceId: "endpoint-a",
    targetId: "chain-b",
    type: "MATCHED_BY",
    attributes: { chainKey: "chain-b", chainOrder: "2" },
    confidence: "UNKNOWN",
    evidenceIds: []
  });
  const before = JSON.stringify(graph);
  const index = window.MapInBootFlow.createIndex(graph);

  assert.equal(index.endpoints.length, 2);
  assert.equal(index.securityFilters.length, 2);
  assert.equal(index.servletFilters.length, 1);
  assert.equal(index.firstMatchedChain("endpoint-b").status, "CONFIRMED");
  assert.equal(index.firstMatchedChain("endpoint-a").status, "UNCERTAIN");
  assert.equal(index.firstMatchedChain("endpoint-a").chain, null);
  assert.equal(index.securityFiltersForChain("chain-a").orderStatus, "CONFIRMED");
  assert.deepEqual(index.securityFiltersForChain("chain-a").filters.map((item) => item.id), [
    "security-filter-1", "security-filter-2"
  ]);
  assert.equal(index.servletFiltersForServlet("servlet-1").filters[0].id, "servlet-filter-1");
  assert.equal(index.handlerFor("endpoint-a").status, "CONFIRMED");
  assert.equal(index.handlerFor("endpoint-a").node.id, "handler-a");
  const summary = index.summary();
  assert.equal(summary.endpointCount, 2);
  assert.equal(summary.matchedEndpointCount, 1);
  assert.equal(summary.securityFilterCount, 2);
  assert.equal(summary.servletFilterCount, 1);
  assert.equal(summary.handlerMatchCount, 2);
  assert.equal(summary.uncertainCount, 1);
  assert.equal(JSON.stringify(graph), before);
});

test("[T04] filterOrder 0·중복과 chainOrder 문자열은 임의 실행 순서로 승격되지 않음", () => {
  const { window } = loadUi();
  const graph = flowGraphFixture();
  graph.edges.find((edge) => edge.id === "security-filtered-1").attributes.filterOrder = "0";
  graph.edges.find((edge) => edge.id === "security-filtered-2").attributes.filterOrder = "1";
  const index = window.MapInBootFlow.createIndex(window.MapInBootGraph.normalize(graph));

  assert.equal(window.MapInBootFlow.positiveInteger("2"), 2);
  assert.equal(window.MapInBootFlow.positiveInteger("0"), null);
  assert.equal(index.securityFiltersForChain("chain-a").orderStatus, "UNKNOWN");

  graph.edges.find((edge) => edge.id === "security-filtered-1").attributes.filterOrder = "1";
  const duplicateIndex = window.MapInBootFlow.createIndex(window.MapInBootGraph.normalize(graph));
  assert.equal(duplicateIndex.securityFiltersForChain("chain-a").orderStatus, "UNKNOWN");
  const normalized = window.MapInBootGraph.normalize(graph);
  const steps = window.MapInBootRequestFlow.buildSteps({
    graph: normalized,
    index: window.MapInBootFlow.createIndex(normalized),
    endpointId: "endpoint-a",
    positions: {}
  });
  assert.equal(Array.from(steps, (step) => step.anchorId).includes("security-filter-1"), false);
});

test("[T06] 보존 Snapshot PARTIAL·UNKNOWN은 현재 상태 READY나 표준 부재로 오염되지 않음", () => {
  const { window } = loadUi();
  const graph = standardFilterGraphFixture();
  const partial = window.MapInBootStandardFilters.classify(graph, {
    "security-chain": "PARTIAL",
    "security-filter-registration-analysis": "UNKNOWN"
  });
  const statuses = new Map(partial.map((item) => [item.fqcn, item.status]));
  assert.equal(statuses.get("org.springframework.security.web.access.intercept.AuthorizationFilter"), "UNKNOWN");
  assert.equal(statuses.get("org.springframework.security.web.csrf.CsrfFilter"), "REGISTERED");
  assert.equal(window.MapInBootStandardFilters.classify(graph, {}).find((item) =>
    item.fqcn === "org.springframework.security.web.access.intercept.AuthorizationFilter").status, "UNKNOWN");
});

test("[T13] Filter 없는 부분 완료 Snapshot은 구조 Node를 유지하고 가짜 Filter 관계를 만들지 않음", () => {
  const { ui, elements, window } = loadUi();
  const graph = flowGraphFixture();
  graph.analysisStatus = { "security-chain": "PARTIAL", "security-filter-registration-analysis": "PARTIAL" };
  graph.edges = graph.edges.filter((edge) => edge.type !== "FILTERED_BY");
  ui.renderGraph(graph);

  assert.equal(ui.state.graph.nodes.filter((node) => node.type === "FILTER").length, 3);
  assert.equal(ui.state.graph.edges.some((edge) => edge.type === "FILTERED_BY"), false);
  assert.equal(window.MapInBootFlow.createIndex(ui.state.graph).securityFiltersForChain("chain-a").filters.length, 0);
  assert.equal(elements.get("graph-svg").hasAttribute("hidden"), false);
});

test("[T14] Identity형 103 Node·83 Edge·61 FILTERED_BY Graph를 ELK·MiniMap에 한 번만 전달함", async () => {
  const { ui, elements, layoutCalls } = loadUi();
  const graph = detailGraphFixture();
  for (let index = 0; index < 58; index += 1) {
    graph.nodes.push({
      id: `identity-filter-${index}`,
      type: "FILTER",
      serviceId: "identity",
      label: `Identity Filter ${index}`,
      attributes: { registrationKind: "SECURITY", filterClass: "com.example.IdentityFilter", chainKey: "chain-b", filterOrder: String(index + 1) },
      evidenceIds: []
    });
    graph.edges.push({
      id: `identity-filtered-${index}`,
      sourceId: "chain-b",
      targetId: `identity-filter-${index}`,
      type: "FILTERED_BY",
      attributes: { registrationKind: "SECURITY", filterOrder: String(index + 1) },
      confidence: "CONFIRMED",
      evidenceIds: []
    });
  }
  while (graph.nodes.length < 103) {
    const index = graph.nodes.length;
    graph.nodes.push({
      id: `identity-data-${index}`,
      type: "SECURITY_DATA",
      serviceId: "identity",
      label: `Identity Data ${index}`,
      attributes: { dataType: "SESSION" },
      evidenceIds: []
    });
  }
  const identityDataIds = graph.nodes
    .filter((node) => node.type === "SECURITY_DATA")
    .map((node) => node.id);
  while (graph.edges.length < 83) {
    const index = graph.edges.length;
    graph.edges.push({
      id: `identity-state-${index}`,
      sourceId: identityDataIds[index % identityDataIds.length],
      targetId: identityDataIds[(index + 1) % identityDataIds.length],
      type: "SECURITY_STATE",
      attributes: { stateKind: "SESSION" },
      confidence: "CONFIRMED",
      evidenceIds: []
    });
  }
  assert.equal(graph.nodes.length, 103);
  assert.equal(graph.edges.length, 83);
  assert.equal(graph.edges.filter((edge) => edge.type === "FILTERED_BY").length, 61);

  ui.renderGraph(graph);
  await ui.layoutGraph();
  assert.equal(ui.state.visibleGraph.nodes.length, 103);
  assert.equal(elements.get("graph-minimap-nodes").children.length,
    ui.state.graphRender.displayNodes.length + ui.state.layout.plan.projection.nodes.length);
  assert.equal(layoutCalls.length, 1);
  assert.equal(layoutCalls[0].children.length, 103);
  assert.equal(layoutCalls[0].edges.length, 83);
});

test("전체 MAP이 실제 구조 Edge를 보존하고 통계 문구를 표시하지 않음", () => {
  const { ui, elements } = loadUi();
  const graph = flowGraphFixture();
  const originalEdgeIds = graph.edges.map((edge) => edge.id);
  ui.renderGraph(graph);

  assert.equal(ui.state.graph.edges.map((edge) => edge.id).join(","), originalEdgeIds.join(","));
  assert.equal(elements.get("graph-svg").hasAttribute("hidden"), false);
  assert.equal(ui.state.graph.edges.some((edge) => edge.type === "FLOWS_TO"), false);
});

test("Filter 관계가 없는 Snapshot에서도 구조 Node를 유지하고 가짜 Edge를 만들지 않음", () => {
  const { window } = loadUi();
  const graph = flowGraphFixture();
  graph.edges = graph.edges.filter((edge) => edge.type !== "FILTERED_BY");
  const index = window.MapInBootFlow.createIndex(graph);

  assert.equal(index.securityFiltersForChain("chain-a").filters.length, 0);
  assert.equal(graph.nodes.filter((node) => node.type === "FILTER").length, 3);
  assert.equal(graph.edges.some((edge) => edge.type === "FILTERED_BY"), false);
});

test("Flow 필터 적용 후에도 원본 Node·Edge ID와 Evidence를 변경하지 않음", () => {
  const { ui, elements } = loadUi();
  const graph = flowGraphFixture();
  ui.renderGraph(graph);
  const nodeIds = Array.from(ui.state.graph.nodes, (node) => node.id);
  const edgeIds = Array.from(ui.state.graph.edges, (edge) => edge.id);
  const evidenceIds = Array.from(ui.state.graph.nodes.flatMap((node) => node.evidenceIds));

  elements.get("endpoint-search").value = "get /orders";
  const filtered = ui.applyGraphFilter();

  assert.deepEqual(Array.from(filtered.nodes, (node) => node.id), ["endpoint-a"]);
  assert.deepEqual(Array.from(ui.state.graph.nodes, (node) => node.id), nodeIds);
  assert.deepEqual(Array.from(ui.state.graph.edges, (edge) => edge.id), edgeIds);
  assert.deepEqual(Array.from(ui.state.graph.nodes.flatMap((node) => node.evidenceIds)), evidenceIds);
});

test("실제 10 NodeType·9 EdgeType와 방향·근거를 SVG에 보존함", () => {
  const { ui, elements } = loadUi();
  const result = ui.renderGraph(graphFixture());

  assert.deepEqual(Array.from(result.nodes, (node) => node.type), nodeTypes);
  assert.deepEqual(Array.from(result.edges, (edge) => edge.type), edgeTypes);
  assert.equal(elements.get("graph-nodes").children.length, 10);
  assert.equal(elements.get("graph-edges").children.filter((child) => child.attributes.class === "graph-edge").length, 9);
  assert.equal(elements.get("graph-edges").children[0].attributes["data-source-id"], "node-0");
  assert.equal(elements.get("graph-edges").children[0].attributes["data-target-id"], "node-1");
  assert.equal(elements.get("graph-nodes").children[2].attributes["data-node-id"], "node-2");
  assert.equal(elements.get("graph-nodes").children[2].attributes["data-evidence-ids"], "evidence-2");
});

test("Graph 표시 라벨은 짧은 한글 타입과 의미 중심 이름을 사용함", () => {
  const { ui, elements, window } = loadUi();
  const snapshot = graphFixture();
  snapshot.nodes[2].label = "endpoint|requestMappingHandlerMapping|GET|/mapinboot/api/status|com.mapinboot.starter.web.api.StatusController#status(jakarta.servlet.http.HttpServletRequest)|";
  snapshot.nodes[2].attributes = {
    httpMethod: "GET",
    path: "/mapinboot/api/status",
    handler: "com.mapinboot.starter.web.api.StatusController#status(jakarta.servlet.http.HttpServletRequest)"
  };
  snapshot.nodes[3].label = "com.mapinboot.starter.web.api.StatusController#status(jakarta.servlet.http.HttpServletRequest)";
  snapshot.nodes[3].attributes = { handler: snapshot.nodes[2].attributes.handler };
  snapshot.nodes[4].attributes = {
    chainOrder: "3",
    matcherCondition: "NOT(GET /api/legacy/account-summary/{accountId})"
  };
  snapshot.nodes[5].attributes = {
    registrationKind: "SECURITY",
    filterClass: "org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter",
    filterOrder: "8"
  };

  ui.renderGraph(snapshot);

  const nodeTexts = Array.from(elements.get("graph-nodes").children, textOf);
  assert.match(nodeTexts[0], /애플리케이션/);
  assert.match(nodeTexts[1], /서블릿/);
  assert.match(nodeTexts[2], /API/);
  assert.match(nodeTexts[2], /GET \/mapinboot\/api\/status/);
  assert.match(nodeTexts[2], /StatusController#status\(\)/);
  assert.doesNotMatch(nodeTexts[2], /com\.mapinboot/);
  assert.match(nodeTexts[3], /핸들러/);
  assert.match(nodeTexts[3], /StatusController/);
  assert.match(nodeTexts[3], /status\(\)/);
  assert.match(nodeTexts[4], /보안 체인/);
  assert.match(nodeTexts[5], /필터/);
  assert.match(nodeTexts[5], /Bearer Token Authentication Filter/);
  assert.doesNotMatch(nodeTexts[5], /org\.springframework/);

  const edgeLabels = findAllByClass(elements.get("graph-edges"), "graph-edge-label");
  assert.equal(edgeLabels.every((label) => label.attributes["data-visible"] === "false"), true);
  assert.equal(edgeLabels.filter((label) => label.textContent === "보호 근거").length, 1);
  ui.selectGraphElement("edge", "edge-3");
  const selectedLabel = findAllByClass(elements.get("graph-edges"), "graph-edge-label")
    .find((label) => label.attributes["data-edge-id"] === "edge-3");
  assert.equal(selectedLabel.attributes["data-visible"], "true");
  ui.clearSelection();
  const edgeElement = findAllByClass(elements.get("graph-edges"), "graph-edge")
    .find((edge) => edge.attributes["data-edge-id"] === "edge-3");
  edgeElement.dispatchEvent({ type: "mouseenter" });
  const hoveredLabel = findAllByClass(elements.get("graph-edges"), "graph-edge-label")
    .find((label) => label.attributes["data-edge-id"] === "edge-3");
  assert.equal(hoveredLabel.attributes["data-visible"], "true");
  edgeElement.dispatchEvent({ type: "mouseleave" });
  assert.equal(hoveredLabel.attributes["data-visible"], "false");
  assert.equal(window.MapInBootGraph.nodeTypeLabel("ENDPOINT"), "API");
  assert.equal(window.MapInBootGraph.edgeTypeLabel("FILTERED_BY"), "적용 필터");
});

test("ELK layout은 좌우 의미 그룹과 여유 간격 힌트를 전달함", () => {
  const { layoutApi } = loadUi();
  const built = layoutApi.buildGraph(graphFixture());
  assert.equal(built.layoutOptions["org.eclipse.elk.direction"], "RIGHT");
  assert.equal(built.layoutOptions["org.eclipse.elk.spacing.nodeNode"], "24");
  assert.equal(built.layoutOptions["org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers"], "72");
  assert.equal(built.layoutOptions["org.eclipse.elk.layered.layering.strategy"], "MIN_WIDTH");
  assert.equal(built.children.every((child) => child.layoutOptions === undefined), true);
});

test("고아 Edge는 제외하고 Node 텍스트는 안전한 textContent로 유지함", () => {
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  snapshot.edges.push({
    id: "edge-orphan",
    sourceId: "node-0",
    targetId: "missing-node",
    type: "FLOWS_TO",
    attributes: {},
    confidence: "UNKNOWN",
    evidenceIds: []
  });

  const result = ui.renderGraph(snapshot);
  assert.equal(result.invalidEdges, 1);
  assert.equal(elements.get("graph-edges").children.filter((child) => child.attributes.class === "graph-edge").length, 9);
  assert.equal(elements.get("graph-nodes").children.some((node) =>
    node.children.some((child) => child.textContent.includes("<script>"))), true);
  assert.equal(elements.get("graph-nodes").children.some((node) =>
    node.children.some((child) => child.tagName === "script")), false);
});

test("ELK 결과를 의미 기반 Lane으로 재배치하고 실제 관계와 안내선을 분리함", async () => {
  const { ui, elements, layoutApi, layoutCalls } = loadUi();
  const snapshot = graphFixture();
  snapshot.nodes.push({
    id: "node-security-filter",
    type: "FILTER",
    serviceId: "orders",
    label: "SecurityFilter",
    attributes: { registrationKind: "SECURITY", chainKey: "orders" },
    evidenceIds: ["evidence-security-filter"]
  });
  const initial = ui.renderGraph(snapshot);
  const layout = await ui.layoutGraph();

  assert.equal(initial.nodes.length, 11);
  assert.equal(layoutCalls.length, 1);
  assert.equal(layoutApi.version, "0.12.1");
  assert.equal(ui.state.layoutState, "loaded", ui.state.layoutError || "layout state");
  assert.equal(elements.get("graph-svg").hasAttribute("hidden"), false);
  assert.equal(elements.get("graph-svg").attributes["data-layout-mode"], "elk", JSON.stringify({
    state: ui.state.layoutState,
    error: ui.state.layoutError,
    layout: layout && layout.positions,
    rendered: ui.state.graphRender && ui.state.graphRender.positions,
    attributes: elements.get("graph-svg").attributes
  }));
  const renderedNode = elements.get("graph-nodes").children[2];
  const renderedEdge = findAllByClass(elements.get("graph-edges"), "graph-edge")[0];
  assert.equal(renderedNode.attributes.transform, `translate(${layout.positions["node-2"].x} ${layout.positions["node-2"].y})`);
  assert.match(renderedEdge.attributes.d, /^M /);
  assert.equal(ui.navigation.state.graphBounds.width, layout.width);
  assert.equal(ui.navigation.state.graphBounds.height, layout.height);
  assert.equal(elements.get("graph-areas").children.length, layout.plan.lanes.length + layout.plan.chainGroups.length);
  assert.equal(layout.positions["node-2"].x, layout.plan.lanes.find((lane) => lane.id === "endpoint").x);
  assert.equal(layout.plan.mode, "request-flow-lanes");
  assert.ok(layout.plan.lanes.find((lane) => lane.id === "security-filter").columns >= 1);
  assert.ok(layout.plan.chainGroups.length >= 1);
  const areaNodes = new Map(ui.state.graphRender.areas.map((area) => [area.id, area.nodeIds]));
  assert.equal(areaNodes.get("endpoint").length, 0);
  assert.equal(elements.get("graph-guides").children.filter((child) => child.attributes["data-guide-kind"] === "education").length, 0);
  assert.equal(elements.get("graph-guides").children.some((child) =>
    child.textContent.includes("화면 안내") || child.textContent.includes("점선: Endpoint")), false);
  assert.equal(layout.edgeRoutes["edge-0"].sections.length, 1);
  assert.equal(layoutCalls[0].layoutOptions["org.eclipse.elk.direction"], "RIGHT");
  assert.equal(layoutCalls[0].edges.some((edge) => edge.id === "edge-0"), true);
});

test("17개 API를 두 Endpoint 열에 보존하고 확인된 Chain·Handler만 대응시킴", async () => {
  const { ui, layoutApi, elements } = loadUi();
  const snapshot = laneGraphFixture();
  const originalEdgeCount = snapshot.edges.length;
  ui.renderGraph(snapshot);
  await ui.layoutGraph();

  const endpoints = ui.state.viewGraph.nodes.filter((node) => node.type === "ENDPOINT");
  const endpointXs = new Set(endpoints.map((node) => ui.state.layout.positions[node.id].x));
  assert.equal(endpoints.length, 17);
  assert.equal(endpointXs.size, 2);
  const endpointColumns = [...endpointXs].sort((left, right) => left - right)
    .map((x) => endpoints.map((node) => ui.state.layout.positions[node.id])
      .filter((position) => position.x === x).sort((left, right) => left.y - right.y));
  assert.deepEqual(endpointColumns.map((column) => column.length), [9, 8]);
  assert.equal(endpointColumns[1][0].y - endpointColumns[0][0].y, 78);
  assert.equal(ui.state.flowIndex.summary().matchedEndpointCount, 13);
  assert.equal(ui.state.flowIndex.summary().uncertainCount, 4);
  const endpointX = ui.state.layout.positions[endpoints[0].id].x;
  endpoints.forEach((endpoint) => {
    const handler = ui.state.flowIndex.handlerFor(endpoint.id).node;
    assert.ok(handler);
    assert.ok(ui.state.layout.positions[handler.id].x > endpointX);
  });
  assert.equal(ui.state.graph.edges.length, originalEdgeCount);
  assert.equal(layoutApi.buildGraph(ui.state.graph).edges.length, originalEdgeCount);
  assert.equal(elements.get("graph-guides").children.filter((child) => child.attributes["data-guide-kind"] === "endpoint-handler").length, 17);
});

test("Chain별 Security Filter 순서와 4열 줄바꿈이 안정적이며 실제 Graph를 늘리지 않음", async () => {
  const { ui } = loadUi();
  const snapshot = laneGraphFixture();
  const normalized = ui.normalizeGraph(snapshot);
  ui.renderGraph(snapshot);
  await ui.layoutGraph();
  const positions = ui.state.layout.positions;
  ["chain-1", "chain-2", "chain-3"].forEach((chainId) => {
    const filterIds = normalized.edges
      .filter((edge) => edge.type === "FILTERED_BY" && edge.sourceId === chainId)
      .map((edge) => edge.targetId);
    const ordered = filterIds
      .map((id) => positions[id])
      .sort((left, right) => left.y - right.y || left.x - right.x);
    assert.ok(ordered.every((position, index) => index === 0
      || position.y > ordered[index - 1].y
      || position.x > ordered[index - 1].x));
    const rows = new Map();
    ordered.forEach((position) => {
      const row = rows.get(position.y) || [];
      row.push(position);
      rows.set(position.y, row);
    });
    assert.ok(Array.from(rows.values()).every((row) => row.length <= 4));
    assert.ok(Array.from(rows.values()).every((row) => row.every((position, index) =>
      index === 0 || position.x > row[index - 1].x)));
  });
  const lanes = ui.state.layout.plan.lanes;
  lanes.slice(0, -1).forEach((lane, index) => {
    const next = lanes[index + 1];
    assert.ok(lane.x + lane.width <= next.x, `${lane.id} overlaps ${next.id}`);
  });
  assert.equal(ui.state.layout.plan.mode, "request-flow-lanes");
});

test("요청 흐름 투영은 HTTP·Servlet·Chain 선택·MVC 단계를 실제 Graph와 분리함", async () => {
  const { ui, elements } = loadUi();
  const snapshot = laneGraphFixture();
  const originalGraph = JSON.stringify(snapshot);
  ui.renderGraph(snapshot);
  await ui.layoutGraph();

  const projection = ui.state.layout.plan.projection;
  assert.ok(projection);
  assert.equal(
    projection.nodes.filter((node) => node.kind === "education").map((node) => node.id).join("|"),
    [
      "education-http-request",
      "education-request-prepare",
      "education-thread-context",
      "education-servlet-filter-chain",
      "education-delegating-filter-proxy",
      "education-filter-chain-proxy",
      "education-request-matcher",
      "education-servlet-chain-continue",
      "education-handler-mapping",
      "education-handler-adapter",
      "education-response-return"
    ].join("|")
  );
  assert.match(projection.nodes.find((node) => node.id === "education-request-matcher").detail, /체인 1.*체인 2.*체인 3/);
  assert.ok(projection.edges.length > 0);
  assert.equal(projection.edges.some((edge) => edge.dataEdgeId), false);
  assert.equal(elements.get("graph-flow-projection").children.length > 0, true);
  assert.equal(JSON.stringify(snapshot), originalGraph);
  assert.equal(ui.state.graph.nodes.length, 17 + 17 + 3 + 46, "실제 Snapshot Node 수 보존");
  assert.equal(ui.state.graph.edges.some((edge) => edge.type === "FLOWS_TO"), false);
});

test("Security Filter는 동일 Chain의 동일 수평 대역에서 filterOrder 증가 방향으로 배치됨", async () => {
  const { ui } = loadUi();
  ui.renderGraph(laneGraphFixture());
  await ui.layoutGraph();
  const positions = ui.state.layout.positions;
  const graph = ui.state.graph;
  ["chain-1", "chain-2", "chain-3"].forEach((chainId) => {
    const relations = graph.edges
      .filter((edge) => edge.type === "FILTERED_BY" && edge.sourceId === chainId)
      .sort((left, right) => Number(left.attributes.filterOrder) - Number(right.attributes.filterOrder));
    const ordered = relations.map((edge) => positions[edge.targetId]);
    const rows = new Map();
    ordered.forEach((position) => {
      const row = rows.get(position.y) || [];
      row.push(position);
      rows.set(position.y, row);
    });
    assert.ok(Array.from(rows.values()).every((row) => row.length <= 4));
    assert.ok(Array.from(rows.values()).every((row) => row.every((position, index) =>
      index === 0 || position.x > row[index - 1].x)));
  });
  assert.equal(ui.state.layout.plan.routeDiagnostics.nodeOverlaps, 0, JSON.stringify(ui.state.layout.positions));
  assert.equal(ui.state.layout.plan.routeDiagnostics.edgeNodeIntersections, 0);
});

test("Servlet Filter 순서 미확정 상태는 참고 순서와 확인 불가를 구분함", async () => {
  const { ui } = loadUi();
  const graph = laneGraphFixture();
  graph.nodes.push(
    {
      id: "servlet-dispatcher",
      type: "SERVLET",
      serviceId: "orders",
      label: "dispatcherServlet",
      attributes: { servletClass: "org.springframework.web.servlet.DispatcherServlet" },
      evidenceIds: ["evidence-servlet-dispatcher"]
    },
    {
      id: "servlet-character",
      type: "FILTER",
      serviceId: "orders",
      label: "OrderedCharacterEncodingFilter",
      attributes: { registrationKind: "SERVLET", filterClass: "org.springframework.boot.servlet.filter.OrderedCharacterEncodingFilter" },
      evidenceIds: ["evidence-servlet-character"]
    },
    {
      id: "servlet-ws",
      type: "FILTER",
      serviceId: "orders",
      label: "WsFilter",
      attributes: { registrationKind: "SERVLET", filterClass: "org.apache.tomcat.websocket.server.WsFilter" },
      evidenceIds: ["evidence-servlet-ws"]
    }
  );
  graph.edges.push({
    id: "servlet-filtered-character",
    sourceId: "servlet-dispatcher",
    targetId: "servlet-character",
    type: "FILTERED_BY",
    attributes: { registrationKind: "SERVLET" },
    confidence: "CONFIRMED",
    evidenceIds: ["evidence-servlet-filtered-character"]
  }, {
    id: "servlet-filtered-ws",
    sourceId: "servlet-dispatcher",
    targetId: "servlet-ws",
    type: "FILTERED_BY",
    attributes: { registrationKind: "SERVLET" },
    confidence: "CONFIRMED",
    evidenceIds: ["evidence-servlet-filtered-ws"]
  });
  ui.renderGraph(graph);
  await ui.layoutGraph();
  const orderInfo = ui.state.layout.plan.servletFilterOrder;
  assert.equal(orderInfo["servlet-character"].status, "REFERENCE");
  assert.equal(orderInfo["servlet-ws"].status, "UNKNOWN");
  assert.ok(ui.state.layout.positions["servlet-character"].x < ui.state.layout.positions["servlet-ws"].x);
});

test("Servlet·Security Filter는 4열을 넘기지 않고 0·1·3·4·5·8·9·12·13·15개를 순서대로 줄바꿈함", () => {
  const { layoutApi, ui } = loadUi();
  [0, 1, 3, 4, 5, 8, 9, 12, 13, 15].forEach((count) => {
    const layout = layoutApi.semanticLayout(
      ui.normalizeGraph(wrappedFilterGraph(count, count)),
      { positions: {} }
    );
    ["servlet-filter", "security-filter"].forEach((kind) => {
      const prefix = kind === "servlet-filter" ? "servlet-filter-" : "security-filter-";
      const positions = Object.entries(layout.positions)
        .filter(([id]) => id.startsWith(prefix))
        .map(([, position]) => position)
        .sort((left, right) => left.y - right.y || left.x - right.x);
      const rows = new Map();
      positions.forEach((position) => rows.set(position.y, (rows.get(position.y) || 0) + 1));
      assert.ok(Array.from(rows.values()).every((rowSize) => rowSize <= 4), `${kind} ${count}`);
      if (count > 4) {
        assert.ok(positions[4].y > positions[3].y, `${kind} 5번째 Filter가 다음 행에 없음`);
        assert.equal(positions[4].x, positions[0].x, `${kind} 다음 행 첫 열이 아님`);
      }
    });
    assert.equal(layout.plan.routeDiagnostics.nodeOverlaps, 0, `${count}개 Node 겹침`);
  });
});

test("Filter 줄바꿈 표시용 Edge는 다음 행의 첫 Filter로 우회하고 카드 내부를 통과하지 않음", () => {
  const { layoutApi, ui } = loadUi();
  const layout = layoutApi.semanticLayout(ui.normalizeGraph(wrappedFilterGraph(0, 5)), { positions: {} });
  const wrap = layout.plan.projection.edges.find((edge) => edge.routeKind === "filter-wrap");
  assert.ok(wrap);
  assert.equal(wrap.sourceId, "security-filter-3");
  assert.equal(wrap.targetId, "security-filter-4");
  assert.equal(wrap.dataEdgeId, null);
  assert.match(layout.plan.projectionRoutes[wrap.id].d, /V/);
  assert.equal(layout.plan.routeDiagnostics.edgeNodeIntersections, 0);
});

test("주요 섹션은 실제 사용 폭과 공통 중심선 및 안전 여백을 사용함", () => {
  const { layoutApi, ui } = loadUi();
  const layout = layoutApi.semanticLayout(ui.normalizeGraph(laneGraphFixture()), { positions: {} });
  const requestLane = layout.plan.lanes.find((lane) => lane.id === "request");
  const servletLane = layout.plan.lanes.find((lane) => lane.id === "servlet-filter");
  const requestProjectionRight = Math.max(...layout.plan.projection.nodes
    .filter((node) => node.position.x >= requestLane.x && node.position.x < servletLane.x)
    .map((node) => node.position.x + 260));
  assert.equal(requestLane.x + requestLane.width, requestProjectionRight);
  assert.equal(servletLane.x, requestLane.x + requestLane.width + layout.plan.sectionGap);

  const centers = Object.values(layout.plan.sectionAlignment).map((section) => section.centerY);
  assert.ok(centers.every((centerY) => Math.abs(centerY - centers[0]) <= 1), JSON.stringify(layout.plan.sectionAlignment));
  assert.ok(layout.plan.routing.nodeSafeMargin >= 24);
});

test("Filter 행과 상세 보조 Node 사이에 확장된 세로 간격을 유지함", () => {
  const { layoutApi, ui } = loadUi();
  const layout = layoutApi.semanticLayout(ui.normalizeGraph(wrappedFilterGraph(0, 5)), { positions: {} });
  const filters = ["security-filter-0", "security-filter-4"].map((id) => layout.positions[id]);
  assert.ok(filters[1].y - filters[0].y >= 156);
  assert.equal(layout.plan.routeDiagnostics.nodeOverlaps, 0);
  assert.equal(layout.plan.routeDiagnostics.edgeNodeIntersections, 0);
});

test("Security Data 원본 구조 키를 의미 이름으로 축약하고 원문 속성을 Inspector에 보존함", () => {
  const { ui, elements, window } = loadUi();
  const snapshot = detailGraphFixture();
  snapshot.nodes.push({
    id: "security-data-jwt",
    type: "SECURITY_DATA",
    serviceId: "orders",
    label: "jwt|READ|com.example.Controller#get()|sub|0",
    attributes: {
      operation: "READ",
      apiType: "SPRING_SECURITY_JWT",
      apiName: "getSubject",
      claimName: "sub",
      codeLocation: "com.example.Controller#get()"
    },
    evidenceIds: []
  });
  ui.renderGraph(snapshot);
  const node = elements.get("graph-nodes").children.find((item) => item.attributes["data-node-id"] === "security-data-jwt");
  assert.match(textOf(node), /JWT 정보 읽기/);
  assert.match(textOf(node), /Claim sub/);
  assert.doesNotMatch(textOf(node), /jwt\|READ\|/);
  ui.selectGraphElement("node", "security-data-jwt");
  assert.match(textOf(elements.get("inspector")), /작업/);
  assert.match(textOf(elements.get("inspector")), /읽기 \(READ\)/);
  assert.match(textOf(elements.get("inspector")), /코드 위치/);
  assert.equal(window.MapInBootGraph.friendlyClassName("org.springframework.security.web.SecurityContextHolderAwareRequestFilter"), "Security Context Holder Aware Request Filter");
});

test("ELK 실패 시 초기 Graph 배치와 SVG 표시 상태를 유지함", async () => {
  const { ui, elements, layoutApi } = loadUi();
  layoutApi.layout = () => Promise.reject(new Error("worker unavailable"));

  ui.renderGraph(graphFixture());
  assert.equal(elements.get("graph-svg").hasAttribute("hidden"), false);
  const layout = await ui.layoutGraph();

  assert.equal(layout, null);
  assert.equal(ui.state.layoutState, "failed");
  assert.equal(elements.get("graph-svg").hasAttribute("hidden"), false);
  assert.equal(elements.get("graph-nodes").children.length, 10);
  assert.equal(elements.get("graph-edges").children.filter((child) => child.attributes.class === "graph-edge").length, 9);
  assert.match(elements.get("graph-state-message").textContent, /초기 배치를 유지합니다/);
});

test("새 요청 이후 이전 ELK 결과를 stale로 판정함", async () => {
  const { ui, layoutApi } = loadUi();
  const pending = [];
  class DelayedElk {
    layout(graph) {
      return new Promise((resolve) => pending.push({ graph, resolve }));
    }
  }
  const client = layoutApi.createClient(DelayedElk);
  const graph = ui.normalizeGraph(graphFixture());
  const first = client.layout(graph);
  const second = client.layout(graph);
  const output = () => ({
    width: 640,
    height: 360,
    children: graph.nodes.map((node, index) => ({ id: node.id, x: index, y: index })),
    edges: graph.edges.map((edge) => ({ id: edge.id, sections: [] }))
  });
  pending[0].resolve(output());
  pending[1].resolve(output());
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.stale, true);
  assert.equal(secondResult.stale, false);
});

test("후처리 Worker의 결과는 동기 배치와 같고 오류 시 복구됨", async () => {
  const { ui, layoutApi, window } = loadUi();
  const graph = ui.normalizeGraph(detailGraphFixture());
  const elkResult = { width: 640, height: 360,
    children: graph.nodes.map((node, index) => ({ id: node.id, x: index, y: index })),
    edges: graph.edges.map((edge) => ({ id: edge.id, sections: [] })) };
  class Elk { layout() { return Promise.resolve(elkResult); } }
  let workers = 0;
  class Worker {
    constructor() { workers += 1; }
    postMessage(message) {
      Promise.resolve().then(() => this.onmessage({ data: { requestId: message.requestId,
        layout: layoutApi.semanticLayout(message.graph, message.elkLayout) } }));
    }
    terminate() {}
  }
  window.Worker = Worker;
  const client = layoutApi.createClient(Elk);
  const result = await client.layout(graph);
  const expected = layoutApi.semanticLayout(graph, layoutApi.extractLayout(elkResult));
  assert.equal(workers, 1);
  assert.equal(JSON.stringify({ ...result, requestId: undefined, stale: undefined }), JSON.stringify(expected));
  client.terminate();
  window.Worker = class extends Worker {
    postMessage() { Promise.resolve().then(() => this.onerror({ preventDefault() {} })); }
  };
  const fallback = layoutApi.createClient(Elk);
  const recovered = await fallback.layout(graph);
  assert.equal(JSON.stringify({ ...recovered, requestId: undefined, stale: undefined }), JSON.stringify(expected));
  fallback.terminate();
});

test("새 배치 요청은 진행 중인 후처리를 중단하고 오래된 결과를 무시함", async () => {
  const { ui, layoutApi, window } = loadUi();
  const graph = ui.normalizeGraph(detailGraphFixture());
  const workers = [];
  class Elk {
    layout() { return Promise.resolve({ children: graph.nodes.map((node) => ({ id: node.id, x: 0, y: 0 })),
      edges: graph.edges.map((edge) => ({ id: edge.id, sections: [] })) }); }
  }
  window.Worker = class {
    constructor() { workers.push(this); }
    postMessage(message) { this.message = message; }
    terminate() { this.terminated = true; }
  };
  const client = layoutApi.createClient(Elk);
  const first = client.layout(graph);
  await Promise.resolve();
  const second = client.layout(graph);
  await Promise.resolve();
  assert.equal(workers[0].terminated, true);
  workers[0].onmessage({ data: { requestId: workers[0].message.requestId, layout: { obsolete: true } } });
  const current = workers[1];
  workers[0].onerror({ preventDefault() {} });
  assert.notEqual(current.terminated, true);
  current.onmessage({ data: { requestId: current.message.requestId,
    layout: layoutApi.semanticLayout(current.message.graph, current.message.elkLayout) } });
  assert.equal((await first).stale, true);
  assert.equal((await second).stale, false);
  client.terminate();
  assert.equal(current.terminated, true);
});

test("페이지 종료 시 대기 중인 후처리를 정리하고 오래된 결과를 적용하지 않음", async () => {
  const { ui, window } = loadUi();
  let worker;
  window.Worker = class {
    constructor() { worker = this; }
    postMessage() {}
    terminate() { this.terminated = true; }
  };
  ui.renderGraph(detailGraphFixture());
  const pending = ui.layoutGraph();
  await Promise.resolve();
  window.dispatchEvent({ type: "pagehide", persisted: false });
  const result = await pending;
  assert.equal(worker.terminated, true);
  assert.equal(result.stale, true);
  assert.equal(ui.state.layout, null);
});

test("Endpoint 검색과 NodeType·EdgeType 필터는 원본 Graph를 변경하지 않음", async () => {
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  ui.renderGraph(snapshot);
  await ui.layoutGraph();
  const sourceNodeIds = ui.state.graph.nodes.map((node) => node.id);
  const sourceEdgeIds = ui.state.graph.edges.map((edge) => edge.id);

  elements.get("endpoint-search").value = " get /orders ";
  elements.get("node-filter").value = "";
  elements.get("edge-filter").value = "";
  let filtered = ui.applyGraphFilter();
  assert.deepEqual(Array.from(filtered.nodes, (node) => node.id), ["node-2"]);
  assert.equal(filtered.edges.length, 0);
  ui.focusEndpoint("node-2");
  assert.notEqual(ui.navigation.state.panX, 0);
  assert.equal(elements.get("graph-filter-status").textContent, "필터 적용");
  assert.doesNotMatch(elements.get("graph-filter-status").textContent, /\d+개/);

  elements.get("endpoint-search").value = "";
  elements.get("node-filter").value = "";
  elements.get("edge-filter").value = "SECURED_BY";
  filtered = ui.applyGraphFilter();
  assert.equal(filtered.nodes.length, 10);
  assert.deepEqual(Array.from(filtered.edges, (edge) => edge.id), ["edge-3"]);

  elements.get("edge-filter").value = "";
  ui.applyGraphFilter();
  assert.deepEqual(ui.state.graph.nodes.map((node) => node.id), sourceNodeIds);
  assert.deepEqual(ui.state.graph.edges.map((edge) => edge.id), sourceEdgeIds);
  assert.equal(elements.get("graph-minimap").hidden, false);
});

test("Fit·Zoom·Pan·Reset과 Mini Map Viewport가 같은 좌표를 사용함", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(graphFixture());
  await ui.layoutGraph();
  const navigation = ui.navigation;

  navigation.fit();
  assert.equal(navigation.state.zoom !== 1, true);
  assert.equal(elements.get("graph-minimap").hidden, false);
  assert.equal(elements.get("graph-minimap-nodes").children.length,
    ui.state.graphRender.displayNodes.length + ui.state.layout.plan.projection.nodes.length);
  const fittedViewportX = Number(elements.get("graph-minimap-viewport").attributes.x);
  navigation.zoomAt(2, 480, 270);
  navigation.panBy(24, -12);
  assert.equal(navigation.state.zoom, 2);
  assert.notEqual(Number(elements.get("graph-minimap-viewport").attributes.x), fittedViewportX);

  navigation.reset();
  assert.equal(navigation.state.zoom, 1);
  assert.equal(navigation.state.panX, 0);
  assert.equal(navigation.state.panY, 0);
  assert.equal(elements.get("graph-svg").attributes.viewBox, "0 0 960 540");
});

test("넓은 Graph의 화면 맞춤은 전체 표시 영역을 Canvas에 포함함", () => {
  const { ui } = loadUi();
  const positions = { first: { x: 0, y: 0 }, last: { x: 20000, y: 0 } };
  ui.navigation.setGraph({ nodes: [{ id: "first" }, { id: "last" }] }, positions, null);
  ui.navigation.fit();
  assert.ok(ui.navigation.state.visibleBounds.width * ui.navigation.state.zoom <= ui.navigation.state.canvasWidth - 64);
  assert.ok(ui.navigation.state.zoom < 0.2);
});

test("연속 휠 이벤트는 최종 Zoom 상태를 한 프레임에 한 번만 반영함", () => {
  const { ui, elements, window } = loadUi();
  const callbacks = [];
  window.requestAnimationFrame = (callback) => { callbacks.push(callback); return callbacks.length; };
  const viewport = elements.get("graph-viewport");
  const before = viewport.attributes.transform;
  elements.get("graph-svg").dispatchEvent({ type: "wheel", deltaY: -1, clientX: 100, clientY: 100 });
  elements.get("graph-svg").dispatchEvent({ type: "wheel", deltaY: -1, clientX: 100, clientY: 100 });
  assert.equal(callbacks.length, 1);
  assert.equal(viewport.attributes.transform, before);
  callbacks[0]();
  assert.notEqual(viewport.attributes.transform, before);
  assert.ok(ui.navigation.state.zoom > 1);
});

test("동일 Graph의 Inspector 선택은 Mini Map Node를 다시 만들지 않음", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(detailGraphFixture());
  await ui.layoutGraph();
  const first = elements.get("graph-minimap-nodes").children[0];
  ui.selectGraphElement("node", "endpoint-a");
  assert.equal(elements.get("graph-minimap-nodes").children[0], first);
});

test("Hover 요약과 Node·Edge Inspector가 실제 ID·연결·Evidence를 사용함", async () => {
  const { ui, elements, document } = loadUi();
  ui.renderGraph(graphFixture());
  await ui.layoutGraph();

  const node = elements.get("graph-nodes").children[2];
  let edge = findAllByClass(elements.get("graph-edges"), "graph-edge")[3];
  node.dispatchEvent({ type: "mouseenter" });
  assert.equal(elements.get("graph-popover").hidden, false);
  assert.match(textOf(elements.get("graph-popover")), /GET \/orders/);
  assert.match(textOf(elements.get("graph-popover")), /관련 Finding 있음/);
  node.dispatchEvent({ type: "mouseleave" });
  assert.equal(elements.get("graph-popover").hidden, true);

  node.dispatchEvent({ type: "click" });
  const inspector = elements.get("inspector");
  assert.equal(ui.state.selection.kind, "node");
  assert.equal(ui.state.selection.id, "node-2");
  assert.equal(inspector.hidden, false);
  assert.equal(inspector.attributes["data-selection-kind"], "node");
  assert.equal(inspector.attributes["data-selection-id"], "node-2");
  const selectedNode = elements.get("graph-nodes").children[2];
  assert.equal(selectedNode.attributes["data-selected"], "true");
  assert.equal(selectedNode.attributes["data-related"], "true");
  assert.match(textOf(inspector), /GET \/orders/);
  assert.match(textOf(inspector), /orders:\/\/node\/2/);
  assert.match(textOf(inspector), /관련 Finding 있음/);

  elements.get("endpoint-search").value = "get /orders";
  ui.applyGraphFilter();
  assert.equal(ui.state.selection.id, "node-2");
  assert.equal(elements.get("graph-nodes").children[0].attributes["data-node-id"], "node-2");
  assert.equal(elements.get("graph-nodes").children[0].attributes["data-selected"], "true");
  elements.get("endpoint-search").value = "";
  ui.applyGraphFilter();
  edge = findAllByClass(elements.get("graph-edges"), "graph-edge")[3];

  ui.setInspectorTab("connections");
  assert.match(textOf(inspector), /edge-1|edge-2|edge-3/);
  ui.setInspectorTab("relations");
  assert.match(textOf(inspector), /보호 근거/);
  const relationBlocks = findAllByClass(inspector, "inspector-relation");
  const findingReference = relationBlocks.at(-1);
  assert.match(textOf(findingReference), /node-3/);
  assert.match(textOf(findingReference), /node-4/);
  assert.doesNotMatch(textOf(findingReference), /들어옴|나감/);

  edge.dispatchEvent({ type: "click" });
  assert.equal(inspector.attributes["data-selection-kind"], "edge");
  assert.equal(inspector.attributes["data-selection-id"], "edge-3");
  ui.setInspectorTab("properties");
  assert.match(textOf(inspector), /node-3/);
  assert.match(textOf(inspector), /node-4/);

  const close = findAllByClass(inspector, "inspector-close")[0];
  close.dispatchEvent({ type: "click" });
  assert.equal(inspector.hidden, true);
  assert.equal(ui.state.selection, null);

  edge = findAllByClass(elements.get("graph-edges"), "graph-edge")[3];
  edge.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selection.kind, "edge");
  assert.equal(ui.state.selection.id, "edge-3");
  document.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(inspector.hidden, true);
  assert.equal(ui.state.selection, null);
});

test("[T18] Status·Snapshot의 401·403·404·5xx 오류를 분리한 상태 문구로 표시함", async () => {
  const statusCases = [
    { status: 401, state: "denied", message: "인증 필요" },
    { status: 403, state: "denied", message: "관리자 권한 필요" },
    { status: 404, state: "status-unavailable", message: "상태 조회 불가" },
    { status: 500, state: "server-error", message: "서버 오류" }
  ];
  for (const expected of statusCases) {
    const instance = loadUi({ fetchImpl: () => Promise.resolve({ ok: false, status: expected.status }) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(instance.ui.state.snapshotState, expected.state);
    assert.equal(instance.elements.get("graph-state-message").textContent, expected.message);
  }

  const snapshotCases = [
    { status: 401, message: "Snapshot 인증 필요" },
    { status: 403, message: "Snapshot 관리자 권한 필요" },
    { status: 404, message: "보존 Snapshot 없음" },
    { status: 500, message: "서버 오류" }
  ];
  for (const expected of snapshotCases) {
    const responses = [
      { ok: true, json: async () => ({ phase: "COMPLETED", persistedSnapshotPresent: true }) },
      { ok: false, status: expected.status }
    ];
    const instance = loadUi({ fetchImpl: () => Promise.resolve(responses.shift()) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(instance.elements.get("graph-state-message").textContent, expected.message);
  }
});

test("Snapshot 오류를 인증·권한·보존 없음·서버·연결 상태로 구분함", async () => {
  const responses = [
    { ok: true, json: async () => ({ phase: "COMPLETED", persistedSnapshotPresent: true }) },
    { ok: false, status: 500 }
  ];
  const serverError = loadUi({ fetchImpl: () => Promise.resolve(responses.shift()) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(serverError.ui.state.snapshotState, "server-error");
  assert.equal(serverError.elements.get("graph-state-message").textContent, "서버 오류");

  const networkError = loadUi({ fetchImpl: () => Promise.reject(new Error("offline")) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(networkError.ui.state.snapshotState, "connection-error");
  assert.equal(networkError.elements.get("graph-state-message").textContent, "연결 오류");
});

test("상세 MAP에서 새로고침 후 선택 Endpoint Graph를 다시 표시함", async () => {
  const snapshot = detailGraphFixture();
  const responses = [
    { ok: true, json: async () => ({ phase: "COMPLETED", persistedSnapshotPresent: true }) },
    { ok: true, json: async () => snapshot },
    { ok: true, json: async () => ({ phase: "COMPLETED", persistedSnapshotPresent: true }) },
    { ok: true, json: async () => snapshot }
  ];
  const instance = loadUi({ fetchImpl: () => Promise.resolve(responses.shift()) });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  instance.ui.openEndpointDetail("endpoint-a");
  await instance.ui.layoutGraph();
  assert.equal(instance.ui.state.selectedEndpointId, "endpoint-a");
  assert.ok(instance.ui.state.visibleGraph.nodes.length > 0);

  await instance.ui.loadStatus();
  assert.equal(instance.ui.state.view, "feature-flow");
  assert.equal(instance.ui.state.selectedEndpointId, "endpoint-a");
  assert.equal(instance.elements.get("endpoint-search").value, "GET /orders");
  assert.equal(instance.elements.get("graph-svg").hasAttribute("hidden"), false);
  assert.ok(instance.ui.state.visibleGraph.nodes.length > 0);
  assert.ok(instance.elements.get("graph-nodes").children.length > 0);
  assert.ok(instance.elements.get("graph-edges").children.length > 0);
});

test("Header·Window Resize와 Edge 포인터가 Navigation 상태와 충돌하지 않음", async () => {
  const { ui, elements, window } = loadUi();
  ui.renderGraph(graphFixture());
  await ui.layoutGraph();
  const navigation = ui.navigation;
  elements.get("graph-svg").clientWidth = 700;
  elements.get("graph-svg").clientHeight = 400;
  navigation.apply();
  assert.equal(navigation.state.canvasWidth, 700);
  assert.equal(navigation.state.canvasHeight, 400);

  elements.get("graph-svg").clientWidth = 720;
  elements.get("graph-svg").clientHeight = 410;
  window.dispatchEvent({ type: "resize" });
  assert.equal(elements.get("graph-svg").attributes.viewBox, "0 0 720 410");

  const edge = findAllByClass(elements.get("graph-edges"), "graph-edge")[0];
  edge.dispatchEvent({ type: "pointerdown", clientX: 10, clientY: 10, pointerId: 1 });
  assert.equal(navigation.state.dragging, false);
});

test("내부 처리 단계는 중앙 대역에서 실제 Node와 겹치지 않고 Bounds에 포함됨", async () => {
  const { ui } = loadUi();
  ui.renderGraph(laneGraphFixture());
  const layout = await ui.layoutGraph();
  const projection = layout.plan.projection;
  const projectionTop = Math.min(...projection.nodes.map((node) => node.position.y));

  const actualPositions = Object.values(layout.positions);
  assert.ok(actualPositions.some((position) => position.y < projectionTop));
  assert.ok(actualPositions.some((position) => position.y > projectionTop));
  projection.nodes.forEach((node) => actualPositions.forEach((position) => {
    assert.ok(node.position.x + 260 <= position.x || position.x + 260 <= node.position.x
      || node.position.y + 96 <= position.y || position.y + 96 <= node.position.y);
  }));
  assert.ok(layout.height >= projectionTop + 96);
  assert.equal(new Set(projection.nodes.map((node) => node.position.y)).size, 1);
  assert.ok(projection.edges.length > 0);
  assert.equal(layout.plan.educationArea.top, projectionTop - layout.plan.educationArea.topPadding);
});

test("Endpoint 16개 이상은 정렬 목록을 두 열로 분할하고 둘째 열을 엇갈리게 배치함", () => {
  const { layoutApi, ui } = loadUi();
  [0, 1, 15, 16, 17, 31, 32].forEach((count) => {
    const graph = endpointCountGraph(count);
    const layout = layoutApi.semanticLayout(ui.normalizeGraph(graph), { positions: {} });
    const endpoints = graph.nodes.filter((node) => node.type === "ENDPOINT");
    const positions = endpoints.map((node) => layout.positions[node.id]);
    const xs = [...new Set(positions.map((position) => position.x))].sort((left, right) => left - right);
    assert.equal(xs.length, count >= 16 ? 2 : count === 0 ? 0 : 1, `${count}개 열 수`);
    if (count < 16 || count === 0) return;

    const firstColumnCount = Math.ceil(count / 2);
    const firstColumn = positions.filter((position) => position.x === xs[0]).sort((left, right) => left.y - right.y);
    const secondColumn = positions.filter((position) => position.x === xs[1]).sort((left, right) => left.y - right.y);
    assert.equal(firstColumn.length, firstColumnCount);
    assert.equal(secondColumn.length, count - firstColumnCount);
    assert.equal(secondColumn[0].y - firstColumn[0].y, 78);
    assert.ok(layout.plan.lanes.find((lane) => lane.id === "handler").x > xs[1] + 260);
  });
});

test("전체 MAP은 동일 FQCN Controller Handler를 표시 그룹으로 묶고 원본 Handler는 보존함", async () => {
  const { ui, window, elements } = loadUi();
  const graph = detailGraphFixture();
  const originalHandlerIds = graph.nodes.filter((node) => node.type === "HANDLER").map((node) => node.id);
  graph.nodes.push(
    {
      id: "handler-report-a", type: "HANDLER", serviceId: "orders",
      label: "com.example.ReportController#list(java.lang.String)",
      attributes: { handler: "com.example.ReportController#list(java.lang.String)" }, evidenceIds: ["evidence-handler-report-a"]
    },
    {
      id: "handler-report-b", type: "HANDLER", serviceId: "orders",
      label: "com.example.ReportController#detail(java.lang.String)",
      attributes: { handler: "com.example.ReportController#detail(java.lang.String)" }, evidenceIds: ["evidence-handler-report-b"]
    },
    {
      id: "handler-other-report", type: "HANDLER", serviceId: "orders",
      label: "com.other.ReportController#list(java.lang.String)",
      attributes: { handler: "com.other.ReportController#list(java.lang.String)" }, evidenceIds: ["evidence-handler-other-report"]
    },
    {
      id: "endpoint-report-a", type: "ENDPOINT", serviceId: "orders", label: "GET /reports",
      attributes: { httpMethod: "GET", path: "/reports", handler: "com.example.ReportController#list(java.lang.String)" }, evidenceIds: ["evidence-endpoint-report-a"]
    },
    {
      id: "endpoint-report-b", type: "ENDPOINT", serviceId: "orders", label: "GET /reports/{id}",
      attributes: { httpMethod: "GET", path: "/reports/{id}", handler: "com.example.ReportController#detail(java.lang.String)" }, evidenceIds: ["evidence-endpoint-report-b"]
    },
    {
      id: "endpoint-other-report", type: "ENDPOINT", serviceId: "orders", label: "GET /other-reports",
      attributes: { httpMethod: "GET", path: "/other-reports", handler: "com.other.ReportController#list(java.lang.String)" }, evidenceIds: ["evidence-endpoint-other-report"]
    }
  );
  graph.edges.push(
    { id: "match-report-a", sourceId: "endpoint-report-a", targetId: "chain-a", type: "MATCHED_BY", attributes: { chainOrder: "1" }, confidence: "CONFIRMED", evidenceIds: ["evidence-match-report-a"] },
    { id: "match-report-b", sourceId: "endpoint-report-b", targetId: "chain-a", type: "MATCHED_BY", attributes: { chainOrder: "1" }, confidence: "CONFIRMED", evidenceIds: ["evidence-match-report-b"] },
    { id: "match-other-report", sourceId: "endpoint-other-report", targetId: "chain-a", type: "MATCHED_BY", attributes: { chainOrder: "1" }, confidence: "CONFIRMED", evidenceIds: ["evidence-match-other-report"] }
  );
  const before = JSON.stringify(graph);
  ui.renderGraph(graph);
  await ui.layoutGraph();
  const groups = ui.state.layout.plan.controllerGroups;
  const reportGroups = groups.filter((group) => group.controllerFqcn === "com.example.ReportController");
  assert.equal(reportGroups.length, 1);
  assert.equal(Array.from(reportGroups[0].handlerIds).join("|"), "handler-report-a|handler-report-b");
  assert.deepEqual(new Set(reportGroups[0].endpointIds), new Set(["endpoint-report-a", "endpoint-report-b"]));
  assert.equal(groups.filter((group) => group.controllerName === "ReportController").length, 2);
  assert.equal(graph.nodes.filter((node) => node.type === "HANDLER").map((node) => node.id).join("|"), [
    ...originalHandlerIds, "handler-report-a", "handler-report-b", "handler-other-report"
  ].join("|"));
  assert.equal(JSON.stringify(graph), before);
  assert.equal(findAllByClass(elements.get("graph-nodes"), "graph-controller-group").length, groups.length);
  const reportGroupElement = findAllByClass(elements.get("graph-nodes"), "graph-controller-group")
    .find((element) => element.attributes["data-controller-fqcn"] === "com.example.ReportController");
  reportGroupElement.dispatchEvent({ type: "keydown", key: "Enter" });
  assert.equal(ui.state.selection.kind, "controller-group");
  assert.equal(ui.state.selection.id, reportGroups[0].id);
  assert.equal(elements.get("inspector").attributes["data-selection-kind"], "controller-group");
  assert.match(textOf(elements.get("inspector")), /com\.example\.ReportController/);
  assert.equal(typeof window.MapInBootFlow.deriveEndpointGraph, "function");
});

test("표시 그룹은 실제 관계로 소속을 확인하고 원본 Fact와 Edge를 역추적함", () => {
  const { layoutApi, ui } = loadUi();
  const graph = detailGraphFixture();
  const node = (id, type, attributes) => ({ id, type, serviceId: "orders", label: id, attributes, evidenceIds: [`e-${id}`] });
  const edge = (id, sourceId, targetId, type, confidence = "CONFIRMED") => ({
    id, sourceId, targetId, type, confidence, attributes: {}, evidenceIds: [`e-${id}`]
  });
  graph.nodes.push(
    node("auth-other", "AUTHORIZATION", { policySource: "URL", policyKind: "PERMIT_ALL" }),
    node("data-other", "SECURITY_DATA", { operation: "READ", codeLocation: "other:2" }),
    node("data-unknown", "SECURITY_DATA", { operation: "READ", codeLocation: "unknown:3" }),
    node("data-uncertain", "SECURITY_DATA", { operation: "READ", codeLocation: "unknown:4" })
  );
  graph.edges.push(
    edge("auth-other-edge", "handler-a", "auth-other", "SECURED_BY"),
    edge("data-other-edge", "auth-other", "data-other", "READS_SECURITY_DATA"),
    edge("uncertain-edge", "handler-a", "data-uncertain", "READS_SECURITY_DATA", "UNKNOWN")
  );
  const normalized = ui.normalizeGraph(graph);
  const before = JSON.stringify(normalized);
  const plan = layoutApi.semanticLayout(normalized, { positions: {} }).plan;
  const display = plan.displayModel;
  const authGroup = display.groups.find((group) => group.nodeIds.includes("authorization-a"));
  const dataGroup = display.groups.find((group) => group.nodeIds.includes("security-data-a"));
  assert.ok(authGroup);
  assert.ok(dataGroup);
  assert.equal(display.nodeToDisplay["data-unknown"], "data-unknown");
  assert.equal(display.nodeToDisplay["data-uncertain"], "data-uncertain");
  assert.ok(display.groups.some((group) => group.nodeIds.includes("auth-other")));
  assert.ok(display.groups.some((group) => group.nodeIds.includes("data-other")));
  normalized.nodes.forEach((item) => assert.ok(display.displayToNodes[display.nodeToDisplay[item.id]].includes(item.id)));
  normalized.edges.forEach((item) => assert.ok(display.displayToEdges[display.edgeToDisplay[item.id]].includes(item.id)));
  assert.equal(JSON.stringify(normalized), before);
});

test("인가 및 보안정보 표시 그룹은 원본 Fact를 Inspector에서 선택할 수 있음", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(detailGraphFixture());
  await ui.layoutGraph();
  const support = findAllByClass(elements.get("graph-nodes"), "graph-support-group");
  assert.ok(support.length >= 2);
  support[0].dispatchEvent({ type: "click", stopPropagation() {} });
  assert.equal(ui.state.selection.kind, "controller-group");
  assert.match(textOf(elements.get("inspector")), /포함된 원본 Fact/);
  const links = findAllByClass(elements.get("inspector"), "inspector-link");
  assert.ok(links.length > 0);
  links[0].dispatchEvent({ type: "click" });
  assert.equal(ui.state.selection.kind, "node");
});

test("API 안내선은 표시 Controller 카드의 실제 입력 포트에 도착함", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(detailGraphFixture());
  await ui.layoutGraph();
  const group = ui.state.layout.plan.controllerGroups.find((item) => item.handlerIds.includes("handler-a"));
  const guide = elements.get("graph-guides").children.find((item) => item.attributes["data-endpoint-id"] === "endpoint-a");
  assert.ok(guide);
  const path = guide.attributes.d;
  assert.match(path, new RegExp(`L ${group.position.x} ${group.position.y + 48}$`));
});

test("묶인 표시 관계에서 개별 Edge와 Evidence를 선택할 수 있음", async () => {
  const { ui, elements } = loadUi();
  const graph = detailGraphFixture();
  graph.nodes.push({ id: "authorization-a2", type: "AUTHORIZATION", serviceId: "orders", label: "other policy",
    attributes: { authorizationKind: "OTHER" }, evidenceIds: ["e-auth2"] });
  graph.edges.push({ id: "secured-a2", sourceId: "handler-a", targetId: "authorization-a2", type: "SECURED_BY",
    attributes: { policyKind: "OTHER" }, confidence: "CONFIRMED", evidenceIds: ["e-edge2"] });
  ui.renderGraph(graph);
  await ui.layoutGraph();
  const paths = findAllByClass(elements.get("graph-edges"), "graph-edge");
  const bundle = paths.find((path) => (path.attributes["data-edge-ids"] || "").includes("secured-a2"));
  assert.ok(bundle);
  assert.match(bundle.attributes["data-edge-ids"], /secured-a/);
  assert.equal(paths.filter((path) => (path.attributes["data-edge-ids"] || "").includes("secured-a2")).length, 1);
  bundle.dispatchEvent({ type: "click", stopPropagation() {} });
  assert.match(textOf(elements.get("inspector")), /함께 표시한 원본 관계/);
  const link = findAllByClass(elements.get("inspector"), "inspector-link")
    .find((button) => button.attributes["data-edge-id"] === "secured-a2");
  assert.ok(link);
  link.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selection.id, "secured-a2");
  assert.match(textOf(elements.get("inspector")), /e-edge2/);
});

test("표시 그룹 관계 경로는 최종 카드 포트에서 시작하고 끝남", () => {
  const { ui, layoutApi } = loadUi();
  const graph = ui.normalizeGraph(detailGraphFixture());
  const layout = layoutApi.semanticLayout(graph, { positions: {} });
  const groups = layout.plan.controllerGroups.concat(layout.plan.displayModel.groups);
  const position = (id) => {
    const displayId = layout.plan.displayModel.nodeToDisplay[id];
    const group = groups.find((item) => item.id === displayId);
    return group ? group.position : layout.positions[id];
  };
  Object.entries(layout.plan.displayEdgeRoutes).forEach(([id, route]) => {
    const edge = graph.edges.find((item) => item.id === id);
    const source = position(edge.sourceId);
    const target = position(edge.targetId);
    const section = route.sections[0];
    assert.ok([source.x, source.x + 260].includes(section.startPoint.x), id);
    assert.equal(section.startPoint.y, source.y + 48, id);
    assert.ok([target.x, target.x + 260].includes(section.endPoint.x), id);
    assert.equal(section.endPoint.y, target.y + 48, id);
  });
});

test("동일한 Snapshot의 표시 경로와 중앙 배치는 안정적으로 유지됨", () => {
  const { ui, layoutApi } = loadUi();
  const layout = layoutApi.semanticLayout(ui.normalizeGraph(detailGraphFixture()), { positions: {} });
  assert.equal(layout.plan.guideRoutes["endpoint-a"], "M 5704 408 L 5752 408 L 5752 758 L 5800 758");
});

test("소속을 확인할 수 없는 보안정보도 메인 영역 가까이 개별 표시함", () => {
  const { ui, layoutApi } = loadUi();
  const graph = detailGraphFixture();
  graph.nodes.push({ id: "unowned", type: "SECURITY_DATA", serviceId: "orders", label: "unknown",
    attributes: { codeLocation: "unknown", operation: "READ" }, evidenceIds: [] });
  const layout = layoutApi.semanticLayout(ui.normalizeGraph(graph), { positions: {} });
  assert.equal(layout.plan.displayModel.nodeToDisplay.unowned, "unowned");
  assert.ok(Math.abs(layout.positions.unowned.y + 48 - layout.plan.sectionAlignment.handler.centerY) < 300);
});

test("API 선택은 실제 상세 Graph의 Handler와 보안 근거를 함께 강조함", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(detailGraphFixture());
  await ui.layoutGraph();
  ui.selectGraphElement("node", "endpoint-a");
  const support = findAllByClass(elements.get("graph-nodes"), "graph-support-group");
  assert.ok(support.some((node) => (node.attributes["data-handler-ids"] || "").includes("security-data-a")
    && node.attributes["data-related"] === "true"));
});

test("같은 Controller의 두 번째 API 선택도 공유 처리 경로를 강조함", async () => {
  const { ui, elements } = loadUi();
  const graph = detailGraphFixture();
  graph.nodes.push(
    { id: "handler-a2", type: "HANDLER", serviceId: "orders", label: "OrderController#other", attributes: { handler: "OrderController#other" }, evidenceIds: [] },
    { id: "endpoint-a2", type: "ENDPOINT", serviceId: "orders", label: "GET /other", attributes: { httpMethod: "GET", path: "/other", handler: "OrderController#other" }, evidenceIds: [] }
  );
  ui.renderGraph(graph);
  await ui.layoutGraph();
  ui.selectGraphElement("node", "endpoint-a2");
  const paths = findAllByClass(elements.get("graph-flow-projection"), "graph-projection-edge");
  const adapter = paths.find((path) => (path.attributes["data-projection-edge-id"] || "") === "adapter-to-handler-a");
  const shared = paths.find((path) => path.attributes["data-projection-edge-id"] === "mapping-to-adapter-shared");
  const response = paths.find((path) => path.attributes["data-projection-edge-id"] === "handler-to-response-handler-a");
  assert.equal(adapter.attributes["data-related"], "true");
  assert.equal(shared.attributes["data-related"], "true");
  assert.equal(response.attributes["data-related"], "true");
});

test("기능별 상세에서는 같은 방향과 유형의 원본 Edge도 개별 표시함", async () => {
  const { ui, elements } = loadUi();
  const graph = detailGraphFixture();
  graph.edges.push({ ...graph.edges.find((edge) => edge.id === "secured-a"), id: "secured-a-second", evidenceIds: ["other-evidence"] });
  ui.renderGraph(graph);
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();
  const edges = findAllByClass(elements.get("graph-edges"), "graph-edge");
  assert.ok(edges.some((edge) => edge.attributes["data-edge-id"] === "secured-a"));
  assert.ok(edges.some((edge) => edge.attributes["data-edge-id"] === "secured-a-second"));
});

test("Chain 그룹과 기술 영역은 실제 Node 범위와 동적 여백으로 분리됨", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(laneGraphFixture());
  const layout = await ui.layoutGraph();
  const groups = layout.plan.chainGroups;
  for (let index = 1; index < groups.length; index += 1) {
    assert.ok(groups[index].top - groups[index - 1].bottom >= layout.plan.chainGap - 36);
  }
  const areaRects = elements.get("graph-areas").children
    .map((group) => group.children.find((child) => child.attributes.class === "graph-area-box"))
    .filter(Boolean);
  assert.ok(areaRects.some((rect) => Number(rect.attributes.height) < layout.height));
  groups.forEach((group) => group.nodeIds.forEach((id) => {
    const position = layout.positions[id];
    assert.ok(position.y >= group.top && position.y + 96 <= group.bottom);
  }));
});

test("Mini Map은 실제 표시 Node와 교육용 Projection Node를 함께 갱신함", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(laneGraphFixture());
  await ui.layoutGraph();
  const minimap = elements.get("graph-minimap-nodes").children;
  assert.equal(minimap.filter((node) => node.attributes["data-node-kind"] === "education").length,
    ui.state.layout.plan.projection.nodes.length);
  assert.equal(minimap.filter((node) => node.attributes["data-node-kind"] !== "education").length,
    ui.state.graphRender.displayNodes.length);
  ui.selectView("feature-flow");
  await ui.layoutGraph();
  assert.equal(elements.get("graph-minimap-nodes").children.some((node) =>
    node.attributes["data-node-kind"] === "education"), true);
});
