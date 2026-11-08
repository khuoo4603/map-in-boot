package com.mapinboot.starter.web.ui;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class EvidenceDisplayCodeResolverTest {

    @Test
    void classifiesFactAndMethodAnalysisEvidenceWithoutParsingText() {
        Evidence endpoint = evidence("e-endpoint", EvidenceSource.RUNTIME);
        Evidence servlet = evidence("e-servlet", EvidenceSource.RUNTIME);
        Evidence servletFilter = evidence("e-servlet-filter", EvidenceSource.RUNTIME);
        Evidence securityFilter = evidence("e-security-filter", EvidenceSource.RUNTIME);
        Evidence securityFilterCode = evidence("e-security-filter-code", EvidenceSource.CODE_PATTERN);
        Evidence chain = evidence("e-chain", EvidenceSource.RUNTIME);
        Evidence policy = evidence("e-policy", EvidenceSource.RUNTIME);
        Evidence methodDeclaration = evidence("e-method-declaration", EvidenceSource.DECLARATION);
        Evidence methodMetadata = evidence("e-method-metadata", EvidenceSource.SPRING_METADATA);
        Evidence methodRuntime = evidence("e-method-runtime", EvidenceSource.RUNTIME);
        Evidence methodCall = evidence("e-method-call", EvidenceSource.CODE_PATTERN);
        Evidence general = evidence("e-general", EvidenceSource.RUNTIME);

        CollectionReport collection = collectionReport(
                List.of(
                        new Fact("fact-endpoint", "ENDPOINT_MAPPING", "endpoint", Map.of(), List.of(endpoint.id())),
                        new Fact("fact-servlet", "SERVLET_REGISTRATION", "servlet", Map.of(), List.of(servlet.id())),
                        new Fact("fact-servlet-filter", "FILTER_REGISTRATION", "servlet-filter",
                                Map.of("registrationKind", "SERVLET"), List.of(servletFilter.id())),
                        new Fact("fact-security-filter", "FILTER_REGISTRATION", "security-filter",
                                Map.of("registrationKind", "SECURITY"), List.of(securityFilter.id(), securityFilterCode.id())),
                        new Fact("fact-chain", "SECURITY_CHAIN", "chain", Map.of(), List.of(chain.id())),
                        new Fact("fact-policy", "URL_AUTHORIZATION", "policy",
                                Map.of("policySource", "URL"), List.of(policy.id())),
                        new Fact("fact-method", "METHOD_AUTHORIZATION", "method",
                                Map.of("policySource", "METHOD"),
                                List.of(methodDeclaration.id(), methodMetadata.id(), methodRuntime.id()))),
                List.of(endpoint, servlet, servletFilter, securityFilter, securityFilterCode, chain, policy,
                        methodDeclaration, methodMetadata, methodRuntime),
                AnalysisStatus.READY);
        Relation methodRelation = new Relation(
                "relation-method", "endpoint", "method", EdgeType.SECURED_BY,
                Map.of("policySource", "METHOD"), Confidence.LIKELY,
                List.of(endpoint.id(), methodDeclaration.id(), methodCall.id()));
        AnalysisReport analysis = new AnalysisReport(
                collection, List.of(methodRelation), List.of(methodCall, general),
                Map.of("analyzer", AnalysisStatus.READY), List.of());

        Map<String, String> codes = new EvidenceDisplayCodeResolver().resolve(collection, analysis);

        assertEquals("EP-MAPPING-001", codes.get(endpoint.id()));
        assertEquals("SV-SERVLET-001", codes.get(servlet.id()));
        assertEquals("SV-FILTER-001", codes.get(servletFilter.id()));
        assertEquals("SF-FILTER-001", codes.get(securityFilter.id()));
        assertEquals("SF-CODE-001", codes.get(securityFilterCode.id()));
        assertEquals("SC-CHAIN-001", codes.get(chain.id()));
        assertEquals("SC-AUTH-001", codes.get(policy.id()));
        assertEquals("MS-DECL-001", codes.get(methodDeclaration.id()));
        assertEquals("MS-META-001", codes.get(methodMetadata.id()));
        assertEquals("MS-RUNTIME-001", codes.get(methodRuntime.id()));
        assertEquals("MA-CALL-001", codes.get(methodCall.id()));
        assertEquals("EV-GENERAL-001", codes.get(general.id()));
    }

    @Test
    void usesGeneralClassificationForConflictingEvidenceLinks() {
        Evidence shared = evidence("e-shared", EvidenceSource.RUNTIME);
        CollectionReport collection = collectionReport(
                List.of(
                        new Fact("fact-endpoint", "ENDPOINT_MAPPING", "endpoint", Map.of(), List.of(shared.id())),
                        new Fact("fact-chain", "SECURITY_CHAIN", "chain", Map.of(), List.of(shared.id()))),
                List.of(shared), AnalysisStatus.READY);

        Map<String, String> codes = new EvidenceDisplayCodeResolver().resolve(collection, null);

        assertEquals("EV-GENERAL-001", codes.get(shared.id()));
    }

    @Test
    void rejectsConflictingEvidenceContentsInsteadOfUsingGeneralClassification() {
        Evidence first = evidence("e-conflict", EvidenceSource.RUNTIME);
        Evidence second = evidence("e-conflict", EvidenceSource.CODE_PATTERN);
        CollectionReport collection = collectionReport(List.of(), List.of(first), AnalysisStatus.READY);
        AnalysisReport analysis = new AnalysisReport(
                collection, List.of(), List.of(second), Map.of("analyzer", AnalysisStatus.READY), List.of());

        MapInBootException exception = assertThrows(MapInBootException.class,
                () -> new EvidenceDisplayCodeResolver().resolve(collection, analysis));

        assertEquals(ErrorCode.INVALID_CONFIG, exception.getErrorCode());
    }

    private Evidence evidence(String id, EvidenceSource source) {
        return new Evidence(id, source, "location text", "summary text");
    }

    private CollectionReport collectionReport(List<Fact> facts, List<Evidence> evidence, AnalysisStatus status) {
        return new CollectionReport(facts, evidence, Map.of("collector", status), List.of());
    }
}
