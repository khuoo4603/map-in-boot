(() => {
  const form = document.getElementById("login-form");
  const password = document.getElementById("password");
  const toggle = document.getElementById("password-toggle");
  const button = document.getElementById("login-button");
  const status = document.getElementById("login-status");

  const message = (text) => { status.textContent = text; };

  toggle.addEventListener("click", () => {
    const visible = password.type === "text";
    password.type = visible ? "password" : "text";
    toggle.textContent = visible ? "보기" : "숨기기";
    toggle.setAttribute("aria-label", visible ? "비밀번호 표시" : "비밀번호 숨기기");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!password.value) {
      message("관리자 비밀번호를 입력하세요.");
      password.focus();
      return;
    }

    button.disabled = true;
    message("관리자 인증 중입니다.");
    try {
      const csrfResponse = await fetch("/api/auth/csrf", {
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      if (!csrfResponse.ok) throw new Error("csrf");
      const csrf = await csrfResponse.json();
      if (!csrf.token || !csrf.headerName) throw new Error("csrf");

      const loginResponse = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          [csrf.headerName]: csrf.token
        },
        body: JSON.stringify({ username: "mib.dev", password: password.value })
      });
      if (!loginResponse.ok) throw new Error(loginResponse.status === 401 ? "credentials" : "server");

      const meResponse = await fetch("/api/auth/me", {
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      if (!meResponse.ok) throw new Error("session");
      const me = await meResponse.json();
      if (!Array.isArray(me.roles) || !me.roles.includes("ROLE_MAP_IN_BOOT_ADMIN")) {
        throw new Error("role");
      }
      window.location.assign("/mapinboot/test");
    } catch (error) {
      const messages = {
        credentials: "관리자 비밀번호가 올바르지 않습니다.",
        role: "진단 페이지 관리자 권한을 확인할 수 없습니다.",
        csrf: "CSRF 정보를 가져오지 못했습니다. 다시 시도하세요.",
        session: "관리자 Session을 확인하지 못했습니다. 다시 시도하세요.",
        server: "로그인 서버 오류입니다. 잠시 후 다시 시도하세요."
      };
      message(messages[error.message] || "로그인에 실패했습니다. 다시 시도하세요.");
    } finally {
      password.value = "";
      button.disabled = false;
    }
  });
})();
