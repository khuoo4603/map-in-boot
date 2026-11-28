const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const scriptPath = "map-in-boot-starter/src/main/resources/META-INF/mapinboot/development-diagnostic/development-diagnostic.js";

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.dataset = {};
    this.classList = { toggle: () => {} };
    this.style = {};
    this.className = "";
    this.hidden = false;
    this.textContent = "";
  }

  append(...items) {
    items.filter((item) => item !== null && item !== undefined).forEach((item) => this.children.push(item));
  }

  replaceChildren(...items) {
    this.children = [];
    this.append(...items);
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  click() {
    if (this.listeners.click) this.listeners.click();
  }

  focus() {}

  remove() {}

  get innerText() {
    return this.textContent + this.children
      .map((item) => item instanceof Element ? item.innerText : String(item))
      .join("");
  }
}

function objectFact(type, handler, subjectKey, attributes) {
  return {
    id: `${type}-${subjectKey}`,
    type,
    subjectKey,
    attributes: { handler, ...attributes },
    evidenceIds: ["shared-evidence"]
  };
}

function reportWithSharedEvidence() {
  const requirementA = objectFact("OBJECT_AUTHORIZATION_REQUIREMENT", "HandlerA", "requirement-a", {
    declaringMethod: "HandlerA",
    requirementKind: "OWNER",
    resourceType: "Account",
    principalSource: "JWT_SUBJECT"
  });
  const pathA = objectFact("OBJECT_ACCESS_PATH", "HandlerA", "path-a", {
    codeLocation: "HandlerA:20",
    resourceType: "Account",
    requirementKey: requirementA.subjectKey,
    pathOutcome: "UNGUARDED",
    coverage: "COMPLETE_SUPPORTED_PATH",
    principalSource: "JWT_SUBJECT"
  });
  const requirementB = objectFact("OBJECT_AUTHORIZATION_REQUIREMENT", "HandlerB", "requirement-b", {
    declaringMethod: "HandlerB",
    requirementKind: "OWNER",
    resourceType: "Account",
    principalSource: "JWT_SUBJECT"
  });
  const pathB = objectFact("OBJECT_ACCESS_PATH", "HandlerB", "path-b", {
    codeLocation: "HandlerB:20",
    resourceType: "Account",
    requirementKey: requirementB.subjectKey,
    pathOutcome: "UNGUARDED",
    coverage: "COMPLETE_SUPPORTED_PATH",
    principalSource: "REQUEST_HEADER"
  });
  const node = (fact) => ({
    id: `node-${fact.subjectKey}`,
    type: "AUTHORIZATION",
    serviceId: "orders",
    label: fact.subjectKey,
    attributes: { ...fact.attributes, factType: fact.type },
    evidenceIds: fact.evidenceIds
  });
  return {
    phase: "COMPLETED",
    errorCode: null,
    collectionPresent: true,
    collectionStatuses: { collector: "READY" },
    facts: [requirementA, pathA, requirementB, pathB],
    analysisPresent: true,
    analysisStatuses: { analyzer: "READY" },
    relations: [],
    evidence: [{ id: "shared-evidence", source: "RUNTIME", location: "test", summary: "shared" }],
    evidenceDisplayCodes: { "shared-evidence": "E-001" },
    diagnostics: [],
    currentSnapshotPresent: true,
    currentSnapshot: {
      snapshotId: "snapshot-1",
      serviceId: "orders",
      applicationVersion: "test",
      nodes: [node(requirementA), node(pathA), node(requirementB), node(pathB)],
      edges: [],
      findings: [{
        id: "finding-b",
        ruleId: "OBJECT_BINDING",
        title: "B Handler Finding",
        description: "B Handler description",
        confidence: "CONFIRMED",
        nodeIds: ["node-requirement-b", "node-path-b"],
        edgeIds: [],
        evidenceIds: ["shared-evidence"],
        guide: "B Handler guide"
      }],
      analysisStatus: { analyzer: "READY" }
    },
    persistedSnapshotPresent: true,
    persistedSnapshot: null
  };
}

function reportWithDiagnostics() {
  const report = reportWithSharedEvidence();
  report.collectionStatuses = { collector: "READY" };
  report.analysisStatuses = { analyzer: "PARTIAL" };
  report.diagnostics = [
    { adapterId: "security-object-authorization", errorCode: "MIB-004", summary: "원인 A" },
    { adapterId: "security-object-authorization", errorCode: "MIB-004", summary: "원인 A" },
    { adapterId: "security-object-authorization", errorCode: "MIB-004", summary: "원인 B" },
    { adapterId: "security-filter-registration-analysis", errorCode: "MIB-004", summary: "원인 A" }
  ];
  return report;
}

function reportWithoutBusinessState() {
  const report = reportWithSharedEvidence();
  report.collectionStatuses = { "security-business-state": "READY" };
  report.analysisStatuses = { "security-business-state-analysis": "READY" };
  return report;
}

function createHarness(report, clipboard = { writeText: async () => {} }) {
  const elements = new Map();
  ["view-content", "refresh-button", "snapshot-download-button", "request-state", "service-name", "service-meta"]
    .forEach((id) => elements.set(id, new Element("div")));
  const nav = ["dashboard", "endpoints", "chains", "policies", "filters", "object-authorization", "business-state", "findings", "evidence", "diagnostics"]
    .map((view) => {
      const item = new Element("button");
      item.dataset.view = view;
      return item;
    });
  const document = {
    body: new Element("body"),
    createElement: (tagName) => new Element(tagName),
    getElementById: (id) => elements.get(id),
    querySelectorAll: (selector) => selector === ".nav-item" ? nav : []
  };
  const context = {
    Blob: class {},
    URL: { createObjectURL: () => "blob:test", revokeObjectURL: () => {} },
    clearTimeout,
    console,
    document,
    fetch: async () => ({ ok: true, json: async () => report }),
    setTimeout,
    navigator: { clipboard }
  };
  vm.runInNewContext(fs.readFileSync(scriptPath, "utf8"), context);
  return { content: elements.get("view-content"), nav, requestState: elements.get("request-state") };
}

function findFirst(root, predicate) {
  if (!(root instanceof Element)) return null;
  if (predicate(root)) return root;
  for (const child of root.children) {
    const result = findFirst(child, predicate);
    if (result) return result;
  }
  return null;
}

test("공유 Evidence를 가진 다른 Handler Finding을 객체 상세 행에 귀속하지 않음", async () => {
  const harness = createHarness(reportWithSharedEvidence());
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.nav.find((item) => item.dataset.view === "object-authorization").click();

  const table = findFirst(harness.content, (item) => item.tagName === "table");
  const body = table.children.find((item) => item.tagName === "tbody");
  body.children[0].click();
  const inspector = findFirst(harness.content, (item) => item.className === "inspector");

  assert.ok(inspector);
  assert.equal(inspector.innerText.includes("finding-b"), false);

  body.children[1].click();
  assert.equal(inspector.innerText.includes("finding-b"), true);
});

test("Diagnostic을 Adapter·오류 코드·Summary별로 묶고 원본 건수를 보존함", async () => {
  const harness = createHarness(reportWithDiagnostics());
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.nav.find((item) => item.dataset.view === "diagnostics").click();

  assert.equal(harness.content.innerText.includes("전체 Diagnostic 4건"), true);
  assert.equal(harness.content.innerText.includes("그룹 3개"), true);
  assert.equal(harness.content.innerText.includes("원인 A"), true);
  assert.equal(harness.content.innerText.includes("원인 B"), true);
  assert.equal(harness.content.innerText.includes("2건"), true);
});

test("객체 인가 화면에 경로 판정·Coverage·관련 Finding 요약을 표시함", async () => {
  const harness = createHarness(reportWithSharedEvidence());
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.nav.find((item) => item.dataset.view === "object-authorization").click();

  assert.equal(harness.content.innerText.includes("객체 인가 요구 수"), true);
  assert.equal(harness.content.innerText.includes("접근 경로 분석 수"), true);
  assert.equal(harness.content.innerText.includes("UNGUARDED"), true);
  assert.equal(harness.content.innerText.includes("COMPLETE_SUPPORTED_PATH"), true);
  assert.equal(harness.content.innerText.includes("관련 Finding 수"), true);
});

test("업무 보안 상태 대상 없음과 안전 판정 아님을 구분해 표시함", async () => {
  const harness = createHarness(reportWithoutBusinessState());
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.nav.find((item) => item.dataset.view === "business-state").click();

  assert.equal(harness.content.innerText.includes("현재 서비스에서 업무 보안 상태 분석 대상이 발견되지 않았습니다."), true);
  assert.equal(harness.content.innerText.includes("분석 대상 0건은 서비스가 안전하다는 의미가 아닙니다."), true);
});

test("개발 진단 Evidence가 Snapshot 저장 표시 코드를 사용하고 원본 ID 접기·복사를 지원함", async () => {
  const copied = [];
  const report = reportWithSharedEvidence();
  const harness = createHarness(report, { writeText: async (text) => copied.push(text) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.nav.find((item) => item.dataset.view === "evidence").click();

  const table = findFirst(harness.content, (item) => item.tagName === "table");
  const body = table.children.find((item) => item.tagName === "tbody");
  assert.match(body.children[0].innerText, /E-001/);
  assert.doesNotMatch(body.children[0].innerText, /shared-evidence/);
  body.children[0].click();

  const inspector = findFirst(harness.content, (item) => item.className === "inspector");
  assert.match(inspector.innerText, /E-001/);
  const revealOriginal = findFirst(inspector, (item) => item.className === "evidence-id-toggle");
  const originalPanel = findFirst(inspector, (item) => item.className === "evidence-id-original");
  assert.equal(revealOriginal.getAttribute("aria-expanded"), "false");
  assert.equal(originalPanel.hidden, true);
  revealOriginal.click();
  assert.equal(revealOriginal.getAttribute("aria-expanded"), "true");
  assert.match(originalPanel.innerText, /shared-evidence/);
  findFirst(originalPanel, (item) => item.className === "evidence-id-copy").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(copied, ["shared-evidence"]);
  assert.equal(harness.requestState.textContent, "원본 식별자를 복사했습니다.");
});

test("개발 진단 구버전 Evidence 매핑은 설명 문구로 표시하고 원본 ID를 코드로 대체하지 않음", async () => {
  const report = reportWithSharedEvidence();
  report.evidenceDisplayCodes = {};
  const copied = [];
  const harness = createHarness(report, { writeText: async (text) => copied.push(text) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.nav.find((item) => item.dataset.view === "evidence").click();

  const table = findFirst(harness.content, (item) => item.tagName === "table");
  const row = table.children.find((item) => item.tagName === "tbody").children[0];
  assert.match(row.innerText, /표시 ID가 저장되지 않은 근거입니다\./);
  row.click();
  const inspector = findFirst(harness.content, (item) => item.className === "inspector");
  assert.match(inspector.innerText, /표시 ID가 저장되지 않은 근거입니다\./);
  const revealOriginal = findFirst(inspector, (item) => item.className === "evidence-id-toggle");
  assert.equal(revealOriginal.getAttribute("aria-expanded"), "false");
  revealOriginal.click();
  assert.equal(revealOriginal.getAttribute("aria-expanded"), "true");
  assert.match(findFirst(inspector, (item) => item.className === "evidence-id-original").innerText, /shared-evidence/);
  findFirst(inspector, (item) => item.className === "evidence-id-copy").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(copied, ["shared-evidence"]);
});

test("개발 진단에서 Evidence ID 참조가 비었을 때 누락 상태를 명시함", async () => {
  const report = reportWithSharedEvidence();
  report.facts[0].evidenceIds = [];
  const harness = createHarness(report);
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.nav.find((item) => item.dataset.view === "object-authorization").click();

  const table = findFirst(harness.content, (item) => item.tagName === "table");
  table.children.find((item) => item.tagName === "tbody").children[0].click();
  const inspector = findFirst(harness.content, (item) => item.className === "inspector");
  assert.match(inspector.innerText, /연결된 근거가 없습니다\./);
});
