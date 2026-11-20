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
    pointerCaptures: new Set(),
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
    remove() {
      if (!this.parentNode) return;
      const siblings = this.parentNode.children;
      const index = siblings.indexOf(this);
      if (index >= 0) siblings.splice(index, 1);
      this.parentNode = null;
    },
    focus() { this.focused = true; },
    replaceChildren(...items) {
      children.forEach((child) => { child.parentNode = null; });
      children.length = 0;
      this.textContent = "";
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
    getTotalLength() { return 100; },
    getPointAtLength() { return { x: 123, y: 45 }; },
    closest(selector) {
      let current = this;
      while (current) {
        const className = current.getAttribute && current.getAttribute("class");
        if (selector.startsWith(".") && className && className.split(/\s+/).includes(selector.slice(1))) return current;
        current = current.parentNode;
      }
      return null;
    },
    setPointerCapture(pointerId) { this.pointerCaptures.add(pointerId); },
    releasePointerCapture(pointerId) { this.pointerCaptures.delete(pointerId); },
    querySelector() { return createElement(); }
  };
  Object.assign(element, createEventTarget());
  return element;
}

function loadUi({ fetchImpl, timers, animationClock, clipboard } = {}) {
  const ids = [
    "view-title", "view-state", "shell-notice", "help-button", "settings-button", "refresh-button",
    "help-panel", "settings-panel", "setting-show-areas", "setting-show-edge-labels", "setting-show-minimap",
    "graph-canvas",
    "graph-empty", "graph-state-message", "graph-svg", "graph-viewport", "graph-areas", "graph-flow-projection", "graph-guides",
    "graph-edges", "graph-nodes", "graph-finding-section-titles", "service-name", "snapshot-time", "endpoint-search", "endpoint-filter-label", "endpoint-filter-label-text",
    "endpoint-options", "node-filter-field", "node-filter", "edge-filter-field", "edge-filter", "unconnected-node-field", "include-unconnected-nodes", "finding-filter-fields", "finding-rule", "finding-confidence", "finding-list", "finding-api-fields", "finding-api-select", "finding-all-apis", "detail-finding-list", "search-reset", "filter-toggle", "map-filter-panel", "zoom-in", "zoom-out", "fit-graph",
    "reset-view", "screen-lock-toggle", "graph-filter-status", "graph-minimap", "graph-minimap-svg",
    "graph-minimap-nodes", "graph-minimap-viewport", "graph-finding-sections", "finding-modal", "finding-modal-title", "finding-modal-close", "finding-modal-content", "inspector", "graph-popover",
    "request-flow-controls", "request-flow-start", "request-flow-pause", "request-flow-reset",
    "request-flow-status", "request-flow-education", "request-flow-dot"
  ];
  const elements = new Map(ids.map((id) => [id, createElement()]));
  elements.get("help-panel").hidden = true;
  elements.get("settings-panel").hidden = true;
  elements.get("map-filter-panel").hidden = true;
  elements.get("endpoint-options").hidden = true;
  elements.get("request-flow-controls").hidden = true;
  elements.get("finding-modal").hidden = true;
  elements.get("finding-modal-title").tagName = "h2";
  elements.get("finding-modal-close").tagName = "button";
  elements.get("finding-modal-content").tagName = "div";
  elements.get("finding-modal").append(
    elements.get("finding-modal-title"), elements.get("finding-modal-close"), elements.get("finding-modal-content")
  );
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
  window.navigator = { clipboard: clipboard || { writeText: async () => {} } };
  if (animationClock) {
    window.requestAnimationFrame = (callback) => animationClock.requestFrame(callback);
    window.cancelAnimationFrame = (id) => animationClock.cancelFrame(id);
  }
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
    clearTimeout: timers ? timers.clearTimeout : clearTimeout,
    performance: animationClock ? { now: () => animationClock.now() } : undefined
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
  return [element.textContent || "", ...Array.from(element.children || [], textOf)].join(" ");
}

test("Finding 위치는 정규화된 원본 참조만 사용하고 유실 참조를 구분함", () => {
  const { window } = loadUi();
  const snapshot = graphFixture();
  const graph = window.MapInBootGraph.normalize(snapshot);
  const nodeId = graph.nodes[0].id;
  const edgeId = graph.edges[0].id;
  const findings = [
    { id: "f1", nodeIds: [nodeId, "missing-node"], edgeIds: [edgeId] },
    { id: "f2", nodeIds: [], edgeIds: [] },
    { id: "f3", nodeIds: [nodeId], edgeIds: [] },
    { id: "f4", nodeIds: ["absent"], edgeIds: ["absent-edge"] }
  ];
  const original = JSON.stringify(findings);
  const index = window.MapInBootGraph.indexFindings({ findings }, graph);
  assert.deepEqual(Array.from(index[0].nodeIds), [nodeId]);
  assert.deepEqual(Array.from(index[0].edgeIds), [edgeId]);
  assert.equal(index[0].missing, true);
  assert.equal(index[1].unlocated, true);
  assert.equal(index[2].unlocated, false);
  assert.equal(index[3].unlocated, true);
  assert.equal(index[3].missing, true);
  assert.equal(JSON.stringify(findings), original);
});

test("복합 Finding 참조와 공유 Evidence는 원본 Node·Edge ID에만 연결됨", async () => {
  const { ui, elements, window } = loadUi();
  const snapshot = graphFixture();
  snapshot.evidence.push({ id: "evidence-shared", source: "CODE_PATTERN", location: "OrderPolicy#check", summary: "공유 근거" });
  snapshot.findings = [
    { id: "composite", ruleId: "CHAIN_ORDER", title: "복합 Finding", description: "첫 판단", confidence: "LIKELY", nodeIds: ["node-2", "node-2"], edgeIds: ["edge-3"], evidenceIds: ["evidence-shared"], guide: "첫 가이드" },
    { id: "shared-only", ruleId: "STATE_BYPASS", title: "공유 Evidence만 같은 Finding", description: "다른 판단", confidence: "UNKNOWN", nodeIds: ["node-7"], edgeIds: ["edge-7"], evidenceIds: ["evidence-shared"], guide: "다른 가이드" }
  ];
  const original = JSON.stringify(snapshot);
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");
  await ui.layoutGraph();
  assert.equal(findAllByClass(elements.get("graph-minimap-nodes"), "finding-marker").length, 0);

  let nodeMarkers = findAllByClass(elements.get("graph-nodes"), "finding-marker");
  let edgeMarkers = findAllByClass(elements.get("graph-edges"), "finding-marker");
  assert.equal(nodeMarkers.filter((marker) => /복합 Finding/.test(marker.getAttribute("aria-label"))).length, 1);
  assert.match(nodeMarkers[0].children.find((child) => child.tagName === "title").textContent, /복합 Finding.*CHAIN_ORDER.*검토 필요/);
  assert.equal(edgeMarkers.filter((marker) => /복합 Finding/.test(marker.getAttribute("aria-label"))).length, 1);
  assert.equal(edgeMarkers.find((marker) => /복합 Finding/.test(marker.getAttribute("aria-label"))).getAttribute("data-confidence"), "LIKELY");

  ui.selectGraphElement("node", "node-2");
  assert.match(textOf(elements.get("inspector")), /복합 Finding/);
  assert.doesNotMatch(textOf(elements.get("inspector")), /공유 Evidence만 같은 Finding/);
  edgeMarkers = findAllByClass(elements.get("graph-edges"), "finding-marker");
  edgeMarkers.find((marker) => /복합 Finding/.test(marker.getAttribute("aria-label"))).dispatchEvent({ type: "click" });
  await ui.layoutGraph();

  assert.equal(ui.state.selectedFindingId, "composite");
  assert.equal(ui.state.selection, null);
  const endpointGraph = window.MapInBootFlow.deriveEndpointGraph(ui.state.graph, ui.state.detailApiId, ui.state.flowIndex);
  assert.deepEqual(Array.from(ui.state.viewGraph.nodes, (node) => node.id), Array.from(endpointGraph.nodes, (node) => node.id));
  assert.deepEqual(Array.from(ui.state.viewGraph.edges, (edge) => edge.id), Array.from(endpointGraph.edges, (edge) => edge.id));
  assert.equal(elements.get("inspector").hidden, true);
  assert.match(textOf(elements.get("finding-modal")), /공유 근거/);
  assert.match(textOf(elements.get("finding-modal")), /첫 가이드/);
  assert.doesNotMatch(textOf(elements.get("finding-modal")), /다른 판단|다른 가이드/);
  assert.equal(JSON.stringify(snapshot), original);
});

test("동일 Finding ID의 새 Snapshot 참조와 근거를 갱신하고 PARTIAL·Confidence를 분리함", async () => {
  const first = graphFixture();
  first.findings = [{
    id: "same-finding", ruleId: "CHAIN_ORDER", title: "이전 판단", description: "이전 설명",
    confidence: "LIKELY", nodeIds: ["node-2"], edgeIds: ["edge-3"], evidenceIds: ["evidence-2"], guide: "이전 가이드"
  }];
  first.analysisStatus = { "security-chain": "READY" };
  const latest = graphFixture();
  latest.findings = [{
    id: "same-finding", ruleId: "CHAIN_ORDER", title: "갱신된 판단", description: "갱신된 설명",
    confidence: "UNKNOWN", nodeIds: ["node-7"], edgeIds: ["edge-7"], evidenceIds: ["evidence-7"], guide: "갱신된 가이드"
  }];
  latest.analysisStatus = { "security-chain": "PARTIAL" };
  const responses = [
    { ok: true, json: async () => ({ phase: "COMPLETED", persistedSnapshotPresent: true }) },
    { ok: true, json: async () => first },
    { ok: true, json: async () => ({ phase: "PARTIAL", persistedSnapshotPresent: true }) },
    { ok: true, json: async () => latest }
  ];
  const { ui, elements } = loadUi({ fetchImpl: () => Promise.resolve(responses.shift()) });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  ui.selectView("security-flow");
  await ui.layoutGraph();
  findAllByClass(elements.get("graph-nodes"), "finding-marker")[0].dispatchEvent({ type: "click" });
  await ui.layoutGraph();
  assert.equal(ui.state.selectedFindingId, "same-finding");

  await ui.loadStatus();
  assert.equal(ui.state.view, "security-flow");
  assert.equal(ui.state.selectedFindingId, "same-finding");
  assert.equal(ui.state.snapshot.analysisStatus["security-chain"], "PARTIAL");
  assert.deepEqual(Array.from(ui.state.viewGraph.nodes, (node) => node.id), Array.from(ui.state.graph.nodes, (node) => node.id));
  assert.deepEqual(Array.from(ui.state.viewGraph.edges, (edge) => edge.id), Array.from(ui.state.graph.edges, (edge) => edge.id));
  assert.match(textOf(elements.get("view-state")), /부분 완료.*보존 Snapshot 있음/);
  const modalText = textOf(elements.get("finding-modal"));
  ["갱신된 판단", "UNKNOWN", "확인 불가", "갱신된 설명", "evidence-7", "runtime evidence 7", "갱신된 가이드"]
    .forEach((value) => assert.ok(modalText.includes(value), `${value} 표시`));
  ["이전 판단", "이전 설명", "이전 가이드", "runtime evidence 2"]
    .forEach((value) => assert.equal(modalText.includes(value), false, `${value} 잔존 금지`));
});

test("Finding과 Evidence의 특수 문자열은 Modal의 텍스트 노드로 표시됨", async () => {
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  const payloads = ["<script>window.pwned=true</script>", "<img src=x onerror=alert(1)>"];
  snapshot.findings = [{
    id: "text-only", ruleId: "STATE_BYPASS", title: payloads[0], description: payloads[1],
    confidence: "UNKNOWN", nodeIds: ["node-2"], edgeIds: [], evidenceIds: ["evidence-2"], guide: payloads[0]
  }];
  snapshot.evidence[2].location = payloads[1];
  snapshot.evidence[2].summary = payloads[0];
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");
  await ui.layoutGraph();
  findAllByClass(elements.get("graph-nodes"), "finding-marker")[0].dispatchEvent({ type: "click" });
  await ui.layoutGraph();

  const modalText = textOf(elements.get("finding-modal"));
  assert.ok(payloads.every((payload) => modalText.includes(payload)));
  assert.doesNotMatch(modalText, /Severity|Risk Score|Proof of Exploit|Trace/i);
  const descendants = (element) => element.children.flatMap((child) => [child, ...descendants(child)]);
  assert.equal(descendants(elements.get("finding-modal")).some((element) => ["script", "img"].includes(element.tagName)), false);
});

test("보안 MAP 필터는 Escape·외부 클릭으로 닫혀도 Rule·Confidence 선택을 보존함", () => {
  const { ui, elements, document } = loadUi();
  const snapshot = graphFixture();
  snapshot.findings = [{ id: "filter-state", ruleId: "CHAIN_MISSING", title: "필터 상태", confidence: "UNKNOWN", nodeIds: ["node-2"], edgeIds: [] }];
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");
  elements.get("finding-rule").value = "CHAIN_MISSING";
  elements.get("finding-confidence").value = "UNKNOWN";
  elements.get("finding-rule").dispatchEvent({ type: "change" });
  elements.get("finding-confidence").dispatchEvent({ type: "change" });
  assert.equal(findAllByClass(elements.get("graph-nodes"), "finding-marker").length, 1);

  const toggle = elements.get("filter-toggle");
  const panel = elements.get("map-filter-panel");
  toggle.dispatchEvent({ type: "click" });
  document.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(panel.hidden, true);
  assert.equal(elements.get("finding-rule").value, "CHAIN_MISSING");
  assert.equal(elements.get("finding-confidence").value, "UNKNOWN");

  toggle.dispatchEvent({ type: "click" });
  document.dispatchEvent({ type: "click", target: createElement() });
  assert.equal(panel.hidden, true);
  assert.equal(elements.get("finding-rule").value, "CHAIN_MISSING");
  assert.equal(elements.get("finding-confidence").value, "UNKNOWN");
  assert.equal(findAllByClass(elements.get("graph-nodes"), "finding-marker").length, 1);
});

test("PERMIT_ALL만으로 Finding을 합성하지 않고 보안 MAP 화면 전환 Toast를 억제함", async () => {
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  snapshot.findings = [];
  snapshot.nodes.find((node) => node.type === "AUTHORIZATION").attributes = { policyKind: "PERMIT_ALL" };
  ui.renderGraph(snapshot);
  elements.get("shell-notice").textContent = "";
  ui.selectView("security-flow");
  await ui.layoutGraph();

  assert.equal(findAllByClass(elements.get("graph-nodes"), "finding-marker").length, 0);
  assert.match(textOf(elements.get("finding-list")), /보존된 Finding 없음/);
  assert.equal(elements.get("shell-notice").textContent, "");
  assert.equal(snapshot.findings.length, 0);
});

test("보안 MAP은 원본 위치와 위치 미확인 Finding을 필터와 함께 제공함", () => {
  assert.match(indexHtml, /id="graph-svg"[^>]*role="group"/);
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  snapshot.findings.push({ id: "missing", ruleId: "PUBLIC_ENDPOINT", title: "위치 미확인", confidence: "LIKELY", nodeIds: [], edgeIds: [] });
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");
  assert.ok(findAllByClass(elements.get("graph-nodes"), "finding-marker").length > 0);
  const edgeMarker = findAllByClass(elements.get("graph-edges"), "finding-marker")[0];
  assert.equal(edgeMarker.getAttribute("transform"), "translate(123 45)");
  assert.match(textOf(elements.get("finding-list")), /위치 미확인/);
  edgeMarker.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selectedFindingId, "finding-1");
  assert.equal(ui.state.view, "security-detail");
  assert.equal(elements.get("inspector").hidden, true);
  assert.match(elements.get("finding-modal-title").textContent, /실제 참조 Finding/);
  ui.selectView("security-flow");
  elements.get("finding-confidence").value = "LIKELY";
  elements.get("finding-confidence").dispatchEvent({ type: "change" });
  assert.equal(findAllByClass(elements.get("graph-nodes"), "finding-marker").filter((marker) => !marker.hidden).length, 0);
  assert.match(textOf(elements.get("finding-list")), /위치 미확인/);
  assert.equal(snapshot.nodes.length, 10);
});

test("Graph가 비어 있어도 위치 없는 Finding을 보안 MAP Modal에서 확인함", () => {
  const { ui, elements } = loadUi();
  ui.selectView("security-flow");
  ui.renderGraph({ nodes: [], edges: [], findings: [
    { id: "unlocated", ruleId: "CHAIN_MISSING", title: "체인 점검", confidence: "UNKNOWN", nodeIds: [], edgeIds: [] }
  ] });
  assert.match(textOf(elements.get("finding-list")), /체인 점검.*연결 위치 확인 불가/);
  elements.get("finding-list").children[0].dispatchEvent({ type: "click" });
  assert.equal(ui.state.selectedFindingId, "unlocated");
  assert.equal(ui.state.view, "security-flow");
  assert.equal(elements.get("inspector").hidden, true);
  assert.equal(elements.get("finding-modal").hidden, false);
  assert.match(textOf(elements.get("finding-modal")), /확인된 연결 위치 없음/);
  assert.match(textOf(elements.get("finding-modal")), /연결된 근거가 없습니다\./);
  assert.match(textOf(elements.get("finding-modal")), /제공된 점검 가이드 없음/);
  ui.selectView("security-flow");
  elements.get("finding-confidence").value = "CONFIRMED";
  elements.get("finding-confidence").dispatchEvent({ type: "change" });
  assert.doesNotMatch(textOf(elements.get("finding-list")), /체인 점검/);
  elements.get("search-reset").dispatchEvent({ type: "click" });
  assert.match(textOf(elements.get("finding-list")), /체인 점검/);
});

test("위치 없는 Finding도 보안 MAP에서 상세 Modal로 확인함", () => {
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  snapshot.findings = [{ id: "finding-empty", ruleId: "CHAIN_MISSING", title: "체인 점검", description: "판단 설명", confidence: "UNKNOWN", nodeIds: [], edgeIds: [], evidenceIds: ["evidence-2", "missing"], guide: "설정 확인" }];
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");
  elements.get("finding-list").children[0].dispatchEvent({ type: "click" });
  assert.equal(ui.state.view, "security-flow");
  assert.equal(elements.get("inspector").hidden, true);
  assert.equal(elements.get("finding-modal").hidden, false);
  assert.match(elements.get("finding-modal-title").textContent, /체인 점검/);
  assert.match(textOf(elements.get("finding-modal-content")), /판단 설명/);
  assert.match(textOf(elements.get("finding-modal-content")), /CHAIN_MISSING/);
  assert.match(textOf(elements.get("finding-modal-content")), /UNKNOWN/);
  assert.match(textOf(elements.get("finding-modal-content")), /runtime evidence 2/);
  assert.match(textOf(elements.get("finding-modal-content")), /orders:\/\/node\/2/);
  assert.match(textOf(elements.get("finding-modal-content")), /근거 참조를 확인할 수 없습니다\./);
  assert.match(textOf(elements.get("finding-modal-content")), /설정 확인/);
  assert.equal(ui.state.viewGraph.nodes.length, 10);
});

test("API를 확정할 수 없는 Finding은 보안 MAP을 유지하고 직접 근거만 Modal에 표시함", () => {
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  snapshot.findings = [
    { id: "edge-only", ruleId: "CHAIN_ORDER", title: "Edge 판단", description: "Edge 설명", confidence: "LIKELY", nodeIds: [], edgeIds: ["edge-3"], evidenceIds: ["evidence-3"], guide: "Edge 가이드" },
    { id: "node-only", ruleId: "OBJECT_BINDING", title: "Node 판단", description: "Node 설명", confidence: "CONFIRMED", nodeIds: ["node-7", "missing-node"], edgeIds: [], evidenceIds: ["evidence-7"], guide: "Node 가이드" }
  ];
  const original = JSON.stringify(snapshot);
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");
  let marker = findAllByClass(elements.get("graph-edges"), "finding-marker")
    .find((item) => /Edge 판단/.test(item.getAttribute("aria-label")));
  marker.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selectedFindingId, "edge-only");
  assert.equal(ui.state.view, "security-flow");
  assert.deepEqual(Array.from(ui.state.viewGraph.nodes, (node) => node.id), Array.from(ui.state.graph.nodes, (node) => node.id));
  assert.deepEqual(Array.from(ui.state.viewGraph.edges, (edge) => edge.id), Array.from(ui.state.graph.edges, (edge) => edge.id));
  assert.equal(elements.get("finding-modal").hidden, false);
  assert.match(elements.get("finding-modal-title").textContent, /Edge 판단/);
  assert.match(textOf(elements.get("finding-modal-content")), /Edge 설명/);
  assert.match(textOf(elements.get("finding-modal-content")), /Edge 가이드/);
  elements.get("finding-modal-close").dispatchEvent({ type: "click" });

  assert.equal(ui.state.selectedFindingId, "edge-only");
  marker = findAllByClass(elements.get("graph-nodes"), "finding-marker")
    .find((item) => /Node 판단/.test(item.getAttribute("aria-label")));
  marker.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selectedFindingId, "node-only");
  assert.deepEqual(Array.from(ui.state.viewGraph.nodes, (node) => node.id), Array.from(ui.state.graph.nodes, (node) => node.id));
  assert.deepEqual(Array.from(ui.state.viewGraph.edges, (edge) => edge.id), Array.from(ui.state.graph.edges, (edge) => edge.id));
  assert.match(elements.get("finding-modal-title").textContent, /Node 판단/);
  assert.match(textOf(elements.get("finding-modal-content")), /Node 설명/);
  assert.match(textOf(elements.get("finding-modal-content")), /Node 가이드/);
  assert.match(textOf(elements.get("finding-modal-content")), /evidence-7/);
  assert.doesNotMatch(textOf(elements.get("finding-modal-content")), /Edge 판단|Edge 설명|Edge 가이드|evidence-3/);
  assert.match(textOf(elements.get("finding-modal-content")), /일부 Graph 참조를 확인할 수 없습니다/);
  assert.equal(JSON.stringify(snapshot), original);
});

test("상세 취약점 직접 진입과 Endpoint 이동은 전체 Endpoint Graph를 표시함", () => {
  const { ui, elements, window } = loadUi();
  const snapshot = detailGraphFixture();
  snapshot.findings = [{ id: "endpoint-finding", ruleId: "PUBLIC_ENDPOINT", title: "API 판단", description: "실제 Endpoint 참조", confidence: "UNKNOWN", nodeIds: ["endpoint-a"], edgeIds: [], evidenceIds: [], guide: "실제 가이드" }];
  ui.renderGraph(snapshot);
  ui.state.snapshotState = "loaded";
  ui.selectView("security-detail");
  assert.equal(ui.state.selectedFindingId, "endpoint-finding");
  assert.equal(elements.get("inspector").hidden, true);
  assert.deepEqual(Array.from(ui.state.viewGraph.nodes, (node) => node.id), ["endpoint-a", "handler-a", "chain-a", "security-filter-1", "security-filter-2", "authorization-a", "security-data-a"]);
  ui.selectView("security-flow");
  const marker = findAllByClass(elements.get("graph-nodes"), "finding-marker")[0];
  marker.dispatchEvent({ type: "click" });
  assert.match(elements.get("finding-modal-title").textContent, /API 판단/);
  elements.get("finding-modal-close").dispatchEvent({ type: "click" });
  ui.selectGraphElement("node", "endpoint-a");
  const endpointAction = findAllByClass(elements.get("inspector"), "inspector-detail-action")
    .find((button) => button.textContent === "기능별 상세 보기");
  assert.ok(endpointAction);
  endpointAction.dispatchEvent({ type: "click" });
  assert.equal(ui.state.view, "feature-flow");
  assert.equal(ui.state.selectedEndpointId, "endpoint-a");
  ui.selectView("security-flow");
  assert.equal(ui.state.selectedFindingId, "endpoint-finding");
  ui.selectView("security-detail");
  const expected = window.MapInBootFlow.deriveEndpointGraph(ui.state.graph, "endpoint-a", ui.state.flowIndex);
  assert.deepEqual(Array.from(ui.state.viewGraph.nodes, (node) => node.id), Array.from(expected.nodes, (node) => node.id));
  ui.selectGraphElement("node", "endpoint-a");
  const returnToFinding = findAllByClass(elements.get("inspector"), "inspector-detail-action")
    .find((button) => button.textContent === "선택 Finding 다시 보기");
  assert.ok(returnToFinding);
  returnToFinding.dispatchEvent({ type: "click" });
  assert.equal(ui.state.view, "security-detail");
  assert.equal(ui.state.selectedFindingId, "endpoint-finding");
  ui.renderGraph({ ...snapshot, findings: [] });
  assert.equal(ui.state.selectedFindingId, null);
  const refreshedEndpointGraph = window.MapInBootFlow.deriveEndpointGraph(ui.state.graph, "endpoint-a", ui.state.flowIndex);
  assert.deepEqual(Array.from(ui.state.viewGraph.nodes, (node) => node.id), Array.from(refreshedEndpointGraph.nodes, (node) => node.id));
  assert.equal(elements.get("finding-modal").hidden, true);
});

test("다른 View와 Finding의 늦은 ELK 응답은 선택 Finding의 Graph를 덮지 않음", async () => {
  const { ui, layoutApi, elements } = loadUi();
  ui.renderGraph(graphFixture());
  const pending = [];
  layoutApi.layout = (graph) => new Promise((resolve) => pending.push({ graph, resolve }));
  ui.selectView("security-flow");
  const marker = findAllByClass(elements.get("graph-edges"), "finding-marker")[0];
  marker.dispatchEvent({ type: "click" });
  const currentLayout = ui.layoutGraph();
  assert.equal(pending.length, 3);

  const resultFor = (graph, x) => ({
    width: 960,
    height: 720,
    positions: Object.fromEntries(graph.nodes.map((node, index) => [node.id, { x: x + index, y: index * 40 }])),
    edgeRoutes: Object.fromEntries(graph.edges.map((edge) => [edge.id, { sections: [] }]))
  });
  pending[2].resolve(resultFor(pending[2].graph, 300));
  await currentLayout;
  pending[0].resolve(resultFor(pending[0].graph, 10));
  pending[1].resolve(resultFor(pending[1].graph, 100));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(ui.state.view, "security-detail");
  assert.deepEqual(Object.keys(ui.state.layout.positions).sort(), ["node-2"]);
  assert.deepEqual(Array.from(ui.state.visibleGraph.edges, (edge) => edge.id), []);
  assert.equal(ui.state.layout.positions["node-2"].x, 300);
  assert.equal(elements.get("graph-minimap-nodes").children.length, ui.state.graphRender.displayNodes.length);
  assert.equal(elements.get("graph-flow-projection").children.length, 0);
  assert.equal(elements.get("graph-guides").children.length, 0);
});

test("API가 확인되지 않은 Finding의 Modal에서 실제 Node Inspector를 열 수 있음", async () => {
  const { ui, elements } = loadUi();
  const snapshot = detailGraphFixture();
  snapshot.evidence = [
    { id: "evidence-authorization-a", source: "SPRING_METADATA", location: "authorization-a", summary: "인가 노드 근거" },
    { id: "e-auth-a", source: "CODE_PATTERN", location: "OrderPolicy#check", summary: "인가 조건 근거" }
  ];
  snapshot.findings = [{ id: "grouped-finding", ruleId: "OBJECT_BINDING", title: "인가 판단", description: "인가 정보 참조", confidence: "LIKELY", nodeIds: ["authorization-a"], edgeIds: ["secured-a"], evidenceIds: ["e-auth-a"], guide: "인가 조건 확인" }];
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");
  await ui.layoutGraph();
  findAllByClass(elements.get("graph-nodes"), "finding-marker")[0].dispatchEvent({ type: "click" });
  assert.equal(ui.state.view, "security-flow");
  assert.equal(elements.get("finding-modal").hidden, false);
  assert.match(textOf(elements.get("finding-modal")), /OrderPolicy#check/);
  assert.match(textOf(elements.get("finding-modal")), /CODE_PATTERN/);
  const originalNode = findAllByClass(elements.get("finding-modal"), "inspector-link")
    .find((button) => button.attributes["data-node-id"] === "authorization-a");
  assert.ok(originalNode);
  originalNode.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selection.kind, "node");
  assert.equal(ui.state.selection.id, "authorization-a");
  assert.equal(elements.get("finding-modal").hidden, false);
  assert.match(textOf(elements.get("inspector")), /Node ID authorization-a/);
  assert.match(textOf(elements.get("inspector")), /authorizationKind ROLE/);
});

test("Snapshot 새로고침은 같은 Finding만 복원하고 사라진 ID는 폐기함", async () => {
  const snapshot = graphFixture();
  const replacement = { ...graphFixture(), findings: [] };
  const responses = [
    { ok: true, json: async () => ({ phase: "COMPLETED", persistedSnapshotPresent: true }) },
    { ok: true, json: async () => snapshot },
    { ok: true, json: async () => ({ phase: "COMPLETED", persistedSnapshotPresent: true }) },
    { ok: true, json: async () => snapshot },
    { ok: true, json: async () => ({ phase: "COMPLETED", persistedSnapshotPresent: true }) },
    { ok: true, json: async () => replacement }
  ];
  const instance = loadUi({ fetchImpl: () => Promise.resolve(responses.shift()) });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  instance.ui.navigation.setLocked(true);
  assert.equal(instance.ui.navigation.state.locked, true);
  instance.ui.selectView("security-flow");
  findAllByClass(instance.elements.get("graph-nodes"), "finding-marker")[0].dispatchEvent({ type: "click" });
  instance.ui.navigation.setLocked(true);
  await instance.ui.loadStatus();
  assert.equal(instance.ui.navigation.state.locked, false);
  assert.equal(instance.ui.state.view, "security-detail");
  assert.equal(instance.ui.state.selectedFindingId, "finding-1");
  assert.equal(instance.elements.get("inspector").hidden, true);
  assert.match(textOf(instance.elements.get("finding-modal")), /실제 참조 Finding/);

  await instance.ui.loadStatus();
  assert.equal(instance.ui.state.view, "security-detail");
  assert.equal(instance.ui.state.selectedFindingId, null);
  assert.equal(instance.ui.state.viewGraph, null);
  assert.match(textOf(instance.elements.get("inspector")), /보존된 Finding 없음/);
  assert.doesNotMatch(textOf(instance.elements.get("inspector")), /후속 단계/);
});

test("같은 Node의 다중 Finding과 신뢰도 필터가 원본을 보존함", () => {
  const { ui, elements, layoutCalls } = loadUi();
  const snapshot = graphFixture();
  snapshot.findings = ["CONFIRMED", "LIKELY", "UNKNOWN"].map((confidence, index) => ({
    id: `f${index}`, title: `판단 ${index}`, description: `설명 ${index}`, guide: `가이드 ${index}`,
    ruleId: "CHAIN_MISSING", confidence, nodeIds: ["node-2"], edgeIds: [], evidenceIds: [`evidence-${index}`]
  }));
  const original = JSON.stringify(snapshot);
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");
  ui.selectGraphElement("node", "node-2");
  assert.equal(ui.state.selection.id, "node-2");
  let markers = findAllByClass(elements.get("graph-nodes"), "finding-marker");
  assert.equal(markers.length, 3);
  assert.equal(markers[1].getAttribute("tabindex"), "0");
  assert.equal(markers[1].getAttribute("role"), "button");
  assert.match(markers[1].getAttribute("aria-label"), /판단 1.*CHAIN_MISSING.*검토 필요/);
  assert.match(appCss, /\.finding-marker:focus-visible/);
  markers[1].dispatchEvent({ type: "keydown", key: " " });
  assert.equal(ui.state.selectedFindingId, "f1");
  assert.equal(ui.state.view, "security-detail");
  assert.equal(ui.state.selection, null);
  let modalText = textOf(elements.get("finding-modal"));
  ["설명 1", "runtime evidence 1", "가이드 1"].forEach((value) => assert.ok(modalText.includes(value)));
  ["설명 0", "runtime evidence 0", "가이드 0"].forEach((value) => assert.equal(modalText.includes(value), false));
  ui.selectView("security-flow");
  markers = findAllByClass(elements.get("graph-nodes"), "finding-marker");
  assert.equal(markers[1].getAttribute("data-selected"), "true");
  ui.clearSelection();
  assert.equal(ui.state.selectedFindingId, "f1");
  markers = findAllByClass(elements.get("graph-nodes"), "finding-marker");
  markers[0].dispatchEvent({ type: "click" });
  assert.equal(ui.state.selectedFindingId, "f0");
  modalText = textOf(elements.get("finding-modal"));
  ["설명 0", "runtime evidence 0", "가이드 0"].forEach((value) => assert.ok(modalText.includes(value)));
  ["설명 1", "runtime evidence 1", "가이드 1"].forEach((value) => assert.equal(modalText.includes(value), false));
  assert.equal(ui.state.view, "security-detail");
  ui.selectView("security-flow");
  ui.selectGraphElement("node", "node-2");
  assert.equal(ui.state.selectedFindingId, "f0");
  const beforeFilters = layoutCalls.length;
  for (const confidence of ["CONFIRMED", "LIKELY", "UNKNOWN"]) {
    elements.get("finding-confidence").value = confidence;
    elements.get("finding-confidence").dispatchEvent({ type: "change" });
    markers = findAllByClass(elements.get("graph-nodes"), "finding-marker").filter((marker) => !marker.hidden);
    assert.equal(markers.length, 1);
    assert.equal(markers[0].getAttribute("data-confidence"), confidence);
  }
  assert.equal(layoutCalls.length, beforeFilters);
  assert.equal(JSON.stringify(snapshot), original);
  markers[0].dispatchEvent({ type: "click" });
  ui.selectView("all-flow");
  assert.equal(ui.state.selectedFindingId, "f2");
  assert.equal(findAllByClass(elements.get("graph-nodes"), "finding-marker").length, 0);
});

test("Finding 유형 필터는 원본 Rule ID를 구분하고 숨긴 위치를 알림", () => {
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  const rules = ["CHAIN_MISSING", "CHAIN_ORDER", "PUBLIC_ENDPOINT", "METHOD_MISMATCH", "FILTER_ORDER", "OBJECT_BINDING", "STATE_BYPASS", "EXTRA_RULE"];
  snapshot.findings = rules.map((ruleId) => ({ id: ruleId, title: ruleId, ruleId, confidence: "UNKNOWN", nodeIds: ["node-2"], edgeIds: [] }));
  const original = JSON.stringify(snapshot);
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");
  for (const ruleId of rules) {
    elements.get("finding-rule").value = ruleId;
    elements.get("finding-rule").dispatchEvent({ type: "change" });
    const markers = findAllByClass(elements.get("graph-nodes"), "finding-marker").filter((marker) => !marker.hidden);
    assert.equal(markers.length, 1);
    assert.match(markers[0].getAttribute("aria-label"), new RegExp(ruleId));
  }
  assert.ok(elements.get("finding-rule").children.some((option) => option.value === "EXTRA_RULE"));
  elements.get("node-filter").value = "FILTER";
  elements.get("node-filter").dispatchEvent({ type: "change" });
  elements.get("edge-filter").value = "FILTERED_BY";
  elements.get("edge-filter").dispatchEvent({ type: "change" });
  assert.doesNotMatch(textOf(elements.get("finding-list")), /필터로 숨겨진 항목/);
  elements.get("search-reset").dispatchEvent({ type: "click" });
  assert.equal(elements.get("finding-rule").value, "");
  assert.equal(elements.get("node-filter").value, "");
  assert.equal(elements.get("edge-filter").value, "");
  assert.equal(JSON.stringify(snapshot), original);
  rules.slice(0, 7).forEach((ruleId) => assert.ok(indexHtml.includes(`<option>${ruleId}</option>`)));
});

test("취약점 마커는 크게 표시되고 포인터 이동과 클릭 전파를 막음", () => {
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  snapshot.findings = ["f1", "f2"].map((id) => ({
    id, ruleId: "CHAIN_ORDER", title: id, confidence: "CONFIRMED", nodeIds: ["node-2"], edgeIds: []
  }));
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");

  const markers = findAllByClass(elements.get("graph-nodes"), "finding-marker");
  assert.equal(markers.length, 2);
  assert.deepEqual(markers.map((marker) => marker.children.find((child) => child.tagName === "circle").getAttribute("r")), ["14", "14"]);
  assert.equal(markers[0].children.find((child) => child.tagName === "circle").getAttribute("vector-effect"), "non-scaling-stroke");
  assert.deepEqual(markers.map((marker) => marker.getAttribute("tabindex")), ["0", "0"]);
  assert.match(appCss, /\.finding-marker\[data-confidence="CONFIRMED"\] circle\s*\{[^}]*fill:\s*#b91c1c/s);
  assert.match(appCss, /\.finding-marker:hover circle/);
  assert.match(appCss, /\.finding-marker\[data-selected="true"\] circle/);
  assert.match(appCss, /\.finding-marker:focus-visible circle/);

  const beforePan = { x: ui.navigation.state.panX, y: ui.navigation.state.panY };
  elements.get("graph-canvas").dispatchEvent({ type: "pointerdown", target: markers[0], clientX: 10, clientY: 20 });
  elements.get("graph-canvas").dispatchEvent({ type: "pointermove", target: markers[0], clientX: 60, clientY: 70 });
  elements.get("graph-canvas").dispatchEvent({ type: "pointerup", target: markers[0] });
  assert.deepEqual({ x: ui.navigation.state.panX, y: ui.navigation.state.panY }, beforePan);

  const click = { type: "click" };
  markers[0].dispatchEvent(click);
  assert.equal(click.cancelBubble, true);
  assert.equal(ui.state.selectedFindingId, "f1");
  assert.equal(ui.state.view, "security-detail");
});

test("상세 취약점 API 목록은 실제 Finding 연결만 보여줌", () => {
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  snapshot.nodes.push({
    id: "endpoint-unlinked", type: "ENDPOINT", label: "POST /unlinked",
    attributes: { httpMethod: "POST", path: "/unlinked", handler: "OtherController#save" }, evidenceIds: []
  });
  snapshot.findings = [
    { id: "node-linked", ruleId: "PUBLIC_ENDPOINT", title: "Node 연결", confidence: "CONFIRMED", nodeIds: ["node-2"], edgeIds: [], evidenceIds: [], guide: "node 점검" },
    { id: "edge-linked", ruleId: "CHAIN_ORDER", title: "Edge 연결", confidence: "LIKELY", nodeIds: [], edgeIds: ["edge-2"], evidenceIds: [], guide: "edge 점검" },
    { id: "other-node", ruleId: "STATE_BYPASS", title: "다른 Node", confidence: "UNKNOWN", nodeIds: ["node-7"], edgeIds: [], evidenceIds: ["evidence-2"], guide: "상태 점검" },
    { id: "missing-only", ruleId: "CHAIN_MISSING", title: "유실 참조", confidence: "UNKNOWN", nodeIds: ["missing-node"], edgeIds: ["missing-edge"], evidenceIds: [], guide: "참조 점검" }
  ];
  ui.state.snapshotState = "loaded";
  ui.renderGraph(snapshot);
  ui.selectView("security-detail");

  const apiSelect = elements.get("finding-api-select");
  const apiIds = () => apiSelect.children.filter((option) => option.value).map((option) => option.value);
  assert.equal(elements.get("finding-api-fields").hidden, false);
  assert.equal(elements.get("filter-toggle").hidden, false);
  assert.deepEqual(apiIds(), ["node-2"]);

  apiSelect.value = "node-2";
  apiSelect.dispatchEvent({ type: "change" });
  let choices = elements.get("detail-finding-list").children;
  assert.equal(choices.length, 2);
  assert.match(textOf(elements.get("detail-finding-list")), /Node 연결/);
  assert.match(textOf(elements.get("detail-finding-list")), /Edge 연결/);
  assert.match(textOf(elements.get("detail-finding-list")), /확정/);
  assert.match(textOf(elements.get("detail-finding-list")), /검토 필요/);
  assert.doesNotMatch(textOf(elements.get("detail-finding-list")), /다른 Node|유실 참조/);
  choices[1].dispatchEvent({ type: "click" });
  assert.equal(ui.state.selectedFindingId, "edge-linked");
  assert.deepEqual(Array.from(ui.state.viewGraph.nodes, (node) => node.id), ["node-2"]);
  assert.deepEqual(Array.from(ui.state.viewGraph.edges, (edge) => edge.id), []);
  assert.equal(elements.get("inspector").hidden, true);
  assert.match(elements.get("finding-modal-title").textContent, /Edge 연결/);
  assert.match(textOf(elements.get("finding-modal")), /edge-2/);
  elements.get("search-reset").dispatchEvent({ type: "click" });
  assert.equal(ui.state.selectedFindingId, "edge-linked");
  assert.equal(apiSelect.value, "node-2");
  assert.deepEqual(apiIds(), ["node-2"]);
  assert.doesNotMatch(indexHtml, /전체 API 보기/);
});

test("네 화면의 필터 문구와 입력 구성이 화면 목적에 맞게 분리됨", () => {
  const { ui, elements } = loadUi();
  const label = elements.get("endpoint-filter-label-text");

  ui.selectView("all-flow");
  assert.equal(label.textContent, "Endpoint 검색");
  assert.equal(elements.get("map-filter-panel").getAttribute("aria-label"), "전체 Flow Map 필터");
  assert.equal(elements.get("search-reset").textContent, "검색 초기화");
  assert.equal(elements.get("node-filter-field").hidden, false);
  assert.equal(elements.get("finding-filter-fields").hidden, true);
  assert.equal(elements.get("finding-api-fields").hidden, true);

  ui.selectView("feature-flow");
  assert.equal(label.textContent, "API 선택");
  assert.equal(elements.get("map-filter-panel").getAttribute("aria-label"), "기능별 상세 API 선택");
  assert.equal(elements.get("search-reset").textContent, "API 검색 초기화");
  assert.equal(elements.get("endpoint-search").getAttribute("role"), "combobox");
  assert.equal(elements.get("node-filter-field").hidden, true);
  assert.equal(elements.get("finding-filter-fields").hidden, true);

  ui.selectView("security-flow");
  assert.equal(label.textContent, "Endpoint 검색");
  assert.equal(elements.get("map-filter-panel").getAttribute("aria-label"), "취약점 MAP 필터");
  assert.equal(elements.get("search-reset").textContent, "취약점 필터 초기화");
  assert.equal(elements.get("finding-filter-fields").hidden, false);
  assert.equal(elements.get("node-filter-field").hidden, false);
  assert.equal(elements.get("finding-api-fields").hidden, true);

  ui.selectView("security-detail");
  assert.equal(elements.get("map-filter-panel").getAttribute("aria-label"), "상세 취약점 API 선택");
  assert.equal(elements.get("search-reset").textContent, "API 선택 초기화");
  assert.equal(elements.get("endpoint-filter-label").hidden, true);
  assert.equal(elements.get("finding-filter-fields").hidden, true);
  assert.equal(elements.get("finding-api-fields").hidden, false);
  assert.equal(elements.get("node-filter-field").hidden, true);
  assert.equal(elements.get("filter-toggle").hidden, false);
});

function findAllByClass(element, className) {
  const matches = [];
  if (element.getAttribute && (element.getAttribute("class") || "").split(/\s+/).includes(className)) matches.push(element);
  Array.from(element.children || []).forEach((child) => matches.push(...findAllByClass(child, className)));
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

function useHtmlCollectionChildren(element) {
  const children = element.children;
  const collection = new Proxy({
    item(index) { return children[index] || null; },
    [Symbol.iterator]() { return children[Symbol.iterator](); }
  }, {
    get(target, property, receiver) {
      if (property === "length") return children.length;
      if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) return children[Number(property)];
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) return Number(property) < children.length;
      return Reflect.has(target, property);
    }
  });
  Object.defineProperty(element, "children", { configurable: true, get: () => collection });
  return collection;
}

function useHtmlCollectionChildrenTree(element) {
  if (!element) return;
  const children = Array.from(element.children || []);
  children.forEach(useHtmlCollectionChildrenTree);
  if (Array.isArray(element.children)) useHtmlCollectionChildren(element);
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

test("MAP 툴바는 좌측 상단에 기존 조작과 화면 고정만 노출하고 검색 결과 Select를 제거함", () => {
  assert.match(appCss, /--header-height:\s*clamp\(60px/);
  assert.match(appCss, /\.map-toolbar\s*\{[^}]*top:\s*14px;[^}]*left:\s*18px;[^}]*background:\s*#363636/s);
  assert.doesNotMatch(appCss.match(/\.map-toolbar\s*\{[^}]*\}/s)[0], /backdrop-filter|background:\s*rgba\(/);
  assert.match(appCss, /\.graph-tool-button\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px/);
  assert.match(appCss, /\.graph-tool-button\[data-tooltip\]::after\s*\{[^}]*border:\s*1px solid #575757;[^}]*background:\s*#424242/);
  assert.match(indexHtml, /id="view-title" class="sr-only"/);
  assert.doesNotMatch(indexHtml, /class="map-toolbar-title"/);
  assert.doesNotMatch(indexHtml, /id="endpoint-results"|검색 결과/);
  assert.doesNotMatch(appJs, /endpointResults|renderSearchResults/);
  assert.equal((indexHtml.match(/class="graph-tool-button(?:\s|\")/g) || []).length, 6);
  assert.match(indexHtml, /id="screen-lock-toggle"[^>]*aria-pressed="false"/);
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

test("Finding 마커 포인터 입력은 Graph Pan을 시작하지 않음", () => {
  const { ui, elements } = loadUi();
  const marker = createElement("g");
  marker.setAttribute("class", "finding-marker");
  const circle = createElement("circle");
  marker.appendChild(circle);
  elements.get("graph-canvas").appendChild(marker);
  circle.dispatchEvent({ type: "pointerdown", pointerId: 1, clientX: 20, clientY: 20 });
  assert.equal(ui.navigation.state.dragging, false);
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

function controllerGroupGraph(firstCount = 1, secondCount = 1) {
  const nodes = [{ id: "shared-chain", type: "SECURITY_CHAIN", serviceId: "orders", label: "공통 Chain",
    attributes: { chainOrder: "1" }, evidenceIds: ["e-shared-chain"] }];
  const edges = [];
  const controllers = [
    { fqcn: "com.example.SampleController", count: firstCount, prefix: "first" },
    { fqcn: "org.other.SampleController", count: secondCount, prefix: "second" }
  ];
  controllers.forEach(({ fqcn, count, prefix }) => {
    for (let index = 0; index < count; index += 1) {
      const handler = `${fqcn}#method${index}(java.lang.String)`;
      const endpointId = `${prefix}-endpoint-${index}`;
      const handlerId = `${prefix}-handler-${index}`;
      nodes.push(
        { id: endpointId, type: "ENDPOINT", serviceId: "orders", label: `GET /${prefix}/${index}`,
          attributes: { httpMethod: "GET", path: `/${prefix}/${index}`, handler }, evidenceIds: [`e-${endpointId}`] },
        { id: handlerId, type: "HANDLER", serviceId: "orders", label: handler,
          attributes: { handler }, evidenceIds: [`e-${handlerId}`] }
      );
      edges.push({ id: `${prefix}-match-${index}`, sourceId: endpointId, targetId: "shared-chain", type: "MATCHED_BY",
        attributes: { chainOrder: "1" }, confidence: "CONFIRMED", evidenceIds: [`e-${prefix}-match-${index}`] });
    }
  });
  return { nodes, edges };
}

function supportApiGraph(count) {
  const graph = controllerGroupGraph(count, 0);
  for (let index = 0; index < count; index += 1) {
    const authorizationId = `authorization-${index}`;
    graph.nodes.push({ id: authorizationId, type: "AUTHORIZATION", serviceId: "orders", label: `Policy ${index}`,
      attributes: { policySource: `METHOD-${index}` }, evidenceIds: [`e-${authorizationId}`] });
    graph.edges.push({ id: `secured-${index}`, sourceId: `first-handler-${index}`, targetId: authorizationId, type: "SECURED_BY",
      attributes: { policySource: `METHOD-${index}` }, confidence: "CONFIRMED", evidenceIds: [`e-secured-${index}`] });
  }
  return graph;
}

function routePoints(route) {
  const section = route && route.sections && route.sections[0];
  return section ? [section.startPoint, ...(section.bendPoints || []), section.endPoint] : [];
}

function routeLength(route) {
  const points = routePoints(route);
  return points.slice(1).reduce((length, point, index) => length
    + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0);
}

function routeIntersectsPosition(route, position, width = 260, height = 96) {
  const points = routePoints(route);
  return points.slice(1).some((point, index) => {
    const start = points[index];
    const left = position.x;
    const right = left + (Number.isFinite(position.width) ? position.width : width);
    const top = position.y;
    const bottom = top + (Number.isFinite(position.height) ? position.height : height);
    if (start.x === point.x) {
      return start.x > left && start.x < right
        && Math.max(Math.min(start.y, point.y), top) < Math.min(Math.max(start.y, point.y), bottom);
    }
    if (start.y === point.y) {
      return start.y > top && start.y < bottom
        && Math.max(Math.min(start.x, point.x), left) < Math.min(Math.max(start.x, point.x), right);
    }
    return Math.min(start.x, point.x) < right && Math.max(start.x, point.x) > left
      && Math.min(start.y, point.y) < bottom && Math.max(start.y, point.y) > top;
  });
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
  ui.state.includeUnconnectedNodes = true;
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

test("Endpoint 상세 Graph는 실제 FLOW 경로와 Servlet Filter 등록을 끝까지 포함함", () => {
  const { window } = loadUi();
  const graph = detailGraphFixture();
  graph.nodes.push(
    { id: "application-a", type: "APPLICATION", serviceId: "orders", label: "주문 앱", attributes: {}, evidenceIds: [] },
    { id: "servlet-a", type: "SERVLET", serviceId: "orders", label: "DispatcherServlet", attributes: {}, evidenceIds: [] },
    { id: "servlet-filter-a", type: "FILTER", serviceId: "orders", label: "RequestFilter", attributes: { registrationKind: "SERVLET", filterOrder: "1" }, evidenceIds: [] }
  );
  graph.edges.push(
    { id: "app-flow", sourceId: "application-a", targetId: "servlet-a", type: "FLOWS_TO", attributes: {}, confidence: "CONFIRMED", evidenceIds: [] },
    { id: "servlet-flow", sourceId: "servlet-a", targetId: "endpoint-a", type: "FLOWS_TO", attributes: {}, confidence: "CONFIRMED", evidenceIds: [] },
    { id: "endpoint-handler-flow", sourceId: "endpoint-a", targetId: "handler-a", type: "FLOWS_TO", attributes: {}, confidence: "CONFIRMED", evidenceIds: [] },
    { id: "servlet-filter-registration", sourceId: "servlet-a", targetId: "servlet-filter-a", type: "FILTERED_BY", attributes: { registrationKind: "SERVLET", filterOrder: "1" }, confidence: "CONFIRMED", evidenceIds: [] }
  );
  const detail = window.MapInBootFlow.deriveEndpointGraph(window.MapInBootGraph.normalize(graph), "endpoint-a");
  const nodeIds = new Set(detail.nodes.map((node) => node.id));
  const edgeIds = new Set(detail.edges.map((edge) => edge.id));
  assert.deepEqual(["application-a", "servlet-a", "servlet-filter-a", "endpoint-a", "handler-a"].filter((id) => nodeIds.has(id)),
    ["application-a", "servlet-a", "servlet-filter-a", "endpoint-a", "handler-a"]);
  assert.deepEqual(["app-flow", "servlet-flow", "endpoint-handler-flow", "servlet-filter-registration"].filter((id) => edgeIds.has(id)),
    ["app-flow", "servlet-flow", "endpoint-handler-flow", "servlet-filter-registration"]);
  assert.equal(nodeIds.has("endpoint-b"), false);
  assert.equal(edgeIds.has("synthetic-endpoint-handler"), false);
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
  assert.match(textOf(elements.get("inspector")), /보안정보 읽기/);
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
    endpointId: "endpoint-a",
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
  assert.equal(steps.some((step) => step.label.includes("응답 복귀")), false);
  assert.equal(steps.some((step) => step.id === "education-response-return"), false);
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
    endpointId: "endpoint-a",
    positions: {}
  });
  assert.equal(Array.from(uncertainSteps, (step) => step.anchorId).includes("security-filter-1"), false);
  assert.equal(uncertainSteps.some((step) => step.label.includes("순서 확인 불가")), true);

  const unselectedSteps = window.MapInBootRequestFlow.buildSteps({
    graph: uncertainGraph,
    index: window.MapInBootFlow.createIndex(uncertainGraph),
    endpointId: "missing-endpoint",
    positions: {}
  });
  assert.equal(unselectedSteps.some((step) => step.id === "endpoint-mapping"), false);
});

test("Request 교육은 Endpoint가 없거나 여러 개여도 선택 Endpoint 하나만 사용함", () => {
  const { window } = loadUi();
  [0, 1, 5, 16, 50, 60].forEach((count) => {
    const graph = window.MapInBootGraph.normalize(endpointCountGraph(count));
    const endpointId = count > 0 ? `count-endpoint-${count - 1}` : null;
    const steps = window.MapInBootRequestFlow.buildSteps({
      graph,
      index: window.MapInBootFlow.createIndex(graph),
      endpointId,
      positions: {}
    });
    const endpointSteps = steps.filter((step) => step.id === "endpoint-mapping");
    assert.equal(endpointSteps.length, count === 0 ? 0 : 1, `Endpoint ${count}개`);
    if (count > 0) assert.equal(endpointSteps[0].anchorId, endpointId);
    const handlerSteps = steps.filter((step) => step.id === "handler");
    assert.ok(handlerSteps.length <= 1, `Endpoint ${count}개 Handler 단계 수`);
    if (count > 0 && handlerSteps.length > 0) assert.equal(handlerSteps[0].anchorId, `count-handler-${count - 1}`);
  });
});

test("Request 교육 Controller가 Node 점등·Edge 이동·경로 불가·일시정지·재개·완료를 보장함", () => {
  const { window } = loadUi();
  const clock = createFakeClock();
  const updates = [];
  const controller = window.MapInBootRequestFlow.createController({
    clock,
    nodeHoldDuration: 100,
    minimumEdgeDuration: 200,
    maximumEdgeDuration: 200,
    durationPerLength: 1,
    unavailablePathDuration: 50,
    onUpdate: (state) => updates.push(state)
  });
  controller.setSteps([
    { id: "step-a", label: "A", anchorId: "node-a", transition: { kind: "projection", edgeId: "edge-a", length: 100 } },
    { id: "step-b", label: "B", kind: "actual", anchorId: "node-b" },
    { id: "step-c", label: "C", kind: "education", anchorId: "node-c" }
  ]);

  assert.equal(controller.state().status, "idle");
  assert.equal(controller.state().phase, null);
  assert.equal(controller.activeFrameCount(), 0);
  controller.play();
  assert.equal(controller.state().status, "running");
  assert.equal(controller.state().phase, "NODE_HOLD");
  assert.equal(controller.state().step.anchorId, "node-a");
  assert.equal(clock.activeCount(), 1);
  controller.play();
  assert.equal(clock.activeCount(), 1);
  clock.tick(50);
  assert.equal(controller.state().phase, "NODE_HOLD");
  assert.equal(controller.state().progress, 0.5);
  controller.pause();
  assert.equal(controller.state().status, "paused");
  assert.equal(clock.activeCount(), 0);
  const pausedProgress = controller.state().progress;
  clock.tick(100);
  assert.equal(controller.state().progress, pausedProgress);
  controller.play();
  assert.equal(clock.activeCount(), 1);
  clock.tick(50);
  assert.equal(controller.state().phase, "EDGE_TRAVEL");
  assert.equal(controller.state().progress, 0);
  clock.tick(100);
  assert.equal(controller.state().phase, "EDGE_TRAVEL");
  assert.equal(controller.state().progress, 0.5);
  controller.pause();
  assert.equal(clock.activeCount(), 0);
  clock.tick(500);
  assert.equal(controller.state().progress, 0.5);
  controller.play();
  clock.tick(100);
  assert.equal(controller.state().phase, "NODE_HOLD");
  assert.equal(controller.state().step.anchorId, "node-b");
  clock.tick(100);
  assert.equal(controller.state().phase, "PATH_UNAVAILABLE");
  assert.equal(controller.state().nextStep.anchorId, "node-c");
  clock.tick(50);
  assert.equal(controller.state().phase, "NODE_HOLD");
  assert.equal(controller.state().step.anchorId, "node-c");
  clock.tick(100);
  assert.equal(controller.state().status, "complete");
  assert.equal(controller.state().phase, "COMPLETE");
  assert.equal(clock.activeCount(), 0);

  controller.play();
  assert.equal(controller.state().status, "running");
  assert.equal(controller.state().phase, "NODE_HOLD");
  assert.equal(controller.state().step.anchorId, "node-a");
  controller.reset();
  assert.equal(controller.state().status, "idle");
  assert.equal(controller.state().stepIndex, 0);
  assert.equal(controller.state().phase, null);
  assert.equal(clock.activeCount(), 0);
  assert.equal(updates.some((state) => state.status === "complete"), true);
});

test("Request 교육 빛 점은 꺾인 SVG 경로의 실제 좌표를 사용함", () => {
  const { window } = loadUi();
  const path = {
    getTotalLength: () => 100,
    getPointAtLength(distance) {
      return distance <= 50
        ? { x: distance, y: 0 }
        : { x: 50, y: distance - 50 };
    }
  };
  const point = window.MapInBootRequestFlow.pathPointAt(path, 0.75);

  assert.deepEqual({ ...point }, { x: 50, y: 25 });
  assert.deepEqual({ ...window.MapInBootRequestFlow.pathPointAt(path, 0) }, { x: 0, y: 0 });
  assert.deepEqual({ ...window.MapInBootRequestFlow.pathPointAt(path, 1) }, { x: 50, y: 50 });
  assert.equal(window.MapInBootRequestFlow.pathPointAt({}, 0.5), null);
});

test("Request 교육 reduced-motion은 RAF 없이 마지막 단계와 키보드 가능한 상태를 제공함", () => {
  const { window } = loadUi();
  const clock = createFakeClock();
  const controller = window.MapInBootRequestFlow.createController({
    clock,
    reducedMotion: true,
    nodeHoldDuration: 100
  });
  controller.setSteps([
    { id: "step-a", label: "A", kind: "education" },
    { id: "step-b", label: "B", kind: "actual", anchorId: "node-b" }
  ]);
  controller.play();

  assert.equal(controller.state().status, "complete");
  assert.equal(controller.state().stepIndex, 1);
  assert.equal(controller.state().step.anchorId, "node-b");
  assert.equal(controller.state().phase, "NODE_HOLD");
  assert.equal(controller.state().progress, 1);
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
  assert.equal(elements.get("request-flow-dot").hasAttribute("hidden"), true);
  ui.requestFlow.play();
  assert.equal(elements.get("request-flow-dot").hasAttribute("hidden"), true);
  assert.equal(findAllByClass(elements.get("graph-nodes"), "graph-node")
    .find((node) => node.getAttribute("data-node-id") === "endpoint-a")
    .getAttribute("data-request-flow-active"), "true");
  ui.requestFlow.setSteps([]);
  assert.equal(elements.get("request-flow-dot").hasAttribute("hidden"), true);
  assert.equal(findAllByClass(elements.get("graph-nodes"), "graph-node")
    .find((node) => node.getAttribute("data-node-id") === "endpoint-a")
    .getAttribute("data-request-flow-active"), null);
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

test("Request 교육은 SVG Edge 경로를 따라 점을 이동하고 실제·교육 Node를 짧게 점등함", async () => {
  const animationClock = createFakeClock();
  const { ui, elements } = loadUi({ animationClock });
  ui.renderGraph(detailGraphFixture());
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();

  const steps = ui.state.requestFlowSteps;
  const first = steps[0];
  const target = steps[1];
  assert.equal(first.anchorId, "education-http-request");
  assert.equal(first.transition.kind, "projection");
  assert.equal(first.transition.sourceId, first.anchorId);
  assert.equal(first.transition.targetId, target.anchorId);
  const path = elements.get("graph-flow-projection").children.find((element) =>
    element.tagName === "path" && element.getAttribute("data-projection-edge-id") === first.transition.edgeId);
  assert.ok(path);
  path.getTotalLength = () => 100;
  path.getPointAtLength = (distance) => distance <= 50
    ? { x: distance, y: 0 }
    : { x: 50, y: distance - 50 };
  const source = findAllByClass(elements.get("graph-flow-projection"), "graph-projection-node")
    .find((node) => node.getAttribute("data-projection-id") === first.anchorId);
  const destination = findAllByClass(elements.get("graph-flow-projection"), "graph-projection-node")
    .find((node) => node.getAttribute("data-projection-id") === target.anchorId);
  assert.ok(source && destination);

  ui.requestFlow.play();
  assert.equal(source.getAttribute("data-request-flow-active"), "true");
  assert.equal(elements.get("request-flow-dot").hasAttribute("hidden"), true);
  animationClock.tick(280);
  assert.equal(ui.requestFlow.state().phase, "EDGE_TRAVEL");
  assert.equal(source.getAttribute("data-request-flow-active"), null);
  assert.equal(elements.get("request-flow-dot").hasAttribute("hidden"), false);
  assert.equal(elements.get("request-flow-dot").getAttribute("cx"), "0");
  assert.equal(elements.get("request-flow-dot").getAttribute("cy"), "0");
  animationClock.tick(225);
  assert.equal(elements.get("request-flow-dot").getAttribute("cx"), "50");
  assert.equal(elements.get("request-flow-dot").getAttribute("cy"), "0");
  ui.requestFlow.pause();
  const paused = {
    progress: ui.requestFlow.state().progress,
    x: elements.get("request-flow-dot").getAttribute("cx"),
    y: elements.get("request-flow-dot").getAttribute("cy")
  };
  animationClock.tick(300);
  assert.equal(ui.requestFlow.state().progress, paused.progress);
  assert.equal(elements.get("request-flow-dot").getAttribute("cx"), paused.x);
  assert.equal(elements.get("request-flow-dot").getAttribute("cy"), paused.y);
  ui.requestFlow.play();
  animationClock.tick(225);
  assert.equal(ui.requestFlow.state().phase, "NODE_HOLD");
  assert.equal(ui.requestFlow.state().step.anchorId, target.anchorId);
  assert.equal(elements.get("request-flow-dot").hasAttribute("hidden"), true);
  assert.equal(destination.getAttribute("data-request-flow-active"), "true");

  ui.requestFlow.reset();
  assert.equal(destination.getAttribute("data-request-flow-active"), null);
  assert.equal(elements.get("request-flow-dot").hasAttribute("hidden"), true);
  ui.requestFlow.setSteps([{ id: "actual-endpoint", label: "Endpoint", kind: "actual", anchorId: "endpoint-a" }]);
  ui.requestFlow.play();
  const actualNode = findAllByClass(elements.get("graph-nodes"), "graph-node")
    .find((node) => node.getAttribute("data-node-id") === "endpoint-a");
  assert.equal(actualNode.getAttribute("data-request-flow-active"), "true");
  ui.requestFlow.reset();
  assert.equal(actualNode.getAttribute("data-request-flow-active"), null);
  assert.equal(animationClock.activeCount(), 0);
});

test("Request Flow는 HTMLCollection형 SVG Projection children에서 실제 경로를 찾음", async () => {
  const animationClock = createFakeClock();
  const { ui, elements } = loadUi({ animationClock });
  ui.renderGraph(detailGraphFixture());
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();

  const first = ui.state.requestFlowSteps[0];
  assert.equal(first.transition.kind, "projection");
  const projectionLayer = elements.get("graph-flow-projection");
  const path = projectionLayer.children.find((element) =>
    element.getAttribute("data-projection-edge-id") === first.transition.edgeId);
  assert.ok(path);
  path.getTotalLength = () => 100;
  path.getPointAtLength = (distance) => ({ x: distance, y: 31 });

  const children = useHtmlCollectionChildren(projectionLayer);
  assert.equal(children.length > 0, true);
  assert.equal(children.item(0), projectionLayer.children[0]);
  assert.equal(Array.from(children).length, children.length);
  assert.equal(typeof children.forEach, "undefined");
  assert.equal(typeof children.find, "undefined");
  assert.equal(typeof children.map, "undefined");
  assert.equal(typeof children.filter, "undefined");

  ui.requestFlow.play();
  assert.doesNotThrow(() => animationClock.tick(280));
  assert.equal(ui.requestFlow.state().phase, "EDGE_TRAVEL");
  assert.equal(elements.get("request-flow-dot").hidden, false);
  assert.equal(elements.get("request-flow-dot").getAttribute("cx"), "0");
  assert.equal(elements.get("request-flow-dot").getAttribute("cy"), "31");
});

test("Request Flow는 HTMLCollection형 Graph Edge의 묶인 원본 ID를 찾고 없는 경로를 건너뜀", async () => {
  const animationClock = createFakeClock();
  const { ui, elements } = loadUi({ animationClock });
  ui.renderGraph(detailGraphFixture());
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();

  const edgeLayer = elements.get("graph-edges");
  const edgePath = edgeLayer.children.find((element) =>
    element.getAttribute("data-edge-id") === "match-a");
  assert.ok(edgePath);
  edgePath.setAttribute("data-edge-ids", "match-a,match-a-bundle");
  edgePath.getTotalLength = () => 100;
  edgePath.getPointAtLength = (distance) => ({ x: 70, y: distance });
  useHtmlCollectionChildren(edgeLayer);

  ui.requestFlow.setSteps([
    { id: "endpoint", label: "API", kind: "actual", anchorId: "endpoint-a", transition: {
      kind: "actual", edgeId: "match-a-bundle", sourceId: "endpoint-a", targetId: "chain-a", length: 100
    } },
    { id: "chain", label: "Chain", kind: "actual", anchorId: "chain-a" }
  ]);
  ui.requestFlow.play();
  assert.doesNotThrow(() => animationClock.tick(280));
  assert.equal(elements.get("request-flow-dot").getAttribute("cx"), "70");
  assert.equal(elements.get("request-flow-dot").getAttribute("cy"), "0");

  ui.requestFlow.setSteps([
    { id: "endpoint", label: "API", kind: "actual", anchorId: "endpoint-a", transition: {
      kind: "actual", edgeId: "missing-edge", sourceId: "endpoint-a", targetId: "chain-a", length: 100
    } },
    { id: "chain", label: "Chain", kind: "actual", anchorId: "chain-a" }
  ]);
  ui.requestFlow.play();
  assert.doesNotThrow(() => animationClock.tick(280));
  assert.match(elements.get("request-flow-status").textContent, /경로 확인 불가/);
});

test("ELK 성공 후 Request Flow 준비 실패는 Graph 배치 성공을 유지함", async () => {
  const { ui, elements, window } = loadUi();
  ui.renderGraph(detailGraphFixture());
  window.MapInBootRequestFlow.buildSteps = () => { throw new Error("flow prepare failed"); };
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();

  assert.equal(ui.state.layoutState, "loaded");
  assert.equal(elements.get("graph-canvas").dataset.layoutState, "loaded");
  assert.ok(ui.state.layout);
  assert.ok(ui.state.visibleGraph.nodes.length > 0);
  assert.match(elements.get("shell-notice").textContent, /교육용 흐름 준비 실패/);
  assert.doesNotMatch(elements.get("shell-notice").textContent, /Graph 자동 배치 실패/);
});

test("Graph 렌더 실패는 ELK 배치 실패로 분류하지 않고 성공 Layout을 보존함", async () => {
  const { ui, elements, window } = loadUi();
  ui.renderGraph(detailGraphFixture());
  window.MapInBootGraph.render = () => { throw new Error("svg render failed"); };

  await ui.layoutGraph();

  assert.equal(ui.state.layoutState, "loaded");
  assert.equal(elements.get("graph-canvas").dataset.layoutState, "loaded");
  assert.ok(ui.state.layout);
  assert.match(elements.get("shell-notice").textContent, /Graph 표시 실패/);
  assert.doesNotMatch(elements.get("shell-notice").textContent, /Graph 자동 배치 실패/);
});

test("ELK Layout Cache Hit 뒤 Request Flow 준비 실패도 Layout 성공을 유지함", async () => {
  const { ui, elements, window } = loadUi();
  ui.renderGraph(detailGraphFixture());
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();
  const cachedLayout = ui.state.layout;
  assert.ok(cachedLayout);
  assert.ok(ui.state.layoutCache.size > 0);

  window.MapInBootRequestFlow.buildSteps = () => { throw new Error("cached flow prepare failed"); };
  await assert.doesNotReject(() => ui.layoutGraph());

  assert.strictEqual(ui.state.layout, cachedLayout);
  assert.equal(ui.state.layoutState, "loaded");
  assert.match(elements.get("shell-notice").textContent, /교육용 흐름 준비 실패/);
  assert.doesNotMatch(elements.get("shell-notice").textContent, /Graph 자동 배치 실패/);
});

test("Request Flow Edge 이동 중 Inspector를 닫아도 재생과 경로 이동을 유지함", async () => {
  const animationClock = createFakeClock();
  const { ui, elements } = loadUi({ animationClock });
  ui.renderGraph(detailGraphFixture());
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();

  const transition = ui.state.requestFlowSteps[0].transition;
  assert.equal(transition.kind, "projection");
  const path = elements.get("graph-flow-projection").children.find((element) =>
    element.tagName === "path" && element.getAttribute("data-projection-edge-id") === transition.edgeId);
  assert.ok(path);
  path.getTotalLength = () => 100;
  path.getPointAtLength = (distance) => ({ x: distance, y: 12 });
  transition.length = 100;

  ui.requestFlow.play();
  animationClock.tick(280);
  animationClock.tick(100);
  assert.equal(ui.requestFlow.state().phase, "EDGE_TRAVEL");
  assert.equal(ui.requestFlow.state().status, "running");
  const previousProgress = ui.requestFlow.state().progress;
  const previousX = elements.get("request-flow-dot").getAttribute("cx");

  ui.selectGraphElement("node", "endpoint-a");
  const close = findAllByClass(elements.get("inspector"), "inspector-close")[0];
  assert.doesNotThrow(() => close.dispatchEvent({ type: "click" }));
  assert.equal(elements.get("inspector").hidden, true);
  assert.equal(elements.get("inspector").attributes["aria-hidden"], "true");
  assert.equal(ui.requestFlow.state().phase, "EDGE_TRAVEL");
  assert.equal(ui.requestFlow.state().status, "running");

  animationClock.tick(100);
  assert.equal(ui.requestFlow.state().status, "running");
  assert.ok(ui.requestFlow.state().progress > previousProgress);
  assert.notEqual(elements.get("request-flow-dot").getAttribute("cx"), previousX);
  assert.equal(ui.state.layoutState, "loaded");
});

test("실제 ELK Layout 거부는 자동 배치 실패로 표시함", async () => {
  const { ui, layoutApi, elements } = loadUi();
  ui.renderGraph(detailGraphFixture());
  layoutApi.layout = () => Promise.reject(new Error("ELK worker failed"));

  await ui.layoutGraph();

  assert.equal(ui.state.layoutState, "failed");
  assert.equal(elements.get("graph-canvas").dataset.layoutState, "failed");
  assert.equal(ui.state.layoutError, "ELK worker failed");
  assert.match(elements.get("shell-notice").textContent, /Graph 자동 배치 실패: ELK worker failed/);
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
  assert.deepEqual(Array.from(index.securityFiltersForChain("chain-a").filters, (item) => item.id), [
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
  ui.state.includeUnconnectedNodes = true;
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
  graph.findings = [{ id: "identity-finding", ruleId: "CHAIN_ORDER", title: "Identity 판단", confidence: "UNKNOWN", nodeIds: ["endpoint-a"], edgeIds: [], evidenceIds: [] }];

  ui.renderGraph(graph);
  await ui.layoutGraph();
  assert.equal(ui.state.visibleGraph.nodes.length, 103);
  assert.equal(elements.get("graph-minimap-nodes").children.length,
    ui.state.graphRender.displayNodes.length + ui.state.layout.plan.projection.nodes.length);
  assert.equal(layoutCalls.length, 1);
  assert.equal(layoutCalls[0].children.length, 103);
  assert.equal(layoutCalls[0].edges.length, 83);

  ui.selectView("security-flow");
  await ui.layoutGraph();
  assert.equal(layoutCalls.length, 1);
  const mapLayoutCalls = layoutCalls.length;
  elements.get("finding-confidence").value = "CONFIRMED";
  elements.get("finding-confidence").dispatchEvent({ type: "change" });
  assert.equal(layoutCalls.length, mapLayoutCalls);
  assert.equal(ui.state.visibleGraph.nodes.length, 103);
  assert.equal(ui.state.visibleGraph.edges.length, 83);
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
  snapshot.nodes[0].attributes = {
    applicationClass: "com.example.orders.OrderApplication",
    applicationVersion: "1.2.0"
  };
  snapshot.nodes[1].attributes = { servletName: "dispatcherServlet", servletKind: "DISPATCHER", urlPattern: "/" };
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
    proxyBeanName: "springSecurityFilterChain",
    matcherCondition: "NOT(GET /api/legacy/account-summary/{accountId})"
  };
  snapshot.nodes[5].attributes = {
    registrationKind: "SECURITY",
    filterClass: "org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter",
    filterOrder: "8"
  };
  snapshot.nodes[6].attributes = { authenticationKind: "JWT", provider: "org.springframework.security.authentication.dao.DaoAuthenticationProvider" };
  snapshot.nodes[7].attributes = { policyKind: "AUTHORITY_REQUIRED", requiredAuthority: "ROLE_BANK_ADMIN" };
  snapshot.nodes[8].attributes = { dataKind: "JWT_CLAIM", claimName: "sub", operation: "READ" };

  ui.renderGraph(snapshot);

  const nodeTexts = Array.from(elements.get("graph-nodes").children, textOf);
  const firstNodeCard = findAllByClass(elements.get("graph-nodes").children[0], "graph-node-card")[0];
  assert.equal(firstNodeCard.attributes.width, "260");
  assert.equal(firstNodeCard.attributes.height, "96");
  assert.equal(firstNodeCard.attributes.rx, "7");
  assert.match(nodeTexts[0], /애플리케이션/);
  assert.match(nodeTexts[0], /OrderApplication/);
  assert.match(nodeTexts[0], /서비스 ID orders/);
  assert.match(nodeTexts[1], /서블릿/);
  assert.match(nodeTexts[1], /dispatcherServlet/);
  assert.match(nodeTexts[1], /DISPATCHER · \/?/);
  assert.match(nodeTexts[2], /API/);
  assert.match(nodeTexts[2], /GET \/mapinboot\/api\/status/);
  assert.match(nodeTexts[2], /StatusController#status\(\)/);
  assert.doesNotMatch(nodeTexts[2], /com\.mapinboot/);
  assert.match(nodeTexts[3], /핸들러/);
  assert.match(nodeTexts[3], /StatusController/);
  assert.match(nodeTexts[3], /status\(\)/);
  const handlerDisplay = window.MapInBootGraph.nodeDisplay(snapshot.nodes[3]);
  assert.equal(handlerDisplay.primary, "status()");
  assert.equal(handlerDisplay.detail, "StatusController");
  assert.match(nodeTexts[4], /보안 체인/);
  assert.match(window.MapInBootGraph.nodeDisplay(snapshot.nodes[4]).primary, /^제외 · GET \/api\/legacy\/account-summary/);
  assert.match(nodeTexts[4], /springSecurityFilterChain/);
  assert.match(nodeTexts[5], /필터/);
  assert.match(nodeTexts[5], /Bearer Token Authentication Filter/);
  assert.doesNotMatch(nodeTexts[5], /org\.springframework/);
  assert.match(nodeTexts[6], /JWT/);
  assert.match(nodeTexts[6], /DaoAuthenticationProvider/);
  assert.match(nodeTexts[7], /권한 필요/);
  assert.match(nodeTexts[7], /ROLE_BANK_ADMIN/);
  assert.match(nodeTexts[8], /JWT Claim/);
  assert.match(nodeTexts[8], /sub/);
  assert.match(nodeTexts[8], /조회/);

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

test("Node 카드는 간결한 Handler를 보이고 Inspector는 전체 FQCN 원문을 보존함", () => {
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  const handler = "org.example.account.AccountController#load(java.lang.String)";
  snapshot.nodes[2].attributes.handler = handler;
  ui.renderGraph(snapshot);

  const node = findAllByClass(elements.get("graph-nodes"), "graph-node")
    .find((item) => item.getAttribute("data-node-id") === "node-2");
  assert.match(textOf(node), /AccountController#load\(\)/);
  ui.selectGraphElement("node", "node-2");
  assert.ok(textOf(elements.get("inspector")).includes(handler));
});

test("Endpoint 경로는 HTTP Method와 경로를 두 줄로 배치하고 Inspector 원문을 보존함", () => {
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  const path = "/api/financial-accounts/{accountId}/transactions";
  snapshot.nodes[2].attributes = { httpMethod: "GET", path, handler: "org.example.AccountController#transactions()" };
  ui.renderGraph(snapshot);

  const endpoint = elements.get("graph-nodes").children[2];
  const lines = endpoint.children.filter((child) => child.attributes.class === "graph-node-label");
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((line) => line.textContent), ["GET /api/financial-accounts", "/{accountId}/transactions"]);
  assert.match(lines[0].textContent, /^GET \/api/);
  assert.match(lines[1].textContent, /\{accountId\}/);

  ui.selectGraphElement("node", "node-2");
  assert.ok(textOf(elements.get("inspector")).includes(path));

  const extendedPath = `${path}/ledger/entries`;
  snapshot.nodes[2].attributes.path = extendedPath;
  ui.renderGraph(snapshot);
  const extendedLines = elements.get("graph-nodes").children[2].children
    .filter((child) => child.attributes.class === "graph-node-label");
  assert.equal(extendedLines.length, 2);
  assert.match(extendedLines[1].textContent, /…$/);
  ui.selectGraphElement("node", "node-2");
  assert.ok(textOf(elements.get("inspector")).includes(extendedPath));
});

test("겹치는 Edge 라벨은 선택·Hover해도 Node 위에 강제 표시하지 않음", () => {
  const { window, elements } = loadUi();
  const snapshot = graphFixture();
  snapshot.nodes = [
    { id: "source", type: "ENDPOINT", label: "GET /orders", attributes: { httpMethod: "GET", path: "/orders" }, evidenceIds: [] },
    { id: "target", type: "AUTHORIZATION", label: "인가 정책", attributes: { policyKind: "AUTHENTICATED" }, evidenceIds: [] },
    { id: "blocker", type: "SECURITY_DATA", label: "보안 정보", attributes: { dataType: "JWT" }, evidenceIds: [] }
  ];
  snapshot.edges = [{ id: "secured-edge", sourceId: "source", targetId: "target", type: "SECURED_BY", confidence: "CONFIRMED", evidenceIds: [] }];
  snapshot.findings = [];
  const graph = window.MapInBootGraph.normalize(snapshot);
  const layers = {
    svg: elements.get("graph-svg"),
    viewport: elements.get("graph-viewport"),
    areaLayer: elements.get("graph-areas"),
    projectionLayer: elements.get("graph-flow-projection"),
    guideLayer: elements.get("graph-guides"),
    edgeLayer: elements.get("graph-edges"),
    nodeLayer: elements.get("graph-nodes"),
    findingLayer: elements.get("graph-finding-sections"),
    findingTitleLayer: elements.get("graph-finding-section-titles")
  };
  const positions = { source: { x: 0, y: 0 }, target: { x: 400, y: 0 }, blocker: { x: 300, y: 0 } };
  let clickedEdgeId = "";
  const render = (selection = null) => window.MapInBootGraph.render(graph, layers, {
    positions,
    selection,
    related: { nodeIds: new Set(["source", "target", "blocker"]), edgeIds: new Set(["secured-edge"]) },
    onEdgeClick: (id) => { clickedEdgeId = id; }
  });

  render();
  const edge = findAllByClass(elements.get("graph-edges"), "graph-edge")[0];
  const label = findAllByClass(elements.get("graph-edges"), "graph-edge-label")[0];
  assert.ok(edge);
  assert.equal(label.attributes["data-collision"], "true");
  edge.dispatchEvent({ type: "mouseenter" });
  assert.equal(label.attributes["data-visible"], "false");

  render({ kind: "edge", id: "secured-edge" });
  const selectedLabel = findAllByClass(elements.get("graph-edges"), "graph-edge-label")[0];
  assert.equal(selectedLabel.attributes["data-collision"], "true");
  assert.equal(selectedLabel.attributes["data-visible"], "false");
  const selectedPath = findAllByClass(elements.get("graph-edges"), "graph-edge")[0];
  assert.ok(selectedPath.attributes.d);
  assert.equal(findAllByClass(elements.get("graph-edges"), "graph-edge").length, 1);
  selectedPath.dispatchEvent({ type: "click" });
  assert.equal(clickedEdgeId, "secured-edge");
});

test("같은 구간의 선택·Hover Edge 라벨은 서로 겹치지 않는 후보에 배치함", () => {
  const { window, elements } = loadUi();
  const snapshot = graphFixture();
  snapshot.nodes = [
    { id: "source", type: "HANDLER", label: "Controller#load", attributes: { handler: "Controller#load" }, evidenceIds: [] },
    { id: "target", type: "SECURITY_DATA", label: "JWT", attributes: { dataKind: "JWT" }, evidenceIds: [] }
  ];
  snapshot.edges = [
    { id: "secured-edge", sourceId: "source", targetId: "target", type: "SECURED_BY", attributes: {}, confidence: "CONFIRMED", evidenceIds: [] },
    { id: "reads-edge", sourceId: "source", targetId: "target", type: "READS_SECURITY_DATA", attributes: {}, confidence: "CONFIRMED", evidenceIds: [] }
  ];
  snapshot.findings = [];
  const graph = window.MapInBootGraph.normalize(snapshot);
  const layers = {
    svg: elements.get("graph-svg"), viewport: elements.get("graph-viewport"),
    areaLayer: elements.get("graph-areas"), projectionLayer: elements.get("graph-flow-projection"),
    guideLayer: elements.get("graph-guides"), edgeLayer: elements.get("graph-edges"),
    nodeLayer: elements.get("graph-nodes"), findingLayer: elements.get("graph-finding-sections"),
    findingTitleLayer: elements.get("graph-finding-section-titles")
  };
  window.MapInBootGraph.render(graph, layers, {
    positions: { source: { x: 0, y: 0 }, target: { x: 500, y: 0 } },
    selection: { kind: "edge", id: "secured-edge" },
    hoverEdgeId: "reads-edge"
  });

  const labels = findAllByClass(elements.get("graph-edges"), "graph-edge-label");
  const selected = labels.find((label) => label.attributes["data-edge-id"] === "secured-edge");
  const hovered = labels.find((label) => label.attributes["data-edge-id"] === "reads-edge");
  assert.equal(selected.attributes["data-visible"], "true");
  assert.equal(hovered.attributes["data-visible"], "true");
  assert.equal(selected.attributes["data-collision"], "false");
  assert.equal(hovered.attributes["data-collision"], "false");
  assert.ok(Math.abs(Number(selected.attributes.y) - Number(hovered.attributes.y)) >= 18);
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
  ui.state.includeUnconnectedNodes = true;
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
  ui.state.includeUnconnectedNodes = true;
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
      "education-handler-adapter"
    ].join("|")
  );
  assert.equal(projection.nodes.some((node) => node.id === "education-response-return"), false);
  assert.equal(projection.edges.some((edge) => edge.id.startsWith("handler-to-response-")), false);
  const graphNodeIds = new Set([
    ...ui.state.graph.nodes.map((node) => node.id),
    ...projection.nodes.map((node) => node.id)
  ]);
  assert.equal(projection.edges.every((edge) => graphNodeIds.has(edge.sourceId) && graphNodeIds.has(edge.targetId)), true);
  const projectionBounds = projection.nodes.map((node) => node.bounds);
  assert.equal(ui.state.layout.plan.educationArea.left, Math.min(...projectionBounds.map((bounds) => bounds.left)) - 24);
  assert.equal(ui.state.layout.plan.educationArea.top, Math.min(...projectionBounds.map((bounds) => bounds.top)) - 48);
  assert.equal(ui.state.layout.plan.educationArea.right, Math.max(...projectionBounds.map((bounds) => bounds.right)) + 24);
  assert.equal(ui.state.layout.plan.educationArea.bottom, Math.max(...projectionBounds.map((bounds) => bounds.bottom)) + 32);
  assert.match(projection.nodes.find((node) => node.id === "education-request-matcher").detail, /체인 1.*체인 2.*체인 3/);
  assert.ok(projection.edges.length > 0);
  assert.equal(projection.edges.some((edge) => edge.dataEdgeId), false);
  assert.equal(elements.get("graph-flow-projection").children.length > 0, true);
  assert.equal(findAllByClass(elements.get("graph-minimap-nodes"), "graph-minimap-node")
    .some((node) => node.getAttribute("data-node-id") === "education-response-return"), false);
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
  ui.state.includeUnconnectedNodes = true;
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

test("Graph 전처리 Worker는 Snapshot별 Graph를 한 번 보내고 작업 식별자를 유지함", async () => {
  const { ui, layoutApi, window } = loadUi();
  const snapshot = detailGraphFixture();
  const threshold = layoutApi.preprocessThreshold;
  snapshot.nodes.push(...Array.from({ length: threshold - snapshot.nodes.length }, (_value, index) => ({
    id: `unconnected-${index}`, type: "APPLICATION", serviceId: "orders", label: `Application ${index}`, attributes: {}, evidenceIds: []
  })));
  const graph = ui.normalizeGraph(snapshot);
  const messages = [];
  const snapshots = new Map();
  class Worker {
    postMessage(message) {
      messages.push(message);
      if (message.type === "snapshot") {
        snapshots.set(message.generation, message.graph);
        return;
      }
      if (message.type !== "prepare") return;
      const result = layoutApi.prepareGraphData(snapshots.get(message.generation), message.task, message.endpointId);
      queueMicrotask(() => this.onmessage({ data: {
        type: "prepared", requestId: message.requestId, generation: message.generation,
        viewKey: message.viewKey, task: message.task, result
      } }));
    }
    terminate() {}
  }
  window.Worker = Worker;
  const client = layoutApi.createClient();
  const connectedRequest = client.prepareGraph(graph, 11, "11|all-flow||false", "connectedGraph");
  const endpointRequest = client.prepareGraph(graph, 11, "11|security-detail|endpoint-a|false", "endpointGraph", "endpoint-a");
  const [connected, endpoint] = await Promise.all([connectedRequest, endpointRequest]);

  assert.equal(messages.filter((message) => message.type === "snapshot").length, 1);
  assert.deepEqual(messages.filter((message) => message.type === "prepare").map(({ generation, viewKey, task }) => ({ generation, viewKey, task })), [
    { generation: 11, viewKey: "11|all-flow||false", task: "connectedGraph" },
    { generation: 11, viewKey: "11|security-detail|endpoint-a|false", task: "endpointGraph" }
  ]);
  assert.deepEqual(Array.from(connected.nodeIds), Array.from(layoutApi.prepareGraphData(graph, "connectedGraph").nodeIds));
  assert.deepEqual(Array.from(endpoint.nodeIds), Array.from(layoutApi.prepareGraphData(graph, "endpointGraph", "endpoint-a").nodeIds));
  assert.equal(connected.fallback, false);
  assert.equal(endpoint.fallback, false);
  client.terminate();
});

test("Graph 전처리 Worker 오류는 동기 계산으로 복구하고 재시작하지 않음", async () => {
  const { ui, layoutApi, window } = loadUi();
  const snapshot = detailGraphFixture();
  snapshot.nodes.push(...Array.from({ length: layoutApi.preprocessThreshold - snapshot.nodes.length }, (_value, index) => ({
    id: `unconnected-${index}`, type: "APPLICATION", serviceId: "orders", label: `Application ${index}`, attributes: {}, evidenceIds: []
  })));
  const graph = ui.normalizeGraph(snapshot);
  let workerCount = 0;
  let worker;
  class Worker {
    constructor() { workerCount += 1; worker = this; }
    postMessage(message) {
      if (message.type !== "prepare") return;
      queueMicrotask(() => this.onmessage({ data: {
        type: "prepared", requestId: message.requestId, generation: message.generation,
        viewKey: message.viewKey, task: message.task, error: "preprocess failed"
      } }));
    }
    terminate() { this.terminated = true; }
  }
  window.Worker = Worker;
  const client = layoutApi.createClient();
  const result = await client.prepareGraph(graph, 12, "12|all-flow||false", "connectedGraph");
  const expected = layoutApi.prepareGraphData(graph, "connectedGraph");
  assert.equal(result.fallback, true);
  assert.deepEqual(Array.from(result.nodeIds), Array.from(expected.nodeIds));
  assert.equal(worker.terminated, true);
  const second = await client.prepareGraph(graph, 12, "12|all-flow||true", "connectedGraph");
  assert.equal(second.fallback, true);
  assert.equal(workerCount, 1);
  client.terminate();
});

test("큰 Graph 전처리의 늦은 응답은 전환한 View를 덮지 않음", async () => {
  const { ui, layoutApi, window } = loadUi();
  const snapshot = detailGraphFixture();
  snapshot.nodes.push(...Array.from({ length: layoutApi.preprocessThreshold - snapshot.nodes.length }, (_value, index) => ({
    id: `unconnected-${index}`, type: "APPLICATION", serviceId: "orders", label: `Application ${index}`, attributes: {}, evidenceIds: []
  })));
  const messages = [];
  let worker;
  class Worker {
    constructor() { worker = this; }
    postMessage(message) { messages.push(message); }
    terminate() {}
  }
  window.Worker = Worker;
  ui.renderGraph(snapshot);
  const pending = messages.find((message) => message.type === "prepare");
  assert.ok(pending, JSON.stringify({ nodeCount: ui.state.graph.nodes.length, threshold: layoutApi.preprocessThreshold,
    view: ui.state.view, messages: messages.map((message) => message.type || "layout") }));
  assert.equal(ui.state.viewGraph, null);
  ui.selectView("security-detail");
  const savedSnapshot = messages.find((message) => message.type === "snapshot").graph;
  const result = layoutApi.prepareGraphData(savedSnapshot, pending.task, pending.endpointId);
  worker.onmessage({ data: {
    type: "prepared", requestId: pending.requestId, generation: pending.generation,
    viewKey: pending.viewKey, task: pending.task, result
  } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.state.view, "security-detail");
  assert.equal(ui.state.viewGraph, null);
  assert.equal(ui.state.preparingViewKey, null);
});

test("같은 Snapshot 식별자의 재수신은 새 세대로 취급하고 이전 배치 캐시를 비움", () => {
  const { ui } = loadUi();
  const snapshot = { ...detailGraphFixture(), snapshotId: "same-snapshot" };
  ui.renderGraph(snapshot);
  const previousViewGraph = ui.state.viewGraph;
  const previousGeneration = ui.state.snapshotGeneration;
  ui.state.layoutCache.set("stale-layout", {});
  ui.renderGraph({ ...snapshot });

  assert.equal(ui.state.snapshotGeneration, previousGeneration + 1);
  assert.notEqual(ui.state.viewGraph, previousViewGraph);
  assert.equal(ui.state.viewGraphCache.size, 1);
  assert.equal(ui.state.layoutCache.size, 0);
});

test("View Graph와 ELK 배치 캐시의 최대 보관량을 지킴", async () => {
  const { ui } = loadUi();
  const base = graphFixture();
  const snapshot = { ...base, nodes: base.nodes.slice(), edges: base.edges.slice(), findings: [] };
  for (let index = 0; index < 14; index += 1) {
    const endpointId = `cache-endpoint-${index}`;
    snapshot.nodes.push({ id: endpointId, type: "ENDPOINT", serviceId: "orders", label: `GET /cache/${index}`,
      attributes: { httpMethod: "GET", path: `/cache/${index}` }, evidenceIds: [] });
    snapshot.findings.push({ id: `cache-finding-${index}`, ruleId: "PUBLIC_ENDPOINT", title: `Finding ${index}`,
      confidence: "CONFIRMED", nodeIds: [endpointId], edgeIds: [], evidenceIds: [] });
  }
  ui.renderGraph(snapshot);
  for (let index = 0; index < 14; index += 1) {
    ui.state.selectedFindingId = `cache-finding-${index}`;
    ui.selectView("security-detail");
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(ui.state.viewGraphCache.size, 12);
  assert.equal(ui.state.layoutCache.size, 8);
});

test("새 배치 요청은 이전 결과를 stale로 무시하고 같은 Worker를 재사용함", async () => {
  const { ui, layoutApi, window } = loadUi();
  const graph = ui.normalizeGraph(detailGraphFixture());
  const workers = [];
  class Elk {
    layout() { return Promise.resolve({ children: graph.nodes.map((node) => ({ id: node.id, x: 0, y: 0 })),
      edges: graph.edges.map((edge) => ({ id: edge.id, sections: [] })) }); }
  }
  window.Worker = class {
    constructor() { this.messages = []; workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
  };
  const client = layoutApi.createClient(Elk);
  const first = client.layout(graph);
  await Promise.resolve();
  const second = client.layout(graph);
  await Promise.resolve();
  assert.equal(workers.length, 1);
  assert.equal(workers[0].terminated, undefined);
  assert.equal(workers[0].messages.length, 2);
  workers[0].onmessage({ data: { requestId: workers[0].messages[0].requestId, layout: { obsolete: true } } });
  const current = workers[0];
  current.onmessage({ data: { requestId: current.messages[1].requestId,
    layout: layoutApi.semanticLayout(current.messages[1].graph, current.messages[1].elkLayout) } });
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

test("화면 고정은 활성 이동이 없어도 브라우저 포인터 예외 없이 전환됨", () => {
  const { ui, elements } = loadUi();
  const graphCanvas = elements.get("graph-canvas");
  graphCanvas.releasePointerCapture = (pointerId) => {
    if (!graphCanvas.pointerCaptures.has(pointerId)) {
      const error = new Error("NotFoundError: No active pointer with the given id is found.");
      error.name = "NotFoundError";
      throw error;
    }
    graphCanvas.pointerCaptures.delete(pointerId);
  };

  assert.doesNotThrow(() => elements.get("screen-lock-toggle").dispatchEvent({ type: "click" }));
  assert.equal(ui.navigation.state.locked, true);
  assert.equal(elements.get("screen-lock-toggle").getAttribute("aria-pressed"), "true");
});

test("화면 고정 중 Finding Marker 선택은 Modal을 열고 잠금을 유지함", async () => {
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  snapshot.findings = [{
    id: "finding-1", ruleId: "CHAIN_ORDER", title: "실제 참조 Finding", description: "검토 이유",
    confidence: "UNKNOWN", nodeIds: [], edgeIds: ["edge-3"], evidenceIds: ["evidence-3"], guide: "검토 가이드"
  }];
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");
  await ui.layoutGraph();
  ui.navigation.setLocked(true);

  const marker = findAllByClass(elements.get("graph-edges"), "finding-marker")[0];
  assert.ok(marker);
  marker.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selectedFindingId, "finding-1");
  assert.equal(elements.get("finding-modal").hidden, false);
  assert.equal(ui.navigation.state.locked, true);

  elements.get("finding-modal-close").dispatchEvent({ type: "click" });
  assert.equal(elements.get("finding-modal").hidden, true);
  assert.equal(ui.navigation.state.locked, true);
});

test("화면 고정은 모든 사용자 Pan·Zoom 우회 경로를 막고 선택·필터를 유지함", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(graphFixture());
  await ui.layoutGraph();
  const navigation = ui.navigation;
  const lockToggle = elements.get("screen-lock-toggle");
  const viewport = navigation.state;

  assert.equal(viewport.locked, false);
  assert.equal(lockToggle.getAttribute("aria-pressed"), "false");
  assert.equal(lockToggle.getAttribute("data-tooltip"), "화면 이동과 확대·축소 고정");
  elements.get("graph-canvas").dispatchEvent({ type: "pointerdown", pointerId: 6, target: elements.get("graph-canvas") });
  assert.equal(viewport.dragging, true);
  assert.equal(elements.get("graph-canvas").pointerCaptures.has(6), true);
  lockToggle.dispatchEvent({ type: "click" });
  assert.equal(viewport.locked, true);
  assert.equal(viewport.dragging, false);
  assert.equal(elements.get("graph-canvas").pointerCaptures.has(6), false);
  assert.equal(lockToggle.getAttribute("aria-pressed"), "true");
  assert.equal(lockToggle.getAttribute("data-tooltip"), "화면 고정 해제");
  ["zoom-in", "zoom-out", "fit-graph", "reset-view"].forEach((id) => {
    assert.equal(elements.get(id).getAttribute("aria-disabled"), "true");
  });

  const lockedViewport = { zoom: viewport.zoom, panX: viewport.panX, panY: viewport.panY };
  const pointerDown = { type: "pointerdown", pointerId: 7, target: elements.get("graph-canvas") };
  elements.get("graph-canvas").dispatchEvent(pointerDown);
  elements.get("graph-canvas").dispatchEvent({ type: "pointermove", pointerId: 7, clientX: 220, clientY: 180 });
  const wheel = { type: "wheel", deltaY: -1, clientX: 120, clientY: 100 };
  elements.get("graph-svg").dispatchEvent(wheel);
  elements.get("zoom-in").dispatchEvent({ type: "click" });
  elements.get("zoom-out").dispatchEvent({ type: "click" });
  elements.get("fit-graph").dispatchEvent({ type: "click" });
  elements.get("reset-view").dispatchEvent({ type: "click" });
  navigation.panBy(60, 40);
  navigation.zoomBy(1.5, 200, 140);
  navigation.zoomAt(2, 200, 140);
  navigation.fit();
  navigation.reset();
  ui.focusEndpoint("node-2");
  assert.deepEqual({ zoom: viewport.zoom, panX: viewport.panX, panY: viewport.panY }, lockedViewport);
  assert.equal(viewport.dragging, false);
  assert.equal(wheel.defaultPrevented, true);
  assert.equal(elements.get("graph-canvas").getAttribute("data-navigation-locked"), "true");

  elements.get("filter-toggle").dispatchEvent({ type: "click" });
  assert.equal(elements.get("map-filter-panel").hidden, false);
  ui.selectGraphElement("node", "node-2");
  assert.equal(elements.get("inspector").hidden, false);
  ui.clearSelection();
  assert.equal(viewport.locked, true);

  const edge = findAllByClass(elements.get("graph-edges"), "graph-edge")
    .find((item) => item.getAttribute("data-edge-id") === "edge-3");
  edge.dispatchEvent({ type: "mouseenter" });
  assert.equal(elements.get("graph-popover").hidden, false);
  edge.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selection.kind, "edge");
  assert.equal(ui.state.selection.id, "edge-3");
  assert.equal(elements.get("inspector").hidden, false);
  ui.clearSelection();
  assert.equal(viewport.locked, true);

  lockToggle.dispatchEvent({ type: "click" });
  assert.equal(viewport.locked, false);
  assert.equal(lockToggle.getAttribute("aria-pressed"), "false");
  navigation.panBy(10, -6);
  navigation.zoomBy(1.1, 200, 140);
  assert.notEqual(viewport.panX, lockedViewport.panX);
  assert.notEqual(viewport.zoom, lockedViewport.zoom);

  lockToggle.dispatchEvent({ type: "click" });
  ui.selectView("security-flow");
  assert.equal(viewport.locked, false);
  assert.equal(lockToggle.getAttribute("aria-pressed"), "false");
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

test("기능별 상세 Inspector는 중복 이동 버튼 없이 닫히고 선택 Endpoint와 Navigation을 유지함", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(detailGraphFixture());
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();
  ui.selectGraphElement("node", "endpoint-a");
  assert.equal(findAllByClass(elements.get("inspector"), "inspector-detail-action")
    .some((button) => button.textContent === "기능별 상세 보기"), false);

  ui.state.navigation.panBy(31, -17);
  ui.state.navigation.zoomBy(1.1, 400, 260);
  const viewGraph = ui.state.viewGraph;
  const layout = ui.state.layout;
  const navigation = { zoom: ui.state.navigation.state.zoom, panX: ui.state.navigation.state.panX,
    panY: ui.state.navigation.state.panY };
  const requestId = ui.state.layoutRequestId;
  findAllByClass(elements.get("inspector"), "inspector-close")[0].dispatchEvent({ type: "click" });

  assert.equal(elements.get("inspector").hidden, true);
  assert.equal(elements.get("inspector").attributes["aria-hidden"], "true");
  assert.equal(elements.get("inspector").children.length, 0);
  assert.equal(ui.state.selection, null);
  assert.equal(ui.state.selectedEndpointId, "endpoint-a");
  assert.equal(ui.state.view, "feature-flow");
  assert.equal(ui.state.viewGraph, viewGraph);
  assert.equal(ui.state.layout, layout);
  assert.equal(ui.state.layoutRequestId, requestId);
  assert.deepEqual({ zoom: ui.state.navigation.state.zoom, panX: ui.state.navigation.state.panX,
    panY: ui.state.navigation.state.panY }, navigation);

  ui.applyGraphFilter();
  assert.equal(elements.get("inspector").hidden, true);
  ui.selectGraphElement("node", "handler-a");
  assert.equal(elements.get("inspector").hidden, false);
  assert.equal(elements.get("inspector").attributes["data-selection-id"], "handler-a");
  ui.selectGraphElement("node", "endpoint-a");
  assert.equal(elements.get("inspector").hidden, false);
  assert.equal(findAllByClass(elements.get("inspector"), "inspector-detail-action")
    .some((button) => button.textContent === "기능별 상세 보기"), false);
});

test("Inspector 닫기는 후속 Graph 선택 갱신 실패와 독립적으로 완료됨", async () => {
  const { ui, elements, window } = loadUi();
  ui.renderGraph(detailGraphFixture());
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();
  ui.selectGraphElement("node", "endpoint-a");
  window.MapInBootGraph.updateState = () => { throw new Error("svg selection update failed"); };

  const close = findAllByClass(elements.get("inspector"), "inspector-close")[0];
  assert.doesNotThrow(() => close.dispatchEvent({ type: "click" }));
  assert.equal(elements.get("inspector").hidden, true);
  assert.equal(elements.get("inspector").attributes["aria-hidden"], "true");
  assert.equal(elements.get("inspector").children.length, 0);
  assert.equal(ui.state.selection, null);
  assert.equal(ui.state.selectedEndpointId, "endpoint-a");
  assert.match(elements.get("shell-notice").textContent, /Graph 표시 갱신 실패/);
});

test("API 자동 선택은 Inspector를 열지 않고 Graph 선택만 Inspector를 엶", () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(detailGraphFixture());
  ui.selectView("feature-flow");

  assert.ok(ui.state.graph.nodes.some((node) => node.id === ui.state.selectedEndpointId && node.type === "ENDPOINT"));
  assert.equal(ui.state.selection, null);
  assert.equal(elements.get("inspector").hidden, true);

  ui.selectGraphElement("node", ui.state.selectedEndpointId);
  assert.equal(ui.state.selection.id, ui.state.selectedEndpointId);
  assert.equal(elements.get("inspector").hidden, false);
});

test("빈 Finding Graph의 Inspector 닫힘은 같은 화면 재렌더와 Snapshot 새로고침 후에도 유지됨", async () => {
  const snapshot = detailGraphFixture();
  snapshot.findings = [{
    id: "finding-without-anchor",
    ruleId: "CHAIN_MISSING",
    title: "연결 위치 확인 불가",
    description: "확인된 Graph 참조 없음",
    nodeIds: [],
    edgeIds: [],
    evidenceIds: [],
    guide: "제공된 점검 가이드 없음"
  }];
  const responses = [
    { ok: true, json: async () => ({ phase: "COMPLETED", persistedSnapshotPresent: true }) },
    { ok: true, json: async () => snapshot },
    { ok: true, json: async () => ({ phase: "COMPLETED", persistedSnapshotPresent: true }) },
    { ok: true, json: async () => snapshot }
  ];
  const { ui, elements } = loadUi({ fetchImpl: () => Promise.resolve(responses.shift()) });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  ui.selectView("security-detail");
  assert.equal(ui.state.selectedFindingId, "finding-without-anchor");
  assert.equal(ui.state.visibleGraph.nodes.length, 0);
  assert.equal(elements.get("inspector").hidden, false);

  findAllByClass(elements.get("inspector"), "inspector-close")[0].dispatchEvent({ type: "click" });
  assert.equal(elements.get("inspector").hidden, true);
  assert.equal(elements.get("inspector").attributes["aria-hidden"], "true");
  assert.equal(ui.state.selectedFindingId, "finding-without-anchor");

  ui.selectView("security-detail");
  assert.equal(elements.get("inspector").hidden, true);
  await ui.loadStatus();
  assert.equal(ui.state.selectedFindingId, "finding-without-anchor");
  assert.equal(elements.get("inspector").hidden, true);
  assert.equal(elements.get("inspector").attributes["aria-hidden"], "true");
});

test("닫은 Inspector는 늦은 레이아웃 응답 이후에도 자동으로 다시 열리지 않음", async () => {
  const { ui, layoutApi, elements } = loadUi();
  ui.renderGraph(detailGraphFixture());
  const pending = [];
  layoutApi.layout = (graph) => new Promise((resolve) => pending.push({ graph, resolve }));
  ui.openEndpointDetail("endpoint-a");
  assert.equal(pending.length, 1);
  ui.selectGraphElement("node", "endpoint-a");
  findAllByClass(elements.get("inspector"), "inspector-close")[0].dispatchEvent({ type: "click" });
  assert.equal(elements.get("inspector").hidden, true);

  pending[0].resolve(layoutApi.semanticLayout(pending[0].graph, { positions: {} }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.state.selectedEndpointId, "endpoint-a");
  assert.equal(ui.state.selection, null);
  assert.equal(elements.get("inspector").hidden, true);
  assert.equal(elements.get("inspector").attributes["aria-hidden"], "true");
});

test("상세 MAP에서 새로고침 후 선택 Endpoint Graph와 닫힌 Inspector를 유지함", async () => {
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
  instance.ui.selectGraphElement("node", "endpoint-a");
  instance.elements.get("inspector").children.find((child) => child.attributes.class === "inspector-header")
    .children.find((child) => child.attributes.class === "inspector-close").dispatchEvent({ type: "click" });

  await instance.ui.loadStatus();
  assert.equal(instance.ui.state.view, "feature-flow");
  assert.equal(instance.ui.state.selectedEndpointId, "endpoint-a");
  assert.equal(instance.ui.state.selection, null);
  assert.equal(instance.elements.get("inspector").hidden, true);
  assert.equal(instance.elements.get("inspector").attributes["aria-hidden"], "true");
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
  projection.nodes.forEach((node) => {
    assert.ok(layout.height >= node.position.y + 96);
    assert.ok(layout.width >= node.position.x + node.width,
      `${node.id}: layout.width=${layout.width}, node.x=${node.position.x}, node.width=${node.width}`);
  });
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
  ui.state.includeUnconnectedNodes = true;
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
  assert.equal(findAllByClass(reportGroupElement, "graph-controller-group-card")[0].attributes.rx, "7");
  reportGroupElement.dispatchEvent({ type: "keydown", key: "Enter" });
  assert.equal(ui.state.selection.kind, "controller-group");
  assert.equal(ui.state.selection.id, reportGroups[0].id);
  assert.equal(elements.get("inspector").attributes["data-selection-kind"], "controller-group");
  assert.match(textOf(elements.get("inspector")), /com\.example\.ReportController/);
  assert.equal(typeof window.MapInBootFlow.deriveEndpointGraph, "function");
});

test("Controller Group 소속 API 수는 공통 Chain과 FQCN이 다른 같은 이름 Controller를 구분함", () => {
  const { ui, layoutApi } = loadUi();
  [1, 2, 10].forEach((count) => {
    const graph = ui.normalizeGraph(controllerGroupGraph(count, 1));
    const groups = layoutApi.semanticLayout(graph, { positions: {} }).plan.controllerGroups;
    const first = groups.find((group) => group.controllerFqcn === "com.example.SampleController");
    const second = groups.find((group) => group.controllerFqcn === "org.other.SampleController");
    assert.ok(first);
    assert.ok(second);
    assert.equal(first.handlerIds.length, count);
    assert.equal(first.endpointIds.length, count);
    assert.equal(second.handlerIds.length, 1);
    assert.equal(second.endpointIds.length, 1);
    assert.notEqual(first.id, second.id);
    assert.equal(first.controllerName, second.controllerName);
  });
});

test("Controller Group 선택은 소속과 직접 관계만 강조하고 공유 Chain을 통해 확장하지 않음", () => {
  const { ui, layoutApi, window } = loadUi();
  const graph = ui.normalizeGraph(controllerGroupGraph(1, 1));
  const groups = layoutApi.semanticLayout(graph, { positions: {} }).plan.controllerGroups;
  const first = groups.find((group) => group.controllerFqcn === "com.example.SampleController");
  const related = window.MapInBootInspector.related(graph, { kind: "controller-group", id: first.id }, groups);

  assert.equal(related.nodeIds.has(first.id), true);
  assert.equal(related.nodeIds.has("first-handler-0"), true);
  assert.equal(related.nodeIds.has("first-endpoint-0"), true);
  assert.equal(related.nodeIds.has("shared-chain"), true);
  assert.equal(related.nodeIds.has("second-handler-0"), false);
  assert.equal(related.nodeIds.has("second-endpoint-0"), false);
  assert.equal(related.edgeIds.has("first-match-0"), true);
  assert.equal(related.edgeIds.has("second-match-0"), false);
});

test("Controller Group 선택은 해당 Controller의 안내선과 전용 Projection만 강조함", async () => {
  const { ui, elements } = loadUi();
  ui.state.includeUnconnectedNodes = true;
  ui.renderGraph(controllerGroupGraph(1, 1));
  await ui.layoutGraph();
  const group = ui.state.layout.plan.controllerGroups.find((item) => item.controllerFqcn === "com.example.SampleController");
  ui.selectGraphElement("controller-group", group.id);

  const guideFor = (endpointId) => elements.get("graph-guides").children
    .find((item) => item.attributes["data-endpoint-id"] === endpointId);
  const projectionFor = (id) => findAllByClass(elements.get("graph-flow-projection"), "graph-projection-edge")
    .find((item) => item.attributes["data-projection-edge-id"] === id);
  assert.equal(guideFor("first-endpoint-0").attributes["data-related"], "true");
  assert.equal(guideFor("second-endpoint-0").attributes["data-related"], "false");
  assert.equal(projectionFor("adapter-to-first-handler-0").attributes["data-related"], "true");
  assert.equal(projectionFor("adapter-to-second-handler-0").attributes["data-related"], "false");
  assert.equal(findAllByClass(elements.get("graph-flow-projection"), "graph-projection-edge")
    .some((edge) => (edge.attributes["data-projection-edge-id"] || "").startsWith("handler-to-response-")), false);
  assert.equal(projectionFor("mapping-to-adapter-shared").attributes["data-related"], "false");
  assert.equal(projectionFor("education-education-http-request-education-request-prepare").attributes["data-related"], "false");
});

test("보안 관계선은 Graph 하단을 우회하지 않고 목표 입력 Port까지 짧게 연결함", () => {
  const { ui, layoutApi } = loadUi();
  const graph = ui.normalizeGraph(supportApiGraph(1));
  const layout = layoutApi.semanticLayout(graph, { positions: {} });
  const model = layout.plan.displayModel;
  const sourceDisplayId = model.nodeToDisplay["first-handler-0"];
  const targetDisplayId = model.nodeToDisplay["authorization-0"];
  const groupPositions = layout.plan.controllerGroups.concat(model.groups)
    .map((group) => [group.id, group.position]);
  const displayedPosition = (id) => {
    const displayId = model.nodeToDisplay[id];
    const grouped = groupPositions.find(([groupId]) => groupId === displayId);
    return grouped ? grouped[1] : layout.positions[id];
  };
  const route = layout.plan.displayEdgeRoutes["secured-0"];
  const points = routePoints(route);
  const actualRoute = layout.edgeRoutes["secured-0"];
  const source = displayedPosition("first-handler-0");
  const target = displayedPosition("authorization-0");
  const start = { x: source.x + 260, y: source.y + 48 };
  const end = { x: target.x, y: target.y + 48 };
  assert.equal(points[0].x, start.x);
  assert.equal(points[0].y, start.y);
  assert.equal(points[points.length - 1].x, end.x);
  assert.equal(points[points.length - 1].y, end.y);
  assert.ok(points.length - 2 <= 2, `굽힘 수 ${points.length - 2}`);
  assert.ok(routeLength(route) <= Math.abs(end.x - start.x) + Math.abs(end.y - start.y) + 32,
    `경로 길이 ${routeLength(route)}`);

  const positions = Object.fromEntries(layout.plan.projection.nodes.map((node) => [node.id, node.position]));
  graph.nodes.forEach((node) => { positions[model.nodeToDisplay[node.id]] = displayedPosition(node.id); });
  Object.entries(positions).forEach(([nodeId, position]) => {
    if (nodeId === sourceDisplayId || nodeId === targetDisplayId) return;
    assert.equal(routeIntersectsPosition(route, position), false, `${nodeId} 관통`);
  });
  const actualBottom = Math.max(...Object.values(layout.positions).map((position) => position.y + 96));
  assert.ok(Math.max(...points.map((point) => point.y)) < actualBottom,
    `경로가 실제 Node 하단 ${actualBottom} 아래로 내려감`);
  assert.ok(Math.max(...routePoints(actualRoute).map((point) => point.y)) < actualBottom);
  assert.equal(layout.plan.routeDiagnostics.edgeNodeIntersections, 0);
});

test("Controller 50·60 API 규모에서도 보안 관계 Route를 유지하고 하단 공통 우회를 만들지 않음", () => {
  const { ui, layoutApi } = loadUi();
  [50, 60].forEach((count) => {
    const graph = ui.normalizeGraph(supportApiGraph(count));
    const layout = layoutApi.semanticLayout(graph, { positions: {} });
    const model = layout.plan.displayModel;
    const firstRoute = layout.plan.displayEdgeRoutes["secured-0"];
    const displayPositions = Object.fromEntries(layout.plan.projection.nodes.map((node) => [node.id, node.position]));
    const displayGroups = layout.plan.controllerGroups.concat(model.groups);
    graph.nodes.forEach((node) => {
      const displayId = model.nodeToDisplay[node.id];
      const group = displayGroups.find((item) => item.id === displayId);
      displayPositions[displayId] = group ? group.position : layout.positions[node.id];
    });
    const sourceDisplayId = model.nodeToDisplay["first-handler-0"];
    const targetDisplayId = model.nodeToDisplay["authorization-0"];
    const groupPositions = layout.plan.controllerGroups.concat(model.groups)
      .map((group) => [group.id, group.position]);
    const source = groupPositions.find(([id]) => id === sourceDisplayId)[1];
    const target = groupPositions.find(([id]) => id === targetDisplayId)[1];
    const points = routePoints(firstRoute);
    assert.equal(Object.keys(layout.plan.displayEdgeRoutes).filter((id) => id.startsWith("secured-")).length, count);
    assert.ok(points.length > 0, `${count}개 API의 첫 관계선 Route 없음`);
    assert.ok(Math.max(...points.map((point) => point.y)) <= Math.max(source.y + 48, target.y + 48) + 48,
      `${count}개 API의 첫 관계선이 목표 주변을 벗어남`);
    assert.equal(layout.plan.routeDiagnostics.nodeOverlaps, 0, `${count}개 API Node 겹침`);
    assert.equal(layout.plan.routeDiagnostics.edgeNodeIntersections, 0, `${count}개 API 실제 Edge 충돌`);
    graph.edges.filter((edge) => edge.type === "SECURED_BY").forEach((edge) => {
      const sourceId = model.nodeToDisplay[edge.sourceId];
      const targetId = model.nodeToDisplay[edge.targetId];
      const route = layout.plan.displayEdgeRoutes[edge.id];
      Object.entries(displayPositions).forEach(([nodeId, position]) => {
        if (nodeId === sourceId || nodeId === targetId) return;
        assert.equal(routeIntersectsPosition(route, position), false, `${count}개 API ${edge.id}의 ${nodeId} 충돌`);
      });
    });
  });
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

test("묶인 Edge의 Finding은 원본 Edge별로 따로 선택됨", async () => {
  const { ui, elements } = loadUi();
  const snapshot = detailGraphFixture();
  snapshot.nodes.push({ id: "authorization-a2", type: "AUTHORIZATION", serviceId: "orders", label: "other", attributes: {}, evidenceIds: [] });
  snapshot.edges.push({ id: "secured-a2", sourceId: "handler-a", targetId: "authorization-a2", type: "SECURED_BY", attributes: {}, confidence: "CONFIRMED", evidenceIds: [] });
  snapshot.findings = [
    { id: "first", title: "첫 판단", ruleId: "CHAIN_ORDER", confidence: "CONFIRMED", nodeIds: [], edgeIds: ["secured-a"] },
    { id: "second", title: "둘째 판단", ruleId: "FILTER_ORDER", confidence: "LIKELY", nodeIds: [], edgeIds: ["secured-a2"] }
  ];
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");
  await ui.layoutGraph();
  const markers = findAllByClass(elements.get("graph-edges"), "finding-marker");
  assert.equal(markers.length, 2);
  assert.match(markers[0].getAttribute("aria-label"), /첫 판단/);
  assert.match(markers[1].getAttribute("aria-label"), /둘째 판단/);
  markers[1].dispatchEvent({ type: "keydown", key: "Enter" });
  assert.equal(ui.state.selectedFindingId, "second");
});

test("표시 그룹의 원본 Node 참조와 Snapshot 교체가 마커를 정확히 갱신함", async () => {
  const { ui, elements } = loadUi();
  const snapshot = detailGraphFixture();
  snapshot.findings = [
    { id: "grouped", title: "인가 판단", ruleId: "OBJECT_BINDING", confidence: "LIKELY", nodeIds: ["authorization-a", "missing"], edgeIds: [] }
  ];
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");
  await ui.layoutGraph();
  const group = ui.state.layout.plan.displayModel.groups.find((item) => item.nodeIds.includes("authorization-a"));
  const marker = findAllByClass(elements.get("graph-nodes"), "finding-marker")[0];
  assert.equal(marker.getAttribute("transform"), `translate(${group.position.x + 246} ${group.position.y + 14})`);
  marker.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selectedFindingId, "grouped");
  assert.equal(ui.state.view, "security-flow");
  assert.equal(elements.get("finding-modal").hidden, false);
  assert.match(textOf(elements.get("finding-modal")), /authorization-a/);
  ui.selectView("security-flow");
  assert.match(textOf(elements.get("finding-list")), /인가 판단/);
  const replacement = detailGraphFixture();
  replacement.findings = [];
  ui.renderGraph(replacement);
  assert.equal(findAllByClass(elements.get("graph-nodes"), "finding-marker").length, 0);
  assert.match(textOf(elements.get("finding-list")), /보존된 Finding 없음/);
  assert.equal(ui.state.selectedFindingId, null);
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
  assert.equal(adapter.attributes["data-related"], "true");
  assert.equal(shared.attributes["data-related"], "true");
  assert.equal(paths.some((path) => (path.attributes["data-projection-edge-id"] || "").startsWith("handler-to-response-")), false);
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

test("업무 상태 구조 식별자는 카드 이름이 아닌 의미 있는 상태로 표시됨", () => {
  const { window } = loadUi();
  const display = window.MapInBootGraph.nodeDisplay({ type: "BUSINESS_SECURITY_STATE", label: "state-evaluation|org.example.AccountController#submit(Ljava/lang/String;)V|BYPASS_PATH", attributes: { factType: "BUSINESS_STATE_EVALUATION", stateName: "verified", pathOutcome: "BYPASS_PATH" } });
  assert.match(display.primary, /업무 상태 검증/);
  assert.match(display.primary, /verified/);
  assert.doesNotMatch(display.primary + display.detail, /state-evaluation\||Ljava/);

  const required = window.MapInBootGraph.nodeDisplay({
    type: "BUSINESS_SECURITY_STATE", label: "state-requires|identity_verified",
    attributes: { stateAction: "REQUIRES", stateName: "identity_verified" }
  });
  const produced = window.MapInBootGraph.nodeDisplay({
    type: "BUSINESS_SECURITY_STATE", label: "state-produces|identity_verified",
    attributes: { stateAction: "PRODUCES", stateName: "identity_verified" }
  });
  assert.match(required.primary, /업무 상태 요구/);
  assert.match(produced.primary, /업무 상태 생성/);
});

test("화면 전환 후 상세 취약점 선택을 유지함", () => {
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  snapshot.findings = [{ id: "saved-finding", ruleId: "PUBLIC_ENDPOINT", title: "판단", confidence: "LIKELY", nodeIds: ["node-2"], edgeIds: [], evidenceIds: [], guide: "점검" }];
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");
  findAllByClass(elements.get("graph-nodes"), "finding-marker")[0].dispatchEvent({ type: "click" });
  for (const view of ["all-flow", "feature-flow", "security-flow"]) {
    ui.selectView(view);
    ui.selectView("security-detail");
    assert.equal(ui.state.selectedFindingId, "saved-finding");
    assert.equal(ui.state.detailApiId, "node-2");
  }
});

test("Snapshot 시간은 단일 버전 문구로 표시함", async () => {
  const snapshot = graphFixture();
  snapshot.capturedAt = "2026-11-19T03:00:00Z";
  const responses = [
    { ok: true, json: async () => ({ phase: "PARTIAL", persistedSnapshotPresent: true }) },
    { ok: true, json: async () => snapshot }
  ];
  const { elements } = loadUi({ fetchImpl: () => Promise.resolve(responses.shift()) });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(textOf(elements.get("snapshot-time")), /^Snapshot 버전: /);
  assert.doesNotMatch(indexHtml.match(/<span class="view-state"[^>]*>/)?.[0] || "", /class="view-state"/);
});

test("유형 필터는 원본 Enum을 값으로 유지하고 한국어를 표시함", () => {
  const { window, elements } = loadUi();
  for (const [value, label] of Object.entries(window.MapInBootGraph.nodeTypeNames)) {
    assert.ok(elements.get("node-filter").children.some((option) => option.value === value && option.textContent === label));
  }
  for (const [value, label] of Object.entries(window.MapInBootGraph.edgeTypeNames)) {
    assert.ok(elements.get("edge-filter").children.some((option) => option.value === value && option.textContent === label));
  }
});

test("보안 MAP에서 직접 참조된 노드만 Finding 테두리 상태를 가짐", () => {
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  snapshot.findings = [{ id: "border-finding", ruleId: "PUBLIC_ENDPOINT", title: "판단", confidence: "LIKELY", nodeIds: ["node-2"], edgeIds: [], evidenceIds: [], guide: "점검" }];
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");
  const nodes = findAllByClass(elements.get("graph-nodes"), "graph-node");
  assert.equal(nodes.find((node) => node.getAttribute("data-node-id") === "node-2").getAttribute("data-has-finding"), "true");
  assert.equal(nodes.find((node) => node.getAttribute("data-node-id") === "node-1").getAttribute("data-has-finding"), "false");
  elements.get("finding-confidence").value = "CONFIRMED";
  elements.get("finding-confidence").dispatchEvent({ type: "change" });
  const filtered = findAllByClass(elements.get("graph-nodes"), "graph-node");
  assert.equal(filtered.find((node) => node.getAttribute("data-node-id") === "node-2").getAttribute("data-has-finding"), "false");
});

test("Finding 근거는 유일한 Endpoint 등록 근거 또는 구조 Handler로만 연결함", () => {
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  const endpoint = snapshot.nodes.find((node) => node.id === "node-2");
  endpoint.attributes.handler = "org.example.Controller#one()";
  endpoint.evidenceIds = ["endpoint-evidence"];
  snapshot.nodes.push({ id: "other-endpoint", type: "ENDPOINT", label: "GET /other", attributes: { httpMethod: "GET", path: "/other", handler: "org.example.Controller#other()" }, evidenceIds: ["shared-evidence"] });
  snapshot.nodes.push({ id: "state-node", type: "BUSINESS_SECURITY_STATE", label: "state", attributes: { factType: "BUSINESS_STATE_EVALUATION", handler: "org.example.Controller#one()" }, evidenceIds: ["state-evidence"] });
  snapshot.evidence = [
    { id: "endpoint-evidence", source: "RUNTIME", location: `mapping:${endpoint.attributes.handler}`, summary: `등록 Endpoint: ${endpoint.attributes.httpMethod} ${endpoint.attributes.path}` },
    { id: "shared-evidence" }, { id: "state-evidence" }
  ];
  snapshot.findings = [
    { id: "evidence-finding", ruleId: "FILTER_ORDER", title: "순서", nodeIds: [], edgeIds: [], evidenceIds: ["endpoint-evidence"], guide: "점검" },
    { id: "state-finding", ruleId: "STATE_BYPASS", title: "상태", nodeIds: [], edgeIds: [], evidenceIds: ["state-evidence"], guide: "점검" }
  ];
  ui.renderGraph(snapshot);
  ui.selectView("security-detail");
  const options = elements.get("finding-api-select").children.filter((option) => option.value).map((option) => option.value);
  assert.deepEqual(options, ["node-2"]);
  elements.get("finding-api-select").value = "node-2";
  elements.get("finding-api-select").dispatchEvent({ type: "change" });
  assert.match(textOf(elements.get("detail-finding-list")), /순서/);
  assert.match(textOf(elements.get("detail-finding-list")), /상태/);
});

test("다수 보안정보 표시 카드와 교육 노드는 충돌하지 않음", () => {
  const { layoutApi, ui } = loadUi();
  const snapshot = laneGraphFixture();
  for (let index = 0; index < 30; index += 1) {
    snapshot.nodes.push({ id: `extra-state-${index}`, type: "BUSINESS_SECURITY_STATE", label: `state-${index}`, attributes: {}, evidenceIds: [] });
  }
  const layout = layoutApi.semanticLayout(ui.normalizeGraph(snapshot), { positions: {} });
  const groups = (layout.plan.controllerGroups || []).concat(layout.plan.displayModel.groups || []);
  const cards = Object.values(layout.positions).concat(groups.map((group) => group.position));
  const education = layout.plan.projection.nodes.map((node) => node.position);
  const overlap = (a, b) => a.x < b.x + 260 && a.x + 260 > b.x && a.y < b.y + 96 && a.y + 96 > b.y;
  for (const [index, position] of education.entries()) {
    assert.equal(cards.some((card) => overlap(position, card)), false, `실제 카드와 충돌: ${index}`);
    assert.equal(education.slice(index + 1).some((card) => overlap(position, card)), false, `교육 카드와 충돌: ${index}`);
  }
});

test("빈 Graph부터 다수 Endpoint까지 교육 카드의 실제 표시 Bounds가 겹치지 않음", () => {
  const { layoutApi, ui } = loadUi();
  const toRect = (position, width = 260, height = 96) => ({
    left: position.x, top: position.y, right: position.x + width, bottom: position.y + height
  });
  const overlaps = (left, right, gap = 0) => left.left - gap < right.right && left.right + gap > right.left
    && left.top - gap < right.bottom && left.bottom + gap > right.top;
  for (const count of [0, 1, 5, 16, 32, 50, 60]) {
    const graph = ui.normalizeGraph(endpointCountGraph(count));
    if (count >= 50) {
      const endpointIds = graph.nodes.filter((node) => node.type === "ENDPOINT").map((node) => node.id);
      graph.findingSections = ["first", "second"].map((suffix) => ({
        finding: { id: `bulk-finding-${count}-${suffix}`, title: `API ${count}개 영향 ${suffix}` },
        nodeIds: endpointIds,
        edgeIds: []
      }));
    }
    const original = JSON.stringify({ nodes: graph.nodes, edges: graph.edges });
    const layout = layoutApi.semanticLayout(graph, { positions: {} });
    const groups = (layout.plan.controllerGroups || []).concat(layout.plan.displayModel.groups || []);
    const groupedIds = new Set(groups.flatMap((group) => (group.handlerIds || []).concat(group.nodeIds || [])));
    const cards = graph.nodes.filter((node) => !groupedIds.has(node.id))
      .map((node) => toRect(layout.positions[node.id]))
      .concat(groups.filter((group) => group.position).map((group) => toRect(group.position)));
    const nodes = layout.plan.projection.nodes;
    const projectionById = new Map(nodes.map((node) => [node.id, node]));
    const projectionIds = nodes.map((node) => node.presentationId);
    assert.equal(new Set(projectionIds).size, nodes.length, `${count}: Presentation ID 중복`);
    assert.equal(projectionIds.some((id) => graph.nodes.some((node) => node.id === id)), false,
      `${count}: Presentation ID가 원본 Node와 겹침`);
    assert.deepEqual(JSON.stringify({ nodes: graph.nodes, edges: graph.edges }), original, `${count}: 원본 Graph 변경`);

    for (const [index, node] of nodes.entries()) {
      assert.ok(node.width > 0 && node.height > 0, `${count}: ${node.id} 크기`);
      assert.deepEqual([node.bounds.left, node.bounds.top, node.bounds.right, node.bounds.bottom], [
        node.position.x, node.position.y,
        node.position.x + node.width, node.position.y + node.height
      ], `${count}: ${node.id} Bounds`);
      assert.equal(cards.some((card) => overlaps(node.bounds, card, 24)), false,
        `${count}: 실제 Node·Group과 24px 여백 충돌 ${index}`);
      assert.equal(nodes.slice(index + 1).some((other) => overlaps(node.bounds, other.bounds, 24)), false,
        `${count}: 교육 Node 간 24px 여백 충돌 ${index}`);
      assert.ok(layout.width >= node.bounds.right, `${count}: ${node.id}가 layout 폭을 벗어남`);
      assert.ok(layout.height >= node.bounds.bottom, `${count}: ${node.id}가 layout 높이를 벗어남`);
      assert.ok(layout.plan.educationArea.left <= node.bounds.left
        && layout.plan.educationArea.right >= node.bounds.right
        && layout.plan.educationArea.top <= node.bounds.top
        && layout.plan.educationArea.bottom >= node.bounds.bottom, `${count}: ${node.id}가 교육 영역을 벗어남`);
      const edgeBounds = [...(layout.plan.lanes || []).map((lane) => lane.headerBounds),
        ...(layout.plan.chainGroups || []).map((group) => group.headerBounds)].filter(Boolean);
      assert.equal(edgeBounds.some((bounds) => overlaps(node.bounds, bounds, 24)), false,
        `${count}: 기술 제목과 24px 여백 충돌 ${index}`);
      assert.equal((layout.plan.findingSectionLayouts || []).some((section) =>
        overlaps(node.bounds, section.bounds, 24) || overlaps(node.bounds, section.titleBounds, 24)), false,
      `${count}: Finding 섹션과 24px 여백 충돌 ${index}`);
    }

    for (const edge of layout.plan.projection.edges) {
      const route = layout.plan.projectionRoutes[edge.id];
      if (!route) continue;
      const source = projectionById.get(edge.sourceId);
      const target = projectionById.get(edge.targetId);
      const sourcePosition = source ? source.position : layout.positions[edge.sourceId];
      const targetPosition = target ? target.position : layout.positions[edge.targetId];
      if (!sourcePosition || !targetPosition) continue;
      const sourceHeight = source ? source.height : 96;
      const targetHeight = target ? target.height : 96;
      const points = [];
      for (const [, command, first, second] of route.d.matchAll(/([MLHV])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?/g)) {
        const previous = points.at(-1);
        points.push(command === "H" ? { x: Number(first), y: previous.y }
          : command === "V" ? { x: previous.x, y: Number(first) }
            : { x: Number(first), y: Number(second) });
      }
      assert.ok(points.length > 1, `${count}: ${edge.id} Route`);
      const sourceWidth = source ? source.width : 260;
      const targetWidth = target ? target.width : 260;
      assert.ok([[sourcePosition.x, sourcePosition.y + sourceHeight / 2],
        [sourcePosition.x + sourceWidth, sourcePosition.y + sourceHeight / 2]]
        .some(([x, y]) => points[0].x === x && points[0].y === y), `${count}: ${edge.id} 시작 포트`);
      assert.ok([[targetPosition.x, targetPosition.y + targetHeight / 2],
        [targetPosition.x + targetWidth, targetPosition.y + targetHeight / 2]]
        .some(([x, y]) => points.at(-1).x === x && points.at(-1).y === y), `${count}: ${edge.id} 종료 포트`);
    }

    for (const section of layout.plan.findingSectionLayouts || []) {
      const related = section.nodeIds.map((id) => layout.positions[id]);
      assert.ok(related.length > 0, `${count}: 영향 Node 없음`);
      assert.ok(section.bounds.left <= Math.min(...related.map((position) => position.x)) - 28);
      assert.ok(section.bounds.right >= Math.max(...related.map((position) => position.x + 260)) + 28);
      assert.ok(section.bounds.top <= Math.min(...related.map((position) => position.y)) - 48);
      assert.ok(section.bounds.bottom >= Math.max(...related.map((position) => position.y + 96)) + 24);
      assert.equal(cards.some((card) => overlaps(section.titleBounds, card, 4)), false,
        `${count}: Finding 제목과 실제 카드 충돌`);
      const technicalTitles = [...(layout.plan.lanes || []).map((lane) => lane.headerBounds),
        ...(layout.plan.chainGroups || []).map((group) => group.headerBounds)].filter(Boolean);
      assert.equal(technicalTitles.some((title) => overlaps(section.titleBounds, title, 4)), false,
        `${count}: Finding 제목과 기술 제목 충돌`);
    }
    const sectionTitles = (layout.plan.findingSectionLayouts || []).map((section) => section.titleBounds);
    for (let index = 0; index < sectionTitles.length; index += 1) {
      assert.equal(sectionTitles.slice(index + 1).some((title) => overlaps(sectionTitles[index], title, 4)), false,
        `${count}: Finding 제목 간 충돌 ${index}`);
    }
  }
});

test("Finding 섹션 배경과 제목은 Modal을 열고 Node·Edge Inspector와 Pan 상태를 보존함", async () => {
  const { ui, elements, layoutCalls } = loadUi();
  const snapshot = detailGraphFixture();
  snapshot.evidence = [{ id: "finding-evidence", source: "STATIC", location: "OrderController#list", summary: "인가 관계 확인" }];
  snapshot.findings = [{
    id: "section-modal", ruleId: "OBJECT_BINDING", title: "객체 인가 확인", description: "인가 대상 확인",
    confidence: "LIKELY", nodeIds: ["endpoint-a", "authorization-a"], edgeIds: ["secured-a"],
    evidenceIds: ["finding-evidence"], guide: "객체 소유자 검증"
  }];
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");
  findAllByClass(elements.get("graph-nodes"), "finding-marker")[0].dispatchEvent({ type: "click" });
  await new Promise((resolve) => setImmediate(resolve));

  let section = findAllByClass(elements.get("graph-finding-sections"), "graph-finding-section")[0];
  let outline = findAllByClass(section, "graph-finding-section-outline")[0];
  let titleHit = findAllByClass(elements.get("graph-finding-section-titles"), "graph-finding-section-title-hit")[0];
  assert.ok(section && outline && titleHit);
  assert.equal(section.getAttribute("role"), "button");
  assert.match(section.getAttribute("aria-label"), /객체 인가 확인/);
  assert.equal(titleHit.parentNode.getAttribute("data-finding-id"), section.getAttribute("data-finding-id"));
  assert.match(appCss, /\.graph-finding-section-outline\s*\{[^}]*fill:\s*#7f1d1d[^}]*stroke-dasharray:\s*5 4/s);
  assert.match(appCss, /\.graph-finding-section\[data-hovered="true"\]/);
  assert.match(appCss, /\.graph-finding-section-title-target\[data-hovered="true"\]/);
  assert.match(appCss, /\.graph-finding-section:focus-visible/);
  assert.match(outline.getAttribute("class"), /graph-area-box/);
  assert.ok(indexHtml.indexOf('id="graph-finding-sections"') < indexHtml.indexOf('id="graph-edges"'));
  assert.ok(indexHtml.indexOf('id="graph-edges"') < indexHtml.indexOf('id="graph-nodes"'));

  const titleGroup = titleHit.parentNode;
  outline.dispatchEvent({ type: "pointerover" });
  assert.equal(section.getAttribute("data-hovered"), "true");
  assert.equal(titleGroup.getAttribute("data-hovered"), "true");
  titleGroup.dispatchEvent({ type: "pointerout", relatedTarget: outline });
  assert.equal(section.getAttribute("data-hovered"), "true");
  titleHit.dispatchEvent({ type: "pointerover" });
  assert.equal(section.getAttribute("data-hovered"), "true");
  titleGroup.dispatchEvent({ type: "pointerout", relatedTarget: elements.get("graph-svg") });
  assert.equal(section.getAttribute("data-hovered"), "false");
  assert.equal(titleGroup.getAttribute("data-hovered"), "false");
  assert.equal(section.getAttribute("data-selected"), "true");

  const node = findAllByClass(elements.get("graph-nodes"), "graph-node")
    .find((item) => item.getAttribute("data-node-id") === "authorization-a");
  node.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selection.kind, "node");
  assert.equal(elements.get("inspector").hidden, false);
  const edge = findAllByClass(elements.get("graph-edges"), "graph-edge")
    .find((item) => item.getAttribute("data-edge-id") === "secured-a");
  edge.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selection.kind, "edge");
  assert.equal(ui.state.selection.id, "secured-a");
  section = findAllByClass(elements.get("graph-finding-sections"), "graph-finding-section")[0];
  outline = findAllByClass(section, "graph-finding-section-outline")[0];
  titleHit = findAllByClass(elements.get("graph-finding-section-titles"), "graph-finding-section-title-hit")[0];

  const navigation = ui.state.navigation.state;
  const before = {
    view: ui.state.view,
    selection: { ...ui.state.selection },
    selectedFindingId: ui.state.selectedFindingId,
    detailApiId: ui.state.detailApiId,
    zoom: navigation.zoom,
    panX: navigation.panX,
    panY: navigation.panY,
    layoutCount: layoutCalls.length
  };
  outline.dispatchEvent({ type: "click" });
  assert.equal(elements.get("finding-modal").hidden, false);
  assert.equal(ui.state.view, before.view);
  assert.equal(ui.state.selection.kind, before.selection.kind);
  assert.equal(ui.state.selection.id, before.selection.id);
  assert.equal(ui.state.selectedFindingId, before.selectedFindingId);
  assert.equal(ui.state.detailApiId, before.detailApiId);
  assert.equal(navigation.zoom, before.zoom);
  assert.equal(navigation.panX, before.panX);
  assert.equal(navigation.panY, before.panY);
  assert.equal(layoutCalls.length, before.layoutCount);

  elements.get("finding-modal").dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(section.focused, true);
  assert.equal(elements.get("finding-modal").hidden, true);
  titleHit.dispatchEvent({ type: "click" });
  assert.equal(elements.get("finding-modal").hidden, false);
  elements.get("finding-modal").dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(section.focused, true);
  const spaceKey = { type: "keydown", key: " " };
  section.dispatchEvent(spaceKey);
  assert.equal(spaceKey.defaultPrevented, true);
  assert.equal(elements.get("finding-modal").hidden, false);
  elements.get("finding-modal").dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(section.focused, true);

  elements.get("graph-canvas").dispatchEvent({ type: "pointerdown", target: outline, clientX: 10, clientY: 20, pointerId: 1 });
  assert.equal(navigation.dragging, false);
  elements.get("graph-canvas").dispatchEvent({ type: "pointerdown", target: titleHit, clientX: 10, clientY: 20, pointerId: 3 });
  assert.equal(navigation.dragging, false);
  elements.get("graph-canvas").dispatchEvent({ type: "pointerdown", target: elements.get("graph-svg"), clientX: 10, clientY: 20, pointerId: 2 });
  assert.equal(navigation.dragging, true);
  elements.get("graph-canvas").dispatchEvent({ type: "pointerup", target: elements.get("graph-svg"), pointerId: 2 });
  assert.equal(navigation.dragging, false);

  const layout = ui.state.layout;
  const presentation = layout.plan.projection.nodes[0];
  const minimapNode = findAllByClass(elements.get("graph-minimap-nodes"), "graph-minimap-node")
    .find((item) => item.getAttribute("data-node-id") === presentation.id);
  assert.ok(minimapNode);
  assert.equal(Number(minimapNode.getAttribute("width")), presentation.width);
  assert.equal(Number(minimapNode.getAttribute("height")), presentation.height);
  const fitBounds = navigation.visibleBounds;
  const fitRect = {
    left: fitBounds.x, top: fitBounds.y,
    right: fitBounds.x + fitBounds.width, bottom: fitBounds.y + fitBounds.height
  };
  const sectionBounds = layout.plan.findingSectionLayouts[0].bounds;
  const areaBounds = layout.plan.educationArea;
  assert.ok(fitRect.left <= sectionBounds.left && fitRect.right >= sectionBounds.right);
  assert.ok(fitRect.top <= sectionBounds.top && fitRect.bottom >= sectionBounds.bottom);
  assert.ok(fitRect.left <= areaBounds.left && fitRect.right >= areaBounds.right);
  assert.ok(fitRect.top <= areaBounds.top && fitRect.bottom >= areaBounds.bottom);
});


test("객체 인가 사실 유형은 구조 키 대신 역할을 표시함", () => {
  const { window } = loadUi();
  const requirement = window.MapInBootGraph.nodeDisplay({ type: "AUTHORIZATION", label: "object-requirement|example.Foo#bar()", attributes: { factType: "OBJECT_AUTHORIZATION_REQUIREMENT", handler: "example.Foo#bar(java.lang.String)" } });
  const path = window.MapInBootGraph.nodeDisplay({ type: "AUTHORIZATION", label: "object-access|example.Foo#bar()", attributes: { factType: "OBJECT_ACCESS_PATH", handler: "example.Foo#bar(java.lang.String)" } });
  assert.match(requirement.primary, /객체 인가 요구/);
  assert.match(path.primary, /객체 접근 경로/);
  assert.doesNotMatch(requirement.primary + path.primary, /object-|example\./);
});

test("교육 흐름 경로는 관련 없는 실제 카드 내부를 지나지 않음", () => {
  const { layoutApi, ui } = loadUi();
  const intersects = (a, b, p) => a.x === b.x
    ? a.x > p.x && a.x < p.x + 260 && Math.max(a.y, b.y) > p.y && Math.min(a.y, b.y) < p.y + 96
    : a.y === b.y && a.y > p.y && a.y < p.y + 96 && Math.max(a.x, b.x) > p.x && Math.min(a.x, b.x) < p.x + 260;
  for (const graph of [wrappedFilterGraph(5, 5), laneGraphFixture()]) {
  const layout = layoutApi.semanticLayout(ui.normalizeGraph(graph), { positions: {} });
  for (const edge of layout.plan.projection.edges) {
    const route = layout.plan.projectionRoutes[edge.id];
    if (!route) continue;
    const commands = [...route.d.matchAll(/([MLHV])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?/g)];
    let previous = null;
    for (const [, command, first, second] of commands) {
      const point = command === "H" ? { x: Number(first), y: previous.y }
        : command === "V" ? { x: previous.x, y: Number(first) }
          : { x: Number(first), y: Number(second) };
      if (previous) for (const [id, position] of Object.entries(layout.positions)) {
        if (id !== edge.sourceId && id !== edge.targetId) assert.equal(intersects(previous, point, position), false, `${edge.id}: ${id}`);
      }
      previous = point;
    }
  }
  }
});

test("객체 인가 Handler는 실제 근거가 일치할 때만 API에 연결하고 모호한 등록 근거는 제외함", () => {
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  const endpoint = snapshot.nodes.find((node) => node.id === "node-2");
  endpoint.attributes.handler = "org.sample.Controller#load()";
  endpoint.evidenceIds = ["shared"];
  snapshot.nodes.push({ id: "ambiguous-endpoint", type: "ENDPOINT", label: endpoint.label, attributes: { ...endpoint.attributes }, evidenceIds: ["shared"] });
  snapshot.nodes.push({ id: "object-path", type: "AUTHORIZATION", label: "object-path", attributes: { factType: "OBJECT_ACCESS_PATH", handler: "org.sample.Other#load()" }, evidenceIds: ["object-evidence"] });
  snapshot.nodes.push({ id: "object-endpoint", type: "ENDPOINT", label: "GET /objects", attributes: { httpMethod: "GET", path: "/objects", handler: "org.sample.Other#load()" }, evidenceIds: [] });
  snapshot.evidence = [{ id: "shared", source: "RUNTIME", location: `mapping:${endpoint.attributes.handler}`, summary: `등록 Endpoint: ${endpoint.attributes.httpMethod} ${endpoint.attributes.path}` }, { id: "object-evidence" }];
  snapshot.findings = [
    { id: "ambiguous", ruleId: "FILTER_ORDER", title: "모호", nodeIds: [], edgeIds: [], evidenceIds: ["shared"] },
    { id: "object", ruleId: "OBJECT_BINDING", title: "객체", nodeIds: [], edgeIds: [], evidenceIds: ["object-evidence"] }
  ];
  ui.renderGraph(snapshot);
  ui.selectView("security-detail");
  const options = elements.get("finding-api-select").children.filter((option) => option.value).map((option) => option.value);
  assert.deepEqual(options, ["object-endpoint"]);
  assert.equal(ui.state.selectedFindingId, "object");
});

test("속성이 없는 노드도 구조 ID와 JVM Descriptor를 제목으로 노출하지 않음", () => {
  const { window } = loadUi();
  for (const type of ["APPLICATION", "SERVLET", "ENDPOINT", "HANDLER", "FILTER", "AUTHENTICATION", "AUTHORIZATION", "SECURITY_DATA", "BUSINESS_SECURITY_STATE", "SECURITY_CHAIN"]) {
    const display = window.MapInBootGraph.nodeDisplay({ id: "opaque-id", type, label: "structural|org.other.Example#run(Ljava/lang/String;)V", attributes: {} });
    assert.doesNotMatch(display.primary, /structural\||Ljava\/|opaque-id/, type);
  }
});

test("Snapshot 버전은 실제 조회 결과의 유효한 시각만 표시함", async () => {
  const snapshot = graphFixture();
  snapshot.capturedAt = "invalid-time";
  const responses = [
    { ok: true, json: async () => ({ phase: "COMPLETED", persistedSnapshotPresent: true, persistedCapturedAt: "2026-11-19T03:00:00Z" }) },
    { ok: true, json: async () => snapshot }
  ];
  const { elements } = loadUi({ fetchImpl: () => Promise.resolve(responses.shift()) });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(textOf(elements.get("snapshot-time")), "Snapshot 버전: 확인 불가");
});

test("API 선택 목록에 구조 ID가 이름으로 노출되지 않음", () => {
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  const endpoint = snapshot.nodes.find((node) => node.id === "node-2");
  endpoint.label = "endpoint|opaque|org.example.Api#method(Ljava/lang/String;)V";
  endpoint.attributes = {};
  snapshot.findings = [{ id: "finding", ruleId: "PUBLIC_ENDPOINT", title: "판단", nodeIds: ["node-2"], edgeIds: [], evidenceIds: [] }];
  ui.renderGraph(snapshot);
  ui.selectView("security-detail");
  assert.doesNotMatch(textOf(elements.get("finding-api-select")), /endpoint\|opaque|Ljava|node-2/);
});

test("전체 Flow MAP은 실제 연결 Node만 기본 표시하고 옵션과 보안 MAP 원본을 보존함", () => {
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  snapshot.nodes.push({ id: "orphan-node", type: "HANDLER", serviceId: "orders", label: "고립 Handler", attributes: {}, evidenceIds: [] });
  snapshot.edges.push({ id: "orphan-edge", sourceId: "orphan-node", targetId: "missing-node", type: "FLOWS_TO", attributes: {}, confidence: "CONFIRMED", evidenceIds: [] });
  const original = JSON.stringify(snapshot);

  ui.renderGraph(snapshot);
  assert.equal(ui.state.graph.nodes.some((node) => node.id === "orphan-node"), true);
  assert.equal(ui.state.graph.invalidEdges, 1);
  assert.equal(ui.state.viewGraph.nodes.some((node) => node.id === "orphan-node"), false);
  assert.equal(ui.state.viewGraph.edges.some((edge) => edge.id === "orphan-edge"), false);
  assert.equal(elements.get("unconnected-node-field").hidden, false);

  elements.get("include-unconnected-nodes").checked = true;
  elements.get("include-unconnected-nodes").dispatchEvent({ type: "change" });
  assert.equal(ui.state.viewGraph.nodes.some((node) => node.id === "orphan-node"), true);
  assert.equal(ui.state.viewGraph.edges.some((edge) => edge.id === "orphan-edge"), false);

  elements.get("include-unconnected-nodes").checked = false;
  elements.get("include-unconnected-nodes").dispatchEvent({ type: "change" });
  ui.selectView("security-flow");
  assert.equal(ui.state.viewGraph.nodes.some((node) => node.id === "orphan-node"), true);
  assert.equal(JSON.stringify(snapshot), original);
});

test("상세 취약점 MAP은 선택 Endpoint의 전체 실제 상세 Graph를 표시함", () => {
  const { ui, elements, window } = loadUi();
  const snapshot = detailGraphFixture();
  snapshot.findings = [{ id: "endpoint-flow-finding", ruleId: "PUBLIC_ENDPOINT", title: "API 판단", confidence: "LIKELY", nodeIds: ["endpoint-a"], edgeIds: [], evidenceIds: [], guide: "점검" }];
  const original = JSON.stringify(snapshot);
  const expected = window.MapInBootFlow.deriveEndpointGraph(window.MapInBootGraph.normalize(snapshot), "endpoint-a");
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");

  const marker = findAllByClass(elements.get("graph-nodes"), "finding-marker")[0];
  marker.dispatchEvent({ type: "click" });
  const actual = ui.state.viewGraph;

  assert.equal(ui.state.view, "security-detail");
  assert.deepEqual(Array.from(actual.nodes, (node) => node.id), Array.from(expected.nodes, (node) => node.id));
  assert.deepEqual(Array.from(actual.edges, (edge) => edge.id), Array.from(expected.edges, (edge) => edge.id));
  assert.ok(actual.nodes.some((node) => node.id === "handler-a"));
  assert.ok(actual.nodes.some((node) => node.id === "chain-a"));
  assert.ok(actual.nodes.some((node) => node.id === "security-filter-1"));
  assert.ok(actual.nodes.some((node) => node.id === "authorization-a"));
  assert.ok(actual.nodes.some((node) => node.id === "security-data-a"));
  assert.equal(actual.nodes.some((node) => node.id === "endpoint-b"), false);
  assert.equal(actual.nodes.some((node) => node.id === "chain-b"), false);
  assert.equal(actual.edges.some((edge) => edge.id === "secured-a"), true);
  assert.equal(actual.edges.some((edge) => edge.id === "secured-b"), false);
  assert.equal(JSON.stringify(snapshot), original);
});

test("Finding 영향 섹션은 실제 참조만 감싸고 별도 Modal을 키보드로 열고 닫음", async () => {
  const { ui, elements, layoutCalls } = loadUi();
  const snapshot = detailGraphFixture();
  snapshot.evidence = [{ id: "finding-evidence", source: "STATIC", location: "OrderController#list", summary: "인가 관계 확인" }];
  snapshot.findings = [{
    id: "endpoint-impact", ruleId: "OBJECT_BINDING", title: "객체 인가 확인", description: "인가 대상 확인",
    confidence: "LIKELY", nodeIds: ["endpoint-a", "authorization-a"], edgeIds: ["secured-a"],
    evidenceIds: ["finding-evidence"], guide: "객체 소유자 검증"
  }];
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");
  const marker = findAllByClass(elements.get("graph-nodes"), "finding-marker")[0];
  marker.dispatchEvent({ type: "click" });

  await new Promise((resolve) => setImmediate(resolve));

  const section = findAllByClass(elements.get("graph-finding-sections"), "graph-finding-section")[0];
  assert.ok(section);
  assert.equal(section.getAttribute("data-finding-id"), "endpoint-impact");
  assert.match(section.getAttribute("data-node-ids"), /authorization-a/);
  assert.match(section.getAttribute("data-node-ids"), /handler-a/);
  assert.doesNotMatch(section.getAttribute("data-node-ids"), /security-data-a|endpoint-b/);
  assert.equal(section.getAttribute("role"), "button");
  assert.equal(elements.get("finding-modal").hidden, false);
  assert.equal(elements.get("finding-modal").getAttribute("role"), "dialog");
  assert.equal(elements.get("finding-modal").getAttribute("aria-modal"), "true");
  assert.equal(elements.get("finding-modal-title").textContent, "객체 인가 확인");
  assert.match(textOf(elements.get("finding-modal-content")), /finding-evidence/);
  assert.match(textOf(elements.get("finding-modal-content")), /OrderController#list/);
  assert.match(textOf(elements.get("finding-modal-content")), /객체 소유자 검증/);
  assert.equal(elements.get("inspector").hidden, true);

  const graphNode = findAllByClass(elements.get("graph-nodes"), "graph-node")[0];
  const layoutCount = layoutCalls.length;
  elements.get("finding-modal-close").dispatchEvent({ type: "click" });
  section.dispatchEvent({ type: "keydown", key: "Enter" });
  assert.equal(elements.get("finding-modal").hidden, false);
  assert.equal(findAllByClass(elements.get("graph-nodes"), "graph-node")[0], graphNode);
  assert.equal(layoutCalls.length, layoutCount);
  useHtmlCollectionChildrenTree(elements.get("finding-modal"));
  assert.equal(typeof elements.get("finding-modal").children.forEach, "undefined");
  const focusables = [];
  const collectButtons = (element) => {
    if (element.tagName === "button" && !element.hidden) focusables.push(element);
    Array.from(element.children || []).forEach(collectButtons);
  };
  collectButtons(elements.get("finding-modal"));
  const trap = { type: "keydown", key: "Tab", shiftKey: true };
  focusables[0].dispatchEvent(trap);
  assert.equal(trap.defaultPrevented, true);
  assert.equal(focusables[focusables.length - 1].focused, true);

  elements.get("finding-modal").dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(elements.get("finding-modal").hidden, true);
  assert.equal(section.focused, true);
  assert.equal(ui.state.view, "security-detail");
  assert.equal(ui.state.selectedFindingId, "endpoint-impact");
});

test("HTMLCollection형 SVG 자식에서도 부분 Graph 갱신과 Node·Edge Inspector가 동작함", async () => {
  const { ui, elements, window, layoutCalls } = loadUi();
  ui.renderGraph(detailGraphFixture());
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();
  ui.clearSelection();
  assert.equal(elements.get("inspector").hidden, true);

  useHtmlCollectionChildrenTree(elements.get("graph-nodes"));
  useHtmlCollectionChildrenTree(elements.get("graph-edges"));
  assert.equal(typeof elements.get("graph-nodes").children.forEach, "undefined");
  assert.equal(typeof elements.get("graph-edges").children.forEach, "undefined");
  const originalUpdateState = window.MapInBootGraph.updateState;
  let updateCalls = 0;
  window.MapInBootGraph.updateState = (...args) => {
    updateCalls += 1;
    return originalUpdateState(...args);
  };
  const layoutCount = layoutCalls.length;
  const layoutRequestId = ui.state.layoutRequestId;

  assert.doesNotThrow(() => ui.selectGraphElement("node", "endpoint-a"));
  assert.equal(updateCalls, 1);
  assert.equal(ui.state.selection.kind, "node");
  assert.equal(ui.state.selection.id, "endpoint-a");
  assert.equal(elements.get("inspector").hidden, false);
  assert.equal(elements.get("inspector").getAttribute("data-selection-id"), "endpoint-a");
  assert.match(textOf(elements.get("inspector")), /GET \/orders/);

  assert.doesNotThrow(() => ui.selectGraphElement("node", "handler-a"));
  assert.equal(elements.get("inspector").getAttribute("data-selection-id"), "handler-a");
  assert.doesNotMatch(textOf(elements.get("inspector")), /endpoint-a/);
  assert.doesNotThrow(() => ui.selectGraphElement("edge", "match-a"));
  assert.equal(elements.get("inspector").getAttribute("data-selection-kind"), "edge");
  assert.equal(elements.get("inspector").getAttribute("data-selection-id"), "match-a");
  assert.equal(layoutCalls.length, layoutCount);

  findAllByClass(elements.get("inspector"), "inspector-close")[0].dispatchEvent({ type: "click" });
  assert.equal(elements.get("inspector").hidden, true);
  assert.equal(elements.get("inspector").getAttribute("aria-hidden"), "true");
  assert.equal(ui.state.selectedEndpointId, "endpoint-a");
  assert.equal(ui.state.layoutRequestId, layoutRequestId);
  assert.doesNotThrow(() => ui.selectGraphElement("node", "endpoint-a"));
  assert.equal(elements.get("inspector").hidden, false);
  assert.equal(elements.get("inspector").getAttribute("data-selection-id"), "endpoint-a");
  assert.equal(layoutCalls.length, layoutCount);
});

test("HTMLCollection형 Finding Marker는 선택과 필터 갱신을 유지함", async () => {
  const { ui, elements } = loadUi();
  const snapshot = detailGraphFixture();
  snapshot.findings = [{
    id: "handler-finding", ruleId: "OBJECT_BINDING", title: "Handler 판단", confidence: "CONFIRMED",
    nodeIds: ["handler-a"], edgeIds: ["secured-a"], evidenceIds: [], guide: "인가 대상 점검"
  }];
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");
  await ui.layoutGraph();
  useHtmlCollectionChildrenTree(elements.get("graph-nodes"));
  useHtmlCollectionChildrenTree(elements.get("graph-edges"));

  ui.state.selectedFindingId = "handler-finding";
  assert.doesNotThrow(() => ui.selectGraphElement("node", "handler-a"));
  let marker = findAllByClass(elements.get("graph-nodes"), "finding-marker")
    .find((item) => item.getAttribute("data-finding-id") === "handler-finding");
  assert.ok(marker);
  assert.equal(marker.hidden, false);
  assert.equal(marker.getAttribute("data-selected"), "true");
  assert.equal(marker.getAttribute("aria-pressed"), "true");

  elements.get("finding-confidence").value = "LIKELY";
  assert.doesNotThrow(() => elements.get("finding-confidence").dispatchEvent({ type: "change" }));
  marker = findAllByClass(elements.get("graph-nodes"), "finding-marker")
    .find((item) => item.getAttribute("data-finding-id") === "handler-finding");
  assert.equal(marker.hidden, true);
});

test("Node 선택은 기존 SVG Node와 Edge DOM을 재사용함", () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(graphFixture());
  const node = findAllByClass(elements.get("graph-nodes"), "graph-node")[2];
  const edge = findAllByClass(elements.get("graph-edges"), "graph-edge")[2];
  ui.selectGraphElement("node", node.getAttribute("data-node-id"));
  assert.equal(findAllByClass(elements.get("graph-nodes"), "graph-node")[2], node);
  assert.equal(findAllByClass(elements.get("graph-edges"), "graph-edge")[2], edge);
  assert.equal(node.getAttribute("data-selected"), "true");
});

test("Node·Edge·Finding 근거가 저장 표시 코드를 공유하고 전체 원본 ID를 접어 복사함", async () => {
  const copied = [];
  const { ui, elements } = loadUi({ clipboard: { writeText: async (text) => copied.push(text) } });
  const snapshot = graphFixture();
  const originalId = "a".repeat(64);
  snapshot.evidence = [{ id: originalId, source: "RUNTIME", location: "orders://handler/check", summary: "실제 확인 내용" }];
  snapshot.evidenceDisplayCodes = { [originalId]: "EP-MAPPING-001" };
  snapshot.nodes[2].evidenceIds = [originalId];
  snapshot.edges[3].evidenceIds = [originalId];
  snapshot.findings[0].evidenceIds = [originalId];

  ui.renderGraph(snapshot);
  await ui.layoutGraph();
  ui.selectGraphElement("node", "node-2");

  const inspector = elements.get("inspector");
  const codeIn = (root) => findAllByClass(root, "inspector-evidence-code")[0].textContent;
  const nodeCard = findAllByClass(inspector, "inspector-evidence")[0];
  assert.equal(codeIn(nodeCard), "EP-MAPPING-001");
  const originalPanel = findAllByClass(nodeCard, "inspector-evidence-original")[0];
  const revealOriginal = findAllByClass(nodeCard, "inspector-evidence-toggle")[0];
  assert.equal(originalPanel.hidden, true);
  assert.equal(revealOriginal.attributes["aria-expanded"], "false");
  findAllByClass(nodeCard, "inspector-evidence-copy-code")[0].dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(copied, ["EP-MAPPING-001"]);
  assert.equal(elements.get("shell-notice").textContent, "표시 ID를 복사했습니다.");
  revealOriginal.dispatchEvent({ type: "click" });
  assert.equal(originalPanel.hidden, false);
  assert.equal(revealOriginal.attributes["aria-expanded"], "true");
  assert.equal(findAllByClass(originalPanel, "inspector-evidence-id")[0].textContent, originalId);
  findAllByClass(nodeCard, "inspector-evidence-copy-id")[0].dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(copied, ["EP-MAPPING-001", originalId]);
  assert.equal(elements.get("shell-notice").textContent, "원본 식별자를 복사했습니다.");

  ui.selectGraphElement("edge", "edge-3");
  assert.equal(codeIn(findAllByClass(inspector, "inspector-evidence")[0]), "EP-MAPPING-001");

  const entry = { finding: snapshot.findings[0], nodeIds: ["node-2"], edgeIds: ["edge-3"], missing: false };
  ui.inspector.renderFinding({ graph: ui.state.graph, snapshot, entry, onReturn: () => {}, onOpenEndpoint: () => {} });
  assert.equal(codeIn(findAllByClass(inspector, "inspector-evidence")[0]), "EP-MAPPING-001");
  ui.inspector.renderFindingModal({ graph: ui.state.graph, snapshot, entry, apiLabel: "GET /orders" });
  assert.equal(codeIn(findAllByClass(elements.get("finding-modal-content"), "inspector-evidence")[0]), "EP-MAPPING-001");
});

test("Evidence 누락·구버전 매핑·위치 누락을 구분하고 가짜 표시 ID를 만들지 않음", async () => {
  const copied = [];
  const { ui, elements } = loadUi({ clipboard: { writeText: async (text) => copied.push(text) } });
  const snapshot = graphFixture();
  snapshot.evidence = [
    { id: "mapped-evidence", source: "RUNTIME", location: "", summary: "저장된 근거" },
    { id: "legacy-evidence", source: "RUNTIME", location: "legacy://source", summary: "구버전 근거" }
  ];
  snapshot.evidenceDisplayCodes = { "mapped-evidence": "EV-GENERAL-007" };
  snapshot.nodes[2].evidenceIds = ["mapped-evidence", "missing-reference", "legacy-evidence"];

  ui.renderGraph(snapshot);
  ui.selectGraphElement("node", "node-2");

  const cards = findAllByClass(elements.get("inspector"), "inspector-evidence");
  assert.equal(cards.length, 3);
  assert.match(textOf(cards[0]), /EV-GENERAL-007/);
  assert.match(textOf(cards[0]), /확인 위치 정보 없음/);
  assert.match(textOf(cards[1]), /근거 참조를 확인할 수 없습니다\./);
  assert.match(textOf(cards[2]), /표시 ID가 저장되지 않은 근거입니다\./);
  assert.doesNotMatch(textOf(cards[2]), /EV-[A-Z]+-[0-9]{3}/);
  const originalPanel = findAllByClass(cards[2], "inspector-evidence-original")[0];
  const revealOriginal = findAllByClass(cards[2], "inspector-evidence-toggle")[0];
  assert.equal(originalPanel.hidden, true);
  revealOriginal.dispatchEvent({ type: "click" });
  assert.equal(findAllByClass(originalPanel, "inspector-evidence-id")[0].textContent, "legacy-evidence");
  findAllByClass(originalPanel, "inspector-evidence-copy-id")[0].dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(copied, ["legacy-evidence"]);
});

test("Evidence 복사 권한 오류를 Inspector Toast로 알림", async () => {
  const { ui, elements } = loadUi({ clipboard: { writeText: async () => { throw new Error("denied"); } } });
  const snapshot = graphFixture();
  snapshot.evidenceDisplayCodes = { "evidence-2": "EV-GENERAL-002" };
  ui.renderGraph(snapshot);
  ui.selectGraphElement("node", "node-2");

  findAllByClass(elements.get("inspector"), "inspector-evidence-copy-code")[0].dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(elements.get("shell-notice").dataset.kind, "error");
  assert.match(elements.get("shell-notice").textContent, /클립보드 권한/);
});
