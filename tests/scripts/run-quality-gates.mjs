import { spawnSync } from "node:child_process";
import fs from "node:fs";

const gates = [
  {
    id: "project_structure",
    label: "Project structure and publication boundaries",
    args: ["tests/scripts/verify-project-structure.mjs"]
  },
  {
    id: "feedback_regression_loop",
    label: "Feedback and regression loop",
    args: ["tests/scripts/verify-feedback-regression-loop.mjs"]
  },
  {
    id: "component_quality",
    label: "Deterministic component quality",
    args: ["tests/scripts/verify-component-quality.mjs"]
  },
  {
    id: "provider_connectors",
    label: "Keyless provider connector contracts",
    args: ["tests/scripts/verify-provider-connectors.mjs"]
  },
  {
    id: "context_retrieval",
    label: "Hybrid context retrieval",
    args: ["tests/scripts/context-search-benchmark.mjs", "--require=95"]
  },
  {
    id: "cross_component_regression",
    label: "Cross-component regression",
    args: ["tests/scripts/verify-keep-only.mjs"]
  }
];

const startedAt = new Date().toISOString();
const results = gates.map(gate => {
  const run = spawnSync(process.execPath, gate.args, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  return {
    id: gate.id,
    label: gate.label,
    passed: run.status === 0,
    exitCode: run.status,
    output: String(run.stdout || "").trim(),
    error: String(run.stderr || "").trim()
  };
});

const componentReport = JSON.parse(
  fs.readFileSync("tests/reports/component_quality_results.json", "utf8")
);
const feedbackReport = JSON.parse(
  fs.readFileSync("tests/reports/feedback_regression_loop_results.json", "utf8")
);
const contextReport = JSON.parse(
  fs.readFileSync("tests/reports/context_search_benchmark_results.json", "utf8")
);
const providerReport = JSON.parse(
  fs.readFileSync("tests/reports/provider_connector_results.json", "utf8")
);
const structureReport = JSON.parse(
  fs.readFileSync("tests/reports/project_structure_results.json", "utf8")
);
const report = {
  startedAt,
  completedAt: new Date().toISOString(),
  testType: "streaming_guard_deterministic_quality_gates",
  targetSuccessRate: 100,
  passed: results.every(result => result.passed),
  projectStructure: {
    passed: structureReport.passed,
    total: structureReport.total,
    successRate: structureReport.successRate
  },
  feedbackRegressionLoop: {
    passed: feedbackReport.passed,
    total: feedbackReport.total,
    successRate: feedbackReport.successRate
  },
  componentAssertions: {
    passed: componentReport.passed,
    total: componentReport.total,
    successRate: componentReport.successRate
  },
  providerConnectors: {
    passed: providerReport.passed,
    total: providerReport.total,
    successRate: providerReport.successRate,
    liveNetworkCallsMade: providerReport.liveNetworkCallsMade
  },
  contextRetrieval: {
    passed: contextReport.passed,
    total: contextReport.total,
    successRate: contextReport.successRate,
    requiredSuccessRate: contextReport.requiredSuccessRate
  },
  crossComponentRegressionPassed:
    results.find(result => result.id === "cross_component_regression")?.passed === true,
  gates: results
};

fs.writeFileSync(
  "tests/reports/deterministic_quality_summary.json",
  `${JSON.stringify(report, null, 2)}\n`
);

results.forEach(result => {
  console.log(`${result.passed ? "PASS" : "FAIL"} · ${result.label}`);
  if (result.output) console.log(result.output);
  if (result.error) console.error(result.error);
});
console.log(
  `Deterministic quality gates: ${report.passed ? "PASS" : "FAIL"} · ` +
  `${report.projectStructure.passed}/${report.projectStructure.total} structure checks · ` +
  `${report.componentAssertions.passed}/${report.componentAssertions.total} component assertions · ` +
  `${report.providerConnectors.passed}/${report.providerConnectors.total} provider connector checks · ` +
  `${report.contextRetrieval.passed}/${report.contextRetrieval.total} context cases.`
);

if (!report.passed) process.exitCode = 1;
