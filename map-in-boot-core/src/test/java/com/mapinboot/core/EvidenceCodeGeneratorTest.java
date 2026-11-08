package com.mapinboot.core;

import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.EvidenceClassification;
import com.mapinboot.core.evidence.EvidenceCodeGenerator;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class EvidenceCodeGeneratorTest {

    @Test
    void generatesReadableCodeForSingleEvidence() {
        Evidence evidence = evidence("evidence-1");

        Map<String, String> codes = new EvidenceCodeGenerator().generate(
                List.of(evidence),
                List.of(new EvidenceClassification("evidence-1", "EP", "MAPPING")));

        assertEquals(Map.of("evidence-1", "EP-MAPPING-001"), codes);
    }

    @Test
    void numbersEvidenceBySortedOriginalIdWithinClassification() {
        Map<String, String> codes = new EvidenceCodeGenerator().generate(
                List.of(evidence("evidence-z"), evidence("evidence-a")),
                List.of(
                        new EvidenceClassification("evidence-z", "SC", "CHAIN"),
                        new EvidenceClassification("evidence-a", "SC", "CHAIN")));

        assertEquals("SC-CHAIN-001", codes.get("evidence-a"));
        assertEquals("SC-CHAIN-002", codes.get("evidence-z"));
    }

    @Test
    void numbersDifferentClassificationsIndependently() {
        Map<String, String> codes = new EvidenceCodeGenerator().generate(
                List.of(evidence("evidence-a"), evidence("evidence-b")),
                List.of(
                        new EvidenceClassification("evidence-a", "EP", "MAPPING"),
                        new EvidenceClassification("evidence-b", "SC", "CHAIN")));

        assertEquals("EP-MAPPING-001", codes.get("evidence-a"));
        assertEquals("SC-CHAIN-001", codes.get("evidence-b"));
    }

    @Test
    void producesTheSameCodesWhenInputOrderChanges() {
        Evidence first = evidence("evidence-a");
        Evidence second = evidence("evidence-b");
        List<EvidenceClassification> classifications = List.of(
                new EvidenceClassification("evidence-a", "EP", "MAPPING"),
                new EvidenceClassification("evidence-b", "EP", "MAPPING"));

        Map<String, String> firstResult = new EvidenceCodeGenerator().generate(
                List.of(first, second), classifications);
        Map<String, String> secondResult = new EvidenceCodeGenerator().generate(
                List.of(second, first), List.of(classifications.get(1), classifications.get(0)));

        assertEquals(firstResult, secondResult);
    }

    @Test
    void removesIdenticalDuplicateEvidenceAndClassification() {
        Evidence evidence = evidence("evidence-1");
        EvidenceClassification classification = new EvidenceClassification("evidence-1", "EP", "MAPPING");

        Map<String, String> codes = new EvidenceCodeGenerator().generate(
                List.of(evidence, evidence), List.of(classification, classification));

        assertEquals(Map.of("evidence-1", "EP-MAPPING-001"), codes);
    }

    @Test
    void rejectsConflictingEvidenceWithTheSameOriginalId() {
        Evidence first = evidence("evidence-1");
        Evidence second = new Evidence("evidence-1", EvidenceSource.CODE_PATTERN, "other", "other");

        MapInBootException exception = assertThrows(MapInBootException.class, () ->
                new EvidenceCodeGenerator().generate(List.of(first, second), List.of()));

        assertEquals(ErrorCode.INVALID_CONFIG, exception.getErrorCode());
    }

    @Test
    void rejectsConflictingClassificationsWithTheSameOriginalId() {
        MapInBootException exception = assertThrows(MapInBootException.class, () ->
                new EvidenceCodeGenerator().generate(
                        List.of(evidence("evidence-1")),
                        List.of(
                                new EvidenceClassification("evidence-1", "EP", "MAPPING"),
                                new EvidenceClassification("evidence-1", "SC", "CHAIN"))));

        assertEquals(ErrorCode.INVALID_CONFIG, exception.getErrorCode());
    }

    @Test
    void usesGeneralClassificationWhenClassificationIsMissing() {
        Map<String, String> codes = new EvidenceCodeGenerator().generate(
                List.of(evidence("evidence-1")), List.of());

        assertEquals("EV-GENERAL-001", codes.get("evidence-1"));
    }

    @Test
    void rejectsInvalidClassificationInputWithInvalidConfig() {
        MapInBootException exception = assertThrows(MapInBootException.class, () ->
                new EvidenceClassification("evidence-1", "", "CHAIN"));

        assertEquals(ErrorCode.INVALID_CONFIG, exception.getErrorCode());
    }

    @Test
    void rejectsInvalidEvidenceInputWithInvalidConfig() {
        MapInBootException exception = assertThrows(MapInBootException.class, () ->
                new EvidenceCodeGenerator().generate(
                        List.of(new Evidence(" ", EvidenceSource.RUNTIME, "location", "summary")),
                        List.of()));

        assertEquals(ErrorCode.INVALID_CONFIG, exception.getErrorCode());
    }

    @Test
    void doesNotTruncateNumbersAboveThreeDigits() {
        List<Evidence> evidence = IntStream.rangeClosed(1, 1000)
                .mapToObj(index -> evidence(String.format("evidence-%04d", index)))
                .toList();
        List<EvidenceClassification> classifications = evidence.stream()
                .map(value -> new EvidenceClassification(value.id(), "EP", "MAPPING"))
                .toList();

        Map<String, String> codes = new EvidenceCodeGenerator().generate(evidence, classifications);

        assertEquals("EP-MAPPING-1000", codes.get("evidence-1000"));
    }

    @Test
    void returnsAnUnmodifiableResultAndPreservesOriginalEvidenceId() {
        Evidence evidence = evidence("evidence-1");
        Map<String, String> codes = new EvidenceCodeGenerator().generate(
                new ArrayList<>(List.of(evidence)),
                new ArrayList<>(List.of(new EvidenceClassification("evidence-1", "EP", "MAPPING"))));

        assertThrows(UnsupportedOperationException.class, () -> codes.put("other", "EP-MAPPING-002"));
        assertEquals("evidence-1", evidence.id());
    }

    @Test
    void rejectsNullClassificationCollectionAndUnknownClassificationId() {
        MapInBootException nullCollectionException = assertThrows(MapInBootException.class, () ->
                new EvidenceCodeGenerator().generate(List.of(evidence("evidence-1")), null));
        MapInBootException unknownIdException = assertThrows(MapInBootException.class, () ->
                new EvidenceCodeGenerator().generate(
                        List.of(evidence("evidence-1")),
                        List.of(new EvidenceClassification("unknown", "EP", "MAPPING"))));

        assertEquals(ErrorCode.INVALID_CONFIG, nullCollectionException.getErrorCode());
        assertEquals(ErrorCode.INVALID_CONFIG, unknownIdException.getErrorCode());
    }

    private Evidence evidence(String id) {
        return new Evidence(id, EvidenceSource.RUNTIME, "location", "summary");
    }
}
