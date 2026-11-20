(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const NODE_WIDTH = 260;
  const NODE_HEIGHT = 96;
  const NODE_GAP_X = 330;
  const NODE_GAP_Y = 132;
  const NODE_PADDING = 48;
  const NODE_TYPES = Object.freeze([
    "APPLICATION", "SERVLET", "ENDPOINT", "HANDLER", "SECURITY_CHAIN",
    "FILTER", "AUTHENTICATION", "AUTHORIZATION", "SECURITY_DATA", "BUSINESS_SECURITY_STATE"
  ]);
  const EDGE_TYPES = Object.freeze([
    "FLOWS_TO", "MATCHED_BY", "FILTERED_BY", "SECURED_BY", "READS_SECURITY_DATA",
    "WRITES_SECURITY_DATA", "CONVERTS_TO_AUTHORITY", "USES_FOR_AUTHORIZATION", "SECURITY_STATE"
  ]);
  const nodeTypeNames = {
    APPLICATION: "애플리케이션",
    SERVLET: "서블릿",
    ENDPOINT: "API",
    HANDLER: "핸들러",
    SECURITY_CHAIN: "보안 체인",
    FILTER: "필터",
    AUTHENTICATION: "인증",
    AUTHORIZATION: "인가",
    SECURITY_DATA: "보안 정보",
    BUSINESS_SECURITY_STATE: "업무 보안 상태"
  };
  const edgeTypeNames = {
    FLOWS_TO: "흐름",
    MATCHED_BY: "적용 체인",
    FILTERED_BY: "적용 필터",
    SECURED_BY: "보호 근거",
    READS_SECURITY_DATA: "보안정보 읽기",
    WRITES_SECURITY_DATA: "보안정보 기록",
    CONVERTS_TO_AUTHORITY: "권한 변환",
    USES_FOR_AUTHORIZATION: "인가 사용",
    SECURITY_STATE: "보안 상태"
  };
  const nodeStyles = {
    APPLICATION: "#4ade80",
    SERVLET: "#67e8f9",
    ENDPOINT: "#93c5fd",
    HANDLER: "#c4b5fd",
    SECURITY_CHAIN: "#fbbf24",
    FILTER: "#fb923c",
    AUTHENTICATION: "#f9a8d4",
    AUTHORIZATION: "#fda4af",
    SECURITY_DATA: "#a7f3d0",
    BUSINESS_SECURITY_STATE: "#bef264"
  };
  const edgeStyles = {
    FLOWS_TO: { color: "#7dd3fc", dash: "none" },
    MATCHED_BY: { color: "#c4b5fd", dash: "6 4" },
    FILTERED_BY: { color: "#fbbf24", dash: "2 4" },
    SECURED_BY: { color: "#fb7185", dash: "8 3 2 3" },
    READS_SECURITY_DATA: { color: "#60a5fa", dash: "3 3" },
    WRITES_SECURITY_DATA: { color: "#a78bfa", dash: "1 3" },
    CONVERTS_TO_AUTHORITY: { color: "#f0abfc", dash: "10 2" },
    USES_FOR_AUTHORIZATION: { color: "#f59e0b", dash: "5 2" },
    SECURITY_STATE: { color: "#86efac", dash: "12 3" }
  };
  const detailKeys = {
    APPLICATION: ["applicationVersion", "applicationClass"],
    SERVLET: ["servletClass", "registrationKind"],
    ENDPOINT: ["handler"],
    HANDLER: ["handler"],
    SECURITY_CHAIN: ["chainKey", "matcherCondition", "chainOrder"],
    FILTER: ["registrationKind", "filterClass", "filterOrder"],
    AUTHENTICATION: ["authenticationKind", "provider"],
    AUTHORIZATION: ["factType", "authorizationKind", "pathOutcome", "coverage"],
    SECURITY_DATA: ["dataType", "securityKind", "usage"],
    BUSINESS_SECURITY_STATE: ["stateAction", "stateKind", "pathOutcome", "coverage"]
  };
  const detailKeyNames = {
    applicationVersion: "버전",
    applicationClass: "애플리케이션",
    servletClass: "클래스",
    registrationKind: "등록",
    chainKey: "체인",
    matcherCondition: "조건",
    chainOrder: "순서",
    filterClass: "클래스",
    filterOrder: "순서",
    authenticationKind: "인증 방식",
    provider: "제공자",
    factType: "근거 유형",
    authorizationKind: "인가 유형",
    pathOutcome: "판정",
    coverage: "대상 범위",
    dataType: "데이터",
    securityKind: "보안 종류",
    usage: "사용",
    stateAction: "상태 동작",
    stateKind: "상태 유형"
  };

  function stringValue(value, fallback) {
    return value === null || value === undefined || value === "" ? fallback : String(value);
  }

  function copyAttributes(attributes) {
    if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return {};
    return Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, stringValue(value, "")]));
  }

  function copyEvidenceIds(evidenceIds) {
    return Array.isArray(evidenceIds) ? evidenceIds.map((id) => String(id)) : [];
  }

  function normalize(snapshot) {
    const nodes = [];
    const nodeIds = new Set();
    let invalidNodes = 0;
    const rawNodes = snapshot && Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
    rawNodes.forEach((node) => {
      if (!node || typeof node.id !== "string" || !node.id || !NODE_TYPES.includes(node.type) || nodeIds.has(node.id)) {
        invalidNodes += 1;
        return;
      }
      nodeIds.add(node.id);
      nodes.push({
        id: node.id,
        type: node.type,
        serviceId: stringValue(node.serviceId, ""),
        label: stringValue(node.label, "이름 미확인"),
        attributes: copyAttributes(node.attributes),
        evidenceIds: copyEvidenceIds(node.evidenceIds)
      });
    });

    const edges = [];
    const edgeIds = new Set();
    let invalidEdges = 0;
    const rawEdges = snapshot && Array.isArray(snapshot.edges) ? snapshot.edges : [];
    rawEdges.forEach((edge) => {
      if (!edge || typeof edge.id !== "string" || !edge.id || edgeIds.has(edge.id)
        || !EDGE_TYPES.includes(edge.type) || !nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) {
        invalidEdges += 1;
        return;
      }
      edgeIds.add(edge.id);
      edges.push({
        id: edge.id,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        type: edge.type,
        attributes: copyAttributes(edge.attributes),
        confidence: stringValue(edge.confidence, "UNKNOWN"),
        evidenceIds: copyEvidenceIds(edge.evidenceIds)
      });
    });
    return { nodes, edges, invalidNodes, invalidEdges };
  }

  function filterGraph(graph, filters = {}) {
    const query = stringValue(filters.query, "").trim().toLowerCase();
    const nodeType = stringValue(filters.nodeType, "");
    const edgeType = stringValue(filters.edgeType, "");
    const nodes = graph.nodes.filter((node) => {
      if (nodeType && node.type !== nodeType) return false;
      if (!query) return true;
      if (node.type !== "ENDPOINT") return false;
      const attributes = node.attributes || {};
      return [node.label, attributes.httpMethod, attributes.path, attributes.handler]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = graph.edges.filter((edge) => {
      if (edgeType && edge.type !== edgeType) return false;
      return nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId);
    });
    return {
      ...graph,
      nodes,
      edges,
      filters: { query, nodeType, edgeType },
      hiddenNodes: graph.nodes.length - nodes.length,
      hiddenEdges: graph.edges.length - edges.length
    };
  }

  // 보존 Graph에 존재하는 참조와 유실된 참조를 분리
  function indexFindings(snapshot, graph) {
    const findings = snapshot && Array.isArray(snapshot.findings) ? snapshot.findings : [];
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    const edgeIds = new Set(graph.edges.map((edge) => edge.id));
    return findings.filter((finding) => finding && typeof finding === "object").map((finding) => {
      const nodes = Array.isArray(finding.nodeIds) ? finding.nodeIds : [];
      const edges = Array.isArray(finding.edgeIds) ? finding.edgeIds : [];
      const existingNodes = [...new Set(nodes.filter((id) => nodeIds.has(id)))];
      const existingEdges = [...new Set(edges.filter((id) => edgeIds.has(id)))];
      return {
        finding,
        nodeIds: existingNodes,
        edgeIds: existingEdges,
        missing: nodes.some((id) => !nodeIds.has(id)) || edges.some((id) => !edgeIds.has(id)),
        unlocated: existingNodes.length === 0 && existingEdges.length === 0
      };
    });
  }

  function shorten(value, limit) {
    const text = stringValue(value, "");
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 1))}…`;
  }

  function simpleClassName(value) {
    const text = stringValue(value, "").trim().replace(/^L|;$/g, "").replace(/\//g, ".");
    if (!text) return "";
    const lastDot = text.lastIndexOf(".");
    return text.slice(lastDot + 1);
  }

  function friendlyClassName(value) {
    return simpleClassName(value)
      .replace(/\$\d+$/, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();
  }

  function shortTypeNames(value) {
    return stringValue(value, "")
      .replace(/\b(?:[a-zA-Z_$][\w$]*\.)+([A-Z_$][\w$]*)/g, "$1")
      .replace(/L([\w/$]+);/g, (_match, name) => simpleClassName(name));
  }

  function handlerDisplay(value) {
    const text = stringValue(value, "").trim();
    if (!text) return "";
    const hashIndex = text.indexOf("#");
    if (hashIndex < 0) return simpleClassName(text);
    const owner = simpleClassName(text.slice(0, hashIndex));
    const methodText = shortTypeNames(text.slice(hashIndex + 1));
    const methodName = methodText.split("(", 1)[0].trim();
    const method = `${methodName}()`;
    return `${owner}#${method}`;
  }

  function handlerParts(value) {
    const display = handlerDisplay(value);
    const hashIndex = display.indexOf("#");
    return hashIndex < 0
      ? { primary: display, detail: "" }
      : { primary: display.slice(0, hashIndex), detail: display.slice(hashIndex + 1) };
  }

  function matcherDisplay(value) {
    const text = stringValue(value, "");
    if (text.startsWith("NOT(") && text.endsWith(")")) return `제외 · ${text.slice(4, -1)}`;
    if (text.startsWith("OR(") && text.endsWith(")")) return `조건 · ${text.slice(3, -1)}`;
    return text;
  }

  function policyDisplay(value) {
    return {
      PERMIT_ALL: "모두 허용",
      AUTHENTICATED: "인증 필요",
      AUTHORITY_REQUIRED: "권한 필요"
    }[value] || stringValue(value, "인가 조건 확인 필요");
  }

  function attributeDetails(attributes, keys) {
    return keys
      .filter((key) => attributes[key])
      .map((key) => {
        let value = attributes[key];
        if (["handler", "filterClass", "applicationClass", "servletClass", "matcherClass", "provider"].includes(key)) {
          value = key === "handler" ? handlerDisplay(value) : simpleClassName(value);
        }
        if (key === "matcherCondition") value = matcherDisplay(value);
        if (key === "registrationKind") value = value === "SECURITY" ? "보안" : value === "SERVLET" ? "서블릿" : value;
        return `${detailKeyNames[key] || key} ${value}`;
      })
      .slice(0, 2);
  }

  function securityDataDisplay(attributes, fallback) {
    const operation = stringValue(attributes.operation, "");
    const apiType = stringValue(attributes.apiType, "");
    const sourceKind = stringValue(attributes.sourceKind, "");
    const mappingKind = stringValue(attributes.mappingKind, "");
    if (operation === "VERIFY_CONFIGURATION" || attributes.verificationKind === "CONFIGURATION") {
      return { primary: "JWT 검증 구성", detail: stringValue(attributes.apiName, "검증 설정 확인 필요") };
    }
    if (mappingKind === "GRANTED_AUTHORITY_CREATION" || apiType === "AUTHORITY") {
      return { primary: "권한 매핑", detail: stringValue(attributes.apiName, "권한 생성") };
    }
    if (sourceKind === "JWT" || apiType === "SPRING_SECURITY_JWT") {
      return { primary: "JWT 정보 읽기", detail: attributes.claimName ? `Claim ${attributes.claimName}` : stringValue(attributes.apiName, "읽기") };
    }
    if (apiType === "PRINCIPAL" || attributes.principalType) {
      return {
        primary: operation === "DECLARE" ? "Principal 선언" : "Principal 조회",
        detail: friendlyClassName(attributes.principalType) || stringValue(attributes.apiName, "Principal")
      };
    }
    return {
      primary: fallback || "보안 정보 확인 불가",
      detail: stringValue(attributes.apiName, "속성 확인 필요")
    };
  }

  function nodeDisplayRaw(node, displayOptions = {}) {
    const attributes = node.attributes || {};
    if (node.type === "ENDPOINT") {
      const endpoint = [attributes.httpMethod, attributes.path].filter(Boolean).join(" ");
      return {
        primary: endpoint || node.label,
        detail: handlerDisplay(attributes.handler) || "핸들러 확인 불가"
      };
    }
    if (node.type === "HANDLER") {
      const parts = handlerParts(attributes.handler || node.label);
      return { primary: parts.detail || "메서드 확인 불가", detail: parts.primary || "핸들러 확인 불가" };
    }
    if (node.type === "FILTER") {
      const registration = attributes.registrationKind === "SECURITY" ? "보안" : attributes.registrationKind === "SERVLET" ? "서블릿" : "등록 확인 필요";
      const orderInfo = displayOptions.filterOrderInfo && displayOptions.filterOrderInfo[node.id];
      const order = orderInfo && orderInfo.status === "REFERENCE"
        ? "참고 순서"
        : orderInfo && orderInfo.status === "CONFIRMED" && orderInfo.order !== null
          ? `순서 ${orderInfo.order}`
          : orderInfo && orderInfo.status === "MISMATCHED"
            ? "순서 불일치 · 확인 불가"
            : attributes.filterOrder
              ? `순서 ${attributes.filterOrder}`
              : "순서 확인 불가";
      return {
        primary: friendlyClassName(attributes.filterClass || node.label) || "필터 이름 확인 불가",
        detail: `${registration} · ${order}`
      };
    }
    if (node.type === "SECURITY_CHAIN") {
      const chainName = stringValue(attributes.proxyBeanName, "");
      const matcher = matcherDisplay(attributes.matcherCondition);
      return {
        primary: matcher || chainName || "보안 체인",
        detail: [chainName && chainName !== matcher ? chainName : "", attributes.chainOrder ? `순서 ${attributes.chainOrder}` : ""]
          .filter(Boolean).join(" · ") || "조건 확인 불가"
      };
    }
    if (node.type === "SERVLET") {
      return {
        primary: attributes.servletName || simpleClassName(attributes.servletClass) || node.label.replace(/^servlet\|/, ""),
        detail: [attributes.servletKind, attributes.urlPattern].filter(Boolean).join(" · ") || "서블릿 진입점"
      };
    }
    if (node.type === "APPLICATION") {
      const version = attributes.applicationVersion ? `버전 ${attributes.applicationVersion}` : "";
      const serviceId = node.serviceId ? `서비스 ID ${node.serviceId}` : "";
      return {
        primary: simpleClassName(attributes.applicationName || attributes.applicationClass || node.label) || "애플리케이션",
        detail: [version, serviceId].filter(Boolean).join(" · ") || "애플리케이션 진입"
      };
    }
    if (node.type === "AUTHORIZATION") {
      if (attributes.factType === "OBJECT_AUTHORIZATION_REQUIREMENT" || attributes.factType === "OBJECT_ACCESS_PATH") {
        return {
          primary: attributes.factType === "OBJECT_AUTHORIZATION_REQUIREMENT" ? "객체 인가 요구" : "객체 접근 경로",
          detail: handlerDisplay(attributes.handler) || "핸들러 확인 불가"
        };
      }
      return {
        primary: policyDisplay(attributes.policyKind),
        detail: [attributes.requiredAuthority, attributes.policyMatcherCondition].filter(Boolean).join(" · ") || "인가 조건 확인 필요"
      };
    }
    if (node.type === "AUTHENTICATION") {
      return {
        primary: attributes.authenticationKind || node.label,
        detail: attributes.provider ? simpleClassName(attributes.provider) : "인증 공급자 확인 필요"
      };
    }
    if (node.type === "SECURITY_DATA") {
      const dataKindNames = {
        JWT: "JWT",
        JWT_CLAIM: "JWT Claim",
        SESSION_STATE: "Session 상태",
        HEADER: "Header",
        PRINCIPAL: "Principal",
        AUTHORITY: "권한"
      };
      const dataKind = stringValue(attributes.dataKind, "");
      if (dataKindNames[dataKind]) {
        const detailValue = dataKind === "JWT_CLAIM" ? attributes.claimName
          : dataKind === "PRINCIPAL" ? friendlyClassName(attributes.principalType)
            : dataKind === "HEADER" ? attributes.headerName
              : attributes.apiName;
        const operationNames = { READ: "조회", CREATE: "생성", VERIFY_CONFIGURATION: "검증 구성", DECLARE: "선언" };
        const detail = [detailValue, operationNames[attributes.operation]].filter(Boolean).join(" · ");
        return { primary: dataKindNames[dataKind], detail };
      }
      return securityDataDisplay(attributes, attributes.dataType || attributes.securityKind || "보안 정보");
    }
    if (node.type === "BUSINESS_SECURITY_STATE") {
      const kind = attributes.factType === "BUSINESS_STATE_EVALUATION" ? "업무 상태 검증"
        : attributes.factType === "BUSINESS_STATE_REQUIREMENT" || attributes.stateAction === "REQUIRES" ? "업무 상태 요구"
          : attributes.stateAction === "PRODUCES" ? "업무 상태 생성" : "업무 보안 상태";
      return {
        primary: [kind, attributes.stateName].filter(Boolean).join(" · "),
        detail: attributes.pathOutcome === "BYPASS_PATH" ? "검증 경로 우회"
          : handlerDisplay(attributes.handler) || "상태 정보 확인"
      };
    }
    const keys = detailKeys[node.type] || [];
    return {
      primary: simpleClassName(node.label) || node.label,
      detail: attributeDetails(attributes, keys).join(" · ") || "속성 확인 필요"
    };
  }

  function nodeDisplay(node, displayOptions = {}) {
    const display = nodeDisplayRaw(node, displayOptions);
    const safe = (value, fallback) => {
      const text = String(value || "").trim();
      if (!text || text === node.id || text.includes("|") || /L[^;\s]*\/[\w/$]+;/.test(text)) return fallback;
      return shorten(text, 96);
    };
    return { primary: safe(display.primary, "이름 확인 불가"), detail: safe(display.detail, "상세 정보 확인 불가") };
  }

  function createElement(name) {
    return document.createElementNS(SVG_NS, name);
  }

  function addText(parent, className, x, y, value) {
    const text = createElement("text");
    text.setAttribute("class", className);
    text.setAttribute("x", String(x));
    text.setAttribute("y", String(y));
    text.textContent = value;
    parent.appendChild(text);
    return text;
  }

  function semanticLines(value, maxLength = 28) {
    const source = stringValue(value, "").trim();
    if (!source) return ["확인할 수 없음"];
    const words = source.split(/\s+/).flatMap((word) => {
      if (!word.startsWith("/") || word.length <= maxLength) return [word];
      const segments = word.split("/").filter(Boolean);
      const parts = [];
      let current = "/";
      segments.forEach((segment) => {
        const candidate = `${current}${segment}/`;
        if (current !== "/" && candidate.length > maxLength) {
          parts.push(current.endsWith("/") ? current.slice(0, -1) : current);
          current = `/${segment}/`;
        } else {
          current = candidate;
        }
      });
      if (current !== "/") parts.push(current.endsWith("/") ? current.slice(0, -1) : current);
      return parts;
    });
    const lines = [];
    let current = "";
    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (current && candidate.length > maxLength) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    });
    if (current) lines.push(current);
    if (lines.length <= 2) return lines;
    return [lines[0], shorten(lines.slice(1).join(" "), maxLength)];
  }

  function fitText(textElement, value, maxWidth, fallbackLimit) {
    const source = stringValue(value, "");
    textElement.textContent = source;
    if (typeof textElement.getComputedTextLength !== "function") {
      textElement.textContent = shorten(source, fallbackLimit);
      return textElement;
    }
    let candidate = source;
    while (candidate.length > 1 && textElement.getComputedTextLength() > maxWidth) {
      candidate = `${candidate.slice(0, -2)}…`;
      textElement.textContent = candidate;
    }
    return textElement;
  }

  function addNodeText(parent, className, x, y, value, maxWidth, fallbackLimit) {
    const textElement = createElement("text");
    textElement.setAttribute("class", className);
    textElement.setAttribute("x", String(x));
    textElement.setAttribute("y", String(y));
    parent.appendChild(textElement);
    fitText(textElement, value, maxWidth, fallbackLimit);
    return textElement;
  }

  function controllerGroupDisplay(group) {
    const methodCount = Array.isArray(group.handlerMethods) ? group.handlerMethods.length : 0;
    const endpointCount = Array.isArray(group.endpointIds) ? group.endpointIds.length : 0;
    return {
      primary: group.controllerName || group.controllerFqcn,
      detail: `API ${endpointCount}개 · 메서드 ${methodCount}개`
    };
  }

  function positionsFor(nodes, supplied) {
    const positions = {};
    nodes.forEach((node, index) => {
      const candidate = supplied && supplied[node.id];
      positions[node.id] = candidate && Number.isFinite(candidate.x) && Number.isFinite(candidate.y)
        ? { x: candidate.x, y: candidate.y }
        : {
          x: NODE_PADDING + (index % 3) * NODE_GAP_X,
          y: NODE_PADDING + Math.floor(index / 3) * NODE_GAP_Y
        };
    });
    return positions;
  }

  function graphSize(positions, bounds) {
    const values = Object.values(positions);
    const width = values.length === 0
      ? 640
      : Math.max(640, ...values.map((position) => position.x + NODE_WIDTH + NODE_PADDING));
    const height = values.length === 0
      ? 360
      : Math.max(360, ...values.map((position) => position.y + NODE_HEIGHT + NODE_PADDING));
    return {
      width: bounds && Number.isFinite(bounds.width) ? Math.max(width, bounds.width) : width,
      height: bounds && Number.isFinite(bounds.height) ? Math.max(height, bounds.height) : height
    };
  }

  function port(position, right, yOffset) {
    return {
      x: position.x + (right ? NODE_WIDTH : 0),
      y: position.y + NODE_HEIGHT / 2 + yOffset
    };
  }

  function edgePath(source, target, parallelIndex) {
    const forward = source.x <= target.x;
    const offset = (parallelIndex || 0) * 10;
    const start = port(source, forward, offset);
    const end = port(target, !forward, -offset);
    const distance = Math.max(48, Math.abs(end.x - start.x) * 0.45);
    const controlStart = { x: start.x + (forward ? distance : -distance), y: start.y };
    const controlEnd = { x: end.x - (forward ? distance : -distance), y: end.y };
    return `M ${start.x} ${start.y} C ${controlStart.x} ${controlStart.y}, ${controlEnd.x} ${controlEnd.y}, ${end.x} ${end.y}`;
  }

  function routedPath(route, fallback) {
    const points = [];
    const sections = route && Array.isArray(route.sections) ? route.sections : [];
    sections.forEach((section, index) => {
      const start = section.startPoint;
      const end = section.endPoint;
      if (index === 0 && start && Number.isFinite(start.x) && Number.isFinite(start.y)) points.push(start);
      (section.bendPoints || []).forEach((point) => {
        if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) points.push(point);
      });
      if (end && Number.isFinite(end.x) && Number.isFinite(end.y)) points.push(end);
    });
    return points.length > 1
      ? points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")
      : fallback;
  }

  function edgeLabelPosition(source, target, parallelIndex, route) {
    const sections = route && Array.isArray(route.sections) ? route.sections : [];
    const points = [];
    sections.forEach((section, index) => {
      if (index === 0 && section.startPoint
        && Number.isFinite(section.startPoint.x) && Number.isFinite(section.startPoint.y)) {
        points.push(section.startPoint);
      }
      (section.bendPoints || []).forEach((point) => {
        if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) points.push(point);
      });
      if (section.endPoint
        && Number.isFinite(section.endPoint.x) && Number.isFinite(section.endPoint.y)) {
        points.push(section.endPoint);
      }
    });
    if (points.length > 1) {
      const middle = points[Math.floor((points.length - 1) / 2)];
      return { x: middle.x, y: middle.y - 8 - (parallelIndex || 0) * 8 };
    }
    return {
      x: (source.x + target.x + NODE_WIDTH) / 2,
      y: (source.y + target.y + NODE_HEIGHT) / 2 - 8 - (parallelIndex || 0) * 8
    };
  }

  function shouldShowEdgeLabel(edge, options, relatedEdgeIds) {
    if (options.displayEdgeLabels === false) return false;
    if (options.hoverEdgeId === edge.id) return true;
    if (options.selection && options.selection.kind === "edge" && options.selection.id === edge.id) return true;
    return false;
  }

  function boxesOverlap(left, right) {
    return left.x < right.x + right.width && left.x + left.width > right.x
      && left.y < right.y + right.height && left.y + left.height > right.y;
  }

  function placeEdgeLabels(graph, positions, edgeRoutes, options) {
    const nodeBoxes = graph.nodes.map((node) => {
      const position = positions[node.id];
      return position ? { x: position.x, y: position.y, width: NODE_WIDTH, height: NODE_HEIGHT } : null;
    }).filter(Boolean);
    const usedBoxes = [];
    const placed = new Map();
    graph.edges.forEach((edge) => {
      const source = positions[edge.sourceId];
      const target = positions[edge.targetId];
      if (!source || !target) return;
      const relatedEdgeIds = options.related && options.related.edgeIds instanceof Set
        ? options.related.edgeIds : new Set();
      const requested = shouldShowEdgeLabel(edge, options, relatedEdgeIds);
      const label = edgeTypeNames[edge.type] || edge.type;
      const width = Math.min(170, Math.max(54, label.length * 13));
      const height = 18;
      const base = edgeLabelPosition(source, target, 0, edgeRoutes && edgeRoutes[edge.id]);
      const candidates = [0, -20, 20, -40, 40].map((offset) => {
        const x = base.x;
        const y = base.y + offset;
        return { x, y, bounds: { x: x - width / 2, y: y - 14, width, height } };
      });
      const candidate = candidates.find(({ bounds }) => !nodeBoxes.some((nodeBox) => boxesOverlap(bounds, nodeBox))
        && !usedBoxes.some((usedBox) => boxesOverlap(bounds, usedBox)));
      const collision = !candidate;
      const position = candidate || { x: base.x, y: base.y };
      const visible = requested && !collision;
      placed.set(edge.id, { x: position.x, y: position.y, visible, collision });
      if (visible) usedBoxes.push(candidate.bounds);
    });
    return placed;
  }

  function renderLaneBox(layer, lane) {
    if (!lane || !lane.bounds) return null;
    const group = createElement("g");
    group.setAttribute("class", "graph-area");
    group.setAttribute("data-area-id", lane.id);
    const box = createElement("rect");
    box.setAttribute("class", "graph-area-box");
    box.setAttribute("x", String(lane.bounds.left));
    box.setAttribute("y", String(lane.bounds.top));
    box.setAttribute("width", String(lane.bounds.right - lane.bounds.left));
    box.setAttribute("height", String(lane.bounds.bottom - lane.bounds.top));
    group.appendChild(box);
    addText(group, "graph-area-label", lane.bounds.left + 12, lane.bounds.top + 18, lane.label);
    layer.appendChild(group);
    return { id: lane.id, label: lane.label, nodeIds: [] };
  }

  function renderEducationArea(layer, area) {
    if (!area) return null;
    const group = createElement("g");
    group.setAttribute("class", "graph-area");
    group.setAttribute("data-area-id", "education");
    const box = createElement("rect");
    box.setAttribute("class", "graph-area-box graph-education-area-box");
    box.setAttribute("x", String(area.left));
    box.setAttribute("y", String(area.top));
    box.setAttribute("width", String(area.right - area.left));
    box.setAttribute("height", String(area.bottom - area.top));
    group.appendChild(box);
    addText(group, "graph-area-label", Number.isFinite(area.titleX) ? area.titleX : area.left + 12,
      Number.isFinite(area.titleY) ? area.titleY : area.top + 18, "내부 처리 과정");
    layer.appendChild(group);
    return { id: "education", label: "내부 처리 과정", nodeIds: [] };
  }

  function renderChainGroup(layer, groupDefinition, plan) {
    const group = createElement("g");
    group.setAttribute("class", "graph-chain-area");
    group.setAttribute("data-chain-id", groupDefinition.id);
    if (Number.isFinite(groupDefinition.left) && Number.isFinite(groupDefinition.right)) {
      const box = createElement("rect");
      box.setAttribute("class", "graph-chain-area-box");
      box.setAttribute("x", String(groupDefinition.left));
      box.setAttribute("y", String(groupDefinition.top));
      box.setAttribute("width", String(groupDefinition.right - groupDefinition.left));
      box.setAttribute("height", String(groupDefinition.bottom - groupDefinition.top));
      group.appendChild(box);
      addText(group, "graph-chain-area-label", groupDefinition.left + 12, String(groupDefinition.top + 16), groupDefinition.label);
      layer.appendChild(group);
      return;
    }
    const filterLane = plan.lanes.find((lane) => lane.id === "security-filter");
    if (!filterLane || !Number.isInteger(groupDefinition.column)) return;
    const leftX = filterLane.x + (groupDefinition.column - filterLane.column) * (filterLane.width / filterLane.columns);
    const box = createElement("rect");
    box.setAttribute("class", "graph-chain-area-box");
    box.setAttribute("x", String(leftX - 10));
    box.setAttribute("y", String(groupDefinition.top));
    box.setAttribute("width", String(NODE_WIDTH + 20));
    box.setAttribute("height", String(groupDefinition.bottom - groupDefinition.top));
    group.appendChild(box);
    addText(group, "graph-chain-area-label", leftX, String(groupDefinition.top + 16), groupDefinition.label);
    layer.appendChild(group);
  }

  function renderAreas(graph, positions, layer, plan, height) {
    if (!layer) return [];
    layer.replaceChildren();
    const areas = [];
    if (plan && Array.isArray(plan.lanes)) {
      plan.lanes.forEach((lane) => {
        const area = renderLaneBox(layer, lane);
        if (area) areas.push(area);
      });
      (plan.chainGroups || []).forEach((group) => renderChainGroup(layer, group, plan));
      const education = renderEducationArea(layer, plan.educationArea);
      if (education) areas.push(education);
      return areas;
    }
    const areaDefinitions = [
      { id: "servlet-entry", label: "서블릿 컨테이너·진입", matches: (node) => ["APPLICATION", "SERVLET"].includes(node.type) },
      { id: "servlet-filter", label: "서블릿 필터", matches: (node) => node.type === "FILTER" && node.attributes.registrationKind === "SERVLET" },
      { id: "spring-security", label: "스프링 시큐리티", matches: (node) => node.type === "SECURITY_CHAIN"
        || (node.type === "FILTER" && node.attributes.registrationKind === "SECURITY") },
      { id: "servlet-handler", label: "서블릿·핸들러", matches: (node) => ["ENDPOINT", "HANDLER"].includes(node.type) },
      { id: "authentication-authorization", label: "인증·인가·보안정보", matches: (node) => ["AUTHENTICATION", "AUTHORIZATION", "SECURITY_DATA", "BUSINESS_SECURITY_STATE"].includes(node.type) }
    ];
    areaDefinitions.forEach((definition) => {
      const members = graph.nodes.filter(definition.matches).map((node) => ({ node, position: positions[node.id] }))
        .filter((item) => item.position);
      if (members.length === 0) return;
      const left = Math.min(...members.map((item) => item.position.x)) - 22;
      const top = Math.min(...members.map((item) => item.position.y)) - 30;
      const right = Math.max(...members.map((item) => item.position.x + NODE_WIDTH)) + 22;
      const bottom = Math.max(...members.map((item) => item.position.y + NODE_HEIGHT)) + 22;
      const group = createElement("g");
      group.setAttribute("class", "graph-area");
      group.setAttribute("data-area-id", definition.id);
      const box = createElement("rect");
      box.setAttribute("class", "graph-area-box");
      box.setAttribute("x", String(left));
      box.setAttribute("y", String(top));
      box.setAttribute("width", String(right - left));
      box.setAttribute("height", String(bottom - top));
      group.appendChild(box);
      addText(group, "graph-area-label", left + 12, top + 18, definition.label);
      layer.appendChild(group);
      areas.push({ id: definition.id, label: definition.label, nodeIds: members.map((item) => item.node.id) });
    });
    return areas;
  }

  function renderGuides(graph, positions, layer, plan, flowIndex, selection, detailMode) {
    if (!layer) return [];
    layer.replaceChildren();
    if (!plan || !Array.isArray(plan.lanes)) return [];
    const guides = [];

    const index = flowIndex || (window.MapInBootFlow && window.MapInBootFlow.createIndex
      ? window.MapInBootFlow.createIndex(graph)
      : null);
    if (!index || typeof index.handlerFor !== "function") return guides;
    graph.nodes.filter((node) => node.type === "ENDPOINT").forEach((endpoint) => {
      const match = index.handlerFor(endpoint.id);
      const handler = match && match.status === "CONFIRMED" ? match.node : null;
      const source = positions[endpoint.id];
      const target = handler && positions[handler.id];
      if (!source || !target) return;
      const related = guideRelated(plan, endpoint.id, handler.id, selection);
      const path = createElement("path");
      path.setAttribute("class", "graph-guide graph-guide-handler");
      path.setAttribute("data-guide-kind", "endpoint-handler");
      path.setAttribute("data-endpoint-id", endpoint.id);
      path.setAttribute("data-handler-id", handler.id);
      path.setAttribute("data-related", String(related));
      const controller = (plan.controllerGroups || []).find((group) => (group.handlerIds || []).includes(handler.id));
      const matchesGroup = !controller || (controller.position.x === target.x && controller.position.y === target.y);
      const planned = !detailMode && matchesGroup && plan.guideRoutes && plan.guideRoutes[endpoint.id];
      path.setAttribute("d", planned || projectionRoute(source, target));
      layer.appendChild(path);
      guides.push({ id: `${endpoint.id}:${handler.id}`, kind: "endpoint-handler", endpointId: endpoint.id, handlerId: handler.id, element: path });
    });
    return guides;
  }

  function guideRelated(plan, endpointId, handlerId, selection) {
    if (!selection) return true;
    if (selection.kind === "node") return [endpointId, handlerId].includes(selection.id);
    if (selection.kind !== "controller-group") return false;
    const group = (plan && plan.controllerGroups || []).find((item) => item.id === selection.id);
    return Boolean(group && (group.endpointIds || []).includes(endpointId)
      && (group.handlerIds || []).includes(handlerId));
  }

  function projectionRoute(source, target, edge, index = 0) {
    if (!source || !target) return "";
    const start = { x: source.x + NODE_WIDTH, y: source.y + NODE_HEIGHT / 2 };
    const end = { x: target.x, y: target.y + NODE_HEIGHT / 2 };
    if (edge && edge.routeKind === "filter-wrap") {
      const outerX = source.x + NODE_WIDTH + 48;
      const upperY = target.y - 36;
      const leftX = target.x - 48;
      return `M ${start.x} ${start.y} H ${outerX} V ${upperY} H ${leftX} V ${end.y} H ${end.x}`;
    }
    const channelX = (start.x + end.x) / 2 + (index % 2) * 18 - 9;
    if (Math.abs(start.y - end.y) < 2) return `M ${start.x} ${start.y} H ${end.x}`;
    return `M ${start.x} ${start.y} H ${channelX} V ${end.y} H ${end.x}`;
  }

  function projectionRelated(edge, graph, plan, flowIndex, selection) {
    if (!selection) return true;
    if (selection.kind === "controller-group") {
      const group = (plan.controllerGroups || []).concat(plan.displayModel && plan.displayModel.groups || [])
        .find((item) => item.id === selection.id);
      if (!group) return false;
      const groupNodeIds = new Set([...(group.endpointIds || []), ...(group.handlerIds || [])]);
      return groupNodeIds.has(edge.sourceId) || groupNodeIds.has(edge.targetId);
    }
    let selectedChainId = null;
    let selectedEndpointId = null;
    if (selection.kind === "node") {
      const selectedNode = graph.nodes.find((node) => node.id === selection.id);
      if (selectedNode && selectedNode.type === "ENDPOINT") selectedEndpointId = selectedNode.id;
      if (selectedNode && selectedNode.type === "SECURITY_CHAIN") selectedChainId = selectedNode.id;
      if (selectedNode && selectedNode.type === "FILTER") {
        const group = (plan.chainGroups || []).find((item) => item.nodeIds.includes(selectedNode.id));
        selectedChainId = group && group.id;
      }
      if (selectedEndpointId && flowIndex && typeof flowIndex.firstMatchedChain === "function") {
        const match = flowIndex.firstMatchedChain(selectedEndpointId);
        selectedChainId = match.status === "CONFIRMED" ? match.chain.id : null;
      }
    }
    const group = (plan.chainGroups || []).find((item) => item.id === selectedChainId);
    const branchIds = group ? new Set(group.nodeIds) : new Set();
    if (selectedChainId && (branchIds.has(edge.sourceId) || branchIds.has(edge.targetId))) return true;
    if (selectedChainId && edge.id.includes(selectedChainId)) return true;
    if (selectedEndpointId && edge.id.includes(selectedEndpointId)) return true;
    if (selectedEndpointId && edge.id.startsWith("adapter-to-")) {
      const handler = flowIndex && flowIndex.handlerFor ? flowIndex.handlerFor(selectedEndpointId) : null;
      const mapping = plan.displayModel && plan.displayModel.nodeToDisplay;
      const handlerId = edge.targetId;
      return Boolean(handler && handler.node && (handlerId === handler.node.id
        || mapping && mapping[handlerId] && mapping[handlerId] === mapping[handler.node.id]));
    }
    if (selectedChainId || selectedEndpointId) {
      return edge.id.startsWith("education-") || edge.id === "delegating-to-proxy" || edge.id === "proxy-to-matcher"
        || edge.id === "continue-to-dispatcher" || edge.id === "dispatcher-to-handler-mapping"
        || edge.id === "mapping-to-adapter-shared";
    }
    return true;
  }

  function renderProjection(graph, positions, layer, projection, plan, options) {
    if (!layer) return { nodes: [], edges: [] };
    layer.replaceChildren();
    if (!projection || !Array.isArray(projection.nodes) || !Array.isArray(projection.edges)) {
      return { nodes: [], edges: [] };
    }
    const projectionPositions = Object.fromEntries(projection.nodes.map((node) => [node.id, node.position]));
    const allPositions = { ...positions, ...projectionPositions };
    const edgeElements = [];
    const routes = {};
    const nodeElements = [];
    const edgeCounts = new Map();
    let projectionEdges = projection.edges;
    if (!options.detailMode) {
      const mappingEdges = projectionEdges.filter((edge) => edge.id.startsWith("mapping-to-") || edge.id.startsWith("endpoint-to-adapter-"));
      const seen = new Set();
      projectionEdges = projectionEdges.filter((edge) => {
        if (mappingEdges.includes(edge)) return false;
        if (!edge.id.startsWith("adapter-to-")) return true;
        const mapping = plan.displayModel && plan.displayModel.nodeToDisplay;
        const sourceId = mapping && mapping[edge.sourceId] || edge.sourceId;
        const targetId = mapping && mapping[edge.targetId] || edge.targetId;
        const key = `${sourceId}\u0000${targetId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (mappingEdges.length) projectionEdges = projectionEdges.concat({
        id: "mapping-to-adapter-shared", sourceId: "education-handler-mapping", targetId: "education-handler-adapter", kind: "education"
      });
    }
    projectionEdges.forEach((edge) => {
      const source = allPositions[edge.sourceId];
      const target = allPositions[edge.targetId];
      if (!source || !target) return;
      const pairKey = `${edge.sourceId}\u0000${edge.targetId}`;
      const index = edgeCounts.get(pairKey) || 0;
      edgeCounts.set(pairKey, index + 1);
      const path = createElement("path");
      path.setAttribute("class", "graph-projection-edge");
      const plannedRoute = options.detailMode
        ? plan && plan.projectionRoutes && plan.projectionRoutes[edge.id]
        : plan && plan.overviewProjectionRoutes && plan.overviewProjectionRoutes[edge.id];
      const route = plannedRoute && plannedRoute.d
        ? plannedRoute.d : projectionRoute(source, target, edge, index);
      path.setAttribute("d", route);
      path.setAttribute("data-projection-edge-id", edge.id);
      path.setAttribute("data-projection-kind", edge.kind || "education");
      path.setAttribute("data-route-kind", edge.routeKind || "direct");
      path.setAttribute("data-related", String(projectionRelated(edge, graph, plan, options.flowIndex, options.selection)));
      path.setAttribute("marker-end", "url(#graph-guide-arrow)");
      layer.appendChild(path);
      edgeElements.push(path);
      routes[edge.id] = { d: route, kind: edge.routeKind || "direct" };
    });
    projection.nodes.forEach((node) => {
      const position = node.position;
      const nodeWidth = Number.isFinite(node.width) ? node.width : NODE_WIDTH;
      const nodeHeight = Number.isFinite(node.height) ? node.height : NODE_HEIGHT;
      const group = createElement("g");
      group.setAttribute("class", "graph-projection-node");
      group.setAttribute("transform", `translate(${position.x} ${position.y})`);
      group.setAttribute("data-projection-id", node.id);
      group.setAttribute("data-projection-kind", node.kind || "education");
      group.setAttribute("aria-label", `${node.primary} ${node.detail}`);
      const card = createElement("rect");
      card.setAttribute("class", "graph-projection-card");
      card.setAttribute("width", String(nodeWidth));
      card.setAttribute("height", String(nodeHeight));
      card.setAttribute("rx", "7");
      group.appendChild(card);
      addText(group, "graph-projection-type", 14, 22, "내부 처리 단계");
      addNodeText(group, "graph-projection-label", 14, 48, node.primary, nodeWidth - 28, 28);
      addNodeText(group, "graph-projection-detail", 14, 76, node.detail, nodeWidth - 28, 40);
      layer.appendChild(group);
      nodeElements.push(group);
    });
    return { nodes: nodeElements, edges: edgeElements, routes };
  }

  function renderFindingSections(graph, positions, layer, titleLayer, sections, onFindingClick, plan) {
    if (!layer) return [];
    layer.replaceChildren();
    if (titleLayer) titleLayer.replaceChildren();
    const nodeById = new Map((graph.nodes || []).map((node) => [node.id, node]));
    const cardBounds = (position) => ({
      left: position.x,
      top: position.y,
      right: position.x + NODE_WIDTH,
      bottom: position.y + NODE_HEIGHT
    });
    const overlaps = (left, right) => left.left < right.right && left.right > right.left
      && left.top < right.bottom && left.bottom > right.top;
    const usedTitles = [];
    const rendered = [];
    const relatedFindingId = (target) => {
      let current = target;
      while (current) {
        const id = typeof current.getAttribute === "function" ? current.getAttribute("data-finding-id") : null;
        if (id) return id;
        current = current.parentNode;
      }
      return null;
    };
    const entries = (Array.isArray(sections) ? sections : []).slice().sort((left, right) =>
      stringValue(left.finding && left.finding.id, "").localeCompare(stringValue(right.finding && right.finding.id, "")));
    entries.forEach((section) => {
      const nodes = (section.nodeIds || []).map((id) => nodeById.get(id)).filter(Boolean);
      const located = nodes.map((node) => positions[node.id]).filter(Boolean);
      if (located.length === 0) return;
      const planned = plan && Array.isArray(plan.findingSectionLayouts)
        ? plan.findingSectionLayouts.find((item) => item.findingId === section.finding.id)
        : null;
      const relatedIds = new Set(nodes.map((node) => node.id));
      const minY = Math.min(...located.map((point) => point.y));
      let bounds = planned && planned.bounds;
      let titleBounds = planned && planned.titleBounds;
      if (!bounds || !titleBounds) {
        const left = Math.min(...located.map((point) => point.x)) - 28;
        const right = Math.max(...located.map((point) => point.x + NODE_WIDTH)) + 28;
        let titleTop = Math.max(0, minY - 40);
        const titleRect = (top) => ({ left: left + 12, top, right: right - 12, bottom: top + 18 });
        const unrelatedCards = (graph.nodes || []).filter((node) => !relatedIds.has(node.id))
          .map((node) => positions[node.id]).filter(Boolean).map(cardBounds);
        for (let attempt = 0; attempt < unrelatedCards.length + usedTitles.length + 8; attempt += 1) {
          const candidate = titleRect(titleTop);
          if (!unrelatedCards.some((card) => overlaps(candidate, card))
            && !usedTitles.some((title) => overlaps(candidate, title))) break;
          titleTop = Math.max(0, titleTop - 22);
        }
        titleBounds = titleRect(titleTop);
        bounds = {
          left,
          top: Math.max(0, Math.min(minY - 48, titleTop - 8)),
          right,
          bottom: Math.max(...located.map((point) => point.y + NODE_HEIGHT)) + 24
        };
      }
      usedTitles.push(titleBounds);
      const group = createElement("g");
      group.setAttribute("class", "graph-finding-section");
      group.setAttribute("data-finding-id", section.finding.id);
      group.setAttribute("data-node-ids", nodes.map((node) => node.id).join(","));
      group.setAttribute("data-edge-ids", (section.edgeIds || []).join(","));
      group.setAttribute("data-selected", String(Boolean(section.selected)));
      group.setAttribute("data-hovered", "false");
      group.setAttribute("data-confidence", section.finding.confidence || "UNKNOWN");
      group.setAttribute("data-bounds", [bounds.left, bounds.top, bounds.right, bounds.bottom].join(","));
      group.setAttribute("data-title-bounds", [titleBounds.left, titleBounds.top, titleBounds.right, titleBounds.bottom].join(","));
      group.setAttribute("tabindex", "0");
      group.setAttribute("role", "button");
      const confidence = section.finding.confidence || "UNKNOWN";
      const confidenceLabel = { CONFIRMED: "확정", LIKELY: "검토 필요", UNKNOWN: "확인 불가" }[confidence] || "확인 불가";
      const label = `${section.finding.title || section.finding.id} · ${confidenceLabel}`;
      group.setAttribute("aria-label", `Finding 영향 범위 열기: ${label}`);
      const outline = createElement("rect");
      outline.setAttribute("class", "graph-area-box graph-finding-section-outline");
      outline.setAttribute("x", String(bounds.left));
      outline.setAttribute("y", String(bounds.top));
      outline.setAttribute("width", String(bounds.right - bounds.left));
      outline.setAttribute("height", String(bounds.bottom - bounds.top));
      outline.setAttribute("rx", "8");
      outline.setAttribute("pointer-events", "all");
      group.appendChild(outline);
      let titleGroup = null;
      const activate = (event) => {
        if (event && event.stopPropagation) event.stopPropagation();
        if (onFindingClick) onFindingClick(section.finding.id, group);
      };
      const updateHover = (event, hovered) => {
        if (!hovered && event && relatedFindingId(event.relatedTarget) === section.finding.id) return;
        group.setAttribute("data-hovered", String(hovered));
        if (titleGroup) titleGroup.setAttribute("data-hovered", String(hovered));
      };
      group.addEventListener("pointerover", (event) => updateHover(event, true));
      group.addEventListener("pointerout", (event) => updateHover(event, false));
      group.addEventListener("click", activate);
      group.addEventListener("keydown", (event) => {
        if (!event || (event.key !== "Enter" && event.key !== " ")) return;
        if (event.preventDefault) event.preventDefault();
        activate(event);
      });
      layer.appendChild(group);
      if (titleLayer) {
        titleGroup = createElement("g");
        titleGroup.setAttribute("class", "graph-finding-section-title-target");
        titleGroup.setAttribute("data-finding-id", section.finding.id);
        titleGroup.setAttribute("data-selected", String(Boolean(section.selected)));
        titleGroup.setAttribute("data-confidence", confidence);
        titleGroup.setAttribute("data-hovered", "false");
        titleGroup.addEventListener("pointerover", (event) => updateHover(event, true));
        titleGroup.addEventListener("pointerout", (event) => updateHover(event, false));
        const hit = createElement("rect");
        hit.setAttribute("class", "graph-finding-section-title-hit");
        hit.setAttribute("x", String(titleBounds.left));
        hit.setAttribute("y", String(titleBounds.top));
        hit.setAttribute("width", String(titleBounds.right - titleBounds.left));
        hit.setAttribute("height", String(titleBounds.bottom - titleBounds.top));
        hit.setAttribute("pointer-events", "all");
        titleGroup.appendChild(hit);
        const title = addNodeText(titleGroup, "graph-finding-section-title", titleBounds.left + 2,
          titleBounds.top + 15, label, titleBounds.right - titleBounds.left - 4,
          Math.max(8, Math.floor((titleBounds.right - titleBounds.left - 4) / 12)));
        title.setAttribute("aria-hidden", "true");
        titleGroup.addEventListener("click", activate);
        titleLayer.appendChild(titleGroup);
      }
      rendered.push(group);
    });
    return rendered;
  }

  function render(graph, layers, options = {}) {
    const findings = Array.isArray(options.findings) ? options.findings : [];
    const confidenceNames = { CONFIRMED: "확정", LIKELY: "검토 필요", UNKNOWN: "확인 불가" };
    function appendMarkers(parent, entries, x, y) {
      entries.forEach(({ finding }, index) => {
        const marker = createElement("g");
        marker.setAttribute("class", "finding-marker");
        marker.setAttribute("transform", `translate(${x + index * 32} ${y})`);
        marker.setAttribute("tabindex", "0");
        marker.setAttribute("role", "button");
        marker.setAttribute("data-finding-id", finding.id);
        marker.setAttribute("data-confidence", finding.confidence || "UNKNOWN");
        marker.setAttribute("data-selected", String(finding.id === options.selectedFindingId));
        marker.setAttribute("aria-pressed", String(finding.id === options.selectedFindingId));
        const label = `${finding.title || finding.id} · ${finding.ruleId || ""} · ${confidenceNames[finding.confidence] || "확인 불가"}`;
        marker.setAttribute("aria-label", label);
        const title = createElement("title");
        title.textContent = label;
        marker.appendChild(title);
        const circle = createElement("circle");
        circle.setAttribute("r", "14");
        circle.setAttribute("vector-effect", "non-scaling-stroke");
        marker.appendChild(circle);
        const text = createElement("text");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("y", "5");
        text.textContent = "!";
        marker.appendChild(text);
        const select = (event) => {
          if (event && event.stopPropagation) event.stopPropagation();
          if (options.onFindingClick) options.onFindingClick(finding.id, marker);
        };
        marker.addEventListener("click", select);
        marker.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          select(event);
        });
        parent.appendChild(marker);
      });
    }
    const positions = positionsFor(graph.nodes, options.positions);
    const visibleIds = new Set(graph.nodes.map((node) => node.id));
    const controllerGroups = !options.detailMode && options.layoutPlan && Array.isArray(options.layoutPlan.controllerGroups)
      ? options.layoutPlan.controllerGroups.concat(options.layoutPlan.displayModel ? options.layoutPlan.displayModel.groups : [])
        .filter((group) => (group.handlerIds || []).every((id) => visibleIds.has(id)))
      : [];
    const groupedHandlerIds = new Set(controllerGroups.flatMap((group) => group.handlerIds || []));
    const displayPositions = { ...positions };
    controllerGroups.forEach((group) => {
      displayPositions[group.id] = group.position;
      (group.handlerIds || []).forEach((handlerId) => { displayPositions[handlerId] = group.position; });
    });
    const size = graphSize(displayPositions, options.bounds);
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const selection = options.selection || null;
    const relatedNodeIds = options.related && options.related.nodeIds instanceof Set
      ? options.related.nodeIds
      : new Set();
    const relatedEdgeIds = options.related && options.related.edgeIds instanceof Set
      ? options.related.edgeIds
      : new Set();
    const edgePairCounts = new Map();
    const edgeElements = [];
    const edgeLabelElements = [];
    const nodeElements = [];
    const areas = renderAreas(graph, positions, layers.areaLayer, options.layoutPlan, size.height);
    let guides;
    if (options.findingDetailMode && !options.detailMode) {
      if (layers.guideLayer) layers.guideLayer.replaceChildren();
      guides = [];
    } else {
      guides = renderGuides(graph, displayPositions, layers.guideLayer, options.layoutPlan, options.flowIndex, selection, options.detailMode);
    }
    let projection;
    if (options.findingDetailMode && !options.detailMode) {
      if (layers.projectionLayer) layers.projectionLayer.replaceChildren();
      projection = { nodes: [], edges: [] };
    } else {
      projection = renderProjection(graph, displayPositions, layers.projectionLayer, options.layoutPlan && options.layoutPlan.projection, options.layoutPlan || {}, options);
    }
    const renderEdgeRoutes = { ...(options.edgeRoutes || {}) };
    graph.edges.forEach((edge) => {
      const model = options.layoutPlan && options.layoutPlan.displayModel;
      const matchesGrouping = model && [edge.sourceId, edge.targetId].every((id) =>
        groupedHandlerIds.has(id) === (model.nodeToDisplay[id] !== id));
      const route = !options.detailMode && matchesGrouping && options.layoutPlan.displayEdgeRoutes
        && options.layoutPlan.displayEdgeRoutes[edge.id];
      if (route) renderEdgeRoutes[edge.id] = route;
      else if (groupedHandlerIds.has(edge.sourceId) || groupedHandlerIds.has(edge.targetId)) delete renderEdgeRoutes[edge.id];
    });
    const labelPositions = placeEdgeLabels(graph, displayPositions, renderEdgeRoutes, options);
    layers.edgeLayer.replaceChildren();
    layers.nodeLayer.replaceChildren();
    layers.svg.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
    layers.svg.setAttribute("data-layout-mode", options.layoutMode || "initial");
    if (layers.viewport) layers.viewport.setAttribute("data-layout-mode", options.layoutMode || "initial");

    const activeDisplayIds = {};
    controllerGroups.forEach((group) => (group.handlerIds || []).forEach((id) => { activeDisplayIds[id] = group.id; }));
    const bundles = new Map();
    graph.edges.forEach((edge) => {
      const sourceId = activeDisplayIds[edge.sourceId] || edge.sourceId;
      const targetId = activeDisplayIds[edge.targetId] || edge.targetId;
      const grouped = sourceId !== edge.sourceId || targetId !== edge.targetId;
      const key = !options.detailMode && grouped ? JSON.stringify([sourceId, targetId, edge.type]) : edge.id;
      const bundle = bundles.get(key) || { edge, edgeIds: [] };
      bundle.edgeIds.push(edge.id);
      bundles.set(key, bundle);
    });
    Array.from(bundles.values()).forEach(({ edge, edgeIds }) => {
      const source = displayPositions[edge.sourceId];
      const target = displayPositions[edge.targetId];
      if (!source || !target) return;
      const pairKey = `${edge.sourceId}\u0000${edge.targetId}`;
      const parallelIndex = edgePairCounts.get(pairKey) || 0;
      edgePairCounts.set(pairKey, parallelIndex + 1);
      const style = edgeStyles[edge.type];
      const path = createElement("path");
      path.setAttribute("class", "graph-edge");
      path.setAttribute("d", routedPath(renderEdgeRoutes[edge.id], edgePath(source, target, parallelIndex)));
      path.setAttribute("data-edge-id", edge.id);
      path.setAttribute("data-edge-ids", edgeIds.join(","));
      path.setAttribute("data-edge-type", edge.type);
      path.setAttribute("data-source-id", edge.sourceId);
      path.setAttribute("data-target-id", edge.targetId);
      path.setAttribute("data-confidence", edge.confidence);
      path.setAttribute("data-evidence-ids", edge.evidenceIds.join(","));
      path.setAttribute("tabindex", "0");
      path.setAttribute("role", "button");
      path.setAttribute("aria-label", `${edgeTypeNames[edge.type] || edge.type} ${edge.sourceId} → ${edge.targetId}`);
      path.setAttribute("data-selected", String(Boolean(selection && selection.kind === "edge" && edgeIds.includes(selection.id))));
      path.setAttribute("data-related", String(!selection || edgeIds.some((id) => relatedEdgeIds.has(id))));
      path.setAttribute("stroke", style.color);
      path.setAttribute("stroke-dasharray", style.dash);
      path.setAttribute("marker-end", "url(#graph-arrow)");
      if (options.onEdgeClick) path.addEventListener("click", (event) => {
        if (event && event.stopPropagation) event.stopPropagation();
        options.onEdgeClick(edge.id, path);
      });
      if (options.onEdgeFocus) path.addEventListener("focus", () => options.onEdgeFocus(edge.id, path));
      if (options.onEdgeBlur) path.addEventListener("blur", () => options.onEdgeBlur(edge.id, path));
      if (options.onEdgeHover) path.addEventListener("mouseenter", () => options.onEdgeHover(edge.id, path));
      if (options.onEdgeLeave) path.addEventListener("mouseleave", () => options.onEdgeLeave(edge.id, path));
      path.addEventListener("keydown", (event) => {
        if (!event || (event.key !== "Enter" && event.key !== " ")) return;
        if (event.preventDefault) event.preventDefault();
        if (options.onEdgeClick) options.onEdgeClick(edge.id, path);
      });
      layers.edgeLayer.appendChild(path);
      edgeElements.push(path);
      if (typeof path.getTotalLength === "function" && typeof path.getPointAtLength === "function") {
        const matching = findings.filter((entry) => entry.edgeIds.some((id) => edgeIds.includes(id)));
        if (matching.length) {
          const length = path.getTotalLength();
          matching.forEach((entry, index) => {
            const distance = Math.max(0, Math.min(length, length / 2 + (index - (matching.length - 1) / 2) * 22));
            const point = path.getPointAtLength(distance);
            appendMarkers(layers.edgeLayer, [entry], point.x, point.y);
          });
        }
      }

      const label = createElement("text");
      label.setAttribute("class", "graph-edge-label");
      label.setAttribute("data-edge-id", edge.id);
      label.setAttribute("data-edge-type", edge.type);
      label.setAttribute("data-selected", String(Boolean(selection && selection.kind === "edge" && selection.id === edge.id)));
      label.setAttribute("data-related", String(!selection || relatedEdgeIds.has(edge.id)));
      const labelPosition = labelPositions.get(edge.id) || edgeLabelPosition(source, target, parallelIndex, renderEdgeRoutes[edge.id]);
      label.setAttribute("x", String(labelPosition.x));
      label.setAttribute("y", String(labelPosition.y));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("data-visible", String(labelPosition.visible !== false
        && shouldShowEdgeLabel(edge, options, relatedEdgeIds)));
      label.setAttribute("data-collision", String(Boolean(labelPosition.collision)));
      label.setAttribute("fill", style.color);
      label.textContent = edgeTypeNames[edge.type] || edge.type;
      layers.edgeLayer.appendChild(label);
      edgeLabelElements.push(label);
      const setHoveredLabel = (visible) => {
        if (options.displayEdgeLabels === false) return;
        if (!labelPosition.collision && (visible || (selection && selection.kind === "edge" && selection.id === edge.id))) {
          label.setAttribute("data-visible", "true");
        } else {
          label.setAttribute("data-visible", "false");
        }
      };
      path.addEventListener("mouseenter", () => setHoveredLabel(true));
      path.addEventListener("mouseleave", () => setHoveredLabel(false));
      path.addEventListener("focus", () => setHoveredLabel(true));
      path.addEventListener("blur", () => setHoveredLabel(false));
    });

    graph.nodes.forEach((node) => {
      if (groupedHandlerIds.has(node.id)) return;
      const position = displayPositions[node.id];
      const style = nodeStyles[node.type];
    const display = nodeDisplay(node, { filterOrderInfo: options.layoutPlan && {
      ...(options.layoutPlan.securityFilterOrder || {}),
      ...(options.layoutPlan.servletFilterOrder || {})
    } });
      const group = createElement("g");
      group.setAttribute("class", "graph-node");
      group.setAttribute("transform", `translate(${position.x} ${position.y})`);
      group.setAttribute("data-node-id", node.id);
      group.setAttribute("data-has-finding", String(findings.some((entry) => entry.nodeIds.includes(node.id))));
      group.setAttribute("data-node-type", node.type);
      group.setAttribute("data-evidence-ids", node.evidenceIds.join(","));
      group.setAttribute("data-selected", String(Boolean(selection && selection.kind === "node" && selection.id === node.id)));
      group.setAttribute("data-related", String(!selection || relatedNodeIds.has(node.id)));
      group.setAttribute("tabindex", "0");
      group.setAttribute("role", "button");
      group.setAttribute("aria-label", `${nodeTypeNames[node.type] || node.type} ${display.primary} ${display.detail}`);
      if (options.onNodeClick) group.addEventListener("click", (event) => {
        if (event && event.stopPropagation) event.stopPropagation();
        options.onNodeClick(node.id, group);
      });
      if (options.onNodeFocus) group.addEventListener("focus", () => options.onNodeFocus(node.id, group));
      if (options.onNodeBlur) group.addEventListener("blur", () => options.onNodeBlur(node.id, group));
      if (options.onNodeHover) group.addEventListener("mouseenter", () => options.onNodeHover(node.id, group));
      if (options.onNodeLeave) group.addEventListener("mouseleave", () => options.onNodeLeave(node.id, group));
      group.addEventListener("keydown", (event) => {
        if (!event || (event.key !== "Enter" && event.key !== " ")) return;
        if (event.preventDefault) event.preventDefault();
        if (options.onNodeClick) options.onNodeClick(node.id, group);
      });

      const card = createElement("rect");
      card.setAttribute("class", "graph-node-card");
      card.setAttribute("width", String(NODE_WIDTH));
      card.setAttribute("height", String(NODE_HEIGHT));
      card.setAttribute("rx", "7");
      card.setAttribute("stroke", style);
      group.appendChild(card);
      const mark = createElement("rect");
      mark.setAttribute("class", "graph-node-mark");
      mark.setAttribute("x", "14");
      mark.setAttribute("y", "12");
      mark.setAttribute("width", "8");
      mark.setAttribute("height", "8");
      mark.setAttribute("rx", "2");
      mark.setAttribute("fill", style);
      group.appendChild(mark);
      addText(group, "graph-node-type", 30, 23, nodeTypeNames[node.type] || node.type);
      const primaryLines = semanticLines(display.primary, 28).slice(0, 2);
      primaryLines.forEach((line, index) => addNodeText(
        group,
        "graph-node-label",
        14,
        48 + index * 16,
        line,
        NODE_WIDTH - 28,
        28
      ));
      addNodeText(
        group,
        "graph-node-detail",
        14,
        primaryLines.length > 1 ? 84 : 76,
        display.detail,
        NODE_WIDTH - 28,
        40
      );

      const input = createElement("circle");
      input.setAttribute("class", "graph-port graph-port-in");
      input.setAttribute("cx", "0");
      input.setAttribute("cy", String(NODE_HEIGHT / 2));
      input.setAttribute("r", "4");
      input.setAttribute("data-port", "in");
      group.appendChild(input);
      const output = createElement("circle");
      output.setAttribute("class", "graph-port graph-port-out");
      output.setAttribute("cx", String(NODE_WIDTH));
      output.setAttribute("cy", String(NODE_HEIGHT / 2));
      output.setAttribute("r", "4");
      output.setAttribute("data-port", "out");
      group.appendChild(output);
      layers.nodeLayer.appendChild(group);
      appendMarkers(layers.nodeLayer, findings.filter((entry) => entry.nodeIds.includes(node.id)), position.x + NODE_WIDTH - 14, position.y + 14);
      nodeElements.push(group);
    });

    controllerGroups.forEach((groupDefinition) => {
      const position = displayPositions[groupDefinition.id];
      if (!position) return;
      const display = controllerGroupDisplay(groupDefinition);
      const group = createElement("g");
      group.setAttribute("class", groupDefinition.type ? "graph-node graph-support-group" : "graph-node graph-controller-group");
      group.setAttribute("transform", `translate(${position.x} ${position.y})`);
      group.setAttribute("data-controller-group-id", groupDefinition.id);
      group.setAttribute("data-has-finding", String(findings.some((entry) => entry.nodeIds.some((id) =>
        (groupDefinition.nodeIds || []).includes(id) || (groupDefinition.handlerIds || []).includes(id)))));
      group.setAttribute("data-controller-fqcn", groupDefinition.controllerFqcn);
      group.setAttribute("data-handler-ids", (groupDefinition.handlerIds || []).join(","));
      group.setAttribute("data-endpoint-ids", (groupDefinition.endpointIds || []).join(","));
      group.setAttribute("data-selected", String(Boolean(selection
        && selection.kind === "controller-group" && selection.id === groupDefinition.id)));
      group.setAttribute("data-related", String(!selection || relatedNodeIds.has(groupDefinition.id)
        || (groupDefinition.handlerIds || []).some((id) => relatedNodeIds.has(id))));
      group.setAttribute("tabindex", "0");
      group.setAttribute("role", "button");
      group.setAttribute("aria-label", `Controller ${display.primary} ${display.detail}`);
      if (options.onControllerGroupClick) group.addEventListener("click", (event) => {
        if (event && event.stopPropagation) event.stopPropagation();
        options.onControllerGroupClick(groupDefinition.id, group);
      });
      if (options.onControllerGroupFocus) group.addEventListener("focus", () => options.onControllerGroupFocus(groupDefinition.id, group));
      if (options.onControllerGroupBlur) group.addEventListener("blur", () => options.onControllerGroupBlur(groupDefinition.id, group));
      if (options.onControllerGroupHover) group.addEventListener("mouseenter", () => options.onControllerGroupHover(groupDefinition.id, group));
      if (options.onControllerGroupLeave) group.addEventListener("mouseleave", () => options.onControllerGroupLeave(groupDefinition.id, group));
      group.addEventListener("keydown", (event) => {
        if (!event || (event.key !== "Enter" && event.key !== " ")) return;
        if (event.preventDefault) event.preventDefault();
        if (options.onControllerGroupClick) options.onControllerGroupClick(groupDefinition.id, group);
      });

      const card = createElement("rect");
      card.setAttribute("class", "graph-node-card graph-controller-group-card");
      card.setAttribute("width", String(NODE_WIDTH));
      card.setAttribute("height", String(NODE_HEIGHT));
      card.setAttribute("rx", "7");
      card.setAttribute("stroke", "#c4b5fd");
      group.appendChild(card);
      const mark = createElement("rect");
      mark.setAttribute("class", "graph-node-mark");
      mark.setAttribute("x", "14");
      mark.setAttribute("y", "12");
      mark.setAttribute("width", "8");
      mark.setAttribute("height", "8");
      mark.setAttribute("rx", "2");
      mark.setAttribute("fill", "#c4b5fd");
      group.appendChild(mark);
      addText(group, "graph-node-type", 30, 23, groupDefinition.type === "AUTHORIZATION" ? "인가 근거" : groupDefinition.type === "SECURITY_DATA" ? "보안정보 사용" : "Controller");
      addNodeText(group, "graph-node-label", 14, 48, display.primary, NODE_WIDTH - 28, 28);
      addNodeText(group, "graph-node-detail", 14, 76, groupDefinition.type ? `원본 Fact ${(groupDefinition.nodeIds || []).length}건` : display.detail, NODE_WIDTH - 28, 40);
      [0, NODE_WIDTH].forEach((x) => {
        const port = createElement("circle");
        port.setAttribute("class", x === 0 ? "graph-port graph-port-in" : "graph-port graph-port-out");
        port.setAttribute("cx", String(x));
        port.setAttribute("cy", String(NODE_HEIGHT / 2));
        port.setAttribute("r", "4");
        port.setAttribute("data-port", x === 0 ? "in" : "out");
        group.appendChild(port);
      });
      const groupedNodeIds = (groupDefinition.nodeIds || []).concat(groupDefinition.handlerIds || []);
      layers.nodeLayer.appendChild(group);
      appendMarkers(layers.nodeLayer, findings.filter((entry) => entry.nodeIds.some((id) => groupedNodeIds.includes(id))), position.x + NODE_WIDTH - 14, position.y + 14);
      nodeElements.push(group);
    });

    const graphHidden = graph.nodes.length === 0;
    if (typeof layers.svg.toggleAttribute === "function") {
      layers.svg.toggleAttribute("hidden", graphHidden);
    } else if (graphHidden) {
      layers.svg.setAttribute("hidden", "");
    } else {
      layers.svg.removeAttribute("hidden");
    }
    const displayNodes = graph.nodes.filter((node) => !groupedHandlerIds.has(node.id)).map((node) => ({
      ...node,
      position: displayPositions[node.id],
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      bounds: { x: displayPositions[node.id].x, y: displayPositions[node.id].y, width: NODE_WIDTH, height: NODE_HEIGHT },
      kind: "actual"
    })).concat(controllerGroups.map((group) => ({
      id: group.id,
      type: "CONTROLLER_GROUP",
      label: group.controllerName || group.controllerFqcn,
      position: group.position,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      bounds: { x: group.position.x, y: group.position.y, width: NODE_WIDTH, height: NODE_HEIGHT },
      kind: "controller-group"
    })));
    const findingSections = renderFindingSections(graph, displayPositions, layers.findingLayer, layers.findingTitleLayer,
      options.findingSections, options.onFindingSectionClick || options.onFindingClick, options.layoutPlan);
    return {
      positions: displayPositions,
      actualPositions: positions,
      width: size.width,
      height: size.height,
      nodes: graph.nodes,
      displayNodes,
      edges: graph.edges,
      invalidNodes: graph.invalidNodes,
      invalidEdges: graph.invalidEdges,
      nodeElements,
      edgeElements,
      edgeLabelElements,
      nodeById,
      areas,
      guides,
      projection,
      findingSections
    };
  }

  function updateState(rendered, graph, options = {}, layers = {}) {
    if (!rendered) return null;
    const selection = options.selection || null;
    const relatedNodeIds = options.related && options.related.nodeIds instanceof Set ? options.related.nodeIds : new Set();
    const relatedEdgeIds = options.related && options.related.edgeIds instanceof Set ? options.related.edgeIds : new Set();
    const findings = Array.isArray(options.findings) ? options.findings : [];
    const findingIds = new Set(findings.map((entry) => entry.finding.id));
    const findingNodeIds = new Set(findings.flatMap((entry) => entry.nodeIds || []));
    rendered.nodeElements.forEach((element) => {
      const nodeId = element.getAttribute("data-node-id");
      const groupId = element.getAttribute("data-controller-group-id");
      const id = nodeId || groupId;
      const selected = Boolean(selection && ((selection.kind === "node" && selection.id === nodeId)
        || (selection.kind === "controller-group" && selection.id === groupId)));
      element.setAttribute("data-selected", String(selected));
      element.setAttribute("data-related", String(!selection || relatedNodeIds.has(id)
        || (element.getAttribute("data-handler-ids") || "").split(",").some((item) => relatedNodeIds.has(item))));
      if (nodeId) element.setAttribute("data-has-finding", String(findingNodeIds.has(nodeId)));
      if (groupId) element.setAttribute("data-has-finding", String((element.getAttribute("data-handler-ids") || "").split(",").some((item) => findingNodeIds.has(item))));
    });
    rendered.edgeElements.forEach((element) => {
      const edgeIds = (element.getAttribute("data-edge-ids") || element.getAttribute("data-edge-id") || "").split(",");
      element.setAttribute("data-selected", String(Boolean(selection && selection.kind === "edge" && edgeIds.includes(selection.id))));
      element.setAttribute("data-related", String(!selection || edgeIds.some((id) => relatedEdgeIds.has(id))));
    });
    rendered.edgeLabelElements.forEach((element) => {
      const edgeId = element.getAttribute("data-edge-id");
      const selected = Boolean(selection && selection.kind === "edge" && selection.id === edgeId);
      element.setAttribute("data-selected", String(selected));
      element.setAttribute("data-related", String(!selection || relatedEdgeIds.has(edgeId)));
      if (selected) element.setAttribute("data-visible", "true");
    });
    (rendered.guides || []).forEach((guide) => {
      if (guide.element) guide.element.setAttribute("data-related", String(guideRelated(options.layoutPlan, guide.endpointId, guide.handlerId, selection)));
    });
    const projectionEdges = new Map((options.layoutPlan && options.layoutPlan.projection
      && options.layoutPlan.projection.edges || []).map((edge) => [edge.id, edge]));
    projectionEdges.set("mapping-to-adapter-shared", {
      id: "mapping-to-adapter-shared",
      sourceId: "education-handler-mapping",
      targetId: "education-handler-adapter"
    });
    (rendered.projection && rendered.projection.edges || []).forEach((element) => {
      const edge = projectionEdges.get(element.getAttribute("data-projection-edge-id"));
      if (edge) element.setAttribute("data-related", String(projectionRelated(edge, graph,
        options.layoutPlan || {}, options.flowIndex, selection)));
    });
    const updateMarkers = (parent) => {
      if (!parent) return;
      for (const element of Array.from(parent.children || [])) {
        if ((element.getAttribute("class") || "").split(/\s+/).includes("finding-marker")) {
          const findingId = element.getAttribute("data-finding-id");
          const selected = findingId === options.selectedFindingId;
          element.setAttribute("data-selected", String(selected));
          element.setAttribute("aria-pressed", String(selected));
          element.hidden = !findingIds.has(findingId);
        }
        updateMarkers(element);
      }
    };
    updateMarkers(layers.nodeLayer);
    updateMarkers(layers.edgeLayer);
    rendered.findingSections = renderFindingSections(graph, rendered.positions, layers.findingLayer, layers.findingTitleLayer,
      options.findingSections, options.onFindingSectionClick || options.onFindingClick, options.layoutPlan);
    return rendered;
  }

  window.MapInBootGraph = {
    nodeTypes: NODE_TYPES,
    edgeTypes: EDGE_TYPES,
    nodeTypeNames,
    edgeTypeNames,
    nodeTypeLabel: (type) => nodeTypeNames[type] || type,
    edgeTypeLabel: (type) => edgeTypeNames[type] || type,
    shorten,
    simpleClassName,
    friendlyClassName,
    handlerDisplay,
    securityDataDisplay,
    normalize,
    indexFindings,
    filter: filterGraph,
    render,
    updateState,
    nodeDisplay
  };
})();
