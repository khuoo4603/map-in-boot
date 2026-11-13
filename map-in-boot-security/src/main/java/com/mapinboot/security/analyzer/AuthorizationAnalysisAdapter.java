package com.mapinboot.security.analyzer;

import com.mapinboot.core.analysis.AbstractAnalysisAdapter;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisResult;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.common.type.NodeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import com.mapinboot.core.graph.StableIdGenerator;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

// 객체 인가 Fact와 실제 Handler·인증정보 관계 분석
public class AuthorizationAnalysisAdapter extends AbstractAnalysisAdapter {
    private static final String ENDPOINT_TYPE = "ENDPOINT_MAPPING";
    private static final String OBJECT_TYPE = "OBJECT_AUTHORIZATION";
    private static final String JWT_TYPE = "JWT_USAGE";
    private static final String PRINCIPAL_TYPE = "PRINCIPAL_USAGE";
    private static final String HEADER_TYPE = "HEADER_USAGE";

    private final StableIdGenerator idGenerator = new StableIdGenerator();

    public AuthorizationAnalysisAdapter() {
        super("security-authorization-analysis", "객체 인가 보호·인증정보 관계 분석",
                Set.of("SECURED_BY", "USES_FOR_AUTHORIZATION"));
    }

    @Override
    public AnalysisResult analyze(AnalysisContext context) {
        if (context == null || context.collectionReport() == null || isBlank(context.serviceId())) {
            return unknown("객체 인가 분석 입력 또는 서비스 식별자 부족");
        }

        CollectionReport report = context.collectionReport();
        Map<String, Evidence> evidenceById = evidenceById(report.evidence());
        List<Fact> endpoints = facts(report, ENDPOINT_TYPE);
        List<Fact> objects = facts(report, OBJECT_TYPE);
        List<AdapterDiagnostic> diagnostics = new ArrayList<>();
        Map<RelationKey, RelationData> relationData = new TreeMap<>(Comparator
                .comparing(RelationKey::sourceKey)
                .thenComparing(RelationKey::targetKey)
                .thenComparing(key -> key.type().name()));
        boolean partial = false;

        for (Fact object : objects) {
            if (!hasEvidence(object, evidenceById)) {
                partial = true;
                diagnostics.add(diagnostic("객체 인가 Fact Evidence 확인 불가: " + object.subjectKey()));
                continue;
            }
            String handler = object.attributes().get("handler");
            List<Fact> matchingEndpoints = endpoints.stream()
                    .filter(endpoint -> handler != null && handler.equals(endpoint.attributes().get("handler")))
                    .toList();
            if (matchingEndpoints.isEmpty()) {
                partial = true;
                diagnostics.add(diagnostic("객체 인가 Handler Endpoint 연결 불가: " + object.subjectKey()));
                continue;
            }

            for (Fact endpoint : matchingEndpoints) {
                if (!hasEvidence(endpoint, evidenceById)) {
                    partial = true;
                    diagnostics.add(diagnostic("Endpoint Evidence 확인 불가: " + endpoint.subjectKey()));
                    continue;
                }
                addRelation(relationData, handler, object.subjectKey(), EdgeType.SECURED_BY,
                        Map.of("securityKind", "AUTHORIZATION", "policySource", "OBJECT"),
                        Confidence.CONFIRMED, evidenceIds(endpoint, object));
            }

            Fact credential = matchingCredential(report, object);
            if (credential == null) {
                partial = true;
                diagnostics.add(diagnostic("객체 인가 입력 인증정보 Fact 연결 불가: " + object.subjectKey()));
                continue;
            }
            if (!hasEvidence(credential, evidenceById)) {
                partial = true;
                diagnostics.add(diagnostic("인증정보 Evidence 확인 불가: " + credential.subjectKey()));
                continue;
            }
            addRelation(relationData, credential.subjectKey(), object.subjectKey(),
                    EdgeType.USES_FOR_AUTHORIZATION,
                    Map.of("securityKind", "AUTHORIZATION", "policySource", "OBJECT"),
                    Confidence.CONFIRMED, evidenceIds(credential, object));
        }

        List<Relation> relations = relationData.values().stream()
                .map(data -> data.relation(context.serviceId(), idGenerator))
                .sorted(Comparator.comparing(Relation::id))
                .toList();
        return new AnalysisResult(id(), relations, List.of(),
                partial ? AnalysisStatus.PARTIAL : AnalysisStatus.READY, diagnostics);
    }

    @Override
    public Set<String> requiredFactTypes() {
        return Set.of();
    }

    private Fact matchingCredential(CollectionReport report, Fact object) {
        String source = object.attributes().get("credentialSource");
        String location = object.attributes().get("credentialCodeLocation");
        String owner = object.attributes().get("credentialApiOwner");
        String name = object.attributes().get("credentialApiName");
        String descriptor = object.attributes().get("credentialApiDescriptor");
        String headerName = object.attributes().get("headerName");
        return report.facts().stream()
                .filter(this::isCredentialFact)
                .filter(fact -> matchesSource(fact, source))
                .filter(fact -> location == null || matchesLocation(fact, location))
                .filter(fact -> owner == null || owner.equals(fact.attributes().get("apiOwner")))
                .filter(fact -> name == null || name.equals(fact.attributes().get("apiName")))
                .filter(fact -> descriptor == null || descriptor.equals(fact.attributes().get("apiDescriptor")))
                .filter(fact -> headerName == null || headerName.equals(fact.attributes().get("headerName")))
                .sorted(Comparator.comparing(Fact::subjectKey))
                .findFirst()
                .orElse(null);
    }

    private boolean matchesLocation(Fact fact, String location) {
        String factLocation = fact.attributes().get("codeLocation");
        if (location.equals(factLocation)) {
            return true;
        }
        return HEADER_TYPE.equals(fact.type()) && factLocation != null
                && factLocation.startsWith(location + "@parameter[");
    }

    private boolean isCredentialFact(Fact fact) {
        return fact != null && Set.of(JWT_TYPE, PRINCIPAL_TYPE, HEADER_TYPE).contains(fact.type());
    }

    private boolean matchesSource(Fact fact, String source) {
        return switch (source) {
            case "JWT_SUBJECT" -> JWT_TYPE.equals(fact.type());
            case "AUTHENTICATION_NAME" -> PRINCIPAL_TYPE.equals(fact.type())
                    && "AUTHENTICATION".equals(fact.attributes().get("sourceKind"));
            case "REQUEST_HEADER" -> HEADER_TYPE.equals(fact.type());
            default -> false;
        };
    }

    private List<Fact> facts(CollectionReport report, String type) {
        return report.facts().stream()
                .filter(fact -> fact != null && type.equals(fact.type()))
                .sorted(Comparator.comparing(Fact::subjectKey))
                .toList();
    }

    private Map<String, Evidence> evidenceById(List<Evidence> evidence) {
        Map<String, Evidence> result = new LinkedHashMap<>();
        for (Evidence item : evidence) {
            if (item != null && item.id() != null) {
                result.putIfAbsent(item.id(), item);
            }
        }
        return result;
    }

    private boolean hasEvidence(Fact fact, Map<String, Evidence> evidenceById) {
        return fact.evidenceIds().stream().allMatch(evidenceById::containsKey);
    }

    private List<String> evidenceIds(Fact first, Fact second) {
        return java.util.stream.Stream.concat(first.evidenceIds().stream(), second.evidenceIds().stream())
                .filter(id -> id != null && !id.isBlank())
                .collect(java.util.stream.Collectors.toCollection(TreeSet::new))
                .stream().toList();
    }

    private void addRelation(
            Map<RelationKey, RelationData> relationData,
            String sourceKey,
            String targetKey,
            EdgeType type,
            Map<String, String> attributes,
            Confidence confidence,
            List<String> evidenceIds
    ) {
        if (isBlank(sourceKey) || isBlank(targetKey) || evidenceIds.isEmpty()) {
            return;
        }
        RelationKey key = new RelationKey(sourceKey, targetKey, type, attributes.get("securityKind"),
                attributes.get("policySource"));
        relationData.computeIfAbsent(key, ignored -> new RelationData(
                        sourceKey, targetKey, type, attributes, confidence))
                .evidenceIds.addAll(evidenceIds);
    }

    private AdapterDiagnostic diagnostic(String summary) {
        return new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, summary);
    }

    private AnalysisResult unknown(String summary) {
        return new AnalysisResult(id(), List.of(), List.of(), AnalysisStatus.UNKNOWN,
                List.of(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, summary)));
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private record RelationKey(
            String sourceKey,
            String targetKey,
            EdgeType type,
            String securityKind,
            String policySource
    ) {
    }

    private static final class RelationData {
        private final String sourceKey;
        private final String targetKey;
        private final EdgeType type;
        private final Map<String, String> attributes;
        private final Confidence confidence;
        private final Set<String> evidenceIds = new TreeSet<>();

        private RelationData(
                String sourceKey,
                String targetKey,
                EdgeType type,
                Map<String, String> attributes,
                Confidence confidence
        ) {
            this.sourceKey = sourceKey;
            this.targetKey = targetKey;
            this.type = type;
            this.attributes = Map.copyOf(attributes);
            this.confidence = confidence;
        }

        private Relation relation(String serviceId, StableIdGenerator idGenerator) {
            NodeType sourceType = type == EdgeType.USES_FOR_AUTHORIZATION
                    ? NodeType.SECURITY_DATA : NodeType.HANDLER;
            String sourceId = idGenerator.generate(serviceId, sourceType, sourceKey);
            String targetId = idGenerator.generate(serviceId, NodeType.AUTHORIZATION, targetKey);
            String id = idGenerator.generateEdge(sourceId, targetId, type, attributes);
            return new Relation(id, sourceKey, targetKey, type, attributes, confidence,
                    evidenceIds.stream().toList());
        }
    }
}
