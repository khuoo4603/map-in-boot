package com.mapinboot.core;

import com.mapinboot.core.analysis.AbstractAnalysisAdapter;
import com.mapinboot.core.analysis.AnalysisProvider;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.analysis.model.AnalysisResult;
import com.mapinboot.core.collection.AbstractCollectorAdapter;
import com.mapinboot.core.collection.CollectionProvider;
import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.collection.model.CollectionResult;
import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProviderTest {

    @Test
    void collectionProviderOrdersDependenciesAndPreservesPartialResults() {
        List<String> calls = new ArrayList<>();
        Evidence evidenceA = new Evidence("evidence-a", EvidenceSource.RUNTIME, "A", "근거 A");
        Evidence evidenceB = new Evidence("evidence-b", EvidenceSource.RUNTIME, "B", "근거 B");
        Evidence conflictingEvidence = new Evidence("evidence-a", EvidenceSource.CODE_PATTERN, "B", "충돌 근거");
        Fact factA = new Fact("fact-a", "ENDPOINT_MAPPING", "A", Map.of(), List.of("evidence-a"));
        Fact factB = new Fact("fact-b", "SECURITY_CHAIN", "B", Map.of(), List.of("evidence-b"));
        Fact conflictingFact = new Fact("fact-a", "ENDPOINT_MAPPING", "B", Map.of(), List.of("evidence-a"));
        AdapterDiagnostic diagnostic = new AdapterDiagnostic("B", ErrorCode.ADAPTER_FAILED, "부분 수집");
        TestCollector dependent = new TestCollector(
                "B", true, Set.of("A"),
                new CollectionResult(
                        "B", List.of(factA, conflictingFact, factB),
                        List.of(evidenceA, conflictingEvidence, evidenceB), AnalysisStatus.READY, List.of(diagnostic)),
                null, calls);
        TestCollector prerequisite = new TestCollector(
                "A", true, Set.of(),
                new CollectionResult("A", List.of(factA), List.of(evidenceA), AnalysisStatus.READY, List.of()),
                null, calls);

        CollectionReport report = new CollectionProvider().execute(
                new CollectionContext(null, "service", "instance"), List.of(dependent, prerequisite));

        assertEquals(List.of("A", "B"), calls);
        assertEquals(List.of(factA, factB), report.facts());
        assertEquals(List.of(evidenceA, evidenceB), report.evidence());
        assertEquals(AnalysisStatus.READY, report.statusByAdapter().get("A"));
        assertEquals(AnalysisStatus.PARTIAL, report.statusByAdapter().get("B"));
        assertTrue(report.diagnostics().contains(diagnostic));
        assertTrue(report.diagnostics().stream().anyMatch(value -> value.adapterId().equals("B")
                && value.errorCode() == ErrorCode.INVALID_STATE
                && value.summary().contains("fact-a")));
    }

    @Test
    void collectionProviderIsolatesFailureAndInvalidDependencies() {
        List<String> calls = new ArrayList<>();
        Fact fact = new Fact("fact", "ENDPOINT_MAPPING", "endpoint", Map.of(), List.of());
        TestCollector successful = new TestCollector(
                "good", true, Set.of(),
                new CollectionResult("good", List.of(fact), List.of(), AnalysisStatus.READY, List.of()), null, calls);
        TestCollector failed = new TestCollector("failed", true, Set.of(), null, new IllegalStateException(), calls);
        TestCollector disabled = new TestCollector("disabled", false, Set.of(), null, null, calls);
        TestCollector afterDisabled = new TestCollector("after-disabled", true, Set.of("disabled"), null, null, calls);
        TestCollector missing = new TestCollector("missing", true, Set.of("absent"), null, null, calls);
        TestCollector cycleA = new TestCollector("cycle-a", true, Set.of("cycle-b"), null, null, calls);
        TestCollector cycleB = new TestCollector("cycle-b", true, Set.of("cycle-a"), null, null, calls);
        TestCollector afterFailed = new TestCollector("after-failed", true, Set.of("failed"), null, null, calls);
        TestCollector invalidResult = new TestCollector(
                "invalid", true, Set.of(),
                new CollectionResult("other", List.of(), List.of(), AnalysisStatus.READY, List.of()), null, calls);
        TestCollector nullResult = new TestCollector("null", true, Set.of(), null, null, calls);

        CollectionReport report = new CollectionProvider().execute(
                new CollectionContext(null, "service", "instance"),
                List.of(successful, failed, disabled, afterDisabled, missing, cycleA, cycleB, afterFailed, invalidResult, nullResult));

        assertEquals(List.of(fact), report.facts());
        assertEquals(AnalysisStatus.READY, report.statusByAdapter().get("good"));
        assertEquals(AnalysisStatus.UNKNOWN, report.statusByAdapter().get("failed"));
        assertEquals(AnalysisStatus.UNKNOWN, report.statusByAdapter().get("after-disabled"));
        assertEquals(AnalysisStatus.UNKNOWN, report.statusByAdapter().get("missing"));
        assertEquals(AnalysisStatus.UNKNOWN, report.statusByAdapter().get("cycle-a"));
        assertEquals(AnalysisStatus.UNKNOWN, report.statusByAdapter().get("cycle-b"));
        assertEquals(AnalysisStatus.UNKNOWN, report.statusByAdapter().get("after-failed"));
        assertEquals(AnalysisStatus.UNKNOWN, report.statusByAdapter().get("invalid"));
        assertEquals(AnalysisStatus.UNKNOWN, report.statusByAdapter().get("null"));
        assertFalse(report.statusByAdapter().containsKey("disabled"));
        assertFalse(calls.contains("disabled"));
        assertFalse(calls.contains("after-disabled"));
        assertFalse(calls.contains("after-failed"));
        assertFalse(calls.contains("cycle-a"));
        assertFalse(calls.contains("cycle-b"));
        assertTrue(report.diagnostics().stream().anyMatch(value -> value.errorCode() == ErrorCode.ADAPTER_FAILED));
        assertTrue(report.diagnostics().stream().anyMatch(value -> value.errorCode() == ErrorCode.INVALID_CONFIG));
        assertTrue(report.diagnostics().stream().filter(value -> value.adapterId().equals("failed"))
                .allMatch(value -> value.summary().contains("failed")));
    }

    @Test
    void collectionProviderRejectsDuplicateAdapterIds() {
        TestCollector first = new TestCollector("duplicate", true, Set.of(), null, null, new ArrayList<>());
        TestCollector second = new TestCollector("duplicate", true, Set.of(), null, null, new ArrayList<>());

        MapInBootException exception = assertThrows(MapInBootException.class, () -> new CollectionProvider().execute(
                new CollectionContext(null, "service", "instance"), List.of(first, second)));

        assertEquals(ErrorCode.DUPLICATE_ADAPTER, exception.getErrorCode());
    }

    @Test
    void analysisProviderMergesCollectionAndAnalysisEvidence() {
        Fact fact = new Fact("fact", "ENDPOINT_MAPPING", "endpoint", Map.of(), List.of("collection-evidence"));
        Evidence collectionEvidence = new Evidence("collection-evidence", EvidenceSource.RUNTIME, "endpoint", "수집 근거");
        Evidence analysisEvidence = new Evidence("analysis-evidence", EvidenceSource.CODE_PATTERN, "handler", "분석 근거");
        Evidence conflictingEvidence = new Evidence("collection-evidence", EvidenceSource.CODE_PATTERN, "handler", "충돌 근거");
        Relation relationA = new Relation(
                "relation-a", "endpoint", "chain", EdgeType.MATCHED_BY, Map.of(), Confidence.CONFIRMED, List.of());
        Relation relationB = new Relation(
                "relation-b", "endpoint", "handler", EdgeType.FLOWS_TO, Map.of(), Confidence.LIKELY, List.of());
        Relation conflictingRelation = new Relation(
                "relation-a", "endpoint", "other-chain", EdgeType.MATCHED_BY, Map.of(), Confidence.CONFIRMED, List.of());
        CollectionReport collectionReport = new CollectionReport(
                List.of(fact), List.of(collectionEvidence), Map.of("collector", AnalysisStatus.READY), List.of());
        List<String> calls = new ArrayList<>();
        TestAnalysis first = new TestAnalysis(
                "first", true, Set.of("ENDPOINT_MAPPING"),
                new AnalysisResult(
                        "first", List.of(relationA), List.of(collectionEvidence, analysisEvidence), AnalysisStatus.READY, List.of()),
                null, calls);
        TestAnalysis second = new TestAnalysis(
                "second", true, Set.of("ENDPOINT_MAPPING"),
                new AnalysisResult(
                        "second", List.of(relationA, conflictingRelation, relationB),
                        List.of(conflictingEvidence), AnalysisStatus.READY, List.of()),
                null, calls);

        AnalysisReport report = new AnalysisProvider().execute(
                new AnalysisContext(collectionReport, "service"), List.of(first, second));

        assertEquals(List.of("first", "second"), calls);
        assertEquals(collectionReport, report.collectionReport());
        assertEquals(List.of(relationA, relationB), report.relations());
        assertEquals(List.of(collectionEvidence, analysisEvidence), report.evidence());
        assertEquals(AnalysisStatus.READY, report.statusByAdapter().get("first"));
        assertEquals(AnalysisStatus.PARTIAL, report.statusByAdapter().get("second"));
        assertTrue(report.diagnostics().stream().anyMatch(value -> value.adapterId().equals("second")
                && value.errorCode() == ErrorCode.INVALID_STATE
                && value.summary().contains("relation-a")));
    }

    @Test
    void analysisProviderIsolatesFailuresAndInsufficientFacts() {
        CollectionReport collectionReport = new CollectionReport(
                List.of(), List.of(), Map.of("collector", AnalysisStatus.PARTIAL), List.of());
        Relation relation = new Relation(
                "relation", "source", "target", EdgeType.FLOWS_TO, Map.of(), Confidence.LIKELY, List.of());
        List<String> calls = new ArrayList<>();
        TestAnalysis successful = new TestAnalysis(
                "good", true, Set.of(),
                new AnalysisResult("good", List.of(relation), List.of(), AnalysisStatus.READY, List.of()), null, calls);
        TestAnalysis disabled = new TestAnalysis("disabled", false, Set.of(), null, null, calls);
        TestAnalysis missing = new TestAnalysis("missing", true, Set.of("ENDPOINT_MAPPING"), null, null, calls);
        TestAnalysis failed = new TestAnalysis("failed", true, Set.of(), null, new IllegalStateException(), calls);
        TestAnalysis invalidResult = new TestAnalysis(
                "invalid", true, Set.of(),
                new AnalysisResult("other", List.of(), List.of(), AnalysisStatus.READY, List.of()), null, calls);
        TestAnalysis nullResult = new TestAnalysis("null", true, Set.of(), null, null, calls);

        AnalysisReport report = new AnalysisProvider().execute(
                new AnalysisContext(collectionReport, "service"), List.of(successful, disabled, missing, failed, invalidResult, nullResult));

        assertEquals(List.of(relation), report.relations());
        assertEquals(AnalysisStatus.READY, report.statusByAdapter().get("good"));
        assertFalse(report.statusByAdapter().containsKey("disabled"));
        assertEquals(AnalysisStatus.PARTIAL, report.statusByAdapter().get("missing"));
        assertEquals(AnalysisStatus.UNKNOWN, report.statusByAdapter().get("failed"));
        assertEquals(AnalysisStatus.UNKNOWN, report.statusByAdapter().get("invalid"));
        assertEquals(AnalysisStatus.UNKNOWN, report.statusByAdapter().get("null"));
        assertFalse(calls.contains("missing"));
        assertFalse(calls.contains("disabled"));
        assertTrue(report.diagnostics().stream().anyMatch(value -> value.adapterId().equals("missing")
                && value.errorCode() == ErrorCode.INVALID_STATE));
        assertTrue(report.diagnostics().stream().anyMatch(value -> value.adapterId().equals("failed")
                && value.errorCode() == ErrorCode.ADAPTER_FAILED));
        assertTrue(report.diagnostics().stream().filter(value -> value.adapterId().equals("failed"))
                .allMatch(value -> value.summary().contains("failed")));
    }

    @Test
    void analysisProviderDoesNotTreatPartialCollectionAsCompleteInput() {
        Fact fact = new Fact("fact", "ENDPOINT_MAPPING", "endpoint", Map.of(), List.of());
        CollectionReport collectionReport = new CollectionReport(
                List.of(fact), List.of(), Map.of("collector", AnalysisStatus.PARTIAL), List.of());
        List<String> calls = new ArrayList<>();
        TestAnalysis analysis = new TestAnalysis(
                "analysis", true, Set.of("ENDPOINT_MAPPING"), null, null, calls);

        AnalysisReport report = new AnalysisProvider().execute(
                new AnalysisContext(collectionReport, "service"), List.of(analysis));

        assertEquals(AnalysisStatus.PARTIAL, report.statusByAdapter().get("analysis"));
        assertFalse(calls.contains("analysis"));
        assertTrue(report.diagnostics().stream().anyMatch(value -> value.adapterId().equals("analysis")
                && value.errorCode() == ErrorCode.INVALID_STATE));
    }

    @Test
    void analysisProviderRejectsDuplicateAdapterIds() {
        CollectionReport collectionReport = new CollectionReport(List.of(), List.of(), Map.of(), List.of());
        TestAnalysis first = new TestAnalysis("duplicate", true, Set.of(), null, null, new ArrayList<>());
        TestAnalysis second = new TestAnalysis("duplicate", true, Set.of(), null, null, new ArrayList<>());

        MapInBootException exception = assertThrows(MapInBootException.class, () -> new AnalysisProvider().execute(
                new AnalysisContext(collectionReport, "service"), List.of(first, second)));

        assertEquals(ErrorCode.DUPLICATE_ADAPTER, exception.getErrorCode());
    }

    private static final class TestCollector extends AbstractCollectorAdapter {
        private final boolean active;
        private final Set<String> dependencies;
        private final CollectionResult result;
        private final RuntimeException failure;
        private final List<String> calls;

        private TestCollector(
                String id,
                boolean active,
                Set<String> dependencies,
                CollectionResult result,
                RuntimeException failure,
                List<String> calls
        ) {
            super(id, id, Set.of());
            this.active = active;
            this.dependencies = dependencies;
            this.result = result;
            this.failure = failure;
            this.calls = calls;
        }

        @Override
        public boolean enabled() {
            return active;
        }

        @Override
        public Set<String> dependsOn() {
            return dependencies;
        }

        @Override
        public CollectionResult collect(CollectionContext context) {
            calls.add(id());
            if (failure != null) {
                throw failure;
            }
            return result;
        }
    }

    private static final class TestAnalysis extends AbstractAnalysisAdapter {
        private final boolean active;
        private final Set<String> requiredFacts;
        private final AnalysisResult result;
        private final RuntimeException failure;
        private final List<String> calls;

        private TestAnalysis(
                String id,
                boolean active,
                Set<String> requiredFacts,
                AnalysisResult result,
                RuntimeException failure,
                List<String> calls
        ) {
            super(id, id, Set.of());
            this.active = active;
            this.requiredFacts = requiredFacts;
            this.result = result;
            this.failure = failure;
            this.calls = calls;
        }

        @Override
        public boolean enabled() {
            return active;
        }

        @Override
        public Set<String> requiredFactTypes() {
            return requiredFacts;
        }

        @Override
        public AnalysisResult analyze(AnalysisContext context) {
            calls.add(id());
            if (failure != null) {
                throw failure;
            }
            return result;
        }
    }
}
