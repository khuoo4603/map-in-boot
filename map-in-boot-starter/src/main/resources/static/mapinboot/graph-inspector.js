(() => {
  "use strict";

  const tabs = [
    { id: "properties", label: "속성" },
    { id: "connections", label: "연결 노드" },
    { id: "relations", label: "연결 관계" }
  ];
  const filterEducationTab = { id: "filter-education", label: "필터 이해하기" };
  const graphDisplay = window.MapInBootGraph || {};
  const standardFilterClient = window.MapInBootStandardFilters || null;
  const standardFilters = standardFilterClient && standardFilterClient.list
    ? standardFilterClient.list()
    : [];
  const nodeTypeNames = graphDisplay.nodeTypeNames || {
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
  const edgeTypeNames = graphDisplay.edgeTypeNames || {
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
  const confidenceLabel = graphDisplay.confidenceLabel || (() => "판단 불가");
  const findingRuleLabel = graphDisplay.findingRuleLabel || (() => "진단 유형 확인 불가");
  const evidenceSourceLabel = graphDisplay.evidenceSourceLabel || (() => "출처 확인 불가");
  const nodeDisplay = graphDisplay.nodeDisplay || ((item) => ({ primary: item.label, detail: "" }));
  const shortHandlerSignature = graphDisplay.shortHandlerSignature || ((value) => value);
  const controllerGroupDisplay = graphDisplay.controllerGroupDisplay || ((item) => ({
    primary: item.controllerName || item.controllerFqcn,
    displayId: "표시 ID 확인 불가"
  }));

  function valueOf(value, fallback = "확인할 수 없음") {
    return value === null || value === undefined || value === "" ? fallback : String(value);
  }

  const attributeNames = {
    httpMethod: "HTTP 메서드",
    path: "경로",
    handler: "핸들러",
    handlerMapping: "핸들러 매핑",
    mvcPathPatternSettings: "MVC 경로 패턴 설정",
    params: "요청 파라미터",
    headers: "요청 헤더",
    consumes: "요청 미디어 유형",
    produces: "응답 미디어 유형",
    servletName: "서블릿 이름",
    filterClass: "필터 클래스",
    servletClass: "서블릿 클래스",
    servletKind: "서블릿 종류",
    urlPattern: "URL 경로 패턴",
    dispatcherTypes: "Dispatcher 유형",
    urlPatterns: "URL 경로 패턴",
    servletNames: "서블릿 이름",
    registrationKind: "등록 구분",
    registrationName: "등록 이름",
    filterOrder: "필터 순서",
    filterRole: "필터 역할",
    chainKey: "체인 내부 식별자",
    chainOrder: "보안 체인 순서",
    proxyBeanName: "보안 프록시 Bean 이름",
    matcherCondition: "요청 매칭 조건",
    matcherType: "매칭 방식",
    matcherClass: "매처 클래스",
    policyMatcherCondition: "정책 매칭 조건",
    policyMatcherType: "정책 매칭 방식",
    policyKind: "인가 정책",
    policySource: "정책 출처",
    policyOrder: "정책 순서",
    requiredAuthority: "필요 권한",
    authorityOperator: "권한 결합 방식",
    pathPatternSettings: "경로 패턴 설정",
    factType: "수집 사실 유형",
    securityKind: "보안 종류",
    flowKind: "흐름 구분",
    apiType: "API 유형",
    apiName: "API 메서드명",
    apiOwner: "API 소유 클래스",
    apiDescriptor: "API 메서드 서명",
    sourceKind: "원천 유형",
    mappingKind: "매핑 유형",
    observationKind: "관찰 유형",
    principalType: "Principal 유형",
    claimName: "Claim 이름",
    claim: "Claim 이름",
    verificationKind: "검증 유형",
    codeLocation: "코드 위치",
    credentialSource: "인증정보 출처",
    credentialCodeLocation: "인증정보 코드 위치",
    credentialApiOwner: "인증정보 API 소유 클래스",
    credentialApiName: "인증정보 API 메서드명",
    credentialApiDescriptor: "인증정보 API 메서드 서명",
    attributeName: "속성 이름",
    occurrence: "발생 위치",
    operation: "수행 동작",
    required: "필수 여부",
    hasDefaultValue: "기본값 여부",
    declarationKind: "선언 유형",
    annotationType: "어노테이션 유형",
    beanName: "Bean 이름",
    declaringClass: "선언 클래스",
    declaringMethod: "선언 메서드",
    expressionKind: "표현식 유형",
    invocationKind: "호출 유형",
    methodSignature: "메서드 서명",
    methodSecurityInfrastructure: "메서드 보안 기반 구성",
    proxyApplicability: "프록시 적용 가능성",
    proxyDetected: "프록시 확인 결과",
    proxyKind: "프록시 유형",
    targetClass: "대상 클래스",
    authorizationManager: "인가 관리자",
    authorizationStrategy: "인가 전략",
    checkKind: "검증 유형",
    resourceType: "대상 자원 유형",
    objectLookup: "대상 객체 조회 호출",
    ownerGetter: "소유자 확인 메서드",
    requirementKey: "요구사항 식별값",
    requirementKind: "요구사항 유형",
    principalSource: "인증 주체 출처",
    evaluationScope: "판단 범위",
    pathOutcome: "경로 판단 결과",
    coverage: "분석 대상 범위",
    stateName: "업무 상태 이름",
    stateAction: "업무 상태 동작",
    authData: "인증 데이터",
    authType: "인증 유형",
    authCheck: "인증 확인 방식",
    codePattern: "코드 분석 패턴",
    unauthenticatedAction: "미인증 요청 처리",
    filterChainContinuation: "필터 체인 진행 조건",
    instanceReuse: "필터 인스턴스 재사용"
  };
  const attributeValueNames = {
    apiType: {
      AUTHORITY: "권한 API", HEADER: "헤더 API", PRINCIPAL: "인증 주체 API",
      SESSION: "세션 API", SPRING_SECURITY_JWT: "Spring Security JWT API"
    },
    authCheck: { IS_AUTHENTICATED: "인증 여부 확인" },
    authData: { SECURITY_CONTEXT_AUTHENTICATION: "SecurityContext의 인증 정보" },
    authType: { AUTHENTICATION: "인증", JWT_AUTHENTICATION: "JWT 인증" },
    authorityOperator: { ANY: "하나 이상 충족", ALL: "모두 충족" },
    codePattern: { AUTHENTICATION_GUARD: "인증 확인 흐름", AUTHENTICATION_LOOKUP: "인증 정보 조회 흐름", UNKNOWN: "확인 불가" },
    coverage: {
      ALL: "전체 대상", COMPLETE_SUPPORTED_PATH: "지원 경로 전체", PARTIAL: "일부 대상",
      NONE: "해당 없음", INCOMPLETE: "분석 불완전", UNKNOWN: "확인 불가"
    },
    credentialSource: {
      JWT_SUBJECT: "JWT 주체", AUTHENTICATION_NAME: "인증 이름", REQUEST_HEADER: "요청 헤더", UNKNOWN: "확인 불가"
    },
    declarationKind: { METHOD: "메서드 선언", CLASS: "클래스 선언", UNKNOWN: "확인 불가" },
    evaluationScope: { HANDLER_LOCAL: "핸들러 내부", UNKNOWN: "확인 불가" },
    factType: {
      ENDPOINT_MAPPING: "Endpoint 매핑", SERVLET_REGISTRATION: "서블릿 등록", FILTER_REGISTRATION: "필터 등록",
      SECURITY_CHAIN: "보안 필터 체인", URL_AUTHORIZATION: "URL 인가 정책", METHOD_AUTHORIZATION: "메서드 인가 정책",
      JWT_USAGE: "JWT 사용", SESSION_USAGE: "세션 사용", HEADER_USAGE: "헤더 사용", PRINCIPAL_USAGE: "인증 주체 사용",
      AUTHORITY_MAPPING: "권한 매핑", OBJECT_AUTHORIZATION: "객체 인가 확인", OBJECT_AUTHORIZATION_REQUIREMENT: "객체 인가 요구",
      OBJECT_ACCESS_PATH: "객체 접근 경로", BUSINESS_SECURITY_STATE: "업무 보안 상태", BUSINESS_STATE_EVALUATION: "업무 상태 판단"
    },
    filterChainContinuation: { AFTER_AUTHENTICATION: "인증 이후" },
    filterRole: { AUTHENTICATION_PROVIDER: "인증 제공 필터" },
    mappingKind: { GRANTED_AUTHORITY_CREATION: "인가 권한 생성" },
    matcherCondition: { ANY: "모든 요청" },
    matcherType: {
      ANY: "모든 요청", METHOD_PATH: "HTTP 메서드·경로", NEGATED: "제외 조건",
      OR: "여러 조건 중 하나", UNSUPPORTED: "지원하지 않는 방식", UNKNOWN: "확인 불가"
    },
    mvcPathPatternSettings: { DEFAULT: "기본 설정", NON_DEFAULT: "사용자 설정", UNKNOWN: "확인 불가" },
    observationKind: {
      DECLARATION: "선언 정보", CODE_PATTERN: "코드 분석", SPRING_METADATA: "Spring 메타데이터",
      RUNTIME: "실행 환경", BYTECODE: "바이트코드 분석"
    },
    operation: {
      READ: "읽기", DECLARE: "선언", CREATE: "생성", VERIFY_CONFIGURATION: "구성 검증",
      WRITE: "기록", AUTH_STATUS: "인증 상태 확인"
    },
    pathOutcome: {
      ENFORCED: "보호 적용", BYPASS_PATH: "보호 우회 경로", UNRESOLVED: "판단 미완료",
      GUARDED: "검증됨", SOURCE_MISMATCH: "인증 주체 불일치", UNGUARDED: "검증 없음", UNKNOWN: "확인 불가"
    },
    pathPatternSettings: { DEFAULT: "기본 설정", NON_DEFAULT: "사용자 설정", UNKNOWN: "확인 불가" },
    policyKind: {
      PERMIT_ALL: "모두 허용", AUTHENTICATED: "인증 필요", AUTHORITY_REQUIRED: "권한 필요",
      COMPOSITE_AUTHORITY: "복합 권한 필요"
    },
    policyMatcherCondition: { ANY: "모든 요청" },
    policyMatcherType: {
      ANY: "모든 요청", METHOD_PATH: "HTTP 메서드·경로", PATH: "경로", NEGATED: "제외 조건",
      UNSUPPORTED: "지원하지 않는 방식", UNKNOWN: "확인 불가"
    },
    policySource: {
      URL: "URL 인가 정책", METHOD: "메서드 인가 정책", OBJECT: "객체 인가 정책", ANNOTATION: "어노테이션 인가 정책"
    },
    principalSource: {
      JWT_SUBJECT: "JWT 주체", AUTHENTICATION_NAME: "인증 이름", REQUEST_HEADER: "요청 헤더", UNKNOWN: "확인 불가"
    },
    proxyApplicability: { APPLICABLE: "적용 가능", NOT_APPLICABLE: "적용 불가", UNKNOWN: "확인 불가" },
    proxyDetected: { DETECTED: "확인됨", NOT_DETECTED: "확인되지 않음", UNKNOWN: "확인 불가" },
    proxyKind: { JDK: "JDK 프록시", CGLIB: "CGLIB 프록시", UNKNOWN: "확인 불가" },
    registrationKind: { SECURITY: "보안", SERVLET: "서블릿" },
    required: { "true": "필수", "false": "선택" },
    hasDefaultValue: { "true": "기본값 있음", "false": "기본값 없음" },
    securityKind: { AUTHORIZATION: "인가", AUTHENTICATION: "인증", JWT: "JWT" },
    servletKind: { DISPATCHER: "요청 분배 서블릿", SERVLET: "서블릿" },
    sourceKind: {
      AUTHENTICATION: "인증", JWT: "JWT", SESSION: "세션", HEADER: "헤더", PRINCIPAL: "인증 주체",
      JWT_SUBJECT: "JWT 주체", REQUEST_HEADER: "요청 헤더", UNKNOWN: "확인 불가"
    },
    stateAction: { REQUIRES: "업무 상태 요구", PRODUCES: "업무 상태 생성" },
    unauthenticatedAction: { HTTP_401: "HTTP 401 응답" },
    verificationKind: { CONFIGURATION: "구성", UNKNOWN: "확인 불가" }
  };
  const enumAttributeKeys = new Set(Object.keys(attributeValueNames)
    .filter((key) => key !== "matcherCondition" && key !== "policyMatcherCondition"));

  function attributeLabel(key, index) {
    return attributeNames[key] || `확인되지 않은 속성 ${index}`;
  }

  function attributeValue(key, value) {
    const text = valueOf(value);
    if (key === "matcherCondition" && /^NOT\([\s\S]*\)$/.test(text)) return `제외 조건 · ${text.slice(4, -1)}`;
    if (key === "matcherCondition" && /^OR\([\s\S]*\)$/.test(text)) return `여러 조건 중 하나 · ${text.slice(3, -1)}`;
    const values = attributeValueNames[key];
    if (values && Object.prototype.hasOwnProperty.call(values, text)) return values[text];
    return enumAttributeKeys.has(key) ? `확인되지 않은 분류 (${text})` : text;
  }

  function confidenceValue(value) {
    return confidenceLabel(valueOf(value, "UNKNOWN"));
  }

  function appendElement(parent, tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.setAttribute("class", className);
    if (text !== undefined) element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function appendRow(parent, label, value, attributeKey = null) {
    const row = appendElement(parent, "div", "inspector-row");
    if (attributeKey) row.setAttribute("data-attribute-key", attributeKey);
    appendElement(row, "span", "inspector-label", label);
    appendElement(row, "span", "inspector-value", valueOf(value));
    return row;
  }

  function appendHeading(parent, text) {
    return appendElement(parent, "h3", "inspector-section-title", text);
  }

  function appendEmpty(parent, text) {
    appendElement(parent, "p", "inspector-empty", text);
  }

  function copyIds(values) {
    return Array.isArray(values) ? values.map((value) => String(value)) : [];
  }

  function relatedFindings(snapshot, selection, controllerGroups = []) {
    const findings = snapshot && Array.isArray(snapshot.findings) ? snapshot.findings : [];
    if (!selection) return [];
    if (selection.kind === "controller-group") {
      const group = controllerGroups.find((candidate) => candidate.id === selection.id);
      if (!group) return [];
      const nodeIds = new Set([...(group.handlerIds || []), ...(group.endpointIds || [])].map(String));
      const edgeIds = new Set((group.edgeIds || []).map(String));
      return findings.filter((finding) => copyIds(finding && finding.nodeIds).some((id) => nodeIds.has(id))
        || copyIds(finding && finding.edgeIds).some((id) => edgeIds.has(id)));
    }
    const field = selection.kind === "node" ? "nodeIds" : "edgeIds";
    return findings.filter((finding) => copyIds(finding && finding[field]).includes(selection.id));
  }

  function evidenceMap(snapshot) {
    const entries = snapshot && Array.isArray(snapshot.evidence) ? snapshot.evidence : [];
    return new Map(entries
      .filter((entry) => entry && entry.id !== undefined && entry.id !== null)
      .map((entry) => [String(entry.id), entry]));
  }

  function directRelations(graph, selection, controllerGroups = []) {
    if (!graph || !selection) return [];
    if (selection.kind === "edge") {
      return graph.edges.filter((edge) => edge.id === selection.id);
    }
    if (selection.kind === "controller-group") {
      const group = controllerGroups.find((candidate) => candidate.id === selection.id);
      if (!group) return [];
      const nodeIds = new Set([...(group.handlerIds || []), ...(group.endpointIds || [])]);
      return graph.edges.filter((edge) => nodeIds.has(edge.sourceId) || nodeIds.has(edge.targetId));
    }
    return graph.edges.filter((edge) => edge.sourceId === selection.id || edge.targetId === selection.id);
  }

  function related(graph, selection, controllerGroups = []) {
    const nodeIds = new Set();
    const edgeIds = new Set();
    if (!graph || !selection) return { nodeIds, edgeIds };
    if (selection.kind === "edge") {
      const edge = graph.edges.find((candidate) => candidate.id === selection.id);
      if (edge) {
        edgeIds.add(edge.id);
        nodeIds.add(edge.sourceId);
        nodeIds.add(edge.targetId);
      }
      return { nodeIds, edgeIds };
    }
    const selectedNode = selection.kind === "node" && graph.nodes.find((node) => node.id === selection.id);
    if (selectedNode && selectedNode.type === "ENDPOINT" && window.MapInBootFlow
      && typeof window.MapInBootFlow.deriveEndpointGraph === "function") {
      const detail = window.MapInBootFlow.deriveEndpointGraph(graph, selection.id);
      detail.nodes.forEach((node) => nodeIds.add(node.id));
      detail.edges.forEach((edge) => edgeIds.add(edge.id));
      return { nodeIds, edgeIds };
    }
    if (selection.kind === "controller-group") {
      const group = controllerGroups.find((candidate) => candidate.id === selection.id);
      if (!group) return { nodeIds, edgeIds };
      const ownedNodeIds = new Set([...(group.handlerIds || []), ...(group.endpointIds || [])]);
      nodeIds.add(selection.id);
      ownedNodeIds.forEach((id) => nodeIds.add(id));
      graph.edges.forEach((edge) => {
        if (!ownedNodeIds.has(edge.sourceId) && !ownedNodeIds.has(edge.targetId)) return;
        edgeIds.add(edge.id);
        nodeIds.add(edge.sourceId);
        nodeIds.add(edge.targetId);
      });
      return { nodeIds, edgeIds };
    }
    nodeIds.add(selection.id);
    graph.edges.forEach((edge) => {
      if (edge.sourceId !== selection.id && edge.targetId !== selection.id) return;
      edgeIds.add(edge.id);
      nodeIds.add(edge.sourceId === selection.id ? edge.targetId : edge.sourceId);
    });
    return { nodeIds, edgeIds };
  }

  function create(options = {}) {
    const inspector = options.inspector;
    const findingModalTitle = options.findingModalTitle;
    const findingModalConfidence = options.findingModalConfidence;
    const findingModalRule = options.findingModalRule;
    const findingModalContent = options.findingModalContent;
    const popover = options.popover;
    const surface = options.surface;
    const onClear = options.onClear || (() => {});
    const onSelect = options.onSelect || (() => {});
    const onOpenDetail = options.onOpenDetail || (() => {});
    const onOpenFindingEndpoint = options.onOpenFindingEndpoint || (() => {});
    const onCopy = options.onCopy || (() => {});
    let activeTab = "properties";
    let selectedFilterFqcn = null;
    let current = {
      graph: null,
      visibleGraph: null,
      snapshot: null,
      selection: null,
      controllerGroups: [],
      displayIds: null,
      detailedFlow: false,
      endpointChainId: null
    };

    function availableTabs() {
      return current.detailedFlow && standardFilters.length > 0
        ? [...tabs, filterEducationTab]
        : tabs;
    }

    function setHidden(element, hidden) {
      if (!element) return;
      element.hidden = hidden;
      element.setAttribute("aria-hidden", String(hidden));
    }

    function close() {
      current = {
        graph: null,
        visibleGraph: null,
        snapshot: null,
        selection: null,
        controllerGroups: [],
        displayIds: null,
        displayModel: null,
        detailedFlow: false,
        endpointChainId: null
      };
      setHidden(inspector, true);
      if (inspector) {
        inspector.replaceChildren();
        inspector.removeAttribute("data-selection-kind");
        inspector.removeAttribute("data-selection-id");
      }
    }

    function selectedItem(graph, selection, controllerGroups = []) {
      if (!graph || !selection) return null;
      if (selection.kind === "controller-group") {
        return controllerGroups.find((group) => group.id === selection.id) || null;
      }
      const collection = selection.kind === "node" ? graph.nodes : graph.edges;
      return collection.find((item) => item.id === selection.id) || null;
    }

    function displayId(kind, id) {
      const labeler = current.displayIds && current.displayIds[kind];
      return labeler ? labeler(id) : kind === "node" ? "노드 확인 불가" : "관계 확인 불가";
    }

    function displayIdsFor(graph, supplied) {
      return supplied || (graphDisplay.createDisplayIds ? graphDisplay.createDisplayIds(graph) : null);
    }

    function selectedLabel(selection, item) {
      if (!item) return "확인할 수 없음";
      if (selection.kind === "controller-group") return controllerGroupDisplay(item, current.displayIds).primary;
      if (selection.kind === "node") {
        const attributes = item.attributes || {};
        const display = nodeDisplay(item);
        if (item.type === "ENDPOINT") {
          return [attributes.httpMethod, attributes.path].filter(Boolean).join(" ") || display.primary;
        }
        if (item.type === "APPLICATION") return attributes.applicationName || attributes.applicationClass || display.primary || item.label;
        if (item.type === "SERVLET") return attributes.servletName || attributes.servletClass || display.primary || item.label;
        if (item.type === "HANDLER") return shortHandlerSignature(attributes.handler || item.label || display.primary);
        if (item.type === "SECURITY_CHAIN") return attributes.proxyBeanName || attributes.chainKey || attributes.matcherCondition || display.primary || item.label;
        if (item.type === "FILTER") return attributes.registrationName || attributes.filterClass || display.primary || item.label;
        if (item.type === "AUTHENTICATION" && attributes.authenticationKind) {
          return attributeValue("authenticationKind", attributes.authenticationKind);
        }
        if (item.type === "AUTHORIZATION") {
          if (attributes.factType === "OBJECT_AUTHORIZATION_REQUIREMENT" || attributes.factType === "OBJECT_ACCESS_PATH") {
            return attributeValue("factType", attributes.factType);
          }
          if (attributes.policyKind) return attributeValue("policyKind", attributes.policyKind);
        }
        if (item.type === "BUSINESS_SECURITY_STATE") return attributes.stateName || display.primary || item.label;
        return display.primary || item.label;
      }
      return displayId("edge", item.id);
    }

    function headerAttributeKeys(item) {
      const attributes = item.attributes || {};
      if (item.type === "APPLICATION") return attributes.applicationName ? ["applicationName"] : attributes.applicationClass ? ["applicationClass"] : [];
      if (item.type === "SERVLET") return attributes.servletName ? ["servletName"] : attributes.servletClass ? ["servletClass"] : [];
      if (item.type === "ENDPOINT") return ["httpMethod", "path", "handler"];
      if (item.type === "HANDLER") return [];
      if (item.type === "SECURITY_CHAIN") return attributes.proxyBeanName ? ["proxyBeanName"]
        : attributes.chainKey ? ["chainKey"] : attributes.matcherCondition ? ["matcherCondition"] : [];
      if (item.type === "FILTER") return attributes.registrationName ? ["registrationName"]
        : attributes.filterClass ? ["filterClass"] : [];
      if (item.type === "AUTHENTICATION") return attributes.authenticationKind ? ["authenticationKind"] : [];
      if (item.type === "AUTHORIZATION") return attributes.factType === "OBJECT_AUTHORIZATION_REQUIREMENT"
        || attributes.factType === "OBJECT_ACCESS_PATH" ? ["factType"] : attributes.policyKind ? ["policyKind"] : [];
      if (item.type === "SECURITY_DATA") {
        if (attributes.dataKind) return ["dataKind"];
        if (attributes.operation === "VERIFY_CONFIGURATION" || attributes.verificationKind === "CONFIGURATION") {
          return ["operation", "verificationKind"];
        }
        if (attributes.mappingKind === "GRANTED_AUTHORITY_CREATION") return ["mappingKind"];
        if (attributes.apiType === "AUTHORITY") return ["apiType"];
        if (attributes.sourceKind === "JWT") return ["sourceKind"];
        if (attributes.apiType === "SPRING_SECURITY_JWT") return ["apiType"];
        if (attributes.apiType === "PRINCIPAL") return ["apiType"];
        return attributes.dataType ? ["dataType"] : attributes.securityKind ? ["securityKind"] : [];
      }
      if (item.type === "BUSINESS_SECURITY_STATE") return attributes.stateName ? ["stateName"]
        : ["factType", "stateAction"];
      return [];
    }

    function appendEvidence(parent, snapshot, ids) {
      appendHeading(parent, "근거");
      const evidenceIds = copyIds(ids);
      if (evidenceIds.length === 0) {
        appendEmpty(parent, "연결된 근거가 없습니다.");
        return;
      }
      const byId = evidenceMap(snapshot);
      const displayCodes = snapshot && snapshot.evidenceDisplayCodes || {};
      evidenceIds.forEach((id) => {
        const evidence = byId.get(id);
        const block = appendElement(parent, "div", "inspector-evidence");
        const hasDisplayCode = Object.prototype.hasOwnProperty.call(displayCodes, id)
          && valueOf(displayCodes[id], "") !== "";
        if (hasDisplayCode) {
          const code = valueOf(displayCodes[id], "");
          appendElement(block, "strong", "inspector-evidence-code", code);
          appendCopyButton(block, "표시 ID 복사", code, "inspector-evidence-copy-code", "표시 ID를 복사했습니다.");
        } else {
          appendElement(block, "p", "inspector-evidence-state", "표시 ID가 저장되지 않은 근거입니다.");
        }
        if (!evidence) {
          appendElement(block, "p", "inspector-evidence-state", "근거 참조를 확인할 수 없습니다.");
        } else {
          appendRow(block, "근거 출처", evidenceSourceLabel(evidence.source));
          appendRow(block, "확인 내용", valueOf(evidence.summary, "확인 내용 정보 없음"));
          appendRow(block, "확인 위치", valueOf(evidence.location, "확인 위치 정보 없음"));
        }
      });
    }

    function appendCopyButton(parent, label, text, className, successMessage) {
      const button = appendElement(parent, "button", className, label);
      button.setAttribute("type", "button");
      button.addEventListener("click", async () => {
        try {
          const clipboard = window.navigator && window.navigator.clipboard;
          if (!clipboard || typeof clipboard.writeText !== "function") throw new Error("clipboard-unavailable");
          await clipboard.writeText(text);
          onCopy(successMessage, "success");
        } catch (_error) {
          onCopy("클립보드 권한이 없어 복사하지 못했습니다.", "error");
        }
      });
      return button;
    }

    function appendFindings(parent, snapshot, selection, controllerGroups) {
      const findings = relatedFindings(snapshot, selection, controllerGroups);
      appendHeading(parent, "Finding 참조");
      appendElement(parent, "p", "inspector-finding-state", findings.length > 0 ? "관련 Finding 있음" : "관련 Finding 없음");
      findings.forEach((finding) => {
        const block = appendElement(parent, "div", "inspector-finding");
        appendRow(block, "진단 유형", findingRuleLabel(finding.ruleId));
        appendRow(block, "제목", finding.title);
      });
    }

    function appendAttributes(parent, attributes, priorityKeys = [], consumedKeys = []) {
      const entries = attributes && typeof attributes === "object" && !Array.isArray(attributes)
        ? Object.entries(attributes)
        : [];
      const consumed = new Set(consumedKeys);
      const visibleEntries = entries.filter(([key]) => !consumed.has(key));
      const prioritized = priorityKeys.map((key) => visibleEntries.find(([entryKey]) => entryKey === key)).filter(Boolean);
      const remaining = visibleEntries.filter(([key]) => !priorityKeys.includes(key));
      const orderedEntries = [...prioritized, ...remaining];
      if (orderedEntries.length === 0) return;
      appendHeading(parent, "추가 속성");
      let unknownIndex = 0;
      orderedEntries.forEach(([key, value]) => {
        const label = attributeNames[key] || attributeLabel(key, ++unknownIndex);
        appendRow(parent, label, attributeValue(key, value), key);
      });
    }

    function appendNodeButton(parent, node, direction) {
      const button = appendElement(parent, "button", "inspector-link");
      button.setAttribute("type", "button");
      button.setAttribute("data-node-id", node.id);
      button.textContent = `${direction ? `${direction} · ` : ""}${displayId("node", node.id)} · ${nodeTypeLabel(node.type)} · ${selectedLabel({ kind: "node" }, node)}`;
      button.addEventListener("click", () => onSelect("node", node.id));
      return button;
    }

    function renderProperties(parent, graph, item, selection, snapshot) {
      appendHeading(parent, "기본 속성");
      if (selection.kind === "controller-group") {
        if (item.type === "AUTHORIZATION" || item.type === "SECURITY_DATA") {
          appendRow(parent, "유형", item.type === "AUTHORIZATION" ? "인가 근거" : "보안정보 사용");
          appendRow(parent, "소속", item.controllerName);
          appendRow(parent, "원본 Fact", (item.nodeIds || []).length);
          appendHeading(parent, "포함된 원본 Fact");
          (item.nodeIds || []).forEach((id) => {
            const node = graph.nodes.find((candidate) => candidate.id === id);
            if (!node) return;
            const block = appendElement(parent, "div", "inspector-relation");
            appendNodeButton(block, node, "원본");
            appendAttributes(block, node.attributes);
            appendEvidence(block, snapshot, node.evidenceIds);
          });
          appendFindings(parent, snapshot, selection, current.controllerGroups);
          return;
        }
        const handlerNodes = new Map((item.handlerIds || []).map((id) => [id, graph.nodes.find((node) => node.id === id)]));
        appendRow(parent, "전체 클래스 경로", item.controllerFqcn);
        appendRow(parent, "API", (item.endpointIds || []).length);
        appendRow(parent, "메서드", (item.handlerMethods || []).length);
        appendHeading(parent, "포함 메서드");
        if (!item.handlerMethods || item.handlerMethods.length === 0) appendEmpty(parent, "메서드 없음");
        (item.handlerMethods || []).forEach((method) => {
          const entry = appendElement(parent, "div", "inspector-handler-method-entry");
          appendElement(entry, "p", "inspector-handler-method-summary", shortHandlerSignature(method));
          const matchingNodes = Array.from(handlerNodes.values()).filter((node) => node
            && ((node.attributes && node.attributes.handler) || node.label) === method);
          matchingNodes.forEach((node) => appendNodeButton(entry, node, "Handler"));
        });
        const originals = appendElement(parent, "details", "inspector-original-signatures");
        appendElement(originals, "summary", "inspector-original-signatures-title", "전체 원문 서명");
        (item.handlerMethods || []).forEach((method) => appendElement(originals, "p", "inspector-original-signature", method));
        appendHeading(parent, "포함 Endpoint");
        if (!item.endpointIds || item.endpointIds.length === 0) appendEmpty(parent, "Endpoint 없음");
        const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
        (item.endpointIds || []).forEach((id) => {
          const node = nodes.get(id);
          if (node) appendNodeButton(parent, node, "Endpoint");
        });
        return;
      }
      if (selection.kind === "node") {
        appendRow(parent, "노드 ID", displayId("node", item.id));
        appendRow(parent, "서비스 ID", item.serviceId);
        if (item.type === "ENDPOINT" && item.attributes && item.attributes.handler) {
          appendRow(parent, "핸들러 원문 서명", item.attributes.handler, "handler");
        }
        const attributeOrder = item.type === "ENDPOINT" ? ["httpMethod", "path", "handler"]
          : item.type === "SECURITY_CHAIN" ? ["chainOrder", "matcherCondition", "chainKey"]
            : item.type === "FILTER" ? ["registrationKind", "filterOrder", "filterClass"]
              : item.type === "SECURITY_DATA" ? ["dataType", "securityKind", "usage"] : [];
        appendAttributes(parent, item.attributes, attributeOrder, headerAttributeKeys(item));
        appendFindings(parent, snapshot, selection, current.controllerGroups);
        appendEvidence(parent, snapshot, item.evidenceIds);
        return;
      }
      const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
      appendRow(parent, "방향", relationDirection(item, nodes));
      appendRow(parent, "판단 신뢰도", confidenceValue(item.confidence));
      appendAttributes(parent, item.attributes);
      appendFindings(parent, snapshot, selection, current.controllerGroups);
      appendEvidence(parent, snapshot, item.evidenceIds);
      const model = current.displayModel;
      const bundleId = model && model.edgeToDisplay[item.id];
      const edgeIds = bundleId && model.displayToEdges[bundleId] || [];
      if (edgeIds.length > 1) {
        appendHeading(parent, "함께 표시한 원본 관계");
        edgeIds.forEach((id) => {
          const button = appendElement(parent, "button", "inspector-link", displayId("edge", id));
          button.setAttribute("type", "button");
          button.setAttribute("data-edge-id", id);
          button.addEventListener("click", () => onSelect("edge", id));
        });
      }
    }

    function filterStatusSource(statusEntry) {
      if (!statusEntry || statusEntry.status === "UNKNOWN") {
        return "Snapshot의 등록 분석 상태 · 등록 여부 확인 불가";
      }
      if (statusEntry.status === "UNREGISTERED_REFERENCE") {
        return "Snapshot의 전체 필터 등록 분석 상태";
      }
      if ((statusEntry.registrations || []).length > 0) {
        return "Snapshot의 FILTER Node 및 FILTERED_BY 관계";
      }
      return "Snapshot의 필터 등록 분석 상태";
    }

    function renderFilterEducation(parent, graph, item, selection, snapshot) {
      if (!standardFilterClient || standardFilters.length === 0) return;
      const statusEntries = standardFilterClient.classify(
        snapshot || graph,
        snapshot && snapshot.analysisStatus || {},
        current.endpointChainId
      );
      const statusByFqcn = new Map(statusEntries.map((entry) => [entry.fqcn, entry]));
      const selectedNodeFqcn = selection && selection.kind === "node" && item && item.type === "FILTER"
        ? item.attributes && item.attributes.filterClass
        : null;
      const selectedReference = standardFilters.find((reference) => reference.fqcn === selectedFilterFqcn)
        || standardFilters.find((reference) => reference.fqcn === selectedNodeFqcn)
        || standardFilters[0];
      selectedFilterFqcn = selectedReference.fqcn;

      appendHeading(parent, "Spring Security 표준 필터");
      appendElement(parent, "p", "inspector-filter-education-notice",
        "처리 내용과 순서는 필터 동작 원리를 설명하기 위한 참고이며, 특정 요청의 실행 기록이나 실제 filterOrder를 뜻하지 않습니다.");
      const list = appendElement(parent, "div", "inspector-filter-reference-list");
      list.setAttribute("role", "list");
      standardFilters.forEach((reference) => {
        const statusEntry = statusByFqcn.get(reference.fqcn) || {
          status: "UNKNOWN",
          statusLabel: standardFilterClient.statusLabel("UNKNOWN"),
          registrations: []
        };
        const entry = appendElement(list, "div", "inspector-filter-reference-item");
        entry.setAttribute("role", "listitem");
        const button = appendElement(entry, "button", "inspector-filter-reference");
        button.setAttribute("type", "button");
        button.setAttribute("data-filter-fqcn", reference.fqcn);
        button.setAttribute("data-filter-status", statusEntry.status);
        button.setAttribute("aria-pressed", String(reference.fqcn === selectedReference.fqcn));
        appendElement(button, "span", "inspector-filter-reference-name", reference.name);
        appendElement(button, "span", "inspector-filter-reference-status", statusEntry.statusLabel);
        button.addEventListener("click", () => {
          selectedFilterFqcn = reference.fqcn;
          render(current);
        });
      });

      const statusEntry = statusByFqcn.get(selectedReference.fqcn) || {
        status: "UNKNOWN",
        statusLabel: standardFilterClient.statusLabel("UNKNOWN"),
        registrations: []
      };
      const selectedActualNode = selectedNodeFqcn === selectedReference.fqcn;
      const card = appendElement(parent, "section", "inspector-filter-education-card");
      appendElement(card, "p", "inspector-filter-education-kind", selectedActualNode
        ? "Snapshot에서 확인한 Filter의 처리 원리"
        : "Snapshot에 없는 표준 Filter 참고 자료");
      appendElement(card, "h3", "inspector-filter-education-title", selectedReference.name);
      appendElement(card, "p", "inspector-filter-education-fqcn", selectedReference.fqcn);
      appendElement(card, "p", "inspector-filter-education-description", selectedReference.description);
      appendRow(card, "역할", selectedReference.role);
      appendRow(card, "입력", selectedReference.input);
      appendRow(card, "확인 조건", selectedReference.condition);
      appendRow(card, "대표 처리", selectedReference.processing);
      appendRow(card, "가능한 결과", selectedReference.outcomes);
      appendRow(card, "주의사항", selectedReference.cautions);
      appendRow(card, "분석 상태 출처", filterStatusSource(statusEntry));
      appendRow(card, "참고 자료", selectedReference.source);
    }

    function renderConnections(parent, graph, item, selection) {
      appendHeading(parent, "연결 노드");
      if (selection.kind === "controller-group") {
        const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
        const ids = [...(item.handlerIds || []), ...(item.endpointIds || [])];
        ids.forEach((id) => {
          const node = nodes.get(id);
          if (node) appendNodeButton(parent, node, node.type === "ENDPOINT" ? "API" : "핸들러");
        });
        if (ids.length === 0) appendEmpty(parent, "연결 노드 없음");
        return;
      }
      if (selection.kind === "edge") {
        const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
        const source = nodes.get(item.sourceId);
        const target = nodes.get(item.targetId);
        if (source) appendNodeButton(parent, source, "출발");
        if (target) appendNodeButton(parent, target, "도착");
        if (!source && !target) appendEmpty(parent, "연결 노드 확인할 수 없음");
        return;
      }
      const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
      const relations = directRelations(graph, selection, current.controllerGroups);
      const seen = new Set();
      relations.forEach((edge) => {
        const otherId = edge.sourceId === item.id ? edge.targetId : edge.sourceId;
        if (seen.has(otherId)) return;
        seen.add(otherId);
        const node = nodes.get(otherId);
        if (node) appendNodeButton(parent, node, "");
      });
      if (seen.size === 0) appendEmpty(parent, "연결 노드 없음");
      appendHeading(parent, "직접 연결 관계");
      if (relations.length === 0) {
        appendEmpty(parent, "연결 관계 없음");
      } else {
        relations.forEach((edge) => appendRow(parent, displayId("edge", edge.id), edgeTypeLabel(edge.type)));
      }
    }

    function relationDirection(edge, nodes) {
      if (!nodes.has(edge.sourceId) || !nodes.has(edge.targetId)) return "연결 방향을 확인할 수 없습니다.";
      return `${displayId("node", edge.sourceId)} → ${displayId("node", edge.targetId)}`;
    }

    function appendRelation(parent, edge, nodes) {
      const block = appendElement(parent, "div", "inspector-relation");
      appendRow(block, "관계 ID", displayId("edge", edge.id));
      const open = appendElement(block, "button", "inspector-link", "원본 관계 보기");
      open.setAttribute("type", "button");
      open.setAttribute("data-edge-id", edge.id);
      open.addEventListener("click", () => onSelect("edge", edge.id));
      appendRow(block, "관계 유형", edgeTypeLabel(edge.type));
      appendRow(block, "방향", relationDirection(edge, nodes));
      appendRow(block, "판단 신뢰도", confidenceValue(edge.confidence));
      appendAttributes(block, edge.attributes);
      appendEvidence(block, current.snapshot, edge.evidenceIds);
    }

    function renderRelations(parent, graph, item, selection, snapshot) {
      appendHeading(parent, "연결 관계");
      const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
      const relations = directRelations(graph, selection, current.controllerGroups);
      if (relations.length === 0) appendEmpty(parent, "연결 관계 없음");
      relations.forEach((edge) => appendRelation(parent, edge, nodes));

      if (selection.kind !== "node") return;
      const directIds = new Set(relations.map((edge) => edge.id));
      const referencedIds = new Set();
      relatedFindings(snapshot, selection, current.controllerGroups).forEach((finding) => copyIds(finding.edgeIds).forEach((id) => referencedIds.add(id)));
      const referenced = graph.edges.filter((edge) => referencedIds.has(edge.id) && !directIds.has(edge.id));
      if (referenced.length === 0) return;
      appendHeading(parent, "Finding 참조 관계");
      appendElement(parent, "p", "inspector-help", "선택 Node의 Finding이 참조한 Edge이며 직접 연결로 해석하지 않음");
      referenced.forEach((edge) => appendRelation(parent, edge, nodes));
    }

    // Snapshot의 원본 ID와 Finding 참조를 대조한 위치 목록
    function appendFindingLocations(parent, graph, entry, onOpenEndpoint, heading = "확인된 Graph 위치") {
      appendHeading(parent, heading);
      if (!entry) {
        appendEmpty(parent, "Finding을 선택하면 실제 연결 위치를 확인할 수 있습니다.");
        return;
      }
      const nodesById = new Map((graph && graph.nodes || []).map((node) => [node.id, node]));
      const edgesById = new Map((graph && graph.edges || []).map((edge) => [edge.id, edge]));
      const edges = entry.edgeIds.map((id) => edgesById.get(id)).filter(Boolean);
      const nodeIds = new Set(entry.nodeIds);
      edges.forEach((edge) => {
        nodeIds.add(edge.sourceId);
        nodeIds.add(edge.targetId);
      });
      const nodes = [...nodeIds].map((id) => nodesById.get(id)).filter(Boolean);
      if (entry.missing) appendElement(parent, "p", "inspector-help", "일부 Graph 참조를 확인할 수 없습니다.");
      if (nodes.length === 0 && edges.length === 0) {
        appendEmpty(parent, "확인된 연결 위치 없음");
        return;
      }
      nodes.forEach((node) => {
        const label = node.type === "ENDPOINT"
          ? [node.attributes.httpMethod, node.attributes.path].filter(Boolean).join(" ") || nodeDisplay(node).primary
          : nodeDisplay(node).primary || node.label;
        const button = appendElement(parent, "button", "inspector-link", `${displayId("node", node.id)} · ${nodeTypeLabel(node.type)} · ${label}`);
        button.setAttribute("type", "button");
        button.setAttribute("data-node-id", node.id);
        button.addEventListener("click", () => onSelect("node", node.id));
        if (node.type === "ENDPOINT") {
          const detail = appendElement(parent, "button", "inspector-detail-action", "기능별 상세 보기");
          detail.setAttribute("type", "button");
          detail.setAttribute("data-endpoint-id", node.id);
          detail.addEventListener("click", () => onOpenEndpoint(node.id));
        }
      });
      edges.forEach((edge) => {
        const button = appendElement(parent, "button", "inspector-link", `${displayId("edge", edge.id)} · ${edgeTypeLabel(edge.type)}`);
        button.setAttribute("type", "button");
        button.setAttribute("data-edge-id", edge.id);
        button.addEventListener("click", () => onSelect("edge", edge.id));
      });
    }

    // Finding 판단, 실제 근거와 점검 가이드의 우측 Inspector
    function renderFinding({ graph, snapshot, entry, emptyPrompt, onReturn, onOpenEndpoint, dismissed = false, displayIds = null }) {
      if (dismissed) {
        close();
        return null;
      }
      current = { graph, visibleGraph: null, snapshot, selection: null, controllerGroups: [], displayIds: displayIdsFor(graph, displayIds), displayModel: null };
      setHidden(inspector, false);
      if (!inspector) return null;
      inspector.replaceChildren();
      inspector.setAttribute("data-selection-kind", "finding");
      inspector.setAttribute("data-selection-id", entry ? entry.finding.id : "");
      const finding = entry && entry.finding;
      const header = appendElement(inspector, "div", "inspector-header");
      appendElement(header, "span", "inspector-badge", finding ? "Finding" : "선택 필요");
      const heading = appendElement(header, "div", "inspector-heading");
      appendElement(heading, "strong", "inspector-title", finding ? finding.title || "진단 항목" : emptyPrompt && emptyPrompt.title || "Finding 선택 필요");
      appendElement(heading, "span", "inspector-subtitle", finding
        ? `${findingRuleLabel(finding.ruleId)} · ${confidenceValue(finding.confidence)}`
        : emptyPrompt && emptyPrompt.description || "보안 MAP에서 확인할 Finding을 선택하세요.");
      const closeButton = appendElement(header, "button", "inspector-close", "닫기");
      closeButton.setAttribute("type", "button");
      closeButton.setAttribute("aria-label", "Finding Inspector 닫기");
      closeButton.addEventListener("click", onClear);
      const back = appendElement(header, "button", "inspector-detail-action", "보안 MAP으로");
      back.setAttribute("type", "button");
      back.addEventListener("click", onReturn);

      const body = appendElement(inspector, "div", "inspector-body");
      if (!finding) {
        appendEmpty(body, emptyPrompt && emptyPrompt.description || "보안 MAP에서 Finding을 선택할 수 있습니다.");
        return null;
      }
      appendHeading(body, "판단");
      appendRow(body, "진단 유형", findingRuleLabel(finding.ruleId));
      appendRow(body, "판단 신뢰도", confidenceValue(finding.confidence));
      appendElement(body, "p", "inspector-help", valueOf(finding.description, "판단 설명 없음"));
      appendFindingLocations(body, graph, entry, onOpenEndpoint);
      appendEvidence(body, snapshot, finding.evidenceIds);
      appendHeading(body, "점검 가이드");
      appendElement(body, "p", "inspector-help", valueOf(finding.guide, "제공된 점검 가이드 없음"));
      return finding;
    }

    function renderFindingModal({ graph, snapshot, entry, apiLabel, nodeIds = [], edgeIds = [], onOpenEndpoint = onOpenFindingEndpoint, displayIds = null }) {
      current = { graph, visibleGraph: null, snapshot, selection: null, controllerGroups: [], displayIds: displayIdsFor(graph, displayIds), displayModel: null };
      if (findingModalTitle) findingModalTitle.textContent = entry
        ? valueOf(entry.finding.title, "진단 항목")
        : "Finding 선택 필요";
      if (findingModalConfidence) {
        findingModalConfidence.textContent = "판단 불가";
        findingModalConfidence.setAttribute("data-confidence", "UNKNOWN");
      }
      if (findingModalRule) findingModalRule.textContent = "진단 유형 확인 불가";
      if (!findingModalContent) return null;
      findingModalContent.replaceChildren();
      if (!entry) {
        appendEmpty(findingModalContent, "확인할 Finding이 없습니다.");
        return null;
      }
      const finding = entry.finding;
      const confidenceCode = valueOf(finding.confidence, "UNKNOWN");
      if (findingModalConfidence) {
        findingModalConfidence.textContent = confidenceValue(finding.confidence);
        findingModalConfidence.setAttribute("data-confidence", confidenceCode);
      }
      if (findingModalRule) {
        const ruleLabel = findingRuleLabel(finding.ruleId);
        findingModalRule.textContent = finding.ruleId && ruleLabel !== "진단 유형 확인 불가"
          ? `진단 유형 · ${ruleLabel}` : "진단 유형 확인 불가";
      }
      appendHeading(findingModalContent, "대상 API");
      appendRow(findingModalContent, "API", apiLabel || "확인된 API 없음");
      appendHeading(findingModalContent, "판단 내용");
      appendElement(findingModalContent, "p", "finding-modal-description", valueOf(finding.description, "판단 설명 없음"));
      const scopedEntry = {
        ...entry,
        nodeIds: Array.from(new Set([...(entry.nodeIds || []), ...nodeIds])),
        edgeIds: Array.from(new Set([...(entry.edgeIds || []), ...edgeIds]))
      };
      appendEvidence(findingModalContent, snapshot, finding.evidenceIds);
      appendHeading(findingModalContent, "점검 가이드");
      appendElement(findingModalContent, "p", "finding-modal-guide", valueOf(finding.guide, "제공된 점검 가이드 없음"));
      appendFindingLocations(findingModalContent, graph, scopedEntry, onOpenEndpoint, "관련 Graph");
      return finding;
    }

    function render({ graph, visibleGraph, snapshot, selection, view = null, findingId = null, onShowFinding = null, controllerGroups = [], displayModel = null, displayIds = null, detailedFlow = false, endpointChainId = null }) {
      const previousDetailedFlow = current.detailedFlow;
      const previousSelection = current.selection;
      const selectionChanged = !previousSelection || !selection
        || previousSelection.kind !== selection.kind || previousSelection.id !== selection.id;
      const item = selectedItem(graph, selection, controllerGroups);
      const selectedFilter = selection && selection.kind === "node" && item && item.type === "FILTER"
        ? standardFilters.find((reference) => reference.fqcn === (item.attributes || {}).filterClass)
        : null;
      current = {
        graph,
        visibleGraph,
        snapshot,
        selection,
        view,
        findingId,
        onShowFinding,
        controllerGroups,
        displayModel,
        displayIds: displayIdsFor(graph, displayIds),
        detailedFlow: Boolean(detailedFlow),
        endpointChainId
      };
      if (!current.detailedFlow && activeTab === filterEducationTab.id) activeTab = "properties";
      // 상세 모드 진입과 표준 Filter 선택 시 교육 설명으로 전환하면서 일반 선택은 현재 탭 유지
      if (current.detailedFlow && selectedFilter && (selectionChanged || !previousDetailedFlow)) {
        selectedFilterFqcn = selectedFilter.fqcn;
        activeTab = filterEducationTab.id;
      }
      if (!availableTabs().some((tab) => tab.id === activeTab)) activeTab = "properties";
      if (!selection) {
        close();
        return null;
      }
      if (!item) {
        close();
        return null;
      }
      setHidden(inspector, false);
      if (inspector) {
        inspector.replaceChildren();
        inspector.setAttribute("data-selection-kind", selection.kind);
        inspector.setAttribute("data-selection-id", selection.id);
      }

      const header = appendElement(inspector, "div", "inspector-header");
      const groupType = item.type === "AUTHORIZATION" ? "인가 근거"
        : item.type === "SECURITY_DATA" ? "보안정보 사용" : "Controller";
      const badge = selection.kind === "node" ? nodeTypeLabel(item.type)
        : selection.kind === "controller-group" ? groupType : edgeTypeLabel(item.type);
      appendElement(header, "span", "inspector-badge", badge);
      const heading = appendElement(header, "div", "inspector-heading");
      appendElement(heading, "strong", "inspector-title", selectedLabel(selection, item));
      const closeButton = appendElement(header, "button", "inspector-close", "닫기");
      closeButton.setAttribute("type", "button");
      closeButton.setAttribute("aria-label", "Inspector 닫기");
      closeButton.addEventListener("click", onClear);
      if (selection.kind === "node" && item.type === "ENDPOINT" && view !== "feature-flow") {
        const detailAction = appendElement(header, "button", "inspector-detail-action", "기능별 상세 보기");
        detailAction.setAttribute("type", "button");
        detailAction.setAttribute("data-endpoint-id", item.id);
        detailAction.addEventListener("click", () => findingId
          ? onOpenFindingEndpoint(item.id)
          : onOpenDetail(item.id));
      }
      if (findingId && onShowFinding) {
        const findingAction = appendElement(header, "button", "inspector-detail-action", "선택 Finding 다시 보기");
        findingAction.setAttribute("type", "button");
        findingAction.addEventListener("click", onShowFinding);
      }

      const tabBar = appendElement(inspector, "div", "inspector-tabs");
      availableTabs().forEach((tab) => {
        const button = appendElement(tabBar, "button", "inspector-tab", tab.label);
        button.setAttribute("type", "button");
        button.setAttribute("data-tab", tab.id);
        button.setAttribute("aria-selected", String(activeTab === tab.id));
        button.addEventListener("click", () => setTab(tab.id));
      });
      const body = appendElement(inspector, "div", "inspector-body");
      if (activeTab === filterEducationTab.id) renderFilterEducation(body, graph, item, selection, snapshot);
      else if (activeTab === "connections") renderConnections(body, graph, item, selection);
      else if (activeTab === "relations") renderRelations(body, graph, item, selection, snapshot);
      else renderProperties(body, graph, item, selection, snapshot);
      return item;
    }

    function setTab(tab) {
      if (!availableTabs().some((candidate) => candidate.id === tab)) return;
      activeTab = tab;
      if (current.selection) render(current);
    }

    function hoverText(graph, snapshot, kind, id) {
      const selection = { kind, id };
      const item = selectedItem(graph, selection, current.controllerGroups);
      if (!item) return null;
      const lines = [];
      if (kind === "controller-group") {
        const display = controllerGroupDisplay(item, current.displayIds);
        lines.push(display.primary);
        lines.push(`${display.displayId} · API ${(item.endpointIds || []).length}개 · 메서드 ${(item.handlerMethods || []).length}개`);
      } else if (kind === "node") {
        const display = nodeDisplay(item);
        lines.push(display.primary || selectedLabel(selection, item));
        lines.push(`${displayId("node", item.id)} · ${nodeTypeLabel(item.type)} · ${display.detail || display.primary || "상세 정보 확인 불가"}`);
      } else {
        lines.push(`${displayId("edge", item.id)} · ${edgeTypeLabel(item.type)}`);
        lines.push(`${displayId("node", item.sourceId)} → ${displayId("node", item.targetId)}`);
        lines.push(`판단 신뢰도 · ${confidenceValue(item.confidence)}`);
      }
      lines.push(relatedFindings(snapshot, selection, current.controllerGroups).length > 0 ? "관련 Finding 있음" : "관련 Finding 없음");
      return { item, lines };
    }

    function showHover({ graph, snapshot, kind, id, anchor, displayIds = null }) {
      if (displayIds) current.displayIds = displayIds;
      const content = hoverText(graph, snapshot, kind, id);
      if (!content || !popover) return;
      popover.replaceChildren();
      content.lines.forEach((line, index) => appendElement(popover, "div", index === 0 ? "popover-title" : "popover-line", line));
      setHidden(popover, false);
      const surfaceRect = surface && surface.getBoundingClientRect ? surface.getBoundingClientRect() : { left: 0, top: 0, width: 960, height: 540 };
      const anchorRect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : surfaceRect;
      const width = 280;
      const height = Math.max(84, 30 + content.lines.length * 20);
      const left = Math.max(8, Math.min(surfaceRect.width - width - 8, anchorRect.right - surfaceRect.left + 10));
      const top = Math.max(8, Math.min(surfaceRect.height - height - 8, anchorRect.top - surfaceRect.top));
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
    }

    function hideHover() {
      setHidden(popover, true);
      if (popover) popover.replaceChildren();
    }

    hideHover();
    setHidden(inspector, true);
    return { render, renderFinding, renderFindingModal, related, setTab, showHover, hideHover, close };
  }

  window.MapInBootInspector = { create, related };
})();
