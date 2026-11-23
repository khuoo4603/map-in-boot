package com.mapinboot.demo.identity.security;

import com.mapinboot.demo.identity.model.DemoUser;
import com.mapinboot.demo.identity.repository.InMemoryUserRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Bearer JWT 인증 완료 여부와 사용자 상태 확인
 */
public class RefreshTokenFilter extends OncePerRequestFilter {

    public static final String USER_ATTRIBUTE = RefreshTokenFilter.class.getName() + ".user";

    private final InMemoryUserRepository userRepository;

    public RefreshTokenFilter(InMemoryUserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (!(authentication instanceof JwtAuthenticationToken jwtAuthentication)
                || !jwtAuthentication.isAuthenticated()) {
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
            return;
        }

        String userId = jwtAuthentication.getToken().getSubject();
        DemoUser user = userRepository.findByUserId(userId).orElse(null);
        if (user == null || !user.isEnabled()) {
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
            return;
        }

        request.setAttribute(USER_ATTRIBUTE, user);
        filterChain.doFilter(request, response);
    }
}
