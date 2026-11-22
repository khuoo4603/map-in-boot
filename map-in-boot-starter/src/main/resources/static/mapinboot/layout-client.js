(() => {
  "use strict";

  const scope = typeof window !== "undefined" ? window : self;

  const ELK_VERSION = "0.12.1";
  const WORKER_URL = "/mapinboot/vendor/elk-worker.min.js";
  const NODE_WIDTH = 260;
  const NODE_HEIGHT = 120;
  const NODE_PADDING = 72;
  const COLUMN_STEP = 360;
  const SECTION_GAP = 96;
  const NODE_SAFE_MARGIN = 24;
  const FINDING_SECTION_PADDING_X = 28;
  const FINDING_SECTION_TOP_PADDING = 48;
  const FINDING_SECTION_BOTTOM_PADDING = 24;
  const FINDING_TITLE_HEIGHT = 18;
  const FINDING_TITLE_GAP = 22;
  const EDUCATION_AREA_TOP_PADDING = 48;
  const TOP_PADDING = 72;
  const ROW_STEP = 180;
  const CHAIN_GAP = 192;
  const GROUP_GAP = 48;
  const MAX_FILTER_COLUMNS = 4;
  const SUPPORT_EDGE_TYPES = new Set([
    "SECURED_BY", "READS_SECURITY_DATA", "WRITES_SECURITY_DATA", "CONVERTS_TO_AUTHORITY",
    "USES_FOR_AUTHORIZATION", "SECURITY_STATE"
  ]);
  const ACTUAL_Y = TOP_PADDING + 168;
  const BRANCH_Y = TOP_PADDING + 360;
  const LAYOUT_OPTIONS = Object.freeze({
    "org.eclipse.elk.algorithm": "layered",
    "org.eclipse.elk.direction": "RIGHT",
    "org.eclipse.elk.edgeRouting": "ORTHOGONAL",
    "org.eclipse.elk.portConstraints": "FIXED_SIDE",
    "org.eclipse.elk.spacing.nodeNode": "24",
    "org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers": "72",
    "org.eclipse.elk.layered.layering.strategy": "MIN_WIDTH",
    "org.eclipse.elk.padding": "[top=32,left=32,bottom=32,right=32]"
  });
  const PREPROCESS_THRESHOLD = 2400;

  function prepareGraphData(graph, task, endpointId, cachedIndex = null) {
    const flow = scope.MapInBootFlow;
    if (!flow) throw new Error("Graph 전처리 모듈을 사용할 수 없습니다.");
    const index = cachedIndex || flow.createIndex(graph);
    if (task === "connectedGraph") {
      const connected = flow.deriveConnectedGraph(graph, index);
      return {
        task,
        nodeIds: connected.nodes.map((node) => node.id),
        edgeIds: connected.edges.map((edge) => edge.id),
        unconnectedNodeCount: connected.unconnectedNodeCount
      };
    }
    if (task === "endpointGraph") {
      const detail = flow.deriveEndpointGraph(graph, endpointId, index);
      return {
        task,
        endpointId,
        nodeIds: detail.nodes.map((node) => node.id),
        edgeIds: detail.edges.map((edge) => edge.id),
        match: { status: detail.match.status, reason: detail.match.reason, chainId: detail.match.chain && detail.match.chain.id,
          edgeId: detail.match.edge && detail.match.edge.id },
        handler: { status: detail.handler.status, reason: detail.handler.reason, nodeId: detail.handler.node && detail.handler.node.id },
        securityFilterIds: detail.securityFilters.map((node) => node.id)
      };
    }
    throw new Error(`지원하지 않는 Graph 전처리 작업: ${task}`);
  }

  function createLaneDefinitions({ servletFilterCount = 1, maxSecurityFilters = 1, endpointCount = 0 } = {}) {
    const servletColumns = Math.min(MAX_FILTER_COLUMNS, Math.max(1, servletFilterCount));
    const securityColumns = Math.min(MAX_FILTER_COLUMNS, Math.max(1, maxSecurityFilters));
    const requestColumns = 4;
    const endpointColumns = endpointCount >= 16 ? 2 : 1;
    const servletStart = requestColumns;
    const delegationStart = servletStart + servletColumns;
    const chainStart = delegationStart + 3;
    const securityStart = chainStart + 1;
    const mvcStart = securityStart + securityColumns;
    const mappingStart = mvcStart + 2;
    const endpointStart = mappingStart + 2;
    const handlerStart = endpointStart + endpointColumns;
    return [
      { id: "request", label: "HTTP 요청 · 학습 흐름", column: 0, columns: requestColumns },
      { id: "servlet-filter", label: "Servlet Filter · 등록 관계", column: servletStart, columns: servletColumns },
      { id: "security-delegation", label: "Spring Security 위임", column: delegationStart, columns: 3 },
      { id: "security-chain", label: "첫 매칭 SecurityFilterChain", column: chainStart, columns: 1 },
      { id: "security-filter", label: "Security Filter · Chain별 순서", column: securityStart, columns: securityColumns },
      { id: "mvc", label: "DispatcherServlet · MVC", column: mvcStart, columns: 2 },
      { id: "mvc-mapping", label: "HandlerMapping · HandlerAdapter", column: mappingStart, columns: 2 },
      { id: "endpoint", label: "API Endpoint · 매핑 정보", column: endpointStart, columns: endpointColumns },
      { id: "handler", label: "Controller · Handler", column: handlerStart, columns: 1 }
    ].map((lane) => Object.freeze(lane));
  }

  const LANE_DEFINITIONS = createLaneDefinitions();

  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function text(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function attributes(item) {
    return item && item.attributes && typeof item.attributes === "object" ? item.attributes : {};
  }

  function positiveInteger(value) {
    if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : null;
    if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function filterRows(count) {
    return Math.max(1, Math.ceil(count / MAX_FILTER_COLUMNS));
  }

  function filterPosition(lane, index, baseY) {
    return {
      x: lane.x + (index % MAX_FILTER_COLUMNS) * COLUMN_STEP,
      y: baseY + Math.floor(index / MAX_FILTER_COLUMNS) * ROW_STEP
    };
  }

  function laneWidth(lane) {
    return lane.columns * NODE_WIDTH + (lane.columns - 1) * (COLUMN_STEP - NODE_WIDTH);
  }

  function positionLanes(laneDefinitions) {
    let nextX = NODE_PADDING;
    return laneDefinitions.map((lane) => {
      const positioned = { ...lane, x: nextX, width: laneWidth(lane) };
      nextX += positioned.width + SECTION_GAP;
      return positioned;
    });
  }

  function laneForNode(node) {
    if (!node) return "request";
    if (node.type === "APPLICATION") return "request";
    if (node.type === "SERVLET") return "mvc";
    if (node.type === "FILTER") {
      return attributes(node).registrationKind === "SERVLET" ? "servlet-filter" : "security-filter";
    }
    if (node.type === "SECURITY_CHAIN") return "security-chain";
    if (node.type === "ENDPOINT") return "endpoint";
    if (node.type === "HANDLER") return "handler";
    return "mvc-mapping";
  }

  function laneDefinition(id, lanes = LANE_DEFINITIONS) {
    return lanes.find((lane) => lane.id === id) || lanes[0];
  }

  function nodeOrder(node, elkPositions) {
    const position = elkPositions && elkPositions[node.id];
    return `${position && finite(position.y) ? String(position.y).padStart(12, "0") : "999999999999"}\u0000${text(node.id)}`;
  }

  function compareNodes(left, right, elkPositions) {
    return nodeOrder(left, elkPositions).localeCompare(nodeOrder(right, elkPositions));
  }

  function compareByNumber(left, right, numberOf, elkPositions) {
    const leftNumber = numberOf(left);
    const rightNumber = numberOf(right);
    if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) return leftNumber - rightNumber;
    if (leftNumber !== null && rightNumber === null) return -1;
    if (leftNumber === null && rightNumber !== null) return 1;
    return compareNodes(left, right, elkPositions);
  }

  function orderInfo(edge, node) {
    const edgeOrder = positiveInteger(attributes(edge).filterOrder);
    const nodeOrder = positiveInteger(attributes(node).filterOrder);
    if (edgeOrder !== null && nodeOrder !== null && edgeOrder !== nodeOrder) {
      return { status: "MISMATCHED", order: null, source: "CONFLICT" };
    }
    if (edgeOrder !== null) return { status: "CONFIRMED", order: edgeOrder, source: "EDGE" };
    if (nodeOrder !== null) return { status: "CONFIRMED", order: nodeOrder, source: "NODE" };
    return { status: "UNKNOWN", order: null, source: "NONE" };
  }

  function servletReference(node) {
    const className = text(attributes(node).filterClass || node && node.label);
    const reference = [
      ["OrderedCharacterEncodingFilter", 1],
      ["OrderedFormContentFilter", 2],
      ["OrderedRequestContextFilter", 3],
      ["DelegatingFilterProxyRegistrationBean", 4]
    ].find(([name]) => className.includes(name));
    const actual = positiveInteger(attributes(node).filterOrder);
    if (actual !== null) return { status: "CONFIRMED", order: actual, source: "SNAPSHOT" };
    if (reference) return { status: "REFERENCE", order: reference[1], source: "SPRING_BOOT_REFERENCE" };
    return { status: "UNKNOWN", order: null, source: "NONE" };
  }

  function confirmedEndpointChains(graph) {
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const matches = new Map();
    graph.edges.filter((edge) => edge.type === "MATCHED_BY").forEach((edge) => {
      const chain = nodes.get(edge.targetId);
      if (!chain || chain.type !== "SECURITY_CHAIN" || text(edge.confidence) !== "CONFIRMED") return;
      const current = matches.get(edge.sourceId) || [];
      current.push({ chain, edge });
      matches.set(edge.sourceId, current);
    });
    const confirmed = new Map();
    matches.forEach((candidates, endpointId) => {
      if (candidates.length === 1) confirmed.set(endpointId, candidates[0].chain);
    });
    return confirmed;
  }

  function confirmedEndpointHandlers(graph) {
    const handlers = graph.nodes.filter((node) => node.type === "HANDLER");
    const byKey = new Map();
    handlers.forEach((handler) => {
      const key = text(attributes(handler).handler);
      if (!key) return;
      const list = byKey.get(key) || [];
      list.push(handler);
      byKey.set(key, list);
    });
    const confirmed = new Map();
    graph.nodes.filter((node) => node.type === "ENDPOINT").forEach((endpoint) => {
      const key = text(attributes(endpoint).handler);
      const candidates = byKey.get(key) || [];
      if (key && candidates.length === 1) confirmed.set(endpoint.id, candidates[0]);
    });
    return confirmed;
  }

  function chainOrder(chain) {
    return positiveInteger(attributes(chain).chainOrder);
  }

  function endpointSort(endpoint, endpointChains, elkPositions) {
    const chain = endpointChains.get(endpoint.id);
    const order = chainOrder(chain);
    const endpointAttributes = attributes(endpoint);
    const route = `${text(endpointAttributes.httpMethod)} ${text(endpointAttributes.path)}`.trim();
    return [
      order === null ? 999999 : order,
      chain ? text(chain.id) : "zzzzzz",
      route,
      text(endpointAttributes.handler),
      nodeOrder(endpoint, elkPositions)
    ].join("\u0000");
  }

  function routeFromPoints(points) {
    const simplified = [];
    points.forEach((point) => {
      const previous = simplified[simplified.length - 1];
      if (previous && previous.x === point.x && previous.y === point.y) return;
      while (simplified.length >= 2) {
        const beforePrevious = simplified[simplified.length - 2];
        const current = simplified[simplified.length - 1];
        const sameColumn = beforePrevious.x === current.x && current.x === point.x;
        const sameRow = beforePrevious.y === current.y && current.y === point.y;
        if (!sameColumn && !sameRow) break;
        simplified.pop();
      }
      simplified.push(point);
    });
    return { sections: [{
      startPoint: simplified[0],
      bendPoints: simplified.slice(1, -1),
      endPoint: simplified[simplified.length - 1]
    }] };
  }

  function baseRouteFor(source, target, parallelIndex = 0, edgeType = "", sourceNode, targetNode, routeBoundary) {
    if (!source || !target) return { sections: [] };
    if (edgeType === "MATCHED_BY") {
      const start = { x: source.x, y: source.y + NODE_HEIGHT / 2 };
      const end = { x: target.x + NODE_WIDTH, y: target.y + NODE_HEIGHT / 2 };
      const channelY = target.y - NODE_SAFE_MARGIN - 42 - parallelIndex * 16;
      return {
        sections: [{
          startPoint: start,
          bendPoints: [{ x: start.x - 20, y: start.y }, { x: start.x - 20, y: channelY },
            { x: end.x + 20, y: channelY }, { x: end.x + 20, y: end.y }],
          endPoint: end
        }]
      };
    }
    if (edgeType === "FILTERED_BY" && sourceNode && targetNode
      && sourceNode.type === "SECURITY_CHAIN" && targetNode.type === "FILTER") {
      const start = { x: source.x + NODE_WIDTH, y: source.y + NODE_HEIGHT / 2 };
      const end = { x: target.x, y: target.y + NODE_HEIGHT / 2 };
      const channelY = start.y - NODE_HEIGHT / 2 - NODE_SAFE_MARGIN - 42 - parallelIndex * 14;
      return {
        sections: [{
          startPoint: start,
          bendPoints: [{ x: start.x + 20, y: start.y }, { x: start.x + 20, y: channelY },
            { x: end.x - 20, y: channelY }, { x: end.x - 20, y: end.y }],
          endPoint: end
        }]
      };
    }
    if (edgeType === "FILTERED_BY" && sourceNode && targetNode
      && sourceNode.type === "SERVLET" && targetNode.type === "FILTER") {
      const start = { x: source.x, y: source.y + NODE_HEIGHT / 2 };
      const end = { x: target.x + NODE_WIDTH, y: target.y + NODE_HEIGHT / 2 };
      const channelY = Math.min(start.y, end.y) - NODE_HEIGHT * 2 - NODE_SAFE_MARGIN - 48 - parallelIndex * 14;
      return {
        sections: [{
          startPoint: start,
          bendPoints: [{ x: start.x - 20, y: start.y }, { x: start.x - 20, y: channelY },
            { x: end.x + 20, y: channelY }, { x: end.x + 20, y: end.y }],
          endPoint: end
        }]
      };
    }
    if (SUPPORT_EDGE_TYPES.has(edgeType) && sourceNode && targetNode) {
      const forward = target.x >= source.x;
      const routePositions = routeBoundary && routeBoundary.positions ? Object.values(routeBoundary.positions) : [];
      const sourceY = source.y + NODE_HEIGHT / 2;
      const targetY = target.y + NODE_HEIGHT / 2;
      const preferredChannelX = forward
        ? target.x - NODE_SAFE_MARGIN - 1
        : target.x + NODE_WIDTH + NODE_SAFE_MARGIN + 1;
      const parallelChannelX = preferredChannelX + (forward ? -1 : 1) * parallelIndex * 8;
      const candidateXs = new Set([preferredChannelX, parallelChannelX,
        forward ? target.x + NODE_WIDTH + NODE_SAFE_MARGIN + 1 : target.x - NODE_SAFE_MARGIN - 1]);
      routePositions.forEach((position) => {
        candidateXs.add(position.x - NODE_SAFE_MARGIN - 1);
        candidateXs.add(position.x + NODE_WIDTH + NODE_SAFE_MARGIN + 1);
      });
      const candidates = Array.from(candidateXs).sort((left, right) => left - right);
      let bestRoute = null;
      let bestCost = Number.POSITIVE_INFINITY;
      candidates.forEach((channelX) => {
        if ((channelX > source.x && channelX < source.x + NODE_WIDTH)
          || (channelX > target.x && channelX < target.x + NODE_WIDTH)) return;
        const startRight = channelX >= source.x + NODE_WIDTH / 2;
        const targetWest = channelX <= target.x + NODE_WIDTH / 2;
        const start = { x: source.x + (startRight ? NODE_WIDTH : 0), y: sourceY };
        const end = { x: target.x + (targetWest ? 0 : NODE_WIDTH), y: targetY };
        const route = routeFromPoints([start, { x: channelX, y: sourceY }, { x: channelX, y: targetY }, end]);
        const section = route.sections[0];
        const points = [section.startPoint, ...section.bendPoints, section.endPoint];
        if (routeIntersectsAnyNode(route, sourceNode.id, targetNode.id, routeBoundary && routeBoundary.positions || {})) return;
        const length = points.slice(1).reduce((total, point, index) => total
          + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0);
        const bends = Math.max(0, points.length - 2);
        const wrongSourceSide = startRight !== forward;
        const wrongTargetSide = targetWest !== forward;
        const parallelBias = parallelIndex > 0 ? Math.abs(channelX - parallelChannelX) * 8 : 0;
        const cost = length + bends * 24 + (wrongSourceSide ? NODE_WIDTH : 0)
          + (wrongTargetSide ? NODE_WIDTH : 0) + parallelBias;
        if (cost < bestCost) {
          bestCost = cost;
          bestRoute = route;
        }
      });
      return bestRoute || routeAroundNodes(source, target, sourceNode.id, targetNode.id,
        routeBoundary && routeBoundary.positions || {});
    }
    const sourceRight = target.x >= source.x;
    const start = {
      x: source.x + (sourceRight ? NODE_WIDTH : 0),
      y: source.y + NODE_HEIGHT / 2 + parallelIndex * 8
    };
    const end = {
      x: target.x + (sourceRight ? 0 : NODE_WIDTH),
      y: target.y + NODE_HEIGHT / 2 - parallelIndex * 8
    };
    if (Math.abs(start.x - end.x) < 2) {
      const middleY = (start.y + end.y) / 2;
      return { sections: [{ startPoint: start, bendPoints: [{ x: start.x, y: middleY }], endPoint: end }] };
    }
    const middleX = (start.x + end.x) / 2;
    return {
      sections: [{
        startPoint: start,
        bendPoints: [{ x: middleX, y: start.y }, { x: middleX, y: end.y }],
        endPoint: end
      }]
    };
  }

  function projectionNode(id, primary, detail, column, y, lane = null) {
    const x = NODE_PADDING + column * COLUMN_STEP;
    return {
      id,
      presentationId: id,
      kind: "education",
      primary,
      detail,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      position: { x, y },
      bounds: { left: x, top: y, right: x + NODE_WIDTH, bottom: y + NODE_HEIGHT },
      lane,
      groupId: "education-flow",
      isEducational: true
    };
  }

  function layoutRect(position, width = NODE_WIDTH, height = NODE_HEIGHT) {
    const rectWidth = finite(position.width) && position.width > 0 ? position.width : width;
    const rectHeight = finite(position.height) && position.height > 0 ? position.height : height;
    return {
      left: position.x,
      top: position.y,
      right: position.x + rectWidth,
      bottom: position.y + rectHeight
    };
  }

  function overlapsRect(left, right, gap = 0) {
    return left.left - gap < right.right && left.right + gap > right.left
      && left.top - gap < right.bottom && left.bottom + gap > right.top;
  }

  function labelBounds(left, top, right, label, fontSize = 12) {
    const measured = Array.from(text(label)).reduce((width, character) =>
      width + (/[ᄀ-ᇿ㄰-㆏가-힯]/.test(character) ? fontSize : fontSize * 0.58), 0);
    const labelLeft = left + 8;
    return {
      left: labelLeft,
      top: top + 1,
      right: Math.min(right - 4, labelLeft + measured + 8),
      bottom: top + 22
    };
  }

  function sectionLayoutsFor(graph, positions, titleObstacles = []) {
    const nodes = new Map((graph.nodes || []).map((node) => [node.id, node]));
    const usedTitles = [];
    const layouts = [];
    const sections = (Array.isArray(graph.findingSections) ? graph.findingSections : []).slice().sort((left, right) =>
      text(left.finding && left.finding.id).localeCompare(text(right.finding && right.finding.id)));
    sections.forEach((section) => {
      const nodeIds = Array.from(new Set((section.nodeIds || []).filter((id) => nodes.has(id) && positions[id])));
      const related = nodeIds.map((id) => positions[id]);
      if (related.length === 0) return;
      const left = Math.min(...related.map((position) => position.x)) - FINDING_SECTION_PADDING_X;
      const right = Math.max(...related.map((position) => position.x + NODE_WIDTH)) + FINDING_SECTION_PADDING_X;
      const topNode = Math.min(...related.map((position) => position.y));
      const bottomNode = Math.max(...related.map((position) => position.y + NODE_HEIGHT));
      const relatedIds = new Set(nodeIds);
      const unrelatedCards = (graph.nodes || []).filter((node) => !relatedIds.has(node.id))
        .map((node) => positions[node.id]).filter(Boolean).map((position) => layoutRect(position));
      let titleTop = topNode - 40;
      const titleBoundsAt = (top) => ({
        left: left + 12,
        top,
        right: right - 12,
        bottom: top + FINDING_TITLE_HEIGHT
      });
      for (let attempt = 0; attempt < unrelatedCards.length + titleObstacles.length + usedTitles.length + 8; attempt += 1) {
        const candidate = titleBoundsAt(titleTop);
        if (![...unrelatedCards, ...titleObstacles, ...usedTitles].some((obstacle) => overlapsRect(candidate, obstacle, 4))) break;
        titleTop -= FINDING_TITLE_GAP;
      }
      const titleBounds = titleBoundsAt(titleTop);
      usedTitles.push(titleBounds);
      layouts.push({
        findingId: section.finding.id,
        nodeIds,
        bounds: {
          left,
          top: Math.min(topNode - FINDING_SECTION_TOP_PADDING, titleTop - 8),
          right,
          bottom: bottomNode + FINDING_SECTION_BOTTOM_PADDING
        },
        titleBounds,
        titlePosition: { x: titleBounds.left + 2, y: titleBounds.top + 15 }
      });
    });
    return layouts;
  }

  function projectionEdge(id, sourceId, targetId, kind = "education", metadata = {}) {
    return { id, sourceId, targetId, kind, dataEdgeId: null, ...metadata };
  }

  function nodeOverlaps(positions) {
    const entries = Object.entries(positions);
    let count = 0;
    for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
      const [, left] = entries[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
        const [, right] = entries[rightIndex];
        if (left.x < right.x + NODE_WIDTH && left.x + NODE_WIDTH > right.x
          && left.y < right.y + NODE_HEIGHT && left.y + NODE_HEIGHT > right.y) count += 1;
      }
    }
    return count;
  }

  function segmentIntersectsNode(start, end, nodePosition) {
    if (!start || !end || !nodePosition) return false;
    const width = Number.isFinite(nodePosition.width) ? nodePosition.width : NODE_WIDTH;
    const height = Number.isFinite(nodePosition.height) ? nodePosition.height : NODE_HEIGHT;
    const left = nodePosition.x;
    const right = left + width;
    const top = nodePosition.y;
    const bottom = top + height;
    if (start.x === end.x) {
      return start.x > left && start.x < right
        && Math.max(Math.min(start.y, end.y), top) < Math.min(Math.max(start.y, end.y), bottom);
    }
    if (start.y === end.y) {
      return start.y > top && start.y < bottom
        && Math.max(Math.min(start.x, end.x), left) < Math.min(Math.max(start.x, end.x), right);
    }
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    return minX < right && maxX > left && minY < bottom && maxY > top;
  }

  function routeIntersectsNode(route, nodeId, positions) {
    if (!route || !Array.isArray(route.sections)) return false;
    return route.sections.some((section) => {
      const points = [section.startPoint, ...(section.bendPoints || []), section.endPoint].filter(Boolean);
      for (let index = 1; index < points.length; index += 1) {
        if (segmentIntersectsNode(points[index - 1], points[index], positions[nodeId])) return true;
      }
      return false;
    });
  }

  function segmentIntersectsExpandedNode(start, end, nodePosition, margin = NODE_SAFE_MARGIN, expanded) {
    if (!nodePosition) return false;
    return segmentIntersectsNode(start, end, expanded || {
      x: nodePosition.x - margin,
      y: nodePosition.y - margin,
      width: NODE_WIDTH + margin * 2,
      height: NODE_HEIGHT + margin * 2
    });
  }

  function clearRouteSegment(start, end, obstacles) {
    for (const obstacle of obstacles) {
      if (segmentIntersectsExpandedNode(start, end, obstacle.position, NODE_SAFE_MARGIN, obstacle.expanded)) return false;
    }
    return true;
  }

  function routeAroundNodes(source, target, sourceId, targetId, positions) {
    const forward = target.x >= source.x;
    const start = {
      x: source.x + (forward ? NODE_WIDTH : 0),
      y: source.y + NODE_HEIGHT / 2
    };
    const end = {
      x: target.x + (forward ? 0 : NODE_WIDTH),
      y: target.y + NODE_HEIGHT / 2
    };
    const margin = NODE_SAFE_MARGIN;
    const routeBounds = {
      left: Math.min(start.x, end.x) - NODE_WIDTH - margin * 2,
      right: Math.max(start.x, end.x) + NODE_WIDTH + margin * 2,
      top: Math.min(start.y, end.y) - NODE_HEIGHT - margin * 2,
      bottom: Math.max(start.y, end.y) + NODE_HEIGHT + margin * 2
    };
    const entries = Object.entries(positions).filter(([nodeId, position]) => nodeId !== sourceId && nodeId !== targetId
      && position.x < routeBounds.right && position.x + NODE_WIDTH > routeBounds.left
      && position.y < routeBounds.bottom && position.y + NODE_HEIGHT > routeBounds.top);
    const obstacles = entries.map(([, position]) => ({ position, expanded: {
      x: position.x - margin, y: position.y - margin,
      width: NODE_WIDTH + margin * 2, height: NODE_HEIGHT + margin * 2
    } }));
    const xValues = new Set([start.x, end.x]);
    const yValues = new Set([start.y, end.y]);
    entries.forEach(([, position]) => {
      xValues.add(position.x - margin);
      xValues.add(position.x + NODE_WIDTH + margin);
      yValues.add(position.y - margin);
      yValues.add(position.y + NODE_HEIGHT + margin);
    });
    const allX = entries.flatMap(([, position]) => [position.x, position.x + NODE_WIDTH]);
    const allY = entries.flatMap(([, position]) => [position.y, position.y + NODE_HEIGHT]);
    if (allX.length > 0) {
      xValues.add(Math.min(start.x, end.x, ...allX) - margin * 2);
      xValues.add(Math.max(start.x, end.x, ...allX) + margin * 2);
    }
    if (allY.length > 0) {
      yValues.add(Math.min(start.y, end.y, ...allY) - margin * 2);
      yValues.add(Math.max(start.y, end.y, ...allY) + margin * 2);
    }
    const xs = Array.from(xValues).sort((left, right) => left - right);
    const ys = Array.from(yValues).sort((left, right) => left - right);
    const startX = xs.indexOf(start.x);
    const startY = ys.indexOf(start.y);
    const endX = xs.indexOf(end.x);
    const endY = ys.indexOf(end.y);
    const stateKey = (x, y, direction) => `${x}:${y}:${direction}`;
    const distance = (left, right) => Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
    const startKey = stateKey(startX, startY, 0);
    const costs = new Map([[startKey, 0]]);
    const parent = new Map([[startKey, null]]);
    const heap = [];
    const compare = (left, right) => left.score - right.score || left.cost - right.cost
      || left.y - right.y || left.x - right.x || left.direction - right.direction;
    const push = (item) => {
      heap.push(item);
      let index = heap.length - 1;
      while (index > 0) {
        const parentIndex = Math.floor((index - 1) / 2);
        if (compare(heap[parentIndex], item) <= 0) break;
        heap[index] = heap[parentIndex];
        index = parentIndex;
      }
      heap[index] = item;
    };
    const pop = () => {
      const first = heap[0];
      const last = heap.pop();
      if (heap.length > 0) {
        let index = 0;
        while (true) {
          const leftIndex = index * 2 + 1;
          const rightIndex = leftIndex + 1;
          if (leftIndex >= heap.length) break;
          const childIndex = rightIndex < heap.length && compare(heap[rightIndex], heap[leftIndex]) < 0
            ? rightIndex : leftIndex;
          if (compare(heap[childIndex], last) >= 0) break;
          heap[index] = heap[childIndex];
          index = childIndex;
        }
        heap[index] = last;
      }
      return first;
    };
    const startPoint = { x: xs[startX], y: ys[startY] };
    const endPoint = { x: xs[endX], y: ys[endY] };
    push({ x: startX, y: startY, direction: 0, cost: 0, score: distance(startPoint, endPoint) });
    let endKey = null;
    const directions = [[1, 0, 1], [-1, 0, 1], [0, 1, 2], [0, -1, 2]];
    while (heap.length > 0) {
      const currentState = pop();
      const currentKey = stateKey(currentState.x, currentState.y, currentState.direction);
      if (currentState.cost !== costs.get(currentKey)) continue;
      if (currentState.x === endX && currentState.y === endY) {
        endKey = currentKey;
        break;
      }
      const current = { x: xs[currentState.x], y: ys[currentState.y] };
      directions.forEach(([xDelta, yDelta, direction]) => {
        const nextX = currentState.x + xDelta;
        const nextY = currentState.y + yDelta;
        if (nextX < 0 || nextX >= xs.length || nextY < 0 || nextY >= ys.length) return;
        const next = { x: xs[nextX], y: ys[nextY] };
        if (!clearRouteSegment(current, next, obstacles)) return;
        const nextKey = stateKey(nextX, nextY, direction);
        const bendCost = currentState.direction && currentState.direction !== direction ? 40 : 0;
        const nextCost = currentState.cost + distance(current, next) + bendCost;
        if (nextCost >= (costs.get(nextKey) ?? Number.POSITIVE_INFINITY)) return;
        costs.set(nextKey, nextCost);
        parent.set(nextKey, currentKey);
        push({ x: nextX, y: nextY, direction, cost: nextCost,
          score: nextCost + distance(next, endPoint) });
      });
    }
    if (!endKey) return null;
    const points = [];
    let currentKey = endKey;
    while (currentKey !== null) {
      const [xIndex, yIndex] = currentKey.split(":").map(Number);
      points.push({ x: xs[xIndex], y: ys[yIndex] });
      currentKey = parent.get(currentKey);
    }
    points.reverse();
    return routeFromPoints(points);
  }

  function routeFor(source, target, parallelIndex = 0, edgeType = "", sourceNode, targetNode, routeBoundary) {
    const route = baseRouteFor(source, target, parallelIndex, edgeType, sourceNode, targetNode, routeBoundary);
    const positions = routeBoundary && routeBoundary.positions;
    if (!positions || !sourceNode || !targetNode
      || !routeIntersectsAnyNode(route, sourceNode.id, targetNode.id, positions)) return route;
    return routeAroundNodes(source, target, sourceNode.id, targetNode.id, positions) || route;
  }

  function edgeNodeIntersections(graph, positions, edgeRoutes) {
    let count = 0;
    graph.edges.forEach((edge) => {
      const route = edgeRoutes[edge.id];
      graph.nodes.forEach((node) => {
        if (node.id === edge.sourceId || node.id === edge.targetId) return;
        if (routeIntersectsNode(route, node.id, positions)) count += 1;
      });
    });
    return count;
  }

  function routeIntersectsAnyNode(route, sourceId, targetId, positions) {
    return Object.keys(positions).some((nodeId) => {
      if (nodeId === sourceId || nodeId === targetId) return false;
      return routeIntersectsNode(route, nodeId, positions);
    });
  }

  function supportSource(graph, positions, node) {
    const preferredTypes = new Set(["HANDLER", "FILTER", "AUTHORIZATION", "AUTHENTICATION", "SECURITY_CHAIN"]);
    const candidates = graph.edges
      .filter((edge) => edge.targetId === node.id
        && ["SECURED_BY", "READS_SECURITY_DATA", "WRITES_SECURITY_DATA", "CONVERTS_TO_AUTHORITY",
          "USES_FOR_AUTHORIZATION", "SECURITY_STATE"].includes(edge.type))
      .map((edge) => graph.nodes.find((candidate) => candidate.id === edge.sourceId))
      .filter((candidate) => candidate && positions[candidate.id])
      .sort((left, right) => {
        const leftPreferred = preferredTypes.has(left.type) ? 0 : 1;
        const rightPreferred = preferredTypes.has(right.type) ? 0 : 1;
        return leftPreferred - rightPreferred || positions[right.id].x - positions[left.id].x || left.id.localeCompare(right.id);
      });
    return candidates[0] || null;
  }

  function semanticLayout(graph, elkLayout) {
    const endpointChains = confirmedEndpointChains(graph);
    const endpointHandlers = confirmedEndpointHandlers(graph);
    const positions = {};
    const elkPositions = elkLayout && elkLayout.positions ? elkLayout.positions : {};
    const endpoints = graph.nodes.filter((node) => node.type === "ENDPOINT");
    const handlers = graph.nodes.filter((node) => node.type === "HANDLER");
    const chains = graph.nodes.filter((node) => node.type === "SECURITY_CHAIN")
      .sort((left, right) => compareByNumber(left, right, chainOrder, elkPositions));
    const securityFilters = graph.nodes.filter((node) => node.type === "FILTER"
      && attributes(node).registrationKind === "SECURITY");
    const servletFilters = graph.nodes.filter((node) => node.type === "FILTER"
      && attributes(node).registrationKind === "SERVLET");
    const filtersByChain = new Map();
    const securityFilterOrder = {};
    graph.edges.filter((edge) => edge.type === "FILTERED_BY").forEach((edge) => {
      const filter = graph.nodes.find((node) => node.id === edge.targetId);
      const chain = chains.find((node) => node.id === edge.sourceId);
      if (!filter || !chain || attributes(filter).registrationKind !== "SECURITY") return;
      const info = orderInfo(edge, filter);
      securityFilterOrder[filter.id] = info;
      const list = filtersByChain.get(chain.id) || [];
      list.push({ filter, edge, info });
      filtersByChain.set(chain.id, list);
    });
    const orderedChainItems = (chain) => (filtersByChain.get(chain.id) || []).slice().sort((left, right) => {
      const leftOrder = left.info.order === null ? Number.POSITIVE_INFINITY : left.info.order;
      const rightOrder = right.info.order === null ? Number.POSITIVE_INFINITY : right.info.order;
      return leftOrder - rightOrder || text(left.filter.id).localeCompare(text(right.filter.id));
    });
    const maxSecurityFilters = Math.max(1, ...chains.map((chain) => orderedChainItems(chain).length));
    const laneDefinitions = createLaneDefinitions({
      servletFilterCount: servletFilters.length,
      maxSecurityFilters,
      endpointCount: endpoints.length
    });
    const lanes = positionLanes(laneDefinitions);
    const endpointLane = laneDefinition("endpoint", lanes);
    const handlerLane = laneDefinition("handler", lanes);
    const filterLane = laneDefinition("security-filter", lanes);
    const servletLane = laneDefinition("servlet-filter", lanes);
    const delegationLane = laneDefinition("security-delegation", lanes);
    const mvcLane = laneDefinition("mvc", lanes);
    const mappingLane = laneDefinition("mvc-mapping", lanes);
    const chainLane = laneDefinition("security-chain", lanes);
    const dispatcherServlets = graph.nodes.filter((node) => node.type === "SERVLET");
    const endpointGroups = new Map();
    endpoints.slice().sort((left, right) => endpointSort(left, endpointChains, elkPositions)
      .localeCompare(endpointSort(right, endpointChains, elkPositions))).forEach((endpoint) => {
        const chain = endpointChains.get(endpoint.id);
        const key = chain ? chain.id : "uncertain";
        const group = endpointGroups.get(key) || [];
        group.push(endpoint);
        endpointGroups.set(key, group);
      });
    const orderedEndpointGroups = Array.from(endpointGroups.entries()).sort((left, right) => {
      if (left[0] === "uncertain") return 1;
      if (right[0] === "uncertain") return -1;
      const leftChain = chains.find((chain) => chain.id === left[0]);
      const rightChain = chains.find((chain) => chain.id === right[0]);
      return (chainOrder(leftChain) || 999999) - (chainOrder(rightChain) || 999999);
    });
    const blockHeight = (count) => Math.max(NODE_HEIGHT, count > 0
      ? (count - 1) * ROW_STEP + NODE_HEIGHT
      : NODE_HEIGHT);
    const servletRows = filterRows(servletFilters.length);
    const servletHeight = blockHeight(servletRows);
    const dispatcherHeight = blockHeight(dispatcherServlets.length);
    const chainHeights = chains.map((chain) => {
      const rows = filterRows(orderedChainItems(chain).length);
      return blockHeight(rows) + NODE_SAFE_MARGIN * 2;
    });
    const chainStackHeight = chainHeights.reduce((total, height, index) =>
      total + height + (index < chainHeights.length - 1 ? CHAIN_GAP : 0), 0) || NODE_HEIGHT;
    const orderedEndpoints = orderedEndpointGroups.flatMap(([, group]) => group);
    const endpointFirstColumnCount = endpoints.length >= 16 ? Math.ceil(endpoints.length / 2) : endpoints.length;
    const endpointStagger = endpoints.length >= 16 ? ROW_STEP / 2 : 0;
    const endpointHeight = endpoints.length >= 16
      ? blockHeight(Math.max(endpointFirstColumnCount, endpoints.length - endpointFirstColumnCount)) + endpointStagger
      : orderedEndpointGroups.reduce((total, [, group], index) =>
        total + blockHeight(group.length) + (index < orderedEndpointGroups.length - 1 ? GROUP_GAP : 0), 0) || NODE_HEIGHT;
    const controllerKeys = handlers.map((handler) => {
      const value = text(attributes(handler).handler);
      const index = value.indexOf("#");
      return index > 0 ? value.slice(0, index) : handler.id;
    });
    const mainHeight = Math.max(servletHeight, dispatcherHeight, chainStackHeight, endpointHeight, blockHeight(new Set(controllerKeys).size));
    const mainCenterY = ACTUAL_Y + mainHeight / 2;
    const centeredStart = (height) => mainCenterY - Math.max(NODE_HEIGHT, height) / 2;
    const servletStartY = centeredStart(servletHeight);
    const dispatcherStartY = centeredStart(dispatcherHeight);
    const chainStartY = centeredStart(chainStackHeight);
    const endpointStartY = centeredStart(endpointHeight);
    const handlerStartY = centeredStart(Math.max(endpointHeight, blockHeight(handlers.length)));

    const applications = graph.nodes.filter((node) => node.type === "APPLICATION");
    applications.forEach((node, index) => {
      positions[node.id] = { x: lanes[0].x, y: centeredStart(blockHeight(applications.length)) + index * ROW_STEP };
    });
    const servletFilterOrder = {};
    const orderedServletFilters = servletFilters.slice().sort((left, right) => {
      const leftInfo = servletFilterOrder[left.id] || (servletFilterOrder[left.id] = servletReference(left));
      const rightInfo = servletFilterOrder[right.id] || (servletFilterOrder[right.id] = servletReference(right));
      const leftOrder = leftInfo.order === null ? Number.POSITIVE_INFINITY : leftInfo.order;
      const rightOrder = rightInfo.order === null ? Number.POSITIVE_INFINITY : rightInfo.order;
      return leftOrder - rightOrder || text(left.id).localeCompare(text(right.id));
    });
    orderedServletFilters.forEach((filter, index) => {
      positions[filter.id] = filterPosition(servletLane, index, servletStartY);
    });
    dispatcherServlets.forEach((node, index) => {
      positions[node.id] = { x: mvcLane.x + COLUMN_STEP, y: dispatcherStartY + index * ROW_STEP };
    });

    const chainRows = new Map();
    const chainGroupBottoms = new Map();
    const chainGroups = [];
    let chainCursorY = chainStartY;
    chains.forEach((chain, chainIndex) => {
      const y = chainCursorY;
      chainRows.set(chain.id, y);
      positions[chain.id] = { x: chainLane.x, y };
      const items = orderedChainItems(chain);
      items.forEach(({ filter }, itemIndex) => {
        positions[filter.id] = filterPosition(filterLane, itemIndex, y);
      });
      const rows = filterRows(items.length);
      const lastRow = Math.max(0, rows - 1);
      const lastColumn = Math.min(MAX_FILTER_COLUMNS - 1, Math.max(0, items.length - 1));
      const bottom = y + lastRow * ROW_STEP + NODE_HEIGHT + NODE_SAFE_MARGIN;
      chainGroupBottoms.set(chain.id, bottom);
      chainGroups.push({
        id: chain.id,
        label: `체인 ${attributes(chain).chainOrder || "?"} · ${attributes(chain).matcherCondition || "조건 확인 불가"}`,
        top: y - 36,
        bottom,
        left: chainLane.x - NODE_SAFE_MARGIN,
        right: filterLane.x + lastColumn * COLUMN_STEP + NODE_WIDTH + NODE_SAFE_MARGIN,
        nodeIds: [chain.id, ...items.map(({ filter }) => filter.id)],
        filterOrderStatus: items.length > 0 && items.every(({ info }) => info.status === "CONFIRMED") ? "CONFIRMED" : "UNKNOWN"
      });
      chainCursorY = bottom + CHAIN_GAP;
    });
    securityFilters.filter((node) => !positions[node.id]).sort((left, right) => text(left.id).localeCompare(text(right.id)))
      .forEach((filter, index) => {
        positions[filter.id] = filterPosition(filterLane, index, chainCursorY);
        securityFilterOrder[filter.id] = securityFilterOrder[filter.id]
          || { status: "UNKNOWN", order: null, source: "NONE" };
      });

    const endpointRows = new Map();
    if (endpoints.length >= 16) {
      const firstColumn = orderedEndpoints.slice(0, endpointFirstColumnCount);
      const secondColumn = orderedEndpoints.slice(endpointFirstColumnCount);
      firstColumn.forEach((endpoint, index) => {
        const y = endpointStartY + index * ROW_STEP;
        positions[endpoint.id] = { x: endpointLane.x, y };
        endpointRows.set(endpoint.id, y);
      });
      secondColumn.forEach((endpoint, index) => {
        const y = endpointStartY + index * ROW_STEP + endpointStagger;
        positions[endpoint.id] = { x: endpointLane.x + COLUMN_STEP, y };
        endpointRows.set(endpoint.id, y);
      });
    } else {
      let endpointY = endpointStartY;
      orderedEndpointGroups.forEach(([, group]) => {
        group.forEach((endpoint) => {
          positions[endpoint.id] = { x: endpointLane.x, y: endpointY };
          endpointRows.set(endpoint.id, endpointY);
          endpointY += ROW_STEP;
        });
        endpointY += GROUP_GAP;
      });
    }
    let handlerY = handlerStartY;
    handlers.slice().sort((left, right) => {
      const leftEndpoint = Array.from(endpointHandlers.entries()).find(([, handler]) => handler.id === left.id);
      const rightEndpoint = Array.from(endpointHandlers.entries()).find(([, handler]) => handler.id === right.id);
      const leftY = leftEndpoint ? endpointRows.get(leftEndpoint[0]) : Number.POSITIVE_INFINITY;
      const rightY = rightEndpoint ? endpointRows.get(rightEndpoint[0]) : Number.POSITIVE_INFINITY;
      return leftY - rightY || compareNodes(left, right, elkPositions);
    }).forEach((handler, index) => {
      const y = handlerStartY + index * ROW_STEP;
      positions[handler.id] = { x: handlerLane.x, y };
      handlerY = y + ROW_STEP;
    });

    const controllerGroupsByOwner = new Map();
    handlers.forEach((handler) => {
      const handlerValue = text(attributes(handler).handler).trim();
      const hashIndex = handlerValue.indexOf("#");
      if (hashIndex <= 0) return;
      const controllerFqcn = handlerValue.slice(0, hashIndex).trim();
      if (!controllerFqcn) return;
      const group = controllerGroupsByOwner.get(controllerFqcn) || {
        id: `controller-group:${controllerFqcn}`,
        controllerFqcn,
        controllerName: controllerFqcn.slice(controllerFqcn.lastIndexOf(".") + 1),
        handlerIds: [],
        handlerMethods: [],
        endpointIds: []
      };
      group.handlerIds.push(handler.id);
      group.handlerMethods.push(handlerValue);
      controllerGroupsByOwner.set(controllerFqcn, group);
    });
    const controllerGroups = Array.from(controllerGroupsByOwner.values())
      .sort((left, right) => left.controllerFqcn.localeCompare(right.controllerFqcn));
    controllerGroups.forEach((group, index) => {
      group.endpointIds = Array.from(endpointHandlers.entries())
        .filter(([, handler]) => group.handlerIds.includes(handler.id))
        .map(([endpoint]) => endpoint);
      group.position = { x: handlerLane.x, y: centeredStart(blockHeight(controllerGroups.length)) + index * ROW_STEP };
    });

    // 실제 관계로 단일 소속을 확인한 Fact만 표시용으로 묶고 원본 참조 유지
    const nodeToDisplay = Object.fromEntries(graph.nodes.map((node) => [node.id, node.id]));
    const ownerByNode = new Map();
    controllerGroups.forEach((group) => group.handlerIds.forEach((id) => {
      nodeToDisplay[id] = group.id;
      ownerByNode.set(id, new Set([group.id]));
    }));
    graph.nodes.filter((node) => node.type === "FILTER" || node.type === "SECURITY_CHAIN")
      .forEach((node) => ownerByNode.set(node.id, new Set([node.id])));
    const supportTypes = new Set(["AUTHORIZATION", "SECURITY_DATA"]);
    const uncertainOwners = new Set(graph.edges.filter((edge) => SUPPORT_EDGE_TYPES.has(edge.type)
      && edge.confidence !== "CONFIRMED").map((edge) => edge.targetId));
    for (let pass = 0; pass < graph.nodes.length; pass += 1) {
      let changed = false;
      graph.edges.filter((edge) => SUPPORT_EDGE_TYPES.has(edge.type) && edge.confidence === "CONFIRMED")
        .forEach((edge) => {
          const target = graph.nodes.find((node) => node.id === edge.targetId);
          const owners = ownerByNode.get(edge.sourceId);
          if (uncertainOwners.has(edge.sourceId) && target && supportTypes.has(target.type)
            && !uncertainOwners.has(target.id)) { uncertainOwners.add(target.id); changed = true; }
          if (!target || !supportTypes.has(target.type) || !owners) return;
          const targetOwners = ownerByNode.get(target.id) || new Set();
          owners.forEach((owner) => {
            if (!targetOwners.has(owner)) { targetOwners.add(owner); changed = true; }
          });
          ownerByNode.set(target.id, targetOwners);
        });
      if (!changed) break;
    }
    const grouped = new Map();
    graph.nodes.filter((node) => supportTypes.has(node.type)).forEach((node) => {
      const owners = ownerByNode.get(node.id);
      if (!owners || owners.size !== 1 || uncertainOwners.has(node.id)) return;
      const ownerId = Array.from(owners)[0];
      const scope = node.type === "AUTHORIZATION"
        ? text(attributes(node).policySource || attributes(node).factType
          || (attributes(node).declarationKind ? "METHOD" : attributes(node).checkKind ? "OBJECT" : "UNKNOWN")) : "";
      const key = JSON.stringify([node.type, ownerId, scope]);
      const group = grouped.get(key) || {
        id: `display-group:${key}`, type: node.type, ownerId, scope, nodeIds: []
      };
      group.nodeIds.push(node.id);
      grouped.set(key, group);
      nodeToDisplay[node.id] = group.id;
    });
    const groups = Array.from(grouped.values());
    const displayToNodes = {};
    graph.nodes.forEach((node) => {
      const id = nodeToDisplay[node.id];
      (displayToNodes[id] || (displayToNodes[id] = [])).push(node.id);
    });
    const edgeToDisplay = {};
    const displayToEdges = {};
    const displayEdges = new Map();
    graph.edges.forEach((edge) => {
      const sourceId = nodeToDisplay[edge.sourceId];
      const targetId = nodeToDisplay[edge.targetId];
      const grouped = sourceId !== edge.sourceId || targetId !== edge.targetId;
      const id = `display-edge:${JSON.stringify(grouped ? [sourceId, targetId, edge.type] : [edge.id])}`;
      edgeToDisplay[edge.id] = id;
      (displayToEdges[id] || (displayToEdges[id] = [])).push(edge.id);
      if (!displayEdges.has(id)) displayEdges.set(id, { id, sourceId, targetId, type: edge.type });
    });
    const displayModel = { groups, nodeToDisplay, displayToNodes, edgeToDisplay, displayToEdges,
      edges: Array.from(displayEdges.values()) };

    const supportNodes = graph.nodes.filter((node) => ["AUTHENTICATION", "AUTHORIZATION", "SECURITY_DATA", "BUSINESS_SECURITY_STATE"].includes(node.type))
      .sort((left, right) => {
        const rank = { AUTHENTICATION: 1, AUTHORIZATION: 2, SECURITY_DATA: 3, BUSINESS_SECURITY_STATE: 4 };
        return (rank[left.type] || 9) - (rank[right.type] || 9) || text(left.id).localeCompare(text(right.id));
      });
    const supportAnchors = {};
    const supportPlans = supportNodes
      .map((node) => ({ node, anchor: supportSource(graph, positions, node) }))
      .sort((left, right) => Number(!left.anchor) - Number(!right.anchor) || text(left.node.id).localeCompare(text(right.node.id)));
    const unanchoredRows = Math.ceil(supportPlans.filter((item) => !item.anchor).length / 5);
    const unanchoredStartY = Math.max(TOP_PADDING, centeredStart(blockHeight(unanchoredRows)));
    const supportStep = NODE_WIDTH + 56;
    const availableSupportPosition = (baseX, baseY) => {
      for (let row = 0; row < supportPlans.length + 2; row += 1) {
        for (let column = 0; column < 5; column += 1) {
          const candidate = { x: baseX + column * supportStep, y: baseY + row * ROW_STEP };
          const occupied = Object.values(positions).concat(controllerGroups.map((group) => group.position)).some((position) => position.x - NODE_SAFE_MARGIN < candidate.x + NODE_WIDTH + NODE_SAFE_MARGIN
            && position.x + NODE_WIDTH + NODE_SAFE_MARGIN > candidate.x - NODE_SAFE_MARGIN
            && position.y - NODE_SAFE_MARGIN < candidate.y + NODE_HEIGHT + NODE_SAFE_MARGIN
            && position.y + NODE_HEIGHT + NODE_SAFE_MARGIN > candidate.y - NODE_SAFE_MARGIN);
          if (!occupied) return candidate;
        }
      }
      return { x: baseX, y: baseY + supportPlans.length * ROW_STEP };
    };
    supportPlans.forEach(({ node, anchor }) => {
      const controller = anchor && controllerGroups.find((group) => group.handlerIds.includes(anchor.id));
      const anchorPosition = controller ? controller.position : anchor ? positions[anchor.id] : null;
      const baseX = anchorPosition
        ? anchorPosition.x + supportStep
        : handlerLane.x + COLUMN_STEP;
      const baseY = anchorPosition ? anchorPosition.y : unanchoredStartY;
      positions[node.id] = availableSupportPosition(baseX, baseY);
      supportAnchors[node.id] = { status: anchor ? "CONFIRMED" : "UNKNOWN", anchorId: anchor ? anchor.id : null };
    });
    groups.forEach((group) => {
      group.position = positions[group.nodeIds[0]];
      group.handlerIds = group.nodeIds;
      group.endpointIds = [];
      group.edgeIds = graph.edges.filter((edge) => group.nodeIds.includes(edge.sourceId)
        || group.nodeIds.includes(edge.targetId)).map((edge) => edge.id);
      const controller = controllerGroups.find((candidate) => candidate.id === group.ownerId);
      const owner = graph.nodes.find((node) => node.id === group.ownerId);
      group.controllerName = controller ? controller.controllerName : owner ? owner.label : "소속 확인 불가";
      group.controllerFqcn = controller ? controller.controllerFqcn : group.controllerName;
    });

    // 중앙 처리 대역 확보: 실제 카드를 중심선 양쪽으로 분리
    const laneOffset = 100;
    const shiftForLane = (position) => {
      position.y += position.y + NODE_HEIGHT / 2 < mainCenterY ? 0 : laneOffset * 2;
    };
    Object.values(positions).forEach(shiftForLane);
    controllerGroups.forEach((group) => shiftForLane(group.position));
    chainGroups.forEach((group) => {
      const members = group.nodeIds.map((id) => positions[id]).filter(Boolean);
      if (members.length === 0) return;
      group.top = Math.min(...members.map((position) => position.y)) - 36;
      group.bottom = Math.max(...members.map((position) => position.y + NODE_HEIGHT)) + NODE_SAFE_MARGIN;
    });
    const actualBottom = Math.max(
      NODE_HEIGHT,
      ...Object.values(positions).map((position) => position.y + NODE_HEIGHT)
    );
    const educationStartY = mainCenterY + laneOffset - NODE_HEIGHT / 2;
    const EDUCATION_Y = educationStartY;

    const sectionAlignment = {
      request: { top: centeredStart(blockHeight(applications.length)), height: blockHeight(applications.length) + laneOffset * 2, centerY: mainCenterY + laneOffset },
      servletFilter: { top: servletStartY, height: servletHeight + laneOffset * 2, centerY: mainCenterY + laneOffset },
      security: { top: chainStartY, height: chainStackHeight + laneOffset * 2, centerY: mainCenterY + laneOffset },
      mvc: { top: dispatcherStartY, height: dispatcherHeight + laneOffset * 2, centerY: mainCenterY + laneOffset },
      endpoint: { top: endpointStartY, height: endpointHeight + laneOffset * 2, centerY: mainCenterY + laneOffset },
      handler: { top: centeredStart(blockHeight(controllerGroups.length)), height: blockHeight(controllerGroups.length) + laneOffset * 2, centerY: mainCenterY + laneOffset }
    };

    const detailPresentation = graph.presentationContext === "detail";
    const groupedPositionByNode = new Map();
    if (!detailPresentation) {
      controllerGroups.forEach((group) => (group.handlerIds || []).forEach((id) => groupedPositionByNode.set(id, group.position)));
      groups.forEach((group) => (group.nodeIds || []).forEach((id) => groupedPositionByNode.set(id, group.position)));
    }
    const displayPosition = (id) => groupedPositionByNode.get(id) || positions[id];
    const layoutTitleBounds = [];
    lanes.forEach((lane) => {
      const members = graph.nodes.filter((node) => laneForNode(node) === lane.id)
        .map((node) => displayPosition(node.id)).filter(Boolean);
      if (members.length === 0) return;
      const left = Math.min(...members.map((position) => position.x)) - NODE_SAFE_MARGIN;
      const top = Math.min(...members.map((position) => position.y)) - 42;
      const right = Math.max(...members.map((position) => position.x + NODE_WIDTH)) + NODE_SAFE_MARGIN;
      lane.headerBounds = labelBounds(left, top, right, lane.label);
      layoutTitleBounds.push(lane.headerBounds);
    });
    chainGroups.forEach((group) => {
      group.headerBounds = labelBounds(group.left, group.top, group.right, group.label, 11);
      layoutTitleBounds.push(group.headerBounds);
    });
    const findingSectionLayouts = sectionLayoutsFor(graph, positions, layoutTitleBounds);
    const hiddenGroupMembers = new Set();
    const visibleGroupBounds = [];
    if (!detailPresentation) {
      controllerGroups.concat(groups).forEach((group) => {
        (group.handlerIds || group.nodeIds || []).forEach((id) => hiddenGroupMembers.add(id));
        if (group.position) visibleGroupBounds.push(layoutRect(group.position));
      });
    }
    const occupiedBounds = graph.nodes.filter((node) => !hiddenGroupMembers.has(node.id))
      .map((node) => positions[node.id]).filter(Boolean).map((position) => layoutRect(position))
      .concat(visibleGroupBounds, layoutTitleBounds,
        findingSectionLayouts.flatMap((section) => [section.bounds, section.titleBounds]));

    const projectionNodes = [
      projectionNode("education-http-request", "HTTP 요청 수신", "일반적인 Servlet 처리 원리", 0, EDUCATION_Y),
      projectionNode("education-request-prepare", "요청 정보 준비", "HttpServletRequest와 HttpServletResponse 준비", 1, EDUCATION_Y),
      projectionNode("education-thread-context", "동기 처리 문맥", "동기식 Servlet의 일반 처리 문맥", 2, EDUCATION_Y),
      projectionNode("education-servlet-filter-chain", "FilterChain 전달", "Filter#doFilter에서 다음 Filter로 제어 전달", 3, EDUCATION_Y),
      projectionNode("education-delegating-filter-proxy", "DelegatingFilterProxy", "Servlet Filter에서 Spring Security로 처리 위임", delegationLane.column, EDUCATION_Y),
      projectionNode("education-filter-chain-proxy", "FilterChainProxy", "등록된 SecurityFilterChain 평가", delegationLane.column + 1, EDUCATION_Y),
      projectionNode("education-request-matcher", "RequestMatcher 평가", chains.map((chain) => `체인 ${attributes(chain).chainOrder || "?"}`).join(" · ") || "체인 확인 불가", delegationLane.column + 2, EDUCATION_Y),
      projectionNode("education-servlet-chain-continue", "Servlet FilterChain 계속", "앞선 처리 결과에 따라 이후 단계에 도달하지 않을 수 있음", mvcLane.column, EDUCATION_Y),
      projectionNode("education-handler-mapping", "HandlerMapping", "요청 정보에 맞는 Handler 조회", mappingLane.column, EDUCATION_Y),
      projectionNode("education-handler-adapter", "HandlerAdapter", "Controller·Handler 호출 준비", mappingLane.column + 1, EDUCATION_Y)
    ];
    const laneByColumn = new Map(lanes.map((lane) => [lane.column, lane]));
    projectionNodes.forEach((node) => {
      const oldColumn = (node.position.x - NODE_PADDING) / COLUMN_STEP;
      const lane = laneByColumn.get(oldColumn);
      if (!lane) return;
      node.position.x = lane.x;
      node.lane = lane.id;
    });
    // 실제 카드·표시 그룹·영역 제목 Bounds를 기준으로 교육용 카드 위치 확정
    projectionNodes.forEach((node) => {
      const nearby = occupiedBounds.filter((bounds) => node.position.x - NODE_SAFE_MARGIN < bounds.right
        && node.position.x + node.width + NODE_SAFE_MARGIN > bounds.left);
      const candidates = new Set([Math.max(TOP_PADDING, educationStartY)]);
      nearby.forEach((bounds) => {
        candidates.add(bounds.top - node.height - NODE_SAFE_MARGIN);
        candidates.add(bounds.bottom + NODE_SAFE_MARGIN + EDUCATION_AREA_TOP_PADDING);
      });
      const lowest = Math.max(TOP_PADDING, ...nearby.map((bounds) =>
        bounds.bottom + NODE_SAFE_MARGIN + EDUCATION_AREA_TOP_PADDING));
      candidates.add(lowest);
      const ordered = Array.from(candidates).filter((y) => Number.isFinite(y) && y >= TOP_PADDING)
        .sort((left, right) => Math.abs(left - educationStartY) - Math.abs(right - educationStartY) || left - right);
      const available = ordered.find((y) => {
        const candidate = {
          ...layoutRect({ x: node.position.x, y }, node.width, node.height),
          top: y - EDUCATION_AREA_TOP_PADDING
        };
        return !occupiedBounds.some((bounds) => overlapsRect(candidate, bounds, NODE_SAFE_MARGIN));
      });
      node.position.y = available === undefined ? lowest : available;
      node.bounds = layoutRect(node.position, node.width, node.height);
      occupiedBounds.push(node.bounds);
    });
    const projectionEdges = [];
    const addProjectionEdge = (id, sourceId, targetId, metadata = {}) =>
      projectionEdges.push(projectionEdge(id, sourceId, targetId, "education", metadata));
    ["education-http-request", "education-request-prepare", "education-thread-context", "education-servlet-filter-chain"]
      .reduce((previous, current) => {
        if (previous) addProjectionEdge(`education-${previous}-${current}`, previous, current);
        return current;
      }, null);
    if (orderedServletFilters.length > 0) {
      addProjectionEdge("education-servlet-filter-chain-to-first", "education-servlet-filter-chain", orderedServletFilters[0].id,
        { flowGroup: "servlet-filter", orderIndex: 0 });
      orderedServletFilters.slice(0, -1).forEach((filter, index) => {
        const nextIndex = index + 1;
        addProjectionEdge(`servlet-flow-${index}`, filter.id, orderedServletFilters[nextIndex].id, {
          flowGroup: "servlet-filter",
          orderIndex: nextIndex,
          routeKind: nextIndex % MAX_FILTER_COLUMNS === 0 ? "filter-wrap" : "direct"
        });
      });
      addProjectionEdge("servlet-flow-to-delegating", orderedServletFilters[orderedServletFilters.length - 1].id, "education-delegating-filter-proxy");
    } else {
      addProjectionEdge("education-servlet-filter-chain-to-delegating", "education-servlet-filter-chain", "education-delegating-filter-proxy");
    }
    addProjectionEdge("delegating-to-proxy", "education-delegating-filter-proxy", "education-filter-chain-proxy");
    addProjectionEdge("proxy-to-matcher", "education-filter-chain-proxy", "education-request-matcher");
    chains.forEach((chain) => {
      addProjectionEdge(`matcher-to-${chain.id}`, "education-request-matcher", chain.id);
      const items = orderedChainItems(chain);
      if (items.length > 0) {
        addProjectionEdge(`chain-to-filter-${chain.id}`, chain.id, items[0].filter.id,
          { flowGroup: chain.id, orderIndex: 0 });
        items.slice(0, -1).forEach((item, index) => {
          const nextIndex = index + 1;
          addProjectionEdge(`filter-flow-${chain.id}-${index}`, item.filter.id, items[nextIndex].filter.id, {
            flowGroup: chain.id,
            orderIndex: nextIndex,
            routeKind: nextIndex % MAX_FILTER_COLUMNS === 0 ? "filter-wrap" : "direct"
          });
        });
        addProjectionEdge(`filter-to-continue-${chain.id}`, items[items.length - 1].filter.id, "education-servlet-chain-continue");
      } else {
        addProjectionEdge(`chain-to-continue-${chain.id}`, chain.id, "education-servlet-chain-continue");
      }
    });
    addProjectionEdge("continue-to-dispatcher", "education-servlet-chain-continue", dispatcherServlets[0] ? dispatcherServlets[0].id : "education-handler-mapping");
    if (dispatcherServlets.length > 0) addProjectionEdge("dispatcher-to-handler-mapping", dispatcherServlets[0].id, "education-handler-mapping");
    endpoints.forEach((endpoint) => {
      addProjectionEdge(`mapping-to-${endpoint.id}`, "education-handler-mapping", endpoint.id);
      addProjectionEdge(`endpoint-to-adapter-${endpoint.id}`, endpoint.id, "education-handler-adapter");
    });
    handlers.forEach((handler) => {
      addProjectionEdge(`adapter-to-${handler.id}`, "education-handler-adapter", handler.id);
    });

    const lanePlans = lanes.map((lane) => {
      const nodeIds = graph.nodes
        .filter((node) => laneForNode(node) === lane.id && positions[node.id])
        .map((node) => node.id);
      const memberPositions = nodeIds.map((id) => {
        return displayPosition(id);
      });
      return {
        ...lane,
        nodeIds,
        bounds: memberPositions.length === 0
          ? null
          : {
            left: Math.min(...memberPositions.map((position) => position.x)) - NODE_SAFE_MARGIN,
            top: Math.min(...memberPositions.map((position) => position.y)) - 42,
            right: Math.max(...memberPositions.map((position) => position.x + NODE_WIDTH)) + NODE_SAFE_MARGIN,
            bottom: Math.max(...memberPositions.map((position) => position.y + NODE_HEIGHT)) + 32
          }
      };
    });
    const firstProjection = projectionNodes.slice().sort((left, right) =>
      left.position.y - right.position.y || left.position.x - right.position.x)[0];
    const educationArea = {
      left: Math.min(...projectionNodes.map((node) => node.bounds.left)) - NODE_SAFE_MARGIN,
      top: Math.min(...projectionNodes.map((node) => node.bounds.top)) - EDUCATION_AREA_TOP_PADDING,
      right: Math.max(...projectionNodes.map((node) => node.bounds.right)) + NODE_SAFE_MARGIN,
      bottom: Math.max(...projectionNodes.map((node) => node.bounds.bottom)) + 32,
      topPadding: EDUCATION_AREA_TOP_PADDING,
      titleX: firstProjection.position.x + 12,
      titleY: Math.min(...projectionNodes.map((node) => node.position.y)) - EDUCATION_AREA_TOP_PADDING + 18
    };
    const projection = { nodes: projectionNodes, edges: projectionEdges };
    const projectionPositions = Object.fromEntries(projectionNodes.map((node) => [node.id, {
      ...node.position,
      width: node.width,
      height: node.height
    }]));
    const groupPositions = Object.fromEntries((detailPresentation ? [] : controllerGroups.concat(groups))
      .filter((group) => group.position).map((group) => [group.id, group.position]));
    const routePositions = { ...positions, ...projectionPositions };
    const allPositions = { ...positions, ...groupPositions, ...projectionPositions };
    const projectionRoutes = {};
    projectionEdges.forEach((edge) => {
      const source = routePositions[edge.sourceId];
      const target = routePositions[edge.targetId];
      if (!source || !target) return;
      const sourceWidth = finite(source.width) && source.width > 0 ? source.width : NODE_WIDTH;
      const sourceHeight = finite(source.height) && source.height > 0 ? source.height : NODE_HEIGHT;
      const targetHeight = finite(target.height) && target.height > 0 ? target.height : NODE_HEIGHT;
      const start = { x: source.x + sourceWidth, y: source.y + sourceHeight / 2 };
      const end = { x: target.x, y: target.y + targetHeight / 2 };
      if (edge.routeKind === "filter-wrap") {
        projectionRoutes[edge.id] = {
          d: `M ${start.x} ${start.y} H ${source.x + sourceWidth + 48} V ${target.y - 36} H ${target.x - 48} V ${end.y} H ${end.x}`,
          kind: edge.routeKind
        };
      } else if (Math.abs(start.y - end.y) < 2) {
        projectionRoutes[edge.id] = { d: `M ${start.x} ${start.y} H ${end.x}`, kind: edge.routeKind || "direct" };
      } else {
        const channelX = (start.x + end.x) / 2;
        projectionRoutes[edge.id] = {
          d: `M ${start.x} ${start.y} H ${channelX} V ${end.y} H ${end.x}`,
          kind: edge.routeKind || "direct"
        };
      }
      const points = [];
      for (const match of projectionRoutes[edge.id].d.matchAll(/([MHV])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?/g)) {
        const previous = points[points.length - 1];
        points.push(match[1] === "H" ? { x: Number(match[2]), y: previous.y }
          : match[1] === "V" ? { x: previous.x, y: Number(match[2]) }
            : { x: Number(match[2]), y: Number(match[3]) });
      }
      const route = { sections: [{ startPoint: points[0], bendPoints: points.slice(1, -1), endPoint: points[points.length - 1] }] };
      if (routeIntersectsAnyNode(route, edge.sourceId, edge.targetId, routePositions)) {
        const alternate = routeAroundNodes(source, target, edge.sourceId, edge.targetId, routePositions);
        const section = alternate && alternate.sections[0];
        if (section) {
          const safePoints = [section.startPoint, ...(section.bendPoints || []), section.endPoint];
          projectionRoutes[edge.id].d = safePoints.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
        }
      }
    });
    const width = Math.max(
      NODE_PADDING * 2 + NODE_WIDTH,
      ...Object.values(allPositions).map((position) => position.x
        + (finite(position.width) && position.width > 0 ? position.width : NODE_WIDTH) + NODE_PADDING)
    );
    const height = Math.max(
      TOP_PADDING + NODE_HEIGHT,
      ...Object.values(allPositions).map((position) => position.y
        + (finite(position.height) && position.height > 0 ? position.height : NODE_HEIGHT) + NODE_PADDING),
      handlerY + NODE_PADDING
    );
    const edgeRoutes = {};
    const edgePairCounts = new Map();
    graph.edges.forEach((edge) => {
      const source = positions[edge.sourceId];
      const target = positions[edge.targetId];
      if (!source || !target) return;
      const key = `${edge.sourceId}\u0000${edge.targetId}`;
      const index = edgePairCounts.get(key) || 0;
      edgePairCounts.set(key, index + 1);
      edgeRoutes[edge.id] = routeFor(
        source,
        target,
        index,
        edge.type,
        graph.nodes.find((node) => node.id === edge.sourceId),
        graph.nodes.find((node) => node.id === edge.targetId),
        { width, height: actualBottom, positions }
      );
    });
    const displayPositions = { ...projectionPositions };
    graph.nodes.forEach((node) => {
      const displayId = nodeToDisplay[node.id];
      const group = controllerGroups.concat(groups).find((candidate) => candidate.id === displayId);
      displayPositions[displayId] = group ? group.position : positions[node.id];
    });
    const displayEdgeRoutes = {};
    const displayRouteCache = new Map();
    graph.edges.forEach((edge) => {
      const sourceId = nodeToDisplay[edge.sourceId];
      const targetId = nodeToDisplay[edge.targetId];
      const source = displayPositions[sourceId];
      const target = displayPositions[targetId];
      if (!source || !target) return;
      if (sourceId === targetId) {
        displayEdgeRoutes[edge.id] = { sections: [{
          startPoint: { x: source.x + NODE_WIDTH, y: source.y + NODE_HEIGHT / 2 },
          bendPoints: [{ x: source.x + NODE_WIDTH + 24, y: source.y + NODE_HEIGHT / 2 },
            { x: source.x + NODE_WIDTH + 24, y: source.y - 24 }, { x: source.x - 24, y: source.y - 24 },
            { x: source.x - 24, y: source.y + NODE_HEIGHT / 2 }],
          endPoint: { x: source.x, y: source.y + NODE_HEIGHT / 2 }
        }] };
        return;
      }
      const originalSource = graph.nodes.find((node) => node.id === edge.sourceId);
      const originalTarget = graph.nodes.find((node) => node.id === edge.targetId);
      const key = JSON.stringify([sourceId, targetId, edge.type, originalSource.type, originalTarget.type]);
      let route = displayRouteCache.get(key);
      if (!route) {
        route = routeFor(source, target, 0, edge.type,
          { ...originalSource, id: sourceId }, { ...originalTarget, id: targetId },
          { width, height: actualBottom, positions: displayPositions });
        displayRouteCache.set(key, route);
      }
      displayEdgeRoutes[edge.id] = route;
    });
    const overviewProjectionRoutes = {};
    const projectionRouteCache = new Map();
    projectionEdges.concat({ id: "mapping-to-adapter-shared", sourceId: "education-handler-mapping", targetId: "education-handler-adapter" })
      .forEach((edge) => {
        const sourceId = nodeToDisplay[edge.sourceId] || edge.sourceId;
        const targetId = nodeToDisplay[edge.targetId] || edge.targetId;
        const source = displayPositions[sourceId];
        const target = displayPositions[targetId];
        if (!source || !target || sourceId === targetId) return;
        const key = JSON.stringify([sourceId, targetId]);
        let route = projectionRouteCache.get(key);
        if (!route) {
          route = routeFor(source, target, 0, "", { id: sourceId }, { id: targetId },
            { width, height: actualBottom, positions: displayPositions });
          projectionRouteCache.set(key, route);
        }
        const section = route.sections && route.sections[0];
        if (!section) return;
        const points = [section.startPoint, ...(section.bendPoints || []), section.endPoint];
        overviewProjectionRoutes[edge.id] = { d: points.map((point, index) =>
          `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ") };
      });
    const guideRoutes = {};
    endpointHandlers.forEach((handler, endpointId) => {
      const targetId = nodeToDisplay[handler.id];
      const source = displayPositions[endpointId];
      const target = displayPositions[targetId];
      if (!source || !target) return;
      const route = routeFor(source, target, 0, "", { id: endpointId }, { id: targetId },
        { width, height: actualBottom, positions: displayPositions });
      const section = route.sections && route.sections[0];
      if (!section) return;
      const points = [section.startPoint, ...(section.bendPoints || []), section.endPoint];
      guideRoutes[endpointId] = points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
    });
    return {
      positions,
      edgeRoutes,
      width,
      height,
      plan: {
        mode: "request-flow-lanes",
        lanes: lanePlans,
        sectionGap: SECTION_GAP,
        sectionAlignment,
        routing: { nodeSafeMargin: NODE_SAFE_MARGIN },
        chainGap: CHAIN_GAP,
        chainGroups,
        controllerGroups,
        displayModel,
        findingSectionLayouts,
        displayEdgeRoutes,
        overviewProjectionRoutes,
        guideRoutes,
        educationArea,
        projection,
          projectionRoutes,
        servletFilterOrder,
        securityFilterOrder,
        supportAnchors,
        routeDiagnostics: {
          nodeOverlaps: nodeOverlaps(positions),
          edgeNodeIntersections: edgeNodeIntersections(graph, positions, edgeRoutes)
        }
      }
    };
  }

  function buildGraph(graph) {
    const children = graph.nodes
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((node) => ({
        id: node.id,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        ports: [
          { id: `${node.id}:in`, properties: { "org.eclipse.elk.port.side": "WEST" } },
          { id: `${node.id}:out`, properties: { "org.eclipse.elk.port.side": "EAST" } }
        ]
      }));
    const edges = graph.edges
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((edge) => ({
        id: edge.id,
        sources: [`${edge.sourceId}:out`],
        targets: [`${edge.targetId}:in`]
      }));
    return {
      id: "mapinboot-graph",
      layoutOptions: LAYOUT_OPTIONS,
      children,
      edges
    };
  }

  function copyPoint(point) {
    return point && finite(point.x) && finite(point.y) ? { x: point.x, y: point.y } : null;
  }

  function extractLayout(result) {
    if (!result || !Array.isArray(result.children) || !Array.isArray(result.edges)) {
      throw new Error("ELK 결과 구조가 올바르지 않습니다.");
    }
    const positions = {};
    result.children.forEach((child) => {
      if (!child.id || !finite(child.x) || !finite(child.y)) {
        throw new Error("ELK Node 좌표가 올바르지 않습니다.");
      }
      positions[child.id] = { x: child.x, y: child.y };
    });
    const edgeRoutes = {};
    result.edges.forEach((edge) => {
      if (!edge.id) throw new Error("ELK Edge ID가 없습니다.");
      edgeRoutes[edge.id] = {
        sections: Array.isArray(edge.sections)
          ? edge.sections.map((section) => ({
            startPoint: copyPoint(section.startPoint),
            bendPoints: Array.isArray(section.bendPoints) ? section.bendPoints.map(copyPoint).filter(Boolean) : [],
            endPoint: copyPoint(section.endPoint)
          }))
          : []
      };
    });
    return {
      positions,
      edgeRoutes,
      width: finite(result.width) && result.width > 0 ? result.width : 640,
      height: finite(result.height) && result.height > 0 ? result.height : 360
    };
  }

  function createClient(ElkConstructor = scope.ELK) {
    let elk = null;
    let latestRequest = 0;
    let requestSequence = 0;
    let layoutWorker = null;
    let workerUnavailable = false;
    const pending = new Map();
    const sentGenerations = new Set();
    if (typeof ElkConstructor === "function") elk = new ElkConstructor({ workerUrl: WORKER_URL });

    function finish(requestId, layout, fallback) {
      const request = pending.get(requestId);
      if (!request) return;
      pending.delete(requestId);
      if (request.type === "prepare") {
        try {
          const result = fallback ? prepareGraphData(request.graph, request.task, request.endpointId) : layout;
          request.resolve({ ...result, requestId, generation: request.generation, viewKey: request.viewKey, stale: false, fallback: Boolean(fallback) });
        } catch (error) { request.reject(error); }
        return;
      }
      if (requestId !== latestRequest) { request.resolve({ requestId, stale: true }); return; }
      try {
        const result = fallback ? semanticLayout(request.graph, request.elkLayout) : layout;
        request.resolve({ ...result, requestId, stale: false });
      } catch (error) { request.reject(error); }
    }

    function stopWorker(fallback) {
      if (layoutWorker) layoutWorker.terminate();
      layoutWorker = null;
      sentGenerations.clear();
      Array.from(pending.entries()).forEach(([id, request]) => finish(id, null, fallback || request.type === "prepare"));
    }

    function ensureWorker() {
      if (layoutWorker) return true;
      if (workerUnavailable || typeof scope.Worker !== "function") return false;
      try {
        layoutWorker = new scope.Worker("/mapinboot/layout-client.js");
        const worker = layoutWorker;
        layoutWorker.onmessage = (event) => {
          if (layoutWorker !== worker) return;
          const message = event.data || {};
          if (message.type === "snapshot-ready") return;
          if (message.type === "prepared") {
            const request = pending.get(message.requestId);
            if (!request || request.type !== "prepare") return;
            if (message.error) {
              workerUnavailable = true;
              stopWorker(true);
              return;
            }
            if (message.generation !== request.generation || message.viewKey !== request.viewKey || message.task !== request.task) {
              pending.delete(message.requestId);
              request.resolve({ requestId: message.requestId, generation: request.generation, viewKey: request.viewKey, stale: true });
              return;
            }
            finish(message.requestId, message.result, false);
            return;
          }
          if (message.error) { workerUnavailable = true; stopWorker(true); return; }
          finish(message.requestId, message.layout, false);
        };
        layoutWorker.onerror = (event) => {
          if (event && typeof event.preventDefault === "function") event.preventDefault();
          if (layoutWorker !== worker) return;
          workerUnavailable = true;
          stopWorker(true);
        };
        return true;
      } catch (_error) {
        workerUnavailable = true;
        layoutWorker = null;
        return false;
      }
    }

    function calculate(graph, elkLayout, requestId) {
      if (!ensureWorker()) {
        return Promise.resolve({ ...semanticLayout(graph, elkLayout), requestId, stale: requestId !== latestRequest });
      }
      return new Promise((resolve, reject) => {
        pending.set(requestId, { type: "layout", graph, elkLayout, resolve, reject });
        try { layoutWorker.postMessage({ requestId, graph, elkLayout }); }
        catch (_error) { workerUnavailable = true; stopWorker(true); }
      });
    }

    return {
      workerUrl: WORKER_URL,
      layoutOptions: LAYOUT_OPTIONS,
      preprocessThreshold: PREPROCESS_THRESHOLD,
      buildGraph,
      layout(graph) {
        const requestId = ++requestSequence;
        latestRequest = requestId;
        if (!elk) return Promise.reject(new Error("ELK.js Worker를 사용할 수 없습니다."));
        return elk.layout(buildGraph(graph), { layoutOptions: LAYOUT_OPTIONS }).then((result) => {
          if (requestId !== latestRequest) return { requestId, stale: true };
          const elkLayout = extractLayout(result);
          return calculate(graph, elkLayout, requestId);
        });
      },
      prepareGraph(graph, generation, viewKey, task, endpointId = "") {
        const requestId = ++requestSequence;
        const fallback = () => ({ ...prepareGraphData(graph, task, endpointId), requestId, generation, viewKey, stale: false, fallback: true });
        if (graph.nodes.length < PREPROCESS_THRESHOLD || !ensureWorker()) return Promise.resolve(fallback());
        return new Promise((resolve, reject) => {
          pending.set(requestId, { type: "prepare", graph, generation, viewKey, task, endpointId, resolve, reject });
          try {
            if (!sentGenerations.has(generation)) {
              layoutWorker.postMessage({ type: "snapshot", generation, graph });
              sentGenerations.add(generation);
              while (sentGenerations.size > 2) sentGenerations.delete(sentGenerations.values().next().value);
            }
            layoutWorker.postMessage({ type: "prepare", requestId, generation, viewKey, task, endpointId });
          } catch (_error) {
            workerUnavailable = true;
            stopWorker(true);
          }
        });
      },
      terminate() {
        latestRequest = ++requestSequence;
        stopWorker(false);
        if (elk && typeof elk.terminateWorker === "function") elk.terminateWorker();
      }
    };
  }

  const client = createClient();
  scope.MapInBootLayout = {
    version: ELK_VERSION,
    workerUrl: WORKER_URL,
    preprocessThreshold: PREPROCESS_THRESHOLD,
    layoutOptions: LAYOUT_OPTIONS,
    buildGraph,
    extractLayout,
    semanticLayout,
    prepareGraphData,
    createClient,
    prepareGraph: (graph, generation, viewKey, task, endpointId) => client.prepareGraph(graph, generation, viewKey, task, endpointId),
    layout: (graph) => client.layout(graph),
    terminate: () => client.terminate()
  };
  if (typeof document === "undefined" && typeof self !== "undefined" && typeof self.importScripts === "function") {
    if (!scope.MapInBootFlow) self.importScripts("/mapinboot/graph-flow.js");
    const snapshots = new Map();
    self.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === "snapshot") {
        try {
          const index = scope.MapInBootFlow.createIndex(message.graph);
          snapshots.delete(message.generation);
          snapshots.set(message.generation, { graph: message.graph, index });
          while (snapshots.size > 2) snapshots.delete(snapshots.keys().next().value);
          self.postMessage({ type: "snapshot-ready", generation: message.generation });
        } catch (error) {
          self.postMessage({ type: "snapshot-ready", generation: message.generation, error: error.message || "Graph 준비 실패" });
        }
        return;
      }
      if (message.type === "prepare") {
        const stored = snapshots.get(message.generation);
        try {
          if (!stored) throw new Error("Snapshot 세대 데이터가 없습니다.");
          const result = prepareGraphData(stored.graph, message.task, message.endpointId, stored.index);
          self.postMessage({ type: "prepared", requestId: message.requestId, generation: message.generation,
            viewKey: message.viewKey, task: message.task, result });
        } catch (error) {
          self.postMessage({ type: "prepared", requestId: message.requestId, generation: message.generation,
            viewKey: message.viewKey, task: message.task, error: error.message || "Graph 전처리 실패" });
        }
        return;
      }
      try { self.postMessage({ requestId: message.requestId, layout: semanticLayout(message.graph, message.elkLayout) }); }
      catch (error) { self.postMessage({ requestId: message.requestId, error: error.message || "배치 계산 실패" }); }
    };
  }
})();
