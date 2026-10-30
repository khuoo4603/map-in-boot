package com.mapinboot.core.graph;

import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;
import com.mapinboot.core.graph.model.GraphEdge;
import com.mapinboot.core.graph.model.GraphNode;
import com.mapinboot.core.graph.model.SecurityGraph;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class GraphFingerprintGenerator {

    // UI 표현을 제외한 보안 구조 지문 생성
    public String generate(SecurityGraph graph) {
        validate(graph);
        List<String> parts = new ArrayList<>(List.of("graph"));
        // 입력 나열 순서와 무관한 Node 직렬화
        graph.nodes().stream()
                .sorted(java.util.Comparator.comparing(GraphNode::id))
                .forEach(node -> {
                    parts.add("node");
                    parts.add(node.id());
                    parts.add(node.type().name());
                    parts.add(node.serviceId());
                    appendAttributes(parts, node.attributes());
                });
        // 입력 나열 순서와 무관한 Edge 직렬화
        graph.edges().stream()
                .sorted(java.util.Comparator.comparing(GraphEdge::id))
                .forEach(edge -> {
                    parts.add("edge");
                    parts.add(edge.id());
                    parts.add(edge.sourceId());
                    parts.add(edge.targetId());
                    parts.add(edge.type().name());
                    appendAttributes(parts, edge.attributes());
                });
        return hash(parts);
    }

    private void validate(SecurityGraph graph) {
        if (graph == null) {
            invalidGraph("Graph 누락");
        }
        Set<String> nodeIds = new HashSet<>();
        for (GraphNode node : graph.nodes()) {
            if (node == null || isBlank(node.id()) || node.type() == null || isBlank(node.serviceId()) || !nodeIds.add(node.id())) {
                invalidGraph("Node 구조 오류");
            }
        }
        Set<String> edgeIds = new HashSet<>();
        for (GraphEdge edge : graph.edges()) {
            if (edge == null || isBlank(edge.id()) || edge.type() == null
                    || !nodeIds.contains(edge.sourceId()) || !nodeIds.contains(edge.targetId()) || !edgeIds.add(edge.id())) {
                invalidGraph("Edge 구조 오류");
            }
        }
    }

    private void appendAttributes(List<String> parts, Map<String, String> attributes) {
        attributes.entrySet().stream()
                .filter(entry -> isStructuralAttribute(entry.getKey()))
                .sorted(Map.Entry.comparingByKey())
                .forEach(entry -> {
                    parts.add(entry.getKey());
                    parts.add(entry.getValue());
                });
    }

    // 표시·배치·수집 시각 속성 제외
    private boolean isStructuralAttribute(String key) {
        String lowerKey = key.toLowerCase(java.util.Locale.ROOT);
        return !lowerKey.endsWith("label") && !lowerKey.startsWith("display") && !lowerKey.startsWith("ui")
                && !lowerKey.equals("collectedat") && !lowerKey.equals("capturedat") && !lowerKey.equals("timestamp");
    }

    private String hash(List<String> parts) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(serialize(parts).getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new MapInBootException(ErrorCode.HASH_FAILED, "SHA-256 계산 실패", exception);
        }
    }

    // 길이 구분 기반 Graph 직렬화
    private String serialize(List<String> parts) {
        StringBuilder value = new StringBuilder();
        for (String part : parts) {
            value.append(part.length()).append(':').append(part);
        }
        return value.toString();
    }

    private void invalidGraph(String message) {
        throw new MapInBootException(ErrorCode.INVALID_GRAPH, message);
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
