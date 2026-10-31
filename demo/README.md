# Map in Boot — 금융 Demo 서비스

가상 금융 서비스 시나리오를 바탕으로 Spring Security 보안 정책과 권한 제어를 실증·검증하는 로컬 테스트 환경입니다.

## 1. 서비스 구성
- **Main Service (18080)**: 웹 포털 UI 진입점 및 공개 리소스 제공
- **Identity Service (18081)**: 사용자 인증, BCrypt 비밀번호 검증 및 RS256 비대칭 서명 JWT 발급
- **Account Service (18082)**: 공개키 기반 JWT 검증 및 고객별 본인 계좌 조회 인가 처리

## 2. 사전 요구사항
- Git
- Docker Desktop 또는 Docker Engine + Docker Compose

## 3. 최초 실행 방법
본 Demo는 멀티모듈 구조이므로 **전체 저장소를 Clone**한 뒤 루트 디렉터리에서 실행해야 합니다.

```bash
# 1. 저장소 Clone 및 루트 디렉터리 이동
git clone https://github.com/khuoo4603/map-in-boot.git
cd map-in-boot

# 2. 저장소 외부 환경변수 파일 준비 (.env 생성 후 테스트 비밀번호 설정)
cp demo/.env.example ../.env
# ../.env 파일 내 DEMO_TEST_PASSWORD 값을 원하는 비밀번호로 입력하세요.

# 3. Docker Compose 빌드 및 실행
docker compose --env-file ../.env up --build -d
```

## 4. 접속 주소 및 테스트 계정
- **웹 포털 주소**: `http://localhost:18080/demo/`
- **테스트 계정 목록**:
  - 고객: `customer.a` (USER001), `customer.b` (USER002)
  - 직원: `staff.a` (STAFF001), `staff.b` (STAFF002)
  - 관리자: `bank.admin` (ADMIN001), `mib.dev` (DEV001)
- **비밀번호**: `../.env`에 설정한 `DEMO_TEST_PASSWORD` 값 사용

## 5. 종료 방법
```bash
docker compose --env-file ../.env down
```

## 6. 참고 사항
- JWT 서명용 RSA 키(2048비트)는 Compose 실행 시 `jwt-init` 컨테이너를 통해 Docker Named Volume에 자동 생성 및 보관됩니다.
- 생성된 키는 Compose 재시작 시에도 유지되며, 로컬 보안 테스트 전용으로 동작합니다.

## 7. Identity Session 로그인 사용 방법
Identity의 기존 `/api/auth/login` 요청 본문과 `accessToken`, `expiresIn`, `user` 응답 계약은 유지됩니다. 브라우저에서 Session 인증을 함께 사용하려면 로그인 전에 CSRF Token을 발급받아야 합니다.

1. `GET http://localhost:18081/api/auth/csrf` 요청에 `credentials: "include"`를 설정합니다. 응답 JSON의 `token`과 브라우저에 저장된 `XSRF-TOKEN` Cookie를 확인합니다.
2. 기존과 같은 JSON으로 `POST http://localhost:18081/api/auth/login`을 호출하되, `credentials: "include"`와 `X-XSRF-TOKEN` Header를 함께 전달합니다.
3. 로그인 이후 Session 인증 요청과 `POST /api/auth/logout`, `POST /api/identity/verify`에도 `credentials: "include"`와 동일한 CSRF Header를 전달합니다.

```javascript
const csrf = await fetch("http://localhost:18081/api/auth/csrf", {
  credentials: "include"
}).then(response => response.json());

await fetch("http://localhost:18081/api/auth/login", {
  method: "POST",
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
    "X-XSRF-TOKEN": csrf.token
  },
  body: JSON.stringify({ username, password })
});
```

`XSRF-TOKEN`은 Header 전달을 위해 `HttpOnly`가 아니며, 인증용 `MIB_IDENTITY_SESSION` Cookie는 `HttpOnly`로 발급됩니다. `Authorization: Bearer <JWT>` 요청은 기존 JWT 계약을 그대로 사용하며 Session Cookie를 새로 생성하지 않습니다.
