(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const NODE_WIDTH = 260;
  const NODE_HEIGHT = 120;
  const NODE_GAP_X = 330;
  const NODE_GAP_Y = 156;
  const NODE_PADDING = 48;
  const NODE_TYPES = Object.freeze([
    "APPLICATION", "SERVLET", "ENDPOINT", "HANDLER", "SECURITY_CHAIN",
    "FILTER", "AUTHENTICATION", "AUTHORIZATION", "SECURITY_DATA", "BUSINESS_SECURITY_STATE"
  ]);
  const EDGE_TYPES = Object.freeze([
    "FLOWS_TO", "MATCHED_BY", "FILTERED_BY", "SECURED_BY", "READS_SECURITY_DATA",
    "WRITES_SECURITY_DATA", "CONVERTS_TO_AUTHORITY", "USES_FOR_AUTHORIZATION", "SECURITY_STATE"
  ]);
  const nodeDisplayPrefixes = Object.freeze({
    APPLICATION: "AP-SERVICE",
    SERVLET: "SV-SERVLET",
    ENDPOINT: "EP-MAPPING",
    HANDLER: "EP-HANDLER",
    SECURITY_CHAIN: "SC-CHAIN",
    AUTHENTICATION: "SC-AUTHN",
    AUTHORIZATION: "SC-AUTH",
    SECURITY_DATA: "SD-DATA",
    BUSINESS_SECURITY_STATE: "BS-STATE"
  });
  const edgeDisplayPrefixes = Object.freeze({
    FLOWS_TO: "RL-FLOW",
    MATCHED_BY: "RL-MATCH",
    FILTERED_BY: "RL-FILTER",
    SECURED_BY: "RL-SECURITY",
    READS_SECURITY_DATA: "RL-READ",
    WRITES_SECURITY_DATA: "RL-WRITE",
    CONVERTS_TO_AUTHORITY: "RL-AUTHORITY",
    USES_FOR_AUTHORIZATION: "RL-AUTHZ",
    SECURITY_STATE: "RL-STATE"
  });
  const nodeTypeNames = {
    APPLICATION: "애플리케이션",
    SERVLET: "서블릿",
    ENDPOINT: "API",
    HANDLER: "핸들러",
    SECURITY_CHAIN: "보안 필터 체인",
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
    USES_FOR_AUTHORIZATION: "실제 인가 사용",
    SECURITY_STATE: "보안 상태"
  };
  const nodeTypeLabel = (type) => nodeTypeNames[type] || "노드 유형 확인 불가";
  const edgeTypeLabel = (type) => edgeTypeNames[type] || "관계 유형 확인 불가";
  const findingRuleNames = Object.freeze({
    CHAIN_MISSING: "보안 필터 체인 미적용",
    CHAIN_ORDER: "보안 체인·매칭 우선순위 문제",
    PUBLIC_ENDPOINT: "과도한 공개 접근 허용",
    METHOD_MISMATCH: "URL·메서드 보안 불일치",
    FILTER_ORDER: "필터 구성·순서 문제",
    OBJECT_BINDING: "인증 주체와 대상 객체 권한 검증 문제",
    STATE_BYPASS: "업무 보안 절차 우회 가능성"
  });
  const confidenceNames = Object.freeze({
    CONFIRMED: "확정",
    LIKELY: "검토 필요",
    UNKNOWN: "판단 불가",
    PARTIAL: "부분 분석"
  });
  const evidenceSourceNames = Object.freeze({
    RUNTIME: "실행 환경",
    SPRING_METADATA: "Spring 메타데이터",
    CODE_PATTERN: "코드 분석",
    DECLARATION: "선언 정보"
  });
  const analysisStatusNames = Object.freeze({
    NOT_STARTED: "대기",
    RUNNING: "실행 중",
    COLLECTING: "수집 중",
    ANALYZING: "분석 중",
    PARTIAL: "부분 분석",
    COMPLETED: "완료",
    FAILED: "실패",
    READY: "완료",
    UNKNOWN: "판단 불가"
  });

  // 전체 Snapshot의 유형별 원본 식별자 집합에 고정된 화면 표시 코드
  function createDisplayIds(graph) {
    const makeCodes = (items, getPrefix, fallbackPrefix) => {
      const prefixById = new Map();
      (items || []).forEach((item) => {
        if (!item || item.id === undefined || item.id === null) return;
        const id = String(item.id);
        const prefix = getPrefix(item) || fallbackPrefix;
        const previous = prefixById.get(id);
        prefixById.set(id, previous && previous !== prefix ? fallbackPrefix : prefix);
      });

      const groups = new Map();
      Array.from(prefixById.entries()).forEach(([id, prefix]) => {
        const ids = groups.get(prefix) || [];
        ids.push(id);
        groups.set(prefix, ids);
      });

      const codes = new Map();
      groups.forEach((ids, prefix) => {
        ids.sort().forEach((id, index) => codes.set(id, `${prefix}-${String(index + 1).padStart(3, "0")}`));
      });
      return codes;
    };
    const nodeIds = makeCodes(graph && graph.nodes, (node) => {
      if (node.type === "FILTER") {
        const registrationKind = node.attributes && node.attributes.registrationKind;
        return registrationKind === "SECURITY" ? "SF-FILTER"
          : registrationKind === "SERVLET" ? "SV-FILTER" : "FL-FILTER";
      }
      return nodeDisplayPrefixes[node.type];
    }, "ND-UNKNOWN");
    const edgeIds = makeCodes(graph && graph.edges, (edge) => edgeDisplayPrefixes[edge.type], "RL-UNKNOWN");
    return {
      node: (id) => nodeIds.get(String(id)) || "노드 확인 불가",
      edge: (id) => edgeIds.get(String(id)) || "관계 확인 불가"
    };
  }

  function findingRuleLabel(ruleId) {
    return findingRuleNames[ruleId] || "진단 유형 확인 불가";
  }

  function confidenceLabel(confidence) {
    return confidenceNames[confidence] || confidenceNames.UNKNOWN;
  }

  function evidenceSourceLabel(source) {
    return evidenceSourceNames[source] || "출처 확인 불가";
  }

  function analysisStatusLabel(status) {
    return analysisStatusNames[status] || analysisStatusNames.UNKNOWN;
  }

  const nodeStyles = {
    APPLICATION: "#4ade80",
    SERVLET: "#67e8f9",
    ENDPOINT: "#93c5fd",
    HANDLER: "#c4b5fd",
    SECURITY_CHAIN: "#fbbf24",
    FILTER: "#fb923c",
    AUTHENTICATION: "#38bdf8",
    AUTHORIZATION: "#fb7185",
    SECURITY_DATA: "#2dd4bf",
    BUSINESS_SECURITY_STATE: "#a3e635"
  };
  function nodeStyleFor(node) {
    if (node.type !== "FILTER") return nodeStyles[node.type] || "#94a3b8";
    const registrationKind = node.attributes && node.attributes.registrationKind;
    if (registrationKind === "SERVLET") return "#4ade80";
    if (registrationKind === "SECURITY") return nodeStyles.FILTER;
    return "#94a3b8";
  }
  function compositeStyleFor(card) {
    const styles = {
      SERVLET_FILTERS: { stroke: "#65b98d", body: "#14271e", header: "#254636", title: "#a1d7b6" },
      APPLICATION_CONTEXT: { stroke: "#65b98d", body: "#14271e", header: "#254636", title: "#a1d7b6" },
      SERVLET_ENTRY: { stroke: "#65b98d", body: "#14271e", header: "#254636", title: "#a1d7b6" },
      SECURITY_CHAIN: { stroke: "#d6a35a", body: "#292319", header: "#473820", title: "#e5bd73" },
      SECURITY_UNRESOLVED: { stroke: "#d6a35a", body: "#292319", header: "#473820", title: "#e5bd73" },
      AUTHENTICATION: { stroke: "#38bdf8", body: "#172733", header: "#25465a", title: "#9bdcff" },
      AUTHORIZATION: { stroke: "#cf788a", body: "#302125", header: "#482c32", title: "#efa4b3" },
      SECURITY_DATA: { stroke: "#4ab9ad", body: "#142e29", header: "#20443d", title: "#72d2bd" },
      BUSINESS_SECURITY_STATE: { stroke: "#a3e635", body: "#202919", header: "#39452a", title: "#c6ee75" },
      API_MAPPING: { stroke: "#73adde", body: "#192a36", header: "#284357", title: "#a8d5fa" },
      CONTROLLER_HANDLER: { stroke: "#b4a0e5", body: "#292536", header: "#3e344f", title: "#d4c4f8" },
      DETAIL_LEARNING: { stroke: "#6aa580", body: "#15221a", header: "#253a2c", title: "#b5d8c0" },
      RUNTIME_HOST: { stroke: "#86b2c4", body: "#18242a", header: "#2b414a", title: "#b2d0da" },
      RUNTIME_SERVLET: { stroke: "#65b98d", body: "#14271e", header: "#254636", title: "#a1d7b6" },
      RUNTIME_SECURITY: { stroke: "#d6a35a", body: "#292319", header: "#473820", title: "#e5bd73" },
      RUNTIME_MVC: { stroke: "#79a8ca", body: "#182531", header: "#29445a", title: "#b3d7f2" }
    };
    if (styles[card.kind]) return styles[card.kind];
    if (card.areaId === "security") return styles.SECURITY_CHAIN;
    if (card.areaId === "mvc") return styles.API_MAPPING;
    if (card.areaId === "servlet") return styles.SERVLET_FILTERS;
    if (card.areaId === "host") return styles.RUNTIME_HOST;
    return { stroke: "#94a3b8", body: "#17211b", header: "#26352c", title: "#d6ded8" };
  }
  const edgeStyles = {
    FLOWS_TO: { color: "#7dd3fc", dash: "none" },
    MATCHED_BY: { color: "#c4b5fd", dash: "none" },
    FILTERED_BY: { color: "#fbbf24", dash: "none" },
    SECURED_BY: { color: "#fb7185", dash: "none" },
    READS_SECURITY_DATA: { color: "#60a5fa", dash: "none" },
    WRITES_SECURITY_DATA: { color: "#a78bfa", dash: "none" },
    CONVERTS_TO_AUTHORITY: { color: "#f0abfc", dash: "none" },
    USES_FOR_AUTHORIZATION: { color: "#f59e0b", dash: "none" },
    SECURITY_STATE: { color: "#86efac", dash: "none" },
    API_MAPPING: { color: "#9dbdac", dash: "none" },
    SECURITY_CHECK_REFERENCE: { color: "#8ab7a0", dash: "none" }
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
      .replace(/L([\w/$]+);/g, (_match, name) => name.replace(/\//g, "."))
      .replace(/(?:[\w$]+\.)+([\w$]+)/g, "$1")
      .replace(/(?:[\w$]+\$)+([\w$]+)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  function shortHandlerSignature(value) {
    const source = stringValue(value, "").trim();
    const separator = source.indexOf("#");
    const signature = separator >= 0 ? source.slice(separator + 1).trim() : source;
    const open = signature.indexOf("(");
    const close = signature.lastIndexOf(")");
    if (open < 0 || close < open) return signature;
    const name = signature.slice(0, open).trim();
    const parameters = signature.slice(open + 1, close);
    if (!parameters.trim()) return `${name}()`;

    const types = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < parameters.length; index += 1) {
      if (parameters[index] === "<") depth += 1;
      else if (parameters[index] === ">") depth = Math.max(0, depth - 1);
      else if (parameters[index] === "," && depth === 0) {
        types.push(parameters.slice(start, index));
        start = index + 1;
      }
    }
    types.push(parameters.slice(start));
    return `${name}(${types.map(shortTypeNames).join(", ")})`;
  }

  function handlerDisplay(value) {
    const text = stringValue(value, "").trim();
    if (!text) return "";
    const hashIndex = text.indexOf("#");
    if (hashIndex < 0) return simpleClassName(text);
    const owner = simpleClassName(text.slice(0, hashIndex));
    return `${owner}#${shortHandlerSignature(text.slice(hashIndex + 1))}`;
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

  function policySourceDisplay(value) {
    return {
      URL: "URL 정책",
      METHOD: "메서드 정책",
      OBJECT: "객체 정책",
      ANNOTATION: "어노테이션 정책"
    }[value] || "인가 정책";
  }

  function authorizationDisplay(attributes) {
    const semantic = window.MapInBootLayout && window.MapInBootLayout.supportDisplaySemantic
      ? window.MapInBootLayout.supportDisplaySemantic({ type: "AUTHORIZATION", attributes })
      : { primary: "인가 조건 미확정", detail: "분석 근거 확인 필요" };
    if (attributes.factType === "OBJECT_AUTHORIZATION_REQUIREMENT" || attributes.factType === "OBJECT_ACCESS_PATH") {
      return { primary: semantic.primary, detail: handlerDisplay(attributes.handler) || semantic.detail };
    }
    const source = policySourceDisplay(attributes.policySource);
    const condition = attributes.policyMatcherCondition || attributes.matcherCondition
      ? `조건 ${matcherDisplay(attributes.policyMatcherCondition || attributes.matcherCondition)}` : "";
    const order = attributes.policyOrder ? `순서 ${attributes.policyOrder}` : "";
    const method = attributes.httpMethod ? `HTTP ${attributes.httpMethod}` : "";
    const declaration = attributes.policySource === "METHOD"
      ? [attributes.annotationType, attributes.declarationKind, attributes.expressionKind, attributes.requiredAuthority]
        .filter(Boolean).join(" · ") : "";
    const semanticDetail = attributes.policySource ? "" : semantic.detail;
    return {
      primary: semantic.primary,
      detail: [source, condition, order, method, declaration || semanticDetail].filter(Boolean).join(" · ")
    };
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

  function securityDataKind(attributes) {
    const semantic = window.MapInBootLayout && window.MapInBootLayout.supportDisplaySemantic
      ? window.MapInBootLayout.supportDisplaySemantic({ type: "SECURITY_DATA", attributes }) : null;
    return semantic ? semantic.kind : "";
  }

  function securityDataDisplay(attributes, fallback) {
    const semantic = window.MapInBootLayout && window.MapInBootLayout.supportDisplaySemantic
      ? window.MapInBootLayout.supportDisplaySemantic({ type: "SECURITY_DATA", attributes }) : null;
    return semantic
      ? { primary: semantic.primary, detail: semantic.detail || "원본 확인 필요" }
      : { primary: fallback || "보안 정보 확인 필요", detail: "원본 확인 필요" };
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
      return authorizationDisplay(attributes);
    }
    if (node.type === "AUTHENTICATION") {
      const authenticationKind = stringValue(attributes.authenticationKind, "");
      const kind = authenticationKind === "JWT_AUTHENTICATION" ? "JWT" : authenticationKind;
      return {
        primary: kind ? `${kind} 인증 구성` : "인증 구성 확인",
        detail: attributes.provider ? simpleClassName(attributes.provider) : "인증 방식 확인 필요"
      };
    }
    if (node.type === "SECURITY_DATA") {
      return securityDataDisplay(attributes, "보안 정보 확인 필요");
    }
    if (node.type === "BUSINESS_SECURITY_STATE") {
      const kind = attributes.factType === "BUSINESS_STATE_EVALUATION" ? "업무 상태 검증"
        : attributes.factType === "BUSINESS_STATE_REQUIREMENT" || attributes.stateAction === "REQUIRES" ? "업무 상태 요구"
          : attributes.stateAction === "PRODUCES" ? "업무 상태 생성" : "업무 보안 상태";
      const outcomes = {
        BYPASS_PATH: "검증 경로 우회", GUARDED: "보호 경로 확인", UNGUARDED: "보호 확인 없음",
        SOURCE_MISMATCH: "인증 주체 불일치", ENFORCED: "보호 적용 경로", UNRESOLVED: "판단 미완료", UNKNOWN: "판단 확인 필요"
      };
      const coverages = {
        ALL: "전체 분석 범위", COMPLETE_SUPPORTED_PATH: "지원 경로 전체", PARTIAL: "일부 분석 범위",
        NONE: "해당 없음", INCOMPLETE: "분석 불완전", UNKNOWN: "범위 확인 필요"
      };
      const stateDetail = outcomes[attributes.pathOutcome] || coverages[attributes.coverage]
        || handlerDisplay(attributes.handler) || "상태 정보 확인";
      return {
        primary: [kind, attributes.stateName].filter(Boolean).join(" · "),
        detail: stateDetail
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
      candidate = candidate.length > 2 ? `${candidate.slice(0, -2).trimEnd()}…` : "…";
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

  function addNodeHeader(parent, typeLabel, displayId, typeColor) {
    const dot = createElement("circle");
    dot.setAttribute("class", "graph-node-type-dot");
    dot.setAttribute("cx", "15");
    dot.setAttribute("cy", "19");
    dot.setAttribute("r", "3.5");
    dot.setAttribute("fill", typeColor);
    parent.appendChild(dot);

    const displayCode = addNodeText(parent, "graph-node-display-id", 248, 23, displayId, 138, 22);
    displayCode.setAttribute("text-anchor", "end");
    displayCode.setAttribute("clip-path", "url(#graph-node-header-clip)");
    const measuredIdWidth = typeof displayCode.getComputedTextLength === "function"
      ? displayCode.getComputedTextLength()
      : String(displayId || "").length * 7;
    const typeWidth = Math.max(40, 248 - 24 - Math.min(138, measuredIdWidth) - 12);
    const typeText = addNodeText(parent, "graph-node-type", 24, 23, typeLabel,
      typeWidth, Math.max(6, Math.floor(typeWidth / 7)));
    typeText.setAttribute("clip-path", "url(#graph-node-header-type-clip)");
    typeText.setAttribute("fill", typeColor);
  }

  function addNodeBackgroundTint(parent, typeColor) {
    const tint = createElement("rect");
    tint.setAttribute("class", "graph-node-background-tint");
    tint.setAttribute("x", "1");
    tint.setAttribute("y", "1");
    tint.setAttribute("width", String(NODE_WIDTH - 2));
    tint.setAttribute("height", String(NODE_HEIGHT - 2));
    tint.setAttribute("rx", "6");
    tint.setAttribute("fill", typeColor);
    parent.appendChild(tint);
  }

  function ensureNodeTextClips(svg) {
    if (!svg || Array.from(svg.children || []).some((child) => child.getAttribute("data-node-text-clips") === "true")) return;
    const definitions = createElement("defs");
    definitions.setAttribute("data-node-text-clips", "true");
    [
      { id: "graph-node-header-clip", className: "graph-node-header-clip", x: 108, y: 7, width: 140, height: 24 },
      { id: "graph-node-header-type-clip", className: "graph-node-header-type-clip", x: 22, y: 7, width: 226, height: 24 },
      { id: "graph-node-content-clip", className: "graph-node-content-clip", x: 12, y: 34, width: 236, height: 78 }
    ].forEach(({ id, className, x, y, width, height }) => {
      const clipPath = createElement("clipPath");
      clipPath.setAttribute("id", id);
      clipPath.setAttribute("class", className);
      clipPath.setAttribute("clipPathUnits", "userSpaceOnUse");
      const rect = createElement("rect");
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(width));
      rect.setAttribute("height", String(height));
      clipPath.appendChild(rect);
      definitions.appendChild(clipPath);
    });
    svg.appendChild(definitions);
  }

  function ensureCompositeTextClips(svg) {
    if (!svg) return null;
    let definitions = Array.from(svg.children || []).find((child) => child.getAttribute("data-composite-text-clips") === "true");
    if (!definitions) {
      definitions = createElement("defs");
      definitions.setAttribute("data-composite-text-clips", "true");
      svg.appendChild(definitions);
    } else {
      definitions.replaceChildren();
    }
    return definitions;
  }

  function controllerGroupDisplay(group, displayIds) {
    const methodCount = Array.isArray(group.handlerMethods) ? group.handlerMethods.length : 0;
    const endpointCount = Array.isArray(group.endpointIds) ? group.endpointIds.length : 0;
    const memberIds = group.type ? group.nodeIds || [] : group.handlerIds || [];
    const codes = memberIds.map((id) => displayIds.node(id)).sort();
    return {
      primary: group.controllerName || group.controllerFqcn,
      detail: `API ${endpointCount}개 · 메서드 ${methodCount}개`,
      displayId: codes.length > 1 ? `${codes[0]} 외 ${codes.length - 1}개` : codes[0] || "표시 ID 확인 불가"
    };
  }

  function securityChainIndex(graph) {
    const index = new Map();
    (graph.nodes || []).filter((node) => node.type === "SECURITY_CHAIN").forEach((node) => {
      const attributes = node.attributes || {};
      const key = stringValue(attributes.chainKey, "");
      if (!node.serviceId || !key) return;
      const indexKey = `${node.serviceId}\u0000${key}`;
      const matches = index.get(indexKey) || [];
      matches.push(node);
      index.set(indexKey, matches);
    });
    return index;
  }

  function securityGroupContext(group, nodes, graph, nodeById, chainsByKey) {
    const urlPolicies = nodes.filter((node) => node.type === "AUTHORIZATION"
      && node.attributes && node.attributes.policySource === "URL");
    const keyedPolicies = urlPolicies.filter((node) => stringValue(node.attributes.chainKey, ""));
    if (keyedPolicies.length > 0) {
      if (keyedPolicies.length !== urlPolicies.length) return "일부 정책의 Chain 소속 미확정";
      const chains = [];
      for (const policy of keyedPolicies) {
        if (!policy.serviceId) return "Chain 소속 미확정";
        const matches = chainsByKey.get(`${policy.serviceId}\u0000${policy.attributes.chainKey}`) || [];
        if (matches.length !== 1) return "Chain 소속 미확정";
        const chain = matches[0];
        const chainOrder = stringValue(chain.attributes && chain.attributes.chainOrder, "");
        const policyOrder = stringValue(policy.attributes.chainOrder, "");
        if (chainOrder && policyOrder) {
          const chainOrderNumber = /^\d+$/.test(chainOrder) ? Number(chainOrder) : null;
          const policyOrderNumber = /^\d+$/.test(policyOrder) ? Number(policyOrder) : null;
          const orderConflict = chainOrderNumber !== null && policyOrderNumber !== null
            ? chainOrderNumber !== policyOrderNumber : chainOrder !== policyOrder;
          if (orderConflict) return "Chain 소속 미확정";
        }
        if (!chains.some((entry) => entry.id === chain.id)) chains.push(chain);
      }
      const rowChainId = stringValue(group.rowId, "").startsWith("chain:")
        ? String(group.rowId).slice("chain:".length) : "";
      if (rowChainId && chains.some((chain) => chain.id !== rowChainId)) return "표시 행과 직접 소속 Chain 불일치";
      return `${chains.map((chain) => {
        const order = stringValue(chain.attributes && chain.attributes.chainOrder, "");
        return order ? `Chain ${order}` : "Chain 확인 필요";
      }).join(" · ")} 직접 소속`;
    }

    const rowChainId = stringValue(group.rowId, "").startsWith("chain:")
      ? String(group.rowId).slice("chain:".length) : "";
    const chain = rowChainId ? nodeById.get(rowChainId) : null;
    if (!chain) return "Chain 소속 미확정";
    const nodeIds = new Set(group.nodeIds || []);
    const supportEdges = new Set(["SECURED_BY", "READS_SECURITY_DATA", "WRITES_SECURITY_DATA",
      "CONVERTS_TO_AUTHORITY", "USES_FOR_AUTHORIZATION", "SECURITY_STATE"]);
    const hasHandlerRelation = (graph.edges || []).some((edge) => {
      if (edge.confidence !== "CONFIRMED" || !supportEdges.has(edge.type)) return false;
      const relatedId = nodeIds.has(edge.sourceId) ? edge.targetId : nodeIds.has(edge.targetId) ? edge.sourceId : null;
      return relatedId && nodeById.get(relatedId)?.type === "HANDLER";
    });
    const order = stringValue(chain.attributes && chain.attributes.chainOrder, "");
    const context = order ? `Chain ${order}` : "Chain 확인 필요";
    return hasHandlerRelation ? `${context} · Handler 간접 연관` : `${context} · 표시 맥락`;
  }

  function securityGroupDisplay(group, graph, displayIds, suppliedNodeById = null, suppliedChainIndex = null) {
    const nodeById = suppliedNodeById || new Map((graph.nodes || []).map((node) => [node.id, node]));
    const chainsByKey = suppliedChainIndex || securityChainIndex(graph);
    const nodes = (group.nodeIds || []).map((id) => nodeById.get(id)).filter(Boolean);
    const displayId = controllerGroupDisplay(group, displayIds).displayId;
    const context = securityGroupContext(group, nodes, graph, nodeById, chainsByKey);
    if (nodes.length === 0) {
      return { primary: "보안 정보 확인 필요", detail: "원본 확인 필요", context, displayId };
    }

    if (group.type === "AUTHORIZATION") {
      const semantics = nodes.map((node) => window.MapInBootLayout.supportDisplaySemantic(node));
      const semanticKeys = new Set(semantics.map((semantic) => semantic.key));
      const attributes = nodes.map((node) => node.attributes || {});
      if (semanticKeys.size === 1) {
        const semantic = semantics[0];
        const authorities = new Set(attributes.map((item) => stringValue(item.requiredAuthority, "")).filter(Boolean));
        let primary = semantic.primary;
        if (semantic.key === "URL:AUTHORITY_REQUIRED") {
          primary = authorities.size === 1 ? `${Array.from(authorities)[0]} 권한 필요` : "권한 요구";
        }
        if (nodes.length === 1) {
          return { primary, detail: [group.subgroupLabel || "", authorizationDisplay(attributes[0]).detail]
            .filter(Boolean).join(" · "), context, displayId };
        }
        const conditions = new Set(attributes.map((item) => stringValue(item.policyMatcherCondition || item.matcherCondition, ""))
          .filter(Boolean));
        const orders = new Set(attributes.map((item) => stringValue(item.policyOrder, "")).filter(Boolean));
        const methods = new Set(attributes.map((item) => stringValue(item.httpMethod, "")).filter(Boolean));
        const detail = [group.subgroupLabel || "", `${policySourceDisplay(attributes[0].policySource)} ${nodes.length}건`,
          conditions.size === 1 ? `조건 ${matcherDisplay(Array.from(conditions)[0])}`
            : conditions.size > 1 ? `조건 ${conditions.size}종` : "",
          orders.size ? `정책 순서 ${Array.from(orders).sort().join(", ")}` : "",
          methods.size ? `HTTP ${Array.from(methods).sort().join(", ")}` : "",
          semantic.key === "METHOD:DECLARATION"
            ? `선언 ${new Set(attributes.map((item) => item.annotationType || item.declarationKind).filter(Boolean)).size}종` : ""]
          .filter(Boolean).join(" · ");
        return { primary, detail, context, displayId };
      }
      return { primary: `인가 근거 ${nodes.length}건`,
        detail: `${semanticKeys.size}개 의미 유형`, context, displayId };
    }

    if (group.type === "SECURITY_DATA") {
      const displays = nodes.map((node) => securityDataDisplay(node.attributes || {}));
      const actionCounts = new Map();
      displays.forEach((display) => actionCounts.set(display.primary, (actionCounts.get(display.primary) || 0) + 1));
      if (actionCounts.size === 1) {
        return { primary: displays[0].primary,
          detail: [group.subgroupLabel || "", nodes.length === 1 ? displays[0].detail : `관련 정보 ${nodes.length}건`]
            .filter(Boolean).join(" · "),
          context, displayId };
      }
      const kinds = new Set(nodes.map((node) => securityDataKind(node.attributes || {})).filter(Boolean));
      const kind = kinds.size === 1 ? Array.from(kinds)[0] : "";
      const kindLabel = { JWT: "JWT", JWT_CLAIM: "JWT Claim", SESSION: "Session", HEADER: "Request Header",
        PRINCIPAL: "Principal", AUTHORITY: "권한", AUTH_STATUS: "인증 상태", AUTHENTICATION: "인증",
        SECURITY_CONTEXT: "SecurityContext", REQUEST: "요청" }[kind] || "보안 정보";
      const actionEntries = Array.from(actionCounts, ([label, count]) => {
        const action = label.startsWith("JWT Claim ") ? label.slice("JWT Claim ".length)
          : label.startsWith("JWT ") ? label.slice("JWT ".length) : label;
        return `${action} ${count}`;
      });
      const actionLines = [];
      for (let index = 0; index < actionEntries.length; index += 2) {
        actionLines.push(actionEntries.slice(index, index + 2).join(" · "));
      }
      return { primary: `${kindLabel} ${nodes.length}건`, detail: actionLines.join(" · "), detailLines: actionLines,
        context, displayId };
    }

    const displays = nodes.map((node) => nodeDisplay(node));
    const labels = new Map();
    displays.forEach((display) => labels.set(display.primary, (labels.get(display.primary) || 0) + 1));
    if (labels.size === 1) {
      return { primary: displays[0].primary,
        detail: nodes.length === 1 ? displays[0].detail : `관련 보안정보 ${nodes.length}건`,
        context, displayId };
    }
    return { primary: `${nodeTypeLabel(group.type)} ${nodes.length}건`,
      detail: Array.from(labels, ([label, count]) => `${label} ${count}`).join(" · "),
      context, displayId };
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
      : Math.max(640, ...values.map((position) => position.x
        + (Number.isFinite(position.width) ? position.width : NODE_WIDTH) + NODE_PADDING));
    const height = values.length === 0
      ? 360
      : Math.max(360, ...values.map((position) => position.y
        + (Number.isFinite(position.height) ? position.height : NODE_HEIGHT) + NODE_PADDING));
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
      const label = edgeTypeLabel(edge.type);
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

  function renderChainGroup(layer, groupDefinition, plan) {
    const group = createElement("g");
    group.setAttribute("class", "graph-chain-area");
    group.setAttribute("data-chain-id", groupDefinition.id);
    group.setAttribute("data-related", "false");
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
      return { id: groupDefinition.id, nodeIds: groupDefinition.nodeIds || [], element: group };
    }
    const filterLane = plan.lanes.find((lane) => lane.id === "security-filter");
    if (!filterLane || !Number.isInteger(groupDefinition.column)) return null;
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
    return { id: groupDefinition.id, nodeIds: groupDefinition.nodeIds || [], element: group };
  }

  function technicalAreaId(node) {
    if (node.type === "APPLICATION") return "request-entry";
    if (node.type === "SERVLET") return "mvc";
    if (node.type === "FILTER") {
      if (node.attributes && node.attributes.registrationKind === "SERVLET") return "servlet-filter";
      if (node.attributes && node.attributes.registrationKind === "SECURITY") return "spring-security";
      return null;
    }
    if (node.type === "SECURITY_CHAIN") return "spring-security";
    if (node.type === "ENDPOINT") return "api-mapping";
    if (node.type === "HANDLER") return "controller-handler";
    if (["AUTHENTICATION", "AUTHORIZATION", "SECURITY_DATA", "BUSINESS_SECURITY_STATE"].includes(node.type)) {
      return "security-checks";
    }
    return null;
  }

  function renderAreas(graph, positions, layer, plan) {
    if (!layer) return { areas: [], chainAreas: [] };
    layer.replaceChildren();
    const areas = [];
    const runtimeBlueprint = plan && plan.detailBlueprint;
    if (runtimeBlueprint && Array.isArray(runtimeBlueprint.regions)) {
      runtimeBlueprint.regions.forEach((definition) => {
        const bounds = definition.bounds;
        if (!bounds) return;
        const group = createElement("g");
        group.setAttribute("class", "graph-area runtime-blueprint-region");
        group.setAttribute("data-area-id", definition.id);
        group.setAttribute("data-area-kind", definition.kind || "runtime");
        group.setAttribute("data-parent-area-id", definition.parentId || "");
        group.setAttribute("data-coverage", definition.coverage || "UNKNOWN");
        const box = createElement("rect");
        box.setAttribute("class", "graph-area-box runtime-blueprint-region-box");
        box.setAttribute("x", String(bounds.x));
        box.setAttribute("y", String(bounds.y));
        box.setAttribute("width", String(bounds.width));
        box.setAttribute("height", String(bounds.height));
        group.appendChild(box);
        addText(group, "graph-area-label runtime-blueprint-region-label", bounds.x + 12, bounds.y + 21, definition.title);
        layer.appendChild(group);
        areas.push({ id: definition.id, label: definition.title, nodeIds: [], instanceIds: [], bounds: [bounds] });
      });
      if ((!runtimeBlueprint.supported || !runtimeBlueprint.cards.length) && runtimeBlueprint.statusText) {
        const status = createElement("g");
        status.setAttribute("class", "runtime-blueprint-status");
        status.setAttribute("data-runtime-status", runtimeBlueprint.supported ? "UNKNOWN" : "UNSUPPORTED");
        addText(status, "runtime-blueprint-status-text", runtimeBlueprint.bounds.left + 12,
          runtimeBlueprint.bounds.top + 26, runtimeBlueprint.statusText);
        layer.appendChild(status);
      }
    }
    const sourceNodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const composites = plan && plan.displayModel && Array.isArray(plan.displayModel.composites)
      ? plan.displayModel.composites : null;
    if (composites) {
      const areaDefinitions = [
        { id: "servlet-filter", label: "Servlet 필터" },
        { id: "spring-security", label: "Spring Security" },
        { id: "security-checks", label: "보안 점검" },
        { id: "api-mapping", label: "API 매핑" },
        { id: "controller-handler", label: "Controller / Handler" }
      ];
      areaDefinitions.forEach((definition) => {
        const members = composites.filter((card) => card.areaId === definition.id && card.bounds);
        if (!members.length) return;
        const bounds = {
          left: Math.min(...members.map((card) => card.bounds.x)) - 18,
          top: Math.min(...members.map((card) => card.bounds.y)) - 30,
          right: Math.max(...members.map((card) => card.bounds.x + card.bounds.width)) + 18,
          bottom: Math.max(...members.map((card) => card.bounds.y + card.bounds.height)) + 18
        };
        const group = createElement("g");
        group.setAttribute("class", "graph-area");
        group.setAttribute("data-area-id", definition.id);
        group.setAttribute("data-area-kind", "technical");
        const box = createElement("rect");
        box.setAttribute("class", "graph-area-box");
        box.setAttribute("x", String(bounds.left));
        box.setAttribute("y", String(bounds.top));
        box.setAttribute("width", String(bounds.right - bounds.left));
        box.setAttribute("height", String(bounds.bottom - bounds.top));
        group.appendChild(box);
        addText(group, "graph-area-label", bounds.left + 12, bounds.top + 18, definition.label);
        layer.appendChild(group);
        areas.push({ id: definition.id, label: definition.label,
          nodeIds: Array.from(new Set(members.flatMap((card) => card.originalNodeIds || []))),
          instanceIds: members.map((card) => card.id), bounds: [bounds] });
      });
      return { areas, chainAreas: [] };
    }
    const displayInstances = plan && plan.displayModel && Array.isArray(plan.displayModel.instances)
      ? plan.displayModel.instances
      : graph.nodes.map((node) => ({ id: node.id, originalNodeIds: [node.id], displayType: node.type, position: positions[node.id] }));
    const areaDefinitions = [
      { id: "request-entry", label: "요청·진입" },
      { id: "servlet-filter", label: "Servlet 필터" },
      { id: "spring-security", label: "Spring Security" },
      { id: "security-checks", label: "SECURITY CHECKS" },
      { id: "mvc", label: "Servlet / MVC" },
      { id: "api-mapping", label: "API 매핑" },
      { id: "controller-handler", label: "컨트롤러 / 핸들러" }
    ];
    areaDefinitions.forEach((definition) => {
      const members = displayInstances.map((instance) => {
        const node = sourceNodes.get((instance.originalNodeIds || [])[0]);
        const areaNode = node ? { ...node, type: instance.displayType || node.type } : null;
        return { instance, node, areaId: areaNode && technicalAreaId(areaNode), position: instance.position || positions[instance.id] };
      }).filter((item) => item.areaId === definition.id && item.position);
      if (members.length === 0) return;
      const bounds = {
        left: Math.min(...members.map((item) => item.position.x)) - 22,
        top: Math.min(...members.map((item) => item.position.y)) - 30,
        right: Math.max(...members.map((item) => item.position.x + (item.position.width || NODE_WIDTH))) + 22,
        bottom: Math.max(...members.map((item) => item.position.y + (item.position.height || NODE_HEIGHT))) + 22
      };
      const group = createElement("g");
      group.setAttribute("class", "graph-area");
      group.setAttribute("data-area-id", definition.id);
      group.setAttribute("data-area-kind", "technical");
      const box = createElement("rect");
      box.setAttribute("class", "graph-area-box");
      box.setAttribute("x", String(bounds.left));
      box.setAttribute("y", String(bounds.top));
      box.setAttribute("width", String(bounds.right - bounds.left));
      box.setAttribute("height", String(bounds.bottom - bounds.top));
      group.appendChild(box);
      addText(group, "graph-area-label", bounds.left + 12, bounds.top + 18, definition.label);
      layer.appendChild(group);
      areas.push({ id: definition.id, label: definition.label,
        nodeIds: Array.from(new Set(members.flatMap((item) => item.instance.originalNodeIds || []))),
        instanceIds: members.map((item) => item.instance.id), bounds: [bounds] });
    });
    const chainAreas = plan && Array.isArray(plan.chainGroups)
      ? plan.chainGroups.map((group) => renderChainGroup(layer, group, plan)).filter(Boolean)
      : [];
    return { areas, chainAreas };
  }

  function graphFocusNodeIds(focus, rendered) {
    const nodeIds = new Set();
    if (!focus) return nodeIds;
    if (focus.kind === "node") nodeIds.add(focus.id);
    if (focus.kind === "runtime-component") {
      const component = (rendered.nodeElements || []).find((element) =>
        element.getAttribute("data-runtime-component-id") === focus.id
          || (element.getAttribute("data-runtime-component-ids") || "").split(",").includes(focus.id));
      (component && component.getAttribute("data-node-ids") || "").split(",").filter(Boolean)
        .forEach((id) => nodeIds.add(id));
      nodeIds.add(focus.id);
    }
    if (focus.kind === "runtime-relationship") {
      const relation = (rendered.runtimeRelationshipElements || []).find((element) =>
        element.getAttribute("data-runtime-relationship-id") === focus.id);
      (relation && relation.getAttribute("data-node-ids") || "").split(",").filter(Boolean)
        .forEach((id) => nodeIds.add(id));
      (relation && relation.getAttribute("data-runtime-component-ids") || "").split(",").filter(Boolean)
        .forEach((id) => nodeIds.add(id));
    }
    if (focus.kind === "controller-group") return nodeIds;
    return nodeIds;
  }

  function membershipVisible(edge, graph, focus) {
    if (!edge || !focus) return false;
    if (focus.kind === "edge") return focus.id === edge.id;
    if (focus.kind !== "node") return false;
    const node = graph.nodes.find((item) => item.id === focus.id);
    if (!node) return false;
    if (node.type === "SECURITY_CHAIN") return edge.sourceId === node.id;
    if (node.type === "FILTER" && node.attributes && node.attributes.registrationKind === "SECURITY") {
      return edge.targetId === node.id;
    }
    return false;
  }

  function applyGraphEmphasis(rendered, graph, focus, related, retainedRelated) {
    if (!rendered || !graph) return;
    const relatedNodeIds = new Set();
    const relatedEdgeIds = new Set();
    const relatedDisplayItemIds = new Set();
    const relatedCardIds = new Set();
    const relatedVisualRelationIds = new Set();
    const relatedSegmentIds = new Set();
    const relatedJunctionIds = new Set();
    [related, retainedRelated].filter(Boolean).forEach((item) => {
      if (item.nodeIds instanceof Set) item.nodeIds.forEach((id) => relatedNodeIds.add(id));
      if (item.edgeIds instanceof Set) item.edgeIds.forEach((id) => relatedEdgeIds.add(id));
      if (item.displayItemIds instanceof Set) item.displayItemIds.forEach((id) => relatedDisplayItemIds.add(id));
      if (item.cardIds instanceof Set) item.cardIds.forEach((id) => relatedCardIds.add(id));
      if (item.visualRelationIds instanceof Set) item.visualRelationIds.forEach((id) => relatedVisualRelationIds.add(id));
      if (item.segmentIds instanceof Set) item.segmentIds.forEach((id) => relatedSegmentIds.add(id));
      if (item.junctionIds instanceof Set) item.junctionIds.forEach((id) => relatedJunctionIds.add(id));
    });
    const focusNodeIds = graphFocusNodeIds(focus, rendered);
    const matchedChains = new Set((graph.edges || []).filter((edge) => edge.type === "MATCHED_BY"
      && edge.confidence === "CONFIRMED" && focusNodeIds.has(edge.sourceId)
      && graph.nodes.some((node) => node.id === edge.targetId && node.type === "SECURITY_CHAIN"))
      .map((edge) => edge.targetId));
    const focusedChainIds = matchedChains.size === 1 ? matchedChains : new Set();
    const primaryNodeIds = new Set(focusNodeIds);
    const primaryEdgeIds = new Set();
    if (focus && focus.kind === "edge") primaryEdgeIds.add(focus.id);
    if (focusNodeIds.size) {
      graph.edges.forEach((edge) => {
        if (!focusNodeIds.has(edge.sourceId) && !focusNodeIds.has(edge.targetId)) return;
        primaryEdgeIds.add(edge.id);
        primaryNodeIds.add(edge.sourceId);
        primaryNodeIds.add(edge.targetId);
      });
    }
    if (focus && focus.kind === "edge") {
      const selectedEdge = graph.edges.find((edge) => edge.id === focus.id);
      if (selectedEdge) {
        primaryNodeIds.add(selectedEdge.sourceId);
        primaryNodeIds.add(selectedEdge.targetId);
      }
    }
    const nodeState = (element, ids) => {
      if (!focus) return "base";
      if (element.getAttribute("data-selected") === "true") return "primary";
      const itemId = element.getAttribute("data-composite-item-id");
      const cardId = element.getAttribute("data-composite-card-id");
      if (itemId && relatedDisplayItemIds.has(itemId)) return "secondary";
      if (cardId && relatedCardIds.has(cardId)) return "primary";
      if (ids.some((id) => primaryNodeIds.has(id))) return "primary";
      if (ids.some((id) => relatedNodeIds.has(id))) return "secondary";
      return "unrelated";
    };
    (rendered.nodeElements || []).forEach((element) => {
      const ids = [element.getAttribute("data-node-id"), element.getAttribute("data-controller-group-id"),
        ...(element.getAttribute("data-handler-ids") || "").split(","),
        ...(element.getAttribute("data-endpoint-ids") || "").split(","),
        ...(element.getAttribute("data-node-ids") || "").split(","),
        ...(element.getAttribute("data-runtime-component-ids") || "").split(",")].filter(Boolean);
      element.setAttribute("data-emphasis", nodeState(element, ids));
    });
    [...(rendered.edgeElements || []), ...(rendered.edgeTrunkElements || [])].forEach((element) => {
      const edgeIds = (element.getAttribute("data-edge-ids") || element.getAttribute("data-edge-id") || "").split(",").filter(Boolean);
      const nodeIds = (element.getAttribute("data-related-node-ids") || "").split(",").filter(Boolean);
      const flowGroups = (element.getAttribute("data-flow-groups") || "").split(",").filter(Boolean);
      const segmentId = element.getAttribute("data-segment-id");
      const segmentIds = (element.getAttribute("data-segment-ids") || segmentId || "").split(",").filter(Boolean);
      const relationIds = (element.getAttribute("data-relation-ids") || "").split(",").filter(Boolean);
      const visualRelated = focus && relatedVisualRelationIds.size
        ? relationIds.some((id) => relatedVisualRelationIds.has(id)) : false;
      const segmentRelated = focus && relatedSegmentIds.size ? segmentIds.some((id) => relatedSegmentIds.has(id)) : visualRelated;
      const emphasis = !focus ? "base"
        : segmentId && segmentIds.includes(focus.segmentId) ? "primary"
          : segmentId ? segmentRelated ? "secondary" : "unrelated"
        : edgeIds.some((id) => primaryEdgeIds.has(id)) || nodeIds.some((id) => focusNodeIds.has(id))
          || flowGroups.some((id) => focusedChainIds.has(id)) ? "primary"
          : edgeIds.some((id) => relatedEdgeIds.has(id)) ? "secondary" : "unrelated";
      element.setAttribute("data-emphasis", emphasis);
      if (segmentId) element.setAttribute("data-related", String(emphasis !== "unrelated"));
      if (element.getAttribute("data-reference-only") === "true") {
        element.setAttribute("data-reference-visible", String(Boolean(focus) && emphasis !== "unrelated"));
      }
      const membershipIds = edgeIds.filter((id) => rendered.securityMembershipEdgeIds
        && rendered.securityMembershipEdgeIds.has(id));
      if (membershipIds.length) {
        const edgeById = rendered.edgeById || new Map((graph.edges || []).map((edge) => [edge.id, edge]));
        element.setAttribute("data-membership-visible", String(membershipIds.some((id) =>
          membershipVisible(edgeById.get(id), graph, focus))));
      }
    });
    (rendered.edgeLabelElements || []).forEach((element) => {
      const edgeId = element.getAttribute("data-edge-id");
      const edgeIds = (element.getAttribute("data-edge-ids") || edgeId || "").split(",").filter(Boolean);
      const emphasis = !focus ? "base"
        : edgeIds.some((id) => primaryEdgeIds.has(id)) ? "primary"
          : edgeIds.some((id) => relatedEdgeIds.has(id)) ? "secondary" : "unrelated";
      element.setAttribute("data-emphasis", emphasis);
      if (element.getAttribute("data-overview-label") === "true") {
        element.setAttribute("data-visible", String(element.getAttribute("data-collision") !== "true"
          && Boolean(focus && focus.kind === "edge" && edgeIds.includes(focus.id))));
      }
      if (rendered.securityMembershipEdgeIds && rendered.securityMembershipEdgeIds.has(edgeId)) {
        const edgeById = rendered.edgeById || new Map((graph.edges || []).map((edge) => [edge.id, edge]));
        element.setAttribute("data-membership-visible", String(membershipVisible(edgeById.get(edgeId), graph, focus)));
      }
    });
    (rendered.chainAreas || []).forEach((area) => {
      if (!area.element) return;
      area.element.setAttribute("data-related", String((area.nodeIds || []).some((id) => relatedNodeIds.has(id))));
    });
    (rendered.junctionElements || []).forEach((element) => {
      const id = element.getAttribute("data-junction-id");
      element.setAttribute("data-related", String(!focus || relatedJunctionIds.has(id)));
      element.setAttribute("data-emphasis", !focus ? "base" : relatedJunctionIds.has(id) ? "secondary" : "unrelated");
    });
  }

  function securityMembershipEdgeIds(graph, options) {
    const ids = new Set(options.layoutPlan && Array.isArray(options.layoutPlan.securityMembershipEdgeIds)
      ? options.layoutPlan.securityMembershipEdgeIds : []);
    if (ids.size) return ids;
    const flowIndex = options.flowIndex || (window.MapInBootFlow && window.MapInBootFlow.createIndex
      ? window.MapInBootFlow.createIndex(graph)
      : null);
    if (!flowIndex || typeof flowIndex.securityFiltersForChain !== "function") return ids;
    graph.nodes.filter((node) => node.type === "SECURITY_CHAIN").forEach((chain) => {
      const result = flowIndex.securityFiltersForChain(chain.id);
      (result.edges || []).forEach((edge) => ids.add(edge.id));
    });
    return ids;
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
      const controller = handler && (plan.controllerGroups || []).find((group) => (group.handlerIds || []).includes(handler.id)
        && (detailMode || (group.endpointIds || []).includes(endpoint.id)));
      const target = handler && !detailMode && controller ? controller.position : handler && positions[handler.id];
      if (!source || !target) return;
      const related = guideRelated(plan, endpoint.id, handler.id, selection);
      const path = createElement("path");
      path.setAttribute("class", "graph-guide graph-guide-handler");
      path.setAttribute("data-guide-kind", "endpoint-handler");
      path.setAttribute("data-endpoint-id", endpoint.id);
      path.setAttribute("data-handler-id", handler.id);
      path.setAttribute("data-related", String(related));
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
      return groupNodeIds.has(edge.sourceId) || groupNodeIds.has(edge.targetId)
        || (edge.relatedNodeIds || []).some((id) => groupNodeIds.has(id));
    }
    if (selection.kind === "node" && (edge.relatedNodeIds || []).includes(selection.id)) return true;
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
    if (selectedChainId && (edge.flowGroup === selectedChainId || (edge.flowGroups || []).includes(selectedChainId))) return true;
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
    projection.edges.forEach((edge) => {
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
      path.setAttribute("data-projection-purpose", edge.projectionKind || "education");
      path.setAttribute("data-flow-group", edge.flowGroup || "");
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
      if (node.chainId) group.setAttribute("data-chain-id", node.chainId);
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
    const composite = Boolean(plan && plan.displayModel && plan.displayModel.composites
      && plan.displayModel.composites.length);
    const displayEntries = composite ? entries.flatMap((section) =>
      (plan.findingSectionLayouts || []).filter((item) => item.findingId === section.finding.id)
        .map((planned) => ({ section, planned }))) : entries.map((section) => ({ section, planned: null }));
    displayEntries.forEach(({ section, planned: compositePlan }) => {
      const nodes = (section.nodeIds || []).map((id) => nodeById.get(id)).filter(Boolean);
      const located = nodes.map((node) => positions[node.id]).filter(Boolean);
      if (!composite && located.length === 0) return;
      const planned = compositePlan || (plan && Array.isArray(plan.findingSectionLayouts)
        ? plan.findingSectionLayouts.find((item) => item.findingId === section.finding.id)
        : null);
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
      const label = `${section.finding.title || "진단 항목"} · ${confidenceLabel(confidence)}`;
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

  function applyGraphViewState(svg, options) {
    if (!svg) return;
    svg.setAttribute("data-view", options.view || "all-flow");
    svg.setAttribute("data-selection-active", String(Boolean(options.selection)));
  }

  function renderRuntimeBlueprintEdges(layer, blueprint, options, graph, elements) {
    if (!layer || !blueprint || !Array.isArray(blueprint.relations)) return;
    const cards = new Map((blueprint.cards || []).map((card) => [card.runtimeComponentIds[0], card]));
    blueprint.relations.forEach((relation) => {
      const source = cards.get(relation.sourceId);
      const target = cards.get(relation.targetId);
      if (!source || !target) return;
      const path = createElement("path");
      path.setAttribute("class", "runtime-blueprint-edge");
      path.setAttribute("d", relation.d);
      path.setAttribute("data-runtime-relationship-id", relation.id);
      path.setAttribute("data-runtime-relationship-kind", relation.kind);
      path.setAttribute("data-runtime-area", source.regionId || "");
      path.setAttribute("data-confidence", relation.confidence || "UNKNOWN");
      path.setAttribute("data-runtime-component-ids", `${relation.sourceId},${relation.targetId}`);
      path.setAttribute("data-node-ids", Array.from(new Set([...(source.originalNodeIds || []), ...(target.originalNodeIds || [])])).join(","));
      path.setAttribute("data-evidence-ids", (relation.evidenceRefs || []).join(","));
      path.setAttribute("data-selected", String(Boolean(options.selection && options.selection.kind === "runtime-relationship"
        && options.selection.id === relation.id)));
      path.setAttribute("data-related", String(!options.selection
        || (source.runtimeComponentIds || []).includes(options.selection.id)
        || (target.runtimeComponentIds || []).includes(options.selection.id)));
      path.setAttribute("tabindex", "0");
      path.setAttribute("role", "button");
      path.setAttribute("aria-label", `Runtime 관계 ${relation.kind}`);
      const select = (event) => {
        if (event && event.stopPropagation) event.stopPropagation();
        if (options.onRuntimeRelationshipClick) options.onRuntimeRelationshipClick(relation.id, path);
      };
      path.addEventListener("click", select);
      path.addEventListener("keydown", (event) => {
        if (!event || (event.key !== "Enter" && event.key !== " ")) return;
        if (event.preventDefault) event.preventDefault();
        select(event);
      });
      if (options.onRuntimeRelationshipFocus) path.addEventListener("focus", () => options.onRuntimeRelationshipFocus(relation.id, path));
      if (options.onRuntimeRelationshipBlur) path.addEventListener("blur", () => options.onRuntimeRelationshipBlur(relation.id, path));
      if (options.onRuntimeRelationshipHover) path.addEventListener("mouseenter", () => options.onRuntimeRelationshipHover(relation.id, path));
      if (options.onRuntimeRelationshipLeave) path.addEventListener("mouseleave", () => options.onRuntimeRelationshipLeave(relation.id, path));
      layer.appendChild(path);
      elements.push(path);
    });
  }

  function renderRuntimeBlueprintCards(layer, blueprint, options, findings, relatedNodeIds) {
    if (!layer || !blueprint || !Array.isArray(blueprint.cards)) return [];
    const nodes = [];
    blueprint.cards.forEach((definition) => {
      const bounds = definition.bounds;
      if (!bounds) return;
      const component = definition.component || {};
      const graphNodeIds = definition.originalNodeIds || [];
      const componentId = (definition.runtimeComponentIds || [])[0];
      const hasFinding = findings.some((entry) => (entry.nodeIds || []).some((id) => graphNodeIds.includes(id))
        || (entry.edgeIds || []).some((id) => (definition.originalEdgeIds || []).includes(id)));
      const card = createElement("g");
      card.setAttribute("class", "runtime-blueprint-card");
      card.setAttribute("transform", `translate(${bounds.x} ${bounds.y})`);
      card.setAttribute("data-runtime-component-id", componentId || "");
      card.setAttribute("data-runtime-kind", definition.kind || "UNKNOWN");
      card.setAttribute("data-runtime-area", definition.regionId || "");
      card.setAttribute("data-node-ids", graphNodeIds.join(","));
      card.setAttribute("data-evidence-ids", (definition.evidenceRefs || []).join(","));
      card.setAttribute("data-has-finding", String(hasFinding));
      card.setAttribute("data-selected", String(Boolean(options.selection && options.selection.kind === "runtime-component"
        && options.selection.id === componentId)));
      card.setAttribute("data-related", String(!options.selection || graphNodeIds.some((id) => relatedNodeIds.has(id))
        || (options.selection.kind === "runtime-component" && options.selection.id === componentId)));
      card.setAttribute("tabindex", "0");
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `${definition.title} · ${definition.kind}`);
      const select = (event) => {
        if (event && event.stopPropagation) event.stopPropagation();
        if (options.onRuntimeComponentClick) options.onRuntimeComponentClick(componentId, card);
      };
      card.addEventListener("click", select);
      card.addEventListener("keydown", (event) => {
        if (!event || (event.key !== "Enter" && event.key !== " ")) return;
        if (event.preventDefault) event.preventDefault();
        select(event);
      });
      if (options.onRuntimeComponentFocus) card.addEventListener("focus", () => options.onRuntimeComponentFocus(componentId, card));
      if (options.onRuntimeComponentBlur) card.addEventListener("blur", () => options.onRuntimeComponentBlur(componentId, card));
      if (options.onRuntimeComponentHover) card.addEventListener("mouseenter", () => options.onRuntimeComponentHover(componentId, card));
      if (options.onRuntimeComponentLeave) card.addEventListener("mouseleave", () => options.onRuntimeComponentLeave(componentId, card));

      const surface = createElement("rect");
      surface.setAttribute("class", "runtime-blueprint-card-surface");
      surface.setAttribute("width", String(bounds.width));
      surface.setAttribute("height", String(bounds.height));
      surface.setAttribute("rx", "5");
      card.appendChild(surface);
      addNodeText(card, "runtime-blueprint-card-kind", 10, 15, definition.kind || "Runtime", bounds.width - 20, 28);
      addNodeText(card, "runtime-blueprint-card-title", 10, 34, definition.title || "구성 객체", bounds.width - 20, 30);
      addNodeText(card, "runtime-blueprint-card-detail", 10, 52, definition.detail || "", bounds.width - 20, 32);
      const input = createElement("circle");
      input.setAttribute("class", "runtime-blueprint-port runtime-blueprint-port-in");
      input.setAttribute("cx", "0");
      input.setAttribute("cy", String(bounds.height / 2));
      input.setAttribute("r", "3");
      card.appendChild(input);
      const output = createElement("circle");
      output.setAttribute("class", "runtime-blueprint-port runtime-blueprint-port-out");
      output.setAttribute("cx", String(bounds.width));
      output.setAttribute("cy", String(bounds.height / 2));
      output.setAttribute("r", "3");
      card.appendChild(output);
      layer.appendChild(card);
      nodes.push(card);
    });
    return nodes;
  }

  function render(graph, layers, options = {}) {
    const findings = Array.isArray(options.findings) ? options.findings : [];
    const displayIds = options.displayIds || createDisplayIds(graph);
    if (graph.nodes.length > 0 && layers.svg) layers.svg.removeAttribute("hidden");
    ensureNodeTextClips(layers.svg);
    const compositeTextClips = ensureCompositeTextClips(layers.svg);
    let compositeTextClipIndex = 0;
    const compositeTextClip = (x, y, width, height) => {
      if (!compositeTextClips || width <= 0 || height <= 0) return "";
      const id = `graph-composite-text-clip-${compositeTextClipIndex++}`;
      const clipPath = createElement("clipPath");
      clipPath.setAttribute("id", id);
      clipPath.setAttribute("class", "graph-composite-text-clip");
      clipPath.setAttribute("clipPathUnits", "userSpaceOnUse");
      const rect = createElement("rect");
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(width));
      rect.setAttribute("height", String(height));
      clipPath.appendChild(rect);
      compositeTextClips.appendChild(clipPath);
      return `url(#${id})`;
    };
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
        const label = `${finding.title || "진단 항목"} · ${findingRuleLabel(finding.ruleId)} · ${confidenceLabel(finding.confidence)}`;
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
    const overviewInstances = options.layoutPlan && options.layoutPlan.displayModel
      && Array.isArray(options.layoutPlan.displayModel.instances) ? options.layoutPlan.displayModel.instances : null;
    const displayModel = options.layoutPlan && options.layoutPlan.displayModel;
    const compositeCards = displayModel && Array.isArray(displayModel.composites) ? displayModel.composites : null;
    const hasCompositeCards = Boolean(compositeCards);
    const canonicalItemByNodeId = new Map();
    const canonicalItemByEdgeId = new Map();
    if (compositeCards) compositeCards.forEach((card) => (card.items || []).forEach((item) => {
      if (!item.isHeader && !item.bounds) return;
      (item.originalNodeIds || []).forEach((id) => { if (!canonicalItemByNodeId.has(id)) canonicalItemByNodeId.set(id, item.id); });
      (item.originalEdgeIds || []).forEach((id) => { if (!canonicalItemByEdgeId.has(id)) canonicalItemByEdgeId.set(id, item.id); });
    }));
    const findingsForItem = (item) => findings.filter((entry) => {
      const nodeMatch = (entry.nodeIds || []).some((id) => canonicalItemByNodeId.get(id) === item.id);
      const edgeMatch = !(entry.nodeIds || []).length
        && (entry.edgeIds || []).some((id) => canonicalItemByEdgeId.get(id) === item.id);
      return nodeMatch || edgeMatch;
    });
    const visibleOriginalIds = overviewInstances && new Set(overviewInstances.flatMap((instance) => instance.originalNodeIds));
    const positions = positionsFor(visibleOriginalIds
      ? graph.nodes.filter((node) => visibleOriginalIds.has(node.id)) : graph.nodes, options.positions);
    applyGraphViewState(layers.svg, options);
    const visibleIds = new Set(graph.nodes.map((node) => node.id));
    const controllerGroups = !options.detailMode && options.layoutPlan && Array.isArray(options.layoutPlan.controllerGroups)
      ? options.layoutPlan.controllerGroups.concat(options.layoutPlan.displayModel ? options.layoutPlan.displayModel.groups : [])
        .filter((group) => (group.handlerIds || []).every((id) => visibleIds.has(id)))
      : [];
    const groupedHandlerIds = new Set(controllerGroups.flatMap((group) => group.handlerIds || []));
    const displayPositions = overviewInstances ? {} : { ...positions };
    controllerGroups.forEach((group) => {
      displayPositions[group.id] = group.position;
    });
    if (displayModel && Array.isArray(displayModel.instances)) {
      displayModel.instances.forEach((instance) => {
        displayPositions[instance.id] = instance.position;
        (instance.originalNodeIds || []).forEach((nodeId) => { displayPositions[nodeId] = instance.position; });
      });
    }
    const size = graphSize(displayPositions, options.bounds);
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const chainsByKey = securityChainIndex(graph);
    const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
    const selection = options.selection || null;
    const membershipEdgeIds = securityMembershipEdgeIds(graph, options);
    const relatedNodeIds = options.related && options.related.nodeIds instanceof Set
      ? options.related.nodeIds
      : new Set();
    const relatedEdgeIds = options.related && options.related.edgeIds instanceof Set
      ? options.related.edgeIds
      : new Set();
    const edgePairCounts = new Map();
    const edgeElements = [];
    const edgeTrunkElements = [];
    const edgeLabelElements = [];
    const junctionElements = [];
    const nodeElements = [];
    const runtimeRelationshipElements = [];
    const compositeItemElements = [];
    const compositeCardElements = [];
    const runtimeBlueprint = null;
    const areaResult = renderAreas(graph, displayPositions, layers.areaLayer, options.layoutPlan);
    const overviewRouting = options.layoutPlan && options.layoutPlan.overviewRouting;
    let guides;
    if (overviewRouting || (options.findingDetailMode && !options.detailMode)) {
      if (layers.guideLayer) layers.guideLayer.replaceChildren();
      guides = [];
    } else {
      guides = renderGuides(graph, displayPositions, layers.guideLayer, options.layoutPlan, options.flowIndex, selection, options.detailMode);
    }
    let projection;
    if (overviewRouting || (options.findingDetailMode && !options.detailMode)) {
      if (layers.projectionLayer) layers.projectionLayer.replaceChildren();
      projection = { nodes: [], edges: [] };
    } else {
      projection = renderProjection(graph, displayPositions, layers.projectionLayer, options.layoutPlan && options.layoutPlan.projection, options.layoutPlan || {}, options);
    }
    const renderEdgeRoutes = { ...(options.edgeRoutes || {}) };
    const displayRouteEdgeIds = new Set();
    const edgeViews = !options.detailMode && displayModel && Array.isArray(displayModel.displayEdgeInstances)
      ? displayModel.displayEdgeInstances.filter((instance) => !instance.selfConnection).map((instance) => {
        const original = edgeById.get(instance.originalEdgeIds[0]);
        if (!original) return null;
        const route = options.layoutPlan.displayEdgeInstanceRoutes
          && options.layoutPlan.displayEdgeInstanceRoutes[instance.id];
        if (route) {
          renderEdgeRoutes[instance.id] = route;
          displayRouteEdgeIds.add(instance.id);
        }
        return { ...original, originalEdgeId: original.id, originalSourceId: original.sourceId,
          originalTargetId: original.targetId, originalEdgeIds: instance.originalEdgeIds,
          id: original.id, routeId: instance.id, rowId: instance.rowId,
          sourceId: instance.sourceInstanceId, targetId: instance.targetInstanceId };
      }).filter(Boolean)
      : graph.edges.map((edge) => ({ ...edge, originalEdgeId: edge.id, originalSourceId: edge.sourceId,
        originalTargetId: edge.targetId, originalEdgeIds: [edge.id], routeId: edge.id, rowId: null }));
    const labelGraph = {
      nodes: displayModel && Array.isArray(displayModel.instances)
        ? displayModel.instances.map((instance) => ({ id: instance.id, type: instance.displayType })) : graph.nodes,
      edges: edgeViews
    };
    const labelPositions = placeEdgeLabels(labelGraph, displayPositions, renderEdgeRoutes, options);
    layers.edgeLayer.replaceChildren();
    layers.nodeLayer.replaceChildren();
    renderRuntimeBlueprintEdges(layers.edgeLayer, runtimeBlueprint, options, graph, runtimeRelationshipElements);
    layers.svg.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
    layers.svg.setAttribute("data-layout-mode", options.layoutMode || "initial");
    if (layers.viewport) layers.viewport.setAttribute("data-layout-mode", options.layoutMode || "initial");

    const bundles = new Map();
    edgeViews.forEach((edge) => {
      const key = !options.detailMode ? JSON.stringify([edge.rowId, edge.sourceId, edge.targetId, edge.type]) : edge.id;
      const bundle = bundles.get(key) || { edge, edgeIds: [], routeIds: [] };
      (edge.originalEdgeIds || [edge.id]).forEach((id) => {
        if (!bundle.edgeIds.includes(id)) bundle.edgeIds.push(id);
      });
      bundle.routeIds.push(edge.routeId);
      bundles.set(key, bundle);
    });
    const availableEdgeIds = new Set(edgeViews.map((edge) => edge.routeId));
    const candidateRouteGroups = overviewRouting ? [] : options.detailMode
      ? options.layoutPlan && options.layoutPlan.commonEdgeRouteGroups || []
      : options.layoutPlan && options.layoutPlan.displayCommonEdgeRouteGroups || [];
    const routeGroups = candidateRouteGroups.filter((group) =>
      (group.edgeIds || []).length > 1 && group.edgeIds.every((id) =>
        availableEdgeIds.has(id) && renderEdgeRoutes[id]
        && (options.detailMode || displayRouteEdgeIds.has(id))));
    const rendererRouteFallbacks = candidateRouteGroups.filter((group) => !routeGroups.includes(group))
      .map((group) => {
        const missingId = (group.edgeIds || []).find((id) => !availableEdgeIds.has(id));
        const missingRouteId = !missingId && (group.edgeIds || []).find((id) => !renderEdgeRoutes[id]);
        return { groupId: group.id, reason: missingId ? "display-instance-missing"
          : missingRouteId ? "route-missing" : "display-route-missing" };
      });
    layers.svg.setAttribute("data-common-route-group-count", String(candidateRouteGroups.length));
    layers.svg.setAttribute("data-common-route-rendered-count", String(routeGroups.length));
    layers.svg.setAttribute("data-common-route-fallbacks", JSON.stringify([
      ...(options.layoutPlan && (options.detailMode
        ? options.layoutPlan.commonEdgeRouteFallbacks : options.layoutPlan.displayCommonEdgeRouteFallbacks) || []),
      ...rendererRouteFallbacks
    ]));
    const edgeViewByRouteId = new Map(edgeViews.map((edge) => [edge.routeId, edge]));
    const routeGroupByEdgeId = new Map();
    routeGroups.forEach((group) => (group.edgeIds || []).forEach((id) => routeGroupByEdgeId.set(id, group)));
    const renderedRouteGroups = new Set();
    routeGroups.forEach((group) => {
      if (!group.edgeIds || group.edgeIds.length < 2 || renderedRouteGroups.has(group.id)) return;
      const style = edgeStyles[group.type];
      if (!style) return;
      const originalIds = Array.from(new Set(group.edgeIds.flatMap((id) =>
        edgeViewByRouteId.get(id)?.originalEdgeIds || [id])));
      const trunk = createElement("path");
      trunk.setAttribute("class", "graph-edge graph-edge-trunk");
      trunk.setAttribute("d", group.trunk.d);
      trunk.setAttribute("data-common-group-id", group.id);
      trunk.setAttribute("data-edge-ids", originalIds.join(","));
      trunk.setAttribute("data-edge-type", group.type);
      trunk.setAttribute("data-edge-layer", group.type === "FLOWS_TO" ? "flow" : "analysis");
      trunk.setAttribute("data-source-ids", (group.sourceIds || []).join(","));
      trunk.setAttribute("data-target-ids", (group.targetIds || []).join(","));
      trunk.setAttribute("data-has-finding", String(findings.some((entry) =>
        entry.edgeIds.some((id) => originalIds.includes(id)))));
      trunk.setAttribute("data-selected", String(Boolean(selection && selection.kind === "edge" && originalIds.includes(selection.id))));
      trunk.setAttribute("data-related", String(!selection || originalIds.some((id) => relatedEdgeIds.has(id))));
      trunk.setAttribute("stroke", style.color);
      trunk.setAttribute("stroke-dasharray", style.dash);
      if (group.sharedTarget && group.targetIds.length === 1) trunk.setAttribute("marker-end", "url(#graph-arrow)");
      trunk.setAttribute("pointer-events", "none");
      trunk.setAttribute("aria-hidden", "true");
      layers.edgeLayer.appendChild(trunk);
      edgeTrunkElements.push(trunk);
      renderedRouteGroups.add(group.id);
    });
    if (!overviewRouting) Array.from(bundles.values()).forEach(({ edge, edgeIds, routeIds }) => {
      const source = displayPositions[edge.sourceId];
      const target = displayPositions[edge.targetId];
      if (!source || !target) return;
      const pairKey = `${edge.sourceId}\u0000${edge.targetId}`;
      const parallelIndex = edgePairCounts.get(pairKey) || 0;
      edgePairCounts.set(pairKey, parallelIndex + 1);
      const style = edgeStyles[edge.type];
      const routeGroup = routeGroupByEdgeId.get(edge.routeId);
      const usesCommonRoute = routeGroup && routeIds.every((id) => routeGroupByEdgeId.get(id) === routeGroup);
      const branchRoute = usesCommonRoute && routeGroup.branches[edge.routeId];
      const branchEndsAtSharedTarget = usesCommonRoute && routeGroup.sharedTarget && routeGroup.targetIds.length === 1;
      const path = createElement("path");
      const isSecurityMembership = edgeIds.some((id) => membershipEdgeIds.has(id));
      path.setAttribute("class", `graph-edge${usesCommonRoute ? " graph-edge-branch" : ""}${isSecurityMembership ? " graph-edge-security-filter-membership" : ""}`);
      path.setAttribute("d", routedPath(branchRoute || renderEdgeRoutes[edge.routeId], edgePath(source, target, parallelIndex)));
      path.setAttribute("data-edge-id", edge.id);
      path.setAttribute("data-edge-instance-id", edge.routeId);
      path.setAttribute("data-edge-ids", edgeIds.join(","));
      path.setAttribute("data-edge-type", edge.type);
      path.setAttribute("data-edge-layer", edge.type === "FLOWS_TO" ? "flow" : "analysis");
      if (usesCommonRoute) path.setAttribute("data-common-group-id", routeGroup.id);
      if (isSecurityMembership) path.setAttribute("data-membership-kind", "security-chain");
      path.setAttribute("data-source-id", edge.originalSourceId);
      path.setAttribute("data-target-id", edge.originalTargetId);
      path.setAttribute("data-display-source-id", edge.sourceId);
      path.setAttribute("data-display-target-id", edge.targetId);
      path.setAttribute("data-confidence", edge.confidence);
      path.setAttribute("data-evidence-ids", edge.evidenceIds.join(","));
      path.setAttribute("data-has-finding", String(findings.some((entry) => entry.edgeIds.some((id) => edgeIds.includes(id)))));
      path.setAttribute("tabindex", "0");
      path.setAttribute("role", "button");
      path.setAttribute("aria-label", `${edgeTypeLabel(edge.type)} · ${displayIds.node(edge.originalSourceId)} → ${displayIds.node(edge.originalTargetId)}`);
      path.setAttribute("data-selected", String(Boolean(selection && selection.kind === "edge" && edgeIds.includes(selection.id))));
      path.setAttribute("data-related", String(!selection || edgeIds.some((id) => relatedEdgeIds.has(id))));
      path.setAttribute("stroke", style.color);
      path.setAttribute("stroke-dasharray", style.dash);
      if (!branchEndsAtSharedTarget) path.setAttribute("marker-end", "url(#graph-arrow)");
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
      label.setAttribute("data-edge-instance-id", edge.routeId);
      label.setAttribute("data-edge-ids", edgeIds.join(","));
      label.setAttribute("data-edge-type", edge.type);
      label.setAttribute("data-edge-layer", edge.type === "FLOWS_TO" ? "flow" : "analysis");
      if (isSecurityMembership) label.setAttribute("data-membership-kind", "security-chain");
      label.setAttribute("data-selected", String(Boolean(selection && selection.kind === "edge" && selection.id === edge.id)));
      label.setAttribute("data-related", String(!selection || relatedEdgeIds.has(edge.id)));
      const labelPosition = labelPositions.get(edge.routeId) || edgeLabelPosition(source, target, parallelIndex, renderEdgeRoutes[edge.routeId]);
      label.setAttribute("x", String(labelPosition.x));
      label.setAttribute("y", String(labelPosition.y));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("data-visible", String(labelPosition.visible !== false
        && shouldShowEdgeLabel(edge, options, relatedEdgeIds)));
      label.setAttribute("data-collision", String(Boolean(labelPosition.collision)));
      label.setAttribute("fill", style.color);
      label.textContent = edgeTypeLabel(edge.type);
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

    if (overviewRouting) {
      const relations = new Map(overviewRouting.relations.map((relation) => [relation.id, relation]));
      const markedFindings = new Set();
      const labeledRelations = new Set();
      let maskDefs = Array.from(layers.svg.children || []).find((child) => child.getAttribute("data-overview-mask") === "true");
      if (!maskDefs) {
        maskDefs = createElement("defs");
        maskDefs.setAttribute("data-overview-mask", "true");
        layers.svg.appendChild(maskDefs);
      }
      const mask = createElement("mask");
      mask.setAttribute("id", "graph-overview-trunk-mask");
      mask.setAttribute("maskUnits", "userSpaceOnUse");
      mask.setAttribute("x", "-100000");
      mask.setAttribute("y", "-100000");
      mask.setAttribute("width", "200000");
      mask.setAttribute("height", "200000");
      const background = createElement("rect");
      background.setAttribute("x", "-100000");
      background.setAttribute("y", "-100000");
      background.setAttribute("width", "200000");
      background.setAttribute("height", "200000");
      background.setAttribute("fill", "white");
      mask.appendChild(background);
      overviewInstances.forEach((instance) => {
        const position = instance.position;
        if (!position) return;
        const card = createElement("rect");
        card.setAttribute("x", String(position.x));
        card.setAttribute("y", String(position.y));
        card.setAttribute("width", String(position.width || NODE_WIDTH));
        card.setAttribute("height", String(position.height || NODE_HEIGHT));
        card.setAttribute("fill", "black");
        mask.appendChild(card);
      });
      maskDefs.replaceChildren(mask);
      layers.svg.setAttribute("data-unresolved-routes", JSON.stringify(overviewRouting.unresolved));
      // 동일 기하의 표시 선분만 합치고 관계별 Segment와 원본 근거 유지
      const physicalSegments = new Map();
      overviewRouting.segments.forEach((segment) => {
        const points = [segment.from, ...(segment.geometry?.kind === "CUBIC"
          ? segment.geometry.controlPoints : []), segment.to].map((point) => [point.x, point.y]);
        const forward = JSON.stringify(points);
        const reverse = JSON.stringify(points.slice().reverse());
        const key = `${segment.geometry?.kind === "CUBIC" ? "CUBIC" : "LINE"}:${forward < reverse ? forward : reverse}`;
        const existing = physicalSegments.get(key);
        if (existing) {
          existing.segmentIds.push(segment.id);
          existing.relationIds = Array.from(new Set([...existing.relationIds, ...segment.relationIds]));
          Object.assign(existing.routeRolesByRelationId, segment.routeRolesByRelationId || {});
          if (segment.routeRole === "TRUNK") existing.routeRole = "TRUNK";
        } else {
          physicalSegments.set(key, { ...segment, segmentIds: [segment.id],
            relationIds: segment.relationIds.slice(), routeRolesByRelationId: { ...segment.routeRolesByRelationId } });
        }
      });
      physicalSegments.forEach((segment) => {
        const members = segment.relationIds.map((id) => relations.get(id)).filter(Boolean);
        if (!members.length) return;
        const originalIds = Array.from(new Set(members.flatMap((relation) => relation.originalEdgeIds || [])));
        const runtimeRelationIds = Array.from(new Set(members.flatMap((relation) => relation.runtimeRelationshipIds || [])));
        const runtimeComponentIds = Array.from(new Set(members.flatMap((relation) => relation.runtimeComponentIds || [])));
        const projectionEdgeIds = Array.from(new Set(members.flatMap((relation) => relation.projectionEdgeIds || [])));
        const relation = members[0];
        const style = edgeStyles[relation.type];
        const runtimeReference = runtimeRelationIds.length > 0 && projectionEdgeIds.length === 0;
        const targetRoute = members.map((member) => overviewRouting.routesByRelationId[member.id])
          .find((route) => route && segment.segmentIds.includes(route.orderedSegmentIds.at(-1)));
        const reverse = targetRoute && targetRoute.targetPort.x === segment.from.x && targetRoute.targetPort.y === segment.from.y;
        const start = reverse ? segment.to : segment.from;
        const end = reverse ? segment.from : segment.to;
        const path = createElement("path");
        path.setAttribute("class", `graph-edge graph-overview-segment${style ? "" : runtimeReference
          ? " graph-runtime-blueprint-edge runtime-blueprint-edge" : " graph-projection-edge"}`);
        if (segment.geometry && segment.geometry.kind === "CUBIC" && segment.geometry.controlPoints.length === 2) {
          const controls = reverse ? segment.geometry.controlPoints.slice().reverse() : segment.geometry.controlPoints;
          path.setAttribute("d", `M ${start.x} ${start.y} C ${controls[0].x} ${controls[0].y}, ${controls[1].x} ${controls[1].y}, ${end.x} ${end.y}`);
          path.setAttribute("data-segment-geometry", "CUBIC");
        } else {
          path.setAttribute("d", `M ${start.x} ${start.y} L ${end.x} ${end.y}`);
          path.setAttribute("data-segment-geometry", "LINE");
        }
        path.setAttribute("data-segment-id", segment.id);
        path.setAttribute("data-segment-ids", segment.segmentIds.join(","));
        path.setAttribute("data-route-role", segment.routeRole || "DIRECT");
        path.setAttribute("data-route-roles", JSON.stringify(segment.routeRolesByRelationId || {}));
        if (segment.routeRole === "TRUNK" && segment.relationIds.length > 1) {
          path.setAttribute("mask", "url(#graph-overview-trunk-mask)");
        }
        path.setAttribute("data-relation-ids", segment.relationIds.join(","));
        path.setAttribute("data-runtime-relationship-ids", runtimeRelationIds.join(","));
        if (runtimeRelationIds.length) path.setAttribute("data-runtime-relationship-id", runtimeRelationIds[0]);
        path.setAttribute("data-runtime-component-ids", runtimeComponentIds.join(","));
        path.setAttribute("data-projection-edge-ids", projectionEdgeIds.join(","));
        path.setAttribute("data-confidence", members.every((member) => member.confidence === "CONFIRMED")
          ? "CONFIRMED" : members.some((member) => member.confidence === "PARTIAL") ? "PARTIAL" : "UNKNOWN");
        if (runtimeReference) path.setAttribute("data-runtime-area", relation.sourceCard && relation.sourceCard.areaId || "");
        path.setAttribute("data-flow-groups", Array.from(new Set(members.map((member) => member.flowGroup).filter(Boolean))).join(","));
        path.setAttribute("data-edge-ids", originalIds.join(","));
        if (members.every((member) => member.role === "REGISTRATION_REFERENCE")) {
          path.setAttribute("data-reference-only", "true");
          path.setAttribute("data-reference-visible", "false");
        }
        const nodeIds = Array.from(new Set(members.flatMap((member) => [
          ...(displayModel.instanceToOriginalNodeIds[member.sourceInstanceId] || []),
          ...(displayModel.instanceToOriginalNodeIds[member.targetInstanceId] || []),
          ...(member.relatedNodeIds || [])
        ])));
        path.setAttribute("data-related-node-ids", nodeIds.join(","));
        path.setAttribute("data-node-ids", nodeIds.join(","));
        const routeRelated = options.related && options.related.visualRelationIds instanceof Set
          ? segment.relationIds.some((id) => options.related.visualRelationIds.has(id))
          : originalIds.some((id) => relatedEdgeIds.has(id)) || nodeIds.some((id) => relatedNodeIds.has(id));
        const selectedSegment = Boolean(selection && segment.segmentIds.includes(selection.segmentId));
        const segmentRelated = options.related && options.related.segmentIds instanceof Set
          && options.related.segmentIds.size > 0 ? segment.segmentIds.some((id) => options.related.segmentIds.has(id)) : routeRelated;
        path.setAttribute("data-related", String(!selection || selectedSegment || segmentRelated));
        path.setAttribute("data-has-finding", String(findings.some((entry) => entry.edgeIds.some((id) => originalIds.includes(id)))));
        path.setAttribute("data-selected", String(Boolean(selectedSegment
          || selection && selection.kind === "edge" && originalIds.includes(selection.id)
          || selection && selection.kind === "runtime-relationship" && runtimeRelationIds.includes(selection.id))));
        if (style) {
          path.setAttribute("data-edge-type", relation.type);
          path.setAttribute("data-edge-layer", relation.type === "FLOWS_TO" ? "flow" : "analysis");
          path.setAttribute("stroke", style.color);
          path.setAttribute("stroke-dasharray", style.dash);
        }
        const terminalRoutes = members.filter((member) =>
          segment.segmentIds.includes(overviewRouting.routesByRelationId[member.id]?.orderedSegmentIds.at(-1)));
        const endsAtStart = terminalRoutes.some((member) => {
          const route = overviewRouting.routesByRelationId[member.id];
          return route.targetPort.x === segment.from.x && route.targetPort.y === segment.from.y;
        });
        const endsAtEnd = terminalRoutes.some((member) => {
          const route = overviewRouting.routesByRelationId[member.id];
          return route.targetPort.x === segment.to.x && route.targetPort.y === segment.to.y;
        });
        const marker = style ? "url(#graph-arrow)" : "url(#graph-guide-arrow)";
        if (reverse ? endsAtEnd : endsAtStart) path.setAttribute("marker-start", marker);
        if (reverse ? endsAtStart : endsAtEnd) path.setAttribute("marker-end", marker);
        if (originalIds.length || runtimeRelationIds.length) {
          if (originalIds.length) path.setAttribute("data-edge-id", originalIds[0]);
          path.setAttribute("tabindex", "0");
          path.setAttribute("role", "button");
          const original = edgeById.get(originalIds[0]);
          path.setAttribute("aria-label", original
            ? `${edgeTypeLabel(original.type)} · ${displayIds.node(original.sourceId)} → ${displayIds.node(original.targetId)}`
            : `실제 Runtime 관계 ${relation.type}`);
          const activateRoute = (event) => {
            if (event && event.stopPropagation) event.stopPropagation();
            if (originalIds.length && options.onEdgeClick) options.onEdgeClick(originalIds[0], path, originalIds, segment.id);
            else if (runtimeRelationIds.length && options.onRuntimeRelationshipClick) {
              options.onRuntimeRelationshipClick(runtimeRelationIds[0], path);
            }
          };
          path.addEventListener("click", activateRoute);
          path.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            if (event.preventDefault) event.preventDefault();
            activateRoute(event);
          });
          if (originalIds.length) {
            if (options.onEdgeFocus) path.addEventListener("focus", () => options.onEdgeFocus(originalIds[0], path));
            if (options.onEdgeBlur) path.addEventListener("blur", () => options.onEdgeBlur(originalIds[0], path));
            if (options.onEdgeHover) path.addEventListener("mouseenter", () => options.onEdgeHover(originalIds[0], path));
            if (options.onEdgeLeave) path.addEventListener("mouseleave", () => options.onEdgeLeave(originalIds[0], path));
          } else {
            if (options.onRuntimeRelationshipFocus) path.addEventListener("focus", () => options.onRuntimeRelationshipFocus(runtimeRelationIds[0], path));
            if (options.onRuntimeRelationshipBlur) path.addEventListener("blur", () => options.onRuntimeRelationshipBlur(runtimeRelationIds[0], path));
            if (options.onRuntimeRelationshipHover) path.addEventListener("mouseenter", () => options.onRuntimeRelationshipHover(runtimeRelationIds[0], path));
            if (options.onRuntimeRelationshipLeave) path.addEventListener("mouseleave", () => options.onRuntimeRelationshipLeave(runtimeRelationIds[0], path));
          }
        }
        layers.edgeLayer.appendChild(path);
        edgeElements.push(path);
        if (runtimeRelationIds.length) runtimeRelationshipElements.push(path);
        members.filter((member) => (member.originalEdgeIds || []).length
          && segment.segmentIds.includes(overviewRouting.routesByRelationId[member.id]?.orderedSegmentIds.at(-1))
          && !labeledRelations.has(member.id)).forEach((member) => {
          const original = edgeById.get(member.originalEdgeIds[0]);
          if (!original || !style) return;
          const placed = labelPositions.get(member.id);
          const label = createElement("text");
          label.setAttribute("class", "graph-edge-label");
          label.setAttribute("data-overview-label", "true");
          label.setAttribute("data-edge-id", original.id);
          label.setAttribute("data-edge-ids", member.originalEdgeIds.join(","));
          label.setAttribute("data-edge-type", original.type);
          label.setAttribute("data-edge-layer", original.type === "FLOWS_TO" ? "flow" : "analysis");
          label.setAttribute("x", String(placed ? placed.x : (start.x + end.x) / 2));
          label.setAttribute("y", String(placed ? placed.y : (start.y + end.y) / 2 - 8));
          label.setAttribute("text-anchor", "middle");
          label.setAttribute("data-collision", String(Boolean(placed && placed.collision)));
          label.setAttribute("data-visible", String(shouldShowEdgeLabel(original, options, relatedEdgeIds)
            && !(placed && placed.collision)));
          label.setAttribute("fill", style.color);
          label.textContent = edgeTypeLabel(original.type);
          layers.edgeLayer.appendChild(label);
          edgeLabelElements.push(label);
          labeledRelations.add(member.id);
          const setLabelVisible = (visible) => {
            if (options.displayEdgeLabels === false || (placed && placed.collision)) return;
            label.setAttribute("data-visible", String(visible || Boolean(selection
              && selection.kind === "edge" && member.originalEdgeIds.includes(selection.id))));
          };
          path.addEventListener("mouseenter", () => setLabelVisible(true));
          path.addEventListener("mouseleave", () => setLabelVisible(false));
          path.addEventListener("focus", () => setLabelVisible(true));
          path.addEventListener("blur", () => setLabelVisible(false));
        });
        findings.filter((entry) => !markedFindings.has(entry.finding.id) && entry.edgeIds.some((id) => originalIds.includes(id)))
          .forEach((entry) => {
            appendMarkers(layers.edgeLayer, [entry], (start.x + end.x) / 2, (start.y + end.y) / 2);
            markedFindings.add(entry.finding.id);
          });
      });
      (overviewRouting.junctions || []).forEach((junction) => {
        const circle = createElement("circle");
        circle.setAttribute("class", "graph-overview-junction");
        circle.setAttribute("data-junction-id", junction.id);
        circle.setAttribute("data-segment-ids", junction.segmentIds.join(","));
        circle.setAttribute("data-relation-ids", junction.relationIds.join(","));
        circle.setAttribute("cx", String(junction.x));
        circle.setAttribute("cy", String(junction.y));
        circle.setAttribute("r", "3.5");
        const relatedJunction = options.related && options.related.junctionIds instanceof Set
          && options.related.junctionIds.has(junction.id);
        circle.setAttribute("data-related", String(!selection || relatedJunction));
        circle.setAttribute("data-selected", String(Boolean(selection && selection.segmentId
          && junction.segmentIds.includes(selection.segmentId))));
        circle.setAttribute("aria-hidden", "true");
        layers.edgeLayer.appendChild(circle);
        junctionElements.push(circle);
      });
      // Chain에 직접 연결하지 않는 원본 관계의 Finding 위치 표시
      findings.filter((entry) => !markedFindings.has(entry.finding.id)).forEach((entry) => {
        const edge = entry.edgeIds.map((id) => edgeById.get(id)).find((item) => item
          && [item.sourceId, item.targetId].some((id) => nodeById.get(id)?.type === "SECURITY_CHAIN"));
        if (!edge) return;
        const chainId = [edge.sourceId, edge.targetId].find((id) => nodeById.get(id)?.type === "SECURITY_CHAIN");
        const instance = overviewInstances.find((item) => (item.originalNodeIds || []).includes(chainId));
        if (!instance || !instance.position) return;
        const previousLength = layers.edgeLayer.children.length;
        appendMarkers(layers.edgeLayer, [entry], instance.position.x + NODE_WIDTH - 14, instance.position.y + NODE_HEIGHT - 14);
        const marker = layers.edgeLayer.children[previousLength];
        if (marker) {
          marker.setAttribute("data-edge-reference-id", edge.id);
          marker.setAttribute("aria-label", `${marker.getAttribute("aria-label")} · 표시 제외된 원본 관계`);
        }
        markedFindings.add(entry.finding.id);
      });
    }

    const nodeInstances = hasCompositeCards ? [] : !options.detailMode && displayModel && Array.isArray(displayModel.instances)
      ? displayModel.instances.filter((instance) => instance.kind === "node")
      : graph.nodes.filter((node) => !groupedHandlerIds.has(node.id)).map((node) => ({
        id: node.id, originalNodeIds: [node.id], position: displayPositions[node.id]
      }));
    nodeInstances.forEach((instance) => {
      const node = nodeById.get((instance.originalNodeIds || [])[0]);
      if (!node) return;
      const position = instance.position || displayPositions[instance.id];
      if (!position) return;
      const style = nodeStyleFor(node);
    const display = nodeDisplay(node, { filterOrderInfo: options.layoutPlan && {
      ...(options.layoutPlan.securityFilterOrder || {}),
      ...(options.layoutPlan.servletFilterOrder || {})
    } });
      const group = createElement("g");
      group.setAttribute("class", "graph-node");
      group.setAttribute("transform", `translate(${position.x} ${position.y})`);
      group.setAttribute("data-node-id", node.id);
      group.setAttribute("data-display-instance-id", instance.id);
      if (instance.rowId) group.setAttribute("data-row-id", instance.rowId);
      group.setAttribute("data-has-finding", String(findings.some((entry) => entry.nodeIds.includes(node.id))));
      group.setAttribute("data-node-type", node.type);
      group.setAttribute("data-evidence-ids", node.evidenceIds.join(","));
      group.setAttribute("data-selected", String(Boolean(selection && selection.kind === "node" && selection.id === node.id)));
      group.setAttribute("data-related", String(!selection || relatedNodeIds.has(node.id)));
      group.setAttribute("tabindex", "0");
      group.setAttribute("role", "button");
      group.setAttribute("aria-label", `${nodeTypeLabel(node.type)} ${display.primary} ${display.detail}`);
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
      const nodeFindingEntries = findings.filter((entry) => entry.nodeIds.includes(node.id));
      const cardTextWidth = NODE_WIDTH - (nodeFindingEntries.length ? 56 : 28);
      const textFallbackLimit = nodeFindingEntries.length ? 26 : 28;

      const card = createElement("rect");
      card.setAttribute("class", "graph-node-card");
      card.setAttribute("width", String(NODE_WIDTH));
      card.setAttribute("height", String(NODE_HEIGHT));
      card.setAttribute("rx", "7");
      card.setAttribute("stroke", style);
      group.appendChild(card);
      addNodeBackgroundTint(group, style);
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

      addNodeHeader(group, nodeTypeLabel(node.type), displayIds.node(node.id), style);

      const primaryLines = semanticLines(display.primary, 28).slice(0, 2);
      primaryLines.forEach((line, index) => {
        const title = addNodeText(group, "graph-node-label", 14, 56 + index * 18, line, cardTextWidth, textFallbackLimit);
        title.setAttribute("clip-path", "url(#graph-node-content-clip)");
      });
      const detail = node.type === "ENDPOINT" ? "" : display.detail;
      if (detail) {
        const detailText = addNodeText(group, "graph-node-detail", 14,
          primaryLines.length > 1 ? 101 : 84, detail, cardTextWidth, textFallbackLimit);
        detailText.setAttribute("clip-path", "url(#graph-node-content-clip)");
      }
      appendMarkers(layers.nodeLayer, nodeFindingEntries,
        position.x + NODE_WIDTH - 14, position.y + NODE_HEIGHT - 14);
      nodeElements.push(group);
    });

    (hasCompositeCards ? [] : controllerGroups).forEach((groupDefinition) => {
      const position = displayPositions[groupDefinition.id];
      if (!position) return;
      const display = groupDefinition.type
        ? securityGroupDisplay(groupDefinition, graph, displayIds, nodeById, chainsByKey)
        : controllerGroupDisplay(groupDefinition, displayIds);
      const group = createElement("g");
      group.setAttribute("class", groupDefinition.type ? "graph-node graph-support-group" : "graph-node graph-controller-group");
      group.setAttribute("transform", `translate(${position.x} ${position.y})`);
      group.setAttribute("data-controller-group-id", groupDefinition.id);
      group.setAttribute("data-has-finding", String(findings.some((entry) => entry.nodeIds.some((id) =>
        (groupDefinition.nodeIds || []).includes(id) || (groupDefinition.handlerIds || []).includes(id)))));
      group.setAttribute("data-controller-fqcn", groupDefinition.controllerFqcn);
      group.setAttribute("data-node-ids", (groupDefinition.nodeIds || []).join(","));
      group.setAttribute("data-handler-ids", (groupDefinition.handlerIds || []).join(","));
      group.setAttribute("data-endpoint-ids", (groupDefinition.endpointIds || []).join(","));
      group.setAttribute("data-selected", String(Boolean(selection
        && selection.kind === "controller-group" && selection.id === groupDefinition.id)));
      group.setAttribute("data-related", String(!selection || relatedNodeIds.has(groupDefinition.id)
        || (groupDefinition.handlerIds || []).some((id) => relatedNodeIds.has(id))));
      group.setAttribute("tabindex", "0");
      group.setAttribute("role", "button");
      const groupType = groupDefinition.type || "HANDLER";
      group.setAttribute("aria-label", `${nodeTypeLabel(groupType)} ${display.primary} ${display.detail}`);
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
      const groupFindingEntries = findings.filter((entry) => entry.nodeIds.some((id) =>
        (groupDefinition.nodeIds || []).includes(id) || (groupDefinition.handlerIds || []).includes(id)));
      const cardTextWidth = NODE_WIDTH - (groupFindingEntries.length ? 56 : 28);
      const textFallbackLimit = groupFindingEntries.length ? 26 : 28;

      const card = createElement("rect");
      card.setAttribute("class", "graph-node-card graph-controller-group-card");
      card.setAttribute("width", String(NODE_WIDTH));
      card.setAttribute("height", String(NODE_HEIGHT));
      card.setAttribute("rx", "7");
      const groupColor = nodeStyleFor({ type: groupType });
      card.setAttribute("stroke", groupColor);
      group.appendChild(card);
      addNodeBackgroundTint(group, groupColor);
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
      const groupTypeLabel = groupDefinition.type === "AUTHORIZATION" ? "인가 근거"
        : groupDefinition.type === "SECURITY_DATA" ? "보안정보 사용" : nodeTypeLabel(groupType);
      addNodeHeader(group, groupTypeLabel, display.displayId, groupColor);
      const title = addNodeText(group, "graph-node-label", 14, 56, display.primary, cardTextWidth, textFallbackLimit);
      title.setAttribute("clip-path", "url(#graph-node-content-clip)");
      const detailLines = Array.isArray(display.detailLines) ? display.detailLines : [display.detail];
      detailLines.filter(Boolean).slice(0, 2).forEach((detail, index) => {
        const detailText = addNodeText(group, "graph-node-detail", 14, 84 + index * 16, detail, cardTextWidth, textFallbackLimit);
        detailText.setAttribute("clip-path", "url(#graph-node-content-clip)");
      });
      appendMarkers(layers.nodeLayer, groupFindingEntries,
        position.x + NODE_WIDTH - 14, position.y + NODE_HEIGHT - 14);
      nodeElements.push(group);
    });

    compositeCards && compositeCards.forEach((cardDefinition) => {
      const bounds = cardDefinition.bounds;
      if (!bounds) return;
      const style = compositeStyleFor(cardDefinition);
      const cardFindings = (cardDefinition.items || []).flatMap((item) => findingsForItem(item))
        .filter((entry, index, all) => all.findIndex((candidate) => candidate.finding.id === entry.finding.id) === index);
      const card = createElement("g");
      card.setAttribute("class", "graph-node graph-composite-card");
      card.setAttribute("transform", `translate(${bounds.x} ${bounds.y})`);
      card.setAttribute("data-controller-group-id", cardDefinition.id);
      card.setAttribute("data-composite-card-id", cardDefinition.id);
      card.setAttribute("data-node-ids", (cardDefinition.originalNodeIds || []).join(","));
      card.setAttribute("data-edge-ids", (cardDefinition.originalEdgeIds || []).join(","));
      card.setAttribute("data-runtime-component-ids", (cardDefinition.runtimeComponentIds || []).join(","));
      card.setAttribute("data-has-finding", String(cardFindings.length > 0));
      card.setAttribute("data-selected", String(Boolean(selection
        && (selection.kind === "controller-group" && selection.id === cardDefinition.id
          || selection.kind === "runtime-component" && (cardDefinition.runtimeComponentIds || []).includes(selection.id)))));
      card.setAttribute("data-related", String(!selection || (cardDefinition.originalNodeIds || []).some((id) => relatedNodeIds.has(id))
        || (cardDefinition.originalEdgeIds || []).some((id) => relatedEdgeIds.has(id))
        || (cardDefinition.runtimeComponentIds || []).some((id) => relatedNodeIds.has(id))));
      card.setAttribute("tabindex", "0");
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `${cardDefinition.title} · ${(cardDefinition.items || []).filter((item) => !item.isHeader).length}개 항목`);
      const selectCard = (event) => {
        if (event && event.stopPropagation) event.stopPropagation();
        if (options.onControllerGroupClick) options.onControllerGroupClick(cardDefinition.id, card);
      };
      card.addEventListener("click", selectCard);
      card.addEventListener("keydown", (event) => {
        if (!event || (event.key !== "Enter" && event.key !== " ")) return;
        if (event.preventDefault) event.preventDefault();
        selectCard(event);
      });
      if (options.onControllerGroupFocus) card.addEventListener("focus", () => options.onControllerGroupFocus(cardDefinition.id, card));
      if (options.onControllerGroupBlur) card.addEventListener("blur", () => options.onControllerGroupBlur(cardDefinition.id, card));
      if (options.onControllerGroupHover) card.addEventListener("mouseenter", () => options.onControllerGroupHover(cardDefinition.id, card));
      if (options.onControllerGroupLeave) card.addEventListener("mouseleave", () => options.onControllerGroupLeave(cardDefinition.id, card));

      const surface = createElement("rect");
      surface.setAttribute("class", "graph-composite-surface");
      surface.setAttribute("width", String(bounds.width));
      surface.setAttribute("height", String(bounds.height));
      surface.setAttribute("rx", "6");
      surface.setAttribute("fill", style.body);
      surface.setAttribute("stroke", style.stroke);
      card.appendChild(surface);
      const headerBounds = cardDefinition.headerBounds || { height: 42 };
      const header = createElement("rect");
      header.setAttribute("class", "graph-composite-header");
      header.setAttribute("width", String(bounds.width));
      header.setAttribute("height", String(headerBounds.height));
      header.setAttribute("rx", "6");
      header.setAttribute("fill", style.header);
      card.appendChild(header);
      const headerBottom = createElement("line");
      headerBottom.setAttribute("class", "graph-composite-header-rule");
      headerBottom.setAttribute("x1", "0");
      headerBottom.setAttribute("x2", String(bounds.width));
      headerBottom.setAttribute("y1", String(headerBounds.height));
      headerBottom.setAttribute("y2", String(headerBounds.height));
      card.appendChild(headerBottom);
      const headerItems = (cardDefinition.items || []).filter((item) => item.isHeader);
      const headerFindings = headerItems.flatMap((item) => findingsForItem(item))
        .filter((entry, index, all) => all.findIndex((candidate) => candidate.finding.id === entry.finding.id) === index);
      const headerMarkerX = headerFindings.length
        ? Math.max(18, bounds.width - 18 - (headerFindings.length - 1) * 32) : null;
      const headerTextWidth = headerMarkerX === null ? bounds.width - 28 : Math.max(8, headerMarkerX - 36);
      const headerTitleY = cardDefinition.subtitle ? headerBounds.height / 2 - 5 : headerBounds.height / 2 + 7;
      const headerTitle = addNodeText(card, "graph-composite-title", 14, headerTitleY, cardDefinition.title,
        headerTextWidth, Math.max(8, Math.floor(headerTextWidth / 9)));
      headerTitle.setAttribute("clip-path", compositeTextClip(14, 4, headerTextWidth, headerBounds.height - 8));
      headerTitle.setAttribute("fill", style.title);
      if (cardDefinition.subtitle) {
        const subtitle = addNodeText(card, "graph-composite-subtitle", 14, Math.min(headerBounds.height - 8, headerTitleY + 20),
          cardDefinition.subtitle, headerTextWidth, Math.max(8, Math.floor(headerTextWidth / 9)));
        subtitle.setAttribute("clip-path", compositeTextClip(14, 4, headerTextWidth, headerBounds.height - 8));
        subtitle.setAttribute("fill", style.title);
      }
      if (headerFindings.length) {
        appendMarkers(card, headerFindings, headerMarkerX, Math.max(16, headerBounds.height - 17));
      }
      (displayModel.ports || []).filter((port) => headerItems.some((item) => item.id === port.itemId)).forEach((definition) => {
        const port = createElement("circle");
        port.setAttribute("class", definition.direction === "IN" || definition.side === "LEFT"
          ? "graph-composite-port graph-composite-port-in" : "graph-composite-port graph-composite-port-out");
        port.setAttribute("cx", String(definition.x - bounds.x));
        port.setAttribute("cy", String(definition.y - bounds.y));
        port.setAttribute("r", "4");
        port.setAttribute("data-port-ids", definition.id);
        port.setAttribute("data-item-id", definition.itemId);
        port.setAttribute("data-port-channel", definition.channel);
        card.appendChild(port);
      });

      const cardItems = (cardDefinition.items || []).filter((item) => !item.isHeader);
      const orderedItems = cardItems.filter((item) => item.kind === "FILTER"
        && ["CONFIRMED", "REGISTRATION"].includes(item.orderStatus)
        && Number.isInteger(Number(item.order)) && Number(item.order) > 0);
      const displayCodes = (ids) => Array.from(new Set((ids || []).filter((id) => nodeById.has(id))))
        .map((id) => displayIds.node(id)).sort();
      const displayCode = (ids) => {
        const codes = displayCodes(ids);
        return codes.length > 1 ? `${codes[0]} 외 ${codes.length - 1}개` : codes[0] || "";
      };
      if (cardDefinition.kind === "SECURITY_CHAIN") {
        const chainIds = headerItems.flatMap((item) => item.originalNodeIds || [])
          .concat((cardDefinition.originalNodeIds || []).filter((id) => nodeById.get(id)?.type === "SECURITY_CHAIN"));
        const code = displayCode(chainIds);
        if (code) {
          const headerCode = addNodeText(card, "graph-composite-display-id", headerMarkerX === null ? bounds.width - 16 : headerMarkerX - 22,
            headerBounds.height - 10, code, bounds.width - 32, 32);
          headerCode.setAttribute("text-anchor", "end");
        }
      }
      cardItems.forEach((item, index) => {
        const itemBounds = item.bounds;
        if (!itemBounds) return;
        const row = createElement("g");
        row.setAttribute("class", "graph-node graph-composite-item");
        row.setAttribute("transform", `translate(${itemBounds.x - bounds.x} ${itemBounds.y - bounds.y})`);
        row.setAttribute("data-controller-group-id", item.id);
        row.setAttribute("data-composite-item-id", item.id);
        if (options.detailMode && (item.originalNodeIds || []).length === 1) {
          row.setAttribute("data-node-id", item.originalNodeIds[0]);
        }
        row.setAttribute("data-node-ids", (item.originalNodeIds || []).join(","));
        row.setAttribute("data-edge-ids", (item.originalEdgeIds || []).join(","));
        row.setAttribute("data-runtime-component-ids", (item.runtimeComponentIds || []).join(","));
        row.setAttribute("data-projection-node-ids", (item.projectionNodeIds || []).join(","));
        row.setAttribute("data-origin-kind", item.originKind || "GRAPH_NODE");
        const itemFindings = findingsForItem(item);
        row.setAttribute("data-has-finding", String(itemFindings.length > 0));
        row.setAttribute("data-selected", String(Boolean(selection
          && (selection.kind === "controller-group" && selection.id === item.id
            || selection.kind === "runtime-component" && (item.runtimeComponentIds || []).includes(selection.id)))));
        row.setAttribute("data-related", String(!selection || (item.originalNodeIds || []).some((id) => relatedNodeIds.has(id))
          || (item.originalEdgeIds || []).some((id) => relatedEdgeIds.has(id))
          || (item.runtimeComponentIds || []).some((id) => relatedNodeIds.has(id))));
        row.setAttribute("tabindex", "0");
        row.setAttribute("role", "button");
        row.setAttribute("aria-label", [item.label, item.detail, `${(item.originalNodeIds || []).length}개 원본 Node`]
          .filter(Boolean).join(" · "));
        const selectItem = (event) => {
          if (event && event.stopPropagation) event.stopPropagation();
          if (options.detailMode) {
            const runtimeComponentId = (item.runtimeComponentIds || [])[0];
            const originalNodeId = (item.originalNodeIds || [])[0];
            if (runtimeComponentId && options.onRuntimeComponentClick) options.onRuntimeComponentClick(runtimeComponentId, row);
            else if (originalNodeId && options.onNodeClick) options.onNodeClick(originalNodeId, row);
            return;
          }
          if (options.onControllerGroupClick) options.onControllerGroupClick(item.id, row);
        };
        row.addEventListener("click", selectItem);
        row.addEventListener("keydown", (event) => {
          if (!event || (event.key !== "Enter" && event.key !== " ")) return;
          if (event.preventDefault) event.preventDefault();
          selectItem(event);
        });
        const focusItem = (callbackName) => {
          if (options.detailMode && (item.runtimeComponentIds || []).length) {
            const callback = options[callbackName.replace("ControllerGroup", "RuntimeComponent")];
            if (callback) callback(item.runtimeComponentIds[0], row);
          } else if (options.detailMode && (item.originalNodeIds || []).length) {
            const callback = options[callbackName.replace("ControllerGroup", "Node")];
            if (callback) callback(item.originalNodeIds[0], row);
          } else if (options[callbackName]) options[callbackName](item.id, row);
        };
        row.addEventListener("focus", () => focusItem("onControllerGroupFocus"));
        row.addEventListener("blur", () => focusItem("onControllerGroupBlur"));
        row.addEventListener("mouseenter", () => focusItem("onControllerGroupHover"));
        row.addEventListener("mouseleave", () => focusItem("onControllerGroupLeave"));

        const rowSurface = createElement("rect");
        rowSurface.setAttribute("class", "graph-composite-item-surface");
        rowSurface.setAttribute("x", "0");
        rowSurface.setAttribute("width", String(itemBounds.width));
        rowSurface.setAttribute("height", String(itemBounds.height));
        rowSurface.setAttribute("rx", "2");
        row.appendChild(rowSurface);
        if (index > 0) {
          const separator = createElement("line");
          separator.setAttribute("class", "graph-composite-item-separator");
          separator.setAttribute("x1", "10");
          separator.setAttribute("x2", String(itemBounds.width - 10));
          separator.setAttribute("y1", "0");
          separator.setAttribute("y2", "0");
          row.appendChild(separator);
        }
        const labelX = orderedItems.includes(item) ? 52 : item.inputPortIds && item.inputPortIds.length ? 13 : 8;
        const markerX = itemFindings.length
          ? Math.max(18, itemBounds.width - 18 - (itemFindings.length - 1) * 32) : null;
        const textRight = markerX === null
          ? itemBounds.width - (item.outputPortIds && item.outputPortIds.length ? 18 : 10)
          : markerX - 22;
        const labelWidth = Math.max(8, textRight - labelX);
        const code = displayCode(item.originalNodeIds);
        const codeWidth = code ? Math.min(labelWidth / 2, code.length * 7 + 12) : 0;
        const node = (item.originalNodeIds || []).map((id) => nodeById.get(id)).find((value) => value?.type === "FILTER");
        const filterClass = node && String((node.attributes || {}).filterClass || "");
        const standardFilters = window.MapInBootStandardFilters;
        const standard = filterClass && standardFilters && standardFilters.list().find((entry) => entry.fqcn === filterClass);
        const servletDescriptions = {
          "org.springframework.boot.servlet.filter.OrderedCharacterEncodingFilter": "요청·응답 문자 인코딩 설정",
          "org.springframework.boot.servlet.filter.OrderedFormContentFilter": "폼 요청 데이터 처리",
          "org.springframework.boot.servlet.filter.OrderedRequestContextFilter": "요청 컨텍스트 연결",
          "org.springframework.boot.web.servlet.DelegatingFilterProxyRegistrationBean$1": "스프링 시큐리티 처리 위임",
          "org.apache.tomcat.websocket.server.WsFilter": "WebSocket 연결 처리"
        };
        const detailText = node ? standard?.description || servletDescriptions[filterClass] || ((node.attributes || {}).custom === true
          ? "커스텀 필터" : (node.attributes || {}).registrationKind === "SERVLET"
            ? "등록된 서블릿 필터" : "등록된 보안 필터") : item.detail;
        const detailWidth = Math.max(8, labelWidth - codeWidth);
        const labelLineCount = Math.max(1, (item.labelLines || []).length);
        const secondaryLine = Boolean(detailText || code);
        const labelY = itemBounds.height / 2 - (labelLineCount - 1 + Number(secondaryLine)) * 9 + 5;
        const detailY = labelY + labelLineCount * 18;
        const label = addNodeText(row, "graph-composite-item-label", labelX, labelY, item.label,
          labelWidth, Math.max(8, Math.floor(labelWidth / 8)));
        if (item.labelLines && item.labelLines.length > 1) {
          label.textContent = "";
          item.labelLines.forEach((line, lineIndex) => {
            const span = createElement("tspan");
            span.setAttribute("x", String(labelX));
            if (lineIndex) span.setAttribute("dy", "18");
            span.textContent = line;
            label.appendChild(span);
          });
        }
        label.setAttribute("clip-path", compositeTextClip(labelX, 2, labelWidth, itemBounds.height - 4));
        label.setAttribute("fill", style.title);
        if (detailText) {
          const detail = addNodeText(row, "graph-composite-item-detail", labelX, detailY, detailText,
            detailWidth, Math.max(8, Math.floor(detailWidth / 8)));
          detail.setAttribute("clip-path", compositeTextClip(labelX, detailY - 16, detailWidth, Math.max(1, itemBounds.height - detailY + 2)));
          detail.setAttribute("fill", style.title);
        }
        if (code) {
          const idText = addNodeText(row, "graph-composite-display-id", textRight, detailY, code,
            codeWidth, Math.max(8, Math.floor(codeWidth / 7)));
          idText.setAttribute("text-anchor", "end");
        }
        const itemPorts = (displayModel.ports || []).filter((port) => port.itemId === item.id);
        ["LEFT", "RIGHT", "TOP", "BOTTOM"].forEach((side) => {
          const sidePorts = itemPorts.filter((port) => port.side === side);
          sidePorts.forEach((definition) => {
            const port = createElement("circle");
            port.setAttribute("class", definition.direction === "IN"
              ? "graph-composite-port graph-composite-port-in"
              : "graph-composite-port graph-composite-port-out");
            port.setAttribute("cx", String(definition.x - itemBounds.x));
            port.setAttribute("cy", String(definition.y - itemBounds.y));
            port.setAttribute("r", "4");
            port.setAttribute("data-port-ids", definition.id);
            port.setAttribute("data-item-id", item.id);
            port.setAttribute("data-port-channel", definition.channel);
            row.appendChild(port);
          });
        });
        if (itemFindings.length) {
          appendMarkers(row, itemFindings, markerX, itemBounds.height / 2);
        }
        card.appendChild(row);
        compositeItemElements.push(row);
        nodeElements.push(row);
      });
      orderedItems.forEach((item, index) => {
        const current = item.bounds;
        if (!current) return;
        const x = current.x - bounds.x + 27;
        const y = current.y - bounds.y + current.height / 2;
        const next = orderedItems[index + 1];
        if (next && cardItems.indexOf(next) === cardItems.indexOf(item) + 1 && next.bounds) {
          const line = createElement("line");
          line.setAttribute("class", "graph-composite-timeline");
          line.setAttribute("x1", String(x)); line.setAttribute("x2", String(x));
          line.setAttribute("y1", String(y)); line.setAttribute("y2", String(next.bounds.y - bounds.y + next.bounds.height / 2));
          line.setAttribute("stroke", style.stroke); line.setAttribute("opacity", ".45");
          card.appendChild(line);
        }
        const dot = createElement("circle");
        dot.setAttribute("class", "graph-composite-timeline");
        dot.setAttribute("cx", String(x)); dot.setAttribute("cy", String(y)); dot.setAttribute("r", "3.5");
        dot.setAttribute("fill", style.stroke); card.appendChild(dot);
        const number = addNodeText(card, "graph-composite-order", x - 10, y + 4,
          String(item.order).padStart(2, "0"), 22, 4);
        number.setAttribute("text-anchor", "end"); number.setAttribute("fill", style.stroke);
      });
      layers.nodeLayer.appendChild(card);
      compositeCardElements.push(card);
      nodeElements.push(card);
    });

    const runtimeBlueprintNodes = runtimeBlueprint && Array.isArray(runtimeBlueprint.cards)
      ? runtimeBlueprint.cards.map((card) => ({
        id: card.id,
        type: "RUNTIME_COMPONENT",
        label: card.title,
        originalNodeIds: card.originalNodeIds || [],
        runtimeComponentIds: card.runtimeComponentIds || [],
        position: { x: card.bounds.x, y: card.bounds.y, width: card.bounds.width, height: card.bounds.height },
        width: card.bounds.width,
        height: card.bounds.height,
        bounds: card.bounds,
        kind: "runtime-component"
      })) : [];
    nodeElements.push(...renderRuntimeBlueprintCards(layers.nodeLayer, runtimeBlueprint, options, findings, relatedNodeIds));
    const graphHidden = graph.nodes.length === 0 && !(compositeCards && compositeCards.length);
    if (typeof layers.svg.toggleAttribute === "function") {
      layers.svg.toggleAttribute("hidden", graphHidden);
    } else if (graphHidden) {
      layers.svg.setAttribute("hidden", "");
    } else {
      layers.svg.removeAttribute("hidden");
    }
    const displayNodes = (hasCompositeCards
      ? compositeCards.map((card) => ({
        id: card.id,
        type: "COMPOSITE_CARD",
        label: card.title,
        originalNodeIds: card.originalNodeIds,
        rowId: card.rowId,
        position: card.position,
        width: card.bounds.width,
        height: card.bounds.height,
        bounds: card.bounds,
        kind: "composite-card"
      }))
      : !options.detailMode && displayModel && Array.isArray(displayModel.instances)
      ? displayModel.instances.map((instance) => {
        const sourceNode = nodeById.get((instance.originalNodeIds || [])[0]);
        const definition = controllerGroups.find((group) => group.id === instance.id);
        const position = instance.position;
        return {
          ...(instance.kind === "node" ? sourceNode : {}),
          id: instance.id,
          type: instance.kind === "controller-group" ? "CONTROLLER_GROUP" : instance.displayType,
          label: definition ? definition.controllerName || definition.controllerFqcn : sourceNode && sourceNode.label,
          originalNodeIds: instance.originalNodeIds,
          rowId: instance.rowId,
          position,
          width: position.width || NODE_WIDTH,
          height: position.height || NODE_HEIGHT,
          bounds: { x: position.x, y: position.y, width: position.width || NODE_WIDTH, height: position.height || NODE_HEIGHT },
          kind: instance.kind
        };
      })
      : graph.nodes.filter((node) => !groupedHandlerIds.has(node.id)).map((node) => ({
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
      })))).concat(runtimeBlueprintNodes);
    const findingSections = renderFindingSections(graph, displayPositions, layers.findingLayer, layers.findingTitleLayer,
      options.findingSections, options.onFindingSectionClick || options.onFindingClick, options.layoutPlan);
    const rendered = {
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
      edgeTrunkElements,
      edgeLabelElements,
      compositeCardElements,
      compositeItemElements,
      junctionElements,
      runtimeRelationshipElements,
      runtimeBlueprintNodes,
      nodeById,
      edgeById,
      securityMembershipEdgeIds: membershipEdgeIds,
      areas: areaResult.areas,
      chainAreas: areaResult.chainAreas,
      guides,
      projection,
      findingSections
    };
    applyGraphEmphasis(rendered, graph, selection, options.related);
    return rendered;
  }

  function updateState(rendered, graph, options = {}, layers = {}) {
    if (!rendered) return null;
    applyGraphViewState(layers.svg, options);
    const selection = options.selection || null;
    const relatedNodeIds = options.related && options.related.nodeIds instanceof Set ? options.related.nodeIds : new Set();
    const relatedEdgeIds = options.related && options.related.edgeIds instanceof Set ? options.related.edgeIds : new Set();
    const relatedDisplayItemIds = options.related && options.related.displayItemIds instanceof Set
      ? options.related.displayItemIds : new Set();
    const relatedCardIds = options.related && options.related.cardIds instanceof Set ? options.related.cardIds : new Set();
    const relatedVisualRelationIds = options.related && options.related.visualRelationIds instanceof Set
      ? options.related.visualRelationIds : new Set();
    const relatedSegmentIds = options.related && options.related.segmentIds instanceof Set ? options.related.segmentIds : new Set();
    const detailBlueprint = options.layoutPlan && options.layoutPlan.detailBlueprint;
    const runtimeRelationships = detailBlueprint && Array.isArray(detailBlueprint.relations) ? detailBlueprint.relations : [];
    const selectedRuntimeComponentIds = new Set();
    if (selection && selection.kind === "runtime-component") selectedRuntimeComponentIds.add(selection.id);
    if (selection && selection.kind === "runtime-relationship") {
      const selectedRelationship = runtimeRelationships.find((relation) => relation.id === selection.id);
      if (selectedRelationship) {
        selectedRuntimeComponentIds.add(selectedRelationship.sourceId);
        selectedRuntimeComponentIds.add(selectedRelationship.targetId);
      }
    }
    if (selection && selection.kind === "runtime-component") {
      runtimeRelationships.forEach((relation) => {
        if (relation.sourceId === selection.id || relation.targetId === selection.id) {
          selectedRuntimeComponentIds.add(relation.sourceId);
          selectedRuntimeComponentIds.add(relation.targetId);
        }
      });
    }
    const findings = Array.isArray(options.findings) ? options.findings : [];
    const findingIds = new Set(findings.map((entry) => entry.finding.id));
    const findingNodeIds = new Set(findings.flatMap((entry) => entry.nodeIds || []));
    const findingEdgeIds = new Set(findings.flatMap((entry) => entry.edgeIds || []));
    rendered.nodeElements.forEach((element) => {
      const nodeId = element.getAttribute("data-node-id");
      const groupId = element.getAttribute("data-controller-group-id");
      const runtimeComponentId = element.getAttribute("data-runtime-component-id");
      const runtimeComponentIds = (element.getAttribute("data-runtime-component-ids") || "").split(",").filter(Boolean);
      const nodeIds = (element.getAttribute("data-node-ids") || "").split(",").filter(Boolean);
      const id = nodeId || groupId;
      const selected = Boolean(selection && ((selection.kind === "node" && selection.id === nodeId)
        || (selection.kind === "controller-group" && selection.id === groupId)
        || (selection.kind === "runtime-component"
          && (selection.id === runtimeComponentId || runtimeComponentIds.includes(selection.id)))));
      element.setAttribute("data-selected", String(selected));
      const compositeItemId = element.getAttribute("data-composite-item-id");
      const compositeCardId = element.getAttribute("data-composite-card-id");
      const displayScoped = Boolean(selection && selection.kind === "controller-group"
        && (compositeItemId || compositeCardId));
      element.setAttribute("data-related", String(!selection || displayScoped
        ? !selection || (compositeItemId ? relatedDisplayItemIds.has(compositeItemId)
          : compositeCardId ? relatedCardIds.has(compositeCardId) : selected)
        : relatedNodeIds.has(id)
          || (element.getAttribute("data-handler-ids") || "").split(",").some((item) => relatedNodeIds.has(item))
          || nodeIds.some((item) => relatedNodeIds.has(item))
          || runtimeComponentIds.some((id) => selectedRuntimeComponentIds.has(id))
          || (selection.kind === "runtime-component" && selection.id === runtimeComponentId)
          || (element.getAttribute("data-edge-ids") || "").split(",").some((item) => relatedEdgeIds.has(item))));
      if (nodeId) element.setAttribute("data-has-finding", String(findingNodeIds.has(nodeId)));
      if (groupId) element.setAttribute("data-has-finding", String([
        ...(element.getAttribute("data-handler-ids") || "").split(","),
        ...(element.getAttribute("data-node-ids") || "").split(",")
      ].some((item) => findingNodeIds.has(item))
        || (element.getAttribute("data-edge-ids") || "").split(",").some((item) => findingEdgeIds.has(item))));
      if (runtimeComponentId || runtimeComponentIds.length) element.setAttribute("data-has-finding", String(nodeIds.some((item) => findingNodeIds.has(item))));
      if (runtimeComponentId || runtimeComponentIds.length) element.setAttribute("data-related", String(!selection
        || selectedRuntimeComponentIds.has(runtimeComponentId)
        || runtimeComponentIds.some((id) => selectedRuntimeComponentIds.has(id))
        || nodeIds.some((item) => relatedNodeIds.has(item))
        || (element.getAttribute("data-edge-ids") || "").split(",").some((item) => relatedEdgeIds.has(item))));
    });
    rendered.edgeElements.forEach((element) => {
      const edgeIds = (element.getAttribute("data-edge-ids") || element.getAttribute("data-edge-id") || "").split(",");
      element.setAttribute("data-selected", String(Boolean(selection && selection.kind === "edge" && edgeIds.includes(selection.id))));
      const segmentId = element.getAttribute("data-segment-id");
      if (segmentId) {
        const segmentIds = (element.getAttribute("data-segment-ids") || segmentId).split(",").filter(Boolean);
        const relationIds = (element.getAttribute("data-relation-ids") || "").split(",").filter(Boolean);
        const related = relatedSegmentIds.size > 0 ? segmentIds.some((id) => relatedSegmentIds.has(id))
          : relationIds.some((id) => relatedVisualRelationIds.has(id));
        const selectedSegment = selection && segmentIds.includes(selection.segmentId);
        element.setAttribute("data-selected", String(Boolean(selection && (selectedSegment
          || selection.kind === "edge" && edgeIds.includes(selection.id)))));
        element.setAttribute("data-related", String(!selection || selectedSegment || related));
      } else element.setAttribute("data-related", String(!selection || edgeIds.some((id) => relatedEdgeIds.has(id))));
      element.setAttribute("data-has-finding", String(edgeIds.some((id) => findingEdgeIds.has(id))));
    });
    (rendered.edgeTrunkElements || []).forEach((element) => {
      const edgeIds = (element.getAttribute("data-edge-ids") || "").split(",").filter(Boolean);
      element.setAttribute("data-selected", String(Boolean(selection && selection.kind === "edge" && edgeIds.includes(selection.id))));
      element.setAttribute("data-related", String(!selection || edgeIds.some((id) => relatedEdgeIds.has(id))));
      element.setAttribute("data-has-finding", String(edgeIds.some((id) => findingEdgeIds.has(id))));
    });
    (rendered.runtimeRelationshipElements || []).forEach((element) => {
      const id = element.getAttribute("data-runtime-relationship-id");
      const nodeIds = (element.getAttribute("data-node-ids") || "").split(",").filter(Boolean);
      const runtimeComponentIds = (element.getAttribute("data-runtime-component-ids") || "").split(",").filter(Boolean);
      element.setAttribute("data-selected", String(Boolean(selection && selection.kind === "runtime-relationship" && selection.id === id)));
      element.setAttribute("data-related", String(!selection
        || selectedRuntimeComponentIds.size === 0 && nodeIds.some((nodeId) => relatedNodeIds.has(nodeId))
        || runtimeComponentIds.some((componentId) => selectedRuntimeComponentIds.has(componentId))
        || nodeIds.some((nodeId) => relatedNodeIds.has(nodeId))));
      element.setAttribute("data-has-finding", String(nodeIds.some((nodeId) => findingNodeIds.has(nodeId))));
    });
    rendered.edgeLabelElements.forEach((element) => {
      const edgeId = element.getAttribute("data-edge-id");
      const selected = Boolean(selection && selection.kind === "edge" && selection.id === edgeId);
      element.setAttribute("data-selected", String(selected));
      element.setAttribute("data-related", String(!selection || relatedEdgeIds.has(edgeId)));
      if (selected) element.setAttribute("data-visible", "true");
    });
    (rendered.junctionElements || []).forEach((element) => {
      const junctionId = element.getAttribute("data-junction-id");
      const selected = Boolean(selection && selection.segmentId
        && (element.getAttribute("data-segment-ids") || "").split(",").includes(selection.segmentId));
      element.setAttribute("data-selected", String(selected));
      element.setAttribute("data-related", String(!selection || selected
        || (options.related && options.related.junctionIds instanceof Set && options.related.junctionIds.has(junctionId))));
    });
    applyGraphEmphasis(rendered, graph, selection, options.related);
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
    nodeTypeLabel,
    edgeTypeLabel,
    findingRuleNames,
    findingRuleLabel,
    confidenceNames,
    confidenceLabel,
    evidenceSourceNames,
    evidenceSourceLabel,
    analysisStatusNames,
    analysisStatusLabel,
    createDisplayIds,
    shorten,
    simpleClassName,
    friendlyClassName,
    handlerDisplay,
    shortHandlerSignature,
    controllerGroupDisplay,
    securityGroupDisplay,
    securityDataDisplay,
    normalize,
    indexFindings,
    filter: filterGraph,
    render,
    updateState,
    updateEmphasis: applyGraphEmphasis,
    nodeDisplay
  };
})();
