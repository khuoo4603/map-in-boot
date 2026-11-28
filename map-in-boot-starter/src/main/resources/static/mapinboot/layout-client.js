(() => {
  "use strict";

  const scope = typeof window !== "undefined" ? window : self;

  const ELK_VERSION = "0.12.1";
  const WORKER_URL = "/mapinboot/vendor/elk-worker.min.js";
  const NODE_WIDTH = 260;
  const NODE_HEIGHT = 120;
  const OVERVIEW_CARD_WIDTHS = Object.freeze({ SERVLET_FILTERS: 500, SECURITY_CHAIN: 520,
    SECURITY_CHECKS: 440, API_MAPPING: 640, CONTROLLER_HANDLER: 560, CONTEXT: 280 });
  const OVERVIEW_CARD_GAP = 576;
  const OVERVIEW_ROW_GAP = 432;
  const OVERVIEW_HEADER_HEIGHT = 58;
  const OVERVIEW_CHAIN_HEADER_HEIGHT = 82;
  const OVERVIEW_ITEM_PADDING = 14;
  const OVERVIEW_ITEM_HEIGHT = 48;
  const OVERVIEW_ITEM_DETAIL_HEIGHT = 64;
  const MAX_OVERVIEW_SINGLE_COLUMN_HEIGHT = 2520;
  const DETAIL_CARD_WIDTH = 340;
  const DETAIL_CARD_HEIGHT = 150;
  const NODE_PADDING = 72;
  const COLUMN_STEP = 360;
  const SECTION_GAP = 96;
  const MAJOR_SECTION_GAP = 200;
  const OVERVIEW_SECTION_GAP = 288;
  const OVERVIEW_MAJOR_SECTION_GAP = 600;
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
    endpointFlowCount = 0, endpointReferenceCount = 0, securityNodeCount = 0, overview = false,
    detail = false, applicationCount = 0 } = {}) {
    const servletColumns = Math.min(MAX_FILTER_COLUMNS, Math.max(1, servletFilterCount));
    const securityColumns = Math.min(MAX_FILTER_COLUMNS, Math.max(1, maxSecurityFilters));
    const securityChecksColumns = Math.min(overview ? 2 : MAX_FILTER_COLUMNS,
      Math.max(1, overview ? securityNodeCount : Math.ceil(securityNodeCount / 8)));
    const requestColumns = 4;
    const endpointHeight = endpointCount * ROW_STEP;
    const routeDemand = endpointFlowCount + endpointReferenceCount;
    const endpointColumns = overview && (endpointHeight > MAX_OVERVIEW_SINGLE_COLUMN_HEIGHT
      || endpointHeight > MAX_OVERVIEW_SINGLE_COLUMN_HEIGHT * 0.6
        && routeDemand >= endpointCount * 1.5) ? 2 : 1;
    const handlerColumns = endpointColumns;
    if (overview) {
      return [
        { id: "servlet-filter", label: "Servlet 필터", columns: 1, cardWidth: OVERVIEW_CARD_WIDTHS.SERVLET_FILTERS },
        { id: "security-chain", label: "Spring Security", columns: 1, cardWidth: OVERVIEW_CARD_WIDTHS.SECURITY_CHAIN },
        { id: "security-checks", label: "보안 점검", columns: securityChecksColumns,
          cardWidth: OVERVIEW_CARD_WIDTHS.SECURITY_CHECKS, majorSectionAfter: true },
        { id: "endpoint", label: "API 매핑", columns: endpointColumns, cardWidth: OVERVIEW_CARD_WIDTHS.API_MAPPING,
          majorSectionAfter: true },
        { id: "handler", label: "Controller / Handler", columns: handlerColumns,
          cardWidth: OVERVIEW_CARD_WIDTHS.CONTROLLER_HANDLER }
      ].map((lane, index, all) => Object.freeze({ ...lane,
        column: all.slice(0, index).reduce((sum, previous) => sum + previous.columns, 0),
        columnStep: lane.cardWidth + OVERVIEW_CARD_GAP }));
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
    const detailGeometry = detail ? { cardWidth: DETAIL_CARD_WIDTH, columnStep: DETAIL_CARD_WIDTH + 44 } : {};
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
    ].map((lane) => Object.freeze({ ...lane, ...detailGeometry }));
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

  function compactClassName(value) {
    return text(value).trim().replace(/^L/, "").replace(/;$/, "")
      .replace(/[\\/]/g, ".").split(/[.#]/).filter(Boolean).pop() || "";
  }

  function handlerParts(value) {
    const signature = text(value).trim();
    const separator = signature.lastIndexOf("#");
    const methodSignature = separator >= 0 ? signature.slice(separator + 1) : signature;
    const descriptorStart = methodSignature.indexOf("(");
    return { owner: separator >= 0 ? compactClassName(signature.slice(0, separator)) : "",
      method: descriptorStart >= 0 ? methodSignature.slice(0, descriptorStart) : methodSignature,
      signature: methodSignature };
  }

  function handlerDisplayName(value) {
    const handler = handlerParts(value);
    return `${handler.owner || compactClassName(value)}${handler.owner && handler.method ? `#${handler.method}` : ""}`;
  }

  function blueprintNodePresentation(node) {
    const data = attributes(node);
    if (node.type === "ENDPOINT") {
      return { label: [text(data.httpMethod), text(data.path)].filter(Boolean).join(" ") || text(node.label), detail: "" };
    }
    if (node.type === "FILTER") {
      return { label: compactClassName(data.filterClass || node.label) || "Filter", detail: "" };
    }
    if (node.type === "HANDLER") {
      return { label: handlerDisplayName(data.handler || node.label), detail: "" };
    }
    if (["AUTHORIZATION", "SECURITY_DATA"].includes(node.type)) {
      const semantic = supportDisplaySemantic(node);
      return { label: semantic.primary, detail: semantic.detail };
    }
    if (node.type === "SECURITY_CHAIN") return { label: "SecurityFilterChain", detail: "" };
    if (node.type === "BUSINESS_SECURITY_STATE") {
      const action = text(data.stateAction).toUpperCase();
      const actionLabel = action === "REQUIRES" ? "상태 요구" : action === "PRODUCES" ? "상태 생성" : "";
      return { label: text(data.stateName) || text(node.label) || "업무 보안 상태",
        detail: [actionLabel, text(data.stateScope)].filter(Boolean).join(" · ") };
    }
    return { label: text(node.label) || node.type, detail: "" };
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
      x: lane.x + column * (lane.columnStep || COLUMN_STEP),
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

  function stringList(value) {
    if (Array.isArray(value)) return value.map((item) => text(item).trim()).filter(Boolean);
    return text(value).split(",").map((item) => item.trim()).filter(Boolean);
  }

  function tomcatFilterUrlMatches(pattern, requestPath) {
    if (pattern === "*") return true;
    if (pattern === requestPath || pattern === "/*") return true;
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2);
      return requestPath.startsWith(prefix)
        && (requestPath.length === prefix.length || requestPath[prefix.length] === "/");
    }
    if (pattern.startsWith("*.")) {
      const slash = requestPath.lastIndexOf("/");
      const period = requestPath.lastIndexOf(".");
      return slash >= 0 && period > slash && period < requestPath.length - 1
        && requestPath.slice(period + 1) === pattern.slice(2);
    }
    return pattern === "" && requestPath === "/";
  }

  function servletPatternRank(pattern, requestPath) {
    if (pattern === requestPath || pattern === "" && requestPath === "/") return 100000 + pattern.length;
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2);
      return requestPath.startsWith(prefix)
        && (requestPath.length === prefix.length || requestPath[prefix.length] === "/")
        ? 50000 + prefix.length : null;
    }
    if (pattern.startsWith("*.")) {
      const slash = requestPath.lastIndexOf("/");
      const period = requestPath.lastIndexOf(".");
      return slash >= 0 && period > slash && requestPath.slice(period + 1) === pattern.slice(2)
        ? 10000 + pattern.length : null;
    }
    return pattern === "/" ? 0 : null;
  }

  // Tomcat FilterMap의 요청 대상 및 컨테이너 배치 순서로 Servlet Filter 적용 목록 구성
  function resolveTomcatServletFilterExecution(architecture, graph, endpoint, runtimeComponents, flowIndex) {
    const unknown = (reason, entries = []) => ({ status: "UNKNOWN", reason, contextId: null,
      servletName: null, dispatcherComponentId: null, orderedComponentIds: [],
      entries: entries.map((entry) => ({ ...entry, status: "UNKNOWN", order: null, delegating: false })) });
    const environment = architecture && architecture.environment || {};
    if (text(environment.webApplicationType).toUpperCase() !== "SERVLET"
      || text(environment.serverKind).toUpperCase() !== "TOMCAT") return unknown("컨테이너 순서 규칙 확인 불가");
    const servletContexts = runtimeComponents.filter((component) => component.kind === "SERVLET_CONTEXT");
    if (servletContexts.length !== 1 || !servletContexts[0].contextId) return unknown("ServletContext 범위 확인 불가");
    const contextId = servletContexts[0].contextId;
    const coverage = (architecture.coverage || []).filter((item) => item.area === "SERVLET"
      && item.scope === contextId);
    if (coverage.length !== 1 || coverage[0].state !== "PRESENT") return unknown("Servlet 수집 완전성 확인 불가");
    const endpointPath = text(attributes(endpoint).path).trim();
    if (!endpointPath.startsWith("/")) return unknown("선택 API 경로 확인 불가");
    if (/[{}*?]/.test(endpointPath)) return unknown("선택 API가 경로 템플릿이어서 실제 URL 매칭 확인 불가");

    const servletRegistrations = runtimeComponents.filter((component) => component.contextId === contextId
      && ["SERVLET", "DISPATCHER_SERVLET", "SERVLET_REGISTRATION"].includes(component.kind));
    if (servletRegistrations.some((component) => !Object.prototype.hasOwnProperty.call(component.attributes || {}, "urlPatterns"))) {
      return unknown("Servlet URL 매핑 확인 불가");
    }
    const matchingServlets = servletRegistrations.map((component) => {
      const ranks = stringList(attributes(component).urlPatterns)
        .map((pattern) => servletPatternRank(pattern, endpointPath)).filter((rank) => rank !== null);
      return { component, rank: ranks.length ? Math.max(...ranks) : null };
    }).filter((entry) => entry.rank !== null);
    if (!matchingServlets.length) return unknown("선택 API의 Servlet 대상 확인 불가");
    const highestRank = Math.max(...matchingServlets.map((entry) => entry.rank));
    const selectedServlets = matchingServlets.filter((entry) => entry.rank === highestRank);
    if (selectedServlets.length !== 1) return unknown("선택 API의 Servlet 대상이 여러 개");
    const selectedServlet = selectedServlets[0].component;
    if (!/DispatcherServlet/.test(`${selectedServlet.className || ""} ${attributes(selectedServlet).servletClass || ""}`)) {
      return unknown("선택 API가 DispatcherServlet에 매핑되지 않음");
    }
    const servletName = text(attributes(selectedServlet).registrationName || selectedServlet.beanName).trim();
    if (!servletName) return unknown("DispatcherServlet 등록 이름 확인 불가");

    const tomcatContexts = runtimeComponents.filter((component) => component.kind === "TOMCAT_CONTEXT"
      && component.contextId === contextId);
    if (tomcatContexts.length !== 1) return unknown("Tomcat Context 범위 확인 불가");
    const filterMaps = runtimeComponents.filter((component) => component.kind === "TOMCAT_FILTER_MAPPING"
      && component.contextId === contextId && component.parentId === tomcatContexts[0].id);
    const registrations = runtimeComponents.filter((component) => component.kind === "SERVLET_FILTER_REGISTRATION"
      && component.contextId === contextId);
    const registrationsByName = new Map();
    registrations.forEach((component) => {
      const name = text(attributes(component).registrationName).trim();
      const matches = registrationsByName.get(name) || [];
      matches.push(component);
      registrationsByName.set(name, matches);
    });
    if (Array.from(registrationsByName.values()).some((matches) => matches.length !== 1)) {
      return unknown("Filter 등록 이름이 중복됨");
    }

    const orderedMappings = filterMaps.map((component) => {
      const data = attributes(component);
      const order = positiveInteger(data.registrationOrder);
      const hasDispatcherTypes = Object.prototype.hasOwnProperty.call(data, "dispatcherTypes");
      const configuredDispatcherTypes = stringList(data.dispatcherTypes).map((item) => item.toUpperCase());
      const dispatcherTypes = configuredDispatcherTypes.length ? configuredDispatcherTypes : ["REQUEST"];
      const allUrls = text(data.matchAllUrlPatterns).toLowerCase();
      const allServlets = text(data.matchAllServletNames).toLowerCase();
      if (order === null || !hasDispatcherTypes || !["true", "false"].includes(allUrls)
        || !["true", "false"].includes(allServlets)) return null;
      const urlPatterns = stringList(data.urlPatterns);
      const servletNames = stringList(data.servletNames);
      const urlMatched = allUrls === "true" || urlPatterns.some((pattern) => tomcatFilterUrlMatches(pattern, endpointPath));
      const servletMatched = allServlets === "true" || servletNames.includes(servletName);
      return { component, order, requestMapped: dispatcherTypes.includes("REQUEST") && urlMatched,
        servletMapped: dispatcherTypes.includes("REQUEST") && servletMatched };
    });
    if (orderedMappings.some((item) => item === null)
      || new Set(orderedMappings.map((item) => item.order)).size !== orderedMappings.length) {
      return unknown("FilterMap 등록 순서 또는 매핑 정보가 불완전함");
    }
    const matchedMappings = [
      ...orderedMappings.filter((item) => item.requestMapped).sort((left, right) => left.order - right.order),
      ...orderedMappings.filter((item) => item.servletMapped).sort((left, right) => left.order - right.order)
    ];
    const entryById = new Map(registrations.map((component) => [component.id, {
      componentId: component.id, status: "NOT_APPLIED", order: null, mappingIds: [], delegating: false
    }]));
    const orderedComponentIds = [];
    for (const mapping of matchedMappings) {
      const filterName = text(attributes(mapping.component).filterName).trim();
      const matches = registrationsByName.get(filterName) || [];
      if (matches.length !== 1) return unknown("적용 FilterMap과 등록 객체의 이름 대응 확인 불가");
      const registration = matches[0];
      const entry = entryById.get(registration.id);
      if (!entry.mappingIds.includes(mapping.component.id)) entry.mappingIds.push(mapping.component.id);
      if (entry.order !== null) continue;
      entry.status = "CONFIRMED";
      entry.order = orderedComponentIds.length + 1;
      entry.delegating = /DelegatingFilterProxy|springSecurityFilterChain/i
        .test(`${registration.className || ""} ${attributes(registration).filterClass || ""} ${filterName}`);
      orderedComponentIds.push(registration.id);
    }
    const entries = Array.from(entryById.values());
    const graphServletIds = (selectedServlet.graphNodeIds || []).filter((id) =>
      (graph.nodes || []).some((node) => node.id === id && node.type === "SERVLET"));
    if (graphServletIds.length === 1 && flowIndex
      && typeof flowIndex.servletFiltersForServlet === "function") {
      const graphOrder = flowIndex.servletFiltersForServlet(graphServletIds[0]);
      const graphFilters = graphOrder.filters || [];
      const registrationByGraphNode = new Map();
      registrations.forEach((component) => (component.graphNodeIds || []).forEach((id) => {
        const mapped = registrationByGraphNode.get(id) || [];
        mapped.push(component.id);
        registrationByGraphNode.set(id, mapped);
      }));
      if (graphFilters.some((filter) => registrationByGraphNode.get(filter.id)?.length !== 1)) {
        return unknown("Graph Filter와 Servlet 등록의 정확한 대응 확인 불가", entries);
      }
      if (graphOrder.orderStatus === "CONFIRMED") {
        const appliedGraphIds = new Set(orderedComponentIds.flatMap((id) => {
          const registration = registrationsByName.get(text(attributes(runtimeComponents.find((item) => item.id === id))
            .registrationName).trim())?.[0];
          return registration && registration.graphNodeIds || [];
        }));
        const graphOrderSubset = graphFilters.map((filter) => filter.id).filter((id) => appliedGraphIds.has(id));
        const runtimeOrderSubset = orderedComponentIds.flatMap((id) => {
          const component = runtimeComponents.find((item) => item.id === id);
          return (component && component.graphNodeIds || []).filter((nodeId) => appliedGraphIds.has(nodeId));
        });
        if (graphOrderSubset.length !== runtimeOrderSubset.length
          || graphOrderSubset.some((id, index) => id !== runtimeOrderSubset[index])) {
          return unknown("Graph와 Tomcat FilterMap의 적용 순서가 일치하지 않음", entries);
        }
      }
    }
    return { status: "CONFIRMED", source: "TOMCAT_FILTER_MAP",
      reason: "Tomcat FilterMap의 URL·Servlet 이름 매핑과 REQUEST 처리 순서 확인",
      contextId, servletName, dispatcherComponentId: selectedServlet.id, orderedComponentIds, entries };
  }

  function filterRows(count) {
    return Math.max(1, Math.ceil(count / MAX_FILTER_COLUMNS));
  }

  function filterPosition(lane, index, baseY) {
    return {
      x: lane.x + (index % MAX_FILTER_COLUMNS) * (lane.columnStep || COLUMN_STEP),
      y: baseY + Math.floor(index / MAX_FILTER_COLUMNS) * ROW_STEP
    };
  }

  function laneWidth(lane) {
    return (lane.cardWidth || NODE_WIDTH) + (lane.columns - 1) * (lane.columnStep || COLUMN_STEP);
  }

  function positionLanes(laneDefinitions, overview = false) {
    let nextX = NODE_PADDING;
    return laneDefinitions.map((lane) => {
      const positioned = { ...lane, x: nextX, width: laneWidth(lane) };
      const sectionGap = overview
        ? lane.majorSectionAfter ? OVERVIEW_MAJOR_SECTION_GAP : OVERVIEW_SECTION_GAP
        : lane.majorSectionAfter ? MAJOR_SECTION_GAP : SECTION_GAP;
      nextX += positioned.width + sectionGap;
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
    graph.nodes.filter((node) => node.type === "FILTER"
      && !["SECURITY", "SERVLET"].includes(attributes(node).registrationKind))
      .forEach((filter) => add(unresolved(), "filters", filter.id));

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
  function routeOverview(instances, relations, rows = [], retry = null, attempt = 0, ports = []) {
    const nodes = new Map(instances.map((instance) => [instance.id, instance]));
    const portsById = new Map(ports.map((port) => [port.id, port]));
    const rowBounds = new Map(rows.filter((row) => Number.isFinite(row.rowTop) && Number.isFinite(row.rowBottom))
      .map((row) => [row.id, row]));
    const groups = new Map();
    const unresolved = [];
    const targetCounts = new Map();
    const sourceCounts = new Map();
    relations.forEach((relation) => {
      const key = JSON.stringify([relation.rowId, relation.role, relation.type,
        relation.visualTargetPortId || relation.targetInstanceId]);
      const sources = targetCounts.get(key) || new Set();
      sources.add(relation.visualSourcePortId || relation.sourceInstanceId);
      targetCounts.set(key, sources);
      const sourceKey = JSON.stringify([relation.rowId, relation.role, relation.type,
        relation.visualSourcePortId || relation.sourceInstanceId]);
      const targets = sourceCounts.get(sourceKey) || new Set();
      targets.add(relation.visualTargetPortId || relation.targetInstanceId);
      sourceCounts.set(sourceKey, targets);
    });
    const bicliques = new Map();
    relations.forEach((relation) => {
      const source = nodes.get(relation.sourceInstanceId);
      const target = nodes.get(relation.targetInstanceId);
      if (!source || !target || !source.position || !target.position) return;
      const sourcePortId = relation.visualSourcePortId || relation.sourceInstanceId;
      const targetPortId = relation.visualTargetPortId || relation.targetInstanceId;
      const sourceKey = JSON.stringify([relation.rowId, relation.role, relation.type, sourcePortId]);
      const targetIds = Array.from(sourceCounts.get(sourceKey)).sort();
      if (targetIds.length < 2) return;
      const sourcePort = portsById.get(sourcePortId);
      const targetPort = portsById.get(targetPortId);
      const direction = targetPort ? targetPort.x >= (sourcePort && sourcePort.x || source.position.x) ? 1 : -1
        : target.position.x >= source.position.x ? 1 : -1;
      const key = JSON.stringify([relation.rowId, relation.role, relation.type, targetIds, direction]);
      const group = bicliques.get(key) || { key, direction, relations: [], sources: new Set(), targets: targetIds };
      group.sources.add(sourcePortId);
      group.relations.push(relation);
      bicliques.set(key, group);
    });
    relations.forEach((relation) => {
      const targetPortId = relation.visualTargetPortId || relation.targetInstanceId;
      const targetKey = JSON.stringify([relation.rowId, relation.role, relation.type, targetPortId]);
      const sourceIds = Array.from(targetCounts.get(targetKey) || []).sort();
      if (sourceIds.length < 2) return;
      const sourcesHaveSingleTarget = sourceIds.every((sourcePortId) => {
        const sourceKey = JSON.stringify([relation.rowId, relation.role, relation.type, sourcePortId]);
        return (sourceCounts.get(sourceKey) || new Set()).size === 1;
      });
      if (!sourcesHaveSingleTarget) return;
      const sourcePort = portsById.get(relation.visualSourcePortId);
      const targetPort = portsById.get(relation.visualTargetPortId);
      const source = nodes.get(relation.sourceInstanceId);
      const target = nodes.get(relation.targetInstanceId);
      if (!source || !target || !source.position || !target.position) return;
      const direction = targetPort ? targetPort.x >= (sourcePort ? sourcePort.x : source.position.x) ? 1 : -1
        : target.position.x >= source.position.x ? 1 : -1;
      const key = JSON.stringify(["FAN_IN", relation.rowId, relation.role, relation.type, targetPortId, sourceIds]);
      const group = bicliques.get(key) || { key, direction, relations: [], sources: new Set(), targets: [targetPortId] };
      group.sources.add(relation.visualSourcePortId || relation.sourceInstanceId);
      group.relations.push(relation);
      bicliques.set(key, group);
    });
    const paths = [];
    const completed = new Set();
    const pathPartsFor = (path) => path.parts
      ? path.parts.map((part, index) => ({ ...part,
        routeRole: part.routeRole || path.partRoles && path.partRoles[index] || part.role
          || (path.relation.routeKind === "filter-wrap" ? "FILTER_WRAP" : "DIRECT") }))
      : path.points.slice(1).map((to, index) => ({
        from: path.points[index], to,
        geometry: path.geometry && path.points.length === 2 ? path.geometry : null,
        routeRole: path.partRoles ? path.partRoles[index]
          : path.relation.routeKind === "filter-wrap" ? "FILTER_WRAP" : "DIRECT"
      }));
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
    const detourSlots = new Map();
    const busOffsetFor = (rowId, direction, entryX, groupKey) => {
      const key = JSON.stringify([rowId, direction, entryX]);
      const slots = busSlots.get(key) || new Map();
      if (!slots.has(groupKey)) slots.set(groupKey, slots.size);
      busSlots.set(key, slots);
      return (NODE_SAFE_MARGIN + 1) + (slots.get(groupKey) + attempt * 3) * 4;
    };
    const routePorts = (relation) => {
      const sourceId = relation.reverse ? relation.visualTargetPortId : relation.visualSourcePortId;
      const targetId = relation.reverse ? relation.visualSourcePortId : relation.visualTargetPortId;
      const sourcePort = sourceId && portsById.get(sourceId);
      const targetPort = targetId && portsById.get(targetId);
      return { source: sourcePort ? { id: sourcePort.id, itemId: sourcePort.itemId,
        side: sourcePort.side, x: sourcePort.x, y: sourcePort.y }
        : null, target: targetPort ? { id: targetPort.id, itemId: targetPort.itemId,
          side: targetPort.side, x: targetPort.x, y: targetPort.y } : null };
    };
    const reservePath = (path) => {
      paths.push(path);
      pathPartsFor(path).forEach((part) => {
        if (part.geometry && part.geometry.kind === "CUBIC") return;
        const { from: start, to: end } = part;
        const horizontal = start.y === end.y;
        const fixed = horizontal ? start.y : start.x;
        const axis = horizontal ? "x" : "y";
        const indexMap = horizontal ? occupiedHorizontal : occupiedVertical;
        const entries = indexMap.get(fixed) || [];
        entries.push({ low: Math.min(start[axis], end[axis]), high: Math.max(start[axis], end[axis]),
          from: start, to: end, groupKey: path.groupKey, sourcePort: path.sourcePort, targetPort: path.targetPort });
        indexMap.set(fixed, entries);
      });
    };
    const overlapsPaths = (candidate, groupKey, sourcePort = null, targetPort = null) => {
      return candidate.slice(1).some((end, index) => {
        const start = candidate[index];
        const horizontal = start.y === end.y;
        const axis = horizontal ? "x" : "y";
        const fixed = horizontal ? "y" : "x";
        const entries = (horizontal ? occupiedHorizontal : occupiedVertical).get(start[fixed]) || [];
        const low = Math.min(start[axis], end[axis]), high = Math.max(start[axis], end[axis]);
        const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
        const samePort = (left, right) => {
          if (!left || !right || left.x !== right.x || left.y !== right.y) return false;
          if (left.id === right.id) return true;
          if (left.itemId && right.itemId) return left.itemId === right.itemId && left.side === right.side;
          return !left.id || !right.id;
        };
        const touches = (left, right, point) => point && (left.x === point.x && left.y === point.y
          || right.x === point.x && right.y === point.y);
        return entries.some((entry) => {
          if (entry.groupKey === groupKey || Math.max(low, entry.low) >= Math.min(high, entry.high)) return false;
          const entryLength = Math.abs(entry.to.x - entry.from.x) + Math.abs(entry.to.y - entry.from.y);
          const sharedSourceStub = length <= NODE_SAFE_MARGIN + 2 && entryLength <= NODE_SAFE_MARGIN + 2
            && samePort(sourcePort, entry.sourcePort)
            && touches(start, end, sourcePort) && touches(entry.from, entry.to, entry.sourcePort);
          const sharedTargetStub = length <= NODE_SAFE_MARGIN + 2 && entryLength <= NODE_SAFE_MARGIN + 2
            && samePort(targetPort, entry.targetPort)
            && touches(start, end, targetPort) && touches(entry.from, entry.to, entry.targetPort);
          const sharedApproach = (port, otherPort) => {
            if (!samePort(port, otherPort) || start[fixed] !== port?.[fixed] || end[fixed] !== port?.[fixed]
              || entry.from[fixed] !== port?.[fixed] || entry.to[fixed] !== port?.[fixed]) return false;
            const nearPort = (from, to) => Math.min(Math.abs(from[axis] - port[axis]),
              Math.abs(to[axis] - port[axis])) <= NODE_SAFE_MARGIN + 2;
            return nearPort(start, end) && nearPort(entry.from, entry.to)
              && Math.max(Math.abs(low - port[axis]), Math.abs(high - port[axis])) <= NODE_SAFE_MARGIN * 2 + 2;
          };
          const joinsExistingJunction = (port) => port && length <= NODE_SAFE_MARGIN * 2 + 2
            && touches(start, end, port) && start[fixed] === port[fixed] && end[fixed] === port[fixed]
            && entry.from[fixed] === port[fixed] && entry.to[fixed] === port[fixed]
            && Math.min(start[axis], end[axis]) >= entry.low
            && Math.max(start[axis], end[axis]) <= entry.high;
          return !sharedSourceStub && !sharedTargetStub
            && !sharedApproach(sourcePort, entry.sourcePort) && !sharedApproach(targetPort, entry.targetPort)
            && !joinsExistingJunction(sourcePort) && !joinsExistingJunction(targetPort);
        });
      });
    };
    const cubicPoints = (start, controls, end, steps = 24) => Array.from({ length: steps + 1 }, (_, index) => {
      const t = index / steps;
      const inverse = 1 - t;
      return {
        x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * controls[0].x
          + 3 * inverse * t ** 2 * controls[1].x + t ** 3 * end.x,
        y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * controls[0].y
          + 3 * inverse * t ** 2 * controls[1].y + t ** 3 * end.y
      };
    });
    const directBezier = (sourcePort, targetPort, sourceId, targetId, row) => {
      if (!sourcePort || !targetPort) return null;
      const vertical = ["TOP", "BOTTOM"].includes(sourcePort.side)
        && ["TOP", "BOTTOM"].includes(targetPort.side);
      const axis = vertical ? "y" : "x";
      const direction = Math.sign(targetPort[axis] - sourcePort[axis]);
      const distance = Math.abs(targetPort[axis] - sourcePort[axis]);
      if (!direction || distance < NODE_SAFE_MARGIN * 3) return null;
      const sideDirection = (side) => vertical
        ? side === "TOP" ? -1 : side === "BOTTOM" ? 1 : 0
        : side === "LEFT" ? -1 : side === "RIGHT" ? 1 : 0;
      const sourceDirection = sideDirection(sourcePort.side) || direction;
      const targetDirection = sideDirection(targetPort.side) || -direction;
      if (sourceDirection !== direction || targetDirection !== -direction) return null;
      const handle = distance * 0.42;
      const controls = [
        vertical
          ? { x: sourcePort.x, y: sourcePort.y + direction * handle }
          : { x: sourcePort.x + direction * handle, y: sourcePort.y },
        vertical
          ? { x: targetPort.x, y: targetPort.y - direction * handle }
          : { x: targetPort.x - direction * handle, y: targetPort.y }
      ];
      const samples = cubicPoints(sourcePort, controls, targetPort);
      const endpointIds = new Set([sourceId, targetId]);
      const blocked = instances.some((instance) => instance.position && !endpointIds.has(instance.id)
        && samples.slice(1).some((point, index) => segmentIntersectsExpandedNode(samples[index], point, instance.position)));
      if (blocked || row && (Math.min(...samples.map((point) => point.y)) < row.rowTop
        || Math.max(...samples.map((point) => point.y)) > row.rowBottom)) return null;
      return { geometry: { kind: "CUBIC", controlPoints: controls } };
    };
    // 장애물 카드가 있는 단독 관계에 겹치지 않는 외부 통로를 배정하는 규칙
    const routeSingleDetour = (relation, source, target, sourcePort, targetPort, traversalSide, row,
      blocked, overlapsOtherGroup) => {
      const margin = NODE_SAFE_MARGIN + 2;
      const left = Math.min(sourcePort.x, targetPort.x);
      const right = Math.max(sourcePort.x, targetPort.x);
      const obstacles = instances.filter((instance) => instance.position && instance.id !== source.id
        && instance.id !== target.id && instance.position.x < right
        && instance.position.x + (instance.position.width || NODE_WIDTH) > left);
      if (!obstacles.length) return null;
      const bySource = obstacles.slice().sort((a, b) => traversalSide > 0
        ? a.position.x - b.position.x : b.position.x + (b.position.width || NODE_WIDTH)
          - a.position.x - (a.position.width || NODE_WIDTH));
      const first = bySource[0].position;
      const last = bySource[bySource.length - 1].position;
      const sourceBase = sourcePort.x + traversalSide * margin;
      const targetSide = -traversalSide;
      const targetBase = targetPort.x + targetSide * margin;
      const sourceLimit = traversalSide > 0 ? first.x - margin
        : first.x + (first.width || NODE_WIDTH) + margin;
      const targetLimit = traversalSide > 0 ? last.x - margin
        : last.x + (last.width || NODE_WIDTH) + margin;
      const trackRoom = Math.min(traversalSide * (sourceLimit - sourceBase),
        targetSide * (targetLimit - targetBase));
      if (trackRoom < 0) return null;
      const topY = Math.min(...obstacles.map((instance) => instance.position.y)) - margin;
      const bottomY = Math.max(...obstacles.map((instance) => instance.position.y
        + (instance.position.height || NODE_HEIGHT))) + margin;
      const topRoom = row ? topY - (row.rowTop - margin) : Number.POSITIVE_INFINITY;
      const bottomRoom = row ? row.rowBottom + margin - bottomY : Number.POSITIVE_INFINITY;
      const pairKey = JSON.stringify([relation.rowId, source.id, target.id]);
      const state = detourSlots.get(pairKey) || { track: 0, top: 0, bottom: 0 };
      const step = 4;
      for (let skipped = 0; skipped < 128; skipped += 1) {
        const track = state.track + skipped;
        const trackOffset = track * step;
        if (trackOffset > trackRoom) break;
        const topIndex = state.top + skipped;
        const bottomIndex = state.bottom + skipped;
        const canUseTop = topRoom >= topIndex * step;
        const canUseBottom = bottomRoom >= bottomIndex * step;
        if (!canUseTop && !canUseBottom) break;
        const useTop = canUseTop;
        const laneY = useTop ? topY - topIndex * step : bottomY + bottomIndex * step;
        const sourceTrack = sourceBase + traversalSide * trackOffset;
        const targetTrack = targetBase + targetSide * trackOffset;
        const candidate = [sourcePort, { x: sourceTrack, y: sourcePort.y },
          { x: sourceTrack, y: laneY }, { x: targetTrack, y: laneY },
          { x: targetTrack, y: targetPort.y }, targetPort]
          .filter((point, index, all) => index === 0 || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
        if (blocked(candidate) || overlapsOtherGroup(candidate)) continue;
        state.track = track + 1;
        if (useTop) state.top = topIndex + 1;
        else state.bottom = bottomIndex + 1;
        detourSlots.set(pairKey, state);
        return { points: candidate, sourcePort, targetPort };
      }
      return null;
    };
    const routeOuterDetour = (sourcePort, targetPort, row, blocked, overlapsOtherGroup) => {
      if (row) return null;
      const positions = instances.filter((instance) => instance.position).map((instance) => instance.position);
      if (!positions.length) return null;
      const margin = NODE_SAFE_MARGIN + 2;
      const top = Math.min(...positions.map((position) => position.y)) - margin;
      const bottom = Math.max(...positions.map((position) => position.y + (position.height || NODE_HEIGHT))) + margin;
      const sourceSide = sourcePort.side === "LEFT" ? -1 : 1;
      const targetSide = targetPort.side === "RIGHT" ? 1 : -1;
      const trackOffsets = Array.from({ length: 28 }, (_, index) => index * 4);
      const sourceTracks = trackOffsets.map((offset) => sourcePort.x + sourceSide * (margin + offset))
        .filter((x) => !occupiedVertical.has(x)).slice(0, 12);
      const targetTracks = trackOffsets.map((offset) => targetPort.x + targetSide * (margin + offset))
        .filter((x) => !occupiedVertical.has(x)).slice(0, 12);
      const lanes = Array.from({ length: 64 }, (_, index) => [top - index * 8, bottom + index * 8])
        .flat().filter((y) => !occupiedHorizontal.has(y)).slice(0, 32);
      for (const sourceTrackX of sourceTracks) for (const targetTrackX of targetTracks) for (const laneY of lanes) {
        const candidate = [sourcePort, { x: sourceTrackX, y: sourcePort.y },
          { x: sourceTrackX, y: laneY }, { x: targetTrackX, y: laneY },
          { x: targetTrackX, y: targetPort.y }, targetPort]
          .filter((point, pointIndex, all) => pointIndex === 0
            || point.x !== all[pointIndex - 1].x || point.y !== all[pointIndex - 1].y);
        if (blocked(candidate) || overlapsOtherGroup(candidate)) continue;
        return { points: candidate, sourcePort, targetPort };
      }
      return null;
    };
    const curveIsClear = (from, controls, to, excludedIds, row) => {
      const samples = cubicPoints(from, controls, to);
      if (row && (Math.min(...samples.map((point) => point.y)) < row.rowTop
        || Math.max(...samples.map((point) => point.y)) > row.rowBottom)) return false;
      return !instances.some((instance) => instance.position && !excludedIds.has(instance.id)
        && samples.slice(1).some((point, index) =>
          segmentIntersectsExpandedNode(samples[index], point, instance.position)));
    };
    const routeFanIn = (group) => {
      if (group.direction < 0) return false;
      const entries = group.relations.map((relation) => {
        const source = nodes.get(relation.sourceInstanceId);
        const target = nodes.get(relation.targetInstanceId);
        const resolved = routePorts(relation);
        const sourcePort = resolved.source || (source && source.position ? {
          x: source.position.x + (source.position.width || NODE_WIDTH),
          y: source.position.y + (source.position.height || NODE_HEIGHT) / 2
            + portOffsetFor(source.id, 1, group.key), side: "RIGHT"
        } : null);
        const targetPort = resolved.target || (target && target.position ? {
          x: target.position.x, y: target.position.y + (target.position.height || NODE_HEIGHT) / 2
            + portOffsetFor(target.id, -1, group.key), side: "LEFT"
        } : null);
        return { relation, source, target, sourcePort, targetPort };
      });
      if (entries.some((entry) => !entry.source || !entry.target || !entry.sourcePort || !entry.targetPort
        || entry.relation.reverse)) return false;
      const targetPort = entries[0].targetPort;
      const targetInstanceId = entries[0].target.id;
      if (entries.some((entry) => entry.target.id !== targetInstanceId
        || entry.targetPort.id !== targetPort.id || entry.targetPort.x !== targetPort.x
        || entry.targetPort.y !== targetPort.y)) return false;
      const sourceByPort = new Map();
      entries.forEach((entry) => {
        const id = entry.relation.visualSourcePortId || entry.sourcePort.id || entry.source.id;
        if (!sourceByPort.has(id)) sourceByPort.set(id, entry);
      });
      if (sourceByPort.size < 2 || targetPort.side && targetPort.side !== "LEFT") return false;
      const sourceYs = Array.from(sourceByPort.values(), (entry) => entry.sourcePort.y).sort((a, b) => a - b);
      const middleY = sourceYs[Math.floor(sourceYs.length / 2)];
      const sourceX = Math.max(...Array.from(sourceByPort.values(), (entry) => entry.sourcePort.x));
      const junctionX = targetPort.x - Math.min(140, Math.max(48, (targetPort.x - sourceX) * 0.18));
      if (junctionX <= sourceX + NODE_SAFE_MARGIN) return false;
      const row = rowBounds.get(entries[0].relation.rowId);
      const yCandidates = Array.from(new Set([middleY, (sourceYs[0] + sourceYs.at(-1)) / 2, ...sourceYs]))
        .sort((left, right) => Math.abs(left - middleY) - Math.abs(right - middleY) || left - right);
      let selected = null;
      for (const junctionY of yCandidates) {
        const junction = { x: junctionX, y: junctionY };
        const trunkDx = targetPort.x - junction.x;
        const trunkControls = [
          { x: junction.x + trunkDx * 0.38, y: junction.y },
          { x: targetPort.x - trunkDx * 0.34, y: targetPort.y }
        ];
        if (!curveIsClear(junction, trunkControls, targetPort, new Set([targetInstanceId]), row)) continue;
        const branches = Array.from(sourceByPort.values()).map((entry) => {
          const dx = junction.x - entry.sourcePort.x;
          const controls = [
            { x: entry.sourcePort.x + dx * 0.42, y: entry.sourcePort.y },
            { x: junction.x - dx * 0.3, y: junction.y }
          ];
          return { ...entry, controls };
        });
        if (branches.some((branch) => !curveIsClear(branch.sourcePort, branch.controls, junction,
          new Set([branch.source.id]), row))) continue;
        selected = { junction, trunkControls, branches };
        break;
      }
      if (!selected) return false;
      const relationIds = entries.map((entry) => entry.relation.id);
      const junctionId = `junction:${JSON.stringify(["FAN_IN", group.key, selected.junction.x, selected.junction.y])}`;
      entries.forEach((entry) => {
        const branch = selected.branches.find((item) => item.relation.id === entry.relation.id)
          || selected.branches.find((item) => item.sourcePort.x === entry.sourcePort.x
            && item.sourcePort.y === entry.sourcePort.y);
        const parts = [
          { from: entry.sourcePort, to: selected.junction, geometry: { kind: "CUBIC", controlPoints: branch.controls }, routeRole: "FANIN_BRANCH" },
          { from: selected.junction, to: targetPort, geometry: { kind: "CUBIC", controlPoints: selected.trunkControls }, routeRole: "TRUNK" }
        ];
        reservePath({ relation: entry.relation, points: [entry.sourcePort, selected.junction, targetPort], parts,
          sourcePort: entry.sourcePort, targetPort, groupKey: group.key, segmentGroupKey: group.key,
          junctions: [{ id: junctionId, x: selected.junction.x, y: selected.junction.y,
            groupKey: group.key, relationIds }] });
        completed.add(entry.relation.id);
      });
      return true;
    };
    const routeBiclique = (group) => {
      const relationPairs = new Set(group.relations.map((relation) => JSON.stringify([
        relation.visualSourcePortId || relation.sourceInstanceId,
        relation.visualTargetPortId || relation.targetInstanceId
      ])));
      if (group.sources.size < 2 || relationPairs.size !== group.sources.size * group.targets.length) return;
      const direction = group.direction;
      if (group.targets.length === 1) {
        routeFanIn(group);
        return;
      }
      const sourcePorts = new Map(Array.from(group.sources, (id) => {
        const port = portsById.get(id);
        if (port) return [id, { id: port.id, itemId: port.itemId, side: port.side, x: port.x, y: port.y }];
        const nodeId = group.relations.find((relation) => (relation.visualSourcePortId || relation.sourceInstanceId) === id)?.sourceInstanceId;
        const position = nodes.get(nodeId)?.position;
        return [id, position ? { x: position.x + (position.width || NODE_WIDTH),
          y: position.y + (position.height || NODE_HEIGHT) / 2 + portOffsetFor(nodeId, 1, group.key) } : null];
      }).filter(([, port]) => port));
      const targetPorts = new Map(group.targets.map((id) => {
        const port = portsById.get(id);
        if (port) return [id, { id: port.id, itemId: port.itemId, side: port.side, x: port.x, y: port.y }];
        const nodeId = group.relations.find((relation) => (relation.visualTargetPortId || relation.targetInstanceId) === id)?.targetInstanceId;
        const position = nodes.get(nodeId)?.position;
        return [id, position ? { x: position.x, y: position.y + (position.height || NODE_HEIGHT) / 2
          + portOffsetFor(nodeId, -1, group.key) } : null];
      }).filter(([, port]) => port));
      const targetXs = Array.from(targetPorts.values(), (port) => port.x);
      const firstEntryX = direction > 0 ? Math.min(...targetXs) : Math.max(...targetXs);
      const targetBusX = firstEntryX - direction * busOffsetFor(group.relations[0].rowId, direction, firstEntryX, group.key);
      const ys = Array.from(sourcePorts.values(), (port) => port.y).sort((a, b) => a - b);
      const trunkCandidates = [(ys[0] + ys[ys.length - 1]) / 2, ...ys];
      let selected = null;
      for (const trunkY of trunkCandidates) {
        const candidates = group.relations.map((relation) => {
          const sourcePort = sourcePorts.get(relation.visualSourcePortId || relation.sourceInstanceId);
          const targetPort = targetPorts.get(relation.visualTargetPortId || relation.targetInstanceId);
          const sourceBusX = sourcePort.x + direction * (NODE_SAFE_MARGIN + 1);
          const parts = [
            { from: sourcePort, to: { x: sourceBusX, y: sourcePort.y }, role: "SOURCE_STUB" },
            { from: { x: sourceBusX, y: sourcePort.y }, to: { x: sourceBusX, y: trunkY }, role: "MERGE_BUS" },
            { from: { x: sourceBusX, y: trunkY }, to: { x: targetBusX, y: trunkY }, role: "TRUNK" },
            { from: { x: targetBusX, y: trunkY }, to: { x: targetBusX, y: targetPort.y }, role: "SPLIT_BUS" },
            { from: { x: targetBusX, y: targetPort.y }, to: targetPort, role: "TARGET_BRANCH" }
          ].filter((part) => part.from.x !== part.to.x || part.from.y !== part.to.y);
          const points = [parts[0].from, ...parts.map((part) => part.to)];
          return { relation, points, parts, partRoles: parts.map((part) => part.role), sourcePort, targetPort,
            groupKey: group.key, segmentGroupKey: group.key };
        });
        const blocked = candidates.some((candidate) => candidate.parts.some((part) => part.role !== "TRUNK" &&
          instances.some((obstacle) => obstacle.position && obstacle.id !== candidate.relation.sourceInstanceId
            && obstacle.id !== candidate.relation.targetInstanceId
            && segmentIntersectsExpandedNode(part.from, part.to, obstacle.position))));
        if (!blocked && !candidates.some((candidate) => overlapsPaths(candidate.points, group.key,
          candidate.sourcePort, candidate.targetPort))) {
          selected = candidates;
          break;
        }
      }
      if (selected) selected.forEach((candidate) => { reservePath(candidate); completed.add(candidate.relation.id); });
    };
    const routeFanOut = (group, sourcePort) => {
      if (group.direction < 0 || group.direction !== group.traversalSide || !sourcePort
        || sourcePort.side && sourcePort.side !== "RIGHT") return false;
      const targetsByPort = new Map();
      group.items.forEach(({ relation, target, targetPort: assignedTargetPort }) => {
        const position = target.position;
        const targetPort = assignedTargetPort || (position ? {
          x: position.x, y: position.y + (position.height || NODE_HEIGHT) / 2
            + portOffsetFor(target.id, -1, group.key), side: "LEFT"
        } : null);
        if (!targetPort) return;
        const id = relation.visualTargetPortId || targetPort.id
          || JSON.stringify([target.id, targetPort.x, targetPort.y]);
        const bucket = targetsByPort.get(id) || { id, target, targetPort, relations: [] };
        bucket.relations.push(relation);
        targetsByPort.set(id, bucket);
      });
      if (targetsByPort.size < 2) return false;
      const targets = Array.from(targetsByPort.values());
      if (targets.some((entry) => entry.targetPort.side && entry.targetPort.side !== "LEFT")) return false;
      const firstX = Math.min(...targets.map((entry) => entry.targetPort.x));
      const junctionX = firstX - Math.min(140, Math.max(48, (firstX - sourcePort.x) * 0.18));
      if (junctionX <= sourcePort.x + NODE_SAFE_MARGIN) return false;
      const targetYs = targets.map((entry) => entry.targetPort.y).sort((left, right) => left - right);
      const middleY = targetYs[Math.floor(targetYs.length / 2)];
      const row = group.row;
      const yCandidates = Array.from(new Set([middleY, (targetYs[0] + targetYs.at(-1)) / 2, ...targetYs]))
        .filter((y) => !row || y >= row.rowTop && y <= row.rowBottom)
        .sort((left, right) => Math.abs(left - middleY) - Math.abs(right - middleY) || left - right);
      let selected = null;
      for (const junctionY of yCandidates) {
        const junction = { x: junctionX, y: junctionY };
        const trunkDx = junction.x - sourcePort.x;
        const trunkControls = [
          { x: sourcePort.x + trunkDx * 0.46, y: sourcePort.y },
          { x: junction.x - trunkDx * 0.24, y: junction.y }
        ];
        if (!curveIsClear(sourcePort, trunkControls, junction, new Set([group.source.id]), row)) continue;
        const branches = targets.map((entry) => {
          const dx = entry.targetPort.x - junction.x;
          const controls = [
            { x: junction.x + dx * 0.34, y: junction.y },
            { x: entry.targetPort.x - dx * 0.36, y: entry.targetPort.y }
          ];
          return { ...entry, controls };
        });
        const blocked = branches.some((branch) => !curveIsClear(branch.from || junction,
          branch.controls, branch.targetPort, new Set([branch.target.id]), row));
        if (blocked) continue;
        selected = { junction, trunkControls, branches };
        break;
      }
      if (!selected) return false;
      const relationIds = group.items.flatMap((item) => item.relation.id);
      const junctionId = `junction:${JSON.stringify(["FAN_OUT", group.key,
        selected.junction.x, selected.junction.y])}`;
      selected.branches.forEach((branch) => {
        branch.relations.forEach((relation) => {
          const parts = [
            { from: sourcePort, to: selected.junction,
              geometry: { kind: "CUBIC", controlPoints: selected.trunkControls }, routeRole: "TRUNK" },
            { from: selected.junction, to: branch.targetPort,
              geometry: { kind: "CUBIC", controlPoints: branch.controls }, routeRole: "FANOUT_BRANCH" }
          ];
          reservePath({ relation, points: [sourcePort, selected.junction, branch.targetPort], parts,
            sourcePort, targetPort: branch.targetPort, groupKey: group.key, segmentGroupKey: group.key,
            junctions: [{ id: junctionId, x: selected.junction.x, y: selected.junction.y,
              groupKey: group.key, relationIds }] });
          completed.add(relation.id);
        });
      });
      return true;
    };
    const roleOrder = { STRUCTURAL_FLOW: 0, API_MAPPING: 1, ANALYSIS_REFERENCE: 2, REGISTRATION_REFERENCE: 3 };
    relations.slice().sort((a, b) => (roleOrder[a.role] ?? 4) - (roleOrder[b.role] ?? 4)
      || Number(Boolean(retry && retry.has(b.id))) - Number(Boolean(retry && retry.has(a.id)))
      || text(a.id).localeCompare(text(b.id))).forEach((original) => {
      if (completed.has(original.id)) return;
      const key = JSON.stringify([original.rowId, original.role, original.type,
        original.visualTargetPortId || original.targetInstanceId]);
      const sourceKey = JSON.stringify([original.rowId, original.role, original.type,
        original.visualSourcePortId || original.sourceInstanceId]);
      const reverse = !original.preserveDirection && targetCounts.get(key).size > 1 && sourceCounts.get(sourceKey).size === 1
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
      const resolvedPorts = routePorts(relation);
      const sourcePortId = reverse ? original.visualTargetPortId : original.visualSourcePortId;
      const groupKey = JSON.stringify([relation.rowId, relation.role, relation.type,
        sourcePortId || relation.sourceInstanceId, direction, reverse]);
      const sourceSide = resolvedPorts.source && resolvedPorts.source.side;
      const traversalSide = relation.preserveDirection
        ? ["LEFT", "TOP"].includes(sourceSide) ? -1 : 1 : reverse ? -1 : 1;
      const group = groups.get(groupKey) || { key: groupKey, direction, source, role: relation.role,
        traversalSide, sourcePort: resolvedPorts.source,
        row: rowBounds.get(relation.rowId), items: [] };
      group.items.push({ relation, target, targetPort: resolvedPorts.target });
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
      const groupSourcePort = group.sourcePort || { x: source.x + (traversalSide > 0 ? source.width || NODE_WIDTH : 0),
        y: source.y + (source.height || NODE_HEIGHT) / 2 + portOffsetFor(group.source.id, traversalSide, group.key) };
      const entry = group.items.map(({ target, targetPort }) => targetPort ? targetPort.x : target.position.x
        + (traversalSide < 0 ? target.position.width || NODE_WIDTH : 0));
      const firstEntryX = direction > 0 ? Math.min(...entry) : Math.max(...entry);
      const busX = firstEntryX - direction * busOffsetFor(group.items[0].relation.rowId, direction, firstEntryX, group.key);
      const targetPortIds = new Set(group.items.map(({ relation, target, targetPort }) => relation.visualTargetPortId
        || (targetPort ? `${target.id}:${targetPort.x},${targetPort.y}` : target.id)));
      const requiresFanout = targetPortIds.size > 1;
      if (requiresFanout && routeFanOut(group, groupSourcePort)) return;
      if (requiresFanout && direction === traversalSide) {
        const stub = { x: groupSourcePort.x + traversalSide * (NODE_SAFE_MARGIN + 1), y: groupSourcePort.y };
        const split = { x: busX, y: groupSourcePort.y };
        const candidates = group.items.map(({ relation, target, targetPort: assignedTargetPort }) => {
          const p = target.position;
          const targetPort = assignedTargetPort || { x: p.x + (traversalSide < 0 ? p.width || NODE_WIDTH : 0),
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
              if (overlapsPaths([part.from, part.to], group.key, groupSourcePort, targetPort)) return false;
              if (part.role === "TRUNK") return true;
              return !instances.some((obstacle) => obstacle.position && obstacle.id !== group.source.id
                && obstacle.id !== target.id && segmentIntersectsExpandedNode(part.from, part.to, obstacle.position));
            });
            if (safe) return { relation, sourcePort: groupSourcePort, targetPort, parts,
              points: [parts[0].from, ...parts.map((part) => part.to)], groupKey: group.key };
          }
          return null;
        });
        const routedCandidates = candidates.filter(Boolean);
        if (routedCandidates.length > 0) {
          routedCandidates.forEach((candidate) => {
            // 여러 목적지가 실제로 공유하는 구간만 공통 Trunk로 유지
            candidate.partRoles = candidate.parts.map((part) => routedCandidates.length > 1
              ? part.role : "DIRECT");
            reservePath(candidate);
            completed.add(candidate.relation.id);
          });
        }
      }
      group.items.filter(({ relation }) => !completed.has(relation.id))
        .forEach(({ relation, target, targetPort: assignedTargetPort }) => {
        const p = target.position;
        let sourcePort = groupSourcePort;
        let targetPort = assignedTargetPort || { x: p.x + (traversalSide < 0 ? p.width || NODE_WIDTH : 0),
          y: p.y + (p.height || NODE_HEIGHT) / 2 + portOffsetFor(target.id, -traversalSide, group.key) };
        let points = [sourcePort, { x: busX, y: sourcePort.y }, { x: busX, y: targetPort.y }, targetPort]
          .filter((point, index, all) => index === 0 || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
        const blocked = (candidate) => candidate.slice(1).some((point, index) => instances.some((obstacle) => {
          if (obstacle.id === group.source.id || obstacle.id === target.id || !obstacle.position) return false;
          return segmentIntersectsExpandedNode(candidate[index], point, obstacle.position);
        }));
        const overlapsOtherGroup = (candidate) => overlapsPaths(candidate, group.key, sourcePort, targetPort);
        if (group.items.length === 1) {
          const direct = directBezier(sourcePort, targetPort, group.source.id, target.id, group.row);
          if (direct) {
            reservePath({ relation, points: [sourcePort, targetPort], geometry: direct.geometry,
              sourcePort, targetPort, groupKey: group.key });
            return;
          }
        }
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
          let alternate = routeSingleDetour(relation, group.source, target,
            sourcePort, targetPort, traversalSide, group.row, blocked, overlapsOtherGroup);
          const routeLength = (candidate) => candidate.slice(1).reduce((sum, point, index) => sum
            + Math.abs(point.x - candidate[index].x) + Math.abs(point.y - candidate[index].y), 0);
          // 외곽 후보는 유효성 확보용으로 먼저 두되 내부 경로보다 비용을 높게 평가
          let alternateScore = alternate ? routeLength(alternate.points) + ROW_STEP * 2 : Infinity;
          for (const sourceSide of [traversalSide]) {
            for (const targetSide of [-traversalSide]) {
              const from = { ...groupSourcePort,
                x: source.x + (sourceSide > 0 ? source.width || NODE_WIDTH : 0), y: groupSourcePort.y };
              const to = { ...targetPort,
                x: p.x + (targetSide > 0 ? p.width || NODE_WIDTH : 0), y: targetPort.y };
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
                }
              }
            }
          }
          // 인접 장애물 경계로 구성한 직교 통로에서 최단 경로 탐색
          const directDistance = Math.abs(groupSourcePort.x - targetPort.x) + Math.abs(groupSourcePort.y - targetPort.y);
          if (!alternate || alternateScore > directDistance + ROW_STEP) {
            for (const sourceSide of [traversalSide]) {
              for (const targetSide of [-traversalSide]) {
                // 기존 통로가 선분 끝에 막힌 경우 안전 간격 안쪽의 인접 통로 재탐색
                for (const [sourceOffset, targetOffset, portClearance] of
                  [[0, 0, margin], [0, 0, NODE_SAFE_MARGIN + 1]]) {
                if (alternate && (sourceOffset || targetOffset)) continue;
                const from = { ...groupSourcePort,
                  x: source.x + (sourceSide > 0 ? source.width || NODE_WIDTH : 0),
                  y: groupSourcePort.y + sourceOffset };
                const to = { ...targetPort,
                  x: p.x + (targetSide > 0 ? p.width || NODE_WIDTH : 0),
                  y: targetPort.y + targetOffset };
                if (from.y <= source.y + 4 || from.y >= source.y + (source.height || NODE_HEIGHT) - 4
                  || to.y <= p.y + 4 || to.y >= p.y + (p.height || NODE_HEIGHT) - 4) continue;
                const start = { x: from.x + sourceSide * portClearance, y: from.y };
                const end = { x: to.x + targetSide * portClearance, y: to.y };
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
                  .slice(0, 24)
                  .forEach((x) => { xs.add(x - 3); xs.add(x + 3); });
                Array.from(occupiedHorizontal.keys()).filter((y) => y >= minY && y <= maxY)
                  .sort((a, b) => Math.min(Math.abs(a - start.y), Math.abs(a - end.y))
                    - Math.min(Math.abs(b - start.y), Math.abs(b - end.y)) || a - b)
                  .slice(0, 24)
                  .forEach((y) => { ys.add(y - 3); ys.add(y + 3); });
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
            alternate = routeOuterDetour(sourcePort, targetPort, group.row, blocked, overlapsOtherGroup);
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
    const coordinateKey = (value) => Math.round(value * 1000) / 1000;
    const portIdentity = (port) => port && (port.id || JSON.stringify([port.itemId || "", port.side || "", port.x, port.y]));
    const segmentGroupKeyFor = (path) => path.segmentGroupKey || JSON.stringify([path.relation.rowId, path.relation.role,
      path.relation.type, portIdentity(path.sourcePort), Math.sign(path.targetPort.x - path.sourcePort.x),
      Boolean(path.relation.reverse)]);
    const geometryChannelFor = (path) => JSON.stringify([path.relation.rowId, path.relation.role,
      path.relation.type, path.relation.flowGroup || null]);
    const raw = paths.flatMap((path) => pathPartsFor(path).filter((part) =>
      !(part.geometry && part.geometry.kind === "CUBIC")).map((part) => ({
      ...part, relationId: path.relation.id, groupKey: segmentGroupKeyFor(path),
      sourcePort: path.sourcePort, targetPort: path.targetPort, rowId: path.relation.rowId,
      semanticRole: part.routeRole, relationRole: path.relation.role, relationType: path.relation.type
    })));
    const segments = [];
    const segmentByKey = new Map();
    const routesByRelationId = {};
    const sharedPortKey = (port) => port && (port.id
      ? JSON.stringify([port.id, port.side || "", port.x, port.y])
      : JSON.stringify([port.itemId || "", port.side || "", port.x, port.y]));
    const sharedPortGroupKey = (relation, mode, port) => JSON.stringify([
      "shared-port", relation.rowId, relation.role, relation.type, `${mode}_STUB`, sharedPortKey(port)
    ]);
    paths.forEach((path) => {
      const orderedSegmentIds = [];
      pathPartsFor(path).forEach((part) => {
        const { from: start, to: end } = part;
        let routeRole = part.routeRole;
        if (part.geometry && part.geometry.kind === "CUBIC") {
          const segmentGroupKey = segmentGroupKeyFor(path);
          const forward = [start, ...part.geometry.controlPoints, end].map((point) =>
            [coordinateKey(point.x), coordinateKey(point.y)]);
          const reverse = forward.slice().reverse();
          const geometryKey = JSON.stringify(forward) <= JSON.stringify(reverse) ? forward : reverse;
          const key = JSON.stringify([geometryChannelFor(path), "CUBIC", geometryKey]);
          let segment = segmentByKey.get(key);
          if (!segment) {
            segment = { id: `segment:${segments.length}`, from: start, to: end, geometry: part.geometry,
              groupKey: segmentGroupKey, groupKeys: [], routeRole, routeRolesByRelationId: {},
              axis: "CURVE", relationIds: [] };
            segmentByKey.set(key, segment);
            segments.push(segment);
          }
          if (!segment.relationIds.includes(path.relation.id)) segment.relationIds.push(path.relation.id);
          if (!segment.groupKeys.includes(segmentGroupKey)) segment.groupKeys.push(segmentGroupKey);
          segment.routeRolesByRelationId[path.relation.id] = routeRole;
          if (orderedSegmentIds.at(-1) !== segment.id) orderedSegmentIds.push(segment.id);
          return;
        }
        const horizontal = start.y === end.y;
        const axis = horizontal ? "x" : "y";
        const fixed = horizontal ? "y" : "x";
        const low = Math.min(start[axis], end[axis]);
        const high = Math.max(start[axis], end[axis]);
        const cuts = new Set([low, high]);
        raw.forEach((part) => {
          if (Math.abs(part.from[fixed] - start[fixed]) > 0.001
            || Math.abs(part.to[fixed] - start[fixed]) > 0.001) return;
          [part.from[axis], part.to[axis]].forEach((value) => { if (value > low + 0.001 && value < high - 0.001) cuts.add(value); });
        });
        const values = Array.from(cuts).sort((a, b) => start[axis] < end[axis] ? a - b : b - a);
        values.slice(1).forEach((value, partIndex) => {
          const from = horizontal ? { x: values[partIndex], y: start.y } : { x: start.x, y: values[partIndex] };
          const to = horizontal ? { x: value, y: start.y } : { x: start.x, y: value };
          const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
          const pointMatches = (left, right) => left && right && left.x === right.x && left.y === right.y;
          if (routeRole === "DIRECT" && length <= NODE_SAFE_MARGIN + 2) {
            if (pointMatches(from, path.sourcePort) || pointMatches(to, path.sourcePort)) routeRole = "SOURCE_STUB";
            else if (pointMatches(from, path.targetPort) || pointMatches(to, path.targetPort)) routeRole = "TARGET_STUB";
          }
          const terminalPort = routeRole === "SOURCE_STUB" ? path.sourcePort
            : routeRole === "TARGET_STUB" ? path.targetPort : null;
          const segmentGroupKey = terminalPort
            ? sharedPortGroupKey(path.relation,
              routeRole === "SOURCE_STUB" ? "SOURCE" : "TARGET", terminalPort) : segmentGroupKeyFor(path);
          const key = JSON.stringify([geometryChannelFor(path), horizontal ? "H" : "V",
            coordinateKey(start[fixed]), coordinateKey(Math.min(from[axis], to[axis])),
            coordinateKey(Math.max(from[axis], to[axis]))]);
          let segment = segmentByKey.get(key);
          if (!segment) {
            segment = { id: `segment:${segments.length}`, from, to, groupKey: segmentGroupKey,
              groupKeys: [], routeRole, routeRolesByRelationId: {},
              axis: horizontal ? "HORIZONTAL" : "VERTICAL", relationIds: [] };
            segmentByKey.set(key, segment);
            segments.push(segment);
          }
          if (!segment.relationIds.includes(path.relation.id)) segment.relationIds.push(path.relation.id);
          if (!segment.groupKeys.includes(segmentGroupKey)) segment.groupKeys.push(segmentGroupKey);
          segment.routeRolesByRelationId[path.relation.id] = routeRole;
          if (orderedSegmentIds.at(-1) !== segment.id) orderedSegmentIds.push(segment.id);
        });
      });
      routesByRelationId[path.relation.id] = path.relation.reverse
        ? { sourcePort: path.targetPort, targetPort: path.sourcePort, orderedSegmentIds: orderedSegmentIds.reverse() }
        : { sourcePort: path.sourcePort, targetPort: path.targetPort, orderedSegmentIds };
    });
    segments.forEach((segment) => {
      const roles = Array.from(new Set(Object.values(segment.routeRolesByRelationId || {})));
      if (roles.length > 1) segment.routeRole = "SHARED";
      else if (segment.relationIds.length > 1 && ["DIRECT", "SPLIT_BUS", "TARGET_BRANCH"].includes(roles[0])) {
        segment.routeRole = "TRUNK";
      } else if (roles.length === 1) segment.routeRole = roles[0];
    });
    const segmentsById = new Map(segments.map((segment) => [segment.id, segment]));
    const samePoint = (left, right) => left && right && left.x === right.x && left.y === right.y;
    const sameRoutePoint = (left, right) => left && right
      && Math.abs(left.x - right.x) <= 0.001 && Math.abs(left.y - right.y) <= 0.001;
    Object.entries(routesByRelationId).forEach(([relationId, route]) => {
      let current = route.sourcePort;
      const valid = route.orderedSegmentIds.length > 0 && route.orderedSegmentIds.every((id) => {
        const segment = segmentsById.get(id);
        if (!segment || !segment.relationIds.includes(relationId)) return false;
        if (sameRoutePoint(current, segment.from)) current = segment.to;
        else if (sameRoutePoint(current, segment.to)) current = segment.from;
        else return false;
        return true;
      }) && sameRoutePoint(current, route.targetPort);
      if (!valid) {
        unresolved.push({ relationId, reason: "disconnected-segments" });
        delete routesByRelationId[relationId];
      }
    });
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      segments[index].relationIds = segments[index].relationIds.filter((id) => routesByRelationId[id]);
      if (!segments[index].relationIds.length) segments.splice(index, 1);
    }
    const junctionCandidates = new Map();
    paths.forEach((path) => (path.junctions || []).forEach((junction) => {
      const candidate = junctionCandidates.get(junction.id) || { ...junction,
        segmentIds: new Set(), neighborIds: new Set(), relationIds: new Set() };
      (junction.relationIds || []).forEach((id) => candidate.relationIds.add(id));
      junctionCandidates.set(junction.id, candidate);
    }));
    const physicalJunctionCandidates = [];
    junctionCandidates.forEach((junction) => {
      const memberSegments = segments.filter((segment) => (segment.groupKeys || [segment.groupKey]).includes(junction.groupKey)
        && (samePoint(segment.from, junction) || samePoint(segment.to, junction)));
      memberSegments.forEach((segment) => junction.segmentIds.add(segment.id));
      const neighborIds = new Set(memberSegments.map((segment) => {
        const neighbor = samePoint(segment.from, junction) ? segment.to : segment.from;
        return `${neighbor.x},${neighbor.y}`;
      }));
      const relationIds = new Set(memberSegments.flatMap((segment) => segment.relationIds));
      if (neighborIds.size < 3 || relationIds.size < 2) return;
      const candidate = { id: junction.id, x: junction.x, y: junction.y,
        groupKeys: new Set([junction.groupKey]), segmentIds: new Set(memberSegments.map((segment) => segment.id)) };
      // 동일한 물리 Branch를 공유하는 Junction 후보를 합쳐 Segment 참여 관계를 일치
      const overlapping = physicalJunctionCandidates.filter((existing) => existing.x === candidate.x
        && existing.y === candidate.y && Array.from(candidate.segmentIds).some((id) => existing.segmentIds.has(id)));
      if (!overlapping.length) {
        physicalJunctionCandidates.push(candidate);
        return;
      }
      const physical = overlapping[0];
      overlapping.slice(1).forEach((duplicate) => {
        duplicate.groupKeys.forEach((key) => physical.groupKeys.add(key));
        duplicate.segmentIds.forEach((id) => physical.segmentIds.add(id));
        physicalJunctionCandidates.splice(physicalJunctionCandidates.indexOf(duplicate), 1);
      });
      candidate.groupKeys.forEach((key) => physical.groupKeys.add(key));
      candidate.segmentIds.forEach((id) => physical.segmentIds.add(id));
    });
    const junctions = physicalJunctionCandidates.map((junction) => {
      const memberSegments = Array.from(junction.segmentIds, (id) => segmentsById.get(id)).filter(Boolean);
      return { id: junction.id, x: junction.x, y: junction.y,
        segmentIds: Array.from(junction.segmentIds),
        relationIds: Array.from(new Set(memberSegments.flatMap((segment) => segment.relationIds))).sort(),
        groupKey: Array.from(junction.groupKeys)[0], groupKeys: Array.from(junction.groupKeys) };
    });
    segments.forEach((segment) => {
      const groupKeys = segment.groupKeys || [segment.groupKey];
      segment.fromJunctionId = junctions.find((junction) => junction.groupKeys.some((key) => groupKeys.includes(key))
        && samePoint(junction, segment.from))?.id || null;
      segment.toJunctionId = junctions.find((junction) => junction.groupKeys.some((key) => groupKeys.includes(key))
        && samePoint(junction, segment.to))?.id || null;
    });
    const curveDiagnostics = { candidates: 0, applied: 0, cardCollisionRejections: 0, rowBoundaryRejections: 0 };
    const unitDirection = (from, to) => {
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      return length ? { x: (to.x - from.x) / length, y: (to.y - from.y) / length, length } : null;
    };
    const routePartsByRelation = new Map();
    Object.entries(routesByRelationId).forEach(([relationId, route]) => {
      let current = route.sourcePort;
      const parts = [];
      route.orderedSegmentIds.forEach((id) => {
        const segment = segmentsById.get(id);
        if (!segment) return;
        const forward = samePoint(current, segment.from);
        const from = forward ? segment.from : segment.to;
        const to = forward ? segment.to : segment.from;
        parts.push({ segment, from, to, direction: unitDirection(from, to), forward });
        current = to;
      });
      routePartsByRelation.set(relationId, parts);
    });
    const normalizeDirection = (left, right) => {
      const x = left.x + right.x, y = left.y + right.y;
      const length = Math.hypot(x, y);
      return length > 0.001 ? { x: x / length, y: y / length } : null;
    };
    routePartsByRelation.forEach((parts, relationId) => {
      const relation = relations.find((item) => item.id === relationId);
      if (!relation) return;
      parts.forEach((part, index) => {
        const { segment, from, to, direction } = part;
        if (!direction || segment.relationIds.length !== 1 || segment.routeRole === "TRUNK") return;
        const previous = parts[index - 1];
        const next = parts[index + 1];
        const turnsAtStart = previous && Math.abs(previous.direction.x * direction.x
          + previous.direction.y * direction.y) < 0.999;
        const turnsAtEnd = next && Math.abs(next.direction.x * direction.x
          + next.direction.y * direction.y) < 0.999;
        if (!turnsAtStart && !turnsAtEnd) return;
        curveDiagnostics.candidates += 1;
        const startDirection = turnsAtStart
          ? previous.segment.relationIds.length > 1 ? previous.direction : normalizeDirection(previous.direction, direction)
          : direction;
        const endDirection = turnsAtEnd
          ? next.segment.relationIds.length > 1 ? next.direction : normalizeDirection(direction, next.direction)
          : direction;
        if (!startDirection || !endDirection) return;
        const segmentLength = direction.length;
        const radiusAt = (neighbor) => Math.min(12, segmentLength * 0.35,
          neighbor ? neighbor.direction.length * 0.35 : segmentLength * 0.35);
        let startRadius = turnsAtStart ? radiusAt(previous) : 0;
        let endRadius = turnsAtEnd ? radiusAt(next) : 0;
        const radiusScale = startRadius + endRadius > segmentLength * 0.7
          ? segmentLength * 0.7 / (startRadius + endRadius) : 1;
        startRadius *= radiusScale;
        endRadius *= radiusScale;
        if (Math.max(startRadius, endRadius) < 3) return;
        const routeControlStart = { x: from.x + startDirection.x * startRadius,
          y: from.y + startDirection.y * startRadius };
        const routeControlEnd = { x: to.x - endDirection.x * endRadius,
          y: to.y - endDirection.y * endRadius };
        const controlPoints = part.forward ? [routeControlStart, routeControlEnd]
          : [routeControlEnd, routeControlStart];
        const curveBounds = {
          left: Math.min(segment.from.x, segment.to.x, controlPoints[0].x, controlPoints[1].x),
          right: Math.max(segment.from.x, segment.to.x, controlPoints[0].x, controlPoints[1].x),
          top: Math.min(segment.from.y, segment.to.y, controlPoints[0].y, controlPoints[1].y),
          bottom: Math.max(segment.from.y, segment.to.y, controlPoints[0].y, controlPoints[1].y)
        };
        const curvePoints = cubicPoints(segment.from, controlPoints, segment.to);
        const endpointIds = new Set([relation.sourceInstanceId, relation.targetInstanceId]);
        const collidesWithCard = instances.some((instance) => {
          if (!instance.position || endpointIds.has(instance.id)) return false;
          const bounds = instance.position;
          const margin = NODE_SAFE_MARGIN;
          if (curveBounds.left > bounds.x + (bounds.width || NODE_WIDTH) + margin
            || curveBounds.right < bounds.x - margin
            || curveBounds.top > bounds.y + (bounds.height || NODE_HEIGHT) + margin
            || curveBounds.bottom < bounds.y - margin) return false;
          return curvePoints.slice(1).some((point, index) => segmentIntersectsExpandedNode(
            curvePoints[index], point, bounds, margin));
        });
        if (collidesWithCard) {
          curveDiagnostics.cardCollisionRejections += 1;
          return;
        }
        const row = rowBounds.get(relation.rowId);
        if (row && (curveBounds.top < row.rowTop || curveBounds.bottom > row.rowBottom)) {
          curveDiagnostics.rowBoundaryRejections += 1;
          return;
        }
        segment.geometry = { kind: "CUBIC", controlPoints, radius: Math.max(startRadius, endRadius) };
        curveDiagnostics.applied += 1;
      });
    });
    const result = { junctions, segments, routesByRelationId, unresolved,
      curveDiagnostics };
    if (unresolved.length && attempt < 2) {
      const alternative = routeOverview(instances, relations, rows,
        new Set(unresolved.map((item) => item.relationId)), attempt + 1, ports);
      if (alternative.unresolved.length < unresolved.length) return alternative;
    }
    return result;
  }

  function buildOverviewComposites(graph, rows, lanes, endpointHandlers, servletFilters, servletFilterOrder,
    securityFilterOrder, chainFilterOrderStatus, filtersByChain, controllerGroups, supportGroups) {
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
    const cards = [];
    const nodeItemsByRow = new Map();
    const itemById = {};
    const cardById = {};
    const rowToCardIds = {};
    const originalNodeToItemIds = {};
    const itemToOriginalNodeIds = {};
    const itemToOriginalEdgeIds = {};
    const originalNodeToCardIds = {};
    const findings = Array.isArray(graph.findings) ? graph.findings : [];
    const serviceIdFor = (nodeIds) => nodeIds.map((id) => nodeById.get(id)).filter(Boolean)
      .map((node) => text(node.serviceId)).find(Boolean) || "unknown-service";
    const rowNodeKey = (rowId, nodeId) => JSON.stringify([rowId || null, nodeId]);
    const unique = (values) => Array.from(new Set(values));
    const stateActionLabels = { REQUIRES: "상태 요구", PRODUCES: "상태 생성" };
    const typeTitle = {
      AUTHENTICATION: "인증",
      AUTHORIZATION: "인가",
      SECURITY_DATA: "보안정보",
      BUSINESS_SECURITY_STATE: "업무 보안 상태"
    };
    const makeCard = ({ kind, displayType, areaId, laneId, rowId = null, key, title, subtitle = "",
      entries, headerNodeIds = [], groupId = null }) => {
      const cardId = `composite:${JSON.stringify([serviceIdFor(headerNodeIds.concat(entries.flatMap((entry) => entry.nodeIds))),
        rowId || null, kind, key])}`;
      const card = { id: cardId, rowId, areaId, laneId, kind, type: "COMPOSITE", displayType, title, subtitle, key,
        headerItemId: null, groupId, items: [], originalNodeIds: [], originalEdgeIds: [],
        evidenceIds: [], findingIds: [], bounds: null, headerBounds: null, contentBounds: null,
        itemBoundsById: {}, inputPortIds: [], outputPortIds: [], position: null,
        displayKind: "composite-card", isCompositeCard: true };
      const itemSpecs = [];
      if (headerNodeIds.length) itemSpecs.push({ kind: "HEADER", key: "header", nodeIds: headerNodeIds,
        label: title, detail: subtitle, isHeader: true, selectionGroupId: card.id });
      itemSpecs.push(...entries);
      itemSpecs.forEach((spec) => {
        const nodeIds = unique(spec.nodeIds || []).sort((left, right) => text(left).localeCompare(text(right)));
        const itemId = `composite-item:${JSON.stringify([cardId, spec.kind, spec.key, nodeIds])}`;
        const relatedEdges = graph.edges.filter((edge) => nodeIds.includes(edge.sourceId) || nodeIds.includes(edge.targetId));
        const edgeIds = unique([...(spec.edgeIds || []), ...relatedEdges.map((edge) => edge.id)]);
        const evidenceIds = unique(nodeIds.flatMap((id) => nodeById.get(id)?.evidenceIds || [])
          .concat(edgeIds.flatMap((id) => edgeById.get(id)?.evidenceIds || [])));
        const findingIds = findings.filter((finding) => (finding.nodeIds || []).some((id) => nodeIds.includes(id))
          || (finding.edgeIds || []).some((id) => edgeIds.includes(id))).map((finding) => finding.id);
        const item = { id: itemId, cardId, areaId, rowId, kind: spec.kind, type: spec.kind, key: spec.key, label: text(spec.label),
          detail: text(spec.detail), originalNodeIds: nodeIds, originalEdgeIds: edgeIds, evidenceIds,
          findingIds, referenceOnly: Boolean(spec.referenceOnly), orderStatus: spec.orderStatus || null,
          order: spec.order === undefined ? null : spec.order, isHeader: Boolean(spec.isHeader),
          groupId: spec.groupId || null, selectionGroupId: spec.selectionGroupId || null,
          displayKind: "composite-item", isCompositeItem: true, nodeIds: nodeIds.slice(), edgeIds: edgeIds.slice(),
          inputPortIds: [], outputPortIds: [], bounds: null };
        card.items.push(item);
        itemById[itemId] = item;
        itemToOriginalNodeIds[itemId] = nodeIds.slice();
        itemToOriginalEdgeIds[itemId] = edgeIds.slice();
        nodeIds.forEach((nodeId) => {
          const ids = originalNodeToItemIds[nodeId] || (originalNodeToItemIds[nodeId] = []);
          if (!ids.includes(itemId)) ids.push(itemId);
          const cardsForNode = originalNodeToCardIds[nodeId] || (originalNodeToCardIds[nodeId] = []);
          if (!cardsForNode.includes(cardId)) cardsForNode.push(cardId);
          nodeItemsByRow.set(rowNodeKey(rowId, nodeId), itemId);
        });
      });
      card.headerItemId = card.items.find((item) => item.isHeader)?.id || null;
      card.originalNodeIds = unique(card.items.flatMap((item) => item.originalNodeIds));
      card.originalEdgeIds = unique(card.items.flatMap((item) => item.originalEdgeIds));
      card.evidenceIds = unique(card.items.flatMap((item) => item.evidenceIds));
      card.findingIds = unique(card.items.flatMap((item) => item.findingIds));
      card.handlerIds = card.kind === "CONTROLLER_HANDLER" ? card.originalNodeIds.slice() : [];
      card.endpointIds = card.kind === "API_MAPPING" ? card.originalNodeIds.slice() : [];
      card.nodeIds = card.originalNodeIds.slice();
      card.handlerMethods = card.handlerIds.map((id) => text(attributes(nodeById.get(id)).handler)).filter(Boolean);
      card.controllerFqcn = card.key && !String(card.key).startsWith("unresolved:") ? String(card.key) : "";
      card.controllerName = card.controllerFqcn ? card.controllerFqcn.slice(card.controllerFqcn.lastIndexOf(".") + 1) : card.title;
      card.edgeIds = card.originalEdgeIds.slice();
      card.position = null;
      cards.push(card);
      cardById[cardId] = card;
      if (rowId) {
        const rowCards = rowToCardIds[rowId] || (rowToCardIds[rowId] = []);
        rowCards.push(cardId);
      }
      return card;
    };
    const entryForNode = (node, kind = node.type) => {
      const semantic = supportDisplaySemantic(node);
      const presentation = blueprintNodePresentation(node);
      if (node.type === "FILTER") {
        const info = attributes(node).registrationKind === "SERVLET"
          ? servletFilterOrder[node.id] : securityFilterOrder[node.id];
        const status = info && info.status || "UNKNOWN";
        const order = ["CONFIRMED", "REGISTRATION"].includes(status) && info ? info.order : null;
        return { kind, key: node.id, nodeIds: [node.id], label: presentation.label,
          detail: order !== null ? String(order).padStart(2, "0") : "순서 확인 불가",
          orderStatus: status, order };
      }
      if (node.type === "ENDPOINT") {
        return { kind, key: node.id, nodeIds: [node.id], label: presentation.label, detail: presentation.detail };
      }
      if (node.type === "HANDLER") {
        const parts = handlerParts(attributes(node).handler || node.label);
        return { kind, key: node.id, nodeIds: [node.id], label: parts.method || presentation.label, detail: "",
          handlerMethod: parts.method, handlerSignature: parts.signature };
      }
      if (["AUTHORIZATION", "SECURITY_DATA"].includes(node.type)) {
        return { kind, key: node.id, nodeIds: [node.id], label: presentation.label, detail: presentation.detail };
      }
      return { kind, key: node.id, nodeIds: [node.id], label: presentation.label,
        detail: presentation.detail || (semantic.detail === "원본 확인 필요" ? "" : semantic.detail) };
    };
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const sortNodes = (ids, comparator) => ids.map((id) => nodeById.get(id)).filter(Boolean).sort(comparator);
    const stableNodeOrder = (left, right) => text(left.id).localeCompare(text(right.id));
    const servletByService = new Map();
    servletFilters.forEach((node) => {
      const service = text(node.serviceId) || "unknown-service";
      const list = servletByService.get(service) || [];
      list.push(node);
      servletByService.set(service, list);
    });
    servletByService.forEach((nodes, serviceId) => {
      nodes.sort((left, right) => {
        const leftInfo = servletFilterOrder[left.id] || {};
        const rightInfo = servletFilterOrder[right.id] || {};
        return (["CONFIRMED", "REGISTRATION"].includes(leftInfo.status) ? leftInfo.order : Number.POSITIVE_INFINITY)
          - (["CONFIRMED", "REGISTRATION"].includes(rightInfo.status) ? rightInfo.order : Number.POSITIVE_INFINITY)
          || text(left.id).localeCompare(text(right.id));
      });
      makeCard({ kind: "SERVLET_FILTERS", displayType: "FILTER", areaId: "servlet-filter", laneId: "servlet-filter",
        key: serviceId, title: "Servlet 필터", subtitle: `${nodes.length}개 등록${nodes.some((node) => servletFilterOrder[node.id]?.status === "REGISTRATION") ? " · FilterMap 등록 순서" : ""}`,
        entries: nodes.map((node) => entryForNode(node)) });
    });
    const applicationNodes = graph.nodes.filter((node) => node.type === "APPLICATION");
    applicationNodes.forEach((node) => makeCard({ kind: "APPLICATION_CONTEXT", displayType: "APPLICATION",
      areaId: "servlet-filter", laneId: "servlet-filter", key: node.id,
      title: text(attributes(node).applicationName || attributes(node).applicationClass || node.label) || "Application",
      subtitle: text(node.serviceId), entries: [entryForNode(node)] }));
    const servletNodes = graph.nodes.filter((node) => node.type === "SERVLET"
      && !(attributes(node).servletKind === "DISPATCHER" || text(attributes(node).servletClass).endsWith(".DispatcherServlet")
        || text(attributes(node).servletName).toLowerCase() === "dispatcherservlet"));
    servletNodes.forEach((node) => makeCard({ kind: "SERVLET_ENTRY", displayType: "SERVLET", areaId: "servlet-filter",
      laneId: "servlet-filter", key: node.id, title: text(attributes(node).servletName || node.label),
      subtitle: text(attributes(node).urlPattern), entries: [entryForNode(node)] }));

    const endpointGroupByRow = new Map();
    const handlerGroupByRow = new Map();
    rows.forEach((row) => {
      const rowId = row.id;
      const chain = row.chainId ? nodeById.get(row.chainId) : null;
      const rowFilters = row.members.filters.filter((id) => nodeById.get(id)?.type === "FILTER");
      if (chain) {
        const confirmed = chainFilterOrderStatus[chain.id] === "CONFIRMED";
        const order = text(attributes(chain).chainOrder);
        const matcher = text(attributes(chain).matcherCondition) || "조건 확인 불가";
        const filterIds = rowFilters.slice().sort((leftId, rightId) => {
          const left = securityFilterOrder[leftId] || {};
          const right = securityFilterOrder[rightId] || {};
          if (confirmed && left.status === "CONFIRMED" && right.status === "CONFIRMED" && left.order !== right.order) {
            return left.order - right.order;
          }
          return text(leftId).localeCompare(text(rightId));
        });
        const filterEntries = filterIds.map((id) => {
          const node = nodeById.get(id);
          const entry = entryForNode(node);
          if (!confirmed) { entry.orderStatus = "UNKNOWN"; entry.order = null; entry.detail = "Filter 순서 확인 불가"; }
          return entry;
        });
        makeCard({ kind: "SECURITY_CHAIN", displayType: "SECURITY_CHAIN", areaId: "spring-security",
          laneId: "security-chain", rowId, key: chain.id, title: "SecurityFilterChain",
          subtitle: [`순서 ${order || "확인 불가"}`, matcher,
            confirmed ? "Filter 순서 확인" : "Filter 순서 확인 불가"].join(" · "),
          headerNodeIds: [chain.id], entries: filterEntries });
      } else if (rowFilters.length) {
        const filterIds = rowFilters.filter((id) => attributes(nodeById.get(id)).registrationKind === "SECURITY")
          .sort((leftId, rightId) => text(leftId).localeCompare(text(rightId)));
        const unclassifiedFilterIds = rowFilters.filter((id) => !["SECURITY", "SERVLET"]
          .includes(attributes(nodeById.get(id)).registrationKind))
          .sort((leftId, rightId) => text(leftId).localeCompare(text(rightId)));
        if (filterIds.length) makeCard({ kind: "SECURITY_UNRESOLVED", displayType: "FILTER", areaId: "spring-security",
          laneId: "security-chain", rowId, key: rowId, title: "보안 Filter",
          subtitle: "Chain 소속 확인 불가", entries: filterIds.map((id) => {
            const item = entryForNode(nodeById.get(id));
            item.orderStatus = "UNKNOWN";
            item.order = null;
            item.detail = "Chain 소속 및 순서 확인 불가";
            return item;
          }) });
        if (unclassifiedFilterIds.length) makeCard({ kind: "UNRESOLVED_FILTERS", displayType: "FILTER",
          areaId: "spring-security", laneId: "security-chain", rowId, key: rowId,
          title: "미확정 Filter", subtitle: "등록 종류 확인 불가",
          entries: unclassifiedFilterIds.map((id) => ({ ...entryForNode(nodeById.get(id)),
            detail: "등록 종류와 순서 확인 불가", orderStatus: "UNKNOWN", order: null })) });
      }

      const checkTypes = ["AUTHENTICATION", "AUTHORIZATION", "SECURITY_DATA", "BUSINESS_SECURITY_STATE"];
      checkTypes.forEach((kind) => {
        const entries = (row.securityEntries || []).filter((entry) => entry.type === kind).map((entry) => {
          const nodeIds = entry.nodeIds || [entry.nodeId];
          const originals = nodeIds.map((id) => nodeById.get(id)).filter(Boolean);
          const semantic = supportDisplaySemantic(originals[0]);
          const originalAttributes = originals.map((node) => attributes(node));
          let label = semantic.primary;
          let detail = semantic.detail;
          if (kind === "AUTHORIZATION" && originals.length > 1) {
            const authorities = unique(originalAttributes.map((data) => text(data.requiredAuthority)).filter(Boolean));
            if (semantic.key === "URL:AUTHORITY_REQUIRED") {
              label = authorities.length === 1 ? `${authorities[0]} 권한 필요` : "권한 요구";
            }
            const policySource = text(originalAttributes[0].policySource).toUpperCase();
            const sourceLabel = policySource === "URL" ? "URL 정책" : policySource === "METHOD" ? "메서드 정책" : "인가 정책";
            const conditions = unique(originalAttributes.map((data) => text(data.policyMatcherCondition || data.matcherCondition))
              .filter(Boolean));
            const orders = unique(originalAttributes.map((data) => text(data.policyOrder)).filter(Boolean)).sort();
            detail = [entry.subgroupLabel, `${sourceLabel} ${originals.length}건`,
              conditions.length === 1 ? `조건 ${conditions[0]}` : conditions.length > 1 ? `조건 ${conditions.length}종` : "",
              orders.length ? `정책 순서 ${orders.join(", ")}` : ""]
              .filter(Boolean).join(" · ");
          } else if (kind === "SECURITY_DATA" && originals.length > 1) {
            const semantics = originals.map((node) => supportDisplaySemantic(node));
            const labels = unique(semantics.map((item) => item.primary));
            if (labels.length > 1) {
              const kinds = unique(semantics.map((item) => item.kind).filter(Boolean));
              label = `${kinds.length === 1 ? kinds[0] : typeTitle[kind]} ${originals.length}건`;
              detail = labels.join(" · ");
            } else {
              detail = [entry.subgroupLabel, `관련 정보 ${originals.length}건`].filter(Boolean).join(" · ");
            }
          } else if (kind === "BUSINESS_SECURITY_STATE" && originals.length === 1) {
            const data = originalAttributes[0];
            const stateName = text(data.stateName).trim();
            const stateAction = text(data.stateAction).trim().toUpperCase();
            const actionLabel = stateActionLabels[stateAction] || stateAction;
            const method = handlerParts(data.declaringMethod);
            const declaringMethod = [method.owner, method.method].filter(Boolean).join(" · ");
            if (stateName || stateAction) label = [actionLabel, stateName].filter(Boolean).join(" · ");
            if (declaringMethod) detail = declaringMethod;
          } else if (originals.length === 1 && !["AUTHORIZATION", "SECURITY_DATA"].includes(kind)) {
            label = text(originals[0].label) || semantic.primary;
          }
          return { kind, key: entry.key || entry.id || nodeIds.join("|"), nodeIds, label, detail,
            groupId: entry.entryKind === "group" ? entry.id : null };
        }).filter((entry) => entry.nodeIds.length);
        if (!entries.length) return;
        makeCard({ kind, displayType: kind, areaId: "security-checks", laneId: "security-checks", rowId,
          key: kind, title: typeTitle[kind], subtitle: "", entries });
      });

      const endpointGroups = new Map();
      row.members.endpoints.forEach((endpointId) => {
        const endpoint = nodeById.get(endpointId);
        if (!endpoint) return;
        const mappedHandler = endpointHandlers.get(endpointId);
        const controller = mappedHandler ? controllerFqcn(mappedHandler) : "";
        const key = mappedHandler && controller ? controller : `unresolved:${rowId}`;
        const list = endpointGroups.get(key) || [];
        list.push(endpoint);
        endpointGroups.set(key, list);
      });
      endpointGroups.forEach((nodes, key) => {
        const fqcn = key.startsWith("unresolved:") ? "" : key;
        const entries = sortNodes(nodes.map((node) => node.id), (left, right) => {
          const leftKey = `${text(attributes(left).httpMethod)} ${text(attributes(left).path)}`;
          const rightKey = `${text(attributes(right).httpMethod)} ${text(attributes(right).path)}`;
          return leftKey.localeCompare(rightKey) || stableNodeOrder(left, right);
        }).map((node) => entryForNode(node));
        const card = makeCard({ kind: "API_MAPPING", displayType: "ENDPOINT", areaId: "api-mapping",
          laneId: "endpoint", rowId, key, title: compactClassName(fqcn) || "매핑 확인 불가",
          subtitle: "", entries });
        endpointGroupByRow.set(rowNodeKey(rowId, key), card);
      });

      const endpointOrderByHandler = new Map();
      endpointHandlers.forEach((handler, endpointId) => {
        const endpoint = nodeById.get(endpointId);
        if (!endpoint) return;
        const order = `${text(attributes(endpoint).httpMethod)} ${text(attributes(endpoint).path)}`;
        const orders = endpointOrderByHandler.get(handler.id) || [];
        orders.push(order);
        endpointOrderByHandler.set(handler.id, orders);
      });
      const handlerGroups = new Map();
      row.members.handlers.forEach((handlerId) => {
        const handler = nodeById.get(handlerId);
        if (!handler) return;
        const fqcn = controllerFqcn(handler);
        const key = fqcn || `unresolved:${handlerId}`;
        const list = handlerGroups.get(key) || [];
        list.push(handler);
        handlerGroups.set(key, list);
      });
      handlerGroups.forEach((nodes, key) => {
        const fqcn = key.startsWith("unresolved:") ? "" : key;
        const entries = sortNodes(nodes.map((node) => node.id), (left, right) => {
          const mappedOrder = (node) => (endpointOrderByHandler.get(node.id) || []).slice().sort()
            .join("\u0001");
          const mappedDifference = mappedOrder(left).localeCompare(mappedOrder(right));
          if (mappedDifference) return mappedDifference;
          const leftValue = text(attributes(left).handler || left.label);
          const rightValue = text(attributes(right).handler || right.label);
          return leftValue.localeCompare(rightValue) || stableNodeOrder(left, right);
        }).map((node) => entryForNode(node));
        const overloadsByMethod = new Map();
        entries.forEach((entry) => {
          const signatures = overloadsByMethod.get(entry.handlerMethod) || new Set();
          signatures.add(entry.handlerSignature);
          overloadsByMethod.set(entry.handlerMethod, signatures);
        });
        const overloadIndexes = new Map();
        entries.forEach((entry) => {
          const signatures = overloadsByMethod.get(entry.handlerMethod);
          if (!signatures || signatures.size < 2) return;
          const index = (overloadIndexes.get(entry.handlerMethod) || 0) + 1;
          overloadIndexes.set(entry.handlerMethod, index);
          entry.label = `${entry.handlerMethod} · ${index}`;
        });
        const group = controllerGroups.find((candidate) => candidate.layoutGroupId === rowId
          && candidate.handlerIds.some((id) => nodes.some((node) => node.id === id)));
        const card = makeCard({ kind: "CONTROLLER_HANDLER", displayType: "HANDLER", areaId: "controller-handler",
          laneId: "handler", rowId, key, title: compactClassName(fqcn) || "Controller 확인 불가",
          subtitle: "", entries, groupId: group && group.id });
        handlerGroupByRow.set(rowNodeKey(rowId, key), card);
      });
    });

    const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
    const cardHeight = (card) => {
      const headerHeight = card.kind === "SECURITY_CHAIN" ? OVERVIEW_CHAIN_HEADER_HEIGHT : OVERVIEW_HEADER_HEIGHT;
      const width = laneById.get(card.laneId)?.cardWidth || OVERVIEW_CARD_WIDTHS[card.kind] || OVERVIEW_CARD_WIDTHS.CONTEXT;
      return blueprintCardGeometry(card.items, { x: 0, y: 0, width, headerHeight }).bounds.height;
    };
    const setCardGeometry = (card, x, y) => {
      const lane = laneById.get(card.laneId);
      const width = lane && lane.cardWidth || OVERVIEW_CARD_WIDTHS[card.kind] || OVERVIEW_CARD_WIDTHS.CONTEXT;
      const headerHeight = card.kind === "SECURITY_CHAIN" ? OVERVIEW_CHAIN_HEADER_HEIGHT : OVERVIEW_HEADER_HEIGHT;
      const geometry = blueprintCardGeometry(card.items, { x, y, width, headerHeight });
      Object.assign(card, geometry);
      card.position = { x, y, width, height: card.bounds.height };
      card.layout = { cardId: card.id, bounds: card.bounds, headerBounds: card.headerBounds,
        itemBoundsById: card.itemBoundsById, contentBounds: card.contentBounds,
        portIds: card.items.flatMap((item) => [...item.inputPortIds, ...item.outputPortIds]) };
    };

    let cursorY = TOP_PADDING + 24;
    rows.forEach((row) => {
      const rowCards = cards.filter((card) => card.rowId === row.id);
      const security = rowCards.filter((card) => ["SECURITY_CHAIN", "SECURITY_UNRESOLVED", "UNRESOLVED_FILTERS"].includes(card.kind));
      const checks = rowCards.filter((card) => ["AUTHENTICATION", "AUTHORIZATION", "SECURITY_DATA",
        "BUSINESS_SECURITY_STATE"].includes(card.kind));
      const apiCards = rowCards.filter((card) => card.kind === "API_MAPPING");
      const handlerCards = rowCards.filter((card) => card.kind === "CONTROLLER_HANDLER");
      const pairedKeys = unique(apiCards.map((card) => card.key).filter((key) => !key.startsWith("unresolved:")
        && handlerCards.some((card) => card.key === key))).sort((left, right) => text(left).localeCompare(text(right)));
      const pairedApiIds = new Set(pairedKeys.map((key) => apiCards.find((card) => card.key === key).id));
      const pairedHandlerIds = new Set(pairedKeys.map((key) => handlerCards.find((card) => card.key === key).id));
      const unmatchedApis = apiCards.filter((card) => !pairedApiIds.has(card.id))
        .sort((left, right) => text(left.key).localeCompare(text(right.key)));
      const unmatchedHandlers = handlerCards.filter((card) => !pairedHandlerIds.has(card.id))
        .sort((left, right) => text(left.key).localeCompare(text(right.key)));
      // 확정 FQCN 쌍을 우선 배치하고 미확정 카드는 관계 없이 각 영역 순서대로 정렬
      const pairs = pairedKeys.map((key) => ({ key, api: apiCards.find((card) => card.key === key),
        handler: handlerCards.find((card) => card.key === key) }));
      const unmatchedCount = Math.max(unmatchedApis.length, unmatchedHandlers.length);
      for (let index = 0; index < unmatchedCount; index += 1) pairs.push({ key: `unmatched:${row.id}:${index}`,
        api: unmatchedApis[index] || null, handler: unmatchedHandlers[index] || null });
      const pairColumnCount = Math.min(2, Math.max(1, laneById.get("endpoint")?.columns || 1,
        laneById.get("handler")?.columns || 1));
      const pairRows = [];
      for (let index = 0; index < pairs.length; index += pairColumnCount) {
        pairRows.push(pairs.slice(index, index + pairColumnCount));
      }
      const pairRowHeights = pairRows.map((pairRow) => Math.max(0, ...pairRow.flatMap((pair) =>
        [pair.api, pair.handler].filter(Boolean).map(cardHeight))));
      const pairBlockHeight = pairRowHeights.reduce((height, itemHeight, index) => height + itemHeight
        + (index ? OVERVIEW_ROW_GAP : 0), 0);
      const checkRows = [];
      for (let index = 0; index < checks.length; index += 2) checkRows.push(checks.slice(index, index + 2));
      const checkRowHeights = checkRows.map((checkRow) => Math.max(0, ...checkRow.map(cardHeight)));
      const checkBlockHeight = checkRowHeights.reduce((height, itemHeight, index) => height + itemHeight
        + (index ? OVERVIEW_ROW_GAP : 0), 0);
      const rowHeight = Math.max(0, ...security.map(cardHeight), pairBlockHeight, checkBlockHeight, 72);
      row.rowTop = cursorY;
      row.rowHeight = rowHeight + OVERVIEW_ROW_GAP;
      row.rowBottom = row.rowTop + row.rowHeight;
      security.forEach((card, index) => {
        const lane = laneById.get(card.laneId);
        setCardGeometry(card, lane.x, row.rowTop + (row.rowHeight - cardHeight(card)) / 2);
        const chainGroup = row.chainId && row.id === `chain:${row.chainId}`
          ? null : null;
        void chainGroup;
      });
      let checkY = row.rowTop + Math.max(0, (row.rowHeight - checkBlockHeight) / 2);
      checkRows.forEach((checkRow, rowIndex) => {
        const rowCardHeight = checkRowHeights[rowIndex];
        checkRow.forEach((card, column) => {
          const lane = laneById.get(card.laneId);
          setCardGeometry(card, lane.x + column * lane.columnStep, checkY + (rowCardHeight - cardHeight(card)) / 2);
        });
        checkY += rowCardHeight + OVERVIEW_ROW_GAP;
      });
      let pairY = row.rowTop + Math.max(0, (row.rowHeight - pairBlockHeight) / 2);
      pairRows.forEach((pairRow, rowIndex) => {
        const pairHeight = pairRowHeights[rowIndex];
        pairRow.forEach((pair, column) => {
          const apiLane = laneById.get("endpoint");
          const handlerLane = laneById.get("handler");
          const x = apiLane.x + column * apiLane.columnStep;
          if (pair.api) setCardGeometry(pair.api, x, pairY + (pairHeight - cardHeight(pair.api)) / 2);
          if (pair.handler) setCardGeometry(pair.handler, handlerLane.x + column * handlerLane.columnStep,
            pairY + (pairHeight - cardHeight(pair.handler)) / 2);
        });
        pairY += pairHeight + OVERVIEW_ROW_GAP;
      });
      row.sectionHeights = { chainFilter: Math.max(0, ...security.map(cardHeight)),
        securityChecks: checkBlockHeight, endpoint: pairBlockHeight, handler: pairBlockHeight };
      cursorY = row.rowBottom + CHAIN_GAP;
    });

    const servletCards = cards.filter((card) => card.kind === "SERVLET_FILTERS");
    const rowTop = rows.length ? rows[0].rowTop : TOP_PADDING;
    const rowBottom = rows.length ? rows[rows.length - 1].rowBottom : rowTop + OVERVIEW_ROW_GAP;
    servletCards.forEach((card, index) => {
      const lane = laneById.get(card.laneId);
      setCardGeometry(card, lane.x, rowTop + Math.max(0, (rowBottom - rowTop - cardHeight(card)) / 2) + index * OVERVIEW_ROW_GAP);
    });
    cards.filter((card) => card.kind === "APPLICATION_CONTEXT" || card.kind === "SERVLET_ENTRY")
      .forEach((card, index) => {
        const lane = laneById.get(card.laneId);
        const belowFilters = servletCards.length ? Math.max(...servletCards.map((item) => item.bounds.y + item.bounds.height))
          + OVERVIEW_ROW_GAP : rowTop;
        setCardGeometry(card, lane.x, belowFilters + index * (cardHeight(card) + OVERVIEW_ROW_GAP));
      });

    const chainCardByRow = new Map(cards.filter((card) => card.kind === "SECURITY_CHAIN").map((card) => [card.rowId, card]));
    rows.forEach((row) => {
      const chainCard = chainCardByRow.get(row.id);
      if (!chainCard) return;
      const chainId = row.chainId;
      row.bounds = { ...chainCard.bounds };
    });
    cards.forEach((card) => {
      const headerHeight = card.kind === "SECURITY_CHAIN" ? OVERVIEW_CHAIN_HEADER_HEIGHT : OVERVIEW_HEADER_HEIGHT;
      Object.assign(card, blueprintCardGeometry(card.items, { x: card.bounds.x, y: card.bounds.y,
        width: card.bounds.width, headerHeight }));
      card.position = { x: card.bounds.x, y: card.bounds.y, width: card.bounds.width, height: card.bounds.height };
      card.layout = { cardId: card.id, bounds: card.bounds, headerBounds: card.headerBounds,
        itemBoundsById: card.itemBoundsById, contentBounds: card.contentBounds,
        portIds: card.items.flatMap((item) => [...item.inputPortIds, ...item.outputPortIds]) };
    });
    const instances = cards.map((card) => ({ id: card.id, rowId: card.rowId, originalNodeIds: card.originalNodeIds.slice(),
      displayType: card.displayType, kind: "composite-card", position: card.position, width: card.bounds.width,
      height: card.bounds.height, bounds: card.bounds, areaId: card.areaId, composite: card }));
    return { cards, instances, cardById, itemById, nodeItemsByRow, rowToCardIds, originalNodeToItemIds,
      itemToOriginalNodeIds, itemToOriginalEdgeIds, originalNodeToCardIds };
  }

  function runtimeArea(kind) {
    const value = text(kind).toUpperCase();
    if (value === "APPLICATION_CONTEXT" || value === "WEB_SERVER" || value.startsWith("TOMCAT_")) return "host";
    if (value === "DISPATCHER_SERVLET") return "mvc";
    if (value.startsWith("SERVLET")) return "servlet";
    if (value.startsWith("SECURITY_") || value === "FILTER_CHAIN_PROXY" || value === "REQUEST_MATCHER"
      || value.startsWith("AUTHENTICATION_") || value.endsWith("_REPOSITORY") || value === "REQUEST_CACHE") return "security";
    if (value.startsWith("HANDLER_") || value === "ARGUMENT_RESOLVER" || value === "MESSAGE_CONVERTER"
      || value === "MVC_INTERCEPTOR" || value === "EXCEPTION_RESOLVER") return "mvc";
    return null;
  }

  function buildDetailBlueprint(architecture, graph, endpointId, flowIndex = null) {
    if (!architecture || !architecture.environment || !Array.isArray(architecture.components)) return null;
    const environment = architecture.environment;
    const webType = text(environment.webApplicationType).toUpperCase();
    const coverage = Array.isArray(architecture.coverage) ? architecture.coverage : [];
    const coverageFor = (area) => {
      const entries = coverage.filter((item) => text(item.area).toUpperCase() === area);
      if (entries.some((item) => item.state === "PARTIAL")) return "PARTIAL";
      if (entries.some((item) => item.state === "UNKNOWN")) return "UNKNOWN";
      if (entries.some((item) => item.state === "PRESENT")) return "PRESENT";
      if (entries.some((item) => item.state === "ABSENT")) return "ABSENT";
      if (entries.some((item) => item.state === "NOT_SUPPORTED")) return "NOT_SUPPORTED";
      return "UNKNOWN";
    };
    if (webType === "NON_WEB" || webType === "REACTIVE") {
      return {
        supported: false,
        statusText: webType === "REACTIVE" ? "Reactive 애플리케이션 · Servlet 상세 구조 미지원"
          : "비웹 애플리케이션 · Servlet 상세 구조 미지원",
        regions: [], cards: [], relations: [], runtimeComponents: [], runtimeRelationships: [],
        bounds: { left: 24, top: 28, right: 600, bottom: 72, width: 576, height: 44 },
        showSecurityLearning: false, showMvcLearning: false
      };
    }

    const components = architecture.components.filter((item) => item && item.id && runtimeArea(item.kind));
    const componentById = new Map(components.map((item) => [item.id, item]));
    const graphNodeIds = new Set((graph.nodes || []).map((node) => node.id));
    const endpoint = endpointId && (graph.nodes || []).find((node) => node.id === endpointId && node.type === "ENDPOINT");
    if (endpointId && !endpoint) return null;
    const included = new Set();
    const applicationContexts = components.filter((item) => item.kind === "APPLICATION_CONTEXT");
    if (applicationContexts.length === 1) included.add(applicationContexts[0].id);
    components.forEach((component) => {
      if ((component.graphNodeIds || []).some((id) => graphNodeIds.has(id))) included.add(component.id);
    });

    // 실제 상위 객체와 확인된 소유 관계를 따라 선택 API의 환경 범위만 확장
    const relationships = Array.isArray(architecture.relationships) ? architecture.relationships : [];
    let changed = true;
    while (changed) {
      changed = false;
      components.forEach((component) => {
        if (!included.has(component.id)) return;
        if (component.parentId && componentById.has(component.parentId) && !included.has(component.parentId)) {
          included.add(component.parentId);
          changed = true;
        }
      });
      relationships.filter((relation) => relation && relation.kind === "CONTAINS" && relation.confidence === "CONFIRMED")
        .forEach((relation) => {
          if (included.has(relation.targetId) && componentById.has(relation.sourceId) && !included.has(relation.sourceId)) {
            included.add(relation.sourceId);
            changed = true;
          }
        });
    }

    const selectedMvc = components.some((item) => included.has(item.id) && runtimeArea(item.kind) === "mvc")
      || ["PRESENT", "PARTIAL"].includes(coverageFor("MVC"));
    if (selectedMvc && coverageFor("MVC") !== "ABSENT") {
      const contextIds = new Set(components.filter((item) => included.has(item.id) && runtimeArea(item.kind) === "mvc")
        .map((item) => item.contextId).filter(Boolean));
      components.filter((item) => runtimeArea(item.kind) === "mvc" && contextIds.has(item.contextId)
        && ["HANDLER_ADAPTER", "ARGUMENT_RESOLVER", "MESSAGE_CONVERTER", "MVC_INTERCEPTOR", "EXCEPTION_RESOLVER"].includes(item.kind))
        .forEach((item) => included.add(item.id));
      changed = true;
      while (changed) {
        changed = false;
        components.forEach((component) => {
          if (component.parentId && included.has(component.parentId) && runtimeArea(component.kind) === "mvc"
            && ["ARGUMENT_RESOLVER", "MESSAGE_CONVERTER"].includes(component.kind) && !included.has(component.id)) {
            included.add(component.id);
            changed = true;
          }
        });
      }
    }

    const contextIds = new Set(components.filter((item) => included.has(item.id)).map((item) => item.contextId).filter(Boolean));
    contextIds.forEach((contextId) => {
      ["APPLICATION_CONTEXT", "WEB_SERVER", "SERVLET_CONTEXT"].forEach((kind) => {
        const candidates = components.filter((item) => item.kind === kind && item.contextId === contextId);
        if (candidates.length === 1) included.add(candidates[0].id);
      });
      if (selectedMvc) {
        components.filter((item) => ["SERVLET", "DISPATCHER_SERVLET", "SERVLET_REGISTRATION"].includes(item.kind)
          && item.contextId === contextId).forEach((item) => included.add(item.id));
      }
    });
    const servletContextIds = new Set(components.filter((item) => included.has(item.id)
      && item.kind === "SERVLET_CONTEXT").map((item) => item.contextId));
    const servletRegistrationIds = new Set(components.filter((item) => item.kind === "SERVLET_FILTER_REGISTRATION"
      && servletContextIds.has(item.contextId)).map((item) => item.id));
    servletRegistrationIds.forEach((id) => included.add(id));
    const servletContextComponentIds = new Set(components.filter((item) => item.kind === "SERVLET_CONTEXT"
      && servletContextIds.has(item.contextId)).map((item) => item.id));
    const tomcatContextComponentIds = new Set(components.filter((item) => item.kind === "TOMCAT_CONTEXT"
      && servletContextIds.has(item.contextId)).map((item) => item.id));
    components.filter((item) => item.kind === "TOMCAT_FILTER_MAPPING" && servletContextIds.has(item.contextId)
      && (servletContextComponentIds.has(item.parentId) || tomcatContextComponentIds.has(item.parentId)))
      .forEach((item) => included.add(item.id));
    changed = true;
    while (changed) {
      changed = false;
      components.forEach((component) => {
        if (!included.has(component.id)) return;
        if (component.parentId && componentById.has(component.parentId) && !included.has(component.parentId)) {
          included.add(component.parentId);
          changed = true;
        }
      });
      relationships.filter((relation) => relation && relation.kind === "CONTAINS" && relation.confidence === "CONFIRMED")
        .forEach((relation) => {
          if (included.has(relation.targetId) && componentById.has(relation.sourceId) && !included.has(relation.sourceId)) {
            included.add(relation.sourceId);
            changed = true;
          }
        });
    }
    changed = true;
    while (changed) {
      changed = false;
      components.forEach((component) => {
        if (included.has(component.id) || runtimeArea(component.kind) !== "host") return;
        if (component.kind === "WEB_SERVER"
          && components.filter((candidate) => candidate.kind === "WEB_SERVER" && candidate.contextId === component.contextId).length !== 1) return;
        if (component.parentId && included.has(component.parentId)) {
          included.add(component.id);
          changed = true;
        }
      });
      relationships.filter((relation) => relation && relation.kind === "CONTAINS" && relation.confidence === "CONFIRMED")
        .forEach((relation) => {
          const source = componentById.get(relation.sourceId);
          if (included.has(relation.sourceId) && source && source.kind === "WEB_SERVER"
            && componentById.has(relation.targetId) && !included.has(relation.targetId)
            && runtimeArea(componentById.get(relation.targetId).kind) === "host") {
            included.add(relation.targetId);
            changed = true;
          }
        });
    }

    const scoped = components.filter((item) => included.has(item.id));
    const servletFilterExecution = resolveTomcatServletFilterExecution(architecture, graph, endpoint, scoped, flowIndex);
    const grouped = new Map(["host", "servlet", "security", "mvc"].map((area) => [area, []]));
    scoped.forEach((item) => grouped.get(runtimeArea(item.kind)).push(item));
    const typeOrder = new Map(["APPLICATION_CONTEXT", "WEB_SERVER", "TOMCAT_SERVER", "TOMCAT_SERVICE",
      "TOMCAT_CONNECTOR", "TOMCAT_ENGINE", "TOMCAT_HOST", "TOMCAT_CONTEXT", "TOMCAT_WRAPPER",
      "SERVLET_CONTEXT", "SERVLET", "DISPATCHER_SERVLET", "SERVLET_REGISTRATION", "SERVLET_FILTER_REGISTRATION",
      "FILTER_CHAIN_PROXY", "SECURITY_FILTER_CHAIN",
      "REQUEST_MATCHER", "SECURITY_FILTER", "AUTHENTICATION_MANAGER", "AUTHENTICATION_PROVIDER",
      "SECURITY_CONTEXT_REPOSITORY", "CSRF_TOKEN_REPOSITORY", "REQUEST_CACHE", "HANDLER_MAPPING",
      "HANDLER_METHOD", "HANDLER_ADAPTER", "ARGUMENT_RESOLVER", "MESSAGE_CONVERTER", "MVC_INTERCEPTOR"]
      .map((kind, index) => [kind, index]));
    const compareComponent = (left, right) => {
      const order = (typeOrder.get(left.kind) ?? 99) - (typeOrder.get(right.kind) ?? 99);
      if (order) return order;
      const leftOrder = Number(left.attributes && (left.attributes.filterOrder || left.attributes.chainOrder
        || left.attributes.registrationOrder)) || Number.MAX_SAFE_INTEGER;
      const rightOrder = Number(right.attributes && (right.attributes.filterOrder || right.attributes.chainOrder
        || right.attributes.registrationOrder)) || Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || text(left.id).localeCompare(text(right.id));
    };

    const cardWidth = 532;
    const itemWidth = 216;
    const itemHeight = 64;
    const itemColumnStep = 260;
    const itemRowGap = 16;
    const regionPadding = 14;
    const regionHeader = 58;
    const gap = 24;
    let cursorX = 24;
    let maxBottom = 76;
    const groups = [];
    const presentationById = new Map();
    [
      { id: "host", title: environment.serverKind && environment.serverKind !== "UNKNOWN"
        ? `${text(environment.serverKind).toUpperCase()} / WAS`
        : webType === "SERVLET" ? "SERVLET APPLICATION" : "APPLICATION RUNTIME" },
      { id: "servlet", title: "SERVLET CONTAINER" },
      { id: "security", title: "SPRING SECURITY" },
      { id: "mvc", title: "SPRING MVC" }
    ].forEach((definition) => {
      const items = grouped.get(definition.id).filter((component) =>
        !(component.graphNodeIds || []).some((id) => graphNodeIds.has(id))).slice().sort(compareComponent);
      if (!items.length) return;
      const columnCount = 2;
      const rowCount = Math.ceil(items.length / columnCount);
      const width = cardWidth;
      const height = regionHeader + regionPadding * 2 + rowCount * 150 + Math.max(0, rowCount - 1) * itemRowGap;
      const group = { ...definition, items, x: cursorX, y: 76, width, height, columnCount, rowCount };
      items.forEach((component, index) => {
        const column = index % columnCount;
        const row = Math.floor(index / columnCount);
        const x = group.x + regionPadding + 14 + column * itemColumnStep;
        const y = group.y + regionHeader + regionPadding + 72 + row * (150 + itemRowGap);
        const className = text(component.className) || text(component.kind);
        const hash = className.lastIndexOf("#");
        const owner = hash >= 0 ? className.slice(0, hash) : className;
        const method = hash >= 0 ? className.slice(hash + 1).replace(/\(.*$/, "") : "";
        const title = owner.slice(owner.lastIndexOf(".") + 1) || component.kind;
        const attributes = component.attributes || {};
        const detail = method ? `${method}()` : component.beanName ? `Bean 이름 · ${component.beanName}`
          : attributes.filterOrder ? `Filter ${attributes.filterOrder}`
            : attributes.chainOrder ? `Chain ${attributes.chainOrder}`
              : attributes.registrationOrder ? `등록 순서 ${attributes.registrationOrder}` : component.kind;
        const item = {
          id: `runtime-blueprint:item:${component.id}`, label: title, detail,
          originalNodeIds: (component.graphNodeIds || []).filter((id) => graphNodeIds.has(id)),
          runtimeComponentIds: [component.id], evidenceRefs: (component.evidenceIds || []).slice(), findingIds: [],
          originKind: "RUNTIME_COMPONENT", inputPorts: [`runtime-port:${component.id}:in`],
          outputPorts: [`runtime-port:${component.id}:out`], bounds: itemBounds(x, y, itemWidth, itemHeight)
        };
        presentationById.set(component.id, { title, detail, bounds: item.bounds, area: definition.id, item });
      });
      groups.push(group);
      cursorX += width + gap;
      maxBottom = Math.max(maxBottom, group.y + group.height);
    });

    // 같은 기술 책임의 Runtime 객체를 하나의 복합 카드와 개별 항목으로 구성
    const cards = [];
    const cardByComponent = new Map();
    const itemByComponent = new Map();
    groups.forEach((group) => {
      const items = group.items.map((component) => {
        const item = presentationById.get(component.id).item;
        itemByComponent.set(component.id, item);
        return item;
      });
      const card = {
        id: `runtime-blueprint:card:${group.id}`, title: group.title, kind: `RUNTIME_${group.id.toUpperCase()}`,
        areaId: group.id,
        regionId: `runtime-region:${group.id}`, bounds: itemBounds(group.x, group.y, group.width, group.height),
        headerBounds: itemBounds(group.x, group.y, group.width, regionHeader),
        contentBounds: itemBounds(group.x + regionPadding, group.y + regionHeader + regionPadding,
          group.width - regionPadding * 2, group.height - regionHeader - regionPadding * 2),
        itemBoundsById: Object.fromEntries(items.map((item) => [item.id, item.bounds])),
        runtimeComponentIds: group.items.map((component) => component.id),
        originalNodeIds: items.flatMap((item) => item.originalNodeIds),
        evidenceRefs: items.flatMap((item) => item.evidenceRefs), originKind: "RUNTIME_COMPONENT",
        items, groupId: group.id, confidence: "CONFIRMED"
      };
      group.items.forEach((component) => cardByComponent.set(component.id, card));
      cards.push(card);
    });
    const regions = [];
    const servletGroup = groups.find((group) => group.id === "servlet");
    const lastGroup = groups[groups.length - 1];
      const right = lastGroup ? lastGroup.x + lastGroup.width + 8 : cursorX - gap;
      const bottom = maxBottom + 8;
    const hostGroup = groups.find((group) => group.id === "host");
    if (hostGroup) regions.push({ id: "runtime-region:host", parentId: null, kind: "HOST",
      title: hostGroup.title, bounds: itemBounds(16, 24, right - 16, bottom - 24), coverage: coverageFor("WEB_SERVER"),
      componentIds: hostGroup.items.map((item) => item.id) });
    if (servletGroup) regions.push({ id: "runtime-region:servlet", parentId: hostGroup ? "runtime-region:host" : null,
      kind: "SERVLET", title: servletGroup.title,
      bounds: itemBounds(servletGroup.x - 8, servletGroup.y - 8, right - servletGroup.x + 8, bottom - servletGroup.y + 8),
      coverage: coverageFor("SERVLET"), componentIds: servletGroup.items.map((item) => item.id) });
    ["security", "mvc"].forEach((id) => {
      const group = groups.find((item) => item.id === id);
      if (!group) return;
      regions.push({ id: `runtime-region:${id}`, parentId: servletGroup ? "runtime-region:servlet"
        : hostGroup ? "runtime-region:host" : null, kind: id.toUpperCase(), title: group.title,
      bounds: itemBounds(group.x - 8, group.y - 8, group.width + 16, group.height + 16),
      coverage: coverageFor(id === "security" ? "SECURITY" : "MVC"), componentIds: group.items.map((item) => item.id) });
    });
    const layoutRelations = relationships.filter((relation) => relation && cardByComponent.has(relation.sourceId)
      && cardByComponent.has(relation.targetId) && cardByComponent.get(relation.sourceId) !== cardByComponent.get(relation.targetId)).map((relation) => {
      const sourceCard = cardByComponent.get(relation.sourceId);
      const targetCard = cardByComponent.get(relation.targetId);
      const source = sourceCard.bounds;
      const target = targetCard.bounds;
      const forward = target.x >= source.x;
      return { id: relation.id, kind: relation.kind, sourceId: relation.sourceId, targetId: relation.targetId,
        sourceCardId: sourceCard.id, targetCardId: targetCard.id,
        sourceItemId: itemByComponent.get(relation.sourceId).id, targetItemId: itemByComponent.get(relation.targetId).id,
        confidence: relation.confidence,
        originKind: "RUNTIME_RELATIONSHIP", runtimeRelationshipIds: [relation.id], evidenceRefs: relation.evidenceIds || [],
        originalEdgeIds: [], direction: forward ? "FORWARD" : "REVERSED", routeKind: "CUBIC" };
    });
    const regionIds = new Set(regions.map((region) => region.id));
    const includedRegions = regions.filter((region) => !region.parentId || regionIds.has(region.parentId));
    return {
      supported: true,
      statusText: cards.length ? "실제 Runtime 구성" : "선택한 API에 연결된 Runtime 객체 확인 불가",
      regions: includedRegions,
      cards,
      relations: layoutRelations,
      runtimeComponents: scoped,
      servletFilterExecution,
      runtimeRelationships: relationships.filter((relation) => included.has(relation.sourceId) && included.has(relation.targetId)),
      bounds: { left: 16, top: 24, right, bottom, width: right, height: bottom },
      showServletLearning: coverageFor("SERVLET") !== "ABSENT",
      showSecurityLearning: coverageFor("SECURITY") !== "ABSENT",
      showMvcLearning: coverageFor("MVC") !== "ABSENT"
    };
  }

  function itemBounds(x, y, width, height) {
    return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height };
  }

  function blueprintItemHeight(item, width) {
    const length = text(item.label).length + text(item.detail).length;
    const label = text(item.label);
    const limit = Math.max(12, Math.floor((width - 100) / 9));
    item.labelLines = [];
    if (item.kind === "ENDPOINT" && label.length > limit) {
      let remaining = label;
      while (remaining.length > limit) {
        const slash = remaining.lastIndexOf("/", limit);
        const split = slash > Math.floor(limit / 2) ? slash : limit;
        item.labelLines.push(remaining.slice(0, split));
        remaining = remaining.slice(split);
      }
      if (remaining) item.labelLines.push(remaining);
    }
    return (item.detail || length > 42 || item.labelLines.length > 1 ? OVERVIEW_ITEM_DETAIL_HEIGHT : OVERVIEW_ITEM_HEIGHT)
      + Math.max(0, item.labelLines.length - 1) * 18;
  }

  function blueprintCardGeometry(items, { x, y, width, headerHeight = OVERVIEW_HEADER_HEIGHT,
    padding = OVERVIEW_ITEM_PADDING, itemGap = 8, minHeight = 112 } = {}) {
    const bodyItems = (items || []).filter((item) => !item.isHeader);
    const itemHeights = bodyItems.map((item) => blueprintItemHeight(item, width - padding * 2));
    const bodyHeight = itemHeights.reduce((sum, height) => sum + height, 0)
      + Math.max(0, bodyItems.length - 1) * itemGap;
    const height = Math.max(minHeight, headerHeight + padding * 2 + bodyHeight);
    const bounds = itemBounds(x, y, width, height);
    const headerBounds = itemBounds(x, y, width, headerHeight);
    (items || []).filter((item) => item.isHeader).forEach((item) => { item.bounds = { ...headerBounds }; });
    const contentBounds = itemBounds(x + padding, y + headerHeight + padding,
      width - padding * 2, Math.max(0, height - headerHeight - padding * 2));
    let itemY = contentBounds.y;
    const itemBoundsById = {};
    bodyItems.forEach((item, index) => {
      const itemBound = itemBounds(contentBounds.x, itemY, contentBounds.width, itemHeights[index]);
      item.bounds = itemBound;
      itemBoundsById[item.id] = itemBound;
      itemY += itemBound.height + itemGap;
    });
    return { bounds, headerBounds, contentBounds, itemBoundsById };
  }

  // 선택 API와 확인된 Handler에 연결된 URL 인가 정책만 사용
  function selectedUrlPolicy(graph, chainId) {
    const endpointId = graph.detailEndpointId;
    const chain = graph.nodes.find((node) => node.id === chainId);
    if (!endpointId || !chain) return null;
    const handlers = graph.edges.filter((edge) => edge.type === "FLOWS_TO" && edge.confidence === "CONFIRMED"
      && edge.sourceId === endpointId).map((edge) => edge.targetId);
    const subjects = new Set([endpointId, ...handlers]);
    const ids = new Set(graph.edges.filter((edge) => edge.type === "SECURED_BY" && edge.confidence === "CONFIRMED"
      && subjects.has(edge.sourceId)).map((edge) => edge.targetId));
    const policies = graph.nodes.filter((node) => ids.has(node.id) && node.type === "AUTHORIZATION"
      && attributes(node).policySource === "URL" && text(attributes(node).chainKey)
      && text(attributes(node).chainKey) === text(attributes(chain).chainKey));
    return policies.length === 1 ? policies[0] : null;
  }

  function buildDetailCompositeModel(graph, blueprint, positions, projectionNodes, projectionEdges, projectionAliases = {},
    flowIndex = null, servletFilterExecution = null) {
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
    const unique = (values) => Array.from(new Set(values));
    const typeTitle = {
      APPLICATION: "애플리케이션", SERVLET: "서블릿", FILTER: "필터", SECURITY_CHAIN: "보안 필터 체인",
      ENDPOINT: "API 매핑", HANDLER: "컨트롤러 · 핸들러", AUTHENTICATION: "인증 처리",
      AUTHORIZATION: "인가 정책", SECURITY_DATA: "보안 정보", BUSINESS_SECURITY_STATE: "업무 보안 상태"
    };
    const areaForNode = (node) => {
      if (node.type === "APPLICATION") return "host";
      if (node.type === "SERVLET" || node.type === "FILTER" && attributes(node).registrationKind === "SERVLET") return "servlet";
      if (["FILTER", "SECURITY_CHAIN", "AUTHENTICATION", "AUTHORIZATION", "SECURITY_DATA",
        "BUSINESS_SECURITY_STATE"].includes(node.type)) return "security";
      return "mvc";
    };
    const runtimeByGraphNode = new Map();
    const runtimeById = new Map((blueprint && blueprint.runtimeComponents || []).map((component) => [component.id, component]));
    runtimeById.forEach((component) => (component.graphNodeIds || []).forEach((nodeId) => {
      if (!nodeById.has(nodeId) || component.kind === "SERVLET_CONTEXT") return;
      const components = runtimeByGraphNode.get(nodeId) || [];
      components.push(component);
      runtimeByGraphNode.set(nodeId, components);
    }));
    const cards = [];
    const cardById = {};
    const itemById = {};
    const cardByNodeId = new Map();
    const itemByNodeId = new Map();
    const cardByRuntimeId = new Map();
    const itemByRuntimeId = new Map();
    const cardByProjectionId = new Map();
    const itemByProjectionId = new Map();
    const originalNodeToItemIds = {};
    const originalNodeToCardIds = {};
    const itemToOriginalNodeIds = {};
    const itemToOriginalEdgeIds = {};
    const originalEdgeToRelationIds = {};
    const originalEdgeToSegmentIds = {};
    const runtimeRelationshipToRelationIds = {};
    const projectionToItemIds = {};
    const projectionEdgeToRelationIds = {};
    const projectionEdgeToSegmentIds = {};
    const findings = Array.isArray(graph.findings) ? graph.findings : [];

    const estimateTextWidth = (value, size) => Array.from(text(value)).reduce((width, character) =>
      width + (character.codePointAt(0) > 255 ? size : size * 0.56), 0);
    const runtimeKindTitle = (kind) => ({
      APPLICATION_CONTEXT: "애플리케이션 컨텍스트", WEB_SERVER: "웹 서버 / WAS",
      TOMCAT_SERVER: "웹 서버 구성", TOMCAT_SERVICE: "웹 서버 서비스", TOMCAT_CONNECTOR: "웹 서버 연결기",
      TOMCAT_ENGINE: "웹 서버 엔진", TOMCAT_HOST: "웹 서버 호스트", TOMCAT_CONTEXT: "웹 애플리케이션",
      TOMCAT_WRAPPER: "서블릿 실행 구성", SERVLET_CONTEXT: "서블릿 컨테이너", SERVLET: "서블릿 요청 처리",
      SERVLET_FILTER_REGISTRATION: "서블릿 필터 매핑", DISPATCHER_SERVLET: "DispatcherServlet",
      SERVLET_REGISTRATION: "서블릿 등록", FILTER_CHAIN_PROXY: "보안 필터 위임",
      SECURITY_FILTER_CHAIN: "보안 필터 체인", SECURITY_FILTER: "보안 필터",
      HANDLER_MAPPING: "핸들러 매핑", HANDLER_ADAPTER: "핸들러 어댑터", HANDLER_METHOD: "핸들러 메서드",
      ARGUMENT_RESOLVER: "메서드 인자 처리기", MESSAGE_CONVERTER: "메시지 변환기",
      AUTHENTICATION_MANAGER: "인증 관리자", AUTHENTICATION_PROVIDER: "인증 제공자",
      AUTHORIZATION_MANAGER: "인가 관리자", JWT_DECODER: "JWT Decoder",
      SECURITY_CONTEXT_REPOSITORY: "SecurityContext 저장소"
    }[kind] || "요청 처리 구성");
    const detailCardWidthFor = (title, subtitle, items) => {
      const widths = [estimateTextWidth(title, 18) + 44, estimateTextWidth(subtitle, 14) + 44,
        ...items.map((item) => estimateTextWidth(item.label, 16) + 80),
        ...items.map((item) => estimateTextWidth(item.detail, 13) + 80)];
      return Math.max(460, Math.min(720, Math.ceil(Math.max(...widths))));
    };
    const createDetailCard = ({ id, title, subtitle = "", kind, areaId, regionId, x, y, items, originKind }) => {
      const width = detailCardWidthFor(title, subtitle, items);
      const headerHeight = subtitle ? 72 : 58;
      const geometry = blueprintCardGeometry(items, { x, y, width, headerHeight });
      items.forEach((item) => {
        item.cardId = id;
        item.areaId = areaId;
        item.inputPortIds = [];
        item.outputPortIds = [];
      });
      const originalNodeIds = unique(items.flatMap((item) => item.originalNodeIds || []));
      const originalEdgeIds = unique(items.flatMap((item) => item.originalEdgeIds || []));
      const runtimeComponentIds = unique(items.flatMap((item) => item.runtimeComponentIds || []));
      const evidenceRefs = unique(items.flatMap((item) => item.evidenceRefs || []));
      const findingIds = unique(items.flatMap((item) => item.findingIds || []));
      return {
        id, title, subtitle, kind, areaId, regionId: regionId || (areaId === "entry" ? null : `runtime-region:${areaId}`),
        rowId: null, ...geometry, originalNodeIds, originalEdgeIds, runtimeComponentIds, evidenceRefs, findingIds,
        items, inputPortIds: [], outputPortIds: [], originKind,
        position: { x, y, width: geometry.bounds.width, height: geometry.bounds.height },
        displayKind: "composite-card", isCompositeCard: true
      };
    };
    const chainSummary = (chain) => {
      const data = attributes(chain);
      const order = text(data.chainOrder || data.order);
      const matcher = text(data.matcherCondition);
      const negated = /^NOT\((.*)\)$/i.exec(matcher);
      const condition = negated ? `제외 조건 ${negated[1]}`
        : matcher ? `조건 ${matcher}`
          : text(data.matcherType).toUpperCase() === "NEGATED" ? "제외 조건 · 조건 확인 불가" : "조건 확인 불가";
      return `${order ? `순서 ${order}` : "순서 확인 불가"} · ${condition}`;
    };
    const graphNodeGroups = [];
    const assignedNodeIds = new Set();
    const executionModel = servletFilterExecution || blueprint && blueprint.servletFilterExecution
      || { status: "UNKNOWN", entries: [] };
    const executionByComponentId = new Map((executionModel.entries || [])
      .map((entry) => [entry.componentId, entry]));
    const runtimeServletRegistrations = Array.from(runtimeById.values())
      .filter((component) => component.kind === "SERVLET_FILTER_REGISTRATION");
    const executionByGraphNodeId = new Map();
    runtimeServletRegistrations.forEach((component) => (component.graphNodeIds || []).forEach((id) => {
      const matches = executionByGraphNodeId.get(id) || [];
      matches.push({ component, entry: executionByComponentId.get(component.id) });
      executionByGraphNodeId.set(id, matches);
    }));
    const addGraphGroup = (id, title, kind, areaId, nodes, filterOrder = null, allowSingle = false) => {
      const members = unique(nodes.map((node) => node.id)).map((nodeId) => nodeById.get(nodeId)).filter(Boolean);
      if ((!allowSingle && members.length < 2) || members.length === 0
        || members.some((node) => assignedNodeIds.has(node.id))) return;
      members.forEach((node) => assignedNodeIds.add(node.id));
      graphNodeGroups.push({ id, title, kind, areaId, nodes: members, ...filterOrder });
    };
    graph.nodes.filter((node) => node.type === "SECURITY_CHAIN").forEach((chain) => {
      const order = flowIndex && typeof flowIndex.securityFiltersForChain === "function"
        ? flowIndex.securityFiltersForChain(chain.id) : { filters: [], orderStatus: "UNKNOWN", orderInfo: {} };
      addGraphGroup(`detail-card:security-chain:${chain.id}`, "보안 필터 체인",
        "SECURITY_CHAIN", "security", [chain, ...(order.filters || [])], {
          filterOrderStatus: order.orderStatus || "UNKNOWN", filterOrderInfo: order.orderInfo || {}
        });
    });
    graph.nodes.filter((node) => node.type === "SERVLET").forEach((servlet) => {
      const order = flowIndex && typeof flowIndex.servletFiltersForServlet === "function"
        ? flowIndex.servletFiltersForServlet(servlet.id) : { filters: [], orderStatus: "UNKNOWN", orderInfo: {} };
      if (!order.filters || !order.filters.length) return;
      const delegation = order.orderStatus === "CONFIRMED" ? order.filters.findIndex((filter) => {
        const entry = (executionByGraphNodeId.get(filter.id) || []).find((item) => item.entry?.delegating);
        return Boolean(entry) || /DelegatingFilterProxy|springSecurityFilterChain/i.test(
          `${attributes(filter).filterClass || ""} ${attributes(filter).registrationName || ""} ${filter.label || ""}`);
      }) : -1;
      const groups = delegation >= 0 ? [order.filters.slice(0, delegation + 1), order.filters.slice(delegation + 1)] : [order.filters];
      groups.forEach((filters, index) => addGraphGroup(`detail-card:servlet-filters:${servlet.id}:${index}`,
        index ? "후속 서블릿 필터" : "서블릿 필터", index ? "SERVLET_FILTERS_AFTER" : "SERVLET_FILTERS",
        index ? "mvc" : "servlet", filters, {
          filterOrderStatus: order.orderStatus || "UNKNOWN", filterOrderInfo: order.orderInfo || {}
        }, true));
    });
    graph.nodes.forEach((node) => {
      if (assignedNodeIds.has(node.id) || !positions[node.id]) return;
      const relatedEdges = graph.edges.filter((edge) => edge.sourceId === node.id || edge.targetId === node.id);
      const linkedRuntime = runtimeByGraphNode.get(node.id) || [];
      const presentation = blueprintNodePresentation(node);
      const label = presentation.label;
      const detail = node.type === "SECURITY_CHAIN" ? chainSummary(node)
        : node.type === "ENDPOINT" ? handlerDisplayName(attributes(node).handler)
          : ["AUTHORIZATION", "SECURITY_DATA", "BUSINESS_SECURITY_STATE"].includes(node.type) ? presentation.detail
            : node.type === "HANDLER" ? presentation.detail
        : linkedRuntime.map((component) => component.beanName || handlerDisplayName(component.className)
          || runtimeKindTitle(component.kind)).filter(Boolean).join(" · ")
          || presentation.detail
          || text(attributes(node).requiredAuthority || attributes(node).stateName || attributes(node).policyKind);
      const itemId = `detail-item:graph:${node.id}`;
      const item = {
        id: itemId, label, detail, kind: node.type, originalNodeIds: [node.id],
        originalEdgeIds: relatedEdges.map((edge) => edge.id), runtimeComponentIds: linkedRuntime.map((component) => component.id),
        evidenceRefs: unique([...(node.evidenceIds || []), ...linkedRuntime.flatMap((component) => component.evidenceIds || [])]),
        findingIds: findings.filter((finding) => (finding.nodeIds || []).includes(node.id)
          || (finding.edgeIds || []).some((id) => relatedEdges.some((edge) => edge.id === id))).map((finding) => finding.id),
        projectionNodeIds: []
      };
      graphNodeGroups.push({ id: `detail-card:graph:${node.id}`, title: typeTitle[node.type] || node.type,
        kind: node.type === "ENDPOINT" ? "API_MAPPING" : node.type === "HANDLER" ? "CONTROLLER_HANDLER" : node.type,
        areaId: node.type === "SERVLET" && (text(attributes(node).servletClass).endsWith("DispatcherServlet")
          || linkedRuntime.some((component) => text(component.className).endsWith("DispatcherServlet")))
          ? "mvc" : areaForNode(node),
        nodes: [node], items: [item] });
    });
    graphNodeGroups.forEach((group) => {
      const members = group.nodes;
      const anchor = members[0];
      const position = positions[anchor.id] || { x: 24, y: 76 };
      const items = group.items || members.map((node) => {
        const relatedEdges = graph.edges.filter((edge) => edge.sourceId === node.id || edge.targetId === node.id);
        const linkedRuntime = runtimeByGraphNode.get(node.id) || [];
        const presentation = blueprintNodePresentation(node);
        const label = presentation.label;
        const detail = node.type === "SECURITY_CHAIN" ? chainSummary(node)
          : node.type === "ENDPOINT" ? handlerDisplayName(attributes(node).handler)
            : ["AUTHORIZATION", "SECURITY_DATA", "BUSINESS_SECURITY_STATE"].includes(node.type) ? presentation.detail
              : node.type === "HANDLER" ? presentation.detail
                : linkedRuntime.map((component) => component.beanName || runtimeKindTitle(component.kind)).filter(Boolean).join(" · ")
                || presentation.detail
                || text(attributes(node).requiredAuthority || attributes(node).stateName || attributes(node).policyKind);
        return {
          id: `detail-item:graph:${node.id}`, label, detail, kind: node.type, originalNodeIds: [node.id],
          originalEdgeIds: relatedEdges.map((edge) => edge.id), runtimeComponentIds: linkedRuntime.map((component) => component.id),
          evidenceRefs: unique([...(node.evidenceIds || []), ...linkedRuntime.flatMap((component) => component.evidenceIds || [])]),
          findingIds: findings.filter((finding) => (finding.nodeIds || []).includes(node.id)
            || (finding.edgeIds || []).some((id) => relatedEdges.some((edge) => edge.id === id))).map((finding) => finding.id),
          projectionNodeIds: []
        };
      });
      items.forEach((item) => {
        if (item.kind !== "FILTER") return;
        const nodeId = (item.originalNodeIds || [])[0];
        const orderInfo = group.filterOrderInfo && group.filterOrderInfo[nodeId];
        const runtimeMatches = executionByGraphNodeId.get(nodeId) || [];
        if (attributes(nodeById.get(nodeId)).registrationKind === "SERVLET"
          && executionModel.source === "TOMCAT_FILTER_MAP") {
          const runtimeMatch = runtimeMatches.length === 1 ? runtimeMatches[0] : null;
          const execution = runtimeMatch && runtimeMatch.entry;
          const registrationName = runtimeMatch
            ? text(attributes(runtimeMatch.component).registrationName || runtimeMatch.component.beanName) : "";
          const registrationOrder = runtimeMatch ? positiveInteger(attributes(runtimeMatch.component).registrationOrder) : null;
          item.orderStatus = execution && execution.status === "CONFIRMED" ? "CONFIRMED" : "UNKNOWN";
          item.executionOrderStatus = execution ? execution.status : "UNKNOWN";
          item.order = execution && execution.status === "CONFIRMED" ? execution.order : null;
          item.detail = execution && execution.status === "CONFIRMED"
            ? `등록 이름 · ${registrationName} · 적용 순서 ${String(execution.order).padStart(2, "0")}`
              + (registrationOrder ? ` · 등록 ${registrationOrder}` : "")
            : execution && execution.status === "NOT_APPLIED"
              ? `등록 확인 · 선택 API 미적용${registrationName ? ` · 이름 ${registrationName}` : ""}`
                + (registrationOrder ? ` · 등록 ${registrationOrder}` : "")
              : `등록 확인 · 적용 순서 확인 불가${registrationName ? ` · 이름 ${registrationName}` : ""}`
                + (registrationOrder ? ` · 등록 ${registrationOrder}` : "");
          return;
        }
        if (attributes(nodeById.get(nodeId)).registrationKind === "SERVLET"
          && runtimeServletRegistrations.length > 0) {
          item.orderStatus = "UNKNOWN";
          item.executionOrderStatus = "UNKNOWN";
          item.order = null;
          item.detail = "등록 확인 · 적용 순서 확인 불가";
          return;
        }
        const confirmed = group.filterOrderStatus === "CONFIRMED" && orderInfo
          && orderInfo.status === "CONFIRMED" && positiveInteger(orderInfo.order) !== null;
        item.orderStatus = confirmed ? "CONFIRMED" : "UNKNOWN";
        item.executionOrderStatus = confirmed ? "CONFIRMED" : "UNKNOWN";
        item.order = confirmed ? orderInfo.order : null;
        item.detail = confirmed ? `순서 ${String(orderInfo.order).padStart(2, "0")}`
          : "등록 확인 · 적용 순서 확인 불가";
      });
      const card = createDetailCard({ id: group.id, title: group.title, kind: group.kind,
        subtitle: group.subtitle || "", areaId: group.areaId, x: position.x, y: position.y, items,
        originKind: group.nodes.length > 1 ? "GRAPH_COMPOSITE" : items[0].runtimeComponentIds.length
          ? "GRAPH_RUNTIME_COMPONENT" : "GRAPH_NODE" });
      cards.push(card);
      cardById[card.id] = card;
      card.originalNodeIds.forEach((nodeId) => {
        const item = items.find((entry) => entry.originalNodeIds.includes(nodeId));
        if (!item) return;
        itemById[item.id] = item;
        itemToOriginalNodeIds[item.id] = item.originalNodeIds.slice();
        itemToOriginalEdgeIds[item.id] = item.originalEdgeIds.slice();
        cardByNodeId.set(nodeId, card);
        itemByNodeId.set(nodeId, item);
        originalNodeToItemIds[nodeId] = [item.id];
        originalNodeToCardIds[nodeId] = [card.id];
        item.runtimeComponentIds.forEach((runtimeId) => {
          cardByRuntimeId.set(runtimeId, card);
          itemByRuntimeId.set(runtimeId, item);
        });
      });
    });

    const runtimeGroupFor = (component) => {
      const parent = runtimeById.get(component.parentId);
      if (component.kind === "SERVLET_FILTER_REGISTRATION") {
        const delegation = (executionModel.entries || []).find((entry) => entry.status === "CONFIRMED" && entry.delegating);
        const current = executionByComponentId.get(component.id);
        const after = executionModel.status === "CONFIRMED" && delegation && current?.status === "CONFIRMED"
          && current.order > delegation.order;
        const inactive = executionModel.status === "CONFIRMED" && current?.status !== "CONFIRMED";
        return { key: `servlet:filters:${component.contextId}:${inactive ? "other" : after ? "after" : "before"}`,
          title: inactive ? "그 외 서블릿 필터" : after ? "후속 서블릿 필터" : "서블릿 필터",
          kind: inactive ? "SERVLET_FILTERS_OTHER" : after ? "SERVLET_FILTERS_AFTER" : "SERVLET_FILTERS",
          areaId: after && !inactive ? "mvc" : "servlet" };
      }
      if (["SERVLET", "DISPATCHER_SERVLET", "SERVLET_REGISTRATION"].includes(component.kind)) return {
        key: `servlet:request:${component.id}`, title: component.kind === "DISPATCHER_SERVLET"
          ? "DispatcherServlet" : "서블릿 요청 처리", kind: "RUNTIME_SERVLET_ENTRY",
        areaId: component.kind === "DISPATCHER_SERVLET" ? "mvc" : "servlet"
      };
      if (["APPLICATION_CONTEXT", "TOMCAT_FILTER_MAPPING", "ARGUMENT_RESOLVER", "MESSAGE_CONVERTER"]
        .includes(component.kind)) return null;
      if (component.kind === "SECURITY_FILTER" && parent?.kind === "SECURITY_FILTER_CHAIN") return {
        key: `security:filters:${parent.id}`, title: "보안 필터", kind: "SECURITY_FILTERS", areaId: "security"
      };
      if (component.kind === "HANDLER_METHOD" && parent?.kind === "HANDLER_MAPPING") return {
        key: `mvc:mapping:${parent.id}`, title: "핸들러 매핑", kind: "HANDLER_MAPPING", areaId: "mvc"
      };
      if (["TOMCAT_SERVER", "TOMCAT_SERVICE", "TOMCAT_ENGINE", "TOMCAT_HOST", "TOMCAT_CONTEXT", "TOMCAT_WRAPPER"]
        .includes(component.kind) && Array.from(runtimeById.values()).some((item) => item.kind === "WEB_SERVER"
          && item.contextId === component.contextId)) return null;
      if (["WEB_SERVER", "TOMCAT_SERVER", "TOMCAT_SERVICE", "TOMCAT_CONNECTOR", "TOMCAT_ENGINE", "TOMCAT_HOST",
        "TOMCAT_CONTEXT", "TOMCAT_WRAPPER"].includes(component.kind)) return {
        key: `host:${component.contextId}`, title: "웹 서버 / WAS",
        subtitle: text(graph.runtimeArchitecture?.environment?.serverKind) === "TOMCAT" ? "Tomcat"
          : text(graph.runtimeArchitecture?.environment?.serverKind) === "UNKNOWN" ? ""
            : text(graph.runtimeArchitecture?.environment?.serverKind),
        kind: "RUNTIME_HOST", areaId: "host"
      };
      if (component.kind === "SERVLET_CONTEXT") return {
        key: `servlet:container:${component.contextId}`, title: "서블릿 컨테이너", kind: "RUNTIME_SERVLET", areaId: "servlet"
      };
      if (component.kind === "HANDLER_MAPPING") return {
        key: `mvc:mapping:${component.id}`, title: "핸들러 매핑", kind: "HANDLER_MAPPING", areaId: "mvc"
      };
      if (component.kind === "HANDLER_ADAPTER") return {
        key: `mvc:adapter:${component.id}`, title: "핸들러 어댑터", kind: "HANDLER_ADAPTER", areaId: "mvc"
      };
      if (["AUTHENTICATION_MANAGER", "AUTHENTICATION_PROVIDER"].includes(component.kind)) return {
        key: `security:authentication:${component.contextId}`, title: "인증 처리", kind: "AUTHENTICATION", areaId: "security"
      };
      const areaId = runtimeArea(component.kind) || "mvc";
      const title = runtimeKindTitle(component.kind);
      return { key: `${areaId}:${component.kind}:${component.parentId || component.contextId}`,
        title, kind: `RUNTIME_${component.kind}`, areaId };
    };
    const runtimeGroups = new Map();
    Array.from(runtimeById.values()).filter((component) => !cardByRuntimeId.has(component.id))
      .forEach((component) => {
        const definition = runtimeGroupFor(component);
        if (!definition) return;
        const group = runtimeGroups.get(definition.key) || { ...definition, components: [] };
        group.components.push(component);
        runtimeGroups.set(definition.key, group);
      });
    const areaIndex = new Map(["host", "servlet", "security", "mvc"].map((area, index) => [area, index]));
    const nextRuntimeY = new Map(["host", "servlet", "security", "mvc"].map((area) => [area, 76]));
    Array.from(runtimeGroups.values()).forEach((group) => {
      group.components.sort((left, right) => {
        if (["SERVLET_FILTERS", "SERVLET_FILTERS_AFTER"].includes(group.kind) && executionModel.status === "CONFIRMED") {
          const leftEntry = executionByComponentId.get(left.id);
          const rightEntry = executionByComponentId.get(right.id);
          const leftOrder = leftEntry && leftEntry.status === "CONFIRMED" ? leftEntry.order : Number.MAX_SAFE_INTEGER;
          const rightOrder = rightEntry && rightEntry.status === "CONFIRMED" ? rightEntry.order : Number.MAX_SAFE_INTEGER;
          if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        }
        return text(attributes(left).registrationName || left.className).localeCompare(
          text(attributes(right).registrationName || right.className)) || text(left.id).localeCompare(text(right.id));
      });
      const items = group.components.map((component) => {
        const componentAttributes = component.attributes || {};
        const className = component.kind === "SERVLET_FILTER_REGISTRATION"
          ? text(componentAttributes.filterClass || component.className) || text(component.kind)
          : text(component.className) || text(component.kind);
        const hash = className.lastIndexOf("#");
        const owner = hash >= 0 ? className.slice(0, hash) : className;
        const method = hash >= 0 ? className.slice(hash + 1).replace(/\(.*$/, "") : "";
        const label = component.kind === "SERVLET_CONTEXT" && !text(component.className).trim()
          ? "서블릿 컨테이너" : owner.slice(owner.lastIndexOf(".") + 1) || component.kind;
        const registrationOrder = component.kind === "SERVLET_FILTER_REGISTRATION"
          ? positiveInteger(componentAttributes.registrationOrder) : null;
        const filterExecution = component.kind === "SERVLET_FILTER_REGISTRATION"
          ? executionByComponentId.get(component.id) : null;
        const order = component.kind === "SECURITY_FILTER" ? null
          : positiveInteger(componentAttributes.filterOrder) || positiveInteger(componentAttributes.order);
        const detail = component.kind === "SERVLET_FILTER_REGISTRATION"
          ? filterExecution && filterExecution.status === "CONFIRMED"
            ? `등록 이름 · ${text(componentAttributes.registrationName || component.beanName)} · 적용 순서 ${String(filterExecution.order).padStart(2, "0")}`
              + (registrationOrder ? ` · 등록 ${registrationOrder}` : "")
            : filterExecution && filterExecution.status === "NOT_APPLIED"
              ? `등록 확인 · 선택 API 미적용 · 이름 ${text(componentAttributes.registrationName || component.beanName)}`
                + (registrationOrder ? ` · 등록 ${registrationOrder}` : "")
              : `등록 확인 · 적용 순서 확인 불가${text(componentAttributes.registrationName || component.beanName)
                ? ` · 이름 ${text(componentAttributes.registrationName || component.beanName)}` : ""}`
                + (registrationOrder ? ` · 등록 ${registrationOrder}` : "")
          : component.kind === "SERVLET_CONTEXT" ? "서블릿 컨텍스트 접근 객체"
          : method ? `${method}()` : component.beanName ? `Bean 이름 · ${component.beanName}`
            : order !== null ? `등록 순서 ${order}`
              : runtimeKindTitle(component.kind);
        const item = { id: `runtime-blueprint:item:${component.id}`, label, detail, kind: component.kind,
          originalNodeIds: [], originalEdgeIds: [], runtimeComponentIds: [component.id],
          evidenceRefs: (component.evidenceIds || []).slice(), findingIds: [], projectionNodeIds: [], originKind: "RUNTIME_COMPONENT",
          orderStatus: filterExecution && filterExecution.status === "CONFIRMED" ? "CONFIRMED" : "UNKNOWN",
          order: filterExecution && filterExecution.status === "CONFIRMED" ? filterExecution.order : null,
          registrationOrderStatus: registrationOrder === null ? "UNKNOWN" : "CONFIRMED", registrationOrder,
          executionOrderStatus: filterExecution ? filterExecution.status : "UNKNOWN" };
        itemById[item.id] = item;
        itemToOriginalNodeIds[item.id] = [];
        itemToOriginalEdgeIds[item.id] = [];
        cardByRuntimeId.set(component.id, null);
        itemByRuntimeId.set(component.id, item);
        return item;
      });
      const x = 24 + (areaIndex.get(group.areaId) || 0) * 420;
      const y = nextRuntimeY.get(group.areaId) || 76;
      const card = createDetailCard({ id: `detail-card:runtime:${group.key}`, title: group.title,
        subtitle: group.subtitle || "", kind: group.kind, areaId: group.areaId, x, y, items, originKind: "RUNTIME_COMPONENT" });
      cards.push(card);
      cardById[card.id] = card;
      group.components.forEach((component) => {
        cardByRuntimeId.set(component.id, card);
        if (component.kind !== "SERVLET_CONTEXT") return;
        const item = itemByRuntimeId.get(component.id);
        (component.graphNodeIds || []).filter((id) => nodeById.has(id)).forEach((id) => {
          item.originalNodeIds.push(id);
          itemToOriginalNodeIds[item.id].push(id);
          (originalNodeToItemIds[id] || (originalNodeToItemIds[id] = [])).push(item.id);
          (originalNodeToCardIds[id] || (originalNodeToCardIds[id] = [])).push(card.id);
          if (!card.originalNodeIds.includes(id)) card.originalNodeIds.push(id);
        });
      });
      nextRuntimeY.set(group.areaId, y + card.bounds.height + 24);
    });

    Object.entries(projectionAliases || {}).forEach(([projectionId, target]) => {
      const item = target.runtimeComponentId ? itemByRuntimeId.get(target.runtimeComponentId)
        : itemByNodeId.get(target.graphNodeId);
      const card = item && cardById[item.cardId];
      if (!item || !card) return;
      item.projectionNodeIds = unique([...(item.projectionNodeIds || []), projectionId]);
      cardByProjectionId.set(projectionId, card);
      itemByProjectionId.set(projectionId, item);
      projectionToItemIds[projectionId] = [item.id];
    });

    const learningGroupFor = (projection) => {
      if (["education-http-request", "education-request-prepare"].includes(projection.id)) {
        return { key: "request-context", title: "요청 진입", areaId: "entry" };
      }
      if (projection.id === "education-servlet-container") return { key: "servlet-container", title: "서블릿 컨테이너", areaId: "servlet" };
      if (["education-http-servlet-request", "education-http-servlet-response", "education-thread-context"].includes(projection.id)) {
        return { key: "request-response", title: "요청·응답 객체", areaId: "servlet" };
      }
      if (projection.id === "education-http-response") {
        return { key: "http-response", title: "HTTP 응답 반환", areaId: "mvc" };
      }
      if (projection.id === "education-servlet-filter-chain") {
        return { key: "servlet-filter-chain", title: "서블릿 필터 진입", areaId: "servlet" };
      }
      if (["education-delegating-filter-proxy", "education-filter-chain-proxy"]
        .includes(projection.id)) return { key: "security-delegation", title: "스프링 시큐리티 위임", areaId: "security" };
      if (projection.id === "education-servlet-chain-continue") {
        return { key: "servlet-continue", title: "서블릿 필터 이후 처리", areaId: "mvc" };
      }
      if (projection.id === "education-handler-mapping") return { key: "mvc-mapping", title: "핸들러 매핑", areaId: "mvc" };
      if (projection.id === "education-handler-adapter") return { key: "mvc-adapter", title: "핸들러 어댑터", areaId: "mvc" };
      const areaId = projection.lane === "security-delegation" ? "security"
        : projection.lane === "mvc" || projection.lane === "mvc-mapping" ? "mvc" : "servlet";
      return { key: `learning:${projection.lane || areaId}`, title: "요청 처리 단계", areaId };
    };
    const learningGroups = new Map();
    projectionNodes.forEach((projection) => {
      const definition = learningGroupFor(projection);
      const group = learningGroups.get(definition.key) || { ...definition, projections: [] };
      group.projections.push(projection);
      learningGroups.set(definition.key, group);
    });
    Array.from(learningGroups.values()).forEach((group) => {
      const projectionOrder = new Map(projectionNodes.map((node, index) => [node.id, index]));
      group.projections.sort((left, right) => projectionOrder.get(left.id) - projectionOrder.get(right.id));
      const items = group.projections.map((projection) => {
        const item = { id: `detail-item:learning:${projection.id}`, label: projection.primary, detail: projection.detail,
          kind: "LEARNING_STEP", originalNodeIds: [], originalEdgeIds: [], runtimeComponentIds: [],
          evidenceRefs: [], findingIds: [], projectionNodeIds: [projection.id], originKind: "LEARNING_PROJECTION" };
        itemById[item.id] = item;
        itemToOriginalNodeIds[item.id] = [];
        itemToOriginalEdgeIds[item.id] = [];
        return item;
      });
      const x = Math.min(...group.projections.map((projection) => projection.position.x));
      const y = Math.min(...group.projections.map((projection) => projection.position.y));
      const card = createDetailCard({ id: `detail-card:learning:${group.key}`, title: group.title,
        kind: "DETAIL_LEARNING", areaId: group.areaId, x, y, items, originKind: "LEARNING_PROJECTION" });
      cards.push(card);
      cardById[card.id] = card;
      group.projections.forEach((projection, index) => {
        const item = items[index];
        cardByProjectionId.set(projection.id, card);
        itemByProjectionId.set(projection.id, item);
        projectionToItemIds[projection.id] = [item.id];
        projection.position = { x: item.bounds.x, y: item.bounds.y, width: item.bounds.width, height: item.bounds.height };
        projection.bounds = itemBounds(item.bounds.x, item.bounds.y, item.bounds.width, item.bounds.height);
        projection.width = item.bounds.width;
        projection.height = item.bounds.height;
      });
    });

    const moveCard = (card, x, y) => {
      const dx = x - card.bounds.x;
      const dy = y - card.bounds.y;
      [card.bounds, card.headerBounds, card.contentBounds, ...card.items.map((item) => item.bounds)]
        .forEach((bounds) => {
          bounds.x += dx;
          bounds.y += dy;
          if (Number.isFinite(bounds.left)) bounds.left = bounds.x;
          if (Number.isFinite(bounds.right)) bounds.right = bounds.x + bounds.width;
          if (Number.isFinite(bounds.top)) bounds.top = bounds.y;
          if (Number.isFinite(bounds.bottom)) bounds.bottom = bounds.y + bounds.height;
        });
      if (card.position) {
        card.position.x = x;
        card.position.y = y;
      }
    };
    const selectedChain = graph.detailEndpointId && flowIndex?.firstMatchedChain?.(graph.detailEndpointId);
    const selectedPolicy = selectedChain?.status === "CONFIRMED" && selectedChain.chain
      ? selectedUrlPolicy(graph, selectedChain.chain.id) : null;
    const stageForCard = (card) => {
      const confirmedFilterFlow = card.items.length > 0
        && card.items.filter((item) => ["FILTER", "SERVLET_FILTER_REGISTRATION"].includes(item.kind)).length > 0
        && card.items.filter((item) => ["FILTER", "SERVLET_FILTER_REGISTRATION"].includes(item.kind))
          .every((item) => item.executionOrderStatus === "CONFIRMED");
      if (card.id === "detail-card:learning:request-context") return { area: "entry", rank: 0 };
      if (card.id === "detail-card:learning:servlet-container") return { area: "servlet", rank: 0 };
      if (card.id === "detail-card:learning:request-response") return { area: "servlet", rank: 1 };
      if (card.areaId === "host") return card.kind === "RUNTIME_HOST" || card.kind === "APPLICATION_CONTEXT"
        ? { area: "host", rank: 0 } : null;
      if (card.areaId === "servlet") {
        if (card.kind === "RUNTIME_SERVLET" && card.items.some((item) =>
          (item.projectionNodeIds || []).includes("education-servlet-container"))) return { area: "servlet", rank: 0 };
        if (card.kind === "SERVLET_FILTERS" && confirmedFilterFlow
          || card.kind === "FILTER" && confirmedFilterFlow || card.kind === "SERVLET") {
          return { area: "servlet", rank: 2 };
        }
        return null;
      }
      if (card.areaId === "security") {
        if (card.id === "detail-card:learning:security-delegation") return { area: "security", rank: 0 };
        if (card.kind === "RUNTIME_FILTER_CHAIN_PROXY") return { area: "security", rank: 1 };
        if (card.kind === "SECURITY_CHAIN" || card.kind === "RUNTIME_SECURITY_FILTER_CHAIN") {
          return { area: "security", rank: 2 };
        }
        if (card.kind === "SECURITY_FILTERS" && confirmedFilterFlow) return { area: "security", rank: 3 };
        if (selectedPolicy && card.originalNodeIds.includes(selectedPolicy.id)) return { area: "security", rank: 4 };
        return null;
      }
      if (card.areaId === "mvc") {
        if (card.id === "detail-card:learning:http-response") return { area: "mvc", rank: 7 };
        if (card.kind === "SERVLET_FILTERS_AFTER" || card.id === "detail-card:learning:servlet-continue") return { area: "mvc", rank: 0 };
        if (card.kind === "RUNTIME_SERVLET_ENTRY" || card.kind === "SERVLET") return { area: "mvc", rank: 1 };
        if (card.id === "detail-card:learning:mvc-mapping" || card.kind === "HANDLER_MAPPING") {
          return { area: "mvc", rank: 2 };
        }
        if (card.kind === "API_MAPPING") return { area: "mvc", rank: 4 };
        if (card.kind === "HANDLER_ADAPTER" || card.id === "detail-card:learning:mvc-adapter") return { area: "mvc", rank: 5 };
        if (card.kind === "CONTROLLER_HANDLER") return { area: "mvc", rank: 6 };
        return null;
      }
      return null;
    };
    const maxMainWidth = Math.max(380, ...cards.filter((card) => stageForCard(card)).map((card) => card.bounds.width));
    const maxMainHeight = Math.max(120, ...cards.filter((card) => stageForCard(card)).map((card) => card.bounds.height));
    const mainCenterX = 180 + maxMainWidth / 2;
    const findingSections = graph.findingSections || [];
    const longestFindingTitle = Math.max(0, ...findingSections.map((section) =>
      Array.from(text(section.finding?.title)).reduce((width, character) =>
        width + (character.codePointAt(0) > 255 ? 12 : 7), 64)));
    const findingGap = Math.max(0, longestFindingTitle - 380);
    const mainCenterY = Math.max(260, findingSections.length * 24 + 90) + maxMainHeight / 2;
    const sideY = mainCenterY + maxMainHeight / 2 + 120;
    const mainByArea = new Map(["entry", "host", "servlet", "security", "mvc"].map((area) => [area, []]));
    const sideByArea = new Map(["host", "servlet", "security", "mvc"].map((area) => [area, []]));
    cards.forEach((card) => {
      const stage = stageForCard(card);
      if (stage) mainByArea.get(stage.area).push({ card, rank: stage.rank });
      else sideByArea.get(card.areaId)?.push(card);
    });
    const mappedNodeOrder = new Map();
    const mappedEndpoints = graph.edges.filter((edge) => edge.type === "FLOWS_TO" && edge.confidence === "CONFIRMED"
      && nodeById.get(edge.sourceId)?.type === "ENDPOINT" && nodeById.get(edge.targetId)?.type === "HANDLER")
      .sort((left, right) => text(left.sourceId).localeCompare(text(right.sourceId)));
    mappedEndpoints.forEach((edge, index) => {
      mappedNodeOrder.set(edge.sourceId, index);
      mappedNodeOrder.set(edge.targetId, index);
    });
    const cardPairOrder = (entry) => mappedNodeOrder.get(entry.card.originalNodeIds[0]);
    const cardOrder = (left, right) => {
      if (left.rank === right.rank && left.rank >= 4) {
        const leftPair = cardPairOrder(left);
        const rightPair = cardPairOrder(right);
        if (Number.isFinite(leftPair) && Number.isFinite(rightPair) && leftPair !== rightPair) {
          return leftPair - rightPair;
        }
      }
      return left.rank - right.rank || left.card.id.localeCompare(right.card.id);
    };
    let cursorX = 180;
    ["entry", "host", "servlet", "security", "mvc"].forEach((area) => {
      const main = mainByArea.get(area).sort(cardOrder);
      const side = sideByArea.get(area) || [];
      const areaStart = cursorX;
      main.forEach(({ card }) => {
        moveCard(card, cursorX, mainCenterY - card.bounds.height / 2);
        cursorX += card.bounds.width + 160 + findingGap;
      });
      let sideX = areaStart;
      side.forEach((card) => {
        moveCard(card, sideX, sideY);
        sideX += card.bounds.width + 120 + findingGap;
      });
      cursorX = Math.max(cursorX, sideX) + 80;
    });
    cards.filter((card) => !["entry", "host", "servlet", "security", "mvc"].includes(card.areaId))
      .forEach((card) => {
        moveCard(card, cursorX, sideY);
        cursorX += card.bounds.width + 120;
      });
    const projectionById = new Map(projectionNodes.map((projection) => [projection.id, projection]));
    cards.forEach((card) => card.items.forEach((item) => (item.projectionNodeIds || []).forEach((id) => {
      const projection = projectionById.get(id);
      if (!projection) return;
      projection.position = { x: item.bounds.x, y: item.bounds.y, width: item.bounds.width, height: item.bounds.height };
      projection.bounds = itemBounds(item.bounds.x, item.bounds.y, item.bounds.width, item.bounds.height);
      projection.width = item.bounds.width;
      projection.height = item.bounds.height;
    })));

    cards.forEach((card) => {
      card.layout = { cardId: card.id, bounds: card.bounds, headerBounds: card.headerBounds,
        contentBounds: card.contentBounds, itemBoundsById: card.itemBoundsById, portIds: [] };
    });
    const instances = cards.map((card) => ({ id: card.id, rowId: null,
      originalNodeIds: card.originalNodeIds.slice(), displayType: card.kind, kind: "composite-card",
      position: card.position || { x: card.bounds.x, y: card.bounds.y, width: card.bounds.width, height: card.bounds.height },
      width: card.bounds.width, height: card.bounds.height, bounds: card.bounds,
      areaId: card.areaId, composite: card }));
    const instanceById = new Map(instances.map((instance) => [instance.id, instance]));
    const ports = [];
    const portByKey = new Map();
    const ensurePort = (item, card, side, channel, direction) => {
      const key = JSON.stringify([item.id, side, direction]);
      if (portByKey.has(key)) return portByKey.get(key);
      const id = `detail-port:${key}`;
      const port = { id, itemId: item.id, side, channel, direction,
        x: side === "LEFT" ? card.bounds.x : side === "RIGHT" ? card.bounds.right
          : item.bounds.x + item.bounds.width / 2,
        y: side === "TOP" ? card.bounds.y : side === "BOTTOM" ? card.bounds.bottom
          : item.bounds.y + item.bounds.height / 2 };
      ports.push(port);
      portByKey.set(key, port);
      (direction === "IN" ? item.inputPortIds : item.outputPortIds).push(id);
      (direction === "IN" ? card.inputPortIds : card.outputPortIds).push(id);
      return port;
    };
    const relations = [];
    const internalRelations = [];
    const relationRoles = {};
    const relationByKey = new Map();
    const addMappedId = (mapping, key, relationId) => {
      if (!key) return;
      const ids = mapping[key] || (mapping[key] = []);
      if (!ids.includes(relationId)) ids.push(relationId);
    };
    const addRelationReferences = (relation) => {
      relation.originalEdgeIds.forEach((edgeId) => addMappedId(originalEdgeToRelationIds, edgeId, relation.id));
      (relation.runtimeRelationshipIds || []).forEach((id) => addMappedId(runtimeRelationshipToRelationIds, id, relation.id));
      (relation.projectionEdgeIds || []).forEach((id) => addMappedId(projectionEdgeToRelationIds, id, relation.id));
    };
    const addRelation = (definition) => {
      const sourceCard = definition.sourceCard;
      const targetCard = definition.targetCard;
      if (!sourceCard || !targetCard || !definition.sourceItem || !definition.targetItem) {
        (definition.originalEdgeIds || []).forEach((id) => { relationRoles[id] = { role: "UNRESOLVED_DISPLAY_TARGET" }; });
        return;
      }
      if (definition.sourceItem.id === definition.targetItem.id) {
        (definition.originalEdgeIds || []).forEach((id) => {
          relationRoles[id] = { role: "INTERNAL_COMPOSITE_REFERENCE", originalEdgeIds: [id] };
        });
        (definition.projectionEdgeIds || (definition.projectionEdgeId ? [definition.projectionEdgeId] : []))
          .forEach((id) => { projectionEdgeToRelationIds[id] = []; });
        return;
      }
      const sourceItem = definition.sourceItem;
      const targetItem = definition.targetItem;
      const semanticKey = JSON.stringify([sourceItem.id, targetItem.id, definition.role, definition.type,
        definition.semanticFlowGroup === undefined ? definition.flowGroup || null : definition.semanticFlowGroup]);
      const referenceOnly = Boolean(definition.referenceOnly);
      const existing = relationByKey.get(semanticKey);
      const suppliedProjectionIds = definition.projectionEdgeIds
        || (definition.projectionEdgeId ? [definition.projectionEdgeId] : []);
      if (existing && existing.referenceOnly === referenceOnly) {
        ["originalEdgeIds", "runtimeRelationshipIds", "projectionEdgeIds", "evidenceIds", "relatedNodeIds",
          "runtimeComponentIds", "flowGroups"].forEach((key) => {
          const incoming = key === "projectionEdgeIds" ? suppliedProjectionIds : definition[key] || [];
          existing[key] = unique([...(existing[key] || []), ...incoming]);
        });
        existing.originalDirections = unique([...(existing.originalDirections || []), ...(definition.originalDirections || [])]);
        existing.provenance = unique([...(existing.provenance || []), ...(definition.provenance || [])]);
        if (definition.confidence && definition.confidence !== "CONFIRMED") existing.confidence = definition.confidence;
        addRelationReferences(existing);
        return existing;
      }
      const internalCard = sourceCard.id === targetCard.id;
      const channel = JSON.stringify([definition.role, definition.type]);
      const sourceCenter = { x: sourceCard.bounds.x + sourceCard.bounds.width / 2,
        y: sourceCard.bounds.y + sourceCard.bounds.height / 2 };
      const targetCenter = { x: targetCard.bounds.x + targetCard.bounds.width / 2,
        y: targetCard.bounds.y + targetCard.bounds.height / 2 };
      const dx = targetCenter.x - sourceCenter.x;
      const dy = targetCenter.y - sourceCenter.y;
      const horizontalReference = ["ANALYSIS_REFERENCE", "REGISTRATION_REFERENCE"].includes(definition.role);
      const vertical = definition.role === "LEARNING_FLOW" && dx !== 0 ? false
        : Math.abs(dx) < 40 ? Math.abs(dy) >= Math.abs(dx)
          : !horizontalReference && Math.abs(dy) >= Math.abs(dx);
      const sourceSide = vertical ? dy >= 0 ? "BOTTOM" : "TOP" : dx >= 0 ? "RIGHT" : "LEFT";
      const targetSide = vertical ? dy >= 0 ? "TOP" : "BOTTOM" : dx >= 0 ? "LEFT" : "RIGHT";
      const sourcePort = referenceOnly || internalCard ? null
        : ensurePort(sourceItem, sourceCard, sourceSide, channel, "OUT");
      const targetPort = referenceOnly || internalCard ? null
        : ensurePort(targetItem, targetCard, targetSide, channel, "IN");
      const relation = { ...definition, rowId: "detail", sourceInstanceId: sourceCard.id,
        targetInstanceId: targetCard.id, sourceItemId: sourceItem.id, targetItemId: targetItem.id,
        visualSourcePortId: sourcePort && sourcePort.id, visualTargetPortId: targetPort && targetPort.id,
        originalSourceInstanceId: sourceCard.id, originalTargetInstanceId: targetCard.id,
        originalSourceItemId: sourceItem.id, originalTargetItemId: targetItem.id,
        runtimeComponentIds: unique([...(definition.runtimeComponentIds || []),
          ...(sourceItem.runtimeComponentIds || []), ...(targetItem.runtimeComponentIds || [])]),
        semanticFlowGroup: definition.semanticFlowGroup === undefined ? definition.flowGroup || null : definition.semanticFlowGroup,
        flowGroups: unique([...(definition.flowGroups || []), ...(definition.flowGroup ? [definition.flowGroup] : [])]),
        visualDirection: "ORIGINAL", preserveDirection: true, originalEdgeIds: definition.originalEdgeIds || [],
        originalDirections: definition.originalDirections || [], evidenceIds: definition.evidenceIds || [],
        relatedNodeIds: definition.relatedNodeIds || [], presentationKind: definition.presentationKind || "DETAIL_REFERENCE",
        projectionEdgeIds: unique(suppliedProjectionIds), referenceOnly,
        internalCardId: internalCard && !referenceOnly ? sourceCard.id : null };
      relations.push(relation);
      if (internalCard && !referenceOnly) internalRelations.push(relation);
      if (!referenceOnly) relationByKey.set(semanticKey, relation);
      addRelationReferences(relation);
    };

    graph.edges.forEach((edge) => {
      const sourceCard = cardByNodeId.get(edge.sourceId);
      const targetCard = cardByNodeId.get(edge.targetId);
      if (!sourceCard || !targetCard) {
        relationRoles[edge.id] = { role: "UNRESOLVED_DISPLAY_TARGET", originalEdgeIds: [edge.id] };
        return;
      }
      const source = nodeById.get(edge.sourceId);
      const target = nodeById.get(edge.targetId);
      const mapping = edge.type === "FLOWS_TO" && source.type === "ENDPOINT" && target.type === "HANDLER";
      addRelation({ id: `detail-edge:${edge.id}`, role: mapping ? "API_MAPPING" : "ANALYSIS_REFERENCE",
        type: edge.type, sourceCard, targetCard, sourceItem: itemByNodeId.get(edge.sourceId), targetItem: itemByNodeId.get(edge.targetId),
        originalEdgeIds: [edge.id], originalDirections: [{ edgeId: edge.id, sourceId: edge.sourceId, targetId: edge.targetId }],
        evidenceIds: edge.evidenceIds || [], relatedNodeIds: [edge.sourceId, edge.targetId],
        provenance: [{ kind: "GRAPH_EDGE", id: edge.id }],
        referenceOnly: edge.type === "MATCHED_BY" && edge.confidence === "CONFIRMED"
          && source.type === "ENDPOINT" && target.type === "SECURITY_CHAIN",
        presentationKind: mapping ? "CONFIRMED_API_MAPPING" : "GRAPH_RELATION" });
    });
    projectionEdges.forEach((edge) => {
      const sourceCard = cardByNodeId.get(edge.sourceId) || cardByProjectionId.get(edge.sourceId)
        || cardByRuntimeId.get(edge.sourceId);
      const targetCard = cardByNodeId.get(edge.targetId) || cardByProjectionId.get(edge.targetId)
        || cardByRuntimeId.get(edge.targetId);
      const sourceItem = itemByNodeId.get(edge.sourceId) || itemByProjectionId.get(edge.sourceId)
        || itemByRuntimeId.get(edge.sourceId);
      const targetItem = itemByNodeId.get(edge.targetId) || itemByProjectionId.get(edge.targetId)
        || itemByRuntimeId.get(edge.targetId);
      if (!sourceCard || !targetCard) return;
      const matchedMembership = edge.projectionKind === "security-filter-order" && edge.orderIndex === 0
        ? relations.find((relation) => relation.type === "FILTERED_BY"
          && relation.originalDirections.some((direction) => direction.sourceId === edge.sourceId
            && direction.targetId === edge.targetId)) : null;
      if (matchedMembership) {
        relationByKey.delete(JSON.stringify([matchedMembership.sourceItemId, matchedMembership.targetItemId,
          matchedMembership.role, matchedMembership.type, matchedMembership.semanticFlowGroup || null]));
        matchedMembership.role = "LEARNING_FLOW";
        matchedMembership.flowGroup = edge.flowGroup || null;
        matchedMembership.semanticFlowGroup = null;
        matchedMembership.routeKind = edge.routeKind || "DIRECT";
        relationByKey.set(JSON.stringify([matchedMembership.sourceItemId, matchedMembership.targetItemId,
          matchedMembership.role, matchedMembership.type, null]), matchedMembership);
      }
      const normalizedRole = "LEARNING_FLOW";
      const normalizedType = matchedMembership ? matchedMembership.type : "LEARNING_FLOW";
      addRelation({ id: `detail-learning:${edge.id}`, role: normalizedRole, type: normalizedType,
        sourceCard, targetCard, sourceItem, targetItem, projectionEdgeId: edge.id,
        semanticFlowGroup: matchedMembership ? null : edge.flowGroup || null,
        flowGroup: matchedMembership ? matchedMembership.flowGroup || null : edge.flowGroup || null,
        flowGroups: edge.flowGroup ? [edge.flowGroup] : [],
        routeKind: edge.routeKind || "DIRECT", originalEdgeIds: [],
        relatedNodeIds: edge.relatedNodeIds || [],
        provenance: [{ kind: "PROJECTION_EDGE", id: edge.id }],
        presentationKind: "LEARNING_PROJECTION" });
    });
    (blueprint && blueprint.runtimeRelationships || []).forEach((runtimeRelation) => {
      const sourceCard = cardByRuntimeId.get(runtimeRelation.sourceId);
      const targetCard = cardByRuntimeId.get(runtimeRelation.targetId);
      const sourceItem = itemByRuntimeId.get(runtimeRelation.sourceId);
      const targetItem = itemByRuntimeId.get(runtimeRelation.targetId);
      if (!sourceCard || !targetCard) return;
      const sourceComponent = runtimeById.get(runtimeRelation.sourceId);
      const targetComponent = runtimeById.get(runtimeRelation.targetId);
      const mapping = runtimeRelation.kind === "MAPS_TO" && sourceComponent?.kind === "HANDLER_MAPPING"
        && targetComponent?.kind === "HANDLER_METHOD";
      const configurationReference = ["CONTAINS", "CONFIGURES", "REGISTERS", "REGISTERED_IN"].includes(runtimeRelation.kind);
      addRelation({ id: `detail-runtime:${runtimeRelation.id}`, role: mapping ? "API_MAPPING" : "RUNTIME_REFERENCE",
        type: mapping ? "FLOWS_TO" : runtimeRelation.kind,
        sourceCard, targetCard, sourceItem, targetItem, runtimeSourceId: runtimeRelation.sourceId,
        runtimeTargetId: runtimeRelation.targetId, runtimeRelationshipIds: [runtimeRelation.id],
        runtimeComponentIds: [runtimeRelation.sourceId, runtimeRelation.targetId],
        relatedNodeIds: unique([...(runtimeById.get(runtimeRelation.sourceId)?.graphNodeIds || []),
          ...(runtimeById.get(runtimeRelation.targetId)?.graphNodeIds || [])]),
        originalEdgeIds: [], evidenceIds: runtimeRelation.evidenceIds || [], confidence: runtimeRelation.confidence,
        semanticFlowGroup: null, provenance: [{ kind: "RUNTIME_RELATIONSHIP", id: runtimeRelation.id }],
        referenceOnly: configurationReference, presentationKind: "RUNTIME_RELATIONSHIP" });
    });

    cards.forEach((card) => {
      card.inputPortIds = unique(card.inputPortIds).sort();
      card.outputPortIds = unique(card.outputPortIds).sort();
      card.layout.portIds = card.items.flatMap((item) => [...item.inputPortIds, ...item.outputPortIds]);
    });

    const displayModel = { composites: cards, instances, cardById, itemById, ports, portById: Object.fromEntries(ports.map((port) => [port.id, port])),
      displayRelations: relations, runtimeComponents: (blueprint && blueprint.runtimeComponents || []).slice(),
      servletFilterExecution: servletFilterExecution || blueprint && blueprint.servletFilterExecution
        || { status: "UNKNOWN", entries: [], orderedComponentIds: [] },
      originalNodeToItemIds, originalNodeToCardIds, itemToOriginalNodeIds, itemToOriginalEdgeIds,
      originalEdgeToRelationIds, originalEdgeToSegmentIds, runtimeRelationshipToRelationIds, projectionToItemIds,
      projectionEdgeToRelationIds, projectionEdgeToSegmentIds,
      displayRelationToSegmentIds: {},
      runtimeComponentToItemIds: Object.fromEntries(Array.from(itemByRuntimeId, ([id, item]) => [id, [item.id]])),
      instanceToOriginalNodeIds: Object.fromEntries(instances.map((instance) => [instance.id, instance.originalNodeIds.slice()])),
      relationRoles, findingToDisplay: {}, displayEdgeInstances: [] };
    const rotatePoint = (point) => point && ({ ...point, x: point.y, y: point.x,
      side: point.side === "TOP" ? "LEFT" : point.side === "BOTTOM" ? "RIGHT"
        : point.side === "LEFT" ? "TOP" : point.side === "RIGHT" ? "BOTTOM" : point.side });
    const unrotatePoint = (point) => point && ({ ...point, x: point.y, y: point.x,
      side: point.side === "LEFT" ? "TOP" : point.side === "RIGHT" ? "BOTTOM"
        : point.side === "TOP" ? "LEFT" : point.side === "BOTTOM" ? "RIGHT" : point.side });
    const verticalRelations = relations.filter((relation) => !relation.internalCardId
      && !relation.referenceOnly
      && ["TOP", "BOTTOM"].includes(ports.find((port) => port.id === relation.visualSourcePortId)?.side)
      && ["TOP", "BOTTOM"].includes(ports.find((port) => port.id === relation.visualTargetPortId)?.side));
    const verticalRelationIds = new Set(verticalRelations.map((relation) => relation.id));
    const horizontalRelations = relations.filter((relation) => !relation.internalCardId
      && !relation.referenceOnly
      && !verticalRelationIds.has(relation.id));
    const emptyRouting = () => ({ junctions: [], segments: [], routesByRelationId: {}, unresolved: [],
      curveDiagnostics: { candidates: 0, applied: 0, cardCollisionRejections: 0, rowBoundaryRejections: 0 } });
    const mergeRouting = (target, source, rotate) => {
      const segmentIds = new Map();
      source.segments.forEach((segment) => {
        const id = `segment:${target.segments.length}`;
        segmentIds.set(segment.id, id);
        target.segments.push({ ...segment, id,
          from: rotate ? unrotatePoint(segment.from) : segment.from,
          to: rotate ? unrotatePoint(segment.to) : segment.to,
          axis: rotate ? segment.axis === "HORIZONTAL" ? "VERTICAL"
            : segment.axis === "VERTICAL" ? "HORIZONTAL" : segment.axis : segment.axis,
          geometry: segment.geometry && { ...segment.geometry,
            controlPoints: (segment.geometry.controlPoints || []).map((point) =>
              rotate ? unrotatePoint(point) : point) } });
      });
      source.junctions.forEach((junction) => target.junctions.push({ ...junction,
        ...(rotate ? unrotatePoint(junction) : junction),
        segmentIds: junction.segmentIds.map((id) => segmentIds.get(id)).filter(Boolean) }));
      Object.entries(source.routesByRelationId).forEach(([relationId, route]) => {
        target.routesByRelationId[relationId] = { ...route,
          sourcePort: rotate ? unrotatePoint(route.sourcePort) : route.sourcePort,
          targetPort: rotate ? unrotatePoint(route.targetPort) : route.targetPort,
          orderedSegmentIds: route.orderedSegmentIds.map((id) => segmentIds.get(id)).filter(Boolean) };
      });
      target.unresolved.push(...source.unresolved);
      Object.keys(target.curveDiagnostics).forEach((key) => {
        target.curveDiagnostics[key] += source.curveDiagnostics[key] || 0;
      });
    };
    const routing = emptyRouting();
    if (verticalRelations.length) {
      const rotatedInstances = instances.map((instance) => ({ ...instance, position: {
        x: instance.position.y, y: instance.position.x,
        width: instance.position.height, height: instance.position.width
      } }));
      const rotatedPorts = ports.filter((port) => ["TOP", "BOTTOM"].includes(port.side)).map(rotatePoint);
      mergeRouting(routing, routeOverview(rotatedInstances, verticalRelations, [], null, 0, rotatedPorts), true);
    }
    if (horizontalRelations.length) {
      mergeRouting(routing, routeOverview(instances, horizontalRelations, [], null, 0, ports), false);
    }
    const unresolvedVertical = new Set(routing.unresolved.filter((item) =>
      verticalRelationIds.has(item.relationId)).map((item) => item.relationId));
    let sideRouteIndex = 0;
    verticalRelations.filter((relation) => unresolvedVertical.has(relation.id)).forEach((relation) => {
      const sourcePort = ports.find((port) => port.id === relation.visualSourcePortId);
      const targetPort = ports.find((port) => port.id === relation.visualTargetPortId);
      if (!sourcePort || !targetPort) return;
      const sourceCard = cardById[relation.sourceInstanceId];
      const targetCard = cardById[relation.targetInstanceId];
      const sourceOutY = sourcePort.side === "BOTTOM" ? sourceCard.bounds.bottom + 24 : sourceCard.bounds.top - 24;
      const targetOutY = targetPort.side === "TOP" ? targetCard.bounds.top - 24 : targetCard.bounds.bottom + 24;
      const sourceOut = { x: sourcePort.x, y: sourceOutY };
      const targetOut = { x: targetPort.x, y: targetOutY };
      const trackX = mainCenterX - maxMainWidth / 2 - 24 - sideRouteIndex++ * 10;
      const points = [sourcePort, sourceOut, { x: trackX, y: sourceOut.y },
        { x: trackX, y: targetOut.y }, targetOut, targetPort]
        .filter((point, index, all) => index === 0
          || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
      const blocked = points.slice(1).some((point, index) => instances.some((obstacle) => {
        if (!obstacle.position) return false;
        if (index === 0 && obstacle.id === relation.sourceInstanceId) return false;
        if (index === points.length - 2 && obstacle.id === relation.targetInstanceId) return false;
        return segmentIntersectsExpandedNode(points[index], point, obstacle.position, 0);
      }));
      if (blocked) return;
      const segmentIds = [];
      for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1];
        const to = points[index];
        const id = "segment:" + routing.segments.length;
        segmentIds.push(id);
        routing.segments.push({ id, from, to, groupKey: "detail-side-route:" + relation.id,
          routeRole: index === 1 ? "SOURCE_STUB" : index === points.length - 1 ? "TARGET_STUB" : "DETOUR",
          axis: from.y === to.y ? "HORIZONTAL" : "VERTICAL", relationIds: [relation.id] });
      }
      routing.routesByRelationId[relation.id] = { sourcePort, targetPort, orderedSegmentIds: segmentIds };
    });
    routing.unresolved = routing.unresolved.filter((item) => !routing.routesByRelationId[item.relationId]);
    routing.relations = relations;
    relations.forEach((relation) => {
      const segmentIds = (routing.routesByRelationId[relation.id]?.orderedSegmentIds || []).slice();
      displayModel.displayRelationToSegmentIds[relation.id] = segmentIds;
      relation.originalEdgeIds.forEach((edgeId) => {
        const ids = originalEdgeToSegmentIds[edgeId] || (originalEdgeToSegmentIds[edgeId] = []);
        segmentIds.forEach((id) => { if (!ids.includes(id)) ids.push(id); });
      });
      (relation.projectionEdgeIds || []).forEach((id) => { projectionEdgeToSegmentIds[id] = segmentIds; });
    });
    displayModel.findingToDisplay = Object.fromEntries(findings.map((finding) => [finding.id, {
      itemIds: unique((finding.nodeIds || []).flatMap((id) => originalNodeToItemIds[id] || [])),
      relationIds: unique((finding.edgeIds || []).flatMap((id) => originalEdgeToRelationIds[id] || [])),
      segmentIds: unique((finding.edgeIds || []).flatMap((id) => originalEdgeToSegmentIds[id] || []))
    }]));

    if (blueprint) {
      blueprint.cards = cards;
      blueprint.relations = (blueprint.runtimeRelationships || []).slice();
      blueprint.routingPlan = routing;
      const areaForCard = (card) => card.areaId || "mvc";
      const areaRank = { host: 0, servlet: 1, security: 2, mvc: 3 };
      const existing = new Map((blueprint.regions || []).map((region) => [region.kind.toLowerCase(), region]));
      const ensureRegion = (area) => {
        if (!existing.has(area)) {
          const coverageArea = area === "host" ? "WEB_SERVER" : area.toUpperCase();
          const environment = graph.runtimeArchitecture && graph.runtimeArchitecture.environment || {};
          const title = area === "host" ? environment.serverKind && environment.serverKind !== "UNKNOWN"
            ? `${text(environment.serverKind).toUpperCase()} / WAS` : "WEB SERVER / WAS"
            : area === "servlet" ? "SERVLET CONTAINER" : area === "security" ? "SPRING SECURITY" : "SPRING MVC";
          const parentId = area === "host" ? null : area === "servlet" ? "runtime-region:host"
            : existing.has("servlet") ? "runtime-region:servlet" : "runtime-region:host";
          const coverageRows = graph.runtimeArchitecture && Array.isArray(graph.runtimeArchitecture.coverage)
            ? graph.runtimeArchitecture.coverage.filter((item) => text(item.area).toUpperCase() === coverageArea) : [];
          const coverage = ["PARTIAL", "UNKNOWN", "PRESENT", "ABSENT", "NOT_SUPPORTED"]
            .find((state) => coverageRows.some((item) => item.state === state)) || "UNKNOWN";
          const region = { id: `runtime-region:${area}`, parentId, kind: area.toUpperCase(), title,
            coverage: (blueprint.regions || []).find((item) => item.kind.toLowerCase() === area)?.coverage || coverage,
            componentIds: [] };
          existing.set(area, region);
          blueprint.regions.push(region);
        }
        return existing.get(area);
      };
      cards.forEach((card) => {
        if (!card.runtimeComponentIds.length) return;
        const region = ensureRegion(areaForCard(card));
        region.componentIds.push(...card.runtimeComponentIds);
      });
      const runtimeAreas = new Set(cards.filter((card) => card.runtimeComponentIds.length).map(areaForCard));
      if (runtimeAreas.size) runtimeAreas.add("host");
      if (runtimeAreas.has("security") || runtimeAreas.has("mvc")) runtimeAreas.add("servlet");
      ["host", "servlet", "security", "mvc"].filter((area) => runtimeAreas.has(area)).forEach(ensureRegion);
      const membersByArea = {
        host: cards,
        servlet: cards.filter((card) => ["servlet", "security", "mvc"].includes(areaForCard(card))),
        security: cards.filter((card) => areaForCard(card) === "security"),
        mvc: cards.filter((card) => areaForCard(card) === "mvc")
      };
      Object.entries(membersByArea).filter(([area]) => runtimeAreas.has(area)).forEach(([area, members]) => {
        const region = ensureRegion(area);
        const padding = area === "host" ? 64 : area === "servlet" ? 48 : 30;
        if (!members.length) {
          region.bounds = itemBounds(24, 24, 320, 88);
          return;
        }
        const left = Math.min(...members.map((card) => card.bounds.x)) - padding;
        const top = Math.min(...members.map((card) => card.bounds.y)) - padding - 28;
        const right = Math.max(...members.map((card) => card.bounds.x + card.bounds.width)) + padding;
        const bottom = Math.max(...members.map((card) => card.bounds.y + card.bounds.height)) + padding;
        region.bounds = itemBounds(left, top, right - left, bottom - top);
      });
      const serverKinds = new Set(["WEB_SERVER", "TOMCAT_SERVER", "TOMCAT_SERVICE", "TOMCAT_CONNECTOR",
        "TOMCAT_ENGINE", "TOMCAT_HOST", "TOMCAT_CONTEXT", "TOMCAT_WRAPPER"]);
      const hasServerRuntime = cards.some((card) => areaForCard(card) === "host"
        && card.runtimeComponentIds.some((id) => serverKinds.has(runtimeById.get(id)?.kind)));
      const regionTitles = { host: hasServerRuntime ? "웹 서버 / WAS" : "애플리케이션 실행 환경",
        servlet: "서블릿 컨테이너",
        security: "스프링 시큐리티", mvc: "스프링 MVC" };
      blueprint.regions.forEach((region) => {
        const area = region.kind.toLowerCase();
        if (regionTitles[area]) region.title = regionTitles[area];
        region.parentId = area === "host" ? null : area === "servlet" ? "runtime-region:host"
          : ["security", "mvc"].includes(area) ? "runtime-region:servlet" : region.parentId;
        if (["host", "servlet", "security", "mvc"].includes(area)) {
          region.componentIds = unique(cards.filter((card) => areaForCard(card) === area)
            .flatMap((card) => card.runtimeComponentIds));
        }
      });
      const childAreas = { host: ["servlet"], servlet: ["security", "mvc"], security: [], mvc: [] };
      ["mvc", "security", "servlet", "host"].filter((area) => runtimeAreas.has(area)).forEach((area) => {
        const region = existing.get(area);
        const contents = [
          ...cards.filter((card) => areaForCard(card) === area).map((card) => card.bounds),
          ...childAreas[area].filter((child) => runtimeAreas.has(child))
            .map((child) => existing.get(child)?.bounds).filter(Boolean)
        ];
        if (!contents.length) return;
        const padding = area === "host" ? 72 : area === "servlet" ? 64 : 56;
        const left = Math.min(...contents.map((bounds) => bounds.left ?? bounds.x)) - padding;
        const top = Math.min(...contents.map((bounds) => bounds.top ?? bounds.y)) - padding - 21;
        const right = Math.max(...contents.map((bounds) => bounds.right ?? bounds.x + bounds.width)) + padding;
        const bottom = Math.max(...contents.map((bounds) => bounds.bottom ?? bounds.y + bounds.height)) + padding;
        region.bounds = itemBounds(left, top, right - left, bottom - top);
      });
      blueprint.regions.sort((left, right) => (areaRank[left.kind.toLowerCase()] ?? 9)
        - (areaRank[right.kind.toLowerCase()] ?? 9));
      const routeBounds = routing.segments.map((segment) => {
        const points = [segment.from, segment.to, ...(segment.geometry?.controlPoints || [])];
        return { left: Math.min(...points.map((point) => point.x)),
          top: Math.min(...points.map((point) => point.y)),
          right: Math.max(...points.map((point) => point.x)),
          bottom: Math.max(...points.map((point) => point.y)) };
      });
      const allBounds = [...cards.map((card) => card.bounds),
        ...blueprint.regions.map((region) => region.bounds).filter(Boolean), ...routeBounds];
      const left = Math.min(...allBounds.map((bounds) => bounds.left ?? bounds.x), 16);
      const top = Math.min(...allBounds.map((bounds) => bounds.top ?? bounds.y), 24);
      const right = Math.max(...allBounds.map((bounds) => bounds.right ?? bounds.x + bounds.width), 616);
      const bottom = Math.max(...allBounds.map((bounds) => bounds.bottom ?? bounds.y + bounds.height), 264);
      blueprint.bounds = itemBounds(left - 64, top - 64, right - left + 128, bottom - top + 128);

    }
    return { displayModel, routing };
  }

  function semanticLayout(graph, elkLayout) {
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
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
    const runtimeArchitecture = graph.runtimeArchitecture || null;
    const detailBlueprint = detailPresentation
      ? buildDetailBlueprint(runtimeArchitecture, graph, graph.detailEndpointId || "", flowIndex) : null;
    const runtimeComponents = detailBlueprint && detailBlueprint.runtimeComponents || [];
    const runtimeServletRegistrations = (detailBlueprint && detailBlueprint.runtimeComponents || [])
      .filter((component) => component.kind === "SERVLET_FILTER_REGISTRATION");
    const runtimeRegistrationByGraphNode = new Map();
    runtimeServletRegistrations.forEach((component) => (component.graphNodeIds || []).forEach((id) => {
      const list = runtimeRegistrationByGraphNode.get(id) || [];
      list.push(component);
      runtimeRegistrationByGraphNode.set(id, list);
    }));
    const graphServletFilterIds = new Set((servletRegistration.filters || []).map((filter) => filter.id));
    const runtimeFilterExecution = detailBlueprint && detailBlueprint.servletFilterExecution || {
      status: "UNKNOWN", reason: "Runtime FilterMap 확인 불가", orderedComponentIds: [], entries: []
    };
    const mappedRegistrationNodeIds = runtimeServletRegistrations.flatMap((component) =>
      (component.graphNodeIds || []).filter((id) => graphServletFilterIds.has(id)));
    const runtimeRegistrationsMapped = runtimeServletRegistrations.length > 0
      && mappedRegistrationNodeIds.length === runtimeServletRegistrations.length
      && new Set(mappedRegistrationNodeIds).size === runtimeServletRegistrations.length
      && graphServletFilterIds.size === runtimeServletRegistrations.length;
    const graphOrderFallbackAllowed = (runtimeServletRegistrations.length === 0 || runtimeRegistrationsMapped)
      && servletRegistration.orderStatus === "CONFIRMED"
      && !/Graph.*(대응|일치)/.test(text(runtimeFilterExecution.reason));
    const registeredServletOrderStatus = runtimeFilterExecution.status === "CONFIRMED"
      || graphOrderFallbackAllowed ? "CONFIRMED" : "UNKNOWN";
    const orderedRegisteredServletFilters = runtimeFilterExecution.status === "CONFIRMED"
      ? runtimeFilterExecution.orderedComponentIds.map((id) => runtimeServletRegistrations.find((item) => item.id === id)).filter(Boolean)
      : graphOrderFallbackAllowed
        ? servletRegistration.filters.map((filter) => runtimeRegistrationByGraphNode.get(filter.id)?.[0] || filter)
        : [];
    const effectiveServletFilterExecution = runtimeFilterExecution.status === "CONFIRMED"
      ? runtimeFilterExecution
      : graphOrderFallbackAllowed ? { status: "CONFIRMED", source: "GRAPH_FLOW", reason: "Snapshot FILTERED_BY와 filterOrder 확인",
        orderedGraphNodeIds: servletRegistration.filters.map((filter) => filter.id), orderedComponentIds: [], entries: [] }
        : { ...runtimeFilterExecution, status: "UNKNOWN", orderedComponentIds: [], entries: [] };
    const runtimeExecutionByComponentId = new Map((effectiveServletFilterExecution.entries || [])
      .map((entry) => [entry.componentId, entry]));
    const isDelegatingServletFilter = (item) => {
      const runtimeEntry = runtimeExecutionByComponentId.get(item.id);
      return Boolean(runtimeEntry && runtimeEntry.delegating)
        || /DelegatingFilterProxy|springSecurityFilterChain/i.test(`${item.className || ""} ${attributes(item).filterClass || ""} ${attributes(item).registrationName || ""} ${item.label || ""}`);
    };
    const servletDelegationIndex = orderedRegisteredServletFilters.findIndex(isDelegatingServletFilter);
    const runtimeArchitectureSupplied = Boolean(runtimeArchitecture);
    const servletLearningAllowed = !runtimeArchitectureSupplied
      || (!["NON_WEB", "REACTIVE"].includes(text(runtimeArchitecture.environment && runtimeArchitecture.environment.webApplicationType).toUpperCase())
        && (!detailBlueprint || detailBlueprint.showServletLearning !== false));
    const securityLearningAllowed = servletLearningAllowed
      && (!detailBlueprint || detailBlueprint.showSecurityLearning !== false);
    const mvcLearningAllowed = servletLearningAllowed
      && (!detailBlueprint || detailBlueprint.showMvcLearning !== false);
    const securityProjectionAllowed = securityLearningAllowed
      && (runtimeComponents.length === 0
        || registeredServletOrderStatus === "CONFIRMED" && servletDelegationIndex >= 0);
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
    const confirmedHandlerMappings = graph.edges.filter((edge) => edge.type === "FLOWS_TO"
      && edge.confidence === "CONFIRMED" && nodeById.get(edge.sourceId)?.type === "ENDPOINT"
      && nodeById.get(edge.targetId)?.type === "HANDLER").length;
    const endpointSecurityReferences = graph.edges.filter((edge) => edge.confidence === "CONFIRMED"
      && SUPPORT_EDGE_TYPES.has(edge.type)
      && [edge.sourceId, edge.targetId].some((id) => nodeById.get(id)?.type === "HANDLER")).length;
    const laneDefinitions = createLaneDefinitions({
      servletFilterCount: servletFilters.length,
      maxSecurityFilters,
      endpointCount: endpoints.length,
      endpointFlowCount: confirmedHandlerMappings,
      endpointReferenceCount: endpointSecurityReferences,
      securityNodeCount: supportNodes.length,
      overview: !detailPresentation,
      detail: detailPresentation,
      applicationCount: applications.length
    }).map((lane) => ({ ...lane }));
    if (!detailPresentation) {
      const laneNodes = { "servlet-filter": servletFilters, "security-chain": securityFilters,
        "security-checks": supportNodes, endpoint: endpoints, handler: handlers };
      laneDefinitions.forEach((lane) => {
        const nodes = laneNodes[lane.id];
        if (!nodes?.length || !lane.cardWidth) return;
        const longest = Math.max(...nodes.map((node) => Array.from(blueprintNodePresentation(node).label)
          .reduce((width, character) => width + (character.codePointAt(0) > 255 ? 16 : 9), 0)));
        lane.cardWidth = Math.max(lane.cardWidth, Math.min(720, Math.ceil(longest + 150)));
      });
    }
    const lanes = positionLanes(laneDefinitions, !detailPresentation);
    let detailBlueprintOffsetX = 0;
    if (detailPresentation && detailBlueprint && lanes.length) {
      const leftmostLane = Math.min(...lanes.map((lane) => lane.x));
      detailBlueprintOffsetX = Math.max(0, detailBlueprint.bounds.right + 96 - leftmostLane);
      lanes.forEach((lane) => { lane.x += detailBlueprintOffsetX; });
    }
    const endpointLane = laneDefinition("endpoint", lanes);
    const handlerLane = laneDefinition("handler", lanes);
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
    const endpointColumnCount = Math.max(1, endpointLane.columns || 1);
    const endpointFirstColumnCount = Math.ceil(endpoints.length / endpointColumnCount);
    const endpointStagger = endpointColumnCount > 1 ? ROW_STEP / 2 : 0;
    const endpointLastColumnCount = Math.max(0, endpoints.length - endpointFirstColumnCount * (endpointColumnCount - 1));
    const endpointHeight = endpointColumnCount > 1
      ? blockHeight(Math.max(endpointFirstColumnCount, endpointLastColumnCount)) + endpointStagger
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
    const overviewRuntimeComponents = Array.isArray(runtimeArchitecture?.components) ? runtimeArchitecture.components : [];
    const registrations = overviewRuntimeComponents.filter((component) => component.kind === "SERVLET_FILTER_REGISTRATION");
    const filterMappings = overviewRuntimeComponents.filter((component) => component.kind === "TOMCAT_FILTER_MAPPING");
    servletFilters.forEach((filter) => {
      const relationshipInfo = (servletRegistration.orderInfo || {})[filter.id];
      let info = relationshipInfo && relationshipInfo.status !== "UNKNOWN"
        ? relationshipInfo : servletReference(filter);
      const matches = registrations.filter((component) => (component.graphNodeIds || []).includes(filter.id));
      if (matches.length === 1) {
        const registration = matches[0];
        const name = text(attributes(registration).registrationName);
        const mappings = filterMappings.filter((mapping) => mapping.contextId === registration.contextId
          && text(attributes(mapping).filterName) === name);
        const order = mappings.length === 1 ? positiveInteger(attributes(mappings[0]).registrationOrder) : null;
        const duplicates = order === null ? [] : filterMappings.filter((mapping) => mapping.contextId === registration.contextId
          && positiveInteger(attributes(mapping).registrationOrder) === order);
        info = order !== null && duplicates.length === 1
          ? { status: "REGISTRATION", order, source: "TOMCAT_FILTER_MAP" }
          : { status: "UNKNOWN", order: null, source: "TOMCAT_FILTER_MAP" };
      }
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
    if (endpointColumnCount > 1) {
      orderedEndpoints.forEach((endpoint, index) => {
        const column = Math.floor(index / endpointFirstColumnCount);
        const row = index % endpointFirstColumnCount;
        const y = endpointStartY + row * ROW_STEP + (column ? endpointStagger : 0);
        positions[endpoint.id] = { x: endpointLane.x + column * (endpointLane.columnStep || COLUMN_STEP), y };
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
      instanceToOriginalNodeIds: {}, displayEdgeInstances: [], originalEdgeToInstanceIds: {},
      composites: [], cardById: {}, itemById: {}, portById: {}, originalNodeToItemIds: {},
      originalNodeToCardIds: {}, itemToOriginalNodeIds: {}, itemToOriginalEdgeIds: {},
      originalEdgeToRelationIds: {}, originalEdgeToSegmentIds: {}, findingToDisplay: {} };

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

    if (!detailPresentation) {
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
    let layoutTitleBounds = [];
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
    let findingSectionLayouts = detailPresentation ? [] : sectionLayoutsFor(graph, positions, layoutTitleBounds);
    const hiddenGroupMembers = new Set();
    const visibleGroupBounds = [];
    if (!detailPresentation) {
      controllerGroups.concat(groups).forEach((group) => {
        (group.handlerIds || group.nodeIds || []).forEach((id) => hiddenGroupMembers.add(id));
        if (group.position) visibleGroupBounds.push(layoutRect(group.position));
      });
    }
    const occupiedBounds = graph.nodes.filter((node) => !hiddenGroupMembers.has(node.id))
      .map((node) => positions[node.id]).filter(Boolean).map((position) => detailPresentation
        ? layoutRect(position, DETAIL_CARD_WIDTH, DETAIL_CARD_HEIGHT) : layoutRect(position))
      .concat(visibleGroupBounds, layoutTitleBounds,
        findingSectionLayouts.flatMap((section) => [section.bounds, section.titleBounds]));

    const projectionAliases = {};
    const aliasRuntime = (projectionId, kinds) => {
      const component = runtimeComponents.find((item) => kinds.includes(item.kind));
      if (!component) return;
      const graphNodeId = (component.graphNodeIds || []).find((id) => graph.nodes.some((node) => node.id === id));
      projectionAliases[projectionId] = graphNodeId ? { graphNodeId } : { runtimeComponentId: component.id };
    };
    aliasRuntime("education-web-server", ["WEB_SERVER"]);
    const servletContexts = runtimeComponents.filter((item) => item.kind === "SERVLET_CONTEXT");
    if (servletContexts.length === 1) projectionAliases["education-servlet-container"] = {
      runtimeComponentId: servletContexts[0].id
    };
    aliasRuntime("education-filter-chain-proxy", ["FILTER_CHAIN_PROXY"]);
    aliasRuntime("education-handler-mapping", ["HANDLER_MAPPING"]);
    aliasRuntime("education-handler-adapter", ["HANDLER_ADAPTER"]);
    if (securityProjectionAllowed) {
      const delegationComponent = runtimeComponents.find((item) => item.kind === "SERVLET_FILTER_REGISTRATION"
        && isDelegatingServletFilter(item));
      const delegationNode = graph.nodes.find((node) => node.type === "FILTER"
        && attributes(node).registrationKind === "SERVLET"
        && /DelegatingFilterProxy|springSecurityFilterChain/.test(`${attributes(node).filterClass || ""} ${attributes(node).registrationName || ""} ${node.label || ""}`));
      if (delegationComponent) projectionAliases["education-delegating-filter-proxy"] = {
        runtimeComponentId: delegationComponent.id
      };
      else if (delegationNode) projectionAliases["education-delegating-filter-proxy"] = { graphNodeId: delegationNode.id };
    }
    const projectionNodeDefinitions = detailPresentation && servletLearningAllowed ? [
      projectionNode("education-http-request", "HTTP 요청", "서블릿 컨테이너로 들어오는 요청 단계", 0, EDUCATION_Y),
      projectionNode("education-servlet-container", "서블릿 컨테이너", "Servlet 요청 처리와 Filter 연결을 담당하는 일반 구조", 0, EDUCATION_Y),
      ...(!runtimeArchitectureSupplied ? [projectionNode("education-request-prepare", "요청 처리 준비",
        "요청 정보를 다음 처리 단계에 전달하는 일반적인 과정 · 실제 요청 객체 아님", 0, EDUCATION_Y)] : []),
      projectionNode("education-http-servlet-request", "HttpServletRequest", "요청 정보 전달 객체 · 실제 요청 인스턴스 아님", 0, EDUCATION_Y),
      projectionNode("education-http-servlet-response", "HttpServletResponse", "응답 정보 전달 객체 · 실제 응답 인스턴스 아님", 0, EDUCATION_Y),
      ...(securityProjectionAllowed ? [
        projectionNode("education-delegating-filter-proxy", "DelegatingFilterProxy", "Servlet Filter에서 Spring Security로 처리 위임", delegationLane.column, EDUCATION_Y),
        projectionNode("education-filter-chain-proxy", "FilterChainProxy", "등록된 SecurityFilterChain 평가", delegationLane.column + 1, EDUCATION_Y)
      ] : []),
      ...(mvcLearningAllowed ? [
        projectionNode("education-handler-mapping", "HandlerMapping 확인 불가", "요청 정보에 맞는 Handler 조회 · 실제 구현 확인 불가", mappingLane.column, EDUCATION_Y),
        ...(detailPresentation ? [projectionNode("education-handler-adapter", "HandlerAdapter 확인 불가", "Controller·Handler 호출 준비 · 실제 구현 확인 불가", mappingLane.column + 1, EDUCATION_Y)] : [])
      ] : []),
      projectionNode("education-http-response", "HTTP 응답", "요청 처리 이후 응답이 반환되는 일반적인 동기 흐름", 0, EDUCATION_Y)
    ] : [];
    const projectionNodes = projectionNodeDefinitions.filter((node) => !projectionAliases[node.id]);
    if (detailPresentation) projectionNodes.forEach((node) => {
      node.width = DETAIL_CARD_WIDTH;
      node.height = DETAIL_CARD_HEIGHT;
      node.bounds = layoutRect(node.position, node.width, node.height);
    });
    const laneByColumn = new Map(lanes.map((lane) => [lane.column, lane]));
    projectionNodes.forEach((node) => {
      const oldColumn = (node.position.x - NODE_PADDING) / COLUMN_STEP;
      const lane = laneByColumn.get(oldColumn);
      if (lane) {
        node.position.x = lane.x;
        node.lane = lane.id;
      } else if (detailPresentation) node.position.x += detailBlueprintOffsetX;
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
    const mainLearningIds = ["education-http-request", "education-servlet-container", "education-request-prepare",
      "education-http-servlet-request",
      "education-delegating-filter-proxy", "education-filter-chain-proxy", "education-handler-mapping",
      "education-handler-adapter", "education-http-response"];
    const projectionBounds = new Set(projectionNodes.map((node) => node.bounds));
    const fixedBounds = occupiedBounds.filter((bounds) => !projectionBounds.has(bounds));
    occupiedBounds.length = 0;
    occupiedBounds.push(...fixedBounds);
    let previousLearningBottom = null;
    const placeProjectionNode = (node, enforceOrder) => {
      let y = Math.max(node.position.y,
        enforceOrder && previousLearningBottom !== null ? previousLearningBottom + NODE_SAFE_MARGIN : TOP_PADDING);
      for (let attempt = 0; attempt < occupiedBounds.length + 2; attempt += 1) {
        const candidate = layoutRect({ x: node.position.x, y }, node.width, node.height);
        const collisions = occupiedBounds.filter((bounds) => overlapsRect(candidate, bounds, NODE_SAFE_MARGIN));
        if (!collisions.length) break;
        y = Math.max(...collisions.map((bounds) => bounds.bottom + NODE_SAFE_MARGIN + EDUCATION_AREA_TOP_PADDING));
      }
      node.position.y = y;
      node.bounds = layoutRect(node.position, node.width, node.height);
      occupiedBounds.push(node.bounds);
      if (enforceOrder) previousLearningBottom = node.position.y + node.height;
    };
    const mainProjectionNodes = mainLearningIds.map((id) => projectionNodes.find((node) => node.id === id)).filter(Boolean);
    const orderedMainIds = new Set(mainProjectionNodes.map((node) => node.id));
    mainProjectionNodes.forEach((node) => placeProjectionNode(node, true));
    projectionNodes.filter((node) => !orderedMainIds.has(node.id)).forEach((node) => placeProjectionNode(node, false));
    const projectionEdges = [];
    const projectionNodeIds = new Set(projectionNodes.map((node) => node.id));
    const positionedRowNodeIds = new Set();
    graph.nodes.forEach((node) => {
      const rowIds = hiddenGroupPlan.groupByNode.get(node.id);
      if (!rowIds) return;
      rowIds.forEach((rowId) => {
        if (!rowPositions.get(rowId)?.has(node.id)) return;
        positionedRowNodeIds.add(rowIds.size > 1 ? `display:${rowId}:${node.id}` : node.id);
      });
    });
    const positionedDisplayGroupIds = new Set(groups.concat(controllerGroups)
      .filter((group) => group.position).map((group) => group.id));
    const runtimeComponentIds = new Set((runtimeComponents || []).map((component) => component.id));
    const hasProjectionAnchor = (id) => projectionNodeIds.has(id) || Boolean(projectionAliases[id]) || Boolean(positions[id])
      || positionedRowNodeIds.has(id) || positionedDisplayGroupIds.has(id) || runtimeComponentIds.has(id);
    const addProjectionEdge = (id, sourceId, targetId, metadata = {}) => {
      if (!hasProjectionAnchor(sourceId) || !hasProjectionAnchor(targetId)) return;
      projectionEdges.push(projectionEdge(id, sourceId, targetId, "education", metadata));
    };
    const dispatcherRuntime = runtimeComponents.filter((component) => ["SERVLET", "DISPATCHER_SERVLET"].includes(component.kind)
      && /DispatcherServlet/.test(`${component.className || ""} ${attributes(component).servletClass || ""}`));
    const dispatcherGraphNodes = graph.nodes.filter((node) => node.type === "SERVLET"
      && (attributes(node).servletKind === "DISPATCHER"
        || /DispatcherServlet/.test(text(attributes(node).servletClass))
        || text(attributes(node).servletName).toLowerCase() === "dispatcherservlet"));
    const dispatcherAnchorId = dispatcherRuntime.length === 1 ? dispatcherRuntime[0].id
      : dispatcherGraphNodes.length === 1 ? dispatcherGraphNodes[0].id : null;
    const selectedMatch = detailPresentation && graph.detailEndpointId && flowIndex
      && typeof flowIndex.firstMatchedChain === "function"
      ? flowIndex.firstMatchedChain(graph.detailEndpointId) : null;
    const selectedChainId = selectedMatch && selectedMatch.status === "CONFIRMED" && selectedMatch.chain
      ? selectedMatch.chain.id : null;
    if (detailPresentation && servletLearningAllowed) {
      const hasWebServer = Boolean(projectionAliases["education-web-server"]);
      addProjectionEdge("education-request-to-web-server", "education-http-request", "education-web-server",
        { flowGroup: "request-context", projectionKind: "web-server" });
      addProjectionEdge("education-web-server-to-servlet-container",
        hasWebServer ? "education-web-server" : "education-http-request", "education-servlet-container",
        { flowGroup: "request-context", projectionKind: "servlet-container" });
      if (projectionNodeIds.has("education-request-prepare")) {
        addProjectionEdge("education-container-to-request-prepare", "education-servlet-container", "education-request-prepare",
          { flowGroup: "request-context", projectionKind: "request-prepare" });
        addProjectionEdge("education-request-prepare-to-request-object", "education-request-prepare",
          "education-http-servlet-request", { flowGroup: "request-context", projectionKind: "request-object" });
      } else addProjectionEdge("education-container-to-request-object", "education-servlet-container",
        "education-http-servlet-request", { flowGroup: "request-context", projectionKind: "request-object" });
      const firstServletFilter = orderedRegisteredServletFilters[0];
      if (firstServletFilter && registeredServletOrderStatus === "CONFIRMED") {
        addProjectionEdge("education-request-to-first-servlet-filter", "education-http-servlet-request", firstServletFilter.id,
          { flowGroup: "servlet-filter", projectionKind: "servlet-filter-order", orderIndex: 0 });
        orderedRegisteredServletFilters.slice(0, -1).forEach((filter, index) => {
          const nextIndex = index + 1;
          if (index === servletDelegationIndex) return;
          addProjectionEdge(`servlet-flow-${index}`, filter.id, orderedRegisteredServletFilters[nextIndex].id, {
            flowGroup: "servlet-filter",
            projectionKind: "servlet-filter-order",
            orderIndex: nextIndex,
            routeKind: nextIndex % MAX_FILTER_COLUMNS === 0 ? "filter-wrap" : "direct"
          });
        });
      } else if (!runtimeServletRegistrations.length) {
        addProjectionEdge("education-http-request-to-delegating", "education-http-servlet-request", "education-delegating-filter-proxy");
      }
      if (runtimeComponents.length === 0 && registeredServletOrderStatus === "CONFIRMED"
        && orderedRegisteredServletFilters.length && servletDelegationIndex < 0) {
        const lastServletFilter = orderedRegisteredServletFilters[orderedRegisteredServletFilters.length - 1];
        addProjectionEdge("servlet-filter-to-educational-delegating", lastServletFilter.id, "education-delegating-filter-proxy",
          { flowGroup: "security-delegation", projectionKind: "educational-security-delegation" });
      }
    }
    if (detailPresentation && securityProjectionAllowed) {
      addProjectionEdge("delegating-to-filter-chain-proxy", "education-delegating-filter-proxy", "education-filter-chain-proxy",
        { flowGroup: "security-delegation", projectionKind: "security-delegation" });
      if (selectedChainId) addProjectionEdge("filter-chain-proxy-to-selected-chain",
        "education-filter-chain-proxy", selectedChainId,
        { flowGroup: "security-delegation", projectionKind: "security-chain-selection" });
    }
    chains.forEach((chain) => {
      if (detailPresentation && !securityProjectionAllowed) return;
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
        if (detailPresentation && chain.id === selectedChainId) {
          const returnIndex = servletDelegationIndex >= 0 ? servletDelegationIndex + 1 : -1;
          const returnTarget = returnIndex >= 0 ? orderedRegisteredServletFilters[returnIndex]?.id : dispatcherAnchorId;
          const policy = selectedUrlPolicy(graph, chain.id);
          if (policy) {
            addProjectionEdge(`selected-chain-to-policy:${chain.id}`, lastFilterId, policy.id,
              { flowGroup: chain.id, projectionKind: "authorization-policy" });
          }
          if (returnTarget) addProjectionEdge(`selected-chain-to-servlet-return:${chain.id}`,
            policy ? policy.id : lastFilterId, returnTarget,
            { flowGroup: "mvc", projectionKind: returnIndex >= 0 ? "servlet-filter-return" : "servlet-dispatch" });
        }
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
              { flowGroup: chain.id, projectionKind: "security-check-overview", relatedNodeIds: entry.nodeIds,
                originalSourceNodeId: items[items.length - 1].filter.id });
          });
        }
      }
    });
    if (detailPresentation && dispatcherAnchorId && registeredServletOrderStatus === "CONFIRMED"
      && orderedRegisteredServletFilters.length && servletDelegationIndex < 0) {
      const lastServletFilter = orderedRegisteredServletFilters[orderedRegisteredServletFilters.length - 1];
      addProjectionEdge("servlet-filter-to-dispatcher", lastServletFilter.id, dispatcherAnchorId,
        { flowGroup: "mvc", projectionKind: "servlet-dispatch" });
    }
    if (detailPresentation && dispatcherAnchorId && registeredServletOrderStatus === "CONFIRMED"
      && servletDelegationIndex >= 0 && servletDelegationIndex < orderedRegisteredServletFilters.length - 1) {
      const lastServletFilter = orderedRegisteredServletFilters[orderedRegisteredServletFilters.length - 1];
      addProjectionEdge("servlet-filter-return-to-dispatcher", lastServletFilter.id, dispatcherAnchorId,
        { flowGroup: "mvc", projectionKind: "servlet-dispatch" });
    }
    const selectedHandlerEdge = detailPresentation && graph.detailEndpointId
      ? graph.edges.find((edge) => edge.type === "FLOWS_TO" && edge.confidence === "CONFIRMED"
        && edge.sourceId === graph.detailEndpointId && nodeById.get(edge.targetId)?.type === "HANDLER")
      : null;
    const selectedEndpointId = detailPresentation ? text(graph.detailEndpointId) : "";
    if (dispatcherAnchorId && mvcLearningAllowed) {
      addProjectionEdge("dispatcher-to-handler-mapping", dispatcherAnchorId, "education-handler-mapping",
        { flowGroup: "mvc", projectionKind: "handler-mapping" });
      if (selectedEndpointId && nodeById.get(selectedEndpointId)?.type === "ENDPOINT") {
        addProjectionEdge("handler-mapping-to-selected-endpoint", "education-handler-mapping", selectedEndpointId,
          { flowGroup: "mvc", projectionKind: "endpoint-mapping" });
        addProjectionEdge("selected-endpoint-to-handler-adapter", selectedEndpointId, "education-handler-adapter",
          { flowGroup: "mvc", projectionKind: "handler-adapter" });
        if (selectedHandlerEdge) addProjectionEdge("handler-adapter-to-selected-handler",
          "education-handler-adapter", selectedHandlerEdge.targetId,
          { flowGroup: "mvc", projectionKind: "handler-invocation" });
      }
    }
    if (selectedHandlerEdge) addProjectionEdge(`handler-to-http-response:${selectedHandlerEdge.targetId}`,
      selectedHandlerEdge.targetId, "education-http-response",
      { flowGroup: "http-response", projectionKind: "http-response-return" });

    if (isolatedSupportIds.size > 0) {
      Array.from(isolatedSupportIds).forEach((id) => {
        supportAnchors[id] = { status: "UNKNOWN", anchorId: null };
      });
      actualBottom = Math.max(actualBottom, ...hiddenGroups.filter((row) => row.id === "isolated")
        .map((row) => row.rowBottom || 0));
    }

    const rowOrder = new Map(hiddenGroups.map((row, index) => [row.id, index]));
    let instanceByNode = new Map(graph.nodes.map((node) => [node.id, []]));
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
    let displayInstances = groupInstances.slice();
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
    let overviewCompositeState = null;
    if (!detailPresentation) {
      overviewCompositeState = buildOverviewComposites(graph, hiddenGroups, lanes, endpointHandlers,
        servletFilters, servletFilterOrder, securityFilterOrder, chainFilterOrderStatus, filtersByChain,
        controllerGroups, groups);
      displayInstances = overviewCompositeState.instances;
      instanceByNode = new Map(graph.nodes.map((node) => [node.id, []]));
      displayInstances.forEach((instance) => instance.originalNodeIds.forEach((nodeId) => {
        instanceByNode.get(nodeId)?.push(instance);
      }));
      Object.entries(overviewCompositeState.nodeItemsByRow).forEach(([key, itemId]) => {
        const [rowId, nodeId] = JSON.parse(key);
        const item = overviewCompositeState.itemById[itemId];
        const card = overviewCompositeState.cardById[item.cardId];
        const bounds = item.bounds || card.headerBounds;
        if (bounds && (positions[nodeId] === undefined || nodeToDisplay[nodeId] === nodeId)) {
          positions[nodeId] = { ...bounds };
        }
      });
      const cards = overviewCompositeState.cards;
      const sectionCards = {
        request: cards.filter((card) => card.kind === "APPLICATION_CONTEXT"),
        servletFilter: cards.filter((card) => card.areaId === "servlet-filter"),
        security: cards.filter((card) => card.areaId === "spring-security"),
        securityChecks: cards.filter((card) => card.areaId === "security-checks"),
        endpoint: cards.filter((card) => card.areaId === "api-mapping"),
        handler: cards.filter((card) => card.areaId === "controller-handler")
      };
      Object.entries(sectionCards).forEach(([sectionId, sectionItems]) => {
        const section = sectionAlignment[sectionId];
        if (!sectionItems.length || !section) return;
        const top = Math.min(...sectionItems.map((card) => card.bounds.y));
        const bottom = Math.max(...sectionItems.map((card) => card.bounds.y + card.bounds.height));
        Object.assign(section, { top, height: bottom - top, centerY: (top + bottom) / 2 });
      });
      chainGroups.forEach((group) => {
        const card = cards.find((candidate) => candidate.kind === "SECURITY_CHAIN" && candidate.rowId === `chain:${group.id}`);
        if (!card) return;
        group.left = card.bounds.x - NODE_SAFE_MARGIN;
        group.right = card.bounds.x + card.bounds.width + NODE_SAFE_MARGIN;
        group.top = card.bounds.y - 8;
        group.bottom = card.bounds.y + card.bounds.height + 8;
      });
      hiddenGroups.forEach((row) => {
        row.rowTop = Number.isFinite(row.rowTop) ? row.rowTop : TOP_PADDING;
        row.rowBottom = Number.isFinite(row.rowBottom) ? row.rowBottom : row.rowTop + row.rowHeight;
      });
      layoutTitleBounds = cards.length ? Object.entries(sectionCards).flatMap(([sectionId, sectionItems]) => {
        if (!sectionItems.length) return [];
        const laneId = sectionId === "security" ? "security-chain" : sectionId === "securityChecks" ? "security-checks"
          : sectionId === "endpoint" ? "endpoint" : sectionId === "handler" ? "handler" : "servlet-filter";
        const lane = lanes.find((candidate) => candidate.id === laneId);
        const left = Math.min(...sectionItems.map((card) => card.bounds.x)) - NODE_SAFE_MARGIN;
        const top = Math.min(...sectionItems.map((card) => card.bounds.y)) - 30;
        const right = Math.max(...sectionItems.map((card) => card.bounds.x + card.bounds.width)) + NODE_SAFE_MARGIN;
        return [labelBounds(left, top, right, lane ? lane.label : sectionId)];
      }) : [];
      findingSectionLayouts = sectionLayoutsFor(graph, positions, layoutTitleBounds);
      actualBottom = Math.max(TOP_PADDING + NODE_HEIGHT,
        ...cards.map((card) => card.bounds.y + card.bounds.height),
        ...hiddenGroups.map((row) => row.rowBottom || 0));
    }
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
    if (overviewCompositeState) {
      displayModel.composites = overviewCompositeState.cards;
      displayModel.cardById = overviewCompositeState.cardById;
      displayModel.itemById = overviewCompositeState.itemById;
      displayModel.originalNodeToItemIds = overviewCompositeState.originalNodeToItemIds;
      displayModel.originalNodeToCardIds = overviewCompositeState.originalNodeToCardIds;
      displayModel.itemToOriginalNodeIds = overviewCompositeState.itemToOriginalNodeIds;
      displayModel.itemToOriginalEdgeIds = overviewCompositeState.itemToOriginalEdgeIds;
      displayModel.rowToCardIds = overviewCompositeState.rowToCardIds;
      displayModel.nodeItemsByRow = Object.fromEntries(overviewCompositeState.nodeItemsByRow);
      displayModel.originalNodeToInstanceIds = originalNodeToInstanceIds;
      displayModel.instanceToOriginalNodeIds = instanceToOriginalNodeIds;
      displayModel.edgeToDisplay = {};
      displayModel.displayToEdges = {};
      const displayEdgesById = new Map();
      graph.edges.forEach((edge) => {
        const sourceId = nodeToDisplay[edge.sourceId] || edge.sourceId;
        const targetId = nodeToDisplay[edge.targetId] || edge.targetId;
        const id = `display-edge:${JSON.stringify([sourceId, targetId, edge.type])}`;
        displayModel.edgeToDisplay[edge.id] = id;
        (displayModel.displayToEdges[id] || (displayModel.displayToEdges[id] = [])).push(edge.id);
        if (sourceId !== targetId && !displayEdgesById.has(id)) displayEdgesById.set(id,
          { id, sourceId, targetId, type: edge.type });
      });
      displayModel.edges = Array.from(displayEdgesById.values());
    }
    const sectionDisplayBounds = (nodeIds) => {
      const instanceIds = Array.from(new Set(nodeIds.flatMap((nodeId) => originalNodeToInstanceIds[nodeId] || [])));
      const memberPositions = instanceIds.map((id) => displayInstances.find((instance) => instance.id === id)?.position)
        .filter(Boolean);
      if (!memberPositions.length) return null;
      const top = Math.min(...memberPositions.map((position) => position.y));
      const bottom = Math.max(...memberPositions.map((position) => position.y
        + (position.height || NODE_HEIGHT)));
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
    const portById = {};
    const itemById = displayModel.itemById || {};
    const createItemPort = (itemId, side, channel = "RELATION") => {
      const item = itemById[itemId];
      const card = item && displayModel.cardById[item.cardId];
      if (!item || !card || !item.bounds) return null;
      const id = `composite-port:${JSON.stringify([item.id, side])}`;
      if (!portById[id]) {
        const port = { id, cardId: card.id, itemId: item.id, rowId: card.rowId,
          side, role: side === "LEFT" ? "INPUT" : "OUTPUT", channel,
          x: side === "LEFT" ? card.bounds.x : card.bounds.x + card.bounds.width,
          y: item.bounds.y + item.bounds.height / 2 };
        portById[id] = port;
        (side === "LEFT" ? item.inputPortIds : item.outputPortIds).push(id);
        (side === "LEFT" ? card.inputPortIds : card.outputPortIds).push(id);
      }
      return portById[id];
    };
    const itemForNode = (nodeId, rowId, instance) => {
      const ids = displayModel.originalNodeToItemIds[nodeId] || [];
      return ids.map((id) => itemById[id]).find((item) => item.cardId === instance.id
        && (rowId === null || rowId === undefined || item.rowId === rowId)) || null;
    };
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
        const sourceItem = overviewCompositeState ? itemForNode(edge.sourceId, rowId, sourceInstance) : null;
        const targetItem = overviewCompositeState ? itemForNode(edge.targetId, rowId, targetInstance) : null;
        if (overviewCompositeState && (!sourceItem || !targetItem)) return;
        const key = JSON.stringify([rowId, sourceInstance.id, sourceItem && sourceItem.id,
          targetInstance.id, targetItem && targetItem.id, edge.type]);
        let bundle = displayBundles.get(key);
        if (bundle) {
          bundle.originalEdgeIds.push(edge.id);
          bundle.originalDirections.push({ edgeId: edge.id, sourceId: edge.sourceId, targetId: edge.targetId });
          bundle.evidenceIds = Array.from(new Set([...bundle.evidenceIds, ...(edge.evidenceIds || [])]));
          (originalEdgeToInstanceIds[edge.id] || (originalEdgeToInstanceIds[edge.id] = [])).push(bundle.id);
          return;
        }
        const id = `display-edge-instance:${key}`;
        bundle = { id, rowId, originalEdgeIds: [edge.id], sourceId: sourceInstance.id,
          targetId: targetInstance.id, sourceInstanceId: sourceInstance.id, targetInstanceId: targetInstance.id,
          sourceItemId: sourceItem && sourceItem.id || null, targetItemId: targetItem && targetItem.id || null,
          sourcePortId: null, targetPortId: null,
          selfConnection: sourceInstance.id === targetInstance.id,
          originalSourceId: edge.sourceId, originalTargetId: edge.targetId, type: edge.type,
          confidence: edge.confidence, evidenceIds: [...(edge.evidenceIds || [])],
          originalDirections: [{ edgeId: edge.id, sourceId: edge.sourceId, targetId: edge.targetId }] };
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
    displayModel.portById = portById;
    displayModel.originalEdgeToRelationIds = {};
    displayModel.originalEdgeToSegmentIds = {};
    const lanePlans = lanes.map((lane) => {
      if (overviewCompositeState) {
        const laneCards = overviewCompositeState.cards.filter((card) => card.laneId === lane.id);
        const cardBounds = laneCards.map((card) => card.bounds);
        const nodeIds = Array.from(new Set(laneCards.flatMap((card) => card.originalNodeIds)));
        const bounds = cardBounds.length ? {
          left: Math.min(...cardBounds.map((item) => item.x)) - 18,
          top: Math.min(...cardBounds.map((item) => item.y)) - 30,
          right: Math.max(...cardBounds.map((item) => item.x + item.width)) + 18,
          bottom: Math.max(...cardBounds.map((item) => item.y + item.height)) + 18
        } : null;
        return { ...lane, nodeIds, instanceIds: laneCards.map((card) => card.id), bounds, headerBounds: bounds
          ? labelBounds(bounds.left + 12, bounds.top + 2, bounds.right - 12, lane.label) : null };
      }
      const nodeIds = graph.nodes.filter((node) => laneForNode(node) === lane.id && positions[node.id])
        .map((node) => node.id);
      const memberPositions = nodeIds.map((id) => displayPosition(id));
      return { ...lane, nodeIds, bounds: memberPositions.length === 0 ? null : {
        left: Math.min(...memberPositions.map((position) => position.x)) - NODE_SAFE_MARGIN,
        top: Math.min(...memberPositions.map((position) => position.y)) - 42,
        right: Math.max(...memberPositions.map((position) => position.x + NODE_WIDTH)) + NODE_SAFE_MARGIN,
        bottom: Math.max(...memberPositions.map((position) => position.y + NODE_HEIGHT)) + 32
      } };
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
    const projection = { nodes: projectionNodes, edges: projectionEdges, aliases: projectionAliases };
    const projectionPositions = Object.fromEntries(projectionNodes.map((node) => [node.id, {
      ...node.position,
      width: node.width,
      height: node.height
    }]));
    const groupPositions = Object.fromEntries((detailPresentation || overviewCompositeState ? [] : controllerGroups.concat(groups))
      .filter((group) => group.position).map((group) => [group.id, group.position]));
    const compositePositions = overviewCompositeState
      ? Object.fromEntries(displayInstances.map((instance) => [instance.id, instance.position])) : {};
    const routePositions = overviewCompositeState
      ? { ...compositePositions, ...projectionPositions }
      : { ...Object.fromEntries(Object.entries(positions).filter(([id]) => !hiddenGroupMembers.has(id))),
        ...groupPositions, ...projectionPositions };
    const allPositions = overviewCompositeState
      ? { ...compositePositions, ...projectionPositions }
      : { ...positions, ...groupPositions, ...projectionPositions };
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
    let width = Math.max(
      NODE_PADDING * 2 + NODE_WIDTH,
      detailPresentation && detailBlueprint ? detailBlueprint.bounds.right + NODE_PADDING : 0,
      ...Object.values(allPositions).map((position) => position.x
        + (finite(position.width) && position.width > 0 ? position.width : NODE_WIDTH) + NODE_PADDING)
    );
    let height = Math.max(
      TOP_PADDING + NODE_HEIGHT,
      detailPresentation && detailBlueprint ? detailBlueprint.bounds.bottom + NODE_PADDING : 0,
      ...Object.values(allPositions).map((position) => position.y
        + (finite(position.height) && position.height > 0 ? position.height : NODE_HEIGHT) + NODE_PADDING),
      handlerY + NODE_PADDING
    );
    const edgeRoutes = {};
    const edgePairCounts = new Map();
    const edgeRouteIndexes = new Map();
    const routeObstacles = overviewCompositeState
      ? { ...compositePositions, ...projectionPositions } : { ...positions, ...projectionPositions };
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
    if (detailPresentation) {
      const detailModel = buildDetailCompositeModel(graph, detailBlueprint, positions, projectionNodes, projectionEdges,
        projectionAliases, flowIndex, effectiveServletFilterExecution);
      Object.assign(displayModel, detailModel.displayModel);
      projection.aliases = detailModel.displayModel.projectionToItemIds;
      overviewRouting = detailModel.routing;
      // 최종 표시 항목과 관계를 기준으로 카드별 Finding 영역 구성
      const findingCountByCard = new Map();
      findingSectionLayouts = (graph.findingSections || []).flatMap((section) => {
        const mapped = displayModel.findingToDisplay[section.finding.id] || {};
        const relationIds = new Set([...(mapped.relationIds || []),
          ...(section.edgeIds || []).flatMap((id) => displayModel.originalEdgeToRelationIds[id] || [])]);
        const relatedRelations = displayModel.displayRelations.filter((relation) => relationIds.has(relation.id));
        const itemIds = new Set([...(mapped.itemIds || []),
          ...(section.nodeIds || []).flatMap((id) => displayModel.originalNodeToItemIds[id] || []),
          ...relatedRelations.flatMap((relation) => [relation.sourceItemId, relation.targetItemId])]);
        const cards = new Map();
        itemIds.forEach((id) => {
          const item = displayModel.itemById[id];
          if (!item || !item.bounds || !displayModel.cardById[item.cardId]) return;
          const items = cards.get(item.cardId) || [];
          items.push(item);
          cards.set(item.cardId, items);
        });
        return Array.from(cards.entries(), ([cardId]) => {
          const card = displayModel.cardById[cardId];
          const left = card.bounds.x - 32;
          const titleWidth = Array.from(text(section.finding.title)).reduce((width, character) =>
            width + (character.codePointAt(0) > 255 ? 12 : 7), 64);
          const right = Math.max(card.bounds.right + 32, left + titleWidth + 24);
          const titleIndex = findingCountByCard.get(cardId) || 0;
          findingCountByCard.set(cardId, titleIndex + 1);
          const top = card.bounds.y - 48 - titleIndex * 24;
          const bottom = card.bounds.bottom + 28;
          return { findingId: section.finding.id, nodeIds: section.nodeIds || [],
            bounds: { left, top, right, bottom },
            titleBounds: { left: left + 12, top: top + 10, right: right - 12, bottom: top + 30 } };
        });
      });
      projectionNodes.forEach((node) => {
        Object.assign(projectionPositions[node.id], node.position, { width: node.width, height: node.height });
      });
      if (educationArea && projectionNodes.length) {
        const firstProjection = projectionNodes.slice().sort((left, right) =>
          left.position.y - right.position.y || left.position.x - right.position.x)[0];
        educationArea.left = Math.min(...projectionNodes.map((node) => node.bounds.left)) - NODE_SAFE_MARGIN;
        educationArea.top = Math.min(...projectionNodes.map((node) => node.bounds.top)) - EDUCATION_AREA_TOP_PADDING;
        educationArea.right = Math.max(...projectionNodes.map((node) => node.bounds.right)) + NODE_SAFE_MARGIN;
        educationArea.bottom = Math.max(...projectionNodes.map((node) => node.bounds.bottom)) + 32;
        educationArea.titleX = firstProjection.position.x + 12;
        educationArea.titleY = Math.min(...projectionNodes.map((node) => node.position.y))
          - EDUCATION_AREA_TOP_PADDING + 18;
      }
      width = Math.max(NODE_WIDTH + NODE_PADDING * 2, detailBlueprint?.bounds?.right || 0,
        ...displayModel.instances.map((instance) => instance.position.x + instance.width + NODE_PADDING),
        ...findingSectionLayouts.map((section) => section.bounds.right + NODE_PADDING));
      height = Math.max(NODE_HEIGHT + NODE_PADDING * 2, detailBlueprint?.bounds?.bottom || 0,
        ...displayModel.instances.map((instance) => instance.position.y + instance.height + NODE_PADDING),
        ...findingSectionLayouts.map((section) => section.bounds.bottom + NODE_PADDING));
    }
    if (!detailPresentation) {
      const relations = [];
      const edgeRoles = {};
      const uniqueIds = (values) => Array.from(new Set(values));
      const securityCheckTypes = new Set(["AUTHENTICATION", "AUTHORIZATION", "SECURITY_DATA", "BUSINESS_SECURITY_STATE"]);
      const findItem = (nodeId, cardId) => (displayModel.originalNodeToItemIds[nodeId] || [])
        .map((id) => itemById[id]).find((item) => item.cardId === cardId) || null;
      const endpointReferencesByHandlerAndRow = new Map();
      endpointHandlers.forEach((handler, endpointId) => {
        const endpointItem = (displayModel.originalNodeToItemIds[endpointId] || []).map((id) => itemById[id])
          .find((item) => item && item.rowId !== null && item.rowId !== undefined);
        // Handler 매핑 근거는 Chain 소속 상태와 독립적으로 같은 표시 행에 보존
        if (!endpointItem) return;
        const key = JSON.stringify([handler.id, endpointItem.rowId]);
        const endpoints = endpointReferencesByHandlerAndRow.get(key) || [];
        endpoints.push({ endpointId, item: endpointItem });
        endpointReferencesByHandlerAndRow.set(key, endpoints);
      });
      const addVisualRelation = ({ id, rowId, type, role, originalEdgeIds = [], originalDirections = [],
        sourceInstanceId, sourceItemId, targetInstanceId, targetItemId, visualDirection = "ORIGINAL",
        evidenceIds = [], relatedNodeIds = [], presentationKind = "ANALYSIS_REFERENCE", flowGroup = null,
        originalHandlerId = null, viaEndpointId = null, mappingEdgeIds = [] }) => {
        const sourcePosition = displayPositions[sourceInstanceId];
        const targetPosition = displayPositions[targetInstanceId];
        const reversed = sourcePosition && targetPosition && sourcePosition.x > targetPosition.x;
        const visualSourceInstanceId = reversed ? targetInstanceId : sourceInstanceId;
        const visualTargetInstanceId = reversed ? sourceInstanceId : targetInstanceId;
        const visualSourceItemId = reversed ? targetItemId : sourceItemId;
        const visualTargetItemId = reversed ? sourceItemId : targetItemId;
        const portChannel = JSON.stringify([rowId, role, type]);
        const output = createItemPort(visualSourceItemId, "RIGHT", portChannel);
        const input = createItemPort(visualTargetItemId, "LEFT", portChannel);
        if (!output || !input) {
          displayModel.relationRoles[id] = { role: "UNRESOLVED_PORT", originalEdgeIds: originalEdgeIds.slice() };
          return;
        }
        const relation = { id, rowId, type, role, sourceInstanceId: visualSourceInstanceId,
          targetInstanceId: visualTargetInstanceId, sourceItemId: visualSourceItemId, targetItemId: visualTargetItemId,
          visualSourcePortId: output.id, visualTargetPortId: input.id,
          originalSourceInstanceId: sourceInstanceId, originalTargetInstanceId: targetInstanceId,
          originalSourceItemId: sourceItemId, originalTargetItemId: targetItemId,
          visualDirection: reversed ? "REVERSED" : visualDirection,
          originalEdgeIds: uniqueIds(originalEdgeIds), originalDirections: originalDirections.slice(),
          evidenceIds: uniqueIds(evidenceIds), relatedNodeIds: uniqueIds(relatedNodeIds), presentationKind, flowGroup,
          originalHandlerId, viaEndpointId, mappingEdgeIds: uniqueIds(mappingEdgeIds) };
        relations.push(relation);
        relation.originalEdgeIds.forEach((edgeId) => {
          const ids = displayModel.originalEdgeToRelationIds[edgeId] || (displayModel.originalEdgeToRelationIds[edgeId] = []);
          if (!ids.includes(id)) ids.push(id);
        });
      };
      displayModel.relationRoles = {};
      displayModel.displayEdgeInstances.forEach((instance) => {
        const sourceCard = displayNodeById.get(instance.sourceInstanceId);
        const targetCard = displayNodeById.get(instance.targetInstanceId);
        const sourceItem = itemById[instance.sourceItemId];
        const targetItem = itemById[instance.targetItemId];
        const edgeIds = instance.originalEdgeIds;
        if (instance.type === "MATCHED_BY") {
          edgeIds.forEach((edgeId) => { edgeRoles[edgeId] = "ROW_MEMBERSHIP"; });
          displayModel.relationRoles[instance.id] = { role: "ROW_MEMBERSHIP", originalEdgeIds: edgeIds.slice() };
          return;
        }
        if (instance.type === "FILTERED_BY" && sourceCard?.rowId === targetCard?.rowId) {
          edgeIds.forEach((edgeId) => { edgeRoles[edgeId] = "REGISTERED_IN_CARD"; });
          displayModel.relationRoles[instance.id] = { role: "REGISTERED_IN_CARD", originalEdgeIds: edgeIds.slice() };
          return;
        }
        if (instance.selfConnection) {
          edgeIds.forEach((edgeId) => { edgeRoles[edgeId] = "INTERNAL_CARD_REFERENCE"; });
          displayModel.relationRoles[instance.id] = { role: "INTERNAL_CARD_REFERENCE", originalEdgeIds: edgeIds.slice() };
          return;
        }
        if (instance.type === "FILTERED_BY" || sourceItem?.isHeader || targetItem?.isHeader) {
          edgeIds.forEach((edgeId) => { edgeRoles[edgeId] = "INSPECTOR_REFERENCE"; });
          displayModel.relationRoles[instance.id] = { role: "INSPECTOR_REFERENCE", originalEdgeIds: edgeIds.slice() };
          return;
        }
        const endpointHandlerMapping = edgeIds.map((edgeId) => edgeById.get(edgeId)).filter((edge) => {
          if (!edge || edge.type !== "FLOWS_TO" || edge.confidence !== "CONFIRMED") return false;
          return nodeById.get(edge.sourceId)?.type === "ENDPOINT"
            && nodeById.get(edge.targetId)?.type === "HANDLER";
        });
        if (endpointHandlerMapping.length > 0) {
          const mappingRelationId = `api-mapping:${edgeIds.map((edgeId) => encodeURIComponent(edgeId)).join("|")}`;
          edgeIds.forEach((edgeId) => { edgeRoles[edgeId] = "API_MAPPING"; });
          addVisualRelation({ id: mappingRelationId, rowId: instance.rowId, type: instance.type, role: "API_MAPPING",
            originalEdgeIds: edgeIds, originalDirections: instance.originalDirections,
            sourceInstanceId: instance.sourceInstanceId, sourceItemId: instance.sourceItemId,
            targetInstanceId: instance.targetInstanceId, targetItemId: instance.targetItemId,
            evidenceIds: instance.evidenceIds, relatedNodeIds: endpointHandlerMapping.flatMap((edge) => [edge.sourceId, edge.targetId]),
            mappingEdgeIds: edgeIds, presentationKind: "CONFIRMED_API_MAPPING" });
          displayModel.relationRoles[instance.id] = { role: "API_MAPPING", originalEdgeIds: edgeIds.slice() };
          return;
        }
        if (SUPPORT_EDGE_TYPES.has(instance.type)) {
          const handlerSupportEdges = edgeIds.map((edgeId) => edgeById.get(edgeId)).filter((edge) => {
            if (!edge) return false;
            const source = nodeById.get(edge.sourceId);
            const target = nodeById.get(edge.targetId);
            return source?.type === "HANDLER" && securityCheckTypes.has(target?.type)
              || target?.type === "HANDLER" && securityCheckTypes.has(source?.type);
          });
          if (handlerSupportEdges.length) {
            edgeIds.forEach((edgeId) => { edgeRoles[edgeId] = "INSPECTOR_REFERENCE"; });
            handlerSupportEdges.forEach((edge) => {
              const source = nodeById.get(edge.sourceId);
              const target = nodeById.get(edge.targetId);
              const handler = source.type === "HANDLER" ? source : target;
              const supportNode = source.type === "HANDLER" ? target : source;
              const supportItem = (displayModel.originalNodeToItemIds[supportNode.id] || []).map((id) => itemById[id])
                .find((item) => item && item.rowId === instance.rowId);
              const endpoints = endpointReferencesByHandlerAndRow.get(JSON.stringify([handler.id, instance.rowId])) || [];
              if (!supportItem || !endpoints.length) return;
              const supportCard = displayModel.cardById[supportItem.cardId];
              endpoints.forEach(({ endpointId, item: endpointItem }) => {
                const endpointCard = displayModel.cardById[endpointItem.cardId];
                if (!supportCard || !endpointCard || supportCard.id === endpointCard.id) return;
                const mappingEdges = graph.edges.filter((candidate) => candidate.type === "FLOWS_TO"
                  && candidate.confidence === "CONFIRMED"
                  && ((candidate.sourceId === handler.id && candidate.targetId === endpointId)
                    || (candidate.targetId === handler.id && candidate.sourceId === endpointId)));
                addVisualRelation({ id: `endpoint-reference:${edge.id}:${endpointId}`, rowId: instance.rowId,
                  type: edge.type, role: "ANALYSIS_REFERENCE", sourceInstanceId: supportCard.id,
                  sourceItemId: supportItem.id, targetInstanceId: endpointCard.id, targetItemId: endpointItem.id,
                  originalEdgeIds: [edge.id],
                  originalDirections: [{ edgeId: edge.id, sourceId: edge.sourceId, targetId: edge.targetId }],
                  evidenceIds: [...(edge.evidenceIds || []), ...mappingEdges.flatMap((candidate) => candidate.evidenceIds || [])],
                  relatedNodeIds: [edge.sourceId, edge.targetId, handler.id, endpointId],
                  presentationKind: "VIA_ENDPOINT_REFERENCE", visualDirection: "CONCEPTUAL",
                  originalHandlerId: handler.id, viaEndpointId: endpointId,
                  mappingEdgeIds: mappingEdges.map((candidate) => candidate.id) });
                edgeRoles[edge.id] = "VIA_ENDPOINT_REFERENCE";
              });
            });
            displayModel.relationRoles[instance.id] = { role: edgeIds.some((edgeId) =>
              edgeRoles[edgeId] === "VIA_ENDPOINT_REFERENCE") ? "VIA_ENDPOINT_REFERENCE" : "INSPECTOR_REFERENCE",
            originalEdgeIds: edgeIds.slice() };
            return;
          }
        }
        if (!sourceCard || !targetCard || !sourceItem || !targetItem) {
          edgeIds.forEach((edgeId) => { edgeRoles[edgeId] = "UNRESOLVED_ITEM"; });
          displayModel.relationRoles[instance.id] = { role: "UNRESOLVED_ITEM", originalEdgeIds: edgeIds.slice() };
          return;
        }
        const role = instance.type === "FLOWS_TO" ? "STRUCTURAL_FLOW" : "ANALYSIS_REFERENCE";
        edgeIds.forEach((edgeId) => { edgeRoles[edgeId] = role; });
        addVisualRelation({ id: instance.id, rowId: instance.rowId, type: instance.type, role,
          originalEdgeIds: edgeIds, originalDirections: instance.originalDirections,
          sourceInstanceId: instance.sourceInstanceId, sourceItemId: instance.sourceItemId,
          targetInstanceId: instance.targetInstanceId, targetItemId: instance.targetItemId,
          evidenceIds: instance.evidenceIds, presentationKind: role });
      });
      // 확인된 Filter 등록과 FilterChainProxy 소속 관계에 근거한 Chain 선택 진입
      const runtimeRelations = Array.isArray(runtimeArchitecture?.relationships) ? runtimeArchitecture.relationships : [];
      registrations.forEach((registration) => {
        const name = text(attributes(registration).registrationName);
        if (name !== "springSecurityFilterChain" || !/DelegatingFilterProxy/.test(text(registration.className))) return;
        const proxies = overviewRuntimeComponents.filter((component) => component.kind === "FILTER_CHAIN_PROXY"
          && component.contextId === registration.contextId
          && (component.beanName === name || text(component.beanName).endsWith(`:${name}`)));
        if (proxies.length !== 1 || (registration.graphNodeIds || []).length !== 1) return;
        const sourceId = registration.graphNodeIds[0];
        const sourceItem = (displayModel.originalNodeToItemIds[sourceId] || []).map((id) => itemById[id])
          .find((item) => item && displayModel.cardById[item.cardId]?.kind === "SERVLET_FILTERS");
        if (!sourceItem) return;
        runtimeRelations.filter((relation) => relation.kind === "CONTAINS" && relation.confidence === "CONFIRMED"
          && relation.sourceId === proxies[0].id).forEach((relation) => {
          const chain = overviewRuntimeComponents.find((component) => component.id === relation.targetId
            && component.kind === "SECURITY_FILTER_CHAIN" && component.contextId === registration.contextId);
          if (!chain || (chain.graphNodeIds || []).length !== 1) return;
          const chainId = chain.graphNodeIds[0];
          const targetItem = (displayModel.originalNodeToItemIds[chainId] || []).map((id) => itemById[id])
            .find((item) => item?.isHeader && displayModel.cardById[item.cardId]?.kind === "SECURITY_CHAIN");
          if (!targetItem) return;
          addVisualRelation({ id: `runtime-delegation:${registration.id}:${relation.id}`, rowId: null,
            type: "SECURITY_DELEGATION", role: "STRUCTURAL_FLOW", sourceInstanceId: sourceItem.cardId,
            sourceItemId: sourceItem.id, targetInstanceId: targetItem.cardId, targetItemId: targetItem.id,
            evidenceIds: [...(registration.evidenceIds || []), ...(proxies[0].evidenceIds || []), ...(relation.evidenceIds || [])],
            relatedNodeIds: [sourceId, chainId], presentationKind: "SECURITY_CHAIN_SELECTION" });
        });
      });
      projectionEdges.filter((edge) => edge.projectionKind === "security-check-overview").forEach((edge) => {
        const rowId = `chain:${edge.flowGroup}`;
        const targetNodeIds = edge.relatedNodeIds || [];
        const sourceNodeId = edge.originalSourceNodeId || edge.sourceId;
        const sourceItem = itemById[displayModel.nodeItemsByRow[JSON.stringify([rowId, sourceNodeId])]]
          || (displayModel.originalNodeToItemIds[sourceNodeId] || []).map((id) => itemById[id])
            .find((item) => item && item.rowId === rowId);
        const targetItem = targetNodeIds.flatMap((nodeId) => displayModel.originalNodeToItemIds[nodeId] || [])
          .map((id) => itemById[id]).find((item) => item && item.rowId === rowId);
        if (!sourceItem || !targetItem) return;
        const sourceCard = displayModel.cardById[sourceItem.cardId];
        const targetCard = displayModel.cardById[targetItem.cardId];
        if (!sourceCard || !targetCard || sourceCard.id === targetCard.id) return;
        const chainId = edge.flowGroup;
        const relationEdges = graph.edges.filter((candidate) => candidate.confidence === "CONFIRMED"
          && SUPPORT_EDGE_TYPES.has(candidate.type)
          && ((candidate.sourceId === chainId && targetNodeIds.includes(candidate.targetId))
            || (candidate.targetId === chainId && targetNodeIds.includes(candidate.sourceId))));
        const edgeTypes = uniqueIds(relationEdges.map((candidate) => candidate.type));
        const type = edgeTypes.length === 1 ? edgeTypes[0] : "SECURITY_CHECK_REFERENCE";
        const originalDirections = relationEdges.map((candidate) => ({ edgeId: candidate.id,
          sourceId: candidate.sourceId, targetId: candidate.targetId }));
        const originalEdgeIds = relationEdges.map((candidate) => candidate.id);
        addVisualRelation({ id: `overview-security-reference:${chainId}:${sourceItem.id}:${targetItem.id}`,
          rowId, type, role: "ANALYSIS_REFERENCE", sourceInstanceId: sourceCard.id, sourceItemId: sourceItem.id,
          targetInstanceId: targetCard.id, targetItemId: targetItem.id, originalEdgeIds, originalDirections,
          evidenceIds: relationEdges.flatMap((candidate) => candidate.evidenceIds || []),
          relatedNodeIds: targetNodeIds, presentationKind: "CONCEPTUAL_REFERENCE", flowGroup: chainId,
          visualDirection: "CONCEPTUAL" });
        relationEdges.forEach((candidate) => { edgeRoles[candidate.id] = "CONCEPTUAL_CHAIN_POLICY"; });
      });
      displayModel.edgeRoles = edgeRoles;
      const portsByItemSide = new Map();
      Object.values(portById).forEach((port) => {
        const key = JSON.stringify([port.itemId, port.side]);
        const bucket = portsByItemSide.get(key) || [];
        bucket.push(port);
        portsByItemSide.set(key, bucket);
      });
      portsByItemSide.forEach((itemPorts) => {
        const item = itemById[itemPorts[0].itemId];
        if (!item || !item.bounds) return;
        itemPorts.sort((left, right) => left.channel.localeCompare(right.channel));
        const spacing = itemPorts.length > 1
          ? Math.min(8, Math.max(0, item.bounds.height - 8) / (itemPorts.length - 1)) : 0;
        itemPorts.forEach((port, index) => {
          port.y = item.bounds.y + item.bounds.height / 2 + (index - (itemPorts.length - 1) / 2) * spacing;
        });
      });
      displayModel.ports = Object.values(portById);
      Object.values(displayModel.itemById).forEach((item) => {
        item.inputPortIds.sort();
        item.outputPortIds.sort();
      });
      displayModel.composites.forEach((card) => {
        card.inputPortIds = uniqueIds(card.inputPortIds).sort();
        card.outputPortIds = uniqueIds(card.outputPortIds).sort();
        card.layout.portIds = card.items.flatMap((item) => [...item.inputPortIds, ...item.outputPortIds]);
      });
      overviewRouting = routeOverview(displayModel.instances, relations, hiddenGroups, null, 0, displayModel.ports);
      overviewRouting.relations = relations;
      const segmentIdsByRelation = new Map();
      overviewRouting.segments.forEach((segment) => segment.relationIds.forEach((relationId) => {
        const ids = segmentIdsByRelation.get(relationId) || [];
        ids.push(segment.id);
        segmentIdsByRelation.set(relationId, ids);
      }));
      relations.forEach((relation) => relation.originalEdgeIds.forEach((edgeId) => {
        const segmentIds = segmentIdsByRelation.get(relation.id) || [];
        const ids = displayModel.originalEdgeToSegmentIds[edgeId] || (displayModel.originalEdgeToSegmentIds[edgeId] = []);
        segmentIds.forEach((segmentId) => { if (!ids.includes(segmentId)) ids.push(segmentId); });
      }));
      displayModel.findingToDisplay = Object.fromEntries((graph.findings || []).map((finding) => [finding.id, {
        itemIds: uniqueIds((finding.nodeIds || []).flatMap((id) => displayModel.originalNodeToItemIds[id] || [])),
        relationIds: uniqueIds((finding.edgeIds || []).flatMap((id) => displayModel.originalEdgeToRelationIds[id] || [])),
        segmentIds: uniqueIds((finding.edgeIds || []).flatMap((id) => displayModel.originalEdgeToSegmentIds[id] || []))
      }]));
    }
    return {
      positions,
      edgeRoutes,
      width,
      height,
      plan: {
        mode: "request-flow-lanes",
        lanes: lanePlans,
        sectionGap: detailPresentation ? SECTION_GAP : OVERVIEW_SECTION_GAP,
        majorSectionGap: detailPresentation ? MAJOR_SECTION_GAP : OVERVIEW_MAJOR_SECTION_GAP,
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
        detailBlueprint,
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
