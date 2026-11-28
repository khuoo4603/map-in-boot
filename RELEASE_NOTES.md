# Map in Boot 0.1.0

상태: v0.1.0 첫 릴리즈 초안. Maven Central과 GitHub Release에는 아직 공개하지 않았다.

## 포함 범위

- Java 17 기반 Core, Spring Boot Starter, 선택형 Spring Security 분석 모듈
- Spring MVC Servlet 구성 수집과 인증·인가 구조 Graph
- Snapshot, Evidence, Finding 및 네트워크·설정 불확실성 표시
- `전체 Flow Map`, `기능별 상세 Flow Map`, `전체 취약점 진단 Flow Map`, `기능별 상세 취약점 확인` 화면
- Snapshot 보관, SDK WEB 접근 제어, 선택형 `HOST`·`PASSWORD`·`NONE` 인증

## 배포 좌표

| 모듈 | Maven 좌표 |
| --- | --- |
| Core | `io.github.khuoo4603:map-in-boot-core:0.1.0` |
| Starter | `io.github.khuoo4603:map-in-boot-starter:0.1.0` |
| Security | `io.github.khuoo4603:map-in-boot-security:0.1.0` |

좌표는 공개 발행 예정 값이다. Central 공개 전에는 외부 Maven Repository에서 설치할 수 없다. 설치 전제와 예제는 [SDK 사용 가이드](README.md)를 참고한다.

## 지원 기준

- Java 17
- Gradle Wrapper 8.14
- Spring Boot 4.0.9
- Spring Framework 7.0.10
- Spring Security 7.0.8
- Spring MVC Servlet 애플리케이션

다른 프레임워크 버전, 비 Servlet 환경, 다중 서비스 통합은 이 릴리즈에서 검증하거나 지원한다고 보장하지 않는다.

## 인증 기본값

Starter 기본값은 SDK 활성화, WEB 비활성화, 유효 인증 모드 `HOST`이다. Demo Compose는 SDK 활성화, WEB 비활성화, 기본 인증 모드 `NONE`을 사용한다. Demo에서 WEB을 명시적으로 켜면 로그인 화면 없이 SDK를 확인할 수 있다. 외부 애플리케이션에서 `PASSWORD`를 선택할 때는 환경변수로 비밀번호를 주입해야 하며 비밀번호가 비어 있으면 보호 데이터를 허용하지 않는다. 금융 Demo 사용자 인증은 SDK 인증과 별도다.

## 분석 한계

분석 결과는 실행 시 수집 가능한 Spring 구성과 코드 구조를 기반으로 한다. 실제 사용자 요청의 전체 Trace를 기록하지 않으며, 모든 취약점을 탐지하거나 보안 상태를 보증하지 않는다. Snapshot의 수집 범위와 분석 상태, Finding Evidence를 함께 확인해야 한다.

## 검증 및 미완료 사항

- 전체 Gradle 빌드와 JavaScript 테스트 통과
- 로컬 Maven Repository의 Starter 단독 및 Spring Security 조합을 Gradle·Maven 소비 앱에서 확인
- Normal·Vulnerable Demo를 로컬 Artifact 모드로 실행해 SDK 화면·Status·Snapshot HTTP 응답 확인
- 두 Compose 파일 구문 확인
- Maven Central 공개 발행·외부 설치, GitHub Tag·Release 미수행
- Chrome에서 Normal Main의 `/mapinboot/` 화면과 Snapshot Graph 표시 확인. 상세 상호작용은 미검증

## 라이선스와 외부 고지

프로젝트 라이선스는 Apache License 2.0이다. 정적 리소스에 포함된 ELK.js는 Eclipse Public License 2.0 고지를 포함한다. 배포 시 각 라이선스 고지를 함께 확인한다.

실제 공개 발행 절차는 [README의 첫 릴리즈 발행 절차](README.md#첫-릴리즈-발행-절차)를 따른다.
