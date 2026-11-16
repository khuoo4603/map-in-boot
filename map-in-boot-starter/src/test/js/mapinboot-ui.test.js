import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

function createElement() {
  const attributes = {};
  return {
    attributes,
    classList: { toggle() {} },
    dataset: {},
    hidden: false,
    textContent: "",
    addEventListener() {},
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
    "graph-state-message", "service-name", "snapshot-time"
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
    }
  };
  const window = {};
  vm.runInNewContext(
    readFileSync("map-in-boot-starter/src/main/resources/static/mapinboot/app.js", "utf8"),
    { console, document, window }
  );
  return window.MapInBootUi;
}

test("실행 단계와 HTTP 상태를 사용자 문구로 구분함", () => {
  const ui = loadUi();

  assert.equal(ui.executionPhaseLabel("NOT_STARTED"), "대기");
  assert.equal(ui.executionPhaseLabel("RUNNING"), "실행 중");
  assert.equal(ui.executionPhaseLabel("PARTIAL"), "부분 완료");
  assert.equal(ui.executionPhaseLabel("COMPLETED"), "완료");
  assert.equal(ui.executionPhaseLabel("FAILED"), "실패");
  assert.equal(ui.requestMessage(401, "status"), "인증 필요");
  assert.equal(ui.requestMessage(403, "snapshot"), "Snapshot 관리자 권한 필요");
  assert.equal(ui.requestMessage(404, "snapshot"), "보존 Snapshot 없음");
});
