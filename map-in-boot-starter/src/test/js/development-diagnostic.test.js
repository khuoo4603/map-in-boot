const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const scriptPath = "map-in-boot-starter/src/main/resources/META-INF/mapinboot/development-diagnostic/development-diagnostic.js";

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
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

function createHarness(report) {
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
    setTimeout
  };
  vm.runInNewContext(fs.readFileSync(scriptPath, "utf8"), context);
  return { content: elements.get("view-content"), nav };
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
