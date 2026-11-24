# Map in Boot Demo

Demo Bank의 Normal·Vulnerable 실행 환경이다. 두 환경은 같은 HTML, CSS, JavaScript, 경로와 사용자 경험을 사용하며 서버의 보안 검증 결과만 다르다. 취약 환경은 로컬 학습용으로만 사용한다.

## 실행

명령은 Repository 루트에서 실행한다. 기본 프로젝트 이름은 Normal `mapinboot-demo-normal`, Vulnerable `mapinboot-demo-vulnerable`이며, 각각 별도 네트워크·JWT 키 볼륨을 사용한다.

```powershell
docker compose -f demo/normal/compose.yaml config
docker compose -f demo/vulnerable/compose.yaml config
docker compose -f demo/normal/compose.yaml up --build -d
docker compose -f demo/vulnerable/compose.yaml up --build -d
```

기본 접속 주소는 Normal `http://localhost:8080/demo/`, Vulnerable `http://localhost:8180/demo/`이다. 서비스 내부 포트는 Main 8080, Identity 8081, Account 8082이다. 외부 포트와 `DEMO_CORS_ALLOWED_ORIGINS`는 필요할 때만 환경변수 또는 별도 환경변수 파일로 변경한다. 예시 `demo/.env.example`은 Normal의 포트 8080~8082와 CORS Origin 기준이다. Compose 파일은 `demo/normal/` 또는 `demo/vulnerable/`에 있으므로 `demo/.env` 파일은 자동으로 읽히지 않는다. 환경변수 파일을 사용할 때는 실행 명령에 `--env-file`을 지정하고, 두 Stack을 함께 실행하려면 각각 다른 호스트 포트와 CORS Origin을 설정한 파일을 사용한다. Normal은 8080~8082, Vulnerable은 8180~8182를 사용한다.

### `(sub)` 작업본에서 별도 포트로 실행

같은 PC에서 다른 작업본과 함께 실행할 때만 아래처럼 서로 다른 프로젝트 이름과 포트를 지정한다. 환경변수 파일은 공유하지 않는다.

```powershell
$env:MAIN_PORT = "18080"
$env:IDENTITY_PORT = "18081"
$env:ACCOUNT_PORT = "18082"
$env:DEMO_CORS_ALLOWED_ORIGINS = "http://localhost:18080,http://127.0.0.1:18080"
docker compose -p mapinboot-gemini-sub-normal -f demo/normal/compose.yaml up --build -d

$env:MAIN_PORT = "18180"
$env:IDENTITY_PORT = "18181"
$env:ACCOUNT_PORT = "18182"
$env:DEMO_CORS_ALLOWED_ORIGINS = "http://localhost:18180,http://127.0.0.1:18180"
docker compose -p mapinboot-gemini-sub-vulnerable -f demo/vulnerable/compose.yaml up --build -d
```

종료할 때는 실행 시 사용한 파일과 프로젝트 이름을 그대로 지정한다. JWT 키 데이터를 보존하려면 `down -v`를 사용하지 않는다.

```powershell
docker compose -p mapinboot-gemini-sub-normal -f demo/normal/compose.yaml down
docker compose -p mapinboot-gemini-sub-vulnerable -f demo/vulnerable/compose.yaml down
```

## 로그인 계정

| 역할 | 계정 |
| --- | --- |
| 고객 | `customer.a`, `customer.b` |
| 직원 | `staff.a`, `staff.b` |
| 은행 관리자 | `bank.admin` |
| 개발자 관리자 | `mib.dev` |

모든 계정의 비밀번호는 `demotest`이다. 이는 로컬 교육용으로 공개된 자격증명이며 실서비스나 외부 데이터에 사용하지 않는다. 로그인 화면에서 계정을 선택하면 사용자명과 비밀번호가 입력되며, 실제 로그인은 로그인 버튼을 눌러 진행한다. 비밀번호는 BCrypt로 저장되고 기존 `AuthenticationManager` 인증 경로를 사용한다.

Main에서 Account로 보내는 내부 요청은 Basic 인증을 유지한다. 각 실행 환경은 서로 다른 로컬 Demo 기본 자격증명을 사용하며 환경변수 설정 없이 동작한다. JWT RSA 키는 Compose 프로젝트별 Named Volume에 생성·보관된다.

## 서비스 및 세션 인증

- Normal: Main `8080`, Identity `8081`, Account `8082`
- Vulnerable: Main `8180`, Identity `8181`, Account `8182`
- 각 Identity의 `POST /api/auth/login`은 기존 JSON 응답 계약을 유지한다.
- 브라우저 Session 인증은 로그인 전에 해당 Identity에서 `GET /api/auth/csrf`를 호출하고, 받은 token을 `X-XSRF-TOKEN`에 넣어야 한다. 로그인·로그아웃·본인확인 요청은 Session Cookie와 CSRF 검증을 그대로 사용한다.
- 두 Demo를 같은 브라우저에서 동시에 검증하면 포트와 무관하게 Cookie가 공유될 수 있으므로 별도 브라우저 프로필을 사용한다.
- Lab은 현재 열어 둔 Runtime에 실제 HTTP 요청을 보낸다. 응답 코드만으로 Snapshot Finding을 만들거나 갱신하지 않는다.

## 빌드

```powershell
.\gradlew.bat :demo:normal:main-service:bootJar :demo:normal:identity-service:bootJar :demo:normal:account-service:bootJar
.\gradlew.bat :demo:vulnerable:main-service:bootJar :demo:vulnerable:identity-service:bootJar :demo:vulnerable:account-service:bootJar
```

Vulnerable Main은 Normal Main의 `demo` 정적 UI 소스를 빌드 시 재사용한다. 두 BootJar에 들어가는 `/static/demo/**` 파일 목록과 SHA-256은 같아야 한다.
