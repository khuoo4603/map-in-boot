(() => {
  "use strict";

  const form = document.querySelector("#login-form");
  const password = document.querySelector("#password");
  const toggle = document.querySelector("#password-toggle");
  const submit = document.querySelector("#submit-button");
  const message = document.querySelector("#login-message");
  let csrfToken = null;
  let submitting = false;

  async function readAuthStatus() {
    const response = await fetch("/mapinboot/api/auth/status", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
    if (!response.ok) throw new Error("status");
    const status = await response.json();
    if (status.mode !== "PASSWORD") {
      window.location.replace("/mapinboot/");
      return null;
    }
    if (status.authenticated) {
      window.location.replace("/mapinboot/");
      return null;
    }
    csrfToken = status.csrfToken;
    return status;
  }

  async function submitLogin(event) {
    event.preventDefault();
    if (submitting) return;
    if (!password.value) {
      message.textContent = "비밀번호를 입력해 주세요.";
      password.focus();
      return;
    }
    submitting = true;
    submit.disabled = true;
    message.textContent = "확인 중입니다.";
    try {
      if (!csrfToken) await readAuthStatus();
      const response = await fetch("/mapinboot/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-MapInBoot-CSRF": csrfToken || "" },
        body: JSON.stringify({ password: password.value })
      });
      if (response.status === 200) {
        window.location.replace("/mapinboot/");
        return;
      }
      const messages = {
        400: "요청을 확인해 주세요.",
        401: "비밀번호가 일치하지 않습니다.",
        403: "인증 요청이 만료되었습니다. 다시 시도해 주세요.",
        404: "로그인 기능을 사용할 수 없습니다.",
        429: "로그인 시도가 제한되었습니다. 잠시 후 다시 시도해 주세요.",
        503: "서버 인증 설정을 확인해 주세요."
      };
      message.textContent = messages[response.status] || "로그인 요청을 처리하지 못했습니다.";
      if (response.status === 403) await readAuthStatus();
    } catch {
      message.textContent = "서버에 연결할 수 없습니다. 연결 상태를 확인해 주세요.";
    } finally {
      submitting = false;
      submit.disabled = false;
    }
  }

  toggle.addEventListener("click", () => {
    const visible = password.type === "password";
    password.type = visible ? "text" : "password";
    toggle.setAttribute("aria-label", visible ? "비밀번호 숨기기" : "비밀번호 표시");
    toggle.setAttribute("aria-pressed", String(visible));
    password.focus();
  });
  form.addEventListener("submit", submitLogin);
  readAuthStatus().catch(() => { message.textContent = "인증 상태를 확인할 수 없습니다. 다시 시도해 주세요."; });
})();
