package com.mapinboot.demo.identity.security;

import com.mapinboot.demo.identity.model.DemoUser;
import com.mapinboot.demo.identity.repository.InMemoryUserRepository;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

/**
 * 사용자 세부정보 조회 및 Spring Security UserDetails 변환 서비스
 */
@Service
public class DemoUserDetailsService implements UserDetailsService {

    private final InMemoryUserRepository userRepository;

    public DemoUserDetailsService(InMemoryUserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        DemoUser user = userRepository.findByUsername(username)
                .orElseThrow(() -> new UsernameNotFoundException("사용자를 찾을 수 없음: " + username));

        if (!user.isEnabled()) {
            throw new UsernameNotFoundException("비활성화된 사용자: " + username);
        }

        List<SimpleGrantedAuthority> authorities = user.getRoles().stream()
                .map(SimpleGrantedAuthority::new)
                .collect(Collectors.toList());

        return new User(
                user.getUsername(),
                user.getPasswordHash(),
                user.isEnabled(),
                true,
                true,
                true,
                authorities
        );
    }
}

