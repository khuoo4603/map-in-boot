(function () {
  // 실제 DOM 대상을 화면 좌표로 강조하는 공통 학습 단계 엔진
  let session = null;
  let lastRun = null;

  function elementVisible(element) {
    if (!element || element.hidden || element.inert || element.disabled || element.isConnected === false
      || element.getAttribute("aria-hidden") === "true" || element.getAttribute("aria-disabled") === "true") return false;
    if (typeof element.getBoundingClientRect !== "function") return false;
    const rect = element.getBoundingClientRect();
    const width = Number(rect.width) || Number(rect.right) - Number(rect.left);
    const height = Number(rect.height) || Number(rect.bottom) - Number(rect.top);
    if (!(width > 0 && height > 0)) return false;
    const style = typeof window.getComputedStyle === "function"
      ? window.getComputedStyle(element) : element.style;
    return !style || (style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse");
  }

  function resolveTarget(step) {
    if (!step) return null;
    let target = step.target;
    if (typeof target === "function") {
      try {
        target = target();
      } catch (_error) {
        return null;
      }
    }
    if (typeof target === "string") return document.querySelector(target);
    return target && typeof target.getBoundingClientRect === "function" ? target : null;
  }

  function stepIsValid(step, target, context) {
    if (step.valid === false || step.isValid === false) return false;
    const condition = typeof step.valid === "function" ? step.valid
      : typeof step.isValid === "function" ? step.isValid : null;
    if (!condition) return true;
    try {
      return condition({ target, context }) !== false;
    } catch (_error) {
      return false;
    }
  }

  function setPixel(style, property, value) {
    style[property] = `${Math.round(value)}px`;
  }

  function viewportSize() {
    const root = document.documentElement || {};
    return {
      width: Math.max(1, Number(window.innerWidth) || Number(root.clientWidth) || 1024),
      height: Math.max(1, Number(window.innerHeight) || Number(root.clientHeight) || 768)
    };
  }

  function makeButton(label, className, ariaLabel) {
    const button = document.createElement("button");
    button.setAttribute("type", "button");
    button.setAttribute("class", className);
    if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
    button.textContent = label;
    return button;
  }

  function targetBounds(target, viewport) {
    if (!elementVisible(target)) return null;
    const rect = target.getBoundingClientRect();
    const left = Number(rect.left);
    const top = Number(rect.top);
    const right = Number(rect.right) || left + Number(rect.width);
    const bottom = Number(rect.bottom) || top + Number(rect.height);
    if (![left, top, right, bottom].every(Number.isFinite)) return null;
    if (right <= 0 || bottom <= 0 || left >= viewport.width || top >= viewport.height) return null;
    const padding = 8;
    return {
      left: Math.max(0, left - padding),
      top: Math.max(0, top - padding),
      right: Math.min(viewport.width, right + padding),
      bottom: Math.min(viewport.height, bottom + padding),
      padding
    };
  }

  function focusableControls(activeSession) {
    return [activeSession.closeButton, activeSession.previousButton, activeSession.nextButton]
      .filter((button) => button && !button.disabled && !button.hidden);
  }

  function restoreHelpButton(activeSession) {
    const button = activeSession.helpButton;
    if (!button) return;
    button.setAttribute("aria-expanded", "false");
    button.removeAttribute("aria-controls");
    button.setAttribute("aria-pressed", "false");
    button.style.zIndex = activeSession.helpZIndex || "";
  }

  function updateHelpButton(activeSession) {
    const button = activeSession.helpButton;
    if (!button) return;
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-controls", "spotlight-card");
    button.setAttribute("aria-pressed", "true");
    button.style.zIndex = "70";
    if (activeSession.helpPanel) activeSession.helpPanel.hidden = true;
  }

  function runStepCleanup(activeSession) {
    const entry = activeSession.currentEntry;
    if (!entry || !entry.prepared) return;
    entry.prepared = false;
    if (typeof entry.step.cleanup === "function") {
      entry.step.cleanup({ target: entry.target, context: activeSession.context });
    }
  }

  function describeState(activeSession) {
    return {
      active: true,
      current: activeSession.position + 1,
      total: activeSession.entries.length,
      step: activeSession.currentEntry ? activeSession.currentEntry.step : null
    };
  }

  function notifyState(activeSession) {
    if (typeof activeSession.context.onStateChange === "function") {
      activeSession.context.onStateChange(describeState(activeSession));
    }
  }

  function layout(activeSession) {
    if (!activeSession || session !== activeSession) return false;
    const findingModal = document.querySelector("#finding-modal");
    if (findingModal && !findingModal.hidden && findingModal.getAttribute("aria-hidden") !== "true") {
      close({ restoreFocus: false });
      return false;
    }
    const viewport = viewportSize();
    const target = resolveTarget(activeSession.currentEntry.step);
    const bounds = targetBounds(target, viewport);
    if (!bounds) {
      const position = activeSession.position;
      runStepCleanup(activeSession);
      activeSession.currentEntry = null;
      activeSession.entries.splice(position, 1);
      if (position < activeSession.entries.length) enterAt(activeSession, position, 1);
      else close();
      return false;
    }
    activeSession.currentEntry.target = target;
    if (activeSession.resizeObserver) {
      if (activeSession.observedTarget && activeSession.observedTarget !== target) {
        activeSession.resizeObserver.unobserve(activeSession.observedTarget);
      }
      if (activeSession.observedTarget !== target) activeSession.resizeObserver.observe(target);
      activeSession.observedTarget = target;
    }

    const shieldStyles = [
      { left: 0, top: 0, width: viewport.width, height: bounds.top },
      { left: 0, top: bounds.top, width: bounds.left, height: bounds.bottom - bounds.top },
      { left: bounds.right, top: bounds.top, width: viewport.width - bounds.right, height: bounds.bottom - bounds.top },
      { left: 0, top: bounds.bottom, width: viewport.width, height: viewport.height - bounds.bottom }
    ];
    shieldStyles.forEach((geometry, index) => {
      const shield = activeSession.shields[index];
      setPixel(shield.style, "left", geometry.left);
      setPixel(shield.style, "top", geometry.top);
      setPixel(shield.style, "width", geometry.width);
      setPixel(shield.style, "height", geometry.height);
    });

    setPixel(activeSession.frame.style, "left", bounds.left);
    setPixel(activeSession.frame.style, "top", bounds.top);
    setPixel(activeSession.frame.style, "width", bounds.right - bounds.left);
    setPixel(activeSession.frame.style, "height", bounds.bottom - bounds.top);
    const targetStyle = typeof window.getComputedStyle === "function"
      ? window.getComputedStyle(target) : target.style;
    const targetRadius = targetStyle && Number.parseFloat(targetStyle.borderTopLeftRadius) || 0;
    activeSession.frame.style.borderRadius = `${targetRadius + bounds.padding}px`;

    activeSession.card.style.maxHeight = "";
    const cardBounds = activeSession.card.getBoundingClientRect();
    const cardWidth = Math.min(Number(cardBounds.width) || 340, viewport.width - 24);
    let cardHeight = Math.min(Number(cardBounds.height) || 220, viewport.height - 24);
    const gap = 14;
    const available = {
      below: viewport.height - bounds.bottom - gap,
      above: bounds.top - gap,
      right: viewport.width - bounds.right - gap,
      left: bounds.left - gap
    };
    let placement = "below";
    if (available.below < cardHeight && available.above >= cardHeight) placement = "above";
    else if (available.below < cardHeight && available.above < cardHeight) {
      if (available.right >= cardWidth) placement = "right";
      else if (available.left >= cardWidth) placement = "left";
      else {
        placement = Object.keys(available).sort((a, b) => available[b] - available[a])[0];
      }
    }
    if (available[placement] < cardHeight) {
      // 작은 화면에서는 강조 대상과 겹치지 않도록 안내 카드를 가용 영역 안에서 스크롤
      cardHeight = Math.max(0, Math.min(available[placement], viewport.height - 24));
      activeSession.card.style.maxHeight = `${Math.round(cardHeight)}px`;
    }
    const desiredLeft = placement === "right" ? bounds.right + gap
      : placement === "left" ? bounds.left - cardWidth - gap
        : (bounds.left + bounds.right - cardWidth) / 2;
    const desiredTop = placement === "below" ? bounds.bottom + gap
      : placement === "above" ? bounds.top - cardHeight - gap
        : (bounds.top + bounds.bottom - cardHeight) / 2;
    setPixel(activeSession.card.style, "left", Math.max(12, Math.min(desiredLeft, viewport.width - cardWidth - 12)));
    setPixel(activeSession.card.style, "top", Math.max(12, Math.min(desiredTop, viewport.height - cardHeight - 12)));
    activeSession.card.dataset.placement = placement;
    return true;
  }

  function renderStep(activeSession) {
    const step = activeSession.currentEntry.step;
    activeSession.title.textContent = step.title || "안내";
    activeSession.description.textContent = step.description || "";
    activeSession.count.textContent = `${activeSession.position + 1} / ${activeSession.entries.length}`;
    activeSession.previousButton.disabled = activeSession.position === 0;
    activeSession.nextButton.textContent = activeSession.position === activeSession.entries.length - 1 ? "완료" : "다음";
    layout(activeSession);
    notifyState(activeSession);
  }

  function enterAt(activeSession, startPosition, direction) {
    let position = startPosition;
    while (position >= 0 && position < activeSession.entries.length) {
      const entry = activeSession.entries[position];
      const target = resolveTarget(entry.step);
      const valid = target && stepIsValid(entry.step, target, activeSession.context)
        && (elementVisible(target) || typeof entry.step.prepare === "function");
      if (!valid) {
        activeSession.entries.splice(position, 1);
        if (direction < 0) position -= 1;
        continue;
      }

      entry.target = target;
      if (typeof entry.step.prepare === "function") {
        entry.prepared = true;
        activeSession.currentEntry = entry;
        const result = entry.step.prepare({ target, context: activeSession.context });
        if (result === false) {
          runStepCleanup(activeSession);
          activeSession.currentEntry = null;
          activeSession.entries.splice(position, 1);
          continue;
        }
      }
      const preparedTarget = resolveTarget(entry.step);
      if (!preparedTarget || !stepIsValid(entry.step, preparedTarget, activeSession.context) || !elementVisible(preparedTarget)) {
        activeSession.currentEntry = entry;
        entry.target = preparedTarget;
        runStepCleanup(activeSession);
        activeSession.currentEntry = null;
        activeSession.entries.splice(position, 1);
        continue;
      }
      entry.target = preparedTarget;
      activeSession.position = position;
      activeSession.currentEntry = entry;
      renderStep(activeSession);
      return true;
    }
    close();
    return false;
  }

  function moveTo(position) {
    if (!session) return false;
    const activeSession = session;
    runStepCleanup(activeSession);
    activeSession.currentEntry = null;
    return enterAt(activeSession, position, position < activeSession.position ? -1 : 1);
  }

  function stopPropagation(event) {
    if (event && typeof event.stopPropagation === "function") event.stopPropagation();
  }

  function withinElement(element, container) {
    let current = element;
    while (current) {
      if (current === container) return true;
      current = current.parentNode;
    }
    return false;
  }

  function onKeydown(event) {
    if (!session) return;
    if (event.key === "Escape") {
      if (typeof event.preventDefault === "function") event.preventDefault();
      stopPropagation(event);
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = focusableControls(session);
    if (controls.length === 0) {
      if (typeof event.preventDefault === "function") event.preventDefault();
      session.card.focus();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!withinElement(event.target, session.card)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && (event.target === first || event.target === session.card)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (event.target === last || event.target === session.card)) {
      event.preventDefault();
      first.focus();
    }
  }

  function listen(activeSession) {
    activeSession.onResize = () => layout(activeSession);
    activeSession.onScroll = () => layout(activeSession);
    activeSession.onKeydown = onKeydown;
    window.addEventListener("resize", activeSession.onResize);
    document.addEventListener("scroll", activeSession.onScroll, true);
    document.addEventListener("keydown", activeSession.onKeydown);
    if (typeof window.ResizeObserver === "function") {
      activeSession.resizeObserver = new window.ResizeObserver(() => layout(activeSession));
    }
    if (typeof window.MutationObserver === "function" && document.body) {
      activeSession.mutationObserver = new window.MutationObserver((records) => {
        if (records.some((record) => !activeSession.root.contains(record.target))) layout(activeSession);
      });
      activeSession.mutationObserver.observe(document.body, { attributes: true, childList: true, subtree: true });
    }
  }

  function unlisten(activeSession) {
    window.removeEventListener("resize", activeSession.onResize);
    document.removeEventListener("scroll", activeSession.onScroll, true);
    document.removeEventListener("keydown", activeSession.onKeydown);
    if (activeSession.resizeObserver) activeSession.resizeObserver.disconnect();
    if (activeSession.mutationObserver) activeSession.mutationObserver.disconnect();
  }

  function addShield(activeSession) {
    const shield = document.createElement("div");
    shield.setAttribute("class", "spotlight-shield");
    shield.setAttribute("aria-hidden", "true");
    shield.addEventListener("click", stopPropagation);
    shield.addEventListener("pointerdown", stopPropagation);
    activeSession.root.appendChild(shield);
    activeSession.shields.push(shield);
  }

  function createLayer(activeSession) {
    const root = document.createElement("div");
    root.setAttribute("class", "spotlight-layer");
    root.setAttribute("aria-label", "화면 안내");
    root.style.zIndex = "60";
    activeSession.root = root;
    for (let index = 0; index < 4; index += 1) addShield(activeSession);

    const frame = document.createElement("div");
    frame.setAttribute("class", "spotlight-frame");
    frame.setAttribute("aria-hidden", "true");
    root.appendChild(frame);
    activeSession.frame = frame;

    const card = document.createElement("section");
    card.setAttribute("class", "spotlight-card");
    card.setAttribute("id", "spotlight-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "spotlight-title");
    card.setAttribute("aria-describedby", "spotlight-description");
    card.setAttribute("tabindex", "-1");
    card.addEventListener("click", stopPropagation);

    const heading = document.createElement("div");
    heading.setAttribute("class", "spotlight-heading");
    const count = document.createElement("p");
    count.setAttribute("class", "spotlight-step-count");
    count.setAttribute("aria-live", "polite");
    const closeButton = makeButton("닫기", "spotlight-close", "안내 닫기");
    heading.append(count, closeButton);

    const title = document.createElement("h2");
    title.setAttribute("id", "spotlight-title");
    const description = document.createElement("p");
    description.setAttribute("class", "spotlight-description");
    description.setAttribute("id", "spotlight-description");
    const actions = document.createElement("div");
    actions.setAttribute("class", "spotlight-actions");
    const previousButton = makeButton("이전", "spotlight-previous");
    const nextButton = makeButton("다음", "spotlight-next");
    previousButton.addEventListener("click", previous);
    nextButton.addEventListener("click", next);
    closeButton.addEventListener("click", close);
    actions.append(previousButton, nextButton);
    card.append(heading, title, description, actions);
    root.appendChild(card);
    document.body.appendChild(root);
    Object.assign(activeSession, { card, count, title, description, previousButton, nextButton, closeButton });
  }

  function closeSettingsDrawer(context) {
    const drawer = document.querySelector("#settings-panel");
    if (!drawer || (drawer.hidden && drawer.dataset.open !== "true")) return true;
    const closeDrawer = typeof context.closeDrawer === "function" ? context.closeDrawer
      : window.MapInBootUi && window.MapInBootUi.closeSettingsPanel;
    if (typeof closeDrawer !== "function") return false;
    closeDrawer();
    return drawer.hidden && drawer.dataset.open !== "true" && drawer.inert === true;
  }

  function begin(steps, context) {
    if (session) close({ restoreFocus: false });
    const findingModal = document.querySelector("#finding-modal");
    if (findingModal && !findingModal.hidden && findingModal.getAttribute("aria-hidden") !== "true") return false;
    if (!Array.isArray(steps) || steps.length === 0) return false;
    const activeContext = context && typeof context === "object" ? context : {};
    const helpButton = document.querySelector("#help-button");
    const helpPanel = document.querySelector("#help-panel");
    const drawerClosed = closeSettingsDrawer(activeContext);
    if (!drawerClosed) return false;
    if (typeof activeContext.beforeStart === "function" && activeContext.beforeStart() === false) return false;

    const entries = steps.filter((step) => step && typeof step === "object").map((step) => ({ step, target: null, prepared: false }));
    const validEntries = entries.filter((entry) => {
      const target = resolveTarget(entry.step);
      entry.target = target;
      return target && stepIsValid(entry.step, target, activeContext)
        && (elementVisible(target) || typeof entry.step.prepare === "function");
    });
    if (validEntries.length === 0 || !document.body) return false;

    const activeSession = {
      context: activeContext,
      entries: validEntries,
      position: 0,
      currentEntry: null,
      trigger: activeContext.trigger || (document.activeElement && document.activeElement !== document.body
        ? document.activeElement : helpButton),
      helpButton,
      helpPanel,
      helpZIndex: helpButton && helpButton.style.zIndex ? helpButton.style.zIndex : "",
      shields: []
    };
    session = activeSession;
    if (lastRun !== null || activeContext.remember !== false) lastRun = { steps: steps.slice(), context: activeContext };
    createLayer(activeSession);
    updateHelpButton(activeSession);
    listen(activeSession);
    if (!enterAt(activeSession, 0, 1)) return false;
    activeSession.nextButton.focus();
    return true;
  }

  function next() {
    if (!session) return false;
    if (session.position >= session.entries.length - 1) {
      close();
      return true;
    }
    return moveTo(session.position + 1);
  }

  function previous() {
    if (!session || session.position <= 0) return false;
    return moveTo(session.position - 1);
  }

  function close(options) {
    if (!session) return false;
    const activeSession = session;
    session = null;
    runStepCleanup(activeSession);
    unlisten(activeSession);
    if (activeSession.root && typeof activeSession.root.remove === "function") activeSession.root.remove();
    restoreHelpButton(activeSession);
    if (!options || options.restoreFocus !== false) {
      const focusTarget = elementVisible(activeSession.trigger) ? activeSession.trigger : activeSession.helpButton;
      if (focusTarget && !focusTarget.hidden && typeof focusTarget.focus === "function") focusTarget.focus();
    }
    if (typeof activeSession.context.onStateChange === "function") {
      activeSession.context.onStateChange({ active: false, current: 0, total: 0, step: null });
    }
    if (typeof activeSession.context.afterClose === "function") activeSession.context.afterClose();
    return true;
  }

  function restart() {
    if (!lastRun) return false;
    const { steps, context } = lastRun;
    return begin(steps, context);
  }

  function refresh() {
    return session ? layout(session) : false;
  }

  function getState() {
    return session ? describeState(session) : { active: false, current: 0, total: 0, step: null };
  }

  window.MapInBootSpotlight = {
    start(steps, context) { return begin(steps, context); },
    next,
    previous,
    restart,
    close,
    refresh,
    isActive() { return Boolean(session); },
    getState
  };
})();
