package com.mapinboot.security.finding;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;

// Rule 대상 구조 기반 Finding 식별자 생성
final class FindingIdGenerator {

    String generate(String ruleId, List<String> structuralKeys) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            StringBuilder value = new StringBuilder("finding|").append(ruleId);
            structuralKeys.stream().sorted().forEach(key -> value.append('|').append(key.length()).append(':').append(key));
            return HexFormat.of().formatHex(digest.digest(value.toString().getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 알고리즘 미지원", exception);
        }
    }
}
