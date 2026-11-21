(() => {
  "use strict";

  const STANDARD_FILTERS = Object.freeze([
    {
      fqcn: "org.springframework.security.web.context.SecurityContextHolderFilter",
      name: "SecurityContextHolderFilter",
      description: "SecurityContext 준비",
      role: "요청 처리에서 SecurityContext를 사용할 수 있도록 제공",
      input: "SecurityContextRepository, HttpServletRequest, HttpServletResponse",
      condition: "선택된 SecurityFilterChain에 이 Filter가 등록된 경우",
      processing: "저장소에서 SecurityContext를 읽어 SecurityContextHolder에 연결",
      outcomes: "현재 요청 처리에서 문맥 사용 가능, 다음 요청 저장은 별도 saveContext 호출 필요",
      cautions: "인증정보가 다음 요청에도 자동 저장됐다고 단정하지 않음"
    },
    {
      fqcn: "org.springframework.security.web.header.HeaderWriterFilter",
      name: "HeaderWriterFilter",
      description: "보안 응답 Header 작성",
      role: "설정된 보안 응답 헤더 작성",
      input: "HttpServletRequest, HttpServletResponse, 설정된 HeaderWriter",
      condition: "Filter와 해당 HeaderWriter가 구성된 경우",
      processing: "응답 처리 과정에서 구성된 HeaderWriter로 응답 헤더 작성",
      outcomes: "구성에 따른 보안 헤더가 응답에 추가될 수 있음",
      cautions: "실제 응답 헤더의 존재나 값을 관찰한 결과가 아님"
    },
    {
      fqcn: "org.springframework.security.web.csrf.CsrfFilter",
      name: "CsrfFilter",
      description: "CSRF 보호",
      role: "구성된 요청 조건에 따라 CSRF 토큰 검증",
      input: "HttpServletRequest, 요청에서 해석한 CSRF 토큰, CsrfTokenRepository",
      condition: "요청 Matcher가 보호 대상으로 판단하는 요청",
      processing: "저장된 기대 토큰과 요청 토큰을 비교하고 불일치를 거부할 수 있음",
      outcomes: "요청 흐름 계속 또는 AccessDeniedHandler에 의한 거부 처리",
      cautions: "요청 방식과 Matcher 설정은 애플리케이션 설정에 따라 달라짐"
    },
    {
      fqcn: "org.springframework.security.web.authentication.logout.LogoutFilter",
      name: "LogoutFilter",
      description: "로그아웃 처리",
      role: "구성된 로그아웃 요청을 찾아 로그아웃 절차 연결",
      input: "HttpServletRequest, HttpServletResponse, LogoutHandler 구성",
      condition: "요청이 구성된 로그아웃 RequestMatcher와 일치하는 경우",
      processing: "LogoutHandler와 성공 처리기로 로그아웃 절차 수행",
      outcomes: "로그아웃 요청 처리 또는 Matcher 불일치 시 다음 Filter로 전달",
      cautions: "모든 요청에서 로그아웃 처리가 실행되는 것은 아님"
    },
    {
      fqcn: "org.springframework.security.web.authentication.www.BasicAuthenticationFilter",
      name: "BasicAuthenticationFilter",
      description: "Basic 인증 처리",
      role: "HTTP Basic 인증정보를 Authentication으로 변환",
      input: "요청의 Authorization 정보, AuthenticationManager",
      condition: "구성된 Basic 인증 방식으로 요청 인증정보를 처리하는 경우",
      processing: "인증 요청을 AuthenticationManager에 위임하고 결과를 SecurityContext에 연결",
      outcomes: "인증 성공 후 다음 Filter로 전달하거나 인증 실패 처리",
      cautions: "실제 자격정보 원문이나 인증 성공 여부를 표시하지 않음"
    },
    {
      fqcn: "org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter",
      name: "BearerTokenAuthenticationFilter",
      description: "Bearer Token 인증 처리",
      role: "Bearer Token 인증 요청을 인증 처리에 연결",
      input: "요청에서 해석한 Bearer Token, AuthenticationManager",
      condition: "Bearer Token이 해석되고 이 Filter가 체인에 구성된 경우",
      processing: "인증 요청을 AuthenticationManager에 위임하고 결과를 SecurityContext에 연결",
      outcomes: "인증 성공 후 다음 Filter로 전달하거나 인증 실패 처리",
      cautions: "실제 Token 값이나 개별 인증 결과를 표시하지 않음"
    },
    {
      fqcn: "org.springframework.security.web.savedrequest.RequestCacheAwareFilter",
      name: "RequestCacheAwareFilter",
      description: "저장 요청 복원",
      role: "인증 이후 이어질 저장 요청을 현재 처리에 연결",
      input: "현재 HttpServletRequest, RequestCache에 저장된 요청",
      condition: "RequestCache에서 현재 요청과 연결할 저장 요청을 찾은 경우",
      processing: "저장 요청 정보를 사용하는 SavedRequestAwareWrapper로 요청을 감쌀 수 있음",
      outcomes: "저장 요청을 반영한 요청으로 계속하거나 현재 요청을 그대로 전달",
      cautions: "요청 저장·복원이나 이후 재요청이 실제 발생했다고 단정하지 않음"
    },
    {
      fqcn: "org.springframework.security.web.servletapi.SecurityContextHolderAwareRequestFilter",
      name: "SecurityContextHolderAwareRequestFilter",
      description: "Servlet 요청 보안 문맥 연결",
      role: "Servlet 요청 API에서 SecurityContext 기반 정보를 조회하도록 연결",
      input: "HttpServletRequest, SecurityContextHolder",
      condition: "Servlet API 연동 Filter가 체인에 구성된 경우",
      processing: "보안 관련 Servlet API를 제공하는 요청 래퍼로 전달",
      outcomes: "getUserPrincipal, isUserInRole 등 보안 관련 API를 사용할 수 있음",
      cautions: "실제 Principal이나 사용자 권한을 관찰한 결과가 아님"
    },
    {
      fqcn: "org.springframework.security.web.authentication.AnonymousAuthenticationFilter",
      name: "AnonymousAuthenticationFilter",
      description: "익명 인증정보 설정",
      role: "인증정보가 없는 SecurityContext에 익명 Authentication 제공",
      input: "현재 SecurityContext와 익명 인증 설정",
      condition: "현재 문맥에 Authentication이 없는 경우",
      processing: "구성된 익명 Authentication을 SecurityContext에 연결",
      outcomes: "익명 요청 문맥으로 다음 Filter에 전달",
      cautions: "익명 Authentication은 사용자가 인증됐다는 뜻이 아님"
    },
    {
      fqcn: "org.springframework.security.web.session.SessionManagementFilter",
      name: "SessionManagementFilter",
      description: "Session 관리",
      role: "현재 요청의 인증 문맥에 따른 Session 전략 연결",
      input: "SecurityContextRepository, SecurityContextHolder, SessionAuthenticationStrategy",
      condition: "애플리케이션 설정이 이 Filter를 체인에 포함한 경우",
      processing: "요청 내 인증 상태를 확인하고 구성된 SessionAuthenticationStrategy를 호출할 수 있음",
      outcomes: "Session 전략 실행, 별도 조치 없음 또는 설정된 Session 오류 처리",
      cautions: "모든 SecurityFilterChain에 기본 포함된다고 단정하지 않음"
    },
    {
      fqcn: "org.springframework.security.web.access.ExceptionTranslationFilter",
      name: "ExceptionTranslationFilter",
      description: "인가 예외 변환",
      role: "하위 Filter에서 전달된 보안 예외를 HTTP 응답 처리로 연결",
      input: "하위 Filter 실행, AuthenticationException, AccessDeniedException",
      condition: "하위 처리에서 AuthenticationException 또는 AccessDeniedException이 전달된 경우",
      processing: "인증 시작 처리를 요청하거나 AccessDeniedHandler로 거부 처리를 위임",
      outcomes: "AuthenticationEntryPoint 처리 또는 AccessDeniedHandler 처리",
      cautions: "해당 예외가 없으면 별도 동작하지 않으며 예외 발생을 관찰한 것으로 표현하지 않음"
    },
    {
      fqcn: "org.springframework.security.web.access.intercept.AuthorizationFilter",
      name: "AuthorizationFilter",
      description: "요청 인가 판단",
      role: "현재 요청에 적용되는 AuthorizationManager 정책 평가",
      input: "HttpServletRequest, Authentication, AuthorizationManager 정책",
      condition: "요청이 인가 Filter와 구성된 정책 평가에 도달한 경우",
      processing: "요청 접근 권한을 평가하고 거부 결과는 AccessDeniedException으로 전달할 수 있음",
      outcomes: "요청 흐름 계속 또는 거부 예외 전달",
      cautions: "교육 설명만으로 특정 요청의 실제 허용·거부를 확정하지 않음"
    }
  ].map((reference, index) => Object.freeze({
    ...reference,
    referenceOrder: index + 1,
    source: "Spring Security 7 공식 Servlet 아키텍처 참고 · 목록 순서는 교육용"
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
