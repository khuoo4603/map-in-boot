package com.mapinboot.demo.main.client;

import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

/**
 * Account 내부 계좌 요약 HTTP Client
 */
@Component
public class AccountInternalClient {

    private final RestClient restClient;
    private final String serviceUsername;
    private final String serviceSecret;

    public AccountInternalClient(
            @Value("${app.services.account-url}") String accountUrl,
            @Value("${app.services.account-service-username:}") String serviceUsername,
            @Value("${app.services.account-service-secret:}") String serviceSecret) {
        this.restClient = RestClient.builder()
                .baseUrl(accountUrl)
                .build();
        this.serviceUsername = serviceUsername;
        this.serviceSecret = serviceSecret;
    }

    /**
     * 서비스 인증과 최종 사용자 식별정보를 포함한 내부 계좌 요약 호출
     */
    public ResponseEntity<Map<String, Object>> getSummary(String path, String userId) {
        if (serviceUsername.isBlank() || serviceSecret.isBlank() || userId == null || userId.isBlank()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }

        try {
            return restClient.get()
                    .uri(path)
                    .headers(headers -> {
                        headers.setBasicAuth(serviceUsername, serviceSecret);
                        headers.set("X-Authenticated-User", userId);
                    })
                    .retrieve()
                    .toEntity(new ParameterizedTypeReference<>() { });
        } catch (RestClientResponseException exception) {
            if (exception.getStatusCode().value() == HttpStatus.UNAUTHORIZED.value()) {
                return ResponseEntity.status(HttpStatus.BAD_GATEWAY).build();
            }
            return ResponseEntity.status(exception.getStatusCode()).build();
        } catch (RestClientException exception) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
    }

    /**
     * 최종 사용자 식별정보 없이 내부 레거시 계좌 요약 호출
     */
    public ResponseEntity<Map<String, Object>> getLegacySummary(String path) {
        if (serviceUsername.isBlank() || serviceSecret.isBlank()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }

        try {
            return restClient.get()
                    .uri(path)
                    .headers(headers -> headers.setBasicAuth(serviceUsername, serviceSecret))
                    .retrieve()
                    .toEntity(new ParameterizedTypeReference<>() { });
        } catch (RestClientResponseException exception) {
            if (exception.getStatusCode().value() == HttpStatus.UNAUTHORIZED.value()) {
                return ResponseEntity.status(HttpStatus.BAD_GATEWAY).build();
            }
            return ResponseEntity.status(exception.getStatusCode()).build();
        } catch (RestClientException exception) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
    }
}
