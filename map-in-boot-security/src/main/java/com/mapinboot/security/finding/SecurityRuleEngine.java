package com.mapinboot.security.finding;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.FindingEvaluationException;
import com.mapinboot.core.finding.Finding;
import com.mapinboot.core.finding.FindingEvaluation;
import com.mapinboot.core.finding.FindingEvaluator;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.function.Function;
import org.jeasy.rules.api.Facts;
import org.jeasy.rules.api.Rule;
import org.jeasy.rules.api.RuleListener;
import org.jeasy.rules.api.Rules;
import org.jeasy.rules.api.RulesEngineParameters;
import org.jeasy.rules.core.DefaultRulesEngine;

// 7개 Security Finding Rule의 단일 평가 진입점
public class SecurityRuleEngine implements FindingEvaluator {
    private static final String REPORT_FACT = "analysisReport";
    private static final String FINDINGS_FACT = "findings";
    private static final String DIAGNOSTICS_FACT = "diagnostics";

    private final DefaultRulesEngine rulesEngine;
    private final Rules rules;

    public SecurityRuleEngine() {
        ChainMissingFindingRule chainMissingRule = new ChainMissingFindingRule();
        ChainOrderFindingRule chainOrderRule = new ChainOrderFindingRule();
        PublicEndpointFindingRule publicEndpointRule = new PublicEndpointFindingRule();
        MethodMismatchFindingRule methodMismatchRule = new MethodMismatchFindingRule();
        FilterOrderFindingRule filterOrderRule = new FilterOrderFindingRule();
        ObjectBindingFindingRule objectBindingRule = new ObjectBindingFindingRule();
        StateBypassFindingRule stateBypassRule = new StateBypassFindingRule();

        List<Rule> registeredRules = List.of(
                new FindingRule("CHAIN_MISSING", 1, chainMissingRule::evaluate),
                new FindingRule("CHAIN_ORDER", 2, chainOrderRule::evaluate),
                new FindingRule("PUBLIC_ENDPOINT", 3, publicEndpointRule::evaluate),
                new FindingRule("METHOD_MISMATCH", 4, methodMismatchRule::evaluate),
                new FindingRule("FILTER_ORDER", 5, filterOrderRule::evaluate),
                new FindingRule("OBJECT_BINDING", 6, objectBindingRule::evaluate),
                new FindingRule("STATE_BYPASS", 7, stateBypassRule::evaluate));
        this.rulesEngine = new DefaultRulesEngine(parameters());
        this.rules = rules(registeredRules);
        this.rulesEngine.registerRuleListener(new FindingRuleListener());
    }

    SecurityRuleEngine(List<Rule> registeredRules) {
        this.rulesEngine = new DefaultRulesEngine(parameters());
        this.rules = rules(registeredRules);
        this.rulesEngine.registerRuleListener(new FindingRuleListener());
    }

    @Override
    public List<Finding> evaluate(AnalysisReport report) {
        FindingEvaluation evaluation = evaluateWithDiagnostics(report);
        if (!evaluation.diagnostics().isEmpty()) {
            throw new FindingEvaluationException(evaluation.diagnostics());
        }
        return evaluation.findings();
    }

    @Override
    public FindingEvaluation evaluateWithDiagnostics(AnalysisReport report) {
        List<Finding> findings = new ArrayList<>();
        List<AdapterDiagnostic> diagnostics = new ArrayList<>();
        Facts facts = new Facts();
        facts.put(REPORT_FACT, report);
        facts.put(FINDINGS_FACT, findings);
        facts.put(DIAGNOSTICS_FACT, diagnostics);
        rulesEngine.fire(rules, facts);
        return new FindingEvaluation(sortedFindings(findings), List.copyOf(diagnostics));
    }

    private static Rules rules(List<Rule> registeredRules) {
        Rules rules = new Rules();
        registeredRules.forEach(rules::register);
        return rules;
    }

    private static RulesEngineParameters parameters() {
        return new RulesEngineParameters()
                .skipOnFirstAppliedRule(false)
                .skipOnFirstFailedRule(false)
                .skipOnFirstNonTriggeredRule(false);
    }

    private List<Finding> sortedFindings(List<Finding> findings) {
        if (findings.stream().anyMatch(finding -> finding == null || finding.id() == null || finding.id().isBlank())) {
            throw new IllegalStateException("Finding 식별자가 누락되었습니다.");
        }
        return findings.stream()
                .sorted(Comparator.comparing(Finding::id))
                .toList();
    }

    private record FindingRule(
            String name,
            int priority,
            Function<AnalysisReport, List<Finding>> evaluator
    ) implements Rule {
        @Override
        public String getName() {
            return name;
        }

        @Override
        public int getPriority() {
            return priority;
        }

        @Override
        public int compareTo(Rule other) {
            return Integer.compare(priority, other.getPriority());
        }

        @Override
        public boolean evaluate(Facts facts) {
            return true;
        }

        @Override
        public void execute(Facts facts) {
            AnalysisReport report = facts.get(REPORT_FACT);
            List<Finding> findings = facts.get(FINDINGS_FACT);
            List<Finding> evaluated = evaluator.apply(report);
            if (evaluated == null) {
                throw new IllegalStateException("Finding Rule 결과가 없습니다.");
            }
            findings.addAll(evaluated);
        }
    }

    private static final class FindingRuleListener implements RuleListener {
        @Override
        public void onEvaluationError(Rule rule, Facts facts, Exception exception) {
            addDiagnostic(rule, facts);
        }

        @Override
        public void onFailure(Rule rule, Facts facts, Exception exception) {
            addDiagnostic(rule, facts);
        }

        private void addDiagnostic(Rule rule, Facts facts) {
            List<AdapterDiagnostic> diagnostics = facts.get(DIAGNOSTICS_FACT);
            String adapterId = "finding-rule:" + rule.getName();
            if (diagnostics.stream().noneMatch(item -> adapterId.equals(item.adapterId()))) {
                diagnostics.add(new AdapterDiagnostic(adapterId, ErrorCode.ADAPTER_FAILED,
                        "Finding Rule 실행 실패"));
            }
        }
    }
}
