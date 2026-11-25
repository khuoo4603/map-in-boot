(() => {
  "use strict";

  const scope = typeof window !== "undefined" ? window : self;

  const NODE_TYPES = Object.freeze({
    ENDPOINT: "ENDPOINT",
    HANDLER: "HANDLER",
    SECURITY_CHAIN: "SECURITY_CHAIN",
    SERVLET: "SERVLET",
    FILTER: "FILTER"
  });
  const EDGE_TYPES = Object.freeze({
    FLOWS_TO: "FLOWS_TO",
    MATCHED_BY: "MATCHED_BY",
    FILTERED_BY: "FILTERED_BY"
  });
  const DETAIL_RELATION_TYPES = Object.freeze(new Set([
    "SECURED_BY",
    "READS_SECURITY_DATA",
    "WRITES_SECURITY_DATA",
    "CONVERTS_TO_AUTHORITY",
    "USES_FOR_AUTHORIZATION",
    "SECURITY_STATE"
  ]));
  function text(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function attributes(item) {
    return item && item.attributes && typeof item.attributes === "object"
      ? item.attributes
      : {};
  }

  function positiveInteger(value) {
    if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : null;
    if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function orderState(items, valueOf) {
    const values = items.map(valueOf);
    const numbers = values.map(positiveInteger);
    if (numbers.some((value) => value === null)) return "UNKNOWN";
    if (new Set(numbers).size !== numbers.length) return "AMBIGUOUS";
    return "CONFIRMED";
  }

  function filterOrderInfo(edge, node) {
    const edgeOrder = positiveInteger(attributes(edge).filterOrder);
    const nodeOrder = positiveInteger(attributes(node).filterOrder);
    if (edgeOrder !== null && nodeOrder !== null && edgeOrder !== nodeOrder) {
      return { status: "MISMATCHED", order: null, source: "CONFLICT" };
    }
    if (edgeOrder !== null) return { status: "CONFIRMED", order: edgeOrder, source: "EDGE" };
    if (nodeOrder !== null) return { status: "CONFIRMED", order: nodeOrder, source: "NODE" };
    return { status: "UNKNOWN", order: null, source: "NONE" };
  }

  function createIndex(graph, evidence = []) {
    const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
    const edges = graph && Array.isArray(graph.edges) ? graph.edges : [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
    const incomingByNode = new Map(nodes.map((node) => [node.id, []]));
    const outgoingByNode = new Map(nodes.map((node) => [node.id, []]));
    const validEdges = edges.filter((edge) => nodeById.has(edge.sourceId) && nodeById.has(edge.targetId));
    validEdges.forEach((edge) => {
      incomingByNode.get(edge.targetId).push(edge);
      outgoingByNode.get(edge.sourceId).push(edge);
    });
    const endpoints = nodes.filter((node) => node.type === NODE_TYPES.ENDPOINT);
    const handlers = nodes.filter((node) => node.type === NODE_TYPES.HANDLER);
    const chains = nodes.filter((node) => node.type === NODE_TYPES.SECURITY_CHAIN);
    const servlets = nodes.filter((node) => node.type === NODE_TYPES.SERVLET);
    const securityFilters = nodes.filter((node) => node.type === NODE_TYPES.FILTER
      && attributes(node).registrationKind === "SECURITY");
    const servletFilters = nodes.filter((node) => node.type === NODE_TYPES.FILTER
      && attributes(node).registrationKind === "SERVLET");

    function firstMatchedChain(endpointId) {
      const candidates = (outgoingByNode.get(endpointId) || []).filter((edge) => edge.type === EDGE_TYPES.MATCHED_BY);
      if (candidates.length !== 1) {
        return { status: "UNCERTAIN", reason: candidates.length === 0 ? "MISSING" : "MULTIPLE", chain: null, edge: null };
      }
      const edge = candidates[0];
      const chain = nodeById.get(edge.targetId);
      if (!chain || chain.type !== NODE_TYPES.SECURITY_CHAIN || text(edge.confidence) !== "CONFIRMED") {
        return { status: "UNCERTAIN", reason: "UNCONFIRMED", chain: null, edge: null };
      }
      return { status: "CONFIRMED", reason: "", chain, edge };
    }

    function filtersFor(sourceId, registrationKind) {
      const memberships = (outgoingByNode.get(sourceId) || [])
        .filter((edge) => edge.type === EDGE_TYPES.FILTERED_BY);
      const relationships = memberships
        .map((edge) => ({ edge, node: nodeById.get(edge.targetId) }))
        .filter((item) => item.node && item.node.type === NODE_TYPES.FILTER
          && attributes(item.node).registrationKind === registrationKind
          && (!attributes(item.edge).registrationKind
            || attributes(item.edge).registrationKind === registrationKind));
      const items = relationships.map((item) => item.node);
      const orderInfo = Object.fromEntries(relationships.map((item) => [item.node.id, filterOrderInfo(item.edge, item.node)]));
      const result = {
        filters: items.slice().sort((left, right) => text(left.id).localeCompare(text(right.id))),
        edges: relationships.map((item) => item.edge),
        orderInfo,
        orderStatus: "UNKNOWN"
      };
      const orderValues = items.map((item) => orderInfo[item.id]);
      if (relationships.length === 0 || memberships.length !== relationships.length
        || relationships.some((item) => text(item.edge.confidence) !== "CONFIRMED")) result.orderStatus = "UNKNOWN";
      else if (orderValues.some((item) => item.status === "MISMATCHED")) result.orderStatus = "UNKNOWN";
      else if (orderValues.some((item) => item.status === "UNKNOWN")) result.orderStatus = "UNKNOWN";
      else if (new Set(items.map((item) => item.id)).size !== items.length
        || new Set(orderValues.map((item) => item.order)).size !== orderValues.length) result.orderStatus = "AMBIGUOUS";
      else result.orderStatus = "CONFIRMED";
      result.filters.sort((left, right) => {
        const leftOrder = orderInfo[left.id].order === null ? Number.POSITIVE_INFINITY : orderInfo[left.id].order;
        const rightOrder = orderInfo[right.id].order === null ? Number.POSITIVE_INFINITY : orderInfo[right.id].order;
        return leftOrder - rightOrder || text(left.id).localeCompare(text(right.id));
      });
      return result;
    }

    function securityFiltersForChain(chainId) {
      return filtersFor(chainId, "SECURITY");
    }

    function servletFiltersForServlet(servletId) {
      return filtersFor(servletId, "SERVLET");
    }

    function handlerFor(endpointId) {
      const endpoint = nodeById.get(endpointId);
      const handlerKey = attributes(endpoint).handler;
      const candidates = handlers.filter((handler) => text(attributes(handler).handler) === text(handlerKey));
      if (!handlerKey || candidates.length !== 1) {
        return { status: "UNCERTAIN", reason: candidates.length === 0 ? "MISSING" : "MULTIPLE", node: null };
      }
      return { status: "CONFIRMED", reason: "", node: candidates[0] };
    }

    function summary() {
      const matchedEndpointCount = endpoints.filter((endpoint) => firstMatchedChain(endpoint.id).status === "CONFIRMED").length;
      const handlerMatchCount = endpoints.filter((endpoint) => handlerFor(endpoint.id).status === "CONFIRMED").length;
      const uncertainCount = endpoints.length - matchedEndpointCount;
      return {
        endpointCount: endpoints.length,
        matchedEndpointCount,
        securityFilterCount: securityFilters.length,
        servletFilterCount: servletFilters.length,
        handlerMatchCount,
        uncertainCount
      };
    }

    return {
      graph,
      nodeById,
      edgeById,
      evidenceById: new Map((Array.isArray(evidence) ? evidence : []).filter((item) => item && item.id).map((item) => [item.id, item])),
      incomingByNode,
      outgoingByNode,
      nodes,
      edges,
      validEdges,
      endpoints,
      handlers,
      chains,
      servlets,
      securityFilters,
      servletFilters,
      firstMatchedChain,
      securityFiltersForChain,
      servletFiltersForServlet,
      filterOrderInfo,
      handlerFor,
      summary
    };
  }

  // 실제 관계에 닿지 않는 Node를 원본과 분리해 전체 MAP 표시 Graph로 구성
  function deriveConnectedGraph(graph, index = null) {
    const source = graph && typeof graph === "object" ? graph : { nodes: [], edges: [] };
    const graphIndex = index || createIndex(source);
    const connectedIds = new Set();
    graphIndex.validEdges.forEach((edge) => {
      connectedIds.add(edge.sourceId);
      connectedIds.add(edge.targetId);
    });
    const nodes = graphIndex.nodes.filter((node) => connectedIds.has(node.id));
    return {
      ...source,
      nodes,
      edges: graphIndex.validEdges.slice(),
      filters: { query: "", nodeType: "", edgeType: "" },
      unconnectedNodeCount: graphIndex.nodes.length - nodes.length
    };
  }

  // 선택 Endpoint의 실제 관계만 원본 객체 참조로 추출
  function deriveEndpointGraph(graph, endpointId, cachedIndex = null) {
    const source = graph && typeof graph === "object" ? graph : { nodes: [], edges: [] };
    const index = cachedIndex || createIndex(source);
    const endpoint = index.nodeById.get(endpointId);
    const match = endpoint && endpoint.type === NODE_TYPES.ENDPOINT
      ? index.firstMatchedChain(endpointId)
      : { status: "UNCERTAIN", reason: "MISSING", chain: null, edge: null };
    const handler = endpoint && endpoint.type === NODE_TYPES.ENDPOINT
      ? index.handlerFor(endpointId)
      : { status: "UNCERTAIN", reason: "MISSING", node: null };
    const nodeIds = new Set();
    const edgeIds = new Set();
    const securityFrontier = [];
    const selectedChainId = match.status === "CONFIRMED" ? match.chain.id : null;

    const canIncludeNode = (node) => {
      if (!node) return false;
      if (node.type === NODE_TYPES.ENDPOINT) return node.id === endpointId;
      if (node.type === NODE_TYPES.SECURITY_CHAIN) return node.id === selectedChainId;
      return true;
    };

    const includeNode = (node) => {
      if (!canIncludeNode(node) || nodeIds.has(node.id)) return false;
      nodeIds.add(node.id);
      return true;
    };
    const includeEdge = (edge) => {
      if (!edge || edgeIds.has(edge.id)) return false;
      if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) return false;
      edgeIds.add(edge.id);
      return true;
    };

    const includeFlowPath = (direction) => {
      if (!endpoint || endpoint.type !== NODE_TYPES.ENDPOINT) return;
      const queue = [endpointId];
      const visited = new Set();
      while (queue.length > 0) {
        const currentId = queue.shift();
        if (visited.has(currentId)) continue;
        visited.add(currentId);
        const relations = (direction === "incoming" ? index.incomingByNode : index.outgoingByNode).get(currentId) || [];
        relations.forEach((edge) => {
          if (edge.type !== EDGE_TYPES.FLOWS_TO) return;
          const relatedId = direction === "incoming" ? edge.sourceId : edge.targetId;
          const related = index.nodeById.get(relatedId);
          if (!canIncludeNode(related)) return;
          includeNode(related);
          includeEdge(edge);
          if (!visited.has(relatedId)) queue.push(relatedId);
        });
      }
    };

    if (endpoint && endpoint.type === NODE_TYPES.ENDPOINT) includeNode(endpoint);
    includeFlowPath("incoming");
    includeFlowPath("outgoing");
    nodeIds.forEach((id) => {
      const node = index.nodeById.get(id);
      if (!node || node.type !== NODE_TYPES.SERVLET) return;
      index.servletFiltersForServlet(node.id).edges.forEach((edge) => {
        const filter = index.nodeById.get(edge.targetId);
        if (filter) includeNode(filter);
        includeEdge(edge);
      });
    });
    if (handler.node) {
      includeNode(handler.node);
      securityFrontier.push(handler.node.id);
    }
    if (match.status === "CONFIRMED") {
      includeNode(match.chain);
      includeEdge(match.edge);
      const chainFilters = index.securityFiltersForChain(match.chain.id);
      chainFilters.edges.forEach((edge) => {
        const filter = index.nodeById.get(edge.targetId);
        if (filter) includeNode(filter);
        includeEdge(edge);
      });
    }

    // Handler·Endpoint에서 시작한 실제 SECURED_BY만 인증·인가 탐색의 근거로 사용
    index.edges.forEach((edge) => {
      if (edge.type !== "SECURED_BY") return;
      if (!nodeIds.has(edge.sourceId)) return;
      const target = index.nodeById.get(edge.targetId);
      if (!target) return;
      includeNode(target);
      includeEdge(edge);
       securityFrontier.push(target.id);
    });

    // 보안 관계 확장은 실제 방향과 허용된 관계 종류 안에서만 제한
    const visited = new Set();
    while (securityFrontier.length > 0) {
      const currentId = securityFrontier.shift();
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      index.edges.forEach((edge) => {
        if (!DETAIL_RELATION_TYPES.has(edge.type) || edge.sourceId !== currentId) return;
        const target = index.nodeById.get(edge.targetId);
        if (!target) return;
        if (!canIncludeNode(target)) return;
        includeNode(target);
        includeEdge(edge);
        if (!visited.has(target.id)) securityFrontier.push(target.id);
      });
    }

    const nodes = index.nodes.filter((node) => nodeIds.has(node.id));
    const edges = index.edges.filter((edge) => edgeIds.has(edge.id));
    return {
      ...source,
      nodes,
      edges,
      invalidNodes: 0,
      invalidEdges: 0,
      filters: { query: "", nodeType: "", edgeType: "" },
      sourceGraph: source,
      endpointId,
      index,
      match,
      handler,
      securityFilters: match.status === "CONFIRMED"
        ? index.securityFiltersForChain(match.chain.id).filters
        : [],
      relationIds: edges.map((edge) => edge.id)
    };
  }

  scope.MapInBootFlow = {
    createIndex,
    deriveConnectedGraph,
    positiveInteger,
    orderState,
    deriveEndpointGraph
  };
})();
