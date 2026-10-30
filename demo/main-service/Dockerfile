FROM eclipse-temurin:17-jre
WORKDIR /app
COPY build/libs/main-service-*.jar app.jar
EXPOSE 18080
ENTRYPOINT ["java", "-jar", "app.jar"]

