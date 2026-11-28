package com.mapinboot.core.evidence;

import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

// Evidence 원본 ID 기반 결정적 표시 코드 생성
public class EvidenceCodeGenerator {

    // 명시적 분류와 원본 ID 정렬 기반 표시 코드 생성
    public Map<String, String> generate(
            Collection<Evidence> evidence,
            Collection<EvidenceClassification> classifications
    ) {
        if (evidence == null || classifications == null) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, "Evidence 표시 코드 입력이 올바르지 않습니다.");
        }

        Map<String, Evidence> evidenceById = collectEvidence(evidence);
        Map<String, EvidenceClassification> classificationById = collectClassifications(classifications, evidenceById);
        Map<String, List<String>> evidenceIdsByClassification = groupEvidenceIds(evidenceById, classificationById);
        Map<String, String> result = new LinkedHashMap<>();

        for (Map.Entry<String, List<String>> entry : evidenceIdsByClassification.entrySet()) {
            int sequence = 1;
            for (String evidenceId : entry.getValue()) {
                result.put(evidenceId, entry.getKey() + "-" + formatSequence(sequence));
                sequence++;
            }
        }
        return Collections.unmodifiableMap(result);
    }

    // 원본 ID 중복 제거 및 상이한 Evidence 내용 충돌 검증
    private Map<String, Evidence> collectEvidence(Collection<Evidence> evidence) {
        Map<String, Evidence> evidenceById = new TreeMap<>();
        for (Evidence value : evidence) {
            if (value == null || value.id() == null || value.id().isBlank()) {
                throw new MapInBootException(ErrorCode.INVALID_CONFIG, "Evidence 입력이 올바르지 않습니다.");
            }
            Evidence previous = evidenceById.putIfAbsent(value.id(), value);
            if (previous != null && !previous.equals(value)) {
                throw new MapInBootException(ErrorCode.INVALID_CONFIG, "동일 Evidence ID의 내용이 충돌합니다: " + value.id());
            }
        }
        return evidenceById;
    }

    // 분류 중복 제거 및 동일 ID 분류 충돌 검증
    private Map<String, EvidenceClassification> collectClassifications(
            Collection<EvidenceClassification> classifications,
            Map<String, Evidence> evidenceById
    ) {
        Map<String, EvidenceClassification> classificationById = new TreeMap<>();
        for (EvidenceClassification value : classifications) {
            if (value == null || !evidenceById.containsKey(value.evidenceId())) {
                throw new MapInBootException(ErrorCode.INVALID_CONFIG, "Evidence 분류 입력이 올바르지 않습니다.");
            }
            EvidenceClassification previous = classificationById.putIfAbsent(value.evidenceId(), value);
            if (previous != null && !previous.equals(value)) {
                throw new MapInBootException(ErrorCode.INVALID_CONFIG, "동일 Evidence ID의 분류가 충돌합니다: " + value.evidenceId());
            }
        }
        return classificationById;
    }

    // 누락 분류의 일반 처리 및 분류별 Evidence ID 정렬
    private Map<String, List<String>> groupEvidenceIds(
            Map<String, Evidence> evidenceById,
            Map<String, EvidenceClassification> classificationById
    ) {
        Map<String, List<String>> grouped = new TreeMap<>();
        for (String evidenceId : evidenceById.keySet()) {
            EvidenceClassification classification = classificationById.getOrDefault(
                    evidenceId, EvidenceClassification.general(evidenceId));
            String classificationCode = classification.areaCode() + "-" + classification.targetCode();
            grouped.computeIfAbsent(classificationCode, ignored -> new ArrayList<>()).add(evidenceId);
        }
        return grouped;
    }

    private String formatSequence(int sequence) {
        return String.format(Locale.ROOT, "%03d", sequence);
    }
}
