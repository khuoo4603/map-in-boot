(() => {
  "use strict";

  function text(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function positiveInteger(value) {
    if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : null;
    if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function attributes(item) {
    return item && item.attributes && typeof item.attributes === "object" ? item.attributes : {};
  }

  function copyPosition(position) {
    return position && Number.isFinite(position.x) && Number.isFinite(position.y)
      ? { x: position.x, y: position.y }
      : null;
  }

  function nodeMap(graph) {
    return new Map((graph && Array.isArray(graph.nodes) ? graph.nodes : []).map((node) => [node.id, node]));
  }

  function edgeMap(graph) {
    return new Map((graph && Array.isArray(graph.edges) ? graph.edges : []).map((edge) => [edge.id, edge]));
  }

  function appendStep(steps, definition) {
    steps.push({
      id: definition.id,
      label: definition.label,
      kind: definition.kind || "education",
      anchorId: definition.anchorId || null,
      description: definition.description || "",
      filterEducation: definition.filterEducation || null,
      position: copyPosition(definition.position),
      transition: definition.transition || null
    });
  }

  function actualStep(steps, id, label, node, positions, description, filterEducation = null) {
    if (!node) return;
    appendStep(steps, {
      id,
      label,
      kind: "actual",
      anchorId: node.id,
      description,
      filterEducation,
      position: positions && positions[node.id]
    });
  }

  function educationStep(steps, projection, positions, id, label, description) {
    const node = projection && Array.isArray(projection.nodes)
      ? projection.nodes.find((item) => item.id === id)
      : null;
    appendStep(steps, {
      id,
      label,
      kind: "education",
      anchorId: node ? node.id : null,
      description,
      position: node ? node.position : positions && positions[id]
    });
  }

  function endpointFor(graph, endpointId) {
    const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
    const candidateId = endpointId || graph && graph.endpointId;
    return candidateId ? nodes.find((node) => node.id === candidateId && node.type === "ENDPOINT") || null : null;
  }

  function transitionBetween(source, target, graph, projection) {
    if (!source.anchorId || !target.anchorId || source.anchorId === target.anchorId) return null;
    const actualEdge = (graph && Array.isArray(graph.edges) ? graph.edges : [])
      .find((edge) => edge.sourceId === source.anchorId && edge.targetId === target.anchorId);
    if (actualEdge) return {
      kind: "actual",
      edgeId: actualEdge.id,
      sourceId: source.anchorId,
      targetId: target.anchorId,
      length: null
    };
    const projectionEdge = projection && Array.isArray(projection.edges)
      ? projection.edges.find((edge) => edge.sourceId === source.anchorId && edge.targetId === target.anchorId)
      : null;
    if (projectionEdge) {
      return {
        kind: "projection",
        edgeId: projectionEdge.id,
        sourceId: source.anchorId,
        targetId: target.anchorId,
        length: null
      };
    }
    return null;
  }

  function connectSteps(steps, graph, projection) {
    for (let index = 0; index < steps.length - 1; index += 1) {
      steps[index].transition = transitionBetween(steps[index], steps[index + 1], graph, projection);
    }
    return steps;
  }

  function confirmedFilterSet(index, graph, chainId) {
    if (!index || !chainId || typeof index.securityFiltersForChain !== "function") {
      return { status: "UNKNOWN", filters: [], edges: [] };
    }
    const result = index.securityFiltersForChain(chainId);
    const nodes = nodeMap(graph);
    const edges = edgeMap(graph);
    const relationships = (result.edges || []).filter((edge) => {
      const filter = nodes.get(edge.targetId);
      return edges.has(edge.id)
        && edge.sourceId === chainId
        && filter
        && filter.type === "FILTER"
        && attributes(filter).registrationKind === "SECURITY";
    });
    if (result.orderStatus !== "CONFIRMED") return { status: result.orderStatus || "UNKNOWN", filters: [], edges: relationships };
    const orderValues = relationships.map((edge) => {
      const filter = nodes.get(edge.targetId);
      const edgeOrder = attributes(edge).filterOrder;
      return {
        edge,
        filter,
        order: positiveInteger(edgeOrder === undefined ? attributes(filter).filterOrder : edgeOrder)
      };
    });
    if (orderValues.some((item) => item.order === null)
      || new Set(orderValues.map((item) => item.order)).size !== orderValues.length) {
      return { status: "UNKNOWN", filters: [], edges: relationships };
    }
    orderValues.sort((left, right) => left.order - right.order || text(left.filter.id).localeCompare(text(right.filter.id)));
    return {
      status: "CONFIRMED",
      filters: orderValues.map((item) => item.filter),
      edges: orderValues.map((item) => item.edge)
    };
  }

  // 실제 Snapshot 관계와 교육 전용 개념 단계를 분리한 Request 흐름 생성
  function buildSteps({ graph, index, endpointId, positions, projection, snapshot } = {}) {
    const source = graph && typeof graph === "object" ? graph : { nodes: [], edges: [] };
    const sourceNodes = Array.isArray(source.nodes) ? source.nodes : [];
    const nodes = nodeMap(source);
    const edges = edgeMap(source);
    const endpoint = endpointFor(source, endpointId);
    const selectedEndpointId = endpoint ? endpoint.id : endpointId;
    const flowIndex = index || (window.MapInBootFlow && window.MapInBootFlow.createIndex
      ? window.MapInBootFlow.createIndex(source)
      : null);
    const steps = [];

    educationStep(steps, projection, positions, "education-http-request", "HTTP 요청 수신", "HTTP 요청이 Servlet 컨테이너로 전달되는 일반적인 처리 원리입니다.");
    educationStep(steps, projection, positions, "education-request-prepare", "요청 정보 준비", "컨테이너가 HttpServletRequest와 HttpServletResponse를 준비해 처리 체인에 전달합니다.");
    educationStep(steps, projection, positions, "education-thread-context", "동기 처리 문맥", "동기식 Servlet 처리는 컨테이너의 요청 처리 문맥에서 이어집니다.");
    educationStep(steps, projection, positions, "education-servlet-filter-chain", "FilterChain 전달", "Filter#doFilter에서 FilterChain.doFilter를 호출해 다음 Filter로 제어를 넘깁니다.");

    const servlet = sourceNodes.find((node) => node.type === "SERVLET");
    const servletOrder = servlet && flowIndex && typeof flowIndex.servletFiltersForServlet === "function"
      ? flowIndex.servletFiltersForServlet(servlet.id)
      : { orderStatus: "UNKNOWN", filters: [] };
    if (servletOrder.orderStatus === "CONFIRMED") {
      servletOrder.filters.forEach((filter) => actualStep(steps, `servlet-filter-${filter.id}`, `확인된 Servlet Filter · ${filter.label}`, filter, positions, "Snapshot에서 Servlet 등록 관계와 filterOrder가 확인된 Filter입니다."));
    } else {
      educationStep(steps, projection, positions, "education-servlet-filter-chain", "Servlet Filter 순서 확인 불가", "등록 관계는 확인됐지만 순서를 확정할 근거가 부족해 순차 재생하지 않습니다.");
    }
    educationStep(steps, projection, positions, "education-delegating-filter-proxy", "DelegatingFilterProxy", "DelegatingFilterProxy가 Spring Security Filter Chain으로 처리를 위임합니다.");
    educationStep(steps, projection, positions, "education-filter-chain-proxy", "FilterChainProxy", "FilterChainProxy가 등록된 SecurityFilterChain을 평가합니다.");
    educationStep(steps, projection, positions, "education-request-matcher", "RequestMatcher 평가", "RequestMatcher가 등록 순서에 따라 처음 일치하는 Chain을 찾습니다.");

    const match = selectedEndpointId && flowIndex && typeof flowIndex.firstMatchedChain === "function"
      ? flowIndex.firstMatchedChain(selectedEndpointId)
      : { status: "UNCERTAIN", chain: null, edge: null };
    const actualMatchEdge = match.edge && edges.get(match.edge.id);
    const chain = match.status === "CONFIRMED" && match.chain && nodes.get(match.chain.id)
      && actualMatchEdge ? nodes.get(match.chain.id) : null;
    if (chain) {
      actualStep(
        steps,
        "security-chain",
        `확인된 SecurityFilterChain · ${chain.label}`,
        chain,
        positions,
        "Snapshot에서 확인된 MATCHED_BY 관계로 첫 적용 Chain을 표시합니다."
      );
      const filters = confirmedFilterSet(flowIndex, source, chain.id);
      if (filters.status === "CONFIRMED") {
        const standardFilterClient = window.MapInBootStandardFilters;
        const filterEducationByClass = new Map();
        if (standardFilterClient && standardFilterClient.list && standardFilterClient.classify) {
          const statusGraph = snapshot || source;
          const statusEntries = standardFilterClient.classify(
            statusGraph,
            statusGraph.analysisStatus || {},
            chain.id
          );
          const statusByClass = new Map(statusEntries.map((entry) => [entry.fqcn, entry]));
          standardFilterClient.list().forEach((reference) => {
            const status = statusByClass.get(reference.fqcn);
            filterEducationByClass.set(reference.fqcn, {
              ...reference,
              status: status ? status.status : "UNKNOWN",
              statusLabel: status ? status.statusLabel : standardFilterClient.statusLabel("UNKNOWN")
            });
          });
        }
        filters.filters.forEach((filter, indexInChain) => {
          const edge = filters.edges[indexInChain];
          if (!edge || !edges.has(edge.id)) return;
          actualStep(
            steps,
            `security-filter-${filter.id}`,
            `Security Filter · ${filter.label}`,
            filter,
            positions,
            `Snapshot에서 FILTERED_BY와 filterOrder ${attributes(edge).filterOrder || attributes(filter).filterOrder}를 확인했습니다.`,
            filterEducationByClass.get(attributes(filter).filterClass) || null
          );
        });
      } else {
        appendStep(steps, {
          id: "security-filter-order-uncertain",
          label: "Security Filter 순서 확인 불가",
          description: "순서를 확정할 근거가 부족해 확인된 통과 순서로 표시하지 않습니다."
        });
      }
    } else {
      appendStep(steps, {
        id: "security-chain-uncertain",
        label: "첫 SecurityFilterChain 확인 불가",
        kind: "education",
        anchorId: "education-request-matcher",
        position: projection && Array.isArray(projection.nodes)
          ? projection.nodes.find((node) => node.id === "education-request-matcher")?.position
          : null,
        description: "MATCHED_BY 관계가 없거나 불확실해 적용 Chain을 특정하지 않습니다."
      });
    }

    educationStep(steps, projection, positions, "education-servlet-chain-continue", "Servlet FilterChain 계속", "FilterChain.doFilter가 다음 단계로 연결되며, 앞선 처리 결과에 따라 이후 단계에 도달하지 않을 수 있습니다.");
    const dispatcher = sourceNodes.find((node) => node.type === "SERVLET");
    if (dispatcher) actualStep(steps, "dispatcher-servlet", "확인된 DispatcherServlet", dispatcher, positions, "Snapshot에서 Servlet 등록 관계를 확인했습니다.");
    educationStep(steps, projection, positions, "education-handler-mapping", "HandlerMapping", "HandlerMapping이 요청 정보에 맞는 Handler를 조회합니다.");
    const actualEndpoint = endpoint && nodes.get(endpoint.id);
    if (actualEndpoint) actualStep(steps, "endpoint-mapping", `확인된 API Endpoint · ${actualEndpoint.label}`, actualEndpoint, positions, "Endpoint는 Servlet 실행 객체가 아니라 Handler 매핑 정보입니다.");
    educationStep(steps, projection, positions, "education-handler-adapter", "HandlerAdapter", "HandlerAdapter가 매핑된 Controller·Handler 호출을 준비합니다.");

    const handler = selectedEndpointId && flowIndex && typeof flowIndex.handlerFor === "function"
      ? flowIndex.handlerFor(selectedEndpointId)
      : { status: "UNCERTAIN", node: null };
    const actualHandler = handler.status === "CONFIRMED" && handler.node && nodes.get(handler.node.id)
      ? nodes.get(handler.node.id) : null;
    if (actualHandler) {
      actualStep(
        steps,
        "handler",
        `확인된 Handler · ${actualHandler.label}`,
        actualHandler,
        positions,
        "Snapshot의 Endpoint attributes.handler와 기존 Handler Node가 연결됩니다."
      );
    } else {
      appendStep(steps, {
        id: "handler-uncertain",
        label: "Handler 대응 확인 불가",
        description: "Snapshot에서 Endpoint와 Handler를 연결할 근거를 확인하지 못했습니다."
      });
    }

    appendStep(steps, {
      id: "education-response-return",
      label: "응답 복귀 원리",
      kind: "education",
      description: "일반적인 동기 호출 체인에서는 Handler 처리 뒤 호출자 방향으로 돌아갑니다. 비동기·ERROR·FORWARD는 다른 경로가 적용될 수 있습니다."
    });

    return connectSteps(steps, source, projection);
  }

  function pathPointAt(path, progress, cachedLength) {
    if (!path || typeof path.getTotalLength !== "function" || typeof path.getPointAtLength !== "function") return null;
    try {
      const length = Number.isFinite(cachedLength) && cachedLength > 0 ? cachedLength : path.getTotalLength();
      if (!Number.isFinite(length) || length <= 0) return null;
      const ratio = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
      const point = path.getPointAtLength(length * ratio);
      return point && Number.isFinite(point.x) && Number.isFinite(point.y)
        ? { x: point.x, y: point.y }
        : null;
    } catch {
      return null;
    }
  }

  function defaultClock() {
    const request = typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
      ? (callback) => window.requestAnimationFrame(callback)
      : (callback) => setTimeout(() => callback(Date.now()), 16);
    const cancel = typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function"
      ? (id) => window.cancelAnimationFrame(id)
      : (id) => clearTimeout(id);
    const now = typeof performance !== "undefined" && typeof performance.now === "function"
      ? () => performance.now()
      : () => Date.now();
    return { requestFrame: request, cancelFrame: cancel, now };
  }

  function createController(options = {}) {
    const clock = options.clock || defaultClock();
    const duration = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
    let nodeHoldDuration = duration(options.nodeHoldDuration, 280);
    let playbackSpeed = duration(options.speed, 1);
    const minimumEdgeDuration = duration(options.minimumEdgeDuration, 450);
    const maximumEdgeDuration = Math.max(minimumEdgeDuration, duration(options.maximumEdgeDuration, 1000));
    const durationPerLength = duration(options.durationPerLength, 0.65);
    const unavailablePathDuration = duration(options.unavailablePathDuration, 280);
    const stepNoticeDuration = duration(options.stepNoticeDuration, 260);
    const reducedMotion = Boolean(options.reducedMotion);
    const reducedMotionStepDuration = duration(options.reducedMotionStepDuration, 650);
    const onUpdate = typeof options.onUpdate === "function" ? options.onUpdate : () => {};
    const onStateChange = typeof options.onStateChange === "function" ? options.onStateChange : () => {};
    let steps = [];
    let status = "idle";
    let stepIndex = 0;
    let phase = null;
    let progress = 0;
    let startedAt = 0;
    let phaseElapsed = 0;
    let frameId = null;
    let destroyed = false;

    function snapshot() {
      return {
        status,
        stepIndex,
        phase,
        progress,
        step: steps[stepIndex] || null,
        nextStep: steps[stepIndex + 1] || null,
        transition: steps[stepIndex] && steps[stepIndex].transition || null,
        steps: steps.slice()
      };
    }

    function emitUpdate() {
      onUpdate(snapshot());
    }

    function setStatus(nextStatus) {
      if (status === nextStatus) return;
      status = nextStatus;
      onStateChange(snapshot());
    }

    function cancelFrame() {
      if (frameId === null) return;
      clock.cancelFrame(frameId);
      frameId = null;
    }

    function scheduleFrame() {
      if (frameId !== null || status !== "running" || destroyed) return;
      frameId = clock.requestFrame(frame);
    }

    function phaseForStep(step) {
      return step && step.anchorId ? "NODE_HOLD" : "STEP_NOTICE";
    }

    function edgeDuration(step) {
      const length = step && step.transition && step.transition.length;
      if (!Number.isFinite(length) || length <= 0) return null;
      const baseDuration = Math.min(maximumEdgeDuration, Math.max(minimumEdgeDuration, length * durationPerLength));
      return baseDuration / playbackSpeed;
    }

    function phaseDuration() {
      if (reducedMotion) return phase === "NODE_HOLD" ? nodeHoldDuration : reducedMotionStepDuration;
      if (phase === "NODE_HOLD") return nodeHoldDuration;
      if (phase === "EDGE_TRAVEL") return edgeDuration(steps[stepIndex]);
      if (phase === "PATH_UNAVAILABLE") return unavailablePathDuration;
      if (phase === "STEP_NOTICE") return stepNoticeDuration;
      return null;
    }

    function complete() {
      phase = "COMPLETE";
      progress = 1;
      phaseElapsed = 0;
      setStatus("complete");
      emitUpdate();
    }

    function nextStep() {
      if (stepIndex + 1 >= steps.length) {
        complete();
        return;
      }
      stepIndex += 1;
      phase = phaseForStep(steps[stepIndex]);
      phaseElapsed = 0;
      progress = 0;
    }

    function advancePhase() {
      const step = steps[stepIndex];
      const target = steps[stepIndex + 1];
      if (phase === "NODE_HOLD" && target) {
        if (!target.anchorId) {
          stepIndex += 1;
          phase = "STEP_NOTICE";
        }
        else if (step.anchorId === target.anchorId || !edgeDuration(step)) phase = "PATH_UNAVAILABLE";
        else phase = "EDGE_TRAVEL";
        phaseElapsed = 0;
        progress = 0;
        return;
      }
      nextStep();
    }

    function advance(timestamp) {
      if (steps.length === 0 || status !== "running") return false;
      let elapsed = Math.max(0, (Number.isFinite(timestamp) ? timestamp : clock.now()) - startedAt);
      while (status === "running") {
        const currentDuration = phaseDuration();
        if (!Number.isFinite(currentDuration) || currentDuration <= 0) {
          if (phase === "NODE_HOLD" || phase === "EDGE_TRAVEL") {
            phase = "PATH_UNAVAILABLE";
            phaseElapsed = 0;
            progress = 0;
          } else advancePhase();
          if (status !== "running") return false;
          continue;
        }
        if (elapsed < currentDuration) {
          phaseElapsed = elapsed;
          progress = reducedMotion ? 0 : elapsed / currentDuration;
          if (!reducedMotion) emitUpdate();
          return true;
        }
        elapsed -= currentDuration;
        startedAt += currentDuration;
        phaseElapsed = 0;
        progress = 0;
        if (reducedMotion) nextStep();
        else advancePhase();
        if (status !== "running") return false;
        if (reducedMotion) emitUpdate();
        if (elapsed === 0) {
          if (!reducedMotion) emitUpdate();
          return true;
        }
      }
      return false;
    }

    function frame(timestamp) {
      frameId = null;
      if (status !== "running" || destroyed) return;
      if (advance(timestamp)) scheduleFrame();
    }

    function setSteps(nextSteps) {
      if (destroyed) return;
      cancelFrame();
      steps = Array.isArray(nextSteps) ? nextSteps.slice() : [];
      status = "idle";
      stepIndex = 0;
      phase = null;
      progress = 0;
      phaseElapsed = 0;
      onStateChange(snapshot());
      emitUpdate();
    }

    function play() {
      if (destroyed || steps.length === 0 || status === "running") return;
      if (status === "complete" || status === "idle") {
        stepIndex = 0;
        phase = phaseForStep(steps[stepIndex]);
        progress = 0;
        phaseElapsed = 0;
      }
      startedAt = clock.now() - phaseElapsed;
      setStatus("running");
      emitUpdate();
      scheduleFrame();
    }

    function pause() {
      if (destroyed || status !== "running") return;
      advance(clock.now());
      cancelFrame();
      if (status === "running") setStatus("paused");
      emitUpdate();
    }

    // 재생 프레임을 정리하고 Controller가 소유한 현재 단계를 직접 선택
    function seekToStep(index) {
      if (destroyed || !Number.isInteger(index) || index < 0 || index >= steps.length) return false;
      cancelFrame();
      stepIndex = index;
      phase = phaseForStep(steps[stepIndex]);
      progress = 0;
      startedAt = clock.now();
      phaseElapsed = 0;
      setStatus("paused");
      emitUpdate();
      return true;
    }

    function setPlaybackSettings(settings = {}) {
      if (destroyed) return;
      const now = clock.now();
      const wasRunning = status === "running";
      if (wasRunning) advance(now);
      if (wasRunning && status !== "running") cancelFrame();

      const previousDuration = phaseDuration();
      const progressRatio = Number.isFinite(previousDuration) && previousDuration > 0
        ? Math.max(0, Math.min(1, phaseElapsed / previousDuration))
        : 0;
      if (Number.isFinite(settings.nodeHoldDuration) && settings.nodeHoldDuration > 0) {
        nodeHoldDuration = settings.nodeHoldDuration;
      }
      if (Number.isFinite(settings.speed) && settings.speed > 0) playbackSpeed = settings.speed;

      const nextDuration = phaseDuration();
      if (Number.isFinite(previousDuration) && previousDuration > 0
        && Number.isFinite(nextDuration) && nextDuration > 0) {
        phaseElapsed = nextDuration * progressRatio;
        if (status === "running") startedAt = now - phaseElapsed;
        progress = reducedMotion ? 0 : progressRatio;
      }
      emitUpdate();
    }

    function reset() {
      if (destroyed) return;
      cancelFrame();
      phase = null;
      phaseElapsed = 0;
      startedAt = 0;
      stepIndex = 0;
      progress = 0;
      setStatus("idle");
      emitUpdate();
    }

    function destroy() {
      cancelFrame();
      destroyed = true;
      status = "idle";
      phase = null;
    }

    return {
      setSteps,
      setPlaybackSettings,
      play,
      pause,
      seekToStep,
      reset,
      destroy,
      state: snapshot,
      activeFrameCount: () => frameId === null ? 0 : 1
    };
  }

  window.MapInBootRequestFlow = { buildSteps, createController, pathPointAt };
})();
