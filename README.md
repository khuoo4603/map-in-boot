# Map in Boot

Spring Boot / Spring Security 애플리케이션의 인증·인가 구조를 Security Graph로 분석하고 시각화하는 SDK입니다.

## 모듈 구성

- `map-in-boot-core`: 공통 모듈, Provider 및 Graph 생성
- `map-in-boot-starter`: Spring Boot 연동, Adapter, Snapshot 관리 및 읽기 전용 UI
- `map-in-boot-security`: Adapter 및 취약점 진단
- `demo/`: 데모 애플리케이션

## 기술스텍 버전

- Java 17
- Gradle 8.14+
- Spring Boot 4.0.x
- Spring Framework 7.0.x
- Spring Security 7.0.x