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
      position: copyPosition(definition.position)
    });
  }

  function actualStep(steps, id, label, node, positions, description) {
    if (!node) return;
    appendStep(steps, {
      id,
      label,
      kind: "actual",
      anchorId: node.id,
      description,
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
    return nodes.find((node) => node.id === candidateId && node.type === "ENDPOINT")
      || nodes.find((node) => node.type === "ENDPOINT")
      || null;
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
  function buildSteps({ graph, index, endpointId, positions, projection } = {}) {
    const source = graph && typeof graph === "object" ? graph : { nodes: [], edges: [] };
    const nodes = nodeMap(source);
    const edges = edgeMap(source);
    const endpoint = endpointFor(source, endpointId);
    const selectedEndpointId = endpoint ? endpoint.id : endpointId;
    const flowIndex = index || (window.MapInBootFlow && window.MapInBootFlow.createIndex
      ? window.MapInBootFlow.createIndex(source)
      : null);
    const steps = [];

    educationStep(steps, projection, positions, "education-http-request", "HTTP 요청 수신", "실제 요청 Trace가 아닌 표준 처리 원리의 교육 단계");
    educationStep(steps, projection, positions, "education-request-prepare", "Request 준비", "HttpServletRequest·HttpServletResponse 참조 준비");
    educationStep(steps, projection, positions, "education-thread-context", "동기 처리 스레드", "일반적인 처리 문맥이며 실제 Thread ID가 아님");
    educationStep(steps, projection, positions, "education-servlet-filter-chain", "FilterChain 전달", "Filter#doFilter·FilterChain.doFilter의 객체 참조 전달");

    const servlet = source.nodes.find((node) => node.type === "SERVLET");
    const servletOrder = servlet && flowIndex && typeof flowIndex.servletFiltersForServlet === "function"
      ? flowIndex.servletFiltersForServlet(servlet.id)
      : { orderStatus: "UNKNOWN", filters: [] };
    if (servletOrder.orderStatus === "CONFIRMED") {
      servletOrder.filters.forEach((filter) => actualStep(steps, `servlet-filter-${filter.id}`, `확인된 Servlet Filter · ${filter.label}`, filter, positions, "Servlet 등록 관계와 filterOrder 확인"));
    } else {
      educationStep(steps, projection, positions, "education-servlet-filter-chain", "Servlet Filter 순서 확인 불가", "실제 등록은 확인되지만 순서가 확정되지 않아 실제 통과 순서로 재생하지 않음");
    }
    educationStep(steps, projection, positions, "education-delegating-filter-proxy", "DelegatingFilterProxy", "Servlet Filter에서 Spring Security로 위임하는 표준 구조");
    educationStep(steps, projection, positions, "education-filter-chain-proxy", "FilterChainProxy", "등록된 SecurityFilterChain 목록 평가");
    educationStep(steps, projection, positions, "education-request-matcher", "RequestMatcher 평가", "등록 순서에 따라 첫 매칭 Chain 하나를 선택하는 개념 단계");

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
        "MATCHED_BY와 첫 적용 Chain 확인"
      );
      const filters = confirmedFilterSet(flowIndex, source, chain.id);
      if (filters.status === "CONFIRMED") {
        filters.filters.forEach((filter, indexInChain) => {
          const edge = filters.edges[indexInChain];
          if (!edge || !edges.has(edge.id)) return;
          actualStep(
            steps,
            `security-filter-${filter.id}`,
            `Security Filter · ${filter.label}`,
            filter,
            positions,
            `FILTERED_BY 및 filterOrder ${attributes(edge).filterOrder || attributes(filter).filterOrder} 확인`
          );
        });
      } else {
        appendStep(steps, {
          id: "security-filter-order-uncertain",
          label: "Security Filter 순서 확인 불가",
          description: "미확정·중복 순서는 실제 통과 순서로 재생하지 않음"
        });
      }
    } else {
      appendStep(steps, {
        id: "security-chain-uncertain",
        label: "첫 SecurityFilterChain 확인 불가",
        kind: "education",
        anchorId: "education-request-matcher",
        position: projection && projection.nodes.find((node) => node.id === "education-request-matcher")?.position,
        description: "MATCHED_BY가 없거나 불확실하여 실제 Chain을 선택하지 않음"
      });
    }

    educationStep(steps, projection, positions, "education-servlet-chain-continue", "Servlet FilterChain 계속", "인증 실패·인가 거부 시 이후 단계에 도달하지 않을 수 있음");
    const dispatcher = source.nodes.find((node) => node.type === "SERVLET");
    if (dispatcher) actualStep(steps, "dispatcher-servlet", "확인된 DispatcherServlet", dispatcher, positions, "Servlet 등록 정보 확인");
    educationStep(steps, projection, positions, "education-handler-mapping", "HandlerMapping", "요청과 Handler의 매핑 정보 조회");
    const actualEndpoint = endpoint && nodes.get(endpoint.id);
    if (actualEndpoint) actualStep(steps, "endpoint-mapping", `확인된 API Endpoint · ${actualEndpoint.label}`, actualEndpoint, positions, "Endpoint는 Servlet 실행 객체가 아닌 매핑 정보");
    educationStep(steps, projection, positions, "education-handler-adapter", "HandlerAdapter", "확인된 Controller·Handler 호출 준비");

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
        "Endpoint attributes.handler와 기존 Handler Node 대응"
      );
    } else {
      appendStep(steps, {
        id: "handler-uncertain",
        label: "Handler 대응 확인 불가",
        description: "속성 대응이 확인되지 않아 Handler 호출을 실제 사실로 표시하지 않음"
      });
    }

    educationStep(steps, projection, positions, "education-response-return", "응답 복귀", "호출 체인을 거쳐 응답이 반환되는 교육용 흐름");
    return steps;
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
    const stepDuration = Number.isFinite(options.stepDuration) && options.stepDuration > 0
      ? options.stepDuration : 900;
    const reducedMotion = Boolean(options.reducedMotion);
    const onUpdate = typeof options.onUpdate === "function" ? options.onUpdate : () => {};
    const onStateChange = typeof options.onStateChange === "function" ? options.onStateChange : () => {};
    let steps = [];
    let status = "idle";
    let stepIndex = 0;
    let progress = 0;
    let elapsed = 0;
    let startedAt = 0;
    let frameId = null;
    let destroyed = false;

    function snapshot() {
      return {
        status,
        stepIndex,
        progress,
        step: steps[stepIndex] || null,
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

    function advance(timestamp) {
      if (steps.length === 0) return false;
      const currentTime = Number.isFinite(timestamp) ? timestamp : clock.now();
      elapsed = Math.max(0, currentTime - startedAt);
      const total = steps.length * stepDuration;
      if (elapsed >= total) {
        elapsed = total;
        stepIndex = steps.length - 1;
        progress = 1;
        setStatus("complete");
        emitUpdate();
        return false;
      }
      stepIndex = Math.min(steps.length - 1, Math.floor(elapsed / stepDuration));
      progress = (elapsed - stepIndex * stepDuration) / stepDuration;
      emitUpdate();
      return true;
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
      progress = 0;
      elapsed = 0;
      onStateChange(snapshot());
      emitUpdate();
    }

    function play() {
      if (destroyed || steps.length === 0) return;
      if (reducedMotion) {
        cancelFrame();
        elapsed = steps.length * stepDuration;
        stepIndex = steps.length - 1;
        progress = 1;
        setStatus("complete");
        emitUpdate();
        return;
      }
      if (status === "complete") {
        elapsed = 0;
        stepIndex = 0;
        progress = 0;
      }
      startedAt = clock.now() - elapsed;
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

    function reset() {
      if (destroyed) return;
      cancelFrame();
      elapsed = 0;
      stepIndex = 0;
      progress = 0;
      setStatus("idle");
      emitUpdate();
    }

    function destroy() {
      cancelFrame();
      destroyed = true;
      status = "idle";
    }

    return {
      setSteps,
      play,
      pause,
      reset,
      destroy,
      state: snapshot,
      activeFrameCount: () => frameId === null ? 0 : 1
    };
  }

  window.MapInBootRequestFlow = { buildSteps, createController };
})();
