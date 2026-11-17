(() => {
  "use strict";

  const STANDARD_FILTERS = Object.freeze([
    ["org.springframework.security.web.context.SecurityContextHolderFilter", "SecurityContextHolderFilter", "SecurityContext 준비"],
    ["org.springframework.security.web.header.HeaderWriterFilter", "HeaderWriterFilter", "보안 응답 Header 작성"],
    ["org.springframework.security.web.csrf.CsrfFilter", "CsrfFilter", "CSRF 보호"],
    ["org.springframework.security.web.authentication.logout.LogoutFilter", "LogoutFilter", "로그아웃 처리"],
    ["org.springframework.security.web.authentication.www.BasicAuthenticationFilter", "BasicAuthenticationFilter", "Basic 인증 처리"],
    ["org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter", "BearerTokenAuthenticationFilter", "Bearer Token 인증 처리"],
    ["org.springframework.security.web.savedrequest.RequestCacheAwareFilter", "RequestCacheAwareFilter", "저장 요청 복원"],
    ["org.springframework.security.web.servletapi.SecurityContextHolderAwareRequestFilter", "SecurityContextHolderAwareRequestFilter", "Servlet 요청 보안 문맥 연결"],
    ["org.springframework.security.web.authentication.AnonymousAuthenticationFilter", "AnonymousAuthenticationFilter", "익명 인증정보 설정"],
    ["org.springframework.security.web.session.SessionManagementFilter", "SessionManagementFilter", "Session 관리"],
    ["org.springframework.security.web.access.ExceptionTranslationFilter", "ExceptionTranslationFilter", "인가 예외 변환"],
    ["org.springframework.security.web.access.intercept.AuthorizationFilter", "AuthorizationFilter", "요청 인가 판단"]
  ].map(([fqcn, name, description], index) => Object.freeze({
    fqcn,
    name,
    description,
    referenceOrder: index + 1,
    source: "Spring Security 7 FilterOrderRegistration 참고"
  })));

  const STATUS_LABELS = Object.freeze({
    REGISTERED: "등록됨",
    REGISTERED_UNCERTAIN: "등록됨 · 적용 경로 확인 불가",
    CURRENT_PATH_APPLIED: "현재 경로 적용",
    CURRENT_PATH_NOT_APPLIED: "현재 경로 미적용",
    UNREGISTERED_REFERENCE: "참고: 미등록",
    UNKNOWN: "등록 여부 확인 불가"
  });

  function text(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function ready(value) {
    return text(value).toUpperCase() === "READY";
  }

  function classify(graph, analysisStatus = {}, endpointChainId = null) {
    const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
    const edges = graph && Array.isArray(graph.edges) ? graph.edges : [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const securityFilters = nodes.filter((node) => node.type === "FILTER"
      && node.attributes && node.attributes.registrationKind === "SECURITY");
    const completeRegistrationAnalysis = ready(analysisStatus && analysisStatus["security-chain"])
      && ready(analysisStatus && analysisStatus["security-filter-registration-analysis"]);

    return STANDARD_FILTERS.map((reference) => {
      const matches = securityFilters.filter((node) => node.attributes.filterClass === reference.fqcn);
      const registrations = matches.flatMap((filter) => edges
        .filter((edge) => edge.type === "FILTERED_BY" && edge.targetId === filter.id
          && (!edge.attributes || !edge.attributes.registrationKind
            || edge.attributes.registrationKind === "SECURITY"))
        .map((edge) => {
          const chain = nodeById.get(edge.sourceId);
          return {
            filterId: filter.id,
            edgeId: edge.id,
            chainId: chain && chain.type === "SECURITY_CHAIN" ? chain.id : null,
            pathStatus: endpointChainId && chain && chain.id === endpointChainId
              ? "CURRENT_PATH_APPLIED"
              : endpointChainId ? "CURRENT_PATH_NOT_APPLIED" : "REGISTERED"
          };
        }));
      let status = "UNKNOWN";
      if (matches.length === 0) {
        status = completeRegistrationAnalysis ? "UNREGISTERED_REFERENCE" : "UNKNOWN";
      } else if (endpointChainId) {
        status = registrations.some((registration) => registration.chainId === endpointChainId)
          ? "CURRENT_PATH_APPLIED"
          : registrations.length > 0 && registrations.every((registration) => registration.chainId)
            ? "CURRENT_PATH_NOT_APPLIED"
            : "REGISTERED_UNCERTAIN";
      } else {
        status = registrations.length > 0 && registrations.every((registration) => registration.chainId)
          ? "REGISTERED"
          : "REGISTERED_UNCERTAIN";
      }
      return {
        ...reference,
        status,
        statusLabel: STATUS_LABELS[status],
        registrations
      };
    });
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || STATUS_LABELS.UNKNOWN;
  }

  window.MapInBootStandardFilters = {
    list: () => STANDARD_FILTERS.slice(),
    classify,
    statusLabel
  };
})();
