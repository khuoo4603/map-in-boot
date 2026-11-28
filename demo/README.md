# Map in Boot Demo

이 문서는 Demo Bank의 Normal·Vulnerable 실행 방법을 안내한다. 두 환경은 같은 HTML, CSS, JavaScript, 경로와 사용자 경험을 사용하고 서버의 보안 검증 결과가 다르다. 금융 서비스 로그인과 Map in Boot SDK 인증은 별도 기능이다. 취약 환경은 로컬 학습용으로만 사용한다.

## 실행

명령은 Repository 루트에서 실행한다. 기본 프로젝트 이름은 Normal `mapinboot-demo-normal`, Vulnerable `mapinboot-demo-vulnerable`이며, 각각 별도 네트워크·JWT 키 볼륨을 사용한다.

```powershell
docker compose -f demo/normal/compose.yaml config
docker compose -f demo/vulnerable/compose.yaml config
docker compose -f demo/normal/compose.yaml up --build -d
docker compose -f demo/vulnerable/compose.yaml up --build -d
```

기본 접속 주소는 Normal `http://localhost:8080/demo/`, Vulnerable `http://localhost:8180/demo/`이다. 서비스 내부 포트는 Main 8080, Identity 8081, Account 8082이다. 외부 포트와 `DEMO_CORS_ALLOWED_ORIGINS`는 필요할 때만 환경변수 또는 별도 환경변수 파일로 변경한다. 예시 `demo/.env.example`은 Normal의 포트 8080~8082와 CORS Origin 기준이다. Compose 파일은 `demo/normal/` 또는 `demo/vulnerable/`에 있으므로 `demo/.env` 파일은 자동으로 읽히지 않는다. 환경변수 파일을 사용할 때는 실행 명령에 `--env-file`을 지정하고, 두 Stack을 함께 실행하려면 각각 다른 호스트 포트와 CORS Origin을 설정한 파일을 사용한다. Normal은 8080~8082, Vulnerable은 8180~8182를 사용한다.

종료할 때는 실행 시 사용한 Compose 파일과 프로젝트 이름을 지정한다. JWT 키 데이터를 보존하려면 `down -v`를 사용하지 않는다.

```powershell
docker compose -f demo/normal/compose.yaml down
docker compose -f demo/vulnerable/compose.yaml down
```

## Map in Boot SDK

Compose와 Demo 애플리케이션은 SDK를 활성화하고(`MAPINBOOT_ENABLED=true`), SDK WEB은 끄며(`MAPINBOOT_WEB_ENABLED=false`), 인증 모드는 `NONE`으로 설정한다. 기본 실행에는 SDK 로그인 비밀번호가 필요 없다. 별도 SDK 로그인 화면 경로도 제공하지 않는다. SDK 인증 설정은 기존 금융 서비스 계정이나 Session 인증에 영향을 주지 않는다.

## SDK 의존성 모드

여섯 서비스는 같은 Gradle Property로 SDK 의존성을 선택한다. Compose 빌드는 기본 `project` 모드를 사용한다.

| `demoSdkMode` | SDK 참조 | 사용 시점 |
| --- | --- | --- |
| `project` | 현재 저장소의 `map-in-boot-starter`, `map-in-boot-security` 프로젝트 | 기본 개발·Compose 빌드 |
| `local` | 지정한 파일 Maven Repository의 배포 Artifact | 로컬 배포 검증 |
| `central` | Maven Central의 배포 좌표 | Artifact 공개 이후 확인 |

`demoSdkVersion`은 외부 Artifact 버전으로 기본 `0.1.0`이다. `demoSdkRepository`는 로컬 Repository 경로이며 기본 `build/repository`이다. 로컬 모드는 `io.github.khuoo4603` 그룹을 지정한 Repository에서만 조회하므로 캐시나 Maven Central의 같은 버전으로 대체하지 않는다.

로컬 Repository에 세 SDK 모듈을 게시한 다음 Normal·Vulnerable 여섯 서비스의 BootJar를 만든다.

```powershell
./gradlew publishAllPublicationsToBuildLocalRepository '-PreleaseVersion=0.1.0'
./gradlew :demo:normal:main-service:bootJar :demo:normal:identity-service:bootJar :demo:normal:account-service:bootJar `
  :demo:vulnerable:main-service:bootJar :demo:vulnerable:identity-service:bootJar :demo:vulnerable:account-service:bootJar `
  '-PdemoSdkMode=local' '-PdemoSdkVersion=0.1.0' '-PdemoSdkRepository=build/repository'
```

정식 공개 후에는 `-PdemoSdkMode=central -PdemoSdkVersion=0.1.0`을 지정한다. 아직 공개하지 않은 좌표는 Maven Central에서 받을 수 없다. Normal 또는 Vulnerable 한 서비스를 JVM에서 직접 실행할 때도 같은 Property를 해당 `bootRun`에 전달한다. 예를 들어 Main은 `:demo:normal:main-service:bootRun` 또는 `:demo:vulnerable:main-service:bootRun` Task를 사용한다. 세 서비스를 함께 띄우려면 각 터미널에서 해당 서비스의 Task를 실행하고 기존 서비스 포트·JWT 경로·내부 URL 환경변수를 설정한다.

로컬에서 SDK WEB을 켜려면 환경변수를 설정한 뒤 해당 Compose Stack을 재기동한다. 인증 모드는 기본값 `NONE`이므로 로그인 없이 SDK 화면과 조회 API를 사용할 수 있다.

```powershell
$env:MAPINBOOT_WEB_ENABLED = "true"
docker compose -f demo/normal/compose.yaml up --build -d

# 취약 환경 확인이 필요한 경우
docker compose -f demo/vulnerable/compose.yaml up --build -d
```

Normal SDK 주소는 `http://localhost:8080/mapinboot/`, Vulnerable SDK 주소는 `http://localhost:8180/mapinboot/`이다. Status와 Snapshot은 각 주소의 `api/status`, `api/snapshot` 경로에서 조회한다. 금융 Demo 화면은 기존 `/demo/` 경로를 사용한다.

개발 환경에서 SDK 전용 비밀번호를 명시하려면 WEB과 `PASSWORD` 모드를 설정하고 비밀번호를 프로세스 환경 또는 별도로 지정한 Compose 환경변수 파일로 전달한다. 아래 값은 실행 환경에서만 정하며 저장소 파일에 실제 비밀번호를 기록하지 않는다.

```powershell
$env:MAPINBOOT_WEB_ENABLED = "true"
$env:MAPINBOOT_WEB_AUTH_MODE = "PASSWORD"
$env:MAPINBOOT_PASSWORD = "실행 환경에서 주입할 비밀번호"
docker compose -f demo/normal/compose.yaml up --build -d
```

`MAPINBOOT_WEB_AUTH_MODE`는 Compose 입력 변수이며 컨테이너에는 `MAPINBOOT_WEB_AUTHMODE`로 전달된다. 로그인 화면은 `/mapinboot/`에서 제공된다. 비밀번호가 비어 있으면 보호된 Status·Snapshot 접근은 실패 상태로 닫히며, 금융 서비스 로그인에는 별도 영향이 없다. 기본 WEB 비활성 상태에서 SDK 경로는 노출되지 않는다. 환경변수 파일 사용 시 `--env-file <경로>`를 Compose 명령에 지정한다. Compose는 `demo/.env`를 자동으로 읽는다고 가정하지 않는다.

호스트 SDK의 YAML·Maven·Gradle 설정과 Spring Security 연동은 [SDK 사용 가이드](../README.md)를 참고한다.

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

전체 검증 명령과 SDK 인증 정책은 [SDK 사용 가이드](../README.md), 첫 릴리즈 범위는 [Release Notes](../RELEASE_NOTES.md)를 참고한다.
