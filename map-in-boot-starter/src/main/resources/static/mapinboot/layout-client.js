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
  const MAJOR_SECTION_GAP = 200;
  const NODE_SAFE_MARGIN = 24;
  const ROUTE_CORRIDOR_CLEARANCE = 18;
  const API_HANDLER_CORRIDOR = 240;
  const ROUTE_REPLAN_COST = 96;
  const routeGeometryCache = new WeakMap();
  const FINDING_SECTION_PADDING_X = 28;
  const FINDING_SECTION_TOP_PADDING = 48;
  const FINDING_SECTION_BOTTOM_PADDING = 24;
  const FINDING_TITLE_HEIGHT = 18;
  const FINDING_TITLE_GAP = 22;
  const EDUCATION_AREA_TOP_PADDING = 48;
  const TOP_PADDING = 72;
  const ROW_STEP = 180;
  const SECOND_COLUMN_OFFSET = ROW_STEP * 1.5;
  const CHAIN_GAP = 192;
  const GROUP_GAP = 48;
  const MAX_FILTER_COLUMNS = 4;
  const JWT_SECURITY_API_TYPES = new Set(["NIMBUS_CLAIMS_BUILDER", "NIMBUS_CLAIMS_SET", "NIMBUS_SIGNED_JWT",
    "SPRING_SECURITY_JWT", "SPRING_SECURITY_JWT_DECODER", "SPRING_SECURITY_NIMBUS_DECODER",
    "SPRING_SECURITY_JWT_VALIDATION"]);
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

  function createLaneDefinitions({ servletFilterCount = 1, maxSecurityFilters = 1, endpointCount = 0,
    securityNodeCount = 0, overview = false, applicationCount = 0 } = {}) {
    const servletColumns = Math.min(MAX_FILTER_COLUMNS, Math.max(1, servletFilterCount));
    const securityColumns = Math.min(MAX_FILTER_COLUMNS, Math.max(1, maxSecurityFilters));
    const securityChecksColumns = Math.min(overview ? 2 : MAX_FILTER_COLUMNS, Math.max(1, Math.ceil(securityNodeCount / 8)));
    const requestColumns = 4;
    const endpointColumns = endpointCount >= 16 ? 2 : 1;
    const handlerColumns = endpointColumns;
    if (overview) {
      return [
        ...(applicationCount ? [{ id: "request", label: "서비스 진입", columns: 1 }] : []),
        { id: "servlet-filter", label: "Servlet Filter · 등록 관계", columns: servletColumns },
        { id: "security-chain", label: "첫 매칭 SecurityFilterChain", columns: 1 },
        { id: "security-filter", label: "Security Filter · Chain별 순서", columns: securityColumns, majorSectionAfter: true },
        { id: "security-checks", label: "SECURITY CHECKS", columns: securityChecksColumns, majorSectionAfter: true },
        { id: "endpoint", label: "API Endpoint · 매핑 정보", columns: endpointColumns, majorSectionAfter: true },
        { id: "handler", label: "Controller · Handler", columns: handlerColumns }
      ].map((lane, index, all) => Object.freeze({ ...lane,
        column: all.slice(0, index).reduce((sum, previous) => sum + previous.columns, 0) }));
    }
    const servletStart = requestColumns;
    const delegationStart = servletStart + servletColumns;
    const chainStart = delegationStart + 3;
    const securityStart = chainStart + 1;
    const securityChecksStart = securityStart + securityColumns;
    const mvcStart = securityChecksStart + securityChecksColumns;
    const mappingStart = mvcStart + 2;
    const endpointStart = mappingStart + 2;
    const handlerStart = endpointStart + endpointColumns;
    return [
      { id: "request", label: "HTTP 요청 · 학습 흐름", column: 0, columns: requestColumns },
      { id: "servlet-filter", label: "Servlet Filter · 등록 관계", column: servletStart, columns: servletColumns },
      { id: "security-delegation", label: "Spring Security 위임", column: delegationStart, columns: 3 },
      { id: "security-chain", label: "첫 매칭 SecurityFilterChain", column: chainStart, columns: 1 },
      { id: "security-filter", label: "Security Filter · Chain별 순서", column: securityStart, columns: securityColumns,
        majorSectionAfter: true },
      { id: "security-checks", label: "SECURITY CHECKS", column: securityChecksStart, columns: securityChecksColumns,
        majorSectionAfter: true },
      { id: "mvc", label: "DispatcherServlet · MVC", column: mvcStart, columns: 2 },
      { id: "mvc-mapping", label: "HandlerMapping · HandlerAdapter", column: mappingStart, columns: 2 },
      { id: "endpoint", label: "API Endpoint · 매핑 정보", column: endpointStart, columns: endpointColumns,
        majorSectionAfter: true },
      { id: "handler", label: "Controller · Handler", column: handlerStart, columns: handlerColumns }
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

  function securityDataSemantic(rawAttributes) {
    const data = rawAttributes || {};
    const operation = text(data.operation).toUpperCase();
    const apiType = text(data.apiType).toUpperCase();
    const sourceKind = text(data.sourceKind).toUpperCase();
    const observationKind = text(data.observationKind).toUpperCase();
    const dataKind = text(data.dataKind).toUpperCase();
    const securityKind = text(data.securityKind).toUpperCase();
    const apiName = text(data.apiName).toLowerCase();
    const detail = data.claimName ? `Claim ${text(data.claimName)}`
      : text(data.headerName || data.attributeName || data.principalType || data.mappingKind || data.apiName || data.apiOwner);
    const result = (kind, action, primary, fallbackDetail = "") => ({
      key: `${kind}:${action}`,
      kind,
      operation: action,
      primary,
      detail: detail || fallbackDetail
    });

    // 수집기가 기록한 동작을 데이터 출처보다 우선 판정
    if (operation === "AUTH_STATUS" || observationKind === "AUTHENTICATION_STATUS") {
      return result("AUTH_STATUS", "AUTH_STATUS", "인증 상태 확인", "인증 상태 API");
    }

    const authorityMapping = observationKind === "AUTHORITY_MAPPING" || Boolean(data.mappingKind);
    const principalUsage = !authorityMapping && (apiType === "PRINCIPAL" || dataKind === "PRINCIPAL"
      || Boolean(data.principalType) || ["PRINCIPAL_LOOKUP", "PRINCIPAL_NAME", "SUBJECT_LOOKUP"]
        .includes(observationKind));
    if (principalUsage) {
      const action = operation === "DECLARE" || operation === "READ" ? operation : "UNKNOWN";
      return result("PRINCIPAL", action, action === "DECLARE" ? "Principal 선언"
        : action === "READ" ? "Principal 조회" : "Principal 정보 확인 필요", "Principal");
    }

    const authorityUsage = authorityMapping || apiType === "AUTHORITY" || dataKind === "AUTHORITY";
    if (authorityUsage) {
      const action = operation === "CREATE" || operation === "WRITE" ? "CREATE"
        : operation === "READ" ? "READ" : operation === "CONVERT" ? "CONVERT" : "UNKNOWN";
      const primary = action === "CREATE" ? "권한 생성" : action === "READ" ? "권한 정보 조회"
        : action === "CONVERT" ? "권한 변환" : "권한 정보 확인 필요";
      return result("AUTHORITY", action, primary, "권한 정보");
    }

    const jwtUsage = ["JWT", "JWT_CLAIM", "JWT_SUBJECT"].includes(dataKind)
      || ["JWT", "JWT_SUBJECT"].includes(sourceKind) || securityKind === "JWT" || JWT_SECURITY_API_TYPES.has(apiType);
    if (jwtUsage) {
      const claimUsage = dataKind === "JWT_CLAIM" || Boolean(data.claimName) || apiType === "NIMBUS_CLAIMS_BUILDER";
      if (operation === "VERIFY_CONFIGURATION" || text(data.verificationKind).toUpperCase() === "CONFIGURATION") {
        return result("JWT", "VERIFY_CONFIGURATION", "JWT 검증 구성", "검증 구성");
      }
      if (operation === "VERIFY" || text(data.verificationKind).toUpperCase() === "INVOCATION") {
        return result("JWT", "VERIFY", "JWT 검증", "검증 호출");
      }
      if (operation === "SIGN") return result("JWT", "SIGN", "JWT 서명", "서명");
      if (operation === "WRITE") return result("JWT_CLAIM", "WRITE", "JWT Claim 작성", "Claim");
      if (operation === "READ") return claimUsage
        ? result("JWT_CLAIM", "READ", "JWT Claim 조회", "Claim")
        : result("JWT", "READ", "JWT 정보 조회");
      return result(claimUsage ? "JWT_CLAIM" : "JWT", "UNKNOWN", "JWT 정보 확인 필요", "동작 확인 필요");
    }

    const sessionUsage = dataKind === "SESSION_STATE" || ["SESSION", "HTTP_SESSION"].includes(sourceKind)
      || apiType === "SESSION" || observationKind.startsWith("SESSION_");
    if (sessionUsage) {
      const actions = {
        ACQUIRE: ["ACQUIRE", "Session 획득"], READ: ["READ", "Session 정보 조회"],
        WRITE: ["WRITE", "Session 정보 작성"], REMOVE: ["REMOVE", "Session 정보 삭제"],
        INVALIDATE: ["INVALIDATE", "Session 무효화"]
      };
      const [action, primary] = actions[operation] || ["UNKNOWN", "Session 정보 확인 필요"];
      return result("SESSION", action, primary, "Session");
    }

    const headerUsage = dataKind === "HEADER" || ["HEADER", "REQUEST_HEADER"].includes(sourceKind)
      || apiType === "HEADER" || observationKind === "HEADER_LOOKUP"
      || (["SERVLET_REQUEST", "HTTP_SERVLET_REQUEST"].includes(apiType) && apiName === "getheader");
    if (headerUsage) return result("HEADER", operation === "READ" ? "READ" : "UNKNOWN",
      operation === "READ" ? "Request Header 조회" : "Request Header 정보 확인 필요", "Header");

    if (data.authData === "SECURITY_CONTEXT_AUTHENTICATION" || dataKind === "SECURITY_CONTEXT"
      || sourceKind === "SECURITY_CONTEXT" || apiType === "SECURITY_CONTEXT") {
      return result("SECURITY_CONTEXT", operation || "USE", "SecurityContext 인증정보 사용", "인증정보");
    }
    if (sourceKind === "AUTHENTICATION" || apiType === "SPRING_AUTHENTICATION") {
      return result("AUTHENTICATION", operation || "UNKNOWN", "인증 정보 확인", "인증 구성");
    }
    if (["SERVLET_REQUEST", "HTTP_SERVLET_REQUEST"].includes(sourceKind) || apiType === "SERVLET_REQUEST") {
      return result("REQUEST", operation === "READ" ? "READ" : "UNKNOWN",
        operation === "READ" ? "요청 정보 조회" : "요청 정보 확인 필요", "요청 정보");
    }
    const unknownType = text(data.dataKind || data.securityKind || data.sourceKind || data.apiType || "UNKNOWN");
    return result(`UNKNOWN:${unknownType}`, operation || "UNKNOWN", "보안 정보 확인 필요", "동작 확인 필요");
  }

  function authorizationSemantic(rawAttributes) {
    const data = rawAttributes || {};
    const source = text(data.policySource).toUpperCase();
    const factType = text(data.factType).toUpperCase();
    const policyKind = text(data.policyKind || data.requirementKind).toUpperCase();
    const authority = text(data.requiredAuthority);
    const detailParts = [];
    const result = (key, primary, detail) => ({ key, kind: "AUTHORIZATION", primary, detail });

    if (factType === "OBJECT_AUTHORIZATION_REQUIREMENT") {
      return result("OBJECT:REQUIREMENT", "객체 인가 요구",
        [text(data.resourceType), text(data.requirementKind), authority].filter(Boolean).join(" · ") || "객체 인가 조건");
    }
    if (factType === "OBJECT_ACCESS_PATH") {
      return result("OBJECT:ACCESS_PATH", "객체 접근 경로",
        [text(data.resourceType), text(data.pathOutcome), text(data.coverage)].filter(Boolean).join(" · ") || "접근 경로 근거");
    }
    if (factType.startsWith("OBJECT_") && (data.checkKind || data.pathOutcome || data.coverage)) {
      return result("OBJECT:VALIDATION", "객체 인가 근거",
        [text(data.checkKind), text(data.pathOutcome), text(data.coverage)].filter(Boolean).join(" · "));
    }

    let resolvedPolicy = policyKind;
    if (!resolvedPolicy && authority) resolvedPolicy = "AUTHORITY_REQUIRED";
    if (resolvedPolicy === "AUTHORITY" && authority) resolvedPolicy = "AUTHORITY_REQUIRED";
    const knownPolicyKinds = ["PERMIT_ALL", "AUTHENTICATED", "FULLY_AUTHENTICATED", "AUTHORITY_REQUIRED",
      "COMPOSITE_AUTHORITY", "DENY_ALL"];
    if (source === "URL" && knownPolicyKinds
      .includes(resolvedPolicy)) {
      const labels = {
        PERMIT_ALL: "공개 접근 허용", AUTHENTICATED: "인증 필요",
        FULLY_AUTHENTICATED: "완전 인증 필요",
        AUTHORITY_REQUIRED: authority ? `${authority} 권한 필요` : "권한 필요",
        COMPOSITE_AUTHORITY: "복합 권한 필요", DENY_ALL: "접근 차단"
      };
      detailParts.push("URL 정책");
      const matcher = text(data.policyMatcherCondition || data.matcherCondition);
      if (matcher) detailParts.push(`조건 ${matcher}`);
      if (data.policyOrder) detailParts.push(`순서 ${data.policyOrder}`);
      if (data.httpMethod) detailParts.push(`HTTP ${data.httpMethod}`);
      return result(`URL:${resolvedPolicy}`, labels[resolvedPolicy], detailParts.join(" · "));
    }

    if (source === "METHOD" || data.annotationType || data.declarationKind) {
      if (data.pathOutcome || data.checkKind || data.coverage) {
        return result("METHOD:VALIDATION", "메서드 인가 검증 근거",
          [text(data.annotationType), text(data.checkKind), text(data.pathOutcome), text(data.coverage)]
            .filter(Boolean).join(" · "));
      }
      return result("METHOD:DECLARATION", "메서드 인가 선언",
        [text(data.annotationType), text(data.declarationKind), text(data.expressionKind), authority]
          .filter(Boolean).join(" · ") || "인가 선언");
    }

    if (knownPolicyKinds.includes(resolvedPolicy)) {
      const labels = {
        PERMIT_ALL: "공개 접근 허용", AUTHENTICATED: "인증 필요",
        FULLY_AUTHENTICATED: "완전 인증 필요",
        AUTHORITY_REQUIRED: authority ? `${authority} 권한 필요` : "권한 필요",
        COMPOSITE_AUTHORITY: "복합 권한 필요", DENY_ALL: "접근 차단"
      };
      return result(`POLICY:${resolvedPolicy}`, labels[resolvedPolicy],
        [text(data.policySource) || "인가 정책", text(data.policyMatcherCondition || data.matcherCondition),
          text(data.policyOrder) ? `순서 ${data.policyOrder}` : "", text(data.httpMethod) ? `HTTP ${data.httpMethod}` : ""]
          .filter(Boolean).join(" · "));
    }

    const unresolvedScope = [source || "UNKNOWN", factType, text(data.checkKind),
      text(data.expressionKind), text(data.annotationType), authority].filter(Boolean).join(":");
    return result(`UNKNOWN:${unresolvedScope}`, "인가 조건 미확정",
      [source, factType, text(data.checkKind), text(data.expressionKind)].filter(Boolean).join(" · ")
        || "분석 근거 확인 필요");
  }

  function supportDisplaySemantic(node) {
    if (!node) return { key: "UNKNOWN", kind: "UNKNOWN", primary: "보안 정보 확인 필요", detail: "원본 확인 필요" };
    if (node.type === "SECURITY_DATA") return securityDataSemantic(attributes(node));
    if (node.type === "AUTHORIZATION") return authorizationSemantic(attributes(node));
    return { key: node.type, kind: node.type, primary: "보안 근거", detail: "원본 확인 필요" };
  }

  function securityDataSemanticKey(rawAttributes) {
    return securityDataSemantic(rawAttributes).key;
  }

  function supportDisplayScope(node) {
    if (!node) return "";
    if (node.type === "SECURITY_DATA") return securityDataSemanticKey(attributes(node));
    return node.type === "AUTHORIZATION" ? supportDisplaySemantic(node).key : "";
  }

  function supportDisplayGroupKey(node, rowId) {
    return JSON.stringify([node.type, rowId, supportDisplayScope(node)]);
  }

  function securityCheckDisplayGroups(row) {
    return row.securityEntries || [];
  }

  function controllerFqcn(handler) {
    const value = text(attributes(handler).handler).trim();
    const hashIndex = value.indexOf("#");
    return hashIndex > 0 ? value.slice(0, hashIndex).trim() : "";
  }

  function handlerDisplayItemCount(handlerIds, nodeById) {
    const keys = new Set();
    handlerIds.forEach((id) => {
      const owner = controllerFqcn(nodeById.get(id));
      keys.add(owner ? `controller:${owner}` : `handler:${id}`);
    });
    return keys.size;
  }

  function gridPosition(lane, index, columns, baseY, staggerSecondColumn = false) {
    const columnCount = Math.max(1, columns);
    const column = index % columnCount;
    return {
      x: lane.x + column * COLUMN_STEP,
      y: baseY + Math.floor(index / columnCount) * ROW_STEP
        + (staggerSecondColumn && columnCount === 2 && column === 1 ? SECOND_COLUMN_OFFSET : 0)
    };
  }

  function gridRequiredHeight(count, columns, staggerSecondColumn = false) {
    let bottom = 0;
    for (let index = 0; index < count; index += 1) {
      const position = gridPosition({ x: 0 }, index, columns, 0, staggerSecondColumn);
      bottom = Math.max(bottom, position.y + NODE_HEIGHT);
    }
    return bottom;
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
      nextX += positioned.width + (lane.majorSectionAfter ? MAJOR_SECTION_GAP : SECTION_GAP);
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
    if (["AUTHENTICATION", "AUTHORIZATION", "SECURITY_DATA", "BUSINESS_SECURITY_STATE"].includes(node.type)) {
      return "security-checks";
    }
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

  function confirmedEndpointChains(graph, flowIndex) {
    if (flowIndex && typeof flowIndex.firstMatchedChain === "function") {
      return new Map(graph.nodes.filter((node) => node.type === "ENDPOINT").flatMap((endpoint) => {
        const result = flowIndex.firstMatchedChain(endpoint.id);
        return result.status === "CONFIRMED" && result.chain ? [[endpoint.id, result.chain]] : [];
      }));
    }
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

  function confirmedEndpointHandlers(graph, flowIndex) {
    if (flowIndex && typeof flowIndex.handlerFor === "function") {
      return new Map(graph.nodes.filter((node) => node.type === "ENDPOINT").flatMap((endpoint) => {
        const result = flowIndex.handlerFor(endpoint.id);
        return result.status === "CONFIRMED" && result.node ? [[endpoint.id, result.node]] : [];
      }));
    }
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

  function routeGeometry(route) {
    if (!route || typeof route !== "object") return { points: [], segments: [], bounds: null };
    const cached = routeGeometryCache.get(route);
    if (cached) return cached;
    const section = route.sections && route.sections[0];
    const points = section ? [section.startPoint, ...(section.bendPoints || []), section.endPoint].filter(Boolean) : [];
    const segments = points.slice(1).map((point, index) => ({ start: points[index], end: point }));
    const bounds = points.length ? {
      left: Math.min(...points.map((point) => point.x)),
      right: Math.max(...points.map((point) => point.x)),
      top: Math.min(...points.map((point) => point.y)),
      bottom: Math.max(...points.map((point) => point.y))
    } : null;
    const geometry = { points, segments, bounds };
    routeGeometryCache.set(route, geometry);
    return geometry;
  }

  function routePoints(route) { return routeGeometry(route).points; }
  function routeSegments(route) { return routeGeometry(route).segments; }

  function segmentCongestionCost(start, end, existingSegments) {
    let cost = 0;
    const vertical = start.x === end.x;
    const horizontal = start.y === end.y;
    for (const segment of existingSegments) {
      if (Math.max(start.x, end.x) < Math.min(segment.start.x, segment.end.x) - ROUTE_CORRIDOR_CLEARANCE
        || Math.min(start.x, end.x) > Math.max(segment.start.x, segment.end.x) + ROUTE_CORRIDOR_CLEARANCE
        || Math.max(start.y, end.y) < Math.min(segment.start.y, segment.end.y) - ROUTE_CORRIDOR_CLEARANCE
        || Math.min(start.y, end.y) > Math.max(segment.start.y, segment.end.y) + ROUTE_CORRIDOR_CLEARANCE) continue;
      const otherVertical = segment.start.x === segment.end.x;
      const otherHorizontal = segment.start.y === segment.end.y;
      if (vertical && otherVertical) {
        const overlap = Math.min(Math.max(start.y, end.y), Math.max(segment.start.y, segment.end.y))
          - Math.max(Math.min(start.y, end.y), Math.min(segment.start.y, segment.end.y));
        const gap = Math.abs(start.x - segment.start.x);
        if (overlap > 0 && gap < ROUTE_CORRIDOR_CLEARANCE) {
          cost += gap === 0 ? 140 + overlap * 1.5 : overlap * (ROUTE_CORRIDOR_CLEARANCE - gap) * .5;
        }
        continue;
      }
      if (horizontal && otherHorizontal) {
        const overlap = Math.min(Math.max(start.x, end.x), Math.max(segment.start.x, segment.end.x))
          - Math.max(Math.min(start.x, end.x), Math.min(segment.start.x, segment.end.x));
        const gap = Math.abs(start.y - segment.start.y);
        if (overlap > 0 && gap < ROUTE_CORRIDOR_CLEARANCE) {
          cost += gap === 0 ? 140 + overlap * 1.5 : overlap * (ROUTE_CORRIDOR_CLEARANCE - gap) * .5;
        }
        continue;
      }
      if (!vertical && !horizontal || !otherVertical && !otherHorizontal) continue;
      const verticalSegment = vertical ? { start, end } : segment;
      const horizontalSegment = horizontal ? { start, end } : segment;
      const crossX = verticalSegment.start.x;
      const crossY = horizontalSegment.start.y;
      const verticalMin = Math.min(verticalSegment.start.y, verticalSegment.end.y);
      const verticalMax = Math.max(verticalSegment.start.y, verticalSegment.end.y);
      const horizontalMin = Math.min(horizontalSegment.start.x, horizontalSegment.end.x);
      const horizontalMax = Math.max(horizontalSegment.start.x, horizontalSegment.end.x);
      if (crossY > verticalMin && crossY < verticalMax && crossX > horizontalMin && crossX < horizontalMax) cost += 90;
    }
    return cost;
  }

  function routeCongestionCost(route, existingRoutes) {
    const geometry = routeGeometry(route);
    const points = geometry.points;
    const start = points[0];
    const end = points[points.length - 1];
    if (!start || !end || !existingRoutes || existingRoutes.length === 0) return 0;
    let cost = 0;
    for (const existing of existingRoutes) {
      const existingGeometry = routeGeometry(existing);
      if (!existingGeometry.bounds || geometry.bounds.right < existingGeometry.bounds.left - ROUTE_CORRIDOR_CLEARANCE
        || geometry.bounds.left > existingGeometry.bounds.right + ROUTE_CORRIDOR_CLEARANCE
        || geometry.bounds.bottom < existingGeometry.bounds.top - ROUTE_CORRIDOR_CLEARANCE
        || geometry.bounds.top > existingGeometry.bounds.bottom + ROUTE_CORRIDOR_CLEARANCE) continue;
      const existingPoints = existingGeometry.points;
      const existingStart = existingPoints[0];
      const existingEnd = existingPoints[existingPoints.length - 1];
      if (existingStart && existingEnd
        && ((start.x === existingStart.x && start.y === existingStart.y && end.x === existingEnd.x && end.y === existingEnd.y)
          || (start.x === existingEnd.x && start.y === existingEnd.y && end.x === existingStart.x && end.y === existingStart.y))) continue;
      cost += segmentCongestionCostForRoute(route, routeSegments(existing));
    }
    return cost;
  }

  function segmentCongestionCostForRoute(route, existingSegments) {
    return routeSegments(route).reduce((cost, segment) => cost
      + segmentCongestionCost(segment.start, segment.end, existingSegments), 0);
  }

  function collinearOverlapLength(left, right) {
    const leftHorizontal = left.start.y === left.end.y;
    const rightHorizontal = right.start.y === right.end.y;
    if (leftHorizontal && rightHorizontal && left.start.y === right.start.y) {
      return Math.max(0, Math.min(Math.max(left.start.x, left.end.x), Math.max(right.start.x, right.end.x))
        - Math.max(Math.min(left.start.x, left.end.x), Math.min(right.start.x, right.end.x)));
    }
    if (!leftHorizontal && !rightHorizontal && left.start.x === right.start.x) {
      return Math.max(0, Math.min(Math.max(left.start.y, left.end.y), Math.max(right.start.y, right.end.y))
        - Math.max(Math.min(left.start.y, left.end.y), Math.min(right.start.y, right.end.y)));
    }
    return 0;
  }

  function routeCost(route, existingRoutes) {
    const points = routePoints(route);
    const length = points.slice(1).reduce((sum, point, index) => sum
      + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0);
    return length + Math.max(0, points.length - 2) * 40 + routeCongestionCost(route, existingRoutes);
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
    const width = finite(nodePosition.width) && nodePosition.width > 0 ? nodePosition.width : NODE_WIDTH;
    const height = finite(nodePosition.height) && nodePosition.height > 0 ? nodePosition.height : NODE_HEIGHT;
    return segmentIntersectsNode(start, end, expanded || {
      x: nodePosition.x - margin,
      y: nodePosition.y - margin,
      width: width + margin * 2,
      height: height + margin * 2
    });
  }

  function clearRouteSegment(start, end, obstacles) {
    for (const obstacle of obstacles) {
      if (segmentIntersectsExpandedNode(start, end, obstacle.position, NODE_SAFE_MARGIN, obstacle.expanded)) return false;
    }
    return true;
  }

  function routeAroundNodes(source, target, sourceId, targetId, positions, existingRoutes = []) {
    const forward = target.x >= source.x;
    const sourceWidth = finite(source.width) && source.width > 0 ? source.width : NODE_WIDTH;
    const targetWidth = finite(target.width) && target.width > 0 ? target.width : NODE_WIDTH;
    const sourceHeight = finite(source.height) && source.height > 0 ? source.height : NODE_HEIGHT;
    const targetHeight = finite(target.height) && target.height > 0 ? target.height : NODE_HEIGHT;
    const start = {
      x: source.x + (forward ? sourceWidth : 0),
      y: source.y + sourceHeight / 2
    };
    const end = {
      x: target.x + (forward ? 0 : targetWidth),
      y: target.y + targetHeight / 2
    };
    const margin = NODE_SAFE_MARGIN;
    const routeBounds = {
      left: Math.min(start.x, end.x) - NODE_WIDTH - margin * 2,
      right: Math.max(start.x, end.x) + NODE_WIDTH + margin * 2,
      top: Math.min(start.y, end.y) - NODE_HEIGHT - margin * 2,
      bottom: Math.max(start.y, end.y) + NODE_HEIGHT + margin * 2
    };
    const entries = Object.entries(positions).filter(([nodeId, position]) => {
      const width = finite(position.width) && position.width > 0 ? position.width : NODE_WIDTH;
      const height = finite(position.height) && position.height > 0 ? position.height : NODE_HEIGHT;
      return nodeId !== sourceId && nodeId !== targetId
        && position.x < routeBounds.right && position.x + width > routeBounds.left
        && position.y < routeBounds.bottom && position.y + height > routeBounds.top;
    });
    const obstacles = entries.map(([, position]) => {
      const width = finite(position.width) && position.width > 0 ? position.width : NODE_WIDTH;
      const height = finite(position.height) && position.height > 0 ? position.height : NODE_HEIGHT;
      return { position, expanded: {
        x: position.x - margin, y: position.y - margin,
        width: width + margin * 2, height: height + margin * 2
      } };
    });
    const xValues = new Set([start.x, end.x]);
    const yValues = new Set([start.y, end.y]);
    entries.forEach(([, position]) => {
      const width = finite(position.width) && position.width > 0 ? position.width : NODE_WIDTH;
      const height = finite(position.height) && position.height > 0 ? position.height : NODE_HEIGHT;
      xValues.add(position.x - margin);
      xValues.add(position.x + width + margin);
      yValues.add(position.y - margin);
      yValues.add(position.y + height + margin);
    });
    const allX = entries.flatMap(([, position]) => [position.x,
      position.x + (finite(position.width) && position.width > 0 ? position.width : NODE_WIDTH)]);
    const allY = entries.flatMap(([, position]) => [position.y,
      position.y + (finite(position.height) && position.height > 0 ? position.height : NODE_HEIGHT)]);
    if (allX.length > 0) {
      xValues.add(Math.min(start.x, end.x, ...allX) - margin * 2);
      xValues.add(Math.max(start.x, end.x, ...allX) + margin * 2);
    }
    if (allY.length > 0) {
      yValues.add(Math.min(start.y, end.y, ...allY) - margin * 2);
      yValues.add(Math.max(start.y, end.y, ...allY) + margin * 2);
    }
    const sameEndpoints = (points) => points.length > 1 && (
      points[0].x === start.x && points[0].y === start.y && points[points.length - 1].x === end.x && points[points.length - 1].y === end.y
      || points[0].x === end.x && points[0].y === end.y && points[points.length - 1].x === start.x && points[points.length - 1].y === start.y);
    const existingSegments = existingRoutes.flatMap((route) => {
      const points = routePoints(route);
      return sameEndpoints(points) ? [] : routeSegments(route);
    }).filter((segment) => Math.max(segment.start.x, segment.end.x) >= routeBounds.left - ROUTE_CORRIDOR_CLEARANCE
      && Math.min(segment.start.x, segment.end.x) <= routeBounds.right + ROUTE_CORRIDOR_CLEARANCE
      && Math.max(segment.start.y, segment.end.y) >= routeBounds.top - ROUTE_CORRIDOR_CLEARANCE
      && Math.min(segment.start.y, segment.end.y) <= routeBounds.bottom + ROUTE_CORRIDOR_CLEARANCE);
    const spacedCoordinates = (candidates, low, high, center) => Array.from(new Set(candidates))
      .filter((value) => value > low && value < high)
      .sort((left, right) => Math.abs(left - center) - Math.abs(right - center) || left - right)
      .slice(0, 10);
    const corridorX = existingSegments.filter((segment) => segment.start.x === segment.end.x)
      .flatMap((segment) => [segment.start.x - ROUTE_CORRIDOR_CLEARANCE, segment.start.x + ROUTE_CORRIDOR_CLEARANCE]);
    const corridorY = existingSegments.filter((segment) => segment.start.y === segment.end.y)
      .flatMap((segment) => [segment.start.y - ROUTE_CORRIDOR_CLEARANCE, segment.start.y + ROUTE_CORRIDOR_CLEARANCE]);
    if (existingSegments.length <= 12) {
      spacedCoordinates(corridorX, routeBounds.left, routeBounds.right, (start.x + end.x) / 2).forEach((x) => xValues.add(x));
      spacedCoordinates(corridorY, routeBounds.top, routeBounds.bottom, (start.y + end.y) / 2).forEach((y) => yValues.add(y));
    }
    const xs = Array.from(xValues).filter((value) => value >= routeBounds.left && value <= routeBounds.right)
      .sort((left, right) => left - right);
    const ys = Array.from(yValues).filter((value) => value >= routeBounds.top && value <= routeBounds.bottom)
      .sort((left, right) => left - right);
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
        const nextCost = currentState.cost + distance(current, next) + bendCost
          + segmentCongestionCost(current, next, existingSegments);
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
    if (!positions || !sourceNode || !targetNode) return route;
    const existingRoutes = routeBoundary.existingRoutes || [];
    const intersectsNode = routeIntersectsAnyNode(route, sourceNode.id, targetNode.id, positions);
    if (intersectsNode) {
      return routeAroundNodes(source, target, sourceNode.id, targetNode.id, positions, existingRoutes) || route;
    }
    if (routeCongestionCost(route, existingRoutes) < ROUTE_REPLAN_COST) return route;
    const points = routePoints(route);
    let bestRoute = route;
    let bestCost = routeCost(route, existingRoutes);
    for (let index = 1; index < points.length - 2; index += 1) {
      const first = points[index];
      const second = points[index + 1];
      const axis = first.y === second.y ? "y" : first.x === second.x ? "x" : null;
      if (!axis) continue;
      for (const offset of [ROUTE_CORRIDOR_CLEARANCE, -ROUTE_CORRIDOR_CLEARANCE,
        ROUTE_CORRIDOR_CLEARANCE * 2, -ROUTE_CORRIDOR_CLEARANCE * 2]) {
        const shifted = points.map((point) => ({ x: point.x, y: point.y }));
        shifted[index][axis] += offset;
        shifted[index + 1][axis] += offset;
        const candidate = routeFromPoints(shifted);
        if (routeIntersectsAnyNode(candidate, sourceNode.id, targetNode.id, positions)) continue;
        const candidateCost = routeCost(candidate, existingRoutes);
        if (candidateCost < bestCost) {
          bestRoute = candidate;
          bestCost = candidateCost;
        }
      }
    }
    return bestRoute;
  }

  function routeIntersectsNodeMargin(route, sourceId, targetId, positions) {
    const points = routePoints(route);
    for (const [nodeId, position] of Object.entries(positions || {})) {
      if (nodeId === sourceId || nodeId === targetId) continue;
      for (let index = 1; index < points.length; index += 1) {
        if (segmentIntersectsExpandedNode(points[index - 1], points[index], position)) return true;
      }
    }
    return false;
  }

  // 동일 출발점·관계 유형·기술 영역의 근접 도착지만 안전할 때 공통 배선으로 묶음
  function buildCommonEdgeRoutes(graph, positions, routes,
    { nodeToDisplay, chainGroups, endpointChains, hiddenGroups, commonFirst = false, portsFromBounds = false, reservedRoutes = [], fallbacks = [] }) {
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const chainByNode = new Map();
    (chainGroups || []).forEach((group) => (group.nodeIds || []).forEach((id) => chainByNode.set(id, group.id)));
    (endpointChains || new Map()).forEach((chain, id) => chainByNode.set(id, chain.id));
    const hiddenGroupByNode = new Map();
    (hiddenGroups || []).forEach((group) => Object.values(group.members || {}).flat()
      .forEach((id) => hiddenGroupByNode.set(id, group.id)));
    const viewId = (id) => nodeToDisplay && nodeToDisplay[id] || id;
    const recordFallback = (candidate, reason) => {
      fallbacks.push({ type: candidate.type, edgeIds: candidate.edges.map(({ edge }) => edge.id), reason });
    };
    const sourceRoutes = { ...routes };
    const candidates = new Map();
    graph.edges.forEach((edge) => {
      const sourceId = viewId(edge.sourceId);
      const targetId = viewId(edge.targetId);
      const source = nodeById.get(edge.sourceId);
      const target = nodeById.get(edge.targetId);
      if (edge.type === "FILTERED_BY" && source && source.type === "SECURITY_CHAIN") return;
      const sourcePosition = positions[sourceId];
      const targetPosition = positions[targetId];
      const directionFromBounds = sourcePosition && targetPosition
        ? Math.sign(targetPosition.x - sourcePosition.x) : 0;
      const points = portsFromBounds && directionFromBounds ? [
        { x: sourcePosition.x + (directionFromBounds > 0 ? sourcePosition.width || NODE_WIDTH : 0),
          y: sourcePosition.y + (sourcePosition.height || NODE_HEIGHT) / 2 },
        { x: targetPosition.x + (directionFromBounds < 0 ? targetPosition.width || NODE_WIDTH : 0),
          y: targetPosition.y + (targetPosition.height || NODE_HEIGHT) / 2 }
      ] : routePoints(sourceRoutes[edge.id]);
      const start = points[0];
      const end = points.at(-1);
      if (!source || !target || !positions[sourceId] || !positions[targetId] || !start || !end || sourceId === targetId) return;
      const direction = Math.sign(end.x - start.x);
      if (!direction) return;
      const sourceChain = hiddenGroupByNode.get(edge.sourceId) || chainByNode.get(edge.sourceId) || "";
      const targetChain = hiddenGroupByNode.get(edge.targetId) || chainByNode.get(edge.targetId) || "";
      const sourceArea = laneForNode(source);
      const targetArea = laneForNode(target);
      const key = JSON.stringify([sourceArea, targetArea, edge.type, sourceChain, targetChain, direction]);
      const group = candidates.get(key) || { key, sourceArea, targetArea, sourceChain, targetChain,
        type: edge.type, direction, edges: [] };
      group.edges.push({ edge, sourceId, targetId, start, end });
      candidates.set(key, group);
    });

    const accepted = [];
    const acceptedEdgeIds = new Set();
    const acceptedCommonRoutes = [];
    const acceptedBranchRoutes = [];
    const workCandidates = [];
    Array.from(candidates.values()).sort((left, right) => left.key.localeCompare(right.key)).forEach((candidate) => {
      const sources = new Map();
      candidate.edges.forEach((item) => {
        const bucket = sources.get(item.sourceId) || [];
        bucket.push(item);
        sources.set(item.sourceId, bucket);
      });
      const targetViewIds = new Set(candidate.edges.map(({ targetId }) => targetId));
      const distinctPairs = new Set(candidate.edges.map(({ sourceId, targetId }) => `${sourceId}\u0000${targetId}`));
      const completeManyToMany = sources.size > 1 && targetViewIds.size > 1
        && distinctPairs.size === sources.size * targetViewIds.size;
      if (sources.size > 1 && Array.from(sources.values()).some((items) => items.length > 1) && !completeManyToMany) {
        Array.from(sources.entries()).sort(([left], [right]) => left.localeCompare(right)).forEach(([sourceId, edges]) => {
          if (edges.length > 1) workCandidates.push({ ...candidate, key: `${candidate.key}:${sourceId}`, edges });
        });
        return;
      }
      workCandidates.push(candidate);
    });

    workCandidates.sort((left, right) => left.key.localeCompare(right.key)).forEach((candidate) => {
      candidate.edges.sort((left, right) => left.edge.id.localeCompare(right.edge.id));
      const sourceViewIds = new Set(candidate.edges.map(({ sourceId }) => sourceId));
      const targetIds = new Set(candidate.edges.map((item) => item.targetId));
      if (candidate.edges.length < 2 || (sourceViewIds.size < 2 && targetIds.size < 2)) return;
      if (sourceViewIds.size > 1 && targetIds.size > 1) {
        const relationPairs = new Set(candidate.edges.map(({ sourceId, targetId }) => `${sourceId}\u0000${targetId}`));
        if (relationPairs.size !== sourceViewIds.size * targetIds.size) {
          recordFallback(candidate, "incomplete-relation-set");
          return;
        }
      }
      const starts = candidate.edges.map(({ start }) => start);
      const endXs = candidate.edges.map(({ end }) => end.x);
      const endYs = candidate.edges.map(({ end }) => end.y);
      const sourceYs = starts.map((point) => point.y);
      const sourceBusById = new Map(candidate.edges.map(({ sourceId, start }) =>
        [sourceId, start.x + candidate.direction * (NODE_SAFE_MARGIN + 1)]));
      const sourceBusXs = Array.from(new Set(sourceBusById.values()));
      const sourceBusX = candidate.direction > 0 ? Math.min(...sourceBusXs) : Math.max(...sourceBusXs);
      const sourceRowsByBus = new Map();
      candidate.edges.forEach(({ sourceId, start }) => {
        const busX = sourceBusById.get(sourceId);
        const rows = sourceRowsByBus.get(busX) || [];
        rows.push(start.y);
        sourceRowsByBus.set(busX, rows);
      });
      const nearestEndX = candidate.direction > 0 ? Math.min(...endXs) : Math.max(...endXs);
      const horizontalDistance = Math.abs(nearestEndX - sourceBusX);
      const branchDistance = NODE_SAFE_MARGIN + 1;
      if (horizontalDistance <= 0 || branchDistance / horizontalDistance > 0.3
        || horizontalDistance - branchDistance < NODE_SAFE_MARGIN * 2) {
        recordFallback(candidate, "corridor-too-short");
        return;
      }
      const junctionX = nearestEndX - candidate.direction * branchDistance;
      const manySourcesOneTarget = sourceViewIds.size > 1 && targetIds.size === 1;

      const midpointY = [...sourceYs, ...endYs].sort((left, right) => left - right)
        [Math.floor((sourceYs.length + endYs.length - 1) / 2)];
      const corridorLeft = Math.min(sourceBusX, nearestEndX);
      const corridorRight = Math.max(sourceBusX, nearestEndX);
      const corridorYs = Object.values(positions).filter((position) => {
        const width = finite(position.width) && position.width > 0 ? position.width : NODE_WIDTH;
        return position.x - NODE_SAFE_MARGIN < corridorRight
          && position.x + width + NODE_SAFE_MARGIN > corridorLeft;
      }).flatMap((position) => {
        const height = finite(position.height) && position.height > 0 ? position.height : NODE_HEIGHT;
        return [position.y - NODE_SAFE_MARGIN - 1, position.y + height + NODE_SAFE_MARGIN + 1];
      });
      const trunkYs = Array.from(new Set([...sourceYs, ...endYs, ...corridorYs]))
        .sort((left, right) => Math.abs(left - midpointY) - Math.abs(right - midpointY) || left - right);
      const memberIds = new Set(candidate.edges.map(({ edge }) => edge.id));
      const independentRoutes = commonFirst ? [] : graph.edges.filter((edge) => !memberIds.has(edge.id)
        && !acceptedEdgeIds.has(edge.id) && sourceRoutes[edge.id]).map((edge) => sourceRoutes[edge.id]);
      const externalRoutes = independentRoutes.concat(acceptedCommonRoutes, acceptedBranchRoutes);
      let trunkY = null;
      let fullRoutes = null;
      let branchRoutes = null;
      let commonRoutes = null;
      let bestCongestion = Number.POSITIVE_INFINITY;
      let blockedByNode = false;
      let blockedBranch = false;
      for (const candidateY of trunkYs) {
        const nextRoutes = new Map();
        const nextBranches = {};
        const destinationBusYs = new Set([candidateY, ...endYs]);
        const safe = candidate.edges.every(({ edge, sourceId, targetId, start, end }) => {
          const edgeBusX = sourceBusById.get(sourceId);
          const sourceBus = { x: edgeBusX, y: start.y };
          const sourceJoin = { x: edgeBusX, y: candidateY };
          const destinationJoin = { x: junctionX, y: candidateY };
          let branchPoints;
          let fullBranchPoints;
          if (manySourcesOneTarget) {
            branchPoints = [start, sourceBus];
            fullBranchPoints = branchPoints;
          } else {
            const targetPosition = positions[targetId];
            const junctionId = `common-junction:${candidate.key}:${targetId}`;
            const junctionSource = {
              id: junctionId,
              x: candidate.direction > 0 ? junctionX - NODE_WIDTH : junctionX,
              y: candidateY - NODE_HEIGHT / 2,
              width: NODE_WIDTH,
              height: NODE_HEIGHT
            };
            const targetAtPort = { ...targetPosition, y: end.y - NODE_HEIGHT / 2 };
            const branch = routeAroundNodes(junctionSource, targetAtPort, junctionId, targetId,
              positions, externalRoutes);
            if (!branch) {
              blockedBranch = true;
              return false;
            }
            fullBranchPoints = routePoints(branch);
            branchPoints = fullBranchPoints.slice();
            let sharedBusEnd = 1;
            while (sharedBusEnd < branchPoints.length && branchPoints[sharedBusEnd].x === junctionX) {
              sharedBusEnd += 1;
            }
            if (sharedBusEnd > 1) {
              destinationBusYs.add(branchPoints[sharedBusEnd - 1].y);
              branchPoints = branchPoints.slice(sharedBusEnd - 1);
            }
          }
          const route = manySourcesOneTarget
            ? routeFromPoints([start, sourceBus, sourceJoin, destinationJoin, { x: junctionX, y: end.y }, end])
            : routeFromPoints([start, sourceBus, sourceJoin, destinationJoin, ...fullBranchPoints.slice(1)]);
          if (routeIntersectsNodeMargin(route, sourceId, targetId, positions)) {
            blockedByNode = true;
            return false;
          }
          nextRoutes.set(edge.id, route);
          nextBranches[edge.id] = routeFromPoints(branchPoints);
          return true;
        });
        if (!safe) continue;

        // 화면에 그릴 고유 배선만 평가해 공용 Trunk 비용의 Edge 수 반복 합산 방지
        const commonPaths = new Map();
        const addCommonPath = (points) => {
          if (!points || points.length < 2) return;
          const key = points.map((point) => `${point.x}:${point.y}`).join("|");
          if (!commonPaths.has(key)) commonPaths.set(key, routeFromPoints(points));
        };
        Object.values(nextBranches).forEach((route) => addCommonPath(routePoints(route)));
        if (!manySourcesOneTarget) {
          const sourceStubs = new Map(candidate.edges.map(({ sourceId, start }) =>
            [`${start.x}:${start.y}`, { sourceId, start }]));
          sourceStubs.forEach(({ sourceId, start }) => addCommonPath([
            start, { x: sourceBusById.get(sourceId), y: start.y }
          ]));
        }
        const targetTop = Math.min(...destinationBusYs);
        const targetBottom = Math.max(...destinationBusYs);
        sourceRowsByBus.forEach((rows, busX) => {
          const sourceTop = Math.min(candidateY, ...rows);
          const sourceBottom = Math.max(candidateY, ...rows);
          if (sourceBottom > sourceTop) addCommonPath([{ x: busX, y: sourceTop }, { x: busX, y: sourceBottom }]);
        });
        addCommonPath([{ x: sourceBusX, y: candidateY }, { x: junctionX, y: candidateY }]);
        if (targetBottom > targetTop) addCommonPath([{ x: junctionX, y: targetTop }, { x: junctionX, y: targetBottom }]);
        if (manySourcesOneTarget) {
          const end = candidate.edges[0].end;
          addCommonPath([{ x: junctionX, y: end.y }, end]);
        }
        const congestion = Array.from(commonPaths.values()).reduce((cost, route) =>
          cost + routeCongestionCost(route, externalRoutes), 0);
        const length = Array.from(commonPaths.values()).reduce((total, route) => {
          const points = routePoints(route);
          return total + points.slice(1).reduce((sum, point, index) => sum
            + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0);
        }, 0);
        const score = length + congestion * 0.2;
        if (score >= bestCongestion) continue;
        bestCongestion = score;
        trunkY = candidateY;
        fullRoutes = nextRoutes;
        branchRoutes = nextBranches;
        commonRoutes = Array.from(commonPaths.values());
      }
      if (!fullRoutes || trunkY === null) {
        recordFallback(candidate, blockedBranch ? "no-clear-target-branch"
          : blockedByNode ? "blocked-by-node" : "no-clear-trunk-channel");
        return;
      }

      // 승인된 그룹의 Edge만 제외한 나머지 경로 혼잡도 검사
      const sourceBranches = new Map(candidate.edges.map(({ sourceId, start }) =>
        [`${start.x}:${start.y}`, { sourceId, start }]));
      const trunkParts = manySourcesOneTarget ? [] : Array.from(sourceBranches.values()).map((start) =>
        `M ${start.start.x} ${start.start.y} L ${sourceBusById.get(start.sourceId)} ${start.start.y}`);
      sourceRowsByBus.forEach((rows, busX) => {
        const sourceTop = Math.min(trunkY, ...rows);
        const sourceBottom = Math.max(trunkY, ...rows);
        if (sourceBottom > sourceTop) trunkParts.push(`M ${busX} ${sourceTop} L ${busX} ${sourceBottom}`);
      });
      const targetBusYs = Object.values(branchRoutes || {}).flatMap((route) => routePoints(route)
        .filter((point) => point.x === junctionX).map((point) => point.y));
      const targetTop = Math.min(trunkY, ...endYs, ...targetBusYs);
      const targetBottom = Math.max(trunkY, ...endYs, ...targetBusYs);
      trunkParts.push(`M ${sourceBusX} ${trunkY} L ${junctionX} ${trunkY}`);
      if (targetBottom > targetTop) trunkParts.push(`M ${junctionX} ${targetTop} L ${junctionX} ${targetBottom}`);
      if (manySourcesOneTarget) {
        const end = candidate.edges[0].end;
        trunkParts.push(`M ${junctionX} ${end.y} L ${end.x} ${end.y}`);
      }
      const group = {
        id: `common-edge-route-${accepted.length + 1}`,
        sourceId: sourceViewIds.size === 1 ? candidate.edges[0].sourceId : null,
        sourceIds: Array.from(new Set(candidate.edges.map(({ edge }) => edge.sourceId))).sort(),
        sourceArea: candidate.sourceArea,
        targetArea: candidate.targetArea,
        type: candidate.type,
        direction: candidate.direction,
        lane: candidate.targetArea,
        chainId: candidate.targetChain || null,
        edgeIds: candidate.edges.map(({ edge }) => edge.id),
        targetIds: Array.from(targetIds).sort(),
        junction: { x: junctionX, y: trunkY },
        sourceBranchRange: { top: Math.min(...sourceYs), bottom: Math.max(...sourceYs) },
        branchRange: { top: Math.min(...endYs), bottom: Math.max(...endYs) },
        trunk: { d: trunkParts.join(" ") },
        sharedTarget: manySourcesOneTarget,
        branches: branchRoutes
      };
      candidate.edges.forEach(({ edge }) => { routes[edge.id] = fullRoutes.get(edge.id); });
      accepted.push(group);
      memberIds.forEach((id) => acceptedEdgeIds.add(id));
      acceptedCommonRoutes.push(...(commonRoutes || []));
      reservedRoutes.push(...(commonRoutes || []));
      acceptedBranchRoutes.push(...new Map(Object.values(branchRoutes).map((route) => [
        routePoints(route).map((point) => `${point.x}:${point.y}`).join("|"), route
      ])).values());
    });
    return accepted;
  }

  function edgeNodeIntersections(graph, positions, edgeRoutes, obstacleNodes = graph.nodes) {
    let count = 0;
    graph.edges.forEach((edge) => {
      const route = edgeRoutes[edge.id];
      obstacleNodes.forEach((node) => {
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
      .filter((edge) => edge.targetId === node.id && edge.confidence === "CONFIRMED" && SUPPORT_EDGE_TYPES.has(edge.type))
      .map((edge) => graph.nodes.find((candidate) => candidate.id === edge.sourceId))
      .filter((candidate) => candidate && positions[candidate.id])
      .sort((left, right) => {
        const leftPreferred = preferredTypes.has(left.type) ? 0 : 1;
        const rightPreferred = preferredTypes.has(right.type) ? 0 : 1;
        return leftPreferred - rightPreferred || positions[right.id].x - positions[left.id].x || left.id.localeCompare(right.id);
      });
    return candidates[0] || null;
  }

  function buildHiddenConceptualGroups(graph, chains, filtersByChain, endpoints, handlers, supportNodes,
    endpointChains, endpointHandlers, filterOrderByNode) {
    const groupByNode = new Map();
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const isolatedSupportComponents = [];
    const connectedSupportNodeIds = new Set();
    const supportChecksByEndpoint = new Map();
    const rows = chains.map((chain) => ({
      id: "chain:" + chain.id,
      type: "CHAIN",
      chainId: chain.id,
      chainOrder: chainOrder(chain),
      matcherCondition: text(attributes(chain).matcherCondition),
      membershipStatus: "CONFIRMED",
      members: { chains: [chain.id], filters: [], securityChecks: [], endpoints: [], handlers: [] }
    }));
    const chainRows = new Map(rows.map((row) => [row.chainId, row]));
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const chainRowsByKey = new Map();
    chains.forEach((chain) => {
      const key = text(attributes(chain).chainKey);
      if (!chain.serviceId || !key) return;
      const indexKey = `${chain.serviceId}\u0000${key}`;
      const matches = chainRowsByKey.get(indexKey) || [];
      matches.push(chain);
      chainRowsByKey.set(indexKey, matches);
    });
    let unresolvedRow = null;
    const unresolved = () => unresolvedRow || (unresolvedRow = {
      id: "unresolved", type: "UNRESOLVED", chainId: null, chainOrder: null, matcherCondition: "",
      membershipStatus: "UNKNOWN", members: { chains: [], filters: [], securityChecks: [], endpoints: [], handlers: [] }
    });
    const add = (row, category, nodeId) => {
      if (!row.members[category].includes(nodeId)) row.members[category].push(nodeId);
      const rowIds = groupByNode.get(nodeId) || new Set();
      rowIds.add(row.id);
      groupByNode.set(nodeId, rowIds);
    };
    rows.forEach((row) => groupByNode.set(row.chainId, new Set([row.id])));
    const rowIdsFor = (nodeId) => Array.from(groupByNode.get(nodeId) || []);
    const filterChainIds = new Map();
    filtersByChain.forEach((items, chainId) => items.forEach(({ filter, edge }) => {
      if (!edge || edge.confidence !== "CONFIRMED") return;
      const chainIds = filterChainIds.get(filter.id) || new Set();
      chainIds.add(chainId);
      filterChainIds.set(filter.id, chainIds);
    }));
    const filterRowsByNode = new Map();
    graph.nodes.filter((node) => node.type === "FILTER" && attributes(node).registrationKind === "SECURITY")
      .forEach((filter) => {
        const chainIds = filterChainIds.get(filter.id) || new Set();
        const rowsForFilter = Array.from(chainIds).map((id) => chainRows.get(id)).filter(Boolean);
        const targetRows = rowsForFilter.length ? rowsForFilter : [unresolved()];
        filterRowsByNode.set(filter.id, new Set(targetRows.map((row) => row.id)));
        targetRows.forEach((row) => add(row, "filters", filter.id));
      });

    endpoints.forEach((endpoint) => {
      const chain = endpointChains.get(endpoint.id);
      add(chain && chainRows.get(chain.id) || unresolved(), "endpoints", endpoint.id);
    });
    const endpointsByHandler = new Map();
    endpointHandlers.forEach((handler, endpointId) => {
      const endpointIds = endpointsByHandler.get(handler.id) || [];
      endpointIds.push(endpointId);
      endpointsByHandler.set(handler.id, endpointIds);
    });
    const endpointsByChain = new Map();
    endpointChains.forEach((chain, endpointId) => {
      const endpointIds = endpointsByChain.get(chain.id) || [];
      endpointIds.push(endpointId);
      endpointsByChain.set(chain.id, endpointIds);
    });
    const handlerRowsByNode = new Map();
    handlers.forEach((handler) => {
      const endpointIds = endpointsByHandler.get(handler.id) || [];
      const memberships = new Set(endpointIds.flatMap((endpointId) => rowIdsFor(endpointId)));
      if (memberships.size === 0) memberships.add(unresolved().id);
      handlerRowsByNode.set(handler.id, memberships);
      memberships.forEach((rowId) => add(rowById.get(rowId) || unresolved(), "handlers", handler.id));
    });

    const supportById = new Map(supportNodes.map((node) => [node.id, node]));
    const supportAdjacency = new Map(supportNodes.map((node) => [node.id, []]));
    graph.edges.filter((edge) => edge.confidence === "CONFIRMED" && SUPPORT_EDGE_TYPES.has(edge.type))
      .forEach((edge) => {
        if (!supportById.has(edge.sourceId) || !supportById.has(edge.targetId)) return;
        supportAdjacency.get(edge.sourceId).push(edge.targetId);
        supportAdjacency.get(edge.targetId).push(edge.sourceId);
      });
    const visitedSupport = new Set();
    supportNodes.slice().sort((left, right) => text(left.id).localeCompare(text(right.id))).forEach((start) => {
      if (visitedSupport.has(start.id)) return;
      const component = [];
      const pending = [start.id];
      visitedSupport.add(start.id);
      while (pending.length) {
        const current = pending.shift();
        component.push(current);
        (supportAdjacency.get(current) || []).forEach((next) => {
          if (visitedSupport.has(next)) return;
          visitedSupport.add(next);
          pending.push(next);
        });
      }
      const componentIds = new Set(component);
      const candidates = new Set();
      let uncertain = false;
      let hasExternalRelation = false;
      const endpointIds = new Set();
      graph.edges.filter((edge) => SUPPORT_EDGE_TYPES.has(edge.type)
        && (componentIds.has(edge.sourceId) || componentIds.has(edge.targetId))).forEach((edge) => {
        const otherId = componentIds.has(edge.sourceId) ? edge.targetId : edge.sourceId;
        const other = nodeById.get(otherId);
        if (!other || componentIds.has(otherId)) return;
        hasExternalRelation = true;
        if (edge.confidence !== "CONFIRMED") {
          uncertain = true;
          return;
        }
        const relatedRows = other.type === "SECURITY_CHAIN" ? ["chain:" + other.id]
          : other.type === "FILTER" && attributes(other).registrationKind === "SECURITY"
            ? Array.from(filterRowsByNode.get(other.id) || [])
            : other.type === "HANDLER" ? Array.from(handlerRowsByNode.get(other.id) || [])
              : other.type === "ENDPOINT" ? rowIdsFor(other.id)
                : [];
        relatedRows.forEach((rowId) => candidates.add(rowId));
        if (other.type === "ENDPOINT") endpointIds.add(other.id);
        else if (other.type === "HANDLER") (endpointsByHandler.get(other.id) || []).forEach((id) => endpointIds.add(id));
        else if (other.type === "SECURITY_CHAIN") (endpointsByChain.get(other.id) || []).forEach((id) => endpointIds.add(id));
        else if (other.type === "FILTER" && attributes(other).registrationKind === "SECURITY") {
          (filterChainIds.get(other.id) || []).forEach((chainId) =>
            (endpointsByChain.get(chainId) || []).forEach((id) => endpointIds.add(id)));
        }
      });
      component.forEach((nodeId) => endpointIds.forEach((endpointId) => {
        const checks = supportChecksByEndpoint.get(endpointId) || new Set();
        checks.add(nodeId);
        supportChecksByEndpoint.set(endpointId, checks);
      }));
      const directUrlPolicies = component.map((id) => nodeById.get(id)).filter((node) => node
        && node.type === "AUTHORIZATION" && attributes(node).policySource === "URL" && text(attributes(node).chainKey));
      const connected = candidates.size > 0;
      if (!connected && !hasExternalRelation && directUrlPolicies.length === 0) {
        isolatedSupportComponents.push({ nodeIds: component });
        return;
      }
      let directRows = null;
      if (directUrlPolicies.length > 0) {
        const directRowIds = new Set();
        let directMembershipUncertain = false;
        directUrlPolicies.forEach((policy) => {
          if (!policy.serviceId) {
            directMembershipUncertain = true;
            return;
          }
          const policyAttributes = attributes(policy);
          const matches = chainRowsByKey.get(`${policy.serviceId}\u0000${text(policyAttributes.chainKey)}`) || [];
          if (matches.length !== 1) {
            directMembershipUncertain = true;
            return;
          }
          const chain = matches[0];
          const policyOrder = text(policyAttributes.chainOrder);
          const actualOrder = text(attributes(chain).chainOrder);
          if (policyOrder && actualOrder) {
            const policyOrderNumber = positiveInteger(policyOrder);
            const actualOrderNumber = positiveInteger(actualOrder);
            const orderConflict = policyOrderNumber !== null && actualOrderNumber !== null
              ? policyOrderNumber !== actualOrderNumber : policyOrder !== actualOrder;
            if (orderConflict) {
              directMembershipUncertain = true;
              return;
            }
          }
          directRowIds.add(`chain:${chain.id}`);
        });
        directRows = directMembershipUncertain || directRowIds.size === 0
          ? [unresolved()]
          : rows.filter((row) => directRowIds.has(row.id));
      }
      const targetRows = directRows || (!uncertain && candidates.size > 0
        && Array.from(candidates).every((id) => rows.some((row) => row.id === id))
        ? rows.filter((row) => candidates.has(row.id)) : [unresolved()]);
      targetRows.forEach((row) => component.forEach((nodeId) => {
        add(row, "securityChecks", nodeId);
        if (row.membershipStatus === "CONFIRMED") connectedSupportNodeIds.add(nodeId);
      }));
    });

    let isolatedRow = null;
    if (isolatedSupportComponents.length > 0) {
      // Chain 소속이 확인되지 않은 보안 정보의 별도 표시 행
      isolatedRow = {
        id: "isolated", type: "ISOLATED", chainId: null, chainOrder: null, matcherCondition: "",
        membershipStatus: "ISOLATED", members: { chains: [], filters: [], securityChecks: [], endpoints: [], handlers: [] }
      };
      isolatedSupportComponents.flatMap((component) => component.nodeIds)
        .forEach((nodeId) => add(isolatedRow, "securityChecks", nodeId));
    }

    const typeRank = { AUTHENTICATION: 1, AUTHORIZATION: 2, SECURITY_DATA: 3, BUSINESS_SECURITY_STATE: 4 };
    const compareNodeIds = (leftId, rightId) => {
      const left = nodeById.get(leftId);
      const right = nodeById.get(rightId);
      return (typeRank[left && left.type] || 9) - (typeRank[right && right.type] || 9)
        || text(leftId).localeCompare(text(rightId));
    };
    const allRows = rows.concat(unresolvedRow ? [unresolvedRow] : [], isolatedRow ? [isolatedRow] : []);
    // 행 소속과 보안 의미를 기준으로 표시 그룹 및 개별 Node 항목 구성
    allRows.forEach((row) => {
      Object.entries(row.members).filter(([category]) => category !== "filters")
        .forEach(([, ids]) => ids.sort(compareNodeIds));
      row.members.filters.sort((leftId, rightId) => {
        const left = filterOrderByNode.get(leftId);
        const right = filterOrderByNode.get(rightId);
        const leftOrder = left && left.status === "CONFIRMED" ? left.order : null;
        const rightOrder = right && right.status === "CONFIRMED" ? right.order : null;
        if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) return leftOrder - rightOrder;
        if (leftOrder !== null && rightOrder === null) return -1;
        if (leftOrder === null && rightOrder !== null) return 1;
        return text(leftId).localeCompare(text(rightId));
      });
    });
    allRows.forEach((row) => {
      const groups = new Map();
      const individualSecurityChecks = [];
      row.members.securityChecks.forEach((nodeId) => {
        const node = nodeById.get(nodeId);
        if (!node) return;
        if (!["AUTHORIZATION", "SECURITY_DATA"].includes(node.type)) {
          individualSecurityChecks.push({ id: nodeId, key: `node:${nodeId}`, nodeId, nodeIds: [nodeId],
            type: node.type, entryKind: "node" });
          return;
        }
        const key = supportDisplayGroupKey(node, row.id);
        const group = groups.get(key) || {
          id: `display-group:${key}`, key, semanticKey: supportDisplaySemantic(node).key,
          type: node.type, ownerId: row.id, layoutGroupId: row.id, rowId: row.id,
          scope: supportDisplayScope(node), membershipStatus: row.membershipStatus, entryKind: "group",
          nodeIds: [], handlerIds: [], endpointIds: [], edgeIds: []
        };
        group.nodeIds.push(nodeId);
        groups.set(key, group);
      });
      // 큰 의미 그룹만 실제 연결 주체와 정책 범위로 세분화
      row.displayGroups = Array.from(groups.values()).flatMap((group) => {
        const authorityKeys = new Set(group.nodeIds.map((id) => {
          const data = attributes(nodeById.get(id));
          return JSON.stringify([text(data.requiredAuthority), text(data.authorityOperator)]);
        }));
        const splitAuthority = group.type === "AUTHORIZATION" && authorityKeys.size > 1
          && group.nodeIds.some((id) => text(attributes(nodeById.get(id)).requiredAuthority));
        const claims = new Set(group.nodeIds.map((id) => text(attributes(nodeById.get(id)).claimName)).filter(Boolean));
        const splitClaim = group.type === "SECURITY_DATA" && group.semanticKey === "JWT_CLAIM:READ" && claims.size > 1;
        if (!splitAuthority && !splitClaim && group.nodeIds.length <= 5) return [group];
        const subgroups = new Map();
        group.nodeIds.forEach((nodeId) => {
          const node = nodeById.get(nodeId);
          const data = attributes(node);
          let scope = "";
          if (splitAuthority) scope = JSON.stringify([text(data.requiredAuthority), text(data.authorityOperator)]);
          else if (splitClaim) scope = text(data.claimName);
          else if (group.type === "AUTHORIZATION" && text(data.policySource).toUpperCase() === "URL") {
            const matcher = text(data.policyMatcherCondition || data.matcherCondition);
            scope = (matcher.match(/\/[a-zA-Z0-9_.-]+/) || [""])[0];
          } else if (group.type === "SECURITY_DATA") {
            const owners = graph.edges.filter((edge) => edge.confidence === "CONFIRMED"
              && (edge.sourceId === nodeId || edge.targetId === nodeId))
              .map((edge) => nodeById.get(edge.sourceId === nodeId ? edge.targetId : edge.sourceId))
              .filter((owner) => owner && ["HANDLER", "FILTER"].includes(owner.type))
              .map((owner) => owner.type === "HANDLER" ? controllerFqcn(owner) || owner.id : owner.id);
            scope = Array.from(new Set(owners)).sort().join("|");
          }
          const bucket = subgroups.get(scope) || [];
          bucket.push(nodeId);
          subgroups.set(scope, bucket);
        });
        if (subgroups.size < 2) return [group];
        let entries = Array.from(subgroups.entries()).sort(([left], [right]) => left.localeCompare(right));
        if (!splitAuthority && !splitClaim && entries.length > 3) {
          const ranked = entries.slice().sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]));
          const remainder = ranked.slice(2);
          entries = ranked.slice(0, 2).concat([[JSON.stringify(["remaining", ...remainder.map(([scope]) => scope).sort()]),
            remainder.flatMap(([, ids]) => ids)]]);
        }
        return entries.map(([scope, nodeIds]) => {
          const key = JSON.stringify([group.key, scope]);
          const remaining = scope.startsWith('["remaining",');
          const subgroupLabel = remaining ? (group.type === "SECURITY_DATA" ? "그 외·미확인 사용 주체" : "그 외·미확인 경로")
            : !scope ? (splitClaim ? "Claim 확인 불가" : group.type === "SECURITY_DATA" ? "사용 주체 확인 불가" : "적용 범위 확인 불가")
              : splitAuthority ? [text(attributes(nodeById.get(nodeIds[0])).requiredAuthority), text(attributes(nodeById.get(nodeIds[0])).authorityOperator)].filter(Boolean).join(" · ")
                : splitClaim ? `Claim ${scope}`
                : group.type === "SECURITY_DATA" ? scope.split("|").map((owner) => owner.split(".").pop()).join(" · ")
                  : `${scope} 경로`;
          return { ...group, id: `display-group:${key}`, key, nodeIds, subgroupLabel };
        });
      }).sort((left, right) => left.key.localeCompare(right.key));
      row.securityEntries = row.displayGroups.concat(individualSecurityChecks)
        .sort((left, right) => (typeRank[left.type] || 9) - (typeRank[right.type] || 9)
          || left.key.localeCompare(right.key));
    });
    const securityColumns = Math.min(2, Math.max(1, Math.ceil(Math.max(1,
      ...rows.map((row) => row.securityEntries.length)) / 8)));
    const endpointColumns = endpoints.length >= 16 ? 2 : 1;
    allRows.forEach((row) => {
      const chainFilterHeight = Math.max(gridRequiredHeight(row.members.chains.length, 1),
        gridRequiredHeight(row.members.filters.length, MAX_FILTER_COLUMNS));
      const securityChecksHeight = gridRequiredHeight(row.securityEntries.length, securityColumns);
      const endpointHeight = gridRequiredHeight(row.members.endpoints.length, endpointColumns, true);
      const handlerHeight = gridRequiredHeight(handlerDisplayItemCount(row.members.handlers, nodeById), endpointColumns, true);
      row.securityColumns = securityColumns;
      row.sectionHeights = { chainFilter: chainFilterHeight, securityChecks: securityChecksHeight,
        endpoint: endpointHeight, handler: handlerHeight };
      row.rowHeight = Math.max(NODE_HEIGHT, chainFilterHeight, securityChecksHeight,
        endpointHeight, handlerHeight) + NODE_SAFE_MARGIN * 2;
    });
    return {
      rows: allRows,
      groupByNode,
      isolatedSupportComponents,
      connectedSupportNodeIds,
      supportChecksByEndpoint,
      securityColumns
    };
  }

  function positionHiddenConceptualGroups(rows, positions, graph, endpointHandlers, elkPositions, lanes, startY,
    controllerGroups = []) {
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const endpointLane = laneDefinition("endpoint", lanes);
    const handlerLane = laneDefinition("handler", lanes);
    const securityFilterLane = laneDefinition("security-filter", lanes);
    const securityChecksLane = laneDefinition("security-checks", lanes);
    const endpointColumns = endpointLane.columns;
    const handlerColumns = handlerLane.columns;
    const positionsByRow = new Map();
    const canonicalPositions = new Set();
    const controllerGroupsByRow = new Map();
    controllerGroups.forEach((group) => {
      if (!group.layoutGroupId) return;
      const groupsForRow = controllerGroupsByRow.get(group.layoutGroupId) || [];
      groupsForRow.push(group);
      controllerGroupsByRow.set(group.layoutGroupId, groupsForRow);
    });
    const place = (row, nodeId, position) => {
      const rowPositions = positionsByRow.get(row.id) || new Map();
      rowPositions.set(nodeId, { ...position });
      positionsByRow.set(row.id, rowPositions);
      if (!canonicalPositions.has(nodeId)) {
        positions[nodeId] = { ...position };
        canonicalPositions.add(nodeId);
      }
    };
    // 각 섹션 콘텐츠 높이를 기준으로 행 내부 중앙 배치
    const sectionTop = (row, height) => row.rowTop + NODE_SAFE_MARGIN
      + Math.max(0, (row.rowHeight - NODE_SAFE_MARGIN * 2 - height) / 2);
    let nextTop = startY;
    rows.forEach((row) => {
      row.rowTop = nextTop;
      const chainFilterTop = sectionTop(row, row.sectionHeights.chainFilter);
      const securityChecksTop = sectionTop(row, row.sectionHeights.securityChecks);
      const endpointTop = sectionTop(row, row.sectionHeights.endpoint);
      const handlerTop = sectionTop(row, row.sectionHeights.handler);
      row.members.chains.forEach((id) => place(row, id,
        { x: laneDefinition("security-chain", lanes).x, y: chainFilterTop }));
      row.members.filters.forEach((id, index) => place(row, id, filterPosition(securityFilterLane, index, chainFilterTop)));
      securityCheckDisplayGroups(row).forEach((entry, index) => {
        entry.position = gridPosition(securityChecksLane, index, row.securityColumns, securityChecksTop);
        if (entry.entryKind === "group") {
          entry.nodeIds.forEach((id) => place(row, id, entry.position));
        } else place(row, entry.nodeId, entry.position);
      });
      row.members.endpoints.forEach((id, index) => {
        place(row, id, gridPosition(endpointLane, index, endpointColumns, endpointTop, true));
      });
      const endpointOrder = row.members.endpoints.slice().sort((leftId, rightId) => {
        const left = attributes(nodeById.get(leftId));
        const right = attributes(nodeById.get(rightId));
        return (text(left.httpMethod) + " " + text(left.path)).localeCompare(text(right.httpMethod) + " " + text(right.path))
          || text(leftId).localeCompare(text(rightId));
      });
      const orderedHandlers = [];
      endpointOrder.forEach((endpointId) => {
        const handler = endpointHandlers.get(endpointId);
        if (handler && row.members.handlers.includes(handler.id) && !orderedHandlers.includes(handler.id)) {
          orderedHandlers.push(handler.id);
        }
      });
      row.members.handlers.slice().sort((leftId, rightId) =>
        nodeOrder(nodeById.get(leftId), elkPositions).localeCompare(nodeOrder(nodeById.get(rightId), elkPositions)))
        .forEach((id) => { if (!orderedHandlers.includes(id)) orderedHandlers.push(id); });
      const rowControllerGroups = (controllerGroupsByRow.get(row.id) || []).slice()
        .sort((left, right) => left.controllerFqcn.localeCompare(right.controllerFqcn) || left.id.localeCompare(right.id));
      orderedHandlers.forEach((id, index) => place(row, id,
        gridPosition(handlerLane, index, handlerColumns, handlerTop, true)));
      rowControllerGroups.forEach((group, index) => {
        group.position = gridPosition(handlerLane, index, handlerColumns, handlerTop, true);
      });
      row.rowBottom = row.rowTop + row.rowHeight;
      nextTop = row.rowBottom + CHAIN_GAP;
    });
    return { height: rows.length ? nextTop - CHAIN_GAP - startY : 0, positionsByRow };
  }

  // 표시 인스턴스와 관계별 포트에서 직교 선분 및 연결 순서 구성
  function routeOverview(instances, relations, rows = [], retry = null, attempt = 0) {
    const nodes = new Map(instances.map((instance) => [instance.id, instance]));
    const rowBounds = new Map(rows.filter((row) => Number.isFinite(row.rowTop) && Number.isFinite(row.rowBottom))
      .map((row) => [row.id, row]));
    const groups = new Map();
    const unresolved = [];
    const targetCounts = new Map();
    const sourceCounts = new Map();
    relations.forEach((relation) => {
      const key = JSON.stringify([relation.rowId, relation.role, relation.type, relation.targetInstanceId]);
      const sources = targetCounts.get(key) || new Set();
      sources.add(relation.sourceInstanceId);
      targetCounts.set(key, sources);
      const sourceKey = JSON.stringify([relation.rowId, relation.role, relation.type, relation.sourceInstanceId]);
      const targets = sourceCounts.get(sourceKey) || new Set();
      targets.add(relation.targetInstanceId);
      sourceCounts.set(sourceKey, targets);
    });
    const bicliques = new Map();
    relations.forEach((relation) => {
      const source = nodes.get(relation.sourceInstanceId);
      const target = nodes.get(relation.targetInstanceId);
      if (!source || !target || !source.position || !target.position) return;
      const sourceKey = JSON.stringify([relation.rowId, relation.role, relation.type, relation.sourceInstanceId]);
      const targetIds = Array.from(sourceCounts.get(sourceKey)).sort();
      if (targetIds.length < 2) return;
      const direction = target.position.x >= source.position.x ? 1 : -1;
      const key = JSON.stringify([relation.rowId, relation.role, relation.type, targetIds, direction]);
      const group = bicliques.get(key) || { key, direction, relations: [], sources: new Set(), targets: targetIds };
      group.sources.add(relation.sourceInstanceId);
      group.relations.push(relation);
      bicliques.set(key, group);
    });
    const paths = [];
    const completed = new Set();
    const portSlots = new Map();
    const portOffsetFor = (nodeId, side, groupKey) => {
      const key = JSON.stringify([nodeId, side]);
      const slots = portSlots.get(key) || new Map();
      if (!slots.has(groupKey)) slots.set(groupKey, slots.size);
      portSlots.set(key, slots);
      const index = (slots.get(groupKey) + attempt * 5) % 25;
      return index === 0 ? 0 : Math.min(48, Math.ceil(index / 2) * 4) * (index % 2 ? 1 : -1);
    };
    const occupiedHorizontal = new Map();
    const occupiedVertical = new Map();
    const busSlots = new Map();
    const busOffsetFor = (rowId, direction, entryX, groupKey) => {
      const key = JSON.stringify([rowId, direction, entryX]);
      const slots = busSlots.get(key) || new Map();
      if (!slots.has(groupKey)) slots.set(groupKey, slots.size);
      busSlots.set(key, slots);
      return (NODE_SAFE_MARGIN + 1) + (slots.get(groupKey) + attempt * 3) * 4;
    };
    const reservePath = (path) => {
      paths.push(path);
      path.points.slice(1).forEach((end, index) => {
        const start = path.points[index];
        const horizontal = start.y === end.y;
        const fixed = horizontal ? start.y : start.x;
        const axis = horizontal ? "x" : "y";
        const indexMap = horizontal ? occupiedHorizontal : occupiedVertical;
        const entries = indexMap.get(fixed) || [];
        entries.push({ low: Math.min(start[axis], end[axis]), high: Math.max(start[axis], end[axis]),
          groupKey: path.groupKey });
        indexMap.set(fixed, entries);
      });
    };
    const overlapsPaths = (candidate, groupKey) => candidate.slice(1).some((end, index) => {
      const start = candidate[index];
      const horizontal = start.y === end.y;
      const axis = horizontal ? "x" : "y";
      const entries = (horizontal ? occupiedHorizontal : occupiedVertical).get(horizontal ? start.y : start.x) || [];
      const low = Math.min(start[axis], end[axis]), high = Math.max(start[axis], end[axis]);
      return entries.some((entry) => entry.groupKey !== groupKey
        && Math.max(low, entry.low) < Math.min(high, entry.high));
    });
    const routeBiclique = (group) => {
      if (group.sources.size < 2 || group.relations.length !== group.sources.size * group.targets.length) return;
      const direction = group.direction;
      if (direction < 0) return;
      const sourcePorts = new Map(Array.from(group.sources, (id) => {
        const position = nodes.get(id).position;
        return [id, { x: position.x + (position.width || NODE_WIDTH),
          y: position.y + (position.height || NODE_HEIGHT) / 2 + portOffsetFor(id, 1, group.key) }];
      }));
      const targetPorts = new Map(group.targets.map((id) => {
        const position = nodes.get(id).position;
        return [id, { x: position.x, y: position.y + (position.height || NODE_HEIGHT) / 2 + portOffsetFor(id, -1, group.key) }];
      }));
      const targetXs = Array.from(targetPorts.values(), (port) => port.x);
      const firstEntryX = direction > 0 ? Math.min(...targetXs) : Math.max(...targetXs);
      const targetBusX = firstEntryX - direction * busOffsetFor(group.relations[0].rowId, direction, firstEntryX, group.key);
      const ys = Array.from(sourcePorts.values(), (port) => port.y).sort((a, b) => a - b);
      const trunkCandidates = [(ys[0] + ys[ys.length - 1]) / 2, ...ys];
      let selected = null;
      for (const trunkY of trunkCandidates) {
        const candidates = group.relations.map((relation) => {
          const sourcePort = sourcePorts.get(relation.sourceInstanceId);
          const targetPort = targetPorts.get(relation.targetInstanceId);
          const sourceBusX = sourcePort.x + direction * (NODE_SAFE_MARGIN + 1);
          const parts = [
            { from: sourcePort, to: { x: sourceBusX, y: sourcePort.y }, role: "SOURCE_STUB" },
            { from: { x: sourceBusX, y: sourcePort.y }, to: { x: sourceBusX, y: trunkY }, role: "MERGE_BUS" },
            { from: { x: sourceBusX, y: trunkY }, to: { x: targetBusX, y: trunkY }, role: "TRUNK" },
            { from: { x: targetBusX, y: trunkY }, to: { x: targetBusX, y: targetPort.y }, role: "SPLIT_BUS" },
            { from: { x: targetBusX, y: targetPort.y }, to: targetPort, role: "TARGET_BRANCH" }
          ].filter((part) => part.from.x !== part.to.x || part.from.y !== part.to.y);
          const points = [parts[0].from, ...parts.map((part) => part.to)];
          return { relation, points, parts, partRoles: parts.map((part) => part.role), sourcePort, targetPort, groupKey: group.key };
        });
        const blocked = candidates.some((candidate) => candidate.parts.some((part) => part.role !== "TRUNK" &&
          instances.some((obstacle) => obstacle.position && obstacle.id !== candidate.relation.sourceInstanceId
            && obstacle.id !== candidate.relation.targetInstanceId
            && segmentIntersectsExpandedNode(part.from, part.to, obstacle.position))));
        if (!blocked && !candidates.some((candidate) => overlapsPaths(candidate.points, group.key))) {
          selected = candidates;
          break;
        }
      }
      if (selected) selected.forEach((candidate) => { reservePath(candidate); completed.add(candidate.relation.id); });
    };
    const roleOrder = { STRUCTURAL_FLOW: 0, API_MAPPING: 1, ANALYSIS_REFERENCE: 2, REGISTRATION_REFERENCE: 3 };
    relations.slice().sort((a, b) => (roleOrder[a.role] ?? 4) - (roleOrder[b.role] ?? 4)
      || Number(Boolean(retry && retry.has(b.id))) - Number(Boolean(retry && retry.has(a.id)))
      || text(a.id).localeCompare(text(b.id))).forEach((original) => {
      if (completed.has(original.id)) return;
      const key = JSON.stringify([original.rowId, original.role, original.type, original.targetInstanceId]);
      const sourceKey = JSON.stringify([original.rowId, original.role, original.type, original.sourceInstanceId]);
      const reverse = targetCounts.get(key).size > 1 && sourceCounts.get(sourceKey).size === 1
        && Array.from(targetCounts.get(key)).every((id) =>
          sourceCounts.get(JSON.stringify([original.rowId, original.role, original.type, id])).size === 1);
      const relation = reverse ? { ...original, sourceInstanceId: original.targetInstanceId,
        targetInstanceId: original.sourceInstanceId, reverse: true } : original;
      const source = nodes.get(relation.sourceInstanceId);
      const target = nodes.get(relation.targetInstanceId);
      if (!source || !target || !source.position || !target.position || source.id === target.id) {
        unresolved.push({ relationId: relation.id, reason: "missing-port" });
        return;
      }
      const direction = target.position.x >= source.position.x ? 1 : -1;
      const groupKey = JSON.stringify([relation.rowId, relation.role, relation.type, relation.sourceInstanceId, direction, reverse]);
      const group = groups.get(groupKey) || { key: groupKey, direction, source, role: relation.role,
        traversalSide: reverse ? -1 : 1,
        row: rowBounds.get(relation.rowId), items: [] };
      group.items.push({ relation, target });
      groups.set(groupKey, group);
    });
    const routingTasks = [
      ...Array.from(bicliques.values(), (group) => ({ group, biclique: true, role: group.relations[0].role })),
      ...Array.from(groups.values(), (group) => ({ group, biclique: false, role: group.role }))
    ];
    const taskPriority = (task) => Boolean(retry && (task.biclique ? task.group.relations : task.group.items.map((item) => item.relation))
      .some((relation) => retry.has(relation.id)));
    routingTasks.sort((left, right) => Number(taskPriority(right)) - Number(taskPriority(left))
      || (roleOrder[left.role] ?? 4) - (roleOrder[right.role] ?? 4)
      || Number(right.biclique) - Number(left.biclique) || left.group.key.localeCompare(right.group.key));
    routingTasks.forEach((task) => {
      const group = task.group;
      if (task.biclique) { routeBiclique(group); return; }
      group.items = group.items.filter(({ relation }) => !completed.has(relation.id));
      if (!group.items.length) return;
      const source = group.source.position;
      const direction = group.direction;
      const traversalSide = group.traversalSide;
      const groupSourcePort = { x: source.x + (traversalSide > 0 ? source.width || NODE_WIDTH : 0),
        y: source.y + (source.height || NODE_HEIGHT) / 2 + portOffsetFor(group.source.id, traversalSide, group.key) };
      const entry = group.items.map(({ target }) => target.position.x
        + (traversalSide < 0 ? target.position.width || NODE_WIDTH : 0));
      const firstEntryX = direction > 0 ? Math.min(...entry) : Math.max(...entry);
      const busX = firstEntryX - direction * busOffsetFor(group.items[0].relation.rowId, direction, firstEntryX, group.key);
      if (new Set(group.items.map(({ target }) => target.id)).size > 1 && direction === traversalSide
        && Math.abs(busX - groupSourcePort.x) > NODE_SAFE_MARGIN * 3) {
        const stub = { x: groupSourcePort.x + traversalSide * (NODE_SAFE_MARGIN + 1), y: groupSourcePort.y };
        const split = { x: busX, y: groupSourcePort.y };
        const candidates = group.items.map(({ relation, target }) => {
          const p = target.position;
          const targetPort = { x: p.x + (traversalSide < 0 ? p.width || NODE_WIDTH : 0),
            y: p.y + (p.height || NODE_HEIGHT) / 2 + portOffsetFor(target.id, -traversalSide, group.key) };
          const targetStubX = targetPort.x - traversalSide * (NODE_SAFE_MARGIN + 1);
          const margin = NODE_SAFE_MARGIN + 2;
          const branchYs = new Set([targetPort.y, p.y - margin, p.y + (p.height || NODE_HEIGHT) + margin]);
          instances.forEach((obstacle) => {
            if (!obstacle.position) return;
            const bounds = obstacle.position;
            if (bounds.x > Math.max(busX, targetStubX) || bounds.x + (bounds.width || NODE_WIDTH) < Math.min(busX, targetStubX)) return;
            if (Math.abs(bounds.y - p.y) > ROW_STEP * 2) return;
            branchYs.add(bounds.y - margin);
            branchYs.add(bounds.y + (bounds.height || NODE_HEIGHT) + margin);
          });
          const ordered = Array.from(branchYs).filter((y) => !group.row
            || (y >= group.row.rowTop - margin && y <= group.row.rowBottom + margin))
            .sort((a, b) => Math.abs(a - targetPort.y) - Math.abs(b - targetPort.y) || a - b);
          for (const y of ordered) {
            const parts = [
              { from: groupSourcePort, to: stub, role: "SOURCE_STUB" },
              { from: stub, to: split, role: "TRUNK" },
              { from: split, to: { x: busX, y }, role: "SPLIT_BUS" },
              { from: { x: busX, y }, to: { x: targetStubX, y }, role: "TARGET_BRANCH" },
              { from: { x: targetStubX, y }, to: { x: targetStubX, y: targetPort.y }, role: "TARGET_BRANCH" },
              { from: { x: targetStubX, y: targetPort.y }, to: targetPort, role: "TARGET_STUB" }
            ].filter((part) => part.from.x !== part.to.x || part.from.y !== part.to.y);
            const safe = parts.every((part) => {
              if (overlapsPaths([part.from, part.to], group.key)) return false;
              if (part.role === "TRUNK") return true;
              return !instances.some((obstacle) => obstacle.position && obstacle.id !== group.source.id
                && obstacle.id !== target.id && segmentIntersectsExpandedNode(part.from, part.to, obstacle.position));
            });
            if (safe) return { relation, sourcePort: groupSourcePort, targetPort, parts,
              points: [parts[0].from, ...parts.map((part) => part.to)], groupKey: group.key };
          }
          return null;
        });
        const safe = candidates.every(Boolean);
        if (safe) {
          candidates.forEach((candidate) => {
            candidate.partRoles = candidate.parts.map((part) => part.role);
            reservePath(candidate);
          });
          return;
        }
      }
      group.items.forEach(({ relation, target }) => {
        const p = target.position;
        let sourcePort = groupSourcePort;
        let targetPort = { x: p.x + (traversalSide < 0 ? p.width || NODE_WIDTH : 0),
          y: p.y + (p.height || NODE_HEIGHT) / 2 + portOffsetFor(target.id, -traversalSide, group.key) };
        let points = [sourcePort, { x: busX, y: sourcePort.y }, { x: busX, y: targetPort.y }, targetPort]
          .filter((point, index, all) => index === 0 || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
        const blocked = (candidate) => candidate.slice(1).some((point, index) => instances.some((obstacle) => {
          if (obstacle.id === group.source.id || obstacle.id === target.id || !obstacle.position) return false;
          return segmentIntersectsExpandedNode(candidate[index], point, obstacle.position);
        }));
        const overlapsOtherGroup = (candidate) => overlapsPaths(candidate, group.key);
        if (blocked(points) || overlapsOtherGroup(points)
          || (direction > 0 ? busX <= sourcePort.x : busX >= sourcePort.x)) {
          const margin = NODE_SAFE_MARGIN + 2;
          const midY = (sourcePort.y + targetPort.y) / 2;
          const corridors = new Set([source.y - margin, source.y + (source.height || NODE_HEIGHT) + margin,
            p.y - margin, p.y + (p.height || NODE_HEIGHT) + margin]);
          instances.forEach((instance) => {
            if (!instance.position) return;
            const obstacle = instance.position;
            if (obstacle.x > Math.max(source.x, p.x) + NODE_WIDTH
              || obstacle.x + (obstacle.width || NODE_WIDTH) < Math.min(source.x, p.x)) return;
            corridors.add(obstacle.y - margin);
            corridors.add(obstacle.y + (obstacle.height || NODE_HEIGHT) + margin);
          });
          const orderedY = Array.from(corridors).filter((y) => !group.row
            || (y >= group.row.rowTop - margin && y <= group.row.rowBottom + margin))
            .sort((a, b) => Math.abs(a - midY) - Math.abs(b - midY) || a - b);
          let alternate = null;
          let alternateScore = Infinity;
          for (const sourceSide of [traversalSide]) {
            for (const targetSide of [-traversalSide]) {
              const from = { x: source.x + (sourceSide > 0 ? source.width || NODE_WIDTH : 0), y: groupSourcePort.y };
              const to = { x: p.x + (targetSide > 0 ? p.width || NODE_WIDTH : 0), y: targetPort.y };
              const fromX = from.x + sourceSide * margin;
              const toX = to.x + targetSide * margin;
              for (const y of orderedY) {
                const candidate = [from, { x: fromX, y: from.y }, { x: fromX, y }, { x: toX, y },
                  { x: toX, y: to.y }, to]
                  .filter((point, index, all) => index === 0 || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
                if (!blocked(candidate) && !overlapsOtherGroup(candidate)) {
                  const score = candidate.slice(1).reduce((sum, point, index) => sum
                    + Math.abs(point.x - candidate[index].x) + Math.abs(point.y - candidate[index].y), 0)
                    + (sourceSide === traversalSide ? 0 : NODE_WIDTH / 2);
                  if (score < alternateScore) {
                    alternate = { points: candidate, sourcePort: from, targetPort: to };
                    alternateScore = score;
                  }
                  break;
                }
              }
            }
          }
          // 인접 장애물 경계로 구성한 직교 통로에서 최단 경로 탐색
          const directDistance = Math.abs(groupSourcePort.x - targetPort.x) + Math.abs(groupSourcePort.y - targetPort.y);
          if (!alternate || alternateScore > directDistance + ROW_STEP) {
            for (const sourceSide of [traversalSide]) {
              for (const targetSide of [-traversalSide]) {
                for (const [sourceOffset, targetOffset] of [[0, 0]]) {
                if (alternate && (sourceOffset || targetOffset)) continue;
                const from = { x: source.x + (sourceSide > 0 ? source.width || NODE_WIDTH : 0), y: groupSourcePort.y + sourceOffset };
                const to = { x: p.x + (targetSide > 0 ? p.width || NODE_WIDTH : 0), y: targetPort.y + targetOffset };
                if (from.y <= source.y + 4 || from.y >= source.y + (source.height || NODE_HEIGHT) - 4
                  || to.y <= p.y + 4 || to.y >= p.y + (p.height || NODE_HEIGHT) - 4) continue;
                const start = { x: from.x + sourceSide * margin, y: from.y };
                const end = { x: to.x + targetSide * margin, y: to.y };
                if (blocked([from, start]) || blocked([end, to]) || overlapsOtherGroup([from, start])
                  || overlapsOtherGroup([end, to])) continue;
                const minX = Math.min(start.x, end.x) - COLUMN_STEP * 2;
                const maxX = Math.max(start.x, end.x) + COLUMN_STEP * 2;
                const minY = Math.max(Math.min(start.y, end.y) - ROW_STEP * 4,
                  group.row ? group.row.rowTop - margin : -Infinity);
                const maxY = Math.min(Math.max(start.y, end.y) + ROW_STEP * 4,
                  group.row ? group.row.rowBottom + margin : Infinity);
                const obstacles = instances.filter((instance) => instance.position
                  && instance.position.x < maxX && instance.position.x + (instance.position.width || NODE_WIDTH) > minX
                  && instance.position.y < maxY && instance.position.y + (instance.position.height || NODE_HEIGHT) > minY);
                const xs = new Set([start.x, end.x]);
                const ys = new Set([start.y, end.y]);
                obstacles.forEach(({ position }) => {
                  xs.add(position.x - margin);
                  xs.add(position.x + (position.width || NODE_WIDTH) + margin);
                  ys.add(position.y - margin);
                  ys.add(position.y + (position.height || NODE_HEIGHT) + margin);
                  xs.add(position.x - margin - 8);
                  xs.add(position.x + (position.width || NODE_WIDTH) + margin + 8);
                  ys.add(position.y - margin - 4);
                  ys.add(position.y + (position.height || NODE_HEIGHT) + margin + 4);
                });
                // 기존 독립 배선의 인접 빈 채널을 탐색 좌표에 포함
                Array.from(occupiedVertical.keys()).filter((x) => x >= minX && x <= maxX)
                  .sort((a, b) => Math.min(Math.abs(a - start.x), Math.abs(a - end.x))
                    - Math.min(Math.abs(b - start.x), Math.abs(b - end.x)) || a - b)
                  .slice(0, 24).forEach((x) => { xs.add(x - 3); xs.add(x + 3); });
                Array.from(occupiedHorizontal.keys()).filter((y) => y >= minY && y <= maxY)
                  .sort((a, b) => Math.min(Math.abs(a - start.y), Math.abs(a - end.y))
                    - Math.min(Math.abs(b - start.y), Math.abs(b - end.y)) || a - b)
                  .slice(0, 24).forEach((y) => { ys.add(y - 3); ys.add(y + 3); });
                const xValues = Array.from(xs).filter((x) => x >= minX && x <= maxX).sort((a, b) => a - b);
                const yValues = Array.from(ys).filter((y) => y >= minY && y <= maxY).sort((a, b) => a - b);
                const startX = xValues.indexOf(start.x), startY = yValues.indexOf(start.y);
                const endX = xValues.indexOf(end.x), endY = yValues.indexOf(end.y);
                const keyFor = (x, y) => `${x}:${y}`;
                const queue = [{ x: startX, y: startY, cost: 0, score: Math.abs(start.x - end.x) + Math.abs(start.y - end.y) }];
                const before = (a, b) => a.score - b.score || a.cost - b.cost || a.x - b.x || a.y - b.y;
                const enqueue = (item) => {
                  queue.push(item);
                  let index = queue.length - 1;
                  while (index > 0) {
                    const parent = Math.floor((index - 1) / 2);
                    if (before(queue[parent], queue[index]) <= 0) break;
                    [queue[parent], queue[index]] = [queue[index], queue[parent]];
                    index = parent;
                  }
                };
                const dequeue = () => {
                  const first = queue[0];
                  const last = queue.pop();
                  if (queue.length) {
                    queue[0] = last;
                    let index = 0;
                    while (index * 2 + 1 < queue.length) {
                      const left = index * 2 + 1, right = left + 1;
                      const child = right < queue.length && before(queue[right], queue[left]) < 0 ? right : left;
                      if (before(queue[index], queue[child]) <= 0) break;
                      [queue[index], queue[child]] = [queue[child], queue[index]];
                      index = child;
                    }
                  }
                  return first;
                };
                const distance = new Map([[keyFor(startX, startY), 0]]);
                const previous = new Map();
                const passageCache = new Map();
                let found = false;
                for (let visits = 0; queue.length && visits < 25000; visits += 1) {
                  const current = dequeue();
                  const key = keyFor(current.x, current.y);
                  if (current.cost !== distance.get(key)) continue;
                  if (current.x === endX && current.y === endY) { found = true; break; }
                  const currentPoint = { x: xValues[current.x], y: yValues[current.y] };
                  for (const [nextX, nextY] of [[current.x - 1, current.y], [current.x + 1, current.y],
                    [current.x, current.y - 1], [current.x, current.y + 1]]) {
                    if (nextX < 0 || nextX >= xValues.length || nextY < 0 || nextY >= yValues.length) continue;
                    const nextPoint = { x: xValues[nextX], y: yValues[nextY] };
                    const passageKey = [key, keyFor(nextX, nextY)].sort().join("|");
                    let blockedPassage = passageCache.get(passageKey);
                    if (blockedPassage === undefined) {
                      blockedPassage = obstacles.some((obstacle) => segmentIntersectsExpandedNode(currentPoint, nextPoint, obstacle.position))
                        || overlapsOtherGroup([currentPoint, nextPoint]);
                      passageCache.set(passageKey, blockedPassage);
                    }
                    if (blockedPassage) continue;
                    const cost = current.cost + Math.abs(currentPoint.x - nextPoint.x) + Math.abs(currentPoint.y - nextPoint.y);
                    const nextKey = keyFor(nextX, nextY);
                    if (cost >= (distance.get(nextKey) ?? Infinity)) continue;
                    distance.set(nextKey, cost);
                    previous.set(nextKey, key);
                    enqueue({ x: nextX, y: nextY, cost,
                      score: cost + Math.abs(nextPoint.x - end.x) + Math.abs(nextPoint.y - end.y) });
                  }
                }
                if (!found) continue;
                const pointsInGrid = [];
                let current = keyFor(endX, endY);
                while (current) {
                  const [x, y] = current.split(":").map(Number);
                  pointsInGrid.push({ x: xValues[x], y: yValues[y] });
                  current = previous.get(current);
                }
                pointsInGrid.reverse();
                const candidate = [from, ...pointsInGrid, to].filter((point, index, all) => index === 0
                  || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
                if (!blocked(candidate) && !overlapsOtherGroup(candidate)) {
                  const score = candidate.slice(1).reduce((sum, point, index) => sum
                    + Math.abs(point.x - candidate[index].x) + Math.abs(point.y - candidate[index].y), 0)
                    + (sourceSide === traversalSide ? 0 : NODE_WIDTH / 2);
                  if (score < alternateScore) {
                    alternate = { points: candidate, sourcePort: from, targetPort: to };
                    alternateScore = score;
                  }
                }
                if (alternateScore <= directDistance + ROW_STEP) break;
                }
                if (alternateScore <= directDistance + ROW_STEP) break;
              }
              if (alternateScore <= directDistance + ROW_STEP) break;
            }
          }
          if (!alternate) {
            unresolved.push({ relationId: relation.id, reason: "blocked-corridor" });
            return;
          }
          ({ points, sourcePort, targetPort } = alternate);
        }
        points = routePoints(routeFromPoints(points));
        reservePath({ relation, points, sourcePort, targetPort, groupKey: group.key });
      });
    });
    const raw = paths.flatMap((path) => path.points.slice(1).map((point, index) => ({
      from: path.points[index], to: point, relationId: path.relation.id
    })));
    const segments = [];
    const segmentByKey = new Map();
    const routesByRelationId = {};
    paths.forEach((path) => {
      const orderedSegmentIds = [];
      path.points.slice(1).forEach((end, index) => {
        const start = path.points[index];
        const horizontal = start.y === end.y;
        const axis = horizontal ? "x" : "y";
        const fixed = horizontal ? "y" : "x";
        const low = Math.min(start[axis], end[axis]);
        const high = Math.max(start[axis], end[axis]);
        const cuts = new Set([low, high]);
        raw.forEach((part) => {
          if (part.from[fixed] !== start[fixed] || part.to[fixed] !== start[fixed]) return;
          [part.from[axis], part.to[axis]].forEach((value) => { if (value > low && value < high) cuts.add(value); });
        });
        const values = Array.from(cuts).sort((a, b) => start[axis] < end[axis] ? a - b : b - a);
        values.slice(1).forEach((value, partIndex) => {
          const from = horizontal ? { x: values[partIndex], y: start.y } : { x: start.x, y: values[partIndex] };
          const to = horizontal ? { x: value, y: start.y } : { x: start.x, y: value };
          const key = JSON.stringify([horizontal ? "H" : "V", start[fixed], Math.min(from[axis], to[axis]), Math.max(from[axis], to[axis])]);
          let segment = segmentByKey.get(key);
          if (!segment) {
            segment = { id: `segment:${segments.length}`, from, to, groupKey: path.groupKey,
              routeRole: path.partRoles ? path.partRoles[index] : path.relation.routeKind === "filter-wrap" ? "FILTER_WRAP" : "DIRECT",
              axis: horizontal ? "HORIZONTAL" : "VERTICAL", relationIds: [] };
            segmentByKey.set(key, segment);
            segments.push(segment);
          }
          segment.relationIds.push(path.relation.id);
          orderedSegmentIds.push(segment.id);
        });
      });
      routesByRelationId[path.relation.id] = path.relation.reverse
        ? { sourcePort: path.targetPort, targetPort: path.sourcePort, orderedSegmentIds: orderedSegmentIds.reverse() }
        : { sourcePort: path.sourcePort, targetPort: path.targetPort, orderedSegmentIds };
    });
    const segmentsById = new Map(segments.map((segment) => [segment.id, segment]));
    const samePoint = (left, right) => left && right && left.x === right.x && left.y === right.y;
    Object.entries(routesByRelationId).forEach(([relationId, route]) => {
      let current = route.sourcePort;
      const valid = route.orderedSegmentIds.length > 0 && route.orderedSegmentIds.every((id) => {
        const segment = segmentsById.get(id);
        if (!segment || !segment.relationIds.includes(relationId)) return false;
        if (samePoint(current, segment.from)) current = segment.to;
        else if (samePoint(current, segment.to)) current = segment.from;
        else return false;
        return true;
      }) && samePoint(current, route.targetPort);
      if (!valid) {
        unresolved.push({ relationId, reason: "disconnected-segments" });
        delete routesByRelationId[relationId];
      }
    });
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      segments[index].relationIds = segments[index].relationIds.filter((id) => routesByRelationId[id]);
      if (!segments[index].relationIds.length) segments.splice(index, 1);
    }
    const junctionsById = new Map();
    segments.forEach((segment) => {
      const junctionId = (point) => `junction:${JSON.stringify([segment.groupKey, point.x, point.y])}`;
      segment.fromJunctionId = junctionId(segment.from);
      segment.toJunctionId = junctionId(segment.to);
      junctionsById.set(segment.fromJunctionId, { id: segment.fromJunctionId, ...segment.from });
      junctionsById.set(segment.toJunctionId, { id: segment.toJunctionId, ...segment.to });
    });
    const result = { junctions: Array.from(junctionsById.values()), segments, routesByRelationId, unresolved };
    if (unresolved.length && attempt < 2) {
      const alternative = routeOverview(instances, relations, rows,
        new Set(unresolved.map((item) => item.relationId)), attempt + 1);
      if (alternative.unresolved.length < unresolved.length) return alternative;
    }
    return result;
  }

  function semanticLayout(graph, elkLayout) {
    const flowIndex = scope.MapInBootFlow && typeof scope.MapInBootFlow.createIndex === "function"
      ? scope.MapInBootFlow.createIndex(graph)
      : null;
    const endpointChains = confirmedEndpointChains(graph, flowIndex);
    const endpointHandlers = confirmedEndpointHandlers(graph, flowIndex);
    const positions = {};
    const elkPositions = elkLayout && elkLayout.positions ? elkLayout.positions : {};
    const endpoints = graph.nodes.filter((node) => node.type === "ENDPOINT");
    const handlers = graph.nodes.filter((node) => node.type === "HANDLER");
    const supportNodes = graph.nodes.filter((node) => ["AUTHENTICATION", "AUTHORIZATION", "SECURITY_DATA",
      "BUSINESS_SECURITY_STATE"].includes(node.type));
    const chains = graph.nodes.filter((node) => node.type === "SECURITY_CHAIN")
      .sort((left, right) => {
        const leftOrder = chainOrder(left);
        const rightOrder = chainOrder(right);
        if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) return leftOrder - rightOrder;
        if (leftOrder !== null && rightOrder === null) return -1;
        if (leftOrder === null && rightOrder !== null) return 1;
        return text(left.id).localeCompare(text(right.id));
      });
    const securityFilters = graph.nodes.filter((node) => node.type === "FILTER"
      && attributes(node).registrationKind === "SECURITY");
    const servletFilters = graph.nodes.filter((node) => node.type === "FILTER"
      && attributes(node).registrationKind === "SERVLET");
    const dispatcherServlets = graph.nodes.filter((node) => node.type === "SERVLET");
    const servletRegistration = dispatcherServlets.length === 1 && flowIndex
      && typeof flowIndex.servletFiltersForServlet === "function"
      ? flowIndex.servletFiltersForServlet(dispatcherServlets[0].id)
      : { orderStatus: "UNKNOWN", filters: [], edges: [], orderInfo: {} };
    const orderedRegisteredServletFilters = servletRegistration.orderStatus === "CONFIRMED"
      ? servletRegistration.filters.slice()
      : [];
    const filtersByChain = new Map();
    const securityFilterOrder = {};
    const chainFilterOrderStatus = {};
    const securityMembershipEdgeIds = new Set();
    const filterOrderByNode = new Map();
    chains.forEach((chain) => {
      const result = flowIndex && typeof flowIndex.securityFiltersForChain === "function"
        ? flowIndex.securityFiltersForChain(chain.id)
        : { orderStatus: "UNKNOWN", filters: [], edges: [], orderInfo: {} };
      chainFilterOrderStatus[chain.id] = result.orderStatus || "UNKNOWN";
      const uniqueFilters = Array.from(new Map((result.filters || []).map((filter) => [filter.id, filter])).values());
      const items = uniqueFilters.map((filter) => {
        const relationships = (result.edges || []).filter((edge) => edge.targetId === filter.id);
        relationships.forEach((edge) => securityMembershipEdgeIds.add(edge.id));
        const info = (result.orderInfo || {})[filter.id] || { status: "UNKNOWN", order: null, source: "NONE" };
        const previous = filterOrderByNode.get(filter.id);
        const consistent = previous && previous.status === "CONFIRMED" && info.status === "CONFIRMED"
          && previous.order === info.order;
        filterOrderByNode.set(filter.id, previous
          ? consistent ? previous : { status: "UNKNOWN", order: null, source: "CONFLICT" }
          : { ...info });
        return { filter, edge: relationships[0] || null, info };
      });
      items.sort((left, right) => result.orderStatus === "CONFIRMED"
        ? left.info.order - right.info.order || text(left.filter.id).localeCompare(text(right.filter.id))
        : text(left.filter.id).localeCompare(text(right.filter.id)));
      filtersByChain.set(chain.id, items);
    });
    Object.assign(securityFilterOrder, Object.fromEntries(filterOrderByNode));
    const orderedChainItems = (chain) => (filtersByChain.get(chain.id) || []).slice().sort((left, right) => {
      if (chainFilterOrderStatus[chain.id] === "CONFIRMED") {
        return left.info.order - right.info.order || text(left.filter.id).localeCompare(text(right.filter.id));
      }
      return text(left.filter.id).localeCompare(text(right.filter.id));
    });
    const detailPresentation = graph.presentationContext === "detail";
    const hiddenGroupPlan = detailPresentation
      ? { rows: [], groupByNode: new Map(), isolatedSupportComponents: [],
        connectedSupportNodeIds: new Set(), supportChecksByEndpoint: new Map(),
        securityColumns: Math.min(MAX_FILTER_COLUMNS, Math.max(1, Math.ceil(supportNodes.length / 8))) }
      : buildHiddenConceptualGroups(graph, chains, filtersByChain, endpoints, handlers, supportNodes,
        endpointChains, endpointHandlers, filterOrderByNode);
    const hiddenGroups = hiddenGroupPlan.rows;
    const applications = graph.nodes.filter((node) => node.type === "APPLICATION");
    const maxSecurityFilters = Math.max(1, securityFilters.length,
      ...chains.map((chain) => orderedChainItems(chain).length));
    const laneDefinitions = createLaneDefinitions({
      servletFilterCount: servletFilters.length,
      maxSecurityFilters,
      endpointCount: endpoints.length,
      securityNodeCount: detailPresentation ? supportNodes.length : hiddenGroupPlan.securityColumns * 8,
      overview: !detailPresentation,
      applicationCount: applications.length
    });
    const lanes = positionLanes(laneDefinitions);
    const endpointLane = laneDefinition("endpoint", lanes);
    const handlerLane = laneDefinition("handler", lanes);
    if (!detailPresentation) handlerLane.x = endpointLane.x + endpointLane.width + NODE_WIDTH + API_HANDLER_CORRIDOR * 2;
    const filterLane = laneDefinition("security-filter", lanes);
    const servletLane = laneDefinition("servlet-filter", lanes);
    const delegationLane = laneDefinition("security-delegation", lanes);
    const securityChecksLane = laneDefinition("security-checks", lanes);
    const mvcLane = laneDefinition("mvc", lanes);
    const mappingLane = laneDefinition("mvc-mapping", lanes);
    const chainLane = laneDefinition("security-chain", lanes);
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
      const leftOrder = chainOrder(leftChain);
      const rightOrder = chainOrder(rightChain);
      if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) return leftOrder - rightOrder;
      if (leftOrder !== null && rightOrder === null) return -1;
      if (leftOrder === null && rightOrder !== null) return 1;
      return text(left[0]).localeCompare(text(right[0]));
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
    // 미확정·고립 행을 제외한 Chain 확인 행만 주 흐름 높이에 반영
    const confirmedRows = hiddenGroups.filter((row) => row.membershipStatus === "CONFIRMED");
    const hiddenRowStackHeight = confirmedRows.reduce((total, row, index) => total + row.rowHeight
      + (index < confirmedRows.length - 1 ? CHAIN_GAP : 0), 0);
    const mainHeight = Math.max(servletHeight, dispatcherHeight, chainStackHeight, endpointHeight,
      blockHeight(new Set(controllerKeys).size), hiddenRowStackHeight);
    const mainCenterY = ACTUAL_Y + mainHeight / 2;
    const laneOffset = 100;
    const targetCenterY = mainCenterY + laneOffset;
    const centeredStart = (height) => mainCenterY - Math.max(NODE_HEIGHT, height) / 2;
    const servletStartY = centeredStart(servletHeight);
    const dispatcherStartY = centeredStart(dispatcherHeight);
    const chainStartY = centeredStart(chainStackHeight);
    const endpointStartY = centeredStart(endpointHeight);
    const handlerStartY = centeredStart(Math.max(endpointHeight, blockHeight(handlers.length)));

    applications.forEach((node, index) => {
      positions[node.id] = { x: lanes[0].x, y: centeredStart(blockHeight(applications.length)) + index * ROW_STEP };
    });
    const servletFilterOrder = {};
    servletFilters.forEach((filter) => {
      const relationshipInfo = (servletRegistration.orderInfo || {})[filter.id];
      const info = relationshipInfo && relationshipInfo.status !== "UNKNOWN"
        ? relationshipInfo : servletReference(filter);
      servletFilterOrder[filter.id] = info;
    });
    const orderedServletFilters = servletFilters.slice().sort((left, right) => {
      const leftInfo = servletFilterOrder[left.id];
      const rightInfo = servletFilterOrder[right.id];
      const leftOrder = leftInfo.order === null ? Number.POSITIVE_INFINITY : leftInfo.order;
      const rightOrder = rightInfo.order === null ? Number.POSITIVE_INFINITY : rightInfo.order;
      return leftOrder - rightOrder || text(left.id).localeCompare(text(right.id));
    });
    orderedServletFilters.forEach((filter, index) => {
      positions[filter.id] = filterPosition(servletLane, index, servletStartY);
    });
    dispatcherServlets.forEach((node, index) => {
      const data = attributes(node);
      const isDispatcher = data.servletKind === "DISPATCHER"
        || text(data.servletClass).endsWith(".DispatcherServlet")
        || text(data.servletName).toLowerCase() === "dispatcherservlet";
      if (!detailPresentation && isDispatcher) return;
      positions[node.id] = { x: detailPresentation ? mvcLane.x + COLUMN_STEP : servletLane.x,
        y: dispatcherStartY + (detailPresentation ? index : servletRows + index) * ROW_STEP };
    });

    const chainGroups = [];
    let chainCursorY = chainStartY;
    chains.forEach((chain) => {
      const y = chainCursorY;
      positions[chain.id] = { x: chainLane.x, y };
      const items = orderedChainItems(chain);
      items.forEach(({ filter }, itemIndex) => {
        if (!positions[filter.id]) positions[filter.id] = filterPosition(filterLane, itemIndex, y);
      });
      const positionedFilterIds = items.map(({ filter }) => filter.id)
        .filter((id) => detailPresentation || hiddenGroupPlan.groupByNode.get(id)?.has("chain:" + chain.id));
      const positionedNodeIds = [chain.id, ...positionedFilterIds];
      const rows = filterRows(positionedFilterIds.length);
      const lastRow = Math.max(0, rows - 1);
      const reservedBottom = y + lastRow * ROW_STEP + NODE_HEIGHT + NODE_SAFE_MARGIN;
      const memberPositions = positionedNodeIds.map((id) => positions[id]).filter(Boolean);
      const left = Math.min(...memberPositions.map((position) => position.x)) - NODE_SAFE_MARGIN;
      const top = Math.min(...memberPositions.map((position) => position.y)) - 36;
      const right = Math.max(...memberPositions.map((position) => position.x + NODE_WIDTH)) + NODE_SAFE_MARGIN;
      const bottom = Math.max(...memberPositions.map((position) => position.y + NODE_HEIGHT)) + NODE_SAFE_MARGIN;
      const orderStatus = chainFilterOrderStatus[chain.id] || "UNKNOWN";
      chainGroups.push({
        id: chain.id,
        label: `체인 ${attributes(chain).chainOrder || "?"} · ${attributes(chain).matcherCondition || "조건 확인 불가"}${orderStatus !== "CONFIRMED" ? " · 필터 순서 확인 불가" : ""}`,
        top,
        bottom,
        left,
        right,
        nodeIds: [chain.id, ...items.map(({ filter }) => filter.id)],
        positionedNodeIds,
        filterOrderStatus: orderStatus
      });
      chainCursorY = reservedBottom + CHAIN_GAP;
    });
    securityFilters.filter((node) => !positions[node.id]).sort((left, right) => text(left.id).localeCompare(text(right.id)))
      .forEach((filter, index) => {
        positions[filter.id] = filterPosition(filterLane, index, chainCursorY);
        securityFilterOrder[filter.id] = securityFilterOrder[filter.id]
          || { status: "UNKNOWN", order: null, source: "NONE" };
      });
    graph.nodes.filter((node) => node.type === "FILTER" && !positions[node.id])
      .sort((left, right) => text(left.id).localeCompare(text(right.id)))
      .forEach((filter, index) => {
        positions[filter.id] = filterPosition(filterLane, index, chainCursorY);
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
      const rowIds = detailPresentation ? [null] : Array.from(hiddenGroupPlan.groupByNode.get(handler.id) || []);
      (rowIds.length ? rowIds : [null]).forEach((layoutGroupId) => {
        const groupKey = JSON.stringify([layoutGroupId, controllerFqcn]);
        const group = controllerGroupsByOwner.get(groupKey) || {
          id: "",
          controllerFqcn,
          controllerName: controllerFqcn.slice(controllerFqcn.lastIndexOf(".") + 1),
          layoutGroupId,
          handlerIds: [],
          handlerMethods: [],
          endpointIds: []
        };
        group.handlerIds.push(handler.id);
        group.handlerMethods.push(handlerValue);
        controllerGroupsByOwner.set(groupKey, group);
      });
    });
    const controllerGroups = Array.from(controllerGroupsByOwner.values())
      .sort((left, right) => {
        const rowOrder = new Map(hiddenGroups.map((group, index) => [group.id, index]));
        return (rowOrder.get(left.layoutGroupId) ?? Number.MAX_SAFE_INTEGER)
          - (rowOrder.get(right.layoutGroupId) ?? Number.MAX_SAFE_INTEGER)
          || left.controllerFqcn.localeCompare(right.controllerFqcn);
      });
    const controllerCountByOwner = new Map();
    controllerGroups.forEach((group) => controllerCountByOwner.set(group.controllerFqcn,
      (controllerCountByOwner.get(group.controllerFqcn) || 0) + 1));
    controllerGroups.forEach((group, index) => {
      group.id = controllerCountByOwner.get(group.controllerFqcn) === 1
        ? `controller-group:${group.controllerFqcn}`
        : `controller-group:${group.controllerFqcn}:${group.layoutGroupId}`;
      group.endpointIds = Array.from(endpointHandlers.entries())
        .filter(([endpointId, handler]) => group.handlerIds.includes(handler.id)
          && (detailPresentation || hiddenGroupPlan.groupByNode.get(endpointId)?.has(group.layoutGroupId)))
        .map(([endpointId]) => endpointId);
      group.position = { x: handlerLane.x, y: centeredStart(blockHeight(controllerGroups.length)) + index * ROW_STEP };
    });

    const rowStartY = targetCenterY - hiddenRowStackHeight / 2;
    const rowPositions = detailPresentation ? new Map()
      : positionHiddenConceptualGroups(hiddenGroups, positions, graph, endpointHandlers, elkPositions, lanes, rowStartY,
        controllerGroups).positionsByRow;

    const nodeToDisplay = Object.fromEntries(graph.nodes.map((node) => [node.id, node.id]));
    controllerGroups.forEach((group) => group.handlerIds.forEach((id) => {
      if (nodeToDisplay[id] === id) nodeToDisplay[id] = group.id;
    }));
    const groups = [];
    if (detailPresentation) {
      const ownerByNode = new Map();
      controllerGroups.forEach((group) => group.handlerIds.forEach((id) => ownerByNode.set(id, new Set([group.id]))));
      graph.nodes.filter((node) => node.type === "FILTER" || node.type === "SECURITY_CHAIN")
        .forEach((node) => ownerByNode.set(node.id, new Set([node.id])));
      const detailSupportTypes = new Set(["AUTHORIZATION", "SECURITY_DATA"]);
      const uncertainOwners = new Set(graph.edges.filter((edge) => SUPPORT_EDGE_TYPES.has(edge.type)
        && edge.confidence !== "CONFIRMED").map((edge) => edge.targetId));
      for (let pass = 0; pass < graph.nodes.length; pass += 1) {
        let changed = false;
        graph.edges.filter((edge) => SUPPORT_EDGE_TYPES.has(edge.type) && edge.confidence === "CONFIRMED")
          .forEach((edge) => {
            const target = graph.nodes.find((node) => node.id === edge.targetId);
            const owners = ownerByNode.get(edge.sourceId);
            if (uncertainOwners.has(edge.sourceId) && target && detailSupportTypes.has(target.type)
              && !uncertainOwners.has(target.id)) { uncertainOwners.add(target.id); changed = true; }
            if (!target || !detailSupportTypes.has(target.type) || !owners) return;
            const targetOwners = ownerByNode.get(target.id) || new Set();
            owners.forEach((owner) => {
              if (!targetOwners.has(owner)) { targetOwners.add(owner); changed = true; }
            });
            ownerByNode.set(target.id, targetOwners);
          });
        if (!changed) break;
      }
      const grouped = new Map();
      graph.nodes.filter((node) => detailSupportTypes.has(node.type)).forEach((node) => {
        const owners = ownerByNode.get(node.id);
        if (!owners || owners.size !== 1 || uncertainOwners.has(node.id)) return;
        const ownerId = Array.from(owners)[0];
        const scope = supportDisplayScope(node);
        const key = JSON.stringify([node.type, ownerId, scope]);
        const group = grouped.get(key) || {
          id: `display-group:${key}`, type: node.type, ownerId, scope,
          semanticKey: supportDisplaySemantic(node).key, nodeIds: [], handlerIds: [], endpointIds: [], edgeIds: []
        };
        group.nodeIds.push(node.id);
        grouped.set(key, group);
      });
      groups.push(...grouped.values());
    } else {
      groups.push(...hiddenGroupPlan.rows.flatMap((row) => row.displayGroups));
    }
    if (!detailPresentation) supportNodes.forEach((node) => { nodeToDisplay[node.id] = node.id; });
    groups.forEach((group) => group.nodeIds.forEach((id) => {
      if (nodeToDisplay[id] === id) nodeToDisplay[id] = group.id;
      group.handlerIds = group.nodeIds;
      group.edgeIds = graph.edges.filter((edge) => group.nodeIds.includes(edge.sourceId)
        || group.nodeIds.includes(edge.targetId)).map((edge) => edge.id);
      if (!detailPresentation) {
        group.position = group.position || rowPositions.get(group.rowId)?.get(group.nodeIds[0]) || positions[group.nodeIds[0]];
        group.endpointIds = Array.from(hiddenGroupPlan.supportChecksByEndpoint.entries())
          .filter(([endpointId, checks]) => group.nodeIds.some((nodeId) => checks.has(nodeId))
            && hiddenGroupPlan.groupByNode.get(endpointId)?.has(group.rowId))
          .map(([endpointId]) => endpointId);
        const row = hiddenGroups.find((candidate) => candidate.id === group.rowId);
        const chain = row && graph.nodes.find((node) => node.id === row.chainId);
        group.controllerName = chain ? `Chain ${attributes(chain).chainOrder || "?"}`
          : row && row.membershipStatus === "ISOLATED" ? "연결 확인 불가" : "확인되지 않은 Chain";
        group.controllerFqcn = group.controllerName;
      } else group.position = positions[group.nodeIds[0]];
    }));

    const displayIdForRow = (nodeId, rowId) => {
      if (rowId === null || rowId === undefined) return positions[nodeId] ? nodeId : null;
      const controller = controllerGroups.find((group) => group.layoutGroupId === rowId
        && group.handlerIds.includes(nodeId));
      if (controller) return controller.id;
      const supportGroup = groups.find((group) => group.rowId === rowId && group.nodeIds.includes(nodeId));
      if (supportGroup) return supportGroup.id;
      const rowIds = hiddenGroupPlan.groupByNode.get(nodeId);
      if (!rowIds || !rowIds.has(rowId) || !rowPositions.get(rowId)?.has(nodeId)) return null;
      return rowIds.size > 1 ? `display:${rowId}:${nodeId}` : nodeId;
    };

    let displayToNodes = {};
    graph.nodes.forEach((node) => {
      const id = nodeToDisplay[node.id];
      (displayToNodes[id] || (displayToNodes[id] = [])).push(node.id);
    });
    let edgeToDisplay = {};
    let displayToEdges = {};
    let displayEdges = new Map();
    graph.edges.forEach((edge) => {
      const sourceId = nodeToDisplay[edge.sourceId];
      const targetId = nodeToDisplay[edge.targetId];
      const key = JSON.stringify([sourceId, targetId, edge.type]);
      const id = `display-edge:${key}`;
      edgeToDisplay[edge.id] = id;
      (displayToEdges[id] || (displayToEdges[id] = [])).push(edge.id);
      if (sourceId !== targetId && !displayEdges.has(id)) displayEdges.set(id, { id, sourceId, targetId, type: edge.type });
    });
    const displayModel = { groups, nodeToDisplay, displayToNodes, edgeToDisplay, displayToEdges,
      edges: Array.from(displayEdges.values()), instances: [], originalNodeToInstanceIds: {},
      instanceToOriginalNodeIds: {}, displayEdgeInstances: [], originalEdgeToInstanceIds: {} };

    const supportAnchors = {};
    const isolatedSupportIds = new Set(hiddenGroupPlan.isolatedSupportComponents.flatMap((component) => component.nodeIds));
    hiddenGroupPlan.rows.filter((row) => row.membershipStatus !== "CONFIRMED")
      .flatMap((row) => row.members.securityChecks)
      .forEach((id) => { supportAnchors[id] = { status: "UNKNOWN", anchorId: null }; });
    const supportPlans = supportNodes.filter((node) => !isolatedSupportIds.has(node.id)
      && (detailPresentation || !hiddenGroupPlan.groupByNode.has(node.id)))
      .map((node) => ({ node, anchor: supportSource(graph, positions, node) }))
      .sort((left, right) => Number(!left.anchor) - Number(!right.anchor) || text(left.node.id).localeCompare(text(right.node.id)));
    const supportColumns = securityChecksLane.columns;
    const unanchoredRows = Math.ceil(supportPlans.filter((item) => !item.anchor).length / supportColumns);
    const unanchoredStartY = Math.max(TOP_PADDING, centeredStart(blockHeight(unanchoredRows)));
    const availableSupportPosition = (baseY) => {
      for (let row = 0; row < supportPlans.length + 2; row += 1) {
        for (let column = 0; column < supportColumns; column += 1) {
          const candidate = { x: securityChecksLane.x + column * COLUMN_STEP, y: baseY + row * ROW_STEP };
          const occupied = Object.values(positions).concat(controllerGroups.map((group) => group.position)).some((position) =>
            position.x - NODE_SAFE_MARGIN < candidate.x + NODE_WIDTH + NODE_SAFE_MARGIN
            && position.x + NODE_WIDTH + NODE_SAFE_MARGIN > candidate.x - NODE_SAFE_MARGIN
            && position.y - NODE_SAFE_MARGIN < candidate.y + NODE_HEIGHT + NODE_SAFE_MARGIN
            && position.y + NODE_HEIGHT + NODE_SAFE_MARGIN > candidate.y - NODE_SAFE_MARGIN);
          if (!occupied) return candidate;
        }
      }
      return { x: securityChecksLane.x, y: baseY + supportPlans.length * ROW_STEP };
    };
    supportPlans.forEach(({ node, anchor }) => {
      const controller = anchor && controllerGroups.find((group) => group.handlerIds.includes(anchor.id));
      const anchorPosition = controller ? controller.position : anchor ? positions[anchor.id] : null;
      positions[node.id] = availableSupportPosition(anchorPosition ? anchorPosition.y : unanchoredStartY);
      supportAnchors[node.id] = { status: anchor ? "CONFIRMED" : "UNKNOWN", anchorId: anchor ? anchor.id : null };
    });
    if (detailPresentation) groups.forEach((group) => {
      group.position = positions[group.nodeIds[0]];
      const controller = controllerGroups.find((candidate) => candidate.id === group.ownerId);
      const owner = graph.nodes.find((node) => node.id === group.ownerId);
      group.controllerName = controller ? controller.controllerName : owner ? owner.label : "소속 확인 불가";
      group.controllerFqcn = controller ? controller.controllerFqcn : group.controllerName;
    });
    const visibleHiddenRowPositions = (rowId) => {
      const rowMap = rowPositions.get(rowId);
      const visiblePositions = rowMap
        ? Array.from(rowMap.entries()).filter(([nodeId]) => nodeToDisplay[nodeId] === nodeId).map(([, position]) => position)
        : [];
      visiblePositions.push(...controllerGroups.filter((group) => group.layoutGroupId === rowId).map((group) => group.position));
      visiblePositions.push(...groups.filter((group) => group.rowId === rowId).map((group) => group.position));
      return visiblePositions;
    };

    if (detailPresentation) {
      const shiftForLane = (position) => {
        position.y += position.y + NODE_HEIGHT / 2 < mainCenterY ? 0 : laneOffset * 2;
      };
      Object.values(positions).forEach(shiftForLane);
      controllerGroups.forEach((group) => shiftForLane(group.position));
    } else {
      const sectionNodeIds = {
        request: applications.map((node) => node.id),
        servletFilter: servletFilters.map((node) => node.id).concat(dispatcherServlets.filter((node) => positions[node.id]).map((node) => node.id)),
        mvc: []
      };
      Object.values(sectionNodeIds).forEach((nodeIds) => {
        const memberPositions = nodeIds.map((id) => positions[id]).filter(Boolean);
        if (!memberPositions.length) return;
        const offset = targetCenterY - ((Math.min(...memberPositions.map((position) => position.y))
          + Math.max(...memberPositions.map((position) => position.y + NODE_HEIGHT))) / 2);
        memberPositions.forEach((position) => { position.y += offset; });
      });
    }
    chainGroups.forEach((group) => {
      const members = !detailPresentation
        ? visibleHiddenRowPositions(`chain:${group.id}`)
        : (group.positionedNodeIds || group.nodeIds).map((id) => positions[id]).filter(Boolean);
      if (!members.length) return;
      group.top = Math.min(...members.map((position) => position.y)) - 36;
      group.bottom = Math.max(...members.map((position) => position.y + NODE_HEIGHT)) + NODE_SAFE_MARGIN;
    });
    hiddenGroups.forEach((group) => {
      const memberPositions = visibleHiddenRowPositions(group.id);
      if (!memberPositions.length) return;
      group.rowTop = Math.min(...memberPositions.map((position) => position.y)) - NODE_SAFE_MARGIN;
      group.rowBottom = Math.max(...memberPositions.map((position) => position.y + NODE_HEIGHT)) + NODE_SAFE_MARGIN;
      group.rowHeight = group.rowBottom - group.rowTop;
    });
    let actualBottom = Math.max(
      NODE_HEIGHT,
      ...Object.values(positions).map((position) => position.y + NODE_HEIGHT),
      ...hiddenGroups.map((row) => row.rowBottom || 0)
    );
    const educationStartY = targetCenterY - NODE_HEIGHT / 2;
    const EDUCATION_Y = educationStartY;

    const sectionBoundsForPlan = (nodeIds, includeChainGroups = false) => {
      const displayIds = Array.from(new Set(nodeIds.map((id) => nodeToDisplay[id] || id)));
      const memberPositions = displayIds.map((id) => {
        const group = controllerGroups.concat(groups).find((candidate) => candidate.id === id);
        return group && group.position || positions[id];
      }).filter(Boolean);
      if (memberPositions.length === 0) return null;
      let top = Math.min(...memberPositions.map((position) => position.y));
      let bottom = Math.max(...memberPositions.map((position) => position.y + NODE_HEIGHT));
      if (includeChainGroups) {
        const nodeIdsSet = new Set(nodeIds);
        const sectionGroups = chainGroups.filter((group) => (group.positionedNodeIds || group.nodeIds)
          .some((id) => nodeIdsSet.has(id)));
        if (sectionGroups.length) {
          top = Math.min(top, ...sectionGroups.map((group) => group.top));
          bottom = Math.max(bottom, ...sectionGroups.map((group) => group.bottom));
        }
      }
      return { top, bottom };
    };
    const measuredSectionAlignment = (nodeIds, includeChainGroups = false) => {
      const bounds = sectionBoundsForPlan(nodeIds, includeChainGroups);
      return bounds ? { top: bounds.top, height: bounds.bottom - bounds.top,
        centerY: (bounds.top + bounds.bottom) / 2, nodeIds: nodeIds.slice() } : null;
    };
    const sectionAlignment = {
      request: measuredSectionAlignment(applications.map((node) => node.id)),
      servletFilter: measuredSectionAlignment(servletFilters.map((node) => node.id)),
      security: measuredSectionAlignment(chains.concat(securityFilters).map((node) => node.id), true),
      securityChecks: detailPresentation ? null
        : measuredSectionAlignment(Array.from(hiddenGroupPlan.connectedSupportNodeIds)),
      mvc: measuredSectionAlignment(dispatcherServlets.map((node) => node.id)),
      endpoint: measuredSectionAlignment(endpoints.map((node) => node.id)),
      handler: measuredSectionAlignment(handlers.map((node) => node.id))
    };
    const sharedRowsTop = hiddenGroups.length ? Math.min(...hiddenGroups.map((group) => group.rowTop)) : chainStartY;
    const sharedRowsBottom = hiddenGroups.length ? Math.max(...hiddenGroups.map((group) => group.rowBottom)) : chainStartY + chainStackHeight;
    const sharedRowsAlignment = {
      top: sharedRowsTop,
      height: sharedRowsBottom - sharedRowsTop,
      centerY: (sharedRowsTop + sharedRowsBottom) / 2
    };
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

    const projectionNodes = detailPresentation ? [
      projectionNode("education-http-request", "HTTP 요청 수신", "일반적인 Servlet 처리 원리", 0, EDUCATION_Y),
      projectionNode("education-request-prepare", "요청 정보 준비", "HttpServletRequest와 HttpServletResponse 준비", 1, EDUCATION_Y),
      projectionNode("education-thread-context", "동기 처리 문맥", "동기식 Servlet의 일반 처리 문맥", 2, EDUCATION_Y),
      projectionNode("education-servlet-filter-chain", "FilterChain 전달", "Filter#doFilter에서 다음 Filter로 제어 전달", 3, EDUCATION_Y),
      projectionNode("education-delegating-filter-proxy", "DelegatingFilterProxy", "Servlet Filter에서 Spring Security로 처리 위임", delegationLane.column, EDUCATION_Y),
      projectionNode("education-filter-chain-proxy", "FilterChainProxy", "등록된 SecurityFilterChain 평가", delegationLane.column + 1, EDUCATION_Y),
      projectionNode("education-request-matcher", "RequestMatcher 평가", chains.map((chain) => `체인 ${attributes(chain).chainOrder || "?"}`).join(" · ") || "체인 확인 불가", delegationLane.column + 2, EDUCATION_Y),
      ...(detailPresentation ? [projectionNode("education-servlet-chain-continue", "Servlet FilterChain 계속", "앞선 처리 결과에 따라 이후 단계에 도달하지 않을 수 있음", mvcLane.column, EDUCATION_Y)] : []),
      projectionNode("education-handler-mapping", "HandlerMapping", "요청 정보에 맞는 Handler 조회", mappingLane.column, EDUCATION_Y),
      ...(detailPresentation ? [projectionNode("education-handler-adapter", "HandlerAdapter", "Controller·Handler 호출 준비", mappingLane.column + 1, EDUCATION_Y)] : [])
    ] : [];
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
    if (detailPresentation) ["education-http-request", "education-request-prepare", "education-thread-context", "education-servlet-filter-chain"]
      .reduce((previous, current) => {
        if (previous) addProjectionEdge(`education-${previous}-${current}`, previous, current);
        return current;
      }, null);
    if (detailPresentation && orderedRegisteredServletFilters.length > 0) {
      addProjectionEdge("education-servlet-filter-chain-to-first", "education-servlet-filter-chain", orderedRegisteredServletFilters[0].id,
        { flowGroup: "servlet-filter", projectionKind: "servlet-filter-order", orderIndex: 0 });
      orderedRegisteredServletFilters.slice(0, -1).forEach((filter, index) => {
        const nextIndex = index + 1;
        addProjectionEdge(`servlet-flow-${index}`, filter.id, orderedRegisteredServletFilters[nextIndex].id, {
          flowGroup: "servlet-filter",
          projectionKind: "servlet-filter-order",
          orderIndex: nextIndex,
          routeKind: nextIndex % MAX_FILTER_COLUMNS === 0 ? "filter-wrap" : "direct"
        });
      });
      addProjectionEdge("servlet-flow-to-delegating", orderedRegisteredServletFilters[orderedRegisteredServletFilters.length - 1].id,
        "education-delegating-filter-proxy", { flowGroup: "servlet-filter", projectionKind: "servlet-filter-order" });
    } else if (detailPresentation) {
      addProjectionEdge("education-servlet-filter-chain-to-delegating", "education-servlet-filter-chain", "education-delegating-filter-proxy");
    }
    if (detailPresentation) addProjectionEdge("delegating-to-proxy", "education-delegating-filter-proxy", "education-filter-chain-proxy");
    if (detailPresentation) addProjectionEdge("proxy-to-matcher", "education-filter-chain-proxy", "education-request-matcher");
    chains.forEach((chain) => {
      if (detailPresentation) addProjectionEdge(`matcher-to-${chain.id}`, "education-request-matcher", chain.id);
      const items = orderedChainItems(chain);
      const rowId = `chain:${chain.id}`;
      const chainDisplayId = displayIdForRow(chain.id, rowId) || chain.id;
      const filterDisplayId = (filterId) => detailPresentation ? filterId : displayIdForRow(filterId, rowId);
      if (items.length > 0 && chainFilterOrderStatus[chain.id] === "CONFIRMED") {
        const firstFilterId = filterDisplayId(items[0].filter.id);
        if (firstFilterId) addProjectionEdge(`chain-to-filter-${chain.id}`, chainDisplayId, firstFilterId,
          { flowGroup: chain.id, projectionKind: "security-filter-order", orderIndex: 0 });
        items.slice(0, -1).forEach((item, index) => {
          const nextIndex = index + 1;
          const sourceId = filterDisplayId(item.filter.id);
          const targetId = filterDisplayId(items[nextIndex].filter.id);
          if (!sourceId || !targetId) return;
          addProjectionEdge(`filter-flow-${chain.id}-${index}`, sourceId, targetId, {
            flowGroup: chain.id,
            projectionKind: "security-filter-order",
            orderIndex: nextIndex,
            routeKind: nextIndex % MAX_FILTER_COLUMNS === 0 ? "filter-wrap" : "direct"
          });
        });
        const lastFilterId = filterDisplayId(items[items.length - 1].filter.id);
        if (lastFilterId && detailPresentation) addProjectionEdge(`filter-to-continue-${chain.id}`, lastFilterId,
          "education-servlet-chain-continue", { flowGroup: chain.id, projectionKind: "security-filter-order" });
        if (lastFilterId && !detailPresentation) {
          const row = hiddenGroups.find((candidate) => candidate.id === rowId);
          const chainSubjects = new Set([chain.id]);
          const eligible = (nodeId) => {
            const node = graph.nodes.find((candidate) => candidate.id === nodeId);
            if (!node) return false;
            if (node.type === "BUSINESS_SECURITY_STATE"
              || (node.type === "AUTHORIZATION" && attributes(node).policySource !== "URL")) return false;
            if (node.type === "AUTHORIZATION" && attributes(node).policySource === "URL"
              && text(attributes(node).chainKey) === text(attributes(chain).chainKey)
              && text(attributes(chain).chainKey)) return true;
            return graph.edges.some((edge) => edge.confidence === "CONFIRMED" && SUPPORT_EDGE_TYPES.has(edge.type)
              && ((chainSubjects.has(edge.sourceId) && edge.targetId === nodeId)
                || (chainSubjects.has(edge.targetId) && edge.sourceId === nodeId)));
          };
          (row && row.securityEntries || []).forEach((entry) => {
            if (!entry.nodeIds.length || !entry.nodeIds.every(eligible)) return;
            const targetId = displayIdForRow(entry.nodeIds[0], rowId);
            if (targetId) addProjectionEdge(`filter-to-check-${chain.id}-${entry.nodeIds[0]}`, lastFilterId, targetId,
              { flowGroup: chain.id, projectionKind: "security-check-overview", relatedNodeIds: entry.nodeIds });
          });
        }
      } else if (items.length === 0 && chainFilterOrderStatus[chain.id] === "CONFIRMED") {
        if (detailPresentation) addProjectionEdge(`chain-to-continue-${chain.id}`, chainDisplayId, "education-servlet-chain-continue",
          { flowGroup: chain.id, projectionKind: "empty-chain-education" });
      }
    });
    if (detailPresentation) addProjectionEdge("continue-to-dispatcher", "education-servlet-chain-continue", dispatcherServlets[0] ? dispatcherServlets[0].id : "education-handler-mapping");
    if (detailPresentation && dispatcherServlets.length > 0) addProjectionEdge("dispatcher-to-handler-mapping", dispatcherServlets[0].id, "education-handler-mapping");
    endpoints.forEach((endpoint) => {
      const chain = endpointChains.get(endpoint.id);
      const rowId = chain ? `chain:${chain.id}` : "unresolved";
      const endpointDisplayId = detailPresentation ? endpoint.id : displayIdForRow(endpoint.id, rowId) || endpoint.id;
      if (detailPresentation) {
        addProjectionEdge(`mapping-to-${endpoint.id}`, "education-handler-mapping", endpointDisplayId);
        addProjectionEdge(`endpoint-to-adapter-${endpoint.id}`, endpointDisplayId, "education-handler-adapter");
      }
    });
    if (detailPresentation) handlers.forEach((handler) =>
      addProjectionEdge(`adapter-to-${handler.id}`, "education-handler-adapter", handler.id));

    if (isolatedSupportIds.size > 0) {
      Array.from(isolatedSupportIds).forEach((id) => {
        supportAnchors[id] = { status: "UNKNOWN", anchorId: null };
      });
      actualBottom = Math.max(actualBottom, ...hiddenGroups.filter((row) => row.id === "isolated")
        .map((row) => row.rowBottom || 0));
    }

    const rowOrder = new Map(hiddenGroups.map((row, index) => [row.id, index]));
    const instanceByNode = new Map(graph.nodes.map((node) => [node.id, []]));
    const groupInstances = controllerGroups.map((group) => ({
      id: group.id, rowId: group.layoutGroupId, originalNodeIds: group.handlerIds.slice(),
      displayType: "HANDLER", kind: "controller-group", position: group.position
    })).concat(groups.map((group) => ({
      id: group.id, rowId: group.rowId || null, originalNodeIds: group.nodeIds.slice(),
      displayType: group.type, kind: "support-group", position: group.position
    })));
    groupInstances.forEach((instance) => instance.originalNodeIds.forEach((nodeId) => {
      instanceByNode.get(nodeId)?.push(instance);
    }));
    const displayInstances = groupInstances.slice();
    graph.nodes.forEach((node) => {
      const groupedRowIds = new Set((instanceByNode.get(node.id) || []).map((instance) => instance.rowId));
      const rowIds = detailPresentation ? [] : Array.from(hiddenGroupPlan.groupByNode.get(node.id) || []);
      const visibleRows = rowIds.filter((rowId) => !groupedRowIds.has(rowId));
      const instanceRows = visibleRows.length ? visibleRows : rowIds.length || groupedRowIds.size ? [] : [null];
      instanceRows.forEach((rowId) => {
        const position = rowId ? rowPositions.get(rowId)?.get(node.id) : positions[node.id];
        if (!position) return;
        const id = rowIds.length > 1 && rowId ? `display:${rowId}:${node.id}` : node.id;
        const instance = { id, rowId, originalNodeIds: [node.id], displayType: node.type, kind: "node", position };
        displayInstances.push(instance);
        instanceByNode.get(node.id).push(instance);
      });
    });
    const representedNodeIds = new Set(displayInstances.flatMap((instance) => instance.originalNodeIds));
    graph.nodes.filter((node) => nodeToDisplay[node.id] === node.id && !representedNodeIds.has(node.id)
      && positions[node.id]).forEach((node) => {
      const instance = { id: node.id, rowId: null, originalNodeIds: [node.id], displayType: node.type,
        kind: "node", position: positions[node.id] };
      displayInstances.push(instance);
      instanceByNode.get(node.id).push(instance);
    });
    const sourceOrder = new Map(graph.nodes.map((node, index) => [node.id, index]));
    displayInstances.sort((left, right) => Math.min(...left.originalNodeIds.map((id) => sourceOrder.get(id) ?? Number.MAX_SAFE_INTEGER))
      - Math.min(...right.originalNodeIds.map((id) => sourceOrder.get(id) ?? Number.MAX_SAFE_INTEGER))
      || (rowOrder.get(left.rowId) ?? Number.MAX_SAFE_INTEGER)
        - (rowOrder.get(right.rowId) ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id));
    const originalNodeToInstanceIds = {};
    const instanceToOriginalNodeIds = {};
    const displayToNodesByInstance = {};
    displayInstances.forEach((instance) => {
      instanceToOriginalNodeIds[instance.id] = instance.originalNodeIds.slice();
      displayToNodesByInstance[instance.id] = instance.originalNodeIds.slice();
      instance.originalNodeIds.forEach((nodeId) => {
        const ids = originalNodeToInstanceIds[nodeId] || (originalNodeToInstanceIds[nodeId] = []);
        if (!ids.includes(instance.id)) ids.push(instance.id);
      });
    });
    Object.keys(originalNodeToInstanceIds).forEach((nodeId) => {
      originalNodeToInstanceIds[nodeId].sort((leftId, rightId) => {
        const left = displayInstances.find((item) => item.id === leftId);
        const right = displayInstances.find((item) => item.id === rightId);
        return (rowOrder.get(left && left.rowId) ?? Number.MAX_SAFE_INTEGER)
          - (rowOrder.get(right && right.rowId) ?? Number.MAX_SAFE_INTEGER) || leftId.localeCompare(rightId);
      });
      nodeToDisplay[nodeId] = originalNodeToInstanceIds[nodeId][0];
    });
    displayToNodes = displayToNodesByInstance;
    edgeToDisplay = {};
    displayToEdges = {};
    displayEdges = new Map();
    graph.edges.forEach((edge) => {
      const sourceId = nodeToDisplay[edge.sourceId] || edge.sourceId;
      const targetId = nodeToDisplay[edge.targetId] || edge.targetId;
      const key = JSON.stringify([sourceId, targetId, edge.type]);
      const id = `display-edge:${key}`;
      edgeToDisplay[edge.id] = id;
      (displayToEdges[id] || (displayToEdges[id] = [])).push(edge.id);
      if (sourceId !== targetId && !displayEdges.has(id)) displayEdges.set(id, { id, sourceId, targetId, type: edge.type });
    });
    displayModel.nodeToDisplay = nodeToDisplay;
    displayModel.displayToNodes = displayToNodes;
    displayModel.edgeToDisplay = edgeToDisplay;
    displayModel.displayToEdges = displayToEdges;
    displayModel.edges = Array.from(displayEdges.values());
    displayModel.instances = displayInstances;
    displayModel.originalNodeToInstanceIds = originalNodeToInstanceIds;
    displayModel.instanceToOriginalNodeIds = instanceToOriginalNodeIds;
    const sectionDisplayBounds = (nodeIds) => {
      const instanceIds = Array.from(new Set(nodeIds.flatMap((nodeId) => originalNodeToInstanceIds[nodeId] || [])));
      const memberPositions = instanceIds.map((id) => displayInstances.find((instance) => instance.id === id)?.position)
        .filter(Boolean);
      if (!memberPositions.length) return null;
      const top = Math.min(...memberPositions.map((position) => position.y));
      const bottom = Math.max(...memberPositions.map((position) => position.y + NODE_HEIGHT));
      return { top, height: bottom - top, centerY: (top + bottom) / 2 };
    };
    ["security", "securityChecks", "endpoint", "handler"].forEach((sectionId) => {
      const section = sectionAlignment[sectionId];
      const bounds = section && sectionDisplayBounds(section.nodeIds);
      if (bounds) Object.assign(section, bounds);
    });
    const originalEdgeToInstanceIds = {};
    const displayEdgeInstances = [];
    const displayBundles = new Map();
    graph.edges.forEach((edge) => {
      const sourceInstances = instanceByNode.get(edge.sourceId) || [];
      const targetInstances = instanceByNode.get(edge.targetId) || [];
      const commonRows = new Set(sourceInstances.map((instance) => instance.rowId));
      const sharedRows = Array.from(new Set(targetInstances.map((instance) => instance.rowId)))
        .filter((rowId) => commonRows.has(rowId));
      const rowIds = sharedRows.length ? sharedRows
        : sourceInstances.length === 1 && targetInstances.length === 1
          ? [sourceInstances[0].rowId === targetInstances[0].rowId ? sourceInstances[0].rowId : null]
          : [];
      rowIds.forEach((rowId) => {
        const sourceInstance = sourceInstances.find((instance) => instance.rowId === rowId)
          || (sourceInstances.length === 1 ? sourceInstances[0] : null);
        const targetInstance = targetInstances.find((instance) => instance.rowId === rowId)
          || (targetInstances.length === 1 ? targetInstances[0] : null);
        if (!sourceInstance || !targetInstance) return;
        const key = JSON.stringify([rowId, sourceInstance.id, targetInstance.id, edge.type]);
        let bundle = displayBundles.get(key);
        if (bundle) {
          bundle.originalEdgeIds.push(edge.id);
          bundle.evidenceIds = Array.from(new Set([...bundle.evidenceIds, ...(edge.evidenceIds || [])]));
          (originalEdgeToInstanceIds[edge.id] || (originalEdgeToInstanceIds[edge.id] = [])).push(bundle.id);
          return;
        }
        const id = `display-edge-instance:${key}`;
        bundle = { id, rowId, originalEdgeIds: [edge.id], sourceId: sourceInstance.id,
          targetId: targetInstance.id, sourceInstanceId: sourceInstance.id, targetInstanceId: targetInstance.id,
          selfConnection: sourceInstance.id === targetInstance.id,
          originalSourceId: edge.sourceId, originalTargetId: edge.targetId, type: edge.type,
          confidence: edge.confidence, evidenceIds: [...(edge.evidenceIds || [])] };
        displayBundles.set(key, bundle);
        displayEdgeInstances.push(bundle);
        const ids = originalEdgeToInstanceIds[edge.id] || (originalEdgeToInstanceIds[edge.id] = []);
        ids.push(id);
      });
    });
    const edgeOrder = new Map(graph.edges.map((edge, index) => [edge.id, index]));
    displayEdgeInstances.sort((left, right) => (edgeOrder.get(left.originalEdgeIds[0]) ?? Number.MAX_SAFE_INTEGER)
      - (edgeOrder.get(right.originalEdgeIds[0]) ?? Number.MAX_SAFE_INTEGER)
      || (rowOrder.get(left.rowId) ?? Number.MAX_SAFE_INTEGER)
        - (rowOrder.get(right.rowId) ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id));
    displayModel.displayEdgeInstances = displayEdgeInstances;
    displayModel.originalEdgeToInstanceIds = originalEdgeToInstanceIds;
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
    const educationArea = firstProjection ? {
      left: Math.min(...projectionNodes.map((node) => node.bounds.left)) - NODE_SAFE_MARGIN,
      top: Math.min(...projectionNodes.map((node) => node.bounds.top)) - EDUCATION_AREA_TOP_PADDING,
      right: Math.max(...projectionNodes.map((node) => node.bounds.right)) + NODE_SAFE_MARGIN,
      bottom: Math.max(...projectionNodes.map((node) => node.bounds.bottom)) + 32,
      topPadding: EDUCATION_AREA_TOP_PADDING,
      titleX: firstProjection.position.x + 12,
      titleY: Math.min(...projectionNodes.map((node) => node.position.y)) - EDUCATION_AREA_TOP_PADDING + 18
    } : null;
    const projection = { nodes: projectionNodes, edges: projectionEdges };
    const projectionPositions = Object.fromEntries(projectionNodes.map((node) => [node.id, {
      ...node.position,
      width: node.width,
      height: node.height
    }]));
    const groupPositions = Object.fromEntries((detailPresentation ? [] : controllerGroups.concat(groups))
      .filter((group) => group.position).map((group) => [group.id, group.position]));
    const routePositions = {
      ...Object.fromEntries(Object.entries(positions).filter(([id]) => !hiddenGroupMembers.has(id))),
      ...groupPositions,
      ...projectionPositions
    };
    const allPositions = { ...positions, ...groupPositions, ...projectionPositions };
    const projectionRoutes = {};
    if (detailPresentation) projectionEdges.forEach((edge) => {
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
      } else if (start.y === end.y) {
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
    const edgeRouteIndexes = new Map();
    const routeObstacles = { ...positions, ...projectionPositions };
    if (detailPresentation) graph.edges.forEach((edge) => {
      const source = positions[edge.sourceId];
      const target = positions[edge.targetId];
      if (!source || !target) return;
      const key = `${edge.sourceId}\u0000${edge.targetId}`;
      const index = edgePairCounts.get(key) || 0;
      edgePairCounts.set(key, index + 1);
      edgeRouteIndexes.set(edge.id, index);
      const route = routeFor(
        source,
        target,
        index,
        edge.type,
        graph.nodes.find((node) => node.id === edge.sourceId),
        graph.nodes.find((node) => node.id === edge.targetId),
        { width, height: actualBottom, positions: routeObstacles, existingRoutes: [] }
      );
      edgeRoutes[edge.id] = route;
    });
    const commonEdgeReservations = [];
    const commonEdgeRouteFallbacks = [];
    const commonEdgeRouteGroups = detailPresentation ? buildCommonEdgeRoutes(graph, positions, edgeRoutes,
      { chainGroups, endpointChains, hiddenGroups, commonFirst: true,
        reservedRoutes: commonEdgeReservations, fallbacks: commonEdgeRouteFallbacks }) : [];
    const commonEdgeIds = new Set(commonEdgeRouteGroups.flatMap((group) => group.edgeIds));
    const routedEdges = commonEdgeReservations.slice();
    if (detailPresentation) graph.edges.forEach((edge) => {
      if (commonEdgeIds.has(edge.id)) return;
      const source = positions[edge.sourceId];
      const target = positions[edge.targetId];
      if (!source || !target) return;
      const index = edgeRouteIndexes.get(edge.id) || 0;
      const route = routeFor(source, target, index, edge.type,
        graph.nodes.find((node) => node.id === edge.sourceId),
        graph.nodes.find((node) => node.id === edge.targetId),
        { width, height: actualBottom, positions: routeObstacles, existingRoutes: routedEdges });
      edgeRoutes[edge.id] = route;
      routedEdges.push(route);
    });
    const displayPositions = { ...projectionPositions };
    displayModel.instances.forEach((instance) => { displayPositions[instance.id] = instance.position; });
    if (detailPresentation) graph.nodes.forEach((node) => {
      const displayId = nodeToDisplay[node.id];
      if (positions[node.id] && !displayPositions[displayId]) displayPositions[displayId] = positions[node.id];
    });
    const displayEdgeRoutes = {};
    const displayEdgeInstanceRoutes = {};
    const displayRouteCache = new Map();
    if (detailPresentation) displayModel.displayEdgeInstances.forEach((edgeInstance) => {
      if (edgeInstance.selfConnection) return;
      const edge = graph.edges.find((candidate) => candidate.id === edgeInstance.originalEdgeIds[0]);
      if (!edge) return;
      const sourceId = edgeInstance.sourceInstanceId;
      const targetId = edgeInstance.targetInstanceId;
      const source = displayPositions[sourceId];
      const target = displayPositions[targetId];
      if (!source || !target) return;
      if (sourceId === targetId) {
        const route = { sections: [{
          startPoint: { x: source.x + NODE_WIDTH, y: source.y + NODE_HEIGHT / 2 },
          bendPoints: [{ x: source.x + NODE_WIDTH + 24, y: source.y + NODE_HEIGHT / 2 },
            { x: source.x + NODE_WIDTH + 24, y: source.y - 24 }, { x: source.x - 24, y: source.y - 24 },
            { x: source.x - 24, y: source.y + NODE_HEIGHT / 2 }],
          endPoint: { x: source.x, y: source.y + NODE_HEIGHT / 2 }
        }] };
        displayEdgeInstanceRoutes[edgeInstance.id] = route;
        if (!displayEdgeRoutes[edge.id]) displayEdgeRoutes[edge.id] = route;
        return;
      }
      const originalSource = graph.nodes.find((node) => node.id === edge.sourceId);
      const originalTarget = graph.nodes.find((node) => node.id === edge.targetId);
      const key = JSON.stringify([edgeInstance.rowId, sourceId, targetId, edge.type, originalSource.type, originalTarget.type]);
      let route = displayRouteCache.get(key);
      if (!route) {
        route = routeFor(source, target, 0, edge.type,
          { ...originalSource, id: sourceId }, { ...originalTarget, id: targetId },
          { width, height: actualBottom, positions: displayPositions, existingRoutes: [] });
        displayRouteCache.set(key, route);
      }
      displayEdgeInstanceRoutes[edgeInstance.id] = route;
      if (!displayEdgeRoutes[edge.id]) displayEdgeRoutes[edge.id] = route;
    });
    const visibleDisplayPositions = {};
    displayModel.instances.forEach((instance) => { visibleDisplayPositions[instance.id] = instance.position; });
    const displayNodeById = new Map(displayModel.instances.map((instance) => [instance.id, instance]));
    const displayGraph = {
      nodes: displayModel.instances.map((instance) => {
        const original = graph.nodes.find((node) => node.id === instance.originalNodeIds[0]);
        return { ...original, id: instance.id, type: instance.displayType };
      }),
      edges: displayModel.displayEdgeInstances.filter((instance) => !instance.selfConnection).map((instance) => {
        const original = graph.edges.find((edge) => edge.id === instance.originalEdgeIds[0]);
        return { ...original, id: instance.id, sourceId: instance.sourceInstanceId, targetId: instance.targetInstanceId,
          rowId: instance.rowId };
      })
    };
    const displayHiddenGroups = hiddenGroups.map((row) => ({
      ...row,
      members: Object.fromEntries(Object.entries(row.members).map(([category, ids]) => [category,
        ids.flatMap((id) => (originalNodeToInstanceIds[id] || []).filter((instanceId) => displayNodeById.get(instanceId)?.rowId === row.id))]))
    }));
    const displayCommonEdgeReservations = [];
    const displayCommonEdgeRouteFallbacks = [];
    const displayCommonEdgeRouteGroups = detailPresentation ? buildCommonEdgeRoutes(displayGraph, displayPositions,
      displayEdgeInstanceRoutes, { nodeToDisplay: {}, chainGroups: [], endpointChains: new Map(),
        hiddenGroups: displayHiddenGroups, commonFirst: true, portsFromBounds: true,
        reservedRoutes: displayCommonEdgeReservations, fallbacks: displayCommonEdgeRouteFallbacks }) : [];
    const displayCommonEdgeIds = new Set(displayCommonEdgeRouteGroups.flatMap((group) => group.edgeIds));
    const routedDisplayEdges = displayCommonEdgeReservations.slice();
    const finalDisplayRouteCache = new Map();
    if (detailPresentation) displayModel.displayEdgeInstances.forEach((edgeInstance) => {
      if (edgeInstance.selfConnection || displayCommonEdgeIds.has(edgeInstance.id)) return;
      const edge = graph.edges.find((candidate) => candidate.id === edgeInstance.originalEdgeIds[0]);
      if (!edge) return;
      const sourceId = edgeInstance.sourceInstanceId;
      const targetId = edgeInstance.targetInstanceId;
      const source = displayPositions[sourceId];
      const target = displayPositions[targetId];
      if (!source || !target) return;
      const originalSource = graph.nodes.find((node) => node.id === edge.sourceId);
      const originalTarget = graph.nodes.find((node) => node.id === edge.targetId);
      const key = JSON.stringify([edgeInstance.rowId, sourceId, targetId, edge.type, originalSource.type, originalTarget.type]);
      let route = finalDisplayRouteCache.get(key);
      if (!route) {
        route = routeFor(source, target, 0, edge.type,
          { ...originalSource, id: sourceId }, { ...originalTarget, id: targetId },
          { width, height: actualBottom, positions: displayPositions, existingRoutes: routedDisplayEdges });
        finalDisplayRouteCache.set(key, route);
        routedDisplayEdges.push(route);
      }
      displayEdgeInstanceRoutes[edgeInstance.id] = route;
    });
    Object.keys(displayEdgeRoutes).forEach((id) => delete displayEdgeRoutes[id]);
    displayModel.displayEdgeInstances.forEach((edgeInstance) => {
      const route = displayEdgeInstanceRoutes[edgeInstance.id];
      if (route) edgeInstance.originalEdgeIds.forEach((id) => {
        if (!displayEdgeRoutes[id]) displayEdgeRoutes[id] = route;
      });
    });
    const overviewProjectionRoutes = {};
    const projectionRouteCache = new Map();
    if (detailPresentation) projectionEdges
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
    if (detailPresentation) endpointHandlers.forEach((handler, endpointId) => {
      const chain = endpointChains.get(endpointId);
      const rowId = chain ? `chain:${chain.id}` : "unresolved";
      const sourceId = detailPresentation ? endpointId : displayIdForRow(endpointId, rowId) || endpointId;
      const targetId = detailPresentation ? handler.id : displayIdForRow(handler.id, rowId);
      if (!targetId) return;
      const source = displayPositions[sourceId];
      const target = displayPositions[targetId];
      if (!source || !target) return;
      const route = routeFor(source, target, 0, "", { id: sourceId }, { id: targetId },
        { width, height: actualBottom, positions: displayPositions });
      const section = route.sections && route.sections[0];
      if (!section) return;
      const points = [section.startPoint, ...(section.bendPoints || []), section.endPoint];
      guideRoutes[endpointId] = points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
    });
    let overviewRouting = null;
    if (!detailPresentation) {
      const relations = displayModel.displayEdgeInstances
        .filter((instance) => !instance.selfConnection && instance.type !== "FILTERED_BY" && instance.type !== "MATCHED_BY"
          && displayNodeById.get(instance.sourceInstanceId)?.displayType !== "SECURITY_CHAIN"
          && displayNodeById.get(instance.targetInstanceId)?.displayType !== "SECURITY_CHAIN")
        .map((instance) => {
          const source = displayPositions[instance.sourceInstanceId];
          const target = displayPositions[instance.targetInstanceId];
          const reversed = source && target && source.x > target.x;
          return { ...instance,
            sourceInstanceId: reversed ? instance.targetInstanceId : instance.sourceInstanceId,
            targetInstanceId: reversed ? instance.sourceInstanceId : instance.targetInstanceId,
            visualDirection: reversed ? "REVERSED" : "ORIGINAL", role: "ANALYSIS_REFERENCE" };
        });
      projectionEdges.forEach((edge) => {
        const sourceInstanceId = displayPositions[edge.sourceId] ? edge.sourceId : nodeToDisplay[edge.sourceId];
        const targetInstanceId = displayPositions[edge.targetId] ? edge.targetId : nodeToDisplay[edge.targetId];
        if ((displayNodeById.get(sourceInstanceId)?.displayType === "SECURITY_CHAIN"
          || displayNodeById.get(targetInstanceId)?.displayType === "SECURITY_CHAIN")
          && !edge.id.startsWith("chain-to-filter-")) return;
        relations.push({ ...edge, sourceInstanceId, targetInstanceId, rowId: edge.flowGroup ? `chain:${edge.flowGroup}` : null,
          role: "STRUCTURAL_FLOW", originalEdgeIds: [] });
      });
      endpointHandlers.forEach((handler, endpointId) => {
        const chain = endpointChains.get(endpointId);
        const rowId = chain ? `chain:${chain.id}` : "unresolved";
        const sourceInstanceId = displayIdForRow(endpointId, rowId);
        const targetInstanceId = displayIdForRow(handler.id, rowId);
        const mapped = relations.some((relation) => relation.type === "FLOWS_TO" && relation.rowId === rowId
          && ((relation.sourceInstanceId === sourceInstanceId && relation.targetInstanceId === targetInstanceId)
            || (relation.sourceInstanceId === targetInstanceId && relation.targetInstanceId === sourceInstanceId)));
        if (sourceInstanceId && targetInstanceId && !mapped) relations.push({ id: `mapping:${endpointId}:${rowId}`,
          sourceInstanceId, targetInstanceId, rowId, role: "API_MAPPING", originalEdgeIds: [] });
      });
      overviewRouting = routeOverview(displayModel.instances, relations, hiddenGroups);
      overviewRouting.relations = relations;
    }
    return {
      positions,
      edgeRoutes,
      width,
      height,
      plan: {
        mode: "request-flow-lanes",
        lanes: lanePlans,
        sectionGap: SECTION_GAP,
        majorSectionGap: MAJOR_SECTION_GAP,
        sectionAlignment,
        routing: { nodeSafeMargin: NODE_SAFE_MARGIN },
        chainGap: CHAIN_GAP,
        chainGroups,
        hiddenGroups,
        controllerGroups,
        displayModel,
        overviewRouting,
        commonEdgeRouteGroups,
        commonEdgeRouteFallbacks,
        displayCommonEdgeRouteGroups,
        displayCommonEdgeRouteFallbacks,
        findingSectionLayouts,
        displayEdgeRoutes,
        displayEdgeInstanceRoutes,
        overviewProjectionRoutes,
        guideRoutes,
        educationArea,
        projection,
          projectionRoutes,
        servletFilterOrder,
        securityFilterOrder,
        chainFilterOrderStatus,
        securityMembershipEdgeIds: Array.from(securityMembershipEdgeIds),
        supportAnchors,
        routeDiagnostics: {
          nodeOverlaps: nodeOverlaps(visibleDisplayPositions),
          edgeNodeIntersections: edgeNodeIntersections(displayGraph, displayPositions, displayEdgeInstanceRoutes,
            displayGraph.nodes.concat(projectionNodes))
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
          ? edge.sections.map((section) => {
            const startPoint = copyPoint(section.startPoint);
            const bendPoints = Array.isArray(section.bendPoints) ? section.bendPoints.map(copyPoint).filter(Boolean) : [];
            const endPoint = copyPoint(section.endPoint);
            return startPoint && endPoint
              ? routeFromPoints([startPoint, ...bendPoints, endPoint]).sections[0]
              : { startPoint, bendPoints, endPoint };
          })
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
    routeOverview,
    supportDisplaySemantic,
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
