(() => {
    "use strict";

    const state = {
        accessToken: null,
        sessionUser: null,
        csrfToken: null,
        busy: false
    };

    const roleLabels = {
        ROLE_CUSTOMER: "고객",
        ROLE_STAFF: "직원",
        ROLE_BANK_ADMIN: "은행 관리자",
        MAP_IN_BOOT_ADMIN: "개발자"
    };

    const allowedReturnPaths = new Set(["/demo", "/demo/", "/demo/index.html"]);

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
            const error = new Error("CSRF Token을 가져오지 못했습니다.");
            error.status = response.status;
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
        if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
            headers.set("X-XSRF-TOKEN", await loadCsrfToken());
        }

        return fetch(`${identityOrigin}${path}`, {
            ...options,
            method,
            headers,
            credentials: "include"
        });
    }

    // 현재 사용자 Session 조회, Bearer 사용은 명시적인 경우로 제한
    async function loadCurrentUser(includeBearer = false) {
        if (!identityOrigin) {
            return { response: null, body: null, error: new Error("Identity 서비스 주소를 확인할 수 없습니다.") };
        }

        const headers = new Headers();
        if (includeBearer && state.accessToken) {
            headers.set("Authorization", `Bearer ${state.accessToken}`);
        }

        try {
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

    // 실제 화면 경로만 허용하는 returnTo 정규화
    function safeReturnTo() {
        const raw = new URLSearchParams(window.location.search).get("returnTo");
        if (!raw || raw.includes("\\") || raw.includes("\0")) {
            return "/demo/";
        }

        try {
            const target = new URL(raw, window.location.origin);
            if (target.origin !== window.location.origin
                    || target.username
                    || target.password
                    || target.search
                    || target.hash
                    || !allowedReturnPaths.has(target.pathname)) {
                return "/demo/";
            }
            return target.pathname === "/demo" ? "/demo/" : target.pathname;
        } catch {
            return "/demo/";
        }
    }

    function roleLabel(user) {
        const role = Array.isArray(user?.roles) ? user.roles.find((value) => roleLabels[value]) : null;
        return role ? roleLabels[role] : "사용자";
    }

    // 메인 화면의 인증 상태 갱신
    function renderHomeAuth(user, error) {
        const authState = query("[data-auth-state]");
        const loginLinks = queryAll("[data-login-link]");
        const logoutButtons = queryAll("[data-logout]");
        const userLabels = queryAll("[data-user-label]");

        if (user) {
            const label = roleLabel(user);
            showStatus(authState, "is-auth", `${user.userId}님, 환영합니다`, `${label} 권한으로 로그인되었습니다.`);
            loginLinks.forEach((link) => { link.hidden = true; });
            logoutButtons.forEach((button) => { button.hidden = false; });
            userLabels.forEach((element) => {
                element.textContent = `${user.userId} · ${label}`;
                element.hidden = false;
            });
            return;
        }

        if (error) {
            showStatus(authState, "is-error", "로그인 상태를 확인하지 못했습니다", "로그인 화면에서 다시 확인해 주세요.");
        } else {
            showStatus(authState, "is-empty", "로그인하고 금융 서비스를 이용하세요", "로그인하면 현재 사용자와 역할을 확인할 수 있습니다.");
        }
        loginLinks.forEach((link) => { link.hidden = false; });
        logoutButtons.forEach((button) => { button.hidden = true; });
        userLabels.forEach((element) => { element.hidden = true; });
    }

    // 공지사항 목록 조회 및 상태 표시
    async function loadNotices() {
        const stateElement = query("[data-notices-state]");
        const listElement = query("[data-notices-list]");
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

            listElement.replaceChildren();
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

    function formatDate(value) {
        if (typeof value !== "string") {
            return "날짜 정보 없음";
        }

        const date = new Date(`${value}T00:00:00`);
        if (Number.isNaN(date.getTime())) {
            return value;
        }
        return new Intl.DateTimeFormat("ko-KR").format(date);
    }

    function formatMoney(value) {
        const amount = Number(value);
        return Number.isFinite(amount) ? `${new Intl.NumberFormat("ko-KR").format(amount)}원` : "금액 정보 없음";
    }

    function savingsKind(value) {
        return value === "DEPOSIT" ? "예금" : value === "INSTALLMENT" ? "적금" : "상품";
    }

    function renderProduct(listElement, title, detail) {
        const item = document.createElement("article");
        item.className = "product-item";
        appendText(item, "strong", title);
        appendText(item, "span", detail);
        listElement.append(item);
    }

    // 공개 금융상품 목록 조회 및 카드 표시
    async function loadProducts(path, listSelector, stateSelector, renderItem) {
        const stateElement = query(stateSelector);
        const listElement = query(listSelector);
        listElement.hidden = true;
        listElement.replaceChildren();
        try {
            if (!accountOrigin) {
                throw new Error("Account 서비스 주소를 확인할 수 없습니다.");
            }
            const response = await fetch(`${accountOrigin}${path}`, {
                credentials: "omit",
                cache: "no-store"
            });
            const body = await readBody(response);
            if (!response.ok || !Array.isArray(body)) {
                throw new Error("상품 조회 실패");
            }
            if (body.length === 0) {
                showStatus(stateElement, "is-empty", "판매 중인 상품이 없습니다", "현재 이용 가능한 상품이 없습니다.");
                return;
            }

            listElement.replaceChildren();
            body.forEach((product) => renderItem(listElement, product));
            stateElement.hidden = true;
            listElement.hidden = false;
        } catch {
            showStatus(stateElement, "is-server-error", "상품 정보를 불러오지 못했습니다", "잠시 후 다시 시도해 주세요.");
        }
    }

    // 현재 문서의 Session 사용자와 메모리 JWT 초기화
    function clearAuthState() {
        state.accessToken = null;
        state.sessionUser = null;
        state.csrfToken = null;
    }

    function renderSavingsProduct(listElement, product) {
        const detail = [
            savingsKind(product.kind),
            Number.isInteger(product.termMonths) ? `${product.termMonths}개월` : null,
            product.displayRate === null || product.displayRate === undefined
                ? null
                : `표시금리 ${product.displayRate}%`
        ].filter(Boolean).join(" · ");
        renderProduct(listElement, product.name || "상품명 없음", detail || "상품 정보 확인 필요");
    }

    function renderLoanProduct(listElement, product) {
        const detail = `${formatMoney(product.minAmount)} ~ ${formatMoney(product.maxAmount)}`;
        renderProduct(listElement, product.name || "상품명 없음", detail);
    }

    // 로그아웃 요청 및 화면 상태 초기화
    function bindLogout() {
        queryAll("[data-logout]").forEach((button) => {
            button.addEventListener("click", async () => {
                if (state.busy) {
                    return;
                }
                state.busy = true;
                button.disabled = true;
                try {
                    const response = await identityRequest("/api/auth/logout", { method: "POST" });
                    if (!response.ok) {
                        throw new Error("로그아웃 실패");
                    }
                    clearAuthState();
                    window.location.assign("/demo/");
                } catch {
                    const authState = query("[data-auth-state]");
                    showStatus(authState, "is-error", "로그아웃하지 못했습니다", "잠시 후 다시 시도해 주세요.");
                    button.disabled = false;
                } finally {
                    state.busy = false;
                }
            });
        });
    }

    async function initHome() {
        bindLogout();
        await Promise.all([
            loadCurrentUser().then((currentUser) => {
                state.sessionUser = currentUser.response?.ok ? currentUser.body : null;
                if (!currentUser.response?.ok) {
                    state.accessToken = null;
                }
                renderHomeAuth(
                    state.sessionUser,
                    currentUser.error || (currentUser.response && currentUser.response.status !== 401)
                );
            }),
            loadNotices(),
            loadProducts("/api/public/savings/products", "[data-savings-list]", "[data-savings-state]", renderSavingsProduct),
            loadProducts("/api/public/loans/products", "[data-loans-list]", "[data-loans-state]", renderLoanProduct)
        ]);
    }

    function setLoginError(title, detail) {
        const errorElement = query("[data-login-error]");
        showStatus(errorElement, "is-error", title, detail);
    }

    function setLoginBusy(busy) {
        const submit = query("[data-login-submit]");
        if (submit) {
            submit.disabled = busy;
            submit.textContent = busy ? "로그인 중..." : "로그인";
        }
    }

    // 로그인 요청과 현재 사용자 확인
    function initLogin() {
        const form = query("[data-login-form]");
        const username = query("#username");
        const password = query("#password");
        const returnTarget = query("[data-return-target]");
        if (!form || !username || !password) {
            return;
        }

        returnTarget.textContent = `로그인 후 ${safeReturnTo()} 화면으로 이동합니다.`;
        queryAll("[data-account]").forEach((button) => {
            button.addEventListener("click", () => {
                username.value = button.dataset.account || "";
                username.focus();
            });
        });

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (state.busy) {
                return;
            }
            if (!username.value.trim() || !password.value) {
                setLoginError("사용자명과 비밀번호를 입력해 주세요", "입력값을 확인한 뒤 다시 시도해 주세요.");
                return;
            }

            state.busy = true;
            setLoginBusy(true);
            query("[data-login-error]").hidden = true;
            try {
                const response = await identityRequest("/api/auth/login", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username: username.value.trim(), password: password.value })
                });
                const body = await readBody(response);
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
                const currentUser = await loadCurrentUser();
                if (currentUser.error) {
                    const error = new Error("로그인은 처리되었지만 Session 확인 요청에 실패했습니다.");
                    error.phase = "session";
                    error.detail = "Identity 서비스 연결 상태를 확인한 뒤 다시 로그인해 주세요.";
                    throw error;
                }
                if (currentUser.response?.status === 401) {
                    const error = new Error("로그인은 처리되었지만 Session을 확인하지 못했습니다.");
                    error.phase = "session";
                    error.detail = "브라우저 Session과 로그인 응답이 일치하지 않습니다. 다시 로그인해 주세요.";
                    throw error;
                }
                if (!currentUser.response?.ok || !currentUser.body?.userId) {
                    const error = new Error("로그인은 처리되었지만 Session 사용자 확인에 실패했습니다.");
                    error.phase = "session";
                    error.detail = "Session 상태가 확정되지 않았습니다. Identity 서비스 상태를 확인한 뒤 다시 로그인해 주세요.";
                    throw error;
                }
                state.sessionUser = currentUser.body;
                // 보호 API 미구현 범위이므로 페이지 전환 전에 JWT 메모리 폐기
                state.accessToken = null;
                window.location.assign(safeReturnTo());
            } catch (error) {
                clearAuthState();
                const detail = error.phase === "session"
                    ? error.detail
                    : "입력값과 네트워크 상태를 확인해 주세요.";
                setLoginError(error.message || "로그인에 실패했습니다.", detail);
                setLoginBusy(false);
                state.busy = false;
            }
        });
    }

    if (document.body.dataset.page === "home") {
        initHome();
    }
    if (document.body.dataset.page === "login") {
        initLogin();
    }
})();
