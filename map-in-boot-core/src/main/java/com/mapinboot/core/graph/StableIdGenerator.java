package com.mapinboot.core.graph;

import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.common.type.NodeType;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

public class StableIdGenerator {

    // 서비스·NodeType·구조 키 기반 Node Stable ID 생성
    public String generate(String serviceId, NodeType nodeType, String structuralKey) {
        if (isBlank(serviceId) || nodeType == null || isBlank(structuralKey)) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, "Node 식별 입력 누락");
        }
        return hash(List.of("node", serviceId, nodeType.name(), structuralKey));
    }

    // 출발·도착 Node와 관계 정체성 기반 Edge Stable ID 생성
    public String generateEdge(
            String sourceNodeId,
            String targetNodeId,
            EdgeType edgeType,
            Map<String, String> identityAttributes
    ) {
        if (isBlank(sourceNodeId) || isBlank(targetNodeId) || edgeType == null || identityAttributes == null) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, "Edge 식별 입력 누락");
        }
        List<String> parts = new ArrayList<>(List.of("edge", sourceNodeId, targetNodeId, edgeType.name()));
        // Map 삽입 순서 제거를 위한 Key 정렬
        identityAttributes.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .forEach(entry -> {
                    if (isBlank(entry.getKey()) || entry.getValue() == null) {
                        throw new MapInBootException(ErrorCode.INVALID_CONFIG, "Edge 식별 속성 오류");
                    }
                    parts.add(entry.getKey());
                    parts.add(entry.getValue());
                });
        return hash(parts);
    }

    private String hash(List<String> parts) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(serialize(parts).getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new MapInBootException(ErrorCode.HASH_FAILED, "SHA-256 계산 실패", exception);
        }
    }

    // 단순 문자열 결합 충돌 방지용 길이 구분 직렬화
    private String serialize(List<String> parts) {
        StringBuilder value = new StringBuilder();
        for (String part : parts) {
            value.append(part.length()).append(':').append(part);
        }
        return value.toString();
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
