# Map in Boot

Spring Boot·Spring Security 애플리케이션의 실행 구조와 인증·인가 관계를 수집해 Snapshot과 Graph로 보여 주는 Java SDK입니다.

<p>
  <img alt="Java, Spring, Gradle, JavaScript" src="https://skillicons.dev/icons?i=java,spring,gradle,js" />
</p>

## 모듈

| 모듈 | 역할 | 의존 관계 |
| --- | --- | --- |
| `map-in-boot-core` | 공통 Fact·Relation·Finding·Graph·Snapshot 계약과 처리 | Spring Context API |
| `map-in-boot-starter` | Spring Boot 자동 구성, Servlet·MVC 수집, Snapshot 저장, 읽기 전용 SDK WEB | Core 전이 의존성 |
| `map-in-boot-security` | Spring Security 구조 수집 및 7개 보안 Finding 규칙 | Core 전이 의존성, 선택 설치 |
| `demo/` | 업무 로그인과 보안 시나리오를 보여 주는 Normal·Vulnerable 앱, [실행 안내](demo/README.md) | SDK 배포 대상 아님 |

Starter는 호스트 애플리케이션이 제공하는 Spring MVC Servlet 런타임과 Spring Boot 자동 구성에 연결됩니다. `map-in-boot-security`는 선택 모듈입니다. 사용하려면 호스트에 Spring Security를 먼저 추가해야 합니다. SDK는 호스트의 `SecurityFilterChain`을 만들거나 변경하지 않습니다.

## 지원 환경

| 구성 요소 | 버전 |
| --- | --- |
| Java | 17 |
| Gradle Wrapper | 8.14 |
| Spring Boot | 4.0.9 |
| Spring Framework | 7.0.10 |
| Spring Security | 7.0.8 |
| Jackson Databind | 3.1.7 |
| ELK.js | 정적 리소스에 포함, 원본 파일에 패키지 버전 메타데이터 없음 |

현재 검증 기준은 Spring Boot 4.0.9 및 Servlet 기반 Spring MVC입니다. 다른 메이저·마이너 버전과 비 Servlet 환경의 호환성은 이 문서에서 보장하지 않습니다. Starter의 Boot·MVC 의존성은 호스트 제공 전제이며, SDK가 호스트의 Spring 런타임을 대신 설치하지 않습니다.

## 기능

| 영역 | 제공 기능 |
| --- | --- |
| SDK 화면 | `전체 Flow Map`, `기능별 상세 Flow Map`, `전체 취약점 진단 Flow Map`, `기능별 상세 취약점 확인` |
| 구조 수집 | Endpoint·Servlet·Handler·SecurityFilterChain·Filter·인가 정책 및 확인 가능한 연결 관계 |
| 결과 | Snapshot, 원본 참조가 있는 Evidence, 근거 기반 Finding과 불확실성 표시 |
| Finding 규칙 | `CHAIN_MISSING`, `CHAIN_ORDER`, `PUBLIC_ENDPOINT`, `METHOD_MISMATCH`, `FILTER_ORDER`, `OBJECT_BINDING`, `STATE_BYPASS` |
| 탐색 | 검색, Graph 선택·Inspector, 필터, 요청 처리 학습 흐름 |

수집되는 구성 정보와 Snapshot을 바탕으로 구조를 분석합니다. 개별 HTTP 요청을 추적하는 실시간 계측기는 아니며, 모든 취약점을 찾아내거나 보안을 보증하지 않습니다. 수집 범위 밖의 정보는 미확인 또는 불완전 상태로 남을 수 있습니다. 여러 서비스의 정보를 모으는 MSA Hub는 제공하지 않습니다.

## 설치

아래 좌표는 첫 릴리즈 예정 버전 `0.1.0`입니다. Maven Central에 공개하기 전에는 내려받을 수 없습니다. 공개한 뒤에는 Maven Central을 사용하는 호스트에서 설치할 수 있습니다.

### Gradle Groovy

```groovy
repositories {
    mavenCentral()
}

dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-webmvc:4.0.9'
    implementation 'io.github.khuoo4603:map-in-boot-starter:0.1.0'

    // Spring Security 구조 분석이 필요한 경우에만 추가
    implementation 'org.springframework.boot:spring-boot-starter-security:4.0.9'
    implementation 'io.github.khuoo4603:map-in-boot-security:0.1.0'
}
```

Security 분석을 사용하지 않을 때는 주석 처리한 두 의존성을 제외합니다. Core는 Starter와 Security의 전이 의존성으로 제공됩니다. 호스트 애플리케이션이 Spring MVC와 실제 사용할 Spring Security 구성을 제공합니다.

### Maven

```xml
<parent>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-parent</artifactId>
  <version>4.0.9</version>
  <relativePath/>
</parent>

<properties>
  <java.version>17</java.version>
</properties>

<dependencies>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-webmvc</artifactId>
  </dependency>
  <dependency>
    <groupId>io.github.khuoo4603</groupId>
    <artifactId>map-in-boot-starter</artifactId>
    <version>0.1.0</version>
  </dependency>

  <!-- Spring Security 구조 분석이 필요한 경우에만 추가 -->
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-security</artifactId>
  </dependency>
  <dependency>
    <groupId>io.github.khuoo4603</groupId>
    <artifactId>map-in-boot-security</artifactId>
    <version>0.1.0</version>
  </dependency>
</dependencies>
```

Security 분석을 사용하지 않을 때는 주석으로 표시한 두 의존성을 제외합니다. `0.1.0`은 Spring Boot 4.0.9와 Java 17을 사용하는 독립 Gradle·Maven 소비 앱에서 실행을 확인했습니다. Central 공개 여부와 무관하게 공개 전 좌표를 Central에서 설치할 수 있다는 뜻은 아닙니다.

## 설정

### 기본값

| 설정 | 기본값 | 의미 |
| --- | --- | --- |
| `mapinboot.enabled` | `true` | SDK 분석과 WEB의 전체 상위 스위치 |
| `mapinboot.web.enabled` | `false` | SDK WEB 노출 여부 |
| `mapinboot.web.auth-mode` | 생략 시 `HOST` | 호스트 인증, SDK 비밀번호 인증, 인증 없음 중 선택 |
| `mapinboot.web.required-role` | `MAP_IN_BOOT_ADMIN` | `HOST` 모드에서 요구하는 호스트 역할 |
| `mapinboot.web.anonymous-preview` | `false` | 레거시 익명 Preview 호환 설정 |
| `mapinboot.web.login.password` | 미설정 | `PASSWORD` 모드에서 필요한 비밀번호 |
| `mapinboot.web.login.session-timeout` | `30m` | SDK 로그인 세션 유효 시간, 양수 |
| `mapinboot.snapshot.directory` | `./mapinboot-data/snapshots` | Snapshot 저장 경로 |
| `mapinboot.snapshot.retention-days` | `7` | Snapshot 보관 기간, 1~90일 |

SDK를 분석에 사용하고 호스트 역할로 보호하는 기본 예제입니다. 호스트 포트와 `server.servlet.context-path`를 사용한다면 그 값을 포함한 URL로 접속합니다.

```yaml
mapinboot:
  enabled: true
  web:
    enabled: true
    auth-mode: HOST
    required-role: MAP_IN_BOOT_ADMIN
  snapshot:
    directory: ./mapinboot-data/snapshots
    retention-days: 7
```

설정 후 브라우저에서 `http://localhost:8080/mapinboot/`에 접속합니다. 실제 주소는 호스트의 포트와 context path에 맞춰 조정합니다.

### 프로필별 설정

Spring Runtime Profile은 Git Branch와 별개입니다. 다음 예제는 기본·운영 프로필에서 SDK WEB을 끄고, 개발 프로필에서 `PASSWORD`를 명시합니다.

```yaml
mapinboot:
  enabled: true
  web:
    enabled: false
  snapshot:
    directory: ./mapinboot-data/snapshots
    retention-days: 7
---
spring:
  config:
    activate:
      on-profile: develop
mapinboot:
  enabled: true
  web:
    enabled: true
    auth-mode: PASSWORD
    login:
      password: ${MAPINBOOT_PASSWORD:}
      session-timeout: 30m
  snapshot:
    directory: ./mapinboot-data/snapshots
    retention-days: 7
---
spring:
  config:
    activate:
      on-profile: prod
mapinboot:
  enabled: true
  web:
    enabled: false
```

`MAPINBOOT_PASSWORD`는 운영 Secret 저장소, 배포 환경 또는 로컬 프로세스 환경변수로 주입합니다. 저장소의 설정 파일이나 명령 기록에 실제 비밀번호를 남기지 않습니다. `PASSWORD` 모드에서 비밀번호가 비어 있으면 보호된 Snapshot·Status 응답을 허용하지 않으며, 로그인 API도 사용할 수 없습니다.

`NONE`은 인증 없이 SDK WEB과 조회 API를 제공하는 모드입니다. 격리된 로컬·신뢰된 개발 환경에서만 사용하고 외부 네트워크에 공개하지 않습니다.

```yaml
mapinboot:
  enabled: true
  web:
    enabled: true
    auth-mode: NONE
```

두 스위치의 효과는 다릅니다. WEB만 끄면 SDK 분석은 계속 수행되고 WEB 경로는 노출되지 않습니다. `mapinboot.enabled: false`는 분석과 WEB을 모두 끕니다.

```yaml
# SDK 분석과 WEB 모두 비활성화
mapinboot:
  enabled: false
```

기본 SDK의 생략된 인증 모드는 `HOST`입니다. Demo Compose는 기본 인증 모드가 `NONE`이며 WEB은 기본 비활성입니다. Demo 정책과 외부 호스트 SDK 정책은 서로 다릅니다.

### 환경변수

| 목적 | Spring Boot 바인딩 / Compose 입력 |
| --- | --- |
| SDK 전체 | `MAPINBOOT_ENABLED` → `mapinboot.enabled` |
| WEB 활성화 | `MAPINBOOT_WEB_ENABLED` → `mapinboot.web.enabled` |
| 인증 모드 | `MAPINBOOT_WEB_AUTHMODE` → `mapinboot.web.auth-mode` |
| 호스트 역할 | `MAPINBOOT_WEB_REQUIREDROLE` → `mapinboot.web.required-role` |
| 로그인 비밀번호 | `MAPINBOOT_WEB_LOGIN_PASSWORD` → `mapinboot.web.login.password` |
| 세션 제한 시간 | `MAPINBOOT_WEB_LOGIN_SESSIONTIMEOUT` → `mapinboot.web.login.session-timeout` |
| Snapshot 경로 | `MAPINBOOT_SNAPSHOT_DIRECTORY` → `mapinboot.snapshot.directory` |
| Snapshot 보관 기간 | `MAPINBOOT_SNAPSHOT_RETENTIONDAYS` → `mapinboot.snapshot.retention-days` |
| Demo 인증 모드 입력 | Compose의 `MAPINBOOT_WEB_AUTH_MODE`가 컨테이너 `MAPINBOOT_WEB_AUTHMODE`로 전달 |
| Demo 비밀번호 입력 | Compose의 `MAPINBOOT_PASSWORD`가 컨테이너 `MAPINBOOT_WEB_LOGIN_PASSWORD`로 전달 |

일반 Spring Boot 애플리케이션은 YAML·프로필·실행 환경에서 값을 받습니다. Compose는 `--env-file`로 지정한 파일이나 Compose 호출 환경에서 변수를 읽습니다. Compose 파일 하위 디렉터리의 `.env`는 자동으로 읽지 않습니다. 개발·운영 환경의 인증 비밀번호 입력 이름은 실제 애플리케이션 바인딩과 Compose의 외부 입력 이름이 다를 수 있으므로 위 표를 따릅니다.

## Spring Security 연동

Starter는 호스트 `SecurityFilterChain`을 만들거나 변경하지 않습니다. 호스트 Filter Chain이 요청을 거부하면 SDK의 MVC `WebAccessGuard`까지 도달하지 않습니다. 아래 matchers는 기존 체인 안에 추가하고, 기존 업무 인증·인가 규칙과 `anyRequest` 처리는 유지합니다.

```java
import com.mapinboot.starter.autoconfigure.MapInBootProperties;
import com.mapinboot.starter.web.access.WebAccessGuard;
import org.springframework.context.annotation.Bean;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;

@Bean
SecurityFilterChain applicationSecurity(
        HttpSecurity http, MapInBootProperties properties, Environment environment) throws Exception {
    http.authorizeHttpRequests(auth -> {
        auth.requestMatchers(HttpMethod.GET, WebAccessGuard.publicUiPaths()).permitAll();
        auth.requestMatchers(HttpMethod.GET, WebAccessGuard.authUiPaths()).permitAll();
        auth.requestMatchers(HttpMethod.GET, WebAccessGuard.authStatusPaths()).permitAll();
        auth.requestMatchers(HttpMethod.POST, WebAccessGuard.authPostPaths()).permitAll();
        if (WebAccessGuard.isSdkReadApiFilterPassThroughEnabled(properties, environment)) {
            auth.requestMatchers(HttpMethod.GET, WebAccessGuard.previewApiPaths()).permitAll();
        }

        // 기존 호스트 업무별 인증·인가 matchers를 이 위치에 유지
        auth.anyRequest().authenticated();
    });
    http.csrf(csrf -> csrf.ignoringRequestMatchers(WebAccessGuard::isAuthPostRequest));
    return http.build();
}
```

`publicUiPaths()`의 `permitAll`은 SDK 데이터 API의 공개를 뜻하지 않습니다. 실제 `HOST` 역할, `PASSWORD` 세션, `NONE` 정책은 MVC Guard가 다시 확인합니다. `PASSWORD`·`NONE`에서 Preview API를 호스트 필터가 SDK Guard까지 전달하는 조건은 helper가 결정합니다. 업무 API 전체나 `/mapinboot/**` 전체를 무조건 허용하지 않습니다. 호스트 CSRF를 끄지 않으며, SDK 로그인·로그아웃 POST만 SDK 내부 CSRF 검증을 전제로 예외 처리합니다.

| 요청 | 용도와 접근 조건 |
| --- | --- |
| `GET /mapinboot/` | 단일 화면 진입점. `PASSWORD` 미인증이면 같은 경로에서 로그인 화면 제공 |
| `GET /mapinboot/api/status` | Status 조회. `HOST`는 Principal·필수 역할, `PASSWORD`는 로그인 세션, `NONE`은 SDK·WEB 활성 상태 필요 |
| `GET /mapinboot/api/snapshot` | Snapshot 조회. 위 인증 조건 적용 |
| `GET /mapinboot/api/auth/status` | 인증 상태와 필요 시 CSRF token 조회 |
| `POST /mapinboot/api/auth/login` | `PASSWORD` 모드 로그인. JSON Body와 SDK CSRF Header 필요 |
| `POST /mapinboot/api/auth/logout` | `PASSWORD` 모드 로그아웃. 기존 호스트 업무 Session은 로그아웃하지 않으며 SDK CSRF Header 필요 |

별도 `/mapinboot/login` 페이지는 없습니다. 인증 UI는 `/mapinboot/` 응답으로만 제공되며, 인증 API 경로는 화면 진입점과 별개입니다. `HOST` 모드에서 미인증은 401, 필수 역할 부족은 403입니다. `PASSWORD` 비밀번호 누락은 보호 데이터 접근을 닫힌 상태로 처리합니다. 호스트 Security Filter가 먼저 응답하면 최종 상태 코드는 호스트 체인의 정책도 따릅니다.

`anonymous-preview`는 호환 설정입니다. `auth-mode`를 생략하고 `anonymous-preview: true`와 `develop` 프로필을 함께 사용할 때만 적용됩니다. `HOST`, `PASSWORD`, `NONE`을 명시하면 이 레거시 분기가 우선하지 않습니다. `/mapinboot/test` 개발 진단 경로는 별도 호스트 역할 보호 대상입니다.

Snapshot에는 애플리케이션 구조와 보안 구성 정보가 포함될 수 있습니다. HTTPS, 네트워크 접근 제한, Snapshot 저장 경로의 접근 제어를 적용하고 실제 Secret을 Snapshot이나 문서에 기록하지 않습니다.

## 문제 해결

| 증상 | 확인 사항 |
| --- | --- |
| `/mapinboot/` 404 | `mapinboot.enabled=true`, `mapinboot.web.enabled=true`, 호스트 MVC Servlet 구성 확인 |
| HOST 모드 401 | 호스트 Principal 및 Spring Security Chain의 인증 전달 확인 |
| HOST 모드 403 | `required-role`과 `HttpServletRequest.isUserInRole`에 연결된 호스트 권한 확인 |
| PASSWORD 로그인 또는 Snapshot 실패 | 명시적 `auth-mode: PASSWORD`, 비어 있지 않은 환경변수, 세션 Cookie, SDK CSRF 발급·전달 확인 |
| 인증 세션 만료 | 다시 `/mapinboot/`에서 인증. 조회 실패와 실제 만료를 구분하며 브라우저 복귀 때 상태 확인 |
| Spring Security에서 401·403·CSRF 오류 | SDK GET/POST 경로와 HTTP Method matcher 확인. 호스트 업무 CSRF 전체 비활성화 금지 |
| Snapshot이 없거나 오래됨 | SDK 분석 완료, Collector 상태, Snapshot 저장 경로·쓰기 권한, 보관 기간 확인. 저장 결과는 분석 상태와 일치할 수 있음 |
| Boot/Security 의존성 충돌 | Boot 4.0.9, Framework 7.0.10, Security 7.0.8 조합과 호스트의 전이 의존성 확인 |

## 로컬 검증

```bash
./gradlew clean build --stacktrace
node --test map-in-boot-starter/src/test/js/*.test.js
```

Demo의 여섯 서비스는 Gradle Property로 SDK 의존성을 전환합니다. 기본값은 현재 저장소의 SDK 프로젝트를 직접 참조합니다. 로컬 Artifact 모드는 세 모듈을 저장소의 파일 Maven Repository에 게시한 뒤 Demo를 다시 빌드합니다.

```bash
./gradlew publishAllPublicationsToBuildLocalRepository -PreleaseVersion=0.1.0
./gradlew :demo:normal:main-service:bootJar :demo:normal:identity-service:bootJar :demo:normal:account-service:bootJar \
  :demo:vulnerable:main-service:bootJar :demo:vulnerable:identity-service:bootJar :demo:vulnerable:account-service:bootJar \
  -PdemoSdkMode=local -PdemoSdkVersion=0.1.0 -PdemoSdkRepository=build/repository
```

`demoSdkMode`는 `project`, `local`, `central`을 받습니다. `demoSdkVersion`은 외부 Artifact 버전이며 기본값은 `0.1.0`, `demoSdkRepository`는 로컬 모드의 저장소 경로이며 기본값은 `build/repository`입니다. 로컬 모드는 SDK 그룹을 지정된 Repository에서만 찾습니다. `central` 모드는 공개된 좌표를 Maven Central에서 가져오므로 실제 발행 이후 사용할 수 있습니다. 별도 Maven 소비 앱 검증은 임시 디렉터리에서 수행하며 저장소에 두지 않습니다. 자세한 실행 명령은 [Demo 안내](demo/README.md)에 있습니다.

## 저장소와 라이선스

```text
map-in-boot-core/       공통 모델 및 분석 계약
map-in-boot-starter/    Spring Boot Starter, 인증 API, Snapshot, SDK WEB
map-in-boot-security/   Spring Security 수집기 및 Finding 규칙
demo/                   Normal·Vulnerable 금융 Demo
demo/sdk-dependencies.gradle  여섯 Demo 서비스의 SDK 참조 모드
build.gradle            세 SDK 모듈의 Maven Publication 및 Central Bundle
```

프로젝트 라이선스는 [Apache License 2.0](LICENSE)입니다. 정적 리소스에 포함된 ELK.js는 별도 [Eclipse Public License 2.0 고지](map-in-boot-starter/src/main/resources/static/mapinboot/vendor/elkjs-LICENSE.md)를 따릅니다. 포함된 외부 라이선스와 의존성은 SDK 재배포 시 각 고지를 함께 확인합니다.

## 첫 릴리즈 발행 절차

이 절차는 유지관리자가 main의 최종 Commit에서 직접 수행합니다. 이 저장소의 첫 발행 작업은 GitHub·Maven Central로 전송하지 않았습니다. 현재 상태는 [v0.1.0 Release Notes 초안](RELEASE_NOTES.md)에서 확인할 수 있습니다.

1. `feature/*`에서 `develop`으로 Squash Merge하고 통합 검증을 마칩니다. `develop`에서 `main`으로 Merge Commit합니다.
2. `main`으로 이동해 발행할 정확한 Commit을 확인하고 그 Commit에 `v0.1.0` Tag를 생성합니다. Tag는 테스트·발행 대상 Commit과 일치해야 합니다.

   ```bash
   git switch main
   git rev-parse HEAD
   git tag v0.1.0
   ```

3. 해당 소스에서 `./gradlew clean build --stacktrace`와 JavaScript 테스트를 실행합니다. Starter 단독 및 Security 포함 Maven 소비 호환성은 임시 소비 앱으로 확인합니다.
4. `./gradlew centralBundle -PreleaseVersion=0.1.0`을 실행합니다. Gradle은 세 SDK의 JAR·Sources·Javadoc·POM·Module Metadata와 Checksum·GPG 서명을 검증하고 `build/distributions/map-in-boot-0.1.0-central.zip`을 생성합니다. GPG 키는 유지관리자 환경에서만 사용합니다.
5. Central Portal에서 Bundle을 수동 업로드하고 검증을 거쳐 공개 발행합니다. Portal 절차는 [Sonatype Central Portal 사용자 가이드](https://central.sonatype.org/publish/publish-portal-upload/)를 따릅니다.
6. Maven Central의 실제 `io.github.khuoo4603` 좌표로 설치를 검증합니다.
7. 같은 Tag를 기준으로 [GitHub Releases](https://github.com/khuoo4603/map-in-boot/releases)에 Release Notes를 등록합니다. Central Bundle에서 사용한 것과 동일한 Binary JAR 3개만 첨부하며 Sources·Javadoc JAR 및 Bundle ZIP은 첨부하지 않습니다.

Maven Central에 공개한 동일 버전은 덮어쓸 수 없습니다. 수정 발행은 새 SemVer 버전으로 진행합니다. 개인 키의 백업·암호·Agent 접근은 안전하게 관리하며 공개 문서나 저장소에 기록하지 않습니다.
