FROM eclipse-temurin:17-jre
WORKDIR /app
COPY build/libs/account-service-*.jar app.jar
EXPOSE 18082
ENTRYPOINT ["java", "-jar", "app.jar"]

