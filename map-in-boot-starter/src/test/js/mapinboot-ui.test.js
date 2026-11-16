import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

function createElement(tagName = "div") {
  const attributes = {};
  const children = [];
  return {
    attributes,
    children,
    tagName,
    classList: { toggle() {} },
    dataset: {},
    hidden: false,
    textContent: "",
    value: "",
    clientWidth: 960,
    clientHeight: 540,
    style: {},
    addEventListener() {},
    append(...items) { children.push(...items); },
    appendChild(item) { children.push(item); return item; },
    replaceChildren(...items) { children.length = 0; children.push(...items); },
    getAttribute(name) { return attributes[name] || null; },
    setAttribute(name, value) { attributes[name] = value; },
    removeAttribute(name) { delete attributes[name]; },
    getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; },
    closest() { return null; },
    setPointerCapture() {},
    releasePointerCapture() {},
    querySelector() { return createElement(); }
  };
}

function loadUi() {
  const ids = [
    "sidebar", "sidebar-toggle", "view-title", "view-state", "shell-notice",
    "help-button", "settings-button", "refresh-button", "graph-canvas",
    "graph-empty", "graph-state-message", "graph-svg", "graph-viewport", "graph-areas",
    "graph-edges", "graph-nodes", "service-name", "snapshot-time", "endpoint-search",
    "endpoint-results", "node-filter", "edge-filter", "search-reset", "zoom-in", "zoom-out", "fit-graph",
    "reset-view", "graph-filter-status", "graph-minimap", "graph-minimap-svg",
    "graph-minimap-nodes", "graph-minimap-viewport", "inspector", "graph-popover"
  ];
  const elements = new Map(ids.map((id) => [id, createElement()]));
  const navigation = Array.from({ length: 4 }, () => ({
    dataset: { view: "all-flow" },
    classList: { toggle() {} },
    addEventListener() {},
    setAttribute() {},
    removeAttribute() {}
  }));
  const document = {
    querySelector(selector) {
      return selector.startsWith("#") ? elements.get(selector.slice(1)) : createElement();
    },
    querySelectorAll(selector) {
      return selector === ".nav-item" ? navigation : [];
    },
    createElement(tagName) {
      return createElement(tagName);
    },
    createElementNS(_namespace, tagName) {
      return createElement(tagName);
    },
    addEventListener() {}
  };
  const window = { addEventListener() {} };
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
          x: 32 + (index % 3) * 280,
          y: 32 + Math.floor(index / 3) * 112
        })),
        edges: graph.edges.map((edge) => ({
          id: edge.id,
          sections: [{ startPoint: { x: 252, y: 73 }, endPoint: { x: 312, y: 73 }, bendPoints: [] }]
        }))
      });
    }

    terminateWorker() {}
  }
  window.ELK = FakeElk;
  vm.runInNewContext(
    readFileSync("map-in-boot-starter/src/main/resources/static/mapinboot/graph-renderer.js", "utf8"),
    { console, document, window }
  );
  vm.runInNewContext(
    readFileSync("map-in-boot-starter/src/main/resources/static/mapinboot/graph-inspector.js", "utf8"),
    { console, document, window }
  );
  vm.runInNewContext(
    readFileSync("map-in-boot-starter/src/main/resources/static/mapinboot/layout-client.js", "utf8"),
    { console, document, window }
  );
  vm.runInNewContext(
    readFileSync("map-in-boot-starter/src/main/resources/static/mapinboot/graph-navigation.js", "utf8"),
    { console, document, window }
  );
  vm.runInNewContext(
    readFileSync("map-in-boot-starter/src/main/resources/static/mapinboot/app.js", "utf8"),
    { console, document, window, fetch: () => new Promise(() => {}) }
  );
  return {
    ui: window.MapInBootUi,
    elements,
    layoutApi: window.MapInBootLayout,
    navigationApi: window.MapInBootNavigation,
    layoutCalls
  };
}

function textOf(element) {
  return [element.textContent || "", ...element.children.map(textOf)].join(" ");
}

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
  assert.equal(elements.get("graph-areas").children.length, 5);
  assert.equal(layout.positions["node-2"].x, 592);
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
  assert.equal(elements.get("endpoint-results").children.length, 2);
  ui.focusEndpoint("node-2");
  assert.notEqual(ui.navigation.state.panX, 0);
  assert.match(elements.get("graph-filter-status").textContent, /숨김 Node 9개/);

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
  const { ui, elements } = loadUi();
  ui.renderGraph(graphFixture());
  await ui.layoutGraph();

  ui.showGraphHover("node", "node-2", elements.get("graph-nodes").children[2]);
  assert.equal(elements.get("graph-popover").hidden, false);
  assert.match(textOf(elements.get("graph-popover")), /GET \/orders/);
  assert.match(textOf(elements.get("graph-popover")), /관련 Finding 있음/);
  ui.hideGraphHover();
  assert.equal(elements.get("graph-popover").hidden, true);

  ui.selectGraphElement("node", "node-2");
  const inspector = elements.get("inspector");
  assert.equal(inspector.hidden, false);
  assert.equal(inspector.attributes["data-selection-kind"], "node");
  assert.equal(inspector.attributes["data-selection-id"], "node-2");
  assert.match(textOf(inspector), /GET \/orders/);
  assert.match(textOf(inspector), /orders:\/\/node\/2/);
  assert.match(textOf(inspector), /관련 Finding 있음/);

  ui.setInspectorTab("connections");
  assert.match(textOf(inspector), /edge-1|edge-2|edge-3/);
  ui.setInspectorTab("relations");
  assert.match(textOf(inspector), /SECURED_BY/);

  ui.selectGraphElement("edge", "edge-3");
  assert.equal(inspector.attributes["data-selection-kind"], "edge");
  assert.equal(inspector.attributes["data-selection-id"], "edge-3");
  ui.setInspectorTab("properties");
  assert.match(textOf(inspector), /node-3/);
  assert.match(textOf(inspector), /node-4/);

  ui.clearSelection();
  assert.equal(inspector.hidden, true);
  assert.equal(ui.state.selection, null);
});
