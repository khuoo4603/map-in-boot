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
        pendingLoanApplications: []
    };

    const roleLabels = {
        ROLE_CUSTOMER: "고객",
        ROLE_STAFF: "직원",
        ROLE_BANK_ADMIN: "은행 관리자",
        MAP_IN_BOOT_ADMIN: "개발자"
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
        "/demo/my/security.html"
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
        ["/demo/my/loan-detail.html", new Set(["applicationId"])]
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

    function clearAuthState() {
        state.accessToken = null;
        state.sessionUser = null;
        state.csrfToken = null;
        state.enrollment = null;
        state.pendingEnrollments = [];
        state.loanDraft = null;
        state.pendingLoanApplications = [];
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

    async function publicAccountRequest(path) {
        const requestId = state.requestId;
        if (!accountOrigin) {
            throw new Error("Account 서비스 주소를 확인할 수 없습니다.");
        }
        const response = await fetch(`${accountOrigin}${path}`, {
            credentials: "omit",
            cache: "no-store"
        });
        if (!response.ok) {
            throw new ApiError(response.status, "공개 금융상품 조회에 실패했습니다.", requestId);
        }
        return readBody(response);
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

    function isCustomerPath(path) {
        return path.startsWith("/demo/my/")
            || path.startsWith("/demo/accounts/")
            || path.startsWith("/demo/savings/")
            || path.startsWith("/demo/loans/")
            || path.startsWith("/demo/identity/");
    }

    function resolveLoginDestination(user, requestedPath) {
        const roles = Array.isArray(user?.roles) ? user.roles : [];
        if (!roles.includes("ROLE_CUSTOMER")) {
            return "/demo/";
        }
        return normalizePath(requestedPath) || "/demo/my/index.html";
    }

    function setPageTitle(title) {
        document.title = `Demo Bank | ${title}`;
    }

    function updateHeaderAuth(user) {
        const login = query("[data-header-login]");
        const userLabel = query("[data-header-user]");
        const logout = query("[data-logout]");
        if (!login || !userLabel || !logout) {
            return;
        }
        login.href = `/demo/login.html?returnTo=${encodeURIComponent(currentPath())}`;
        if (user?.userId) {
            login.hidden = true;
            userLabel.textContent = `${user.userId} · ${roleLabel(user)}`;
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
        const currentUser = await loadCurrentUser(false);
        if (requestId !== state.requestId) {
            return;
        }
        if (currentUser.response?.ok && currentUser.body?.userId) {
            if (state.sessionUser && state.sessionUser.userId !== currentUser.body.userId) {
                clearAuthState();
            }
            state.sessionUser = currentUser.body;
            updateHeaderAuth(currentUser.body);
            return;
        }
        if (currentUser.response?.status === 401) {
            clearAuthState();
            updateHeaderAuth(null);
            return;
        }
        updateHeaderAuth(state.sessionUser);
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
            <nav class="customer-nav" aria-label="개인 금융 메뉴"><a href="/demo/my/index.html" data-route="true">나의 금융</a><a href="/demo/accounts/index.html" data-route="true">내 계좌</a><a href="/demo/savings/index.html" data-route="true">예적금 상품</a><a href="/demo/loans/index.html" data-route="true">대출 상품</a><a href="/demo/my/savings.html" data-route="true">내 예적금</a><a href="/demo/my/loans.html" data-route="true">내 대출</a><a href="/demo/my/security.html" data-route="true">인증 관리</a><a href="/demo/my/profile.html" data-route="true">내 정보</a></nav>
            <div class="header-tools" data-header-auth><a class="utility-link" data-header-login href="/demo/login.html">로그인</a><span class="user-label" data-header-user hidden></span><button class="button button-quiet button-small" type="button" data-logout hidden>로그아웃</button></div>
        </div>`;
        const main = document.createElement("main");
        main.className = "customer-main";
        main.innerHTML = `<div class="shell customer-content"><div data-screen-root></div></div>`;
        const footer = document.createElement("footer");
        footer.className = "site-footer";
        footer.innerHTML = `<div class="shell footer-inner"><div><strong>Demo Bank</strong><p>금융 서비스 포털</p></div><p>고객 금융 서비스</p></div>`;
        document.body.append(header, main, footer);
        updateHeaderAuth(state.sessionUser);
        bindLogout();
        if (syncAuth) {
            syncHeaderAuth(requestId);
        }
    }

    function screenRoot() {
        return query("[data-screen-root]");
    }

    function renderInlineLogin(destination, message = "고객 금융 서비스는 로그인 후 이용할 수 있습니다.") {
        const root = screenRoot() || query("main") || document.body;
        root.replaceChildren();
        const section = document.createElement("section");
        section.className = "login-layout inline-login";
        section.innerHTML = `<div class="login-copy"><p class="eyebrow">Demo Bank 로그인</p><h1>안전한 금융 서비스를<br><span>계속 이용해 보세요</span></h1><p data-inline-login-message></p></div><div class="card login-card"><div class="card-heading"><div><p class="section-label">고객 인증</p><h2>Demo Bank 이용</h2></div></div><form class="login-form" data-login-form novalidate><label class="field-label" for="inline-username">사용자명</label><input class="field" id="inline-username" name="username" autocomplete="username" required><label class="field-label" for="inline-password">비밀번호</label><input class="field" id="inline-password" name="password" type="password" autocomplete="current-password" required><div class="status-message is-error" data-login-error role="alert" hidden></div><button class="button button-primary button-wide" data-login-submit type="submit">로그인</button></form><p class="login-return" data-inline-login-target></p></div>`;
        query("[data-inline-login-message]", section).textContent = message;
        query("[data-inline-login-target]", section).textContent = `로그인 후 ${destination} 화면으로 이동합니다.`;
        root.append(section);
        bindLoginForm(section, destination);
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
        if (user) {
            const label = roleLabel(user);
            showStatus(authState, "is-auth", `${user.userId}님, 환영합니다`, `${label} 권한으로 로그인되었습니다.`);
            loginLinks.forEach((linkElement) => { linkElement.hidden = true; });
            logoutButtons.forEach((button) => { button.hidden = false; });
            userLabels.forEach((element) => {
                element.textContent = `${user.userId} · ${label}`;
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

    // 공지사항 목록 조회 및 상태 표시
    async function loadNotices() {
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

    async function loadProducts(path, listSelector, stateSelector, renderItem) {
        const stateElement = query(stateSelector);
        const listElement = query(listSelector);
        if (!stateElement || !listElement) {
            return;
        }
        listElement.hidden = true;
        listElement.replaceChildren();
        try {
            const body = await publicAccountRequest(path);
            if (!Array.isArray(body)) {
                throw new Error("상품 조회 실패");
            }
            if (body.length === 0) {
                showStatus(stateElement, "is-empty", "판매 중인 상품이 없습니다", "현재 이용 가능한 상품이 없습니다.");
                return;
            }
            body.forEach((product) => renderItem(listElement, product));
            stateElement.hidden = true;
            listElement.hidden = false;
        } catch {
            showStatus(stateElement, "is-server-error", "상품 정보를 불러오지 못했습니다", "잠시 후 다시 시도해 주세요.");
        }
    }

    async function initHome() {
        const requestId = ++state.requestId;
        bindLogout();
        await Promise.all([
            loadCurrentUser().then((currentUser) => {
                if (!isCurrentHome(requestId)) {
                    return;
                }
                state.sessionUser = currentUser.response?.ok ? currentUser.body : null;
                renderHomeAuth(state.sessionUser, currentUser.error || (currentUser.response && currentUser.response.status !== 401));
            }),
            loadNotices(),
            loadProducts("/api/public/savings/products", "[data-savings-list]", "[data-savings-state]", renderPublicProduct),
            loadProducts("/api/public/loans/products", "[data-loans-list]", "[data-loans-state]", renderPublicLoanProduct)
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

    // 보호 화면 진입 전 Session·JWT 상태 확인
    async function ensureCustomerAccess(root, requestId) {
        if (!isCurrentScreen(root, requestId)) {
            return false;
        }
        if (!state.accessToken) {
            renderInlineLogin(currentPath());
            return false;
        }
        const currentUser = await loadCurrentUser(false);
        if (!isCurrentScreen(root, requestId)) {
            return false;
        }
        if (currentUser.error || !currentUser.response?.ok || !currentUser.body?.userId) {
            clearAuthState();
            renderInlineLogin(currentPath(), "인증 Session이 만료되었거나 확인되지 않았습니다.");
            return false;
        }
        if (state.sessionUser && state.sessionUser.userId !== currentUser.body.userId) {
            clearAuthState();
            renderInlineLogin(currentPath(), "현재 사용자와 이전 인증 상태가 일치하지 않습니다.");
            return false;
        }
        if (!Array.isArray(currentUser.body.roles) || !currentUser.body.roles.includes("ROLE_CUSTOMER")) {
            renderError(root, "고객 권한이 필요한 화면입니다.", "현재 계정으로는 이 금융 기능을 이용할 수 없습니다.");
            return false;
        }
        state.sessionUser = currentUser.body;
        return true;
    }

    function handleScreenError(root, error, requestId) {
        if (!isCurrentScreen(root, requestId) || (error.requestId !== undefined && error.requestId !== state.requestId)) {
            return;
        }
        if (error.status === 401) {
            clearAuthState();
            renderInlineLogin(currentPath(), "금융 API 인증이 만료되었거나 확인되지 않았습니다.");
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

    function renderAccountCard(account) {
        const card = document.createElement("article");
        card.className = "account-card";
        const heading = document.createElement("div");
        heading.className = "account-card-heading";
        appendText(heading, "span", account.accountType || "계좌", "card-icon");
        appendText(heading, "span", account.status || "상태 정보 없음", "account-status");
        card.append(heading);
        appendText(card, "h3", account.accountId || "식별자 정보 없음");
        appendText(card, "strong", formatMoney(account.balance), "account-balance");
        appendText(card, "p", "등록된 계좌 식별자와 잔액");
        const actions = document.createElement("div");
        actions.className = "page-actions";
        appendAction(actions, `/demo/accounts/detail.html?accountId=${encodeURIComponent(account.accountId)}`, "상세 보기");
        card.append(actions);
        return card;
    }

    async function renderMyHome(root, requestId) {
        if (!await ensureCustomerAccess(root, requestId)) {
            return;
        }
        root.replaceChildren();
        renderHeading(root, "나의 금융", "나의 금융 홈", `${state.sessionUser.userId}님의 계좌와 예적금 현황입니다.`);
        try {
            const [accounts, savings] = await Promise.all([
                accountRequest("/api/my/accounts"),
                accountRequest("/api/my/savings")
            ]);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!Array.isArray(accounts) || !Array.isArray(savings)) {
                throw new Error("고객 금융 응답 형식 오류");
            }
            appendStatGrid(root, [
                ["보유 계좌", `${accounts.length}개`, "현재 보유 계좌 현황"],
                ["가상 잔액 합계", formatMoney(accounts.reduce((sum, account) => sum + Number(account.balance || 0), 0)), "보유 계좌 잔액 합계"],
                ["보유 예적금", `${savings.length}건`, "현재 가입 현황"]
            ]);
            const accountSection = document.createElement("section");
            accountSection.className = "data-section";
            appendText(accountSection, "h2", "내 계좌");
            const accountGrid = document.createElement("div");
            accountGrid.className = "account-grid";
            accounts.forEach((account) => accountGrid.append(renderAccountCard(account)));
            if (accounts.length === 0) {
                showStatus(accountGrid, "is-empty", "보유 계좌가 없습니다", "현재 보유한 계좌가 없습니다.");
            }
            accountSection.append(accountGrid);
            const actions = document.createElement("div");
            actions.className = "page-actions";
            appendAction(actions, "/demo/accounts/index.html", "계좌조회");
            appendAction(actions, "/demo/savings/index.html", "예적금 상품", "button-primary");
            appendAction(actions, "/demo/loans/index.html", "대출 상품");
            appendAction(actions, "/demo/my/loans.html", "내 대출");
            appendAction(actions, "/demo/my/profile.html", "내 정보");
            accountSection.append(actions);
            root.append(accountSection);
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    async function renderAccounts(root, requestId) {
        if (!await ensureCustomerAccess(root, requestId)) {
            return;
        }
        root.replaceChildren();
        renderHeading(root, "계좌 조회", "내 계좌", "고객님에게 등록된 계좌 목록입니다.");
        try {
            const accounts = await accountRequest("/api/my/accounts");
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!Array.isArray(accounts)) {
                throw new Error("계좌 응답 형식 오류");
            }
            const grid = document.createElement("div");
            grid.className = "account-grid";
            accounts.forEach((account) => grid.append(renderAccountCard(account)));
            if (accounts.length === 0) {
                showStatus(grid, "is-empty", "보유 계좌가 없습니다", "현재 보유한 계좌가 없습니다.");
            }
            root.append(grid);
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    function transactionType(value) {
        return value === "DEPOSIT" ? "입금" : value === "WITHDRAWAL" ? "출금" : value || "거래";
    }

    function renderTransactionTable(parent, transactions) {
        const section = document.createElement("section");
        section.className = "data-section";
        appendText(section, "h2", "거래내역");
        if (transactions.length === 0) {
            const empty = document.createElement("div");
            showStatus(empty, "is-empty", "거래내역이 없습니다", "해당 계좌에 등록된 거래가 없습니다.");
            section.append(empty);
            parent.append(section);
            return;
        }
        const tableWrap = document.createElement("div");
        tableWrap.className = "table-wrap";
        const table = document.createElement("table");
        table.className = "data-table";
        table.innerHTML = "<thead><tr><th>거래일시</th><th>구분</th><th>금액</th><th>설명</th></tr></thead>";
        const body = document.createElement("tbody");
        transactions.forEach((transaction) => {
            const row = document.createElement("tr");
            appendText(row, "td", formatDate(transaction.occurredAt));
            appendText(row, "td", transactionType(transaction.type));
            appendText(row, "td", formatMoney(transaction.amount), transaction.type === "WITHDRAWAL" ? "amount-withdrawal" : "amount-deposit");
            appendText(row, "td", transaction.description || "설명 없음");
            body.append(row);
        });
        table.append(body);
        tableWrap.append(table);
        section.append(tableWrap);
        parent.append(section);
    }

    async function renderAccountDetail(root, requestId) {
        if (!await ensureCustomerAccess(root, requestId)) {
            return;
        }
        const accountId = new URLSearchParams(window.location.search).get("accountId");
        root.replaceChildren();
        if (!accountId) {
            renderError(root, "계좌 식별자가 없습니다.", "계좌 목록에서 상세 보기를 선택해 주세요.");
            return;
        }
        renderHeading(root, "계좌 상세", "계좌 상세", `${accountId}의 기본 정보와 거래내역입니다.`);
        try {
            const [account, transactions] = await Promise.all([
                accountRequest(`/api/secured/accounts/${encodeURIComponent(accountId)}`),
                accountRequest(`/api/my/accounts/${encodeURIComponent(accountId)}/transactions`)
            ]);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            const section = document.createElement("section");
            section.className = "data-section card account-detail-card";
            appendText(section, "h2", account.accountId || accountId);
            appendDetailGrid(section, [
                ["계좌 유형", account.accountType],
                ["계좌 식별자", account.accountId],
                ["잔액", formatMoney(account.balance)],
                ["상태", account.status]
            ]);
            root.append(section);
            renderTransactionTable(root, Array.isArray(transactions) ? transactions : []);
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
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
                throw new Error("상품 응답 형식 오류");
            }
            const tabs = document.createElement("div");
            tabs.className = "tab-list";
            const catalog = document.createElement("div");
            catalog.className = "catalog-grid";
            const renderCatalog = (kind = "ALL") => {
                catalog.replaceChildren();
                const filtered = kind === "ALL" ? products : products.filter((product) => product.kind === kind);
                filtered.forEach((product) => {
                    const card = document.createElement("a");
                    card.className = "catalog-card";
                    card.href = `/demo/savings/product.html?productId=${encodeURIComponent(product.productId)}`;
                    card.dataset.route = "true";
                    appendText(card, "span", savingsKind(product.kind), "section-label");
                    appendText(card, "h2", product.name || "상품명 없음");
                    appendDetailGrid(card, [["기간", `${product.termMonths}개월`], ["표시금리", `${product.displayRate}%`]]);
                    catalog.append(card);
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
            root.append(tabs, catalog);
            renderCatalog();
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    function renderProductSummary(parent, product) {
        appendDetailGrid(parent, [
            ["상품 유형", savingsKind(product.kind)],
            ["상품명", product.name],
            ["가입 기간", `${product.termMonths}개월`],
            ["표시금리", `${product.displayRate}%`],
            ["판매 상태", product.active ? "판매 중" : "판매 중단"]
        ]);
    }

    async function renderSavingsProduct(root, requestId) {
        root.replaceChildren();
        const productId = new URLSearchParams(window.location.search).get("productId");
        renderHeading(root, "상품 상세", "예적금 상품 상세", productId ? `${productId}의 상품 정보입니다.` : "상품 식별자가 필요합니다.");
        if (!productId) {
            renderError(root, "상품 식별자가 없습니다.", "상품 목록에서 상세 보기를 선택해 주세요.");
            return;
        }
        try {
            const product = await publicAccountRequest(`/api/public/savings/products/${encodeURIComponent(productId)}`);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            const card = document.createElement("section");
            card.className = "card data-section product-detail-card";
            appendText(card, "h2", product.name || product.productId);
            renderProductSummary(card, product);
            if (!product.active) {
                const stopped = document.createElement("div");
                showStatus(stopped, "is-empty", "현재 신규 가입이 중단된 상품입니다.", "판매 상태는 서버 응답을 기준으로 확인했습니다.");
                card.append(stopped);
            } else {
                const actions = document.createElement("div");
                actions.className = "page-actions";
                appendAction(actions, `/demo/savings/enroll.html?productId=${encodeURIComponent(product.productId)}`, "가입하기", "button-primary");
                card.append(actions);
            }
            root.append(card);
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    function renderSubscriptionSummary(parent, subscription, title) {
        const section = document.createElement("section");
        section.className = "card data-section subscription-detail-card";
        appendText(section, "h2", title || subscription.productName || subscription.productId || "가입 상세");
        appendDetailGrid(section, [
            ["가입번호", subscription.subscriptionId],
            ["상품", subscription.productName || subscription.productId],
            ["가입 원금", formatMoney(subscription.principal)],
            ["가입일", formatDate(subscription.joinedAt)],
            ["만기일", formatDate(subscription.maturityDate)],
            ["가입 상태", subscription.status]
        ]);
        return section;
    }

    function renderSubscriptionCard(subscription) {
        const card = document.createElement("a");
        card.className = "subscription-card";
        card.href = `/demo/my/savings-detail.html?subscriptionId=${encodeURIComponent(subscription.subscriptionId)}`;
        card.dataset.route = "true";
        appendText(card, "span", subscription.productName || subscription.productId, "section-label");
        appendText(card, "h2", subscription.subscriptionId || "가입번호 없음");
        appendDetailGrid(card, [
            ["가입 원금", formatMoney(subscription.principal)],
            ["가입일", formatDate(subscription.joinedAt)],
            ["만기일", formatDate(subscription.maturityDate)],
            ["가입 상태", subscription.status]
        ]);
        return card;
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
            const grid = document.createElement("div");
            grid.className = "subscription-grid";
            subscriptions.forEach((subscription) => grid.append(renderSubscriptionCard(subscription)));
            if (subscriptions.length === 0) {
                showStatus(grid, "is-empty", "가입한 예적금이 없습니다", "현재 가입한 예적금이 없습니다.");
            }
            root.append(grid);
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
        renderHeading(root, "가입 상세", "예적금 가입 상세", subscriptionId ? `${subscriptionId} 가입 정보를 확인합니다.` : "가입번호가 필요합니다.");
        if (!subscriptionId) {
            renderError(root, "가입번호가 없습니다.", "내 예적금 목록에서 상세 보기를 선택해 주세요.");
            return;
        }
        try {
            const subscription = await accountRequest(`/api/my/savings/${encodeURIComponent(subscriptionId)}`);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            renderSubscriptionSummary(root, subscription, "가입 내역 재조회 결과");
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
                renderInlineLogin(currentPath(), "로그인 Session이 만료되었습니다. 가입 요청은 자동 재시도하지 않습니다.");
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
        renderHeading(root, "가입 신청", "예적금 가입 신청", productId ? `${productId}의 가입 가능 여부를 확인합니다.` : "상품 식별자가 필요합니다.");
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
            const card = document.createElement("section");
            card.className = "card data-section enrollment-card";
            appendText(card, "h2", product.name || product.productId);
            renderProductSummary(card, product);
            const form = document.createElement("form");
            form.className = "customer-form";
            form.innerHTML = `<label class="field-label" for="principal">가입 금액</label><input class="field" id="principal" name="principal" inputmode="decimal" autocomplete="off" required><label class="check-field"><input type="checkbox" name="terms"><span>가상 약관을 확인하고 가입 내용에 동의합니다.</span></label><button class="button button-primary" data-enroll-submit type="submit">가입 내용 확인</button>`;
            bindEnrollmentReviewReset(form, root);
            form.addEventListener("submit", (event) => {
                event.preventDefault();
                submitEnrollment(form, product, root, requestId);
            });
            card.append(form);
            root.append(card);
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
        renderHeading(root, "가입 완료", "예적금 가입 완료", "저장된 가입 정보를 다시 확인합니다.");
        if (!subscriptionId) {
            renderError(root, "가입번호가 없습니다.", "가입 결과를 확인할 수 없어 내 예적금 목록으로 이동해 주세요.");
            return;
        }
        try {
            const subscription = await accountRequest(`/api/my/savings/${encodeURIComponent(subscriptionId)}`);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            renderSubscriptionSummary(root, subscription, "가입 완료 확인");
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
            const sessionSection = document.createElement("section");
            sessionSection.className = "card data-section";
            appendText(sessionSection, "h2", "인증 사용자");
            appendDetailGrid(sessionSection, [
                ["사용자 ID", state.sessionUser.userId],
                ["역할", state.sessionUser.roles.map((role) => roleLabel({ roles: [role] })).join(", ")],
                ["본인확인 상태", state.sessionUser.identityVerified ? "확인됨" : "미확인"]
            ]);
            root.append(sessionSection);
            if (!customerId) {
                renderError(root, "고객 프로필 식별자를 확인할 수 없습니다.", "현재 Identity API에는 현재 사용자 프로필 매핑 API가 없어 고객 프로필을 표시하지 않았습니다.", "is-empty");
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
            const profileSection = document.createElement("section");
            profileSection.className = "card data-section";
            appendText(profileSection, "h2", "Session 고객 프로필");
            appendDetailGrid(profileSection, [["고객 ID", profile.customerId], ["표시 이름", profile.displayName]]);
            root.append(profileSection);
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
        const card = document.createElement("article");
        card.className = "catalog-card loan-product-card";
        appendText(card, "span", "대출 상품", "section-label");
        appendText(card, "h2", product.name || product.productId || "상품명 없음");
        appendDetailGrid(card, [
            ["상품 식별자", product.productId],
            ["신청 가능 금액", `${formatMoney(product.minAmount)} ~ ${formatMoney(product.maxAmount)}`],
            ["판매 상태", product.active ? "신청 가능" : "신청 중단"]
        ]);
        const actions = document.createElement("div");
        actions.className = "page-actions";
        if (product.active) {
            appendAction(actions, `/demo/loans/product.html?productId=${encodeURIComponent(product.productId)}`, "상품 상세", "button-primary");
        } else {
            appendText(actions, "span", "현재 신청할 수 없습니다", "status-inline");
        }
        card.append(actions);
        return card;
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
                throw new Error("대출 상품 응답 형식 오류");
            }
            const grid = document.createElement("div");
            grid.className = "catalog-grid";
            products.forEach((product) => grid.append(renderLoanProductCard(product)));
            if (products.length === 0) {
                showStatus(grid, "is-empty", "판매 중인 대출 상품이 없습니다", "현재 이용 가능한 대출 상품이 없습니다.");
            }
            root.append(grid);
        } catch (error) {
            handleScreenError(root, error, requestId);
        }
    }

    async function renderLoanProduct(root, requestId) {
        root.replaceChildren();
        const productId = new URLSearchParams(window.location.search).get("productId");
        renderHeading(root, "대출 상품 상세", "대출 상품 상세", productId ? `${productId}의 상품 정보를 확인합니다.` : "상품 식별자가 필요합니다.");
        if (!productId) {
            renderError(root, "상품 식별자가 없습니다.", "대출 상품 목록에서 상세 보기를 선택해 주세요.");
            return;
        }
        try {
            const product = await publicAccountRequest(`/api/public/loans/products/${encodeURIComponent(productId)}`);
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            const card = document.createElement("section");
            card.className = "card data-section loan-detail-card";
            appendText(card, "h2", product.name || product.productId || "대출 상품");
            appendDetailGrid(card, [
                ["상품 식별자", product.productId],
                ["신청 가능 금액", `${formatMoney(product.minAmount)} ~ ${formatMoney(product.maxAmount)}`],
                ["판매 상태", product.active ? "신청 가능" : "신청 중단"]
            ]);
            if (product.active) {
                appendAction(card, `/demo/loans/apply.html?productId=${encodeURIComponent(product.productId)}`, "신청하기", "button-primary");
            } else {
                const stopped = document.createElement("div");
                showStatus(stopped, "is-empty", "현재 신청할 수 없습니다", "상품의 최신 판매 상태를 확인했습니다.");
                card.append(stopped);
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
                renderInlineLogin(currentPath(), "인증 상태가 만료되었습니다. 대출 신청 내용은 자동 제출하지 않습니다.");
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
        renderHeading(root, "대출 신청", "대출 신청서", productId ? `${productId} 신청 내용을 입력합니다.` : "상품 식별자가 필요합니다.");
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
            const card = document.createElement("section");
            card.className = "card data-section loan-apply-card";
            appendText(card, "h2", product.name || product.productId);
            appendDetailGrid(card, [
                ["신청자", state.sessionUser.userId],
                ["신청 가능 금액", `${formatMoney(product.minAmount)} ~ ${formatMoney(product.maxAmount)}`]
            ]);
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
            root.append(card);
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
                renderInlineLogin(currentPath(), "인증 Session이 만료되었습니다. 다시 로그인해 주세요.");
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
            card.className = "card data-section identity-card";
            appendText(card, "h2", "인증번호 입력");
            appendText(card, "p", `${state.sessionUser.userId} 고객님의 가상 본인확인 절차입니다.`);
            const steps = document.createElement("ol");
            steps.className = "identity-steps";
            ["정보 확인", "인증번호 입력", "완료"].forEach((label, index) => appendText(steps, "li", `${index + 1}. ${label}`, index === 1 ? "is-current" : ""));
            card.append(steps);
            const form = document.createElement("form");
            form.className = "customer-form";
            form.innerHTML = `<label class="field-label" for="verification-code">가상 인증번호</label><input class="field" id="verification-code" name="verificationCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required><div class="status-message is-error" data-identity-error role="alert" hidden></div><div class="page-actions"><button class="button button-primary" type="submit">인증하기</button><a class="button button-secondary" data-route="true" href="/demo/loans/index.html">취소</a></div>`;
            form.addEventListener("submit", (event) => {
                event.preventDefault();
                submitIdentityVerification(form, root, requestId, returnPath);
            });
            card.append(form);
            root.append(card);
        } catch (error) {
            if (error.status === 401) {
                clearAuthState();
                renderInlineLogin(currentPath(), "인증 Session이 만료되었습니다. 다시 로그인해 주세요.");
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
                renderInlineLogin(currentPath(), "인증 상태가 만료되었습니다. 대출 신청은 자동 재시도하지 않습니다.");
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
        section.className = "card data-section loan-application-card";
        appendText(section, "h2", title || "대출 신청 내역");
        appendDetailGrid(section, [
            ["신청번호", application.applicationId],
            ["상품 식별자", application.productId],
            ["신청 금액", formatMoney(application.amount)],
            ["접수일", formatDate(application.createdAt)],
            ["진행 상태", loanStatusLabel(application.status)]
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
            card.className = "card data-section loan-confirm-card";
            appendText(card, "h2", product.name || product.productId);
            appendDetailGrid(card, [
                ["신청자", draft.userId],
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
        renderHeading(root, "신청 접수", "대출 신청이 접수되었습니다", "서버에 저장된 신청 내역을 다시 조회합니다.");
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
            root.append(renderLoanApplicationSummary(application, "접수 내역 재조회 결과"));
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
        const card = document.createElement("a");
        card.className = "subscription-card loan-application-item";
        card.href = `/demo/my/loan-detail.html?applicationId=${encodeURIComponent(application.applicationId)}`;
        card.dataset.route = "true";
        appendText(card, "span", application.productId || "상품 식별자 없음", "section-label");
        appendText(card, "h2", application.applicationId || "신청번호 없음");
        appendDetailGrid(card, [
            ["신청 금액", formatMoney(application.amount)],
            ["접수일", formatDate(application.createdAt)],
            ["진행 상태", loanStatusLabel(application.status)]
        ]);
        return card;
    }

    async function renderMyLoans(root, requestId) {
        if (!await ensureCustomerAccess(root, requestId)) {
            return;
        }
        root.replaceChildren();
        renderHeading(root, "내 대출", "내 대출 신청 내역", "현재 로그인한 고객의 대출 신청 목록입니다.");
        try {
            const applications = await accountRequest("/api/loans/applications/my");
            if (!isCurrentScreen(root, requestId)) {
                return;
            }
            if (!Array.isArray(applications)) {
                throw new Error("대출 신청 목록 응답 형식 오류");
            }
            const grid = document.createElement("div");
            grid.className = "subscription-grid loan-application-grid";
            applications.forEach((application) => grid.append(renderLoanApplicationCard(application)));
            if (applications.length === 0) {
                showStatus(grid, "is-empty", "신청 내역이 없습니다", "현재 접수된 대출 신청이 없습니다.");
            }
            root.append(grid);
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
        renderHeading(root, "대출 신청 상세", "대출 신청 결과", applicationId ? `${applicationId}의 현재 저장 상태를 조회합니다.` : "신청번호가 필요합니다.");
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
            card.className = "card data-section security-card";
            appendText(card, "h2", "현재 인증 상태");
            appendDetailGrid(card, [
                ["사용자 ID", state.sessionUser.userId],
                ["본인확인", status.identityVerified ? "확인됨" : "미확인"],
                ["확인 시각", formatDate(status.verifiedAt)]
            ]);
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
                        renderInlineLogin(currentPath(), "인증 갱신이 만료되었습니다. 다시 로그인해 주세요.");
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
                renderInlineLogin(currentPath(), "인증 Session이 만료되었습니다. 다시 로그인해 주세요.");
                return;
            }
            handleScreenError(root, error, requestId);
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
        main.innerHTML = `<section class="login-layout"><div class="login-copy"><p class="eyebrow">Demo Bank 로그인</p><h1>안전한 금융 서비스를<br><span>시작해 보세요</span></h1><p>등록된 테스트 계정으로 로그인하면 현재 사용자와 역할을 확인할 수 있습니다.</p></div><div class="card login-card"><div class="card-heading"><div><p class="section-label">로그인</p><h2>Demo Bank 이용</h2></div></div><form class="login-form" data-login-form novalidate><label class="field-label" for="username">사용자명</label><input class="field" id="username" name="username" autocomplete="username" required><label class="field-label" for="password">비밀번호</label><input class="field" id="password" name="password" type="password" autocomplete="current-password" required><div class="status-message is-error" data-login-error role="alert" hidden></div><button class="button button-primary button-wide" data-login-submit type="submit">로그인</button></form><p class="login-return" data-return-target></p></div></section>`;
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

    async function initScreen(path) {
        const requestId = ++state.requestId;
        const publicLoanScreen = path === "/demo/loans/index.html" || path === "/demo/loans/product.html";
        renderCustomerFrame(requestId, publicLoanScreen);
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
            "/demo/my/security.html": ["인증 관리", renderSecurity]
        }[path];
        if (!screen) {
            renderError(root, "화면 경로를 확인할 수 없습니다.", "Demo Bank 고객 화면 경로가 아닙니다.");
            return;
        }
        setPageTitle(screen[0]);
        await screen[1](root, requestId);
    }

    async function initializePage() {
        const path = currentPath().split("?")[0];
        if (path === "/demo/" || path === "/demo/index.html") {
            if (document.body.dataset.page !== "home") {
                window.location.assign(path);
                return;
            }
            await initHome();
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
        if (isCustomerPath(path)) {
            await initScreen(path);
        }
    }

    async function navigateTo(raw, replace = false) {
        const target = normalizePath(raw);
        if (!target) {
            return;
        }
        const path = target.split("?")[0];
        if (path === "/demo/" || path === "/demo/index.html" || path === "/demo/login.html") {
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
        if (!targetUrl || targetUrl.startsWith("/demo/login.html") || targetUrl === "/demo/" || targetUrl === "/demo/index.html") {
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
