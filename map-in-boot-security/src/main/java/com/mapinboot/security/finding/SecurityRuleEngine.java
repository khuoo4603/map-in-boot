package com.mapinboot.security.finding;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.FindingEvaluationException;
import com.mapinboot.core.common.type.NodeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.finding.Finding;
import com.mapinboot.core.finding.FindingEvaluation;
import com.mapinboot.core.finding.FindingEvaluator;
import com.mapinboot.core.graph.model.GraphNode;
import com.mapinboot.core.graph.model.SecurityGraph;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.Function;
import java.util.stream.Collectors;
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
        return evaluateWithDiagnostics(report, null);
    }

    @Override
    public FindingEvaluation evaluateWithDiagnostics(AnalysisReport report, SecurityGraph graph) {
        FindingEvaluation evaluation = evaluateWithoutGraph(report);
        if (graph == null || !evaluation.diagnostics().isEmpty() || evaluation.findings().isEmpty()) {
            return evaluation;
        }
        return new FindingEvaluation(linkGraphNodes(evaluation.findings(), report, graph), evaluation.diagnostics());
    }

    private FindingEvaluation evaluateWithoutGraph(AnalysisReport report) {
        List<Finding> findings = new ArrayList<>();
        List<AdapterDiagnostic> diagnostics = new ArrayList<>();
        Facts facts = new Facts();
        facts.put(REPORT_FACT, report);
        facts.put(FINDINGS_FACT, findings);
        facts.put(DIAGNOSTICS_FACT, diagnostics);
        rulesEngine.fire(rules, facts);
        try {
            return new FindingEvaluation(sortedFindings(findings), List.copyOf(diagnostics));
        } catch (RuntimeException exception) {
            diagnostics.add(new AdapterDiagnostic("finding-engine", ErrorCode.INVALID_STATE,
                    "Finding 식별 충돌"));
            return new FindingEvaluation(List.of(), List.copyOf(diagnostics));
        }
    }

    // 실제 Graph Node가 유일하게 대응되는 신규 Finding에만 참조 ID 연결
    private List<Finding> linkGraphNodes(List<Finding> findings, AnalysisReport report, SecurityGraph graph) {
        return findings.stream()
                .map(finding -> {
                    if ("OBJECT_BINDING".equals(finding.ruleId())) {
                        return withNodeIds(finding, matchingObjectNodeIds(finding, report, graph));
                    }
                    if ("STATE_BYPASS".equals(finding.ruleId())) {
                        return withNodeIds(finding, matchingStateNodeIds(finding, report, graph));
                    }
                    return finding;
                })
                .toList();
    }

    private List<String> matchingObjectNodeIds(Finding finding, AnalysisReport report, SecurityGraph graph) {
        Set<String> availableEvidence = evidenceIds(report);
        List<ObjectBindingFacts> candidates = objectBindingFacts(report, availableEvidence).stream()
                .filter(candidate -> finding.id().equals(new FindingIdGenerator().generate(
                        "OBJECT_BINDING", List.of(
                                candidate.requirement().subjectKey(), candidate.path().subjectKey()))))
                .toList();
        if (candidates.size() != 1) {
            return List.of();
        }
        ObjectBindingFacts candidate = candidates.get(0);
        return nodeIdsForFacts(graph, List.of(candidate.requirement(), candidate.path()));
    }

    private List<String> matchingStateNodeIds(Finding finding, AnalysisReport report, SecurityGraph graph) {
        Set<String> availableEvidence = evidenceIds(report);
        List<StateBypassFacts> candidates = stateBypassFacts(report, availableEvidence).stream()
                .filter(candidate -> finding.id().equals(new FindingIdGenerator().generate(
                        "STATE_BYPASS", List.of(
                                candidate.requirement().subjectKey(), candidate.evaluation().subjectKey()))))
                .toList();
        if (candidates.size() != 1) {
            return List.of();
        }
        StateBypassFacts candidate = candidates.get(0);
        return nodeIdsForFacts(graph, List.of(candidate.requirement(), candidate.evaluation()));
    }

    private List<ObjectBindingFacts> objectBindingFacts(AnalysisReport report, Set<String> availableEvidence) {
        List<Fact> requirements = facts(report, "OBJECT_AUTHORIZATION_REQUIREMENT");
        List<Fact> paths = facts(report, "OBJECT_ACCESS_PATH");
        return requirements.stream()
                .filter(requirement -> hasEvidence(requirement, availableEvidence))
                .flatMap(requirement -> paths.stream()
                        .filter(path -> matches(requirement, path)
                                && Set.of("UNGUARDED", "SOURCE_MISMATCH").contains(path.attributes().get("pathOutcome"))
                                && "COMPLETE_SUPPORTED_PATH".equals(path.attributes().get("coverage"))
                                && hasEvidence(path, availableEvidence))
                        .map(path -> new ObjectBindingFacts(requirement, path)))
                .distinct()
                .toList();
    }

    private List<StateBypassFacts> stateBypassFacts(AnalysisReport report, Set<String> availableEvidence) {
        List<Fact> requirements = facts(report, "BUSINESS_SECURITY_STATE").stream()
                .filter(fact -> "REQUIRES".equals(fact.attributes().get("stateAction")))
                .toList();
        List<Fact> evaluations = facts(report, "BUSINESS_STATE_EVALUATION");
        return requirements.stream()
                .filter(requirement -> hasEvidence(requirement, availableEvidence))
                .flatMap(requirement -> evaluations.stream()
                        .filter(evaluation -> matches(requirement, evaluation)
                                && "BYPASS_PATH".equals(evaluation.attributes().get("pathOutcome"))
                                && "COMPLETE_SUPPORTED_PATH".equals(evaluation.attributes().get("coverage"))
                                && hasEvidence(evaluation, availableEvidence))
                        .map(evaluation -> new StateBypassFacts(requirement, evaluation)))
                .distinct()
                .toList();
    }

    private List<Fact> facts(AnalysisReport report, String type) {
        return report.collectionReport().facts().stream()
                .filter(fact -> fact != null && type.equals(fact.type()))
                .sorted(java.util.Comparator.comparing(Fact::subjectKey).thenComparing(Fact::id))
                .toList();
    }

    private boolean matches(Fact requirement, Fact path) {
        if ("OBJECT_ACCESS_PATH".equals(path.type())) {
            return same(requirement.attributes().get("handler"), path.attributes().get("handler"))
                    && same(requirement.attributes().get("resourceType"), path.attributes().get("resourceType"))
                    && same(requirement.subjectKey(), path.attributes().get("requirementKey"));
        }
        return same(requirement.subjectKey(), path.attributes().get("requirementKey"))
                && same(requirement.attributes().get("handler"), path.attributes().get("handler"))
                && same(requirement.attributes().get("stateName"), path.attributes().get("stateName"))
                && requirement.attributes().getOrDefault("claim", "")
                .equals(path.attributes().getOrDefault("claimName", ""));
    }

    private boolean hasEvidence(Fact fact, Set<String> availableEvidence) {
        return fact != null && !fact.evidenceIds().isEmpty()
                && fact.evidenceIds().stream().allMatch(id -> !isBlank(id))
                && availableEvidence.containsAll(fact.evidenceIds());
    }

    private Set<String> evidenceIds(AnalysisReport report) {
        return report.evidence().stream()
                .filter(evidence -> evidence != null && !isBlank(evidence.id()))
                .map(Evidence::id)
                .collect(Collectors.toSet());
    }

    private List<String> nodeIdsForFacts(SecurityGraph graph, List<Fact> facts) {
        List<String> nodeIds = new ArrayList<>();
        for (Fact fact : facts) {
            List<GraphNode> candidates = graph.nodes().stream()
                    .filter(node -> matchesFactNode(node, fact))
                    .toList();
            if (candidates.size() != 1) {
                return List.of();
            }
            nodeIds.add(candidates.get(0).id());
        }
        return nodeIds.stream().distinct().sorted().toList();
    }

    private boolean matchesFactNode(GraphNode node, Fact fact) {
        if (node.type() != expectedNodeType(fact.type()) || !fact.subjectKey().equals(node.label())
                || !node.evidenceIds().containsAll(fact.evidenceIds())) {
            return false;
        }
        if ("BUSINESS_SECURITY_STATE".equals(fact.type())) {
            if (node.attributes().containsKey("factType")) {
                return false;
            }
        } else if (!fact.type().equals(node.attributes().get("factType"))) {
            return false;
        }
        return fact.attributes().entrySet().stream()
                .allMatch(entry -> entry.getValue().equals(node.attributes().get(entry.getKey())));
    }

    private NodeType expectedNodeType(String factType) {
        return "BUSINESS_SECURITY_STATE".equals(factType)
                || "BUSINESS_STATE_EVALUATION".equals(factType)
                ? NodeType.BUSINESS_SECURITY_STATE : NodeType.AUTHORIZATION;
    }

    private boolean same(String first, String second) {
        return !isBlank(first) && first.equals(second);
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private Finding withNodeIds(Finding finding, List<String> nodeIds) {
        if (nodeIds.isEmpty()) {
            return finding;
        }
        return new Finding(finding.id(), finding.ruleId(), finding.title(), finding.description(),
                finding.confidence(), nodeIds, finding.edgeIds(), finding.evidenceIds(), finding.guide());
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
        Map<String, Finding> findingsById = new TreeMap<>();
        for (Finding finding : findings) {
            if (finding == null || finding.id() == null || finding.id().isBlank()) {
                throw new IllegalStateException("Finding 식별자가 누락되었습니다.");
            }
            Finding existing = findingsById.putIfAbsent(finding.id(), finding);
            if (existing != null && !existing.equals(finding)) {
                throw new IllegalStateException("Finding 식별 충돌");
            }
        }
        return List.copyOf(findingsById.values());
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

    private record ObjectBindingFacts(Fact requirement, Fact path) {
    }

    private record StateBypassFacts(Fact requirement, Fact evaluation) {
    }
}
