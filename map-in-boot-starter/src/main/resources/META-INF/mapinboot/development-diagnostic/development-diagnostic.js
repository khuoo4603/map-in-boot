(() => {
  const reportUrl = "/mapinboot/test/api/report";
  const $ = (id) => document.getElementById(id);
  const text = (value, fallback = "미확인") => value === null || value === undefined || value === "" ? fallback : String(value);

  function create(tag, value, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = text(value);
    return element;
  }

  function clear(id) {
    const container = $(id);
    container.replaceChildren();
    return container;
  }

  function setRequestState(message, state) {
    const target = $("request-state");
    target.textContent = message;
    target.className = `status-chip ${state || ""}`;
  }

  function setValue(id, value) {
    const target = $(id);
    target.textContent = text(value);
    target.className = phaseClass(value);
  }

  function phaseClass(value) {
    const phase = text(value, "").toLowerCase();
    return phase ? `phase-${phase}` : "";
  }

  function renderTable(containerId, headers, rows) {
    const container = clear(containerId);
    if (!rows.length) {
      container.append(create("p", "수집되거나 분석된 정보가 없습니다.", "empty"));
      return;
    }
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    headers.forEach((header) => headerRow.append(create("th", header)));
    head.append(headerRow);
    const body = document.createElement("tbody");
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      row.forEach((cell) => {
        const td = document.createElement("td");
        if (cell && cell.code) td.append(create("code", cell.value));
        else td.textContent = text(cell && cell.value !== undefined ? cell.value : cell);
        tr.append(td);
      });
      body.append(tr);
    });
    table.append(head, body);
    container.append(table);
  }

  function renderKeyValues(containerId, values) {
    const container = clear(containerId);
    values.forEach(([label, value]) => {
      const definition = document.createElement("dl");
      definition.append(create("dt", label), create("dd", value));
      container.append(definition);
    });
  }

  function factsOf(report, type) {
    return (report.facts || []).filter((fact) => fact.type === type);
  }

  function evidenceById(report) {
    return new Map((report.evidence || []).map((evidence) => [evidence.id, evidence]));
  }

  function relationFor(relations, type, source, target) {
    return relations.find((relation) => relation.type === type
      && relation.sourceKey === source && (!target || relation.targetKey === target));
  }

  function resolveEndpointSecurity(endpoint, chains, policies, relations) {
    const matches = relations.filter((relation) => relation.type === "MATCHED_BY"
      && relation.confidence === "CONFIRMED" && relation.sourceKey === endpoint.subjectKey);
    if (matches.length !== 1) return null;

    const matched = matches[0];
    const chainKey = matched.attributes && matched.attributes.chainKey;
    const chainOrder = matched.attributes && matched.attributes.chainOrder;
    const chainCandidates = chains.filter((chain) => chain.subjectKey === matched.targetKey
      && chain.attributes && chain.attributes.chainKey === chainKey
      && chain.attributes.chainOrder === chainOrder);
    if (chainCandidates.length !== 1) return null;

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

    return { chain: chainCandidates[0], policy: candidates[0].policy, securedBy: candidates[0].relation };
  }

  function endpointDetails(container, endpoints, evidence) {
    endpoints.forEach((endpoint) => {
      const attributes = endpoint.attributes || {};
      const details = document.createElement("details");
      details.append(create("summary", `${text(attributes.httpMethod)} ${text(attributes.path)}`));
      const list = create("ul", undefined, "detail-list");
      (endpoint.evidenceIds || []).forEach((id) => {
        const item = evidence.get(id);
        list.append(create("li", item ? `${item.source}: ${item.summary}` : `근거 ${id} 미확인`));
      });
      if (!list.children.length) list.append(create("li", "연결된 근거가 없습니다."));
      details.append(list);
      container.append(details);
    });
  }

  function renderEndpoints(report, evidence) {
    const endpoints = factsOf(report, "ENDPOINT_MAPPING");
    const chains = factsOf(report, "SECURITY_CHAIN");
    const policies = factsOf(report, "URL_AUTHORIZATION");
    const relations = report.relations || [];
    const rows = endpoints.map((endpoint) => {
      const attributes = endpoint.attributes || {};
      const security = resolveEndpointSecurity(endpoint, chains, policies, relations);
      return [
        attributes.httpMethod,
        { value: attributes.path, code: true },
        attributes.handler,
        security ? security.chain.attributes.chainKey : "미확인",
        security ? security.policy.attributes.policyKind : "미확인",
        security ? security.securedBy.confidence : "미확인"
      ];
    });
    renderTable("endpoint-content", ["Method", "Path", "Handler", "첫 적용 Chain", "URL 정책", "관계 상태"], rows);
    endpointDetails($("endpoint-content"), endpoints, evidence);
  }

  function renderChains(report) {
    const chains = factsOf(report, "SECURITY_CHAIN");
    const matched = (report.relations || []).filter((relation) => relation.type === "MATCHED_BY");
    const rows = chains.map((chain) => {
      const attributes = chain.attributes || {};
      const count = matched.filter((relation) => relation.targetKey === chain.subjectKey).length;
      return [attributes.chainKey, attributes.chainOrder, attributes.matcherType, attributes.matcherCondition, attributes.proxyBeanName, count || "미확인"];
    });
    renderTable("chain-content", ["Chain", "순서", "Matcher", "조건", "Proxy", "확인 Endpoint"], rows);
  }

  function renderPolicies(report) {
    const rows = factsOf(report, "URL_AUTHORIZATION").map((policy) => {
      const attributes = policy.attributes || {};
      return [attributes.chainKey, attributes.policyOrder, attributes.policyMatcherCondition,
        attributes.policyKind, attributes.requiredAuthority, attributes.authorityOperator, attributes.policySource];
    });
    renderTable("policy-content", ["Chain", "순서", "Matcher", "정책", "Authority", "연산", "출처"], rows);
  }

  function renderFilters(report) {
    const filterFacts = [...factsOf(report, "FILTER_REGISTRATION"), ...factsOf(report, "SERVLET_REGISTRATION")];
    const rows = filterFacts.map((fact) => {
      const attributes = fact.attributes || {};
      const filter = fact.type === "FILTER_REGISTRATION";
      const mappings = filter
        ? [attributes.urlPatterns, attributes.servletNames].filter(Boolean).join(" / ")
        : attributes.urlPattern;
      return [fact.type, attributes.registrationName || attributes.servletName,
        filter ? attributes.filterClass : attributes.servletClass, mappings || "미확인", fact.subjectKey];
    });
    renderTable("filter-content", ["유형", "등록명", "클래스", "매핑", "식별자"], rows);
  }

  function renderFindings(report, evidence) {
    const container = clear("finding-content");
    const findings = report.currentSnapshot && report.currentSnapshot.findings || [];
    if (!findings.length) {
      const message = report.phase === "COMPLETED"
        ? "현재 분석 결과에 생성된 Finding이 없습니다."
        : "분석이 완료되지 않았거나 일부 근거가 부족하여 결과가 제한됩니다.";
      container.append(create("p", message, "empty"));
      return;
    }
    findings.forEach((finding) => {
      const details = document.createElement("details");
      details.append(create("summary", `${text(finding.ruleId)} · ${text(finding.title)}`));
      const list = create("ul", undefined, "detail-list");
      [finding.description, `Confidence: ${text(finding.confidence)}`, finding.guide].forEach((value) => list.append(create("li", value)));
      (finding.evidenceIds || []).forEach((id) => {
        const item = evidence.get(id);
        list.append(create("li", item ? `근거: ${item.summary}` : `근거 ${id} 미확인`));
      });
      details.append(list);
      container.append(details);
    });
  }

  function renderDiagnostics(report) {
    const rows = (report.diagnostics || []).map((diagnostic) => [diagnostic.adapterId, diagnostic.errorCode, diagnostic.summary]);
    renderTable("diagnostic-content", ["Adapter", "ErrorCode", "안전한 요약"], rows);
  }

  function renderEvidence(report) {
    const rows = (report.evidence || []).map((evidence) => [evidence.id, evidence.source, evidence.location, evidence.summary]);
    renderTable("evidence-content", ["ID", "Source", "Location", "Summary"], rows);
  }

  function render(report) {
    const current = report.currentSnapshot;
    const persisted = report.persistedSnapshot;
    const evidence = evidenceById(report);
    $("service-name").textContent = current && current.serviceId ? current.serviceId : "서비스 식별 정보 미확인";
    setValue("phase", report.phase);
    setValue("collection-present", report.collectionPresent ? "존재" : "미실행");
    setValue("analysis-present", report.analysisPresent ? "존재" : "미실행");
    setValue("current-snapshot", report.currentSnapshotPresent ? "존재" : "없음");
    setValue("persisted-snapshot", report.persistedSnapshotPresent ? "존재" : "없음");
    renderKeyValues("snapshot-details", [
      ["현재 Snapshot ID", current && current.snapshotId],
      ["현재 Snapshot 시각", current && current.capturedAt],
      ["현재 Graph Fingerprint", current && current.graphFingerprint],
      ["보존 Snapshot ID", persisted && persisted.snapshotId],
      ["보존 Snapshot 시각", persisted && persisted.capturedAt],
      ["보존 Graph Fingerprint", persisted && persisted.graphFingerprint],
      ["오류 코드", report.errorCode]
    ]);
    renderEndpoints(report, evidence);
    renderChains(report);
    renderPolicies(report);
    renderFilters(report);
    renderFindings(report, evidence);
    renderDiagnostics(report);
    renderEvidence(report);
  }

  async function loadReport() {
    const button = $("refresh-button");
    button.disabled = true;
    setRequestState("결과 조회 중", "loading");
    try {
      const response = await fetch(reportUrl, { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(String(response.status));
      render(await response.json());
      setRequestState("최신 조회 결과", "success");
    } catch (error) {
      const message = { "401": "인증 필요", "403": "관리자 권한 필요", "404": "개발 전용 기능 비활성 또는 미등록" }[error.message]
        || "조회 실패 또는 네트워크 오류";
      setRequestState(message, "error");
    } finally {
      button.disabled = false;
    }
  }

  $("refresh-button").addEventListener("click", loadReport);
  loadReport();
})();
