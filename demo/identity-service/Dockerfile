FROM eclipse-temurin:17-jre
WORKDIR /app
COPY build/libs/identity-service-*.jar app.jar
EXPOSE 18081
ENTRYPOINT ["java", "-jar", "app.jar"]

