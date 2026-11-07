(() => {
    "use strict";

    const state = {
        accessToken: null,
        sessionUser: null,
        csrfToken: null,
        busy: false,
        requestId: 0,
        enrollment: null,
        pendingEnrollments: [],
        loanDraft: null,
        pendingLoanApplications: [],
        pendingAdminProductCreations: [],
        labContexts: {
            customer: null,
            staff: null,
            unverifiedCustomer: null
        },
        labContextSequence: 0,
        labRuns: new Map(),
        labSubmissions: new Map(),
        homeTemplate: null,
        homeBodyClass: ""
    };

    const roleLabels = {
        ROLE_CUSTOMER: "고객",
        ROLE_STAFF: "직원",
        ROLE_BANK_ADMIN: "은행 관리자",
        MAP_IN_BOOT_ADMIN: "개발자"
    };

    const personaNames = {
        USER001: "고객 A",
        USER002: "고객 B",
        STAFF001: "직원 A",
        STAFF002: "직원 B",
        ADMIN001: "관리자 A",
        DEV001: "개발자 A"
    };

    const routes = new Set([
        "/demo/",
        "/demo/index.html",
        "/demo/login.html",
        "/demo/my/index.html",
        "/demo/accounts/index.html",
        "/demo/accounts/detail.html",
        "/demo/savings/index.html",
        "/demo/savings/product.html",
        "/demo/savings/enroll.html",
        "/demo/savings/complete.html",
        "/demo/my/savings.html",
        "/demo/my/savings-detail.html",
        "/demo/my/profile.html",
        "/demo/loans/index.html",
        "/demo/loans/product.html",
        "/demo/loans/apply.html",
        "/demo/identity/verify.html",
        "/demo/loans/confirm.html",
        "/demo/loans/complete.html",
        "/demo/my/loans.html",
        "/demo/my/loan-detail.html",
        "/demo/my/security.html",
        "/demo/staff/index.html",
        "/demo/staff/customers.html",
        "/demo/staff/customer.html",
        "/demo/staff/reports.html",
        "/demo/admin/index.html",
        "/demo/admin/savings.html",
        "/demo/admin/subscriptions.html",
        "/demo/admin/loans.html",
        "/demo/lab/index.html",
        "/demo/lab/scenario.html"
    ]);
    const routeQueryKeys = new Map([
        ["/demo/accounts/detail.html", new Set(["accountId"])],
        ["/demo/savings/product.html", new Set(["productId"])],
        ["/demo/savings/enroll.html", new Set(["productId"])],
        ["/demo/savings/complete.html", new Set(["subscriptionId"])],
        ["/demo/my/savings-detail.html", new Set(["subscriptionId"])],
        ["/demo/loans/product.html", new Set(["productId"])],
        ["/demo/loans/apply.html", new Set(["productId"])],
        ["/demo/identity/verify.html", new Set(["returnTo", "applicationId"])],
        ["/demo/loans/complete.html", new Set(["applicationId"])],
        ["/demo/my/loan-detail.html", new Set(["applicationId"])],
        ["/demo/staff/customer.html", new Set(["id"])],
        ["/demo/lab/scenario.html", new Set(["id"])]
    ]);
    const publicProductPaths = new Set([
        "/demo/savings/index.html",
        "/demo/savings/product.html",
        "/demo/loans/index.html",
        "/demo/loans/product.html"
    ]);

    const labScenarios = new Map([
        ["01", {
            id: "01",
            title: "레거시 계좌 요약 조회",
            service: "Main",
            authContext: "anonymous",
            business: "계좌 상세 업무에서 기존 요약 API의 보호 적용 여부를 비교합니다.",
            normal: { method: "GET", path: "/api/secured/legacy/account-summary/ACC001" },
            vulnerable: { method: "GET", path: "/api/legacy/account-summary/ACC001" },
            expected: { normal: [401], vulnerable: [200] },
            relatedPath: "/demo/accounts/detail.html?accountId=ACC001",
            rule: "SecurityFilterChain Matcher 적용 범위",
            guide: {
                account: "비로그인 HTTP 클라이언트",
                role: "인증 없음",
                prerequisites: ["로그인하지 않은 브라우저 또는 별도 HTTP 클라이언트", "로그인·Bearer JWT 불필요"],
                startPath: "/demo/accounts/detail.html?accountId=ACC001",
                input: ["계좌 식별자 ACC001", "화면 표시 계좌번호와 내부 API 식별자 구분"],
                steps: ["로그아웃 상태 또는 인증 없는 HTTP 클라이언트를 준비합니다.", "정상 API에 ACC001을 요청해 HTTP 401을 확인합니다.", "같은 ACC001을 취약 API에 요청해 HTTP 200과 계좌 요약 반환 여부를 확인합니다."],
                verification: "인증 없는 요청의 취약 경로에서 계좌 요약이 반환되면 보호 경계가 누락된 상태입니다.",
                limitations: ["V01이 HTTP 503이면 내부 서비스 인증 설정 미완료로 분류합니다.", "503은 취약점 재현 성공으로 표시하지 않습니다."]
            }
        }],
        ["02", {
            id: "02",
            title: "직원 보고서 조회",
            service: "Main",
            authContext: "anonymous",
            business: "영업점 보고서 API에 선행 Chain이 어떻게 적용되는지 비교합니다.",
            normal: { method: "GET", path: "/api/staff/protected/reports/summary" },
            vulnerable: { method: "GET", path: "/api/staff/reports/summary" },
            expected: { normal: [401], vulnerable: [200] },
            relatedPath: "/demo/staff/reports.html",
            rule: "SecurityFilterChain 순서와 Matcher",
            guide: {
                account: "비로그인 HTTP 클라이언트",
                role: "인증 없음",
                prerequisites: ["로그인하지 않은 브라우저 또는 별도 HTTP 클라이언트", "직원 계정 불필요"],
                startPath: "/demo/staff/reports.html",
                input: ["직원 보고서 요약 요청", "별도 입력값 없음"],
                steps: ["비로그인 상태를 준비합니다.", "정상 직원 보고서 API에 요청해 HTTP 401을 확인합니다.", "같은 조건으로 취약 보고서 API를 호출해 HTTP 200과 보고서 반환 여부를 확인합니다."],
                verification: "익명 요청의 취약 경로에서 직원 보고서가 반환되면 선행 SecurityFilterChain 보호가 누락된 상태입니다.",
                limitations: ["일반 직원 화면은 정상 API만 사용합니다.", "취약 경로의 데이터 반환을 별도 HTTP 요청으로 확인합니다."]
            }
        }],
        ["03", {
            id: "03",
            title: "직원 고객 검색",
            service: "Account",
            authContext: "anonymous",
            business: "직원 고객 검색 화면의 Role 보호 여부를 익명 요청으로 비교합니다.",
            normal: { method: "GET", path: "/api/staff/secured/customers/search?q=CUST" },
            vulnerable: { method: "GET", path: "/api/staff/customers/search?q=CUST" },
            expected: { normal: [401], vulnerable: [200] },
            relatedPath: "/demo/staff/customers.html",
            rule: "Role 기반 접근 제어와 permitAll 경계",
            guide: {
                account: "비로그인 HTTP 클라이언트",
                role: "인증 없음",
                prerequisites: ["로그인하지 않은 상태", "직원 Role 불필요"],
                startPath: "/demo/staff/customers.html",
                input: ["검색어 q=CUST"],
                steps: ["인증 없는 HTTP 클라이언트를 준비합니다.", "q=CUST로 정상 직원 검색 API를 호출해 HTTP 401을 확인합니다.", "같은 q=CUST를 취약 검색 API에 호출해 HTTP 200과 고객 검색 결과 여부를 확인합니다."],
                verification: "익명 취약 경로에서 고객 검색 결과가 반환되면 Role 보호와 공개 경계가 잘못 적용된 상태입니다.",
                limitations: ["일반 직원 검색 화면에서 직원으로 로그인하는 정상 업무와 익명 취약 API 요청을 혼동하지 않습니다."]
            }
        }],
        ["04", {
            id: "04",
            title: "직원 고객 기본 상세",
            service: "Account",
            authContext: "customer",
            business: "고객 A JWT로 고객 B의 직원 상세를 요청해 Method Security의 소유 범위를 비교합니다.",
            normal: { method: "GET", path: "/api/staff/secured/customers/CUST002" },
            vulnerable: { method: "GET", path: "/api/staff/customers/CUST002" },
            expected: { normal: [403], vulnerable: [200] },
            relatedPath: "/demo/staff/customers.html",
            rule: "Method Security Proxy 적용과 self-invocation",
            guide: {
                account: "customer.a",
                role: "ROLE_CUSTOMER",
                prerequisites: ["고객 A로 정상 로그인", "고객 A JWT 준비", "직원 계정 불필요"],
                startPath: "/demo/staff/customers.html",
                input: ["고객 B 식별자 CUST002"],
                steps: ["customer.a로 로그인해 고객 A JWT를 준비합니다.", "CUST002를 대상 고객으로 지정합니다.", "정상 직원 고객 상세 API에서 HTTP 403을 확인합니다.", "같은 JWT와 CUST002로 취약 API를 호출해 HTTP 200 및 고객 B 기본정보 반환 여부를 확인합니다."],
                verification: "고객 A JWT만으로 고객 B 상세가 취약 경로에서 반환되면 객체 권한 검사가 누락된 상태입니다.",
                limitations: ["일반 직원 상세 화면은 정상 API를 사용합니다.", "취약 요청은 Lab 실행 보조 기능 또는 별도 HTTP 클라이언트에서 수행합니다."]
            }
        }],
        ["05", {
            id: "05",
            title: "타인 계좌 상세 조회",
            service: "Account",
            authContext: "customer",
            business: "고객 A JWT로 고객 B의 계좌를 조회해 JWT 주체와 Account Owner 비교를 확인합니다.",
            normal: { method: "GET", path: "/api/secured/accounts/ACC002" },
            vulnerable: { method: "GET", path: "/api/accounts/ACC002" },
            expected: { normal: [403], vulnerable: [200] },
            relatedPath: "/demo/accounts/detail.html?accountId=ACC002",
            rule: "JWT Principal과 리소스 Owner 비교",
            guide: {
                account: "customer.a",
                role: "ROLE_CUSTOMER",
                prerequisites: ["고객 A로 정상 로그인", "고객 A JWT 준비"],
                startPath: "/demo/accounts/detail.html?accountId=ACC002",
                input: ["고객 B 내부 계좌 식별자 ACC002", "표시 계좌번호 0000-00-000200과 구분"],
                steps: ["customer.a로 로그인합니다.", "일반 내 계좌 화면에서 본인 계좌가 조회되는지 확인합니다.", "고객 A JWT를 준비하고 ACC002를 대상 계좌로 지정합니다.", "정상 계좌 상세 API에서 HTTP 403을 확인합니다.", "같은 JWT로 취약 API를 호출해 HTTP 200 및 고객 B 계좌 정보 반환 여부를 확인합니다."],
                verification: "고객 A 인증정보만으로 고객 B 계좌 정보가 반환되면 객체 단위 접근제어가 누락된 상태입니다.",
                limitations: ["일반 계좌 화면을 여는 것만으로 V05가 재현되는 것은 아닙니다.", "취약 API 요청을 별도로 수행해야 합니다."]
            }
        }],
        ["06", {
            id: "06",
            title: "Session 프로필 소유권 조회",
            service: "Identity",
            authContext: "customerSession",
            business: "고객 A의 Session으로 고객 B 프로필을 요청해 Session 주체 비교를 확인합니다.",
            normal: { method: "GET", path: "/api/session/secured/customers/CUST002/profile" },
            vulnerable: { method: "GET", path: "/api/session/customers/CUST002/profile" },
            expected: { normal: [403], vulnerable: [200] },
            relatedPath: "/demo/my/profile.html",
            rule: "Session Principal과 프로필 Owner 비교",
            guide: {
                account: "customer.a",
                role: "고객 A Session",
                prerequisites: ["Identity에 customer.a로 정상 로그인", "고객 A의 실제 Session Cookie", "Bearer JWT로 대체하지 않음"],
                startPath: "/demo/my/profile.html",
                input: ["고객 B 식별자 CUST002", "Session Cookie"],
                steps: ["customer.a로 로그인해 격리된 Session Cookie를 준비합니다.", "CUST002를 대상 고객으로 지정합니다.", "정상 Session 프로필 API를 호출해 HTTP 403을 확인합니다.", "동일한 Session Cookie로 취약 API를 호출해 HTTP 200 및 타인 프로필 반환 여부를 확인합니다."],
                verification: "고객 A Session으로 고객 B 프로필이 취약 경로에서 반환되면 Session 주체와 Owner 검사가 누락된 상태입니다.",
                limitations: ["JWT와 Session Cookie를 혼합하지 않습니다.", "브라우저 Cookie Header를 임의 조작하지 않고 별도 HTTP 클라이언트 또는 격리된 브라우저 문맥을 사용합니다."]
            }
        }],
        ["07", {
            id: "07",
            title: "미담당 고객 연락처 조회",
            service: "Account",
            authContext: "staff",
            business: "직원 A JWT와 다른 직원 식별 Header를 함께 사용해 담당 범위 검사를 비교합니다.",
            normal: { method: "GET", path: "/api/staff/secured/customers/CUST002/contact" },
            vulnerable: { method: "GET", path: "/api/staff/customers/CUST002/contact" },
            expected: { normal: [403], vulnerable: [200] },
            relatedPath: "/demo/staff/customer.html?id=CUST002",
            rule: "JWT 직원 주체와 담당 Assignment 비교",
            forgedStaffId: "STAFF002",
            guide: {
                account: "staff.a",
                role: "ROLE_STAFF",
                prerequisites: ["직원 A로 정상 로그인", "직원 A JWT 준비", "취약 요청에만 X-Staff-Id Header 사용"],
                startPath: "/demo/staff/customer.html?id=CUST002",
                input: ["담당하지 않는 고객 CUST002", "X-Staff-Id: STAFF002"],
                steps: ["staff.a로 로그인해 직원 A JWT를 준비합니다.", "담당하지 않는 고객 CUST002를 선택합니다.", "정상 연락처 API에서 HTTP 403을 확인합니다.", "동일한 직원 A JWT를 유지하고 취약 요청에만 X-Staff-Id: STAFF002를 추가합니다.", "취약 API에서 HTTP 200 및 고객 B 연락처 반환 여부를 확인합니다."],
                verification: "JWT 직원 주체와 다른 직원 ID Header를 권한 근거로 신뢰해 미담당 고객 연락처가 반환되면 Header 기반 권한 검증이 취약한 상태입니다.",
                limitations: ["일반 영업점 업무 화면에는 X-Staff-Id Header를 사용하지 않습니다.", "Header 값은 취약 요청 비교를 위한 입력입니다."]
            }
        }],
        ["08", {
            id: "08",
            title: "인증 갱신 Filter 순서",
            service: "Identity",
            authContext: "customer",
            business: "같은 고객 JWT로 정상·취약 Refresh 경로의 실제 응답 차이를 확인합니다.",
            normal: { method: "POST", path: "/api/auth/secured/refresh" },
            vulnerable: { method: "POST", path: "/api/auth/refresh" },
            expected: { normal: [200], vulnerable: [401] },
            relatedPath: "/demo/my/security.html",
            rule: "RefreshTokenFilter와 Bearer 인증 Filter 순서",
            guide: {
                account: "customer.a",
                role: "ROLE_CUSTOMER",
                prerequisites: ["고객 A로 정상 로그인", "유효한 JWT 준비", "JWT 원문은 화면에 출력하지 않음"],
                startPath: "/demo/my/security.html",
                input: ["동일한 유효 고객 JWT", "Refresh 요청"],
                steps: ["customer.a로 로그인합니다.", "유효한 JWT를 별도 안전한 검증 문맥에 준비합니다.", "정상 Refresh API를 호출해 HTTP 200을 확인합니다.", "같은 JWT로 취약 Refresh API를 호출해 HTTP 401을 확인합니다.", "두 경로에 적용되는 RefreshTokenFilter와 Bearer 인증 Filter 순서 차이를 확인합니다."],
                verification: "동일한 유효 JWT에서 정상·취약 Refresh 경로의 응답이 달라지면 Filter 적용 순서와 경로 보호 차이가 재현된 것입니다.",
                limitations: ["취약 응답이 200이어야만 취약점인 것은 아닙니다.", "JWT 원문·Refresh Token을 화면에 표시하거나 저장하지 않습니다."]
            }
        }],
        ["09", {
            id: "09",
            title: "본인확인 전 대출 신청",
            service: "Account",
            authContext: "unverifiedCustomer",
            business: "본인확인 전 고객 JWT로 같은 대출 신청을 정상·취약 경로에 각각 요청합니다.",
            normal: { method: "POST", path: "/api/secured/loans/applications" },
            vulnerable: { method: "POST", path: "/api/loans/applications" },
            expected: { normal: [403], vulnerable: [201] },
            relatedPath: "/demo/loans/apply.html?productId=LOAN-BASIC",
            rule: "JWT identity_verified 상태 검사",
            sideEffect: true,
            body: { productId: "LOAN-BASIC", amount: 1000000, purpose: "LIVING_COST" },
            guide: {
                account: "customer.a (identityVerified=false)",
                role: "ROLE_CUSTOMER",
                prerequisites: ["고객 A로 로그인", "identityVerified=false인 실제 고객 JWT", "LOAN-BASIC 판매 상품"],
                startPath: "/demo/loans/apply.html?productId=LOAN-BASIC",
                input: ["productId=LOAN-BASIC", "amount=1000000", "purpose=LIVING_COST"],
                steps: ["customer.a로 로그인하고 Identity 상태에서 본인확인 전 상태를 확인합니다.", "LOAN-BASIC과 신청금액 1000000, 목적 LIVING_COST를 준비합니다.", "정상 N09에 POST해 HTTP 403과 본인확인 필요 오류를 확인합니다.", "취약 V09는 명시적으로 확인한 경우에만 같은 Body로 실행합니다.", "V09가 HTTP 201과 신청번호를 반환하면 내 대출 목록에서 실제 저장 결과를 확인합니다."],
                verification: "본인확인 전 고객의 취약 POST가 HTTP 201로 실제 대출 신청을 저장하면 identity_verified 보호가 누락된 상태입니다.",
                limitations: ["V09는 실제 대출 데이터를 변경할 수 있습니다.", "화면 진입 시 자동 POST·중복 POST·네트워크 불명확 상태의 자동 재요청을 금지합니다.", "이미 OTP를 완료한 고객의 JWT를 미확인 상태로 취급하거나 Claim을 조작하지 않습니다."]
            }
        }],
        ["10", {
            id: "10",
            title: "내부 계좌 요약 Owner 검사",
            service: "Main",
            authContext: "customer",
            business: "Main 포털을 통해 고객 A가 고객 B 계좌 요약을 요청할 때 최종 Owner 검사를 비교합니다.",
            normal: { method: "GET", path: "/api/portal/secured/accounts/ACC002/summary" },
            vulnerable: { method: "GET", path: "/api/portal/accounts/ACC002/summary" },
            expected: { normal: [403], vulnerable: [200] },
            relatedPath: "/demo/accounts/detail.html?accountId=ACC002",
            rule: "Main 사용자 주체와 Account 내부 Owner 비교",
            guide: {
                account: "customer.a",
                role: "ROLE_CUSTOMER",
                prerequisites: ["고객 A로 정상 로그인", "고객 A JWT 준비", "Main·Account 서비스가 모두 실행 중"],
                startPath: "/demo/accounts/detail.html?accountId=ACC002",
                input: ["고객 B 내부 계좌 식별자 ACC002", "Main Portal 경유 요청"],
                steps: ["customer.a로 로그인해 고객 A JWT를 준비합니다.", "고객 B 계좌 ACC002를 대상으로 지정합니다.", "Main 정상 Portal API를 호출해 HTTP 403을 확인합니다.", "동일한 JWT로 Main 취약 Portal API를 호출해 HTTP 200 및 타인 계좌 요약 반환 여부를 확인합니다.", "Main에서 Account로 전달되는 내부 요청 경계와 최종 Owner 검사를 함께 확인합니다."],
                verification: "Main Portal 경유 취약 경로에서 고객 B 계좌 요약이 반환되면 최종 Owner 검사가 누락된 상태입니다.",
                limitations: ["브라우저에서 Account /internal API를 직접 호출하지 않습니다.", "내부 서비스 인증 설정이 빠져 503이면 환경 문제로 분류하며 취약점 성공으로 표시하지 않습니다."]
            }
        }]
    ]);

    // 현재 Main Origin 기준 Identity·Account Origin 계산
    function resolveServiceOrigin(offset) {
        if (!/^https?:$/.test(window.location.protocol)) {
            return null;
        }
        const mainPort = Number(window.location.port);
        if (!Number.isInteger(mainPort) || mainPort < 1) {
            return null;
        }
        const origin = new URL(window.location.origin);
        origin.port = String(mainPort + offset);
        return origin.origin;
    }

    const identityOrigin = resolveServiceOrigin(1);
    const accountOrigin = resolveServiceOrigin(2);

    function query(selector, parent = document) {
        return parent.querySelector(selector);
    }

    function queryAll(selector, parent = document) {
        return [...parent.querySelectorAll(selector)];
    }

    function appendText(parent, tagName, text, className) {
        const element = document.createElement(tagName);
        element.textContent = text;
        if (className) {
            element.className = className;
        }
        parent.append(element);
        return element;
    }

    function link(path, label, className = "") {
        const anchor = document.createElement("a");
        anchor.href = path;
        anchor.textContent = label;
        anchor.className = className;
        anchor.dataset.route = "true";
        return anchor;
    }

    // 서버 응답 상태에 따른 공통 메시지 표시
    function showStatus(element, variant, title, detail) {
        if (!element) {
            return;
        }
        element.className = `status-message ${variant}`;
        element.replaceChildren();
        appendText(element, "strong", title);
        if (detail) {
            appendText(element, "span", detail);
        }
        element.hidden = false;
    }

    async function readBody(response) {
        const text = await response.text();
        if (!text) {
            return null;
        }
        try {
            return JSON.parse(text);
        } catch {
            return null;
        }
    }

    function formatMoney(value) {
        const amount = Number(value);
        return Number.isFinite(amount)
            ? `${new Intl.NumberFormat("ko-KR").format(amount)}원`
            : "금액 정보 없음";
    }

    function formatDate(value) {
        if (typeof value !== "string") {
            return "날짜 정보 없음";
        }
        const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
        return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ko-KR").format(date);
    }

    function savingsKind(value) {
        return value === "DEPOSIT" ? "예금" : value === "INSTALLMENT" ? "적금" : "상품";
    }

    function roleLabel(user) {
        const role = Array.isArray(user?.roles) ? user.roles.find((value) => roleLabels[value]) : null;
        return role ? roleLabels[role] : "사용자";
    }

    // 사용자 식별자와 화면 표시용 persona 이름의 분리
    function displayName(user) {
        return personaNames[user?.userId] || roleLabel(user);
    }

    function navPathMatches(path, targetPath) {
        if (targetPath === "/demo/" || targetPath === "/demo/index.html") {
            return path === "/demo/" || path === "/demo/index.html";
        }
        if (targetPath === "/demo/my/index.html") {
            return path.startsWith("/demo/my/") || path.startsWith("/demo/accounts/");
        }
        if (targetPath === "/demo/savings/index.html") {
            return path.startsWith("/demo/savings/");
        }
        if (targetPath === "/demo/loans/index.html") {
            return path.startsWith("/demo/loans/") || path.startsWith("/demo/identity/");
        }
        if (targetPath === "/demo/staff/index.html") {
            return path.startsWith("/demo/staff/");
        }
        if (targetPath === "/demo/admin/index.html") {
            return path.startsWith("/demo/admin/");
        }
        if (targetPath === "/demo/lab/index.html") {
            return path.startsWith("/demo/lab/");
        }
        return path === targetPath;
    }

    function updateNavigationState(root = document) {
        const path = currentPath().split("?")[0];
        queryAll(".primary-nav a, .customer-nav a", root).forEach((link) => {
            let targetPath = link.getAttribute("href");
            try {
                targetPath = new URL(targetPath, window.location.origin).pathname;
            } catch {
                return;
            }
            const current = !link.hidden && navPathMatches(path, targetPath);
            link.classList.toggle("is-current", current);
            if (current) {
                link.setAttribute("aria-current", "page");
            } else {
                link.removeAttribute("aria-current");
            }
        });
    }

    // 공개 메뉴와 역할 전용 메뉴의 동시 노출 방지
    function applyNavigationPolicy(user, hasToken = Boolean(state.accessToken), root = document) {
        const roles = Array.isArray(user?.roles) ? user.roles : [];
        const authenticated = Boolean(hasToken && user?.userId);
        queryAll("[data-role-nav], [data-role-service]", root).forEach((element) => {
            const required = element.dataset.roleNav || element.dataset.roleService;
            if (!required) {
                return;
            }
            const visible = required === "public"
                || (authenticated && required === "customer" && roles.includes("ROLE_CUSTOMER"))
                || (authenticated && required === "staff" && roles.includes("ROLE_STAFF"))
                || (authenticated && required === "admin" && roles.includes("ROLE_BANK_ADMIN"))
                || (authenticated && required === "developer" && roles.includes("MAP_IN_BOOT_ADMIN"));
            element.hidden = !visible;
        });
        updateNavigationState(root);
    }

    function findPendingAdminProduct(userId) {
        return state.pendingAdminProductCreations.find((attempt) => attempt.userId === userId);
    }

    function removePendingAdminProduct(attempt) {
        const index = state.pendingAdminProductCreations.indexOf(attempt);
        if (index >= 0) {
            state.pendingAdminProductCreations.splice(index, 1);
        }
    }

    function appendStaffTabStatus(panel, variant, title, detail) {
        const status = document.createElement("div");
        showStatus(status, variant, title, detail);
        panel.append(status);
        return status;
    }

    function clearAuthState() {
        state.accessToken = null;
        state.sessionUser = null;
        state.csrfToken = null;
        state.enrollment = null;
        state.pendingEnrollments = [];
        state.loanDraft = null;
        state.pendingLoanApplications = [];
        state.pendingAdminProductCreations = [];
        state.labContexts = {
            customer: null,
            staff: null,
            unverifiedCustomer: null
        };
        state.labContextSequence = 0;
        state.labRuns = new Map();
        state.labSubmissions = new Map();
        applyNavigationPolicy(null, false);
        updateHeaderAuth(null);
    }

    function isCurrentScreen(root, requestId) {
        return requestId === state.requestId && root === screenRoot();
    }

    function isCurrentHome(requestId) {
        return requestId === state.requestId && document.body.dataset.page === "home";
    }

    class ApiError extends Error {
        constructor(status, message, requestId = state.requestId, code = null) {
            super(message);
            this.name = "ApiError";
            this.status = status;
            this.requestId = requestId;
            this.code = code;
        }
    }

    // Identity CSRF Token 조회
    async function loadCsrfToken() {
        if (!identityOrigin) {
            throw new Error("Identity 서비스 주소를 확인할 수 없습니다.");
        }
        const response = await fetch(`${identityOrigin}/api/auth/csrf`, {
            credentials: "include",
            cache: "no-store"
        });
        const body = await readBody(response);
        if (!response.ok || typeof body?.token !== "string" || body.token.length === 0) {
            const error = new ApiError(response.status, "CSRF Token을 가져오지 못했습니다.");
            throw error;
        }
        state.csrfToken = body.token;
        return state.csrfToken;
    }

    // Identity Session·Bearer 인증 요청
    async function identityRequest(path, options = {}) {
        const method = (options.method || "GET").toUpperCase();
        const headers = new Headers(options.headers || {});
        if (state.accessToken) {
            headers.set("Authorization", `Bearer ${state.accessToken}`);
        }
        if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
            headers.set("X-XSRF-TOKEN", await loadCsrfToken());
        }
        return fetch(`${identityOrigin}${path}`, {
            ...options,
            method,
            headers,
            credentials: "include"
        });
    }

    // Session 인증만 사용하는 프로필 요청
    async function sessionRequest(path) {
        return fetch(`${identityOrigin}${path}`, {
            credentials: "include",
            cache: "no-store"
        });
    }

    async function loadCurrentUser(includeBearer = false) {
        try {
            const headers = new Headers();
            if (includeBearer && state.accessToken) {
                headers.set("Authorization", `Bearer ${state.accessToken}`);
            }
            const response = await fetch(`${identityOrigin}/api/auth/me`, {
                headers,
                credentials: "include",
                cache: "no-store"
            });
            return { response, body: await readBody(response), error: null };
        } catch (error) {
            return { response: null, body: null, error };
        }
    }

    // 보호 API 공통 요청
    async function accountRequest(path, options = {}) {
        const requestId = state.requestId;
        if (!accountOrigin || !state.accessToken) {
            throw new ApiError(401, "로그인이 필요합니다.", requestId);
        }
        const expectedStatus = options.expectedStatus;
        const fetchOptions = { ...options };
        delete fetchOptions.expectedStatus;
        const headers = new Headers(options.headers || {});
        headers.set("Authorization", `Bearer ${state.accessToken}`);
        const response = await fetch(`${accountOrigin}${path}`, {
            ...fetchOptions,
            headers,
            credentials: "omit",
            cache: "no-store"
        });
        const body = await readBody(response);
        if (!response.ok) {
            throw new ApiError(
                response.status,
                body?.error?.message || "금융 API 요청에 실패했습니다.",
                requestId,
                body?.error?.code || null
            );
        }
        if (expectedStatus && response.status !== expectedStatus) {
            const error = new ApiError(response.status, "금융 API 응답 상태를 확인하지 못했습니다.", requestId);
            error.resultUnknown = true;
            throw error;
        }
        return body;
    }

    // Main 서비스 직원 보고서 보호 API 요청
    async function mainRequest(path, options = {}) {
        const requestId = state.requestId;
        if (!state.accessToken) {
            throw new ApiError(401, "로그인이 필요합니다.", requestId);
        }
        const expectedStatus = options.expectedStatus;
        const fetchOptions = { ...options };
        delete fetchOptions.expectedStatus;
        const headers = new Headers(options.headers || {});
        headers.set("Authorization", `Bearer ${state.accessToken}`);
        const response = await fetch(`${window.location.origin}${path}`, {
            ...fetchOptions,
            headers,
            credentials: "omit",
            cache: "no-store"
        });
        const body = await readBody(response);
        if (!response.ok) {
            throw new ApiError(
                response.status,
                body?.error?.message || "Main 업무 API 요청에 실패했습니다.",
                requestId,
                body?.error?.code || null
            );
        }
        if (expectedStatus && response.status !== expectedStatus) {
            const error = new ApiError(response.status, "Main 업무 API 응답 상태를 확인하지 못했습니다.", requestId);
            error.resultUnknown = true;
            throw error;
        }
        return body;
    }

    // Identity 업무 응답의 오류 코드와 메시지 보존
    async function identityApiRequest(path, options = {}) {
        const requestId = state.requestId;
        const response = await identityRequest(path, options);
        const body = await readBody(response);
        if (!response.ok) {
            throw new ApiError(
                response.status,
                body?.error?.message || "인증 API 요청에 실패했습니다.",
                requestId,
                body?.error?.code || null
            );
        }
        return body;
    }

    function publicResponseFormatError(requestId) {
        const error = new ApiError(null, "공개 금융상품 응답 형식을 확인하지 못했습니다.", requestId, "PUBLIC_RESPONSE_FORMAT");
        error.publicApi = true;
        return error;
    }

    async function publicAccountRequest(path) {
        const requestId = state.requestId;
        if (!accountOrigin) {
            const error = new ApiError(null, "Account 서비스 주소를 확인할 수 없습니다.", requestId, "PUBLIC_API_NETWORK");
            error.publicApi = true;
            error.networkError = true;
            throw error;
        }
        try {
            const response = await fetch(`${accountOrigin}${path}`, {
                credentials: "omit",
                cache: "no-store"
            });
            if (!response.ok) {
                const error = new ApiError(response.status, "공개 금융상품 조회에 실패했습니다.", requestId);
                error.publicApi = true;
                throw error;
            }
            return readBody(response);
        } catch (error) {
            if (error instanceof ApiError) {
                throw error;
            }
            const networkError = new ApiError(null, "공개 금융상품 서비스에 연결할 수 없습니다.", requestId, "PUBLIC_API_NETWORK");
            networkError.publicApi = true;
            networkError.networkError = true;
            throw networkError;
        }
    }

    function normalizePath(raw) {
        if (typeof raw !== "string" || !raw.startsWith("/demo/") || raw.startsWith("//")) {
            return null;
        }
        try {
            const url = new URL(raw, window.location.origin);
            if (url.origin !== window.location.origin
                    || url.pathname === "/demo/login.html"
                    || !routes.has(url.pathname)
                    || url.hash) {
                return null;
            }
            const allowedKeys = routeQueryKeys.get(url.pathname) || new Set();
            for (const key of url.searchParams.keys()) {
                if (!allowedKeys.has(key)) {
                    return null;
                }
            }
            if (url.pathname === "/demo/lab/scenario.html") {
                const scenarioIds = url.searchParams.getAll("id");
                if (scenarioIds.length !== 1 || !/^(0[1-9]|10)$/.test(scenarioIds[0])) {
                    return null;
                }
            }
            return `${url.pathname}${url.search}`;
        } catch {
            return null;
        }
    }

    // 로그인 후 이동 가능한 내부 경로 정규화
    function safeReturnTo() {
        const raw = new URLSearchParams(window.location.search).get("returnTo");
        return normalizePath(raw || "/demo/my/index.html") || "/demo/my/index.html";
    }

    function currentPath() {
        const pathname = window.location.pathname === "/demo" ? "/demo/" : window.location.pathname;
        return `${pathname}${window.location.search}`;
    }

    function redirectToLogin(returnTo) {
        const destination = normalizePath(returnTo) || "/demo/";
        window.location.assign(`/demo/login.html?returnTo=${encodeURIComponent(destination)}`);
    }

    function isPublicProductPath(path) {
        return publicProductPaths.has(path.split("?")[0]);
    }

    function isCustomerPath(path) {
        return path.startsWith("/demo/my/")
            || path.startsWith("/demo/accounts/")
            || path.startsWith("/demo/savings/")
            || path.startsWith("/demo/loans/")
            || path.startsWith("/demo/identity/");
    }

    function isStaffPath(path) {
        return path.startsWith("/demo/staff/");
    }

    function isAdminPath(path) {
        return path.startsWith("/demo/admin/");
    }

    function isLabPath(path) {
        return path.startsWith("/demo/lab/");
    }

    function defaultLandingPath(user) {
        const roles = Array.isArray(user?.roles) ? user.roles : [];
        if (roles.includes("MAP_IN_BOOT_ADMIN")) {
            return "/demo/lab/index.html";
        }
        if (roles.includes("ROLE_BANK_ADMIN")) {
            return "/demo/admin/index.html";
        }
        if (roles.includes("ROLE_STAFF")) {
            return "/demo/staff/index.html";
        }
        if (roles.includes("ROLE_CUSTOMER")) {
            return "/demo/my/index.html";
        }
        return "/demo/";
    }

    function canAccessPath(user, path) {
        if (path === "/demo/" || path === "/demo/index.html"
                || isPublicProductPath(path)
                || isLabPath(path)) {
            return true;
        }
        const roles = Array.isArray(user?.roles) ? user.roles : [];
        if (isCustomerPath(path)) {
            return roles.includes("ROLE_CUSTOMER");
        }
        if (isStaffPath(path)) {
            return roles.includes("ROLE_STAFF");
        }
        if (isAdminPath(path)) {
            return roles.includes("ROLE_BANK_ADMIN");
        }
        if (isLabPath(path)) {
            return roles.includes("MAP_IN_BOOT_ADMIN");
        }
        return false;
    }

    function resolveLoginDestination(user, requestedPath) {
        const normalized = normalizePath(requestedPath);
        return normalized && canAccessPath(user, normalized)
            ? normalized
            : defaultLandingPath(user);
    }

    function setPageTitle(title) {
        document.title = `Demo Bank | ${title}`;
    }

    function updateHeaderAuth(user) {
        const login = query("[data-header-login], [data-login-link]");
        const userLabel = query("[data-header-user], [data-user-label]");
        const logout = query("[data-logout]");
        if (!login || !userLabel || !logout) {
            return;
        }
        login.href = `/demo/login.html?returnTo=${encodeURIComponent(currentPath())}`;
        if (user?.userId) {
            login.hidden = true;
            userLabel.textContent = displayName(user);
            userLabel.hidden = false;
            logout.hidden = false;
            return;
        }
        login.hidden = false;
        userLabel.hidden = true;
        logout.hidden = true;
    }

    // 공개 상품 화면의 Session 상태 비동기 동기화
    async function syncHeaderAuth(requestId) {
        const currentUser = await loadCurrentUser(Boolean(state.accessToken));
        if (requestId !== state.requestId) {
            return;
        }
        if (currentUser.response?.ok && currentUser.body?.userId) {
            if (state.sessionUser && state.sessionUser.userId !== currentUser.body.userId) {
                clearAuthState();
            }
            state.sessionUser = currentUser.body;
            updateHeaderAuth(currentUser.body);
            applyNavigationPolicy(currentUser.body, Boolean(state.accessToken));
            return;
        }
        if (currentUser.response?.status === 401) {
            clearAuthState();
            updateHeaderAuth(null);
            applyNavigationPolicy(null, false);
            return;
        }
        updateHeaderAuth(state.sessionUser);
        applyNavigationPolicy(state.sessionUser, Boolean(state.accessToken));
    }

    function portalNavMarkup() {
        return `<a href="/demo/" data-route="true" data-role-nav="public">홈</a>
            <a href="/demo/savings/index.html" data-route="true" data-role-nav="public">상품</a>
            <a href="/demo/my/index.html" data-route="true" data-role-nav="customer" hidden>개인뱅킹</a>
            <a href="/demo/loans/index.html" data-route="true" data-role-nav="public">대출</a>
            <a href="/demo/staff/index.html" data-route="true" data-role-nav="staff" hidden>영업점</a>
            <a href="/demo/admin/index.html" data-route="true" data-role-nav="admin" hidden>은행 관리자</a>
            <a href="/demo/lab/index.html" data-route="true" data-role-nav="public">개발자 검증</a>`;
    }

    // 고객 화면 공통 프레임 구성
    function renderCustomerFrame(requestId, syncAuth = false) {
        document.body.className = "bank-page customer-page";
        document.body.dataset.page = "screen";
        document.body.replaceChildren();
        const header = document.createElement("header");
        header.className = "site-header customer-header";
        header.innerHTML = `<div class="shell header-inner">
            <a class="brand" href="/demo/" data-route="true" aria-label="Demo Bank 홈"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M6 14.5 16 7l10 7.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4"/><path d="M8.5 14.5v9h15v-9M5.5 25.5h21" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4"/><path d="M12 17v4.5M16 17v4.5M20 17v4.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2"/></svg></span><span class="brand-text"><strong>Demo Bank</strong><small>금융 Demo 포털</small></span></a>
            <nav class="customer-nav" aria-label="주요 메뉴">${portalNavMarkup()}</nav>
            <div class="header-tools" data-header-auth><a class="utility-link" data-header-login href="/demo/login.html">로그인</a><span class="user-label" data-header-user hidden></span><button class="button button-quiet button-small" type="button" data-logout hidden>로그아웃</button></div>
        </div>`;
        const main = document.createElement("main");
        main.className = "customer-main";
        main.innerHTML = `<div class="shell customer-content"><div data-screen-root></div></div>`;
        const footer = document.createElement("footer");
        footer.className = "site-footer";
        footer.innerHTML = `<div class="shell footer-inner"><div><strong>Demo Bank</strong><p>금융 서비스 포털</p></div><p>고객 금융 서비스</p></div>`;
        document.body.append(header, main, footer);
        applyNavigationPolicy(state.sessionUser, Boolean(state.accessToken));
        updateHeaderAuth(state.sessionUser);
        bindLogout();
        if (syncAuth) {
            syncHeaderAuth(requestId);
        }
    }

    // 직원·관리자 업무 화면 공통 프레임 구성
    function renderBusinessFrame(area, requestId = null) {
        document.body.className = "bank-page customer-page business-page";
        document.body.dataset.page = "screen";
        document.body.replaceChildren();
        const isStaff = area === "staff";
        const isLab = area === "lab";
        const footerLabel = isStaff ? "영업점 직원 업무" : isLab ? "개발자 보안 검증" : "은행 관리자 업무";
        const header = document.createElement("header");
        header.className = "site-header customer-header";
        header.innerHTML = `<div class="shell header-inner">
            <a class="brand" href="/demo/" data-route="true" aria-label="Demo Bank 홈"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M6 14.5 16 7l10 7.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4"/><path d="M8.5 14.5v9h15v-9M5.5 25.5h21" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4"/><path d="M12 17v4.5M16 17v4.5M20 17v4.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg></span><span class="brand-text"><strong>Demo Bank</strong><small>금융 Demo 포털</small></span></a>
            <nav class="customer-nav" aria-label="주요 메뉴">${portalNavMarkup()}</nav>
            <div class="header-tools" data-header-auth><a class="utility-link" data-header-login href="/demo/login.html">로그인</a><span class="user-label" data-header-user hidden></span><button class="button button-quiet button-small" type="button" data-logout hidden>로그아웃</button></div>
        </div>`;
        const main = document.createElement("main");
        main.className = "customer-main";
        main.innerHTML = `<div class="shell customer-content"><div data-screen-root></div></div>`;
        const footer = document.createElement("footer");
        footer.className = "site-footer";
        footer.innerHTML = `<div class="shell footer-inner"><div><strong>Demo Bank</strong><p>금융 서비스 포털</p></div><p>${footerLabel}</p></div>`;
        document.body.append(header, main, footer);
        applyNavigationPolicy(state.sessionUser, Boolean(state.accessToken));
        updateHeaderAuth(state.sessionUser);
        bindLogout();
        if (isLab && requestId !== null) {
            syncHeaderAuth(requestId);
        }
    }

    function screenRoot() {
        return query("[data-screen-root]");
    }

    function loginErrorMessage(error) {
        if (error.phase === "session") {
            return { title: error.message, detail: error.detail };
        }
        return { title: error.message || "로그인에 실패했습니다.", detail: "입력값과 네트워크 상태를 확인해 주세요." };
    }

    function setLoginBusy(form, busy) {
        const submit = query("[data-login-submit]", form);
        if (submit) {
            submit.disabled = busy;
            submit.textContent = busy ? "로그인 중..." : "로그인";
        }
    }

    // 로그인 응답과 Session 확인을 분리한 인증 처리
    async function submitLogin(form, destination) {
        const username = query("[name=username]", form);
        const password = query("[name=password]", form);
        const errorElement = query("[data-login-error]", form);
        if (!username?.value.trim() || !password?.value) {
            showStatus(errorElement, "is-error", "사용자명과 비밀번호를 입력해 주세요", "입력값을 확인한 뒤 다시 시도해 주세요.");
            return;
        }
        const requestId = ++state.requestId;
        clearAuthState();
        state.busy = true;
        setLoginBusy(form, true);
        errorElement.hidden = true;
        try {
            const response = await identityRequest("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: username.value.trim(), password: password.value })
            });
            const body = await readBody(response);
            if (requestId !== state.requestId) {
                return;
            }
            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error("사용자명 또는 비밀번호를 확인해 주세요.");
                }
                if (response.status === 403) {
                    throw new Error("보안 토큰을 확인하지 못했습니다. 다시 시도해 주세요.");
                }
                throw new Error("로그인 처리 중 오류가 발생했습니다.");
            }
            if (typeof body?.accessToken !== "string" || !body.accessToken) {
                throw new Error("로그인 응답을 확인하지 못했습니다.");
            }
            state.accessToken = body.accessToken;
            const currentUser = await loadCurrentUser(false);
            if (requestId !== state.requestId) {
                return;
            }
            if (currentUser.error) {
                const error = new Error("로그인은 처리되었지만 Session 확인 요청에 실패했습니다.");
                error.phase = "session";
                error.detail = "비밀번호 오류가 아닙니다. Identity 연결 상태를 확인한 뒤 다시 재로그인해 주세요.";
                throw error;
            }
            if (currentUser.response?.status === 401) {
                const error = new Error("로그인은 처리되었지만 Session 확인이 완료되지 않았습니다.");
                error.phase = "session";
                error.detail = "비밀번호 오류가 아닙니다. 브라우저 Session 상태를 확인한 뒤 다시 시도해 주세요.";
                throw error;
            }
            if (!currentUser.response?.ok || !currentUser.body?.userId) {
                const error = new Error("로그인은 처리되었지만 Session 사용자 확인에 실패했습니다.");
                error.phase = "session";
                error.detail = "인증 상태가 확정되지 않았습니다. 잠시 후 다시 확인해 주세요.";
                throw error;
            }
            const responseUserId = body.user?.id || body.user?.userId;
            if (responseUserId && responseUserId !== currentUser.body.userId) {
                const error = new Error("로그인 응답과 Session 사용자가 일치하지 않습니다.");
                error.phase = "session";
                error.detail = "이전 사용자 화면을 표시하지 않았습니다. 다시 로그인해 주세요.";
                throw error;
            }
            const landingPath = resolveLoginDestination(currentUser.body, destination);
            state.sessionUser = currentUser.body;
            await navigateTo(landingPath);
        } catch (error) {
            if (requestId !== state.requestId) {
                return;
            }
            clearAuthState();
            const message = loginErrorMessage(error);
            showStatus(errorElement, "is-error", message.title, message.detail);
            setLoginBusy(form, false);
        } finally {
            state.busy = false;
        }
    }

    function bindLoginForm(container, destination) {
        const form = query("[data-login-form]", container);
        if (!form || form.dataset.bound === "true") {
            return;
        }
        form.dataset.bound = "true";
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            if (!state.busy) {
                submitLogin(form, destination);
            }
        });
    }

    function bindLogout() {
        queryAll("[data-logout]").forEach((button) => {
            if (button.dataset.bound === "true") {
                return;
            }
            button.dataset.bound = "true";
            button.addEventListener("click", async () => {
                if (state.busy) {
                    return;
                }
                const requestId = ++state.requestId;
                state.busy = true;
                button.disabled = true;
                try {
                    const response = await identityRequest("/api/auth/logout", { method: "POST" });
                    if (requestId !== state.requestId) {
                        return;
                    }
                    if (!response.ok) {
                        throw new Error("로그아웃하지 못했습니다.");
                    }
                    clearAuthState();
                    await navigateTo("/demo/");
                } catch {
                    if (requestId !== state.requestId) {
                        return;
                    }
                    button.disabled = false;
                    showStatus(query("[data-screen-root]") || query("[data-auth-state]"), "is-error", "로그아웃하지 못했습니다", "서버 응답을 확인한 뒤 다시 시도해 주세요.");
                } finally {
                    state.busy = false;
                }
            });
        });
    }

    function renderHomeAuth(user, error) {
        const authState = query("[data-auth-state]");
        const loginLinks = queryAll("[data-login-link]");
        const logoutButtons = queryAll("[data-logout]");
        const userLabels = queryAll("[data-user-label]");
        applyNavigationPolicy(user, Boolean(state.accessToken));
        if (user) {
            const label = roleLabel(user);
            showStatus(authState, "is-auth", `${displayName(user)}님, 환영합니다`, `${label} 권한으로 로그인되었습니다.`);
            loginLinks.forEach((linkElement) => { linkElement.hidden = true; });
            logoutButtons.forEach((button) => { button.hidden = false; });
            userLabels.forEach((element) => {
                element.textContent = displayName(user);
                element.hidden = false;
            });
            return;
        }
        showStatus(
            authState,
            error ? "is-error" : "is-empty",
            error ? "로그인 상태를 확인하지 못했습니다" : "로그인하고 금융 서비스를 이용하세요",
            error ? "로그인 화면에서 다시 확인해 주세요." : "로그인하면 현재 사용자와 역할을 확인할 수 있습니다."
        );
        loginLinks.forEach((linkElement) => { linkElement.hidden = false; });
        logoutButtons.forEach((button) => { button.hidden = true; });
        userLabels.forEach((element) => { element.hidden = true; });
    }

    function captureHomeTemplate() {
        if (state.homeTemplate || document.body.dataset.page !== "home") {
            return;
        }
        state.homeBodyClass = document.body.className;
        state.homeTemplate = Array.from(document.body.children)
            .filter((element) => element.tagName !== "SCRIPT" && !element.matches(".support-grid"))
            .map((element) => element.cloneNode(true));
    }

    // same-tab 홈 복원과 초기 스크립트 중복 실행 방지
    async function restoreHomeDocument(requestId) {
        if (document.body.dataset.page === "home") {
            captureHomeTemplate();
            return true;
        }
        if (!state.homeTemplate) {
            try {
                const response = await fetch("/demo/index.html", { cache: "no-store" });
                if (!response.ok) {
                    throw new Error("홈 화면 조회 실패");
                }
                const markup = await response.text();
                const parsed = new DOMParser().parseFromString(markup, "text/html");
                state.homeBodyClass = parsed.body.className;
                state.homeTemplate = Array.from(parsed.body.children)
                    .filter((element) => element.tagName !== "SCRIPT" && !element.matches(".support-grid"))
                    .map((element) => element.cloneNode(true));
            } catch {
                if (requestId !== state.requestId) {
                    return false;
                }
                document.body.className = "bank-page";
                document.body.dataset.page = "home";
                document.body.replaceChildren();
                const status = document.createElement("div");
                status.className = "status-message is-server-error";
                showStatus(status, "is-server-error", "홈 화면을 불러오지 못했습니다", "잠시 후 다시 시도해 주세요.");
                document.body.append(status);
                return false;
            }
        }
        if (requestId !== state.requestId) {
            return false;
        }
        document.body.className = state.homeBodyClass;
        document.body.dataset.page = "home";
        document.body.replaceChildren(...state.homeTemplate
            .filter((element) => !element.matches(".support-grid"))
            .map((element) => element.cloneNode(true)));
        return true;
    }

    // 공지사항 목록 조회 및 상태 표시
    async function loadNotices(requestId = state.requestId) {
        const stateElement = query("[data-notices-state]");
        const listElement = query("[data-notices-list]");
        if (!stateElement || !listElement) {
            return;
        }
        listElement.hidden = true;
        listElement.replaceChildren();
        try {
            const response = await fetch("/api/public/notices", { cache: "no-store" });
            const body = await readBody(response);
            if (!isCurrentHome(requestId)) {
                return;
            }
            if (!response.ok || !Array.isArray(body)) {
                throw new Error("공지사항 조회 실패");
            }
            if (body.length === 0) {
                showStatus(stateElement, "is-empty", "등록된 공지가 없습니다", "새로운 소식이 등록되면 이곳에서 확인할 수 있습니다.");
                return;
            }
            body.forEach((notice) => {
                const item = document.createElement("li");
                item.className = "notice-item";
                appendText(item, "strong", notice.title || "제목 없음");
                appendText(item, "time", formatDate(notice.publishedAt));
                listElement.append(item);
            });
            stateElement.hidden = true;
            listElement.hidden = false;
        } catch {
            if (!isCurrentHome(requestId)) {
                return;
            }
            showStatus(stateElement, "is-server-error", "공지사항을 불러오지 못했습니다", "잠시 후 다시 시도해 주세요.");
        }
    }

    function productDetail(product) {
        return [
            savingsKind(product.kind),
            Number.isInteger(product.termMonths) ? `${product.termMonths}개월` : null,
            product.displayRate === null || product.displayRate === undefined ? null : `표시금리 ${product.displayRate}%`
        ].filter(Boolean).join(" · ") || "상품 정보 확인 필요";
    }

    function renderPublicProduct(listElement, product) {
        const item = document.createElement("a");
        item.className = "product-item";
        item.href = `/demo/savings/product.html?productId=${encodeURIComponent(product.productId)}`;
        item.dataset.route = "true";
        appendText(item, "strong", product.name || "상품명 없음");
        appendText(item, "span", productDetail(product));
        listElement.append(item);
    }

    function renderPublicLoanProduct(listElement, product) {
        const item = document.createElement("a");
        item.className = "product-item";
        item.href = `/demo/loans/product.html?productId=${encodeURIComponent(product.productId)}`;
        item.dataset.route = "true";
        appendText(item, "strong", product.name || "상품명 없음");
        appendText(item, "span", `${formatMoney(product.minAmount)} ~ ${formatMoney(product.maxAmount)}`);
        listElement.append(item);
    }

    async function loadProducts(path, listSelector, stateSelector, renderItem, requestId = null) {
        const stateElement = query(stateSelector);
        const listElement = query(listSelector);
        if (!stateElement || !listElement) {
            return;
        }
        listElement.hidden = true;
        listElement.replaceChildren();
        try {
            const body = await publicAccountRequest(path);
            if (requestId !== null && !isCurrentHome(requestId)) {
                return;
            }
            if (!Array.isArray(body)) {
                throw publicResponseFormatError(requestId ?? state.requestId);
            }
            if (body.length === 0) {
                showStatus(stateElement, "is-empty", "판매 중인 상품이 없습니다", "현재 이용 가능한 상품이 없습니다.");
                return;
            }
            body.forEach((product) => renderItem(listElement, product));
            stateElement.hidden = true;
            listElement.hidden = false;
        } catch (error) {
            if (requestId !== null && !isCurrentHome(requestId)) {
                return;
            }
            renderPublicProductError(stateElement, error);
        }
    }

    async function initHome(requestId = ++state.requestId) {
        captureHomeTemplate();
        bindLogout();
        await Promise.all([
            loadCurrentUser(Boolean(state.accessToken)).then((currentUser) => {
                if (!isCurrentHome(requestId)) {
                    return;
                }
                if (currentUser.response?.ok && currentUser.body?.userId) {
                    state.sessionUser = currentUser.body;
                } else if (currentUser.response?.status === 401) {
                    clearAuthState();
                }
                renderHomeAuth(state.sessionUser, currentUser.error || (currentUser.response && currentUser.response.status !== 401));
            }),
            loadNotices(requestId),
            loadProducts("/api/public/savings/products", "[data-savings-list]", "[data-savings-state]", renderPublicProduct, requestId),
            loadProducts("/api/public/loans/products", "[data-loans-list]", "[data-loans-state]", renderPublicLoanProduct, requestId)
        ]);
    }

    function renderHeading(root, eyebrow, title, detail) {
        const heading = document.createElement("section");
        heading.className = "customer-heading";
        heading.innerHTML = `<p class="eyebrow"></p><h1></h1><p class="customer-heading-detail"></p>`;
        query(".eyebrow", heading).textContent = eyebrow;
        query("h1", heading).textContent = title;
        query(".customer-heading-detail", heading).textContent = detail;
        root.append(heading);
    }

    function renderError(root, title, detail, variant = "is-error") {
        root.replaceChildren();
        const message = document.createElement("div");
        message.className = "status-message customer-status";
        showStatus(message, variant, title, detail);
        root.append(message);
    }

    function renderPublicProductError(root, error) {
        const formatError = error?.code === "PUBLIC_RESPONSE_FORMAT";
        const title = error?.status === 401
            ? "공개 상품 조회 인증 응답을 확인할 수 없습니다."
            : error?.status === 403
                ? "공개 상품 서비스 접근이 거부되었습니다."
                : error?.status >= 500
                    ? "공개 상품 서비스를 일시적으로 사용할 수 없습니다."
                    : error?.networkError
                        ? "공개 상품 서비스에 연결할 수 없습니다."
                        : formatError
                            ? "공개 상품 응답 형식을 확인할 수 없습니다."
                            : "공개 상품 정보를 불러오지 못했습니다.";
        const detail = error?.status === 403
            ? "브라우저 Origin과 공개 API 접근 설정을 확인해 주세요."
            : error?.networkError
                ? "네트워크 또는 접근 환경을 확인한 뒤 다시 시도해 주세요."
                : formatError
                    ? "서버가 반환한 상품 정보를 다시 확인해 주세요."
                    : "잠시 후 다시 시도해 주세요.";
        if (root.matches?.("[data-savings-state], [data-loans-state]")) {
            showStatus(root, "is-server-error", title, detail);
            return;
        }
        renderError(root, title, detail, "is-server-error");
    }

    // 보호 업무 화면 진입 전 Session·JWT·역할 상태 확인
    async function ensureRoleAccess(root, requestId, requiredRole, roleName) {
        if (!isCurrentScreen(root, requestId)) {
            return false;
        }
        if (!state.accessToken) {
            redirectToLogin(currentPath());
            return false;
        }
        const currentUser = await loadCurrentUser(Boolean(state.accessToken));
        if (!isCurrentScreen(root, requestId)) {
            return false;
        }
        if (currentUser.error) {
            renderError(root, "인증 서비스에 연결할 수 없습니다.", "네트워크 또는 인증 서비스 상태를 확인한 뒤 다시 시도해 주세요.", "is-server-error");
            return false;
        }
        if (currentUser.response?.status === 401) {
            clearAuthState();
            redirectToLogin(currentPath());
            return false;
        }
        if (currentUser.response?.status === 403) {
            renderError(root, "인증 서비스 접근이 거부되었습니다.", "현재 인증 서비스의 접근 설정을 확인해 주세요.", "is-forbidden");
            return false;
        }
        if (!currentUser.response?.ok || !currentUser.body?.userId) {
            renderError(root, "인증 상태를 확인할 수 없습니다.", "인증 서비스 응답을 확인한 뒤 다시 시도해 주세요.", "is-server-error");
            return false;
        }
        if (state.sessionUser && state.sessionUser.userId !== currentUser.body.userId) {
            clearAuthState();
            redirectToLogin(currentPath());
            return false;
        }
        if (!Array.isArray(currentUser.body.roles) || !currentUser.body.roles.includes(requiredRole)) {
            renderError(root, `${roleName} 권한이 필요한 화면입니다.`, "현재 계정으로는 이 업무 기능을 이용할 수 없습니다.", "is-forbidden");
            return false;
        }
        state.sessionUser = currentUser.body;
        updateHeaderAuth(currentUser.body);
        applyNavigationPolicy(currentUser.body, Boolean(state.accessToken));
        return true;
    }

    async function ensureCustomerAccess(root, requestId) {
        return ensureRoleAccess(root, requestId, "ROLE_CUSTOMER", "고객");
    }

    async function ensureStaffAccess(root, requestId) {
        return ensureRoleAccess(root, requestId, "ROLE_STAFF", "직원");
    }

    async function ensureAdminAccess(root, requestId) {
        return ensureRoleAccess(root, requestId, "ROLE_BANK_ADMIN", "은행 관리자");
    }

    // Lab 실제 요청 실행 전 개발자 JWT와 역할 확인
    async function ensureLabExecutionAccess(root, requestId) {
        if (!isCurrentScreen(root, requestId) || !state.accessToken) {
            return false;
        }
        const currentUser = await loadCurrentUser(true);
        if (!isCurrentScreen(root, requestId)) {
            return false;
        }
        if (currentUser.error || !currentUser.response?.ok || !currentUser.body?.userId) {
            if (currentUser.response?.status === 401) {
                clearAuthState();
                updateHeaderAuth(null);
                applyNavigationPolicy(null, false);
            }
            return false;
        }
        if (state.sessionUser && state.sessionUser.userId !== currentUser.body.userId) {
            clearAuthState();
            updateHeaderAuth(null);
            applyNavigationPolicy(null, false);
            return false;
        }
        if (!Array.isArray(currentUser.body.roles) || !currentUser.body.roles.includes("MAP_IN_BOOT_ADMIN")) {
            return false;
        }
        state.sessionUser = currentUser.body;
        updateHeaderAuth(currentUser.body);
        applyNavigationPolicy(currentUser.body, true);
        return true;
    }

    function handleScreenError(root, error, requestId) {
        if (!isCurrentScreen(root, requestId) || (error.requestId !== undefined && error.requestId !== state.requestId)) {
            return;
        }
        if (isPublicProductPath(currentPath())) {
            renderPublicProductError(root, error);
            return;
        }
        if (error.status === 401) {
            clearAuthState();
            redirectToLogin(currentPath());
            return;
        }
        if (error.status === 403) {
            renderError(root, "이 화면을 조회할 권한이 없습니다.", "요청한 자원의 소유권과 고객 권한을 확인해 주세요.");
            return;
        }
        if (error.status === 404) {
            renderError(root, "요청한 정보를 찾지 못했습니다.", "주소와 식별자를 확인한 뒤 다시 시도해 주세요.");
            return;
        }
        if (error.networkError || !error.status) {
            renderError(root, "금융 서비스에 연결할 수 없습니다.", "네트워크 또는 인증 서비스 상태를 확인한 뒤 다시 시도해 주세요.", "is-server-error");
            return;
        }
        renderError(root, "금융 정보를 불러오지 못했습니다.", "네트워크 상태를 확인한 뒤 다시 시도해 주세요.", "is-server-error");
    }

    function appendDetailGrid(parent, entries) {
        const grid = document.createElement("div");
        grid.className = "detail-grid";
        entries.forEach(([label, value]) => {
            const row = document.createElement("div");
            row.className = "detail-row";
            appendText(row, "span", label, "detail-label");
            appendText(row, "strong", value ?? "정보 없음");
            grid.append(row);
        });
        parent.append(grid);
        return grid;
    }

    function appendInfoRows(parent, entries) {
        const list = document.createElement("div");
        list.className = "customer-info-list customer-review-list";
        entries.forEach(([label, value]) => {
            const row = document.createElement("div");
            row.className = "customer-info-row customer-review-row";
            appendText(row, "span", label, "customer-info-label");
            appendText(row, "strong", value ?? "정보 없음", "customer-info-value");
            list.append(row);
        });
        parent.append(list);
        return list;
    }

    function appendAction(parent, path, label, variant = "button-secondary") {
        parent.append(link(path, label, `button ${variant}`));
    }

    function appendStatGrid(parent, entries) {
        const grid = document.createElement("div");
        grid.className = "stats-grid";
        entries.forEach(([label, value, detail]) => {
            const card = document.createElement("article");
            card.className = "stat-card";
            appendText(card, "span", label, "stat-label");
            appendText(card, "strong", value, "stat-value");
            appendText(card, "span", detail, "stat-detail");
            grid.append(card);
        });
        parent.append(grid);
    }

    function appendTable(parent, headers, rows) {
        const wrap = document.createElement("div");
        wrap.className = "table-wrap";
        const table = document.createElement("table");
        table.className = "data-table";
        const head = document.createElement("thead");
        const headRow = document.createElement("tr");
        headers.forEach((header) => appendText(headRow, "th", header));
        head.append(headRow);
        const body = document.createElement("tbody");
        rows.forEach((values) => {
            const row = document.createElement("tr");
            values.forEach((value) => appendText(row, "td", value ?? "정보 없음"));
            body.append(row);
        });
        table.append(head, body);
        wrap.append(table);
        parent.append(wrap);
        return wrap;
    }

    function renderCustomerFinanceIcon(kind) {
        const icon = document.createElement("span");
        icon.className = `customer-finance-icon is-${kind}`;
        icon.setAttribute("aria-hidden", "true");
        const icons = {
            account: `<svg viewBox="0 0 24 24"><path d="M4 9.5 12 4l8 5.5M6 10v8h12v-8M4 19h16M9 13v2M12 13v2M15 13v2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"/></svg>`,
            savings: `<svg viewBox="0 0 24 24"><path d="M5 8.5h14v10H5zM7 8.5V6h10v2.5M8 12h8M8 15h5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"/></svg>`,
            loan: `<svg viewBox="0 0 24 24"><path d="M4 10.5 12 5l8 5.5M6 10v8h12v-8M4 19h16M9 14h6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"/></svg>`,
            profile: `<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5.5 19c.8-3 3-4.5 6.5-4.5s5.7 1.5 6.5 4.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.7"/></svg>`
        };
        icon.innerHTML = icons[kind] || icons.account;
        return icon;
    }

    function renderCustomerFinanceRow({
        kind = "account",
        title,
        value,
        meta,
        actionLabel,
        actionPath,
        actionHandler,
        actionVariant = "button-secondary"
    }) {
        const row = document.createElement("article");
        row.className = "customer-finance-row";
        row.append(renderCustomerFinanceIcon(kind));
        const main = document.createElement("div");
        main.className = "customer-finance-main";
        appendText(main, "strong", title || "정보 없음", "customer-finance-title");
        if (value !== undefined && value !== null) {
            appendText(main, "span", value, "customer-finance-value");
        }
        if (meta) {
            appendText(main, "span", Array.isArray(meta) ? meta.filter(Boolean).join(" · ") : meta, "customer-finance-meta");
        }
        row.append(main);
        if (actionLabel) {
            const action = actionHandler ? document.createElement("button") : link(actionPath, actionLabel);
            action.className = `button ${actionVariant} customer-finance-action`;
            action.textContent = actionLabel;
            if (actionHandler) {
                action.type = "button";
                action.addEventListener("click", () => actionHandler(action));
            }
            row.append(action);
        }
        return row;
    }

    function customerAccountName(account) {
        return account.accountType === "CHECKING" ? "입출금 통장" : account.accountType || "계좌";
    }

    function customerAccountMeta(account) {
        return [account.accountNumber, account.status].filter(Boolean).join(" · ") || "계좌번호 정보 없음";
    }

    function transactionType(value) {
        return value === "DEPOSIT" ? "입금" : value === "WITHDRAWAL" ? "출금" : value || "거래";
    }

    function renderTransactionPanel(panel, account, transactions) {
        panel.replaceChildren();
        const heading = document.createElement("div");
        heading.className = "customer-transactions-heading";
        appendText(heading, "h3", "거래내역");
        appendText(heading, "span", account.accountNumber || "계좌번호 정보 없음", "customer-transactions-account");
        panel.append(heading);
        if (!transactions.length) {
            const empty = document.createElement("div");
            showStatus(empty, "is-empty", "거래내역이 없습니다", "해당 계좌에 등록된 거래가 없습니다.");
            panel.append(empty);
            return;
        }
        const list = document.createElement("div");
        list.className = "customer-transaction-list";
        transactions.forEach((transaction) => {
            const row = document.createElement("div");
            row.className = "customer-transaction-row";
            const detail = document.createElement("div");
            appendText(detail, "strong", transaction.description || "설명 없음");
            appendText(detail, "span", `${formatDate(transaction.occurredAt)} · ${transactionType(transaction.type)}`);
            appendText(row, "span", formatMoney(transaction.amount), transaction.type === "WITHDRAWAL" ? "amount-withdrawal" : "amount-deposit");
            row.prepend(detail);
            list.append(row);
        });
        panel.append(list);
    }

    function renderAccountList(root, accounts, requestId, expandedAccountId = null, initialTransactions = null) {
        const card = document.createElement("section");
        card.className = "customer-finance-card";
        const list = document.createElement("div");
        list.className = "customer-finance-list";
        const transactions = document.createElement("div");
        transactions.className = "customer-transactions";
        transactions.hidden = true;
        const transactionState = { version: 0, accountId: null };
        const rows = [];
        const loadTransactions = async (account, button, initial = null) => {
            if (transactionState.accountId === account.accountId && !transactions.hidden && initial === null) {
                transactions.hidden = true;
                transactionState.accountId = null;
                return;
            }
            const version = ++transactionState.version;
            transactionState.accountId = account.accountId;
            transactions.hidden = false;
            const loading = document.createElement("div");
            showStatus(loading, "is-loading", "거래내역을 불러오는 중입니다", "잠시만 기다려 주세요.");
            transactions.replaceChildren(loading);
            button.disabled = true;
            try {
                const body = initial || await accountRequest(`/api/my/accounts/${encodeURIComponent(account.accountId)}/transactions`);
                if (!isCurrentScreen(root, requestId) || version !== transactionState.version) {
                    return;
                }
                if (!Array.isArray(body)) {
                    throw new Error("거래내역 응답 형식 오류");
                }
                renderTransactionPanel(transactions, account, body);
            } catch (error) {
                if (isCurrentScreen(root, requestId) && version === transactionState.version) {
                    handleScreenError(root, error, requestId);
                }
            } finally {
                if (button.isConnected) {
                    button.disabled = false;
                }
            }
        };
        if (!accounts.length) {
            const empty = document.createElement("div");
            showStatus(empty, "is-empty", "보유 계좌가 없습니다", "현재 보유한 계좌가 없습니다.");
            list.append(empty);
        }
        accounts.forEach((account) => {
            const row = renderCustomerFinanceRow({
                kind: "account",
                title: customerAccountName(account),
                value: formatMoney(account.balance),
                meta: customerAccountMeta(account),
                actionLabel: "거래내역",
                actionHandler: (button) => loadTransactions(account, button)
            });
            const button = query(".customer-finance-action", row);
            rows.push({ account, button });
            list.append(row);
        });
        card.append(list, transactions);
        root.append(card);
        const selected = rows.find(({ account }) => account.accountId === expandedAccountId);
        if (selected) {
            void loadTransactions(selected.account, selected.button, initialTransactions);
        }
        return card;
    }

    async function renderMyHome(root, requestId) {
        if (!await ensureCustomerAccess(root, requestId)) {
            return;
        }
        root.replaceChildren();
        renderHeading(root, "내 계좌", "내 계좌", "보유 계좌와 거래내역을 확인합니다.");
        try {
            const accounts = await accountRequest("/api/my/accounts");
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!Array.isArray(accounts)) {
                throw new Error("계좌 응답 형식 오류");
            }
            renderAccountList(root, accounts, requestId);
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    async function renderAccounts(root, requestId) {
        if (!await ensureCustomerAccess(root, requestId)) {
            return;
        }
        root.replaceChildren();
        renderHeading(root, "내 계좌", "내 계좌", "보유 계좌와 거래내역을 확인합니다.");
        try {
            const accounts = await accountRequest("/api/my/accounts");
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!Array.isArray(accounts)) {
                throw new Error("계좌 응답 형식 오류");
            }
            renderAccountList(root, accounts, requestId);
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    async function renderAccountDetail(root, requestId) {
        if (!await ensureCustomerAccess(root, requestId)) {
            return;
        }
        const accountId = new URLSearchParams(window.location.search).get("accountId");
        root.replaceChildren();
        if (!accountId) {
            renderError(root, "계좌 식별자가 없습니다.", "내 계좌에서 계좌를 선택해 주세요.");
            return;
        }
        renderHeading(root, "내 계좌", "내 계좌", "선택한 계좌의 거래내역을 확인합니다.");
        try {
            const [account, accounts, transactions] = await Promise.all([
                accountRequest(`/api/secured/accounts/${encodeURIComponent(accountId)}`),
                accountRequest("/api/my/accounts"),
                accountRequest(`/api/my/accounts/${encodeURIComponent(accountId)}/transactions`)
            ]);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            const displayAccount = Array.isArray(accounts)
                ? accounts.find((item) => item.accountId === accountId) || account
                : account;
            renderAccountList(root, [displayAccount], requestId, accountId, Array.isArray(transactions) ? transactions : []);
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    function renderCustomerProductRow(product, kind, actionLabel, actionPath, actionVariant = "button-secondary") {
        if (kind === "savings") {
            return renderCustomerFinanceRow({
                kind: "savings",
                title: product.name || "상품명 정보 없음",
                value: `${savingsKind(product.kind)} · ${product.termMonths ?? "정보 없음"}개월 · 표시금리 ${product.displayRate ?? "정보 없음"}%`,
                meta: product.active ? "가입 가능" : "판매 중단",
                actionLabel,
                actionPath,
                actionVariant
            });
        }
        return renderCustomerFinanceRow({
            kind: "loan",
            title: product.name || "대출 상품",
            value: `${formatMoney(product.minAmount)} ~ ${formatMoney(product.maxAmount)}`,
            meta: product.active ? "신청 가능" : "신청 중단",
            actionLabel,
            actionPath,
            actionVariant
        });
    }

    async function renderSavingsList(root, requestId) {
        root.replaceChildren();
        renderHeading(root, "예적금 상품", "예적금 상품", "현재 판매 중인 예금과 적금 상품입니다.");
        try {
            const products = await publicAccountRequest("/api/public/savings/products");
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!Array.isArray(products)) {
                throw publicResponseFormatError(requestId);
            }
            const tabs = document.createElement("div");
            tabs.className = "tab-list";
            const card = document.createElement("section");
            card.className = "customer-finance-card";
            const catalog = document.createElement("div");
            catalog.className = "catalog-grid customer-product-list";
            const renderCatalog = (kind = "ALL") => {
                catalog.replaceChildren();
                const filtered = kind === "ALL" ? products : products.filter((product) => product.kind === kind);
                filtered.forEach((product) => {
                    catalog.append(renderCustomerProductRow(
                        product,
                        "savings",
                        "상세확인",
                        `/demo/savings/product.html?productId=${encodeURIComponent(product.productId)}`
                    ));
                });
                if (filtered.length === 0) {
                    const emptyState = document.createElement("div");
                    showStatus(emptyState, "is-empty", "해당 유형의 상품이 없습니다", "현재 이용 가능한 상품이 없습니다.");
                    catalog.append(emptyState);
                }
            };
            [["ALL", "전체"], ["DEPOSIT", "예금"], ["INSTALLMENT", "적금"]].forEach(([kind, label]) => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "tab-button";
                button.textContent = label;
                button.addEventListener("click", () => {
                    queryAll(".tab-button", tabs).forEach((item) => item.classList.remove("is-current"));
                    button.classList.add("is-current");
                    renderCatalog(kind);
                });
                tabs.append(button);
            });
            query(".tab-button", tabs).classList.add("is-current");
            card.append(catalog);
            root.append(tabs, card);
            renderCatalog();
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    function renderProductSummary(parent, product) {
        parent.append(renderCustomerProductRow(product, "savings"));
    }

    async function renderSavingsProduct(root, requestId) {
        root.replaceChildren();
        const productId = new URLSearchParams(window.location.search).get("productId");
        renderHeading(root, "상품 상세", "예적금 상품 상세", productId ? null : "상품 식별자가 필요합니다.");
        if (!productId) {
            renderError(root, "상품 식별자가 없습니다.", "상품 목록에서 상세 보기를 선택해 주세요.");
            return;
        }
        try {
            const product = await publicAccountRequest(`/api/public/savings/products/${encodeURIComponent(productId)}`);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!product || typeof product !== "object" || Array.isArray(product)) {
                throw publicResponseFormatError(requestId);
            }
            const card = document.createElement("section");
            card.className = "customer-finance-card";
            card.append(renderCustomerFinanceRow({
                kind: "savings",
                title: product.name || "상품명 정보 없음",
                value: `${savingsKind(product.kind)} · ${product.termMonths ?? "정보 없음"}개월`,
                meta: `표시금리 ${product.displayRate ?? "정보 없음"}%`
            }));
            appendInfoRows(card, [
                ["상품 종류", savingsKind(product.kind)],
                ["가입 기간", `${product.termMonths ?? "정보 없음"}개월`],
                ["표시금리", `${product.displayRate ?? "정보 없음"}%`],
                ["최소 가입금액", "0원 초과"],
                ["최대 가입금액", "별도 상한 미설정"],
                ["판매 상태", product.active ? "가입 가능" : "판매 중단"]
            ]);
            if (!product.active) {
                const stopped = document.createElement("div");
                showStatus(stopped, "is-empty", "현재 신규 가입이 중단된 상품입니다.", "판매 상태는 서버 응답을 기준으로 확인했습니다.");
                card.append(stopped);
            } else {
                const actions = document.createElement("div");
                actions.className = "page-actions customer-detail-actions";
                appendAction(actions, `/demo/savings/enroll.html?productId=${encodeURIComponent(product.productId)}`, "가입 신청", "button-primary");
                card.append(actions);
            }
            root.append(card);
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    function renderSubscriptionSummary(parent, subscription, title) {
        const section = document.createElement("section");
        section.className = "customer-finance-card";
        section.append(renderCustomerFinanceRow({
            kind: "savings",
            title: subscription.productName || subscription.productId || title || "가입 상세",
            value: formatMoney(subscription.principal),
            meta: [title, subscription.status ? `상태 ${subscription.status}` : null]
        }));
        appendInfoRows(section, [
            ["가입번호", subscription.subscriptionId],
            ["가입 상품", subscription.productName || subscription.productId],
            ["상품 식별자", subscription.productId],
            ["가입 원금", formatMoney(subscription.principal)],
            ["가입일", formatDate(subscription.joinedAt)],
            ["만기일", formatDate(subscription.maturityDate)],
            ["가입 상태", subscription.status]
        ]);
        return section;
    }

    function renderSubscriptionCard(subscription) {
        return renderCustomerFinanceRow({
            kind: "savings",
            title: subscription.productName || subscription.productId || "상품 정보 없음",
            value: formatMoney(subscription.principal),
            meta: [
                subscription.subscriptionId ? `가입번호 ${subscription.subscriptionId}` : null,
                `가입일 ${formatDate(subscription.joinedAt)}`,
                `만기일 ${formatDate(subscription.maturityDate)}`,
                `상태 ${subscription.status}`
            ],
            actionLabel: "상세확인",
            actionPath: `/demo/my/savings-detail.html?subscriptionId=${encodeURIComponent(subscription.subscriptionId)}`
        });
    }

    async function renderMySavings(root, requestId) {
        if (!await ensureCustomerAccess(root, requestId)) {
            return;
        }
        root.replaceChildren();
        renderHeading(root, "내 예적금", "내 예적금", "로그인한 고객님의 가입 내역입니다.");
        try {
            const subscriptions = await accountRequest("/api/my/savings");
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!Array.isArray(subscriptions)) {
                throw new Error("가입 내역 응답 형식 오류");
            }
            const card = document.createElement("section");
            card.className = "customer-finance-card";
            const grid = document.createElement("div");
            grid.className = "customer-finance-list";
            subscriptions.forEach((subscription) => grid.append(renderSubscriptionCard(subscription)));
            if (subscriptions.length === 0) {
                const empty = document.createElement("div");
                showStatus(empty, "is-empty", "가입한 예적금이 없습니다", "현재 가입한 예적금이 없습니다.");
                grid.append(empty);
            }
            card.append(grid);
            root.append(card);
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    async function renderSavingsDetail(root, requestId) {
        if (!await ensureCustomerAccess(root, requestId)) {
            return;
        }
        const subscriptionId = new URLSearchParams(window.location.search).get("subscriptionId");
        root.replaceChildren();
        renderHeading(root, "가입 상세", "예적금 가입 상세", subscriptionId ? null : "가입번호가 필요합니다.");
        if (!subscriptionId) {
            renderError(root, "가입번호가 없습니다.", "내 예적금 목록에서 상세 보기를 선택해 주세요.");
            return;
        }
        try {
            const subscription = await accountRequest(`/api/my/savings/${encodeURIComponent(subscriptionId)}`);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            root.append(renderSubscriptionSummary(root, subscription, "가입 내역"));
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    function enrollmentMessage(root, variant, title, detail) {
        const message = document.createElement("div");
        showStatus(message, variant, title, detail);
        root.prepend(message);
        return message;
    }

    function findPendingEnrollment(userId, productId) {
        return state.pendingEnrollments.find((pending) => pending.userId === userId && pending.productId === productId);
    }

    function clearPendingEnrollment(pendingEnrollment) {
        state.pendingEnrollments = state.pendingEnrollments.filter((pending) => pending !== pendingEnrollment);
    }

    function renderPendingEnrollment(root) {
        enrollmentMessage(root, "is-server-error", "가입 처리 결과를 확정할 수 없습니다.", "내 예적금 목록에서 가입 여부를 확인해 주세요.");
        appendAction(root, "/demo/my/savings.html", "내 예적금 확인", "button-primary");
    }

    function validatePrincipal(value) {
        if (!/^\d+(\.\d+)?$/.test(value)) {
            return false;
        }
        const amount = Number(value);
        return Number.isFinite(amount) && amount > 0;
    }

    function resetEnrollmentReview(form, root) {
        form.dataset.reviewed = "false";
        delete form.dataset.reviewSnapshot;
        query("[data-enrollment-review]", root)?.remove();
        query("[data-enroll-submit]", form).textContent = "가입 내용 확인";
    }

    function bindEnrollmentReviewReset(form, root) {
        const invalidateReview = () => {
            if (form.dataset.reviewed === "true") {
                resetEnrollmentReview(form, root);
            }
        };
        query("[name=principal]", form).addEventListener("input", invalidateReview);
        query("[name=terms]", form).addEventListener("change", invalidateReview);
    }

    async function submitEnrollment(form, product, root, requestId) {
        if (!isCurrentScreen(root, requestId)) {
            return;
        }
        const principal = query("[name=principal]", form).value.trim();
        const terms = query("[name=terms]", form).checked;
        let reviewSnapshot;
        if (form.dataset.reviewed === "true") {
            try {
                reviewSnapshot = JSON.parse(form.dataset.reviewSnapshot || "");
            } catch {
                reviewSnapshot = null;
            }
            if (!reviewSnapshot
                    || reviewSnapshot.productId !== product.productId
                    || reviewSnapshot.principal !== principal
                    || reviewSnapshot.terms !== terms) {
                resetEnrollmentReview(form, root);
                enrollmentMessage(root, "is-error", "가입 내용이 변경되었습니다", "변경된 금액과 약관 동의 상태를 다시 확인해 주세요.");
                return;
            }
        }
        if (!validatePrincipal(principal)) {
            enrollmentMessage(root, "is-error", "가입 금액을 확인해 주세요", "0보다 큰 숫자 형식의 금액을 입력해 주세요.");
            return;
        }
        if (!terms) {
            enrollmentMessage(root, "is-error", "약관 동의가 필요합니다", "가상 약관을 확인하고 동의해 주세요.");
            return;
        }
        if (form.dataset.reviewed !== "true") {
            const review = query("[data-enrollment-review]", root) || document.createElement("div");
            review.className = "review-panel";
            review.dataset.enrollmentReview = "true";
            review.replaceChildren();
            appendText(review, "strong", "가입 내용 확인");
            appendText(review, "span", `${product.name || product.productId} · ${formatMoney(principal)}`);
            appendText(review, "small", "최종 가입 신청 시 실제 Backend에 1건의 가입 내역이 생성됩니다.");
            form.before(review);
            form.dataset.reviewed = "true";
            form.dataset.reviewSnapshot = JSON.stringify({
                productId: product.productId,
                principal,
                terms
            });
            query("[data-enroll-submit]", form).textContent = "최종 가입 신청";
            return;
        }
        if (state.busy) {
            return;
        }
        state.busy = true;
        const submit = query("[data-enroll-submit]", form);
        const principalInput = query("[name=principal]", form);
        const termsInput = query("[name=terms]", form);
        submit.disabled = true;
        principalInput.disabled = true;
        termsInput.disabled = true;
        submit.textContent = "가입 처리 중...";
        let postStarted = false;
        let pendingEnrollment = null;
        try {
            const currentProduct = await publicAccountRequest(`/api/public/savings/products/${encodeURIComponent(product.productId)}`);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!currentProduct.active) {
                throw new ApiError(409, "현재 신규 가입이 중단된 상품입니다.");
            }
            pendingEnrollment = {
                userId: state.sessionUser.userId,
                productId: currentProduct.productId,
                principal,
                status: "SUBMITTING"
            };
            state.pendingEnrollments.push(pendingEnrollment);
            postStarted = true;
            const response = await fetch(`${accountOrigin}/api/my/savings`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${state.accessToken}`
                },
                credentials: "omit",
                body: JSON.stringify({ productId: currentProduct.productId, principal })
            });
            const body = await readBody(response);
            if (!response.ok) {
                if (response.status >= 500) {
                    const error = new ApiError(response.status, "가입 결과를 확인하지 못했습니다.");
                    error.resultUnknown = true;
                    throw error;
                }
                throw new ApiError(response.status, "가입 신청이 처리되지 않았습니다.");
            }
            if (!body?.subscriptionId) {
                const error = new Error("가입 응답에 가입번호가 없습니다.");
                error.resultUnknown = true;
                throw error;
            }
            clearPendingEnrollment(pendingEnrollment);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            state.enrollment = { subscriptionId: body.subscriptionId };
            await navigateTo(`/demo/savings/complete.html?subscriptionId=${encodeURIComponent(body.subscriptionId)}`);
        } catch (error) {
            const resultUnknown = postStarted && (error instanceof TypeError || error.resultUnknown === true);
            if (resultUnknown && pendingEnrollment) {
                pendingEnrollment.status = "UNRESOLVED";
            } else if (postStarted) {
                clearPendingEnrollment(pendingEnrollment);
            }
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (resultUnknown) {
                renderPendingEnrollment(root);
            } else if (error instanceof TypeError) {
                enrollmentMessage(root, "is-server-error", "상품 상태를 확인하지 못했습니다", "네트워크 상태를 확인한 뒤 가입 내용을 다시 확인해 주세요.");
            } else if (error.status === 401) {
                clearAuthState();
                redirectToLogin(currentPath());
            } else if (error.status === 409) {
                enrollmentMessage(root, "is-error", error.message, "상품의 최신 판매 상태를 확인해 주세요.");
            } else if (error.status === 400) {
                enrollmentMessage(root, "is-error", "가입 입력값을 확인해 주세요", "서버가 가입 요청을 거부했습니다.");
            } else if (error.status === 403) {
                enrollmentMessage(root, "is-error", "가입 권한이 없습니다", "현재 계정의 고객 권한을 확인해 주세요.");
            } else {
                enrollmentMessage(root, "is-server-error", "가입 신청에 실패했습니다", error.message || "잠시 후 다시 시도해 주세요.");
            }
            if (resultUnknown) {
                submit.disabled = true;
                submit.textContent = "내 예적금에서 결과 확인";
            } else {
                principalInput.disabled = false;
                termsInput.disabled = false;
                submit.disabled = false;
                submit.textContent = "최종 가입 신청";
            }
        } finally {
            state.busy = false;
        }
    }

    async function renderSavingsEnroll(root, requestId) {
        if (!await ensureCustomerAccess(root, requestId)) {
            return;
        }
        const productId = new URLSearchParams(window.location.search).get("productId");
        root.replaceChildren();
        renderHeading(root, "가입 신청", "예적금 가입 신청", productId ? "가입 가능 여부를 확인합니다." : "상품 식별자가 필요합니다.");
        if (!productId) {
            renderError(root, "상품 식별자가 없습니다.", "상품 상세에서 가입하기를 선택해 주세요.");
            return;
        }
        if (findPendingEnrollment(state.sessionUser.userId, productId)) {
            renderPendingEnrollment(root);
            return;
        }
        try {
            const product = await publicAccountRequest(`/api/public/savings/products/${encodeURIComponent(productId)}`);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!product.active) {
                renderError(root, "현재 신규 가입이 중단된 상품입니다.", "서버의 최신 판매 상태를 확인했습니다.", "is-empty");
                return;
            }
            const summary = document.createElement("section");
            summary.className = "customer-finance-card";
            renderProductSummary(summary, product);
            const card = document.createElement("section");
            card.className = "customer-finance-card customer-form-panel";
            const form = document.createElement("form");
            form.className = "customer-form";
            form.innerHTML = `<label class="field-label" for="principal">가입 금액</label><input class="field" id="principal" name="principal" inputmode="decimal" autocomplete="off" required><label class="check-field"><input type="checkbox" name="terms"><span>가상 약관을 확인하고 가입 내용에 동의합니다.</span></label><button class="button button-primary" data-enroll-submit type="submit">가입 내용 확인</button>`;
            bindEnrollmentReviewReset(form, root);
            form.addEventListener("submit", (event) => {
                event.preventDefault();
                submitEnrollment(form, product, root, requestId);
            });
            card.append(form);
            root.append(summary, card);
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    async function renderSavingsComplete(root, requestId) {
        if (!await ensureCustomerAccess(root, requestId)) {
            return;
        }
        const subscriptionId = new URLSearchParams(window.location.search).get("subscriptionId");
        root.replaceChildren();
        renderHeading(root, "가입 완료", "예적금 가입 완료", null);
        if (!subscriptionId) {
            renderError(root, "가입번호가 없습니다.", "가입 결과를 확인할 수 없어 내 예적금 목록으로 이동해 주세요.");
            return;
        }
        try {
            const subscription = await accountRequest(`/api/my/savings/${encodeURIComponent(subscriptionId)}`);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            root.append(renderSubscriptionSummary(root, subscription, "가입 완료"));
            const actions = document.createElement("div");
            actions.className = "page-actions";
            appendAction(actions, "/demo/my/savings.html", "내 예적금", "button-primary");
            appendAction(actions, `/demo/my/savings-detail.html?subscriptionId=${encodeURIComponent(subscriptionId)}`, "가입 상세");
            root.append(actions);
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    function customerIdFor(userId) {
        const fixtureCustomerIds = { USER001: "CUST001", USER002: "CUST002" };
        return fixtureCustomerIds[userId] || null;
    }

    async function renderProfile(root, requestId) {
        if (!await ensureCustomerAccess(root, requestId)) {
            return;
        }
        root.replaceChildren();
        renderHeading(root, "내 정보", "내 정보", "로그인 상태와 고객 프로필을 확인합니다.");
        try {
            const customerId = customerIdFor(state.sessionUser.userId);
            if (!customerId) {
                renderError(root, "고객 프로필을 확인할 수 없습니다.", "현재 고객 프로필 식별자를 확인하지 못했습니다.", "is-empty");
                return;
            }
            const response = await sessionRequest(`/api/session/secured/customers/${encodeURIComponent(customerId)}/profile`);
            const profile = await readBody(response);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!response.ok) {
                throw new ApiError(response.status, "Session 고객 프로필 조회에 실패했습니다.");
            }
            if (typeof profile?.customerId !== "string" || typeof profile?.displayName !== "string") {
                throw new Error("고객 프로필 응답 형식 오류");
            }
            const card = document.createElement("section");
            card.className = "customer-profile-card";
            const heading = document.createElement("div");
            heading.className = "customer-profile-heading";
            heading.append(renderCustomerFinanceIcon("profile"));
            const headingText = document.createElement("div");
            appendText(headingText, "strong", profile.displayName, "customer-profile-name");
            appendText(headingText, "span", "내 프로필", "customer-profile-subtitle");
            heading.append(headingText);
            card.append(heading);
            const rows = document.createElement("div");
            rows.className = "customer-profile-rows";
            [["고객번호", profile.customerId], ["본인확인", state.sessionUser.identityVerified ? "완료" : "미완료"]].forEach(([label, value]) => {
                const row = document.createElement("div");
                row.className = "customer-profile-row";
                appendText(row, "span", label);
                appendText(row, "strong", value);
                rows.append(row);
            });
            card.append(rows);
            root.append(card);
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    function loanPurposeLabel(value) {
        return value === "LIVING_COST" ? "생활비" : value === "HOUSING" ? "주거" : value === "OTHER" ? "기타" : "미선택";
    }

    function loanStatusLabel(value) {
        return value === "SUBMITTED" ? "신청 접수" : value === "REVIEW" ? "심사 검토" : value === "DONE" ? "처리 완료" : value || "상태 정보 없음";
    }

    function validateLoanAmount(value, product) {
        if (!/^\d+(\.\d+)?$/.test(value)) {
            return { valid: false, message: "대출 신청 금액을 숫자로 입력해 주세요." };
        }
        const amount = Number(value);
        const minimum = Number(product.minAmount);
        const maximum = Number(product.maxAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
            return { valid: false, message: "대출 신청 금액은 0보다 커야 합니다." };
        }
        if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || amount < minimum || amount > maximum) {
            return { valid: false, message: `${formatMoney(product.minAmount)} 이상 ${formatMoney(product.maxAmount)} 이하로 입력해 주세요.` };
        }
        return { valid: true, amount };
    }

    function findPendingLoan(userId, productId) {
        return state.pendingLoanApplications.find((pending) => pending.userId === userId && pending.productId === productId);
    }

    function clearPendingLoan(pendingLoan) {
        if (!pendingLoan) {
            return;
        }
        state.pendingLoanApplications = state.pendingLoanApplications.filter((pending) => pending !== pendingLoan);
    }

    function renderPendingLoan(root) {
        root.replaceChildren();
        enrollmentMessage(root, "is-server-error", "대출 신청 처리 결과를 확정할 수 없습니다.", "내 대출 신청 내역에서 접수 여부를 확인해 주세요. 자동으로 다시 신청하지 않습니다.");
        appendAction(root, "/demo/my/loans.html", "내 대출 확인", "button-primary");
    }

    function renderLoanProductCard(product) {
        return renderCustomerProductRow(
            product,
            "loan",
            "상세확인",
            `/demo/loans/product.html?productId=${encodeURIComponent(product.productId)}`
        );
    }

    async function renderLoanList(root, requestId) {
        root.replaceChildren();
        renderHeading(root, "대출 상품", "대출 상품", "현재 공개된 대출 상품과 신청 가능 금액을 확인합니다.");
        try {
            const products = await publicAccountRequest("/api/public/loans/products");
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!Array.isArray(products)) {
                throw publicResponseFormatError(requestId);
            }
            const card = document.createElement("section");
            card.className = "customer-finance-card";
            const grid = document.createElement("div");
            grid.className = "catalog-grid customer-product-list";
            products.forEach((product) => grid.append(renderLoanProductCard(product)));
            if (products.length === 0) {
                const empty = document.createElement("div");
                showStatus(empty, "is-empty", "판매 중인 대출 상품이 없습니다", "현재 이용 가능한 대출 상품이 없습니다.");
                grid.append(empty);
            }
            card.append(grid);
            root.append(card);
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    async function renderLoanProduct(root, requestId) {
        root.replaceChildren();
        const productId = new URLSearchParams(window.location.search).get("productId");
        renderHeading(root, "대출 상품 상세", "대출 상품 상세", productId ? null : "상품 식별자가 필요합니다.");
        if (!productId) {
            renderError(root, "상품 식별자가 없습니다.", "대출 상품 목록에서 상세 보기를 선택해 주세요.");
            return;
        }
        try {
            const product = await publicAccountRequest(`/api/public/loans/products/${encodeURIComponent(productId)}`);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!product || typeof product !== "object" || Array.isArray(product)) {
                throw publicResponseFormatError(requestId);
            }
            const card = document.createElement("section");
            card.className = "customer-finance-card";
            card.append(renderCustomerFinanceRow({
                kind: "loan",
                title: product.name || "대출 상품",
                value: `${formatMoney(product.minAmount)} ~ ${formatMoney(product.maxAmount)}`,
                meta: product.active ? "신청 가능" : "신청 중단"
            }));
            appendInfoRows(card, [
                ["상품명", product.name || "정보 없음"],
                ["최소 신청금액", formatMoney(product.minAmount)],
                ["최대 신청금액", formatMoney(product.maxAmount)],
                ["판매 상태", product.active ? "신청 가능" : "신청 중단"]
            ]);
            if (!product.active) {
                const stopped = document.createElement("div");
                showStatus(stopped, "is-empty", "현재 신청할 수 없습니다", "상품의 최신 판매 상태를 확인했습니다.");
                card.append(stopped);
            } else {
                const actions = document.createElement("div");
                actions.className = "page-actions customer-detail-actions";
                appendAction(actions, `/demo/loans/apply.html?productId=${encodeURIComponent(product.productId)}`, "대출 신청", "button-primary");
                card.append(actions);
            }
            root.append(card);
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    // 본인확인 상태를 서버에서 재조회하는 업무 호출
    async function loadIdentityStatus() {
        const body = await identityApiRequest("/api/identity/status");
        if (typeof body?.identityVerified !== "boolean") {
            throw new Error("본인확인 상태 응답 형식 오류");
        }
        return body;
    }

    // 본인확인 상태가 반영된 새 서명 JWT 수령
    async function refreshAccessToken(expectedRequestId = state.requestId) {
        if (expectedRequestId !== state.requestId) {
            return null;
        }
        const expectedUserId = state.sessionUser?.userId;
        const previousToken = state.accessToken;
        try {
            const body = await identityApiRequest("/api/auth/secured/refresh", { method: "POST" });
            if (expectedRequestId !== state.requestId) {
                return null;
            }
            const refreshedUserId = body?.user?.id || body?.user?.userId;
            if (typeof body?.accessToken !== "string" || !body.accessToken || !refreshedUserId) {
                throw new Error("인증 갱신 응답을 확인하지 못했습니다.");
            }
            if (expectedUserId && refreshedUserId !== expectedUserId) {
                throw new Error("인증 갱신 사용자 확인에 실패했습니다.");
            }
            state.accessToken = body.accessToken;
            const currentUser = await loadCurrentUser(true);
            if (expectedRequestId !== state.requestId) {
                state.accessToken = previousToken;
                return null;
            }
            if (currentUser.error || !currentUser.response?.ok || !currentUser.body?.userId) {
                throw new Error("갱신된 인증 Session을 확인하지 못했습니다.");
            }
            if (expectedUserId && currentUser.body.userId !== expectedUserId) {
                throw new Error("갱신된 인증 사용자가 일치하지 않습니다.");
            }
            state.sessionUser = currentUser.body;
            return currentUser.body;
        } catch (error) {
            state.accessToken = previousToken;
            throw error;
        }
    }

    function loanIdentityAction(root, returnPath) {
        renderError(root, "추가 본인확인이 필요합니다.", "신청 또는 결과 조회를 계속하려면 본인확인을 완료해 주세요.", "is-forbidden");
        const actions = document.createElement("div");
        actions.className = "page-actions";
        appendAction(actions, `/demo/identity/verify.html?returnTo=${encodeURIComponent(returnPath)}`, "본인확인하기", "button-primary");
        root.append(actions);
    }

    function loanDraftSnapshot(draft) {
        return {
            userId: draft.userId,
            productId: draft.productId,
            amount: draft.amount,
            purpose: draft.purpose,
            terms: draft.terms
        };
    }

    function sameLoanDraft(draft, snapshot) {
        return Boolean(draft && snapshot
            && draft.userId === snapshot.userId
            && draft.productId === snapshot.productId
            && draft.amount === snapshot.amount
            && draft.purpose === snapshot.purpose
            && draft.terms === snapshot.terms);
    }

    function hasLoanDraftForUser(userId) {
        const draft = state.loanDraft;
        return Boolean(draft
            && draft.userId === userId
            && ["DRAFT", "REVIEW_REQUIRED"].includes(draft.status)
            && typeof draft.productId === "string"
            && draft.productId.length > 0
            && Number.isFinite(draft.amount)
            && draft.amount > 0
            && ["LIVING_COST", "HOUSING", "OTHER"].includes(draft.purpose)
            && draft.terms === true);
    }

    // 본인확인 완료 후 대출 초안의 서버 상품·입력 유효성 재확인
    async function prepareLoanDraftForConfirm(userId, requestId) {
        if (!hasLoanDraftForUser(userId)) {
            return false;
        }
        const draft = state.loanDraft;
        const product = await publicAccountRequest(`/api/public/loans/products/${encodeURIComponent(draft.productId)}`);
        if (requestId !== state.requestId) {
            return null;
        }
        const amount = validateLoanAmount(String(draft.amount), product);
        if (!product.active || !amount.valid) {
            return false;
        }
        draft.amount = amount.amount;
        draft.reviewed = true;
        draft.status = "REVIEW_REQUIRED";
        draft.reviewedSnapshot = loanDraftSnapshot(draft);
        return true;
    }

    async function submitLoanDraft(form, product, root, requestId) {
        if (form.dataset.submitting === "true" || state.busy) {
            return;
        }
        const amountInput = query("[name=amount]", form);
        const purposeInput = query("[name=purpose]", form);
        const termsInput = query("[name=terms]", form);
        const errorElement = query("[data-loan-form-error]", form);
        const amountValue = amountInput.value.trim();
        const validation = validateLoanAmount(amountValue, product);
        if (!validation.valid) {
            showStatus(errorElement, "is-error", "신청 금액을 확인해 주세요", validation.message);
            return;
        }
        if (!termsInput.checked) {
            showStatus(errorElement, "is-error", "약관 동의가 필요합니다", "가상 약관을 확인하고 동의해 주세요.");
            return;
        }
        form.dataset.submitting = "true";
        state.busy = true;
        queryAll("input, select, button", form).forEach((element) => { element.disabled = true; });
        try {
            const currentProduct = await publicAccountRequest(`/api/public/loans/products/${encodeURIComponent(product.productId)}`);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!currentProduct.active) {
                throw new ApiError(409, "현재 신청할 수 없는 상품입니다.");
            }
            const currentValidation = validateLoanAmount(amountValue, currentProduct);
            if (!currentValidation.valid) {
                throw new ApiError(400, currentValidation.message);
            }
            const draft = {
                userId: state.sessionUser.userId,
                productId: currentProduct.productId,
                amount: currentValidation.amount,
                purpose: purposeInput.value,
                terms: termsInput.checked,
                reviewed: false,
                status: "DRAFT"
            };
            state.loanDraft = draft;
            const identityStatus = await loadIdentityStatus();
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (identityStatus.identityVerified) {
                const currentUser = await refreshAccessToken(requestId);
                if (!currentUser || !isCurrentScreen(root, requestId)) {
                    return;
                }
                if (!currentUser.identityVerified) {
                    throw new Error("본인확인 상태가 최신 인증에 반영되지 않았습니다.");
                }
                draft.reviewed = true;
                draft.status = "REVIEW_REQUIRED";
                draft.reviewedSnapshot = loanDraftSnapshot(draft);
                await navigateTo("/demo/loans/confirm.html");
                return;
            }
            await navigateTo(`/demo/identity/verify.html?returnTo=${encodeURIComponent("/demo/loans/confirm.html")}`);
        } catch (error) {
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (error.status === 401) {
                clearAuthState();
                redirectToLogin(currentPath());
            } else if (error.status === 409) {
                enrollmentMessage(root, "is-error", error.message, "상품의 최신 판매 상태를 확인해 주세요.");
            } else if (error.status === 400) {
                showStatus(errorElement, "is-error", "신청 내용을 확인해 주세요", error.message);
            } else {
                showStatus(errorElement, "is-server-error", "본인확인 상태를 확인하지 못했습니다", "잠시 후 다시 시도해 주세요. 신청 내용은 화면 메모리에만 유지됩니다.");
            }
        } finally {
            state.busy = false;
            if (form.isConnected) {
                form.dataset.submitting = "false";
                queryAll("input, select, button", form).forEach((element) => { element.disabled = false; });
            }
        }
    }

    async function renderLoanApply(root, requestId) {
        if (!await ensureCustomerAccess(root, requestId)) {
            return;
        }
        const productId = new URLSearchParams(window.location.search).get("productId");
        root.replaceChildren();
        renderHeading(root, "대출 신청", "대출 신청서", productId ? "신청 내용을 입력합니다." : "상품 식별자가 필요합니다.");
        if (!productId) {
            renderError(root, "상품 식별자가 없습니다.", "대출 상품 상세에서 신청하기를 선택해 주세요.");
            return;
        }
        if (findPendingLoan(state.sessionUser.userId, productId)) {
            renderPendingLoan(root);
            return;
        }
        try {
            const product = await publicAccountRequest(`/api/public/loans/products/${encodeURIComponent(productId)}`);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!product.active) {
                renderError(root, "현재 신청할 수 없는 상품입니다.", "상품의 최신 판매 상태를 확인했습니다.", "is-empty");
                return;
            }
            const summary = document.createElement("section");
            summary.className = "customer-finance-card";
            summary.append(renderCustomerProductRow(product, "loan"));
            const card = document.createElement("section");
            card.className = "customer-finance-card customer-form-panel";
            const form = document.createElement("form");
            form.className = "customer-form";
            form.innerHTML = `<label class="field-label" for="loan-amount">대출 신청 금액</label><input class="field" id="loan-amount" name="amount" inputmode="decimal" autocomplete="off" required><label class="field-label" for="loan-purpose">신청 목적</label><select class="select-control" id="loan-purpose" name="purpose"><option value="LIVING_COST">생활비</option><option value="HOUSING">주거</option><option value="OTHER">기타</option></select><label class="check-field"><input type="checkbox" name="terms"><span>가상 약관을 확인하고 신청 내용에 동의합니다.</span></label><div class="status-message is-error" data-loan-form-error role="alert" hidden></div><button class="button button-primary" data-loan-next type="submit">다음</button>`;
            const existingDraft = state.loanDraft && state.loanDraft.userId === state.sessionUser.userId && state.loanDraft.productId === product.productId && state.loanDraft.status !== "SUBMITTED"
                ? state.loanDraft
                : null;
            if (existingDraft) {
                query("[name=amount]", form).value = String(existingDraft.amount);
                query("[name=purpose]", form).value = existingDraft.purpose || "LIVING_COST";
                query("[name=terms]", form).checked = existingDraft.terms === true;
            }
            form.addEventListener("submit", (event) => {
                event.preventDefault();
                submitLoanDraft(form, product, root, requestId);
            });
            card.append(form);
            root.append(summary, card);
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    async function submitIdentityVerification(form, root, requestId, returnPath) {
        if (form.dataset.submitting === "true" || state.busy) {
            return;
        }
        const input = query("[name=verificationCode]", form);
        const errorElement = query("[data-identity-error]", form);
        const code = input.value.trim();
        if (!/^\d{6}$/.test(code)) {
            showStatus(errorElement, "is-error", "인증번호를 확인해 주세요", "6자리 숫자를 입력해 주세요.");
            return;
        }
        const expectedUserId = state.sessionUser?.userId;
        const previousToken = state.accessToken;
        form.dataset.submitting = "true";
        state.busy = true;
        queryAll("input, button", form).forEach((element) => { element.disabled = true; });
        try {
            const body = await identityApiRequest("/api/identity/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ method: "DEMO_OTP", verificationCode: code })
            });
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (typeof body?.accessToken !== "string" || !body.accessToken || body.identityVerified !== true) {
                throw new Error("본인확인 응답을 확인하지 못했습니다.");
            }
            state.accessToken = body.accessToken;
            const currentUser = await loadCurrentUser(true);
            if (!isCurrentScreen(root, requestId)) {
                state.accessToken = previousToken;
                return;
            }
            if (currentUser.error || !currentUser.response?.ok || currentUser.body?.userId !== expectedUserId || currentUser.body?.identityVerified !== true) {
                state.accessToken = previousToken;
                throw new Error("갱신된 본인확인 사용자를 확인하지 못했습니다.");
            }
            const status = await loadIdentityStatus();
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!status.identityVerified) {
                throw new Error("본인확인 상태 재조회가 완료되지 않았습니다.");
            }
            state.sessionUser = currentUser.body;
            if (returnPath === "/demo/loans/confirm.html") {
                const draftReady = await prepareLoanDraftForConfirm(expectedUserId, requestId);
                if (!isCurrentScreen(root, requestId)) {
                    return;
                }
                if (!draftReady) {
                    await navigateTo("/demo/my/security.html");
                    return;
                }
            }
            await navigateTo(returnPath);
        } catch (error) {
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (error instanceof TypeError || error.status >= 500) {
                try {
                    const recoveredStatus = await loadIdentityStatus();
                    if (isCurrentScreen(root, requestId) && recoveredStatus.identityVerified) {
                        const recoveredUser = await refreshAccessToken(requestId);
                        if (recoveredUser?.identityVerified && isCurrentScreen(root, requestId)) {
                            state.sessionUser = recoveredUser;
                            if (returnPath === "/demo/loans/confirm.html") {
                                const draftReady = await prepareLoanDraftForConfirm(expectedUserId, requestId);
                                if (!isCurrentScreen(root, requestId)) {
                                    return;
                                }
                                if (!draftReady) {
                                    await navigateTo("/demo/my/security.html");
                                    return;
                                }
                            }
                            await navigateTo(returnPath);
                            return;
                        }
                    }
                } catch {
                    // 서버 상태 재확인 실패 시 자동 OTP 재전송 없이 현재 화면 유지
                }
                if (isCurrentScreen(root, requestId)) {
                    showStatus(errorElement, "is-server-error", "본인확인 결과를 확인하지 못했습니다", "서버 상태를 다시 확인해 주세요. 인증번호를 자동으로 재전송하지 않습니다.");
                }
            } else if (error.status === 401) {
                clearAuthState();
                redirectToLogin(currentPath());
            } else if (error.status === 400) {
                showStatus(errorElement, "is-error", "인증번호가 올바르지 않습니다", "6자리 인증번호를 확인한 뒤 다시 입력해 주세요.");
            } else if (error.status === 403) {
                renderError(root, "본인확인을 진행할 권한이 없습니다.", "고객 계정으로 다시 로그인해 주세요.");
            } else {
                showStatus(errorElement, "is-server-error", "본인확인을 완료하지 못했습니다", "네트워크 상태를 확인한 뒤 다시 시도해 주세요.");
            }
        } finally {
            state.busy = false;
            if (form.isConnected) {
                form.dataset.submitting = "false";
                queryAll("input, button", form).forEach((element) => { element.disabled = false; });
            }
        }
    }

    function resolveIdentityReturnPath(userId, applicationId, rawReturn) {
        const requestedReturn = normalizePath(rawReturn || "");
        const safeRequestedReturn = requestedReturn
            && !requestedReturn.startsWith("/demo/identity/verify.html")
            && requestedReturn !== currentPath()
            ? requestedReturn
            : null;
        const detailReturn = applicationId
            ? `/demo/my/loan-detail.html?applicationId=${encodeURIComponent(applicationId)}`
            : null;
        const hasDraft = hasLoanDraftForUser(userId);
        const returnsToDetail = safeRequestedReturn?.startsWith("/demo/my/loan-detail.html");
        const returnsToSecurity = safeRequestedReturn === "/demo/my/security.html";
        const returnPath = detailReturn
            || (safeRequestedReturn === "/demo/loans/confirm.html" && hasDraft
                ? safeRequestedReturn
                : (returnsToDetail || returnsToSecurity)
                    ? safeRequestedReturn
                    : hasDraft
                        ? "/demo/loans/confirm.html"
                        : "/demo/my/security.html");
        return returnPath;
    }

    async function renderIdentityVerify(root, requestId) {
        if (!await ensureCustomerAccess(root, requestId)) {
            return;
        }
        const params = new URLSearchParams(window.location.search);
        const applicationId = params.get("applicationId");
        const returnPath = resolveIdentityReturnPath(state.sessionUser.userId, applicationId, params.get("returnTo"));
        root.replaceChildren();
        renderHeading(root, "본인확인", "안전한 금융거래를 위한 본인확인", "대출 신청과 결과 조회를 위해 현재 고객의 본인확인 상태를 확인합니다.");
        try {
            const status = await loadIdentityStatus();
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (status.identityVerified) {
                const currentUser = await refreshAccessToken(requestId);
                if (!currentUser || !isCurrentScreen(root, requestId)) {
                    return;
                }
                if (!currentUser.identityVerified) {
                    throw new Error("본인확인 상태가 최신 인증에 반영되지 않았습니다.");
                }
                if (returnPath === "/demo/loans/confirm.html") {
                    const draftReady = await prepareLoanDraftForConfirm(currentUser.userId, requestId);
                    if (!isCurrentScreen(root, requestId)) {
                        return;
                    }
                    if (!draftReady) {
                        await navigateTo("/demo/my/security.html");
                        return;
                    }
                }
                await navigateTo(returnPath);
                return;
            }
            const card = document.createElement("section");
            card.className = "customer-finance-card identity-card";
            appendText(card, "h2", "인증번호 입력");
            appendText(card, "p", `${displayName(state.sessionUser)} 고객님의 가상 본인확인 절차입니다.`);
            const steps = document.createElement("ol");
            steps.className = "identity-steps";
            ["정보 확인", "인증번호 입력", "완료"].forEach((label, index) => appendText(steps, "li", `${index + 1}. ${label}`, index === 1 ? "is-current" : ""));
            card.append(steps);
            const form = document.createElement("form");
            form.className = "customer-form";
            form.innerHTML = `<label class="field-label" for="verification-code">가상 인증번호</label><input class="field" id="verification-code" name="verificationCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required><div class="status-message is-error" data-identity-error role="alert" hidden></div><div class="page-actions"><button class="button button-primary" type="submit">인증하기</button><a class="button button-secondary" data-route="true" href="/demo/loans/index.html">취소</a></div>`;
            const verificationInput = query("[name=verificationCode]", form);
            verificationInput.value = "123456";
            const demoOtpNote = document.createElement("p");
            demoOtpNote.className = "otp-demo-note";
            demoOtpNote.textContent = "※demo용 임시 인증번호로 자동으로 입력됩니다.※";
            verificationInput.after(demoOtpNote);
            form.addEventListener("submit", (event) => {
                event.preventDefault();
                submitIdentityVerification(form, root, requestId, returnPath);
            });
            card.append(form);
            root.append(card);
        } catch (error) {
            if (error.status === 401) {
                clearAuthState();
                redirectToLogin(currentPath());
                return;
            }
            handleScreenError(root, error, requestId);
        }
    }

    async function submitLoanApplication(form, product, root, requestId) {
        if (form.dataset.submitting === "true" || state.busy) {
            return;
        }
        const draft = state.loanDraft;
        const userId = state.sessionUser?.userId;
        const snapshot = draft?.reviewedSnapshot;
        if (!draft || draft.userId !== userId || draft.status !== "REVIEW_REQUIRED" || !sameLoanDraft(draft, snapshot)) {
            renderError(root, "신청 확인 상태가 만료되었습니다.", "신청 내용을 다시 확인해 주세요.");
            appendAction(root, `/demo/loans/apply.html?productId=${encodeURIComponent(product.productId)}`, "신청 내용 다시 확인", "button-primary");
            return;
        }
        form.dataset.submitting = "true";
        state.busy = true;
        queryAll("button", form).forEach((element) => { element.disabled = true; });
        let postStarted = false;
        let pendingLoan = null;
        try {
            const currentProduct = await publicAccountRequest(`/api/public/loans/products/${encodeURIComponent(product.productId)}`);
            if (!currentProduct.active) {
                throw new ApiError(409, "현재 신청할 수 없는 상품입니다.");
            }
            const amountValidation = validateLoanAmount(String(draft.amount), currentProduct);
            if (!amountValidation.valid) {
                throw new ApiError(400, amountValidation.message);
            }
            if (state.loanDraft !== draft || !sameLoanDraft(draft, snapshot)) {
                throw new Error("신청 확인 내용이 변경되었습니다.");
            }
            const identityStatus = await loadIdentityStatus();
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!identityStatus.identityVerified) {
                throw new ApiError(403, "본인확인이 필요합니다.", state.requestId, "IDENTITY_VERIFICATION_REQUIRED");
            }
            const currentUser = await refreshAccessToken(requestId);
            if (!currentUser || !isCurrentScreen(root, requestId)) {
                return;
            }
            if (!currentUser.identityVerified) {
                throw new ApiError(403, "본인확인이 필요합니다.", state.requestId, "IDENTITY_VERIFICATION_REQUIRED");
            }
            pendingLoan = {
                userId,
                productId: draft.productId,
                amount: draft.amount,
                status: "SUBMITTING"
            };
            state.pendingLoanApplications.push(pendingLoan);
            postStarted = true;
            const body = await accountRequest("/api/secured/loans/applications", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ productId: draft.productId, amount: draft.amount, purpose: draft.purpose }),
                expectedStatus: 201
            });
            if (typeof body?.applicationId !== "string" || body.applicationId.trim() === "") {
                const error = new Error("대출 신청 응답에 신청번호가 없습니다.");
                error.resultUnknown = true;
                throw error;
            }
            if (state.sessionUser?.userId === userId) {
                clearPendingLoan(pendingLoan);
                if (state.loanDraft === draft) {
                    draft.status = "SUBMITTED";
                    draft.applicationId = body.applicationId;
                }
            }
            if (isCurrentScreen(root, requestId)) {
                await navigateTo(`/demo/loans/complete.html?applicationId=${encodeURIComponent(body.applicationId)}`);
            }
        } catch (error) {
            const sameUser = state.sessionUser?.userId === userId;
            const pendingIsCurrent = pendingLoan && state.pendingLoanApplications.includes(pendingLoan) && sameUser;
            const resultUnknown = postStarted && (error instanceof TypeError || error.resultUnknown === true || error.status >= 500);
            if (resultUnknown && pendingIsCurrent) {
                pendingLoan.status = "UNRESOLVED";
                if (state.loanDraft === draft) {
                    draft.status = "UNRESOLVED";
                }
            } else if (postStarted && pendingIsCurrent) {
                clearPendingLoan(pendingLoan);
            }
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (resultUnknown) {
                renderPendingLoan(root);
            } else if (error.status === 401) {
                clearAuthState();
                redirectToLogin(currentPath());
            } else if (error.status === 403 && error.code === "IDENTITY_VERIFICATION_REQUIRED") {
                if (state.loanDraft === draft) {
                    draft.status = "DRAFT";
                }
                loanIdentityAction(root, "/demo/loans/confirm.html");
            } else if (error.status === 400) {
                enrollmentMessage(root, "is-error", "신청 내용을 확인해 주세요", error.message || "서버가 신청을 거부했습니다.");
            } else if (error.status === 409) {
                enrollmentMessage(root, "is-error", error.message || "현재 신청할 수 없습니다", "상품의 최신 판매 상태를 확인해 주세요.");
            } else if (error.status === 404) {
                enrollmentMessage(root, "is-error", "신청 상품을 찾지 못했습니다", "상품 목록에서 다시 확인해 주세요.");
            } else if (error.status === 403) {
                renderError(root, "대출 신청 권한이 없습니다.", "현재 계정으로는 이 신청을 처리할 수 없습니다.");
            } else {
                enrollmentMessage(root, "is-server-error", "대출 신청을 처리하지 못했습니다", "신청 결과가 확정되지 않은 경우 내 대출에서 접수 여부를 확인해 주세요.");
            }
        } finally {
            state.busy = false;
            if (form.isConnected) {
                form.dataset.submitting = "false";
                queryAll("button", form).forEach((element) => { element.disabled = false; });
            }
        }
    }

    function renderLoanApplicationSummary(application, title) {
        const section = document.createElement("section");
        section.className = "customer-finance-card";
        section.append(renderCustomerFinanceRow({
            kind: "loan",
            title: application.productName || application.productId || title || "대출 신청 내역",
            value: formatMoney(application.amount),
            meta: [title, `상태 ${loanStatusLabel(application.status)}`]
        }));
        appendInfoRows(section, [
            ["신청번호", application.applicationId],
            ["상품", application.productId],
            ["신청 금액", formatMoney(application.amount)],
            ["접수일", formatDate(application.createdAt)],
            ["현재 상태", loanStatusLabel(application.status)]
        ]);
        return section;
    }

    async function renderLoanConfirm(root, requestId) {
        if (!await ensureCustomerAccess(root, requestId)) {
            return;
        }
        root.replaceChildren();
        renderHeading(root, "신청 내용 확인", "대출 신청 최종 확인", "내용을 확인한 뒤 신청 접수를 선택해 주세요.");
        const draft = state.loanDraft;
        if (!draft || draft.userId !== state.sessionUser.userId || draft.status !== "REVIEW_REQUIRED") {
            renderError(root, "확인할 신청 내용이 없습니다.", "대출 상품에서 신청 내용을 다시 작성해 주세요.");
            appendAction(root, "/demo/loans/index.html", "대출 상품 보기", "button-primary");
            return;
        }
        try {
            const product = await publicAccountRequest(`/api/public/loans/products/${encodeURIComponent(draft.productId)}`);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!product.active) {
                renderError(root, "현재 신청할 수 없는 상품입니다.", "상품의 최신 판매 상태를 확인했습니다.", "is-empty");
                return;
            }
            if (!sameLoanDraft(draft, draft.reviewedSnapshot)) {
                renderError(root, "신청 확인 상태가 변경되었습니다.", "신청 내용을 다시 확인해 주세요.");
                appendAction(root, `/demo/loans/apply.html?productId=${encodeURIComponent(draft.productId)}`, "신청 내용 수정", "button-primary");
                return;
            }
            const card = document.createElement("section");
            card.className = "customer-finance-card customer-confirm-card";
            card.append(renderCustomerProductRow(product, "loan"));
            appendInfoRows(card, [
                ["신청자", displayName(state.sessionUser)],
                ["신청 금액", formatMoney(draft.amount)],
                ["신청 목적", loanPurposeLabel(draft.purpose)],
                ["약관 동의", draft.terms ? "동의함" : "미동의"],
                ["본인확인", state.sessionUser.identityVerified ? "확인됨" : "서버 상태 재확인 필요"]
            ]);
            const note = document.createElement("div");
            showStatus(note, "is-loading", "신청 전 확인", "신청 목적은 화면 입력값이며, 신청자와 소유자는 서버 인증 주체로 결정됩니다.");
            card.append(note);
            const form = document.createElement("form");
            form.className = "page-actions loan-confirm-actions";
            const edit = link(`/demo/loans/apply.html?productId=${encodeURIComponent(draft.productId)}`, "수정하기", "button button-secondary");
            const submit = document.createElement("button");
            submit.className = "button button-primary";
            submit.dataset.loanSubmit = "true";
            submit.type = "submit";
            submit.textContent = "신청 접수";
            form.append(edit, submit);
            form.addEventListener("submit", (event) => {
                event.preventDefault();
                submitLoanApplication(form, product, root, requestId);
            });
            card.append(form);
            root.append(card);
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    async function renderLoanComplete(root, requestId) {
        if (!await ensureCustomerAccess(root, requestId)) {
            return;
        }
        const applicationId = new URLSearchParams(window.location.search).get("applicationId");
        root.replaceChildren();
        renderHeading(root, "신청 접수", "대출 신청이 접수되었습니다", null);
        if (!applicationId) {
            renderError(root, "신청번호가 없습니다.", "내 대출 신청 내역에서 접수 상태를 확인해 주세요.");
            appendAction(root, "/demo/my/loans.html", "내 대출 확인", "button-primary");
            return;
        }
        try {
            const application = await accountRequest(`/api/loans/applications/my/${encodeURIComponent(applicationId)}`);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            root.append(renderLoanApplicationSummary(application, "접수 상세"));
            const actions = document.createElement("div");
            actions.className = "page-actions";
            appendAction(actions, `/demo/my/loan-detail.html?applicationId=${encodeURIComponent(applicationId)}`, "신청 내역 상세", "button-primary");
            appendAction(actions, "/demo/my/loans.html", "내 대출 목록");
            appendAction(actions, "/demo/", "은행 홈");
            root.append(actions);
        } catch (error) {
            if (error.status === 403 && error.code === "IDENTITY_VERIFICATION_REQUIRED") {
                loanIdentityAction(root, currentPath());
                return;
            }
            handleScreenError(root, error, requestId);
        }
    }

    function renderLoanApplicationCard(application) {
        return renderCustomerFinanceRow({
            kind: "loan",
            title: "대출 신청",
            value: formatMoney(application.amount),
            meta: [
                application.productId ? `상품 ${application.productId}` : null,
                application.applicationId ? `신청번호 ${application.applicationId}` : null,
                `접수일 ${formatDate(application.createdAt)}`,
                `상태 ${loanStatusLabel(application.status)}`
            ],
            actionLabel: "상세확인",
            actionPath: `/demo/my/loan-detail.html?applicationId=${encodeURIComponent(application.applicationId)}`
        });
    }

    async function renderMyLoans(root, requestId) {
        if (!await ensureCustomerAccess(root, requestId)) {
            return;
        }
        root.replaceChildren();
        renderHeading(root, "내 대출", "내 대출 신청 내역", null);
        try {
            const applications = await accountRequest("/api/loans/applications/my");
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!Array.isArray(applications)) {
                throw new Error("대출 신청 목록 응답 형식 오류");
            }
            const card = document.createElement("section");
            card.className = "customer-finance-card";
            const grid = document.createElement("div");
            grid.className = "customer-finance-list";
            applications.forEach((application) => grid.append(renderLoanApplicationCard(application)));
            if (applications.length === 0) {
                const empty = document.createElement("div");
                showStatus(empty, "is-empty", "신청 내역이 없습니다", "현재 접수된 대출 신청이 없습니다.");
                grid.append(empty);
            }
            card.append(grid);
            root.append(card);
            const actions = document.createElement("div");
            actions.className = "page-actions";
            appendAction(actions, "/demo/loans/index.html", "대출 상품 둘러보기", "button-primary");
            root.append(actions);
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    async function renderLoanDetail(root, requestId) {
        if (!await ensureCustomerAccess(root, requestId)) {
            return;
        }
        const applicationId = new URLSearchParams(window.location.search).get("applicationId");
        root.replaceChildren();
        renderHeading(root, "대출 신청 상세", "대출 신청 결과", applicationId ? null : "신청번호가 필요합니다.");
        if (!applicationId) {
            renderError(root, "신청번호가 없습니다.", "내 대출 신청 내역에서 상세 보기를 선택해 주세요.");
            return;
        }
        try {
            const application = await accountRequest(`/api/loans/applications/my/${encodeURIComponent(applicationId)}`);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            root.append(renderLoanApplicationSummary(application, "신청 결과"));
            const actions = document.createElement("div");
            actions.className = "page-actions";
            appendAction(actions, "/demo/my/loans.html", "내 대출 목록", "button-primary");
            appendAction(actions, "/demo/loans/index.html", "대출 상품 보기");
            root.append(actions);
        } catch (error) {
            if (error.status === 403 && error.code === "IDENTITY_VERIFICATION_REQUIRED") {
                loanIdentityAction(root, currentPath());
                return;
            }
            handleScreenError(root, error, requestId);
        }
    }

    async function renderSecurity(root, requestId) {
        if (!await ensureCustomerAccess(root, requestId)) {
            return;
        }
        root.replaceChildren();
        renderHeading(root, "인증 관리", "본인확인 및 인증 갱신", "현재 고객의 인증 상태를 확인하고 필요한 경우 최신 인증을 요청합니다.");
        try {
            const status = await loadIdentityStatus();
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            const card = document.createElement("section");
            card.className = "customer-finance-card security-card";
            card.append(renderCustomerFinanceRow({
                kind: "profile",
                title: displayName(state.sessionUser),
                value: status.identityVerified ? "본인확인 완료" : "본인확인 미완료",
                meta: `확인 시각 ${formatDate(status.verifiedAt)}`
            }));
            const actions = document.createElement("div");
            actions.className = "page-actions";
            const refresh = document.createElement("button");
            refresh.type = "button";
            refresh.className = "button button-primary";
            refresh.textContent = "인증 갱신";
            const message = document.createElement("div");
            message.className = "status-message is-loading";
            message.hidden = true;
            refresh.addEventListener("click", async () => {
                if (state.busy) {
                    return;
                }
                state.busy = true;
                refresh.disabled = true;
                refresh.textContent = "갱신 중...";
                try {
                    const user = await refreshAccessToken(requestId);
                    if (!user || !isCurrentScreen(root, requestId)) {
                        return;
                    }
                    showStatus(message, "is-success", "인증이 갱신되었습니다", user.identityVerified ? "최신 본인확인 상태가 반영된 인증을 사용합니다." : "현재 본인확인 상태를 확인해 주세요.");
                } catch (error) {
                    if (error.status === 401) {
                        clearAuthState();
                        redirectToLogin(currentPath());
                    } else {
                        showStatus(message, "is-server-error", "인증을 갱신하지 못했습니다", "네트워크 상태와 Session을 확인한 뒤 다시 시도해 주세요.");
                    }
                } finally {
                    state.busy = false;
                    if (refresh.isConnected) {
                        refresh.disabled = false;
                        refresh.textContent = "인증 갱신";
                    }
                }
            });
            actions.append(refresh);
            card.append(actions, message);
            root.append(card);
        } catch (error) {
            if (error.status === 401) {
                clearAuthState();
                redirectToLogin(currentPath());
                return;
            }
            handleScreenError(root, error, requestId);
        }
    }

    function createLoadingStatus(title = "업무 정보를 불러오는 중입니다") {
        const status = document.createElement("div");
        showStatus(status, "is-loading", title, "잠시만 기다려 주세요.");
        return status;
    }

    function renderStaffCustomerCard(customer) {
        const row = document.createElement("a");
        row.className = "staff-customer-row";
        row.href = `/demo/staff/customer.html?id=${encodeURIComponent(customer.customerId)}`;
        row.dataset.route = "true";
        row.append(renderCustomerFinanceIcon("profile"));
        const main = document.createElement("div");
        main.className = "staff-customer-main";
        appendText(main, "strong", customer.displayName || customer.customerId || "고객 정보 없음", "staff-customer-name");
        appendText(main, "span", customer.customerId || "고객 번호 정보 없음", "staff-customer-id");
        appendText(main, "span", customer.status === "ACTIVE" ? "정상" : customer.status || "상태 정보 없음", "staff-customer-status");
        const action = document.createElement("span");
        action.className = "button button-secondary staff-customer-action";
        action.textContent = "고객 상세";
        row.append(main, action);
        return row;
    }

    async function renderStaffHome(root, requestId) {
        if (!await ensureStaffAccess(root, requestId)) {
            return;
        }
        root.replaceChildren();
        renderHeading(root, "영업점 업무센터", "영업점 업무센터", null);
        const status = createLoadingStatus("담당 고객 목록을 불러오는 중입니다");
        const section = document.createElement("section");
        section.className = "customer-finance-card staff-customer-card";
        const header = document.createElement("div");
        header.className = "staff-customer-header";
        appendText(header, "h2", "내 담당 고객");
        appendText(header, "span", "담당 고객을 확인하는 중", "staff-customer-count");
        const list = document.createElement("div");
        list.className = "staff-customer-list";
        list.append(status);
        section.append(header, list);
        root.append(section);
        try {
            const customers = await accountRequest("/api/staff/assigned-customers");
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!Array.isArray(customers)) {
                throw new Error("담당 고객 응답 형식 오류");
            }
            status.remove();
            query(".staff-customer-count", header).textContent = `담당 고객 ${customers.length}명`;
            if (customers.length === 0) {
                showStatus(status, "is-empty", "담당 고객이 없습니다", "현재 직원에게 배정된 고객이 없습니다.");
                list.append(status);
            } else {
                customers.forEach((customer) => list.append(renderStaffCustomerCard(customer)));
            }
            const actions = document.createElement("div");
            actions.className = "page-actions";
            appendAction(actions, "/demo/staff/customers.html", "고객 검색", "button-primary");
            appendAction(actions, "/demo/staff/reports.html", "업무 보고서");
            root.append(actions);
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    async function renderStaffCustomers(root, requestId) {
        if (!await ensureStaffAccess(root, requestId)) {
            return;
        }
        root.replaceChildren();
        renderHeading(root, "고객 검색", "고객 검색", "고객명 또는 고객 ID로 담당 여부와 기본정보를 확인합니다.");
        const form = document.createElement("form");
        form.className = "customer-finance-card customer-form";
        const label = document.createElement("label");
        label.className = "field-label";
        label.htmlFor = "staff-customer-query";
        label.textContent = "고객명 또는 고객 ID";
        const input = document.createElement("input");
        input.className = "field";
        input.id = "staff-customer-query";
        input.name = "q";
        input.type = "search";
        input.autocomplete = "off";
        const submit = document.createElement("button");
        submit.className = "button button-primary";
        submit.type = "submit";
        submit.textContent = "검색";
        form.append(label, input, submit);
        const resultSection = document.createElement("section");
        resultSection.className = "customer-finance-card staff-search-results";
        appendText(resultSection, "h2", "검색 결과");
        const resultState = createLoadingStatus("고객 검색 결과를 불러오는 중입니다");
        resultSection.append(resultState);
        root.append(form, resultSection);
        let searchVersion = 0;

        const loadResults = async () => {
            const version = ++searchVersion;
            submit.disabled = true;
            resultState.replaceChildren();
            showStatus(resultState, "is-loading", "고객 검색 결과를 불러오는 중입니다", "잠시만 기다려 주세요.");
            resultState.hidden = false;
            queryAll(".staff-customer-list", resultSection).forEach((element) => element.remove());
            const params = new URLSearchParams();
            const keyword = input.value.trim();
            if (keyword) {
                params.set("q", keyword);
            }
            try {
                const suffix = params.toString() ? `?${params}` : "";
                const body = await accountRequest(`/api/staff/secured/customers/search${suffix}`);
                if (!isCurrentScreen(root, requestId) || version !== searchVersion) {
                    return;
                }
                if (!Array.isArray(body?.customers)) {
                    throw new Error("고객 검색 응답 형식 오류");
                }
                resultState.hidden = true;
                if (body.customers.length === 0) {
                    showStatus(resultState, "is-empty", "검색 결과가 없습니다", "검색어와 일치하는 고객이 없습니다.");
                    return;
                }
                const list = document.createElement("div");
                list.className = "staff-customer-list";
                body.customers.forEach((customer) => list.append(renderStaffCustomerCard(customer)));
                resultSection.append(list);
            } catch (error) {
                if (!isCurrentScreen(root, requestId) || version !== searchVersion) {
                    return;
                }
                if (error.status === 401 || error.status === 403) {
                    handleScreenError(root, error, requestId);
                    return;
                }
                showStatus(resultState, "is-server-error", "고객 검색에 실패했습니다", "네트워크 상태를 확인한 뒤 다시 시도해 주세요.");
            } finally {
                if (isCurrentScreen(root, requestId) && version === searchVersion) {
                    submit.disabled = false;
                }
            }
        };

        form.addEventListener("submit", (event) => {
            event.preventDefault();
            if (!state.busy) {
                loadResults();
            }
        });
        await loadResults();
    }

    function renderStaffTabError(panel, error, sensitive) {
        panel.replaceChildren();
        if (error.status === 403 && sensitive) {
            appendStaffTabStatus(panel, "is-forbidden", "담당 고객 정보가 아닙니다", "현재 직원에게 배정되지 않은 고객의 정보입니다.");
            return;
        }
        if (error.status === 404) {
            appendStaffTabStatus(panel, "is-empty", "고객 정보를 찾지 못했습니다", "고객 ID를 확인한 뒤 다시 시도해 주세요.");
            return;
        }
        appendStaffTabStatus(panel, "is-server-error", "고객 정보를 불러오지 못했습니다", "권한과 네트워크 상태를 확인한 뒤 다시 시도해 주세요.");
    }

    async function renderStaffCustomer(root, requestId) {
        if (!await ensureStaffAccess(root, requestId)) {
            return;
        }
        const customerId = new URLSearchParams(window.location.search).get("id");
        root.replaceChildren();
        renderHeading(root, "고객 상세", "고객 업무 상세", customerId ? null : "고객 ID가 필요합니다.");
        if (!customerId) {
            renderError(root, "고객 ID가 없습니다.", "고객 검색 또는 담당 고객 목록에서 고객을 선택해 주세요.");
            return;
        }
        const tabs = document.createElement("div");
        tabs.className = "tab-list";
        const panel = document.createElement("section");
        panel.className = "customer-finance-card staff-detail-card";
        let tabVersion = 0;

        const loadTab = async (kind) => {
            const version = ++tabVersion;
            panel.replaceChildren();
            panel.append(createLoadingStatus("고객 업무 정보를 불러오는 중입니다"));
            const encodedId = encodeURIComponent(customerId);
            const paths = {
                profile: `/api/staff/secured/customers/${encodedId}`,
                contact: `/api/staff/secured/customers/${encodedId}/contact`,
                savings: `/api/staff/assigned-customers/${encodedId}/savings`,
                loans: `/api/staff/assigned-customers/${encodedId}/loans`
            };
            try {
                const body = await accountRequest(paths[kind]);
                if (!isCurrentScreen(root, requestId) || version !== tabVersion) {
                    return;
                }
                panel.replaceChildren();
                if (kind === "profile") {
                    appendText(panel, "h2", "기본정보");
                    appendTable(panel, ["고객 ID", "고객명", "고객 상태"], [[body.customerId, body.displayName, body.status === "ACTIVE" ? "정상" : body.status]]);
                } else if (kind === "contact") {
                    appendText(panel, "h2", "연락처");
                    appendTable(panel, ["고객 ID", "연락처"], [[body.customerId, body.contact]]);
                } else if (kind === "savings") {
                    appendText(panel, "h2", "담당 고객 예적금");
                    if (!Array.isArray(body?.subscriptions) || body.subscriptions.length === 0) {
                        appendStaffTabStatus(panel, "is-empty", "예적금 가입 내역이 없습니다", "서버가 반환한 가입 내역이 없습니다.");
                    } else {
                        appendTable(panel, ["가입번호", "상품", "가입 원금", "가입 상태"], body.subscriptions.map((item) => [
                            item.subscriptionId,
                            item.productName || "상품 정보 없음",
                            formatMoney(item.principal),
                            item.status
                        ]));
                    }
                } else {
                    appendText(panel, "h2", "담당 고객 대출");
                    if (!Array.isArray(body) || body.length === 0) {
                        appendStaffTabStatus(panel, "is-empty", "대출 신청 내역이 없습니다", "서버가 반환한 대출 신청 내역이 없습니다.");
                    } else {
                        appendTable(panel, ["신청번호", "상품번호", "신청 금액", "신청 상태", "신청일"], body.map((item) => [
                            item.applicationId,
                            item.productId,
                            formatMoney(item.amount),
                            item.status,
                            formatDate(item.createdAt)
                        ]));
                    }
                }
            } catch (error) {
                if (!isCurrentScreen(root, requestId) || version !== tabVersion) {
                    return;
                }
                if (error.status === 401) {
                    handleScreenError(root, error, requestId);
                    return;
                }
                panel.replaceChildren();
                renderStaffTabError(panel, error, kind !== "profile");
            }
        };

        [["profile", "기본정보"], ["contact", "연락처"], ["savings", "예적금"], ["loans", "대출"]].forEach(([kind, label], index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "tab-button";
            button.textContent = label;
            button.addEventListener("click", () => {
                queryAll(".tab-button", tabs).forEach((item) => item.classList.remove("is-current"));
                button.classList.add("is-current");
                loadTab(kind);
            });
            tabs.append(button);
            if (index === 0) {
                button.classList.add("is-current");
            }
        });
        root.append(tabs, panel);
        await loadTab("profile");
    }

    function renderStaffReportCard(report) {
        const card = document.createElement("article");
        card.className = "card data-section";
        appendText(card, "span", report.visibility || "업무 보고서", "section-label");
        appendText(card, "h2", report.title || report.reportId || "보고서");
        appendText(card, "p", report.summary || "요약 정보 없음");
        appendDetailGrid(card, [["보고서 ID", report.reportId]]);
        return card;
    }

    async function renderStaffReports(root, requestId) {
        if (!await ensureStaffAccess(root, requestId)) {
            return;
        }
        root.replaceChildren();
        renderHeading(root, "업무 보고서", "직원 업무 보고서", "현재 직원이 조회할 수 있는 Main 업무 보고서입니다.");
        const status = createLoadingStatus("업무 보고서를 불러오는 중입니다");
        root.append(status);
        try {
            const reports = await mainRequest("/api/staff/protected/reports/summary");
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!Array.isArray(reports)) {
                throw new Error("보고서 응답 형식 오류");
            }
            status.remove();
            if (reports.length === 0) {
                showStatus(status, "is-empty", "조회할 보고서가 없습니다", "현재 직원 보고서가 없습니다.");
                root.append(status);
            } else {
                const grid = document.createElement("div");
                grid.className = "catalog-grid";
                reports.forEach((report) => grid.append(renderStaffReportCard(report)));
                root.append(grid);
            }
            const actions = document.createElement("div");
            actions.className = "page-actions";
            appendAction(actions, "/demo/staff/index.html", "업무센터로 돌아가기", "button-primary");
            root.append(actions);
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    function renderAdminHomePanel(title, body, error) {
        const card = document.createElement("section");
        card.className = "card data-section";
        appendText(card, "h2", title);
        if (error) {
            showStatus(card, error.status === 403 ? "is-forbidden" : "is-server-error", "이 업무 영역을 조회하지 못했습니다", error.status === 403 ? "은행 관리자 권한을 확인해 주세요." : "서버 응답을 확인한 뒤 다시 조회해 주세요.");
            return card;
        }
        body(card);
        return card;
    }

    async function renderAdminHome(root, requestId) {
        if (!await ensureAdminAccess(root, requestId)) {
            return;
        }
        root.replaceChildren();
        renderHeading(root, "은행 관리자", "은행 관리자 홈", `${displayName(state.sessionUser)}의 운영 조회 화면입니다.`);
        const status = createLoadingStatus("관리자 현황을 불러오는 중입니다");
        root.append(status);
        const resources = [
            ["products", () => accountRequest("/api/admin/savings/products")],
            ["subscriptions", () => accountRequest("/api/admin/savings/subscriptions")],
            ["loans", () => accountRequest("/api/admin/loans/summary")],
            ["assignments", () => accountRequest("/api/admin/assignments")]
        ];
        try {
            const results = await Promise.all(resources.map(async ([key, request]) => {
                try {
                    return [key, await request(), null];
                } catch (error) {
                    return [key, null, error];
                }
            }));
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            const failedAuth = results.find(([, , error]) => error?.status === 401);
            if (failedAuth) {
                handleScreenError(root, failedAuth[2], requestId);
                return;
            }
            status.remove();
            const values = new Map(results.map(([key, body, error]) => [key, { body, error }]));
            const stats = [];
            if (!values.get("products").error && Array.isArray(values.get("products").body)) {
                const products = values.get("products").body;
                stats.push(["전체 상품", `${products.length}개`, "판매 중·중단 상품 전체"]);
                stats.push(["판매 중 상품", `${products.filter((product) => product.active).length}개`, "서버 active 값 기준"]);
            }
            if (!values.get("subscriptions").error && Number.isInteger(values.get("subscriptions").body?.totalCount)) {
                stats.push(["예적금 가입", `${values.get("subscriptions").body.totalCount}건`, "전체 가입 현황 조회 결과"]);
            }
            if (!values.get("loans").error && Number.isInteger(values.get("loans").body?.totalCount)) {
                stats.push(["대출 신청", `${values.get("loans").body.totalCount}건`, "전체 대출 신청 집계"]);
            }
            if (stats.length > 0) {
                appendStatGrid(root, stats);
            }
            root.append(renderAdminHomePanel("예적금 상품 현황", (card) => {
                const products = values.get("products").body;
                if (!Array.isArray(products)) {
                    showStatus(card, "is-empty", "상품 현황이 없습니다", "상품 API가 반환한 목록이 없습니다.");
                    return;
                }
                appendDetailGrid(card, [["전체 상품", `${products.length}개`], ["판매 중", `${products.filter((product) => product.active).length}개`]]);
                appendAction(card, "/demo/admin/savings.html", "상품 관리", "button-primary");
            }, values.get("products").error));
            root.append(renderAdminHomePanel("예적금 가입 현황", (card) => {
                const subscriptions = values.get("subscriptions").body;
                if (!subscriptions || !Array.isArray(subscriptions.items)) {
                    showStatus(card, "is-empty", "가입 현황이 없습니다", "가입 현황 API 응답을 확인해 주세요.");
                    return;
                }
                appendDetailGrid(card, [["조회 건수", `${subscriptions.totalCount}건`], ["표시 항목", `${subscriptions.items.length}건`]]);
                appendAction(card, "/demo/admin/subscriptions.html", "가입 현황 보기");
            }, values.get("subscriptions").error));
            root.append(renderAdminHomePanel("대출 신청 집계", (card) => {
                const loans = values.get("loans").body;
                if (!loans || !Number.isInteger(loans.totalCount)) {
                    showStatus(card, "is-empty", "대출 집계가 없습니다", "대출 집계 API 응답을 확인해 주세요.");
                    return;
                }
                appendDetailGrid(card, [["전체 신청", `${loans.totalCount}건`], ["상태 분류", `${Object.keys(loans.statusCounts || {}).length}개`]]);
                appendAction(card, "/demo/admin/loans.html", "대출 현황 보기");
            }, values.get("loans").error));
            root.append(renderAdminHomePanel("직원 담당 고객 배정", (card) => {
                const assignments = values.get("assignments").body;
                if (!Array.isArray(assignments)) {
                    showStatus(card, "is-empty", "배정 현황이 없습니다", "배정 현황 API 응답을 확인해 주세요.");
                    return;
                }
                appendDetailGrid(card, [["배정 정보", `${assignments.length}건`]]);
                appendAction(card, "/demo/admin/loans.html", "담당 배정 현황 보기");
            }, values.get("assignments").error));
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    function setSelectOptions(select, options, selectedValue) {
        select.replaceChildren();
        options.forEach(([value, label]) => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            option.selected = value === selectedValue;
            select.append(option);
        });
    }

    async function renderAdminSubscriptions(root, requestId) {
        if (!await ensureAdminAccess(root, requestId)) {
            return;
        }
        root.replaceChildren();
        renderHeading(root, "가입 현황", "예적금 가입 현황", "상품과 가입 상태 조건으로 서버의 가입 내역을 조회합니다.");
        const form = document.createElement("form");
        form.className = "card customer-form";
        const productLabel = document.createElement("label");
        productLabel.className = "field-label";
        productLabel.htmlFor = "admin-subscription-product";
        productLabel.textContent = "상품";
        const productSelect = document.createElement("select");
        productSelect.className = "select-control";
        productSelect.id = "admin-subscription-product";
        const statusLabel = document.createElement("label");
        statusLabel.className = "field-label";
        statusLabel.htmlFor = "admin-subscription-status";
        statusLabel.textContent = "가입 상태";
        const statusSelect = document.createElement("select");
        statusSelect.className = "select-control";
        statusSelect.id = "admin-subscription-status";
        setSelectOptions(productSelect, [["", "전체 상품"]], "");
        setSelectOptions(statusSelect, [["", "전체 상태"]], "");
        const submit = document.createElement("button");
        submit.className = "button button-primary";
        submit.type = "submit";
        submit.textContent = "조회";
        form.append(productLabel, productSelect, statusLabel, statusSelect, submit);
        const stateElement = createLoadingStatus("가입 현황을 불러오는 중입니다");
        const resultSection = document.createElement("section");
        resultSection.className = "data-section";
        appendText(resultSection, "h2", "조회 결과");
        resultSection.append(stateElement);
        root.append(form, resultSection);
        let queryVersion = 0;
        let statusOptions = new Set();

        const loadSubscriptions = async () => {
            const version = ++queryVersion;
            submit.disabled = true;
            resultSection.replaceChildren();
            appendText(resultSection, "h2", "조회 결과");
            const loading = createLoadingStatus("가입 현황을 불러오는 중입니다");
            resultSection.append(loading);
            const params = new URLSearchParams();
            if (productSelect.value) {
                params.set("productId", productSelect.value);
            }
            if (statusSelect.value) {
                params.set("status", statusSelect.value);
            }
            try {
                const suffix = params.toString() ? `?${params}` : "";
                const body = await accountRequest(`/api/admin/savings/subscriptions${suffix}`);
                if (!isCurrentScreen(root, requestId) || version !== queryVersion) {
                    return;
                }
                if (!Array.isArray(body?.items) || !Number.isInteger(body.totalCount)) {
                    throw new Error("가입 현황 응답 형식 오류");
                }
                body.items.forEach((item) => statusOptions.add(item.status));
                const selectedStatus = statusSelect.value;
                setSelectOptions(statusSelect, [["", "전체 상태"], ...[...statusOptions].map((value) => [value, value])], selectedStatus);
                loading.remove();
                appendText(resultSection, "p", `현재 조회 결과 ${body.totalCount}건`, "status-inline");
                if (body.items.length === 0) {
                    const empty = document.createElement("div");
                    showStatus(empty, "is-empty", "가입 내역이 없습니다", "현재 조건과 일치하는 가입 내역이 없습니다.");
                    resultSection.append(empty);
                } else {
                    appendTable(resultSection, ["가입번호", "상품번호", "가입 원금", "가입 상태"], body.items.map((item) => [
                        item.subscriptionId,
                        item.productId,
                        formatMoney(item.principal),
                        item.status
                    ]));
                }
            } catch (error) {
                if (!isCurrentScreen(root, requestId) || version !== queryVersion) {
                    return;
                }
                if (error.status === 401 || error.status === 403) {
                    handleScreenError(root, error, requestId);
                    return;
                }
                resultSection.replaceChildren();
                appendText(resultSection, "h2", "조회 결과");
                const failure = document.createElement("div");
                showStatus(failure, "is-server-error", "가입 현황을 조회하지 못했습니다", "네트워크 상태를 확인한 뒤 다시 조회해 주세요.");
                resultSection.append(failure);
            } finally {
                if (isCurrentScreen(root, requestId) && version === queryVersion) {
                    submit.disabled = false;
                }
            }
        };

        try {
            const products = await accountRequest("/api/admin/savings/products");
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (Array.isArray(products)) {
                setSelectOptions(productSelect, [["", "전체 상품"], ...products.map((product) => [product.productId, `${product.name || "상품명 없음"} (${product.productId})`])], "");
            }
        } catch (error) {
            if (error.status === 401 || error.status === 403) {
                handleScreenError(root, error, requestId);
                return;
            }
        }
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            if (!state.busy) {
                loadSubscriptions();
            }
        });
        await loadSubscriptions();
    }

    async function renderAdminLoans(root, requestId) {
        if (!await ensureAdminAccess(root, requestId)) {
            return;
        }
        root.replaceChildren();
        renderHeading(root, "대출·담당 배정", "대출 집계 및 담당 배정", "대출 신청 상태와 직원 담당 고객 배정을 서버 응답으로 확인합니다.");
        const loading = createLoadingStatus("대출 집계와 배정 현황을 불러오는 중입니다");
        root.append(loading);
        try {
            const [loans, assignments] = await Promise.all([
                accountRequest("/api/admin/loans/summary"),
                accountRequest("/api/admin/assignments")
            ]);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!Number.isInteger(loans?.totalCount) || typeof loans.statusCounts !== "object" || !Array.isArray(assignments)) {
                throw new Error("관리자 대출 응답 형식 오류");
            }
            loading.remove();
            const summary = document.createElement("section");
            summary.className = "card data-section";
            appendText(summary, "h2", "대출 신청 집계");
            const entries = [["전체 신청", `${loans.totalCount}건`]];
            Object.entries(loans.statusCounts).forEach(([status, count]) => entries.push([status, `${count}건`]));
            appendDetailGrid(summary, entries);
            root.append(summary);
            const assignmentSection = document.createElement("section");
            assignmentSection.className = "card data-section";
            appendText(assignmentSection, "h2", "직원 담당 고객 배정");
            if (assignments.length === 0) {
                showStatus(assignmentSection, "is-empty", "배정 정보가 없습니다", "서버가 반환한 담당 배정 정보가 없습니다.");
            } else {
                appendTable(assignmentSection, ["직원 ID", "고객 ID", "배정 여부", "배정 범위"], assignments.map((item) => [
                    item.staffId,
                    item.customerId,
                    item.assigned ? "배정" : "미배정",
                    item.scope
                ]));
            }
            root.append(assignmentSection);
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    function showAdminMutationError(element, error) {
        if (error.status === 400) {
            showStatus(element, "is-error", "입력값을 확인해 주세요", "상품명·종류·기간·표시금리 조건을 확인해 주세요.");
            return;
        }
        if (error.status === 401) {
            showStatus(element, "is-error", "관리자 인증이 필요합니다", "다시 로그인한 뒤 시도해 주세요.");
            return;
        }
        if (error.status === 403) {
            showStatus(element, "is-forbidden", "관리자 권한이 없습니다", "은행 관리자 계정으로 다시 확인해 주세요.");
            return;
        }
        if (error.status === 404) {
            showStatus(element, "is-empty", "상품을 찾지 못했습니다", "상품 목록을 새로 조회해 주세요.");
            return;
        }
        if (error.status >= 400 && error.status < 500) {
            showStatus(element, "is-error", "서버가 상품 변경을 거부했습니다", "입력값과 현재 상품 상태를 확인한 뒤 다시 시도해 주세요.");
            return;
        }
        showStatus(element, "is-server-error", "변경 결과를 확정하지 못했습니다", "상품 목록을 다시 조회해 실제 서버 상태를 확인해 주세요.");
    }

    function renderAdminProductCard(product, onMutation, cardIndex) {
        const card = document.createElement("article");
        card.className = "catalog-card product-management-card";
        appendText(card, "span", `${savingsKind(product.kind)} · ${product.productId}`, "section-label");
        appendText(card, "h2", product.name || "상품명 없음");
        appendDetailGrid(card, [
            ["기간", `${product.termMonths}개월`],
            ["표시금리", `${product.displayRate}%`],
            ["판매 상태", product.active ? "판매 중" : "판매 중단"]
        ]);
        const nameForm = document.createElement("form");
        nameForm.className = "customer-form";
        const productKey = String(product.productId || "product").replace(/[^A-Za-z0-9_-]/g, "-");
        const inputId = `admin-product-name-${cardIndex}-${productKey}`;
        const nameLabel = document.createElement("label");
        nameLabel.className = "field-label";
        nameLabel.htmlFor = inputId;
        nameLabel.textContent = "상품명 수정";
        const nameInput = document.createElement("input");
        nameInput.className = "field";
        nameInput.id = inputId;
        nameInput.name = "name";
        nameInput.value = product.name || "";
        nameInput.required = true;
        const nameSubmit = document.createElement("button");
        nameSubmit.className = "button button-secondary";
        nameSubmit.type = "submit";
        nameSubmit.textContent = "상품명 저장";
        nameForm.append(nameLabel, nameInput, nameSubmit);
        nameForm.addEventListener("submit", (event) => {
            event.preventDefault();
            onMutation({ name: nameInput.value.trim() }, nameSubmit);
        });
        const statusButton = document.createElement("button");
        statusButton.className = "button button-primary";
        statusButton.type = "button";
        statusButton.textContent = product.active ? "판매 중단" : "판매 재개";
        statusButton.addEventListener("click", () => {
            if (window.confirm(`${product.name || product.productId} 상품을 ${product.active ? "판매 중단" : "판매 재개"}하시겠습니까?`)) {
                onMutation({ active: !product.active }, statusButton);
            }
        });
        const actions = document.createElement("div");
        actions.className = "page-actions";
        actions.append(statusButton);
        card.append(nameForm, actions);
        return card;
    }

    async function renderAdminSavings(root, requestId) {
        if (!await ensureAdminAccess(root, requestId)) {
            return;
        }
        root.replaceChildren();
        renderHeading(root, "상품 관리", "예적금 상품 관리", "판매 중·중단 상품을 확인하고 관리자 권한으로 운영 상태를 변경합니다.");
        const adminUserId = state.sessionUser.userId;
        const createSection = document.createElement("section");
        createSection.className = "card data-section";
        appendText(createSection, "h2", "신규 상품 등록");
        const createForm = document.createElement("form");
        createForm.className = "customer-form";
        const createFields = [
            ["상품명", "name", "text", "상품명을 입력해 주세요", "admin-new-product-name"],
            ["기간(개월)", "termMonths", "number", "12", "admin-new-product-term-months"],
            ["표시금리(%)", "displayRate", "number", "3.5", "admin-new-product-rate"]
        ];
        const createInputs = new Map();
        createFields.forEach(([labelText, name, type, placeholder, inputId]) => {
            const label = document.createElement("label");
            label.className = "field-label";
            label.htmlFor = inputId;
            label.textContent = labelText;
            const input = document.createElement("input");
            input.className = "field";
            input.id = inputId;
            input.name = name;
            input.type = type;
            input.placeholder = placeholder;
            input.required = true;
            if (type === "number") {
                input.min = name === "termMonths" ? "1" : "0";
                input.step = name === "termMonths" ? "1" : "0.01";
            }
            createForm.append(label, input);
            createInputs.set(name, input);
        });
        const kindLabel = document.createElement("label");
        kindLabel.className = "field-label";
        kindLabel.htmlFor = "admin-new-product-kind";
        kindLabel.textContent = "상품 종류";
        const kind = document.createElement("select");
        kind.className = "select-control";
        kind.id = "admin-new-product-kind";
        kind.name = "kind";
        setSelectOptions(kind, [["DEPOSIT", "예금"], ["INSTALLMENT", "적금"]], "INSTALLMENT");
        const createButton = document.createElement("button");
        createButton.className = "button button-primary";
        createButton.type = "submit";
        createButton.textContent = "상품 등록";
        const mutationState = document.createElement("div");
        mutationState.hidden = true;
        createForm.append(kindLabel, kind, createButton, mutationState);
        createSection.append(createForm);
        const listSection = document.createElement("section");
        listSection.className = "data-section";
        appendText(listSection, "h2", "상품 목록");
        const listState = createLoadingStatus("관리자 상품 목록을 불러오는 중입니다");
        listSection.append(listState);
        root.append(createSection, listSection);
        let mutationBusy = false;
        let productListLoaded = false;

        const renderPendingAdminProduct = (pending) => {
            if (!pending) {
                createButton.disabled = mutationBusy;
                return;
            }
            createButton.disabled = true;
            const isUnknown = pending.status === "UNKNOWN";
            showStatus(
                mutationState,
                "is-error",
                isUnknown ? "상품 등록 결과를 확정할 수 없습니다" : "상품 등록 처리 중입니다",
                isUnknown
                    ? "상품 목록을 확인한 뒤 중복 등록 가능성을 인지하고 재신청을 선택해 주세요."
                    : "기존 등록 요청의 서버 결과를 확인하는 중입니다. 다시 등록하지 마세요."
            );
            mutationState.hidden = false;
            const refreshButton = document.createElement("button");
            refreshButton.className = "button button-secondary";
            refreshButton.type = "button";
            refreshButton.textContent = isUnknown ? "상품 목록 확인 후 재신청" : "상품 목록 새로 조회";
            refreshButton.addEventListener("click", async () => {
                refreshButton.disabled = true;
                await loadProducts();
                if (!isCurrentScreen(root, requestId)) {
                    return;
                }
                const current = findPendingAdminProduct(adminUserId);
                if (!current || !productListLoaded) {
                    renderPendingAdminProduct(current);
                    return;
                }
                if (current.status === "UNKNOWN" && window.confirm("상품 목록을 확인했습니다. 이전 등록이 서버에 반영되었을 가능성을 인지하고 중복 등록을 감수하여 다시 신청하시겠습니까?")) {
                    removePendingAdminProduct(current);
                    mutationState.replaceChildren();
                    mutationState.hidden = true;
                    createButton.disabled = false;
                    return;
                }
                renderPendingAdminProduct(current);
            });
            mutationState.append(refreshButton);
        };

        const applyAdminProductState = () => {
            renderPendingAdminProduct(findPendingAdminProduct(adminUserId));
        };

        const loadProducts = async () => {
            productListLoaded = false;
            listSection.replaceChildren();
            appendText(listSection, "h2", "상품 목록");
            const loading = createLoadingStatus("관리자 상품 목록을 불러오는 중입니다");
            listSection.append(loading);
            try {
                const products = await accountRequest("/api/admin/savings/products");
                if (!isCurrentScreen(root, requestId)) {
                    return [];
                }
                if (!Array.isArray(products)) {
                    throw new Error("관리자 상품 응답 형식 오류");
                }
                productListLoaded = true;
                loading.remove();
                if (products.length === 0) {
                    showStatus(loading, "is-empty", "등록된 상품이 없습니다", "현재 관리자 상품 목록이 비어 있습니다.");
                    listSection.append(loading);
                    return products;
                }
                const grid = document.createElement("div");
                grid.className = "catalog-grid";
                products.forEach((product, index) => {
                    grid.append(renderAdminProductCard(product, async (payload, button) => {
                        if (mutationBusy) {
                            return;
                        }
                        mutationBusy = true;
                        button.disabled = true;
                        try {
                            const response = await accountRequest(`/api/admin/savings/products/${encodeURIComponent(product.productId)}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(payload),
                                expectedStatus: 200
                            });
                            if (!response?.productId || typeof response.active !== "boolean") {
                                const unknown = new Error("상품 수정 응답 형식 오류");
                                unknown.resultUnknown = true;
                                throw unknown;
                            }
                            showStatus(mutationState, "is-success", "상품 정보가 변경되었습니다", "서버 상품 목록을 다시 조회합니다.");
                            mutationState.hidden = false;
                            await loadProducts();
                        } catch (error) {
                            if (!isCurrentScreen(root, requestId)) {
                                return;
                            }
                            if (error.status === 401) {
                                clearAuthState();
                                redirectToLogin(currentPath());
                                return;
                            }
                            showAdminMutationError(mutationState, error);
                            mutationState.hidden = false;
                            if (error.status >= 500 || error.resultUnknown || !error.status) {
                                await loadProducts();
                                if (isCurrentScreen(root, requestId)) {
                                    showAdminMutationError(mutationState, error);
                                    mutationState.hidden = false;
                                }
                            }
                        } finally {
                            mutationBusy = false;
                            if (button.isConnected) {
                                button.disabled = false;
                            }
                        }
                    }, index));
                });
                listSection.append(grid);
                return products;
            } catch (error) {
                if (error.status === 401 || error.status === 403) {
                    handleScreenError(root, error, requestId);
                    return [];
                }
                listSection.replaceChildren();
                appendText(listSection, "h2", "상품 목록");
                const failure = document.createElement("div");
                showStatus(failure, "is-server-error", "상품 목록을 조회하지 못했습니다", "네트워크 상태를 확인한 뒤 다시 조회해 주세요.");
                listSection.append(failure);
                return [];
            }
        };

        createForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const pending = findPendingAdminProduct(adminUserId);
            if (mutationBusy || pending) {
                renderPendingAdminProduct(pending);
                return;
            }
            const name = createInputs.get("name").value.trim();
            const termMonths = Number(createInputs.get("termMonths").value);
            const displayRate = Number(createInputs.get("displayRate").value);
            if (!name || !Number.isInteger(termMonths) || termMonths <= 0 || !Number.isFinite(displayRate) || displayRate < 0) {
                showStatus(mutationState, "is-error", "입력값을 확인해 주세요", "상품명·기간·표시금리를 올바르게 입력해 주세요.");
                mutationState.hidden = false;
                return;
            }
            const attempt = {
                userId: adminUserId,
                name,
                kind: kind.value,
                termMonths,
                displayRate,
                status: "IN_FLIGHT"
            };
            state.pendingAdminProductCreations.push(attempt);
            mutationBusy = true;
            createButton.disabled = true;
            try {
                const response = await accountRequest("/api/admin/savings/products", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name, kind: kind.value, termMonths, displayRate }),
                    expectedStatus: 201
                });
                if (typeof response?.productId !== "string" || !response.productId || response.active !== true) {
                    const unknown = new Error("상품 등록 응답 형식 오류");
                    unknown.resultUnknown = true;
                    throw unknown;
                }
                removePendingAdminProduct(attempt);
                createForm.reset();
                kind.value = "INSTALLMENT";
                showStatus(mutationState, "is-success", "상품이 등록되었습니다", "서버 상품 목록을 다시 조회합니다.");
                mutationState.hidden = false;
                await loadProducts();
            } catch (error) {
                const definitiveRejection = Number.isInteger(error?.status)
                    && error.status >= 400
                    && error.status < 500
                    && !error.resultUnknown;
                if (definitiveRejection) {
                    removePendingAdminProduct(attempt);
                } else {
                    attempt.status = "UNKNOWN";
                }
                if (!isCurrentScreen(root, requestId)) {
                    return;
                }
                if (error.status === 401) {
                    clearAuthState();
                    redirectToLogin(currentPath());
                    return;
                }
                showAdminMutationError(mutationState, error);
                mutationState.hidden = false;
                if (error.status >= 500 || error.resultUnknown || !error.status) {
                    await loadProducts();
                }
            } finally {
                mutationBusy = false;
                if (isCurrentScreen(root, requestId)) {
                    applyAdminProductState();
                }
            }
        });
        await loadProducts();
        if (isCurrentScreen(root, requestId)) {
            applyAdminProductState();
        }
    }

    function renderLoginDocument() {
        document.body.className = "bank-page login-page";
        document.body.dataset.page = "login";
        document.body.replaceChildren();
        const header = document.createElement("header");
        header.className = "site-header";
        header.innerHTML = `<div class="shell header-inner login-header"><a class="brand" href="/demo/"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M6 14.5 16 7l10 7.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4"/><path d="M8.5 14.5v9h15v-9M5.5 25.5h21" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4"/><path d="M12 17v4.5M16 17v4.5M20 17v4.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg></span><span class="brand-text"><strong>Demo Bank</strong><small>금융 Demo 포털</small></span></a><a class="utility-link" href="/demo/">홈으로</a></div>`;
        const main = document.createElement("main");
        main.className = "shell login-main";
        main.innerHTML = `<section class="login-layout"><div class="login-copy"><p class="eyebrow">Demo Bank 로그인</p><h1>안전한 금융 서비스를<br><span>시작해 보세요</span></h1><p>등록된 테스트 계정으로 로그인하면 현재 사용자와 역할을 확인할 수 있습니다.</p><div class="status-message is-auth login-notice"><strong>테스트 환경 안내</strong><span>비밀번호는 화면에 저장하거나 표시하지 않으며 Identity 서비스에서 확인합니다.</span></div></div><div class="card login-card"><div class="card-heading"><div><p class="section-label">로그인</p><h2>Demo Bank 이용</h2></div><span class="heading-icon" aria-hidden="true"><svg viewBox="0 0 24 24" role="img"><circle cx="12" cy="8" fill="none" r="3.2" stroke="currentColor" stroke-width="1.7"/><path d="M5.5 19c.8-3 3-4.5 6.5-4.5s5.7 1.5 6.5 4.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.7"/></svg></span></div><div class="account-picker" aria-label="테스트 계정 선택"><p class="field-label">테스트 계정</p><div class="account-options"><button type="button" data-account="customer.a">고객 A</button><button type="button" data-account="customer.b">고객 B</button><button type="button" data-account="staff.a">직원 A</button><button type="button" data-account="staff.b">직원 B</button><button type="button" data-account="bank.admin">은행 관리자</button></div></div><form class="login-form" data-login-form novalidate><label class="field-label" for="username">사용자명</label><input class="field" id="username" name="username" autocomplete="username" required><label class="field-label" for="password">비밀번호</label><input class="field" id="password" name="password" type="password" autocomplete="current-password" required><div class="status-message is-error" data-login-error role="alert" hidden></div><button class="button button-primary button-wide" data-login-submit type="submit">로그인</button></form><p class="login-return" data-return-target></p></div></section>`;
        const footer = document.createElement("footer");
        footer.className = "site-footer";
        footer.innerHTML = `<div class="shell footer-inner"><div><strong>Demo Bank</strong><p>금융 서비스 포털</p></div><p>안전하고 편리한 금융 생활</p></div>`;
        document.body.append(header, main, footer);
        bindLoginPage();
    }

    function bindLoginPage() {
        const destination = safeReturnTo();
        const target = query("[data-return-target]");
        if (target) {
            target.textContent = `로그인 후 ${destination} 화면으로 이동합니다.`;
        }
        queryAll("[data-account]").forEach((button) => {
            if (button.dataset.bound === "true") {
                return;
            }
            button.dataset.bound = "true";
            button.addEventListener("click", () => {
                const username = query("[name=username]");
                username.value = button.dataset.account || "";
                username.focus();
            });
        });
        bindLoginForm(document, destination);
    }

    const labContextRules = {
        customer: {
            label: "고객 A JWT",
            role: "ROLE_CUSTOMER",
            userId: "USER001",
            description: "고객 A(USER001)의 실제 JWT를 메모리에 준비합니다."
        },
        staff: {
            label: "직원 A JWT",
            role: "ROLE_STAFF",
            userId: "STAFF001",
            description: "직원 A(STAFF001)의 실제 JWT를 메모리에 준비합니다."
        },
        unverifiedCustomer: {
            label: "본인확인 전 고객 JWT",
            role: "ROLE_CUSTOMER",
            description: "identity_verified가 false인 실제 고객 JWT를 메모리에 준비합니다."
        }
    };

    function labContextFor(scenario) {
        return scenario.authContext === "anonymous" || scenario.authContext === "customerSession"
            ? null
            : state.labContexts[scenario.authContext];
    }

    function labContextReady(key) {
        return Boolean(state.labContexts[key]?.token);
    }

    function labContextDisplay(key) {
        const context = state.labContexts[key];
        if (!context) {
            return "준비되지 않음";
        }
        return `${displayName({ userId: context.userId, roles: context.roles })} · ${context.identityVerified ? "본인확인 완료" : "본인확인 전"}`;
    }

    function labContextKey(scenario) {
        return scenario.authContext === "anonymous" || scenario.authContext === "customerSession"
            ? null
            : scenario.authContext;
    }

    function createLabRun(scenario) {
        const contextKey = labContextKey(scenario);
        const context = contextKey ? state.labContexts[contextKey] : null;
        return {
            normal: null,
            vulnerable: null,
            running: false,
            status: "NOT_RUN",
            contextKey,
            contextGeneration: context?.generation || 0,
            contextUserId: context?.userId || null
        };
    }

    function labRunMatchesContext(scenario, run) {
        const contextKey = labContextKey(scenario);
        if (!contextKey) {
            return !run.contextKey;
        }
        const context = state.labContexts[contextKey];
        return Boolean(context
            && run.contextKey === contextKey
            && run.contextGeneration === context.generation
            && run.contextUserId === context.userId);
    }

    function currentLabRun(scenario) {
        const existing = state.labRuns.get(scenario.id);
        if (existing && labRunMatchesContext(scenario, existing)) {
            return existing;
        }
        const fresh = createLabRun(scenario);
        state.labRuns.set(scenario.id, fresh);
        return fresh;
    }

    function resetLabRunsForContext(key) {
        labScenarios.forEach((scenario) => {
            if (labContextKey(scenario) === key) {
                state.labRuns.set(scenario.id, createLabRun(scenario));
            }
        });
    }

    function labSubmissionKey(scenario, userId) {
        return userId ? `${scenario.id}:${userId}` : null;
    }

    function hasLabSubmission(scenario, userId) {
        const key = labSubmissionKey(scenario, userId);
        return Boolean(key && state.labSubmissions.has(key));
    }

    function recordLabSubmission(scenario, run, result) {
        if (!scenario.sideEffect || !result.requestStarted || !run.contextUserId) {
            return;
        }
        const key = labSubmissionKey(scenario, run.contextUserId);
        if (key) {
            state.labSubmissions.set(key, {
                scenarioId: scenario.id,
                userId: run.contextUserId,
                contextGeneration: run.contextGeneration,
                status: result.status
            });
        }
    }

    function resetLabRunView(root) {
        if (!root || typeof root.querySelectorAll !== "function") {
            return;
        }
        queryAll("[data-lab-result-body]", root).forEach((panel) => panel.replaceChildren());
        queryAll("[data-lab-comparison]", root).forEach((panel) => {
            panel.replaceChildren();
            showStatus(panel, "is-empty", "비교 대기", "인증 문맥이 교체되어 이전 비교 결과를 폐기했습니다.");
        });
        const stateElement = query("[data-lab-run-state]", root);
        if (stateElement) {
            showStatus(stateElement, "is-empty", "실행 대기", "인증 문맥이 교체되어 이전 결과를 폐기했습니다. 정상·취약 경로를 다시 실행해 주세요.");
        }
    }

    function isLabServiceError(status) {
        return Number.isInteger(status) && status >= 500 && status <= 599;
    }

    async function prepareLabContext(key, statusElement, requestId, root, input) {
        const rule = labContextRules[key];
        if (!rule || !identityOrigin) {
            if (input) {
                input.value = "";
            }
            showStatus(statusElement, "is-error", "인증 문맥을 준비하지 못했습니다", "Identity 서비스 주소를 확인해 주세요.");
            return;
        }
        const token = typeof input?.value === "string" ? input.value.trim() : "";
        if (!token?.trim()) {
            if (input) {
                input.value = "";
            }
            return;
        }
        try {
            const response = await fetch(`${identityOrigin}/api/auth/me`, {
                headers: { Authorization: `Bearer ${token.trim()}` },
                credentials: "omit",
                cache: "no-store"
            });
            const body = await readBody(response);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            const roles = Array.isArray(body?.roles) ? body.roles : [];
            if (!response.ok || !body?.userId || !roles.includes(rule.role)
                    || (rule.userId && body.userId !== rule.userId)
                    || (key === "unverifiedCustomer" && body.identityVerified === true)) {
                showStatus(statusElement, "is-error", "인증 문맥 교체 실패", "실제 사용자·역할·본인확인 상태가 조건과 일치하지 않습니다. 기존에 검증된 문맥은 유지합니다.");
                return;
            }
            const previousGeneration = Number(state.labContexts[key]?.generation) || 0;
            state.labContextSequence = Math.max(state.labContextSequence, previousGeneration) + 1;
            state.labContexts[key] = {
                token: token.trim(),
                userId: body.userId,
                roles,
                identityVerified: body.identityVerified === true,
                generation: state.labContextSequence
            };
            resetLabRunsForContext(key);
            resetLabRunView(root);
            showStatus(statusElement, "is-success", `${rule.label} 준비 완료`, labContextDisplay(key));
        } catch {
            if (isCurrentScreen(root, requestId)) {
                showStatus(statusElement, "is-server-error", "인증 문맥 교체 실패", "네트워크 상태를 확인한 뒤 다시 준비해 주세요. 기존에 검증된 문맥은 유지합니다.");
            }
        } finally {
            if (input) {
                input.value = "";
            }
        }
    }

    function appendLabContextAction(parent, key, requestId, root) {
        const rule = labContextRules[key];
        const item = document.createElement("div");
        item.className = "lab-context-item";
        appendText(item, "strong", rule.label);
        appendText(item, "span", rule.description);
        const inputId = `lab-token-${key}`;
        const label = document.createElement("label");
        label.className = "field-label";
        label.htmlFor = inputId;
        label.textContent = "테스트 JWT";
        const input = document.createElement("input");
        input.className = "field lab-token-input";
        input.id = inputId;
        input.name = inputId;
        input.type = "password";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.placeholder = "실제 Access Token 입력";
        const actions = document.createElement("div");
        actions.className = "page-actions";
        const button = document.createElement("button");
        button.className = "button button-secondary";
        button.type = "button";
        button.textContent = labContextReady(key) ? "인증 문맥 다시 준비" : "인증 문맥 준비";
        const status = document.createElement("div");
        showStatus(status, labContextReady(key) ? "is-success" : "is-empty", labContextReady(key) ? "현재 문맥" : "준비 필요", labContextDisplay(key));
        button.addEventListener("click", async () => {
            button.disabled = true;
            await prepareLabContext(key, status, requestId, root, input);
            if (button.isConnected) {
                button.disabled = false;
                button.textContent = labContextReady(key) ? "인증 문맥 다시 준비" : "인증 문맥 준비";
            }
        });
        actions.append(button);
        item.append(label, input, actions, status);
        parent.append(item);
        return item;
    }

    function renderLabContextManager(root, requestId, requiredKey = null) {
        const section = document.createElement("section");
        section.className = "customer-finance-card lab-context-card";
        appendText(section, "h2", requiredKey ? "시나리오 사전 준비" : "테스트 인증 문맥");
        appendText(section, "p", requiredKey
            ? "테스트 대상에 맞는 실제 인증 문맥을 준비해야 요청을 실행할 수 있습니다. Token은 메모리에만 보관합니다."
            : "Lab은 인증을 우회하거나 Token을 생성하지 않습니다. 외부에서 발급한 실제 테스트 Token만 일시적으로 준비합니다.");
        if (requiredKey === "customerSession") {
            const status = document.createElement("div");
            showStatus(status, "is-empty", "Session 문맥은 자동 준비하지 않습니다", "Cookie를 복사하거나 수동 Cookie Header를 만들지 않습니다. 별도 HTTP 클라이언트에서 고객 A Session으로 N06/V06을 실행한 뒤 실제 결과를 기록해 주세요.");
            section.append(status);
        } else if (requiredKey === "anonymous") {
            const status = document.createElement("div");
            showStatus(status, "is-auth", "익명 요청", "Session Cookie와 Authorization 없이 실행합니다.");
            section.append(status);
        } else if (requiredKey) {
            appendLabContextAction(section, requiredKey, requestId, root);
        } else {
            const list = document.createElement("div");
            list.className = "lab-context-list";
            ["customer", "staff", "unverifiedCustomer"].forEach((key) => appendLabContextAction(list, key, requestId, root));
            section.append(list);
        }
        root.append(section);
        return section;
    }

    function labServiceOrigin(service) {
        if (service === "Identity") {
            return identityOrigin;
        }
        if (service === "Account") {
            return accountOrigin;
        }
        return window.location.origin;
    }

    function summarizeLabResponse(scenario, result, body, rawBody) {
        if (result.networkError) {
            return "응답을 받지 못했습니다. 자동 재요청하지 말고 관련 금융 화면에서 저장 여부를 확인해 주세요.";
        }
        if (isLabServiceError(result.status)) {
            return "내부 서비스 설정 또는 실행 환경 오류로 보안 비교를 확정할 수 없습니다.";
        }
        if (scenario.id === "08" && result.status === 200) {
            return "인증 갱신 응답을 받았습니다. 새 JWT는 표시하거나 일반 인증 상태에 저장하지 않습니다.";
        }
        if (scenario.id === "09" && typeof body?.applicationId === "string") {
            return `신청번호 ${body.applicationId}가 반환되었습니다. 실제 저장 결과는 내 대출 목록에서 확인할 수 있습니다.`;
        }
        if (body?.error?.code) {
            return `오류 코드 ${body.error.code} 응답입니다.`;
        }
        if (body && typeof body === "object") {
            return "JSON 응답을 받았습니다. 민감한 본문은 표시하지 않습니다.";
        }
        return rawBody ? "JSON이 아닌 응답 본문입니다." : "응답 본문이 없습니다.";
    }

    async function executeLabRequest(scenario, variant) {
        const endpoint = scenario[variant];
        const context = labContextFor(scenario);
        if (scenario.authContext === "customerSession") {
            return { blocked: true, requestStarted: false, summary: "Session Cookie를 자동 구성하지 않으므로 별도 HTTP 클라이언트 검증이 필요합니다." };
        }
        if (scenario.authContext !== "anonymous" && !context) {
            return { blocked: true, requestStarted: false, summary: "필요한 실제 인증 문맥을 먼저 준비해 주세요." };
        }
        const origin = labServiceOrigin(scenario.service);
        if (!origin) {
            return { networkError: true, requestStarted: false, summary: "서비스 주소를 계산하지 못했습니다." };
        }
        const headers = new Headers({ Accept: "application/json" });
        if (context?.token) {
            headers.set("Authorization", `Bearer ${context.token}`);
        }
        if (variant === "vulnerable" && scenario.forgedStaffId) {
            headers.set("X-Staff-Id", scenario.forgedStaffId);
        }
        const options = {
            method: endpoint.method,
            headers,
            credentials: "omit",
            cache: "no-store"
        };
        if (scenario.body) {
            headers.set("Content-Type", "application/json");
            options.body = JSON.stringify(scenario.body);
        }
        try {
            const response = await fetch(`${origin}${endpoint.path}`, options);
            const rawBody = await response.text();
            let body = null;
            try {
                body = rawBody ? JSON.parse(rawBody) : null;
            } catch {
                body = null;
            }
            const result = {
                status: response.status,
                ok: response.ok,
                networkError: false,
                blocked: false,
                requestStarted: true,
                summary: ""
            };
            result.summary = summarizeLabResponse(scenario, result, body, rawBody);
            return result;
        } catch {
            return {
                status: null,
                ok: false,
                networkError: true,
                blocked: false,
                requestStarted: true,
                summary: "네트워크 응답을 받지 못했습니다. 자동 재요청하지 않습니다."
            };
        }
    }

    function labStatusLabel(status) {
        return status === null || status === undefined ? "응답 없음" : String(status);
    }

    function labExpectedResult(scenario, variant, result) {
        return !result?.blocked && !result?.networkError
            && scenario.expected[variant].includes(result.status);
    }

    function updateLabRunStatus(scenario, run) {
        if (run.running) {
            run.status = "RUNNING";
            return;
        }
        if (run.normal && run.vulnerable) {
            if (run.normal.blocked || run.vulnerable.blocked) {
                run.status = "BLOCKED";
            } else if (run.normal.networkError || run.vulnerable.networkError
                    || isLabServiceError(run.normal.status) || isLabServiceError(run.vulnerable.status)) {
                run.status = "ERROR";
            } else if (labExpectedResult(scenario, "normal", run.normal)
                    && labExpectedResult(scenario, "vulnerable", run.vulnerable)) {
                run.status = "PASSED";
            } else {
                run.status = "MISMATCH";
            }
            return;
        }
        const latest = run.normal || run.vulnerable;
        run.status = latest?.blocked
            ? "BLOCKED"
            : latest?.networkError || isLabServiceError(latest?.status)
                ? "ERROR"
                : latest
                    ? "READY"
                    : "NOT_RUN";
    }

    function renderLabResult(panel, scenario, variant, result) {
        panel.replaceChildren();
        const expected = scenario.expected[variant].join(" 또는 ");
        const status = document.createElement("div");
        if (result.blocked) {
            showStatus(status, "is-empty", "실행 차단", result.summary);
        } else if (result.networkError) {
            showStatus(status, "is-server-error", "실제 HTTP 결과 미확정", result.summary);
        } else if (isLabServiceError(result.status)) {
            showStatus(status, "is-server-error", `HTTP ${result.status} 서비스 오류`, result.summary);
        } else if (labExpectedResult(scenario, variant, result)) {
            showStatus(status, "is-success", `HTTP ${result.status} 응답`, result.summary);
        } else {
            showStatus(status, "is-error", `예상과 다른 HTTP ${result.status} 응답`, result.summary);
        }
        panel.append(status);
        appendInfoRows(panel, [
            ["기대 상태", expected],
            ["실제 상태", labStatusLabel(result.status)],
            ["응답 요약", result.summary]
        ]);
    }

    function renderLabComparison(panel, scenario, run) {
        panel.replaceChildren();
        if (!run.normal || !run.vulnerable) {
            showStatus(panel, "is-empty", "비교 대기", "정상·취약 요청을 모두 실행하면 실제 HTTP 결과를 비교합니다.");
            return;
        }
        if (run.status === "BLOCKED") {
            showStatus(panel, "is-empty", "비교 차단", "필요한 인증 문맥 또는 Session 실행 조건이 준비되지 않았습니다.");
        } else if (run.status === "ERROR") {
            const hasServiceError = isLabServiceError(run.normal.status) || isLabServiceError(run.vulnerable.status);
            showStatus(panel, "is-server-error", "비교 미완료", hasServiceError
                ? "내부 서비스 설정 또는 실행 환경을 확인한 뒤 다시 검증해 주세요. 보안 검증 성공으로 처리하지 않습니다."
                : "네트워크 결과가 확정되지 않아 안전하게 성공 처리하지 않습니다.");
        } else if (run.status === "PASSED") {
            showStatus(panel, "is-success", "기대 상태 비교 완료", "정상·취약 경로의 실제 응답이 시나리오 계약과 일치합니다.");
        } else {
            showStatus(panel, "is-error", "기대 상태와 불일치", "실제 Backend 응답을 확인하고 사전조건과 실행 환경을 점검해 주세요.");
        }
        appendInfoRows(panel, [
            ["정상 경로", `${labStatusLabel(run.normal.status)} · ${run.normal.summary}`],
            ["취약 경로", `${labStatusLabel(run.vulnerable.status)} · ${run.vulnerable.summary}`],
            ["비교 상태", run.status]
        ]);
    }

    async function runLabVariant(scenario, variant, root, requestId, button, panel, comparisonPanel, stateElement) {
        const run = currentLabRun(scenario);
        if (run.running) {
            return;
        }
        const context = labContextFor(scenario);
        if (variant === "vulnerable" && scenario.sideEffect
                && hasLabSubmission(scenario, context?.userId)) {
            showStatus(stateElement, "is-empty", "재실행 차단", "같은 사용자의 상태 변경 요청이 이미 실행되었습니다. 내 대출 목록에서 먼저 결과를 확인해 주세요.");
            return;
        }
        if (scenario.sideEffect && run[variant] && !run[variant].blocked) {
            showStatus(stateElement, "is-empty", "재실행 차단", "실제 저장 결과가 확정되지 않았을 수 있어 같은 취약 POST를 자동 또는 반복 실행하지 않습니다. 내 대출 목록에서 먼저 확인해 주세요.");
            return;
        }
        if (variant === "vulnerable" && scenario.sideEffect
                && !window.confirm("취약 경로는 실제 대출 신청을 저장할 수 있습니다. 중복 신청 가능성을 이해했고 이 작업을 직접 실행하시겠습니까?")) {
            return;
        }
        run.running = true;
        updateLabRunStatus(scenario, run);
        button.disabled = true;
        showStatus(stateElement, "is-loading", `${variant === "normal" ? "정상" : "취약"} 경로 실행 중`, "실제 Backend 응답을 기다리는 중입니다.");
        let result;
        try {
            result = await executeLabRequest(scenario, variant);
        } catch {
            result = {
                status: null,
                ok: false,
                networkError: true,
                blocked: false,
                requestStarted: true,
                summary: "요청 결과를 확정하지 못했습니다. 자동 재요청하지 않습니다."
            };
        }
        result.contextKey = run.contextKey;
        result.contextGeneration = run.contextGeneration;
        if (variant === "vulnerable" && scenario.sideEffect) {
            recordLabSubmission(scenario, run, result);
        }
        if (state.labRuns.get(scenario.id) !== run || !labRunMatchesContext(scenario, run)) {
            if (button.isConnected) {
                button.disabled = false;
            }
            return;
        }
        run[variant] = result;
        run.running = false;
        updateLabRunStatus(scenario, run);
        if (isCurrentScreen(root, requestId)) {
            renderLabResult(panel, scenario, variant, result);
            renderLabComparison(comparisonPanel, scenario, run);
            showStatus(stateElement, run.status === "PASSED" ? "is-success" : run.status === "ERROR" ? "is-server-error" : "is-auth", `현재 실행 상태 ${run.status}`, "정상·취약 결과를 각각 확인하세요.");
        }
        if (button.isConnected) {
            button.disabled = false;
        }
    }

    function renderLabSdkPanel(root, scenario) {
        const section = document.createElement("section");
        section.className = "customer-finance-card lab-sdk-card";
        appendText(section, "h2", "SDK에서 확인할 구조");
        appendText(section, "p", "Demo 화면은 SDK Finding을 생성하거나 보안성을 확정하지 않습니다. 아래는 해당 N/V 차이를 확인할 구조 안내입니다.");
        appendInfoRows(section, [
            ["대상 서비스", `${scenario.service} · /mapinboot/`],
            ["대응 Rule", scenario.rule],
            ["SDK 상태", "현재 Demo 환경의 SDK 분석 UI와 연결되지 않음"]
        ]);
        root.append(section);
    }

    // Lab 시나리오별 공개 재현 절차 표시
    function appendLabGuideList(parent, title, values, ordered = false) {
        const section = document.createElement("div");
        section.className = "lab-guide-section";
        appendText(section, "h3", title);
        const list = document.createElement(ordered ? "ol" : "ul");
        list.className = ordered ? "lab-guide-steps" : "lab-guide-list";
        values.forEach((value) => appendText(list, "li", value));
        section.append(list);
        parent.append(section);
    }

    // Lab 설명과 실제 실행 결과의 분리
    function renderLabGuide(root, scenario) {
        const guide = scenario.guide;
        const section = document.createElement("section");
        section.className = "customer-finance-card lab-reproduction-guide";
        appendText(section, "h2", "직접 재현하는 방법");
        appendLabGuideList(section, "재현 준비", [
            `계정 · ${guide.account}`,
            `Role · ${guide.role}`,
            ...guide.prerequisites,
            `시작 금융 화면 · ${guide.startPath}`
        ]);
        appendLabGuideList(section, "준비할 입력", guide.input);
        appendLabGuideList(section, "실제 재현 절차", guide.steps, true);
        const comparison = document.createElement("div");
        comparison.className = "lab-guide-section";
        appendText(comparison, "h3", "정상·취약 응답 비교");
        appendInfoRows(comparison, [
            ["정상 요청", `${scenario.normal.method} ${scenario.normal.path}`],
            ["취약 요청", `${scenario.vulnerable.method} ${scenario.vulnerable.path}`],
            ["예상 HTTP 응답", `정상 ${scenario.expected.normal.join("/")} · 취약 ${scenario.expected.vulnerable.join("/")}`]
        ]);
        appendText(comparison, "p", "일반 금융 화면은 정상 API를 사용합니다. 취약 요청은 Lab 실행 보조 기능 또는 별도 HTTP 클라이언트에서 해당 Endpoint를 직접 호출해야 합니다.", "lab-guide-note");
        appendText(comparison, "p", "위 기대값은 실제 실행 결과가 아닙니다. 요청을 실행한 경우에만 실제 HTTP Status와 응답을 별도로 확인합니다.", "lab-guide-note");
        section.append(comparison);
        appendLabGuideList(section, "취약점 확인 기준", [guide.verification]);
        appendLabGuideList(section, "실행 환경 확인", guide.limitations);
        root.append(section);
    }

    async function renderLabHome(root, requestId) {
        root.replaceChildren();
        renderHeading(root, "개발자 검증 Lab", "보안 시나리오 Lab", null);
        const intro = document.createElement("section");
        intro.className = "customer-finance-card lab-intro-card";
        appendText(intro, "h2", "공개 시나리오 안내");
        appendText(intro, "p", "N/V 시나리오의 요청 계약과 기대 상태를 공개합니다. 실제 Backend 권한 검사를 대신하지 않으며, 토큰·Session Cookie·응답 본문을 화면에 노출하지 않습니다.");
        appendText(intro, "p", "N09/V09는 실제 대출 신청 저장을 발생시킬 수 있어 취약 요청 직전에 별도 확인을 요구합니다.");
        root.append(intro);
        const section = document.createElement("section");
        section.className = "customer-finance-card lab-scenario-section";
        appendText(section, "h2", "N/V 시나리오");
        const list = document.createElement("div");
        list.className = "lab-scenario-list";
        labScenarios.forEach((scenario) => {
            const row = document.createElement("article");
            row.className = "lab-scenario-row";
            appendText(row, "span", `N${scenario.id} / V${scenario.id}`, "lab-scenario-id");
            const main = document.createElement("div");
            main.className = "lab-scenario-main";
            appendText(main, "strong", scenario.title, "lab-scenario-title");
            appendText(main, "span", `대상 서비스 · ${scenario.service}`, "lab-scenario-meta");
            appendText(main, "span", `인증 문맥 · ${scenario.authContext === "anonymous" ? "익명" : scenario.authContext === "customerSession" ? "고객 Session" : labContextRules[scenario.authContext].label}`, "lab-scenario-meta");
            appendText(main, "span", scenario.business, "lab-scenario-description");
            const actions = document.createElement("div");
            actions.className = "page-actions lab-scenario-actions";
            appendAction(actions, `/demo/lab/scenario.html?id=${scenario.id}`, "상세확인", "button button-primary");
            row.append(main, actions);
            list.append(row);
        });
        section.append(list);
        root.append(section);
        if (await ensureLabExecutionAccess(root, requestId)) {
            renderLabContextManager(root, requestId);
        }
    }

    async function renderLabScenario(root, requestId) {
        const scenarioId = new URLSearchParams(window.location.search).get("id");
        const scenario = labScenarios.get(scenarioId);
        if (!scenario) {
            renderError(root, "시나리오를 찾을 수 없습니다.", "01부터 10까지의 허용된 시나리오를 선택해 주세요.");
            return;
        }
        root.replaceChildren();
        renderHeading(root, `N${scenario.id} / V${scenario.id}`, scenario.title, null);
        const overview = document.createElement("section");
        overview.className = "customer-finance-card lab-overview-card";
        appendText(overview, "h2", "요청 계약");
        appendInfoRows(overview, [
            ["서비스", scenario.service],
            ["인증 문맥", scenario.authContext === "anonymous" ? "익명" : scenario.authContext === "customerSession" ? "고객 A Session" : labContextRules[scenario.authContext].label],
            ["정상 API", `${scenario.normal.method} ${scenario.normal.path}`],
            ["취약 API", `${scenario.vulnerable.method} ${scenario.vulnerable.path}`],
            ["기대 상태", `${scenario.expected.normal.join("/")} / ${scenario.expected.vulnerable.join("/")}`],
            ["부작용", scenario.sideEffect ? "취약 경로가 실제 신청을 저장할 수 있음" : "조회 또는 인증 응답 비교"]
        ]);
        const relatedActions = document.createElement("div");
        relatedActions.className = "page-actions";
        appendAction(relatedActions, scenario.relatedPath, "관련 금융 화면", "button button-secondary");
        if (scenario.sideEffect) {
            appendAction(relatedActions, "/demo/my/loans.html", "내 대출 목록에서 확인", "button button-secondary");
        }
        appendAction(relatedActions, "/demo/lab/index.html", "Lab 목록", "button button-quiet");
        overview.append(relatedActions);
        root.append(overview);
        renderLabGuide(root, scenario);
        if (!await ensureLabExecutionAccess(root, requestId)) {
            if (isCurrentScreen(root, requestId)) {
                renderLabSdkPanel(root, scenario);
            }
            return;
        }
        renderLabContextManager(root, requestId, scenario.authContext);

        const actionSection = document.createElement("section");
        actionSection.className = "customer-finance-card lab-run-card";
        appendText(actionSection, "h2", "실제 요청 실행");
        const stateElement = document.createElement("div");
        stateElement.dataset.labRunState = "true";
        showStatus(stateElement, "is-empty", "실행 대기", "정상·취약 버튼을 각각 눌러 실제 응답을 확인하세요.");
        actionSection.append(stateElement);
        const actionGrid = document.createElement("div");
        actionGrid.className = "lab-run-stack";
        const normalPanel = document.createElement("article");
        normalPanel.className = "lab-result-panel";
        appendText(normalPanel, "h3", "정상 API");
        const normalButton = document.createElement("button");
        normalButton.className = "button button-primary";
        normalButton.type = "button";
        normalButton.textContent = "정상 경로 실행";
        normalPanel.append(normalButton);
        const normalResult = document.createElement("div");
        normalResult.className = "lab-result-body";
        normalResult.dataset.labResultBody = "true";
        normalPanel.append(normalResult);
        const vulnerablePanel = document.createElement("article");
        vulnerablePanel.className = "lab-result-panel";
        appendText(vulnerablePanel, "h3", "취약 API");
        const vulnerableButton = document.createElement("button");
        vulnerableButton.className = "button button-secondary";
        vulnerableButton.type = "button";
        vulnerableButton.textContent = "취약 경로 실행";
        vulnerablePanel.append(vulnerableButton);
        const vulnerableResult = document.createElement("div");
        vulnerableResult.className = "lab-result-body";
        vulnerableResult.dataset.labResultBody = "true";
        vulnerablePanel.append(vulnerableResult);
        actionGrid.append(normalPanel, vulnerablePanel);
        actionSection.append(actionGrid);
        const comparison = document.createElement("div");
        comparison.className = "lab-comparison-panel";
        actionSection.append(comparison);
        root.append(actionSection);

        const run = currentLabRun(scenario);
        normalButton.addEventListener("click", () => runLabVariant(scenario, "normal", root, requestId, normalButton, normalResult, comparison, stateElement));
        vulnerableButton.addEventListener("click", () => runLabVariant(scenario, "vulnerable", root, requestId, vulnerableButton, vulnerableResult, comparison, stateElement));
        if (run.normal) {
            renderLabResult(normalResult, scenario, "normal", run.normal);
        }
        if (run.vulnerable) {
            renderLabResult(vulnerableResult, scenario, "vulnerable", run.vulnerable);
        }
        updateLabRunStatus(scenario, run);
        comparison.dataset.labComparison = "true";
        renderLabComparison(comparison, scenario, run);
        renderLabSdkPanel(root, scenario);
    }

    async function initScreen(path) {
        const requestId = ++state.requestId;
        const publicCatalogScreen = isPublicProductPath(path);
        if (isStaffPath(path)) {
            renderBusinessFrame("staff");
        } else if (isAdminPath(path)) {
            renderBusinessFrame("admin");
        } else if (isLabPath(path)) {
            renderBusinessFrame("lab", requestId);
        } else {
            renderCustomerFrame(requestId, publicCatalogScreen);
        }
        const root = screenRoot();
        const screen = {
            "/demo/my/index.html": ["나의 금융", renderMyHome],
            "/demo/accounts/index.html": ["내 계좌", renderAccounts],
            "/demo/accounts/detail.html": ["계좌 상세", renderAccountDetail],
            "/demo/savings/index.html": ["예적금 상품", renderSavingsList],
            "/demo/savings/product.html": ["예적금 상품 상세", renderSavingsProduct],
            "/demo/savings/enroll.html": ["예적금 가입", renderSavingsEnroll],
            "/demo/savings/complete.html": ["가입 완료", renderSavingsComplete],
            "/demo/my/savings.html": ["내 예적금", renderMySavings],
            "/demo/my/savings-detail.html": ["예적금 가입 상세", renderSavingsDetail],
            "/demo/my/profile.html": ["내 정보", renderProfile],
            "/demo/loans/index.html": ["대출 상품", renderLoanList],
            "/demo/loans/product.html": ["대출 상품 상세", renderLoanProduct],
            "/demo/loans/apply.html": ["대출 신청", renderLoanApply],
            "/demo/identity/verify.html": ["본인확인", renderIdentityVerify],
            "/demo/loans/confirm.html": ["신청 내용 확인", renderLoanConfirm],
            "/demo/loans/complete.html": ["신청 접수", renderLoanComplete],
            "/demo/my/loans.html": ["내 대출", renderMyLoans],
            "/demo/my/loan-detail.html": ["대출 신청 상세", renderLoanDetail],
            "/demo/my/security.html": ["인증 관리", renderSecurity],
            "/demo/staff/index.html": ["영업점 업무센터", renderStaffHome],
            "/demo/staff/customers.html": ["고객 검색", renderStaffCustomers],
            "/demo/staff/customer.html": ["고객 상세", renderStaffCustomer],
            "/demo/staff/reports.html": ["업무 보고서", renderStaffReports],
            "/demo/admin/index.html": ["은행 관리자 홈", renderAdminHome],
            "/demo/admin/savings.html": ["예적금 상품 관리", renderAdminSavings],
            "/demo/admin/subscriptions.html": ["예적금 가입 현황", renderAdminSubscriptions],
            "/demo/admin/loans.html": ["대출·담당 배정", renderAdminLoans],
            "/demo/lab/index.html": ["보안 시나리오 Lab", renderLabHome],
            "/demo/lab/scenario.html": ["시나리오 실행", renderLabScenario]
        }[path];
        if (!screen) {
            renderError(root, "화면 경로를 확인할 수 없습니다.", "Demo Bank 업무 화면 경로가 아닙니다.");
            return;
        }
        setPageTitle(screen[0]);
        await screen[1](root, requestId);
    }

    async function initializePage() {
        const current = currentPath();
        const path = current.split("?")[0];
        if (isLabPath(path) && !normalizePath(current)) {
            window.history.replaceState({}, "", "/demo/lab/index.html");
            await initScreen("/demo/lab/index.html");
            return;
        }
        if (path === "/demo/" || path === "/demo/index.html") {
            const requestId = ++state.requestId;
            if (path === "/demo/index.html") {
                window.history.replaceState({}, "", "/demo/");
            }
            if (await restoreHomeDocument(requestId)) {
                await initHome(requestId);
            }
            return;
        }
        if (path === "/demo/login.html") {
            if (document.body.dataset.page !== "login" || !query("[data-login-form]")) {
                renderLoginDocument();
            } else {
                bindLoginPage();
            }
            return;
        }
        if (isCustomerPath(path) || isStaffPath(path) || isAdminPath(path) || isLabPath(path)) {
            await initScreen(path);
        }
    }

    async function navigateTo(raw, replace = false) {
        let target = normalizePath(raw);
        if (!target) {
            return;
        }
        const path = target.split("?")[0];
        if (path === "/demo/index.html") {
            target = "/demo/";
        }
        if (path === "/demo/login.html") {
            window.location.assign(target);
            return;
        }
        if (replace) {
            window.history.replaceState({}, "", target);
        } else {
            window.history.pushState({}, "", target);
        }
        await initializePage();
    }

    document.addEventListener("click", (event) => {
        const target = event.target;
        const anchor = target && typeof target.closest === "function" ? target.closest("a[data-route]") : null;
        if (!anchor) {
            return;
        }
        const targetUrl = normalizePath(`${anchor.pathname}${anchor.search}`);
        if (!targetUrl || targetUrl.startsWith("/demo/login.html")) {
            return;
        }
        event.preventDefault();
        navigateTo(targetUrl);
    });

    window.addEventListener("popstate", () => {
        initializePage();
    });

    initializePage();
})();
