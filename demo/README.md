# Map in Boot — 금융 Demo 서비스

가상 금융 서비스 시나리오를 바탕으로 Spring Security 보안 정책과 권한 제어를 실증·검증하는 로컬 테스트 환경입니다.

## 1. 서비스 구성
- **정상 Demo**: Main `8080`, Identity `8081`, Account `8082`
- **취약 Demo**: Main `8180`, Identity `8181`, Account `8182`
- 각 Demo는 별도 Main·Identity·Account 앱과 JWT 키·Session·In-Memory 저장소를 사용합니다. 은행 화면과 표준 API 경로는 같습니다.

## 2. 사전 요구사항
- Git
- Docker Desktop 또는 Docker Engine + Docker Compose

## 3. 최초 실행 방법
본 Demo는 멀티모듈 구조이므로 **전체 저장소를 Clone**한 뒤 루트 디렉터리에서 실행해야 합니다.

```bash
# 1. 저장소 Clone 및 루트 디렉터리 이동
git clone https://github.com/khuoo4603/map-in-boot.git
cd map-in-boot

# 2. 정상 Demo 환경변수 파일 준비
cp demo/.env.example ../.env
# ../.env 파일에서 DEMO_TEST_PASSWORD와 내부 서비스 Secret을 설정하세요.

# 3. 정상 Demo 실행
docker compose --env-file ../.env up --build -d

# 4. 취약 Demo용 별도 환경변수 파일 준비 및 실행
cp demo/.env.example ../.env.vulnerable
# ../.env.vulnerable에서 Compose 프로젝트명, 포트 8180~8182, CORS Origin,
# DEMO_INTERNAL_SERVICE_SECRET을 정상 Demo와 다른 값으로 설정하세요.
docker compose -f docker-compose.vulnerable.yml --env-file ../.env.vulnerable up --build -d
```

두 환경은 각각 별도 Compose 프로젝트·네트워크·JWT 키 Volume을 사용합니다. 프로젝트명을 각각 `mapinboot-demo`, `mapinboot-demo-vulnerable`로 유지하세요.

## 4. 접속 주소 및 테스트 계정
- **정상 Demo**: 웹 포털 `http://localhost:8080/demo/`, Identity API `http://localhost:8081`, Account API `http://localhost:8082`
- **취약 Demo**: 웹 포털 `http://localhost:8180/demo/`, Identity API `http://localhost:8181`, Account API `http://localhost:8182`
- **테스트 계정 목록**:
  - 고객: `customer.a` (USER001), `customer.b` (USER002)
  - 직원: `staff.a` (STAFF001), `staff.b` (STAFF002)
  - 관리자: `bank.admin` (ADMIN001), `mib.dev` (DEV001)
- **비밀번호**: 각 Demo 환경변수 파일에 설정한 `DEMO_TEST_PASSWORD` 값 사용

## 5. 종료 방법
```bash
# 정상 Demo 종료
docker compose --env-file ../.env down

# 취약 Demo 종료
docker compose -f docker-compose.vulnerable.yml --env-file ../.env.vulnerable down
```

## 6. 참고 사항
- JWT 서명용 RSA 키(2048비트)는 각 Compose 프로젝트의 `jwt-init`을 통해 별도 Docker Named Volume에 자동 생성 및 보관됩니다.
- 생성된 키는 해당 프로젝트 안에서만 재사용됩니다. 취약 Demo는 정상 Demo의 JWT 키 Volume을 참조하지 않습니다.
- 은행 HTML/CSS/JS 원본은 `demo/normal/main-service/src/main/resources/static/demo/`이며, 취약 Main JAR은 빌드 시 같은 리소스를 포함합니다.

## 7. Identity Session 로그인 사용 방법
Identity의 기존 `/api/auth/login` 요청 본문과 `accessToken`, `expiresIn`, `user` 응답 계약은 유지됩니다. 브라우저에서 Session 인증을 함께 사용하려면 로그인 전에 CSRF Token을 발급받아야 합니다.

정상 Identity 주소는 `http://localhost:8081`, 취약 Identity 주소는 `http://localhost:8181`입니다. 비교 시 해당 주소에서 각각 로그인하세요.

1. `GET http://localhost:8081/api/auth/csrf` 요청에 `credentials: "include"`를 설정합니다. 응답 JSON의 `token`과 브라우저에 저장된 `XSRF-TOKEN` Cookie를 확인합니다.
2. 기존과 같은 JSON으로 `POST http://localhost:8081/api/auth/login`을 호출하되, `credentials: "include"`와 `X-XSRF-TOKEN` Header를 함께 전달합니다.
3. 로그인 이후 Session 인증 요청과 `POST /api/auth/logout`, `POST /api/identity/verify`에도 `credentials: "include"`와 동일한 CSRF Header를 전달합니다.

```javascript
const csrf = await fetch("http://localhost:8081/api/auth/csrf", {
  credentials: "include"
}).then(response => response.json());

await fetch("http://localhost:8081/api/auth/login", {
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

## 8. 포트 및 CORS 설정

- 기본 호스트 포트: 정상 Main/Identity/Account `8080/8081/8082`, 취약 `8180/8181/8182`
- 컨테이너 내부 포트: Main/Identity/Account 모두 `8080/8081/8082`
- Compose 내부 서비스 주소: `identity-service:8081`, `account-service:8082`
- 각 환경변수 파일의 `MAIN_PORT`, `IDENTITY_PORT`, `ACCOUNT_PORT`는 해당 Stack의 호스트 공개 포트만 Override
- 각 환경변수 파일의 `DEMO_CORS_ALLOWED_ORIGINS`에는 같은 Stack의 Main Origin만 쉼표로 구분해 명시
- 컨테이너 내부 포트와 서비스 간 호출 주소는 호스트 포트 Override와 무관하게 유지
- 브라우저 Cookie는 포트별로 격리되지 않습니다. 두 Demo의 Session 검증은 별도 브라우저 프로필에서 각각 로그인해 수행합니다.

정상·취약 Compose 실행에는 서로 다른 외부 환경변수 파일을 사용합니다. 기본 실행 명령은 3절을 참고하세요.

## 9. 접근 제어 시나리오 검증

시나리오별 Endpoint는 표의 HTTP 메서드를 따릅니다. JWT 요청은 Identity에서 발급한 Access Token을 사용하며, 직원·고객 역할은 Token의 `roles` Claim으로 구분합니다. N06은 JWT가 아닌 `MIB_IDENTITY_SESSION` Cookie와 CSRF 조건을 갖춘 Session 요청을 사용합니다. N10/V10은 Main의 내부 서비스 인증 환경변수도 필요합니다.

| 시나리오 | 표준 요청 | 요청 준비 조건 | 정상 기대 결과 | 취약 기대 결과 |
| --- | --- | --- | --- | --- |
| N01/V01 | `GET /api/legacy/account-summary/{accountId}` | `ACC001`, 익명 요청 또는 고객 JWT | 익명 401, JWT 200, 없는 계좌 404 | 익명 200, 없는 계좌 404; V01 Chain 미매칭 |
| N02/V02 | `GET /api/staff/reports/summary` | 직원·고객 JWT 또는 익명 요청 | 익명 401, 고객 403, 직원 200 | 익명·고객·직원 200; V02 선행 약한 Chain 선택 |
| N03/V03 | `GET /api/staff/customers/search?q=CUST` | 직원·고객 JWT 또는 익명 요청 | 익명 401, 고객 403, 직원 200 | 익명·고객·직원 200 |
| N04/V04 | `GET /api/staff/customers/{customerId}` | `CUST002`, 고객·직원 JWT | 고객 403, 직원 200 | 고객·직원 200 |
| N05/V05 | `GET /api/accounts/{accountId}` | `ACC001`·`ACC002`, 고객 JWT | 본인 200, 타인 403, 익명 401 | 본인·타인 200, 익명 401 |
| N06/V06 | `GET /api/session/customers/{customerId}/profile` | 고객 Session Cookie, `CUST001`·`CUST002` | 본인 200, 타인 403, Session 없음 401 | 본인·타인 200, Session 없음 401 |
| N07/V07 | `GET /api/staff/customers/{customerId}/contact` (`X-Staff-Id` 포함) | `STAFF001` 직원 JWT, `X-Staff-Id: STAFF002` | 담당 고객 200, 타인 403, 익명 401 | 직원 JWT와 위조 Header 기준 담당 고객 200 |
| N08/V08 | `POST /api/auth/refresh` | 해당 Stack에서 발급한 유효 고객 JWT | `BearerTokenAuthenticationFilter` 후 `RefreshTokenFilter`, 200과 새 JWT | `RefreshTokenFilter` 후 `BearerTokenAuthenticationFilter`, 401 |
| N09/V09 | `POST /api/loans/applications` | 본인확인 전 고객 JWT와 대출 신청 요청 | 미확인 JWT 403, 확인 JWT 201 | 미확인 JWT 201 및 실제 신청 저장 |
| N10/V10 | `GET /api/portal/accounts/{accountId}/summary` | 고객 A JWT, 내부 서비스 인증 환경변수 | 본인 200, 타인 403, 익명 401 | 본인·타인 200, 익명 401 |

정상·취약 런타임은 위 표준 경로를 함께 사용합니다. Lab은 현재 접속한 Runtime에 단일 요청을 보내고, 다른 Demo에서 같은 시나리오를 별도로 실행해야 실제 응답을 비교할 수 있습니다. 응답 코드만으로 Runtime이나 보안 결과를 판정하지 않습니다. 각 Stack에서 자체 Identity로 새 JWT·Session을 발급받으세요. 기존 `/api/secured/...`, `/api/staff/protected/...`, `/api/staff/secured/...`, `/api/session/secured/...`, `/api/auth/secured/...`, `/api/portal/secured/...`, `/internal/secured/...` 경로는 대체 경로로 제공하지 않습니다.

두 Demo가 같은 `localhost` Host를 쓰므로 Identity Session Cookie는 포트가 달라도 겹칠 수 있습니다. N06/V06은 별도 브라우저 프로필을 사용하고 각 Runtime에서 새로 로그인하세요. JWT 키도 분리되어 있으므로 한 Demo의 JWT를 다른 Demo에 보내지 않습니다. N07/V07은 양쪽 요청에 같은 `X-Staff-Id: STAFF002` Header를 전달합니다. N09/V09는 실제 신청을 저장할 수 있으므로 Lab의 실행 전 확인을 읽고 직접 실행해야 합니다.

N01/V01은 Main `SecurityFilterChain` 적용 여부, N02/V02는 `@Order`와 Matcher의 첫 번째 일치 Chain 선택 차이를 검증합니다. V01의 공개 상태는 `permitAll`이 아니라 GET 경로가 모든 Chain Matcher에서 제외된 결과이며, V02는 뒤쪽 보호 Chain이 존재하지만 넓은 선행 Chain이 먼저 선택되는 구조입니다.
