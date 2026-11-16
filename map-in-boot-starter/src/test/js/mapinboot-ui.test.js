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
    addEventListener() {},
    append(...items) { children.push(...items); },
    appendChild(item) { children.push(item); return item; },
    replaceChildren(...items) { children.length = 0; children.push(...items); },
    getAttribute(name) { return attributes[name] || null; },
    setAttribute(name, value) { attributes[name] = value; },
    removeAttribute(name) { delete attributes[name]; },
    querySelector() { return createElement(); }
  };
}

function loadUi() {
  const ids = [
    "sidebar", "sidebar-toggle", "view-title", "view-state", "shell-notice",
    "help-button", "settings-button", "refresh-button", "graph-canvas",
    "graph-empty", "graph-state-message", "graph-svg", "graph-viewport",
    "graph-edges", "graph-nodes", "service-name", "snapshot-time"
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
    createElementNS(_namespace, tagName) {
      return createElement(tagName);
    }
  };
  const window = {};
  vm.runInNewContext(
    readFileSync("map-in-boot-starter/src/main/resources/static/mapinboot/graph-renderer.js", "utf8"),
    { console, document, window }
  );
  vm.runInNewContext(
    readFileSync("map-in-boot-starter/src/main/resources/static/mapinboot/app.js", "utf8"),
    { console, document, window, fetch: async () => ({ ok: false, status: 503 }) }
  );
  return { ui: window.MapInBootUi, elements };
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
  return { nodes, edges };
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
