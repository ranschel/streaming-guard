import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const liveRequested = process.argv.includes("--live");
const liveProviderOptions = [
  {
    provider: "OpenAI",
    model: "gpt-5.6-luna",
    apiKey: String(process.env.OPENAI_API_KEY || ""),
    settings: apiKey => ({ openaiApiKey: apiKey })
  },
  {
    provider: "Anthropic",
    model: "claude-haiku-4-5-20251001",
    apiKey: String(process.env.ANTHROPIC_API_KEY || ""),
    settings: apiKey => ({ anthropicApiKey: apiKey })
  },
  {
    provider: "Google Gemini",
    model: "gemini-3.5-flash-lite",
    apiKey: String(process.env.GEMINI_API_KEY || ""),
    settings: apiKey => ({ geminiApiKey: apiKey })
  }
];
const liveProvider = liveRequested
  ? liveProviderOptions.find(option => option.apiKey)
  : null;
const storageValues = new Map();
const localStorage = {
  getItem: key => storageValues.get(key) ?? null,
  setItem: (key, value) => storageValues.set(key, String(value)),
  removeItem: key => storageValues.delete(key)
};
const window = {
  localStorage,
  location: { protocol: "https:" },
  fetch: (...args) => fetch(...args)
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
  "js/persistence-adapters.js",
  "js/workflow-engine.js",
  "js/memory-store.js",
  "js/recommendation-engine.js",
  "js/trace-manager.js",
  "js/agent-tools.js",
  "js/context-selector.js",
  "js/openai-client.js",
  "js/feedback-manager.js",
  "js/ui-renderers.js"
]) {
  vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

const knowledge = window.StreamingGuardKnowledge;
const context = window.StreamingGuardContext;
const memoryFactory = window.StreamingGuardMemory;
const toolsFactory = window.StreamingGuardAgentTools;
const engine = window.StreamingGuardRecommendationEngine;
const client = window.StreamingGuardOpenAI;
const feedback = window.StreamingGuardFeedback;
const ui = window.StreamingGuardUI;
const applicationSource = fs.readFileSync("js/app.js", "utf8");
const results = [];
let harnessSequence = 0;

async function test(mode, name, body) {
  try {
    await body();
    results.push({ mode, name, passed: true, error: null });
  } catch (error) {
    results.push({
      mode,
      name,
      passed: false,
      error: error?.stack || String(error)
    });
  }
}

function seedState() {
  return context.rebaseStateDates(context.createSeedState("SG-001"), "2026-08-15");
}

function createHarness() {
  const storage = new Map();
  const adapter = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  };
  const memory = memoryFactory.createMemoryStore({
    storageKey: `feedback-loop-test-${++harnessSequence}`,
    createSeedState: seedState,
    storage: adapter,
    clock: () => "2026-08-15T12:00:00.000Z"
  });
  const tools = toolsFactory.createAgentTools({
    memory,
    knowledge,
    clock: () => "2026-08-15T12:00:00.000Z"
  });
  return { memory, tools };
}

function conversationTurn(overrides = {}) {
  return {
    reply: "I understand the feedback.",
    turnType: "answer",
    discussionStatus: "open",
    outcome: "none",
    finalAction: "none",
    externalActionRequired: false,
    recommendationEffect: "unchanged",
    preferenceDisposition: "not_applicable",
    nextExpectedInput: "none",
    safetyDisposition: "normal",
    refusalSections: {
      yourRequest: "",
      myResponse: "",
      whyRefusing: "",
      whatYouCanDoNext: ""
    },
    reasonCodes: ["question_answered"],
    proposedHouseholdUpdates: [],
    ...overrides
  };
}

function preferenceProposal({
  value = "Prefer cancellations only when monthly savings are at least $10.",
  confirmed = false
} = {}) {
  return {
    updateType: "preference_note",
    targetId: "HH-001",
    relatedId: "",
    field: "preferenceNote",
    value,
    effectiveDate: "",
    scope: "permanent",
    requiresAdultConfirmation: !confirmed
  };
}

function modelResponse(turn) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        modelVersion: "gemini-3.5-flash-lite",
        candidates: [{
          content: { parts: [{ text: JSON.stringify(turn) }] }
        }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 }
      };
    }
  };
}

// Deterministic feedback and regression-store behavior.
await test("deterministic", "feedback submission is idempotent per recommendation version", () => {
  feedback.clearAll();
  const first = feedback.recordFeedback({
    scenarioId: "SG-001",
    recommendationVersion: 3,
    recommendationInstanceId: "recommendation-a",
    displayAfterMessageCount: 8,
    rating: "poor",
    reasons: ["Timing was wrong"],
    comment: "This was too close to a new release."
  });
  const second = feedback.recordFeedback({
    scenarioId: "SG-001",
    recommendationVersion: 3,
    recommendationInstanceId: "recommendation-a",
    rating: "poor",
    reasons: ["Other"],
    comment: "Duplicate submit."
  });
  assert.equal(first.id, second.id);
  assert.equal(feedback.feedbackFor({
    scenarioId: "SG-001",
    recommendationVersion: 3,
    recommendationInstanceId: "recommendation-a"
  }).comment, "This was too close to a new release.");
  assert.equal(feedback.feedbackFor({
    scenarioId: "SG-001",
    recommendationVersion: 3,
    recommendationInstanceId: "recommendation-a"
  }).displayAfterMessageCount, 8);
});

await test("deterministic", "feedback from an earlier recommendation instance is not shown on a fresh run", () => {
  feedback.clearAll();
  feedback.recordFeedback({
    scenarioId: "SG-001",
    recommendationVersion: 1,
    recommendationInstanceId: "recommendation-old",
    rating: "poor"
  });
  assert.equal(feedback.feedbackFor({
    scenarioId: "SG-001",
    recommendationVersion: 1,
    recommendationInstanceId: "recommendation-new"
  }), null);
});

await test("deterministic", "unsupported feedback reasons are discarded", () => {
  feedback.clearAll();
  const saved = feedback.recordFeedback({
    scenarioId: "SG-001",
    recommendationVersion: 4,
    recommendationInstanceId: "recommendation-b",
    rating: "helpful",
    reasons: ["Helpful", "Injected reason"]
  });
  assert.equal(JSON.stringify(saved.reasons), JSON.stringify(["Helpful"]));
});

await test("deterministic", "poor recommendation produces one immutable reviewer draft", () => {
  feedback.clearAll();
  const candidate = feedback.captureRegressionCandidate({
    sourceType: "recommendation_feedback",
    sourceKey: "feedback-1",
    title: "Bad timing",
    failureSummary: "A future release was overlooked.",
    actualOutput: { actionType: "cancel" }
  });
  feedback.captureRegressionCandidate({
    sourceType: "recommendation_feedback",
    sourceKey: "feedback-1",
    title: "Duplicate"
  });
  candidate.actualOutput.actionType = "keep";
  const [stored] = feedback.regressionCandidates();
  assert.equal(stored.actualOutput.actionType, "cancel");
  assert.equal(stored.status, "draft");
  assert.equal(stored.reviewerRequired, true);
  assert.equal(feedback.regressionCandidates().length, 1);
});

await test("deterministic", "failed evaluation produces a separate reviewer-controlled draft", () => {
  const candidate = feedback.captureRegressionCandidate({
    sourceType: "evaluation_failure",
    sourceKey: "EVAL-08:run-2026-08-15",
    title: "EVAL-08 failed",
    failureSummary: "The response omitted a second supporting title.",
    actualOutput: { actionType: "subscribe", mentionedTitles: ["Title A"] },
    expectedBehaviorDraft: "Account for every material title supporting the recommendation."
  });
  assert.equal(candidate.sourceType, "evaluation_failure");
  assert.equal(candidate.status, "draft");
  assert.equal(candidate.reviewerRequired, true);
  assert.equal(feedback.regressionCandidates().length, 2);
});

await test("deterministic", "regression export remains draft-only and contains no official promotion flag", () => {
  const payload = feedback.exportPayload();
  assert(payload.notice.includes("human review"));
  assert(payload.candidates.every(item =>
    item.status === "draft" &&
    item.reviewerRequired === true &&
    !Object.hasOwn(item, "official")
  ));
});

await test("deterministic", "reset removes feedback and regression drafts", () => {
  feedback.clearAll();
  assert.equal(feedback.regressionCandidates().length, 0);
  assert.equal(feedback.feedbackFor({
    scenarioId: "SG-001",
    recommendationVersion: 3,
    recommendationInstanceId: "recommendation-a"
  }), null);
});

await test("deterministic", "preference writes reject missing explicit feedback approval", () => {
  const { tools } = createHarness();
  assert.throws(() => tools.update_household_context({
    updateType: "preference_note",
    payload: { preference: "Prefer at least $10 monthly savings." },
    source: "adult_chat",
    scope: "permanent"
  }), /explicit adult feedback approval/);
});

await test("deterministic", "approved preference is concise, durable, and deduplicated", () => {
  const { memory, tools } = createHarness();
  const command = {
    updateType: "preference_note",
    payload: { preference: "Prefer at least $10 monthly savings." },
    source: "adult_feedback_approved",
    scope: "permanent",
    commandId: "approved-preference-1"
  };
  tools.update_household_context(command);
  tools.update_household_context(command);
  const saved = memory.getState().familyRules.preferenceNotes;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].source, "adult_feedback_approved");
});

await test("deterministic", "feedback UI communicates separate storage and explicit approval", () => {
  const markup = ui.feedbackMarkup({ submitted: false });
  assert(markup.includes("kept separately from household memory"));
  assert(markup.includes("explicitly approve"));
  assert(markup.includes("Poor recommendation"));
  assert(!markup.includes("regression"));
  assert(!markup.includes("createRegression"));
});

await test("deterministic", "internal feedback task is separated from the adult-visible message", () => {
  const request = feedback.interpretationRequest({
    comment: "I did not like how this answer was written.",
    reasons: ["Other"]
  });
  assert.equal(request.visibleText, "I did not like how this answer was written.");
  assert(!request.visibleText.includes("distinguish"));
  assert(!request.visibleText.includes("explicit approval"));
  assert(request.contextText.includes("streaming recommendation"));
  assert(request.modelText.includes("Internal feedback task"));
});

await test("deterministic", "pending preference choices use typed application decisions", () => {
  const pending = preferenceProposal();
  const markup = ui.preferenceApprovalMarkup(pending);
  assert(markup.includes('data-action="save-preference"'));
  assert(markup.includes('data-action="reject-preference"'));
  assert(markup.includes('data-action="edit-preference"'));
  assert(markup.includes('data-action="question-preference"'));
  const approved = feedback.preferenceDecision(
    pending,
    feedback.PREFERENCE_DECISIONS.SAVE
  );
  assert.equal(approved.requiresAdultConfirmation, false);
  assert.equal(
    feedback.preferenceDecision(pending, feedback.PREFERENCE_DECISIONS.REJECT),
    null
  );
  assert.equal(
    feedback.preferenceDecision(pending, feedback.PREFERENCE_DECISIONS.EDIT)
      .requiresAdultConfirmation,
    true
  );
});

await test("deterministic", "pending choices block free text until an LLM conversation path is selected", () => {
  assert(applicationSource.includes("function composerChoiceBlock()"));
  assert(applicationSource.includes("messageInput.disabled = disabled"));
  assert(applicationSource.includes('composerIntent === "preference-question"'));
  assert(applicationSource.includes('await askOpenAI(text, "preference_question")'));
  assert(applicationSource.includes("await askOpenAI(text, submittedIntent)"));
  assert(!applicationSource.includes("const budgetMatch = composerIntent"));
  assert(!applicationSource.includes("function isLikelyStreamingScopeMessage"));
  assert(applicationSource.includes("Streaming Guard is currently unavailable. Please try again later."));
  assert(!applicationSource.includes("Connect an AI model before using free-text chat"));
  assert(applicationSource.includes("const disabled = chatBusy || Boolean(block);"));
  const disconnectedBranch = applicationSource.slice(
    applicationSource.indexOf("if (!openAI.isModelConfigured(providerSettings.model, providerSettings))"),
    applicationSource.indexOf('if (composerIntent === "preference-edit")')
  );
  assert(disconnectedBranch.includes("persistAdultMessage(text)"));
  assert(!disconnectedBranch.includes("budgetMatch"));
  assert(!disconnectedBranch.includes("out_of_scope"));
});

await test("deterministic", "preference edit creates a private LLM task and preserves adult text", () => {
  const request = feedback.preferenceEditRequest(
    preferenceProposal(),
    "Make the threshold $20 and apply it only to cancellations."
  );
  assert.equal(
    request.visibleText,
    "Make the threshold $20 and apply it only to cancellations."
  );
  assert(request.contextText.includes("pending household preference"));
  assert(request.modelText.includes("Internal preference-edit task"));
  assert(request.modelText.includes("requiresAdultConfirmation true"));
});

await test("deterministic", "pending preference keeps an entity-free edit in conversation scope", () => {
  const state = seedState();
  state.review.pendingContextUpdates = [preferenceProposal()];
  const selection = client.selectRequestContext({
    state,
    knowledge,
    decisionPacket: engine.buildDecisionPacket(state),
    recommendation: engine.buildRecommendation(state),
    userText: "Make it stricter",
    requestType: "conversation"
  });
  assert.notEqual(selection.contextPlan.intent, "out_of_scope");
  assert(selection.contextPlan.selectionReasons.some(item =>
    item.source === "pending_preference"
  ));
});

// Mocked provider calls exercise the real prompt, schema, response parsing, and validator.
await test("mocked_model", "feedback model may propose only an unapproved preference", async () => {
  const originalFetch = window.fetch;
  window.fetch = async () => modelResponse(conversationTurn({
    reply: "Understood. I’ll treat this as a proposed ongoing preference. Please review it in the available choices; it has not been saved.",
    turnType: "answer",
    outcome: "none",
    preferenceDisposition: "lasting_preference_proposed",
    nextExpectedInput: "adult_decision",
    reasonCodes: ["clarification_needed"],
    proposedHouseholdUpdates: [preferenceProposal()]
  }));
  client.saveSettings({
    geminiApiKey: "test-key",
    model: "gemini-3.5-flash-lite",
    judgeModel: "gemini-3.5-flash-lite"
  });
  const state = seedState();
  const result = await client.createResponse({
    state,
    recommendation: engine.buildRecommendation(state),
    userText: "I want at least $10 monthly savings before canceling. Remember this.",
    intent: "feedback",
    knowledge
  });
  assert.equal(result.response.proposedHouseholdUpdates[0].requiresAdultConfirmation, true);
  const packet = engine.buildDecisionPacket(state);
  assert.throws(() => client.validateConversationResponse(
    conversationTurn({
      preferenceDisposition: "lasting_preference_proposed",
      proposedHouseholdUpdates: []
    }),
    engine.buildRecommendation(state),
    packet,
    state,
    { intent: "feedback" }
  ), /exactly one unapproved durable preference/);
  assert.throws(() => client.validateConversationResponse(
    conversationTurn({
      turnType: "clarification_request",
      outcome: "needs_more_information",
      preferenceDisposition: "one_time_feedback",
      proposedHouseholdUpdates: [preferenceProposal()]
    }),
    engine.buildRecommendation(state),
    packet,
    state,
    { intent: "feedback" }
  ), /One-time recommendation feedback cannot create/);
  window.fetch = originalFetch;
});

await test("mocked_model", "feedback model cannot silently save or revise the recommendation", async () => {
  const state = seedState();
  const packet = engine.buildDecisionPacket(state);
  assert.throws(() => client.validateConversationResponse(
    conversationTurn({
      turnType: "new_information",
      preferenceDisposition: "lasting_preference_proposed",
      proposedHouseholdUpdates: [preferenceProposal({ confirmed: true })]
    }),
    engine.buildRecommendation(state),
    packet,
    state,
    { intent: "feedback" }
  ), /unapproved lasting preference/);
  assert.throws(() => client.validateConversationResponse(
    conversationTurn({ recommendationEffect: "revise" }),
    engine.buildRecommendation(state),
    packet,
    state,
    { intent: "feedback" }
  ), /feedback, preference-edit, or preference-question turn/);
  assert.throws(() => client.validateConversationResponse(
    conversationTurn({
      discussionStatus: "resolved",
      outcome: "recommendation_declined",
      finalAction: "keep",
      recommendationEffect: "close"
    }),
    engine.buildRecommendation(state),
    packet,
    state,
    { intent: "feedback" }
  ), /feedback, preference-edit, or preference-question turn/);
});

await test("mocked_model", "explicit approval can produce a validated durable preference update", () => {
  const state = seedState();
  const validated = client.validateConversationResponse(
    conversationTurn({
      reply: "Thanks. I can save that lasting preference now.",
      turnType: "new_information",
      reasonCodes: ["family_rule_updated"],
      proposedHouseholdUpdates: [preferenceProposal({ confirmed: true })]
    }),
    engine.buildRecommendation(state),
    engine.buildDecisionPacket(state),
    state,
    { intent: "general" }
  );
  assert.equal(validated.proposedHouseholdUpdates[0].requiresAdultConfirmation, false);
});

await test("mocked_model", "preference edit returns one revised unapproved preference", () => {
  const state = seedState();
  const revised = preferenceProposal({
    value: "Notify only about cancellations that save more than $20 per month."
  });
  const validated = client.validateConversationResponse(
    conversationTurn({
      reply: "Here is the revised preference for your review.",
      turnType: "clarification_request",
      outcome: "needs_more_information",
      preferenceDisposition: "pending_preference_revised",
      reasonCodes: ["clarification_needed"],
      proposedHouseholdUpdates: [revised]
    }),
    engine.buildRecommendation(state),
    engine.buildDecisionPacket(state),
    state,
    { intent: "preference_edit" }
  );
  assert.equal(validated.proposedHouseholdUpdates.length, 1);
  assert.equal(validated.proposedHouseholdUpdates[0].value, revised.value);
  assert.throws(() => client.validateConversationResponse(
    conversationTurn({
      preferenceDisposition: "pending_preference_revised",
      proposedHouseholdUpdates: []
    }),
    engine.buildRecommendation(state),
    engine.buildDecisionPacket(state),
    state,
    { intent: "preference_edit" }
  ), /exactly one revised/);
});

await test("mocked_model", "preference question preserves the proposal without changing it", () => {
  const state = seedState();
  const validated = client.validateConversationResponse(
    conversationTurn({
      reply: "This preference would apply to future recommendations, not the recommendation you already completed.",
      turnType: "answer",
      preferenceDisposition: "pending_preference_question",
      reasonCodes: ["no_material_change"],
      proposedHouseholdUpdates: []
    }),
    engine.buildRecommendation(state),
    engine.buildDecisionPacket(state),
    state,
    { intent: "preference_question" }
  );
  assert.equal(validated.proposedHouseholdUpdates.length, 0);
  assert.throws(() => client.validateConversationResponse(
    conversationTurn({
      turnType: "clarification_request",
      outcome: "needs_more_information",
      preferenceDisposition: "pending_preference_question",
      proposedHouseholdUpdates: [preferenceProposal()]
    }),
    engine.buildRecommendation(state),
    engine.buildDecisionPacket(state),
    state,
    { intent: "preference_question" }
  ), /cannot save, reject, or revise/);
});

await test("mocked_model", "one-time feedback creates no durable update", async () => {
  const originalFetch = window.fetch;
  window.fetch = async () => modelResponse(conversationTurn({
    reply: "Understood. I’ll treat this as feedback about this decision only.",
    preferenceDisposition: "one_time_feedback",
    reasonCodes: ["no_material_change"]
  }));
  const state = seedState();
  const result = await client.createResponse({
    state,
    recommendation: engine.buildRecommendation(state),
    userText: "This was only a problem because guests are visiting this weekend.",
    intent: "feedback",
    knowledge
  });
  assert.equal(result.response.proposedHouseholdUpdates.length, 0);
  window.fetch = originalFetch;
});

// Optional live model quality cases. These use fictional household data only.
if (liveRequested) {
  if (!liveProvider) {
    results.push({
      mode: "live_model",
      name: "live model credentials available",
      passed: false,
      classification: "infrastructure_blocked",
      error: "No supported live provider credential is available. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY."
    });
  } else {
    client.saveSettings({
      ...liveProvider.settings(liveProvider.apiKey),
      model: liveProvider.model,
      judgeModel: liveProvider.model
    });
    const liveCases = [
      {
        name: "durable minimum-savings preference requires approval",
        text: "This recommendation was poor. Going forward, never recommend canceling unless it saves at least $10 per month. Please treat that as a lasting preference.",
        check: turn =>
          turn.proposedHouseholdUpdates.length === 1 &&
          turn.proposedHouseholdUpdates[0].updateType === "preference_note" &&
          turn.proposedHouseholdUpdates[0].requiresAdultConfirmation === true
      },
      {
        name: "one-time circumstances do not become memory",
        text: "This recommendation was poor only because guests are visiting this weekend. This is just for this decision, not a future preference.",
        check: turn => turn.proposedHouseholdUpdates.length === 0
      },
      {
        name: "helpful feedback does not invent a preference",
        text: "This recommendation was helpful. I do not want to change any household preference.",
        check: turn => turn.proposedHouseholdUpdates.length === 0
      },
      {
        name: "ambiguous feedback asks before durable learning",
        text: "I dislike canceling subscriptions close to a future release.",
        check: turn =>
          turn.proposedHouseholdUpdates.length === 0 ||
          turn.proposedHouseholdUpdates.every(update => update.requiresAdultConfirmation === true)
      }
    ];
    let providerBlocked = false;
    for (const item of liveCases) {
      if (providerBlocked) break;
      try {
        const state = seedState();
        const result = await client.createResponse({
          state,
          recommendation: engine.buildRecommendation(state),
          userText: item.text,
          intent: "feedback",
          knowledge,
          model: liveProvider.model
        });
        assert(item.check(result.response), JSON.stringify(result.response));
        results.push({ mode: "live_model", name: item.name, passed: true, error: null });
      } catch (error) {
        const errorText = error?.stack || String(error);
        const credentialFailure = /api key|unauthorized|forbidden|status 401|status 403/i.test(errorText);
        results.push({
          mode: "live_model",
          name: credentialFailure ? "live provider credential preflight" : item.name,
          passed: false,
          classification: credentialFailure ? "infrastructure_blocked" : "model_quality_failure",
          error: errorText
        });
        providerBlocked = credentialFailure;
      }
    }
  }
}

client.clearSettings();
const byMode = Object.fromEntries(
  [...new Set(results.map(result => result.mode))].map(mode => {
    const subset = results.filter(result => result.mode === mode);
    const passed = subset.filter(result => result.passed).length;
    return [mode, {
      passed,
      total: subset.length,
      successRate: Number(((passed / subset.length) * 100).toFixed(1))
    }];
  })
);
const passed = results.filter(result => result.passed).length;
const report = {
  generatedAt: new Date().toISOString(),
  testType: "feedback_and_regression_loop",
  liveModelRequested: liveRequested,
  liveModelProvider: liveProvider?.provider || null,
  liveModel: liveProvider?.model || null,
  passed,
  total: results.length,
  successRate: Number(((passed / results.length) * 100).toFixed(1)),
  byMode,
  failures: results.filter(result => !result.passed)
};
fs.mkdirSync("tests/reports", { recursive: true });
const reportPath = liveRequested
  ? "tests/reports/feedback_regression_loop_live_results.json"
  : "tests/reports/feedback_regression_loop_results.json";
fs.writeFileSync(
  reportPath,
  `${JSON.stringify(report, null, 2)}\n`
);

console.log(`Feedback and regression loop: ${passed}/${results.length} passed (${report.successRate}%).`);
Object.entries(byMode).forEach(([mode, score]) => {
  console.log(`- ${mode}: ${score.passed}/${score.total} (${score.successRate}%)`);
});
if (report.failures.length) {
  report.failures.forEach(failure => {
    console.log(`FAIL · ${failure.mode} · ${failure.name}: ${failure.error.split("\n")[0]}`);
  });
  process.exitCode = 1;
}
