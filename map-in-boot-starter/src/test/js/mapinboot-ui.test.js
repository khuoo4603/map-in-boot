import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const indexHtml = readFileSync("map-in-boot-starter/src/main/resources/static/mapinboot/index.html", "utf8");
const loginHtml = readFileSync("map-in-boot-starter/src/main/resources/static/mapinboot/login.html", "utf8");
const loginScript = readFileSync("map-in-boot-starter/src/main/resources/static/mapinboot/login.js", "utf8");
const appCss = readFileSync("map-in-boot-starter/src/main/resources/static/mapinboot/app.css", "utf8");
const appJs = readFileSync("map-in-boot-starter/src/main/resources/static/mapinboot/app.js", "utf8");
const graphRendererJs = readFileSync("map-in-boot-starter/src/main/resources/static/mapinboot/graph-renderer.js", "utf8");
const spotlightJs = readFileSync("map-in-boot-starter/src/main/resources/static/mapinboot/spotlight.js", "utf8");

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (typeof listener !== "function") return;
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      listeners.set(type, entries.filter((entry) => entry !== listener));
    },
    listenerCount(type) {
      return (listeners.get(type) || []).length;
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

function loadUi({ fetchImpl, authStatusImpl, timers, animationClock, clipboard, includeSpotlight = true } = {}) {
  const ids = [
    "view-title", "view-state", "shell-notice", "help-button", "settings-button", "refresh-button", "logout-button",
    "help-panel", "settings-panel", "settings-close", "setting-show-areas", "setting-show-edge-labels", "setting-show-minimap", "setting-show-detail-flow", "setting-flow-node-duration", "setting-flow-speed",
    "graph-canvas", "map-toolbar",
    "graph-empty", "graph-state-message", "graph-svg", "graph-viewport", "graph-areas", "graph-flow-projection", "graph-guides",
    "graph-edges", "graph-nodes", "graph-finding-section-titles", "service-name", "snapshot-time", "endpoint-search", "endpoint-filter-label", "endpoint-filter-label-text",
    "endpoint-options", "node-filter-field", "node-filter", "edge-filter-field", "edge-filter", "unconnected-node-field", "include-unconnected-nodes", "finding-filter-fields", "finding-rule", "finding-confidence", "finding-list", "finding-api-fields", "finding-api-select", "finding-all-apis", "detail-finding-list", "search-reset", "filter-toggle", "map-filter-panel", "zoom-in", "zoom-out", "fit-graph",
    "reset-view", "screen-lock-toggle", "graph-filter-status", "graph-minimap", "graph-minimap-svg",
    "graph-minimap-nodes", "graph-minimap-viewport", "graph-finding-sections", "finding-modal", "finding-modal-title", "finding-modal-close", "finding-modal-content", "inspector", "graph-popover",
    "finding-modal-confidence", "finding-modal-rule",
    "request-flow-controls", "request-flow-start", "request-flow-pause", "request-flow-reset",
    "request-flow-status", "request-flow-education", "request-flow-dot", "request-flow-details",
    "request-flow-detail-toggle", "request-flow-detail-close", "request-flow-popover-count",
    "request-flow-step-count", "request-flow-step-kind", "request-flow-step-title", "request-flow-step-description",
    "request-flow-filter-education", "request-flow-filter-status", "request-flow-filter-name",
    "request-flow-filter-fqcn", "request-flow-filter-description", "request-flow-filter-role",
    "request-flow-filter-input", "request-flow-filter-condition", "request-flow-filter-processing",
    "request-flow-filter-outcomes", "request-flow-filter-cautions", "request-flow-filter-source",
    "request-flow-navigation", "request-flow-previous", "request-flow-next"
  ];
  const elements = new Map(ids.map((id) => [id, createElement()]));
  const ruleOptions = indexHtml.match(/<select id="finding-rule">([\s\S]*?)<\/select>/)?.[1] || "";
  for (const match of ruleOptions.matchAll(/<option(?:\s+value="([^"]*)")?>([^<]*)<\/option>/g)) {
    const option = createElement("option");
    option.value = match[1] || match[2];
    option.textContent = match[2];
    elements.get("finding-rule").appendChild(option);
  }
  elements.get("help-panel").hidden = true;
  elements.get("settings-panel").hidden = true;
  elements.get("logout-button").hidden = true;
  elements.get("settings-button").append(createElement("span"));
  elements.get("setting-show-areas").checked = true;
  elements.get("setting-show-edge-labels").checked = true;
  elements.get("setting-show-minimap").checked = true;
  elements.get("settings-panel").append(
    elements.get("settings-close"),
    elements.get("setting-show-areas"),
    elements.get("setting-show-edge-labels"),
    elements.get("setting-show-minimap"),
    elements.get("setting-show-detail-flow"),
    elements.get("setting-flow-node-duration"),
    elements.get("setting-flow-speed")
  );
  elements.get("map-filter-panel").hidden = true;
  elements.get("endpoint-options").hidden = true;
  elements.get("request-flow-controls").hidden = true;
  elements.get("request-flow-details").hidden = true;
  elements.get("request-flow-filter-education").hidden = true;
  elements.get("request-flow-navigation").hidden = true;
  elements.get("finding-modal").hidden = true;
  elements.get("finding-modal-title").tagName = "h2";
  elements.get("finding-modal-close").tagName = "button";
  elements.get("finding-modal-content").tagName = "div";
  const findingModalHeader = createElement("header");
  findingModalHeader.setAttribute("class", "finding-modal-header");
  elements.get("finding-modal-confidence").tagName = "span";
  elements.get("finding-modal-rule").tagName = "span";
  findingModalHeader.append(
    elements.get("finding-modal-title"),
    elements.get("finding-modal-confidence"),
    elements.get("finding-modal-rule"),
    elements.get("finding-modal-close")
  );
  elements.get("finding-modal").append(findingModalHeader, elements.get("finding-modal-content"));
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
    body: createElement("body"),
    querySelector(selector) {
      if (selector.startsWith("#")) return elements.get(selector.slice(1));
      if (selector === ".map-toolbar") return elements.get("map-toolbar");
      return createElement();
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
  document.body.parentNode = document;
  document.visibilityState = "visible";
  elements.get("settings-panel").parentNode = document;
  elements.get("settings-button").parentNode = document;
  elements.get("finding-modal").parentNode = document;
  const mapToolbar = elements.get("map-toolbar");
  mapToolbar.setAttribute("class", "graph-tools map-toolbar");
  const filterGroup = createElement("div");
  filterGroup.setAttribute("class", "toolbar-tool-group map-filter-toggle");
  filterGroup.append(elements.get("filter-toggle"));
  mapToolbar.append(
    elements.get("zoom-out"), elements.get("zoom-in"), elements.get("fit-graph"),
    elements.get("reset-view"), filterGroup, elements.get("map-filter-panel")
  );
  elements.get("map-filter-panel").setAttribute("class", "map-filter-panel");
  elements.get("map-filter-panel").append(
    elements.get("endpoint-filter-label"), elements.get("node-filter-field"),
    elements.get("edge-filter-field"), elements.get("unconnected-node-field"),
    elements.get("finding-filter-fields"), elements.get("finding-api-fields")
  );
  elements.get("endpoint-filter-label").append(elements.get("endpoint-search"), elements.get("endpoint-options"));
  elements.get("node-filter-field").append(elements.get("node-filter"));
  elements.get("edge-filter-field").append(elements.get("edge-filter"));
  elements.get("finding-filter-fields").append(
    elements.get("finding-rule"), elements.get("finding-confidence"), elements.get("finding-list")
  );
  elements.get("finding-api-fields").append(
    elements.get("finding-api-select"), elements.get("detail-finding-list")
  );
  document.body.appendChild(mapToolbar);
  let activeFetch = fetchImpl || (() => new Promise(() => {}));
  let activeAuthStatus = authStatusImpl || (() => Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ mode: "NONE", authenticated: false, csrfToken: null })
  }));
  const window = Object.assign(createEventTarget(), {});
  window.location = {
    replacements: [],
    replace(path) { this.replacements.push(path); }
  };
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
    fetch: (url, ...args) => String(url) === "/mapinboot/api/auth/status"
      ? activeAuthStatus(url, ...args)
      : activeFetch(url, ...args),
    setTimeout: timers ? timers.setTimeout : setTimeout,
    clearTimeout: timers ? timers.clearTimeout : clearTimeout,
    performance: animationClock ? { now: () => animationClock.now() } : undefined
  });
  ["graph-flow.js", "request-flow-animation.js", "graph-standard-filters.js", "graph-renderer.js", "graph-inspector.js", "layout-client.js", "graph-navigation.js", ...(includeSpotlight ? ["spotlight.js"] : []), "app.js"].forEach((file) => {
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
    setFetch(fetchFunction) { activeFetch = fetchFunction; },
    setAuthStatus(fetchFunction) { activeAuthStatus = fetchFunction; }
  };
}

test("로그인 Form은 JavaScript가 실행되지 않아도 비밀번호를 URL에 넣지 않음", () => {
  const form = loginHtml.match(/<form\b[^>]*>/i)?.[0] || "";
  assert.match(form, /\bmethod="post"/i);
  assert.match(form, /\baction="\/mapinboot\/api\/auth\/login"/i);
  assert.match(loginScript, /form\.addEventListener\("submit", submitLogin\)/);
  assert.match(loginScript, /event\.preventDefault\(\)/);
});

test("일시적인 인증 상태 조회 실패는 PASSWORD 모드와 로그아웃 표시를 유지함", async () => {
  const authStatus = () => Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ mode: "PASSWORD", authenticated: true, csrfToken: "csrf-token" })
  });
  const { ui, elements, window, setAuthStatus } = loadUi({
    authStatusImpl: authStatus,
    fetchImpl: () => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ phase: "COMPLETED", persistedSnapshotPresent: false })
    })
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(elements.get("logout-button").hidden, false);
  setAuthStatus(() => Promise.reject(new Error("offline")));

  await ui.loadStatus();

  assert.equal(elements.get("logout-button").hidden, false);
  assert.deepEqual(window.location.replacements, []);
});

test("페이지 복귀 중 인증 상태 네트워크 오류는 로그아웃 처리로 오인하지 않음", async () => {
  const { elements, window, setAuthStatus } = loadUi({
    authStatusImpl: () => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ mode: "PASSWORD", authenticated: true, csrfToken: "csrf-token" })
    }),
    fetchImpl: () => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ phase: "COMPLETED", persistedSnapshotPresent: false })
    })
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get("logout-button").hidden, false);
  setAuthStatus(() => Promise.reject(new Error("offline")));

  window.dispatchEvent({ type: "pageshow", persisted: true });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(window.location.replacements, []);
  assert.equal(elements.get("logout-button").hidden, false);
});

test("다른 탭 로그아웃 후 문서 복귀 시 Snapshot·Graph·Finding을 비우고 SDK 진입점으로 이동함", async () => {
  let authenticated = true;
  const { ui, elements, document, window } = loadUi({
    authStatusImpl: () => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ mode: "PASSWORD", authenticated, csrfToken: "csrf-token" })
    }),
    fetchImpl: () => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ phase: "COMPLETED", persistedSnapshotPresent: false })
    })
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const snapshot = graphFixture();
  snapshot.findings = [{
    id: "auth-expired-finding", title: "이전 Finding", ruleId: "CHAIN_MISSING",
    confidence: "UNKNOWN", nodeIds: ["node-2"], edgeIds: [], evidenceIds: ["evidence-2"]
  }];
  ui.state.snapshot = snapshot;
  ui.renderGraph(snapshot);
  ui.state.selectedFindingId = "auth-expired-finding";
  ui.state.selection = { kind: "node", id: "node-2" };
  assert.ok(ui.state.graph.nodes.length > 0);

  authenticated = false;
  document.visibilityState = "hidden";
  document.dispatchEvent({ type: "visibilitychange" });
  document.visibilityState = "visible";
  document.dispatchEvent({ type: "visibilitychange" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(window.location.replacements.at(-1), "/mapinboot/");
  assert.equal(ui.state.snapshot, null);
  assert.equal(ui.state.graph, null);
  assert.equal(ui.state.selection, null);
  assert.equal(ui.state.selectedFindingId, null);
  assert.equal(ui.state.findingIndex.length, 0);
  assert.equal(elements.get("graph-svg").hasAttribute("hidden"), true);
});

function textOf(element) {
  return [element.textContent || "", ...Array.from(element.children || [], textOf)].join(" ");
}

test("Spotlight는 유효한 실제 대상만 탐색하고 Escape에서 도움말로 포커스를 복귀함", () => {
  const { ui, window, document, elements } = loadUi();
  const spotlight = window.MapInBootSpotlight;
  assert.ok(spotlight);

  const hiddenTarget = createElement("button");
  hiddenTarget.hidden = true;
  elements.get("help-button").clientWidth = 100;
  elements.get("help-button").clientHeight = 40;
  elements.get("settings-button").clientWidth = 100;
  elements.get("settings-button").clientHeight = 40;
  assert.equal(spotlight.start([
    { target: hiddenTarget, title: "숨겨진 항목", description: "표시하지 않음" },
    { target: elements.get("help-button"), title: "도움말", description: "현재 요소" },
    { target: elements.get("settings-button"), title: "설정", description: "다음 요소" }
  ]), true);

  assert.equal(spotlight.getState().current, 1);
  assert.equal(spotlight.getState().total, 2);
  const card = findAllByClass(document.body, "spotlight-card")[0];
  assert.equal(findAllByClass(card, "spotlight-skip").length, 0);
  assert.equal(card.getAttribute("role"), "dialog");
  assert.equal(card.getAttribute("aria-modal"), "true");
  assert.equal(card.getAttribute("aria-describedby"), "spotlight-description");
  assert.equal(findAllByClass(card, "spotlight-step-count")[0].textContent, "1 / 2");
  assert.equal(findAllByClass(card, "spotlight-previous")[0].disabled, true);
  assert.equal(findAllByClass(card, "spotlight-next")[0].focused, true);
  const nextButton = findAllByClass(card, "spotlight-next")[0];
  const tab = { type: "keydown", key: "Tab", target: nextButton };
  nextButton.dispatchEvent(tab);
  assert.equal(tab.defaultPrevented, true);
  assert.equal(findAllByClass(card, "spotlight-close")[0].focused, true);
  const outsideTab = { type: "keydown", key: "Tab", target: elements.get("settings-button") };
  elements.get("settings-button").dispatchEvent(outsideTab);
  assert.equal(outsideTab.defaultPrevented, true);
  assert.equal(findAllByClass(card, "spotlight-close")[0].focused, true);

  nextButton.dispatchEvent({ type: "click" });
  assert.equal(spotlight.getState().current, 2);
  assert.equal(findAllByClass(card, "spotlight-next")[0].textContent, "완료");
  findAllByClass(card, "spotlight-previous")[0].dispatchEvent({ type: "click" });
  assert.equal(spotlight.getState().current, 1);
  findAllByClass(card, "spotlight-close")[0].dispatchEvent({ type: "click" });
  assert.equal(spotlight.getState().active, false);
  assert.equal(spotlight.restart(), true);
  document.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(spotlight.getState().active, false);
  assert.equal(elements.get("help-button").focused, true);
  assert.equal(elements.get("help-button").getAttribute("aria-pressed"), "false");

  assert.equal(spotlight.restart(), true);
  const completedNext = findAllByClass(document.body, "spotlight-next")[0];
  completedNext.dispatchEvent({ type: "click" });
  assert.equal(spotlight.getState().current, 2);
  completedNext.dispatchEvent({ type: "click" });
  assert.equal(spotlight.getState().active, false);
  assert.equal(spotlight.restart(), true);
  findAllByClass(document.body, "spotlight-close")[0].dispatchEvent({ type: "click" });
  assert.equal(spotlight.getState().active, false);
  assert.equal(spotlight.restart(), true);
  ui.selectView("security-flow");
  assert.equal(spotlight.getState().active, false);
});

test("Spotlight 자산이 없으면 단순 도움말 목록 대신 원인을 안내함", () => {
  const { elements } = loadUi({ includeSpotlight: false });

  elements.get("help-button").dispatchEvent({ type: "click" });

  assert.equal(elements.get("help-panel").hidden, true);
  assert.match(elements.get("shell-notice").textContent, /화면 안내.*불러오지 못했습니다/);
});

test("도움말 대상 외부에만 딤과 약한 블러를 적용함", () => {
  assert.match(appCss, /\.spotlight-shield\s*\{[^}]*backdrop-filter:\s*blur\(1\.25px\)/);
  assert.match(appCss, /\.spotlight-shield\s*\{[^}]*background:\s*rgba\(0, 0, 0, \.38\)/);
  assert.doesNotMatch(spotlightJs, /spotlight-skip|건너뛰기/);
  assert.doesNotMatch(indexHtml, /settings-notice|설정은 현재 화면에만 적용되며 실제 분석 결과를 변경하지 않습니다\./);
  assert.match(appCss, /\.spotlight-card\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*overflow:\s*auto;/);
  assert.match(appCss, /\.spotlight-description\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/);
});

test("학습 흐름 설정은 Drawer에 기본값과 허용 옵션을 제공하고 안내 문구를 반복하지 않음", () => {
  assert.match(indexHtml, /id="setting-flow-node-duration"[^>]*>[\s\S]*?<option value="1500" selected>1\.5초<\/option>/);
  assert.match(indexHtml, /id="setting-flow-speed"[^>]*>[\s\S]*?<option value="1" selected>1배<\/option>/);
  ["500", "1000", "1500", "2000", "3000", "5000"].forEach((value) => {
    assert.match(indexHtml, new RegExp(`<option value="${value}"`));
  });
  ["0.5", "1", "1.5", "2"].forEach((value) => {
    assert.match(indexHtml, new RegExp(`<option value="${value}"`));
  });
  assert.doesNotMatch(indexHtml, /교육용 예시\s*·\s*실제 요청 추적 아님/);
  assert.match(indexHtml, /요청 처리 흐름/);
  assert.match(indexHtml, /class="request-flow-status" id="request-flow-status" data-state="idle" role="status" aria-live="polite">시작 전/);
  assert.match(appCss, /\.settings-panel\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(appCss, /\.settings-choice select:focus-visible\s*\{[^}]*outline:/);
});

test("필터 패널은 Compact Toolbar 바로 아래에서 같은 너비를 사용함", () => {
  assert.match(indexHtml, /class="graph-tools map-toolbar"[\s\S]*?id="screen-lock-toggle"[\s\S]*?<\/button>\s*<\/div>\s*<\/div>\s*<div class="map-filter-panel"/);
  assert.match(appCss, /\.map-filter-panel\s*\{[^}]*top:\s*100%;/);
  assert.match(appCss, /\.map-filter-panel\s*\{[^}]*left:\s*-1px;[^}]*width:\s*calc\(100% \+ 2px\);[^}]*box-sizing:\s*border-box;/);
  assert.doesNotMatch(appCss, /\.map-filter-panel\[data-view="security-detail"\]/);
});

test("Spotlight는 Resize에서 실제 화면 좌표를 갱신하고 작은 Viewport 안에 카드를 둠", () => {
  const { window, document, elements } = loadUi();
  const spotlight = window.MapInBootSpotlight;
  assert.ok(spotlight);
  window.innerWidth = 800;
  window.innerHeight = 600;
  const bounds = { left: 160, top: 120, right: 260, bottom: 160, width: 100, height: 40 };
  const target = elements.get("help-button");
  target.getBoundingClientRect = () => ({ ...bounds });
  assert.equal(spotlight.start([{ target, title: "도움말", description: "화면 좌표로 강조" }]), true);

  const frame = findAllByClass(document.body, "spotlight-frame")[0];
  const card = findAllByClass(document.body, "spotlight-card")[0];
  card.clientWidth = 340;
  card.clientHeight = 200;
  spotlight.refresh();
  const firstLeft = frame.style.left;
  Object.assign(bounds, { left: 730, top: 560, right: 780, bottom: 590, width: 50, height: 30 });
  window.dispatchEvent({ type: "resize" });

  assert.notEqual(frame.style.left, firstLeft);
  assert.equal(frame.style.left, "722px");
  const cardLeft = Number.parseFloat(card.style.left);
  const cardTop = Number.parseFloat(card.style.top);
  assert.ok(cardLeft >= 12 && cardLeft + 340 <= 788);
  assert.ok(cardTop >= 12 && cardTop + 200 <= 588);
  spotlight.close();

  const firstTarget = elements.get("zoom-in");
  const nextTarget = elements.get("settings-button");
  assert.equal(spotlight.start([
    { target: firstTarget, title: "확대", description: "실제 조작" },
    { target: nextTarget, title: "설정", description: "유효한 다음 대상" }
  ]), true);
  firstTarget.hidden = true;
  spotlight.refresh();
  assert.equal(spotlight.getState().current, 1);
  assert.equal(spotlight.getState().total, 1);
  assert.equal(findAllByClass(document.body, "spotlight-card")[0].children[1].textContent, "설정");
  firstTarget.hidden = false;
  spotlight.close();
});

test("Spotlight 단계 Hook은 필터를 원래 상태로 돌리고 Inspector와 Viewport를 보존함", async () => {
  const { ui, window, document, elements } = loadUi();
  const spotlight = window.MapInBootSpotlight;
  assert.ok(spotlight);
  ui.renderGraph(graphFixture());
  await ui.layoutGraph();
  ui.selectGraphElement("node", "node-2");
  elements.get("inspector").scrollTop = 84;
  ui.state.navigation.panBy(31, -17);
  ui.state.navigation.zoomBy(1.1, 400, 260);
  const before = {
    selection: { ...ui.state.selection },
    inspectorScroll: elements.get("inspector").scrollTop,
    zoom: ui.state.navigation.state.zoom,
    panX: ui.state.navigation.state.panX,
    panY: ui.state.navigation.state.panY
  };
  elements.get("endpoint-search").value = "get /orders";
  const filterWasOpen = !elements.get("map-filter-panel").hidden;
  assert.equal(filterWasOpen, false);

  assert.equal(spotlight.start([{
    target: () => elements.get("map-filter-panel"),
    title: "검색 및 필터",
    description: "필요한 조건을 입력합니다.",
    prepare: () => ui.setFilterPanel(true, false),
    cleanup: () => ui.setFilterPanel(filterWasOpen, false)
  }, {
    target: elements.get("help-button"),
    title: "화면 안내",
    description: "도움말을 다시 누르면 처음으로 돌아갑니다."
  }]), true);
  assert.equal(elements.get("map-filter-panel").hidden, false);
  elements.get("help-button").dispatchEvent({ type: "click" });
  assert.equal(spotlight.getState().current, 1);
  assert.equal(elements.get("map-filter-panel").hidden, false);
  findAllByClass(document.body, "spotlight-shield")[0].dispatchEvent({ type: "click" });
  assert.equal(elements.get("map-filter-panel").hidden, false);
  assert.equal(ui.state.selection.id, before.selection.id);
  document.dispatchEvent({ type: "keydown", key: "Escape" });

  assert.equal(elements.get("map-filter-panel").hidden, true);
  assert.equal(elements.get("endpoint-search").value, "get /orders");
  assert.equal(ui.state.selection.kind, before.selection.kind);
  assert.equal(ui.state.selection.id, before.selection.id);
  assert.equal(elements.get("inspector").hidden, false);
  assert.equal(elements.get("inspector").scrollTop, before.inspectorScroll);
  assert.equal(ui.state.navigation.state.zoom, before.zoom);
  assert.equal(ui.state.navigation.state.panX, before.panX);
  assert.equal(ui.state.navigation.state.panY, before.panY);
});

test("Spotlight는 Finding 모달을 우선하고 Drawer를 닫으며 재시작 리스너를 중복하지 않음", () => {
  const { ui, window, document, elements } = loadUi();
  const spotlight = window.MapInBootSpotlight;
  assert.ok(spotlight);
  const baselineKeydown = document.listenerCount("keydown");
  const baselineResize = window.listenerCount("resize");
  const steps = [
    { target: elements.get("help-button"), title: "도움말", description: "첫 단계" },
    { target: elements.get("settings-button"), title: "설정", description: "둘째 단계" }
  ];

  elements.get("settings-button").dispatchEvent({ type: "click" });
  assert.equal(elements.get("settings-panel").dataset.open, "true");
  assert.equal(spotlight.start(steps), true);
  assert.equal(elements.get("settings-panel").dataset.open, "false");
  assert.equal(elements.get("settings-panel").inert, true);
  assert.equal(spotlight.getState().active, true);
  assert.equal(elements.get("help-button").getAttribute("aria-expanded"), "true");
  assert.equal(elements.get("help-button").getAttribute("aria-controls"), "spotlight-card");
  assert.equal(document.listenerCount("keydown"), baselineKeydown + 1);
  assert.equal(window.listenerCount("resize"), baselineResize + 1);

  spotlight.next();
  elements.get("help-button").dispatchEvent({ type: "click" });
  assert.equal(spotlight.getState().current, 1);
  assert.equal(document.listenerCount("keydown"), baselineKeydown + 1);
  assert.equal(window.listenerCount("resize"), baselineResize + 1);
  assert.ok(Number(elements.get("help-button").style.zIndex) > 60);

  elements.get("settings-button").dispatchEvent({ type: "click" });
  assert.equal(spotlight.getState().active, false);
  assert.equal(elements.get("settings-panel").dataset.open, "true");
  ui.closeSettingsPanel();

  elements.get("finding-modal").hidden = false;
  assert.equal(spotlight.start(steps), false);
  assert.equal(spotlight.getState().active, false);
  elements.get("finding-modal").hidden = true;
  assert.equal(document.listenerCount("keydown"), baselineKeydown);
  assert.equal(window.listenerCount("resize"), baselineResize);
});

test("도움말은 현재 화면의 Spotlight를 시작하고 빈 Graph 요소는 단계에서 제외함", () => {
  const { ui, elements, window } = loadUi();
  const spotlight = window.MapInBootSpotlight;
  ui.renderGraph({ nodes: [], edges: [], evidence: [], findings: [] });

  elements.get("help-button").dispatchEvent({ type: "click" });

  assert.equal(spotlight.getState().active, true);
  assert.equal(spotlight.getState().step.title, "그래프 탐색");
  assert.equal(spotlight.getState().total, 2);
  assert.equal(elements.get("help-panel").hidden, true);
  spotlight.next();
  assert.equal(spotlight.getState().step.title, "검색과 필터");
  assert.equal(elements.get("map-filter-panel").hidden, false);
  spotlight.close();
  assert.equal(elements.get("map-filter-panel").hidden, true);

  ui.selectView("feature-flow");
  assert.equal(ui.state.selectedEndpointId, null);
  elements.get("help-button").dispatchEvent({ type: "click" });
  assert.equal(spotlight.getState().total, 1);
  assert.equal(spotlight.getState().step.title, "분석할 API");
  assert.match(spotlight.getState().step.description, /선택 가능한 Endpoint가 없습니다/);
  assert.equal(ui.state.selectedEndpointId, null);
  spotlight.close();
  assert.equal(ui.state.selectedEndpointId, null);
  assert.equal(elements.get("map-filter-panel").hidden, true);

  ui.selectView("security-flow");
  elements.get("help-button").dispatchEvent({ type: "click" });
  assert.equal(spotlight.getState().total, 1);
  assert.equal(spotlight.getState().step.title, "판단 상태 구분");
  assert.equal(elements.get("map-filter-panel").hidden, false);
  assert.equal(findAllByClass(elements.get("graph-nodes"), "finding-marker").length, 0);
  spotlight.close();
  assert.equal(elements.get("map-filter-panel").hidden, true);

  ui.selectView("security-detail");
  elements.get("help-button").dispatchEvent({ type: "click" });
  assert.equal(spotlight.getState().active, true);
  assert.equal(spotlight.getState().total, 1);
  assert.equal(spotlight.getState().step.title, "보존된 취약점 없음");
  assert.match(spotlight.getState().step.description, /Snapshot에는 Finding이 없습니다/);
  assert.equal(elements.get("finding-modal").hidden, true);
  spotlight.close();
});

test("보안 MAP Spotlight는 좁은 화면의 필터 대상을 드러내고 원래 스크롤 위치를 복원함", () => {
  const { ui, elements, window, document } = loadUi();
  const spotlight = window.MapInBootSpotlight;
  const panel = elements.get("map-filter-panel");
  const fields = elements.get("finding-filter-fields");
  window.innerWidth = 360;
  window.innerHeight = 390;
  ui.selectView("security-flow");

  panel.clientTop = 1;
  panel.clientHeight = 166;
  panel.scrollHeight = 369;
  panel.scrollTop = 0;
  panel.getBoundingClientRect = () => ({ left: 10, top: 193, right: 280, bottom: 361, width: 270, height: 168 });
  fields.clientWidth = 248;
  fields.clientHeight = 122;
  fields.getBoundingClientRect = () => {
    const top = 390 - panel.scrollTop;
    return { left: 21, top, right: 269, bottom: top + 122, width: 248, height: 122 };
  };

  elements.get("help-button").dispatchEvent({ type: "click" });
  assert.equal(spotlight.getState().active, true);
  assert.equal(spotlight.getState().step.title, "판단 상태 구분");
  assert.equal(panel.scrollTop, 152);
  assert.equal(findAllByClass(document.body, "spotlight-card")[0].style.maxHeight, "216px");
  spotlight.close();
  assert.equal(panel.hidden, true);
  assert.equal(panel.scrollTop, 0);

  ui.setFilterPanel(true, false);
  panel.scrollTop = 12;
  elements.get("help-button").dispatchEvent({ type: "click" });
  assert.equal(spotlight.getState().active, true);
  assert.equal(panel.scrollTop, 152);
  spotlight.close();
  assert.equal(panel.hidden, false);
  assert.equal(panel.scrollTop, 12);
});

test("미니맵 표시 설정이 꺼진 경우 Spotlight가 설정을 바꾸지 않고 단계를 제외함", async () => {
  const { ui, elements, window } = loadUi();
  ui.renderGraph(graphFixture());
  await ui.layoutGraph();
  elements.get("setting-show-minimap").checked = false;
  elements.get("setting-show-minimap").dispatchEvent({ type: "change" });

  elements.get("help-button").dispatchEvent({ type: "click" });

  assert.equal(window.MapInBootSpotlight.getState().total, 3);
  assert.equal(ui.state.display.minimap, false);
  assert.equal(ui.navigation.state.minimapVisible, false);
  assert.equal(elements.get("graph-minimap").hidden, true);
  window.MapInBootSpotlight.close();
  assert.equal(ui.state.display.minimap, false);
  assert.equal(elements.get("setting-show-minimap").checked, false);
});

test("화면별 Spotlight는 실제 Snapshot 대상을 강조하고 화면 전환에서 임시 상태를 복원함", async () => {
  const { ui, elements, window } = loadUi();
  const spotlight = window.MapInBootSpotlight;
  const snapshot = standardFilterGraphFixture();
  snapshot.findings = [{
    id: "finding-ui26",
    ruleId: "CHAIN_MISSING",
    title: "체인 연결 판단",
    description: "실제 Finding 설명",
    confidence: "CONFIRMED",
    nodeIds: ["endpoint-a"],
    edgeIds: ["match-a"],
    evidenceIds: ["evidence-endpoint-a"],
    guide: "체인 설정과 매칭 경로를 확인하세요."
  }];
  const evidenceIds = new Set([...snapshot.nodes, ...snapshot.edges].flatMap((item) => item.evidenceIds || []));
  snapshot.evidence = [...evidenceIds].map((id) => ({
    id,
    source: "RUNTIME",
    summary: "UI-26 테스트 Snapshot 근거",
    location: `orders://evidence/${id}`
  }));
  snapshot.evidenceDisplayCodes = { "evidence-endpoint-a": "EP-UI26-001" };
  ui.renderGraph(snapshot);
  await ui.layoutGraph();
  ui.selectGraphElement("node", "endpoint-a");
  elements.get("endpoint-search").value = "orders";

  elements.get("help-button").dispatchEvent({ type: "click" });
  assert.equal(spotlight.getState().total, 5);
  assert.equal(spotlight.getState().step.title, "그래프 탐색");
  assert.equal(elements.get("map-toolbar").children.length, 6);
  spotlight.next();
  assert.equal(elements.get("map-filter-panel").hidden, false);
  spotlight.close();
  assert.equal(elements.get("map-filter-panel").hidden, true);
  assert.equal(elements.get("endpoint-search").value, "orders");
  assert.equal(ui.state.selection.id, "endpoint-a");

  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();
  const educationIndex = ui.state.requestFlowSteps.findIndex((step) => step.filterEducation);
  assert.ok(educationIndex >= 0);
  assert.equal(ui.requestFlow.seekToStep(educationIndex), true);
  assert.equal(elements.get("request-flow-detail-toggle").disabled, false);
  const endpointInputBefore = {
    value: elements.get("endpoint-search").value,
    expanded: elements.get("endpoint-search").getAttribute("aria-expanded"),
    optionsHidden: elements.get("endpoint-options").hidden
  };

  elements.get("help-button").dispatchEvent({ type: "click" });
  assert.equal(spotlight.getState().total, 5);
  assert.equal(spotlight.getState().step.title, "분석할 API");
  assert.equal(elements.get("map-filter-panel").hidden, false);
  assert.equal(elements.get("endpoint-search").value, endpointInputBefore.value);
  assert.equal(elements.get("endpoint-search").getAttribute("aria-expanded"), endpointInputBefore.expanded);
  assert.equal(elements.get("endpoint-options").hidden, endpointInputBefore.optionsHidden);
  spotlight.next();
  assert.equal(spotlight.getState().step.title, "적용된 보안 체인");
  assert.match(spotlight.getState().step.description, /Servlet Filter 등록과 SecurityFilterChain 내부 Filter 구성은 구분/);
  assert.equal(elements.get("map-filter-panel").hidden, true);
  spotlight.next();
  assert.match(spotlight.getState().step.description, /SecurityContext에는 현재 Authentication이 담기고, HttpServletRequest는 HTTP 요청 객체/);
  assert.equal(ui.state.selection.id, "endpoint-a");

  elements.get("help-button").dispatchEvent({ type: "click" });
  assert.equal(spotlight.getState().current, 1);
  assert.equal(elements.get("map-filter-panel").hidden, false);

  ui.selectView("security-flow");
  assert.equal(spotlight.getState().active, false);
  assert.equal(elements.get("map-filter-panel").hidden, true);
  await ui.layoutGraph();
  elements.get("help-button").dispatchEvent({ type: "click" });
  assert.equal(spotlight.getState().total, 4);
  assert.equal(spotlight.getState().step.title, "발견된 보안 문제");
  spotlight.next();
  assert.match(spotlight.getState().step.description, /CONFIRMED는 근거가 확인된 분석 판단/);
  assert.match(spotlight.getState().step.description, /UNKNOWN은 근거 부족/);
  elements.get("help-button").dispatchEvent({ type: "click" });
  assert.equal(spotlight.getState().current, 1);
  assert.equal(spotlight.getState().step.title, "발견된 보안 문제");
  spotlight.close();

  ui.selectView("security-detail");
  await ui.layoutGraph();
  ui.selectGraphElement("node", "endpoint-a");
  elements.get("inspector").scrollTop = 52;
  const viewportBefore = {
    zoom: ui.state.navigation.state.zoom,
    panX: ui.state.navigation.state.panX,
    panY: ui.state.navigation.state.panY
  };
  elements.get("help-button").dispatchEvent({ type: "click" });
  assert.equal(spotlight.getState().total, 4);
  assert.equal(spotlight.getState().step.title, "판단 내용");
  assert.equal(elements.get("inspector").getAttribute("data-selection-kind"), "finding");
  spotlight.next();
  const evidenceCard = findAllByClass(elements.get("inspector"), "inspector-evidence")[0];
  assert.ok(evidenceCard);
  assert.match(textOf(evidenceCard), /EP-UI26-001/);
  spotlight.next();
  assert.match(textOf(spotlight.getState().step.target()), /체인 설정과 매칭 경로/);
  spotlight.next();
  assert.ok(spotlight.getState().step.target().getAttribute("data-node-id")
    || spotlight.getState().step.target().getAttribute("data-edge-id"));
  spotlight.close();
  assert.equal(elements.get("inspector").hidden, false);
  assert.equal(elements.get("inspector").scrollTop, 52);
  assert.equal(ui.state.selection.kind, "node");
  assert.equal(ui.state.selection.id, "endpoint-a");
  assert.equal(elements.get("inspector").getAttribute("data-selection-id"), "endpoint-a");
  assert.deepEqual({
    zoom: ui.state.navigation.state.zoom,
    panX: ui.state.navigation.state.panX,
    panY: ui.state.navigation.state.panY
  }, viewportBefore);
});

test("상세 Finding 도움말은 Evidence와 가이드가 없는 단계만 번호에서 제외함", async () => {
  const { ui, elements, window } = loadUi();
  const snapshot = graphFixture();
  snapshot.evidence = [];
  snapshot.findings[0].guide = "";
  ui.renderGraph(snapshot);
  ui.selectView("security-detail");
  await ui.layoutGraph();

  elements.get("help-button").dispatchEvent({ type: "click" });

  assert.equal(window.MapInBootSpotlight.getState().total, 2);
  assert.equal(window.MapInBootSpotlight.getState().step.title, "판단 내용");
  window.MapInBootSpotlight.next();
  assert.equal(window.MapInBootSpotlight.getState().current, 2);
  assert.equal(window.MapInBootSpotlight.getState().total, 2);
  assert.equal(window.MapInBootSpotlight.getState().step.title, "관련 위치 이동");
  window.MapInBootSpotlight.close();
  assert.equal(elements.get("inspector").hidden, true);
});

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
  assert.match(nodeMarkers.find((marker) => /복합 Finding/.test(marker.getAttribute("aria-label")))
    .children.find((child) => child.tagName === "title").textContent,
  /복합 Finding.*보안 체인·매칭 우선순위 문제.*검토 필요/);
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
  assert.match(textOf(elements.get("view-state")), /부분 분석.*보존 Snapshot 있음/);
  const modalText = textOf(elements.get("finding-modal"));
  ["갱신된 판단", "판단 불가", "갱신된 설명", "runtime evidence 7", "갱신된 가이드"]
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
  const unresolved = ui.state.layout.plan.overviewRouting.unresolved.length;
  assert.equal(elements.get("shell-notice").textContent,
    unresolved ? `표시할 수 없는 관계 ${unresolved}건 · Inspector에서 원본 근거 확인` : "");
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
  assert.equal(elements.get("finding-modal-rule").textContent, "진단 유형 · 보안 필터 체인 미적용");
  assert.equal(elements.get("finding-modal-confidence").textContent, "판단 불가");
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
  assert.doesNotMatch(textOf(elements.get("finding-modal-content")), /evidence-7/);
  assert.match(textOf(elements.get("finding-modal-content")), /실행 환경/);
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
  assert.match(textOf(elements.get("finding-modal")), /코드 분석/);
  assert.doesNotMatch(textOf(elements.get("finding-modal")), /CODE_PATTERN/);
  const originalNode = findAllByClass(elements.get("finding-modal"), "inspector-link")
    .find((button) => button.attributes["data-node-id"] === "authorization-a");
  assert.ok(originalNode);
  originalNode.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selection.kind, "node");
  assert.equal(ui.state.selection.id, "authorization-a");
  assert.equal(elements.get("finding-modal").hidden, false);
  assert.match(textOf(elements.get("inspector")), /노드 ID SC-AUTH-001/);
  assert.match(textOf(elements.get("inspector")), /확인되지 않은 속성 1 ROLE/);
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
  assert.match(markers[1].getAttribute("aria-label"), /판단 1.*보안 필터 체인 미적용.*검토 필요/);
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
  const { ui, elements, window } = loadUi();
  const snapshot = graphFixture();
  const rules = ["CHAIN_MISSING", "CHAIN_ORDER", "PUBLIC_ENDPOINT", "METHOD_MISMATCH", "FILTER_ORDER", "OBJECT_BINDING", "STATE_BYPASS", "EXTRA_RULE"];
  snapshot.findings = rules.map((ruleId) => ({ id: ruleId, title: "유형 확인", ruleId, confidence: "UNKNOWN", nodeIds: ["node-2"], edgeIds: [] }));
  const original = JSON.stringify(snapshot);
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");
  for (const ruleId of rules) {
    elements.get("finding-rule").value = ruleId;
    elements.get("finding-rule").dispatchEvent({ type: "change" });
    const markers = findAllByClass(elements.get("graph-nodes"), "finding-marker").filter((marker) => !marker.hidden);
    assert.equal(markers.length, 1);
    const label = window.MapInBootGraph.findingRuleLabel(ruleId);
    assert.match(markers[0].getAttribute("aria-label"), new RegExp(label));
    assert.doesNotMatch(markers[0].getAttribute("aria-label"), new RegExp(ruleId));
  }
  const extraRule = elements.get("finding-rule").children.find((option) => option.value === "EXTRA_RULE");
  assert.ok(extraRule);
  assert.equal(extraRule.textContent, "기타 진단 유형 1");
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
  rules.slice(0, 7).forEach((ruleId) => {
    assert.ok(indexHtml.includes(`<option value="${ruleId}">`));
    assert.equal(elements.get("finding-rule").children.find((option) => option.value === ruleId).textContent,
      window.MapInBootGraph.findingRuleLabel(ruleId));
  });
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
  assert.match(textOf(elements.get("finding-modal")), /RL-FILTER-001/);
  assert.doesNotMatch(textOf(elements.get("finding-modal")), /edge-2/);
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

function routedSegmentPath(ui, elements, mappingName, sourceId) {
  const displayModel = ui.state.layout.plan.displayModel;
  const segmentIds = displayModel[mappingName]?.[sourceId] || [];
  const pending = [elements.get("graph-edges"), elements.get("graph-nodes"), elements.get("graph-flow-projection")]
    .filter(Boolean);
  const paths = [];
  while (pending.length) {
    const element = pending.shift();
    if (element.tagName === "path") paths.push(element);
    pending.push(...Array.from(element.children || []));
  }
  const byId = new Map(paths.filter((path) => path.getAttribute("data-segment-id"))
    .map((path) => [path.getAttribute("data-segment-id"), path]));
  return segmentIds.map((id) => byId.get(id)).find(Boolean);
}

// 실제 Snapshot을 화면별 Node 렌더링 경로에 적용하는 선택 검증
const actualSnapshotTargets = process.env.MAPINBOOT_SNAPSHOT_URLS
  ? JSON.parse(process.env.MAPINBOOT_SNAPSHOT_URLS)
  : [];

const logGraphMetrics = (name, view, layout, elements) => {
  const routing = layout.plan.overviewRouting;
  const point = ({ x, y }) => `${x.toFixed(3)},${y.toFixed(3)}`;
  const geometryKey = (segment) => {
    const controls = segment.geometry?.controlPoints || [];
    const forward = `${point(segment.from)}>${point(segment.to)}:${controls.map(point).join(";")}`;
    const reverse = `${point(segment.to)}>${point(segment.from)}:${controls.slice().reverse().map(point).join(";")}`;
    return forward < reverse ? forward : reverse;
  };
  const paths = new Set([
    ...findAllByClass(elements.get("graph-edges"), "graph-edge"),
    ...findAllByClass(elements.get("graph-edges"), "graph-guide-handler"),
    ...findAllByClass(elements.get("graph-edges"), "graph-projection-edge"),
    ...findAllByClass(elements.get("graph-edges"), "runtime-blueprint-edge"),
    ...findAllByClass(elements.get("graph-nodes"), "graph-learning-segment")
  ]);
  const geometryGroups = new Map();
  routing.segments.forEach((segment) => {
    const key = geometryKey(segment);
    const group = geometryGroups.get(key) || [];
    group.push(segment);
    geometryGroups.set(key, group);
  });
  const duplicateGeometryGroups = Array.from(geometryGroups.values()).filter((group) => group.length > 1);
  const relationPairs = new Map();
  routing.relations.forEach((relation) => {
    const key = `${relation.sourceItemId}>${relation.targetItemId}`;
    const group = relationPairs.get(key) || [];
    group.push(relation);
    relationPairs.set(key, group);
  });
  const duplicateRelationPairs = Array.from(relationPairs.values()).filter((group) => group.length > 1);
  const sameSemanticDuplicatePairs = duplicateRelationPairs.filter((group) => {
    const semanticKeys = group.map((relation) => JSON.stringify([
      relation.role, relation.type, relation.semanticFlowGroup || null
    ]));
    return new Set(semanticKeys).size < semanticKeys.length;
  });
  const crossSourceDuplicatePairs = duplicateRelationPairs.filter((group) => new Set(group.map((relation) =>
    relation.originalEdgeIds?.length ? "GRAPH" : relation.runtimeRelationshipIds?.length ? "RUNTIME"
      : relation.projectionEdgeIds?.length ? "PROJECTION" : "OTHER")).size > 1);
  const metrics = { name, view, relations: routing.relations.length,
    paths: paths.size, segments: routing.segments.length,
    duplicateGeometry: routing.segments.length - geometryGroups.size,
    unresolved: routing.unresolved.length,
    duplicateRelationPairs: duplicateRelationPairs.length, crossSourceDuplicatePairs: crossSourceDuplicatePairs.length,
    sameSemanticDuplicatePairs: ["feature-flow", "security-detail"].includes(view)
      ? sameSemanticDuplicatePairs.length : null,
    relationSources: routing.relations.reduce((counts, relation) => {
      const source = relation.originalEdgeIds?.length ? "GRAPH" : relation.runtimeRelationshipIds?.length ? "RUNTIME"
        : relation.projectionEdgeIds?.length ? "PROJECTION" : "OTHER";
      counts[source] = (counts[source] || 0) + 1;
      return counts;
    }, {}),
    duplicateRoles: duplicateGeometryGroups.slice(0, 3).map((group) => group.map((segment) => ({ role: segment.routeRole,
      relations: segment.relationIds.map((id) => routing.relations.find((relation) => relation.id === id))
        .filter(Boolean).map((relation) => `${relation.role}/${relation.type}/${relation.presentationKind}`) }))) };
  console.log("GRAPH_METRICS", JSON.stringify(metrics));
  if (metrics.sameSemanticDuplicatePairs !== null) assert.equal(metrics.sameSemanticDuplicatePairs, 0,
    `${name}/${view}: 같은 의미의 표시 관계 중복`);
  return metrics;
};

const assertSolidConnectionPaths = (name, elements) => {
  const paths = ["graph-edges", "graph-nodes"].flatMap((layer) => [
    ...findAllByClass(elements.get(layer), "graph-edge"),
    ...findAllByClass(elements.get(layer), "graph-guide-handler"),
    ...findAllByClass(elements.get(layer), "graph-projection-edge"),
    ...findAllByClass(elements.get(layer), "runtime-blueprint-edge"),
    ...findAllByClass(elements.get(layer), "graph-learning-segment")
  ]);
  paths.forEach((path) => assert.ok([null, undefined, "none"].includes(path.getAttribute("stroke-dasharray")),
    `${name}: ${path.getAttribute("class")} 연결선은 실선`));
};

if (actualSnapshotTargets.length > 0) {
  test("실제 Snapshot v2를 네 화면과 상세 Blueprint에서 렌더링함", async () => {
    const assertDetailGeometry = (name, snapshot, plan, elements) => {
      const blueprint = plan.detailBlueprint;
      const model = plan.displayModel;
      const routing = plan.overviewRouting;
      assert.ok(blueprint && model && routing, name + ": 상세 표시 모델");
      assert.deepEqual(Array.from(routing.unresolved), [], name + ": 미해결 관계");
      assert.ok(blueprint.cards.every((card) => card.bounds.width >= 380 && card.bounds.width <= 560),
        name + ": 카드 너비");
      const renderedItems = findAllByClass(elements.get("graph-nodes"), "graph-composite-item");
      const regions = new Map(blueprint.regions.map((region) => [region.id, region]));
      blueprint.cards.forEach((card, index) => {
        assert.ok(card.bounds.x >= blueprint.bounds.x && card.bounds.y >= blueprint.bounds.y
          && card.bounds.right <= blueprint.bounds.right && card.bounds.bottom <= blueprint.bounds.bottom,
        name + ": 전체 Bounds 안의 카드 " + card.id);
        if (card.regionId) {
          const region = regions.get(card.regionId);
          assert.ok(region, name + ": 카드 영역 " + card.id);
          assert.ok(card.bounds.x >= region.bounds.x && card.bounds.y >= region.bounds.y
            && card.bounds.right <= region.bounds.right && card.bounds.bottom <= region.bounds.bottom,
          name + ": 영역 안의 카드 " + card.id);
        }
        blueprint.cards.slice(index + 1).forEach((next) => {
          const overlaps = card.bounds.x < next.bounds.right && card.bounds.right > next.bounds.x
            && card.bounds.y < next.bounds.bottom && card.bounds.bottom > next.bounds.y;
          assert.equal(overlaps, false, name + ": 겹치는 카드 " + card.id + "/" + next.id);
        });
        card.items.forEach((item, index) => {
          assert.equal(card.itemBoundsById[item.id], item.bounds, name + ": Item Bounds 참조 " + item.id);
          assert.ok(item.bounds.x >= card.bounds.x && item.bounds.y >= card.headerBounds.y + card.headerBounds.height
            && item.bounds.right <= card.bounds.right && item.bounds.bottom <= card.bounds.bottom,
          name + ": 카드 안의 Item " + item.id);
          const row = renderedItems.find((element) => element.getAttribute("data-composite-item-id") === item.id);
          assert.ok(row, name + ": 렌더링된 Item " + item.id);
          if (index > 0) {
            const separator = findAllByClass(row, "graph-composite-item-separator")[0];
            assert.equal(Number(separator?.getAttribute("x2")), item.bounds.width - 10,
              name + ": Item 너비 기준 구분선 " + item.id);
          }
          (item.inputPortIds || []).concat(item.outputPortIds || []).forEach((id) => {
            const definition = model.portById[id];
            const renderedPort = findAllByClass(row, "graph-composite-port")
              .find((element) => element.getAttribute("data-port-ids") === id);
            assert.ok(renderedPort, name + ": 렌더링된 Port " + id);
            assert.equal(Number(renderedPort.getAttribute("cx")), definition.x - item.bounds.x,
              name + ": Item 기준 Port X " + id);
            assert.equal(Number(renderedPort.getAttribute("cy")), definition.y - item.bounds.y,
              name + ": Item 기준 Port Y " + id);
            if (definition.side === "LEFT") assert.equal(definition.x, card.bounds.x);
            if (definition.side === "RIGHT") assert.equal(definition.x, card.bounds.right);
            if (definition.side === "TOP") assert.equal(definition.y, card.bounds.y);
            if (definition.side === "BOTTOM") assert.equal(definition.y, card.bounds.bottom);
          });
        });
      });
      blueprint.regions.forEach((region) => {
        if (!region.parentId) return;
        const parent = regions.get(region.parentId);
        assert.ok(parent, name + ": 영역 부모 " + region.id);
        assert.ok(region.bounds.x >= parent.bounds.x && region.bounds.y >= parent.bounds.y
          && region.bounds.right <= parent.bounds.right && region.bounds.bottom <= parent.bounds.bottom,
        name + ": 부모 영역 안의 자식 " + region.id);
      });
      const security = regions.get("runtime-region:security");
      const mvc = regions.get("runtime-region:mvc");
      if (security && mvc) assert.ok(mvc.bounds.x - security.bounds.right >= 0,
        name + ": Security와 MVC 영역 간격");
      const segmentById = new Map(routing.segments.map((segment) => [segment.id, segment]));
      routing.relations.filter((relation) => !relation.internalCardId && !relation.referenceOnly).forEach((relation) => {
        assert.equal(relation.visualDirection, "ORIGINAL", name + ": 원본 관계 방향 " + relation.id);
        const route = routing.routesByRelationId[relation.id];
        assert.ok(route && route.orderedSegmentIds.length, name + ": 실제 관계 배선 " + relation.id);
        let point = route.sourcePort;
        route.orderedSegmentIds.forEach((id) => {
          const segment = segmentById.get(id);
          assert.ok(segment?.relationIds.includes(relation.id), name + ": 관계 Segment " + relation.id);
          if (point.x === segment.from.x && point.y === segment.from.y) point = segment.to;
          else if (point.x === segment.to.x && point.y === segment.to.y) point = segment.from;
          else assert.fail(name + ": 연속되지 않은 Segment " + relation.id);
        });
        assert.equal(point.x, route.targetPort.x, name + ": Route 끝 X " + relation.id);
        assert.equal(point.y, route.targetPort.y, name + ": Route 끝 Y " + relation.id);
      });
      routing.segments.filter((segment) => segment.routeRole === "LEARNING_INTERNAL").forEach((segment) => {
        const card = model.cardById[segment.internalCardId];
        assert.ok(card, name + ": 내부 흐름 카드 " + segment.id);
        const relation = routing.relations.find((item) => item.internalCardId === card.id
          && item.id === segment.relationIds[0]);
        assert.ok(relation, name + ": 내부 흐름 표시 관계 " + segment.id);
        const sourcePort = model.portById[relation.visualSourcePortId];
        const targetPort = model.portById[relation.visualTargetPortId];
        assert.ok(sourcePort && targetPort, name + ": 실제 Item Port " + segment.id);
        assert.deepEqual([segment.from.x, segment.from.y], [sourcePort.x, sourcePort.y],
          name + ": 실제 Source Port 연결 " + segment.id);
        assert.deepEqual([segment.to.x, segment.to.y], [targetPort.x, targetPort.y],
          name + ": 실제 Target Port 연결 " + segment.id);
        const renderedCard = findAllByClass(elements.get("graph-nodes"), "graph-composite-card")
          .find((element) => element.getAttribute("data-composite-card-id") === card.id);
        const path = findAllByClass(renderedCard, "graph-learning-segment")
          .find((element) => element.getAttribute("data-segment-id") === segment.id);
        assert.ok(path, name + ": 내부 학습 Segment SVG " + segment.id);
        const start = /^M\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(path.getAttribute("d"));
        assert.ok(start, name + ": 내부 흐름 SVG 시작 좌표 " + segment.id);
        assert.deepEqual([Number(start[1]), Number(start[2])],
          [segment.from.x - card.bounds.x, segment.from.y - card.bounds.y],
          name + ": 실제 Port 기준 SVG 로컬 좌표 " + segment.id);
      });
      const flows = snapshot.edges.filter((edge) => edge.type === "FLOWS_TO");
      flows.forEach((edge) => {
        const sourceId = model.originalNodeToCardIds[edge.sourceId]?.[0];
        const targetId = model.originalNodeToCardIds[edge.targetId]?.[0];
        if (sourceId && targetId) assert.ok(model.cardById[targetId].bounds.y > model.cardById[sourceId].bounds.y,
          name + ": 아래 방향 API 처리 " + edge.id);
      });
    };
    for (const target of actualSnapshotTargets) {
      assert.ok(target.name && target.url, "Snapshot 대상의 이름과 URL 필요");
      const response = await fetch(target.url);
      assert.equal(response.status, 200, `${target.name}: Snapshot HTTP 상태`);
      const snapshot = await response.json();
      assert.equal(snapshot.schemaVersion, "2", `${target.name}: Snapshot schemaVersion`);
      assert.ok(snapshot.runtimeArchitecture && typeof snapshot.runtimeArchitecture === "object",
        `${target.name}: RuntimeArchitecture 존재`);
      assert.ok(Array.isArray(snapshot.runtimeArchitecture.components), `${target.name}: Runtime 구성 요소 목록`);
      assert.ok(Array.isArray(snapshot.runtimeArchitecture.relationships), `${target.name}: Runtime 관계 목록`);
      assert.ok(Array.isArray(snapshot.runtimeArchitecture.coverage), `${target.name}: Runtime Coverage 목록`);
      const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
      const componentIds = new Set(snapshot.runtimeArchitecture.components.map((component) => component.id));
      assert.equal(nodeById.size, snapshot.nodes.length, `${target.name}: 중복 Graph Node ID`);
      assert.equal(componentIds.size, snapshot.runtimeArchitecture.components.length, `${target.name}: 중복 Runtime Component ID`);
      snapshot.runtimeArchitecture.relationships.forEach((relation) => {
        assert.ok(componentIds.has(relation.sourceId) && componentIds.has(relation.targetId),
          `${target.name}: Runtime 관계 참조 ${relation.id}`);
      });
      snapshot.runtimeArchitecture.components.forEach((component) => {
        (component.graphNodeIds || []).forEach((id) => assert.ok(nodeById.has(id),
          `${target.name}: Runtime Graph 참조 ${component.id} -> ${id}`));
      });
      snapshot.edges.filter((edge) => edge.type === "FLOWS_TO").forEach((edge) => {
        assert.equal(nodeById.get(edge.sourceId)?.type, "ENDPOINT", `${target.name}: FLOWS_TO 출발 Node ${edge.id}`);
        assert.equal(nodeById.get(edge.targetId)?.type, "HANDLER", `${target.name}: FLOWS_TO 도착 Node ${edge.id}`);
      });

      const { ui, elements } = loadUi();
      ui.renderGraph(snapshot);
      const filtersByChain = new Map();
      snapshot.edges.filter((edge) => edge.type === "FILTERED_BY" && edge.confidence === "CONFIRMED")
        .forEach((edge) => {
          if (nodeById.get(edge.sourceId)?.type !== "SECURITY_CHAIN") return;
          const filterIds = filtersByChain.get(edge.sourceId) || [];
          filterIds.push(edge.targetId);
          filtersByChain.set(edge.sourceId, filterIds);
        });
      const handlerByEndpoint = new Map(snapshot.edges.filter((edge) => edge.type === "FLOWS_TO")
        .map((edge) => [edge.sourceId, edge.targetId]));
      const securedHandlers = new Set(snapshot.edges.filter((edge) => edge.type === "SECURED_BY")
        .map((edge) => edge.sourceId));
      const endpointMatches = snapshot.edges.filter((edge) => edge.type === "MATCHED_BY"
        && edge.confidence === "CONFIRMED" && nodeById.get(edge.sourceId)?.type === "ENDPOINT"
        && nodeById.get(edge.targetId)?.type === "SECURITY_CHAIN").sort((left, right) =>
        (filtersByChain.get(right.targetId)?.length || 0) - (filtersByChain.get(left.targetId)?.length || 0)
          || Number(securedHandlers.has(handlerByEndpoint.get(right.sourceId)))
            - Number(securedHandlers.has(handlerByEndpoint.get(left.sourceId)))
          || left.sourceId.localeCompare(right.sourceId));
      for (const view of ["all-flow", "feature-flow", "security-flow"]) {
        ui.selectView(view);
        await ui.layoutGraph();
        assert.ok(ui.state.layout, `${target.name}: ${view} Layout 생성`);
        assertSolidConnectionPaths(`${target.name} ${view}`, elements);
        if (view !== "feature-flow") {
          const metrics = logGraphMetrics(target.name, view, ui.state.layout, elements);
          assert.equal(metrics.duplicateGeometry, 0, `${target.name} ${view}: 중복 물리 Geometry`);
        }
      }

      ui.selectView("security-detail");
      await ui.layoutGraph();
      assert.equal(ui.state.view, "security-detail", `${target.name}: 상세 취약점 화면 진입`);
      assertSolidConnectionPaths(`${target.name} security-detail`, elements);

      const endpointMatch = endpointMatches[0];
      const endpoint = endpointMatch ? nodeById.get(endpointMatch.sourceId)
        : snapshot.nodes.find((node) => node.type === "ENDPOINT");
      const selectedChainId = endpointMatch?.targetId || null;
      if (endpoint) {
        ui.openEndpointDetail(endpoint.id);
        await ui.layoutGraph();
        const metrics = logGraphMetrics(target.name, "feature-flow", ui.state.layout, elements);
        assert.equal(metrics.duplicateGeometry, 0, `${target.name} feature-flow: 중복 물리 Geometry`);
        assertDetailGeometry(target.name + " 기능별 상세", snapshot, ui.state.layout.plan, elements);
        const detailPlan = ui.state.layout.plan;
        const endpointItemId = detailPlan.displayModel.originalNodeToItemIds[endpoint.id]?.[0];
        const endpointRow = findAllByClass(elements.get("graph-nodes"), "graph-composite-item")
          .find((element) => element.getAttribute("data-composite-item-id") === endpointItemId);
        assert.ok(endpointRow, target.name + ": 실제 Endpoint Item");
        endpointRow.dispatchEvent({ type: "click" });
        assert.equal(elements.get("inspector").hidden, false, target.name + ": 실제 Endpoint Inspector");
        if (selectedChainId) {
          const chainCard = compositeCardForNode(detailPlan, selectedChainId, "SECURITY_CHAIN");
          const displayedFilters = chainCard.originalNodeIds.filter((id) => nodeById.get(id)?.type === "FILTER");
          assert.equal(displayedFilters.length, filtersByChain.get(selectedChainId)?.length || 0,
            target.name + ": 확인된 보안 Filter 순서 보존");
        }
        const resolvers = detailPlan.detailBlueprint.runtimeComponents
          .filter((component) => component.kind === "ARGUMENT_RESOLVER");
        if (snapshot.runtimeArchitecture.components.some((component) => component.kind === "ARGUMENT_RESOLVER")) {
          assert.ok(resolvers.length > 1, target.name + ": 여러 ArgumentResolver 포함");
          const displayedResolverIds = detailPlan.detailBlueprint.cards
            .filter((card) => card.kind === "MVC_ARGUMENT_RESOLVERS")
            .flatMap((card) => card.runtimeComponentIds);
          assert.equal(displayedResolverIds.length, 0, target.name + ": 등록용 ArgumentResolver 전용 카드 제거");
          assert.ok(resolvers.every((component) => snapshot.runtimeArchitecture.components.some((original) => original.id === component.id)),
            target.name + ": ArgumentResolver 원본 Runtime 구성 보존");
          const adapter = detailPlan.detailBlueprint.runtimeComponents.find((component) => component.kind === "HANDLER_ADAPTER");
          assert.ok(adapter, target.name + ": 실제 HandlerAdapter 구성 확인");
          ui.selectGraphElement("runtime-component", adapter.id);
          assert.match(textOf(elements.get("inspector")), /ARGUMENT_RESOLVER/,
            target.name + ": ArgumentResolver 등록 정보는 HandlerAdapter Inspector에 표시");
        }
        assert.ok(ui.state.layout.plan.detailBlueprint, `${target.name}: 기능 상세 Blueprint 생성`);
      }

      ui.selectView("security-flow");
      await ui.layoutGraph();
      const marker = findAllByClass(elements.get("graph-nodes"), "finding-marker")[0];
      if (marker) {
        marker.dispatchEvent({ type: "click" });
        await ui.layoutGraph();
        const metrics = logGraphMetrics(target.name, "security-detail", ui.state.layout, elements);
        assert.equal(metrics.duplicateGeometry, 0, `${target.name} security-detail: 중복 물리 Geometry`);
        assertDetailGeometry(target.name + " 상세 취약점", snapshot, ui.state.layout.plan, elements);
        assert.equal(ui.state.view, "security-detail", `${target.name}: Finding 상세 진입`);
        assert.ok(ui.state.layout.plan.detailBlueprint, `${target.name}: 상세 Finding Blueprint 생성`);
      }
    }
  });
}

function compositeItemForNode(plan, nodeId, rowId = null) {
  const model = plan && plan.displayModel;
  return (model?.originalNodeToItemIds?.[nodeId] || []).map((id) => model.itemById[id])
    .find((item) => item && (!rowId || item.rowId === rowId));
}

function compositeCardForNode(plan, nodeId, kind = null, rowId = null) {
  const model = plan && plan.displayModel;
  return (model?.originalNodeToCardIds?.[nodeId] || []).map((id) => model.cardById[id])
    .find((card) => card && (!kind || card.kind === kind) && (!rowId || card.rowId === rowId));
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

test("Header 경계선 높이를 제외해 Graph Surface가 Viewport를 넘지 않음", () => {
  assert.match(appCss, /\.app-body\s*\{[^}]*height:\s*calc\(100vh - var\(--header-height\) - 1px\)/s);
  assert.match(appCss, /\.app-body\s*\{\s*min-height:\s*calc\(100vh - var\(--header-height\) - 1px\);\s*\}/);
  assert.match(appCss, /\.graph-canvas\s*\{\s*min-height:\s*calc\(100vh - var\(--header-height\) - 1px\);\s*\}/);
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
  assert.match(appCss, /\.map-toolbar\s*\{[^}]*top:\s*24px;[^}]*left:\s*24px;[^}]*background:\s*var\(--surface\);[^}]*box-shadow:/s);
  assert.doesNotMatch(appCss.match(/\.map-toolbar\s*\{[^}]*\}/s)[0], /backdrop-filter|background:\s*rgba\(/);
  assert.match(appCss, /\.graph-tool-button\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px/);
  assert.match(appCss, /\.graph-tool-button\s*\{[^}]*border:\s*1px solid transparent;[^}]*color:\s*var\(--accent-strong\);[^}]*background:\s*transparent/s);
  assert.match(appCss, /\.graph-tool-button:hover:not\(\[aria-disabled="true"\]\)\s*\{[^}]*border-color:\s*rgba\(74, 222, 128, \.45\);[^}]*background:\s*rgba\(74, 222, 128, \.1\)/s);
  assert.match(appCss, /\.graph-tool-button\[aria-disabled="true"\]\s*\{[^}]*color:\s*#718077/);
  assert.match(appCss, /\.graph-tool-button:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent-strong\)/);
  assert.match(appCss, /\.map-lock-button\[aria-pressed="true"\]\s*\{[^}]*color:\s*var\(--accent-strong\);[^}]*background:\s*rgba\(74, 222, 128, \.16\)/);
  assert.match(appCss, /\.map-filter-button\[data-active="true"\]\s*\{[^}]*color:\s*var\(--accent-strong\);[^}]*background:\s*rgba\(74, 222, 128, \.14\)/);
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
  assert.match(indexHtml.slice(noticeStart - 100, noticeStart), /<\/div>\s*<\/div>\s*$/);
  assert.match(appCss, /\.map-toolbar\s*\{[^}]*width:\s*max-content/);
  assert.match(appCss, /\.shell-notice\s*\{[^}]*top:\s*clamp\(12px[^}]*right:\s*clamp\(16px[^}]*pointer-events:\s*none/s);
  assert.match(appCss, /\.map-filter-panel\s*\{[^}]*top:\s*100%;[^}]*left:\s*-1px;[^}]*width:\s*calc\(100% \+ 2px\);[^}]*box-sizing:\s*border-box;/);
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

test("교육용 Flow 버튼 포인터 입력은 Graph Pan에 가로채이지 않음", () => {
  const { ui, elements } = loadUi();
  const graphCanvas = elements.get("graph-canvas");
  const controls = elements.get("request-flow-controls");
  controls.setAttribute("class", "request-flow-controls");
  const buttons = [
    "request-flow-start", "request-flow-pause", "request-flow-reset",
    "request-flow-previous", "request-flow-next", "request-flow-detail-toggle", "request-flow-detail-close"
  ].map((id) => elements.get(id));
  controls.append(...buttons);
  graphCanvas.append(controls);

  buttons.forEach((button) => {
    button.tagName = "button";
    button.append(createElement("span"));
  });
  [false, true].forEach((locked) => {
    ui.navigation.setLocked(locked);
    buttons.forEach((button, index) => {
      const event = { type: "pointerdown", pointerId: (locked ? 10 : 0) + index + 1, clientX: 20, clientY: 20 };
      button.children[0].dispatchEvent(event);
      assert.equal(ui.navigation.state.dragging, false);
      assert.equal(graphCanvas.pointerCaptures.has(event.pointerId), false);
      assert.equal(Boolean(event.defaultPrevented), false);
    });
  });
});

test("Graph 내부 표준 대화형 컨트롤은 Pan을 막고 빈 Canvas 드래그는 유지함", () => {
  const { ui, elements, document } = loadUi();
  const graphCanvas = elements.get("graph-canvas");
  const html = createElement("html");
  html.append(graphCanvas);
  html.parentNode = document;
  const controls = [
    createElement("button"), createElement("input"), createElement("select"),
    createElement("textarea"), createElement("a"), createElement("label"),
    createElement("div"), createElement("div"), createElement("div")
  ];
  controls[4].setAttribute("href", "#details");
  controls[6].setAttribute("role", "switch");
  controls[7].setAttribute("tabindex", "0");
  controls[8].setAttribute("contenteditable", "true");
  controls.forEach((control, index) => {
    graphCanvas.append(control);
    const event = { type: "pointerdown", pointerId: index + 20, clientX: 20, clientY: 20 };
    control.dispatchEvent(event);
    assert.equal(ui.navigation.state.dragging, false);
    assert.equal(graphCanvas.pointerCaptures.has(event.pointerId), false);
    assert.equal(Boolean(event.defaultPrevented), false);
  });

  const drag = { type: "pointerdown", pointerId: 40, target: graphCanvas, clientX: 20, clientY: 20 };
  graphCanvas.dispatchEvent(drag);
  assert.equal(ui.navigation.state.dragging, true);
  assert.equal(graphCanvas.pointerCaptures.has(40), true);
  assert.equal(drag.defaultPrevented, true);
  graphCanvas.dispatchEvent({ type: "pointerup", pointerId: 40 });
  assert.equal(ui.navigation.state.dragging, false);
  assert.equal(graphCanvas.pointerCaptures.has(40), false);
});

test("Spotlight 종료 후 교육용 Flow 시작 입력은 포인터 캡처 없이 동작함", async () => {
  const { ui, elements, document, window } = loadUi();
  ui.renderGraph(flowGraphFixture());
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();
  elements.get("setting-show-detail-flow").checked = true;
  elements.get("setting-show-detail-flow").dispatchEvent({ type: "change" });

  const controls = elements.get("request-flow-controls");
  controls.setAttribute("class", "request-flow-controls");
  controls.append(elements.get("request-flow-start"));
  elements.get("graph-canvas").append(controls);

  elements.get("help-button").dispatchEvent({ type: "click" });
  assert.equal(window.MapInBootSpotlight.getState().active, true);
  document.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(window.MapInBootSpotlight.getState().active, false);

  const pointerDown = { type: "pointerdown", pointerId: 41, clientX: 20, clientY: 20 };
  elements.get("request-flow-start").dispatchEvent(pointerDown);
  assert.equal(ui.navigation.state.dragging, false);
  assert.equal(elements.get("graph-canvas").pointerCaptures.has(41), false);
  assert.equal(Boolean(pointerDown.defaultPrevented), false);

  elements.get("request-flow-start").dispatchEvent({ type: "click" });
  assert.equal(ui.requestFlow.state().status, "running");
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

test("도움말·설정 패널과 실제 Graph 표시 설정이 동작하고 새로고침 중복 요청을 막음", async () => {
  const calls = [];
  const { ui, elements, window } = loadUi({
    fetchImpl: (url, options) => {
      calls.push({ url, options });
      return new Promise(() => {});
    }
  });

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "GET");
  elements.get("refresh-button").dispatchEvent({ type: "click" });
  assert.equal(calls.length, 1);

  elements.get("help-button").dispatchEvent({ type: "click" });
  assert.equal(window.MapInBootSpotlight.getState().active, true);
  assert.equal(elements.get("help-panel").hidden, true);
  assert.equal(elements.get("help-button").getAttribute("aria-expanded"), "true");
  elements.get("settings-button").dispatchEvent({ type: "click" });
  assert.equal(window.MapInBootSpotlight.getState().active, false);
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

test("설정 Drawer는 표시 옵션을 독립 적용하고 Escape에서 Graph 선택을 보존함", async () => {
  const { ui, elements, document } = loadUi();
  ui.renderGraph(graphFixture());
  ui.selectView("security-flow");
  await ui.layoutGraph();
  ui.selectGraphElement("node", "node-2");

  assert.equal(ui.state.display.areas, true);
  assert.equal(ui.state.display.edgeLabels, true);
  assert.equal(ui.state.display.minimap, true);
  elements.get("settings-button").children[0].dispatchEvent({ type: "click" });
  assert.equal(elements.get("settings-panel").hidden, false);
  assert.equal(elements.get("settings-panel").dataset.open, "true");
  assert.equal(elements.get("settings-close").focused, true);
  assert.doesNotMatch(indexHtml, /id="setting-show-detail-flow"/);
  document.dispatchEvent({ type: "click", target: elements.get("setting-show-areas") });
  assert.equal(elements.get("settings-panel").hidden, false);

  elements.get("settings-panel").dispatchEvent({
    type: "keydown", key: "Tab", shiftKey: true, target: elements.get("settings-close")
  });
  assert.equal(elements.get("setting-flow-speed").focused, true);
  elements.get("settings-panel").dispatchEvent({
    type: "keydown", key: "Tab", target: elements.get("setting-flow-speed")
  });
  assert.equal(elements.get("settings-close").focused, true);

  elements.get("setting-show-areas").checked = false;
  elements.get("setting-show-areas").dispatchEvent({ type: "change" });
  assert.equal(elements.get("graph-areas").hasAttribute("hidden"), true);
  assert.equal(elements.get("graph-flow-projection").hasAttribute("hidden"), false);

  const selected = { ...ui.state.selection };
  elements.get("setting-show-areas").dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(elements.get("settings-panel").hidden, false);
  assert.equal(elements.get("settings-panel").getAttribute("aria-hidden"), "true");
  assert.equal(elements.get("settings-button").getAttribute("aria-expanded"), "false");
  assert.equal(elements.get("settings-button").focused, true);
  assert.equal(ui.state.selection.kind, selected.kind);
  assert.equal(ui.state.selection.id, selected.id);
  assert.equal(elements.get("inspector").hidden, false);
  elements.get("settings-panel").dispatchEvent({ type: "transitionend", propertyName: "transform" });
  assert.equal(elements.get("settings-panel").hidden, true);

  elements.get("settings-button").dispatchEvent({ type: "click" });
  elements.get("settings-close").dispatchEvent({ type: "click" });
  assert.equal(elements.get("settings-panel").hidden, false);
  assert.equal(elements.get("settings-button").focused, true);
  elements.get("settings-panel").dispatchEvent({ type: "transitionend", propertyName: "transform" });
  assert.equal(elements.get("settings-panel").hidden, true);

  elements.get("settings-button").dispatchEvent({ type: "click" });
  document.dispatchEvent({ type: "click", target: elements.get("graph-canvas") });
  elements.get("settings-panel").dispatchEvent({ type: "transitionend", propertyName: "transform" });
  assert.equal(elements.get("settings-panel").hidden, true);
  elements.get("settings-button").children[0].dispatchEvent({ type: "click" });
  elements.get("settings-button").children[0].dispatchEvent({ type: "click" });
  assert.equal(elements.get("settings-panel").dataset.open, "false");
  elements.get("settings-panel").dispatchEvent({ type: "transitionend", propertyName: "transform" });
  assert.equal(elements.get("settings-panel").hidden, true);
  ui.selectView("all-flow");
  ui.selectView("feature-flow");
  assert.equal(ui.state.display.areas, false);
});

test("학습 흐름 재생 설정은 세션 값으로 반영되고 선택한 단계를 초기화하지 않음", () => {
  const { ui, elements } = loadUi();
  assert.equal(ui.state.requestFlowSettings.nodeHoldDuration, 1500);
  assert.equal(ui.state.requestFlowSettings.speed, 1);
  ui.requestFlow.setSteps([
    { id: "first", kind: "actual", anchorId: "node-a" },
    { id: "selected", kind: "actual", anchorId: "node-b" }
  ]);
  ui.requestFlow.play();

  elements.get("setting-flow-node-duration").value = "3000";
  elements.get("setting-flow-node-duration").dispatchEvent({ type: "change" });
  assert.equal(ui.requestFlow.state().status, "running");
  assert.equal(ui.requestFlow.state().stepIndex, 0);
  ui.requestFlow.pause();
  ui.requestFlow.seekToStep(1);
  elements.get("setting-flow-speed").value = "2";
  elements.get("setting-flow-speed").dispatchEvent({ type: "change" });

  assert.equal(ui.state.requestFlowSettings.nodeHoldDuration, 3000);
  assert.equal(ui.state.requestFlowSettings.speed, 2);
  assert.equal(ui.requestFlow.state().status, "paused");
  assert.equal(ui.requestFlow.state().stepIndex, 1);
  assert.equal(ui.requestFlow.state().step.id, "selected");
});

test("요청 처리 흐름 상태 문구와 점 표시가 Controller 상태를 따라감", () => {
  const { ui, elements } = loadUi();
  ui.requestFlow.setSteps([
    { id: "first", kind: "actual", anchorId: "node-a" },
    { id: "second", kind: "education" }
  ]);
  assert.equal(elements.get("request-flow-status").textContent, "시작 전");
  assert.equal(elements.get("request-flow-status").getAttribute("data-state"), "idle");

  ui.requestFlow.play();
  assert.equal(elements.get("request-flow-status").textContent, "진행 중");
  assert.equal(elements.get("request-flow-status").getAttribute("data-state"), "running");
  ui.requestFlow.pause();
  assert.equal(elements.get("request-flow-status").textContent, "일시정지");
  assert.equal(elements.get("request-flow-status").getAttribute("data-state"), "paused");
  ui.requestFlow.reset();
  assert.equal(elements.get("request-flow-status").textContent, "시작 전");
  assert.equal(elements.get("request-flow-status").getAttribute("data-state"), "idle");
});

test("Spotlight의 Escape 종료는 설정 Drawer와 선택된 Inspector를 추가로 닫지 않음", async () => {
  const { ui, elements, document, window } = loadUi();
  ui.renderGraph(graphFixture());
  await ui.layoutGraph();
  ui.selectGraphElement("node", "node-2");
  elements.get("inspector").scrollTop = 37;
  const selectedId = ui.state.selection.id;

  elements.get("settings-button").dispatchEvent({ type: "click" });
  assert.equal(elements.get("settings-panel").dataset.open, "true");
  elements.get("help-button").dispatchEvent({ type: "click" });

  assert.equal(window.MapInBootSpotlight.getState().active, true);
  assert.equal(elements.get("settings-panel").dataset.open, "false");
  assert.equal(elements.get("inspector").hidden, false);
  assert.equal(ui.state.selection.id, selectedId);
  document.dispatchEvent({ type: "keydown", key: "Escape" });

  assert.equal(window.MapInBootSpotlight.getState().active, false);
  assert.equal(elements.get("settings-panel").dataset.open, "false");
  assert.equal(elements.get("settings-button").getAttribute("aria-expanded"), "false");
  assert.equal(ui.state.selection.id, selectedId);
  assert.equal(elements.get("inspector").hidden, false);
  assert.equal(elements.get("inspector").scrollTop, 37);
  assert.equal(elements.get("help-button").focused, true);
});

test("실행 단계와 HTTP 상태를 사용자 문구로 구분함", () => {
  const { ui } = loadUi();

  assert.equal(ui.executionPhaseLabel("NOT_STARTED"), "대기");
  assert.equal(ui.executionPhaseLabel("RUNNING"), "실행 중");
  assert.equal(ui.executionPhaseLabel("PARTIAL"), "부분 분석");
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
      edge("handler-map-a", "endpoint-a", "handler-a", "FLOWS_TO", { flowKind: "HANDLER" }),
      edge("handler-map-b", "endpoint-b", "handler-b", "FLOWS_TO", { flowKind: "HANDLER" }),
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
    edges.push(edge(`mapping-${index}`, `endpoint-${index}`, `handler-${index}`, "FLOWS_TO", { flowKind: "HANDLER" }));
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
    edges.push(edge(`count-mapping-${index}`, `count-endpoint-${index}`, `count-handler-${index}`, "FLOWS_TO", {
      flowKind: "HANDLER"
    }));
  }
  return { nodes, edges };
}

test("Overview Chain 복합 카드는 실제 원본 Filter 항목과 안정적인 역참조를 보존함", () => {
  const { ui, layoutApi } = loadUi();
  const graph = ui.normalizeGraph(flowGraphFixture());
  const layout = layoutApi.semanticLayout(graph, { positions: {} });
  const composites = layout.plan.displayModel.composites;
  assert.ok(Array.isArray(composites), "Overview 복합 카드 모델 누락");
  const chainCard = composites.find((card) => card.kind === "SECURITY_CHAIN" && card.originalNodeIds.includes("chain-a"));
  assert.ok(chainCard, "실제 Chain 복합 카드 누락");
  assert.equal(chainCard.originalNodeIds.includes("chain-a"), true);
  assert.deepEqual(Array.from(chainCard.items.flatMap((item) => item.originalNodeIds).filter((id) => id.startsWith("security-filter-"))),
    ["security-filter-1", "security-filter-2"]);
  assert.equal(layout.plan.displayModel.cardById[chainCard.id], chainCard);
  chainCard.items.forEach((item) => item.originalNodeIds.forEach((nodeId) => {
    assert.ok(layout.plan.displayModel.originalNodeToItemIds[nodeId]?.includes(item.id), `${nodeId}의 항목 역참조 누락`);
  }));
});

test("Overview 복합 카드와 항목은 실제 포트·Inspector 원본 참조를 렌더링함", async () => {
  const { ui, elements } = loadUi();
  const snapshot = flowGraphFixture();
  snapshot.nodes.find((node) => node.id === "endpoint-a").evidenceIds = ["e-shared", "e-distinct"];
  snapshot.evidence = [{ id: "e-shared", source: "RUNTIME", summary: "공유 근거", location: "endpoint" },
    { id: "e-distinct", source: "RUNTIME", summary: "별도 근거", location: "endpoint" }];
  snapshot.edges.push({ id: "api-handler-flow", sourceId: "endpoint-a", targetId: "handler-a", type: "FLOWS_TO",
    confidence: "CONFIRMED", attributes: {}, evidenceIds: ["e-shared"] });
  ui.renderGraph(snapshot);
  ui.selectView("all-flow");
  await ui.layoutGraph();

  const chainCard = ui.state.layout.plan.displayModel.composites.find((card) =>
    card.kind === "SECURITY_CHAIN" && card.originalNodeIds.includes("chain-a"));
  const renderedCard = findAllByClass(elements.get("graph-nodes"), "graph-composite-card")
    .find((element) => element.getAttribute("data-composite-card-id") === chainCard.id);
  assert.ok(renderedCard, "Chain 카드 SVG 누락");
  assert.equal(renderedCard.getAttribute("data-node-ids").includes("chain-a"), true);

  const apiCard = ui.state.layout.plan.displayModel.composites.find((card) => card.kind === "API_MAPPING");
  const apiItem = apiCard.items.find((item) => item.originalNodeIds.includes("endpoint-a"));
  const renderedItem = findAllByClass(elements.get("graph-nodes"), "graph-composite-item")
    .find((element) => element.getAttribute("data-composite-item-id") === apiItem.id);
  assert.ok(renderedItem, "API 표시 항목 SVG 누락");
  assert.ok(findAllByClass(renderedItem, "graph-composite-port").length > 0, "실제 관계 포트 누락");

  renderedItem.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selection.kind, "controller-group");
  assert.equal(ui.state.selection.id, apiItem.id);
  assert.equal(elements.get("inspector").hidden, false);
  assert.equal(elements.get("inspector").getAttribute("data-selection-id"), apiItem.id);
  assert.ok(findAllByClass(elements.get("inspector"), "inspector-link")
    .some((link) => link.getAttribute("data-node-id") === "endpoint-a"));
  assert.equal(apiItem.areaId, apiCard.areaId);
  const inspector = elements.get("inspector");
  const headings = findAllByClass(inspector, "inspector-section-title").map((heading) => heading.textContent);
  assert.deepEqual(headings, ["기본 속성", "상세 속성", "관련 취약점", "분석 근거"]);
  assert.match(textOf(inspector), /기술 영역\s+API 매핑/);
  const evidenceBlocks = findAllByClass(inspector, "inspector-evidence");
  assert.equal(evidenceBlocks.filter((block) => textOf(block).includes("공유 근거")).length, 1);
  assert.equal(evidenceBlocks.filter((block) => textOf(block).includes("별도 근거")).length, 1);
  const originals = findAllByClass(inspector, "inspector-composite-entry")[0];
  assert.ok(originals && !originals.hasAttribute("open"));
  for (const tab of ["connections", "relations"]) {
    const button = findAllByClass(inspector, "inspector-tab").find((entry) => entry.getAttribute("data-tab") === tab);
    assert.ok(button);
    button.dispatchEvent({ type: "click" });
    assert.equal(button.getAttribute("data-tab"), tab);
  }
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();
  const detail = ui.state.layout.plan.displayModel;
  detail.composites.forEach((card) => card.items.forEach((entry) => assert.equal(entry.areaId, card.areaId)));
  assert.ok(detail.originalNodeToItemIds?.["endpoint-a"]?.length === 1, JSON.stringify(detail.originalNodeToItemIds?.["endpoint-a"]));
  ui.selectGraphElement("node", "endpoint-a");
  const properties = findAllByClass(inspector, "inspector-tab").find((entry) => entry.getAttribute("data-tab") === "properties");
  properties.dispatchEvent({ type: "click" });
  assert.match(textOf(inspector), /기술 영역\s+스프링 MVC/);
  assert.deepEqual(findAllByClass(inspector, "inspector-section-title").map((entry) => entry.textContent),
    ["기본 속성", "상세 속성", "관련 취약점", "분석 근거"]);
});

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
      edges.push({ id: `${prefix}-mapping-${index}`, sourceId: endpointId, targetId: handlerId, type: "FLOWS_TO",
        attributes: { flowKind: "HANDLER" }, confidence: "CONFIRMED", evidenceIds: [`e-${prefix}-mapping-${index}`] });
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

function routeIntersectsPosition(route, position, width = 260, height = 120) {
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

test("Spring Security 7 표준 Filter 12종이 FQCN과 교육 필수 항목을 제공함", () => {
  const { window } = loadUi();
  const references = window.MapInBootStandardFilters.list();
  const expectedFqcns = [
    "org.springframework.security.web.context.SecurityContextHolderFilter",
    "org.springframework.security.web.header.HeaderWriterFilter",
    "org.springframework.security.web.csrf.CsrfFilter",
    "org.springframework.security.web.authentication.logout.LogoutFilter",
    "org.springframework.security.web.authentication.www.BasicAuthenticationFilter",
    "org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter",
    "org.springframework.security.web.savedrequest.RequestCacheAwareFilter",
    "org.springframework.security.web.servletapi.SecurityContextHolderAwareRequestFilter",
    "org.springframework.security.web.authentication.AnonymousAuthenticationFilter",
    "org.springframework.security.web.session.SessionManagementFilter",
    "org.springframework.security.web.access.ExceptionTranslationFilter",
    "org.springframework.security.web.access.intercept.AuthorizationFilter"
  ];
  const educationFields = ["role", "input", "condition", "processing", "outcomes", "cautions"];

  assert.deepEqual(Array.from(references, (reference) => reference.fqcn), expectedFqcns);
  assert.deepEqual(Array.from(references, (reference) => reference.referenceOrder),
    Array.from({ length: 12 }, (_, index) => index + 1));
  references.forEach((reference) => {
    assert.match(reference.source, /표시 순서는 처리 원리 설명용/);
    educationFields.forEach((field) => {
      assert.equal(typeof reference[field], "string", `${reference.name} ${field} 문자열 제공`);
      assert.ok(reference[field].trim().length > 0, `${reference.name} ${field} 설명 제공`);
    });
  });
});

test("상세 처리 보기에서 표준 Filter 교육을 선택하고 실제 Snapshot 속성·Evidence를 보존함", async () => {
  const { ui, elements } = loadUi();
  const snapshot = standardFilterGraphFixture();
  snapshot.evidence = [{
    id: "evidence-security-filter-1",
    source: "CODE_PATTERN",
    location: "SecurityConfiguration#filterChain",
    summary: "실제 등록 근거"
  }];
  ui.renderGraph(snapshot);
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();
  ui.selectGraphElement("node", "security-filter-1");
  assert.equal(findAllByClass(elements.get("inspector"), "inspector-tab")
    .some((button) => button.attributes["data-tab"] === "filter-education"), true);
  assert.match(textOf(elements.get("inspector")), /org\.springframework\.security\.web\.csrf\.CsrfFilter/);
  let inspector = elements.get("inspector");
  let educationTab = findAllByClass(inspector, "inspector-tab")
    .find((button) => button.attributes["data-tab"] === "filter-education");
  assert.ok(educationTab, "필터 교육 탭 제공");
  educationTab.dispatchEvent({ type: "click" });
  educationTab = findAllByClass(elements.get("inspector"), "inspector-tab")
    .find((button) => button.attributes["data-tab"] === "filter-education");
  assert.equal(educationTab.getAttribute("aria-selected"), "true");
  let educationText = textOf(inspector);
  assert.match(educationText, /CsrfFilter/);
  assert.match(educationText, /입력/);
  assert.match(educationText, /확인 조건/);
  assert.match(educationText, /대표 처리/);
  assert.match(educationText, /가능한 결과/);
  assert.match(educationText, /주의사항/);
  assert.match(educationText, /실제 filterOrder를 뜻하지 않습니다/);
  assert.match(educationText, /분석 상태 출처/);
  assert.match(educationText, /참고 자료/);
  assert.doesNotMatch(educationText, /evidence-security-filter-1|SecurityConfiguration#filterChain/);
  assert.equal(findAllByClass(inspector, "inspector-filter-reference")
    .find((button) => button.attributes["data-filter-fqcn"] === "org.springframework.security.web.csrf.CsrfFilter")
    .attributes["data-filter-status"], "CURRENT_PATH_APPLIED");
  assert.equal(inspector.getAttribute("data-selection-id"), "security-filter-1");

  findAllByClass(inspector, "inspector-tab")
    .find((button) => button.attributes["data-tab"] === "properties").dispatchEvent({ type: "click" });
  inspector = elements.get("inspector");
  const propertyText = textOf(inspector);
  assert.match(propertyText, /org\.springframework\.security\.web\.csrf\.CsrfFilter/);
  assert.match(propertyText, /실제 등록 근거/);
  assert.equal(inspector.getAttribute("data-selection-id"), "security-filter-1");
});

test("미등록 표준 필터 참고 카드 선택은 Snapshot Graph 선택과 분리됨", async () => {
  const { ui, elements } = loadUi();
  const snapshot = standardFilterGraphFixture();
  ui.renderGraph(snapshot);
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();
  ui.selectGraphElement("node", "endpoint-a");

  const inspector = elements.get("inspector");
  findAllByClass(inspector, "inspector-tab")
    .find((button) => button.attributes["data-tab"] === "filter-education").dispatchEvent({ type: "click" });
  const reference = findAllByClass(inspector, "inspector-filter-reference")
    .find((button) => button.attributes["data-filter-fqcn"]
      === "org.springframework.security.web.header.HeaderWriterFilter");
  assert.ok(reference, "미등록 표준 필터 참고 카드를 선택 가능");
  assert.equal(reference.hasAttribute("data-node-id"), false);
  assert.match(textOf(reference), /참고: 미등록/);

  reference.dispatchEvent({ type: "click" });
  const educationText = textOf(inspector);
  assert.match(educationText, /HeaderWriterFilter/);
  assert.match(educationText, /Snapshot에 없는 표준 Filter 참고 자료/);
  assert.match(educationText, /응답/);
  assert.equal(inspector.getAttribute("data-selection-id"), "endpoint-a");
  assert.equal(snapshot.nodes.some((node) => node.id.startsWith("standard-filter-")), false);
  assert.equal(ui.state.graph.nodes.some((node) => node.id.startsWith("standard-filter-")), false);
});

test("사용자 정의 Filter에는 표준 필터의 처리 설명을 자동 연결하지 않음", async () => {
  const { ui, elements } = loadUi();
  const snapshot = standardFilterGraphFixture();
  ui.state.includeUnconnectedNodes = true;
  ui.renderGraph(snapshot);
  ui.inspector.render({ graph: snapshot, visibleGraph: snapshot, snapshot,
    selection: { kind: "node", id: "custom-csrf-filter" }, detailedFlow: true });

  const inspector = elements.get("inspector");
  assert.ok(findAllByClass(inspector, "inspector-tab")
    .some((button) => button.attributes["data-tab"] === "filter-education"));
  assert.equal(findAllByClass(inspector, "inspector-filter-education-card").length, 0);
  assert.match(textOf(inspector), /com\.example\.CsrfFilter/);
});

test("표준 필터 교육 카드가 등록·적용·불확실성 상태를 기존 분류와 일치시킴", () => {
  const { ui, elements } = loadUi();
  const snapshot = standardFilterGraphFixture();
  snapshot.nodes.push(
    {
      id: "other-chain-bearer-filter",
      type: "FILTER",
      serviceId: "orders",
      label: "BearerTokenAuthenticationFilter",
      attributes: {
        registrationKind: "SECURITY",
        filterClass: "org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter",
        chainKey: "chain-b",
        filterOrder: "4"
      },
      evidenceIds: ["evidence-other-chain-bearer-filter"]
    },
    {
      id: "unlinked-session-filter",
      type: "FILTER",
      serviceId: "orders",
      label: "SessionManagementFilter",
      attributes: {
        registrationKind: "SECURITY",
        filterClass: "org.springframework.security.web.session.SessionManagementFilter"
      },
      evidenceIds: ["evidence-unlinked-session-filter"]
    }
  );
  snapshot.edges.push({
    id: "other-chain-bearer-edge",
    sourceId: "chain-b",
    targetId: "other-chain-bearer-filter",
    type: "FILTERED_BY",
    attributes: { registrationKind: "SECURITY", filterOrder: "4" },
    confidence: "CONFIRMED",
    evidenceIds: ["evidence-other-chain-bearer-edge"]
  });
  const selection = { kind: "node", id: "security-filter-1" };
  const renderEducation = (endpointChainId = "chain-a") => ui.inspector.render({
    graph: snapshot,
    visibleGraph: snapshot,
    snapshot,
    selection,
    detailedFlow: true,
    endpointChainId
  });
  const statusFor = (fqcn) => findAllByClass(elements.get("inspector"), "inspector-filter-reference")
    .find((button) => button.attributes["data-filter-fqcn"] === fqcn)
    .attributes["data-filter-status"];
  const referenceFor = (fqcn) => findAllByClass(elements.get("inspector"), "inspector-filter-reference")
    .find((button) => button.attributes["data-filter-fqcn"] === fqcn);

  renderEducation(null);
  ui.inspector.setTab("filter-education");
  assert.equal(statusFor("org.springframework.security.web.csrf.CsrfFilter"), "REGISTERED");
  assert.match(textOf(referenceFor("org.springframework.security.web.csrf.CsrfFilter")), /등록됨/);
  renderEducation("chain-a");
  assert.equal(statusFor("org.springframework.security.web.csrf.CsrfFilter"), "CURRENT_PATH_APPLIED");
  assert.match(textOf(referenceFor("org.springframework.security.web.csrf.CsrfFilter")), /현재 경로 적용/);
  assert.equal((textOf(referenceFor("org.springframework.security.web.csrf.CsrfFilter")).match(/현재 경로 적용/g) || []).length, 1);
  assert.equal(statusFor("org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter"),
    "CURRENT_PATH_NOT_APPLIED");
  assert.match(textOf(referenceFor("org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter")),
    /현재 경로 미적용/);
  assert.equal(statusFor("org.springframework.security.web.session.SessionManagementFilter"), "REGISTERED_UNCERTAIN");
  assert.match(textOf(referenceFor("org.springframework.security.web.session.SessionManagementFilter")), /적용 경로 확인 불가/);
  assert.equal(statusFor("org.springframework.security.web.authentication.logout.LogoutFilter"), "UNREGISTERED_REFERENCE");
  assert.match(textOf(referenceFor("org.springframework.security.web.authentication.logout.LogoutFilter")), /참고: 미등록/);

  snapshot.analysisStatus["security-filter-registration-analysis"] = "PARTIAL";
  renderEducation("chain-a");
  assert.equal(statusFor("org.springframework.security.web.header.HeaderWriterFilter"), "UNKNOWN");
  assert.match(textOf(referenceFor("org.springframework.security.web.header.HeaderWriterFilter")), /등록 여부 확인 불가/);
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
    ui.state.graphRender.displayNodes.length + ui.state.layout.plan.projection.nodes.length);
  assert.equal(ui.state.graphRender.displayNodes.some((node) => node.originalNodeIds?.includes("servlet-1")), false);
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
    "match-a", "handler-map-a", "security-filtered-1", "security-filtered-2", "secured-a", "reads-a", "uses-a"
  ]);
  assert.equal(detail.match.status, "CONFIRMED");
  assert.equal(detail.nodes.find((node) => node.id === "endpoint-a"), normalized.nodes.find((node) => node.id === "endpoint-a"));
  assert.equal(detail.edges.find((edge) => edge.id === "secured-a"), normalized.edges.find((edge) => edge.id === "secured-a"));
  assert.equal(detail.edges.some((edge) => edge.sourceId === "endpoint-a" && edge.targetId === "handler-a"), true);
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

test("상세 Blueprint는 선택 Endpoint에 연결된 Runtime 객체와 실제 중첩 영역을 표시하고 Inspector에서 추적함", async () => {
  const { ui, elements } = loadUi();
  const graph = detailGraphFixture();
  graph.runtimeArchitecture = {
    environment: { webApplicationType: "SERVLET", serverKind: "TOMCAT", serverClassName: "org.apache.catalina.startup.Tomcat", deploymentMode: "EMBEDDED", frameworkVersions: {} },
    components: [
      { id: "runtime-app", kind: "APPLICATION_CONTEXT", className: "org.springframework.boot.web.servlet.context.AnnotationConfigServletWebServerApplicationContext", beanName: null, contextId: "app", parentId: null, attributes: {}, graphNodeIds: [], evidenceIds: [] },
      { id: "runtime-server", kind: "WEB_SERVER", className: "org.springframework.boot.web.embedded.tomcat.TomcatWebServer", beanName: null, contextId: "app", parentId: "runtime-app", attributes: {}, graphNodeIds: [], evidenceIds: [] },
      { id: "runtime-servlet-context", kind: "SERVLET_CONTEXT", className: "org.apache.catalina.core.StandardContext", beanName: null, contextId: "app", parentId: "runtime-server", attributes: {}, graphNodeIds: ["servlet-1"], evidenceIds: [] },
      { id: "runtime-dispatcher", kind: "SERVLET", className: "org.springframework.web.servlet.DispatcherServlet", beanName: "dispatcherServlet", contextId: "app", parentId: "runtime-servlet-context", attributes: {}, graphNodeIds: ["servlet-1"], evidenceIds: [] },
      { id: "runtime-proxy", kind: "FILTER_CHAIN_PROXY", className: "org.springframework.security.web.FilterChainProxy", beanName: "springSecurityFilterChain", contextId: "app", parentId: null, attributes: {}, graphNodeIds: ["chain-a"], evidenceIds: [] },
      { id: "runtime-chain", kind: "SECURITY_FILTER_CHAIN", className: "org.springframework.security.web.DefaultSecurityFilterChain", beanName: null, contextId: "app", parentId: "runtime-proxy", attributes: { order: "1" }, graphNodeIds: ["chain-a"], evidenceIds: [] },
      { id: "runtime-security-filter", kind: "SECURITY_FILTER", className: "org.springframework.security.web.csrf.CsrfFilter", beanName: null, contextId: "app", parentId: "runtime-chain", attributes: { filterOrder: "1" }, graphNodeIds: ["security-filter-1"], evidenceIds: [] },
      { id: "runtime-mapping", kind: "HANDLER_MAPPING", className: "org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping", beanName: "requestMappingHandlerMapping", contextId: "app", parentId: null, attributes: {}, graphNodeIds: ["endpoint-a"], evidenceIds: ["runtime-evidence-mapping"] },
      { id: "runtime-handler", kind: "HANDLER_METHOD", className: "com.example.orders.OrderController#list", beanName: null, contextId: "app", parentId: "runtime-mapping", attributes: {}, graphNodeIds: ["handler-a"], evidenceIds: [] },
      { id: "runtime-other-handler", kind: "HANDLER_METHOD", className: "com.example.accounts.AccountController#list", beanName: null, contextId: "app", parentId: "runtime-mapping", attributes: {}, graphNodeIds: ["handler-b"], evidenceIds: [] }
    ],
    relationships: [
      { id: "runtime-server-contains-context", sourceId: "runtime-server", targetId: "runtime-servlet-context", kind: "CONTAINS", confidence: "CONFIRMED", attributes: {}, evidenceIds: [] },
      { id: "runtime-proxy-contains-chain", sourceId: "runtime-proxy", targetId: "runtime-chain", kind: "CONTAINS", confidence: "CONFIRMED", attributes: {}, evidenceIds: [] },
      { id: "runtime-chain-contains-filter", sourceId: "runtime-chain", targetId: "runtime-security-filter", kind: "CONTAINS", confidence: "CONFIRMED", attributes: {}, evidenceIds: [] },
      { id: "runtime-mapping-resolves-handler", sourceId: "runtime-mapping", targetId: "runtime-handler", kind: "MAPS_TO", confidence: "CONFIRMED", attributes: {}, evidenceIds: [] }
    ],
    coverage: [
      { collectorId: "host", area: "WEB_SERVER", scope: "app", state: "PRESENT", reasonCode: "OBSERVED", evidenceIds: [] },
      { collectorId: "servlet", area: "SERVLET", scope: "app", state: "PRESENT", reasonCode: "OBSERVED", evidenceIds: [] },
      { collectorId: "security", area: "SECURITY", scope: "app", state: "PRESENT", reasonCode: "OBSERVED", evidenceIds: [] },
      { collectorId: "mvc", area: "MVC", scope: "app", state: "PRESENT", reasonCode: "OBSERVED", evidenceIds: [] }
    ],
    evidence: [{ id: "runtime-evidence-mapping", source: "MVC_RUNTIME", location: "requestMappingHandlerMapping", summary: "실제 HandlerMapping 등록 근거" }],
    architectureFingerprint: "runtime-fingerprint"
  };

  ui.renderGraph(graph);
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();

  const blueprint = ui.state.layout && ui.state.layout.plan.detailBlueprint;
  assert.ok(blueprint, "상세 Layout에 Runtime Blueprint가 포함됨");
  assert.ok(blueprint.cards.every((card) => card.bounds.width >= 380 && card.bounds.width <= 560),
    "상세 카드 너비가 허용 범위 안에 있음");
  assert.ok(blueprint.regions.some((region) => region.title === "웹 서버 / WAS"), JSON.stringify({
    regions: blueprint.regions.map((region) => region.title), cards: blueprint.cards.map((card) => card.runtimeComponentIds),
    graphNodeIds: ui.state.viewGraph.nodes.map((node) => node.id)
  }));
  assert.ok(blueprint.regions.some((region) => region.title === "서블릿 컨테이너"));
  assert.ok(blueprint.regions.some((region) => region.title === "스프링 시큐리티"));
  assert.ok(blueprint.regions.some((region) => region.title === "스프링 MVC"));
  const regionById = new Map(blueprint.regions.map((region) => [region.id, region]));
  const securityRegion = regionById.get("runtime-region:security");
  const mvcRegion = regionById.get("runtime-region:mvc");
  assert.ok(securityRegion.bounds.right + 64 <= mvcRegion.bounds.left
    || mvcRegion.bounds.right + 64 <= securityRegion.bounds.left
    || securityRegion.bounds.bottom + 64 <= mvcRegion.bounds.top
    || mvcRegion.bounds.bottom + 64 <= securityRegion.bounds.top,
  "Security와 MVC 형제 영역 사이 64px 이상 간격 확보");
  blueprint.regions.forEach((region) => {
    if (!region.parentId) return;
    const parent = regionById.get(region.parentId);
    assert.ok(parent);
    assert.ok(region.bounds.x >= parent.bounds.x && region.bounds.y >= parent.bounds.y
      && region.bounds.right <= parent.bounds.right && region.bounds.bottom <= parent.bounds.bottom,
    `${region.id} 영역이 상위 영역 안에 배치됨`);
  });
  blueprint.cards.forEach((card, index) => {
    if (!card.regionId) return;
    const region = regionById.get(card.regionId);
    assert.ok(region);
    assert.ok(card.bounds.x >= region.bounds.x && card.bounds.y >= region.bounds.y
      && card.bounds.x + card.bounds.width <= region.bounds.right
      && card.bounds.y + card.bounds.height <= region.bounds.bottom, `${card.id} 카드가 소속 영역 안에 배치됨`);
    blueprint.cards.slice(index + 1).forEach((next) => {
      const overlaps = card.bounds.x < next.bounds.x + next.bounds.width
        && card.bounds.x + card.bounds.width > next.bounds.x
        && card.bounds.y < next.bounds.y + next.bounds.height
        && card.bounds.y + card.bounds.height > next.bounds.y;
      assert.equal(overlaps, false, `${card.id} 카드와 ${next.id} 카드가 겹치지 않음`);
    });
  });
  assert.ok(blueprint.cards.some((card) => card.runtimeComponentIds.includes("runtime-mapping")));
  assert.equal(blueprint.cards.some((card) => card.runtimeComponentIds.includes("runtime-other-handler")), false,
    "선택하지 않은 Endpoint의 Handler 제외");
  const runtimeOnlyCards = blueprint.cards.filter((card) => card.runtimeComponentIds.length && !card.originalNodeIds.length);
  const graphCards = blueprint.cards.filter((card) => card.originalNodeIds.length);
  assert.ok(runtimeOnlyCards.length > 0 && graphCards.length > 0, "실제 Runtime과 Graph 항목이 같은 Blueprint를 구성함");
  const areaLeft = (area) => Math.min(...blueprint.cards.filter((card) => card.areaId === area)
    .map((card) => card.bounds.x));
  assert.ok(areaLeft("servlet") > areaLeft("host"), "서블릿 처리가 웹 서버 오른쪽에 배치됨");
  assert.ok(areaLeft("security") > areaLeft("servlet"), "보안 처리가 서블릿 등록 오른쪽에 배치됨");
  assert.ok(areaLeft("mvc") > areaLeft("security"), "Spring MVC가 보안 처리 오른쪽에 배치됨");
  assert.equal(findAllByClass(elements.get("graph-nodes"), "runtime-blueprint-card").length, 0,
    "기존 개별 Runtime 카드가 중복 렌더링되지 않음");
  assert.equal(findAllByClass(elements.get("graph-nodes"), "graph-node-card").length, 0,
  "기존 개별 Graph Node가 복합 Blueprint와 중복 렌더링되지 않음");

  ui.selectGraphElement("runtime-component", "runtime-mapping");
  assert.equal(ui.state.selection.kind, "runtime-component");
  assert.match(textOf(elements.get("inspector")), /RequestMappingHandlerMapping/);
  assert.match(textOf(elements.get("inspector")), /실제 HandlerMapping 등록 근거/);
  const runtimeItems = findAllByClass(elements.get("graph-nodes"), "graph-composite-item");
  const runtimeHandlerItem = runtimeItems.find((item) => (item.getAttribute("data-runtime-component-ids") || "")
    .split(",").includes("runtime-handler"));
  assert.ok(runtimeHandlerItem, JSON.stringify(runtimeItems.map((item) => item.getAttribute("data-runtime-component-ids"))));
  assert.equal(runtimeHandlerItem.getAttribute("data-related"), "true", "실제 Runtime 관계의 이웃 객체 강조");

  ui.selectGraphElement("runtime-relationship", "runtime-mapping-resolves-handler");
  const runtimeRelation = findAllByClass(elements.get("graph-edges"), "graph-edge")
    .find((edge) => (edge.getAttribute("data-runtime-relationship-ids") || "").split(",").includes("runtime-mapping-resolves-handler"));
  assert.ok(runtimeRelation, "정규화된 Graph·Runtime 관계가 공통 Route Renderer에서 연결됨");
  assert.equal(runtimeRelation.getAttribute("data-selected"), "true");
  assert.equal(runtimeItems.find((item) => (item.getAttribute("data-runtime-component-ids") || "").split(",").includes("runtime-mapping"))
    .getAttribute("data-related"), "true");
  assert.equal(runtimeItems.find((item) => (item.getAttribute("data-runtime-component-ids") || "").split(",").includes("runtime-handler"))
    .getAttribute("data-related"), "true");
});

test("상세 Blueprint는 처리 흐름 위주로 표시하고 등록 세부 정보를 Inspector에 남김", async () => {
  const { ui, elements } = loadUi();
  const graph = detailGraphFixture();
  for (let index = 3; index <= 5; index += 1) {
    graph.nodes.push({ id: `security-filter-${index}`, type: "FILTER", serviceId: "orders",
      label: `SecurityFilter${index}`, attributes: { registrationKind: "SECURITY", chainKey: "chain-a",
        filterOrder: String(index) }, evidenceIds: [`evidence-security-filter-${index}`] });
    graph.edges.push({ id: `security-filtered-${index}`, sourceId: "chain-a", targetId: `security-filter-${index}`,
      type: "FILTERED_BY", confidence: "CONFIRMED", attributes: { registrationKind: "SECURITY", filterOrder: String(index) },
      evidenceIds: [`evidence-security-filtered-${index}`] });
  }
  const runtimeComponent = (id, kind, parentId, graphNodeIds = [], attributes = {}) => ({
    id, kind, className: `example.${kind}Component`, beanName: null, contextId: "app", parentId,
    attributes, graphNodeIds, evidenceIds: [`evidence-${id}`]
  });
  graph.runtimeArchitecture = {
    environment: { webApplicationType: "SERVLET", serverKind: "TOMCAT", deploymentMode: "EMBEDDED" },
    components: [
      runtimeComponent("runtime-app", "APPLICATION_CONTEXT", null),
      runtimeComponent("runtime-server", "WEB_SERVER", "runtime-app"),
      runtimeComponent("runtime-servlet-context", "SERVLET_CONTEXT", "runtime-server", ["servlet-1"]),
      runtimeComponent("runtime-dispatcher", "SERVLET", "runtime-servlet-context", ["servlet-1"]),
      runtimeComponent("runtime-proxy", "FILTER_CHAIN_PROXY", null),
      runtimeComponent("runtime-chain", "SECURITY_FILTER_CHAIN", "runtime-proxy", ["chain-a"], { order: "1" }),
      ...Array.from({ length: 5 }, (_, index) => runtimeComponent(`runtime-security-filter-${index + 1}`,
        "SECURITY_FILTER", "runtime-chain", [`security-filter-${index + 1}`], { filterOrder: String(index + 1) })),
      runtimeComponent("runtime-mapping", "HANDLER_MAPPING", null, ["endpoint-a"]),
      runtimeComponent("runtime-handler", "HANDLER_METHOD", "runtime-mapping", ["handler-a"]),
      runtimeComponent("runtime-adapter", "HANDLER_ADAPTER", "runtime-mapping"),
      ...Array.from({ length: 3 }, (_, index) => runtimeComponent(`runtime-resolver-${index + 1}`,
        "ARGUMENT_RESOLVER", "runtime-adapter", [], { order: String(index + 1) })),
      ...Array.from({ length: 2 }, (_, index) => runtimeComponent(`runtime-converter-${index + 1}`,
        "MESSAGE_CONVERTER", "runtime-adapter", [], { order: String(index + 1) })),
      { ...runtimeComponent("runtime-servlet-registration", "SERVLET_FILTER_REGISTRATION", "runtime-servlet-context",
        ["servlet-filter-1"], { registrationName: "auditFilter", filterClass: "com.example.AuditFilter" }),
        beanName: "auditFilter" },
      { ...runtimeComponent("runtime-filter-map", "TOMCAT_FILTER_MAPPING", "runtime-servlet-context", [], {
        filterName: "auditFilter", registrationOrder: "4", urlPatterns: ["/api/*"],
        dispatcherTypes: ["REQUEST", "ASYNC"], servletNames: ["dispatcherServlet"]
      }) }
    ],
    relationships: [],
    coverage: ["WEB_SERVER", "SERVLET", "SECURITY", "MVC"].map((area) => ({
      collectorId: area.toLowerCase(), area, scope: "app", state: "PRESENT", reasonCode: "OBSERVED", evidenceIds: []
    })),
    evidence: [], architectureFingerprint: "detail-composite-groups"
  };

  ui.renderGraph(graph);
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();

  const blueprint = ui.state.layout.plan.detailBlueprint;
  const chainCard = blueprint.cards.find((card) => card.originalNodeIds.includes("chain-a"));
  assert.ok(chainCard, "선택 Chain 복합 카드 필요");
  const expectedFilterIds = ui.state.viewGraph.nodes.filter((node) => node.type === "FILTER"
    && node.attributes.registrationKind === "SECURITY").map((node) => node.id);
  assert.equal(expectedFilterIds.length, 5, "선택 Chain의 확인된 Filter 5개 필요");
  assert.deepEqual(Array.from(chainCard.items.flatMap((item) => item.originalNodeIds)
    .filter((id) => id === "chain-a" || expectedFilterIds.includes(id))).sort(),
  ["chain-a", ...expectedFilterIds].sort());
  assert.deepEqual(chainCard.items.flatMap((item) => item.originalNodeIds)
    .filter((id) => expectedFilterIds.includes(id)), expectedFilterIds.slice().sort((left, right) =>
    Number(ui.state.viewGraph.nodes.find((node) => node.id === left).attributes.filterOrder)
      - Number(ui.state.viewGraph.nodes.find((node) => node.id === right).attributes.filterOrder)));
  assert.ok(chainCard.runtimeComponentIds.includes("runtime-chain"));
  assert.equal(blueprint.cards.some((card) => card.runtimeComponentIds.some((id) =>
    id.startsWith("runtime-resolver-") || id.startsWith("runtime-converter-")
      || id === "runtime-filter-map")), false, "등록 보조 객체 전용 카드 없음");
  assert.equal(blueprint.runtimeComponents.some((component) => component.id === "runtime-filter-map"), true,
    "FilterMap 원본 Runtime 객체 보존");
  ui.selectGraphElement("runtime-component", "runtime-adapter");
  assert.match(textOf(elements.get("inspector")), /ARGUMENT_RESOLVER/);
  assert.match(textOf(elements.get("inspector")), /MESSAGE_CONVERTER/);
  ui.selectGraphElement("runtime-component", "runtime-servlet-registration");
  assert.match(textOf(elements.get("inspector")), /\/api\/\*/);
  assert.match(textOf(elements.get("inspector")), /ASYNC/);
  const handlerItems = blueprint.cards.flatMap((card) => card.items)
    .filter((item) => item.originalNodeIds.includes("handler-a"));
  assert.equal(handlerItems.length, 1, "Runtime Handler와 Graph Handler 중복 표시 금지");
  assert.ok(handlerItems[0].runtimeComponentIds.includes("runtime-handler"));

  const projectionIds = ui.state.layout.plan.projection.nodes.map((node) => node.id).sort();
  const mappedProjectionIds = blueprint.cards.flatMap((card) => card.items.flatMap((item) => item.projectionNodeIds || [])).sort();
  assert.ok(projectionIds.every((id) => mappedProjectionIds.includes(id)), "표시 학습 단계를 실제 복합 Item으로 역참조");
  assert.equal(projectionIds.includes("education-servlet-chain-continue"), false);
  assert.equal(projectionIds.includes("education-handler-mapping"), false, "실제 Runtime HandlerMapping Item 별칭 사용");
  assert.equal(projectionIds.includes("education-handler-adapter"), false, "실제 Runtime HandlerAdapter Item 별칭 사용");
  assert.equal(ui.state.layout.plan.displayModel.projectionToItemIds["education-delegating-filter-proxy"]?.length || 0, 0,
    "DelegatingFilterProxy 등록 근거가 없는 경우 교육용 Proxy를 실제 Item으로 만들지 않음");
  ["education-filter-chain-proxy", "education-handler-mapping", "education-handler-adapter"]
    .forEach((id) => assert.ok(ui.state.layout.plan.displayModel.projectionToItemIds[id]?.length,
      `${id} 학습 단계의 실제 표시 Item Alias 필요`));
  const projectionEdgeIds = ui.state.layout.plan.projection.edges.map((edge) => edge.id);
  projectionEdgeIds.forEach((id) => {
    const relation = blueprint.routingPlan.relations.find((item) => (item.projectionEdgeIds || []).includes(id));
    assert.ok(relation && blueprint.routingPlan.routesByRelationId[relation.id], `${id}의 새 Blueprint 경로 필요`);
    const segmentIds = ui.state.layout.plan.displayModel.projectionEdgeToSegmentIds[id];
    assert.ok(segmentIds && segmentIds.length > 0, `${id}의 실제 Segment 연결 필요`);
    assert.equal(segmentIds.every((segmentId) => blueprint.routingPlan.segments.some((segment) => segment.id === segmentId)), true);
  });
  assert.equal(elements.get("graph-flow-projection").children.length, 0, "숨겨진 기존 Projection 경로 제거");
  assert.ok(findAllByClass(elements.get("graph-edges"), "graph-projection-edge").length > 0,
    "교육 관계를 실제 Projection 경로로 렌더링");
});

test("Overview와 Detail은 보안 Item의 의미 이름과 기본 기하를 공유함", async () => {
  const { ui } = loadUi();
  const graph = detailGraphFixture();
  const policy = graph.nodes.find((node) => node.id === "authorization-a");
  policy.label = "policy|springSecurityFilterChain|ANY|1|19|PATH|/error|PERMIT_ALL";
  policy.attributes = {
    policySource: "URL",
    policyKind: "PERMIT_ALL",
    policyMatcherCondition: "/error",
    policyOrder: "19",
    httpMethod: "ANY"
  };

  ui.renderGraph(graph);
  await ui.layoutGraph();
  const overviewPlan = ui.state.layout.plan;
  const overviewItemId = overviewPlan.displayModel.originalNodeToItemIds[policy.id][0];
  const overviewItem = overviewPlan.displayModel.itemById[overviewItemId];

  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();
  const detailPlan = ui.state.layout.plan;
  const detailItemId = detailPlan.displayModel.originalNodeToItemIds[policy.id][0];
  const detailItem = detailPlan.displayModel.itemById[detailItemId];

  assert.equal(overviewItem.label, "공개 접근 허용");
  assert.match(overviewItem.detail, /URL 정책.*\/error.*순서 19/);
  assert.equal(detailItem.label, overviewItem.label);
  assert.equal(detailItem.detail, overviewItem.detail);
  assert.equal(detailItem.kind, overviewItem.kind);
  assert.equal(detailItem.bounds.height, overviewItem.bounds.height);
  assert.doesNotMatch(`${detailItem.label} ${detailItem.detail}`, /policy\|springSecurityFilterChain/);
});

test("상세 Blueprint는 Graph Node가 없는 실제 Servlet Filter 등록을 표시함", async () => {
  const { ui, window } = loadUi();
  const graph = detailGraphFixture();
  const runtimeComponent = (id, kind, parentId, graphNodeIds = [], attributes = {}) => ({
    id, kind, className: "com.example.AuditFilter", beanName: null, contextId: "app", parentId,
    attributes, graphNodeIds, evidenceIds: []
  });
  graph.runtimeArchitecture = {
    environment: { webApplicationType: "SERVLET", serverKind: "TOMCAT", deploymentMode: "EMBEDDED" },
    components: [
      runtimeComponent("runtime-app", "APPLICATION_CONTEXT", null),
      runtimeComponent("runtime-server", "WEB_SERVER", "runtime-app"),
      runtimeComponent("runtime-servlet-context", "SERVLET_CONTEXT", "runtime-server", ["servlet-1"]),
      runtimeComponent("runtime-dispatcher", "SERVLET", "runtime-servlet-context", ["servlet-1"]),
      runtimeComponent("runtime-servlet-filter", "SERVLET_FILTER_REGISTRATION", "runtime-servlet-context", [], {
        filterClass: "com.example.AuditFilter", registrationName: "auditFilter", registrationOrder: "2"
      })
    ],
    relationships: [
      { id: "context-registers-filter", sourceId: "runtime-servlet-context", targetId: "runtime-servlet-filter",
        kind: "REGISTERS", confidence: "CONFIRMED", attributes: {}, evidenceIds: [] }
    ],
    coverage: ["WEB_SERVER", "SERVLET", "SECURITY", "MVC"].map((area) => ({
      collectorId: area.toLowerCase(), area, scope: "app", state: "PRESENT", reasonCode: "OBSERVED", evidenceIds: []
    })),
    evidence: [], architectureFingerprint: "runtime-servlet-filter"
  };

  ui.renderGraph(graph);
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();

  const blueprint = ui.state.layout.plan.detailBlueprint;
  assert.ok(blueprint.runtimeComponents.some((component) => component.id === "runtime-servlet-filter"));
  const filterItem = blueprint.cards.flatMap((card) => card.items)
    .find((item) => item.runtimeComponentIds.includes("runtime-servlet-filter"));
  assert.ok(filterItem, "Graph Node가 없는 등록 Filter 표시 Item");
  assert.equal(filterItem.label, "AuditFilter");
  assert.equal(filterItem.executionOrderStatus, "UNKNOWN");
  assert.equal(filterItem.order, null);
  assert.match(filterItem.detail, /등록 확인.*적용 순서 확인 불가.*등록 2/);
  const steps = window.MapInBootRequestFlow.buildSteps({
    graph: ui.state.viewGraph,
    index: window.MapInBootFlow.createIndex(ui.state.viewGraph),
    endpointId: "endpoint-a",
    positions: ui.state.layout.plan.positions,
    projection: ui.state.layout.plan.projection,
    snapshot: graph,
    displayModel: ui.state.layout.plan.displayModel
  });
  assert.equal(steps.some((step) => step.displayItemId === filterItem.id), false,
    "FilterMap에 근거한 적용 순서가 없으면 개별 Filter를 순차 재생하지 않음");
  assert.equal(steps.some((step) => /선택 API의 적용 순서를 확정할 근거가 부족/.test(step.description)), true);
});

test("Tomcat FilterMap은 URL·서블릿 이름 순서와 등록 단위 중복 제거로 선택 API 흐름을 구성함", async () => {
  const { ui, window, elements } = loadUi();
  const graph = detailGraphFixture();
  const policy = graph.nodes.find((node) => node.id === "authorization-a");
  Object.assign(policy.attributes, { policySource: "URL", chainKey: "chain-a", policyKind: "PERMIT_ALL" });
  const graphFilter = graph.nodes.find((node) => node.id === "servlet-filter-1");
  graphFilter.attributes.registrationName = "requestAudit";
  graphFilter.attributes.filterClass = "com.example.AuditFilter";
  const component = (id, kind, className, beanName, parentId, attributes = {}, graphNodeIds = []) => ({
    id, kind, className, beanName, contextId: "app", parentId, attributes, graphNodeIds, evidenceIds: []
  });
  const registration = (id, name, className, registrationOrder, graphNodeIds = []) => component(
    id, "SERVLET_FILTER_REGISTRATION", className, name, "runtime-servlet-context",
    { registrationName: name, filterClass: className, registrationOrder }, graphNodeIds);
  const filterMap = (id, filterName, registrationOrder,
    { urlPatterns = [], servletNames = [], dispatcherTypes = "REQUEST" } = {}) => component(
    id, "TOMCAT_FILTER_MAPPING", "org.apache.tomcat.util.descriptor.web.FilterMap", null, "runtime-tomcat-context", {
      filterName, registrationOrder: String(registrationOrder), urlPatterns: urlPatterns.join(","),
      servletNames: servletNames.join(","), dispatcherTypes,
      matchAllUrlPatterns: "false", matchAllServletNames: "false"
    });
  graph.runtimeArchitecture = {
    environment: { webApplicationType: "SERVLET", serverKind: "TOMCAT", deploymentMode: "EMBEDDED" },
    components: [
      component("runtime-app", "APPLICATION_CONTEXT", "org.springframework.context.ApplicationContext", null, null),
      component("runtime-server", "WEB_SERVER", "org.springframework.boot.web.embedded.tomcat.TomcatWebServer", null, "runtime-app"),
      component("runtime-tomcat-context", "TOMCAT_CONTEXT", "org.apache.catalina.core.StandardContext", null, "runtime-server"),
      component("runtime-servlet-context", "SERVLET_CONTEXT", "org.apache.catalina.core.ApplicationContextFacade", null,
        "runtime-tomcat-context", {}, ["servlet-1"]),
      component("runtime-dispatcher", "DISPATCHER_SERVLET", "org.springframework.web.servlet.DispatcherServlet",
        "dispatcherServlet", "runtime-servlet-context", { registrationName: "dispatcherServlet", urlPatterns: "/" }, ["servlet-1"]),
      registration("runtime-filter-before", "requestAudit", "com.example.AuditFilter", "9", ["servlet-filter-1"]),
      registration("runtime-delegating", "springSecurityFilterChain", "org.springframework.web.filter.DelegatingFilterProxy", "8"),
      registration("runtime-filter-after", "responseAudit", "com.example.AuditFilter", "1"),
      registration("runtime-filter-outside", "adminAudit", "com.example.AdminFilter", "2"),
      filterMap("map-outside", "adminAudit", 1, { urlPatterns: ["/admin/*"] }),
      filterMap("map-before", "requestAudit", 2,
        { urlPatterns: ["/orders/*"], servletNames: ["dispatcherServlet"] }),
      filterMap("map-proxy", "springSecurityFilterChain", 3, { urlPatterns: ["/orders/*"] }),
      filterMap("map-after", "responseAudit", 4, { servletNames: ["dispatcherServlet"], dispatcherTypes: "" }),
      filterMap("map-before-duplicate", "requestAudit", 5, { servletNames: ["dispatcherServlet"] })
    ],
    relationships: [],
    coverage: ["WEB_SERVER", "SERVLET", "SECURITY", "MVC"].map((area) => ({
      collectorId: area.toLowerCase(), area, scope: "app", state: "PRESENT", reasonCode: "OBSERVED", evidenceIds: []
    })),
    evidence: [], architectureFingerprint: "tomcat-filter-map-order"
  };

  ui.renderGraph(graph);
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();

  const plan = ui.state.layout.plan;
  const execution = plan.detailBlueprint.servletFilterExecution;
  const modelContext = plan.displayModel;
  const contextItem = modelContext.itemById[modelContext.projectionToItemIds["education-servlet-container"]?.[0]];
  assert.ok(contextItem?.runtimeComponentIds.includes("runtime-servlet-context"));
  assert.equal(contextItem.label, "ApplicationContextFacade");
  assert.equal(modelContext.composites.filter((card) => card.title === "서블릿 컨테이너").length, 1);
  assert.equal(execution.status, "CONFIRMED", JSON.stringify({ execution,
    servlets: plan.detailBlueprint.runtimeComponents.filter((component) => component.kind.includes("SERVLET"))
      .map((component) => ({ id: component.id, kind: component.kind, contextId: component.contextId,
        attributes: component.attributes, graphNodeIds: component.graphNodeIds })) }));
  assert.deepEqual(Array.from(execution.orderedComponentIds),
    ["runtime-filter-before", "runtime-delegating", "runtime-filter-after"]);
  assert.deepEqual(Array.from(execution.entries.find((entry) => entry.componentId === "runtime-filter-before").mappingIds),
    ["map-before", "map-before-duplicate"]);
  assert.equal(execution.entries.find((entry) => entry.componentId === "runtime-filter-outside").status, "NOT_APPLIED");

  const steps = window.MapInBootRequestFlow.buildSteps({ graph: ui.state.viewGraph,
    index: window.MapInBootFlow.createIndex(ui.state.viewGraph), endpointId: "endpoint-a",
    positions: plan.positions, projection: plan.projection, snapshot: graph, displayModel: plan.displayModel });
  const stepIds = steps.map((step) => step.id);
  const beforeIndex = stepIds.indexOf("servlet-filter-runtime-filter-before");
  const proxyIndex = stepIds.indexOf("servlet-filter-runtime-delegating");
  const securityIndex = stepIds.indexOf("security-chain");
  const afterIndex = stepIds.indexOf("servlet-filter-runtime-filter-after");
  const dispatcherIndex = stepIds.indexOf("dispatcher-servlet");
  assert.ok(steps[dispatcherIndex].displayItemId, "DispatcherServlet 표시 항목");
  assert.notEqual(steps[dispatcherIndex].displayItemId, contextItem.id);
  assert.ok(beforeIndex >= 0 && beforeIndex < proxyIndex);
  assert.ok(proxyIndex < securityIndex && securityIndex < afterIndex && afterIndex < dispatcherIndex);
  assert.equal(steps[beforeIndex].transition?.kind, "internal");
  const model = plan.displayModel;
  const beforeCard = model.cardById[model.itemById[steps[beforeIndex].displayItemId].cardId];
  const proxyCard = model.cardById[model.itemById[steps[proxyIndex].displayItemId].cardId];
  const afterCard = model.cardById[model.itemById[steps[afterIndex].displayItemId].cardId];
  const chainCard = model.cardById[model.itemById[steps[securityIndex].displayItemId].cardId];
  assert.equal(beforeCard.id, proxyCard.id);
  assert.notEqual(proxyCard.id, afterCard.id);
  assert.ok(proxyCard.bounds.x < chainCard.bounds.x && chainCard.bounds.x < afterCard.bounds.x);
  assert.equal(steps[proxyIndex].transition?.kind, "display");
  const lastFilterIndex = steps.findIndex((step) => step.id === "security-filter-security-filter-2");
  const policyIndex = stepIds.indexOf("authorization-policy");
  assert.ok(lastFilterIndex < policyIndex && policyIndex < afterIndex);
  assert.equal(steps[lastFilterIndex].transition?.kind, "display");
  assert.equal(steps[policyIndex].transition?.kind, "display");
  const policyCard = model.cardById[model.itemById[steps[policyIndex].displayItemId].cardId];
  assert.ok(chainCard.bounds.x < policyCard.bounds.x && policyCard.bounds.x < afterCard.bounds.x);
  assert.equal(steps[afterIndex].transition?.kind, "display");
  const contextStep = ui.state.requestFlowSteps.findIndex((step) => step.id === "education-servlet-container");
  assert.ok(contextStep >= 0);
  assert.equal(ui.state.requestFlowSteps[contextStep].displayItemId, contextItem.id);
  ui.requestFlow.seekToStep(contextStep);
  const contextElement = findAllByClass(elements.get("graph-nodes"), "graph-composite-item")
    .find((element) => element.getAttribute("data-composite-item-id") === contextItem.id);
  assert.equal(contextElement.getAttribute("data-request-flow-active"), "true");
  contextElement.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selection.kind, "runtime-component");
  assert.equal(ui.state.selection.id, "runtime-servlet-context");
  for (const relation of plan.overviewRouting.relations.filter((entry) => entry.role === "LEARNING_FLOW" && !entry.internalCardId)) {
    if (relation.projectionEdgeIds.some((id) => id.startsWith("handler-to-http-response"))) continue;
    const from = model.cardById[relation.sourceInstanceId];
    const to = model.cardById[relation.targetInstanceId];
    assert.ok(from.bounds.x < to.bounds.x, `역행 ${relation.projectionEdgeIds.join(",")} ${from.title} → ${to.title}`);
    assert.ok(plan.overviewRouting.routesByRelationId[relation.id], `경로 누락 ${relation.projectionEdgeIds.join(",")}`);
  }
});

test("상세 Blueprint는 HTTP 요청과 Request·Response 객체 준비를 구분함", async () => {
  const { ui, window } = loadUi();
  const graph = detailGraphFixture();
  graph.runtimeArchitecture = {
    environment: { webApplicationType: "SERVLET", serverKind: "UNKNOWN", deploymentMode: "UNKNOWN" },
    components: [], relationships: [], coverage: ["SERVLET", "SECURITY", "MVC"].map((area) => ({
      collectorId: area.toLowerCase(), area, scope: "app", state: "PRESENT", reasonCode: "OBSERVED", evidenceIds: []
    })),
    evidence: [], architectureFingerprint: "servlet-learning"
  };

  ui.renderGraph(graph);
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();

  const plan = ui.state.layout.plan;
  const projectionIds = new Set(plan.projection.nodes.map((node) => node.id));
  ["education-http-request", "education-http-servlet-request", "education-http-servlet-response"]
    .forEach((id) => assert.equal(projectionIds.has(id), true, `${id} 표시`));
  assert.equal(projectionIds.has("education-request-prepare"), false);
  const itemFor = (id) => plan.displayModel.itemById[plan.displayModel.projectionToItemIds[id]?.[0]];
  const requestItem = itemFor("education-http-servlet-request");
  const responseItem = itemFor("education-http-servlet-response");
  assert.equal(requestItem.label, "HttpServletRequest");
  assert.equal(responseItem.label, "HttpServletResponse");
  assert.equal(requestItem.originalNodeIds.length, 0);
  assert.equal(responseItem.originalNodeIds.length, 0);
  assert.equal(requestItem.runtimeComponentIds.length, 0);
  assert.equal(responseItem.runtimeComponentIds.length, 0);
  assert.equal(plan.projection.edges.some((edge) =>
    edge.sourceId === "education-http-servlet-request" && edge.targetId === "education-http-servlet-response"
      || edge.sourceId === "education-http-servlet-response" && edge.targetId === "education-http-servlet-request"), false);

  const steps = window.MapInBootRequestFlow.buildSteps({
    graph: ui.state.viewGraph,
    index: window.MapInBootFlow.createIndex(ui.state.viewGraph),
    endpointId: "endpoint-a",
    positions: plan.positions,
    projection: plan.projection,
    snapshot: graph,
    displayModel: plan.displayModel
  });
  assert.ok(steps.some((step) => step.id === "education-http-request"));
  assert.ok(steps.some((step) => step.id === "education-http-servlet-request" && step.label === "요청·응답 객체"));
  assert.equal(steps.some((step) => step.id === "education-request-prepare"), false);
  assert.equal(steps.find((step) => step.id === "education-http-request").transition?.kind, "display");
});

test("Reactive Snapshot의 상세 Blueprint는 Servlet 학습 경로와 영역을 만들지 않음", async () => {
  const { ui, elements } = loadUi();
  const graph = detailGraphFixture();
  graph.runtimeArchitecture = {
    environment: { webApplicationType: "REACTIVE", serverKind: "NETTY", deploymentMode: "EMBEDDED" },
    components: [], relationships: [], coverage: [
      { area: "SERVLET", state: "NOT_SUPPORTED" },
      { area: "SECURITY", state: "NOT_SUPPORTED" },
      { area: "MVC", state: "NOT_SUPPORTED" }
    ], evidence: [], architectureFingerprint: "reactive-runtime"
  };
  ui.renderGraph(graph);
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();

  const blueprint = ui.state.layout.plan.detailBlueprint;
  assert.equal(blueprint.supported, false);
  assert.equal(blueprint.regions.length, 0);
  assert.equal(ui.state.layout.plan.projection.nodes.length, 0, JSON.stringify({ type: graph.runtimeArchitecture.environment.webApplicationType,
    supported: blueprint.supported, nodes: ui.state.layout.plan.projection.nodes.map((node) => node.id) }));
  assert.equal(ui.state.layout.plan.projection.edges.length, 0);
  const status = findAllByClass(elements.get("graph-areas"), "runtime-blueprint-status")[0];
  assert.ok(status);
  assert.equal(status.getAttribute("data-runtime-status"), "UNSUPPORTED");
});

test("Runtime Coverage에서 Security와 MVC가 확인된 미사용이면 교육용 영역을 숨김", async () => {
  const { ui } = loadUi();
  const graph = detailGraphFixture();
  const omittedIds = new Set(graph.nodes.filter((node) => ["SECURITY_CHAIN", "FILTER", "AUTHENTICATION", "AUTHORIZATION", "SECURITY_DATA"]
    .includes(node.type)).map((node) => node.id));
  graph.nodes = graph.nodes.filter((node) => !omittedIds.has(node.id));
  graph.edges = graph.edges.filter((edge) => !omittedIds.has(edge.sourceId) && !omittedIds.has(edge.targetId));
  graph.runtimeArchitecture = {
    environment: { webApplicationType: "SERVLET", serverKind: "TOMCAT", deploymentMode: "EMBEDDED" },
    components: [
      { id: "runtime-app", kind: "APPLICATION_CONTEXT", className: "org.springframework.context.ApplicationContext", contextId: "app", parentId: null, attributes: {}, graphNodeIds: [], evidenceIds: [] },
      { id: "runtime-server", kind: "WEB_SERVER", className: "org.springframework.boot.web.embedded.tomcat.TomcatWebServer", contextId: "app", parentId: "runtime-app", attributes: {}, graphNodeIds: [], evidenceIds: [] },
      { id: "runtime-context", kind: "SERVLET_CONTEXT", className: "org.apache.catalina.core.StandardContext", contextId: "app", parentId: "runtime-server", attributes: {}, graphNodeIds: [], evidenceIds: [] }
    ],
    relationships: [],
    coverage: [
      { area: "SERVLET", state: "PRESENT" },
      { area: "SECURITY", state: "ABSENT" },
      { area: "MVC", state: "ABSENT" }
    ], evidence: [], architectureFingerprint: "servlet-without-mvc-security"
  };
  ui.renderGraph(graph);
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();

  const blueprint = ui.state.layout.plan.detailBlueprint;
  assert.equal(blueprint.regions.some((region) => region.id === "runtime-region:security"), false);
  assert.equal(blueprint.regions.some((region) => region.id === "runtime-region:mvc"), false);
  assert.equal(ui.state.layout.plan.projection.nodes.some((node) => /security|handler-mapping|handler-adapter/i.test(node.id)), false);
});

test("Unknown 호스트 구성은 실제 서버 종류를 만들지 않고 확인된 애플리케이션 객체만 표시함", async () => {
  const { ui } = loadUi();
  const graph = detailGraphFixture();
  graph.runtimeArchitecture = {
    environment: { webApplicationType: "UNKNOWN", serverKind: "UNKNOWN", deploymentMode: "UNKNOWN" },
    components: [{ id: "runtime-app", kind: "APPLICATION_CONTEXT", className: "org.springframework.context.ApplicationContext",
      contextId: "app", parentId: null, attributes: {}, graphNodeIds: [], evidenceIds: [] }],
    relationships: [], coverage: [
      { area: "WEB_SERVER", state: "UNKNOWN" }, { area: "SERVLET", state: "UNKNOWN" },
      { area: "SECURITY", state: "UNKNOWN" }, { area: "MVC", state: "UNKNOWN" }
    ], evidence: [], architectureFingerprint: "unknown-host-runtime"
  };
  ui.renderGraph(graph);
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();

  const blueprint = ui.state.layout.plan.detailBlueprint;
  assert.equal(blueprint.regions.some((region) => /TOMCAT|JETTY|SERVLET CONTAINER/.test(region.title)), false);
  assert.equal(blueprint.regions.some((region) => region.title === "애플리케이션 실행 환경"), true);
  assert.deepEqual(Array.from(blueprint.cards.filter((card) => card.runtimeComponentIds.length),
    (card) => card.runtimeComponentIds[0]), []);
  assert.equal(blueprint.runtimeComponents.some((component) => component.id === "runtime-app"), true,
    "ApplicationContext 원본은 Runtime Inspector 대상에 유지");
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
  assert.match(textOf(elements.get("inspector")), new RegExp(ui.state.displayIds.edge("reads-a")));
  assert.doesNotMatch(textOf(elements.get("inspector")), /reads-a/);
  assert.match(textOf(elements.get("inspector")), /보안정보 읽기/);
  ui.selectGraphElement("edge", "uses-a");
  assert.match(textOf(elements.get("inspector")), new RegExp(ui.state.displayIds.edge("uses-a")));
  assert.doesNotMatch(textOf(elements.get("inspector")), /uses-a/);
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

test("Request 교육 단계는 중복 설명 노드를 제거하고 확인 가능한 실제 처리 항목을 사용함", () => {
  const { window, layoutApi } = loadUi();
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
  normalized.presentationContext = "detail";
  const index = window.MapInBootFlow.createIndex(normalized);
  const layout = layoutApi.semanticLayout(normalized, { positions: {} });
  const removedProjectionIds = new Set(["education-thread-context",
    "education-servlet-filter-chain", "education-servlet-chain-continue"]);
  assert.equal(layout.plan.projection.nodes.some((node) => removedProjectionIds.has(node.id)), false);
  assert.equal(layout.plan.projection.nodes.some((node) => node.id === "education-request-prepare"), true);
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
    },
    projection: layout.plan.projection
  });
  const actualAnchors = Array.from(steps
    .filter((step) => step.kind === "actual"), (step) => step.anchorId);

  assert.deepEqual(actualAnchors, ["servlet-filter-1", "chain-a", "security-filter-1", "security-filter-2", "security-filter-3", "servlet-1", "endpoint-a", "handler-a"]);
  assert.equal(steps.some((step) => step.label.includes("HTTP 요청")), true);
  assert.equal(steps.some((step) => step.id === "education-request-prepare"), true);
  assert.equal(steps.some((step) => /요청 정보 준비|동기 처리 문맥|FilterChain 전달|FilterChain 계속/.test(step.label)), false);
  const responseReturn = steps.at(-1);
  assert.equal(responseReturn.id, "education-http-response");
  assert.equal(responseReturn.kind, "education");
  assert.equal(responseReturn.anchorId, "education-http-response");
  assert.equal(responseReturn.transition, null);
  assert.match(responseReturn.description, /Handler 결과|호출자/);
  assert.equal(responseReturn.label, "HTTP 응답");
  assert.equal(steps.some((step) => step.anchorId === "chain-b"), false);
  assert.equal(steps.some((step) => step.anchorId === "other-chain-filter"), false);
  assert.equal(steps.some((step) => step.id.startsWith("security-checks:")), false);
  assert.equal(steps.some((step) => step.anchorId === "education-servlet-chain-continue"), false);
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
    positions: {},
    projection: layoutApi.semanticLayout(uncertainGraph, { positions: {} }).plan.projection
  });
  assert.equal(Array.from(uncertainSteps, (step) => step.anchorId).includes("security-filter-1"), false);
  assert.equal(uncertainSteps.some((step) => step.description.includes("Security Filter 순서 확인 불가")), true,
    JSON.stringify(uncertainSteps.map(({ id, label, description }) => ({ id, label, description }))));
  assert.equal(uncertainSteps.some((step) => step.id.startsWith("security-checks:")), false);

  const unselectedSteps = window.MapInBootRequestFlow.buildSteps({
    graph: uncertainGraph,
    index: window.MapInBootFlow.createIndex(uncertainGraph),
    endpointId: "missing-endpoint",
    positions: {},
    projection: layout.plan.projection
  });
  assert.equal(unselectedSteps.some((step) => step.id === "endpoint-mapping"), false);
  assert.equal(unselectedSteps.some((step) => step.id.startsWith("security-checks:")), false);
});

test("Request 교육 표준 Filter 단계는 기존 교육 메타데이터와 Snapshot 분류 상태를 사용함", () => {
  const { window } = loadUi();
  const snapshot = standardFilterGraphFixture();
  snapshot.edges.push({
    id: "custom-filtered-by-chain-a",
    sourceId: "chain-a",
    targetId: "custom-csrf-filter",
    type: "FILTERED_BY",
    attributes: { registrationKind: "SECURITY", filterOrder: "3" },
    confidence: "CONFIRMED",
    evidenceIds: ["evidence-custom-filtered-by-chain-a"]
  });
  const graph = window.MapInBootGraph.normalize(snapshot);
  const steps = window.MapInBootRequestFlow.buildSteps({
    graph,
    index: window.MapInBootFlow.createIndex(graph),
    endpointId: "endpoint-a",
    positions: {},
    snapshot
  });
  const csrfStep = steps.find((step) => step.anchorId === "security-filter-1");
  const customStep = steps.find((step) => step.anchorId === "custom-csrf-filter");
  const csrfReference = window.MapInBootStandardFilters.list()
    .find((reference) => reference.fqcn === "org.springframework.security.web.csrf.CsrfFilter");
  const csrfStatus = window.MapInBootStandardFilters.classify(snapshot, snapshot.analysisStatus, "chain-a")
    .find((entry) => entry.fqcn === csrfReference.fqcn);

  assert.equal(csrfStep.filterEducation.fqcn, csrfReference.fqcn);
  assert.equal(csrfStep.filterEducation.input, csrfReference.input);
  assert.equal(csrfStep.filterEducation.processing, csrfReference.processing);
  assert.equal(csrfStep.filterEducation.status, csrfStatus.status);
  assert.equal(csrfStep.filterEducation.statusLabel, csrfStatus.statusLabel);
  assert.equal(customStep.filterEducation, null);
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

test("Request 교육은 복합 카드 내부 경로와 라우팅된 표시 관계를 구분함", () => {
  const { window, layoutApi } = loadUi();
  const graph = window.MapInBootGraph.normalize(detailGraphFixture());
  graph.presentationContext = "detail";
  graph.detailEndpointId = "endpoint-a";
  const index = window.MapInBootFlow.createIndex(graph);
  const layout = layoutApi.semanticLayout(graph, { positions: {} });
  const unrenderedSteps = window.MapInBootRequestFlow.buildSteps({
    graph,
    index,
    endpointId: "endpoint-a",
    positions: {},
    projection: layout.plan.projection
  });
  const steps = window.MapInBootRequestFlow.buildSteps({
    graph, index, endpointId: "endpoint-a", positions: layout.plan.positions,
    projection: layout.plan.projection, displayModel: layout.plan.displayModel
  });
  const unrenderedChain = unrenderedSteps.find((step) => step.anchorId === "chain-a");
  const chain = steps.find((step) => step.anchorId === "chain-a");
  const firstFilter = steps.find((step) => step.anchorId === "security-filter-1");
  assert.ok(chain.transition, JSON.stringify({
    chainItemIds: layout.plan.displayModel.originalNodeToItemIds["chain-a"],
    filterItemIds: layout.plan.displayModel.originalNodeToItemIds["security-filter-1"],
    candidateRelations: layout.plan.displayModel.displayRelations.filter((relation) =>
      relation.originalEdgeIds.includes("security-filtered-1")
        || relation.projectionEdgeIds.some((id) => id.startsWith("chain-to-filter-")))
      .map((relation) => ({ id: relation.id, role: relation.role, sourceItemId: relation.sourceItemId,
        targetItemId: relation.targetItemId, projectionEdgeIds: relation.projectionEdgeIds,
        segmentIds: layout.plan.displayModel.displayRelationToSegmentIds[relation.id] }))
  }));
  const routedIds = layout.plan.displayModel.displayRelationToSegmentIds[chain.transition.relationId];

  assert.equal(unrenderedChain.transition, null, "화면에 배치되지 않은 Graph 관계는 재생 경로가 아님");
  assert.equal(chain.transition.kind, "internal");
  assert.equal(chain.transition.sourceId, layout.plan.displayModel.originalNodeToItemIds["chain-a"][0]);
  assert.equal(chain.transition.targetId, layout.plan.displayModel.originalNodeToItemIds["security-filter-1"][0]);
  assert.equal(Array.isArray(routedIds) && routedIds.length > 0, false);
  assert.equal(firstFilter.transition.kind, "internal");
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

test("Request Controller 설정 변경은 재생 중 Node·Edge 진행률과 현재 단계를 보존함", () => {
  const { window } = loadUi();
  const clock = createFakeClock();
  const controller = window.MapInBootRequestFlow.createController({
    clock,
    nodeHoldDuration: 1000,
    minimumEdgeDuration: 300,
    maximumEdgeDuration: 300,
    durationPerLength: 1
  });
  controller.setSteps([
    { id: "first", kind: "actual", anchorId: "node-a", transition: { kind: "actual", edgeId: "edge-a", length: 300 } },
    { id: "second", kind: "actual", anchorId: "node-b" }
  ]);
  controller.play();
  clock.tick(400);
  assert.equal(controller.state().progress, 0.4);
  controller.setPlaybackSettings({ nodeHoldDuration: 2000 });
  assert.equal(controller.state().progress, 0.4);
  assert.equal(controller.state().phase, "NODE_HOLD");
  assert.equal(controller.state().stepIndex, 0);
  clock.tick(1199);
  assert.equal(controller.state().phase, "NODE_HOLD");
  clock.tick(1);
  assert.equal(controller.state().phase, "EDGE_TRAVEL");

  clock.tick(120);
  assert.equal(controller.state().progress, 0.4);
  controller.setPlaybackSettings({ speed: 2 });
  assert.equal(controller.state().progress, 0.4);
  assert.equal(controller.state().phase, "EDGE_TRAVEL");
  controller.pause();
  controller.setPlaybackSettings({ speed: 0.5 });
  assert.equal(controller.state().status, "paused");
  assert.equal(controller.state().progress, 0.4);
  clock.tick(500);
  assert.equal(controller.state().progress, 0.4);
  controller.play();
  clock.tick(359);
  assert.equal(controller.state().phase, "EDGE_TRAVEL");
  clock.tick(1);
  assert.equal(controller.state().stepIndex, 1);
  assert.equal(controller.state().phase, "NODE_HOLD");

  controller.pause();
  const pausedIndex = controller.state().stepIndex;
  controller.setPlaybackSettings({ nodeHoldDuration: 3000 });
  assert.equal(controller.state().status, "paused");
  assert.equal(controller.state().stepIndex, pausedIndex);
  assert.equal(controller.activeFrameCount(), 0);
});

test("Request 교육 Controller의 단계 탐색은 경계·중간 재생·완료 상태를 보존함", () => {
  const { window } = loadUi();
  const clock = createFakeClock();
  const controller = window.MapInBootRequestFlow.createController({
    clock,
    nodeHoldDuration: 100,
    stepNoticeDuration: 80
  });
  controller.setSteps([
    { id: "step-a", label: "A", kind: "actual", anchorId: "node-a" },
    { id: "step-b", label: "B", kind: "education" },
    { id: "step-c", label: "C", kind: "actual", anchorId: "node-c" }
  ]);

  assert.equal(controller.seekToStep(-1), false);
  assert.equal(controller.seekToStep(3), false);
  assert.equal(controller.state().status, "idle");
  assert.equal(controller.state().stepIndex, 0);
  controller.play();
  assert.equal(controller.activeFrameCount(), 1);
  assert.equal(controller.seekToStep(-1), false);
  assert.equal(controller.state().status, "running");
  assert.equal(controller.state().stepIndex, 0);
  assert.equal(controller.activeFrameCount(), 1);
  assert.equal(controller.seekToStep(1), true);
  assert.equal(controller.state().status, "paused");
  assert.equal(controller.state().stepIndex, 1);
  assert.equal(controller.state().phase, "STEP_NOTICE");
  assert.equal(controller.state().progress, 0);
  assert.equal(controller.activeFrameCount(), 0);
  clock.tick(500);
  assert.equal(controller.state().stepIndex, 1);

  controller.play();
  assert.equal(controller.state().status, "running");
  assert.equal(controller.state().stepIndex, 1);
  assert.equal(controller.activeFrameCount(), 1);
  controller.pause();
  assert.equal(controller.state().status, "paused");
  assert.equal(controller.state().stepIndex, 1);
  assert.equal(controller.activeFrameCount(), 0);
  assert.equal(controller.seekToStep(2), true);
  assert.equal(controller.state().stepIndex, 2);
  assert.equal(controller.state().phase, "NODE_HOLD");
  assert.equal(controller.state().status, "paused");
  controller.play();
  clock.tick(100);
  assert.equal(controller.state().status, "complete");
  assert.equal(controller.state().stepIndex, 2);
  assert.equal(controller.state().nextStep, null);
  assert.equal(controller.activeFrameCount(), 0);

  assert.equal(controller.seekToStep(0), true);
  assert.equal(controller.state().status, "paused");
  assert.equal(controller.state().phase, "NODE_HOLD");
  assert.equal(controller.state().progress, 0);
  controller.reset();
  assert.equal(controller.state().status, "idle");
  assert.equal(controller.state().stepIndex, 0);
  assert.equal(controller.state().phase, null);
  assert.equal(controller.activeFrameCount(), 0);
});

test("상세 처리 보기에서 단계·표준 Filter 설명·재생 조작을 같은 Controller 상태로 표시함", async () => {
  const animationClock = createFakeClock();
  const { ui, elements } = loadUi({ animationClock });
  const snapshot = standardFilterGraphFixture();
  ui.renderGraph(snapshot);
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();
  const steps = ui.state.requestFlowSteps;
  const filterIndex = steps.findIndex((step) => step.anchorId === "security-filter-1");
  const filterStep = steps[filterIndex];
  const filterNode = findAllByClass(elements.get("graph-nodes"), "graph-node")
    .find((node) => node.getAttribute("data-node-id") === "security-filter-1");
  const nodeIds = Array.from(ui.state.graph.nodes, (node) => node.id);
  const edgeIds = Array.from(ui.state.graph.edges, (edge) => edge.id);

  assert.equal(elements.get("request-flow-details").hidden, true);
  assert.equal(elements.get("request-flow-navigation").hidden, false);
  elements.get("request-flow-detail-toggle").dispatchEvent({ type: "click" });
  assert.equal(elements.get("request-flow-details").hidden, false);
  assert.equal(elements.get("request-flow-popover-count").textContent, `1 / ${steps.length}`);
  assert.equal(ui.requestFlow.state().status, "idle");
  assert.equal(elements.get("request-flow-previous").disabled, true);
  assert.equal(elements.get("request-flow-next").disabled, false);

  elements.get("request-flow-next").dispatchEvent({ type: "click" });
  assert.equal(ui.requestFlow.state().stepIndex, 1);
  assert.equal(ui.requestFlow.state().status, "paused");
  assert.equal(elements.get("request-flow-popover-count").textContent, `2 / ${steps.length}`);
  assert.equal(elements.get("request-flow-previous").disabled, false);

  assert.ok(filterStep.filterEducation);
  assert.equal(ui.requestFlow.seekToStep(filterIndex), true);
  assert.match(elements.get("request-flow-step-description").textContent, /역할을 합니다/);
  assert.equal(elements.get("request-flow-filter-education").hidden, true);
  assert.ok(!elements.get("request-flow-step-title").textContent.includes(" · "));
  assert.equal(filterNode.getAttribute("data-request-flow-active"), "true");
  assert.equal(ui.state.selection.id, "endpoint-a");
  assert.deepEqual(Array.from(ui.state.graph.nodes, (node) => node.id), nodeIds);
  assert.deepEqual(Array.from(ui.state.graph.edges, (edge) => edge.id), edgeIds);

  elements.get("request-flow-start").dispatchEvent({ type: "click" });
  assert.equal(ui.requestFlow.state().status, "running");
  elements.get("request-flow-next").dispatchEvent({ type: "click" });
  assert.equal(ui.requestFlow.state().status, "paused");
  assert.equal(ui.requestFlow.state().stepIndex, filterIndex + 1);
  assert.equal(ui.requestFlow.activeFrameCount(), 0);
  assert.equal(elements.get("request-flow-filter-education").hidden, true);
  assert.equal(filterNode.getAttribute("data-request-flow-active"), null);

  elements.get("request-flow-start").dispatchEvent({ type: "click" });
  elements.get("request-flow-previous").dispatchEvent({ type: "click" });
  assert.equal(ui.requestFlow.state().status, "paused");
  assert.equal(ui.requestFlow.state().stepIndex, filterIndex);
  assert.equal(ui.requestFlow.activeFrameCount(), 0);
  assert.equal(filterNode.getAttribute("data-request-flow-active"), "true");

  elements.get("request-flow-detail-toggle").dispatchEvent({ type: "click" });
  assert.equal(ui.requestFlow.state().stepIndex, filterIndex);
  assert.equal(elements.get("request-flow-details").hidden, true);
  elements.get("request-flow-detail-toggle").dispatchEvent({ type: "click" });
  assert.equal(elements.get("request-flow-details").hidden, false);

  assert.equal(ui.requestFlow.seekToStep(steps.length - 1), true);
  assert.equal(ui.requestFlow.state().step.id, "education-http-response");
  assert.equal(ui.requestFlow.state().step.anchorId, "education-http-response");
  assert.equal(elements.get("request-flow-next").disabled, true);
  assert.equal(elements.get("request-flow-previous").disabled, false);
  assert.equal(findAllByClass(elements.get("graph-nodes"), "graph-node")
    .filter((node) => node.getAttribute("data-request-flow-active") === "true").length, 1);

  elements.get("request-flow-reset").dispatchEvent({ type: "click" });
  assert.equal(ui.requestFlow.state().status, "idle");
  assert.equal(ui.requestFlow.state().stepIndex, 0);
  assert.equal(elements.get("request-flow-previous").disabled, true);

  ui.openEndpointDetail("endpoint-b");
  await ui.layoutGraph();
  assert.equal(ui.state.selectedEndpointId, "endpoint-b");
  assert.equal(ui.requestFlow.state().status, "idle");
  assert.equal(ui.requestFlow.state().stepIndex, 0);
  assert.equal(ui.requestFlow.state().steps.some((step) => step.anchorId === "endpoint-b"), true);
  assert.equal(filterNode.getAttribute("data-request-flow-active"), null);
  assert.equal(elements.get("request-flow-popover-count").textContent, `1 / ${ui.requestFlow.state().steps.length}`);

  ui.returnToAllMap();
  assert.equal(elements.get("request-flow-controls").hidden, true);
  assert.equal(elements.get("request-flow-start").disabled, true);
  assert.equal(elements.get("request-flow-pause").disabled, true);
  assert.equal(elements.get("request-flow-reset").disabled, true);
  assert.equal(elements.get("request-flow-previous").disabled, true);
  assert.equal(elements.get("request-flow-next").disabled, true);
  assert.equal(ui.requestFlow.state().status, "idle");
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
  const first = { getTotalLength: () => 40, getPointAtLength: (distance) => ({ x: distance, y: 0 }) };
  const second = { getTotalLength: () => 60, getPointAtLength: (distance) => ({ x: distance, y: 60 }) };
  assert.deepEqual({ ...window.MapInBootRequestFlow.pathPointAt([first, second], 0.5, 100) }, { x: 10, y: 60 });
  assert.deepEqual({ ...window.MapInBootRequestFlow.pathPointAt([first, second], 1, 100) }, { x: 60, y: 60 });
  const transformedPath = { ...path, getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 100, f: 50 }) };
  const dotFrame = { getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 2, e: 40, f: 20 }) };
  assert.deepEqual({ ...window.MapInBootRequestFlow.pathPointAt(transformedPath, 0.75, 100, dotFrame) },
    { x: 55, y: 27.5 });
  assert.equal(window.MapInBootRequestFlow.pathPointAt({}, 0.5), null);
});

test("Request 교육 reduced-motion은 이동 효과를 줄이고 수동·자동 단계 진행을 유지함", () => {
  const { window } = loadUi();
  const clock = createFakeClock();
  const controller = window.MapInBootRequestFlow.createController({
    clock,
    reducedMotion: true,
    nodeHoldDuration: 100,
    reducedMotionStepDuration: 100
  });
  controller.setSteps([
    { id: "step-a", label: "A", kind: "education" },
    { id: "step-b", label: "B", kind: "actual", anchorId: "node-b" }
  ]);
  controller.play();

  assert.equal(controller.state().status, "running");
  assert.equal(controller.state().stepIndex, 0);
  assert.equal(controller.state().phase, "STEP_NOTICE");
  assert.equal(controller.state().progress, 0);
  assert.equal(controller.activeFrameCount(), 1);
  assert.equal(clock.activeCount(), 1);
  clock.tick(60);
  controller.pause();
  assert.equal(controller.state().status, "paused");
  assert.equal(controller.state().stepIndex, 0);
  controller.play();
  clock.tick(40);
  assert.equal(controller.state().status, "running");
  assert.equal(controller.state().stepIndex, 1);
  assert.equal(controller.state().step.anchorId, "node-b");
  assert.equal(controller.state().phase, "NODE_HOLD");
  assert.equal(controller.state().progress, 0);
  assert.equal(controller.activeFrameCount(), 1);
  clock.tick(100);
  assert.equal(controller.state().status, "complete");
  assert.equal(controller.state().stepIndex, 1);
  assert.equal(controller.activeFrameCount(), 0);
  assert.equal(clock.activeCount(), 0);

  const selectedController = window.MapInBootRequestFlow.createController({
    clock,
    reducedMotion: true,
    nodeHoldDuration: 100,
    reducedMotionStepDuration: 100
  });
  selectedController.setSteps([
    { id: "step-a", label: "A", kind: "actual", anchorId: "node-a" },
    { id: "step-b", label: "B", kind: "education" },
    { id: "step-c", label: "C", kind: "actual", anchorId: "node-c" }
  ]);
  assert.equal(selectedController.seekToStep(1), true);
  selectedController.play();
  assert.equal(selectedController.state().status, "running");
  assert.equal(selectedController.state().stepIndex, 1);
  assert.equal(selectedController.state().phase, "STEP_NOTICE");
  clock.tick(100);
  assert.equal(selectedController.state().stepIndex, 2);
  assert.equal(selectedController.state().status, "running");
  clock.tick(100);
  assert.equal(selectedController.state().status, "complete");
  assert.equal(selectedController.activeFrameCount(), 0);
});

test("동일 레이아웃 재적용은 진행 중인 요청 교육 단계를 초기화하지 않음", async () => {
  const animationClock = createFakeClock();
  const { ui, elements } = loadUi({ animationClock });
  ui.renderGraph(detailGraphFixture());
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();
  const flow = ui.requestFlow;
  const selectedStep = Math.min(2, flow.state().steps.length - 1);
  assert.ok(selectedStep > 0);
  assert.equal(flow.seekToStep(selectedStep), true);
  elements.get("request-flow-start").dispatchEvent({ type: "click" });
  animationClock.tick(40);
  const before = flow.state();

  await ui.layoutGraph();

  const after = flow.state();
  assert.equal(after.status, "running");
  assert.equal(after.stepIndex, before.stepIndex);
  assert.equal(after.phase, before.phase);
  assert.equal(flow.activeFrameCount(), 1);
  assert.equal(ui.state.requestFlowSteps.length, after.steps.length);
});

test("Request 교육은 상세 MAP에서만 표시되고 View 복귀·문서 숨김·재조회 시 정리됨", async () => {
  const { ui, elements, document, window } = loadUi();
  const snapshot = detailGraphFixture();
  ui.renderGraph(snapshot);
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();

  assert.equal(elements.get("request-flow-controls").hidden, false);
  assert.equal(elements.get("request-flow-education").hasAttribute("hidden"), false);
  assert.equal(elements.get("request-flow-status").textContent, "시작 전");
  assert.equal(ui.requestFlow.state().status, "idle");

  ui.requestFlow.setSteps([{ id: "visible-dot", kind: "actual", anchorId: "endpoint-a", position: { x: 10, y: 20 } }]);
  assert.equal(elements.get("request-flow-dot").hasAttribute("hidden"), true);
  ui.requestFlow.play();
  assert.equal(elements.get("request-flow-dot").hasAttribute("hidden"), false);
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
  const stepIndex = steps.findIndex((step) => step.transition && step.transition.kind === "display"
    && step.transition.sourceAnchorId && step.transition.targetAnchorId);
  assert.ok(stepIndex >= 0);
  const first = steps[stepIndex];
  const target = steps[stepIndex + 1];
  assert.equal(first.transition.kind, "display");
  assert.equal(first.transition.sourceAnchorId, first.anchorId);
  assert.equal(first.transition.targetAnchorId, target.anchorId);
  const path = routedSegmentPath(ui, elements, "displayRelationToSegmentIds", first.transition.relationId);
  assert.ok(path);
  const routedId = path.getAttribute("data-segment-id");
  path.setAttribute("data-segment-id", "segment:shared-display");
  path.setAttribute("data-segment-ids", `segment:shared-display,${routedId}`);
  path.getTotalLength = () => 100;
  path.getPointAtLength = (distance) => distance <= 50
    ? { x: distance, y: 0 }
    : { x: 50, y: distance - 50 };
  const source = findAllByClass(elements.get("graph-nodes"), "graph-composite-item")
    .find((node) => (node.getAttribute("data-projection-node-ids") || "").split(",").includes(first.anchorId));
  const destination = findAllByClass(elements.get("graph-nodes"), "graph-composite-item")
    .find((node) => (node.getAttribute("data-projection-node-ids") || "").split(",").includes(target.anchorId));
  assert.ok(source && destination);

  assert.equal(ui.requestFlow.seekToStep(stepIndex), true);
  ui.requestFlow.play();
  assert.equal(source.getAttribute("data-request-flow-active"), "true");
  assert.equal(elements.get("request-flow-dot").hasAttribute("hidden"), false);
  animationClock.tick(1500);
  assert.equal(ui.requestFlow.state().phase, "EDGE_TRAVEL");
  assert.equal(elements.get("request-flow-status").textContent, "이동 중");
  assert.equal(elements.get("request-flow-status").getAttribute("data-state"), "moving");
  assert.equal(path.getAttribute("data-request-flow-active"), "true");
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
  assert.equal(elements.get("request-flow-dot").hasAttribute("hidden"), false);
  assert.equal(destination.getAttribute("data-request-flow-active"), "true");

  ui.requestFlow.reset();
  assert.equal(destination.getAttribute("data-request-flow-active"), null);
  assert.equal(path.getAttribute("data-request-flow-active"), null);
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

test("Request Flow는 HTMLCollection형 Composite children에서 실제 Segment를 찾음", async () => {
  const animationClock = createFakeClock();
  const { ui, elements } = loadUi({ animationClock });
  ui.renderGraph(detailGraphFixture());
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();

  const first = ui.state.requestFlowSteps[0];
  const routedStep = ui.state.requestFlowSteps.find((step) => step.transition?.kind === "display");
  assert.ok(routedStep, "확인된 표시 관계를 이동 경로로 사용");
  const path = routedSegmentPath(ui, elements, "displayRelationToSegmentIds", routedStep.transition.relationId);
  assert.ok(path);
  routedStep.transition.length = 100;
  path.getTotalLength = () => 100;
  path.getPointAtLength = (distance) => ({ x: distance, y: 31 });

  const compositeLayer = elements.get("graph-nodes");
  const children = useHtmlCollectionChildren(compositeLayer);
  assert.equal(children.length > 0, true);
  assert.equal(children.item(0), compositeLayer.children[0]);
  assert.equal(Array.from(children).length, children.length);
  assert.equal(typeof children.forEach, "undefined");
  assert.equal(typeof children.find, "undefined");
  assert.equal(typeof children.map, "undefined");
  assert.equal(typeof children.filter, "undefined");

  ui.requestFlow.setPlaybackSettings({ nodeHoldDuration: 500 });
  ui.requestFlow.seekToStep(ui.state.requestFlowSteps.indexOf(routedStep));
  ui.requestFlow.play();
  assert.doesNotThrow(() => animationClock.tick(600));
  assert.equal(ui.requestFlow.state().phase, "EDGE_TRAVEL");
  assert.equal(elements.get("request-flow-dot").hidden, false);
  assert.ok(Number.isFinite(Number(elements.get("request-flow-dot").getAttribute("cx"))));
  assert.ok(Number.isFinite(Number(elements.get("request-flow-dot").getAttribute("cy"))));
});

test("Request Flow는 HTMLCollection형 Graph Edge의 묶인 원본 ID를 찾고 없는 경로를 건너뜀", async () => {
  const animationClock = createFakeClock();
  const { ui, elements } = loadUi({ animationClock });
  ui.renderGraph(detailGraphFixture());
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();

  const edgeLayer = elements.get("graph-edges");
  const routedStep = ui.state.requestFlowSteps.find((step) => step.transition?.kind === "display");
  assert.ok(routedStep, "라우팅된 표시 관계 필요");
  const edgePath = routedSegmentPath(ui, elements, "displayRelationToSegmentIds", routedStep.transition.relationId);
  assert.ok(edgePath);
  routedStep.transition.length = 100;
  edgePath.setAttribute("data-edge-ids", `${routedStep.transition.originalEdgeIds[0]},display-edge-bundle`);
  edgePath.getTotalLength = () => 100;
  edgePath.getPointAtLength = (distance) => ({ x: 70, y: distance });
  useHtmlCollectionChildren(edgeLayer);

  ui.requestFlow.setPlaybackSettings({ nodeHoldDuration: 500 });
  ui.requestFlow.seekToStep(ui.state.requestFlowSteps.indexOf(routedStep));
  ui.requestFlow.play();
  assert.doesNotThrow(() => animationClock.tick(600));
  assert.equal(ui.requestFlow.state().phase, "EDGE_TRAVEL");
  assert.ok(Number.isFinite(Number(elements.get("request-flow-dot").getAttribute("cx"))));
  assert.ok(Number.isFinite(Number(elements.get("request-flow-dot").getAttribute("cy"))));
  assert.equal(edgePath.getAttribute("data-request-flow-active"), "true");
  assert.equal(elements.get("request-flow-status").textContent, "이동 중");
  assert.equal(elements.get("request-flow-status").getAttribute("data-state"), "moving");
  ui.requestFlow.reset();
  assert.equal(edgePath.getAttribute("data-request-flow-active"), null);

  ui.requestFlow.setSteps([
    { id: "endpoint", label: "API", kind: "actual", anchorId: "endpoint-a", transition: {
      kind: "display", relationId: "missing-relation", sourceId: "endpoint-a", targetId: "chain-a", length: 100
    } },
    { id: "chain", label: "Chain", kind: "actual", anchorId: "chain-a" }
  ]);
  ui.requestFlow.play();
  assert.doesNotThrow(() => animationClock.tick(600));
  assert.match(elements.get("request-flow-status").textContent, /경로 확인 불가/);
  assert.equal(elements.get("request-flow-status").getAttribute("data-state"), "unavailable");
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
  assert.match(elements.get("shell-notice").textContent, /학습 흐름 준비 실패/);
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
  assert.match(elements.get("shell-notice").textContent, /학습 흐름 준비 실패/);
  assert.doesNotMatch(elements.get("shell-notice").textContent, /Graph 자동 배치 실패/);
});

test("Request Flow Edge 이동 중 Inspector를 닫아도 재생과 경로 이동을 유지함", async () => {
  const animationClock = createFakeClock();
  const { ui, elements } = loadUi({ animationClock });
  ui.renderGraph(detailGraphFixture());
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();

  const routedIndex = ui.state.requestFlowSteps.findIndex((step) => step.transition?.kind === "display");
  const routedSteps = ui.state.requestFlowSteps.slice(routedIndex, routedIndex + 2);
  assert.ok(routedSteps.length === 2 && routedSteps[0].transition);
  const transition = routedSteps[0].transition;
  assert.equal(transition.kind, "display");
  const path = routedSegmentPath(ui, elements, "displayRelationToSegmentIds", transition.relationId);
  assert.ok(path);
  path.getTotalLength = () => 100;
  path.getPointAtLength = (distance) => ({ x: distance, y: 12 });
  transition.length = 100;
  ui.requestFlow.setSteps(routedSteps);
  ui.requestFlow.setPlaybackSettings({ nodeHoldDuration: 500 });

  ui.requestFlow.play();
  animationClock.tick(600);
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
  const withoutMapping = window.MapInBootFlow.createIndex({ nodes: graph.nodes,
    edges: graph.edges.filter((edge) => edge.id !== "handler-map-a") });
  assert.equal(withoutMapping.handlerFor("endpoint-a").status, "UNCERTAIN",
    "Endpoint.attributes.handler 문자열만으로 Handler 관계를 복원하지 않음");
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
  assert.equal(ui.state.graph.edges.some((edge) => edge.type === "FLOWS_TO"), true);
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
  assert.equal(firstNodeCard.attributes.height, "120");
  assert.equal(firstNodeCard.attributes.rx, "7");
  assert.match(nodeTexts[0], /애플리케이션/);
  assert.match(nodeTexts[0], /OrderApplication/);
  assert.match(nodeTexts[0], /서비스 ID orders/);
  assert.match(nodeTexts[1], /서블릿/);
  assert.match(nodeTexts[1], /dispatcherServlet/);
  assert.match(nodeTexts[1], /DISPATCHER · \/?/);
  assert.match(nodeTexts[2], /API/);
  assert.match(nodeTexts[2], /GET \/mapinboot\/api\/status/);
  assert.doesNotMatch(nodeTexts[2], /StatusController#status\(\)/);
  assert.doesNotMatch(nodeTexts[2], /com\.mapinboot/);
  assert.match(nodeTexts[3], /핸들러/);
  assert.match(nodeTexts[3], /StatusController/);
  assert.match(nodeTexts[3], /status\(HttpServletRequest\)/);
  const handlerDisplay = window.MapInBootGraph.nodeDisplay(snapshot.nodes[3]);
  assert.equal(handlerDisplay.primary, "status(HttpServletRequest)");
  assert.equal(handlerDisplay.detail, "StatusController");
  assert.match(nodeTexts[4], /보안 필터 체인/);
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
  assert.equal(findAllByClass(node, "graph-node-detail").length, 0);
  assert.ok(findAllByClass(node, "graph-node-display-id").length > 0);
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
  const apiCard = compositeCardForNode(layout.plan, "node-2", "API_MAPPING");
  const apiItem = compositeItemForNode(layout.plan, "node-2", apiCard.rowId);
  const renderedNode = findAllByClass(elements.get("graph-nodes"), "graph-composite-card")
    .find((card) => card.getAttribute("data-composite-card-id") === apiCard.id);
  assert.equal(renderedNode.getAttribute("transform"), `translate(${apiCard.position.x} ${apiCard.position.y})`);
  assert.equal(apiItem.bounds.x, apiCard.contentBounds.x);
  assert.equal(layout.plan.overviewRouting.relations.some((relation) =>
    relation.role === "API_MAPPING" && relation.sourceItemId === apiItem.id), false,
  "확인된 FQCN 매핑이 없는 Endpoint와 Handler 사이에 표시 관계를 만들지 않음");
  assert.equal(ui.navigation.state.graphBounds.width, layout.width);
  assert.equal(ui.navigation.state.graphBounds.height, layout.height);
  assert.equal(ui.state.graphRender.areas.filter((area) => area.id !== "education").length, 5);
  assert.equal(elements.get("graph-areas").children.filter((group) => group.getAttribute("class") === "graph-chain-area").length, 0);
  assert.equal(apiCard.position.x, layout.plan.lanes.find((lane) => lane.id === "endpoint").x);
  assert.equal(layout.plan.mode, "request-flow-lanes");
  assert.ok(layout.plan.lanes.find((lane) => lane.id === "security-chain").columns >= 1);
  assert.ok(layout.plan.chainGroups.length >= 1);
  const areaNodes = new Map(ui.state.graphRender.areas.map((area) => [area.id, area.nodeIds]));
  assert.ok(areaNodes.get("servlet-filter").length > 0);
  assert.ok(areaNodes.get("security-checks").length > 0);
  assert.ok(areaNodes.get("api-mapping").length > 0);
  assert.ok(areaNodes.get("controller-handler").length > 0);
  assert.ok(areaNodes.get("spring-security").length > 0);
  assert.ok(elements.get("graph-areas").children.filter((group) => group.getAttribute("class") === "graph-chain-area")
    .every((group) => group.getAttribute("data-related") === "false"));
  assert.equal(elements.get("graph-guides").children.filter((child) => child.attributes["data-guide-kind"] === "education").length, 0);
  assert.equal(elements.get("graph-guides").children.some((child) =>
    child.textContent.includes("화면 안내") || child.textContent.includes("점선: Endpoint")), false);
  const entryRelation = layout.plan.overviewRouting.relations.find((relation) => relation.originalEdgeIds?.includes("edge-0"));
  assert.ok(entryRelation);
  assert.ok(layout.plan.overviewRouting.routesByRelationId[entryRelation.id]);
  assert.equal(layoutCalls[0].layoutOptions["org.eclipse.elk.direction"], "RIGHT");
  assert.equal(layoutCalls[0].edges.some((edge) => edge.id === "edge-0"), true);
});

test("17개 API를 Chain별 Hidden Group에 배치하고 확인된 Chain·Handler만 대응시킴", async () => {
  const { ui, layoutApi, elements } = loadUi();
  const snapshot = laneGraphFixture();
  const originalEdgeCount = snapshot.edges.length;
  ui.state.includeUnconnectedNodes = true;
  ui.renderGraph(snapshot);
  await ui.layoutGraph();

  const endpoints = ui.state.viewGraph.nodes.filter((node) => node.type === "ENDPOINT");
  const plan = ui.state.layout.plan;
  const endpointCards = plan.displayModel.composites.filter((card) => card.kind === "API_MAPPING");
  const handlerCards = plan.displayModel.composites.filter((card) => card.kind === "CONTROLLER_HANDLER");
  const endpointXs = new Set(endpointCards.map((card) => card.position.x));
  assert.equal(endpoints.length, 17);
  assert.equal(endpointCards.length, 17);
  assert.equal(handlerCards.length, 17);
  assert.equal(endpointXs.size, 2);
  const endpointColumns = [...endpointXs].sort((left, right) => left - right)
    .map((x) => endpointCards.filter((card) => card.position.x === x).sort((left, right) => left.position.y - right.position.y));
  assert.deepEqual(endpointColumns.map((column) => column.length), [9, 8]);
  const hiddenGroups = plan.hiddenGroups;
  assert.deepEqual(Array.from(hiddenGroups, (group) => group.members.endpoints.length), [5, 4, 4, 4]);
  endpoints.forEach((endpoint) => {
    const group = hiddenGroups.find((candidate) => candidate.members.endpoints.includes(endpoint.id));
    const item = compositeItemForNode(plan, endpoint.id, group.id);
    const card = compositeCardForNode(plan, endpoint.id, "API_MAPPING", group.id);
    assert.ok(item && card);
    assert.ok(card.position.y >= group.rowTop && card.position.y + card.position.height <= group.rowBottom);
    const match = ui.state.flowIndex.firstMatchedChain(endpoint.id);
    if (match.status === "CONFIRMED") {
      const handler = ui.state.flowIndex.handlerFor(endpoint.id).node;
      const handlerCard = compositeCardForNode(plan, handler.id, "CONTROLLER_HANDLER", group.id);
      assert.ok(handlerCard);
      assert.ok(Math.abs(handlerCard.position.y + handlerCard.position.height / 2
        - card.position.y - card.position.height / 2) <= 1);
    }
  });
  assert.equal(ui.state.flowIndex.summary().matchedEndpointCount, 13);
  assert.equal(ui.state.flowIndex.summary().uncertainCount, 4);
  endpoints.forEach((endpoint) => {
    const handler = ui.state.flowIndex.handlerFor(endpoint.id).node;
    assert.ok(handler);
    const apiCard = compositeCardForNode(plan, endpoint.id, "API_MAPPING");
    const handlerCard = compositeCardForNode(plan, handler.id, "CONTROLLER_HANDLER", apiCard.rowId);
    assert.ok(handlerCard.position.x > apiCard.position.x);
  });
  assert.equal(ui.state.graph.edges.length, originalEdgeCount);
  assert.equal(layoutApi.buildGraph(ui.state.graph).edges.length, originalEdgeCount);
  const mappingRelations = plan.overviewRouting.relations.filter((relation) => relation.role === "API_MAPPING");
  assert.equal(mappingRelations.length, 17);
  assert.equal(elements.get("graph-guides").children.length, 0);
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

test("Overview는 내부 처리 카드를 제외하고 Detail은 학습 단계를 유지함", async () => {
  const { ui, elements } = loadUi();
  const snapshot = laneGraphFixture();
  const originalGraph = JSON.stringify(snapshot);
  ui.renderGraph(snapshot);
  await ui.layoutGraph();

  const projection = ui.state.layout.plan.projection;
  assert.ok(projection);
  assert.equal(projection.nodes.length, 0);
  assert.equal(projection.edges.some((edge) => /(?:continue|adapter)/.test(edge.id)), false);
  assert.equal(projection.nodes.some((node) => /(?:chain-continue|handler-adapter)/.test(node.id)), false);
  assert.equal(projection.edges.some((edge) => /(?:chain-continue|handler-adapter)/.test(`${edge.sourceId} ${edge.targetId}`)), false);
  assert.equal(projection.nodes.some((node) => node.id === "education-response-return"), false);
  assert.equal(projection.edges.some((edge) => edge.id.startsWith("handler-to-response-")), false);
  assert.equal(ui.state.layout.plan.educationArea, null);
  assert.ok(projection.edges.length > 0);
  assert.equal(projection.edges.some((edge) => edge.dataEdgeId), false);
  assert.equal(elements.get("graph-flow-projection").children.length, 0);
  assert.equal(findAllByClass(elements.get("graph-minimap-nodes"), "graph-minimap-node")
    .some((node) => node.getAttribute("data-node-id") === "education-response-return"), false);
  assert.equal(JSON.stringify(snapshot), originalGraph);
  assert.equal(ui.state.graph.nodes.length, 17 + 17 + 3 + 46, "실제 Snapshot Node 수 보존");
  assert.equal(ui.state.graph.edges.some((edge) => edge.type === "FLOWS_TO"), true);
  ui.selectView("feature-flow");
  await ui.layoutGraph();
  assert.ok(ui.state.layout.plan.projection.nodes.some((node) => node.id === "education-handler-mapping"));
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

test("Filter 줄바꿈은 외부 Edge 없이 복합 카드 내부 순서를 유지함", () => {
  const { layoutApi, ui } = loadUi();
  const layout = layoutApi.semanticLayout(ui.normalizeGraph(wrappedFilterGraph(0, 5)), { positions: {} });
  const card = compositeCardForNode(layout.plan, "security-filter-0", "SECURITY_CHAIN", "chain:chain");
  const filters = card.items.filter((item) => !item.isHeader);
  assert.equal(filters.length, 5);
  assert.deepEqual(Array.from(filters, (item) => item.order), [1, 2, 3, 4, 5]);
  assert.deepEqual(Array.from(filters, (item) => item.originalNodeIds[0]),
    ["security-filter-0", "security-filter-1", "security-filter-2", "security-filter-3", "security-filter-4"]);
  assert.ok(filters.every((item, index) => index === 0 || item.bounds.y > filters[index - 1].bounds.y));
  assert.equal(layout.plan.overviewRouting.relations.some((relation) => relation.type === "FILTERED_BY"), false);
  assert.equal(layout.plan.overviewRouting.relations.some((relation) => relation.routeKind === "filter-wrap"), false);
});

test("주요 섹션은 실제 사용 폭을 사용하고 Hidden Row별 Y 구간을 유지함", () => {
  const { layoutApi, ui } = loadUi();
  const layout = layoutApi.semanticLayout(ui.normalizeGraph(laneGraphFixture()), { positions: {} });
  const servletLane = layout.plan.lanes.find((lane) => lane.id === "servlet-filter");
  assert.equal(layout.plan.lanes.some((lane) => lane.id === "request"), false);
  assert.equal(servletLane.x, 72);

  const measuredSections = Object.entries(layout.plan.sectionAlignment)
    .filter(([, section]) => section && section.nodeIds && section.nodeIds.length)
    .map(([id, section]) => {
      const instanceIds = Array.from(new Set(section.nodeIds.flatMap((nodeId) =>
        layout.plan.displayModel.originalNodeToInstanceIds[nodeId] || [])));
      const members = instanceIds.map((instanceId) => layout.plan.displayModel.instances
        .find((instance) => instance.id === instanceId)?.position).filter(Boolean);
      let top = Math.min(...members.map((position) => position.y));
      let bottom = Math.max(...members.map((position) => position.y + (position.height || 120)));
      assert.equal(section.top, top, `${id} actual top`);
      assert.equal(section.height, bottom - top, `${id} actual height`);
      return id;
    });
  assert.ok(measuredSections.length >= 3);
  const displayModel = layout.plan.displayModel;
  layout.plan.hiddenGroups.filter((row) => row.type === "CHAIN").forEach((row) => {
    const categoryPositions = Object.fromEntries(Object.entries(row.members).map(([category, nodeIds]) => [category,
      Array.from(new Set(nodeIds.flatMap((nodeId) => displayModel.originalNodeToCardIds[nodeId] || [])))
        .map((cardId) => displayModel.cardById[cardId])
        .filter((card) => card && card.rowId === row.id)
        .map((card) => card.position)]));
    Object.values(categoryPositions).flat().forEach((position) => {
      assert.ok(position.y >= row.rowTop && position.y + position.height <= row.rowBottom,
        `${row.id} member outside its hidden row`);
    });
    const chainFilter = [...categoryPositions.chains, ...categoryPositions.filters];
    const sections = [chainFilter, categoryPositions.securityChecks, categoryPositions.endpoints, categoryPositions.handlers]
      .filter((positions) => positions.length);
    assert.ok(sections.length >= 3, `${row.id} must span chain, API, and handler areas`);
    const rowCenter = (row.rowTop + row.rowBottom) / 2;
    sections.forEach((positions) => {
      const top = Math.min(...positions.map((position) => position.y));
      const bottom = Math.max(...positions.map((position) => position.y + position.height));
      assert.ok(Math.abs((top + bottom) / 2 - rowCenter) <= 1,
        `${row.id} section must be vertically centered in its row`);
    });
  });
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
  assert.match(textOf(node), /JWT Claim 조회/);
  assert.match(textOf(node), /Claim sub/);
  assert.doesNotMatch(textOf(node), /jwt\|READ\|/);
  ui.selectGraphElement("node", "security-data-jwt");
  assert.match(textOf(elements.get("inspector")), /수행 동작/);
  assert.match(textOf(elements.get("inspector")), /조회/);
  assert.match(textOf(elements.get("inspector")), /JWT Claim 조회/);
  assert.doesNotMatch(textOf(elements.get("inspector")), /READ|SPRING_SECURITY_JWT/);
  assert.match(textOf(elements.get("inspector")), /코드 위치/);
  assert.equal(window.MapInBootGraph.friendlyClassName("org.springframework.security.web.SecurityContextHolderAwareRequestFilter"), "Security Context Holder Aware Request Filter");
});

test("ELK 실패 시 초기 Graph 배치와 SVG 표시 상태를 유지함", async () => {
  const { ui, elements, layoutApi, window } = loadUi();
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

test("ELK 직교 Route 추출은 중복 좌표와 공선 Bend를 정리함", () => {
  const { layoutApi } = loadUi();
  const layout = layoutApi.extractLayout({
    width: 400,
    height: 200,
    children: [{ id: "source", x: 0, y: 0 }, { id: "target", x: 300, y: 0 }],
    edges: [{ id: "edge", sections: [{
      startPoint: { x: 0, y: 20 },
      bendPoints: [{ x: 0, y: 40 }, { x: 0, y: 60 }, { x: 180, y: 60 }, { x: 180, y: 60 }],
      endPoint: { x: 180, y: 120 }
    }] }]
  });
  assert.equal(JSON.stringify(routePoints(layout.edgeRoutes.edge)), JSON.stringify([
    { x: 0, y: 20 }, { x: 0, y: 60 }, { x: 180, y: 60 }, { x: 180, y: 120 }
  ]));
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
    .find((item) => (item.getAttribute("data-edge-ids") || "").split(",").includes("edge-0"));
  edge.dispatchEvent({ type: "mouseenter" });
  assert.equal(elements.get("graph-popover").hidden, false);
  edge.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selection.kind, "edge");
  assert.equal(ui.state.selection.id, "edge-0");
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
  const { ui, elements, document, layoutCalls } = loadUi();
  ui.renderGraph(graphFixture());
  await ui.layoutGraph();

  const endpointItem = findAllByClass(elements.get("graph-nodes"), "graph-composite-item")
    .find((item) => (item.getAttribute("data-node-ids") || "").split(",").includes("node-2"));
  const endpointItemId = endpointItem.getAttribute("data-composite-item-id");
  let edge = findAllByClass(elements.get("graph-edges"), "graph-edge")
    .find((item) => (item.getAttribute("data-edge-ids") || "").split(",").includes("edge-0"));
  const initialNodeElements = [...elements.get("graph-nodes").children];
  const initialEdgeEmphasis = findAllByClass(elements.get("graph-edges"), "graph-edge")
    .map((item) => item.getAttribute("data-emphasis"));
  const initialLayoutCalls = layoutCalls.length;
  endpointItem.dispatchEvent({ type: "mouseenter", bubbles: false });
  assert.equal(elements.get("graph-popover").hidden, false, JSON.stringify({
    listeners: endpointItem.listenerCount("mouseenter"), hover: ui.state.graphHover,
    content: textOf(elements.get("graph-popover"))
  }));
  assert.match(textOf(elements.get("graph-popover")), /GET \/orders/);
  assert.match(textOf(elements.get("graph-popover")), /관련 Finding 있음/);
  const hoveredNodeEdges = findAllByClass(elements.get("graph-edges"), "graph-edge");
  assert.deepEqual(hoveredNodeEdges.map((item) => item.getAttribute("data-emphasis")), initialEdgeEmphasis);
  assert.deepEqual([...elements.get("graph-nodes").children], initialNodeElements);
  assert.equal(layoutCalls.length, initialLayoutCalls);
  endpointItem.dispatchEvent({ type: "mouseleave", bubbles: false });
  assert.equal(elements.get("graph-popover").hidden, true);
  assert.deepEqual(hoveredNodeEdges.map((item) => item.getAttribute("data-emphasis")), initialEdgeEmphasis);

  endpointItem.dispatchEvent({ type: "click" });
  const inspector = elements.get("inspector");
  assert.equal(ui.state.selection.kind, "controller-group");
  assert.equal(ui.state.selection.id, endpointItemId);
  assert.equal(inspector.hidden, false);
  assert.equal(inspector.attributes["data-selection-kind"], "controller-group");
  assert.equal(inspector.attributes["data-selection-id"], endpointItemId);
  assert.equal(endpointItem.attributes["data-selected"], "true");
  assert.equal(endpointItem.attributes["data-related"], "true");
  assert.match(textOf(inspector), /GET \/orders/);
  assert.match(textOf(inspector), /orders:\/\/node\/2/);
  assert.match(textOf(inspector), /관련 Finding 있음/);

  const selectedEmphasis = findAllByClass(elements.get("graph-edges"), "graph-edge")
    .map((item) => item.getAttribute("data-emphasis"));
  const selectedElements = [...elements.get("graph-nodes").children];
  const otherNode = findAllByClass(elements.get("graph-nodes"), "graph-composite-item")
    .find((item) => item.getAttribute("data-composite-item-id") !== endpointItemId);
  otherNode.dispatchEvent({ type: "mouseenter", bubbles: false });
  assert.equal(elements.get("graph-popover").hidden, false);
  assert.equal(endpointItem.getAttribute("data-selected"), "true");
  assert.deepEqual(findAllByClass(elements.get("graph-edges"), "graph-edge")
    .map((item) => item.getAttribute("data-emphasis")), selectedEmphasis);
  assert.deepEqual([...elements.get("graph-nodes").children], selectedElements);
  otherNode.dispatchEvent({ type: "mouseleave", bubbles: false });

  edge.dispatchEvent({ type: "mouseenter" });
  assert.deepEqual(findAllByClass(elements.get("graph-edges"), "graph-edge")
    .map((item) => item.getAttribute("data-emphasis")), selectedEmphasis);
  edge.dispatchEvent({ type: "mouseleave" });

  elements.get("endpoint-search").value = "get /orders";
  ui.applyGraphFilter();
  assert.equal(ui.state.selection.id, endpointItemId);
  assert.equal(endpointItem.attributes["data-selected"], "true");
  elements.get("endpoint-search").value = "";
  ui.applyGraphFilter();
  edge = findAllByClass(elements.get("graph-edges"), "graph-edge")
    .find((item) => (item.getAttribute("data-edge-ids") || "").split(",").includes("edge-0"));

  ui.setInspectorTab("connections");
  assert.ok(findAllByClass(inspector, "inspector-link")
    .some((link) => link.getAttribute("data-node-id") === "node-2"));
  ui.setInspectorTab("relations");
  assert.ok(["edge-1", "edge-2"].some((id) => textOf(inspector).includes(ui.state.displayIds.edge(id))),
    textOf(inspector));
  assert.doesNotMatch(textOf(inspector), /edge-1|edge-2/);
  const relationBlocks = findAllByClass(inspector, "inspector-relation");
  const findingReference = relationBlocks.at(-1);
  assert.ok(findingReference);
  assert.doesNotMatch(textOf(inspector), /node-1|node-3|edge-1|edge-2/);

  edge.dispatchEvent({ type: "click" });
  assert.equal(inspector.attributes["data-selection-kind"], "edge");
  assert.equal(inspector.attributes["data-selection-id"], "edge-0");
  ui.setInspectorTab("properties");
  assert.match(textOf(inspector), new RegExp(ui.state.displayIds.edge("edge-0")));
  assert.match(textOf(inspector), new RegExp(ui.state.displayIds.node("node-0")));
  assert.match(textOf(inspector), new RegExp(ui.state.displayIds.node("node-1")));
  assert.doesNotMatch(textOf(inspector), /edge-0|node-0|node-1/);

  const close = findAllByClass(inspector, "inspector-close")[0];
  close.dispatchEvent({ type: "click" });
  assert.equal(inspector.hidden, true);
  assert.equal(ui.state.selection, null);

  edge = findAllByClass(elements.get("graph-edges"), "graph-edge")
    .find((item) => (item.getAttribute("data-edge-ids") || "").split(",").includes("edge-0"));
  edge.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selection.kind, "edge");
  assert.equal(ui.state.selection.id, "edge-0");
  document.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(inspector.hidden, true);
  assert.equal(ui.state.selection, null);
});

test("기술 영역과 실제 Edge는 기본 상태에서 읽히고 선택 강조는 과도하게 흐리지 않음", () => {
  assert.match(appCss, /\.graph-area-box\s*\{[^}]*fill-opacity:\s*\.1[4-8]/s);
  for (const areaId of ["request-entry", "servlet-filter", "spring-security", "mvc", "api-mapping",
    "controller-handler", "security-checks"]) {
    assert.match(appCss, new RegExp(`\\.graph-area\\[data-area-id="${areaId}"\\] \\.graph-area-box \\{[^}]*fill: #[0-9a-f]{6}[^}]*stroke: #[0-9a-f]{6}`, "s"));
  }
  assert.ok(/:root\s*\{[^}]*--graph-line-opacity:\s*\.78;[^}]*--graph-line-width:\s*1\.8;/s.test(appCss));
  assert.ok(/\.graph-edge\s*\{[^}]*stroke-width:\s*var\(--graph-line-width\)[^}]*opacity:\s*var\(--graph-line-opacity\)/s.test(appCss));
  assert.ok(/\.graph-projection-edge\s*\{[^}]*stroke-width:\s*var\(--graph-line-width\)[^}]*opacity:\s*var\(--graph-line-opacity\)/s.test(appCss));
  assert.ok(/\.graph-guide-handler\s*\{[^}]*stroke-width:\s*var\(--graph-line-width\)[^}]*opacity:\s*var\(--graph-line-opacity\)/s.test(appCss));
  assert.match(appCss, /\.graph-edge\[data-emphasis="unrelated"\]\s*\{[^}]*opacity:\s*\.(?:3[0-9]|4[0-9]|5[0])/s);
  assert.doesNotMatch(appCss, /\.graph-node:hover\s+\.graph-node-card/);
  assert.match(appCss, /\.graph-node:focus-visible\s+\.graph-node-card/);
  assert.match(appCss, /graph-edge-security-filter-membership/);
  assert.match(appCss, /graph-area-box[^}]*fill-opacity:\s*\.1[4-8]/s);
  assert.deepEqual(Array.from(new Set(Array.from(graphRendererJs.matchAll(/dash:\s*"([^"]+)"/g), (match) => match[1]))), ["none"]);
  for (const selector of ["graph-guide-handler", "graph-projection-edge", "runtime-blueprint-edge"]) {
    assert.doesNotMatch(appCss, new RegExp(`\\.${selector}[^}]*stroke-dasharray:\\s*[1-9]`));
  }
  assert.match(appCss, /\.graph-edge,\s*\.graph-guide-handler,\s*\.graph-projection-edge,\s*\.runtime-blueprint-edge\s*\{[^}]*stroke-dasharray:\s*none/s);
  assert.match(appCss, /\.graph-chain-area-box\s*\{[^}]*stroke-dasharray:\s*5 4/s);
  assert.match(appCss, /\.runtime-blueprint-region-box\s*\{[^}]*stroke-dasharray:\s*5 4/s);
});

test("Servlet·Security·미확정 Filter 복합 카드가 유형 색상을 유지함", async () => {
  const { ui, elements } = loadUi();
  const graph = wrappedFilterGraph(1, 1);
  graph.nodes.push({
    id: "unknown-filter", type: "FILTER", serviceId: "orders", label: "UnknownFilter",
    attributes: { filterClass: "com.example.UnknownFilter" }, evidenceIds: []
  });
  ui.state.includeUnconnectedNodes = true;
  ui.renderGraph(graph);
  await ui.layoutGraph();

  const cards = findAllByClass(elements.get("graph-nodes"), "graph-composite-card");
  const cardFor = (id) => cards.find((card) => (card.getAttribute("data-node-ids") || "").split(",").includes(id));
  const surfaceColor = (id) => findAllByClass(cardFor(id), "graph-composite-surface")[0].getAttribute("stroke");
  const servletColor = surfaceColor("servlet-filter-0");
  const securityColor = surfaceColor("security-filter-0");
  const unknownColor = surfaceColor("unknown-filter");
  assert.equal(servletColor, "#65b98d");
  assert.equal(securityColor, "#d6a35a");
  assert.equal(unknownColor, "#94a3b8");
  assert.equal(new Set([servletColor, securityColor, unknownColor]).size, 3);
});

test("내부 처리 과정 배경만 제거하고 Projection 배치 좌표와 상위 기술 영역을 보존함", async () => {
  const { ui, elements } = loadUi();
  ui.state.includeUnconnectedNodes = true;
  ui.renderGraph(laneGraphFixture());
  const layout = await ui.layoutGraph();

  const technicalAreaIds = ui.state.graphRender.areas.map((area) => area.id).sort();
  assert.equal(technicalAreaIds.includes("education"), false);
  assert.equal(elements.get("graph-areas").children.filter((group) => group.getAttribute("class") === "graph-area"
    && group.getAttribute("data-area-kind") === "technical")
    .map((group) => group.getAttribute("data-area-id")).sort().join(","),
  technicalAreaIds.join(","));
  assert.equal(findAllByClass(elements.get("graph-areas"), "graph-education-area-box").length, 0);
  assert.equal(findAllByClass(elements.get("graph-areas"), "graph-area-label")
    .some((label) => label.textContent === "내부 처리 과정"), false);
  assert.equal(layout.plan.educationArea, null);
  assert.equal(layout.plan.projection.nodes.length, 0);
  const areas = new Map(ui.state.graphRender.areas.map((area) => [area.id, area]));
  assert.equal(areas.has("mvc"), false);
  assert.equal(areas.has("servlet-filter"), false);
  assert.ok(areas.has("api-mapping"));
  assert.ok(areas.has("controller-handler"));
  const apiBounds = areas.get("api-mapping").bounds[0];
  const handlerBounds = areas.get("controller-handler").bounds[0];
  assert.ok(handlerBounds.left - apiBounds.right >= 100,
    JSON.stringify({ apiBounds, handlerBounds, lanes: layout.plan.lanes }));
  assert.match(appCss, /data-area-id="controller-handler"[^}]*fill:\s*#49376a/);
  assert.equal(findAllByClass(elements.get("graph-flow-projection"), "graph-projection-node").length, 0);
  assert.equal(elements.get("setting-show-areas").checked, true);
  elements.get("setting-show-areas").checked = false;
  elements.get("setting-show-areas").dispatchEvent({ type: "change" });
  assert.equal(elements.get("graph-areas").hasAttribute("hidden"), true);
  elements.get("setting-show-areas").checked = true;
  elements.get("setting-show-areas").dispatchEvent({ type: "change" });
  assert.equal(elements.get("graph-areas").hasAttribute("hidden"), false);
});

test("SECURITY CHECKS에서 두 Handler 열로 향하는 관계가 표시 경로에서 공통 배선됨", async () => {
  const { ui, layoutApi, elements } = loadUi();
  const node = (id, type, attributes = {}) => ({ id, type, serviceId: "orders", label: id, attributes,
    evidenceIds: [`evidence-${id}`] });
  const edge = (id, sourceId, targetId, type, attributes = {}) => ({ id, sourceId, targetId, type,
    attributes, confidence: "CONFIRMED", evidenceIds: [`evidence-${id}`] });
  const handlers = Array.from({ length: 16 }, (_, index) => `handler-${index}`);
  const snapshot = {
    nodes: [node("chain", "SECURITY_CHAIN", { chainKey: "chain", chainOrder: "1" }),
      ...handlers.flatMap((id, index) => [
        node(`endpoint-${index}`, "ENDPOINT", { httpMethod: "GET", path: `/items/${index}`, handler: `${id}#read` }),
        node(id, "HANDLER", { handler: `${id}#read` })
      ]),
      node("authorization", "AUTHORIZATION", { authorizationKind: "ROLE" })],
    edges: [
      ...handlers.flatMap((id, index) => [
        edge(`match-${index}`, `endpoint-${index}`, "chain", "MATCHED_BY", { chainKey: "chain", chainOrder: "1" }),
        edge(`handler-map-${index}`, `endpoint-${index}`, id, "FLOWS_TO", { flowKind: "HANDLER" }),
        edge(`secured-${index}`, id, "authorization", "SECURED_BY", { authorizationKind: "ROLE" })
      ])
    ]
  };
  const graph = ui.normalizeGraph(snapshot);
  graph.presentationContext = "overview";
  const layout = layoutApi.semanticLayout(graph, { positions: {} });
  assert.equal(layout.plan.lanes.find((lane) => lane.id === "endpoint").columns, 2);
  const plan = layout.plan.overviewRouting;
  const relations = plan.relations.filter((relation) => relation.type === "SECURED_BY");
  assert.equal(relations.length, handlers.length);
  assert.ok(relations.every((relation) => plan.routesByRelationId[relation.id]));
  const trunk = plan.segments.find((segment) => segment.routeRole === "TRUNK"
    && relations.every((relation) => segment.relationIds.includes(relation.id)));
  assert.ok(trunk, `두 Handler 열로 향하는 공통 배선 누락: ${JSON.stringify({
    sourceCount: new Set(relations.map((relation) => relation.visualSourcePortId)).size,
    targetCount: new Set(relations.map((relation) => relation.visualTargetPortId)).size,
    routeCount: relations.filter((relation) => plan.routesByRelationId[relation.id]).length,
    shared: plan.segments.filter((segment) => segment.relationIds.length > 1)
      .map((segment) => ({ role: segment.routeRole, count: segment.relationIds.length }))
  })}`);

  ui.renderGraph(snapshot);
  await ui.layoutGraph();
  const trunkPaths = () => findAllByClass(elements.get("graph-edges"), "graph-overview-segment")
    .filter((path) => path.getAttribute("data-segment-id") === trunk.id);
  assert.equal(trunkPaths().length, 1, "공통 Trunk는 한 번만 렌더링");
  const pathData = trunkPaths()[0].getAttribute("d");
  ui.selectGraphElement("node", "authorization");
  assert.equal(trunkPaths().length, 1);
  assert.equal(trunkPaths()[0].getAttribute("d"), pathData);
  assert.equal(graph.edges.filter((edge) => edge.type === "SECURED_BY" && edge.evidenceIds.length).length, handlers.length);
});

test("확정된 16개 Security Filter는 실제 순서로 이어지고 DispatcherServlet에 연결하지 않음", () => {
  const { layoutApi, ui, window } = loadUi();
  const source = wrappedFilterGraph(0, 16);
  const graph = ui.normalizeGraph(source);
  const originalEdgeIds = graph.edges.map((edge) => edge.id).sort();
  const layout = layoutApi.semanticLayout(graph, { positions: {} });
  const projected = layout.plan.projection.edges.filter((edge) => edge.projectionKind === "security-filter-order");

  assert.equal(window.MapInBootFlow.createIndex(graph).securityFiltersForChain("chain").orderStatus, "CONFIRMED");
  assert.equal(projected.length, 16);
  assert.equal(projected[0].sourceId, "chain");
  assert.equal(projected[0].targetId, "security-filter-0");
  assert.equal(projected.at(-1).targetId, "security-filter-15");
  assert.ok(projected.every((edge) => edge.flowGroup === "chain" && edge.dataEdgeId === null));
  assert.equal(projected.some((edge) => edge.id.startsWith("filter-to-dispatcher-")), false);
  assert.equal(layout.plan.projection.nodes.some((node) => node.kind === "security-checks"), false);
  assert.deepEqual(graph.edges.map((edge) => edge.id).sort(), originalEdgeIds);
  assert.equal(graph.edges.filter((edge) => edge.type === "FILTERED_BY").length, 16);
  assert.ok(projected.some((edge) => edge.routeKind === "filter-wrap"));
  assert.equal(layout.plan.commonEdgeRouteGroups.some((group) => group.type === "FILTERED_BY"), false);

  const mixed = layoutApi.semanticLayout(ui.normalizeGraph(wrappedFilterGraph(5, 16)), { positions: {} });
  const servletProjection = mixed.plan.projection.edges.filter((edge) => edge.projectionKind === "servlet-filter-order");
  const securityProjection = mixed.plan.projection.edges.filter((edge) => edge.projectionKind === "security-filter-order");
  assert.equal(servletProjection.length, 0);
  assert.equal(securityProjection.length, 16);
  assert.ok(servletProjection.every((edge) => edge.flowGroup === "servlet-filter"));
  assert.ok(securityProjection.every((edge) => edge.flowGroup === "chain"));
});

test("보안 근거를 실행 Projection으로 추가하지 않고 원본 관계를 보존함", () => {
  const { layoutApi, ui } = loadUi();
  const source = detailGraphFixture();
  source.nodes.push({ id: "uncertain-data", type: "SECURITY_DATA", serviceId: "orders", label: "Uncertain",
    attributes: {}, evidenceIds: [] });
  source.edges.push({ id: "uncertain-secured", sourceId: "handler-b", targetId: "uncertain-data",
    type: "SECURED_BY", attributes: {}, confidence: "LIKELY", evidenceIds: ["evidence-uncertain"] });
  const graph = ui.normalizeGraph(source);
  const originalGraph = JSON.stringify(graph);
  const originalSecurityEdge = graph.edges.find((edge) => edge.id === "secured-a");
  const layout = layoutApi.semanticLayout(graph, { positions: {} });
  const checksFlow = layout.plan.projection.edges.filter((edge) => edge.projectionKind === "security-checks");
  assert.equal(checksFlow.length, 0);
  const chainCard = compositeCardForNode(layout.plan, "chain-a", "SECURITY_CHAIN");
  const authorizationCard = compositeCardForNode(layout.plan, "authorization-a", "AUTHORIZATION");
  const endpointCard = compositeCardForNode(layout.plan, "endpoint-a", "API_MAPPING");
  assert.ok(chainCard.position.x + chainCard.position.width < authorizationCard.position.x);
  assert.ok(authorizationCard.position.x + authorizationCard.position.width < endpointCard.position.x);
  assert.deepEqual({ sourceId: originalSecurityEdge.sourceId, targetId: originalSecurityEdge.targetId },
    { sourceId: "handler-a", targetId: "authorization-a" });
  assert.equal(JSON.stringify(graph), originalGraph);

  const withoutSecondCheck = detailGraphFixture();
  withoutSecondCheck.nodes = withoutSecondCheck.nodes.filter((node) => node.id !== "authorization-b");
  withoutSecondCheck.edges = withoutSecondCheck.edges.filter((edge) => edge.id !== "secured-b");
  const noCheckLayout = layoutApi.semanticLayout(ui.normalizeGraph(withoutSecondCheck), { positions: {} });
  assert.equal(noCheckLayout.plan.projection.edges.some((edge) => edge.sourceId === "education-handler-mapping"), false);
});

test("연결된 Security Checks와 실제 Controller Group까지 최종 Bounds 중심선을 공유함", () => {
  const { layoutApi, ui } = loadUi();
  const layout = layoutApi.semanticLayout(ui.normalizeGraph(detailGraphFixture()), { positions: {} });
  const displayModel = layout.plan.displayModel;
  const rows = layout.plan.hiddenGroups.filter((row) => row.type === "CHAIN");
  rows.forEach((row) => {
    const cards = displayModel.composites.filter((card) => card.rowId === row.id);
    const sections = [
      cards.filter((card) => ["SECURITY_CHAIN", "SECURITY_UNRESOLVED"].includes(card.kind)),
      cards.filter((card) => ["AUTHENTICATION", "AUTHORIZATION", "SECURITY_DATA", "BUSINESS_SECURITY_STATE"].includes(card.kind)),
      cards.filter((card) => card.kind === "API_MAPPING"),
      cards.filter((card) => card.kind === "CONTROLLER_HANDLER")
    ].filter((section) => section.length);
    const centers = sections.map((section) => {
      const top = Math.min(...section.map((card) => card.position.y));
      const bottom = Math.max(...section.map((card) => card.position.y + card.position.height));
      return (top + bottom) / 2;
    });
    assert.ok(centers.length >= 3, `${row.id}의 실제 표시 영역 부족`);
    assert.ok(Math.max(...centers) - Math.min(...centers) <= 1,
      `${row.id} 카드 영역 중심 불일치: ${centers.join(",")}`);
  });
});

test("누락·중복·충돌 순서는 Security Filter 직렬 Projection 없이 확인 불가로 표시함", () => {
  const { layoutApi, ui, window } = loadUi();
  const variants = [
    ["누락", (graph) => {
      delete graph.edges.find((edge) => edge.id === "security-edge-1").attributes.filterOrder;
      delete graph.nodes.find((node) => node.id === "security-filter-1").attributes.filterOrder;
    }],
    ["중복", (graph) => {
      graph.edges.find((edge) => edge.id === "security-edge-1").attributes.filterOrder = "1";
      graph.nodes.find((node) => node.id === "security-filter-1").attributes.filterOrder = "1";
    }],
    ["충돌", (graph) => {
      graph.edges.find((edge) => edge.id === "security-edge-1").attributes.filterOrder = "3";
    }],
    ["미확정 소속", (graph) => {
      graph.edges.find((edge) => edge.id === "security-edge-1").confidence = "UNKNOWN";
    }]
  ];
  variants.forEach(([label, mutate]) => {
    const source = wrappedFilterGraph(0, 2);
    mutate(source);
    const graph = ui.normalizeGraph(source);
    const orderStatus = window.MapInBootFlow.createIndex(graph).securityFiltersForChain("chain").orderStatus;
    const layout = layoutApi.semanticLayout(graph, { positions: {} });
    assert.notEqual(orderStatus, "CONFIRMED", label);
    assert.equal(layout.plan.projection.edges.some((edge) => edge.projectionKind === "security-filter-order"), false, label);
    assert.equal(layout.plan.chainGroups.find((group) => group.id === "chain").filterOrderStatus, orderStatus, label);
  });
});

test("비어 있거나 단일 Filter인 Chain도 근거가 없으면 순서 경로를 과장하지 않음", () => {
  const { layoutApi, ui, window } = loadUi();
  const empty = layoutApi.semanticLayout(ui.normalizeGraph(wrappedFilterGraph(0, 0)), { positions: {} });
  assert.equal(empty.plan.projection.edges.some((edge) => edge.projectionKind === "security-filter-order"), false);
  assert.equal(window.MapInBootFlow.createIndex(ui.normalizeGraph(wrappedFilterGraph(0, 0)))
    .securityFiltersForChain("chain").orderStatus, "UNKNOWN");
  assert.match(empty.plan.chainGroups.find((group) => group.id === "chain").label, /필터 순서 확인 불가/);

  const oneConfirmed = layoutApi.semanticLayout(ui.normalizeGraph(wrappedFilterGraph(0, 1)), { positions: {} });
  assert.equal(oneConfirmed.plan.projection.edges.filter((edge) => edge.projectionKind === "security-filter-order").length, 1);

  const oneUnknown = wrappedFilterGraph(0, 1);
  delete oneUnknown.edges[0].attributes.filterOrder;
  delete oneUnknown.nodes.find((node) => node.id === "security-filter-0").attributes.filterOrder;
  const uncertain = layoutApi.semanticLayout(ui.normalizeGraph(oneUnknown), { positions: {} });
  assert.equal(uncertain.plan.projection.edges.some((edge) => edge.projectionKind === "security-filter-order"), false);
});

test("여러 Chain과 공유 Filter의 순서 Projection은 Chain별 소속을 유지함", () => {
  const { layoutApi, ui } = loadUi();
  const graph = {
    nodes: [
      { id: "chain-a", type: "SECURITY_CHAIN", serviceId: "orders", label: "A", attributes: { chainOrder: "1" }, evidenceIds: [] },
      { id: "chain-b", type: "SECURITY_CHAIN", serviceId: "orders", label: "B", attributes: { chainOrder: "2" }, evidenceIds: [] },
      ...["a-first", "shared-filter", "a-last", "b-first"].map((id) => ({
        id, type: "FILTER", serviceId: "orders", label: id,
        attributes: { registrationKind: "SECURITY", filterClass: `com.example.${id}` }, evidenceIds: []
      }))
    ],
    edges: [
      { id: "a-filter-1", sourceId: "chain-a", targetId: "a-first", type: "FILTERED_BY", attributes: { registrationKind: "SECURITY", filterOrder: "1" }, confidence: "CONFIRMED", evidenceIds: ["ea1"] },
      { id: "a-filter-2", sourceId: "chain-a", targetId: "shared-filter", type: "FILTERED_BY", attributes: { registrationKind: "SECURITY", filterOrder: "2" }, confidence: "CONFIRMED", evidenceIds: ["ea2"] },
      { id: "b-filter-1", sourceId: "chain-b", targetId: "shared-filter", type: "FILTERED_BY", attributes: { registrationKind: "SECURITY", filterOrder: "1" }, confidence: "CONFIRMED", evidenceIds: ["eb1"] },
      { id: "b-filter-2", sourceId: "chain-b", targetId: "b-first", type: "FILTERED_BY", attributes: { registrationKind: "SECURITY", filterOrder: "2" }, confidence: "CONFIRMED", evidenceIds: ["eb2"] }
    ]
  };
  const normalized = ui.normalizeGraph(graph);
  const layout = layoutApi.semanticLayout(normalized, { positions: {} });
  const projected = layout.plan.projection.edges.filter((edge) => edge.projectionKind === "security-filter-order");
  const byChain = (chainId) => projected.filter((edge) => edge.flowGroup === chainId);

  assert.equal(JSON.stringify(byChain("chain-a").map((edge) => [edge.sourceId, edge.targetId])), JSON.stringify([
    ["chain-a", "a-first"], ["a-first", "display:chain:chain-a:shared-filter"]
  ]));
  assert.equal(JSON.stringify(byChain("chain-b").map((edge) => [edge.sourceId, edge.targetId])), JSON.stringify([
    ["chain-b", "display:chain:chain-b:shared-filter"],
    ["display:chain:chain-b:shared-filter", "b-first"]
  ]));
  assert.deepEqual(Array.from(layout.plan.displayModel.originalNodeToInstanceIds["shared-filter"], (id) =>
    layout.plan.displayModel.instances.find((instance) => instance.id === id)?.rowId).sort(), ["chain:chain-a", "chain:chain-b"]);
  assert.equal(layout.plan.projection.edges.some((edge) => edge.kind === "security-checks"), false);
  assert.notEqual(layout.plan.securityFilterOrder["shared-filter"].status, "CONFIRMED");
  assert.equal(normalized.edges.filter((edge) => edge.type === "FILTERED_BY").length, 4);
  assert.equal(layout.plan.projection.edges.some((edge) => edge.sourceId === "a-last" || edge.targetId === "a-last"), false);
});

test("전체 MAP에서 Endpoint 선택은 MATCHED_BY로 적용된 Chain의 순서만 강조함", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(laneGraphFixture());
  await ui.layoutGraph();
  assert.equal(ui.state.flowIndex.firstMatchedChain("endpoint-0").chain.id, "chain-1");
  const match = ui.state.graph.edges.find((edge) => edge.type === "MATCHED_BY" && edge.sourceId === "endpoint-0");
  assert.ok(match);
  assert.equal(ui.state.layout.plan.overviewRouting.relations.some((relation) => relation.originalEdgeIds?.includes(match.id)), false);
  assert.equal(elements.get("graph-svg").getAttribute("data-view"), "all-flow");
  assert.equal(elements.get("graph-svg").getAttribute("data-selection-active"), "false");
  assert.match(appCss, /\.graph-svg\[data-view="all-flow"\]\[data-selection-active="false"\] \.graph-edge\[data-edge-layer="analysis"\]/);
  ui.selectGraphElement("node", "endpoint-0");
  assert.equal(elements.get("graph-svg").getAttribute("data-selection-active"), "true");
  const chainCards = findAllByClass(elements.get("graph-nodes"), "graph-composite-card")
    .filter((card) => card.getAttribute("data-node-ids").split(",").some((id) => id.startsWith("chain-")));
  const selectedChain = chainCards.find((card) => card.getAttribute("data-node-ids").split(",").includes("chain-1"));
  assert.ok(selectedChain);
  assert.equal(selectedChain.getAttribute("data-emphasis"), "primary");
  assert.equal(chainCards.filter((card) => card !== selectedChain)
    .some((card) => card.getAttribute("data-emphasis") === "primary"), false);
  assert.equal(findAllByClass(elements.get("graph-edges"), "graph-overview-segment")
    .some((path) => path.getAttribute("data-edge-ids").split(",").includes(match.id)), false);
});

test("SECURITY CHECKS는 기존 보안 NodeType과 Display Group을 실제 관계·ID 그대로 재배치함", async () => {
  const { ui, elements, layoutApi } = loadUi();
  const node = (id, type, label, attributes = {}) => ({
    id, type, serviceId: "orders", label, attributes, evidenceIds: [`node-${id}`]
  });
  const edge = (id, sourceId, targetId, type, evidenceIds, confidence = "CONFIRMED", attributes = {}) => ({
    id, sourceId, targetId, type, attributes, confidence, evidenceIds
  });
  const graph = {
    nodes: [
      node("chain-a", "SECURITY_CHAIN", "내부 API", { chainOrder: "1", matcherCondition: "PATH /internal/**" }),
      node("chain-b", "SECURITY_CHAIN", "기본 API", { chainOrder: "2", matcherCondition: "ANY" }),
      node("filter-a", "FILTER", "Filter A", { registrationKind: "SECURITY", filterOrder: "1" }),
      node("filter-b", "FILTER", "Filter B", { registrationKind: "SECURITY", filterOrder: "1" }),
      node("filter-shared", "FILTER", "공유 Filter", { registrationKind: "SECURITY", filterOrder: "2" }),
      node("auth-shared", "AUTHENTICATION", "JWT", { authenticationKind: "JWT" }),
      node("auth-partial", "AUTHENTICATION", "Custom 인증", { authenticationKind: "Custom" }),
      node("authz-a", "AUTHORIZATION", "인가 정책", { policyKind: "AUTHORITY", requiredAuthority: "ROLE_BANK_ADMIN" }),
      node("data-a", "SECURITY_DATA", "JWT Claim", { dataKind: "JWT_CLAIM", claimName: "sub", operation: "READ" }),
      node("state-a", "BUSINESS_SECURITY_STATE", "소유 상태", { stateName: "owner" }),
      node("handler-a", "HANDLER", "OrderController#read", { handler: "OrderController#read" }),
      node("method-authz", "AUTHORIZATION", "메서드 인가", { policyKind: "METHOD" }),
      node("security-checks:chain-a", "SECURITY_DATA", "실제 ID 충돌")
    ],
    edges: [
      edge("membership-a1", "chain-a", "filter-a", "FILTERED_BY", ["e-membership-a1"], "CONFIRMED", { registrationKind: "SECURITY", filterOrder: "1" }),
      edge("membership-a2", "chain-a", "filter-shared", "FILTERED_BY", ["e-membership-a2"], "CONFIRMED", { registrationKind: "SECURITY", filterOrder: "2" }),
      edge("membership-b1", "chain-b", "filter-b", "FILTERED_BY", ["e-membership-b1"], "CONFIRMED", { registrationKind: "SECURITY", filterOrder: "1" }),
      edge("membership-b2", "chain-b", "filter-shared", "FILTERED_BY", ["e-membership-b2"], "CONFIRMED", { registrationKind: "SECURITY", filterOrder: "2" }),
      edge("auth-shared-evidence", "filter-shared", "auth-shared", "SECURED_BY", ["e-shared-auth"]),
      edge("auth-partial-evidence", "filter-b", "auth-partial", "SECURED_BY", ["e-partial-auth"], "LIKELY"),
      edge("authorization-evidence", "filter-a", "authz-a", "USES_FOR_AUTHORIZATION", ["e-authorization"]),
      edge("security-data-evidence", "filter-a", "data-a", "READS_SECURITY_DATA", ["e-security-data"]),
      edge("security-state-evidence", "filter-a", "state-a", "SECURITY_STATE", ["e-security-state"]),
      edge("method-only-evidence", "handler-a", "method-authz", "SECURED_BY", ["e-method-only"])
    ],
    evidence: [
      { id: "node-auth-partial", source: "RUNTIME", location: "orders://auth-partial", summary: "인증 구성 원본 근거" },
      { id: "e-partial-auth", source: "RUNTIME", location: "orders://auth-partial-edge", summary: "부분 분석 관계 근거" }
    ]
  };
  const before = JSON.stringify(graph);
  const originalNodeIds = graph.nodes.map((item) => item.id).sort();
  const originalEdges = graph.edges.map((item) => ({ id: item.id, sourceId: item.sourceId, targetId: item.targetId,
    type: item.type, evidenceIds: item.evidenceIds.slice() })).sort((left, right) => left.id.localeCompare(right.id));
  const directLayout = layoutApi.semanticLayout(graph, { positions: {} });
  ui.state.includeUnconnectedNodes = true;
  ui.renderGraph(graph);
  const layout = await ui.layoutGraph();
  const securityTypes = new Set(["AUTHENTICATION", "AUTHORIZATION", "SECURITY_DATA", "BUSINESS_SECURITY_STATE"]);
  const securityNodes = graph.nodes.filter((item) => securityTypes.has(item.type));
  const lane = layout.plan.lanes.find((item) => item.id === "security-checks");
  const controllerLane = layout.plan.lanes.find((item) => item.id === "handler");
  const securityIds = securityNodes.map((item) => item.id).sort();

  assert.ok(lane);
  assert.equal(lane.nodeIds.slice().sort().join(","), securityIds.join(","));
  securityNodes.forEach((item) => {
    const position = layout.positions[item.id];
    assert.ok(position.x >= lane.x && position.x + 260 <= lane.x + lane.width, item.id + "가 SECURITY CHECKS Lane 밖에 있음");
  });
  assert.equal(layout.positions["handler-a"].x, controllerLane.x);
  assert.ok(layout.plan.projection.nodes.every((item) => item.kind !== "security-checks"));
  assert.ok(layout.plan.projection.edges.every((item) => !item.id.includes("security-checks")));
  assert.equal(layout.plan.securityChecksArea, undefined);
  assert.equal(directLayout.plan.projection.nodes.filter((item) => item.kind === "security-checks").length, 0);
  assert.deepEqual(graph.nodes.map((item) => item.id).sort(), originalNodeIds);
  assert.deepEqual(graph.edges.map((item) => ({ id: item.id, sourceId: item.sourceId, targetId: item.targetId,
    type: item.type, evidenceIds: item.evidenceIds.slice() })).sort((left, right) => left.id.localeCompare(right.id)), originalEdges);
  assert.equal(JSON.stringify(graph), before);

  const area = findAllByClass(elements.get("graph-areas"), "graph-area")
    .find((item) => item.getAttribute("data-area-id") === "security-checks");
  assert.ok(area);
  assert.equal(area.getAttribute("data-area-kind"), "technical");
  assert.equal(findAllByClass(area, "graph-area-label")[0].textContent, "보안 점검");
  assert.equal(findAllByClass(elements.get("graph-flow-projection"), "graph-projection-node")
    .some((item) => item.getAttribute("data-projection-kind") === "security-checks"), false);
  const dataCard = compositeCardForNode(layout.plan, "data-a", "SECURITY_DATA");
  const dataItem = compositeItemForNode(layout.plan, "data-a", dataCard.rowId);
  assert.ok(dataCard.originalNodeIds.includes("data-a"));
  assert.ok(dataItem.originalNodeIds.includes("data-a"));
  assert.ok(dataCard.position.x >= lane.x && dataCard.position.x + dataCard.position.width <= lane.x + lane.width);
  ui.selectGraphElement("node", "auth-partial");
  assert.equal(ui.state.selection.id, "auth-partial");
  assert.ok(textOf(elements.get("inspector")).includes(ui.state.displayIds.node("auth-partial")));
  assert.match(textOf(elements.get("inspector")), /인증 구성 원본 근거|부분 분석 관계 근거/);
});

test("Security Chain 등록 관계는 가시 배선에 추가하지 않고 Inspector에서 보존함", async () => {
  const { ui, elements } = loadUi();
  const graph = wrappedFilterGraph(0, 2);
  const original = graph.edges.map((edge) => ({ id: edge.id, evidenceIds: edge.evidenceIds.slice() }));
  ui.renderGraph(graph);
  await ui.layoutGraph();

  const membershipPaths = () => findAllByClass(elements.get("graph-edges"), "graph-edge")
    .filter((path) => path.getAttribute("data-edge-type") === "FILTERED_BY");
  assert.equal(membershipPaths().length, 0);
  assert.equal(JSON.stringify(ui.state.graph.edges.filter((edge) => edge.type === "FILTERED_BY")
    .map((edge) => ({ id: edge.id, evidenceIds: edge.evidenceIds }))), JSON.stringify(original));

  ui.selectGraphElement("node", "chain");
  assert.equal(membershipPaths().length, 0);
  ui.selectGraphElement("node", "security-filter-0");
  assert.equal(membershipPaths().length, 0);
  ui.selectGraphElement("edge", "security-edge-1");
  assert.equal(membershipPaths().length, 0);
  assert.equal(ui.state.selection.id, "security-edge-1");
  assert.match(textOf(elements.get("inspector")), /적용 필터/);
});

test("Graph 기술 영역은 내부 배치 Lane을 보존하면서 실제 Node를 분리된 상위 영역으로 묶음", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(graphFixture());
  await ui.layoutGraph();

  const areas = ui.state.graphRender.areas.filter((area) => area.id !== "education");
  assert.equal(areas.map((area) => area.id).sort().join(","), [
    "api-mapping", "controller-handler", "security-checks", "servlet-filter", "spring-security"
  ].join(","));
  const assignedNodeIds = areas.flatMap((area) => area.nodeIds).sort();
  assert.equal(assignedNodeIds.join(","), ui.state.viewGraph.nodes.map((node) => node.id).sort().join(","));
  const segments = areas.flatMap((area) => area.bounds.map((bounds) => ({ areaId: area.id, bounds })));
  segments.forEach((left, index) => segments.slice(index + 1).forEach((right) => {
    if (left.areaId === right.areaId) return;
    const intersects = left.bounds.left < right.bounds.right && left.bounds.right > right.bounds.left
      && left.bounds.top < right.bounds.bottom && left.bounds.bottom > right.bounds.top;
    assert.equal(intersects, false, `${left.areaId}와 ${right.areaId} 영역이 겹침: ${JSON.stringify({ left, right })}`);
  }));
  assert.deepEqual(Array.from(ui.state.layout.plan.lanes, (lane) => lane.id),
    ["servlet-filter", "security-chain", "security-checks", "endpoint", "handler"]);
  const renderedTechnicalAreas = elements.get("graph-areas").children.filter((group) =>
    group.getAttribute("class") === "graph-area" && group.getAttribute("data-area-kind") === "technical");
  assert.equal(renderedTechnicalAreas.length, areas.length);
  assert.ok(elements.get("graph-areas").children.some((group) => group.getAttribute("class") === "graph-area"
    && group.getAttribute("data-area-kind") === "technical"
    && group.getAttribute("data-area-id") === "security-checks"));
});

test("세 개 이상 Chain의 기술 영역은 행마다 나뉘지 않고 전체 표시 인스턴스를 감쌈", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(laneGraphFixture());
  await ui.layoutGraph();

  const rows = ui.state.layout.plan.hiddenGroups.filter((group) => group.type === "CHAIN");
  assert.ok(rows.length >= 3);
  const technicalAreas = ui.state.graphRender.areas.filter((area) => area.id !== "education");
  const renderedAreas = elements.get("graph-areas").children.filter((group) =>
    group.getAttribute("class") === "graph-area" && group.getAttribute("data-area-kind") === "technical");
  assert.equal(renderedAreas.length, technicalAreas.length);
  renderedAreas.forEach((group) => {
    assert.equal(findAllByClass(group, "graph-area-box").length, 1,
      `${group.getAttribute("data-area-id")} 기술 영역은 연속된 Bounds 하나만 사용`);
    assert.equal(findAllByClass(group, "graph-area-label").length, 1,
      `${group.getAttribute("data-area-id")} 기술 영역 제목 하나만 표시`);
  });
  technicalAreas.forEach((area) => assert.equal(area.bounds.length, 1, `${area.id} Bounds 하나`));
});

test("Finding에 연결된 Edge는 강조 상태가 없을 때도 Finding 식별을 유지함", () => {
  const { window, elements } = loadUi();
  const graph = window.MapInBootGraph.normalize(graphFixture());
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
  const positions = Object.fromEntries(graph.nodes.map((node, index) => [node.id, { x: index * 320, y: 0 }]));
  window.MapInBootGraph.render(graph, layers, {
    positions,
    findings: [{ finding: { id: "finding-1", ruleId: "RULE-1", confidence: "UNKNOWN" },
      nodeIds: ["node-2"], edgeIds: ["edge-3"] }]
  });
  const edge = findAllByClass(elements.get("graph-edges"), "graph-edge")
    .find((item) => item.getAttribute("data-edge-id") === "edge-3");
  assert.equal(edge.getAttribute("data-has-finding"), "true");
});

test("Edge 직교 경로는 결정적이고 연속 중복·공선 굴절을 제거함", () => {
  const { ui, layoutApi } = loadUi();
  const graph = ui.normalizeGraph(supportApiGraph(50));
  const first = layoutApi.semanticLayout(graph, { positions: {} });
  const second = layoutApi.semanticLayout(graph, { positions: {} });

  assert.deepEqual(first.edgeRoutes, second.edgeRoutes);
  Object.entries(first.plan.displayEdgeRoutes).forEach(([edgeId, route]) => {
    const points = routePoints(route);
    assert.ok(points.length >= 2, `${edgeId} 경로 누락`);
    for (let index = 1; index < points.length; index += 1) {
      const before = points[index - 1];
      const point = points[index];
      assert.ok(before.x === point.x || before.y === point.y, `${edgeId} 비직교 경로`);
      assert.notDeepEqual(before, point, `${edgeId} 중복 굴절점`);
      if (index > 1) {
        const previous = points[index - 2];
        assert.equal(previous.x === before.x && before.x === point.x
          || previous.y === before.y && before.y === point.y, false, `${edgeId} 공선 굴절점`);
      }
    }
  });
  assert.equal(first.plan.routeDiagnostics.edgeNodeIntersections, 0);
});

test("Handler 수준 보안 근거는 확인된 API를 경유하고 같은 API 카드에서 분기함", async () => {
  const { ui, layoutApi, elements } = loadUi();
  const snapshot = {
    nodes: [
      { id: "handler-a", type: "HANDLER", label: "OrderController#handle",
        attributes: { handler: "example.OrderController#handle" }, evidenceIds: ["source-evidence"] },
      { id: "handler-b", type: "HANDLER", label: "OtherController#handle",
        attributes: { handler: "example.OtherController#handle" }, evidenceIds: [] },
      { id: "handler-unmapped", type: "HANDLER", label: "UnmappedController#handle",
        attributes: { handler: "example.UnmappedController#handle" }, evidenceIds: [] },
      { id: "chain-a", type: "SECURITY_CHAIN", label: "Order Chain",
        attributes: { chainKey: "orders", chainOrder: "1", matcherCondition: "PATH /orders" }, evidenceIds: [] },
      ...["endpoint-a", "endpoint-b", "endpoint-c"].map((id) => ({ id, type: "ENDPOINT", label: id,
        attributes: { httpMethod: "GET", path: `/${id}`,
          handler: id === "endpoint-a" ? "example.OtherController#handle" : "example.OrderController#handle" }, evidenceIds: [`e-${id}`] })),
      { id: "data-a", type: "SECURITY_DATA", label: "data-a", attributes: { operation: "READ" }, evidenceIds: [] },
      { id: "data-unmapped", type: "SECURITY_DATA", label: "data-unmapped", attributes: { operation: "READ" }, evidenceIds: [] }
    ],
    edges: [
      ...["endpoint-a", "endpoint-b", "endpoint-c"].map((sourceId) => ({ id: `match-${sourceId}`,
        sourceId, targetId: "chain-a", type: "MATCHED_BY", confidence: "CONFIRMED", attributes: {}, evidenceIds: [] })),
      ...["endpoint-b", "endpoint-c"].map((sourceId) => ({ id: `flows-${sourceId}`, sourceId, targetId: "handler-a",
        type: "FLOWS_TO", confidence: "CONFIRMED", attributes: { flowKind: "HANDLER" }, evidenceIds: [`e-${sourceId}`] })),
      { id: "different-type", sourceId: "handler-a", targetId: "data-a", type: "READS_SECURITY_DATA",
        confidence: "CONFIRMED", attributes: {}, evidenceIds: ["e-different-type"] },
      { id: "different-source", sourceId: "endpoint-a", targetId: "handler-b", type: "FLOWS_TO",
        confidence: "CONFIRMED", attributes: { flowKind: "HANDLER" }, evidenceIds: ["e-different-source"] },
      { id: "unmapped-security", sourceId: "handler-unmapped", targetId: "data-unmapped",
        type: "READS_SECURITY_DATA", confidence: "CONFIRMED", attributes: {}, evidenceIds: ["e-unmapped-security"] }
    ]
  };
  const graph = ui.normalizeGraph(snapshot);
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");
  const layoutResult = await ui.layoutGraph();
  assert.ok(ui.state.layout, JSON.stringify({ layoutState: ui.state.layoutState,
    error: ui.state.layoutError, viewGraphNodes: ui.state.viewGraph?.nodes.map((node) => node.id),
    result: layoutResult && { width: layoutResult.width, error: layoutResult.error } }));
  const routing = ui.state.layout.plan.overviewRouting;
  const relations = ["flows-endpoint-b", "flows-endpoint-c", "different-source"]
    .map((edgeId) => routing.relations.find((relation) => relation.originalEdgeIds.includes(edgeId)));
  const securityRelations = routing.relations.filter((relation) => relation.originalEdgeIds.includes("different-type"));
  assert.ok(relations.every(Boolean), "실제 매핑 Relation이 모두 복합 카드 포트에 연결됨");
  assert.equal(securityRelations.length, 2, "확인된 두 Endpoint에 Handler 수준 근거를 각각 투영함");
  assert.ok(securityRelations.every((relation) => relation.presentationKind === "VIA_ENDPOINT_REFERENCE"
    && relation.originalHandlerId === "handler-a" && ["endpoint-b", "endpoint-c"].includes(relation.viaEndpointId)));
  assert.deepEqual(Array.from(securityRelations, (relation) => relation.viaEndpointId).sort(), ["endpoint-b", "endpoint-c"]);
  assert.equal(securityRelations.some((relation) => [relation.sourceItemId, relation.targetItemId]
    .some((itemId) => ui.state.layout.plan.displayModel.itemById[itemId]?.originalNodeIds.includes("handler-a"))), false,
  "Handler 수준 보안 근거의 직접 가시선을 생성하지 않음");
  assert.equal(ui.state.layout.plan.displayModel.edgeRoles["unmapped-security"], "INSPECTOR_REFERENCE",
    "매핑을 확인할 수 없는 근거는 Inspector 전용으로 보존함");
  assert.equal(securityRelations.some((relation) => relation.originalEdgeIds.includes("unmapped-security")), false);
  assert.equal(routing.unresolved.length, 0, JSON.stringify(routing.unresolved));
  const segmentIdsFor = (relation) => new Set(routing.routesByRelationId[relation.id].orderedSegmentIds);
  const bSegments = segmentIdsFor(relations[0]);
  const cSegments = segmentIdsFor(relations[1]);
  const securityRouteSegments = securityRelations.map(segmentIdsFor);
  assert.ok(Array.from(securityRouteSegments[0]).some((id) => securityRouteSegments[1].has(id)),
    "같은 API 카드의 서로 다른 Endpoint 포트까지 공통선을 유지함");
  assert.ok(Array.from(bSegments).some((id) => cSegments.has(id)), "같은 Handler의 Endpoint 매핑 분기에서 공통 구간을 재사용함");
  assert.equal(Array.from(segmentIdsFor(relations[2])).some((id) => bSegments.has(id)), false,
    "다른 Handler의 관계가 Endpoint Trunk에 합쳐지지 않음");
  [...relations, ...securityRelations].forEach((relation) => {
    const route = routing.routesByRelationId[relation.id];
    const sourceItem = ui.state.layout.plan.displayModel.itemById[relation.sourceItemId];
    const targetItem = ui.state.layout.plan.displayModel.itemById[relation.targetItemId];
    const edge = graph.edges.find((item) => relation.originalEdgeIds.includes(item.id));
    if (relation.presentationKind === "VIA_ENDPOINT_REFERENCE") {
      assert.ok(relation.relatedNodeIds.includes(edge.sourceId) && relation.relatedNodeIds.includes(edge.targetId));
      assert.ok(relation.mappingEdgeIds.includes(`flows-${relation.viaEndpointId}`));
    } else {
      const displayedNodeIds = [...sourceItem.originalNodeIds, ...targetItem.originalNodeIds];
      assert.ok(displayedNodeIds.includes(edge.sourceId) && displayedNodeIds.includes(edge.targetId));
    }
    assert.ok(route.sourcePort && route.targetPort);
  });
  const rendered = findAllByClass(elements.get("graph-edges"), "graph-overview-segment");
  assert.ok(rendered.some((path) => (path.getAttribute("data-edge-ids") || "").split(",").includes("flows-endpoint-b")));
});

test("서로 다른 SecurityFilterChain에 속한 도착지는 공통 경로로 합치지 않음", () => {
  const { ui, layoutApi } = loadUi();
  const snapshot = {
    nodes: [
      { id: "endpoint", type: "ENDPOINT", label: "GET /items", attributes: { httpMethod: "GET", path: "/items" }, evidenceIds: [] },
      ...["chain-a", "chain-b"].map((id, index) => ({ id, type: "SECURITY_CHAIN", label: id,
        attributes: { chainOrder: String(index + 1), matcherCondition: `/${index}` }, evidenceIds: [] }))
    ],
    edges: ["chain-a", "chain-b"].map((targetId) => ({ id: `match-${targetId}`, sourceId: "endpoint",
      targetId, type: "MATCHED_BY", confidence: "CONFIRMED", attributes: {}, evidenceIds: [] }))
  };
  const graph = ui.normalizeGraph(snapshot);
  const layout = layoutApi.semanticLayout(graph, { positions: {} });
  assert.equal(layout.plan.commonEdgeRouteGroups.some((group) =>
    group.edgeIds.includes("match-chain-a") && group.edgeIds.includes("match-chain-b")), false);
});

test("Handler 수준 보안 근거는 확정된 Chain 행이 없으면 Inspector 전용임", () => {
  const { ui, layoutApi } = loadUi();
  const graph = ui.normalizeGraph({
    nodes: [
      { id: "handler", type: "HANDLER", serviceId: "orders", label: "OrderController#handle",
        attributes: { handler: "example.OrderController#handle" }, evidenceIds: [] },
      { id: "endpoint", type: "ENDPOINT", serviceId: "orders", label: "GET /orders",
        attributes: { httpMethod: "GET", path: "/orders", handler: "example.OrderController#handle" }, evidenceIds: [] },
      { id: "security-data", type: "SECURITY_DATA", serviceId: "orders", label: "Order data",
        attributes: { operation: "READ" }, evidenceIds: [] }
    ],
    edges: [
      { id: "mapping", sourceId: "handler", targetId: "endpoint", type: "FLOWS_TO",
        confidence: "CONFIRMED", attributes: {}, evidenceIds: [] },
      { id: "security-reference", sourceId: "handler", targetId: "security-data", type: "READS_SECURITY_DATA",
        confidence: "CONFIRMED", attributes: {}, evidenceIds: [] }
    ]
  });
  const plan = layoutApi.semanticLayout(graph, { positions: {} }).plan;

  assert.equal(plan.displayModel.edgeRoles["security-reference"], "INSPECTOR_REFERENCE");
  assert.equal(plan.overviewRouting.relations.some((relation) =>
    relation.originalEdgeIds.includes("security-reference")), false);
  assert.equal(plan.overviewRouting.unresolved.length, 0);
});

test("Overview 복합 항목은 기술 이름을 줄여 표시하고 원본 메서드와 상태 정보를 보존함", async () => {
  const { ui, elements } = loadUi();
  const handlerA = "com.example.OrderController#createApplication(Ljava/lang/String;)V";
  const handlerB = "com.example.OrderController#createApplication(Ljava/lang/Long;)V";
  const apiPath = `/api/loans/{loanId}/applications/${"very-long-segment/".repeat(8)}`;
  const snapshot = {
    nodes: [
      { id: "servlet-filter", type: "FILTER", serviceId: "orders", label: "Filter",
        attributes: { registrationKind: "SERVLET", filterClass: "org/springframework/web/filter/CompositeFilter", filterOrder: "1" }, evidenceIds: [] },
      { id: "security-filter", type: "FILTER", serviceId: "orders", label: "Filter",
        attributes: { registrationKind: "SECURITY", filterClass: "Lorg/springframework/security/web/csrf/CsrfFilter;", filterOrder: "1" }, evidenceIds: [] },
      { id: "chain", type: "SECURITY_CHAIN", serviceId: "orders", label: "Order Chain",
        attributes: { chainKey: "orders", chainOrder: "1", matcherCondition: "PATH /api/loans" }, evidenceIds: [] },
      { id: "servlet", type: "SERVLET", serviceId: "orders", label: "DispatcherServlet",
        attributes: { servletClass: "org.springframework.web.servlet.DispatcherServlet" }, evidenceIds: [] },
      { id: "handler-a", type: "HANDLER", serviceId: "orders", label: "createApplication",
        attributes: { handler: handlerA }, evidenceIds: [] },
      { id: "handler-b", type: "HANDLER", serviceId: "orders", label: "createApplication",
        attributes: { handler: handlerB }, evidenceIds: [] },
      { id: "endpoint-a", type: "ENDPOINT", serviceId: "orders", label: "GET endpoint-a",
        attributes: { httpMethod: "GET", path: apiPath, handler: handlerA }, evidenceIds: [] },
      { id: "endpoint-b", type: "ENDPOINT", serviceId: "orders", label: "POST endpoint-b",
        attributes: { httpMethod: "POST", path: "/api/loans/{loanId}/applications", handler: handlerB }, evidenceIds: [] },
      { id: "state-a", type: "BUSINESS_SECURITY_STATE", serviceId: "orders", label: "state-requires|identity_verified",
        attributes: { stateName: "identity_verified", stateAction: "REQUIRES",
          declaringMethod: "com.example.OrderController#requireIdentity(Ljava/lang/String;)V" }, evidenceIds: [] }
    ],
    edges: [
      { id: "match-a", sourceId: "endpoint-a", targetId: "chain", type: "MATCHED_BY", confidence: "CONFIRMED", attributes: {}, evidenceIds: [] },
      { id: "match-b", sourceId: "endpoint-b", targetId: "chain", type: "MATCHED_BY", confidence: "CONFIRMED", attributes: {}, evidenceIds: [] },
      { id: "servlet-filtered", sourceId: "servlet", targetId: "servlet-filter", type: "FILTERED_BY", confidence: "CONFIRMED",
        attributes: { registrationKind: "SERVLET", filterOrder: "1" }, evidenceIds: [] },
      { id: "chain-filtered", sourceId: "chain", targetId: "security-filter", type: "FILTERED_BY", confidence: "CONFIRMED",
        attributes: { registrationKind: "SECURITY", filterOrder: "1" }, evidenceIds: [] },
      { id: "mapping-a", sourceId: "endpoint-a", targetId: "handler-a", type: "FLOWS_TO", confidence: "CONFIRMED", attributes: { flowKind: "HANDLER" }, evidenceIds: [] },
      { id: "mapping-b", sourceId: "endpoint-b", targetId: "handler-b", type: "FLOWS_TO", confidence: "CONFIRMED", attributes: { flowKind: "HANDLER" }, evidenceIds: [] },
      { id: "state-requirement", sourceId: "handler-a", targetId: "state-a", type: "SECURITY_STATE", confidence: "CONFIRMED", attributes: { stateAction: "REQUIRES" }, evidenceIds: [] }
    ],
    findings: [{ id: "finding-a", ruleId: "PUBLIC_ENDPOINT", title: "표시 경계 확인", confidence: "UNKNOWN",
      nodeIds: ["endpoint-a"], edgeIds: [], evidenceIds: [] }]
  };
  const graph = ui.normalizeGraph(snapshot);
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");
  const layoutResult = await ui.layoutGraph();
  assert.ok(ui.state.layout, JSON.stringify({ layoutState: ui.state.layoutState,
    error: ui.state.layoutError, viewGraphNodes: ui.state.viewGraph?.nodes.map((node) => node.id),
    result: layoutResult && { width: layoutResult.width, error: layoutResult.error } }));
  const plan = ui.state.layout.plan;
  const cards = plan.displayModel.composites;
  const entries = cards.flatMap((card) => card.items.filter((item) => !item.isHeader));
  const cardText = cards.flatMap((card) => [card.title, card.subtitle,
    ...card.items.flatMap((item) => [item.label, item.detail])]).join(" ");
  const servletItem = compositeItemForNode(plan, "servlet-filter");
  const securityFilterItem = compositeItemForNode(plan, "security-filter");
  const apiCard = cards.find((card) => card.kind === "API_MAPPING" && card.originalNodeIds.includes("endpoint-a"));
  const handlerCard = cards.find((card) => card.kind === "CONTROLLER_HANDLER" && card.originalNodeIds.includes("handler-a"));
  const stateItem = compositeItemForNode(plan, "state-a");

  assert.equal(servletItem.label, "CompositeFilter");
  assert.equal(securityFilterItem.label, "CsrfFilter");
  assert.match(servletItem.detail, /^0?1$/);
  assert.equal(apiCard.title, "OrderController");
  assert.equal(handlerCard.title, "OrderController");
  assert.deepEqual(Array.from(handlerCard.items.filter((item) => item.originalNodeIds.some((id) => ["handler-a", "handler-b"].includes(id)))
    .map((item) => item.label)).sort(), ["createApplication · 1", "createApplication · 2"]);
  assert.equal(apiCard.items.find((item) => item.originalNodeIds.includes("endpoint-a")).label, `GET ${apiPath}`);
  assert.equal(stateItem.label, "상태 요구 · identity_verified");
  assert.equal(stateItem.detail, "OrderController · requireIdentity");
  assert.doesNotMatch(cardText, /com\.example\.|org\.springframework\//);
  assert.ok(entries.some((item) => item.originalNodeIds.includes("handler-a")));
  assert.equal(ui.state.graph.nodes.find((node) => node.id === "handler-a").attributes.handler, handlerA);
  assert.equal(ui.state.graph.nodes.find((node) => node.id === "handler-b").attributes.handler, handlerB);
  assert.ok(graph.edges.find((edge) => edge.id === "state-requirement").sourceId === "handler-a");
  const endpointItem = cards.flatMap((card) => card.items)
    .find((item) => item.originalNodeIds.includes("endpoint-a"));
  const endpointRow = findAllByClass(elements.get("graph-nodes"), "graph-composite-item")
    .find((item) => (item.getAttribute("data-node-ids") || "").split(",").includes("endpoint-a"));
  assert.ok(endpointRow, JSON.stringify({ itemId: endpointItem.id,
    renderedItems: findAllByClass(elements.get("graph-nodes"), "graph-composite-item")
      .map((item) => item.getAttribute("data-composite-item-id")),
    graphNodeChildren: elements.get("graph-nodes").children.map((item) => item.getAttribute("class")) }));
  const pathLabel = findAllByClass(endpointRow, "graph-composite-item-label")[0];
  assert.match(pathLabel.getAttribute("clip-path"), /^url\(#graph-composite-text-clip-/);
  const marker = findAllByClass(endpointRow, "finding-marker")[0];
  const markerX = Number(marker.getAttribute("transform").match(/translate\(([-\d.]+)/)[1]);
  assert.ok(markerX + 14 <= endpointItem.bounds.width, "Finding 표식이 복합 항목 경계 안에 배치됨");
});

test("Overview Blueprint 간격만 확대하고 상세 배치 간격은 유지함", () => {
  const { ui, layoutApi } = loadUi();
  const sourceGraph = detailGraphFixture();
  sourceGraph.nodes.push({ id: "state-gap", type: "BUSINESS_SECURITY_STATE", serviceId: "orders",
    label: "business state", attributes: { stateName: "identity_verified", stateAction: "REQUIRES" }, evidenceIds: [] });
  sourceGraph.edges.push({ id: "state-gap-edge", sourceId: "handler-a", targetId: "state-gap", type: "SECURITY_STATE",
    confidence: "CONFIRMED", attributes: {}, evidenceIds: [] });
  const graph = ui.normalizeGraph(sourceGraph);
  const overview = layoutApi.semanticLayout(graph, { positions: {} });
  const detail = layoutApi.semanticLayout({ ...graph, presentationContext: "detail" }, { positions: {} });
  const lanes = new Map(overview.plan.lanes.map((lane) => [lane.id, lane]));
  const checkCards = overview.plan.displayModel.composites.filter((card) => card.rowId === "chain:chain-a"
    && ["AUTHORIZATION", "SECURITY_DATA", "BUSINESS_SECURITY_STATE"].includes(card.kind))
    .sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x);

  assert.equal(lanes.get("endpoint").columnStep - lanes.get("endpoint").cardWidth, 576);
  assert.equal(overview.plan.sectionGap, 288);
  assert.equal(overview.plan.majorSectionGap, 600);
  assert.equal(checkCards.length, 3);
  assert.equal(checkCards[2].bounds.y - Math.max(...checkCards.slice(0, 2).map((card) => card.bounds.y + card.bounds.height)), 432,
    JSON.stringify(checkCards.map((card) => ({ kind: card.kind, y: card.bounds.y, height: card.bounds.height }))));
  assert.equal(detail.plan.sectionGap, 96);
  assert.equal(detail.plan.majorSectionGap, 200);
});

test("Overview의 MATCHED_BY는 가시 배선 없이 원본 적용 관계로 보존함", async () => {
  const { ui, layoutApi, elements } = loadUi();
  const graph = ui.normalizeGraph({
    nodes: [
      { id: "endpoint-a", type: "ENDPOINT", label: "GET /a", attributes: { httpMethod: "GET", path: "/a" }, evidenceIds: [] },
      { id: "endpoint-b", type: "ENDPOINT", label: "GET /b", attributes: { httpMethod: "GET", path: "/b" }, evidenceIds: [] },
      { id: "chain", type: "SECURITY_CHAIN", label: "Chain", attributes: { chainOrder: "1" }, evidenceIds: [] }
    ],
    edges: [
      { id: "match-a", sourceId: "endpoint-a", targetId: "chain", type: "MATCHED_BY", attributes: {}, evidenceIds: [] },
      { id: "match-b", sourceId: "endpoint-b", targetId: "chain", type: "MATCHED_BY", attributes: {}, evidenceIds: [] }
    ]
  });
  const layout = layoutApi.semanticLayout(graph, { positions: {} });
  assert.equal(layout.plan.overviewRouting.relations.some((relation) =>
    relation.originalEdgeIds.some((id) => ["match-a", "match-b"].includes(id))), false);
  assert.equal(layout.plan.displayModel.edgeRoles["match-a"], "ROW_MEMBERSHIP");
  assert.equal(layout.plan.displayModel.edgeRoles["match-b"], "ROW_MEMBERSHIP");
  assert.deepEqual(Array.from(graph.edges, (edge) => edge.id), ["match-a", "match-b"]);

  ui.renderGraph(graph);
  await ui.layoutGraph();
  const visibleEdges = findAllByClass(elements.get("graph-edges"), "graph-overview-segment");
  assert.equal(visibleEdges.some((path) => (path.getAttribute("data-edge-ids") || "")
    .split(",").some((id) => ["match-a", "match-b"].includes(id))), false);
});

test("Inspector 속성 순서·확실성 문구와 고정 헤더·본문 스크롤을 구분함", () => {
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  const endpoint = snapshot.nodes[2];
  endpoint.attributes = {
    handler: "com.example.OrderController#list",
    path: "/orders",
    httpMethod: "GET"
  };
  const filter = snapshot.nodes.find((node) => node.type === "FILTER");
  filter.attributes = {
    registrationKind: "SERVLET",
    filterClass: "com.example.AuditFilter",
    pathStatus: "CURRENT_PATH_NOT_APPLIED"
  };
  snapshot.edges.push({
    id: "inspector-authorization-use",
    sourceId: endpoint.id,
    targetId: filter.id,
    type: "USES_FOR_AUTHORIZATION",
    attributes: {},
    confidence: "CONFIRMED",
    evidenceIds: []
  });

  ui.renderGraph(snapshot);
  ui.selectGraphElement("node", endpoint.id);
  const inspector = elements.get("inspector");
  const propertyRows = findAllByClass(inspector, "inspector-row");
  const labels = propertyRows.map((row) => row.children[0].textContent);
  const endpointLabels = labels.filter((label) => ["HTTP 메서드", "경로", "핸들러 원문 서명"].includes(label));
  assert.deepEqual(endpointLabels, ["핸들러 원문 서명"]);
  assert.match(textOf(inspector), /GET \/orders/);
  assert.match(textOf(inspector), /com\.example\.OrderController#list/);

  ui.selectGraphElement("node", filter.id);
  assert.match(textOf(inspector), /서블릿/);
  assert.match(textOf(inspector), /확인되지 않은 속성 1 CURRENT_PATH_NOT_APPLIED/);
  assert.doesNotMatch(textOf(inspector), /SERVLET|pathStatus/);

  ui.selectGraphElement("edge", "inspector-authorization-use");
  assert.match(textOf(inspector), /실제 인가 사용/);
  const confidenceRow = findAllByClass(inspector, "inspector-row")
    .find((row) => row.children[0].textContent === "판단 신뢰도");
  assert.ok(confidenceRow);
  assert.equal(confidenceRow.children[1].textContent, "확정");

  assert.match(appCss, /\.inspector\s*\{[^}]*width:\s*clamp\(420px,\s*30vw,\s*480px\)[^}]*overflow:\s*hidden/s);
  assert.match(appCss, /\.inspector-header\s*\{[^}]*flex:\s*0\s+0\s+auto/s);
  assert.match(appCss, /\.inspector-tabs\s*\{[^}]*flex:\s*0\s+0\s+auto/s);
  assert.match(appCss, /\.inspector-body\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s);
  assert.match(appCss, /@media\s*\(max-width:\s*1279px\)\s*\{[^}]*\.inspector\s*\{[^}]*position:\s*fixed[^}]*width:\s*min\(480px,\s*96vw\)/s);
  assert.match(appCss, /\.app-body:has\(>\s*#inspector:not\(\[hidden\]\)\)\s+\.graph-minimap\s*\{[^}]*right:\s*calc\(min\(480px,\s*96vw\)\s*\+\s*14px\)/s);
  assert.match(appCss, /@media\s*\(max-width:\s*760px\)\s*\{[^}]*--header-height:\s*114px/);
  assert.match(appCss, /@media\s*\(max-width:\s*520px\)\s*\{[^}]*--header-height:\s*138px/);
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

test("내부 처리 단계는 세로 순서를 유지하고 실제 Node와 겹치지 않으며 Bounds에 포함됨", async () => {
  const { ui } = loadUi();
  ui.renderGraph(laneGraphFixture());
  ui.selectView("feature-flow");
  const layout = await ui.layoutGraph();
  const projection = layout.plan.projection;
  const projectionTop = Math.min(...projection.nodes.map((node) => node.position.y));

  const actualPositions = Object.values(layout.positions);
  assert.ok(projection.nodes.length > 0);
  const mainLearningIds = ["education-http-request", "education-servlet-container",
    "education-delegating-filter-proxy", "education-filter-chain-proxy", "education-handler-mapping",
    "education-handler-adapter", "education-http-response"];
  const mainLearning = mainLearningIds.map((id) => projection.nodes.find((node) => node.id === id)).filter(Boolean);
  mainLearning.slice(1).forEach((node, index) => {
    const previous = mainLearning[index];
    assert.ok(node.position.x > previous.position.x
      || node.position.x === previous.position.x && node.position.y > previous.position.y,
    `${node.id}가 앞선 카드 또는 카드 내부 처리 단계보다 뒤에 배치되지 않음: ${JSON.stringify(mainLearning.map((item) => ({ id: item.id, position: item.position })))}`);
  });
  projection.nodes.forEach((node) => actualPositions.forEach((position) => {
    assert.ok(node.position.x + node.width <= position.x || position.x + 260 <= node.position.x
      || node.position.y + node.height <= position.y || position.y + 120 <= node.position.y);
  }));
  const projectionBottom = Math.max(...projection.nodes.map((node) => node.position.y + node.height));
  assert.ok(layout.height >= projectionBottom);
  projection.nodes.forEach((node) => {
    assert.ok(layout.height >= node.position.y + node.height);
    assert.ok(layout.width >= node.position.x + node.width,
      `${node.id}: layout.width=${layout.width}, node.x=${node.position.x}, node.width=${node.width}`);
  });
  assert.ok(projection.edges.length > 0);
  assert.equal(layout.plan.educationArea.top, projectionTop - layout.plan.educationArea.topPadding);
});

test("Endpoint 16개 복합 항목은 실제 API 카드와 동적 Chain 행 높이에 반영함", () => {
  const { layoutApi, ui } = loadUi();
  const graph = endpointCountGraph(16);
  const plan = layoutApi.semanticLayout(ui.normalizeGraph(graph), { positions: {} }).plan;
  const row = plan.hiddenGroups.find((item) => item.id === "chain:count-chain");
  const cards = plan.displayModel.composites.filter((card) => card.kind === "API_MAPPING" && card.rowId === row.id);
  assert.equal(cards.length, 1, "확인된 Controller가 없는 Endpoint는 한 미확정 API 카드에 유지");
  const card = cards[0];
  const itemNodeIds = card.items.flatMap((item) => item.originalNodeIds);
  assert.equal(itemNodeIds.length, 16);
  assert.deepEqual(Array.from(itemNodeIds).sort(), Array.from(graph.nodes.filter((node) => node.type === "ENDPOINT"),
    (node) => node.id).sort());
  card.items.forEach((item) => {
    assert.ok(item.bounds.x >= card.contentBounds.x);
    assert.ok(item.bounds.y >= card.contentBounds.y);
    assert.ok(item.bounds.x + item.bounds.width <= card.contentBounds.x + card.contentBounds.width);
    assert.ok(item.bounds.y + item.bounds.height <= card.contentBounds.y + card.contentBounds.height);
  });
  assert.ok(card.bounds.y >= row.rowTop && card.bounds.y + card.bounds.height <= row.rowBottom);
  const apiMappings = plan.overviewRouting.relations.filter((relation) => relation.role === "API_MAPPING");
  assert.equal(apiMappings.length, 16, "실제 Handler 원문이 일치하는 Endpoint 매핑 누락");
  apiMappings.forEach((relation) => {
    const endpointId = relation.relatedNodeIds.find((id) => graph.nodes.find((node) => node.id === id)?.type === "ENDPOINT");
    const handlerId = relation.relatedNodeIds.find((id) => graph.nodes.find((node) => node.id === id)?.type === "HANDLER");
    assert.ok(endpointId && handlerId);
    assert.equal(graph.nodes.find((node) => node.id === endpointId).attributes.handler,
      graph.nodes.find((node) => node.id === handlerId).attributes.handler);
    assert.equal(relation.originalEdgeIds.length, 1, "확정 Handler 관계의 원본 Edge가 보존됨");
  });
  assert.ok(plan.lanes.find((lane) => lane.id === "handler").x > card.bounds.x + card.bounds.width);
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
  const cards = ui.state.layout.plan.displayModel.composites.filter((card) => card.kind === "CONTROLLER_HANDLER");
  const reportCards = cards.filter((card) => card.key === "com.example.ReportController");
  assert.equal(reportCards.length, 1);
  assert.deepEqual(new Set(reportCards[0].items.flatMap((item) => item.originalNodeIds)),
    new Set(["handler-report-a", "handler-report-b"]));
  assert.equal(cards.filter((card) => card.title === "ReportController").length, 2);
  assert.equal(graph.nodes.filter((node) => node.type === "HANDLER").map((node) => node.id).join("|"), [
    ...originalHandlerIds, "handler-report-a", "handler-report-b", "handler-other-report"
  ].join("|"));
  assert.equal(JSON.stringify(graph), before);
  assert.equal(findAllByClass(elements.get("graph-nodes"), "graph-composite-card").length,
    ui.state.layout.plan.displayModel.composites.length);
  const reportCard = reportCards[0];
  const reportCardElement = findAllByClass(elements.get("graph-nodes"), "graph-composite-card")
    .find((element) => element.getAttribute("data-composite-card-id") === reportCard.id);
  assert.ok(reportCardElement);
  assert.equal(findAllByClass(reportCardElement, "graph-composite-item").length, 2);
  reportCardElement.dispatchEvent({ type: "keydown", key: "Enter" });
  assert.equal(ui.state.selection.kind, "controller-group");
  assert.equal(ui.state.selection.id, reportCard.id);
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

test("Controller 카드 선택은 실제 Handler 매핑 관계만 강조함", async () => {
  const { ui, elements } = loadUi();
  ui.state.includeUnconnectedNodes = true;
  ui.renderGraph(controllerGroupGraph(1, 1));
  await ui.layoutGraph();
  const card = ui.state.layout.plan.displayModel.composites.find((item) => item.kind === "CONTROLLER_HANDLER"
    && item.controllerFqcn === "com.example.SampleController");
  assert.ok(card);
  ui.selectGraphElement("controller-group", card.id);
  const plan = ui.state.layout.plan.overviewRouting;
  const first = plan.relations.find((relation) => relation.role === "API_MAPPING"
    && relation.relatedNodeIds.includes("first-endpoint-0"));
  const second = plan.relations.find((relation) => relation.role === "API_MAPPING"
    && relation.relatedNodeIds.includes("second-endpoint-0"));
  assert.ok(first);
  assert.ok(second);
  const relatedState = (relation) => {
    const route = plan.routesByRelationId[relation.id];
    assert.ok(route, `${relation.id} route 누락: ${JSON.stringify(plan.unresolved)}`);
    const ids = new Set(route.orderedSegmentIds);
    return findAllByClass(elements.get("graph-edges"), "graph-overview-segment")
      .filter((path) => ids.has(path.getAttribute("data-segment-id")))
      .map((path) => path.getAttribute("data-related"));
  };
  assert.ok(relatedState(first).length > 0 && relatedState(first).every((value) => value === "true"));
  assert.ok(relatedState(second).length > 0 && relatedState(second).every((value) => value === "false"));
});

test("보안 관계선은 Graph 하단을 우회하지 않고 목표 입력 Port까지 짧게 연결함", () => {
  const { ui, layoutApi } = loadUi();
  const graph = ui.normalizeGraph(supportApiGraph(1));
  graph.presentationContext = "detail";
  const layout = layoutApi.semanticLayout(graph, { positions: {} });
  const routing = layout.plan.overviewRouting;
  const model = layout.plan.displayModel;
  const relation = routing.relations.find((item) => item.originalEdgeIds.includes("secured-0"));
  const route = relation && routing.routesByRelationId[relation.id];
  assert.ok(route, "상세 Composite 관계 경로 누락");
  const segments = new Map(routing.segments.map((segment) => [segment.id, segment]));
  const ports = new Map(model.ports.map((port) => [port.id, port]));
  [route.sourcePort, route.targetPort].forEach((port) => {
    const source = ports.get(port.id);
    assert.ok(source && source.x === port.x && source.y === port.y && source.itemId === port.itemId);
  });
  let current = route.sourcePort;
  const samples = [];
  let length = 0;
  let curvedSegments = 0;
  route.orderedSegmentIds.forEach((id) => {
    const segment = segments.get(id);
    assert.ok(segment && segment.relationIds.includes(relation.id), `${id} 관계 연결 누락`);
    const forward = current.x === segment.from.x && current.y === segment.from.y;
    const backward = current.x === segment.to.x && current.y === segment.to.y;
    assert.ok(forward || backward, `${id} Junction 연결 불일치`);
    const start = forward ? segment.from : segment.to;
    const end = forward ? segment.to : segment.from;
    const controls = segment.geometry?.kind === "CUBIC"
      ? forward ? segment.geometry.controlPoints : segment.geometry.controlPoints.slice().reverse()
      : null;
    if (controls) curvedSegments += 1;
    let previous = start;
    for (let index = 1; index <= 16; index += 1) {
      const t = index / 16;
      const inverse = 1 - t;
      const point = controls ? {
        x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * controls[0].x
          + 3 * inverse * t ** 2 * controls[1].x + t ** 3 * end.x,
        y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * controls[0].y
          + 3 * inverse * t ** 2 * controls[1].y + t ** 3 * end.y
      } : { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
      samples.push(point);
      previous = point;
    }
    current = end;
  });
  assert.ok(current.x === route.targetPort.x && current.y === route.targetPort.y, "목표 입력 Port까지 이어지지 않음");
  assert.ok(curvedSegments > 0, "상세 관계가 자연스러운 Bézier Segment를 포함함");
  const directLength = Math.hypot(route.targetPort.x - route.sourcePort.x,
    route.targetPort.y - route.sourcePort.y);
  assert.ok(length <= directLength * 1.25, `불필요한 우회: ${length.toFixed(1)} / ${directLength.toFixed(1)}`);
  const endpointCards = new Set([relation.sourceInstanceId, relation.targetInstanceId]);
  const clearance = layout.plan.routing.nodeSafeMargin;
  model.instances.filter((instance) => !endpointCards.has(instance.id)).forEach((instance) => {
    const bounds = instance.position;
    samples.forEach((point) => {
      assert.ok(point.x <= bounds.x - clearance || point.x >= bounds.x + bounds.width + clearance
        || point.y <= bounds.y - clearance || point.y >= bounds.y + bounds.height + clearance,
      `${instance.id} 카드 안전 간격 침범`);
    });
  });
  const minCardTop = Math.min(...model.instances.map((instance) => instance.position.y));
  const maxCardBottom = Math.max(...model.instances.map((instance) => instance.position.y + instance.position.height));
  assert.ok(Math.min(...samples.map((point) => point.y)) >= minCardTop - clearance * 3,
    "경로가 전체 카드의 위쪽 외곽으로 이탈함");
  assert.ok(Math.max(...samples.map((point) => point.y)) <= maxCardBottom + clearance * 3,
    "경로가 전체 카드의 아래쪽 외곽으로 이탈함");
  assert.equal(layout.plan.routeDiagnostics.edgeNodeIntersections, 0);
});

test("Controller 50·60 API Overview에서 보안 관계가 정확한 Item Port로 연결됨", () => {
  const { ui, layoutApi } = loadUi();
  [50, 60].forEach((count) => {
    const graph = ui.normalizeGraph(supportApiGraph(count));
    const layout = layoutApi.semanticLayout(graph, { positions: {} });
    const plan = layout.plan.overviewRouting;
    const model = layout.plan.displayModel;
    const securedEdges = graph.edges.filter((edge) => edge.type === "SECURED_BY");
    const securedRelations = plan.relations.filter((relation) => relation.originalEdgeIds.some((id) => id.startsWith("secured-")));
    const ports = new Map(model.ports.map((port) => [port.id, port]));
    const segments = new Map(plan.segments.map((segment) => [segment.id, segment]));
    assert.equal(Array.from(plan.unresolved).length, 0, `${count}개 API 미해결 관계`);
    assert.equal(securedRelations.length, count, `${count}개 API 보안 관계 누락`);
    securedEdges.forEach((edge) => {
      const relation = securedRelations.find((item) => item.originalEdgeIds.includes(edge.id));
      const route = relation && plan.routesByRelationId[relation.id];
      assert.ok(route, `${count}개 API ${edge.id}의 Route 없음`);
      assert.equal(route.sourcePort.x, ports.get(relation.visualSourcePortId).x, edge.id);
      assert.equal(route.sourcePort.y, ports.get(relation.visualSourcePortId).y, edge.id);
      assert.equal(route.targetPort.x, ports.get(relation.visualTargetPortId).x, edge.id);
      assert.equal(route.targetPort.y, ports.get(relation.visualTargetPortId).y, edge.id);
      let current = route.sourcePort;
      route.orderedSegmentIds.forEach((id) => {
        const segment = segments.get(id);
        assert.ok(segment && segment.relationIds.includes(relation.id), `${count}개 API ${edge.id} 단절`);
        assert.ok((current.x === segment.from.x && current.y === segment.from.y)
          || (current.x === segment.to.x && current.y === segment.to.y), `${edge.id} Junction 불일치`);
        current = current.x === segment.from.x && current.y === segment.from.y ? segment.to : segment.from;
        model.instances.forEach((instance) => {
          if (instance.id === relation.sourceInstanceId || instance.id === relation.targetInstanceId) return;
          const collision = routeIntersectsPosition({ sections: [{ startPoint: segment.from, endPoint: segment.to }] }, instance.position);
          if (collision) assert.ok(segment.routeRole === "TRUNK" && segment.relationIds.length > 1,
            `${count}개 API ${edge.id} ${instance.id}와 ${segment.routeRole} 충돌`);
        });
      });
      assert.equal(current.x, route.targetPort.x, `${edge.id} 최종 Port X`);
      assert.equal(current.y, route.targetPort.y, `${edge.id} 최종 Port Y`);
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
  const authCard = compositeCardForNode(plan, "authorization-a", "AUTHORIZATION");
  const dataCard = compositeCardForNode(plan, "security-data-a", "SECURITY_DATA");
  assert.ok(authCard);
  assert.ok(dataCard);
  const isolatedUnknown = compositeCardForNode(plan, "data-unknown", "SECURITY_DATA");
  const unresolved = compositeCardForNode(plan, "data-uncertain", "SECURITY_DATA");
  assert.equal(isolatedUnknown.rowId, "isolated");
  assert.equal(unresolved.rowId, "unresolved");
  assert.equal(display.nodeToDisplay["data-unknown"], isolatedUnknown.id);
  assert.equal(display.nodeToDisplay["data-uncertain"], unresolved.id);
  assert.ok(compositeCardForNode(plan, "auth-other", "AUTHORIZATION"));
  assert.ok(compositeCardForNode(plan, "data-other", "SECURITY_DATA"));
  normalized.nodes.filter((node) => display.originalNodeToItemIds[node.id]).forEach((item) => {
    const itemIds = display.originalNodeToItemIds[item.id];
    assert.ok(itemIds.length > 0);
    itemIds.forEach((id) => assert.ok(display.itemToOriginalNodeIds[id].includes(item.id)));
  });
  normalized.edges.forEach((item) => assert.ok(display.displayToEdges[display.edgeToDisplay[item.id]].includes(item.id)));
  assert.equal(JSON.stringify(normalized), before);
});

test("인가 및 보안정보 표시 그룹은 원본 Fact를 Inspector에서 선택할 수 있음", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(detailGraphFixture());
  await ui.layoutGraph();
  const supportCards = ui.state.layout.plan.displayModel.composites
    .filter((card) => ["AUTHORIZATION", "SECURITY_DATA"].includes(card.kind));
  assert.ok(supportCards.length >= 2);
  const factItem = supportCards.flatMap((card) => card.items)
    .find((item) => item.originalNodeIds.length > 0 && !item.isHeader);
  const renderedItem = findAllByClass(elements.get("graph-nodes"), "graph-composite-item")
    .find((item) => item.getAttribute("data-composite-item-id") === factItem.id);
  assert.ok(renderedItem);
  renderedItem.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selection.kind, "controller-group");
  assert.match(textOf(elements.get("inspector")), /원본 Node/);
  const links = findAllByClass(elements.get("inspector"), "inspector-link");
  assert.ok(links.length > 0);
  links[0].dispatchEvent({ type: "click" });
  assert.equal(ui.state.selection.kind, "node");
});

test("API 안내선은 표시 Controller 카드의 실제 입력 포트에 도착함", async () => {
  const { ui, layoutApi } = loadUi();
  const graph = ui.normalizeGraph(detailGraphFixture());
  const plan = layoutApi.semanticLayout(graph, { positions: {} }).plan;
  const endpointItem = compositeItemForNode(plan, "endpoint-a");
  const handlerItem = compositeItemForNode(plan, "handler-a", endpointItem.rowId);
  const relation = plan.overviewRouting.relations.find((item) => item.role === "API_MAPPING"
    && item.sourceItemId === endpointItem.id && item.targetItemId === handlerItem.id);
  assert.ok(relation, "확정된 API와 Handler 항목 간 관계 누락");
  const ports = plan.displayModel.portById;
  const route = plan.overviewRouting.routesByRelationId[relation.id];
  assert.equal(route.sourcePort.x, ports[relation.visualSourcePortId].x);
  assert.equal(route.sourcePort.y, endpointItem.bounds.y + endpointItem.bounds.height / 2);
  assert.equal(route.targetPort.x, ports[relation.visualTargetPortId].x);
  assert.equal(route.targetPort.y, handlerItem.bounds.y + handlerItem.bounds.height / 2);
});

test("묶인 표시 관계에서 개별 Edge와 Evidence를 선택할 수 있음", async () => {
  const { ui, elements } = loadUi();
  const graph = detailGraphFixture();
  graph.evidence = [{ id: "e-edge2", source: "RUNTIME", location: "OrderPolicy#check", summary: "추가 관계 근거" }];
  graph.evidenceDisplayCodes = { "e-edge2": "EV-TEST-002" };
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
  const bundledSegments = paths.filter((path) => (path.attributes["data-edge-ids"] || "").includes("secured-a2"));
  assert.ok(bundledSegments.length > 0);
  assert.equal(new Set(bundledSegments.map((path) => path.getAttribute("data-segment-id"))).size, bundledSegments.length);
  bundle.dispatchEvent({ type: "click", stopPropagation() {} });
  assert.match(textOf(elements.get("inspector")), /함께 표시한 원본 관계/);
  const link = findAllByClass(elements.get("inspector"), "inspector-link")
    .find((button) => button.attributes["data-edge-id"] === "secured-a2");
  assert.ok(link);
  link.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selection.id, "secured-a2");
  assert.match(textOf(elements.get("inspector")), /EV-TEST-002/);
  assert.doesNotMatch(textOf(elements.get("inspector")), /e-edge2/);
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
  const item = compositeItemForNode(ui.state.layout.plan, "authorization-a");
  const renderedItem = findAllByClass(elements.get("graph-nodes"), "graph-composite-item")
    .find((element) => element.getAttribute("data-composite-item-id") === item.id);
  const marker = findAllByClass(renderedItem, "finding-marker")[0];
  assert.ok(marker, "Finding 표식이 실제 인가 항목 안에 표시됨");
  assert.equal(marker.getAttribute("data-finding-id"), "grouped");
  marker.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selectedFindingId, "grouped");
  assert.equal(ui.state.view, "security-flow");
  assert.equal(elements.get("finding-modal").hidden, false);
  assert.match(textOf(elements.get("finding-modal")), new RegExp(ui.state.displayIds.node("authorization-a")));
  assert.doesNotMatch(textOf(elements.get("finding-modal")), /authorization-a/);
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
    assert.equal(section.startPoint.y, source.y + 60, id);
    assert.ok([target.x, target.x + 260].includes(section.endPoint.x), id);
    assert.equal(section.endPoint.y, target.y + 60, id);
  });
});

test("동일한 Snapshot의 표시 경로와 중앙 배치는 안정적으로 유지됨", () => {
  const { ui, layoutApi } = loadUi();
  const graph = ui.normalizeGraph(detailGraphFixture());
  const first = layoutApi.semanticLayout(graph, { positions: {} });
  const second = layoutApi.semanticLayout(graph, { positions: {} });
  assert.deepEqual(first.positions, second.positions);
  assert.deepEqual(first.plan.guideRoutes, second.plan.guideRoutes);
});

test("미확정·고립 보안 정보는 의미별로 묶이고 주 흐름 정렬과 분리됨", async () => {
  const { ui, layoutApi } = loadUi();
  const baseline = layoutApi.semanticLayout(ui.normalizeGraph(detailGraphFixture()), { positions: {} });
  const graph = detailGraphFixture();
  const addNode = (id, attributes) => graph.nodes.push({ id, type: "SECURITY_DATA", serviceId: "orders",
    label: id, attributes, evidenceIds: [`evidence-${id}`] });
  addNode("unowned", { apiType: "PRINCIPAL", operation: "READ", principalType: "USER" });
  addNode("unresolved-principal-a", { apiType: "PRINCIPAL", operation: "READ", principalType: "USER" });
  addNode("unresolved-principal-b", { apiType: "PRINCIPAL", operation: "READ", principalType: "USER" });
  Array.from({ length: 8 }, (_, index) => addNode(`isolated-data-${index}`, {
    apiType: "NIMBUS_CLAIMS_BUILDER", operation: "WRITE", sourceKind: "JWT"
  }));
  graph.edges.push({ id: "unresolved-principal-edge", sourceId: "unresolved-principal-a",
    targetId: "unresolved-principal-b", type: "READS_SECURITY_DATA", attributes: {}, confidence: "CONFIRMED",
    evidenceIds: ["unresolved-principal-evidence"] },
  { id: "unresolved-handler-edge", sourceId: "unresolved-principal-a", targetId: "handler-a",
    type: "READS_SECURITY_DATA", attributes: {}, confidence: "PARTIAL", evidenceIds: ["uncertain-evidence"] },
  ...Array.from({ length: 7 }, (_, index) => ({
    id: `isolated-data-edge-${index}`, sourceId: `isolated-data-${index}`,
    targetId: `isolated-data-${index + 1}`, type: "READS_SECURITY_DATA", attributes: {},
    confidence: "CONFIRMED", evidenceIds: [`isolated-evidence-${index}`]
  })));
  const layout = layoutApi.semanticLayout(ui.normalizeGraph(graph), { positions: {} });
  const plan = layout.plan;
  const unownedCard = compositeCardForNode(plan, "unowned", "SECURITY_DATA");
  const unownedItem = compositeItemForNode(plan, "unowned", "isolated");
  assert.equal(unownedCard.rowId, "isolated");
  assert.deepEqual(Array.from(unownedItem.originalNodeIds), ["unowned"]);
  const unresolvedItem = compositeItemForNode(plan, "unresolved-principal-a", "unresolved");
  assert.deepEqual(new Set(unresolvedItem.originalNodeIds),
    new Set(["unresolved-principal-a", "unresolved-principal-b"]));
  const isolatedCard = compositeCardForNode(plan, "isolated-data-0", "SECURITY_DATA");
  const isolatedItem = compositeItemForNode(plan, "isolated-data-0", "isolated");
  assert.equal(isolatedCard.rowId, "isolated");
  assert.deepEqual(new Set(isolatedItem.originalNodeIds), new Set(Array.from({ length: 8 }, (_, index) => `isolated-data-${index}`)));
  assert.ok(isolatedItem.originalEdgeIds.includes("isolated-data-edge-0"));
  assert.ok(layout.plan.displayModel.edgeToDisplay["isolated-data-edge-0"]);
  const internalEdgeInstance = layout.plan.displayModel.displayEdgeInstances
    .find((edge) => edge.originalEdgeIds.includes("isolated-data-edge-0"));
  assert.equal(internalEdgeInstance.selfConnection, true);
  assert.ok(layout.plan.displayModel.originalEdgeToInstanceIds["isolated-data-edge-0"]
    .includes(internalEdgeInstance.id));
  assert.equal(layout.plan.displayModel.edges.some((edge) => edge.sourceId === edge.targetId), false);
  const lane = layout.plan.lanes.find((item) => item.id === "security-checks");
  assert.equal(lane.nodeIds.includes("unowned"), true);
  assert.equal(layout.plan.supportAnchors.unowned.status, "UNKNOWN");
  assert.ok(unownedCard.bounds.x >= lane.bounds.left
    && unownedCard.bounds.x + unownedCard.bounds.width <= lane.bounds.right);
  const mainBottom = Math.max(...Object.values(layout.plan.sectionAlignment)
    .filter((section) => section && section.nodeIds && section.nodeIds.length)
    .map((section) => section.top + section.height));
  assert.ok([unownedCard, isolatedCard].every((card) => card.bounds.y > mainBottom));
  assert.equal(layout.plan.sectionAlignment.securityChecks.nodeIds.includes("unowned"), false);
  const baselineCard = compositeCardForNode(baseline.plan, "security-data-a", "SECURITY_DATA");
  const currentCard = compositeCardForNode(plan, "security-data-a", "SECURITY_DATA");
  assert.equal(currentCard.position.x, baselineCard.position.x);
  assert.equal(currentCard.position.y, baselineCard.position.y,
    "고립·미확정 노드가 기존 Chain 표시 좌표를 바꾸지 않아야 함");
  const rows = plan.hiddenGroups.filter((row) => row.id !== "detail");
  const rowById = new Map(rows.map((row) => [row.id, row]));
  rows.slice(1).forEach((row, index) => {
    assert.ok(rows[index].rowBottom + plan.chainGap <= row.rowTop,
      `${rows[index].id}와 ${row.id}가 겹침`);
  });
  plan.displayModel.instances.filter((instance) => rowById.has(instance.rowId)).forEach((instance) => {
    const row = rowById.get(instance.rowId);
    const padding = plan.routing.nodeSafeMargin;
    assert.ok(instance.position.y >= row.rowTop + padding);
    assert.ok(instance.position.y + instance.position.height <= row.rowBottom - padding);
  });
  ["chain-a", "endpoint-a", "handler-a"].forEach((id) => {
    assert.equal(layout.positions[id].x, baseline.positions[id].x, `${id} 기존 X 좌표 보존`);
    assert.equal(layout.positions[id].y, baseline.positions[id].y, `${id} 기존 Y 좌표 보존`);
  });

  ui.state.includeUnconnectedNodes = true;
  ui.renderGraph(graph);
  await ui.layoutGraph();
  const checkArea = ui.state.graphRender.areas.find((area) => area.id === "security-checks");
  assert.equal(checkArea.bounds.length, 1);
  [unownedCard, isolatedCard, compositeCardForNode(plan, "unresolved-principal-a", "SECURITY_DATA")].forEach((card) => {
    const position = card.bounds;
    const bounds = checkArea.bounds[0];
    assert.ok(position.x >= bounds.left && position.x + position.width <= bounds.right);
    assert.ok(position.y >= bounds.top && position.y + position.height <= bounds.bottom,
      `${card.rowId} ${JSON.stringify({ position, bounds })}`);
  });
});

test("보안 정보 의미 분류가 실제 수집기 동작을 구분함", () => {
  const { ui, layoutApi } = loadUi();
  const graph = flowGraphFixture();
  const examples = [
    ["auth-status", { apiType: "SESSION", operation: "AUTH_STATUS" }, "AUTH_STATUS:AUTH_STATUS"],
    ["principal-jwt", { apiType: "PRINCIPAL", sourceKind: "JWT", observationKind: "SUBJECT_LOOKUP",
      operation: "READ", principalType: "JWT" }, "PRINCIPAL:READ"],
    ["jwt-claim-write", { apiType: "NIMBUS_CLAIMS_BUILDER", operation: "WRITE" }, "JWT_CLAIM:WRITE"],
    ["jwt-claim-read", { apiType: "NIMBUS_CLAIMS_SET", operation: "READ", claimName: "sub" }, "JWT_CLAIM:READ"],
    ["jwt-claims-map-read", { apiType: "NIMBUS_CLAIMS_SET", operation: "READ" }, "JWT:READ"],
    ["jwt-read", { apiType: "SPRING_SECURITY_JWT", operation: "READ" }, "JWT:READ"],
    ["jwt-sign", { apiType: "NIMBUS_SIGNED_JWT", operation: "SIGN" }, "JWT:SIGN"],
    ["jwt-verify", { apiType: "NIMBUS_SIGNED_JWT", operation: "VERIFY", verificationKind: "INVOCATION" }, "JWT:VERIFY"],
    ["jwt-verify-config", { apiType: "SPRING_SECURITY_NIMBUS_DECODER", operation: "VERIFY_CONFIGURATION",
      verificationKind: "CONFIGURATION" }, "JWT:VERIFY_CONFIGURATION"],
    ["session-acquire", { apiType: "SESSION", operation: "ACQUIRE" }, "SESSION:ACQUIRE"],
    ["session-read", { apiType: "SESSION", operation: "READ" }, "SESSION:READ"],
    ["session-write", { apiType: "SESSION", operation: "WRITE" }, "SESSION:WRITE"],
    ["session-remove", { apiType: "SESSION", operation: "REMOVE" }, "SESSION:REMOVE"],
    ["session-invalidate", { apiType: "SESSION", operation: "INVALIDATE" }, "SESSION:INVALIDATE"],
    ["authority-create", { apiType: "AUTHORITY", operation: "CREATE" }, "AUTHORITY:CREATE"],
    ["authority-read", { apiType: "AUTHORITY", operation: "READ" }, "AUTHORITY:READ"],
    ["authority-convert", { apiType: "AUTHORITY", operation: "CONVERT" }, "AUTHORITY:CONVERT"],
    ["header-read", { apiType: "HEADER", operation: "READ", headerName: "Authorization" }, "HEADER:READ"]
  ];
  examples.forEach(([id, attributes]) => {
    graph.nodes.push({ id, type: "SECURITY_DATA", serviceId: "orders", label: id, attributes,
      evidenceIds: [`evidence-${id}`] });
    graph.edges.push({ id: `edge-${id}`, sourceId: "handler-a", targetId: id, type: "SECURED_BY",
      attributes: {}, confidence: "CONFIRMED", evidenceIds: [`evidence-edge-${id}`] });
  });
  const layout = layoutApi.semanticLayout(ui.normalizeGraph(graph), { positions: {} });
  const actualKeys = new Set(layout.plan.displayModel.groups.filter((group) => group.type === "SECURITY_DATA")
    .map((group) => group.semanticKey));
  examples.forEach(([, , expected]) => assert.ok(actualKeys.has(expected), `누락된 의미 분류: ${expected}`));
});

test("인가 의미 분류는 URL·Method·객체 근거를 각각 구분함", () => {
  const { layoutApi } = loadUi();
  const classify = (attributes) => layoutApi.supportDisplaySemantic({ type: "AUTHORIZATION", attributes });
  assert.equal(classify({ policySource: "URL", policyKind: "PERMIT_ALL" }).key, "URL:PERMIT_ALL");
  assert.equal(classify({ policySource: "URL", requiredAuthority: "ROLE_ADMIN" }).key,
    "URL:AUTHORITY_REQUIRED");
  assert.equal(classify({ policySource: "METHOD", annotationType: "PreAuthorize",
    declarationKind: "ANNOTATION", requiredAuthority: "ROLE_ADMIN" }).key, "METHOD:DECLARATION");
  assert.equal(classify({ factType: "OBJECT_AUTHORIZATION_REQUIREMENT", resourceType: "Order" }).key,
    "OBJECT:REQUIREMENT");
  assert.equal(classify({ factType: "OBJECT_ACCESS_PATH", resourceType: "Order", coverage: "COMPLETE_SUPPORTED_PATH" }).key,
    "OBJECT:ACCESS_PATH");
});

test("API 선택은 실제 상세 Graph의 Handler와 보안 근거를 함께 강조함", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(detailGraphFixture());
  await ui.layoutGraph();
  ui.selectGraphElement("node", "endpoint-a");
  const plan = ui.state.layout.plan.overviewRouting;
  const mapping = plan.relations.find((relation) => relation.role === "API_MAPPING"
    && relation.relatedNodeIds.includes("endpoint-a"));
  assert.ok(mapping, "선택 Endpoint의 실제 Handler 매핑 누락");
  const mappingSegmentIds = new Set(plan.routesByRelationId[mapping.id].orderedSegmentIds);
  const mappingSegments = findAllByClass(elements.get("graph-edges"), "graph-overview-segment")
    .filter((path) => mappingSegmentIds.has(path.getAttribute("data-segment-id")));
  assert.ok(mappingSegments.length > 0);
  assert.ok(mappingSegments.every((path) => path.attributes["data-related"] === "true"));
  const securedEdge = () => findAllByClass(elements.get("graph-edges"), "graph-edge")
    .find((edge) => (edge.attributes["data-edge-ids"] || "").split(",").includes("secured-a"));
  assert.ok(securedEdge());
  assert.equal(securedEdge().attributes["data-related"], "true");
  ui.selectGraphElement("node", "authorization-a");
  assert.equal(securedEdge().attributes["data-related"], "true");
});

test("같은 Controller의 두 번째 API 선택도 공유 처리 경로를 강조함", async () => {
  const { ui, elements } = loadUi();
  const graph = detailGraphFixture();
  graph.nodes.push(
    { id: "handler-a2", type: "HANDLER", serviceId: "orders", label: "OrderController#other", attributes: { handler: "OrderController#other" }, evidenceIds: [] },
    { id: "endpoint-a2", type: "ENDPOINT", serviceId: "orders", label: "GET /other", attributes: { httpMethod: "GET", path: "/other", handler: "OrderController#other" }, evidenceIds: [] }
  );
  graph.edges.push({ id: "handler-map-a2", sourceId: "endpoint-a2", targetId: "handler-a2", type: "FLOWS_TO",
    confidence: "CONFIRMED", attributes: {}, evidenceIds: [] });
  ui.state.includeUnconnectedNodes = true;
  ui.renderGraph(graph);
  await ui.layoutGraph();
  ui.selectGraphElement("node", "endpoint-a2");
  const plan = ui.state.layout.plan.overviewRouting;
  const selected = plan.relations.find((relation) => relation.role === "API_MAPPING"
    && relation.relatedNodeIds.includes("endpoint-a2"));
  const other = plan.relations.find((relation) => relation.role === "API_MAPPING"
    && relation.relatedNodeIds.includes("endpoint-a"));
  assert.ok(selected);
  assert.ok(other);
  const paths = findAllByClass(elements.get("graph-edges"), "graph-overview-segment");
  const routeSegments = (relation) => new Set(plan.routesByRelationId[relation.id].orderedSegmentIds);
  assert.ok(paths.some((path) => routeSegments(selected).has(path.getAttribute("data-segment-id"))
    && path.attributes["data-related"] === "true"));
  assert.ok(paths.some((path) => routeSegments(other).has(path.getAttribute("data-segment-id"))
    && path.attributes["data-related"] === "false"));
});

test("기능별 상세는 중복 원본 Edge를 한 관계와 공통 Segment로 통합함", async () => {
  const { ui, elements } = loadUi();
  const graph = detailGraphFixture();
  graph.edges.push({ ...graph.edges.find((edge) => edge.id === "secured-a"), id: "secured-a-second", evidenceIds: ["other-evidence"] });
  ui.renderGraph(graph);
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();
  const edges = findAllByClass(elements.get("graph-edges"), "graph-edge");
  const shared = edges.find((edge) => ["secured-a", "secured-a-second"].every((id) =>
    (edge.getAttribute("data-edge-ids") || edge.getAttribute("data-edge-id") || "").split(",").includes(id)));
  assert.ok(shared, "같은 물리 경로에 두 원본 Edge ID가 유지됨");
  const relations = ui.state.layout.plan.overviewRouting.relations
    .filter((relation) => relation.originalEdgeIds.some((id) => ["secured-a", "secured-a-second"].includes(id)));
  assert.equal(relations.length, 1, "동일한 의미·방향의 원본 Edge를 단일 표시 관계로 정규화함");
  assert.deepEqual(Array.from(relations[0].evidenceIds).sort(), ["evidence-secured-a", "other-evidence"].sort());
});

test("Chain 그룹과 기술 영역은 실제 Node 범위와 동적 여백으로 분리됨", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(laneGraphFixture());
  const layout = await ui.layoutGraph();
  const rows = layout.plan.hiddenGroups.filter((row) => row.id.startsWith("chain:"));
  for (let index = 1; index < rows.length; index += 1) {
    assert.ok(rows[index].rowTop >= rows[index - 1].rowBottom, "Chain 행이 서로 겹치지 않음");
  }
  const cards = layout.plan.displayModel.composites;
  rows.forEach((row) => cards.filter((card) => card.rowId === row.id).forEach((card) => {
    assert.ok(card.bounds.y >= row.rowTop && card.bounds.y + card.bounds.height <= row.rowBottom,
      `${card.kind} 복합 카드가 Chain 행 안에 있음`);
  }));
  const areas = new Map(elements.get("graph-areas").children.map((group) => [group.getAttribute("data-area-id"),
    group.children.find((child) => child.attributes.class === "graph-area-box")]));
  cards.forEach((card) => {
    const area = areas.get(card.areaId);
    assert.ok(area, `${card.areaId} 기술 영역 표시`);
    assert.ok(Number(area.attributes.x) <= card.bounds.x
      && Number(area.attributes.x) + Number(area.attributes.width) >= card.bounds.x + card.bounds.width);
  });
});

test("Mini Map은 실제 표시 Node와 교육용 Projection Node를 함께 갱신함", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(laneGraphFixture());
  await ui.layoutGraph();
  const minimap = elements.get("graph-minimap-nodes").children;
  const projectionKinds = new Set(["education"]);
  assert.equal(minimap.filter((node) => projectionKinds.has(node.attributes["data-node-kind"])).length,
    ui.state.layout.plan.projection.nodes.length);
  assert.equal(minimap.filter((node) => !projectionKinds.has(node.attributes["data-node-kind"])).length,
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

test("Finding API 범위는 명시적 Endpoint–Handler 관계와 실제 근거로만 결정함", () => {
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  const endpoint = snapshot.nodes.find((node) => node.id === "node-2");
  endpoint.attributes.handler = "org.example.Controller#one()";
  endpoint.evidenceIds = ["endpoint-evidence"];
  const handler = snapshot.nodes.find((node) => node.id === "node-3");
  handler.attributes.handler = endpoint.attributes.handler;
  snapshot.edges.push({ id: "endpoint-handler-one", sourceId: endpoint.id, targetId: handler.id,
    type: "FLOWS_TO", attributes: { flowKind: "HANDLER" }, confidence: "CONFIRMED", evidenceIds: ["endpoint-evidence"] });
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
  const overlap = (a, b) => a.x < b.x + 260 && a.x + 260 > b.x && a.y < b.y + 120 && a.y + 120 > b.y;
  for (const [index, position] of education.entries()) {
    assert.equal(cards.some((card) => overlap(position, card)), false, `실제 카드와 충돌: ${index}`);
    assert.equal(education.slice(index + 1).some((card) => overlap(position, card)), false, `교육 카드와 충돌: ${index}`);
  }
});

test("빈 Graph부터 다수 Endpoint까지 교육 카드의 실제 표시 Bounds가 겹치지 않음", () => {
  const { layoutApi, ui } = loadUi();
  const toRect = (position, width = 260, height = 120) => ({
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
      const sourceHeight = source ? source.height : 120;
      const targetHeight = target ? target.height : 120;
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
      assert.ok(section.bounds.bottom >= Math.max(...related.map((position) => position.y + 120)) + 24);
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
  snapshot.evidenceDisplayCodes = { "finding-evidence": "EP-FINDING-001" };
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

  elements.get("settings-button").dispatchEvent({ type: "click" });
  elements.get("finding-modal").dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(section.focused, true);
  assert.equal(elements.get("finding-modal").hidden, true);
  assert.equal(elements.get("settings-panel").dataset.open, "true");
  elements.get("settings-button").dispatchEvent({ type: "click" });
  elements.get("settings-panel").dispatchEvent({ type: "transitionend", propertyName: "transform" });
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
    ? a.x > p.x && a.x < p.x + 260 && Math.max(a.y, b.y) > p.y && Math.min(a.y, b.y) < p.y + 120
    : a.y === b.y && a.y > p.y && a.y < p.y + 120 && Math.max(a.x, b.x) > p.x && Math.min(a.x, b.x) < p.x + 260;
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
        if (id !== edge.sourceId && id !== edge.targetId) assert.equal(intersects(previous, point, position), false,
          `${edge.id}: ${id} ${route.d} ${JSON.stringify(position)}`);
      }
      previous = point;
    }
  }
  }
});

test("객체 인가 Finding은 명시적 Endpoint–Handler 관계로 연결하고 복수 등록 근거는 제외함", () => {
  const { ui, elements } = loadUi();
  const snapshot = graphFixture();
  const endpoint = snapshot.nodes.find((node) => node.id === "node-2");
  endpoint.attributes.handler = "org.sample.Controller#load()";
  endpoint.evidenceIds = ["shared"];
  snapshot.nodes.push({ id: "ambiguous-endpoint", type: "ENDPOINT", label: endpoint.label, attributes: { ...endpoint.attributes }, evidenceIds: ["shared"] });
  snapshot.nodes.push({ id: "object-path", type: "AUTHORIZATION", label: "object-path", attributes: { factType: "OBJECT_ACCESS_PATH", handler: "org.sample.Other#load()" }, evidenceIds: ["object-evidence"] });
  snapshot.nodes.push({ id: "object-endpoint", type: "ENDPOINT", label: "GET /objects", attributes: { httpMethod: "GET", path: "/objects", handler: "org.sample.Other#load()" }, evidenceIds: [] });
  snapshot.nodes.push(
    { id: "handler-shared", type: "HANDLER", label: endpoint.attributes.handler, attributes: { handler: endpoint.attributes.handler }, evidenceIds: [] },
    { id: "handler-other", type: "HANDLER", label: "org.sample.Other#load()", attributes: { handler: "org.sample.Other#load()" }, evidenceIds: [] }
  );
  snapshot.edges.push(
    { id: "mapping-main-shared", sourceId: endpoint.id, targetId: "handler-shared", type: "FLOWS_TO", attributes: {}, confidence: "CONFIRMED", evidenceIds: ["shared"] },
    { id: "mapping-ambiguous-shared", sourceId: "ambiguous-endpoint", targetId: "handler-shared", type: "FLOWS_TO", attributes: {}, confidence: "CONFIRMED", evidenceIds: ["shared"] },
    { id: "mapping-object", sourceId: "object-endpoint", targetId: "handler-other", type: "FLOWS_TO", attributes: {}, confidence: "CONFIRMED", evidenceIds: ["object-endpoint-evidence"] }
  );
  snapshot.evidence = [
    { id: "shared", source: "RUNTIME", location: `mapping:${endpoint.attributes.handler}`, summary: `등록 Endpoint: ${endpoint.attributes.httpMethod} ${endpoint.attributes.path}` },
    { id: "object-evidence" }, { id: "object-endpoint-evidence", source: "RUNTIME", location: "mapping:object-endpoint", summary: "등록 Endpoint" }
  ];
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

test("상세 취약점 MAP은 Endpoint Graph와 Runtime Blueprint를 같은 Renderer에서 표시함", async () => {
  const { ui, elements, window } = loadUi();
  const snapshot = detailGraphFixture();
  snapshot.findings = [{ id: "endpoint-flow-finding", ruleId: "PUBLIC_ENDPOINT", title: "API 판단", confidence: "LIKELY", nodeIds: ["endpoint-a"], edgeIds: [], evidenceIds: [], guide: "점검" }];
  snapshot.runtimeArchitecture = {
    environment: { webApplicationType: "SERVLET", serverKind: "TOMCAT", deploymentMode: "EMBEDDED" },
    components: [{ id: "runtime-mapping", kind: "HANDLER_MAPPING", className: "org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping",
      beanName: "requestMappingHandlerMapping", contextId: "app", parentId: null, attributes: {}, graphNodeIds: ["endpoint-a"], evidenceIds: [] }],
    relationships: [], coverage: [
      { area: "WEB_SERVER", state: "PRESENT" }, { area: "SERVLET", state: "PRESENT" },
      { area: "SECURITY", state: "PRESENT" }, { area: "MVC", state: "PRESENT" }
    ], evidence: [], architectureFingerprint: "finding-runtime"
  };
  const original = JSON.stringify(snapshot);
  const expected = window.MapInBootFlow.deriveEndpointGraph(window.MapInBootGraph.normalize(snapshot), "endpoint-a");
  ui.renderGraph(snapshot);
  ui.selectView("security-flow");

  const marker = findAllByClass(elements.get("graph-nodes"), "finding-marker")[0];
  marker.dispatchEvent({ type: "click" });
  await ui.layoutGraph();
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
  assert.ok(ui.state.layout.plan.detailBlueprint.cards.some((card) => card.runtimeComponentIds.includes("runtime-mapping")));
  assert.ok(findAllByClass(elements.get("graph-nodes"), "graph-composite-card").length > 0);
  assert.equal(findAllByClass(elements.get("graph-nodes"), "runtime-blueprint-card").length, 0);
  assert.equal(JSON.stringify(snapshot), original);
});

test("Finding 영향 섹션은 실제 참조만 감싸고 별도 Modal을 키보드로 열고 닫음", async () => {
  const { ui, elements, layoutCalls } = loadUi();
  const snapshot = detailGraphFixture();
  snapshot.evidence = [{ id: "finding-evidence", source: "STATIC", location: "OrderController#list", summary: "인가 관계 확인" }];
  snapshot.evidenceDisplayCodes = { "finding-evidence": "EP-FINDING-001" };
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
  assert.match(textOf(elements.get("finding-modal-content")), /EP-FINDING-001/);
  assert.match(textOf(elements.get("finding-modal-content")), /출처 확인 불가/);
  assert.doesNotMatch(textOf(elements.get("finding-modal-content")), /finding-evidence|STATIC/);
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

test("Finding 상세 Modal은 한국어 진단 유형·상태와 실제 정보 순서를 표시함", () => {
  const { ui, elements } = loadUi();
  const snapshot = detailGraphFixture();
  const finding = {
    id: "finding-modal-order",
    ruleId: "OBJECT_BINDING",
    title: "다른 계정 주문 조회 차단",
    description: "요청 계정과 주문 소유자가 다르면 조회를 거부함.",
    confidence: "CONFIRMED",
    nodeIds: ["endpoint-a", "authorization-a"],
    edgeIds: ["secured-a"],
    evidenceIds: ["finding-evidence"],
    guide: "요청자 ID와 주문 소유자 ID 비교 확인"
  };
  const entry = { finding, nodeIds: finding.nodeIds, edgeIds: finding.edgeIds, missing: false, unlocated: false };
  snapshot.evidence = [{ id: "finding-evidence", source: "STATIC", location: "OrderController#list", summary: "인가 비교 확인" }];
  snapshot.evidenceDisplayCodes = { "finding-evidence": "EP-FINDING-001" };

  ui.inspector.renderFindingModal({
    graph: snapshot,
    snapshot,
    entry,
    apiLabel: "GET /orders/{orderId}",
    nodeIds: [],
    edgeIds: [],
    onOpenEndpoint: () => {}
  });

  const modal = elements.get("finding-modal");
  const confidence = elements.get("finding-modal-confidence");
  const rule = elements.get("finding-modal-rule");
  assert.ok(confidence);
  assert.equal(confidence.textContent, "확정");
  assert.equal(confidence.attributes["data-confidence"], "CONFIRMED");
  assert.ok(rule);
  assert.equal(rule.textContent, "진단 유형 · 인증 주체와 대상 객체 권한 검증 문제");
  assert.equal(elements.get("finding-modal-title").textContent, finding.title);
  [
    ["CONFIRMED", "확정"],
    ["LIKELY", "검토 필요"],
    ["UNKNOWN", "판단 불가"],
    ["PARTIAL", "부분 분석"],
    [undefined, "판단 불가"]
  ].forEach(([value, expected]) => {
    entry.finding.confidence = value;
    ui.inspector.renderFindingModal({ graph: snapshot, snapshot, entry, apiLabel: "GET /orders/{orderId}" });
    assert.equal(confidence.textContent, expected);
  });
  entry.finding.confidence = "CONFIRMED";
  ui.inspector.renderFindingModal({ graph: snapshot, snapshot, entry, apiLabel: "GET /orders/{orderId}" });

  const content = elements.get("finding-modal-content");
  assert.deepEqual(findAllByClass(content, "inspector-section-title").map((item) => item.textContent), [
    "대상 API", "판단 내용", "근거", "점검 가이드", "관련 Graph"
  ]);
  assert.match(textOf(content), /GET \/orders\/\{orderId\}/);
  assert.match(textOf(content), /요청 계정과 주문 소유자가 다르면 조회를 거부함\./);
  assert.match(textOf(content), /EP-FINDING-001/);
  assert.match(textOf(content), /인가 비교 확인/);
  assert.match(textOf(content), /요청자 ID와 주문 소유자 ID 비교 확인/);
  finding.evidenceIds = ["finding-evidence", "finding-evidence-second"];
  snapshot.evidence.push({ id: "finding-evidence-second", source: "RUNTIME", location: "OrderService#load", summary: "소유자 조건 적용" });
  snapshot.evidenceDisplayCodes["finding-evidence-second"] = "EP-FINDING-002";
  ui.inspector.renderFindingModal({ graph: snapshot, snapshot, entry, apiLabel: "GET /orders/{orderId}" });
  assert.equal(findAllByClass(content, "inspector-evidence").length, 2);
  assert.match(textOf(content), /EP-FINDING-002/);
  finding.evidenceIds = [];
  ui.inspector.renderFindingModal({ graph: snapshot, snapshot, entry, apiLabel: "GET /orders/{orderId}" });
  assert.equal(findAllByClass(content, "inspector-evidence").length, 0);
  assert.match(textOf(content), /연결된 근거가 없습니다\./);
  finding.evidenceIds = ["finding-evidence"];
  ui.inspector.renderFindingModal({ graph: snapshot, snapshot, entry, apiLabel: "GET /orders/{orderId}" });
  const nodeRefs = findAllByClass(content, "inspector-link")
    .map((item) => item.attributes["data-node-id"])
    .filter(Boolean);
  assert.ok(nodeRefs.includes("endpoint-a"));
  assert.ok(nodeRefs.includes("authorization-a"));
  const edgeRefs = findAllByClass(content, "inspector-link")
    .map((item) => item.attributes["data-edge-id"])
    .filter(Boolean);
  assert.deepEqual(edgeRefs, ["secured-a"]);

  ui.inspector.renderFindingModal({ graph: null, snapshot, entry: null, apiLabel: "" });
  assert.equal(elements.get("finding-modal-title").textContent, "Finding 선택 필요");
  assert.equal(confidence.textContent, "판단 불가");
  assert.equal(confidence.attributes["data-confidence"], "UNKNOWN");
  assert.equal(rule.textContent, "진단 유형 확인 불가");
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

test("Node·Edge·Finding 근거는 저장 표시 코드만 노출하고 원본 Evidence ID는 숨김", async () => {
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
  assert.doesNotMatch(textOf(nodeCard), new RegExp(originalId));
  assert.equal(findAllByClass(nodeCard, "inspector-evidence-original").length, 0);
  assert.equal(findAllByClass(nodeCard, "inspector-evidence-toggle").length, 0);
  assert.equal(findAllByClass(nodeCard, "inspector-evidence-copy-id").length, 0);
  findAllByClass(nodeCard, "inspector-evidence-copy-code")[0].dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(copied, ["EP-MAPPING-001"]);
  assert.equal(elements.get("shell-notice").textContent, "표시 ID를 복사했습니다.");

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
  assert.doesNotMatch(textOf(cards[2]), /legacy-evidence/);
  assert.equal(findAllByClass(cards[2], "inspector-evidence-toggle").length, 0);
  assert.equal(findAllByClass(cards[2], "inspector-evidence-copy-id").length, 0);
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

test("전체 Snapshot 기준 Node·Edge 표시 코드는 유형별 정렬에 고정됨", () => {
  const { window } = loadUi();
  const nodeTypes = [
    ["app", "APPLICATION"], ["servlet", "SERVLET"], ["endpoint-a", "ENDPOINT"],
    ["endpoint-b", "ENDPOINT"], ["handler", "HANDLER"], ["chain", "SECURITY_CHAIN"],
    ["security-filter", "FILTER", { registrationKind: "SECURITY" }],
    ["servlet-filter", "FILTER", { registrationKind: "SERVLET" }],
    ["unknown-filter", "FILTER", {}], ["authentication", "AUTHENTICATION"],
    ["authorization", "AUTHORIZATION"], ["security-data", "SECURITY_DATA"],
    ["state", "BUSINESS_SECURITY_STATE"], ["unknown-node", "FUTURE_NODE"]
  ];
  const edgeTypes = [
    ["flow", "FLOWS_TO"], ["matched", "MATCHED_BY"], ["filtered", "FILTERED_BY"],
    ["secured", "SECURED_BY"], ["reads", "READS_SECURITY_DATA"],
    ["writes", "WRITES_SECURITY_DATA"], ["authority", "CONVERTS_TO_AUTHORITY"],
    ["authz", "USES_FOR_AUTHORIZATION"], ["state-edge", "SECURITY_STATE"],
    ["unknown-edge", "FUTURE_EDGE"]
  ];
  const snapshot = {
    nodes: nodeTypes.map(([id, type, attributes = {}]) => ({ id, type, attributes })),
    edges: edgeTypes.map(([id, type]) => ({ id, type }))
  };
  const displayIds = window.MapInBootGraph.createDisplayIds(snapshot);
  const expectedNodes = {
    app: "AP-SERVICE-001",
    servlet: "SV-SERVLET-001",
    "endpoint-a": "EP-MAPPING-001",
    "endpoint-b": "EP-MAPPING-002",
    handler: "EP-HANDLER-001",
    chain: "SC-CHAIN-001",
    "security-filter": "SF-FILTER-001",
    "servlet-filter": "SV-FILTER-001",
    "unknown-filter": "FL-FILTER-001",
    authentication: "SC-AUTHN-001",
    authorization: "SC-AUTH-001",
    "security-data": "SD-DATA-001",
    state: "BS-STATE-001",
    "unknown-node": "ND-UNKNOWN-001"
  };
  const expectedEdges = {
    flow: "RL-FLOW-001",
    matched: "RL-MATCH-001",
    filtered: "RL-FILTER-001",
    secured: "RL-SECURITY-001",
    reads: "RL-READ-001",
    writes: "RL-WRITE-001",
    authority: "RL-AUTHORITY-001",
    authz: "RL-AUTHZ-001",
    "state-edge": "RL-STATE-001",
    "unknown-edge": "RL-UNKNOWN-001"
  };
  Object.entries(expectedNodes).forEach(([id, code]) => assert.equal(displayIds.node(id), code));
  Object.entries(expectedEdges).forEach(([id, code]) => assert.equal(displayIds.edge(id), code));
  assert.equal(displayIds.node("missing"), "노드 확인 불가");
  assert.equal(displayIds.edge("missing"), "관계 확인 불가");

  const reversed = window.MapInBootGraph.createDisplayIds({
    nodes: [...snapshot.nodes].reverse(),
    edges: [...snapshot.edges].reverse()
  });
  Object.keys(expectedNodes).forEach((id) => assert.equal(reversed.node(id), displayIds.node(id)));
  Object.keys(expectedEdges).forEach((id) => assert.equal(reversed.edge(id), displayIds.edge(id)));
  assert.equal(new Set([...Object.values(expectedNodes), ...Object.values(expectedEdges)]).size,
    Object.keys(expectedNodes).length + Object.keys(expectedEdges).length);
});

test("Inspector는 Endpoint·보안 정책 핵심 정보를 한 번씩 표시하고 속성명을 한국어로 변환함", () => {
  const { ui, elements, window } = loadUi();
  const endpointHandler = "com.example.orders.OrderController#getSubscriptions(java.lang.String, java.lang.Long)";
  const snapshot = {
    nodes: [
      { id: "endpoint", type: "ENDPOINT", serviceId: "account-service", label: "GET /api/admin/subscriptions", attributes: {
        httpMethod: "GET", path: "/api/admin/subscriptions", handler: endpointHandler,
        handlerMapping: "requestMappingHandlerMapping", mvcPathPatternSettings: "DEFAULT"
      }, evidenceIds: [] },
      { id: "chain", type: "SECURITY_CHAIN", serviceId: "account-service", label: "mainSecurityChain", attributes: {
        proxyBeanName: "mainSecurityChain", chainKey: "chain-0", chainOrder: "0",
        matcherType: "METHOD_PATH", matcherCondition: "PATH /api/**", pathPatternSettings: "DEFAULT"
      }, evidenceIds: [] },
      { id: "authorization", type: "AUTHORIZATION", serviceId: "account-service", label: "인가", attributes: {
        factType: "URL_AUTHORIZATION", policyKind: "AUTHORITY_REQUIRED", securityKind: "AUTHORIZATION",
        policySource: "URL", policyMatcherType: "METHOD_PATH", policyMatcherCondition: "ANY",
        policyOrder: "2", requiredAuthority: "ROLE_BANK_ADMIN"
      }, evidenceIds: [] },
      { id: "security-filter", type: "FILTER", serviceId: "account-service", label: "BearerTokenAuthenticationFilter", attributes: {
        registrationKind: "SECURITY", filterClass: "org.springframework.security.web.authentication.BearerTokenAuthenticationFilter",
        filterOrder: "3", filterRole: "AUTHENTICATION_PROVIDER", filterChainContinuation: "AFTER_AUTHENTICATION"
      }, evidenceIds: [] }
    ],
    edges: [{ id: "edge", sourceId: "chain", targetId: "endpoint", type: "FILTERED_BY", attributes: {}, confidence: "CONFIRMED", evidenceIds: [] }],
    findings: [],
    evidence: []
  };
  ui.renderGraph(snapshot);
  const graph = window.MapInBootGraph.normalize(snapshot);
  const displayIds = window.MapInBootGraph.createDisplayIds(graph);
  const renderNode = (id) => ui.inspector.render({
    graph, visibleGraph: graph, snapshot, selection: { kind: "node", id }, displayIds
  });

  renderNode("endpoint");
  let inspectorText = textOf(elements.get("inspector"));
  assert.equal(inspectorText.split("GET /api/admin/subscriptions").length - 1, 1);
  assert.equal(inspectorText.split(endpointHandler).length - 1, 1);
  assert.match(inspectorText, /EP-MAPPING-001/);
  assert.match(inspectorText, /핸들러 매핑 requestMappingHandlerMapping/);
  assert.match(inspectorText, /MVC 경로 패턴 설정 기본 설정/);
  assert.doesNotMatch(inspectorText, /API GET \/api\/admin\/subscriptions|HTTP Method|mvcPathPatternSettings/);
  assert.doesNotMatch(inspectorText, /추가 속성 없음/);

  renderNode("chain");
  inspectorText = textOf(elements.get("inspector"));
  assert.match(inspectorText, /요청 매칭 조건 PATH \/api\/\*\*/);
  assert.match(inspectorText, /매칭 방식 HTTP 메서드·경로/);
  assert.match(inspectorText, /보안 체인 순서 0/);
  assert.doesNotMatch(inspectorText, /matcherCondition|matcherType|chainOrder|proxyBeanName/);

  renderNode("authorization");
  inspectorText = textOf(elements.get("inspector"));
  assert.match(inspectorText, /권한 필요/);
  assert.match(inspectorText, /정책 출처 URL 인가 정책/);
  assert.match(inspectorText, /정책 매칭 방식 HTTP 메서드·경로/);
  assert.match(inspectorText, /정책 매칭 조건 모든 요청/);
  assert.match(inspectorText, /필요 권한 ROLE_BANK_ADMIN/);
  assert.match(inspectorText, /보안 종류 인가/);
  assert.doesNotMatch(inspectorText, /AUTHORITY_REQUIRED|policyMatcherCondition|policyMatcherType/);

  renderNode("security-filter");
  inspectorText = textOf(elements.get("inspector"));
  assert.match(inspectorText, /SF-FILTER-001/);
  assert.match(inspectorText, /등록 구분 보안/);
  assert.match(inspectorText, /필터 역할 인증 제공 필터/);
  assert.match(inspectorText, /필터 체인 진행 조건 인증 이후/);
  assert.match(inspectorText, /org\.springframework\.security\.web\.authentication\.BearerTokenAuthenticationFilter/);
  assert.doesNotMatch(inspectorText, /registrationKind|filterRole|filterChainContinuation/);

  ui.inspector.render({ graph, visibleGraph: graph, snapshot, selection: { kind: "edge", id: "edge" }, displayIds });
  inspectorText = textOf(elements.get("inspector"));
  assert.match(inspectorText, /RL-FILTER-001/);
  assert.match(inspectorText, /SC-CHAIN-001 → EP-MAPPING-001/);
  assert.doesNotMatch(inspectorText, /출발 Node|도착 Node|나감|들어옴/);
});

test("10개 NodeType Inspector는 대표 정보를 중복하지 않고 원문 식별값을 보존함", () => {
  const { ui, elements, window } = loadUi();
  const handler = "com.example.orders.OrderController#getOrder(java.lang.String, java.lang.Long)";
  const snapshot = {
    nodes: [
      { id: "application", type: "APPLICATION", serviceId: "orders", label: "OrdersApplication", attributes: {}, evidenceIds: [] },
      { id: "servlet", type: "SERVLET", serviceId: "orders", label: "dispatcherServlet", attributes: {
        servletName: "dispatcherServlet", servletClass: "org.springframework.web.servlet.DispatcherServlet",
        servletKind: "DISPATCHER", urlPattern: "/"
      }, evidenceIds: [] },
      { id: "endpoint", type: "ENDPOINT", serviceId: "orders", label: "GET /api/orders/{id}", attributes: {
        httpMethod: "GET", path: "/api/orders/{id}", handler,
        handlerMapping: "requestMappingHandlerMapping", mvcPathPatternSettings: "DEFAULT"
      }, evidenceIds: [] },
      { id: "handler", type: "HANDLER", serviceId: "orders", label: handler, attributes: { handler }, evidenceIds: [] },
      { id: "chain", type: "SECURITY_CHAIN", serviceId: "orders", label: "mainSecurityChain", attributes: {
        proxyBeanName: "mainSecurityChain", matcherType: "METHOD_PATH", matcherCondition: "GET /api/**", chainOrder: "1"
      }, evidenceIds: [] },
      { id: "security-filter", type: "FILTER", serviceId: "orders", label: "AuthenticationFilter", attributes: {
        registrationKind: "SECURITY", filterClass: "org.springframework.security.web.AuthenticationFilter", filterOrder: "2"
      }, evidenceIds: [] },
      { id: "servlet-filter", type: "FILTER", serviceId: "orders", label: "auditFilter", attributes: {
        registrationKind: "SERVLET", registrationName: "auditFilter", filterClass: "com.example.AuditFilter", filterOrder: "3"
      }, evidenceIds: [] },
      { id: "authentication", type: "AUTHENTICATION", serviceId: "orders", label: "인증 처리", attributes: {}, evidenceIds: [] },
      { id: "authorization", type: "AUTHORIZATION", serviceId: "orders", label: "권한 정책", attributes: {
        factType: "URL_AUTHORIZATION", policyKind: "AUTHORITY_REQUIRED", policySource: "URL",
        policyMatcherType: "METHOD_PATH", policyMatcherCondition: "ANY", requiredAuthority: "ROLE_STAFF"
      }, evidenceIds: [] },
      { id: "security-data", type: "SECURITY_DATA", serviceId: "orders", label: "JWT 데이터", attributes: {
        apiType: "SPRING_SECURITY_JWT", apiName: "getClaim", apiOwner: "org.springframework.security.oauth2.jwt.Jwt",
        apiDescriptor: "(Ljava/lang/String;)Ljava/lang/Object;", sourceKind: "JWT", operation: "READ",
        observationKind: "CODE_PATTERN", claimName: "sub", codeLocation: "OrderController#readClaim"
      }, evidenceIds: [] },
      { id: "business-state", type: "BUSINESS_SECURITY_STATE", serviceId: "orders", label: "소유자 상태", attributes: {
        factType: "BUSINESS_SECURITY_STATE", stateName: "OWNER", stateAction: "REQUIRES", handler,
        requirementKey: "owner-check", pathOutcome: "UNGUARDED", coverage: "COMPLETE_SUPPORTED_PATH"
      }, evidenceIds: [] }
    ],
    edges: [], findings: [], evidence: []
  };
  const graph = window.MapInBootGraph.normalize(snapshot);
  const displayIds = window.MapInBootGraph.createDisplayIds(graph);
  const count = (text, value) => text.split(value).length - 1;

  graph.nodes.forEach((node) => {
    ui.inspector.render({ graph, visibleGraph: graph, snapshot, selection: { kind: "node", id: node.id }, displayIds });
    const inspectorText = textOf(elements.get("inspector"));
    assert.equal(findAllByClass(elements.get("inspector"), "inspector-title")[0].textContent.length > 0, true,
      `${node.type} 대표 이름 표시`);
    assert.ok(inspectorText.includes(displayIds.node(node.id)), `${node.type} 표시 ID`);
    assert.doesNotMatch(inspectorText, new RegExp(`(?:^|\\s)${node.id}(?:\\s|$)`), `${node.type} 원본 ID 숨김`);
    assert.doesNotMatch(inspectorText, /Node ID|Service ID|Edge ID|HTTP Method|등록 유형|Filter 순서/);
  });

  ui.inspector.render({ graph, visibleGraph: graph, snapshot, selection: { kind: "node", id: "endpoint" }, displayIds });
  let inspectorText = textOf(elements.get("inspector"));
  assert.equal(count(inspectorText, "GET /api/orders/{id}"), 1);
  assert.equal(count(inspectorText, handler), 1);
  assert.match(inspectorText, /핸들러 매핑 requestMappingHandlerMapping/);

  ui.inspector.render({ graph, visibleGraph: graph, snapshot, selection: { kind: "node", id: "handler" }, displayIds });
  inspectorText = textOf(elements.get("inspector"));
  assert.equal(count(inspectorText, handler), 1);

  ui.inspector.render({ graph, visibleGraph: graph, snapshot, selection: { kind: "node", id: "security-data" }, displayIds });
  inspectorText = textOf(elements.get("inspector"));
  ["Spring Security JWT API", "getClaim", "org.springframework.security.oauth2.jwt.Jwt",
    "(Ljava/lang/String;)Ljava/lang/Object;", "sub", "OrderController#readClaim"]
    .forEach((value) => assert.ok(inspectorText.includes(value), `${value} 정보 보존`));
  assert.doesNotMatch(inspectorText, /apiType|apiName|apiOwner|apiDescriptor|sourceKind|observationKind/);

  ui.inspector.render({ graph, visibleGraph: graph, snapshot, selection: { kind: "node", id: "business-state" }, displayIds });
  inspectorText = textOf(elements.get("inspector"));
  ["OWNER", "업무 상태 요구", handler, "owner-check", "검증 없음", "지원 경로 전체"]
    .forEach((value) => assert.ok(inspectorText.includes(value), `${value} 업무 상태 정보 보존`));
});

test("Edge 방향은 원본 source·target 순서를 따르고 참조가 빠지면 방향을 추측하지 않음", () => {
  const { ui, elements, window } = loadUi();
  const snapshot = {
    nodes: [
      { id: "target", type: "ENDPOINT", serviceId: "orders", label: "GET /orders", attributes: { httpMethod: "GET", path: "/orders" }, evidenceIds: [] }
    ],
    edges: [{ id: "missing-edge", sourceId: "missing-source", targetId: "target", type: "FLOWS_TO", attributes: {}, confidence: "CONFIRMED", evidenceIds: [] }],
    findings: [], evidence: []
  };
  const graph = snapshot;
  const displayIds = window.MapInBootGraph.createDisplayIds(graph);
  ui.inspector.render({ graph, visibleGraph: graph, snapshot, selection: { kind: "edge", id: "missing-edge" }, displayIds });

  const inspectorText = textOf(elements.get("inspector"));
  assert.match(inspectorText, /연결 방향을 확인할 수 없습니다/);
  assert.match(inspectorText, /RL-FLOW-001/);
  assert.doesNotMatch(inspectorText, /노드 확인 불가 → EP-MAPPING-001|출발 Node|도착 Node/);
});

test("추가 속성이 없는 경우 빈 구역을 만들지 않고 미등록 키는 값만 중립적으로 보존함", () => {
  const { ui, elements, window } = loadUi();
  const snapshot = {
    nodes: [{ id: "bare-endpoint", type: "ENDPOINT", serviceId: "orders", label: "GET /orders", attributes: {
      httpMethod: "GET", path: "/orders"
    }, evidenceIds: [] }],
    edges: [],
    findings: [],
    evidence: []
  };
  const graph = window.MapInBootGraph.normalize(snapshot);
  const displayIds = window.MapInBootGraph.createDisplayIds(graph);
  ui.inspector.render({ graph, visibleGraph: graph, snapshot, selection: { kind: "node", id: "bare-endpoint" }, displayIds });
  assert.doesNotMatch(textOf(elements.get("inspector")), /추가 속성|미등록 키/);

  const unknownUi = loadUi();
  const unknownSnapshot = {
    ...snapshot,
    nodes: [{ ...snapshot.nodes[0], attributes: {
      ...snapshot.nodes[0].attributes,
      futureInternalProperty: "확인 가능한 원본 값"
    } }]
  };
  const unknownGraph = unknownUi.window.MapInBootGraph.normalize(unknownSnapshot);
  const unknownDisplayIds = unknownUi.window.MapInBootGraph.createDisplayIds(unknownGraph);
  unknownUi.ui.inspector.render({ graph: unknownGraph, visibleGraph: unknownGraph, snapshot: unknownSnapshot,
    selection: { kind: "node", id: "bare-endpoint" }, displayIds: unknownDisplayIds });
  const inspectorText = textOf(unknownUi.elements.get("inspector"));
  assert.match(inspectorText, /확인되지 않은 속성 1/);
  assert.match(inspectorText, /확인 가능한 원본 값/);
  assert.doesNotMatch(inspectorText, /futureInternalProperty/);
  const unknownRow = findAllByClass(unknownUi.elements.get("inspector"), "inspector-row")
    .find((row) => row.attributes["data-attribute-key"] === "futureInternalProperty");
  assert.ok(unknownRow, "내부 테스트 진단은 원본 키를 추적할 수 있음");
});

test("Inspector·Hover·Finding은 공통 한국어 표시와 원본 이벤트 ID를 함께 보존함", () => {
  const { ui, elements } = loadUi();
  const endpointId = "f".repeat(64);
  const filterId = "0".repeat(64);
  const edgeId = "e".repeat(64);
  const findingId = "d".repeat(64);
  const evidenceIds = ["1", "2", "3", "4"].map((digit) => digit.repeat(64));
  const finding = {
    id: findingId,
    ruleId: "OBJECT_BINDING",
    title: "요청자와 주문 소유자 검증",
    description: "요청자 ID와 대상 객체의 소유자를 비교합니다.",
    confidence: "PARTIAL",
    nodeIds: [endpointId],
    edgeIds: [edgeId],
    evidenceIds,
    guide: "소유자 비교 위치 확인"
  };
  const snapshot = {
    nodes: [
      { id: endpointId, type: "ENDPOINT", serviceId: "orders", label: "GET /orders", attributes: { httpMethod: "GET", path: "/orders", handler: "OrderController#list" }, evidenceIds: [evidenceIds[0]] },
      { id: filterId, type: "FILTER", serviceId: "orders", label: "AuditFilter", attributes: { registrationKind: "SERVLET", filterClass: "com.example.AuditFilter" }, evidenceIds: [evidenceIds[1]] }
    ],
    edges: [{ id: edgeId, sourceId: endpointId, targetId: filterId, type: "SECURED_BY", confidence: "CONFIRMED", attributes: {}, evidenceIds: [evidenceIds[2]] }],
    findings: [finding],
    evidence: ["RUNTIME", "SPRING_METADATA", "CODE_PATTERN", "DECLARATION"].map((source, index) => ({
      id: evidenceIds[index], source, location: `OrderPolicy#check${index}`, summary: `확인 근거 ${index + 1}`
    })),
    evidenceDisplayCodes: Object.fromEntries(evidenceIds.map((id, index) => [id, `EV-TEST-${String(index + 1).padStart(3, "0")}`]))
  };
  const originalIdentifiers = [endpointId, filterId, edgeId, findingId, ...evidenceIds];
  const expectedRules = {
    CHAIN_MISSING: "보안 필터 체인 미적용",
    CHAIN_ORDER: "보안 체인·매칭 우선순위 문제",
    PUBLIC_ENDPOINT: "과도한 공개 접근 허용",
    METHOD_MISMATCH: "URL·메서드 보안 불일치",
    FILTER_ORDER: "필터 구성·순서 문제",
    OBJECT_BINDING: "인증 주체와 대상 객체 권한 검증 문제",
    STATE_BYPASS: "업무 보안 절차 우회 가능성"
  };
  const expectedSources = ["실행 환경", "Spring 메타데이터", "코드 분석", "선언 정보"];

  ui.renderGraph(snapshot);
  const ruleOptions = elements.get("finding-rule").children;
  Object.entries(expectedRules).forEach(([id, label]) => {
    assert.ok(ruleOptions.some((option) => option.value === id && option.textContent === label), `${id} 표시`);
  });

  ui.selectGraphElement("edge", edgeId);
  let inspector = elements.get("inspector");
  assert.match(textOf(inspector), /RL-SECURITY-001/);
  assert.match(textOf(inspector), /EP-MAPPING-001/);
  assert.match(textOf(inspector), /SV-FILTER-001/);
  assert.match(textOf(inspector), /확정/);
  assert.doesNotMatch(textOf(inspector), /CONFIRMED|SECURED_BY/);
  originalIdentifiers.forEach((id) => assert.equal(textOf(inspector).includes(id), false, "Inspector에 원본 ID 미노출"));
  ui.inspector.setTab("connections");
  const endpointButton = findAllByClass(inspector, "inspector-link").find((button) => button.attributes["data-node-id"] === endpointId);
  assert.ok(endpointButton);
  endpointButton.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selection.id, endpointId);

  elements.get("node-filter").value = "ENDPOINT";
  elements.get("node-filter").dispatchEvent({ type: "change" });
  ui.selectGraphElement("node", endpointId);
  ui.inspector.setTab("properties");
  assert.match(textOf(inspector), /EP-MAPPING-001/);
  ui.showGraphHover("node", endpointId, null);
  assert.match(textOf(elements.get("graph-popover")), /EP-MAPPING-001/);
  assert.doesNotMatch(textOf(elements.get("graph-popover")), new RegExp(endpointId));

  const entry = ui.state.findingIndex[0];
  for (const [confidence, label] of [["CONFIRMED", "확정"], ["LIKELY", "검토 필요"], ["UNKNOWN", "판단 불가"], ["PARTIAL", "부분 분석"], ["FUTURE_STATUS", "판단 불가"]]) {
    finding.confidence = confidence;
    ui.inspector.renderFindingModal({ graph: ui.state.graph, snapshot, entry, apiLabel: "GET /orders" });
    assert.equal(elements.get("finding-modal-confidence").textContent, label);
  }
  finding.confidence = "PARTIAL";
  ui.inspector.renderFindingModal({ graph: ui.state.graph, snapshot, entry, apiLabel: "GET /orders" });
  const modalText = textOf(elements.get("finding-modal"));
  assert.equal(elements.get("finding-modal-rule").textContent, `진단 유형 · ${expectedRules.OBJECT_BINDING}`);
  assert.ok(expectedSources.every((source) => modalText.includes(source)));
  assert.match(modalText, /EP-MAPPING-001/);
  assert.match(modalText, /RL-SECURITY-001/);
  assert.match(modalText, /EV-TEST-001/);
  assert.doesNotMatch(modalText, /OBJECT_BINDING|RUNTIME|SPRING_METADATA|CODE_PATTERN|DECLARATION/);
  originalIdentifiers.forEach((id) => assert.equal(modalText.includes(id), false, "Finding 상세에 원본 ID 미노출"));
});

test("Node 유형 점·텍스트는 외곽선 색을 따르고 SVG 텍스트 경계를 유지함", () => {
  const { ui, elements, document, window } = loadUi();
  const snapshot = graphFixture();
  snapshot.nodes[2].attributes = {
    httpMethod: "GET",
    path: "/api/admin/assignments/with/a/very/long/resource/name/that/must/stay/inside/the/card",
    handler: "com.example.AdminController#list(java.lang.String)"
  };
  snapshot.nodes[3].attributes.handler = "com.example.InternalAccountController#createApplication(com.example.InternalAccountController$LoanApplicationRequest,org.springframework.security.oauth2.jwt.Jwt)";
  snapshot.nodes[3].label = snapshot.nodes[3].attributes.handler;

  const createElementNS = document.createElementNS.bind(document);
  let measuredNodeTexts = 0;
  document.createElementNS = (namespace, tagName) => {
    const element = createElementNS(namespace, tagName);
    if (tagName === "text") {
      element.getComputedTextLength = () => {
        const className = element.getAttribute("class");
        if (["graph-node-label", "graph-node-detail", "graph-node-display-id", "graph-node-type"].includes(className)) {
          let current = element;
          while (current && current !== elements.get("graph-nodes")) current = current.parentNode;
          assert.ok(current, `${className}는 SVG 계층 연결 후 너비 측정`);
          measuredNodeTexts += 1;
        }
        return (element.textContent || "").length * 8;
      };
    }
    return element;
  };

  ui.renderGraph(snapshot);
  const expectedCodes = [
    "AP-SERVICE-001", "SV-SERVLET-001", "EP-MAPPING-001", "EP-HANDLER-001", "SC-CHAIN-001",
    "SV-FILTER-001", "SC-AUTHN-001", "SC-AUTH-001", "SD-DATA-001", "BS-STATE-001"
  ];
  const renderedNodes = Array.from(elements.get("graph-nodes").children)
    .filter((element) => element.getAttribute("data-node-id"));
  assert.equal(renderedNodes.length, 10);
  renderedNodes.forEach((node, index) => {
    const type = snapshot.nodes[index].type;
    const card = findAllByClass(node, "graph-node-card")[0];
    const badge = findAllByClass(node, "graph-node-type")[0];
    const typeDot = findAllByClass(node, "graph-node-type-dot")[0];
    const displayId = findAllByClass(node, "graph-node-display-id")[0];
    const titleLines = findAllByClass(node, "graph-node-label");
    const details = findAllByClass(node, "graph-node-detail");

    assert.equal(card.attributes.width, "260");
    assert.equal(card.attributes.height, "120");
    assert.equal(badge.textContent, window.MapInBootGraph.nodeTypeLabel(type));
    assert.ok(typeDot);
    assert.equal(typeDot.tagName, "circle");
    assert.equal(findAllByClass(node, "graph-node-type-badge").length, 0);
    assert.equal(badge.getAttribute("fill"), card.getAttribute("stroke"));
    assert.equal(typeDot.getAttribute("fill"), card.getAttribute("stroke"));
    assert.equal(displayId.textContent, expectedCodes[index]);
    assert.equal(displayId.attributes["text-anchor"], "end");
    const typeWidth = badge.getComputedTextLength();
    const displayStart = Number(displayId.attributes.x) - displayId.getComputedTextLength();
    assert.ok(Number(badge.attributes.x) + typeWidth <= displayStart,
      `${badge.textContent} 유형명과 ${displayId.textContent} 표시 ID 사이 간격 확보`);
    assert.ok(titleLines.length <= 2);
    assert.ok(details.length <= 1);
    assert.ok(badge.getAttribute("clip-path"));
    [...titleLines, ...details, displayId].forEach((text) => assert.ok(text.getAttribute("clip-path")));
  });
  const endpoint = renderedNodes.find((node) => node.getAttribute("data-node-id") === "node-2");
  assert.equal(findAllByClass(endpoint, "graph-node-detail").length, 0);
  assert.ok(measuredNodeTexts > 0);
  assert.ok(findAllByClass(elements.get("graph-svg"), "graph-node-content-clip").length > 0);
  assert.ok(findAllByClass(elements.get("graph-svg"), "graph-node-header-clip").length > 0);
  assert.ok(findAllByClass(elements.get("graph-svg"), "graph-node-header-type-clip").length > 0);
  assert.match(appCss, /\.graph-node-display-id\s*\{[^}]*fill:\s*#b5c3ba/);
  assert.match(appCss, /\.graph-node-type-dot,\s*\.graph-node-type\s*\{[^}]*pointer-events:\s*none/);
});

test("Inspector 헤더는 유형 배지와 대표 이름만 표시하고 표시 ID는 속성에 보존함", () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(graphFixture());

  ui.selectGraphElement("node", "node-2");
  let header = findAllByClass(elements.get("inspector"), "inspector-header")[0];
  assert.equal(findAllByClass(header, "inspector-badge")[0].textContent, "API");
  assert.equal(findAllByClass(header, "inspector-title")[0].textContent, "GET /orders/<script>alert(1)</script>");
  assert.equal(findAllByClass(header, "inspector-subtitle").length, 0);
  assert.ok(textOf(elements.get("inspector")).includes("EP-MAPPING-001"));

  ui.selectGraphElement("edge", "edge-3");
  header = findAllByClass(elements.get("inspector"), "inspector-header")[0];
  assert.equal(findAllByClass(header, "inspector-badge")[0].textContent, "보호 근거");
  assert.equal(findAllByClass(header, "inspector-title")[0].textContent, "RL-SECURITY-001");
  assert.equal(findAllByClass(header, "inspector-subtitle").length, 0);
  assert.match(textOf(elements.get("inspector")), /EP-HANDLER-001 → SC-CHAIN-001/);
});

test("Controller 복합 카드 Inspector는 Handler 서명을 축약하고 전체 원문을 보존함", async () => {
  const { ui, elements } = loadUi();
  const graph = detailGraphFixture();
  const signatures = [
    "com.mapinboot.demo.account.controller.LoanApplicationController#createApplication(com.mapinboot.demo.account.controller.LoanApplicationController$LoanApplicationRequest,org.springframework.security.oauth2.jwt.Jwt)",
    "com.mapinboot.demo.account.controller.LoanApplicationController#getMyApplications(org.springframework.security.oauth2.jwt.Jwt)",
    "com.mapinboot.demo.account.controller.LoanApplicationController#searchCustomers(java.lang.String,java.util.List<com.mapinboot.demo.account.controller.CustomerFilter>)"
  ];
  signatures.forEach((signature, index) => graph.nodes.push({
    id: `loan-handler-${index}`, type: "HANDLER", serviceId: "orders", label: signature,
    attributes: { handler: signature }, evidenceIds: []
  }));

  ui.state.includeUnconnectedNodes = true;
  ui.renderGraph(graph);
  await ui.layoutGraph();
  const plan = ui.state.layout.plan;
  const card = compositeCardForNode(plan, "loan-handler-0", "CONTROLLER_HANDLER");
  assert.ok(card, JSON.stringify(plan.displayModel.composites.map((item) => item.controllerFqcn)));
  assert.equal(card.controllerFqcn, "com.mapinboot.demo.account.controller.LoanApplicationController");
  ui.selectGraphElement("controller-group", card.id);
  const inspector = elements.get("inspector");
  const header = findAllByClass(inspector, "inspector-header")[0];
  assert.equal(findAllByClass(header, "inspector-badge")[0].textContent, "Controller");
  assert.equal(findAllByClass(header, "inspector-title")[0].textContent, "LoanApplicationController");
  assert.equal(findAllByClass(header, "inspector-subtitle").length, 0);
  assert.ok(findAllByClass(inspector, "inspector-row").some((row) => row.children[0].textContent === "전체 클래스 경로"));
  assert.deepEqual(Array.from(findAllByClass(inspector, "inspector-handler-method-summary"), (element) => element.textContent), [
    "createApplication(LoanApplicationRequest, Jwt)",
    "getMyApplications(Jwt)",
    "searchCustomers(String, List<CustomerFilter>)"
  ]);
  const originals = findAllByClass(inspector, "inspector-original-signatures")[0];
  assert.ok(originals);
  assert.equal(originals.hasAttribute("open"), false);
  signatures.forEach((signature) => assert.ok(textOf(originals).includes(signature)));
});

test("노드 유형 라벨은 외곽선 색을 따르고 노드 배경만 옅게 물들임", () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(graphFixture());

  const nodes = findAllByClass(elements.get("graph-nodes"), "graph-node")
    .filter((node) => node.getAttribute("data-node-id"));
  assert.ok(nodes.length > 0);
  nodes.forEach((node) => {
    const outlineColor = findAllByClass(node, "graph-node-card")[0].getAttribute("stroke");
    const tint = findAllByClass(node, "graph-node-background-tint")[0];
    const badge = findAllByClass(node, "graph-node-type-badge")[0];
    const label = findAllByClass(node, "graph-node-type")[0];
    const dot = findAllByClass(node, "graph-node-type-dot")[0];

    assert.ok(tint);
    assert.equal(tint.getAttribute("fill"), outlineColor);
    assert.equal(tint.getAttribute("fill-opacity"), null);
    assert.equal(badge, undefined);
    assert.equal(label.getAttribute("fill"), outlineColor);
    assert.equal(dot.getAttribute("fill"), outlineColor);
  });
  assert.match(appCss, /\.graph-node-background-tint\s*\{[^}]*fill-opacity:\s*\.12/);
});

test("상위 기술 영역만 배선 간격을 넓히고 내부 Lane 간격은 유지함", () => {
  const { ui, layoutApi } = loadUi();
  const layout = layoutApi.semanticLayout(ui.normalizeGraph(detailGraphFixture()), { positions: {} });
  const lanes = layout.plan.lanes;
  const gapBetween = (leftId, rightId) => {
    const left = lanes.find((lane) => lane.id === leftId);
    const right = lanes.find((lane) => lane.id === rightId);
    return right.x - (left.x + left.width);
  };

  assert.deepEqual(Array.from(lanes, (lane) => lane.id),
    ["servlet-filter", "security-chain", "security-checks", "endpoint", "handler"]);
  assert.equal(gapBetween("security-chain", "security-checks"), layout.plan.sectionGap);
  assert.equal(gapBetween("security-checks", "endpoint"), layout.plan.majorSectionGap);
  assert.equal(gapBetween("endpoint", "handler"), layout.plan.majorSectionGap);
});

test("장거리 Edge는 여러 행에 걸쳐 공통 Trunk를 유지하고 목적지 직전에서 분기함", async () => {
  const { ui, layoutApi, elements } = loadUi();
  const snapshot = {
    nodes: [
      { id: "application", type: "APPLICATION", label: "Application", attributes: {}, evidenceIds: [] },
      ...Array.from({ length: 8 }, (_, index) => ({ id: `endpoint-${index}`, type: "ENDPOINT",
        label: `GET /items/${index}`, attributes: { httpMethod: "GET", path: `/items/${index}` },
        evidenceIds: [`endpoint-evidence-${index}`] }))
    ],
    edges: Array.from({ length: 8 }, (_, index) => ({ id: `flow-${index}`, sourceId: "application",
      targetId: `endpoint-${index}`, type: "FLOWS_TO", confidence: "CONFIRMED", attributes: {},
      evidenceIds: [`flow-evidence-${index}`] }))
  };
  const graph = ui.normalizeGraph(snapshot);
  const layout = layoutApi.semanticLayout(graph, { positions: {} });
  const routing = layout.plan.overviewRouting;
  const flowRelations = routing.relations.filter((relation) => relation.originalEdgeIds.some((id) => id.startsWith("flow-")));
  assert.equal(flowRelations.length, 8);
  const relationIds = new Set(flowRelations.map((relation) => relation.id));
  const shared = routing.segments.find((segment) => segment.routeRole === "TRUNK"
    && segment.relationIds.length === 8 && segment.relationIds.every((id) => relationIds.has(id)));
  assert.ok(shared, "8개 항목 관계가 공유하는 단일 Trunk 누락");
  const curves = routing.segments.filter((segment) => segment.geometry?.kind === "CUBIC");
  assert.ok(curves.length > 0, "안전한 분기·코너에 Blueprint 곡선 기하 누락");
  curves.forEach((segment) => segment.relationIds.forEach((id) => {
    assert.ok(routing.routesByRelationId[id]?.orderedSegmentIds.includes(segment.id),
      `${segment.id}: 곡선 Segment의 관계 membership 유지`);
  }));
  const relationById = new Map(flowRelations.map((relation) => [relation.id, relation]));
  curves.forEach((segment) => {
    const relation = relationById.get(segment.relationIds[0]);
    const controls = segment.geometry.controlPoints;
    const hull = {
      left: Math.min(segment.from.x, segment.to.x, ...controls.map((point) => point.x)),
      right: Math.max(segment.from.x, segment.to.x, ...controls.map((point) => point.x)),
      top: Math.min(segment.from.y, segment.to.y, ...controls.map((point) => point.y)),
      bottom: Math.max(segment.from.y, segment.to.y, ...controls.map((point) => point.y))
    };
    layout.plan.displayModel.instances.forEach((instance) => {
      if (instance.id === relation.sourceInstanceId || instance.id === relation.targetInstanceId) return;
      const position = instance.position;
      assert.equal(hull.left <= position.x + position.width && hull.right >= position.x
        && hull.top <= position.y + position.height && hull.bottom >= position.y, false,
      `${segment.id} Bézier 제어점 Bounds가 ${instance.id} 카드와 충돌`);
    });
  });
  const ports = new Map(layout.plan.displayModel.ports.map((port) => [port.id, port]));
  flowRelations.forEach((relation) => {
    const route = routing.routesByRelationId[relation.id];
    assert.ok(route, relation.id);
    assert.equal(route.sourcePort.x, ports.get(relation.visualSourcePortId).x);
    assert.equal(route.targetPort.x, ports.get(relation.visualTargetPortId).x);
    assert.ok(route.orderedSegmentIds.includes(shared.id), `${relation.id}가 공통 Trunk를 사용함`);
    const edgeId = relation.originalEdgeIds[0];
    assert.deepEqual({ ...relation.originalDirections[0] }, {
      edgeId, sourceId: "application", targetId: `endpoint-${edgeId.slice("flow-".length)}`
    });
  });
  assert.deepEqual(Array.from(routing.unresolved), []);

  ui.renderGraph(snapshot);
  await ui.layoutGraph();
  const segments = findAllByClass(elements.get("graph-edges"), "graph-overview-segment");
  const trunks = segments.filter((path) => path.getAttribute("data-segment-id") === shared.id);
  assert.equal(trunks.length, 1, "공유 Trunk는 한 번만 렌더링");
  assert.equal(trunks[0].getAttribute("data-segment-geometry"), "CUBIC");
  assert.match(trunks[0].getAttribute("d"), / C /);
  curves.forEach((segment) => {
    const path = segments.find((item) => item.getAttribute("data-segment-id") === segment.id);
    assert.ok(path);
    assert.equal(path.getAttribute("data-segment-geometry"), "CUBIC");
    assert.match(path.getAttribute("d"), / C /);
  });
  assert.equal(new Set(segments.map((path) => path.getAttribute("data-segment-id"))).size, routing.segments.length);
  assert.equal((trunks[0].getAttribute("data-edge-ids") || "").split(",").filter(Boolean).length, 8);
});

test("완전한 N→M 공통 배선은 원본 관계 쌍과 Evidence를 개별 보존함", () => {
  const { ui, layoutApi } = loadUi();
  const graph = ui.normalizeGraph({
    nodes: [
      ...["handler-a", "handler-b"].map((id) => ({ id, type: "HANDLER", label: id,
        attributes: { handler: `${id}#handle` }, evidenceIds: [] })),
      ...["endpoint-a", "endpoint-b"].map((id) => ({ id, type: "ENDPOINT", label: id,
        attributes: { httpMethod: "GET", path: `/${id}` }, evidenceIds: [] }))
    ],
    edges: [
      ...["handler-a", "handler-b"].flatMap((sourceId) => ["endpoint-a", "endpoint-b"].map((targetId) => ({
        id: `flow-${sourceId}-${targetId}`, sourceId, targetId, type: "FLOWS_TO",
        confidence: "CONFIRMED", attributes: {}, evidenceIds: [`evidence-${sourceId}-${targetId}`]
      })))
    ]
  });
  const layout = layoutApi.semanticLayout(graph, { positions: {} });
  const routing = layout.plan.overviewRouting;
  const actualEdgeIds = [
    "flow-handler-a-endpoint-a", "flow-handler-a-endpoint-b",
    "flow-handler-b-endpoint-a", "flow-handler-b-endpoint-b"
  ];
  const relations = routing.relations.filter((relation) => relation.originalEdgeIds.some((id) => actualEdgeIds.includes(id)));
  assert.equal(relations.length, 4);
  assert.deepEqual(Array.from(relations).flatMap((relation) => Array.from(relation.originalEdgeIds)).sort(), actualEdgeIds.slice().sort());
  assert.equal(new Set(graph.edges.map((edge) => `${edge.sourceId}\u0000${edge.targetId}`)).size, 4,
    "공통 배선의 Source–Target 쌍이 모두 실제 관계여야 함");
  const sharedSegments = routing.segments.filter((segment) => segment.routeRole === "TRUNK"
    && segment.relationIds.length > 1);
  assert.ok(sharedSegments.length > 0, JSON.stringify({
    unresolved: routing.unresolved,
    routes: relations.map((relation) => routing.routesByRelationId[relation.id]?.orderedSegmentIds),
    shared: routing.segments.filter((segment) => segment.relationIds.length > 1)
      .map((segment) => ({ role: segment.routeRole, count: segment.relationIds.length, group: segment.groupKey }))
  }));
  relations.forEach((relation) => {
    const route = routing.routesByRelationId[relation.id];
    assert.ok(route.orderedSegmentIds.some((id) => sharedSegments.some((segment) => segment.id === id)), relation.id);
    const edge = graph.edges.find((candidate) => candidate.id === relation.originalEdgeIds[0]);
    assert.deepEqual({ ...relation.originalDirections[0] }, { edgeId: edge.id, sourceId: edge.sourceId, targetId: edge.targetId });
    assert.deepEqual(Array.from(relation.evidenceIds), Array.from(edge.evidenceIds));
  });
  const diagonalGraph = ui.normalizeGraph({
    nodes: graph.nodes,
    edges: graph.edges.filter((edge) => (edge.sourceId === "handler-a") === (edge.targetId === "endpoint-a"))
  });
  const diagonalLayout = layoutApi.semanticLayout(diagonalGraph, { positions: {} });
  assert.equal(diagonalLayout.plan.overviewRouting.segments.some((segment) => segment.relationIds.length === 4), false,
  "실제 대각선 관계만으로 N→M 연결을 암시하지 않아야 함");
});

test("Hidden Conceptual Group은 공유 원본을 Chain별 표시 인스턴스로 분리하고 원본 계약을 보존함", () => {
  const { ui, layoutApi } = loadUi();
  const graph = ui.normalizeGraph(detailGraphFixture());
  const handlerA = graph.nodes.find((node) => node.id === "handler-a");
  const endpointA = graph.nodes.find((node) => node.id === "endpoint-a");
  const handlerB = graph.nodes.find((node) => node.id === "handler-b");
  const endpointB = graph.nodes.find((node) => node.id === "endpoint-b");
  handlerA.attributes.handler = "com.example.OrderController#list";
  endpointA.attributes.handler = handlerA.attributes.handler;
  handlerB.attributes.handler = "com.example.OrderController#detail";
  endpointB.attributes.handler = handlerB.attributes.handler;
  graph.nodes.push(
    { id: "handler-shared", type: "HANDLER", label: "SharedController#handle",
      attributes: { handler: "SharedController#handle" }, evidenceIds: ["e-handler-shared"] },
    { id: "endpoint-shared-a", type: "ENDPOINT", label: "GET /shared/a",
      attributes: { httpMethod: "GET", path: "/shared/a", handler: "SharedController#handle" },
      evidenceIds: ["e-endpoint-shared-a"] },
    { id: "endpoint-shared-b", type: "ENDPOINT", label: "GET /shared/b",
      attributes: { httpMethod: "GET", path: "/shared/b", handler: "SharedController#handle" },
      evidenceIds: ["e-endpoint-shared-b"] },
    { id: "handler-unresolved", type: "HANDLER", label: "UnresolvedController#handle",
      attributes: { handler: "UnresolvedController#handle" }, evidenceIds: ["e-handler-unresolved"] },
    { id: "endpoint-unresolved", type: "ENDPOINT", label: "GET /unresolved",
      attributes: { httpMethod: "GET", path: "/unresolved", handler: "UnresolvedController#handle" },
      evidenceIds: ["e-endpoint-unresolved"] },
    { id: "security-shared", type: "AUTHORIZATION", label: "Shared authorization",
      attributes: { authorizationKind: "ROLE" }, evidenceIds: ["e-security-shared"] },
    ...Array.from({ length: 18 }, (_, index) => ({
      id: `endpoint-bulk-${index}`, type: "ENDPOINT", label: `GET /bulk/${index}`,
      attributes: { httpMethod: "GET", path: `/bulk/${index}`, handler: handlerB.attributes.handler },
      evidenceIds: [`e-endpoint-bulk-${index}`]
    }))
  );
  graph.edges.push(
    { id: "map-shared-a", sourceId: "endpoint-shared-a", targetId: "handler-shared", type: "FLOWS_TO",
      confidence: "CONFIRMED", attributes: { flowKind: "HANDLER" }, evidenceIds: ["e-map-shared-a"] },
    { id: "map-shared-b", sourceId: "endpoint-shared-b", targetId: "handler-shared", type: "FLOWS_TO",
      confidence: "CONFIRMED", attributes: { flowKind: "HANDLER" }, evidenceIds: ["e-map-shared-b"] },
    { id: "map-unresolved", sourceId: "endpoint-unresolved", targetId: "handler-unresolved", type: "FLOWS_TO",
      confidence: "CONFIRMED", attributes: { flowKind: "HANDLER" }, evidenceIds: ["e-map-unresolved"] },
    ...Array.from({ length: 18 }, (_, index) => ({
      id: `map-bulk-${index}`, sourceId: `endpoint-bulk-${index}`, targetId: "handler-b", type: "FLOWS_TO",
      confidence: "CONFIRMED", attributes: { flowKind: "HANDLER" }, evidenceIds: [`e-map-bulk-${index}`]
    })),
    { id: "match-shared-a", sourceId: "endpoint-shared-a", targetId: "chain-a", type: "MATCHED_BY",
      confidence: "CONFIRMED", attributes: {}, evidenceIds: ["e-match-shared-a"] },
    { id: "match-shared-b", sourceId: "endpoint-shared-b", targetId: "chain-b", type: "MATCHED_BY",
      confidence: "CONFIRMED", attributes: {}, evidenceIds: ["e-match-shared-b"] },
    { id: "match-unresolved", sourceId: "endpoint-unresolved", targetId: "chain-a", type: "MATCHED_BY",
      confidence: "LIKELY", attributes: {}, evidenceIds: ["e-match-unresolved"] },
    { id: "shared-security-a", sourceId: "chain-a", targetId: "security-shared", type: "SECURED_BY",
      confidence: "CONFIRMED", attributes: {}, evidenceIds: ["e-shared-security-a"] },
    { id: "shared-security-b", sourceId: "chain-b", targetId: "security-shared", type: "SECURED_BY",
      confidence: "CONFIRMED", attributes: {}, evidenceIds: ["e-shared-security-b"] },
    ...Array.from({ length: 18 }, (_, index) => ({
      id: `match-bulk-${index}`, sourceId: `endpoint-bulk-${index}`, targetId: "chain-b", type: "MATCHED_BY",
      confidence: "CONFIRMED", attributes: {}, evidenceIds: [`e-match-bulk-${index}`]
    }))
  );
  const originalGraph = JSON.stringify(graph);
  const first = layoutApi.semanticLayout(graph, { positions: {} });
  const second = layoutApi.semanticLayout(graph, { positions: {} });
  const hiddenGroups = first.plan.hiddenGroups;
  assert.ok(Array.isArray(hiddenGroups), "내부 Hidden Group 계획 누락");
  const chainGroups = hiddenGroups.filter((group) => group.type === "CHAIN");
  assert.deepEqual(Array.from(chainGroups, (group) => group.id), ["chain:chain-a", "chain:chain-b"]);
  assert.deepEqual(Array.from(chainGroups, (group) => group.chainOrder), [1, 2]);
  const groupsFor = (nodeId) => hiddenGroups.filter((group) => Object.values(group.members)
    .some((memberIds) => memberIds.includes(nodeId)));
  assert.deepEqual(Array.from(groupsFor("authorization-a"), (group) => group.id), ["chain:chain-a"]);
  assert.deepEqual(Array.from(groupsFor("security-data-a"), (group) => group.id), ["chain:chain-a"]);
  assert.deepEqual(Array.from(groupsFor("authorization-b"), (group) => group.id), ["chain:chain-b"]);
  assert.deepEqual(Array.from(groupsFor("handler-shared"), (group) => group.id), ["chain:chain-a", "chain:chain-b"]);
  assert.deepEqual(Array.from(groupsFor("security-shared"), (group) => group.id), ["chain:chain-a", "chain:chain-b"]);
  assert.deepEqual(Array.from(groupsFor("endpoint-unresolved"), (group) => group.id), ["unresolved"]);
  assert.deepEqual(Array.from(groupsFor("handler-unresolved"), (group) => group.id), ["unresolved"]);
  assert.deepEqual(Array.from(groupsFor("endpoint-bulk-17"), (group) => group.id), ["chain:chain-b"]);

  const chainA = chainGroups[0];
  const chainB = chainGroups[1];
  assert.ok(chainB.rowHeight > chainA.rowHeight, "Endpoint가 많은 Chain만 행 높이 확장");
  assert.ok(first.positions[chainA.chainId].y < first.positions[chainB.chainId].y);
  const display = first.plan.displayModel;
  const displayFor = (nodeId, rowId) => display.instances.find((instance) =>
    instance.rowId === rowId && instance.originalNodeIds.includes(nodeId));
  const sharedHandlerA = displayFor("handler-shared", "chain:chain-a");
  const sharedHandlerB = displayFor("handler-shared", "chain:chain-b");
  const sharedSecurityA = displayFor("security-shared", "chain:chain-a");
  const sharedSecurityB = displayFor("security-shared", "chain:chain-b");
  assert.ok(sharedHandlerA && sharedHandlerB, "공유 Handler가 두 Chain 행에 표시됨");
  assert.ok(sharedSecurityA && sharedSecurityB, "공유 보안 근거가 두 Chain 행에 표시됨");
  assert.notEqual(sharedHandlerA.id, sharedHandlerB.id);
  assert.notEqual(sharedSecurityA.id, sharedSecurityB.id);
  assert.deepEqual(Array.from(display.originalNodeToInstanceIds["handler-shared"]), [sharedHandlerA.id, sharedHandlerB.id]);
  assert.deepEqual(Array.from(display.instanceToOriginalNodeIds[sharedHandlerB.id]), ["handler-shared"]);
  assert.equal(display.nodeToDisplay["handler-shared"], sharedHandlerA.id);
  assert.ok(sharedHandlerA.position.y >= chainA.rowTop && sharedHandlerA.position.y + 120 <= chainA.rowBottom);
  assert.ok(sharedHandlerB.position.y >= chainB.rowTop && sharedHandlerB.position.y + 120 <= chainB.rowBottom);
  assert.ok(sharedSecurityA.position.y >= chainA.rowTop && sharedSecurityA.position.y + 120 <= chainA.rowBottom);
  assert.ok(sharedSecurityB.position.y >= chainB.rowTop && sharedSecurityB.position.y + 120 <= chainB.rowBottom);
  assert.equal(first.plan.lanes.find((lane) => lane.id === "endpoint").columns, 2);
  assert.ok(first.plan.lanes.find((lane) => lane.id === "handler").columns >= 1);
  hiddenGroups.forEach((group) => {
    assert.equal(group.rowBottom, group.rowTop + group.rowHeight);
    Object.values(group.members).flat().forEach((nodeId) => {
      const instance = display.instances.find((candidate) => candidate.rowId === group.id
        && candidate.originalNodeIds.includes(nodeId));
      const position = instance && instance.position;
      assert.ok(position, `${nodeId}의 ${group.id} 표시 인스턴스 위치 누락`);
      assert.ok(position.y >= group.rowTop && position.y + 120 <= group.rowBottom,
        `${nodeId}가 ${group.id} 행 밖에 배치됨`);
    });
  });
  assert.equal(chainB.members.endpoints.length, 20);
  assert.ok(hiddenGroups.flatMap((group) => Object.values(group.members).flat()).length
    > new Set(hiddenGroups.flatMap((group) => Object.values(group.members).flat())).size,
  "공유 원본은 Hidden Row마다 배치하되 Snapshot Node 수는 유지");
  assert.equal(first.plan.controllerGroups.filter((group) => group.controllerFqcn === "com.example.OrderController").length, 2,
    "서로 다른 Chain의 실제 Handler 메서드는 별도 표시 그룹으로 유지");
  const sharedSecurityEdgeA = display.displayEdgeInstances.filter((edge) => edge.originalEdgeIds.includes("shared-security-a"));
  const sharedSecurityEdgeB = display.displayEdgeInstances.filter((edge) => edge.originalEdgeIds.includes("shared-security-b"));
  assert.equal(sharedSecurityEdgeA.length, 1);
  assert.equal(sharedSecurityEdgeA[0].rowId, "chain:chain-a");
  assert.equal(sharedSecurityEdgeB.length, 1);
  assert.equal(sharedSecurityEdgeB[0].rowId, "chain:chain-b");
  assert.equal(display.originalNodeToInstanceIds["security-shared"].length, 2);
  assert.deepEqual(first.positions, second.positions);
  assert.deepEqual(first.plan.displayModel.instances, second.plan.displayModel.instances);
  assert.deepEqual(first.plan.displayModel.displayEdgeInstances, second.plan.displayModel.displayEdgeInstances);
  assert.deepEqual(Array.from(hiddenGroups, ({ id, rowTop, rowHeight }) => ({ id, rowTop, rowHeight })),
    Array.from(second.plan.hiddenGroups, ({ id, rowTop, rowHeight }) => ({ id, rowTop, rowHeight })));
  assert.equal(JSON.stringify(graph), originalGraph, "레이아웃 계산으로 Snapshot Graph를 변경하지 않음");
});

test("보안 복합 카드는 원본 유형 색상과 항목 접근성 정보를 유지함", () => {
  const { ui, elements, window, layoutApi } = loadUi();
  const graph = detailGraphFixture();
  graph.nodes.push(
    { id: "authentication-color", type: "AUTHENTICATION", label: "Authentication", attributes: {}, evidenceIds: [] },
    { id: "business-state-color", type: "BUSINESS_SECURITY_STATE", label: "Business state",
      attributes: {}, evidenceIds: [] }
  );
  const normalizedGraph = ui.normalizeGraph(graph);
  const layoutResult = layoutApi.semanticLayout(normalizedGraph, { positions: {} });
  const layers = {
    svg: elements.get("graph-svg"), viewport: elements.get("graph-viewport"),
    areaLayer: elements.get("graph-areas"), projectionLayer: elements.get("graph-flow-projection"),
    guideLayer: elements.get("graph-guides"), edgeLayer: elements.get("graph-edges"),
    nodeLayer: elements.get("graph-nodes"), findingLayer: elements.get("graph-finding-sections"),
    findingTitleLayer: elements.get("graph-finding-section-titles")
  };
  window.MapInBootGraph.render(normalizedGraph, layers, {
    positions: layoutResult.positions, bounds: { width: layoutResult.width, height: layoutResult.height },
    layoutPlan: layoutResult.plan, findings: []
  });

  const expected = {
    AUTHENTICATION: "#38bdf8",
    AUTHORIZATION: "#cf788a",
    SECURITY_DATA: "#4ab9ad",
    BUSINESS_SECURITY_STATE: "#a3e635",
    HANDLER: "#b4a0e5"
  };
  const cardDefinitions = layoutResult.plan.displayModel.composites;
  const renderedCards = findAllByClass(elements.get("graph-nodes"), "graph-composite-card");
  ["authentication-color", "business-state-color", "authorization-a", "security-data-a", "handler-a"].forEach((nodeId) => {
    const cardId = layoutResult.plan.displayModel.originalNodeToCardIds[nodeId]?.[0];
    const definition = layoutResult.plan.displayModel.cardById[cardId];
    const rendered = renderedCards.find((card) => card.getAttribute("data-composite-card-id") === cardId);
    const itemId = layoutResult.plan.displayModel.originalNodeToItemIds[nodeId]?.[0];
    const renderedItem = findAllByClass(rendered, "graph-composite-item")
      .find((item) => item.getAttribute("data-composite-item-id") === itemId);
    const color = expected[definition.kind === "CONTROLLER_HANDLER" ? "HANDLER" : definition.kind];
    assert.ok(definition && rendered && renderedItem, `${nodeId} 복합 항목 누락`);
    assert.equal(findAllByClass(rendered, "graph-composite-surface")[0].getAttribute("stroke"), color);
    assert.equal(renderedItem.getAttribute("role"), "button");
    assert.ok(renderedItem.getAttribute("aria-label").length > 0);
  });
});

test("인가 표시 그룹은 혼합 정책을 집계하고 Inspector에서 원본 정책과 근거를 보존함", async () => {
  const { ui, elements } = loadUi();
  const graph = detailGraphFixture();
  graph.evidence ||= [];
  graph.nodes.find((node) => node.id === "chain-a").attributes.matcherCondition = "/internal/**";
  graph.nodes.find((node) => node.id === "authorization-b").attributes = {
    policySource: "URL", policyKind: "AUTHORITY_REQUIRED", requiredAuthority: "ROLE_CUSTOMER",
    policyMatcherCondition: "ANY", policyOrder: "1", chainKey: "chain-b", chainOrder: "2"
  };
  const policyKinds = ["PERMIT_ALL", "PERMIT_ALL", "PERMIT_ALL", "AUTHENTICATED", "AUTHENTICATED", "AUTHORITY_REQUIRED"];
  policyKinds.forEach((policyKind, index) => {
    const id = `url-policy-${index + 1}`;
    graph.nodes.push({
      id,
      type: "AUTHORIZATION",
      serviceId: "orders",
      label: id,
      attributes: {
        policySource: "URL",
        policyKind,
        policyMatcherCondition: "ANY",
        policyMatcherType: "ANY",
        policyOrder: String(index + 1),
        chainKey: "chain-a",
        chainOrder: "1",
        ...(policyKind === "AUTHORITY_REQUIRED" ? { requiredAuthority: "ROLE_CUSTOMER" } : {})
      },
      evidenceIds: [`evidence-${id}`]
    });
    graph.edges.push({
      id: `secured-${id}`, sourceId: "handler-a", targetId: id, type: "SECURED_BY",
      attributes: {}, confidence: "CONFIRMED", evidenceIds: [`evidence-secured-${id}`]
    });
    graph.evidence.push({
      id: `evidence-${id}`, source: "CODE_PATTERN", location: `SecurityConfig#policy${index + 1}`,
      summary: `인가 정책 ${index + 1}`
    });
  });
  graph.findings = [{ id: "policy-finding", title: "정책 Finding", ruleId: "PUBLIC_ENDPOINT", confidence: "LIKELY",
    nodeIds: ["url-policy-1"], edgeIds: ["secured-url-policy-1"], evidenceIds: ["evidence-url-policy-1"] }];

  ui.renderGraph(graph);
  await ui.layoutGraph();

  const plan = ui.state.layout.plan;
  const policyCard = compositeCardForNode(plan, "url-policy-1", "AUTHORIZATION");
  const permitItem = compositeItemForNode(plan, "url-policy-1", policyCard.rowId);
  assert.ok(policyCard && permitItem);
  assert.equal(permitItem.label, "공개 접근 허용");
  assert.equal(permitItem.originalNodeIds.length, 3);
  assert.match(permitItem.detail, /URL 정책 3건/);
  assert.match(permitItem.detail, /조건 ANY/);
  assert.doesNotMatch(`${permitItem.label} ${permitItem.detail}`, /\/internal\/\*\*|원본 Fact/);
  const policyItems = policyKinds.map((_, index) => compositeItemForNode(plan, `url-policy-${index + 1}`));
  assert.equal(new Set(policyItems.slice(0, 3).map((item) => item.id)).size, 1);
  assert.equal(new Set(policyItems.slice(3, 5).map((item) => item.id)).size, 1);
  assert.notEqual(policyItems[0].id, policyItems[3].id);
  assert.notEqual(policyItems[0].id, policyItems[5].id);

  const authorityItem = compositeItemForNode(plan, "authorization-b");
  assert.equal(authorityItem.label, "ROLE_CUSTOMER 권한 필요");
  assert.equal(authorityItem.detail, "URL 정책 · 조건 ANY · 순서 1");
  const renderedItem = findAllByClass(elements.get("graph-nodes"), "graph-composite-item")
    .find((item) => item.getAttribute("data-composite-item-id") === permitItem.id);
  renderedItem.dispatchEvent({ type: "click" });
  const inspectorTitle = findAllByClass(elements.get("inspector"), "inspector-title")[0];
  assert.equal(inspectorTitle.textContent, permitItem.label);
  const sourceLinks = findAllByClass(elements.get("inspector"), "inspector-link")
    .filter((link) => link.getAttribute("data-node-id")?.startsWith("url-policy-"));
  assert.deepEqual(sourceLinks.map((link) => link.getAttribute("data-node-id")),
    ["url-policy-1", "url-policy-2", "url-policy-3"]);
  assert.match(textOf(elements.get("inspector")), /ROLE_CUSTOMER|정책 순서|모든 요청|CODE_PATTERN|SecurityConfig#policy6|evidence-url-policy-6/);
  assert.match(textOf(elements.get("inspector")), /원본 Node ID|AUTHORIZATION|url-policy-1/);
  assert.equal(findAllByClass(elements.get("inspector"), "inspector-finding").length, 1);
});

test("URL 인가 정책은 정확히 일치하는 chainKey만 직접 소속으로 사용함", () => {
  const { ui, layoutApi } = loadUi();
  const graph = flowGraphFixture();
  const addPolicy = (id, chainKey, chainOrder, connectToHandler = true) => {
    graph.nodes.push({ id, type: "AUTHORIZATION", serviceId: "orders", label: id,
      attributes: { policySource: "URL", policyKind: "AUTHENTICATED", chainKey, chainOrder }, evidenceIds: [] });
    if (connectToHandler) graph.edges.push({ id: `edge-${id}`, sourceId: "handler-a", targetId: id, type: "SECURED_BY",
      attributes: {}, confidence: "CONFIRMED", evidenceIds: [] });
  };
  addPolicy("direct-chain-b", "chain-b", "2");
  addPolicy("direct-without-edge", "chain-b", "2", false);
  addPolicy("missing-chain-key-match", "missing-chain", "9", false);
  addPolicy("chain-order-only", undefined, "2");
  addPolicy("chain-order-conflict", "chain-b", "1");
  graph.nodes.push({ id: "chain-a-duplicate", type: "SECURITY_CHAIN", serviceId: "orders", label: "duplicate",
    attributes: { chainKey: "chain-a", chainOrder: "3" }, evidenceIds: [] });
  addPolicy("ambiguous-chain-key", "chain-a", "1");

  const normalized = ui.normalizeGraph(graph);
  const plan = layoutApi.semanticLayout(normalized, { positions: {} }).plan;
  const rowsFor = (nodeId) => plan.displayModel.groups.filter((group) => group.nodeIds.includes(nodeId))
    .map((group) => group.rowId);
  const unresolvedSecurityChecks = new Set(plan.hiddenGroups.find((row) => row.id === "unresolved")?.members.securityChecks || []);

  assert.equal(rowsFor("direct-chain-b").join(","), "chain:chain-b");
  assert.equal(rowsFor("direct-without-edge").join(","), "chain:chain-b");
  assert.equal(rowsFor("chain-order-only").join(","), "chain:chain-a");
  assert.ok(unresolvedSecurityChecks.has("chain-order-conflict"));
  assert.ok(unresolvedSecurityChecks.has("ambiguous-chain-key"));
  assert.ok(unresolvedSecurityChecks.has("missing-chain-key-match"));
});

test("SECURITY_DATA 복합 항목은 실제 JWT 동작별로 분리하고 조회만으로 권한 사용을 표시하지 않음", async () => {
  const { ui, elements, window } = loadUi();
  const graph = flowGraphFixture();
  const operations = [
    { operation: "WRITE", apiType: "NIMBUS_CLAIMS_BUILDER", apiName: "claim" },
    { operation: "READ", apiType: "SPRING_SECURITY_JWT", apiName: "getClaim" },
    { operation: "SIGN", apiType: "NIMBUS_SIGNED_JWT", apiName: "sign" },
    { operation: "VERIFY_CONFIGURATION", apiType: "SPRING_SECURITY_NIMBUS_DECODER", apiName: "build",
      verificationKind: "CONFIGURATION" }
  ];
  operations.forEach(({ operation, apiType, apiName, verificationKind }, index) => {
    const id = `jwt-${operation.toLowerCase()}`;
    graph.nodes.push({ id, type: "SECURITY_DATA", serviceId: "orders", label: id,
      attributes: { operation, apiType, apiName, claimName: `claim-${index + 1}`, verificationKind,
        codeLocation: `TokenService#${operation}` }, evidenceIds: [`evidence-${id}`] });
    graph.edges.push({ id: `reads-${id}`, sourceId: "handler-a", targetId: id, type: "READS_SECURITY_DATA",
      attributes: {}, confidence: "CONFIRMED", evidenceIds: [] });
  });
  ["CREATE", "READ"].forEach((operation) => {
    const id = `authority-${operation.toLowerCase()}`;
    graph.nodes.push({ id, type: "SECURITY_DATA", serviceId: "orders", label: id,
      attributes: { dataKind: "AUTHORITY", apiType: "AUTHORITY", operation }, evidenceIds: [] });
    graph.edges.push({ id: `reads-${id}`, sourceId: "handler-a", targetId: id, type: "READS_SECURITY_DATA",
      attributes: {}, confidence: "CONFIRMED", evidenceIds: [] });
  });
  graph.evidence = graph.nodes.filter((node) => node.id.startsWith("jwt-")).map((node) => ({
    id: node.evidenceIds[0], source: "CODE_PATTERN", location: node.attributes.codeLocation, summary: node.attributes.operation
  }));
  const displays = graph.nodes.filter((node) => node.id.startsWith("jwt-"))
    .map((node) => [node.attributes.operation, window.MapInBootGraph.nodeDisplay(node).primary]);

  assert.deepEqual(displays, [
    ["WRITE", "JWT Claim 작성"],
    ["READ", "JWT Claim 조회"],
    ["SIGN", "JWT 서명"],
    ["VERIFY_CONFIGURATION", "JWT 검증 구성"]
  ]);
  assert.ok(displays.every(([, label]) => !label.includes("권한")));
  assert.equal(window.MapInBootGraph.nodeDisplay(graph.nodes.find((node) => node.id === "authority-create")).primary, "권한 생성");
  assert.equal(window.MapInBootGraph.nodeDisplay(graph.nodes.find((node) => node.id === "authority-read")).primary, "권한 정보 조회");

  ui.renderGraph(graph);
  await ui.layoutGraph();
  const plan = ui.state.layout.plan;
  const items = graph.nodes.filter((node) => node.id.startsWith("jwt-")).map((node) => compositeItemForNode(plan, node.id));
  assert.equal(items.length, 4);
  assert.ok(items.every((item) => item.originalNodeIds.length === 1), "서로 다른 JWT 동작을 한 항목에 합치지 않음");
  assert.equal(new Set(items.map((item) => item.id)).size, 4);
  const authorityItems = graph.nodes.filter((node) => node.id.startsWith("authority-"))
    .map((node) => compositeItemForNode(plan, node.id));
  assert.equal(authorityItems.length, 2);
  assert.equal(new Set(authorityItems.map((item) => item.id)).size, 2);
  const renderedItemFor = (item) => findAllByClass(elements.get("graph-nodes"), "graph-composite-item")
    .find((element) => element.getAttribute("data-composite-item-id") === item.id);
  const itemFor = (nodeId) => {
    const item = compositeItemForNode(plan, nodeId);
    assert.ok(item);
    assert.ok(renderedItemFor(item));
    return item;
  };
  for (const [nodeId, label] of [["jwt-write", "JWT Claim 작성"], ["jwt-read", "JWT Claim 조회"],
    ["jwt-sign", "JWT 서명"], ["jwt-verify_configuration", "JWT 검증 구성"]]) {
    const item = itemFor(nodeId);
    assert.equal(item.label, label);
    assert.doesNotMatch(`${item.label} ${item.detail}`, /권한 판단|인가 확인/);
  }
  const readNode = graph.nodes.find((node) => node.id === "jwt-read");
  renderedItemFor(itemFor(readNode.id)).dispatchEvent({ type: "click" });
  assert.equal(findAllByClass(elements.get("inspector"), "inspector-title")[0].textContent, "JWT Claim 조회");
  assert.match(textOf(elements.get("inspector")), /TokenService#READ/);
  assert.doesNotMatch(findAllByClass(elements.get("inspector"), "inspector-title")[0].textContent, /권한/);
});

test("SECURITY_DATA 의미별 그룹은 17개 원본 Fact를 네 종류로 묶고 Inspector 근거를 제한함", async () => {
  const { ui, elements } = loadUi();
  const graph = flowGraphFixture();
  graph.evidence = [];
  graph.findings = [];
  const kinds = [
    { prefix: "principal-read", count: 8, label: "Principal 조회", attributes: (index) => ({
      dataKind: "PRINCIPAL", apiType: "PRINCIPAL", operation: "READ", principalType: "UserDetails", apiName: `principal${index}`
    }) },
    { prefix: "jwt-write", count: 5, label: "JWT Claim 작성", attributes: (index) => ({
      dataKind: "JWT_CLAIM", apiType: "NIMBUS_CLAIMS_BUILDER", operation: "WRITE", claimName: `claim-${index}`
    }) },
    { prefix: "jwt-read", count: 1, label: "JWT Claim 조회", attributes: () => ({
      dataKind: "JWT_CLAIM", apiType: "SPRING_SECURITY_JWT", operation: "READ", claimName: "subject"
    }) },
    { prefix: "authentication-status", count: 3, label: "인증 상태 확인", attributes: (index) => ({
      sourceKind: "AUTHENTICATION", apiType: "SPRING_AUTHENTICATION", operation: "AUTH_STATUS", apiName: `isAuthenticated${index}`
    }) }
  ];
  const expectedNodeIds = [];
  kinds.forEach(({ prefix, count, attributes }) => {
    for (let index = 0; index < count; index += 1) {
      const id = `${prefix}-${index}`;
      expectedNodeIds.push(id);
      graph.nodes.push({ id, type: "SECURITY_DATA", serviceId: "orders", label: id,
        attributes: { ...attributes(index), codeLocation: `SecurityConfig#${id}` }, evidenceIds: [`evidence-${id}`] });
      graph.edges.push({ id: `edge-${id}`, sourceId: "handler-a", targetId: id,
        type: prefix === "jwt-write" ? "WRITES_SECURITY_DATA" : "READS_SECURITY_DATA",
        attributes: {}, confidence: "CONFIRMED", evidenceIds: [`edge-evidence-${id}`] });
      graph.evidence.push({ id: `evidence-${id}`, source: "CODE_PATTERN", location: `SecurityConfig#${id}`, summary: id });
    }
  });
  graph.findings = [{ id: "semantic-finding", title: "보안정보 Finding", ruleId: "PUBLIC_ENDPOINT", confidence: "LIKELY",
    nodeIds: ["jwt-write-0"], edgeIds: ["edge-jwt-write-0"], evidenceIds: ["evidence-jwt-write-0"] }];
  const originalGraph = JSON.stringify(graph);

  ui.renderGraph(graph);
  await ui.layoutGraph();

  const plan = ui.state.layout.plan;
  const rowId = "chain:chain-a";
  const row = plan.hiddenGroups.find((group) => group.id === rowId);
  const items = plan.displayModel.composites.filter((card) => card.kind === "SECURITY_DATA" && card.rowId === rowId)
    .flatMap((card) => card.items).filter((item) => item.originalNodeIds.some((id) => expectedNodeIds.includes(id)));
  assert.equal(items.length, 4);
  const groupedIds = Array.from(items).flatMap((item) => Array.from(item.originalNodeIds));
  assert.equal(groupedIds.length, 17);
  assert.deepEqual(Array.from(groupedIds).sort(), expectedNodeIds.slice().sort());
  const labels = Array.from(items, (item) => [item.label, item.originalNodeIds.length])
    .sort((left, right) => left[0].localeCompare(right[0]));
  assert.deepEqual(labels, [
    ["JWT Claim 작성", 5], ["JWT Claim 조회", 1], ["Principal 조회", 8], ["인증 상태 확인", 3]
  ].sort((left, right) => left[0].localeCompare(right[0])));
  const securityCards = plan.displayModel.composites.filter((card) => card.kind === "SECURITY_DATA" && card.rowId === rowId);
  assert.ok(securityCards.every((card) => card.bounds.y >= row.rowTop
    && card.bounds.y + card.bounds.height <= row.rowBottom));
  assert.ok(items.every((item) => {
    const card = plan.displayModel.cardById[item.cardId];
    return item.bounds.y >= card.contentBounds.y
      && item.bounds.y + item.bounds.height <= card.contentBounds.y + card.contentBounds.height;
  }));

  const principalItem = items.find((item) => item.originalNodeIds[0].startsWith("principal-read"));
  const renderedPrincipal = findAllByClass(elements.get("graph-nodes"), "graph-composite-item")
    .find((element) => element.getAttribute("data-composite-item-id") === principalItem.id);
  renderedPrincipal.dispatchEvent({ type: "click" });
  const factLinks = findAllByClass(elements.get("inspector"), "inspector-link")
    .map((link) => link.getAttribute("data-node-id"))
    .filter((id) => expectedNodeIds.includes(id));
  assert.deepEqual(Array.from(factLinks).sort(), expectedNodeIds.filter((id) => id.startsWith("principal-read-")).sort());
  assert.match(textOf(elements.get("inspector")), /evidence-principal-read-0/);
  assert.doesNotMatch(textOf(elements.get("inspector")), /evidence-jwt-write-0/);
  assert.equal(JSON.stringify(graph), originalGraph, "Display Group 분할이 원본 Graph, Evidence, Finding을 변경하지 않음");
});

test("전체 MAP의 API와 Controller 복합 카드는 같은 Chain 행에서 정확한 항목 관계로 연결됨", async () => {
  const { ui, elements, layoutApi, window } = loadUi();
  const graph = flowGraphFixture();
  ui.state.includeUnconnectedNodes = true;
  const endpointIds = [];
  for (let index = 0; index < 16; index += 1) {
    const controller = `com.example.LayoutController${String(index % 4).padStart(2, "0")}`;
    const handler = `${controller}#handle${index}`;
    const endpointId = `stagger-endpoint-${String(index).padStart(2, "0")}`;
    const handlerId = `stagger-handler-${String(index).padStart(2, "0")}`;
    endpointIds.push(endpointId);
    graph.nodes.push(
      { id: endpointId, type: "ENDPOINT", serviceId: "orders", label: `GET /stagger/${index}`,
        attributes: { httpMethod: "GET", path: `/stagger/${String(index).padStart(2, "0")}`, handler }, evidenceIds: [] },
      { id: handlerId, type: "HANDLER", serviceId: "orders", label: handler, attributes: { handler }, evidenceIds: [] }
    );
    graph.edges.push({ id: `stagger-match-${index}`, sourceId: endpointId, targetId: "chain-a", type: "MATCHED_BY",
      confidence: "CONFIRMED", attributes: { chainOrder: "1" }, evidenceIds: [] });
    graph.edges.push({ id: `stagger-mapping-${index}`, sourceId: endpointId, targetId: handlerId, type: "FLOWS_TO",
      confidence: "CONFIRMED", attributes: { flowKind: "HANDLER" }, evidenceIds: [] });
  }
  ui.renderGraph(graph);
  await ui.layoutGraph();
  const plan = ui.state.layout.plan;
  const row = plan.hiddenGroups.find((group) => group.id === "chain:chain-a");
  const rowB = plan.hiddenGroups.find((group) => group.id === "chain:chain-b");
  const apiCards = plan.displayModel.composites.filter((card) => card.kind === "API_MAPPING" && card.rowId === row.id
    && card.key.includes("LayoutController"));
  const handlerCards = plan.displayModel.composites.filter((card) => card.kind === "CONTROLLER_HANDLER" && card.rowId === row.id
    && card.key.includes("LayoutController"));
  assert.equal(plan.lanes.find((lane) => lane.id === "endpoint").columns, 2);
  assert.equal(plan.lanes.find((lane) => lane.id === "handler").columns, 2);
  assert.equal(apiCards.length, 4, JSON.stringify({ rowId: row.id,
    cards: plan.displayModel.composites.map(({ kind, key, rowId }) => ({ kind, key, rowId })) }));
  assert.equal(handlerCards.length, 4);
  assert.equal(new Set(apiCards.map((card) => card.bounds.x)).size, 2, "API 복합 카드가 두 열을 사용함");
  assert.equal(new Set(handlerCards.map((card) => card.bounds.x)).size, 2, "Controller 복합 카드가 두 열을 사용함");
  apiCards.concat(handlerCards).forEach((card) => {
    assert.ok(card.bounds.y >= row.rowTop && card.bounds.y + card.bounds.height <= row.rowBottom,
      `${card.kind} 카드가 Chain 행 안에 있음`);
  });
  assert.ok(rowB.rowTop > row.rowBottom, "확장된 Chain 행이 다음 행과 겹치지 않음");
  const flowIndex = window.MapInBootFlow.createIndex(ui.normalizeGraph(graph));
  const mappings = plan.overviewRouting.relations.filter((relation) => relation.role === "API_MAPPING"
    && relation.relatedNodeIds.some((id) => endpointIds.includes(id)));
  assert.equal(mappings.length, 16);
  endpointIds.forEach((endpointId) => {
    const match = flowIndex.handlerFor(endpointId);
    assert.equal(match.status, "CONFIRMED");
    const relation = mappings.find((item) => item.relatedNodeIds.includes(endpointId));
    assert.ok(relation);
    const sourceItem = plan.displayModel.itemById[relation.sourceItemId];
    const targetItem = plan.displayModel.itemById[relation.targetItemId];
    assert.ok(sourceItem.originalNodeIds.includes(endpointId));
    assert.ok(targetItem.originalNodeIds.includes(match.node.id));
    assert.ok(plan.overviewRouting.routesByRelationId[relation.id]);
    assert.ok(findAllByClass(elements.get("graph-edges"), "graph-overview-segment")
      .some((path) => (path.getAttribute("data-relation-ids") || "").split(",").includes(relation.id)),
    JSON.stringify({ relation, route: plan.overviewRouting.routesByRelationId[relation.id],
      segments: plan.overviewRouting.segments.filter((segment) => segment.relationIds.includes(relation.id)),
      rendered: findAllByClass(elements.get("graph-edges"), "graph-overview-segment")
        .map((path) => path.getAttribute("data-relation-ids")) }));
  });
  apiCards.forEach((apiCard) => {
    const handlerCard = handlerCards.find((card) => card.key === apiCard.key);
    assert.ok(handlerCard);
    assert.equal(apiCard.items.filter((item) => !item.isHeader).length, 4);
    assert.equal(handlerCard.items.filter((item) => !item.isHeader).length, 4);
    assert.equal(apiCard.bounds.y + apiCard.bounds.height / 2,
      handlerCard.bounds.y + handlerCard.bounds.height / 2, `${apiCard.key}의 API/Controller 카드 정렬`);
  });

  const singleColumnGraph = flowGraphFixture();
  singleColumnGraph.nodes.push(
    { id: "single-endpoint-1", type: "ENDPOINT", serviceId: "orders", label: "GET /single/1",
      attributes: { httpMethod: "GET", path: "/single/1", handler: "SingleController#one" }, evidenceIds: [] },
    { id: "single-handler-1", type: "HANDLER", serviceId: "orders", label: "SingleController#one",
      attributes: { handler: "SingleController#one" }, evidenceIds: [] },
    { id: "single-endpoint-2", type: "ENDPOINT", serviceId: "orders", label: "GET /single/2",
      attributes: { httpMethod: "GET", path: "/single/2", handler: "SingleController#two" }, evidenceIds: [] },
    { id: "single-handler-2", type: "HANDLER", serviceId: "orders", label: "SingleController#two",
      attributes: { handler: "SingleController#two" }, evidenceIds: [] }
  );
  singleColumnGraph.edges.push(
    { id: "single-match-1", sourceId: "single-endpoint-1", targetId: "chain-a", type: "MATCHED_BY", confidence: "CONFIRMED", attributes: {}, evidenceIds: [] },
    { id: "single-match-2", sourceId: "single-endpoint-2", targetId: "chain-a", type: "MATCHED_BY", confidence: "CONFIRMED", attributes: {}, evidenceIds: [] }
  );
  const singlePlan = layoutApi.semanticLayout(ui.normalizeGraph(singleColumnGraph), { positions: {} }).plan;
  const singleRow = singlePlan.hiddenGroups.find((group) => group.id === "chain:chain-a");
  const singleApiCards = singlePlan.displayModel.composites.filter((card) => card.kind === "API_MAPPING"
    && card.rowId === singleRow.id && card.originalNodeIds.some((id) => id.startsWith("single-endpoint-")));
  assert.equal(singlePlan.lanes.find((lane) => lane.id === "endpoint").columns, 1);
  assert.equal(singleApiCards.length, 1);
  assert.equal(singleApiCards[0].items.filter((item) => !item.isHeader).length, 2);
});

test("Detail 이동 후 카드 항목은 부모 카드의 상대 좌표를 유지함", async () => {
  const { ui } = loadUi();
  const graph = detailGraphFixture();
  const runtimeComponent = (id, kind, parentId = null) => ({
    id, kind, className: `example.${kind}`, beanName: null, contextId: "app", parentId,
    attributes: {}, graphNodeIds: [], evidenceIds: []
  });
  graph.runtimeArchitecture = {
    environment: { webApplicationType: "SERVLET", serverKind: "TOMCAT", deploymentMode: "EMBEDDED" },
    components: [
      runtimeComponent("layout-host", "APPLICATION_CONTEXT"),
      runtimeComponent("layout-servlet", "SERVLET_CONTEXT", "layout-host"),
      runtimeComponent("layout-security", "AUTHENTICATION_MANAGER", "layout-host"),
      runtimeComponent("layout-mvc", "HANDLER_ADAPTER", "layout-host")
    ],
    relationships: [],
    coverage: ["WEB_SERVER", "SERVLET", "SECURITY", "MVC"].map((area) => ({
      collectorId: area.toLowerCase(), area, scope: "app", state: "PRESENT", reasonCode: "OBSERVED", evidenceIds: []
    }))
  };
  ui.renderGraph(graph);
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();
  const plan = ui.state.layout.plan;

  assert.ok(plan.detailBlueprint.cards.length > 0);
  const projectionById = new Map(plan.projection.nodes.map((projection) => [projection.id, projection]));
  plan.detailBlueprint.cards.forEach((card) => {
    let expectedY = card.contentBounds.y;
    card.items.forEach((item) => {
      assert.equal(card.itemBoundsById[item.id], item.bounds, item.id + " Bounds 참조 일치");
      assert.ok(item.bounds.right <= card.bounds.right && item.bounds.bottom <= card.bounds.bottom,
        item.id + "가 카드 안에 배치됨");
      (item.projectionNodeIds || []).forEach((id) => {
        const projection = projectionById.get(id);
        if (projection) {
          assert.deepEqual([projection.position.x, projection.position.y, projection.width, projection.height],
            [item.bounds.x, item.bounds.y, item.bounds.width, item.bounds.height], id + " Projection 위치 일치");
        } else {
          assert.ok(plan.displayModel.projectionToItemIds[id]?.includes(item.id), id + " Runtime Alias 보존");
        }
      });
      assert.equal(item.bounds.x, card.bounds.x + 14, `${card.id}/${item.id}의 좌우 간격 유지`);
      if (!item.isHeader) {
        assert.equal(item.bounds.y, expectedY, `${card.id}/${item.id}의 세로 배치 유지`);
        expectedY = item.bounds.bottom + 8;
      }
    });
  });
});

test("Detail 외부 Port는 카드 외곽에 표시되고 내부 학습선은 표시하지 않음", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(detailGraphFixture());
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();
  const model = ui.state.layout.plan.displayModel;
  assert.equal(findAllByClass(elements.get("graph-nodes"), "graph-learning-segment").length, 0);
  assert.ok(model.ports.length > 0);
  for (const port of model.ports) {
    const item = model.itemById[port.itemId];
    const card = model.cardById[item.cardId];
    const row = findAllByClass(elements.get("graph-nodes"), "graph-composite-item")
      .find((element) => element.getAttribute("data-composite-item-id") === item.id);
    const rendered = findAllByClass(row, "graph-composite-port")
      .find((element) => element.getAttribute("data-port-ids") === port.id);
    assert.ok(rendered);
    assert.equal(Number(rendered.getAttribute("cx")), port.x - item.bounds.x);
    assert.equal(Number(rendered.getAttribute("cy")), port.y - item.bounds.y);
    if (port.side === "LEFT") assert.equal(port.x, card.bounds.x);
    if (port.side === "RIGHT") assert.equal(port.x, card.bounds.right);
    if (port.side === "TOP") assert.equal(port.y, card.bounds.y);
    if (port.side === "BOTTOM") assert.equal(port.y, card.bounds.bottom);
  }
});

test("Overview와 Detail은 각 전용 Composite Blueprint 내부 처리 모델을 사용함", () => {
  const { ui, layoutApi } = loadUi();
  const graph = ui.normalizeGraph(detailGraphFixture());
  const overview = layoutApi.semanticLayout({ ...graph, presentationContext: "overview" }, { positions: {} });
  const detail = layoutApi.semanticLayout({ ...graph, presentationContext: "detail" }, { positions: {} });
  assert.equal(overview.plan.projection.nodes.length, 0);
  assert.equal(overview.plan.displayModel.instances.some((item) => item.originalNodeIds.includes("servlet-1")), false);
  assert.deepEqual(Array.from(overview.plan.lanes, (lane) => lane.id),
    ["servlet-filter", "security-chain", "security-checks", "endpoint", "handler"]);
  assert.ok(overview.plan.displayModel.composites.length > 0);
  assert.ok(detail.plan.projection.nodes.some((node) => node.id === "education-handler-mapping"));
  assert.ok(detail.plan.lanes.some((lane) => lane.id === "mvc"));
  assert.ok(detail.plan.lanes.some((lane) => lane.id === "security-filter"));
  assert.ok(detail.plan.displayModel.composites.length > 0);
  assert.ok(detail.plan.displayModel.composites.every((card) => card.displayKind === "composite-card"));
  assert.ok(detail.plan.overviewRouting.relations.length > 0);
  assert.equal(detail.plan.overviewRouting.unresolved.length, 0,
    JSON.stringify(detail.plan.overviewRouting.unresolved));
});

test("Detail 주 처리 관계는 원본 방향을 유지하고 가로 Port를 사용함", () => {
  const { ui, layoutApi } = loadUi();
  const graph = ui.normalizeGraph(detailGraphFixture());
  const plan = layoutApi.semanticLayout({ ...graph, presentationContext: "detail" }, { positions: {} }).plan;
  const cardForNode = (id) => plan.displayModel.composites.find((card) => card.originalNodeIds.includes(id));
  const endpoint = cardForNode("endpoint-a");
  const handler = cardForNode("handler-a");
  const relation = plan.overviewRouting.relations.find((item) => item.originalEdgeIds.includes("handler-map-a"));
  const sourcePort = plan.displayModel.portById[relation.visualSourcePortId];
  const targetPort = plan.displayModel.portById[relation.visualTargetPortId];

  assert.ok(endpoint && handler && relation);
  assert.ok(handler.bounds.x > endpoint.bounds.x, "선택 Endpoint 오른쪽에 Handler 배치");
  assert.equal(relation.originalSourceInstanceId, endpoint.id);
  assert.equal(relation.originalTargetInstanceId, handler.id);
  assert.equal(relation.visualDirection, "ORIGINAL");
  assert.equal(sourcePort.side, "RIGHT");
  assert.equal(targetPort.side, "LEFT");
  assert.equal(plan.overviewRouting.unresolved.length, 0, JSON.stringify(plan.overviewRouting.unresolved.map((item) => {
    const edge = plan.overviewRouting.relations.find((relation) => relation.id === item.relationId);
    return { ...item, source: edge && plan.displayModel.cardById[edge.sourceInstanceId].bounds,
      target: edge && plan.displayModel.cardById[edge.targetInstanceId].bounds,
      sourcePort: edge && plan.displayModel.portById[edge.visualSourcePortId],
      targetPort: edge && plan.displayModel.portById[edge.visualTargetPortId] };
  })));
});

test("확정된 마지막 Filter는 같은 Chain의 URL 정책만 향함", () => {
  const { ui, layoutApi } = loadUi();
  const snapshot = detailGraphFixture();
  snapshot.nodes.push({ id: "url-policy", type: "AUTHORIZATION", serviceId: "orders", label: "URL policy",
    attributes: { policySource: "URL", chainKey: "chain-a", chainOrder: "1" }, evidenceIds: [] });
  const graph = ui.normalizeGraph(snapshot);
  const plan = layoutApi.semanticLayout({ ...graph, presentationContext: "overview" }, { positions: {} }).plan;
  const relation = plan.overviewRouting.relations.find((item) => item.flowGroup === "chain-a"
    && item.presentationKind === "CONCEPTUAL_REFERENCE" && item.relatedNodeIds.includes("url-policy"));
  assert.ok(relation);
  const sourceItem = plan.displayModel.itemById[relation.sourceItemId];
  const targetItem = plan.displayModel.itemById[relation.targetItemId];
  assert.ok(sourceItem.originalNodeIds.includes("security-filter-2"));
  assert.ok(targetItem.originalNodeIds.includes("url-policy"));
  assert.ok(plan.overviewRouting.routesByRelationId[relation.id]);
  assert.equal(plan.projection.edges.some((item) => item.id.startsWith("filter-to-dispatcher-")), false);
});

test("순서 미확정 Chain과 Method 정책은 마지막 Filter 진행선에서 제외됨", () => {
  const { ui, layoutApi } = loadUi();
  const snapshot = detailGraphFixture();
  snapshot.nodes.push({ id: "method-policy", type: "AUTHORIZATION", serviceId: "orders", label: "Method policy",
    attributes: { policySource: "METHOD" }, evidenceIds: [] });
  snapshot.edges.push({ id: "method-edge", sourceId: "security-filter-2", targetId: "method-policy", type: "SECURED_BY",
    attributes: {}, confidence: "CONFIRMED", evidenceIds: [] });
  let graph = ui.normalizeGraph(snapshot);
  let plan = layoutApi.semanticLayout({ ...graph, presentationContext: "overview" }, { positions: {} }).plan;
  assert.equal(plan.projection.edges.some((edge) => (edge.relatedNodeIds || []).includes("method-policy")), false);
  snapshot.edges.find((edge) => edge.id === "security-filtered-2").attributes.filterOrder = "1";
  graph = ui.normalizeGraph(snapshot);
  plan = layoutApi.semanticLayout({ ...graph, presentationContext: "overview" }, { positions: {} }).plan;
  assert.notEqual(plan.chainFilterOrderStatus["chain-a"], "CONFIRMED");
  assert.equal(plan.projection.edges.some((edge) => edge.id.startsWith("filter-to-check-chain-a-")), false);
});

test("Overview 렌더와 Mini Map에서 DispatcherServlet을 제외하고 Detail에서는 유지함", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(detailGraphFixture());
  ui.selectView("all-flow");
  await ui.layoutGraph();
  assert.equal(findAllByClass(elements.get("graph-nodes"), "graph-node")
    .some((node) => node.getAttribute("data-node-id") === "servlet-1"), false);
  assert.equal(ui.state.graphRender.displayNodes.some((node) => node.originalNodeIds?.includes("servlet-1")), false);
  assert.equal(elements.get("graph-minimap-nodes").children.some((node) =>
    node.getAttribute("data-node-id") === "servlet-1"), false);
  ui.selectView("feature-flow");
  await ui.layoutGraph();
  assert.ok(ui.state.layout.plan.projection.nodes.some((node) => node.id === "education-handler-mapping"));
});

test("Overview는 다른 실제 Servlet을 DispatcherServlet으로 취급하지 않음", () => {
  const { ui, layoutApi } = loadUi();
  const snapshot = detailGraphFixture();
  snapshot.nodes.push({ id: "other-servlet", type: "SERVLET", serviceId: "orders", label: "CustomServlet",
    attributes: { servletKind: "SERVLET", servletClass: "com.example.CustomServlet" }, evidenceIds: [] });
  const graph = ui.normalizeGraph(snapshot);
  const layout = layoutApi.semanticLayout({ ...graph, presentationContext: "overview" }, { positions: {} });
  assert.equal(layout.plan.displayModel.instances.some((instance) => instance.originalNodeIds.includes("servlet-1")), false);
  assert.equal(layout.plan.displayModel.instances.some((instance) => instance.originalNodeIds.includes("other-servlet")), true);
  assert.equal(graph.nodes.some((node) => node.id === "servlet-1"), true);
});

test("Overview 배선은 목적지 앞 공통 선분을 공유하고 각 관계의 연결 순서를 보존함", () => {
  const { layoutApi } = loadUi();
  const instances = [
    { id: "source", position: { x: 0, y: 180 } },
    { id: "a", position: { x: 1000, y: 0 } },
    { id: "b", position: { x: 1000, y: 360 } }
  ];
  const relations = [
    { id: "one", sourceInstanceId: "source", targetInstanceId: "a", rowId: "row", role: "evidence" },
    { id: "two", sourceInstanceId: "source", targetInstanceId: "b", rowId: "row", role: "evidence" }
  ];
  const plan = layoutApi.routeOverview(instances, relations);
  assert.deepEqual(Array.from(plan.unresolved), []);
  const first = plan.routesByRelationId.one;
  const second = plan.routesByRelationId.two;
  const shared = first.orderedSegmentIds.filter((id) => second.orderedSegmentIds.includes(id));
  assert.ok(shared.length > 0);
  const segments = new Map(plan.segments.map((segment) => [segment.id, segment]));
  assert.ok(shared.some((id) => Math.abs(segments.get(id).to.x - segments.get(id).from.x) > 500));
  for (const route of [first, second]) {
    let point = route.sourcePort;
    for (const id of route.orderedSegmentIds) {
      const segment = segments.get(id);
      const same = (a, b) => a.x === b.x && a.y === b.y;
      assert.ok(same(point, segment.from) || same(point, segment.to));
      point = same(point, segment.from) ? segment.to : segment.from;
    }
    assert.deepEqual(point, route.targetPort);
  }
});

test("동일 카드의 여섯 Target Port는 하나의 Junction과 여섯 Branch로 연결함", () => {
  const { layoutApi } = loadUi();
  const instances = [
    { id: "source", position: { x: 0, y: 240, width: 260, height: 120 } },
    { id: "authorization-card", position: { x: 1200, y: 60, width: 420, height: 520 } }
  ];
  const ports = [
    { id: "source-output", itemId: "source-item", side: "RIGHT", x: 260, y: 300 },
    ...Array.from({ length: 6 }, (_, index) => ({ id: `target-input-${index}`, itemId: `target-item-${index}`,
      side: "LEFT", x: 1200, y: 100 + index * 88 }))
  ];
  const relations = Array.from({ length: 6 }, (_, index) => [0, 1].map((duplicate) => ({
    id: `secured-${index}-${duplicate}`, sourceInstanceId: "source", targetInstanceId: "authorization-card",
    visualSourcePortId: "source-output", visualTargetPortId: `target-input-${index}`,
    rowId: "chain:main", role: "ANALYSIS_REFERENCE", type: "SECURED_BY"
  }))).flat();
  const plan = layoutApi.routeOverview(instances, relations, [], null, 0, ports);

  assert.deepEqual(Array.from(plan.unresolved), []);
  assert.equal(plan.junctions.length, 1);
  const [junction] = plan.junctions;
  const segments = new Map(plan.segments.map((segment) => [segment.id, segment]));
  const branches = plan.segments.filter((segment) => segment.fromJunctionId === junction.id);
  const trunks = plan.segments.filter((segment) => segment.toJunctionId === junction.id);
  assert.equal(branches.length, 6);
  assert.equal(trunks.length, 1);
  assert.equal(trunks[0].routeRole, "TRUNK");
  assert.equal(trunks[0].relationIds.length, relations.length);
  assert.equal(plan.segments.some((segment) => segment.routeRole === "SPLIT_BUS"), false);
  assert.deepEqual(Array.from(new Set(branches.map((segment) => `${segment.to.x},${segment.to.y}`))).sort(),
    ports.slice(1).map((port) => `${port.x},${port.y}`).sort());
  assert.deepEqual(Array.from(new Set(plan.junctions.flatMap((item) => item.segmentIds))).sort(),
    Array.from(segments.keys()).sort());
  assert.deepEqual(Array.from(new Set(plan.segments.flatMap((segment) => segment.relationIds))).sort(),
    relations.map((relation) => relation.id).sort());
});

test("동일 Target Port의 Fan-in은 Source Port마다 Branch 하나와 공통 Trunk를 사용함", () => {
  const { layoutApi } = loadUi();
  const instances = [
    ...Array.from({ length: 3 }, (_, index) => ({ id: `source-${index}`,
      position: { x: 0, y: index * 240, width: 260, height: 120 } })),
    { id: "target", position: { x: 1120, y: 240, width: 380, height: 160 } }
  ];
  const ports = [
    ...Array.from({ length: 3 }, (_, index) => ({ id: `source-port-${index}`, itemId: `source-item-${index}`,
      side: "RIGHT", x: 260, y: index * 240 + 60 })),
    { id: "target-port", itemId: "target-item", side: "LEFT", x: 1120, y: 320 }
  ];
  const relations = Array.from({ length: 3 }, (_, index) => [0, 1].map((duplicate) => ({
    id: `fanin-${index}-${duplicate}`, sourceInstanceId: `source-${index}`, targetInstanceId: "target",
    visualSourcePortId: `source-port-${index}`, visualTargetPortId: "target-port",
    rowId: "chain:main", role: "ANALYSIS_REFERENCE", type: "SECURED_BY"
  }))).flat();
  const plan = layoutApi.routeOverview(instances, relations, [], null, 0, ports);

  assert.deepEqual(Array.from(plan.unresolved), []);
  assert.equal(plan.junctions.length, 1, JSON.stringify({ unresolved: plan.unresolved,
    segments: plan.segments.map(({ id, from, to, routeRole, relationIds, fromJunctionId, toJunctionId }) =>
      ({ id, from, to, routeRole, relationIds, fromJunctionId, toJunctionId })) }));
  const [junction] = plan.junctions;
  const branches = plan.segments.filter((segment) => segment.toJunctionId === junction.id);
  const trunks = plan.segments.filter((segment) => segment.fromJunctionId === junction.id);
  assert.equal(branches.length, 3);
  assert.equal(trunks.length, 1);
  assert.equal(trunks[0].routeRole, "TRUNK");
  assert.deepEqual(Array.from(new Set(branches.flatMap((segment) => segment.relationIds))).sort(),
    relations.map((relation) => relation.id).sort());
  assert.deepEqual(Array.from(new Set(trunks[0].relationIds)).sort(), relations.map((relation) => relation.id).sort());
  assert.equal(plan.segments.some((segment) => segment.routeRole === "SPLIT_BUS"), false);
});

test("서로 독립적인 교차는 직접 Bézier와 관계 의미를 유지하고 Junction을 만들지 않음", () => {
  const { layoutApi } = loadUi();
  const instances = [
    { id: "source-top", position: { x: 0, y: 0, width: 200, height: 120 } },
    { id: "target-bottom", position: { x: 700, y: 420, width: 200, height: 120 } },
    { id: "source-bottom", position: { x: 0, y: 500, width: 200, height: 120 } },
    { id: "target-top", position: { x: 700, y: 0, width: 200, height: 120 } }
  ];
  const relations = [
    { id: "top-to-bottom", sourceInstanceId: "source-top", targetInstanceId: "target-bottom",
      rowId: "row-a", role: "API_MAPPING", type: "FLOWS_TO" },
    { id: "bottom-to-top", sourceInstanceId: "source-bottom", targetInstanceId: "target-top",
      rowId: "row-b", role: "API_MAPPING", type: "FLOWS_TO" }
  ];
  const plan = layoutApi.routeOverview(instances, relations);

  assert.deepEqual(Array.from(plan.unresolved), []);
  assert.deepEqual(Array.from(plan.junctions), []);
  relations.forEach((relation) => {
    const route = plan.routesByRelationId[relation.id];
    assert.ok(route, relation.id);
    assert.equal(route.orderedSegmentIds.length, 1, relation.id);
    assert.equal(plan.segments.find((segment) => segment.id === route.orderedSegmentIds[0]).geometry?.kind, "CUBIC");
  });
});

test("수직 Port 사이의 직접 경로는 아래쪽으로 진행하는 Bézier를 사용함", () => {
  const { layoutApi } = loadUi();
  const instances = [
    { id: "vertical-source", position: { x: 120, y: 80, width: 380, height: 120 } },
    { id: "vertical-target", position: { x: 220, y: 500, width: 380, height: 120 } }
  ];
  const ports = [
    { id: "vertical-out", itemId: "vertical-out-item", side: "BOTTOM", x: 310, y: 200 },
    { id: "vertical-in", itemId: "vertical-in-item", side: "TOP", x: 410, y: 500 }
  ];
  const relation = { id: "vertical-flow", sourceInstanceId: "vertical-source", targetInstanceId: "vertical-target",
    visualSourcePortId: "vertical-out", visualTargetPortId: "vertical-in", rowId: "detail", role: "STRUCTURAL_FLOW", type: "FLOWS_TO" };
  const plan = layoutApi.routeOverview(instances, [relation], [], null, 0, ports);
  const route = plan.routesByRelationId[relation.id];
  const segment = plan.segments.find((item) => route.orderedSegmentIds.includes(item.id));

  assert.deepEqual(Array.from(plan.unresolved), []);
  assert.equal(plan.junctions.length, 0);
  assert.equal(segment.geometry.kind, "CUBIC");
  assert.ok(segment.geometry.controlPoints[0].y > segment.from.y);
  assert.ok(segment.geometry.controlPoints[1].y < segment.to.y);
});

test("카드 사이의 내부 통로를 사용하고 Row 밖으로 외곽 우회하지 않음", () => {
  const { layoutApi } = loadUi();
  const instances = [
    { id: "source", position: { x: 0, y: 160, width: 300, height: 120 } },
    { id: "obstacle", position: { x: 370, y: 160, width: 350, height: 120 } },
    { id: "target", position: { x: 900, y: 160, width: 200, height: 120 } }
  ];
  const relation = { id: "internal-corridor", sourceInstanceId: "source", targetInstanceId: "target",
    rowId: "row", role: "API_MAPPING", type: "FLOWS_TO" };
  const row = { id: "row", rowTop: 80, rowBottom: 360 };
  const plan = layoutApi.routeOverview(instances, [relation], [row]);

  assert.deepEqual(Array.from(plan.unresolved), []);
  const route = plan.routesByRelationId[relation.id];
  assert.ok(route);
  const segments = route.orderedSegmentIds.map((id) => plan.segments.find((segment) => segment.id === id));
  const routePoints = segments.flatMap((segment) => [segment.from, ...(segment.geometry?.controlPoints || []), segment.to]);
  assert.ok(routePoints.every((point) => point.y >= row.rowTop && point.y <= row.rowBottom),
    "경로가 허용된 내부 Row 범위를 유지함");
  assert.ok(routePoints.every((point) => point.x >= 0 && point.x <= 1100), "경로가 카드 사이 내부 통로에 머묾");
  assert.ok(routePoints.some((point) => point.y < instances[1].position.y)
    && routePoints.some((point) => point.x > instances[1].position.x + instances[1].position.width),
  "장애물보다 위쪽 여유 통로를 이용함");
  assert.ok(segments.some((segment) => segment.geometry?.kind === "CUBIC"), "굴곡을 Bézier로 렌더링함");
});

test("독립 관계 그룹은 기존 Junction과 좌표만으로 합쳐지지 않음", () => {
  const { layoutApi } = loadUi();
  const instances = [
    { id: "source", position: { x: 0, y: 180, width: 300, height: 120 } },
    { id: "first-target", position: { x: 1500, y: 0, width: 300, height: 120 } },
    { id: "second-target", position: { x: 1500, y: 360, width: 300, height: 120 } },
    { id: "branch-target", position: { x: 875, y: 180, width: 300, height: 120 } },
    { id: "branch-source", position: { x: 2100, y: 600, width: 300, height: 120 } }
  ];
  const relations = [
    { id: "first", sourceInstanceId: "source", targetInstanceId: "first-target",
      rowId: "row", role: "evidence", type: "SECURED_BY" },
    { id: "second", sourceInstanceId: "source", targetInstanceId: "second-target",
      rowId: "row", role: "evidence", type: "SECURED_BY" },
    { id: "branch", sourceInstanceId: "branch-source", targetInstanceId: "branch-target",
      rowId: "row", role: "z-analysis", type: "ZZ_TEST" }
  ];
  const plan = layoutApi.routeOverview(instances, relations);
  assert.deepEqual(Array.from(plan.unresolved), []);
  const sharedIds = plan.routesByRelationId.first.orderedSegmentIds
    .filter((id) => plan.routesByRelationId.second.orderedSegmentIds.includes(id));
  assert.ok(sharedIds.length > 0);
  const shared = sharedIds.map((id) => plan.segments.find((segment) => segment.id === id));
  assert.ok(shared.some((segment) => segment.relationIds.includes("first") && segment.relationIds.includes("second")));
  assert.equal(shared.some((segment) => segment.relationIds.includes("branch")), false);
  assert.equal(sharedIds.some((id) => plan.routesByRelationId.branch.orderedSegmentIds.includes(id)), false);
  assert.equal(plan.junctions.some((item) => item.relationIds.includes("branch")), false);
});

test("Overview SVG는 새 배선 계획의 물리 선분을 한 번씩 표시함", async () => {
  const { ui, elements } = loadUi();
  const snapshot = detailGraphFixture();
  ui.renderGraph(snapshot);
  await ui.layoutGraph();
  const plan = ui.state.layout.plan.overviewRouting;
  assert.ok(plan && plan.segments.length > 0);
  const segments = findAllByClass(elements.get("graph-edges"), "graph-overview-segment");
  assert.equal(segments.length, plan.segments.length);
  assert.equal(new Set(segments.map((path) => path.getAttribute("data-segment-id"))).size, plan.segments.length);
});

test("Overview 배선은 표시 관계를 누락하지 않고 해결함", () => {
  const { ui, layoutApi } = loadUi();
  const graph = ui.normalizeGraph(detailGraphFixture());
  const layout = layoutApi.semanticLayout({ ...graph, presentationContext: "overview" }, { positions: {} });
  const plan = layout.plan.overviewRouting;
  assert.deepEqual(Array.from(plan.unresolved), [], JSON.stringify({
    relations: plan.relations.map((relation) => ({ id: relation.id, source: relation.sourceInstanceId,
      target: relation.targetInstanceId, sourcePort: relation.visualSourcePortId, targetPort: relation.visualTargetPortId })),
    unresolved: plan.unresolved,
    cards: layout.plan.displayModel.instances.map((instance) => ({ id: instance.id, position: instance.position })),
    segments: plan.segments.map((segment) => ({ id: segment.id, from: segment.from, to: segment.to,
      role: segment.routeRole, relations: segment.relationIds }))
  }));
  for (const relation of plan.relations) assert.ok(plan.routesByRelationId[relation.id], relation.id);
});

test("장애물이 없는 독립 API–Handler 관계는 실제 Port를 잇는 단일 Bézier로 계획함", () => {
  const { layoutApi } = loadUi();
  const instances = [
    { id: "api", position: { x: 0, y: 0, width: 400, height: 120 } },
    { id: "handler", position: { x: 900, y: 220, width: 360, height: 140 } }
  ];
  const relation = { id: "api-handler", rowId: "row", role: "API_MAPPING", type: "FLOWS_TO",
    sourceInstanceId: "api", targetInstanceId: "handler" };
  const plan = layoutApi.routeOverview(instances, [relation]);
  const route = plan.routesByRelationId[relation.id];
  assert.deepEqual(Array.from(plan.unresolved), []);
  assert.ok(route);
  assert.equal(route.orderedSegmentIds.length, 1);
  const segment = plan.segments.find((item) => item.id === route.orderedSegmentIds[0]);
  assert.equal(segment.geometry?.kind, "CUBIC");
  assert.deepEqual(segment.from, route.sourcePort);
  assert.deepEqual(segment.to, route.targetPort);
  assert.equal(segment.relationIds.includes(relation.id), true);
});

test("Controller Handler 항목 순서는 명시 FLOWS_TO의 API 순서를 따름", () => {
  const { ui, layoutApi } = loadUi();
  const handler = "example.SharedController";
  const snapshot = {
    nodes: [
      { id: "endpoint-z", type: "ENDPOINT", serviceId: "orders", label: "GET /z",
        attributes: { httpMethod: "GET", path: "/z", handler: `${handler}#alpha` }, evidenceIds: [] },
      { id: "endpoint-a", type: "ENDPOINT", serviceId: "orders", label: "GET /a",
        attributes: { httpMethod: "GET", path: "/a", handler: `${handler}#zeta` }, evidenceIds: [] },
      { id: "handler-z", type: "HANDLER", serviceId: "orders", label: `${handler}#zeta`,
        attributes: { handler: `${handler}#zeta` }, evidenceIds: [] },
      { id: "handler-a", type: "HANDLER", serviceId: "orders", label: `${handler}#alpha`,
        attributes: { handler: `${handler}#alpha` }, evidenceIds: [] }
    ],
    edges: [
      { id: "map-z", sourceId: "endpoint-z", targetId: "handler-a", type: "FLOWS_TO",
        confidence: "CONFIRMED", attributes: {}, evidenceIds: [] },
      { id: "map-a", sourceId: "endpoint-a", targetId: "handler-z", type: "FLOWS_TO",
        confidence: "CONFIRMED", attributes: {}, evidenceIds: [] }
    ]
  };
  const graph = ui.normalizeGraph(snapshot);
  const model = layoutApi.semanticLayout({ ...graph, presentationContext: "overview" }, { positions: {} }).plan.displayModel;
  const apiCard = model.composites.find((card) => card.kind === "API_MAPPING");
  const handlerCard = model.composites.find((card) => card.kind === "CONTROLLER_HANDLER");
  const apiOrder = apiCard.items.filter((item) => !item.isHeader).map((item) => item.originalNodeIds[0]);
  const handlerOrder = handlerCard.items.filter((item) => !item.isHeader).map((item) => item.originalNodeIds[0]);
  assert.deepEqual(Array.from(apiOrder), ["endpoint-a", "endpoint-z"]);
  assert.deepEqual(Array.from(handlerOrder), ["handler-z", "handler-a"]);
  const mapping = new Map(snapshot.edges.map((edge) => [edge.sourceId, edge.targetId]));
  assert.deepEqual(apiOrder.map((id) => mapping.get(id)), handlerOrder);
});

test("60 API Overview 배선은 미해결 관계를 남기지 않음", () => {
  const { ui, layoutApi } = loadUi();
  const graph = ui.normalizeGraph(supportApiGraph(60));
  const layout = layoutApi.semanticLayout({ ...graph, presentationContext: "overview" }, { positions: {} });
  const plan = layout.plan.overviewRouting;
  assert.deepEqual(Array.from(plan.unresolved), []);
  const segments = new Map(plan.segments.map((segment) => [segment.id, segment]));
  const keys = new Set();
  plan.segments.forEach((segment) => {
    const ends = [segment.from, segment.to].map((point) => `${point.x}:${point.y}`).sort();
    const key = ends.join("|");
    assert.equal(keys.has(key), false, key);
    keys.add(key);
  });
  plan.relations.forEach((relation) => {
    const route = plan.routesByRelationId[relation.id];
    assert.ok(route, relation.id);
    const source = layout.plan.displayModel.instances.find((instance) => instance.id === relation.sourceInstanceId).position;
    const target = layout.plan.displayModel.instances.find((instance) => instance.id === relation.targetInstanceId).position;
    assert.equal(route.sourcePort.x, source.x + (source.width || 260), relation.id);
    assert.equal(route.targetPort.x, target.x, relation.id);
    let current = route.sourcePort;
    route.orderedSegmentIds.forEach((id) => {
      const segment = segments.get(id);
      assert.ok(segment && segment.relationIds.includes(relation.id), relation.id);
      layout.plan.displayModel.instances.forEach((instance) => {
        if (instance.id === relation.sourceInstanceId || instance.id === relation.targetInstanceId) return;
        const intersects = routeIntersectsPosition({ sections: [{ startPoint: segment.from, endPoint: segment.to }] }, instance.position);
        if (intersects) assert.ok(segment.routeRole === "TRUNK" && segment.relationIds.length > 1,
          `${relation.id} / ${instance.id} / ${segment.routeRole}`);
      });
      const equal = (left, right) => left.x === right.x && left.y === right.y;
      assert.ok(equal(current, segment.from) || equal(current, segment.to), relation.id);
      current = equal(current, segment.from) ? segment.to : segment.from;
    });
    assert.equal(current.x, route.targetPort.x, relation.id);
    assert.equal(current.y, route.targetPort.y, relation.id);
    if (relation.type === "SECURED_BY") {
      const maxY = Math.max(...route.orderedSegmentIds.flatMap((id) => [segments.get(id).from.y, segments.get(id).to.y]));
      assert.ok(maxY <= Math.max(route.sourcePort.y, route.targetPort.y) + 96,
        `${relation.id}: ${maxY} / ${route.sourcePort.y} / ${route.targetPort.y}`);
    }
  });
});

test("Chain에 연결된 Finding 원본 관계는 가시 배선에서 제외하고 원본에 보존됨", () => {
  const { ui, layoutApi } = loadUi();
  const graph = ui.normalizeGraph(graphFixture());
  const plan = layoutApi.semanticLayout({ ...graph, presentationContext: "overview" }, { positions: {} }).plan.overviewRouting;
  const relation = plan.relations.find((item) => item.originalEdgeIds?.includes("edge-3"));
  assert.equal(relation, undefined);
  assert.ok(graph.edges.some((edge) => edge.id === "edge-3"));
});

test("완전한 다대다 관계는 하나의 공통 선분을 공유함", () => {
  const { layoutApi } = loadUi();
  const instances = [
    { id: "a", position: { x: 0, y: 0 } }, { id: "b", position: { x: 0, y: 360 } },
    { id: "x", position: { x: 1000, y: 0 } }, { id: "y", position: { x: 1000, y: 360 } }
  ];
  const relations = ["a", "b"].flatMap((sourceInstanceId) => ["x", "y"].map((targetInstanceId) => ({
    id: `${sourceInstanceId}-${targetInstanceId}`, sourceInstanceId, targetInstanceId, rowId: "row", role: "evidence"
  })));
  const plan = layoutApi.routeOverview(instances, relations);
  assert.deepEqual(Array.from(plan.unresolved), []);
  assert.ok(plan.segments.some((segment) => segment.relationIds.length === 4
    && Math.abs(segment.to.x - segment.from.x) > 500));
});

test("두 열의 완전한 다대다 관계도 모든 표시 경로가 연결됨", () => {
  const { layoutApi } = loadUi();
  const instances = [
    { id: "a", position: { x: 0, y: 0 } }, { id: "b", position: { x: 360, y: 360 } },
    { id: "x", position: { x: 1600, y: 0 } }, { id: "y", position: { x: 1960, y: 360 } }
  ];
  const relations = ["a", "b"].flatMap((sourceInstanceId) => ["x", "y"].map((targetInstanceId) => ({
    id: `${sourceInstanceId}-${targetInstanceId}`, sourceInstanceId, targetInstanceId, rowId: "row", role: "evidence"
  })));
  const plan = layoutApi.routeOverview(instances, relations);
  assert.deepEqual(Array.from(plan.unresolved), []);
  assert.ok(plan.segments.some((segment) => segment.relationIds.length === 4));
  const byId = new Map(plan.segments.map((segment) => [segment.id, segment]));
  relations.forEach((relation) => {
    const route = plan.routesByRelationId[relation.id];
    let point = route.sourcePort;
    for (const id of route.orderedSegmentIds) {
      const segment = byId.get(id);
      const same = (left, right) => left.x === right.x && left.y === right.y;
      assert.ok(same(point, segment.from) || same(point, segment.to), relation.id);
      point = same(point, segment.from) ? segment.to : segment.from;
    }
    assert.equal(point.x, route.targetPort.x, relation.id);
    assert.equal(point.y, route.targetPort.y, relation.id);
  });
});

test("불완전한 다대다 배선은 존재하지 않는 관계를 생성하지 않음", () => {
  const { layoutApi } = loadUi();
  const instances = [
    { id: "a", position: { x: 0, y: 0 } }, { id: "b", position: { x: 0, y: 360 } },
    { id: "x", position: { x: 1000, y: 0 } }, { id: "y", position: { x: 1000, y: 360 } }
  ];
  const relations = [["a", "x"], ["a", "y"], ["b", "x"]].map(([sourceInstanceId, targetInstanceId]) => ({
    id: `${sourceInstanceId}-${targetInstanceId}`, sourceInstanceId, targetInstanceId, rowId: "row", role: "evidence"
  }));
  const plan = layoutApi.routeOverview(instances, relations);
  assert.deepEqual(Array.from(plan.unresolved), []);
  assert.equal(plan.routesByRelationId["b-y"], undefined);
  assert.equal(plan.segments.some((segment) => segment.relationIds.length === 3), false);
});

test("Overview Chain Header는 외부 등록선을 만들지 않고 가시 포트는 실제 항목 경계임", () => {
  const { ui, layoutApi } = loadUi();
  const graph = ui.normalizeGraph(detailGraphFixture());
  const plan = layoutApi.semanticLayout({ ...graph, presentationContext: "overview" }, { positions: {} }).plan;
  const routing = plan.overviewRouting;
  const card = plan.displayModel.composites.find((item) => item.kind === "SECURITY_CHAIN"
    && item.originalNodeIds.includes("chain-a"));
  const header = card.items.find((item) => item.isHeader);
  assert.ok(header);
  assert.ok(header.originalEdgeIds.includes("security-filtered-1"));
  assert.equal(header.inputPortIds.length, 0);
  assert.equal(header.outputPortIds.length, 0);
  assert.equal(routing.relations.some((relation) => ["FILTERED_BY", "MATCHED_BY"].includes(relation.type)), false);
  const ports = new Map(plan.displayModel.ports.map((port) => [port.id, port]));
  for (const relation of routing.relations) {
    const route = routing.routesByRelationId[relation.id];
    if (!route) continue;
    const source = ports.get(relation.visualSourcePortId);
    const target = ports.get(relation.visualTargetPortId);
    assert.ok(source && target, relation.id);
    assert.equal(source.side, "RIGHT", relation.id);
    assert.equal(target.side, "LEFT", relation.id);
    assert.equal(route.sourcePort.x, source.x, relation.id);
    assert.equal(route.sourcePort.y, source.y, relation.id);
    assert.equal(route.targetPort.x, target.x, relation.id);
    assert.equal(route.targetPort.y, target.y, relation.id);
  }
});

test("큰 Principal 그룹은 확인된 사용 주체별로 나누고 원본을 보존함", () => {
  const { ui, layoutApi } = loadUi();
  const snapshot = detailGraphFixture();
  snapshot.nodes.push(
    { id: "handler-c", type: "HANDLER", serviceId: "orders", label: "OtherController#view", attributes: { handler: "OtherController#view" }, evidenceIds: [] },
    { id: "endpoint-c", type: "ENDPOINT", serviceId: "orders", label: "GET /other", attributes: { httpMethod: "GET", path: "/other", handler: "OtherController#view" }, evidenceIds: [] }
  );
  snapshot.edges.push({ id: "match-c", sourceId: "endpoint-c", targetId: "chain-a", type: "MATCHED_BY", confidence: "CONFIRMED", attributes: {}, evidenceIds: [] });
  for (let index = 0; index < 6; index += 1) {
    const id = `principal-${index}`;
    snapshot.nodes.push({ id, type: "SECURITY_DATA", serviceId: "orders", label: id,
      attributes: { apiType: "PRINCIPAL", operation: "READ" }, evidenceIds: [`e-${id}`] });
    snapshot.edges.push({ id: `reads-${id}`, sourceId: index < 3 ? "handler-a" : "handler-c", targetId: id,
      type: "READS_SECURITY_DATA", confidence: "CONFIRMED", attributes: {}, evidenceIds: [`e-${id}`] });
  }
  const graph = ui.normalizeGraph(snapshot);
  const before = JSON.stringify(graph);
  const plan = layoutApi.semanticLayout({ ...graph, presentationContext: "overview" }, { positions: {} }).plan;
  const groups = plan.displayModel.groups.filter((group) => group.nodeIds.some((id) => id.startsWith("principal-")));
  assert.equal(groups.length, 2);
  assert.deepEqual(Array.from(groups).flatMap((group) => Array.from(group.nodeIds)).sort(), Array.from({ length: 6 }, (_, index) => `principal-${index}`));
  assert.equal(JSON.stringify(graph), before);
  assert.ok(plan.lanes.find((lane) => lane.id === "security-checks").columns <= 2);
});

test("공유 Trunk는 중간 카드 뒤를 지나고 Branch는 카드를 피함", () => {
  const { layoutApi } = loadUi();
  const instances = [
    { id: "source", position: { x: 0, y: 180 } },
    { id: "obstacle", position: { x: 450, y: 180 } },
    { id: "a", position: { x: 1000, y: 0 } }, { id: "b", position: { x: 1000, y: 360 } }
  ];
  const relations = ["a", "b"].map((targetInstanceId) => ({ id: targetInstanceId,
    sourceInstanceId: "source", targetInstanceId, rowId: "row", role: "evidence" }));
  const plan = layoutApi.routeOverview(instances, relations);
  assert.deepEqual(Array.from(plan.unresolved), []);
  assert.ok(plan.segments.some((segment) => segment.routeRole === "TRUNK" && segment.relationIds.length === 2
    && routeIntersectsPosition({ sections: [{ startPoint: segment.from, endPoint: segment.to }] }, instances[1].position)),
  JSON.stringify(plan.segments.map((segment) => ({ role: segment.routeRole, count: segment.relationIds.length,
    from: segment.from, to: segment.to }))));
  plan.segments.filter((segment) => segment.routeRole !== "TRUNK").forEach((segment) => {
    assert.equal(routeIntersectsPosition({ sections: [{ startPoint: segment.from, endPoint: segment.to }] }, instances[1].position), false);
  });
});

function mappedSecurityReferenceGraph() {
  const authorities = ["ROLE_CUSTOMER", "ROLE_SUPPORT", "ROLE_BANK_ADMIN"];
  const handler = "example.OrderController#handle";
  return {
    nodes: [
      { id: "shared-handler", type: "HANDLER", serviceId: "orders", label: "OrderController#handle",
        attributes: { handler }, evidenceIds: [] },
      { id: "shared-endpoint", type: "ENDPOINT", serviceId: "orders", label: "GET /orders/{id}",
        attributes: { httpMethod: "GET", path: "/orders/{id}", handler }, evidenceIds: [] },
      { id: "shared-chain", type: "SECURITY_CHAIN", serviceId: "orders", label: "Orders Chain",
        attributes: { chainKey: "orders", chainOrder: "1", matcherCondition: "PATH /orders/**" }, evidenceIds: [] },
      ...authorities.map((authority, index) => ({ id: `shared-policy-${index}`, type: "AUTHORIZATION",
        serviceId: "orders", label: authority,
        attributes: { policySource: "METHOD", policyKind: "AUTHORITY_REQUIRED", requiredAuthority: authority },
        evidenceIds: [] }))
    ],
    edges: [
      { id: "shared-match", sourceId: "shared-endpoint", targetId: "shared-chain", type: "MATCHED_BY",
        confidence: "CONFIRMED", attributes: {}, evidenceIds: [] },
      { id: "shared-mapping", sourceId: "shared-endpoint", targetId: "shared-handler", type: "FLOWS_TO",
        confidence: "CONFIRMED", attributes: { flowKind: "HANDLER" }, evidenceIds: [] },
      ...authorities.map((authority, index) => ({ id: `shared-edge-${index}`, sourceId: "shared-handler",
        targetId: `shared-policy-${index}`, type: "SECURED_BY", confidence: "CONFIRMED", attributes: {}, evidenceIds: [] }))
    ]
  };
}

test("Overview 공통 Trunk는 카드 가림 마스크를 사용함", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(mappedSecurityReferenceGraph());
  await ui.layoutGraph();
  const trunks = ui.state.layout.plan.overviewRouting.segments.filter((segment) => segment.routeRole === "TRUNK");
  assert.ok(trunks.length > 0);
  const paths = findAllByClass(elements.get("graph-edges"), "graph-overview-segment");
  trunks.forEach((segment) => {
    const path = paths.find((item) => item.getAttribute("data-segment-id") === segment.id);
    assert.equal(path?.getAttribute("mask"), "url(#graph-overview-trunk-mask)");
  });
});

test("공유 Segment 선택은 구성 원본 관계를 Inspector에서 제공함", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(mappedSecurityReferenceGraph());
  await ui.layoutGraph();
  const shared = findAllByClass(elements.get("graph-edges"), "graph-overview-segment")
    .find((path) => (path.getAttribute("data-edge-ids") || "").split(",").filter(Boolean).length > 1);
  assert.ok(shared);
  const ids = shared.getAttribute("data-edge-ids").split(",");
  shared.dispatchEvent({ type: "click" });
  const links = findAllByClass(elements.get("inspector"), "inspector-link");
  ids.forEach((id) => assert.ok(links.some((link) => link.getAttribute("data-edge-id") === id), id));
});

test("Overview 관계 선택 시 원본 관계명을 표시함", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(detailGraphFixture());
  await ui.layoutGraph();
  const path = findAllByClass(elements.get("graph-edges"), "graph-overview-segment")
    .find((item) => (item.getAttribute("data-edge-ids") || "").split(",").includes("secured-a"));
  assert.ok(path);
  path.dispatchEvent({ type: "click" });
  const label = findAllByClass(elements.get("graph-edges"), "graph-edge-label")
    .find((item) => item.getAttribute("data-edge-id") === "secured-a");
  assert.ok(label);
  assert.match(label.textContent, /보호 근거/);
  assert.equal(label.getAttribute("data-visible"), "true");
});

test("마지막 Filter의 구조 연결은 다른 Filter의 보안정보 사용을 전가하지 않음", () => {
  const { ui, layoutApi } = loadUi();
  const snapshot = detailGraphFixture();
  snapshot.nodes.push({ id: "filter-data", type: "SECURITY_DATA", serviceId: "orders", label: "header",
    attributes: { apiType: "HEADER", operation: "READ" }, evidenceIds: [] });
  snapshot.edges.push({ id: "filter-read", sourceId: "security-filter-1", targetId: "filter-data",
    type: "READS_SECURITY_DATA", confidence: "CONFIRMED", attributes: {}, evidenceIds: [] });
  const graph = ui.normalizeGraph(snapshot);
  const plan = layoutApi.semanticLayout({ ...graph, presentationContext: "overview" }, { positions: {} }).plan;
  assert.equal(plan.projection.edges.some((edge) => edge.id.startsWith("filter-to-check-chain-a-")
    && (edge.relatedNodeIds || []).includes("filter-data")), false);
  assert.ok(plan.overviewRouting.relations.some((relation) => relation.originalEdgeIds?.includes("filter-read")));
  assert.equal(graph.edges.find((edge) => edge.id === "filter-read").sourceId, "security-filter-1");
});

test("Chain이 미확정이어도 확인된 Handler와 Endpoint의 보안 참조를 같은 행에 보존함", () => {
  const { ui, layoutApi } = loadUi();
  const snapshot = detailGraphFixture();
  snapshot.edges.find((edge) => edge.id === "match-a").confidence = "UNKNOWN";
  const graph = ui.normalizeGraph(snapshot);
  const plan = layoutApi.semanticLayout({ ...graph, presentationContext: "overview" }, { positions: {} }).plan;
  const endpointItem = compositeItemForNode(plan, "endpoint-a", "unresolved");
  const securityItem = compositeItemForNode(plan, "authorization-a", "unresolved");
  assert.ok(endpointItem, "미확정 Chain 행의 Endpoint 항목");
  assert.ok(securityItem, "같은 행의 보안 근거 항목");
  const reference = plan.overviewRouting.relations.find((relation) =>
    relation.originalEdgeIds.includes("secured-a") && relation.viaEndpointId === "endpoint-a");
  assert.ok(reference, "확인된 Handler → 보안 근거와 Endpoint FLOWS_TO를 연결한 참조");
  assert.equal(reference.presentationKind, "VIA_ENDPOINT_REFERENCE");
  assert.ok(reference.mappingEdgeIds.includes("handler-map-a"));
  assert.equal(reference.rowId, "unresolved");
});

test("서로 다른 JWT Claim과 요구 권한은 같은 표시 그룹으로 뭉치지 않음", () => {
  const { ui, layoutApi } = loadUi();
  const snapshot = detailGraphFixture();
  for (const [id, claimName] of [["claim-one", "subject"], ["claim-two", "identity_verified"]]) {
    snapshot.nodes.push({ id, type: "SECURITY_DATA", serviceId: "orders", label: id,
      attributes: { apiType: "NIMBUS_CLAIMS_SET", dataKind: "JWT_CLAIM", operation: "READ", claimName }, evidenceIds: [] });
    snapshot.edges.push({ id: `edge-${id}`, sourceId: "handler-a", targetId: id, type: "READS_SECURITY_DATA", confidence: "CONFIRMED", attributes: {}, evidenceIds: [] });
  }
  for (const [id, requiredAuthority] of [["role-one", "ROLE_CUSTOMER"], ["role-two", "ROLE_BANK_ADMIN"]]) {
    snapshot.nodes.push({ id, type: "AUTHORIZATION", serviceId: "orders", label: id,
      attributes: { policySource: "URL", policyKind: "AUTHORITY_REQUIRED", chainKey: "chain-a", requiredAuthority }, evidenceIds: [] });
  }
  const graph = ui.normalizeGraph(snapshot);
  const plan = layoutApi.semanticLayout({ ...graph, presentationContext: "overview" }, { positions: {} }).plan;
  for (const [a, b] of [["claim-one", "claim-two"], ["role-one", "role-two"]]) {
    const left = compositeItemForNode(plan, a);
    const right = compositeItemForNode(plan, b);
    assert.ok(left && right);
    assert.notEqual(left.id, right.id);
  }
});

test("Filter 행은 확인된 순서대로 Chain 복합 카드 내부에 유지됨", () => {
  const { ui, layoutApi } = loadUi();
  const graph = ui.normalizeGraph(laneGraphFixture());
  const layout = layoutApi.semanticLayout({ ...graph, presentationContext: "overview" }, { positions: {} });
  const plan = layout.plan.overviewRouting;
  const cards = layout.plan.displayModel.composites.filter((card) => card.kind === "SECURITY_CHAIN");
  assert.equal(cards.length, 3);
  cards.forEach((card) => {
    const filters = card.items.filter((item) => !item.isHeader);
    const orders = filters.map((item) => item.order);
    assert.ok(filters.length > 0);
    assert.ok(filters.every((item) => item.orderStatus === "CONFIRMED"));
    assert.deepEqual(orders, orders.slice().sort((left, right) => left - right));
    const y = filters.map((item) => item.bounds.y);
    assert.deepEqual(y, y.slice().sort((left, right) => left - right));
    assert.ok(filters.every((item) => item.bounds.x >= card.contentBounds.x - 1
      && item.bounds.x + item.bounds.width <= card.contentBounds.x + card.contentBounds.width + 1),
    JSON.stringify({ card: card.bounds, content: card.contentBounds,
      filters: filters.map((item) => ({ id: item.id, bounds: item.bounds })) }));
  });
  assert.equal(plan.relations.some((relation) => relation.routeKind === "filter-wrap"), false);
  assert.equal(plan.relations.some((relation) => relation.type === "FILTERED_BY"), false);
});

test("Chain 선택으로 원본 등록선이 새로 표시되지 않음", async () => {
  const { ui, elements } = loadUi();
  ui.renderGraph(wrappedFilterGraph(0, 5));
  await ui.layoutGraph();
  const plan = ui.state.layout.plan.overviewRouting;
  const chainCard = ui.state.layout.plan.displayModel.composites.find((card) => card.kind === "SECURITY_CHAIN"
    && card.originalNodeIds.includes("chain"));
  assert.ok(chainCard);
  assert.equal(chainCard.items.filter((item) => !item.isHeader).length, 5);
  const header = chainCard.items.find((item) => item.isHeader);
  assert.ok(header.originalEdgeIds.filter((id) => id.startsWith("security-edge-")).length === 5);
  assert.equal(plan.relations.some((relation) => relation.type === "FILTERED_BY" || relation.type === "MATCHED_BY"), false);
  const before = findAllByClass(elements.get("graph-edges"), "graph-overview-segment")
    .map((path) => [path.getAttribute("data-segment-id"), path.getAttribute("d")]);
  const renderedCard = findAllByClass(elements.get("graph-nodes"), "graph-composite-card")
    .find((element) => element.getAttribute("data-composite-card-id") === chainCard.id);
  renderedCard.dispatchEvent({ type: "click" });
  assert.equal(ui.state.selection.kind, "controller-group");
  assert.equal(ui.state.selection.id, chainCard.id);
  const after = findAllByClass(elements.get("graph-edges"), "graph-overview-segment")
    .map((path) => [path.getAttribute("data-segment-id"), path.getAttribute("d")]);
  assert.deepEqual(after, before);
  assert.equal(after.some(([id]) => !id), false);
  assert.equal(ui.state.graph.edges.filter((edge) => edge.type === "FILTERED_BY").length, 5);
});

if (actualSnapshotTargets.length > 0) {
  test("실제 Snapshot의 전체 MAP과 보안 MAP은 모든 표시 관계를 연속 Segment로 렌더링함", async () => {
    const metrics = [];
    for (const target of actualSnapshotTargets) {
      const response = await fetch(target.url);
      assert.equal(response.status, 200, `${target.name}: Snapshot HTTP 상태`);
      const snapshot = await response.json();
      const { ui, elements } = loadUi();
      ui.renderGraph(snapshot);
      for (const view of ["all-flow", "security-flow"]) {
        ui.selectView(view);
        await ui.layoutGraph();
        assert.ok(ui.state.layout, `${target.name}: 레이아웃 ${ui.state.layoutError}`);
        const routing = ui.state.layout.plan.overviewRouting;
        const missing = routing.relations.filter((relation) => !routing.routesByRelationId[relation.id]);
        const segmentsById = new Map(routing.segments.map((segment) => [segment.id, segment]));
        const displayModel = ui.state.layout.plan.displayModel;
        const registration = (snapshot.runtimeArchitecture?.components || []).find((component) =>
          component.kind === "SERVLET_FILTER_REGISTRATION"
          && component.attributes?.registrationName === "springSecurityFilterChain"
          && /DelegatingFilterProxy/.test(component.className || "") && component.graphNodeIds?.length === 1);
        if (registration && displayModel.originalNodeToItemIds[registration.graphNodeIds[0]]?.length) {
          const delegation = routing.relations.filter((relation) => relation.presentationKind === "SECURITY_CHAIN_SELECTION");
          assert.ok(delegation.length > 0, `${target.name}: 보안 위임 연결`);
          assert.ok(delegation.every((relation) => relation.relatedNodeIds.includes(registration.graphNodeIds[0])),
            `${target.name}: 실제 위임 Filter 출발`);
        }
        const decorations = findAllByClass(elements.get("graph-nodes"), "graph-composite-timeline");
        assert.ok(decorations.every((element) => !element.getAttribute("data-port-ids")
          && !element.getAttribute("data-segment-id")), `${target.name}: Timeline 장식 분리`);
        assert.ok(findAllByClass(elements.get("graph-nodes"), "graph-composite-display-id").length > 0,
          `${target.name}: 원본 표시 ID`);
        const disconnected = [];
        routing.relations.forEach((relation) => {
          const route = routing.routesByRelationId[relation.id];
          if (!route) return;
          let current = route.sourcePort;
          route.orderedSegmentIds.forEach((id) => {
            const segment = segmentsById.get(id);
            if (!segment || !segment.relationIds.includes(relation.id)) {
              disconnected.push({ relationId: relation.id, segmentId: id, reason: "missing-segment" });
              return;
            }
            const same = (left, right) => left.x === right.x && left.y === right.y;
            if (!same(current, segment.from) && !same(current, segment.to)) {
              disconnected.push({ relationId: relation.id, segmentId: id, reason: "disconnected" });
              return;
            }
            current = same(current, segment.from) ? segment.to : segment.from;
          });
          if (current.x !== route.targetPort.x || current.y !== route.targetPort.y) {
            disconnected.push({ relationId: relation.id, reason: "wrong-target" });
          }
        });
        const rendered = findAllByClass(elements.get("graph-edges"), "graph-overview-segment");
        const roleCounts = Object.fromEntries(Array.from(new Set(routing.relations.map((relation) => relation.role)),
          (role) => [role, routing.relations.filter((relation) => relation.role === role).length]));
        const relationById = new Map(routing.relations.map((relation) => [relation.id, relation]));
        const routeOrderErrors = routing.relations.filter((relation) => {
          const route = routing.routesByRelationId[relation.id];
          return route && new Set(route.orderedSegmentIds).size !== route.orderedSegmentIds.length;
        }).length;
        const wrongPortDirectionCount = routing.relations.filter((relation) => {
          const route = routing.routesByRelationId[relation.id];
          const sourceBounds = displayModel.cardById[relation.sourceInstanceId]?.bounds;
          const targetBounds = displayModel.cardById[relation.targetInstanceId]?.bounds;
          return route && (!sourceBounds || !targetBounds
            || route.sourcePort.x !== sourceBounds.x + sourceBounds.width
            || route.targetPort.x !== targetBounds.x);
        }).length;
        const portsById = new Map(displayModel.ports.map((port) => [port.id, port]));
        const routePortErrors = routing.relations.filter((relation) => {
          const route = routing.routesByRelationId[relation.id];
          return !route || [route.sourcePort, route.targetPort].some((routePort) => {
            const port = portsById.get(routePort.id);
            return !port || port.x !== routePort.x || port.y !== routePort.y;
          });
        }).length;
        const portGroups = new Map();
        displayModel.ports.forEach((port) => {
          const key = `${port.itemId}:${port.side}`;
          const group = portGroups.get(key) || [];
          group.push(port);
          portGroups.set(key, group);
        });
        const portPlacementErrors = Array.from(portGroups.values()).reduce((count, ports) => {
          const item = displayModel.itemById[ports[0].itemId];
          const uniqueY = new Set(ports.map((port) => port.y));
          const outsideItem = ports.filter((port) => port.y < item.bounds.y + 4
            || port.y > item.bounds.y + item.bounds.height - 4).length;
          return count + ports.length - uniqueY.size + outsideItem;
        }, 0);
        const segmentMembershipErrors = routing.segments.filter((segment) => {
          const usedBy = routing.relations.filter((relation) =>
            routing.routesByRelationId[relation.id]?.orderedSegmentIds.includes(segment.id))
            .map((relation) => relation.id).sort();
          return JSON.stringify(usedBy) !== JSON.stringify(segment.relationIds.slice().sort());
        }).length;
        const pathById = new Map(rendered.flatMap((path) =>
          (path.getAttribute("data-segment-ids") || path.getAttribute("data-segment-id") || "")
            .split(",").filter(Boolean).map((id) => [id, path])));
        const pointKey = (point) => `${point.x},${point.y}`;
        const physicalGeometryKey = (segment) => {
          const controls = segment.geometry?.kind === "CUBIC" ? segment.geometry.controlPoints : [];
          const points = [segment.from, ...controls, segment.to].map(pointKey);
          const forward = points.join(">");
          const reverse = points.slice().reverse().join(">");
          return `${controls.length ? "CUBIC" : "LINE"}:${forward < reverse ? forward : reverse}`;
        };
        const segmentById = new Map(routing.segments.map((segment) => [segment.id, segment]));
        const geometryCounts = new Map();
        rendered.forEach((path) => {
          const segment = segmentById.get(path.getAttribute("data-segment-id"));
          if (!segment) return;
          const key = physicalGeometryKey(segment);
          geometryCounts.set(key, (geometryCounts.get(key) || 0) + 1);
        });
        const duplicatePhysicalSegmentCount = Array.from(geometryCounts.values())
          .reduce((sum, count) => sum + count - 1, 0);
        const duplicatePhysicalSegmentExamples = Array.from(geometryCounts.entries())
          .filter(([, count]) => count > 1).slice(0, 3);
        const svgErrorExamples = rendered.flatMap((path) => {
          const ids = (path.getAttribute("data-segment-ids") || "").split(",").filter(Boolean);
          const segments = ids.map((id) => segmentById.get(id));
          if (!ids.length || segments.some((segment) => !segment)) return [{ reason: "missing-segment", ids }];
          if (new Set(segments.map(physicalGeometryKey)).size !== 1) return [{ reason: "geometry", ids }];
          const relationIds = Array.from(new Set(segments.flatMap((segment) => segment.relationIds)));
          const members = relationIds.map((id) => relationById.get(id)).filter(Boolean);
          const originalIds = Array.from(new Set(members.flatMap((relation) => relation.originalEdgeIds || [])));
          const runtimeIds = Array.from(new Set(members.flatMap((relation) => relation.runtimeRelationshipIds || [])));
          if ((path.getAttribute("data-relation-ids") || "") !== relationIds.join(",")
            || (path.getAttribute("data-edge-ids") || "") !== originalIds.join(",")
            || (path.getAttribute("data-runtime-relationship-ids") || "") !== runtimeIds.join(",")) {
            return [{ reason: "membership", ids }];
          }
          const first = segments[0];
          const commands = (reverse) => {
            const start = reverse ? first.to : first.from;
            const end = reverse ? first.from : first.to;
            if (first.geometry?.kind === "CUBIC") {
              const controls = reverse ? first.geometry.controlPoints.slice().reverse() : first.geometry.controlPoints;
              return `M ${start.x} ${start.y} C ${controls[0].x} ${controls[0].y}, ${controls[1].x} ${controls[1].y}, ${end.x} ${end.y}`;
            }
            return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
          };
          if (![commands(false), commands(true)].includes(path.getAttribute("d"))) return [{ reason: "path", ids }];
          return [];
        });
        const svgSegmentErrors = svgErrorExamples.length
          + routing.segments.filter((segment) => !pathById.has(segment.id)).length;
        const cardById = displayModel.cardById;
        const lineIntersectsBounds = (start, end, bounds) => {
          let low = 0;
          let high = 1;
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const constraints = [[-dx, start.x - bounds.left], [dx, bounds.right - start.x],
            [-dy, start.y - bounds.top], [dy, bounds.bottom - start.y]];
          for (const [direction, distance] of constraints) {
            if (direction === 0) {
              if (distance < 0) return false;
              continue;
            }
            const ratio = distance / direction;
            if (direction < 0) low = Math.max(low, ratio);
            else high = Math.min(high, ratio);
            if (low > high) return false;
          }
          return true;
        };
        const cubicIntersectsBounds = (start, firstControl, secondControl, end, bounds, depth = 0) => {
          const controlBounds = {
            left: Math.min(start.x, firstControl.x, secondControl.x, end.x),
            right: Math.max(start.x, firstControl.x, secondControl.x, end.x),
            top: Math.min(start.y, firstControl.y, secondControl.y, end.y),
            bottom: Math.max(start.y, firstControl.y, secondControl.y, end.y)
          };
          if (controlBounds.right < bounds.left || controlBounds.left > bounds.right
            || controlBounds.bottom < bounds.top || controlBounds.top > bounds.bottom) return false;
          const distanceFromLine = (point) => {
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const length = Math.hypot(dx, dy);
            return length ? Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length
              : Math.hypot(point.x - start.x, point.y - start.y);
          };
          if (depth >= 12 || Math.max(distanceFromLine(firstControl), distanceFromLine(secondControl)) <= 0.25) {
            return lineIntersectsBounds(start, end, bounds);
          }
          const midpoint = (left, right) => ({ x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 });
          const startFirst = midpoint(start, firstControl);
          const firstSecond = midpoint(firstControl, secondControl);
          const secondEnd = midpoint(secondControl, end);
          const leftMiddle = midpoint(startFirst, firstSecond);
          const rightMiddle = midpoint(firstSecond, secondEnd);
          const center = midpoint(leftMiddle, rightMiddle);
          return cubicIntersectsBounds(start, startFirst, leftMiddle, center, bounds, depth + 1)
            || cubicIntersectsBounds(center, rightMiddle, secondEnd, end, bounds, depth + 1);
        };
        const curveCollidesWithCard = (segment, card) => {
          if (!card.bounds || !segment.geometry?.controlPoints || segment.geometry.controlPoints.length !== 2) return false;
          const bounds = { left: card.bounds.x - 2, right: card.bounds.x + card.bounds.width + 2,
            top: card.bounds.y - 2, bottom: card.bounds.y + card.bounds.height + 2 };
          return cubicIntersectsBounds(segment.from, segment.geometry.controlPoints[0],
            segment.geometry.controlPoints[1], segment.to, bounds);
        };
        const curveCollisionCount = routing.segments.filter((segment) => {
          if (segment.geometry?.kind !== "CUBIC") return false;
          const endpointCardIds = new Set(segment.relationIds.flatMap((id) => {
            const relation = relationById.get(id);
            return relation ? [relation.sourceInstanceId, relation.targetInstanceId] : [];
          }));
          return Object.values(cardById).some((card) => !endpointCardIds.has(card.id)
            && curveCollidesWithCard(segment, card));
        }).length;
        const curveCollisionExamples = routing.segments.filter((segment) => {
          if (segment.geometry?.kind !== "CUBIC") return false;
          const endpointCardIds = new Set(segment.relationIds.flatMap((id) => {
            const relation = relationById.get(id);
            return relation ? [relation.sourceInstanceId, relation.targetInstanceId] : [];
          }));
          return Object.values(cardById).some((card) => !endpointCardIds.has(card.id)
            && curveCollidesWithCard(segment, card));
        }).slice(0, 3).map((segment) => {
          const endpointCardIds = new Set(segment.relationIds.flatMap((id) => {
            const relation = relationById.get(id);
            return relation ? [relation.sourceInstanceId, relation.targetInstanceId] : [];
          }));
          const overlappingCards = Object.values(cardById).filter((card) => card.bounds && !endpointCardIds.has(card.id)
            && curveCollidesWithCard(segment, card))
            .map((card) => ({ kind: card.kind, bounds: [card.bounds.x, card.bounds.y,
              card.bounds.width, card.bounds.height] }));
          return { id: segment.id, from: [segment.from.x, segment.from.y], to: [segment.to.x, segment.to.y],
            controls: segment.geometry.controlPoints.map((point) => [point.x, point.y]), overlappingCards,
            relationTypes: segment.relationIds.map((id) => relationById.get(id)?.type) };
        });
        const junctions = routing.junctions || [];
        const junctionsById = new Map(junctions.map((junction) => [junction.id, junction]));
        const renderedJunctions = findAllByClass(elements.get("graph-edges"), "graph-overview-junction");
        const junctionValidation = junctions.map((junction) => {
          const memberSegments = junction.segmentIds.map((id) => segmentsById.get(id)).filter(Boolean);
          const memberRelations = Array.from(new Set(memberSegments.flatMap((segment) => segment.relationIds))).sort();
          const neighbors = new Set(memberSegments.map((segment) => segment.from.x === junction.x
            && segment.from.y === junction.y ? `${segment.to.x},${segment.to.y}` : `${segment.from.x},${segment.from.y}`));
          const misalignedSegmentIds = memberSegments.filter((segment) =>
            !((segment.from.x === junction.x && segment.from.y === junction.y)
              || (segment.to.x === junction.x && segment.to.y === junction.y))).map((segment) => segment.id);
          const reasons = [];
          if (memberSegments.length !== junction.segmentIds.length) reasons.push("missing-segment");
          if (neighbors.size < 3) reasons.push("insufficient-branches");
          if (memberRelations.join(",") !== junction.relationIds.slice().sort().join(",")) reasons.push("relation-membership");
          if (misalignedSegmentIds.length) reasons.push("misaligned-segment");
          return { junction, memberSegments, memberRelations, neighbors, misalignedSegmentIds, reasons,
            invalid: reasons.length > 0 };
        });
        const junctionErrors = junctionValidation.filter((item) => item.invalid).length;
        const junctionErrorExamples = junctionValidation.filter((item) => item.invalid).slice(0, 4)
          .map(({ junction, memberSegments, memberRelations, neighbors, misalignedSegmentIds, reasons }) => ({
            point: [junction.x, junction.y], reasons,
            declaredSegmentCount: junction.segmentIds.length, memberSegmentIds: memberSegments.map((segment) => segment.id),
            declaredRelationCount: junction.relationIds.length, actualRelationCount: memberRelations.length,
            neighborCount: neighbors.size, misalignedSegmentIds }));
        const junctionDomErrors = junctions.filter((junction) => {
          const element = renderedJunctions.find((item) => item.getAttribute("data-junction-id") === junction.id);
          return !element || Number(element.getAttribute("cx")) !== junction.x
            || Number(element.getAttribute("cy")) !== junction.y;
        }).length + Math.max(0, renderedJunctions.length - junctionsById.size);
        const unresolvedDom = JSON.parse(elements.get("graph-svg").getAttribute("data-unresolved-routes") || "[]");
        const expectedJunctionCount = junctions.length;
        metrics.push({ service: target.name, view, relationCount: routing.relations.length,
          routedCount: Object.keys(routing.routesByRelationId).length, missingCount: missing.length,
          unresolvedCount: routing.unresolved.length, unresolvedReasons: Object.fromEntries(Array.from(
            new Set(routing.unresolved.map((item) => item.reason)),
            (reason) => [reason, routing.unresolved.filter((item) => item.reason === reason).length])),
          unresolvedRelations: routing.unresolved.map(({ relationId, reason }) => {
            const relation = routing.relations.find((item) => item.id === relationId);
            const source = relation && displayModel.itemById[relation.sourceItemId];
            const targetItem = relation && displayModel.itemById[relation.targetItemId];
            const sourceCard = relation && displayModel.cardById[relation.sourceInstanceId];
            const targetCard = relation && displayModel.cardById[relation.targetInstanceId];
            const portPoint = (id) => {
              const port = id && displayModel.portById[id];
              return port ? [port.x, port.y] : null;
            };
            const bounds = (card) => card ? [card.bounds.x, card.bounds.y,
              card.bounds.width, card.bounds.height] : null;
            return { relationKind: relationId.split(":", 1)[0], reason, role: relation?.role,
              type: relation?.type, sourceKind: source?.kind, targetKind: targetItem?.kind,
              sourceCardKind: sourceCard?.kind, targetCardKind: targetCard?.kind,
              sourceItemBounds: source?.bounds && [source.bounds.x, source.bounds.y,
                source.bounds.width, source.bounds.height],
              targetItemBounds: targetItem?.bounds && [targetItem.bounds.x, targetItem.bounds.y,
                targetItem.bounds.width, targetItem.bounds.height],
              sourcePort: portPoint(relation?.visualSourcePortId), targetPort: portPoint(relation?.visualTargetPortId),
              sourceCard: bounds(sourceCard), targetCard: bounds(targetCard) };
          }),
          disconnectedCount: disconnected.length, roleCounts, segmentCount: routing.segments.length,
          sharedSegmentCount: routing.segments.filter((segment) => segment.relationIds.length > 1).length,
          cubicSegmentCount: routing.segments.filter((segment) => segment.geometry?.kind === "CUBIC").length,
          routeOrderErrors, wrongPortDirectionCount, routePortErrors, portPlacementErrors,
          segmentMembershipErrors, svgSegmentErrors,
          svgErrorExamples,
          duplicatePhysicalSegmentCount, curveCollisionCount, junctionErrors, junctionDomErrors,
          duplicatePhysicalSegmentExamples, curveCollisionExamples, junctionErrorExamples,
          unresolvedDomCount: unresolvedDom.length,
          branchJunctionCount: expectedJunctionCount,
          renderedSegmentCount: rendered.length,
          uniqueRenderedSegmentCount: pathById.size,
          physicalSegmentCount: geometryCounts.size,
          renderedJunctionCount: findAllByClass(elements.get("graph-edges"), "graph-overview-junction").length });
      }
    }
    const failures = metrics.filter((item) => item.missingCount || item.unresolvedCount || item.disconnectedCount
      || item.renderedSegmentCount !== item.physicalSegmentCount || item.uniqueRenderedSegmentCount !== item.segmentCount
      || item.renderedJunctionCount !== item.branchJunctionCount || item.routeOrderErrors
      || item.wrongPortDirectionCount || item.segmentMembershipErrors || item.svgSegmentErrors
      || item.routePortErrors || item.portPlacementErrors
      || item.duplicatePhysicalSegmentCount || item.curveCollisionCount || item.junctionErrors
      || item.junctionDomErrors || item.unresolvedDomCount || item.cubicSegmentCount === 0);
    const failureDetails = failures.map((item) => ({ service: item.service, view: item.view,
      relationCount: item.relationCount, routedCount: item.routedCount, missingCount: item.missingCount,
      unresolvedRelations: item.unresolvedRelations, duplicateExamples: item.duplicatePhysicalSegmentExamples,
      unresolvedCount: item.unresolvedCount, disconnectedCount: item.disconnectedCount,
      routeOrderErrors: item.routeOrderErrors, wrongPortDirectionCount: item.wrongPortDirectionCount,
      routePortErrors: item.routePortErrors, portPlacementErrors: item.portPlacementErrors,
      segmentMembershipErrors: item.segmentMembershipErrors, svgSegmentErrors: item.svgSegmentErrors,
      svgErrorExamples: item.svgErrorExamples.slice(0, 3),
      duplicatePhysicalSegmentCount: item.duplicatePhysicalSegmentCount,
      curveCollisionCount: item.curveCollisionCount, curveCollisionExamples: item.curveCollisionExamples,
      junctionErrors: item.junctionErrors, junctionErrorExamples: item.junctionErrorExamples,
      junctionDomErrors: item.junctionDomErrors, unresolvedDomCount: item.unresolvedDomCount,
      renderedSegmentCount: item.renderedSegmentCount, segmentCount: item.segmentCount,
      renderedJunctionCount: item.renderedJunctionCount, branchJunctionCount: item.branchJunctionCount }));
    assert.deepEqual(failureDetails, [], `실제 Snapshot Overview 연결/렌더 지표 ${JSON.stringify(failureDetails)}`);
  });

  test("실제 Account API Item 선택은 명시 매핑과 해당 Row의 Flow만 강조함", async () => {
    const target = actualSnapshotTargets.find((item) => item.name === "Account");
    assert.ok(target, "실제 Account Snapshot 대상 필요");
    const response = await fetch(target.url);
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    const endpoint = snapshot.nodes.find((node) => node.type === "ENDPOINT"
      && node.attributes.httpMethod === "POST" && node.attributes.path === "/api/admin/savings/products");
    assert.ok(endpoint, "POST /api/admin/savings/products Endpoint 필요");
    const { ui, elements, window } = loadUi();
    ui.renderGraph(snapshot);
    ui.selectView("all-flow");
    await ui.layoutGraph();
    const plan = ui.state.layout.plan;
    const mapping = window.MapInBootFlow.createIndex(snapshot).handlerFor(endpoint.id);
    assert.equal(mapping.status, "CONFIRMED", "API–Handler 관계는 명시 FLOWS_TO로 확인");
    assert.match(mapping.node.attributes.handler, /AdminController#createSavingsProduct\(/);
    const item = compositeItemForNode(plan, endpoint.id, `chain:${snapshot.edges.find((edge) =>
      edge.type === "MATCHED_BY" && edge.sourceId === endpoint.id)?.targetId}`);
    assert.ok(item, "선택 Endpoint의 복합 항목 필요");
    const relationIds = new Set(plan.overviewRouting.relations.filter((relation) => relation.rowId === item.rowId
      && (relation.sourceItemId === item.id || relation.targetItemId === item.id
        || (relation.relatedNodeIds || []).includes(endpoint.id))).map((relation) => relation.id));
    assert.ok(Array.from(relationIds, (id) => plan.overviewRouting.relations.find((relation) => relation.id === id))
      .some((relation) => relation.role === "API_MAPPING" && relation.mappingEdgeIds.includes(mapping.edge.id)),
    "선택 API에 실제 Handler 매핑 Segment 존재");
    const itemElement = findAllByClass(elements.get("graph-nodes"), "graph-composite-item")
      .find((element) => element.getAttribute("data-composite-item-id") === item.id);
    assert.ok(itemElement);
    itemElement.dispatchEvent({ type: "click" });
    assert.equal(itemElement.getAttribute("data-related"), "true", "선택 항목 강조");
    const paths = findAllByClass(elements.get("graph-edges"), "graph-overview-segment");
    const incorrectPaths = paths.filter((path) => {
      const related = path.getAttribute("data-related") === "true";
      const containsSelectedRelation = path.getAttribute("data-relation-ids").split(",")
        .some((id) => relationIds.has(id));
      return related !== containsSelectedRelation;
    });
    assert.deepEqual(incorrectPaths.map((path) => path.getAttribute("data-segment-id")), [],
      "실제 관계 교집합과 Segment 강조 범위 일치");
    const unrelatedMappings = plan.overviewRouting.relations.filter((relation) => relation.role === "API_MAPPING"
      && !relationIds.has(relation.id));
    assert.ok(unrelatedMappings.length > 0, "비교할 다른 API 매핑 필요");
    const unrelatedSegments = new Set(unrelatedMappings.flatMap((relation) =>
      plan.overviewRouting.routesByRelationId[relation.id]?.orderedSegmentIds || []));
    assert.equal(paths.filter((path) => unrelatedSegments.has(path.getAttribute("data-segment-id"))
      && path.getAttribute("data-related") === "true").length, 0, "다른 API 매핑 흐림 유지");

    const routing = plan.overviewRouting;
    const relationById = new Map(routing.relations.map((relation) => [relation.id, relation]));
    const mergedPath = paths.find((path) => (path.getAttribute("data-segment-ids") || "").split(",").length > 1
      && (path.getAttribute("data-edge-ids") || "").split(",").filter(Boolean).length > 1);
    assert.ok(mergedPath, "여러 논리 Segment를 공유하는 실제 SVG 선분 필요");
    const mergedEdges = mergedPath.getAttribute("data-edge-ids").split(",").filter(Boolean);
    mergedPath.dispatchEvent({ type: "click" });
    assert.deepEqual(Array.from(ui.state.selection.segmentEdgeIds).sort(), mergedEdges.slice().sort());
    const inspectorLinks = findAllByClass(elements.get("inspector"), "inspector-link");
    mergedEdges.forEach((id) => assert.ok(inspectorLinks.some((link) => link.getAttribute("data-edge-id") === id), id));
    for (const id of mergedEdges.slice(0, 2)) {
      const link = findAllByClass(elements.get("inspector"), "inspector-link")
        .find((item) => item.getAttribute("data-edge-id") === id);
      if (!link) {
        mergedPath.dispatchEvent({ type: "click" });
      }
      findAllByClass(elements.get("inspector"), "inspector-link")
        .find((item) => item.getAttribute("data-edge-id") === id).dispatchEvent({ type: "click" });
      assert.equal(ui.state.selection.id, id);
      const edge = snapshot.edges.find((item) => item.id === id);
      assert.ok(edge.evidenceIds.length > 0);
      assert.ok(findAllByClass(elements.get("inspector"), "inspector-evidence").length > 0);
    }
    const graphNodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const flowIndex = window.MapInBootFlow.createIndex(snapshot);
    const renderedPaths = () => findAllByClass(elements.get("graph-edges"), "graph-overview-segment");
    const selectItemAndCheckScope = (selectedItem) => {
      const renderedItem = findAllByClass(elements.get("graph-nodes"), "graph-composite-item")
        .find((element) => element.getAttribute("data-composite-item-id") === selectedItem.id);
      assert.ok(renderedItem, `${selectedItem.label} 복합 항목 렌더링`);
      renderedItem.dispatchEvent({ type: "click" });
      const scope = window.MapInBootInspector.related(ui.state.graph, ui.state.selection, [], snapshot,
        plan.displayModel, routing);
      assert.ok(scope.displayItemIds.has(selectedItem.id), `${selectedItem.label} 선택 항목 범위`);
      const inScopeRelations = routing.relations.filter((relation) => scope.visualRelationIds.has(relation.id));
      assert.ok(inScopeRelations.length > 0, `${selectedItem.label} 실제 관계`);
      assert.ok(inScopeRelations.every((relation) => relation.rowId === selectedItem.rowId),
        `${selectedItem.label} 다른 Chain Row 제외`);
      const expectedSegments = new Set(inScopeRelations.flatMap((relation) =>
        routing.routesByRelationId[relation.id]?.orderedSegmentIds || []));
      assert.deepEqual(Array.from(scope.segmentIds).sort(), Array.from(expectedSegments).sort(),
        `${selectedItem.label} 관계 Segment 합집합`);
      const incorrect = renderedPaths().filter((path) =>
        (path.getAttribute("data-related") === "true") !== (path.getAttribute("data-segment-ids") || "")
          .split(",").some((id) => scope.segmentIds.has(id)));
      assert.deepEqual(incorrect.map((path) => path.getAttribute("data-segment-id")), [],
        `${selectedItem.label} 실제 Segment만 강조`);

      const endpointAnchors = new Set(inScopeRelations.map((relation) => relation.viaEndpointId).filter(Boolean));
      assert.ok(endpointAnchors.size > 0, `${selectedItem.label} 원본 Endpoint 참조`);
      const mappingRelations = inScopeRelations.filter((relation) => relation.role === "API_MAPPING");
      assert.ok(mappingRelations.length > 0, `${selectedItem.label} 명시 API–Handler 매핑`);
      mappingRelations.forEach((mappingRelation) => {
        const endpointIds = (mappingRelation.relatedNodeIds || []).filter((id) => graphNodeById.get(id)?.type === "ENDPOINT");
        const handlerIds = (mappingRelation.relatedNodeIds || []).filter((id) => graphNodeById.get(id)?.type === "HANDLER");
        assert.equal(endpointIds.length, 1, `${selectedItem.label} 매핑 Endpoint 개수`);
        assert.equal(handlerIds.length, 1, `${selectedItem.label} 매핑 Handler 개수`);
        assert.ok(endpointAnchors.has(endpointIds[0]), `${selectedItem.label} 원본 근거 Endpoint만 매핑`);
        const confirmed = flowIndex.handlerFor(endpointIds[0]);
        assert.equal(confirmed.status, "CONFIRMED", `${selectedItem.label} 명시 Handler 관계`);
        assert.equal(confirmed.node.id, handlerIds[0], `${selectedItem.label} Handler 관계 일치`);
        assert.ok(mappingRelation.mappingEdgeIds.includes(confirmed.edge.id), `${selectedItem.label} FLOWS_TO 참조`);
        assert.ok(scope.nodeIds.has(endpointIds[0]) && scope.nodeIds.has(handlerIds[0]),
          `${selectedItem.label} Endpoint 및 Handler 강조`);
      });
      const unrelatedMappingRelations = routing.relations.filter((relation) => relation.rowId === selectedItem.rowId
        && relation.role === "API_MAPPING" && !scope.visualRelationIds.has(relation.id));
      assert.ok(unrelatedMappingRelations.length > 0, `${selectedItem.label} 비교할 무관 API 매핑`);
      unrelatedMappingRelations.forEach((unrelated) => {
        const exclusiveSegments = routing.routesByRelationId[unrelated.id].orderedSegmentIds.filter((id) => {
          const segment = routing.segments.find((candidate) => candidate.id === id);
          return segment && segment.relationIds.every((memberId) => !scope.visualRelationIds.has(memberId));
        });
        assert.ok(exclusiveSegments.every((id) => !scope.segmentIds.has(id)),
          `${selectedItem.label} 무관 API 전용 Branch 제외`);
      });
      return scope;
    };

    const cases = [
      ["ROLE_STAFF 권한 필요", (item) => item.label === "ROLE_STAFF 권한 필요"],
      ["ROLE_BANK_ADMIN 권한 필요", (item) => item.label === "ROLE_BANK_ADMIN 권한 필요"],
      ["ROLE_CUSTOMER 권한 필요", (item) => item.label === "ROLE_CUSTOMER 권한 필요"],
      ["Principal 조회", (item) => item.label === "Principal 조회"],
      ["JWT Claim 조회", (item) => item.label === "JWT Claim 조회"],
      ["identity_verified 업무 상태", (item) => item.label.includes("identity_verified")]
    ];
    cases.forEach(([label, matches]) => {
      const matchingItems = Object.values(plan.displayModel.itemById)
        .filter((candidate) => candidate.rowId?.startsWith("chain:") && matches(candidate));
      assert.ok(matchingItems.length > 0, `실제 Snapshot의 ${label} 항목`);
      matchingItems.forEach((candidate) => selectItemAndCheckScope(candidate));
    });

    const selectedCard = plan.displayModel.cardById[item.cardId];
    const cardElement = findAllByClass(elements.get("graph-nodes"), "graph-composite-card")
      .find((element) => element.getAttribute("data-composite-card-id") === selectedCard.id);
    assert.ok(cardElement, "API 복합 카드 Header 렌더링");
    cardElement.dispatchEvent({ type: "click" });
    const cardScope = window.MapInBootInspector.related(ui.state.graph, ui.state.selection, [], snapshot,
      plan.displayModel, routing);
    assert.deepEqual(Array.from(cardScope.rowIds), [selectedCard.rowId], "카드 Header는 해당 Row만 선택");
    const cardItemIds = new Set(selectedCard.items.map((entry) => entry.id));
    const cardNodeIds = new Set(selectedCard.items.flatMap((entry) => entry.originalNodeIds || []));
    const expectedCardRelations = routing.relations.filter((relation) => relation.rowId === selectedCard.rowId
      && (cardItemIds.has(relation.sourceItemId) || cardItemIds.has(relation.targetItemId)
        || (relation.relatedNodeIds || []).some((id) => cardNodeIds.has(id))));
    const expectedCardRelationIds = new Set(expectedCardRelations.map((entry) => entry.id));
    assert.deepEqual({
      missing: Array.from(expectedCardRelationIds).filter((id) => !cardScope.visualRelationIds.has(id)),
      extra: Array.from(cardScope.visualRelationIds).filter((id) => !expectedCardRelationIds.has(id))
    }, { missing: [], extra: [] }, "카드 Header는 내부 Flow 합집합만 선택");

    const handlerItemIds = plan.displayModel.originalNodeToItemIds[mapping.node.id] || [];
    const handlerItem = handlerItemIds.map((id) => plan.displayModel.itemById[id])
      .find((candidate) => candidate?.rowId === item.rowId);
    assert.ok(handlerItem, "같은 Chain Row의 명시 매핑 Handler 항목 필요");
    const handlerScope = selectItemAndCheckScope(handlerItem);
    const handlerMappingRelations = routing.relations.filter((relation) => relation.rowId === handlerItem.rowId
      && relation.role === "API_MAPPING" && (relation.relatedNodeIds || []).includes(mapping.node.id));
    assert.ok(handlerMappingRelations.length > 0, "선택 Handler의 명시 Endpoint 매핑 필요");
    handlerMappingRelations.forEach((relation) => {
      const endpointId = (relation.relatedNodeIds || []).find((id) => graphNodeById.get(id)?.type === "ENDPOINT");
      const confirmed = flowIndex.handlerFor(endpointId);
      assert.equal(confirmed.status, "CONFIRMED", "Handler 항목의 Endpoint 매핑 확인");
      assert.equal(confirmed.node.id, mapping.node.id, "Handler 항목은 매핑된 원본 Handler만 포함");
      assert.ok(handlerScope.visualRelationIds.has(relation.id), "Handler 항목의 실제 매핑 Flow 강조");
    });
    const handlerCard = plan.displayModel.cardById[handlerItem.cardId];
    const handlerCardElement = findAllByClass(elements.get("graph-nodes"), "graph-composite-card")
      .find((element) => element.getAttribute("data-composite-card-id") === handlerCard.id);
    assert.ok(handlerCardElement, "Handler 복합 카드 Header 렌더링");
    handlerCardElement.dispatchEvent({ type: "click" });
    const handlerCardScope = window.MapInBootInspector.related(ui.state.graph, ui.state.selection, [], snapshot,
      plan.displayModel, routing);
    assert.deepEqual(Array.from(handlerCardScope.rowIds), [handlerCard.rowId], "Handler 카드 Header는 해당 Row만 선택");
    const handlerCardItemIds = new Set(handlerCard.items.map((entry) => entry.id));
    const handlerCardNodeIds = new Set(handlerCard.items.flatMap((entry) => entry.originalNodeIds || []));
    const expectedHandlerCardRelationIds = new Set(routing.relations.filter((relation) => relation.rowId === handlerCard.rowId
      && (handlerCardItemIds.has(relation.sourceItemId) || handlerCardItemIds.has(relation.targetItemId)
        || (relation.relatedNodeIds || []).some((id) => handlerCardNodeIds.has(id))))
      .map((relation) => relation.id));
    assert.deepEqual({
      missing: Array.from(expectedHandlerCardRelationIds).filter((id) => !handlerCardScope.visualRelationIds.has(id)),
      extra: Array.from(handlerCardScope.visualRelationIds).filter((id) => !expectedHandlerCardRelationIds.has(id))
    }, { missing: [], extra: [] }, "Handler 카드 Header는 내부 Flow 합집합만 선택");

    const trunk = routing.segments.find((segment) => segment.routeRole === "TRUNK" && segment.relationIds.length > 1);
    assert.ok(trunk, "실제 공통 Trunk 필요");
    const trunkPath = renderedPaths().find((path) => path.getAttribute("data-segment-id") === trunk.id);
    trunkPath.dispatchEvent({ type: "click" });
    assert.equal(ui.state.selection.segmentId, trunk.id, "공통 Trunk 선택");
    assert.deepEqual(renderedPaths().filter((path) => path.getAttribute("data-related") === "true")
      .map((path) => path.getAttribute("data-segment-id")), [trunk.id], "선택 Trunk만 강조");
    const branch = routing.segments.find((segment) => segment.fromJunctionId && segment.relationIds.length === 1);
    assert.ok(branch, "실제 Junction 출발 단일 Branch 필요");
    const branchPath = renderedPaths().find((path) => path.getAttribute("data-segment-id") === branch.id);
    branchPath.dispatchEvent({ type: "click" });
    assert.equal(ui.state.selection.segmentId, branch.id, "개별 Branch 선택");
    assert.deepEqual(renderedPaths().filter((path) => path.getAttribute("data-related") === "true")
      .map((path) => path.getAttribute("data-segment-id")), [branch.id], "개별 Branch만 강조");
  });
}

test("긴급 안정화: 내부 학습 관계는 Port와 표시 Segment 없이 유지됨", () => {
  const { ui, layoutApi } = loadUi();
  const graph = ui.normalizeGraph(detailGraphFixture());
  const plan = layoutApi.semanticLayout({ ...graph, presentationContext: "detail" }, { positions: {} }).plan;
  const internal = plan.overviewRouting.relations.filter((relation) => relation.internalCardId && relation.role === "LEARNING_FLOW");
  assert.ok(internal.length > 0);
  for (const relation of internal) {
    assert.equal(relation.visualSourcePortId, null);
    assert.equal(relation.visualTargetPortId, null);
    assert.equal(plan.overviewRouting.segments.some((segment) => segment.relationIds.includes(relation.id)), false);
  }
  for (const port of plan.displayModel.ports) {
    const item = plan.displayModel.itemById[port.itemId];
    const card = plan.displayModel.cardById[item.cardId];
    if (port.side === "LEFT") assert.equal(port.x, card.bounds.x);
    if (port.side === "RIGHT") assert.equal(port.x, card.bounds.right);
    if (port.side === "TOP") assert.equal(port.y, card.bounds.y);
    if (port.side === "BOTTOM") assert.equal(port.y, card.bounds.bottom);
  }
});


test("긴급 안정화: 최종 표시 항목 주변에만 Finding 영역을 배치함", () => {
  const { ui, layoutApi } = loadUi();
  const graph = ui.normalizeGraph(detailGraphFixture());
  graph.findingSections = [
    { finding: { id: "finding-area", title: "영향" }, nodeIds: ["endpoint-a", "authorization-a"], edgeIds: [] },
    { finding: { id: "finding-second", title: "별도 인가 조건의 충분히 긴 취약점 제목" }, nodeIds: ["endpoint-a"], edgeIds: [] },
    { finding: { id: "finding-empty", title: "없음" }, nodeIds: ["not-visible"], edgeIds: [] }
  ];
  const layout = layoutApi.semanticLayout({ ...graph, presentationContext: "detail" }, { positions: {} });
  const model = layout.plan.displayModel;
  const sections = layout.plan.findingSectionLayouts;
  assert.ok(sections.some((section) => section.findingId === "finding-area"));
  assert.equal(sections.some((section) => section.findingId === "finding-empty"), false);
  const endpointCard = model.cardById[model.itemById[model.originalNodeToItemIds["endpoint-a"][0]].cardId];
  const endpointSections = sections.filter((section) => section.bounds.left === endpointCard.bounds.x - 32);
  assert.equal(endpointSections.length, 2);
  assert.ok(endpointSections[0].titleBounds.top >= endpointSections[1].titleBounds.bottom
    || endpointSections[1].titleBounds.top >= endpointSections[0].titleBounds.bottom);
  assert.ok(endpointSections.every((section) => section.titleBounds.bottom < endpointCard.bounds.y));
  for (const id of ["endpoint-a", "authorization-a"]) {
    const items = (model.originalNodeToItemIds[id] || []).map((itemId) => model.itemById[itemId]);
    assert.ok(items.length);
    assert.ok(items.every((item) => sections.some((section) => {
      const card = model.cardById[item.cardId];
      return section.findingId === "finding-area" && section.bounds.left <= card.bounds.x - 32
        && section.bounds.right >= card.bounds.right + 32 && section.bounds.top <= card.bounds.y - 48
        && section.bounds.bottom >= card.bounds.bottom + 28 && section.titleBounds.bottom <= card.bounds.y;
    })));
  }
});

test("긴급 안정화: 내부 단계는 표시선 없이 이동하고 활성 항목과 점이 바뀜", async () => {
  const animationClock = createFakeClock();
  const { ui, elements } = loadUi({ animationClock });
  ui.renderGraph(detailGraphFixture());
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();
  const steps = ui.state.requestFlowSteps;
  const index = steps.findIndex((step) => step.transition && step.transition.kind === "internal");
  assert.ok(index >= 0, "내부 학습 경로 필요");
  assert.equal(ui.requestFlow.seekToStep(index), true);
  const active = () => findAllByClass(elements.get("graph-nodes"), "graph-composite-item")
    .find((item) => item.getAttribute("data-request-flow-active") === "true");
  assert.equal(active().getAttribute("data-composite-item-id"), steps[index].displayItemId);
  assert.equal(elements.get("request-flow-dot").hasAttribute("hidden"), false);
  ui.requestFlow.play();
  animationClock.tick(1600);
  assert.equal(ui.requestFlow.state().phase, "EDGE_TRAVEL");
  assert.equal(elements.get("request-flow-dot").hasAttribute("hidden"), false);
  const transition = steps[index].transition;
  assert.notEqual(transition.from.y, transition.to.y);
  assert.ok(Number(elements.get("request-flow-dot").getAttribute("cy")) >= Math.min(transition.from.y, transition.to.y));
  ui.requestFlow.seekToStep(index + 1);
  assert.equal(active().getAttribute("data-composite-item-id"), steps[index + 1].displayItemId);
});

if (actualSnapshotTargets.length) {
  test("실제 Snapshot 상세 요청 단계는 표시 항목과 가로 방향 경로를 유지함", async () => {
    for (const target of actualSnapshotTargets) {
    const snapshot = await (await fetch(target.url)).json();
    const endpoint = snapshot.nodes.find((node) => node.type === "ENDPOINT"
      && (target.name === "Account" ? node.attributes.httpMethod === "POST"
        && node.attributes.path === "/api/admin/savings/products"
        : snapshot.edges.some((edge) => edge.type === "FLOWS_TO" && edge.confidence === "CONFIRMED" && edge.sourceId === node.id)));
    assert.ok(endpoint, `${target.name}: Endpoint 필요`);
    const { ui } = loadUi();
    ui.renderGraph(snapshot);
    ui.openEndpointDetail(endpoint.id);
    await ui.layoutGraph();
    const model = ui.state.layout.plan.displayModel;
    const routing = ui.state.layout.plan.overviewRouting;
    const regions = new Map((ui.state.layout.plan.detailBlueprint.regions || []).map((region) => [region.kind, region]));
    const contains = (outer, inner) => outer.left <= inner.left && outer.top <= inner.top
      && outer.right >= inner.right && outer.bottom >= inner.bottom;
    for (const [parent, child] of [["HOST", "SERVLET"], ["SERVLET", "SECURITY"], ["SERVLET", "MVC"]]) {
      if (regions.get(parent)?.bounds && regions.get(child)?.bounds) {
        assert.ok(contains(regions.get(parent).bounds, regions.get(child).bounds), `${target.name}: 영역 계층 ${parent}/${child}`);
      }
    }
    const security = regions.get("SECURITY")?.bounds;
    const mvc = regions.get("MVC")?.bounds;
    if (security && mvc) assert.ok(security.right < mvc.left || mvc.right < security.left
      || security.bottom < mvc.top || mvc.bottom < security.top, `${target.name}: 기술 영역 겹침`);
    const segmentById = new Map(routing.segments.map((segment) => [segment.id, segment]));
    const same = (a, b) => Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;
    for (const relation of routing.relations.filter((item) => item.role === "LEARNING_FLOW" && !item.internalCardId)) {
      const route = routing.routesByRelationId[relation.id];
      assert.ok(route, `${target.name}: 경로 누락 ${relation.id}`);
      assert.ok(same(route.sourcePort, model.portById[relation.visualSourcePortId]));
      assert.ok(same(route.targetPort, model.portById[relation.visualTargetPortId]));
      assert.equal(route.sourcePort.side, "RIGHT", `${target.name}: 출발 방향`);
      assert.equal(route.targetPort.side, "LEFT", `${target.name}: 도착 방향`);
      let point = route.sourcePort;
      for (const id of route.orderedSegmentIds) {
        const segment = segmentById.get(id);
        assert.ok(segment && (same(point, segment.from) || same(point, segment.to)), `${target.name}: 단절 ${id}`);
        point = same(point, segment.from) ? segment.to : segment.from;
      }
      assert.ok(same(point, route.targetPort), `${target.name}: 도착 Port 불일치`);
    }
    const contexts = model.runtimeComponents.filter((component) => component.kind === "SERVLET_CONTEXT");
    if (contexts.length === 1) {
      const context = model.itemById[model.projectionToItemIds["education-servlet-container"]?.[0]];
      assert.ok(context?.runtimeComponentIds.includes(contexts[0].id), `${target.name}: 컨텍스트 참조 누락`);
      assert.equal(model.composites.filter((card) => card.title === "서블릿 컨테이너").length, 1);
    }
    const steps = ui.state.requestFlowSteps.filter((step) => step.anchorId);
    assert.ok(steps.length > 5);
    for (const step of steps) {
      assert.ok(model.itemById[step.displayItemId], `${step.id}: 표시 항목 누락`);
      assert.ok(!step.label.includes("|"), `${step.id}: 내부 식별자 노출`);
    }
    for (const relation of routing.relations.filter((item) => item.role === "LEARNING_FLOW" && !item.internalCardId)) {
      const source = model.cardById[relation.sourceInstanceId];
      const destination = model.cardById[relation.targetInstanceId];
      if (relation.projectionEdgeIds.some((id) => id.startsWith("handler-to-http-response"))) continue;
      assert.ok(destination.bounds.x > source.bounds.x, `역행: ${relation.projectionEdgeIds.join(",")} ${source.title} → ${destination.title}`);
      assert.equal(source.bounds.y + source.bounds.height / 2, destination.bounds.y + destination.bounds.height / 2,
        `${target.name}: 주 흐름 중심선`);
      assert.ok(routing.routesByRelationId[relation.id], `경로 없음: ${relation.projectionEdgeIds.join(",")}`);
    }
    const byProjection = (id) => model.itemById[model.projectionToItemIds[id]?.[0]];
    const request = byProjection("education-http-request");
    const container = byProjection("education-servlet-container");
    const requestObject = byProjection("education-http-servlet-request");
    const responseObject = byProjection("education-http-servlet-response");
    assert.ok(request && container && requestObject && responseObject);
    assert.notEqual(request.cardId, requestObject.cardId);
    assert.equal(requestObject.cardId, responseObject.cardId);
    assert.equal(model.projectionToItemIds["education-request-prepare"], undefined);
    }
  });
}


test("요청 흐름 상세 팝오버는 단계 이동과 닫기 조작을 따름", async () => {
  const { ui, elements, document } = loadUi();
  const controls = elements.get("request-flow-controls");
  const detail = elements.get("request-flow-details");
  const toggle = elements.get("request-flow-detail-toggle");
  controls.append(toggle, detail);
  detail.append(elements.get("request-flow-detail-close"), elements.get("request-flow-next"));
  document.body.append(controls);
  ui.renderGraph(detailGraphFixture());
  ui.openEndpointDetail("endpoint-a");
  await ui.layoutGraph();
  assert.equal(detail.hidden, true);
  assert.equal(toggle.disabled, false);
  toggle.dispatchEvent({ type: "click" });
  assert.equal(detail.hidden, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  const title = elements.get("request-flow-step-title").textContent;
  elements.get("request-flow-next").dispatchEvent({ type: "click" });
  assert.equal(ui.requestFlow.state().stepIndex, 1);
  assert.notEqual(elements.get("request-flow-step-title").textContent, title);
  assert.equal(detail.hidden, false);
  elements.get("request-flow-detail-close").dispatchEvent({ type: "click" });
  assert.equal(detail.hidden, true);
  toggle.dispatchEvent({ type: "click" });
  document.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(detail.hidden, true);
  toggle.dispatchEvent({ type: "click" });
  document.dispatchEvent({ type: "click", target: document.body });
  assert.equal(detail.hidden, false);
  toggle.dispatchEvent({ type: "click" });
  assert.equal(detail.hidden, true);
  assert.doesNotMatch(indexHtml, /id="setting-show-detail-flow"/);
});
