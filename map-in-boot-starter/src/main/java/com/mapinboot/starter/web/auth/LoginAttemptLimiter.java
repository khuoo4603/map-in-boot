package com.mapinboot.starter.web.auth;

import java.time.Duration;
import java.time.Instant;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

// SDK 비밀번호 로그인 원격 주소별 실패 제한
public final class LoginAttemptLimiter {
    private static final int MAX_FAILURES = 5;
    private static final int MAX_ADDRESSES = 10_000;
    private static final Duration WINDOW = Duration.ofMinutes(15);

    private final Map<String, AttemptState> states = new LinkedHashMap<>(16, 0.75f, true);

    public synchronized boolean isLimited(String remoteAddress) {
        Instant now = Instant.now();
        removeExpired(now);
        AttemptState state = states.get(key(remoteAddress));
        return state != null && state.failures >= MAX_FAILURES;
    }

    public synchronized void recordFailure(String remoteAddress) {
        Instant now = Instant.now();
        removeExpired(now);
        String key = key(remoteAddress);
        AttemptState current = states.get(key);
        int failures = current == null ? 0 : current.failures;
        if (current == null && states.size() >= MAX_ADDRESSES) {
            Iterator<String> oldest = states.keySet().iterator();
            if (oldest.hasNext()) {
                oldest.next();
                oldest.remove();
            }
        }
        states.put(key, new AttemptState(failures + 1, now));
    }

    public synchronized void reset(String remoteAddress) {
        states.remove(key(remoteAddress));
    }

    private void removeExpired(Instant now) {
        Iterator<AttemptState> attempts = states.values().iterator();
        while (attempts.hasNext()) {
            AttemptState state = attempts.next();
            if (!now.isBefore(state.lastFailure.plus(WINDOW))) {
                attempts.remove();
            }
        }
    }

    private String key(String remoteAddress) {
        return remoteAddress == null || remoteAddress.isBlank() ? "unknown" : remoteAddress;
    }

    private record AttemptState(int failures, Instant lastFailure) {
    }
}
