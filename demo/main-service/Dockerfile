# Build Stage
FROM eclipse-temurin:17-jdk AS builder
WORKDIR /workspace
COPY gradlew gradlew
COPY gradle gradle
COPY build.gradle settings.gradle ./
COPY map-in-boot-core map-in-boot-core
COPY map-in-boot-security map-in-boot-security
COPY map-in-boot-starter map-in-boot-starter
COPY demo demo
RUN sh ./gradlew :demo:main-service:bootJar -x test --no-daemon

# Runtime Stage
FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=builder /workspace/demo/main-service/build/libs/main-service-*.jar app.jar
EXPOSE 18080
ENTRYPOINT ["java", "-jar", "app.jar"]
