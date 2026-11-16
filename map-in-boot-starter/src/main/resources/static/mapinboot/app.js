(() => {
  "use strict";

  const viewNames = {
    "all-flow": "전체 Flow Map",
    "feature-flow": "기능별 상세 Flow Map",
    "security-flow": "전체 취약점 진단 Flow Map",
    "security-detail": "기능별 상세 취약점 확인"
  };
  const sidebar = document.querySelector("#sidebar");
  const toggle = document.querySelector("#sidebar-toggle");
  const title = document.querySelector("#view-title");
  const viewState = document.querySelector("#view-state");
  const notice = document.querySelector("#shell-notice");
  const state = { pinned: false, hovered: false, view: "all-flow" };

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

  function showNotice(message) {
    notice.textContent = message;
    notice.hidden = false;
  }

  function selectView(view) {
    if (!viewNames[view]) return;
    state.view = view;
    title.textContent = viewNames[view];
    viewState.textContent = "Snapshot 조회 전";
    document.querySelectorAll(".nav-item").forEach((item) => {
      const active = item.dataset.view === view;
      item.classList.toggle("is-active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
    showNotice(`${viewNames[view]} 화면 선택`);
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
  document.querySelector("#refresh-button").addEventListener("click", () => {
    showNotice("Snapshot 조회 기능은 다음 단계에서 연결됩니다.");
  });

  renderSidebarState();
  window.MapInBootUi = { state, selectView, renderSidebarState };
})();
