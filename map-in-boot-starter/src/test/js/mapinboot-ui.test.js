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
    setAttribute(name, value) { attributes[name] = value; },
    removeAttribute(name) { delete attributes[name]; },
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
    "graph-empty", "graph-state-message", "graph-svg", "graph-viewport", "graph-areas",
    "graph-edges", "graph-nodes", "service-name", "snapshot-time", "endpoint-search",
    "node-filter", "edge-filter", "search-reset", "filter-toggle", "map-filter-panel", "zoom-in", "zoom-out", "fit-graph",
    "reset-view", "graph-filter-status", "flow-summary", "graph-minimap", "graph-minimap-svg",
    "graph-minimap-nodes", "graph-minimap-viewport", "inspector", "graph-popover"
  ];
  const elements = new Map(ids.map((id) => [id, createElement()]));
  elements.get("help-panel").hidden = true;
  elements.get("settings-panel").hidden = true;
  elements.get("map-filter-panel").hidden = true;
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
  ["graph-flow.js", "graph-renderer.js", "graph-inspector.js", "layout-client.js", "graph-navigation.js", "app.js"].forEach((file) => {
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
  assert.equal(elements.get("graph-areas").hidden, true);
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

test("전체 MAP이 Flow 인덱스 요약을 표시하고 구조 Edge를 합성하지 않음", () => {
  const { ui, elements } = loadUi();
  const graph = flowGraphFixture();
  const originalEdgeIds = graph.edges.map((edge) => edge.id);
  ui.renderGraph(graph);

  assert.equal(ui.state.graph.edges.map((edge) => edge.id).join(","), originalEdgeIds.join(","));
  assert.match(elements.get("flow-summary").textContent, /Endpoint 2개/);
  assert.match(elements.get("flow-summary").textContent, /첫 적용 Chain 확인 2개/);
  assert.match(elements.get("flow-summary").textContent, /Security Filter 2개/);
  assert.match(elements.get("flow-summary").textContent, /Servlet Filter 1개/);
  assert.match(elements.get("flow-summary").textContent, /Handler 대응 2개/);
  assert.match(elements.get("flow-summary").textContent, /확인 불가 0개/);
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

test("ELK 입력·결과를 Stable ID로 재결합하고 다섯 기술 영역을 배경으로 표시함", async () => {
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
  assert.equal(elements.get("graph-svg").attributes["data-layout-mode"], "elk", JSON.stringify({
    state: ui.state.layoutState,
    error: ui.state.layoutError,
    layout: layout && layout.positions,
    rendered: ui.state.graphRender && ui.state.graphRender.positions,
    attributes: elements.get("graph-svg").attributes
  }));
  const renderedNode = elements.get("graph-nodes").children[2];
  const renderedEdge = findAllByClass(elements.get("graph-edges"), "graph-edge")[0];
  assert.equal(renderedNode.attributes.transform, "translate(376 132)");
  assert.equal(renderedEdge.attributes.d, "M 100 80 L 180 140 L 260 200");
  assert.equal(ui.navigation.state.graphBounds.width, layout.width);
  assert.equal(ui.navigation.state.graphBounds.height, layout.height);
  assert.equal(elements.get("graph-areas").children.length, 5);
  assert.equal(layout.positions["node-2"].x, 376);
  const areaNodes = new Map(ui.state.graphRender.areas.map((area) => [area.id, area.nodeIds]));
  assert.deepEqual(Array.from(areaNodes.get("servlet-entry")), ["node-0", "node-1"]);
  assert.deepEqual(Array.from(areaNodes.get("servlet-handler")), ["node-2", "node-3"]);
  assert.equal(layout.edgeRoutes["edge-0"].sections.length, 1);
  assert.equal(layoutCalls[0].layoutOptions["org.eclipse.elk.direction"], "RIGHT");
  assert.equal(layoutCalls[0].edges.some((edge) => edge.id === "edge-0"), true);
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
  assert.equal(elements.get("graph-minimap-nodes").children.length, 10);
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
  assert.match(textOf(inspector), /SECURED_BY/);
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
