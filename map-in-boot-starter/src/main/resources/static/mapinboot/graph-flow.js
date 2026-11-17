(() => {
  "use strict";

  const NODE_TYPES = Object.freeze({
    ENDPOINT: "ENDPOINT",
    HANDLER: "HANDLER",
    SECURITY_CHAIN: "SECURITY_CHAIN",
    SERVLET: "SERVLET",
    FILTER: "FILTER"
  });
  const EDGE_TYPES = Object.freeze({
    MATCHED_BY: "MATCHED_BY",
    FILTERED_BY: "FILTERED_BY"
  });

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

  function createIndex(graph) {
    const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
    const edges = graph && Array.isArray(graph.edges) ? graph.edges : [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
    const endpoints = nodes.filter((node) => node.type === NODE_TYPES.ENDPOINT);
    const handlers = nodes.filter((node) => node.type === NODE_TYPES.HANDLER);
    const chains = nodes.filter((node) => node.type === NODE_TYPES.SECURITY_CHAIN);
    const servlets = nodes.filter((node) => node.type === NODE_TYPES.SERVLET);
    const securityFilters = nodes.filter((node) => node.type === NODE_TYPES.FILTER
      && attributes(node).registrationKind === "SECURITY");
    const servletFilters = nodes.filter((node) => node.type === NODE_TYPES.FILTER
      && attributes(node).registrationKind === "SERVLET");

    function firstMatchedChain(endpointId) {
      const candidates = edges.filter((edge) => edge.type === EDGE_TYPES.MATCHED_BY
        && edge.sourceId === endpointId);
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
      const relationships = edges
        .filter((edge) => edge.type === EDGE_TYPES.FILTERED_BY && edge.sourceId === sourceId)
        .map((edge) => ({ edge, node: nodeById.get(edge.targetId) }))
        .filter((item) => item.node && item.node.type === NODE_TYPES.FILTER
          && attributes(item.node).registrationKind === registrationKind
          && (!attributes(item.edge).registrationKind
            || attributes(item.edge).registrationKind === registrationKind));
      const items = relationships.map((item) => item.node);
      const result = {
        filters: items.slice().sort((left, right) => text(left.id).localeCompare(text(right.id))),
        edges: relationships.map((item) => item.edge),
        orderStatus: orderState(relationships, (item) => {
          const edgeOrder = attributes(item.edge).filterOrder;
          return edgeOrder === undefined ? attributes(item.node).filterOrder : edgeOrder;
        })
      };
      if (result.orderStatus === "CONFIRMED") {
        result.filters.sort((left, right) => {
          const leftOrder = positiveInteger(attributes(left).filterOrder);
          const rightOrder = positiveInteger(attributes(right).filterOrder);
          return leftOrder - rightOrder || text(left.id).localeCompare(text(right.id));
        });
      }
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
      nodes,
      edges,
      endpoints,
      handlers,
      chains,
      servlets,
      securityFilters,
      servletFilters,
      firstMatchedChain,
      securityFiltersForChain,
      servletFiltersForServlet,
      handlerFor,
      summary
    };
  }

  window.MapInBootFlow = {
    createIndex,
    positiveInteger,
    orderState
  };
})();
