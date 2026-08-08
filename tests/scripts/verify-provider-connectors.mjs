import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const storageValues = new Map();
const localStorage = {
  getItem: key => storageValues.get(key) ?? null,
  setItem: (key, value) => storageValues.set(key, String(value)),
  removeItem: key => storageValues.delete(key)
};
const requests = [];
let queuedResponse = null;
const window = {
  localStorage,
  location: { protocol: "https:" },
  fetch: async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    if (queuedResponse instanceof Error) throw queuedResponse;
    return queuedResponse;
  }
};
window.window = window;
const sandbox = vm.createContext({
  window,
  console,
  Intl,
  Date,
  URL,
  AbortController,
  setTimeout,
  clearTimeout
});

for (const file of [
  "js/knowledge-base.js",
  "js/streaming-guard-math.js",
  "js/scenario-config.js",
  "js/household-context.js",
  "js/state-schemas.js",
  "js/trace-manager.js",
  "js/recommendation-engine.js",
  "js/context-selector.js",
  "js/openai-client.js"
]) {
  vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

const client = window.StreamingGuardOpenAI;
const knowledge = window.StreamingGuardKnowledge;
const results = [];

function mockResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body
  };
}

function judgment() {
  return {
    rubricPassed: true,
    rubricAssessment: "The output satisfies the supplied rubric.",
    humanControlPassed: true,
    humanControlAssessment: "The adult retains control of external actions.",
    strengths: ["Grounded and advisory"],
    gaps: [],
    requirementEvidence: [{
      requirement: "The response is grounded and advisory.",
      passed: true,
      evidenceQuote: "Action recommended",
      gap: ""
    }]
  };
}

function evaluationInput() {
  return {
    item: {
      eval_id: "CONNECTOR-TEST",
      case_name: "Provider connector contract",
      task_type: "recommendation",
      input_summary: "A fixed keyless connector test.",
      user_input: "Review this subscription.",
      expected_status: "Action recommended",
      expected_action: "keep",
      expected_behavior: "Return a valid semantic judgment."
    },
    output: { status: "Action recommended", actionType: "keep" },
    deterministicCriteria: [{ passed: true, label: "Schema valid" }],
    knowledge
  };
}

function configure(model, keyField) {
  storageValues.clear();
  client.saveSettings({
    openaiApiKey: "",
    anthropicApiKey: keyField === "anthropicApiKey" ? "mock-anthropic-key" : "",
    geminiApiKey: keyField === "geminiApiKey" ? "mock-gemini-key" : "",
    model,
    judgeModel: model
  });
}

async function test(provider, name, body) {
  try {
    await body();
    results.push({ provider, name, passed: true, error: null });
  } catch (error) {
    results.push({ provider, name, passed: false, error: error?.stack || String(error) });
  }
}

await test("anthropic", "builds the documented Messages API request", async () => {
  configure("claude-haiku-4-5-20251001", "anthropicApiKey");
  queuedResponse = mockResponse(200, {
    id: "msg_mock_1",
    model: "claude-haiku-4-5-20251001",
    content: [{ type: "text", text: JSON.stringify(judgment()) }],
    usage: { input_tokens: 10, output_tokens: 20 }
  });
  requests.length = 0;
  const result = await client.createEvaluationJudgment(evaluationInput());
  const request = requests.at(-1);
  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["x-api-key"], "mock-anthropic-key");
  assert.equal(request.options.headers["anthropic-version"], "2023-06-01");
  assert.equal(request.options.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(request.body.model, "claude-haiku-4-5-20251001");
  assert.equal(typeof request.body.system, "string");
  assert.equal(request.body.messages[0].role, "user");
  assert.equal(request.body.output_config.format.type, "json_schema");
  assert.equal(request.body.output_config.format.schema.type, "object");
  assert.equal(result.judgment.rubricPassed, true);
  assert.equal(result.responseId, "msg_mock_1");
});

await test("anthropic", "extracts joined text blocks", async () => {
  configure("claude-sonnet-5", "anthropicApiKey");
  const serialized = JSON.stringify(judgment());
  queuedResponse = mockResponse(200, {
    id: "msg_mock_2",
    model: "claude-sonnet-5",
    content: [
      { type: "text", text: serialized.slice(0, 30) },
      { type: "text", text: serialized.slice(30) }
    ]
  });
  const result = await client.createEvaluationJudgment(evaluationInput());
  assert.equal(result.judgment.humanControlPassed, true);
});

await test("anthropic", "surfaces provider API errors with debug data", async () => {
  configure("claude-haiku-4-5-20251001", "anthropicApiKey");
  queuedResponse = mockResponse(401, { error: { message: "Mock Anthropic authentication error" } });
  await assert.rejects(
    () => client.createEvaluationJudgment(evaluationInput()),
    error => error.message === "Mock Anthropic authentication error" &&
      error.provider === "anthropic" &&
      error.debug?.response?.httpStatus === 401
  );
});

await test("google", "builds the documented Gemini generateContent request", async () => {
  configure("gemini-3.5-flash", "geminiApiKey");
  queuedResponse = mockResponse(200, {
    responseId: "gemini_mock_1",
    modelVersion: "gemini-3.5-flash",
    candidates: [{ content: { parts: [{ text: JSON.stringify(judgment()) }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 }
  });
  requests.length = 0;
  const result = await client.createEvaluationJudgment(evaluationInput());
  const request = requests.at(-1);
  assert.equal(
    request.url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent"
  );
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["x-goog-api-key"], "mock-gemini-key");
  assert.equal(request.body.systemInstruction.parts[0].text, knowledge.evaluationJudge);
  assert.equal(request.body.contents[0].role, "user");
  assert.equal(request.body.generationConfig.responseFormat.text.mimeType, "APPLICATION_JSON");
  assert.equal(request.body.generationConfig.responseFormat.text.schema.type, "object");
  assert.equal(result.judgment.rubricPassed, true);
  assert.equal(result.responseId, "gemini_mock_1");
});

await test("google", "extracts joined candidate text parts", async () => {
  configure("gemini-3.6-flash", "geminiApiKey");
  const serialized = JSON.stringify(judgment());
  queuedResponse = mockResponse(200, {
    modelVersion: "gemini-3.6-flash",
    candidates: [{ content: { parts: [
      { text: serialized.slice(0, 35) },
      { text: serialized.slice(35) }
    ] } }]
  });
  const result = await client.createEvaluationJudgment(evaluationInput());
  assert.equal(result.judgment.humanControlPassed, true);
});

await test("google", "rejects an empty successful provider response", async () => {
  configure("gemini-3.5-flash-lite", "geminiApiKey");
  queuedResponse = mockResponse(200, { candidates: [] });
  await assert.rejects(
    () => client.createEvaluationJudgment(evaluationInput()),
    error => error.message === "Google Gemini returned an empty response." && error.provider === "google"
  );
});

await test("shared", "surfaces browser transport failures without exposing mock keys", async () => {
  configure("gemini-3.5-flash", "geminiApiKey");
  queuedResponse = new TypeError("Mock network failure");
  await assert.rejects(
    () => client.createEvaluationJudgment(evaluationInput()),
    error => /browser could not reach Google Gemini/.test(error.message) &&
      !JSON.stringify(error.debug).includes("mock-gemini-key")
  );
});

const report = {
  generatedAt: new Date().toISOString(),
  testType: "keyless_mock_provider_connector_contract",
  liveNetworkCallsMade: false,
  passed: results.filter(result => result.passed).length,
  failed: results.filter(result => !result.passed).length,
  total: results.length,
  successRate: Number(((results.filter(result => result.passed).length / results.length) * 100).toFixed(2)),
  results
};

fs.writeFileSync(
  "tests/reports/provider_connector_results.json",
  `${JSON.stringify(report, null, 2)}\n`
);

results.forEach(result => {
  console.log(`${result.passed ? "PASS" : "FAIL"} · ${result.provider} · ${result.name}`);
  if (result.error) console.error(result.error);
});
console.log(`Provider connector tests: ${report.passed}/${report.total} passed · no API keys or network calls used.`);

if (report.failed) process.exitCode = 1;
