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
