package com.mapinboot.security.finding;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.finding.Finding;
import com.mapinboot.core.finding.FindingEvaluator;
import java.util.List;
import java.util.stream.Stream;

// 현재 지원 Rule의 단일 FindingEvaluator 진입점
public class SecurityRuleEngine implements FindingEvaluator {
    private final ChainMissingFindingRule chainMissingRule = new ChainMissingFindingRule();
    private final ChainOrderFindingRule chainOrderRule = new ChainOrderFindingRule();

    @Override
    public List<Finding> evaluate(AnalysisReport report) {
        return Stream.concat(chainMissingRule.evaluate(report).stream(), chainOrderRule.evaluate(report).stream())
                .sorted(java.util.Comparator.comparing(Finding::id))
                .toList();
    }
}
