(() => {
  const reportUrl = "/mapinboot/test/api/report";
  const state = { report: null, view: "dashboard", downloading: false };
  const $ = (id) => document.getElementById(id);
  const value = (input, fallback = "미확인") => input === null || input === undefined || input === "" ? fallback : String(input);

  const policyNames = {
    AUTHORITY_REQUIRED: "권한 필요",
    AUTHENTICATED: "인증 필요",
    PERMIT_ALL: "전체 허용",
    DENY_ALL: "전체 차단",
    FULLY_AUTHENTICATED: "완전 인증 필요",
    COMPOSITE_AUTHORITY: "복합 권한 조건",
    UNKNOWN: "확인 불가"
  };
  const authorityNames = {
    ROLE_CUSTOMER: "고객 권한",
    ROLE_STAFF: "직원 권한",
    ROLE_BANK_ADMIN: "은행 관리자 권한",
    ROLE_MAP_IN_BOOT_ADMIN: "SDK 관리자 권한",
    ROLE_INTERNAL_SERVICE: "내부 서비스 권한"
  };
  const statusNames = {
    READY: "정상",
    PARTIAL: "부분 분석",
    UNKNOWN: "확인 불가",
    COMPLETED: "완료",
    FAILED: "실패",
    NOT_STARTED: "실행 전",
    RUNNING: "실행 중",
    COLLECTING: "수집 중",
    ANALYZING: "분석 중"
  };
  const confidenceNames = { CONFIRMED: "확인됨", LIKELY: "가능성 높음", UNKNOWN: "판단 불가" };
  const sourceNames = {
    RUNTIME: "실행 환경",
    SPRING_METADATA: "Spring 등록 정보",
    CODE_PATTERN: "코드 분석",
    DECLARATION: "선언 정보"
  };
  const relationNames = {
    MATCHED_BY: "적용 체인 관계",
    SECURED_BY: "접근 정책 관계",
    FILTERED_BY: "필터 연결 관계",
    FLOWS_TO: "처리 흐름 관계"
  };

  function create(tag, content, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = value(content);
    return element;
  }

  function clearContent() {
    const content = $("view-content");
    content.replaceChildren();
    return content;
  }

  function factsOf(type) {
    return (state.report.facts || []).filter((fact) => fact.type === type);
  }

  function statusLabel(status) {
    const code = value(status);
    return statusNames[code] ? `${statusNames[code]} (${code})` : code;
  }

  function statusSummary(statuses) {
    const values = Object.values(statuses || {});
    if (!values.length) return "미확인";
    if (values.includes("UNKNOWN")) return statusLabel("UNKNOWN");
    if (values.includes("PARTIAL")) return statusLabel("PARTIAL");
    if (values.every((item) => item === "READY")) return statusLabel("READY");
    return statusLabel(values[0]);
  }

  function policyLabel(policy) {
    const code = value(policy);
    return policyNames[code] ? `${policyNames[code]} (${code})` : code;
  }

  function authorityLabel(authority) {
    const original = value(authority, "없음");
    return original.replace(/ROLE_[A-Z_]+/g, (code) => authorityNames[code] ? `${authorityNames[code]} (${code})` : code);
  }

  function confidenceLabel(confidence) {
    const code = value(confidence);
    return confidenceNames[code] ? `${confidenceNames[code]} (${code})` : code;
  }

  function sourceLabel(source) {
    const code = value(source);
    return sourceNames[code] ? `${sourceNames[code]} (${code})` : code;
  }

  // 원본 Evidence ID를 표시 코드로 변환하고 미매핑 값은 원본 유지
  function evidenceCode(evidenceId) {
    const codes = state.report && state.report.evidenceDisplayCodes || {};
    return Object.prototype.hasOwnProperty.call(codes, evidenceId) && codes[evidenceId]
      ? codes[evidenceId] : value(evidenceId, "없음");
  }

  // Evidence ID 목록의 표시 코드 변환
  function evidenceCodes(evidenceIds) {
    const ids = evidenceIds || [];
    return ids.length ? ids.map(evidenceCode).join(", ") : "없음";
  }

  // Inspector용 표시 코드·원본 ID 병렬 출력
  function evidenceDetails(evidenceIds) {
    const ids = evidenceIds || [];
    return [["근거 코드", evidenceCodes(ids)], ["원본 Evidence ID", ids.join(", ") || "없음"]];
  }

  function relationLabel(type) {
    const code = value(type);
    return relationNames[code] ? `${relationNames[code]} (${code})` : code;
  }

  function matcherLabel(condition, type) {
    if (condition === "ANY" || type === "ANY") return "전체 요청";
    return value(condition || type);
  }

  function registrationKind(item) {
    return item && item.attributes && item.attributes.registrationKind;
  }

  function registrationKindLabel(kind) {
    if (kind === "SECURITY") return "Security";
    if (kind === "SERVLET") return "Servlet";
    return value(kind, "미확인");
  }

  function simpleClassName(className) {
    const original = value(className, "");
    if (!original) return "미확인";
    const separator = original.lastIndexOf(".");
    return separator < 0 ? original : original.slice(separator + 1);
  }

  function filterDisplayName(filter) {
    const attributes = filter.attributes || {};
    if (registrationKind(filter) === "SECURITY") return simpleClassName(attributes.filterClass);
    if (registrationKind(filter) === "SERVLET") return value(attributes.registrationName, simpleClassName(attributes.filterClass));
    return simpleClassName(attributes.filterClass);
  }

  function securityChainForFilter(filter, chains) {
    const attributes = filter.attributes || {};
    const candidates = (chains || []).filter((chain) => {
      const chainAttributes = chain.attributes || {};
      return chainAttributes.chainKey === attributes.chainKey
        && chainAttributes.chainOrder === attributes.chainOrder
        && chainAttributes.proxyBeanName === attributes.proxyBeanName;
    });
    return candidates.length === 1 ? candidates[0] : null;
  }

  function filterScope(filter, chains) {
    const attributes = filter.attributes || {};
    if (registrationKind(filter) === "SECURITY") {
      const chain = securityChainForFilter(filter, chains);
      return chain ? `Security Chain Matcher: ${matcherLabel(chain.attributes.matcherCondition, chain.attributes.matcherType)}` : "미확인";
    }
    if (registrationKind(filter) === "SERVLET") return value(attributes.urlPatterns, "미확인");
    return "미확인";
  }

  function filterOrderLabel(filter) {
    const attributes = filter.attributes || {};
    if (registrationKind(filter) !== "SECURITY") return "—";
    if (!attributes.chainOrder || !attributes.filterOrder) return "미확인";
    return `Chain #${attributes.chainOrder} · Filter #${attributes.filterOrder}`;
  }

  function chainLabel(attributes, chains) {
    const chain = (chains || []).find((item) => item.subjectKey
      && item.attributes && item.attributes.chainKey === attributes.chainKey
      && item.attributes.chainOrder === attributes.chainOrder);
    const source = chain ? chain.attributes : attributes;
    const order = source.chainOrder;
    if (!order) return "미확인";
    const matcher = matcherLabel(source.matcherCondition, source.matcherType);
    const conflicts = (chains || []).filter((item) => item.attributes
      && item.attributes.chainOrder === source.chainOrder
      && matcherLabel(item.attributes.matcherCondition, item.attributes.matcherType) === matcher);
    const suffix = conflicts.length > 1 && source.proxyBeanName ? ` · ${source.proxyBeanName}` : "";
    return `Chain #${order} · ${matcher}${suffix}`;
  }

  function policiesForEvidence(evidenceId) {
    return factsOf("URL_AUTHORIZATION").filter((fact) => (fact.evidenceIds || []).includes(evidenceId));
  }

  function policyEvidenceLabel(evidenceId, fallback) {
    const policies = policiesForEvidence(evidenceId);
    if (policies.length !== 1) return evidenceSummary(fallback);
    const attributes = policies[0].attributes || {};
    const matcher = matcherLabel(attributes.policyMatcherCondition, attributes.policyMatcherType);
    const order = attributes.policyOrder ? `정책 #${attributes.policyOrder} · ` : "";
    return `${order}${matcher} · ${policyLabel(attributes.policyKind)}`;
  }

  function resolveEndpointChain(endpoint, chains, relations) {
    const matches = relations.filter((relation) => relation.type === "MATCHED_BY"
      && relation.confidence === "CONFIRMED" && relation.sourceKey === endpoint.subjectKey);
    if (matches.length !== 1) return null;

    const matched = matches[0];
    const chainKey = matched.attributes && matched.attributes.chainKey;
    const chainOrder = matched.attributes && matched.attributes.chainOrder;
    const chainCandidates = chains.filter((chain) => chain.subjectKey === matched.targetKey
      && chain.attributes && chain.attributes.chainKey === chainKey
      && chain.attributes.chainOrder === chainOrder);
    return chainCandidates.length === 1 ? chainCandidates[0] : null;
  }

  function securityFilterMappingStatus(filter, endpoint, chains, relations) {
    const chain = resolveEndpointChain(endpoint, chains, relations);
    if (!chain) return { code: "filter-unknown", label: "미확인" };
    const chainAttributes = chain.attributes || {};
    const matches = relations.filter((relation) => relation.type === "FILTERED_BY"
      && relation.confidence === "CONFIRMED"
      && relation.sourceKey === chain.subjectKey
      && relation.targetKey === filter.subjectKey
      && relation.attributes
      && relation.attributes.chainKey === chainAttributes.chainKey
      && relation.attributes.chainOrder === chainAttributes.chainOrder
      && relation.attributes.proxyBeanName === chainAttributes.proxyBeanName
      && relation.attributes.filterOrder === (filter.attributes || {}).filterOrder);
    return matches.length === 1
      ? { code: "included", label: "선택 Chain에 포함" }
      : { code: "filter-unknown", label: "미확인" };
  }

  function servletFilterMappingStatus(filter, endpoint) {
    const attributes = filter.attributes || {};
    const patterns = value(attributes.urlPatterns, "").split(",").map((item) => item.trim()).filter(Boolean);
    const path = endpoint.attributes && endpoint.attributes.path;
    if (!path || !patterns.length) return { code: "filter-unknown", label: "미확인" };
    if (patterns.includes("/*") || patterns.includes(path)) return { code: "matched", label: "Endpoint에 매핑됨" };
    if (patterns.every((pattern) => !pattern.includes("*"))) return { code: "unmatched", label: "미적용" };
    return { code: "filter-unknown", label: "미확인" };
  }

  function filterMappingStatus(filter, endpoint, chains, relations) {
    if (!endpoint) return { code: "not-selected", label: "Endpoint 미선택" };
    if (registrationKind(filter) === "SECURITY") return securityFilterMappingStatus(filter, endpoint, chains, relations);
    if (registrationKind(filter) === "SERVLET") return servletFilterMappingStatus(filter, endpoint);
    return { code: "filter-unknown", label: "미확인" };
  }

  function evidenceSummary(summary) {
    let display = value(summary);
    display = display.replace(/URL Authorization 정책 수집: ([A-Z_]+)/g, (_, policy) => `URL 접근 정책 수집: ${policyLabel(policy)}`);
    display = display.replace(/SecurityFilterChain Matcher 수집: OR/g, "보안 체인 요청 조건 수집: OR (조건 중 하나)");
    display = display.replace(/등록 Endpoint:/g, "API 경로 등록:");
    display = display.replace(/Registered Endpoint:/g, "API 경로 등록:");
    display = display.replace(/Filter 등록:/g, "필터 등록:");
    return display.replace(/ROLE_[A-Z_]+/g, (code) => authorityNames[code] ? `${authorityNames[code]} (${code})` : code);
  }

  function badge(raw, label) {
    return create("span", label === undefined ? raw : label, `badge ${value(raw, "").toLowerCase()}`);
  }

  function keyValues(values) {
    const container = create("div", undefined, "key-values");
    values.forEach(([label, item]) => {
      const definition = document.createElement("dl");
      definition.append(create("dt", label), create("dd", item));
      container.append(definition);
    });
    return container;
  }

  // Endpoint와 URL 정책의 유일성 검증
  function resolveEndpointSecurity(endpoint, chains, policies, relations) {
    const chain = resolveEndpointChain(endpoint, chains, relations);
    if (!chain) return null;

    const chainKey = chain.attributes && chain.attributes.chainKey;
    const chainOrder = chain.attributes && chain.attributes.chainOrder;

    const endpointEvidenceIds = endpoint.evidenceIds || [];
    const candidates = relations.filter((relation) => relation.type === "SECURED_BY"
      && relation.confidence === "CONFIRMED"
      && relation.sourceKey === endpoint.attributes.handler
      && relation.attributes && relation.attributes.policySource === "URL"
      && relation.attributes.chainKey === chainKey
      && relation.attributes.chainOrder === chainOrder
      && endpointEvidenceIds.length > 0
      && endpointEvidenceIds.every((id) => (relation.evidenceIds || []).includes(id)))
      .map((relation) => ({
        relation,
        policy: policies.find((policy) => policy.subjectKey === relation.targetKey
          && policy.attributes && policy.attributes.policySource === "URL"
          && policy.attributes.chainKey === chainKey
          && policy.attributes.chainOrder === chainOrder)
      }))
      .filter((candidate) => candidate.policy);
    if (candidates.length !== 1) return null;

    return { chain, policy: candidates[0].policy, securedBy: candidates[0].relation };
  }

  function appendCell(row, column, item) {
    const cell = document.createElement("td");
    const raw = column.value(item);
    const display = column.display ? column.display(raw, item) : raw;
    if (column.badge) cell.append(badge(column.badgeTone ? column.badgeTone(item) : raw, display));
    else if (column.code) cell.append(create("code", display, column.truncate ? "truncate" : ""));
    else {
      const content = create("span", display, column.truncate ? "truncate" : "");
      if (column.truncate) content.title = value(display);
      cell.append(content);
    }
    row.append(cell);
  }

  // 전체 Fact 목록과 선택 상세 정보 출력
  function renderList(parent, items, columns, details, canInspect, tableClass) {
    const area = create("section", undefined, "list-area");
    area.append(create("span", `총 ${items.length}건`, "count"));
    const tableWrap = create("div", undefined, "table-wrap");
    const table = document.createElement("table");
    if (tableClass) table.className = tableClass;
    if (columns.some((column) => column.width)) {
      const colgroup = document.createElement("colgroup");
      columns.forEach((column) => {
        const col = document.createElement("col");
        if (column.width) col.style.width = column.width;
        colgroup.append(col);
      });
      table.append(colgroup);
    }
    const head = document.createElement("thead");
    const header = document.createElement("tr");
    columns.forEach((column) => header.append(create("th", column.label)));
    head.append(header);
    const body = document.createElement("tbody");
    if (!items.length) {
      const row = document.createElement("tr");
      const cell = create("td", "0건", "empty");
      cell.colSpan = columns.length;
      row.append(cell);
      body.append(row);
    }
    const inspector = create("section", undefined, "inspector");
    inspector.hidden = true;
    items.forEach((item) => {
      const row = document.createElement("tr");
      columns.forEach((column) => appendCell(row, column, item));
      if (!canInspect || canInspect(item)) {
        row.addEventListener("click", () => {
          inspector.replaceChildren(keyValues(details(item)));
          inspector.hidden = false;
        });
      } else row.className = "not-selectable";
      body.append(row);
    });
    table.append(head, body);
    tableWrap.append(table);
    area.append(tableWrap, inspector);
    parent.append(area);
  }

  function renderDashboard(parent) {
    const report = state.report;
    const statusArea = create("section", undefined, "dashboard-status");
    [
      ["현재 실행", statusLabel(report.phase)],
      ["수집 상태", statusSummary(report.collectionStatuses)],
      ["분석 상태", statusSummary(report.analysisStatuses)],
      ["보존 Snapshot", report.persistedSnapshotPresent ? "있음" : "없음"]
    ].forEach(([label, item]) => {
      const section = document.createElement("div");
      section.append(create("span", label), create("span", item, "status-value"));
      statusArea.append(section);
    });
    const counts = create("section", undefined, "dashboard-counts");
    [
      ["엔드포인트", factsOf("ENDPOINT_MAPPING").length],
      ["보안 체인", factsOf("SECURITY_CHAIN").length],
      ["URL 정책", factsOf("URL_AUTHORIZATION").length],
      ["필터", factsOf("FILTER_REGISTRATION").length],
      ["관계", (report.relations || []).length],
      ["분석 근거", (report.evidence || []).length],
      ["진단 결과", (report.currentSnapshot && report.currentSnapshot.findings || []).length]
    ].forEach(([label, count]) => {
      const section = document.createElement("div");
      section.append(create("span", label), create("span", count, "count-value"));
      counts.append(section);
    });
    parent.append(statusArea, counts);
  }

  function endpointDetails(endpoint) {
    const attributes = endpoint.attributes || {};
    const resolved = resolveEndpointSecurity(endpoint, factsOf("SECURITY_CHAIN"), factsOf("URL_AUTHORIZATION"), state.report.relations || []);
    return [
      ["ID", endpoint.subjectKey],
      ["Handler", attributes.handler],
      ["적용 Chain", resolved ? chainLabel(resolved.chain.attributes, factsOf("SECURITY_CHAIN")) : "미확인"],
      ["원문 Chain Key", resolved ? resolved.chain.attributes.chainKey : "미확인"],
      ["Chain 순서", resolved ? resolved.chain.attributes.chainOrder : "미확인"],
      ["URL 정책", resolved ? policyLabel(resolved.policy.attributes.policyKind) : "미확인"],
      ["필요 권한", resolved ? authorityLabel(resolved.policy.attributes.requiredAuthority) : "미확인"],
      ...evidenceDetails(endpoint.evidenceIds)
    ];
  }

  function renderEndpoints(parent) {
    const chains = factsOf("SECURITY_CHAIN");
    const policies = factsOf("URL_AUTHORIZATION");
    const relations = state.report.relations || [];
    renderList(parent, factsOf("ENDPOINT_MAPPING"), [
      { label: "Method", value: (item) => item.attributes && item.attributes.httpMethod, width: "6%" },
      { label: "Path", value: (item) => item.attributes && item.attributes.path, code: true, truncate: true, width: "27%" },
      { label: "Handler", value: (item) => item.attributes && item.attributes.handler, truncate: true, width: "29%" },
      { label: "적용 Chain", value: (item) => { const found = resolveEndpointSecurity(item, chains, policies, relations); return found ? chainLabel(found.chain.attributes, chains) : "미확인"; }, truncate: true, width: "23%" },
      { label: "URL 정책", value: (item) => { const found = resolveEndpointSecurity(item, chains, policies, relations); return found ? found.policy.attributes.policyKind : "미확인"; }, display: policyLabel, badge: true, width: "15%" }
    ], endpointDetails, null, "endpoint-table");
  }

  function renderChains(parent) {
    const matched = (state.report.relations || []).filter((relation) => relation.type === "MATCHED_BY" && relation.confidence === "CONFIRMED");
    const chains = factsOf("SECURITY_CHAIN");
    renderList(parent, chains, [
      { label: "Chain", value: (item) => chainLabel(item.attributes || {}, chains), truncate: true },
      { label: "순서", value: (item) => item.attributes && item.attributes.chainOrder },
      { label: "Matcher", value: (item) => item.attributes && item.attributes.matcherCondition, truncate: true },
      { label: "확정 Endpoint", value: (item) => matched.filter((relation) => relation.targetKey === item.subjectKey).length }
    ], (item) => {
      const a = item.attributes || {};
      return [["표시 Chain", chainLabel(a, chains)], ["원문 Chain Key", a.chainKey], ["Proxy Bean", a.proxyBeanName], ["순서", a.chainOrder], ["Matcher Type", a.matcherType], ["Matcher", a.matcherCondition], ["확정 Endpoint", matched.filter((relation) => relation.targetKey === item.subjectKey).length], ...evidenceDetails(item.evidenceIds)];
    });
  }

  function renderPolicies(parent) {
    const chains = factsOf("SECURITY_CHAIN");
    renderList(parent, factsOf("URL_AUTHORIZATION"), [
      { label: "Chain", value: (item) => chainLabel(item.attributes || {}, chains), truncate: true },
      { label: "Matcher", value: (item) => item.attributes && item.attributes.policyMatcherCondition, truncate: true },
      { label: "정책", value: (item) => item.attributes && item.attributes.policyKind, display: policyLabel, badge: true },
      { label: "Authority", value: (item) => item.attributes && item.attributes.requiredAuthority, display: authorityLabel, truncate: true },
      { label: "출처", value: (item) => item.attributes && item.attributes.policySource, badge: true }
    ], (item) => {
      const a = item.attributes || {};
      return [["ID", item.subjectKey], ["표시 Chain", chainLabel(a, chains)], ["원문 Chain Key", a.chainKey], ["Matcher", a.policyMatcherCondition], ["정책", policyLabel(a.policyKind)], ["Authority", authorityLabel(a.requiredAuthority)], ["Authority 연산", a.authorityOperator], ["출처", a.policySource], ...evidenceDetails(item.evidenceIds)];
    });
  }

  function renderFilters(parent) {
    const holder = create("section");
    const endpointSelect = document.createElement("select");
    endpointSelect.className = "endpoint-select";
    endpointSelect.append(create("option", "Endpoint 선택"));
    factsOf("ENDPOINT_MAPPING").forEach((endpoint) => {
      const attributes = endpoint.attributes || {};
      const option = create("option", `${value(attributes.httpMethod)} ${value(attributes.path)}`);
      option.value = endpoint.subjectKey;
      endpointSelect.append(option);
    });
    const body = create("div");
    const chains = factsOf("SECURITY_CHAIN");
    const relations = state.report.relations || [];
    const filters = factsOf("FILTER_REGISTRATION");
    const securityFilters = filters.filter((item) => registrationKind(item) === "SECURITY");
    const servletFilters = filters.filter((item) => registrationKind(item) === "SERVLET");
    const draw = () => {
      body.replaceChildren();
      const endpoint = factsOf("ENDPOINT_MAPPING").find((item) => item.subjectKey === endpointSelect.value);
      renderList(body, securityFilters, [
        { label: "구분", value: () => "Security", badge: true, badgeTone: () => "security", width: "11%" },
        { label: "필터 이름", value: filterDisplayName, truncate: true, width: "20%" },
        { label: "적용 범위", value: (item) => filterScope(item, chains), truncate: true, width: "31%" },
        { label: "순서", value: filterOrderLabel, code: true, width: "18%" },
        { label: "적용 상태", value: (item) => filterMappingStatus(item, endpoint, chains, relations).label, badge: true, badgeTone: (item) => filterMappingStatus(item, endpoint, chains, relations).code, width: "20%" }
      ], (item) => filterDetails(item, endpoint, chains, relations), null, "filter-table");
      renderList(body, servletFilters, [
        { label: "구분", value: () => "Servlet", badge: true, badgeTone: () => "servlet", width: "11%" },
        { label: "필터 이름", value: filterDisplayName, truncate: true, width: "20%" },
        { label: "적용 범위", value: (item) => filterScope(item, chains), truncate: true, width: "31%" },
        { label: "순서", value: filterOrderLabel, code: true, width: "18%" },
        { label: "적용 상태", value: (item) => filterMappingStatus(item, endpoint, chains, relations).label, badge: true, badgeTone: (item) => filterMappingStatus(item, endpoint, chains, relations).code, width: "20%" }
      ], (item) => filterDetails(item, endpoint, chains, relations), null, "filter-table");
    };
    endpointSelect.addEventListener("change", draw);
    holder.append(endpointSelect, body);
    parent.append(holder);
    draw();
  }

  function filterDetails(item, endpoint, chains, relations) {
    const attributes = item.attributes || {};
    const kind = registrationKind(item);
    const chain = kind === "SECURITY" ? securityChainForFilter(item, chains) : null;
    const status = filterMappingStatus(item, endpoint, chains, relations);
    return [
      ["필터 표시명", filterDisplayName(item)],
      ["구분", registrationKindLabel(kind)],
      ["Fact ID", item.id],
      ["원본 Filter 클래스", attributes.filterClass],
      ["Servlet 등록명", kind === "SERVLET" ? attributes.registrationName : "—"],
      ["소속 Security Chain", kind === "SECURITY" && chain ? chainLabel(chain.attributes, chains) : kind === "SECURITY" ? "미확인" : "—"],
      ["Chain Matcher", kind === "SECURITY" && chain ? matcherLabel(chain.attributes.matcherCondition, chain.attributes.matcherType) : "—"],
      ["Servlet URL 패턴", kind === "SERVLET" ? attributes.urlPatterns : "—"],
      ["Chain 순서", kind === "SECURITY" ? attributes.chainOrder : "—"],
      ["Filter 순서", kind === "SECURITY" ? attributes.filterOrder : "—"],
      ["표시 순서", filterOrderLabel(item)],
      ["적용 상태", status.label],
      ...evidenceDetails(item.evidenceIds)
    ];
  }

  function renderFindings(parent) {
    const findings = state.report.currentSnapshot && state.report.currentSnapshot.findings || [];
    renderList(parent, findings, [
      { label: "Rule", value: (item) => item.ruleId, code: true },
      { label: "제목", value: (item) => item.title, truncate: true },
      { label: "심각도", value: (item) => item.severity, badge: true },
      { label: "Confidence", value: (item) => item.confidence, display: confidenceLabel, badge: true },
      { label: "대상", value: (item) => item.subjectKey, code: true, truncate: true }
    ], (item) => [["Rule", item.ruleId], ["설명", item.description], ["가이드", item.guide], ["Confidence", confidenceLabel(item.confidence)], ...evidenceDetails(item.evidenceIds)]);
  }

  function referencesForEvidence(id) {
    const refs = [];
    (state.report.facts || []).filter((item) => (item.evidenceIds || []).includes(id)).forEach((item) => refs.push(`Fact: ${item.type} (${item.subjectKey})`));
    (state.report.relations || []).filter((item) => (item.evidenceIds || []).includes(id)).forEach((item) => refs.push(`Relation: ${relationLabel(item.type)}`));
    const findings = state.report.currentSnapshot && state.report.currentSnapshot.findings || [];
    findings.filter((item) => (item.evidenceIds || []).includes(id)).forEach((item) => refs.push(`Finding: ${item.ruleId}`));
    return refs.join(" / ") || "없음";
  }

  function renderEvidence(parent) {
    renderList(parent, state.report.evidence || [], [
      { label: "근거 코드", value: (item) => evidenceCode(item.id), code: true, truncate: true, width: "15%" },
      { label: "출처", value: (item) => item.source, display: sourceLabel, badge: true, width: "15%" },
      { label: "위치", value: (item) => item.location, truncate: true, width: "25%" },
      { label: "내용", value: (item) => policyEvidenceLabel(item.id, item.summary), truncate: true, width: "45%" }
    ], (item) => {
      const policies = policiesForEvidence(item.id);
      const policyValues = policies.length === 1 ? policies[0].attributes || {} : null;
      return [["근거 코드", evidenceCode(item.id)], ["원본 Evidence ID", item.id], ["출처", sourceLabel(item.source)], ["위치", item.location], ["표시 내용", policyEvidenceLabel(item.id, item.summary)], ["원문 Summary", item.summary], ["Chain", policyValues && chainLabel(policyValues, factsOf("SECURITY_CHAIN"))], ["원문 Chain Key", policyValues && policyValues.chainKey], ["정책 Matcher", policyValues && policyValues.policyMatcherCondition], ["정책 순서", policyValues && policyValues.policyOrder], ["정책", policyValues && policyLabel(policyValues.policyKind)], ["연결", referencesForEvidence(item.id)]];
    }, null, "evidence-table");
  }

  function renderDiagnostics(parent) {
    const rows = [
      ...Object.entries(state.report.collectionStatuses || {}).map(([adapter, status]) => ({ area: "수집", adapter, status })),
      ...Object.entries(state.report.analysisStatuses || {}).map(([adapter, status]) => ({ area: "분석", adapter, status }))
    ];
    renderList(parent, rows, [
      { label: "영역", value: (item) => item.area },
      { label: "Adapter", value: (item) => item.adapter, code: true, truncate: true },
      { label: "상태", value: (item) => item.status, display: statusLabel, badge: true }
    ], (item) => [["영역", item.area], ["Adapter", item.adapter], ["상태", statusLabel(item.status)]]);
    renderList(parent, state.report.diagnostics || [], [
      { label: "Adapter", value: (item) => item.adapterId, code: true, truncate: true },
      { label: "오류 코드", value: (item) => item.errorCode, badge: true },
      { label: "내용", value: (item) => item.summary, truncate: true }
    ], (item) => [["Adapter", item.adapterId], ["오류 코드", item.errorCode], ["내용", item.summary]]);
  }

  const renderers = {
    dashboard: renderDashboard,
    endpoints: renderEndpoints,
    chains: renderChains,
    policies: renderPolicies,
    filters: renderFilters,
    findings: renderFindings,
    evidence: renderEvidence,
    diagnostics: renderDiagnostics
  };

  function renderView() {
    const content = clearContent();
    if (state.report) (renderers[state.view] || renderDashboard)(content);
  }

  function changeView(view) {
    state.view = renderers[view] ? view : "dashboard";
    document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
    renderView();
    $("view-content").focus({ preventScroll: true });
  }

  function setRequestState(message, type) {
    const target = $("request-state");
    target.textContent = message;
    target.className = `request-state ${type || ""}`;
  }

  function updateHeader(report) {
    const current = report.currentSnapshot;
    $("service-name").textContent = current && current.serviceId ? current.serviceId : "서비스 식별 정보 미확인";
    $("service-meta").textContent = current && current.applicationVersion ? `application ${current.applicationVersion}` : "개발 진단 화면";
    $("snapshot-download-button").disabled = !report.persistedSnapshotPresent || state.downloading;
  }

  function snapshotFileName(snapshot) {
    const serviceId = value(snapshot.serviceId, "mapinboot").replace(/[^A-Za-z0-9._-]+/g, "-");
    const snapshotId = value(snapshot.snapshotId, "snapshot").replace(/[^A-Za-z0-9._-]+/g, "-");
    return `mapinboot-${serviceId}-snapshot-${snapshotId}.json`;
  }

  async function downloadSnapshot() {
    if (state.downloading || !state.report || !state.report.persistedSnapshotPresent) return;
    const button = $("snapshot-download-button");
    state.downloading = true;
    button.disabled = true;
    setRequestState("Snapshot 다운로드 중", "loading");
    try {
      const response = await fetch("/mapinboot/api/snapshot", {
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error(String(response.status));
      const raw = await response.text();
      const snapshot = JSON.parse(raw);
      const blob = new Blob([raw], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = snapshotFileName(snapshot);
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setRequestState("Snapshot 다운로드 완료", "success");
    } catch (error) {
      const messages = { "401": "인증 필요", "403": "관리자 권한 필요", "404": "보존 Snapshot 없음" };
      setRequestState(messages[error.message] || "Snapshot 다운로드 실패", "error");
    } finally {
      state.downloading = false;
      button.disabled = !state.report.persistedSnapshotPresent;
    }
  }

  async function loadReport() {
    const button = $("refresh-button");
    button.disabled = true;
    setRequestState("결과 조회 중", "loading");
    try {
      const response = await fetch(reportUrl, { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(String(response.status));
      state.report = await response.json();
      updateHeader(state.report);
      renderView();
      setRequestState("최신 조회 결과", "success");
    } catch (error) {
      const messages = { "401": "인증 필요", "403": "관리자 권한 필요", "404": "개발 전용 기능 비활성 또는 미등록" };
      setRequestState(messages[error.message] || "조회 실패 또는 네트워크 오류", "error");
    } finally {
      button.disabled = false;
    }
  }

  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => changeView(button.dataset.view)));
  $("refresh-button").addEventListener("click", loadReport);
  $("snapshot-download-button").addEventListener("click", downloadSnapshot);
  loadReport();
})();
