package com.mapinboot.security.externalfixture;

import com.mapinboot.core.annotation.RequiresObjectAuthorization;
import java.util.Optional;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

public final class ExternalAuthorizationFixtures {

    private ExternalAuthorizationFixtures() {
    }

    public record Resource(String ownerId) {

        public String getOwnerId() {
            return ownerId;
        }
    }

    @RestController
    public static class AuthorizedHandler {
        private final ResourceRepository repository = new ResourceRepository();

        @GetMapping("/external/authorized")
        @RequiresObjectAuthorization(kind = "OWNER", resourceType = Resource.class,
                principalSource = "JWT_SUBJECT")
        public ResponseEntity<Resource> authorize(String id, Jwt jwt) {
            Resource resource = repository.findById(id).orElse(null);
            if (!resource.getOwnerId().equals(jwt.getSubject())) {
                throw new AccessDeniedException("denied");
            }
            return ResponseEntity.ok(resource);
        }
    }

    public static final class ResourceRepository {

        Optional<Resource> findById(String id) {
            return Optional.of(new Resource("owner"));
        }
    }

    @RestController
    public static class OrdinaryHandler {

        @GetMapping("/external/ordinary")
        public String handle() {
            return "ok";
        }
    }
}
