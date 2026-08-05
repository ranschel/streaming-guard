import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const storageValues = new Map();
const localStorage = {
  getItem: key => storageValues.get(key) ?? null,
  setItem: (key, value) => storageValues.set(key, String(value)),
  removeItem: key => storageValues.delete(key)
};
const window = {
  localStorage,
  location: { protocol: "file:" },
  fetch: async () => {
    throw new Error("Network calls are disabled in deterministic component tests.");
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
const math = window.StreamingGuardMath;
const context = window.StreamingGuardContext;
const schemas = window.StreamingGuardStateSchemas;
const workflow = window.StreamingGuardWorkflow;
const memoryFactory = window.StreamingGuardMemory;
const toolsFactory = window.StreamingGuardAgentTools;
const engine = window.StreamingGuardRecommendationEngine;
const selector = window.StreamingGuardContextSelector;
const client = window.StreamingGuardOpenAI;
const ui = window.StreamingGuardUI;
const feedback = window.StreamingGuardFeedback;

const results = [];
let harnessSequence = 0;
const fixedClock = () => "2026-07-29T19:00:00.000Z";

function createStorage() {
  const values = new Map();
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

function createHarness(scenarioId = "SG-001") {
  const storage = createStorage();
  const memory = memoryFactory.createMemoryStore({
    storageKey: `streaming-guard.component-test.${++harnessSequence}`,
    createSeedState: requestedScenarioId => context.rebaseStateDates(
      context.createSeedState(requestedScenarioId || scenarioId),
      fixedClock().slice(0, 10)
    ),
    storage,
    clock: fixedClock
  });
  const tools = toolsFactory.createAgentTools({
    memory,
    knowledge,
    clock: fixedClock
  });
  return { storage, memory, tools };
}

async function test(category, name, body) {
  try {
    await body();
    results.push({ category, name, passed: true, error: null });
  } catch (error) {
    results.push({
      category,
      name,
      passed: false,
      error: error?.stack || String(error)
    });
  }
}

function validConversation(overrides = {}) {
  return {
    reply: "I can help with that streaming-subscription question.",
    turnType: "answer",
    discussionStatus: "open",
    outcome: "none",
    finalAction: "none",
    externalActionRequired: false,
    recommendationEffect: "unchanged",
    preferenceDisposition: "not_applicable",
    nextExpectedInput: "additional_information",
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

function decisionPacket(scenarioId = "SG-001") {
  return engine.buildDecisionPacket(context.createSeedState(scenarioId));
}

// Memory, controlled writes, persistence, and privacy.
await test("memory", "seeded household loads", () => {
  const { memory } = createHarness();
  assert.equal(memory.getState().subscriptions.length, 5);
  assert.equal(memory.getState().household.authorizedAdultMemberId, "MEM-001");
});

await test("memory", "completed viewing requires a completion date", () => {
  const { tools } = createHarness();
  assert.throws(() => tools.update_household_context({
    updateType: "viewing_confirmation",
    payload: {
      memberId: "MEM-003",
      titleId: "TTL-GARDEN",
      status: "completed"
    },
    commandId: "viewing-no-date"
  }), /completedOn is required/);
});

await test("memory", "completed viewing persists with provenance", () => {
  const { memory, tools } = createHarness();
  tools.update_household_context({
    updateType: "viewing_confirmation",
    payload: {
      memberId: "MEM-003",
      titleId: "TTL-GARDEN",
      status: "completed",
      completedOn: "2026-07-29"
    },
    commandId: "viewing-complete-1"
  });
  const record = memory.getState().householdViewing.find(item =>
    item.memberId === "MEM-003" && item.titleId === "TTL-GARDEN"
  );
  assert.equal(record.status, "completed");
  assert.equal(record.completedOn, "2026-07-29");
  assert.equal(record._provenance.confidence, "adult_confirmed");
});

await test("memory", "new subscription requires an exact plan", () => {
  const { tools } = createHarness();
  assert.throws(() => tools.update_household_context({
    updateType: "subscription_record",
    payload: {
      serviceId: "SVC-SUMMIT",
      field: "subscriptionStatus",
      value: "active"
    },
    commandId: "subscription-no-plan"
  }), /plan is required first/);
});

await test("memory", "new subscription plan creates an active record", () => {
  const { memory, tools } = createHarness();
  const before = memory.getState().householdSpendingHistory.find(item => item.monthOffset === 0).totalMonthlySpend;
  tools.update_household_context({
    updateType: "subscription_record",
    payload: {
      serviceId: "SVC-SUMMIT",
      field: "subscriptionPlan",
      value: "PLAN-SUMMIT-M",
      planId: "PLAN-SUMMIT-M",
      effectiveDate: "2026-07-29"
    },
    commandId: "subscription-plan-1"
  });
  const afterState = memory.getState();
  const subscription = afterState.subscriptions.find(item => item.serviceId === "SVC-SUMMIT");
  assert.equal(subscription.planId, "PLAN-SUMMIT-M");
  assert.equal(subscription.status, "active");
  assert.equal(
    afterState.householdSpendingHistory.find(item => item.monthOffset === 0).totalMonthlySpend,
    math.roundCurrency(before + subscription.monthlyCost)
  );
});

await test("memory", "plan change adjusts current spending once", () => {
  const { memory, tools } = createHarness();
  const before = memory.getState().subscriptions.find(item => item.serviceId === "SVC-AURORA");
  const beforeSpend = memory.getState().householdSpendingHistory.find(item => item.monthOffset === 0).totalMonthlySpend;
  tools.update_household_context({
    updateType: "subscription_record",
    payload: {
      serviceId: "SVC-AURORA",
      field: "subscriptionPlan",
      value: "PLAN-AURORA-ADS",
      planId: "PLAN-AURORA-ADS"
    },
    commandId: "aurora-plan-change"
  });
  const next = memory.getState();
  const changed = next.subscriptions.find(item => item.serviceId === "SVC-AURORA");
  assert.equal(changed.planId, "PLAN-AURORA-ADS");
  assert.equal(
    next.householdSpendingHistory.find(item => item.monthOffset === 0).totalMonthlySpend,
    math.roundCurrency(beforeSpend - before.monthlyCost + changed.monthlyCost)
  );
});

for (const [status, expectedContribution] of [
  ["canceled", 0],
  ["paused", 0],
  ["active", 12.99]
]) {
  await test("memory", `subscription status ${status} updates spending`, () => {
    const { memory, tools } = createHarness();
    if (status === "active") {
      tools.update_household_context({
        updateType: "subscription_record",
        payload: { serviceId: "SVC-AURORA", field: "subscriptionStatus", value: "paused" },
        commandId: "aurora-pause-first"
      });
    }
    const beforeState = memory.getState();
    const beforeSpend = beforeState.householdSpendingHistory.find(item => item.monthOffset === 0).totalMonthlySpend;
    const previous = beforeState.subscriptions.find(item => item.serviceId === "SVC-AURORA");
    tools.update_household_context({
      updateType: "subscription_record",
      payload: { serviceId: "SVC-AURORA", field: "subscriptionStatus", value: status },
      commandId: `aurora-status-${status}`
    });
    const afterState = memory.getState();
    const expected = math.roundCurrency(
      beforeSpend -
      (previous.status === "active" ? previous.monthlyCost : 0) +
      expectedContribution
    );
    assert.equal(
      afterState.householdSpendingHistory.find(item => item.monthOffset === 0).totalMonthlySpend,
      expected
    );
  });
}

await test("memory", "monthly price update rejects negative values", () => {
  const { tools } = createHarness();
  assert.throws(() => tools.update_household_context({
    updateType: "subscription_record",
    payload: { serviceId: "SVC-AURORA", field: "monthlyCost", value: -1 },
    commandId: "negative-monthly-cost"
  }), /invalid/);
});

await test("memory", "monthly price update adjusts active spending", () => {
  const { memory, tools } = createHarness();
  const beforeSpend = memory.getState().householdSpendingHistory.find(item => item.monthOffset === 0).totalMonthlySpend;
  tools.update_household_context({
    updateType: "subscription_record",
    payload: { serviceId: "SVC-AURORA", field: "monthlyCost", value: 15.49 },
    commandId: "aurora-price-change"
  });
  assert.equal(
    memory.getState().householdSpendingHistory.find(item => item.monthOffset === 0).totalMonthlySpend,
    math.roundCurrency(beforeSpend + 2.5)
  );
});

await test("memory", "renewal and expiration dates calculate offsets", () => {
  const { memory, tools } = createHarness();
  tools.update_household_context({
    updateType: "subscription_record",
    payload: { serviceId: "SVC-AURORA", field: "nextRenewal", value: "2026-08-15" },
    commandId: "aurora-renewal-date"
  });
  tools.update_household_context({
    updateType: "subscription_record",
    payload: { serviceId: "SVC-AURORA", field: "expirationDate", value: "2026-08-31" },
    commandId: "aurora-expiration-date"
  });
  const subscription = memory.getState().subscriptions.find(item => item.serviceId === "SVC-AURORA");
  assert.equal(subscription.renewalOffsetDays, math.daysBetween(memory.getState().systemDate, "2026-08-15"));
  assert.equal(subscription.expirationOffsetDays, math.daysBetween(memory.getState().systemDate, "2026-08-31"));
});

await test("memory", "invalid subscription date is rejected", () => {
  const { tools } = createHarness();
  assert.throws(() => tools.update_household_context({
    updateType: "subscription_record",
    payload: { serviceId: "SVC-AURORA", field: "nextRenewal", value: "August 15" },
    commandId: "invalid-renewal-date"
  }), /valid subscription date/);
});

await test("memory", "watchlist item can be added and prioritized", () => {
  const { memory, tools } = createHarness();
  tools.update_household_context({
    updateType: "watchlist_item",
    payload: {
      memberId: "MEM-004",
      titleId: "TTL-SUMMER-KITE",
      field: "priority",
      value: "high"
    },
    commandId: "watchlist-add-priority"
  });
  const entry = memory.getState().householdWatchlist.find(item =>
    item.memberId === "MEM-004" && item.titleId === "TTL-SUMMER-KITE"
  );
  assert.equal(entry.priority, "high");
  assert.equal(entry._provenance.confidence, "adult_confirmed");
});

await test("memory", "watchlist removal removes the matching member-title pair", () => {
  const { memory, tools } = createHarness();
  tools.update_household_context({
    updateType: "watchlist_item",
    payload: {
      memberId: "MEM-001",
      titleId: "TTL-STARWARD",
      field: "watchlistStatus",
      value: "removed"
    },
    commandId: "watchlist-remove-item"
  });
  assert(!memory.getState().householdWatchlist.some(item =>
    item.memberId === "MEM-001" && item.titleId === "TTL-STARWARD"
  ));
});

await test("memory", "child rating exception requires one-time scope", () => {
  const { tools } = createHarness("SG-010");
  assert.throws(() => tools.update_household_context({
    updateType: "title_rating_exception",
    payload: { memberId: "MEM-004", titleId: "TTL-WILDFLOWER", approved: true },
    scope: "permanent",
    commandId: "rating-permanent"
  }), /one-time scope/);
});

await test("memory", "child rating exception rejects an adult viewer", () => {
  const { tools } = createHarness("SG-010");
  assert.throws(() => tools.update_household_context({
    updateType: "title_rating_exception",
    payload: { memberId: "MEM-001", titleId: "TTL-WILDFLOWER", approved: true },
    scope: "one_time",
    commandId: "rating-adult"
  }), /under age 18/);
});

await test("memory", "valid child rating exception is title and child specific", () => {
  const { memory, tools } = createHarness("SG-010");
  tools.update_household_context({
    updateType: "title_rating_exception",
    payload: { memberId: "MEM-004", titleId: "TTL-WILDFLOWER", approved: true },
    scope: "one_time",
    commandId: "rating-one-time"
  });
  const exception = memory.getState().familyRules.contentRatingExceptions.find(item =>
    item.memberId === "MEM-004" && item.titleId === "TTL-WILDFLOWER"
  );
  assert.equal(exception.scope, "one_time");
  assert.equal(exception.approved, true);
});

await test("memory", "budget update requires a positive number", () => {
  const { tools } = createHarness();
  assert.throws(() => tools.update_household_context({
    updateType: "family_rule",
    payload: { rule: "monthlyBudgetCap", value: 0 },
    commandId: "budget-zero"
  }), /greater than zero/);
});

await test("memory", "budget update persists explicit adult value", () => {
  const { memory, tools } = createHarness();
  tools.update_household_context({
    updateType: "family_rule",
    payload: { rule: "monthlyBudgetCap", value: 90 },
    commandId: "budget-ninety"
  });
  assert.equal(memory.getState().familyRules.monthlyBudgetCap, 90);
});

await test("memory", "additional escalation can be added and removed", () => {
  const { memory, tools } = createHarness();
  const condition = "Ask before any annual commitment.";
  tools.update_household_context({
    updateType: "additional_escalation",
    payload: { condition },
    commandId: "escalation-add"
  });
  assert(memory.getState().familyRules.additionalEscalations.includes(condition));
  tools.update_household_context({
    updateType: "remove_additional_escalation",
    payload: { condition },
    commandId: "escalation-remove"
  });
  assert(!memory.getState().familyRules.additionalEscalations.includes(condition));
});

await test("memory", "external action requires explicit completion", () => {
  const { tools } = createHarness();
  assert.throws(() => tools.update_household_context({
    updateType: "external_action_confirmation",
    payload: {
      serviceId: "SVC-AURORA",
      newStatus: "canceled",
      confirmed: false
    },
    commandId: "external-not-confirmed"
  }), /Explicit completion confirmation/);
});

await test("memory", "confirmed cancellation updates status and savings once", () => {
  const { memory, tools } = createHarness();
  tools.update_household_context({
    updateType: "external_action_confirmation",
    payload: {
      serviceId: "SVC-AURORA",
      newStatus: "canceled",
      confirmed: true
    },
    commandId: "external-cancel-1"
  });
  const state = memory.getState();
  assert.equal(state.subscriptions.find(item => item.serviceId === "SVC-AURORA").status, "canceled");
  assert.equal(state.recommendationSavingsEvents.filter(item => item.serviceId === "SVC-AURORA").length, 1);
  assert.equal(state.review.externalActionConfirmed, true);
});

await test("memory", "duplicate command IDs are idempotent", () => {
  const { memory, tools } = createHarness();
  const command = {
    updateType: "subscription_record",
    payload: {
      serviceId: "SVC-AURORA",
      field: "monthlyCost",
      value: 14.99
    },
    commandId: "duplicate-price-command"
  };
  tools.update_household_context(command);
  const firstLogCount = memory.getState().subscriptionChangeLog.length;
  tools.update_household_context(command);
  assert.equal(memory.getState().subscriptionChangeLog.length, firstLogCount);
  assert.equal(
    memory.getState().appliedCommandIds.filter(id => id === command.commandId).length,
    1
  );
});

await test("memory", "stale household revision is rejected", () => {
  const { memory, tools } = createHarness();
  const staleRevision = memory.householdRevision();
  tools.update_household_context({
    updateType: "family_rule",
    payload: { rule: "monthlyBudgetCap", value: 80 },
    commandId: "revision-first"
  });
  assert.throws(() => tools.update_household_context({
    updateType: "family_rule",
    payload: { rule: "monthlyBudgetCap", value: 85 },
    commandId: "revision-stale",
    expectedHouseholdRevision: staleRevision
  }), error => error?.code === "revision_conflict");
});

await test("memory", "export contains durable memory but no session chat", () => {
  const { memory, tools } = createHarness();
  tools.send_chat_response({ text: "A retained in-scope chat message." });
  const exported = memory.exportHouseholdData();
  assert.equal(exported.format, memoryFactory.householdDataFormat);
  assert(exported.household);
  assert(!("messages" in exported.household));
  assert(!("review" in exported.household));
});

await test("memory", "import restores household and resets the session", () => {
  const source = createHarness();
  source.tools.update_household_context({
    updateType: "family_rule",
    payload: { rule: "monthlyBudgetCap", value: 92 },
    commandId: "export-budget"
  });
  const exported = source.memory.exportHouseholdData();
  const target = createHarness();
  target.tools.send_chat_response({ text: "Temporary session message." });
  const imported = target.memory.importHouseholdData(exported);
  assert.equal(imported.familyRules.monthlyBudgetCap, 92);
  assert.equal(imported.messages.length, 0);
  assert.equal(imported.review.generatedRecommendation, null);
});

await test("memory", "reload preserves durable and session state", () => {
  const { memory, tools } = createHarness();
  tools.update_household_context({
    updateType: "family_rule",
    payload: { rule: "monthlyBudgetCap", value: 88 },
    commandId: "reload-budget"
  });
  tools.send_chat_response({ text: "Reload me." });
  const reloaded = memory.reload();
  assert.equal(reloaded.familyRules.monthlyBudgetCap, 88);
  assert(reloaded.messages.some(message => message.text === "Reload me."));
});

await test("memory", "sensitive chat text is not retained", () => {
  const { memory, tools } = createHarness();
  tools.send_chat_response({ text: "My password is secret12345" });
  assert(!memory.getState().messages.some(message => /secret12345/.test(message.text)));
});

// Financial and date math.
const subscriptionFixture = [
  { serviceId: "A", service: "A", status: "active", monthlyCost: 9.99 },
  { serviceId: "B", service: "B", status: "active", monthlyCost: 12.01 },
  { serviceId: "C", service: "C", status: "paused", monthlyCost: 7.5 }
];

await test("financial_math", "monthly costs use currency-safe summation", () => {
  assert.equal(math.sumMonthlyCosts(subscriptionFixture), 22);
});

await test("financial_math", "subscription counts respect status", () => {
  assert.equal(math.countSubscriptions(subscriptionFixture), 2);
  assert.equal(math.countSubscriptions(subscriptionFixture, null), 3);
});

for (const [spend, cap, remaining, overage, utilization] of [
  [50, 75, 25, 0, 66.66666666666666],
  [75, 75, 0, 0, 100],
  [79.94, 75, -4.94, 4.94, (7994 / 7500) * 100]
]) {
  await test("financial_math", `budget utilization ${spend} of ${cap}`, () => {
    const result = math.calculateBudgetUtilization(spend, cap);
    assert.equal(result.remaining, remaining);
    assert.equal(result.overage, overage);
    assert.equal(result.utilizationPercent, utilization);
  });
}

await test("financial_math", "zero budget is rejected", () => {
  assert.throws(() => math.calculateBudgetUtilization(10, 0), /greater than zero/);
});

await test("financial_math", "subscription change annualizes exactly", () => {
  const result = math.calculateSubscriptionChangeImpact({
    beforeMonthly: 62.95,
    afterMonthly: 79.94,
    monthlyBudgetCap: 75
  });
  assert.equal(result.monthlyChange, 16.99);
  assert.equal(result.annualChange, 203.88);
  assert.equal(result.afterBudget.overage, 4.94);
});

await test("financial_math", "active cancellation impact is correct", () => {
  const result = math.calculateCancellationImpact({
    subscriptions: subscriptionFixture,
    targetServiceId: "B",
    monthlyBudgetCap: 75,
    projectionMonths: 12
  });
  assert.equal(result.beforeActionMonthly, 22);
  assert.equal(result.afterActionMonthly, 9.99);
  assert.equal(result.monthlySavings, 12.01);
  assert.equal(result.projectedSavings, 144.12);
  assert.equal(result.afterActionSubscriptionCount, 1);
});

await test("financial_math", "inactive cancellation reconstructs before state", () => {
  const canceled = subscriptionFixture.map(item =>
    item.serviceId === "B" ? { ...item, status: "canceled" } : item
  );
  const result = math.calculateCancellationImpact({
    subscriptions: canceled,
    targetServiceId: "B",
    monthlyBudgetCap: 75,
    projectionMonths: 12
  });
  assert.equal(result.activeMonthly, 9.99);
  assert.equal(result.beforeActionMonthly, 22);
  assert.equal(result.afterActionMonthly, 9.99);
});

await test("financial_math", "negative projection is rejected", () => {
  assert.throws(() => math.calculateCancellationImpact({
    subscriptions: subscriptionFixture,
    targetServiceId: "A",
    monthlyBudgetCap: 75,
    projectionMonths: -1
  }), /cannot be negative/);
});

await test("financial_math", "annual plan monthly equivalent rounds to cents", () => {
  assert.equal(math.monthlyEquivalent({ price: 119.88, billingCadence: "annual" }), 9.99);
});

await test("financial_math", "unsupported billing cadence is rejected", () => {
  assert.throws(() => math.monthlyEquivalent({ price: 10, billingCadence: "weekly" }), /Unsupported/);
});

await test("financial_math", "monthly subscribe impact includes upfront and annual effect", () => {
  const result = math.calculatePlanFinancialImpact({
    subscriptions: subscriptionFixture,
    action: "subscribe",
    targetService: "D",
    targetServiceId: "D",
    targetPlan: {
      billingCadence: "monthly",
      monthlyPrice: 13.99,
      upfrontCost: 13.99
    },
    monthlyBudgetCap: 75,
    projectionMonths: 12
  });
  assert.equal(result.proposedMonthly, 35.99);
  assert.equal(result.projectedIncrease, 167.88);
  assert.equal(result.upfrontCost, 13.99);
});

await test("financial_math", "annual subscribe impact uses monthly equivalent and upfront price", () => {
  const result = math.calculatePlanFinancialImpact({
    subscriptions: subscriptionFixture,
    action: "subscribe",
    targetService: "D",
    targetServiceId: "D",
    targetPlan: {
      billingCadence: "annual",
      annualPrice: 119.88,
      upfrontCost: 119.88
    },
    monthlyBudgetCap: 75,
    projectionMonths: 12
  });
  assert.equal(result.monthlyIncrease, 9.99);
  assert.equal(result.projectedIncrease, 119.88);
  assert.equal(result.upfrontCost, 119.88);
});

await test("financial_math", "pause savings stop at the selected duration", () => {
  const result = math.calculatePlanFinancialImpact({
    subscriptions: subscriptionFixture,
    action: "pause",
    targetServiceId: "B",
    monthlyBudgetCap: 75,
    projectionMonths: 12,
    pauseDurationMonths: 2
  });
  assert.equal(result.pauseDurationMonths, 2);
  assert.equal(result.projectedSavings, 24.02);
  assert.equal(result.postPauseMonthly, 22);
});

await test("financial_math", "pause requires a positive duration", () => {
  assert.throws(() => math.calculatePlanFinancialImpact({
    subscriptions: subscriptionFixture,
    action: "pause",
    targetServiceId: "B",
    monthlyBudgetCap: 75,
    pauseDurationMonths: 0
  }), /greater than zero/);
});

await test("financial_math", "keep leaves all financial values unchanged", () => {
  const result = math.calculatePlanFinancialImpact({
    subscriptions: subscriptionFixture,
    action: "keep",
    monthlyBudgetCap: 75,
    projectionMonths: 12
  });
  assert.equal(result.currentMonthly, result.proposedMonthly);
  assert.equal(result.projectedChange, 0);
});

for (const [start, end, expected] of [
  ["2026-07-29", "2026-07-30", 1],
  ["2026-07-29", "2026-07-29", 0],
  ["2026-07-30", "2026-07-29", -1],
  ["2026-12-31", "2027-01-01", 1]
]) {
  await test("financial_math", `calendar days ${start} to ${end}`, () => {
    assert.equal(math.daysBetween(start, end), expected);
  });
}

await test("financial_math", "date addition crosses month and year boundaries", () => {
  assert.equal(math.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(math.addDays("2026-03-01", -1), "2026-02-28");
});

// Safety, validation, URL grounding, and context isolation.
const fakeApiKey = `sk-${"abcdefghijklmnopqrstuvwxyz"}`;
for (const text of [
  "My password is hunter2",
  "My CVV is 123",
  "The authentication code is 123456",
  `My API key is ${fakeApiKey}`,
  "Bearer abcdefghijklmnopqrstuvwxyz",
  "4111 1111 1111 1111"
]) {
  await test("safety_validation", `sensitive input detected: ${text.slice(0, 18)}`, () => {
    assert.equal(memoryFactory.containsSensitiveAccountInformation(text), true);
  });
}

for (const text of [
  "Aurora+ costs $12.99",
  "The title is rated PG-13",
  "Pause for 60 days",
  "My monthly budget is $75"
]) {
  await test("safety_validation", `ordinary planning input retained: ${text}`, () => {
    assert.equal(memoryFactory.containsSensitiveAccountInformation(text), false);
  });
}

for (const query of [
  "Give me a pasta recipe",
  "Can you save me $10 a month on groceries?",
  "Draft an email to my manager",
  "Tell me a joke",
  "What is the weather?"
]) {
  await test("safety_validation", `out-of-scope isolation: ${query}`, () => {
    const state = context.createSeedState("SG-001");
    const packet = selector.select({
      state,
      knowledge,
      decisionPacket: engine.buildDecisionPacket(state),
      userText: query,
      requestType: "conversation"
    });
    assert.equal(packet.contextPlan.intent, "out_of_scope");
    assert.equal(packet.householdContext.current_subscriptions.length, 0);
    assert.equal(packet.householdContext.household_watchlist.length, 0);
    assert.equal(packet.servicePlans.length, 0);
  });
}

await test("safety_validation", "pure execution request receives no household viewing context", () => {
  const state = context.createSeedState("SG-004");
  const packet = selector.select({
    state,
    knowledge,
    decisionPacket: engine.buildDecisionPacket(state),
    userText: "Subscribe to Summit+ for me now",
    requestType: "conversation"
  });
  assert.equal(packet.contextPlan.intent, "external_execution_request");
  assert.equal(packet.householdContext.household_watchlist.length, 0);
  assert.equal(packet.householdContext.viewing_information.length, 0);
});

await test("safety_validation", "valid account URL passes and invented URL fails", () => {
  const { tools } = createHarness();
  assert.equal(tools.validate_output_url({
    serviceId: "SVC-AURORA",
    url: "https://www.auroraplus.com/"
  }).valid, true);
  assert.equal(tools.validate_output_url({
    serviceId: "SVC-AURORA",
    url: "https://example.com/cancel"
  }).valid, false);
});

await test("safety_validation", "complete no-signal sweep remains silent", () => {
  const signals = Object.fromEntries(toolsFactory.sweepSignalKeys.map(key => [key, false]));
  const result = toolsFactory.evaluateSweepSignals(signals);
  assert.equal(result.status, "no_action");
  assert.equal(result.shouldNotify, false);
  assert.equal(result.recommendation, null);
});

await test("safety_validation", "incomplete sweep signal set is rejected", () => {
  assert.throws(() => toolsFactory.evaluateSweepSignals({ underuseSignal: true }), /incomplete/);
});

await test("safety_validation", "ordinary conversation response validates", () => {
  assert.doesNotThrow(() => client.validateConversationResponse(
    validConversation(),
    null,
    decisionPacket("SG-001"),
    context.createSeedState("SG-001")
  ));
});

await test("safety_validation", "out-of-scope response cannot update memory", () => {
  const candidate = validConversation({
    reply: "That request is outside Streaming Guard's scope.",
    turnType: "out_of_scope",
    safetyDisposition: "out_of_scope",
    proposedHouseholdUpdates: [{
      updateType: "family_rule",
      targetId: "HH-001",
      relatedId: "",
      field: "monthlyBudgetCap",
      value: "80",
      effectiveDate: "",
      scope: "permanent",
      requiresAdultConfirmation: false
    }]
  });
  assert.throws(() => client.validateConversationResponse(
    candidate,
    null,
    decisionPacket("SG-001"),
    context.createSeedState("SG-001")
  ), /Only explicit new information|out-of-scope turn cannot/);
});

await test("safety_validation", "execution refusal requires four complete sections", () => {
  const candidate = validConversation({
    reply: "I cannot do that.",
    turnType: "execution_request",
    safetyDisposition: "execution_refused",
    refusalSections: {
      yourRequest: "Cancel Aurora+.",
      myResponse: "I cannot change the account.",
      whyRefusing: "",
      whatYouCanDoNext: "Please use the service account."
    }
  });
  assert.throws(() => client.validateConversationResponse(
    candidate,
    null,
    decisionPacket("SG-001"),
    context.createSeedState("SG-001")
  ), /all four required/);
});

await test("safety_validation", "billing escalation requires a validated support URL", () => {
  const candidate = validConversation({
    reply: "Please contact the provider.",
    turnType: "safety_escalation",
    safetyDisposition: "billing_or_legal_escalation",
    nextExpectedInput: "none"
  });
  assert.throws(() => client.validateConversationResponse(
    candidate,
    null,
    decisionPacket("SG-013"),
    context.createSeedState("SG-013")
  ), /validated support URL/);
});

await test("safety_validation", "unsupported URL in conversation is rejected", () => {
  const candidate = validConversation({
    reply: "Please use https://attacker.example/cancel."
  });
  assert.throws(() => client.validateConversationResponse(
    candidate,
    null,
    decisionPacket("SG-001"),
    context.createSeedState("SG-001")
  ), /unvalidated URL/);
});

await test("safety_validation", "invalid judge pass with material gaps is rejected", () => {
  assert.throws(() => client.validateEvaluationJudgment({
    rubricPassed: true,
    humanControlPassed: true,
    rubricAssessment: "Looks good.",
    humanControlAssessment: "Human control is present.",
    strengths: ["Grounded"],
    gaps: ["Missing a required fact"]
  }), /passed while reporting material gaps/);
});

await test("safety_validation", "child restriction applies to an intended child", () => {
  const state = context.createSeedState("SG-009");
  const packet = engine.buildDecisionPacket(state);
  assert(packet.childSafety.conflicts.length > 0);
  assert(packet.childSafety.intendedChildren.some(child => child.memberId === "MEM-004"));
  assert.deepEqual(Array.from(packet.allowedActions), ["request_adult_judgment"]);
});

await test("safety_validation", "adult-only title does not create a child conflict", () => {
  const state = context.createSeedState("SG-001");
  state.scenario.intendedViewerIds = ["MEM-001"];
  state.householdWatchlist = state.householdWatchlist.filter(entry =>
    entry.titleId !== state.scenario.titleId || entry.memberId === "MEM-001"
  );
  const packet = engine.buildDecisionPacket(state);
  assert.equal(packet.childSafety.conflicts.length, 0);
});

// Workflow state machine and UI/provider compatibility smoke tests.
await test("workflow", "complete external-action workflow reaches completed", () => {
  let state = workflow.initial();
  for (const event of [
    "INPUT_RECEIVED",
    "CONTEXT_SELECTED",
    "DECISION_REQUESTED",
    "OUTPUT_VALIDATED",
    "DISCUSSION_OPENED",
    "ADULT_AGREED",
    "EXTERNAL_ACTION_CONFIRMED"
  ]) {
    state = workflow.transition(state, event, { timestamp: fixedClock() });
  }
  assert.equal(state.state, "completed");
  assert.equal(state.history.length, 7);
});

await test("workflow", "keep decision completes without external action", () => {
  let state = workflow.initial();
  for (const event of [
    "INPUT_RECEIVED",
    "CONTEXT_SELECTED",
    "DECISION_REQUESTED",
    "OUTPUT_VALIDATED",
    "DISCUSSION_OPENED",
    "COMPLETE_WITHOUT_ACTION"
  ]) {
    state = workflow.transition(state, event, { timestamp: fixedClock() });
  }
  assert.equal(state.state, "completed");
});

await test("workflow", "external confirmation before agreement is rejected", () => {
  assert.throws(() => workflow.transition(
    workflow.initial(),
    "EXTERNAL_ACTION_CONFIRMED",
    { timestamp: fixedClock() }
  ), error => error?.code === "invalid_workflow_transition");
});

await test("workflow", "execution refusal follows input", () => {
  let state = workflow.transition(workflow.initial(), "INPUT_RECEIVED", { timestamp: fixedClock() });
  state = workflow.transition(state, "EXECUTION_REFUSED", { timestamp: fixedClock() });
  assert.equal(state.state, "refused");
});

await test("workflow", "revisit reopens a completed recommendation", () => {
  let state = { ...workflow.initial(), state: "completed" };
  state = workflow.transition(state, "REVISIT_REQUESTED", { timestamp: fixedClock() });
  assert.equal(state.state, "adult_discussion");
});

await test("provider_ui", "model catalog contains all three providers", () => {
  assert.deepEqual(
    [...new Set(client.MODEL_OPTIONS.map(option => option.provider))].sort(),
    ["anthropic", "google", "openai"]
  );
});

await test("provider_ui", "provider settings require both selected model keys", () => {
  const storage = createStorage();
  assert.throws(() => client.saveSettings({
    openaiApiKey: "test-openai",
    anthropicApiKey: "",
    geminiApiKey: "",
    model: "gpt-5.6-terra",
    judgeModel: "claude-haiku-4-5-20251001"
  }, storage), /Add an API key for the selected Anthropic model/);
  assert.equal(storage.values.size, 0);
});

await test("provider_ui", "provider keys can be cleared without corrupting model defaults", () => {
  const storage = createStorage();
  client.saveSettings({
    openaiApiKey: "test-openai",
    anthropicApiKey: "test-anthropic",
    geminiApiKey: "test-google",
    model: "gpt-5.6-terra",
    judgeModel: "gpt-5.6-luna"
  }, storage);
  client.clearSettings(storage);
  const settings = client.readSettings(storage);
  assert.equal(settings.openaiApiKey, "");
  assert.equal(settings.anthropicApiKey, "");
  assert.equal(settings.geminiApiKey, "");
});

await test("provider_ui", "all structured schemas are strict objects", () => {
  for (const schema of [
    client.recommendationSchema(),
    client.conversationResponseSchema(),
    client.evaluationJudgmentSchema()
  ]) {
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
    assert(Array.isArray(schema.required));
  }
});

await test("provider_ui", "external-action recommendation fields preserve the record confirmation gate", () => {
  const schema = client.recommendationSchema();
  assert(schema.properties.reminderHeadline.description.includes(
    "record remains unchanged until the adult confirms completing the external action"
  ));
  assert(schema.properties.reminderHeadline.description.includes(
    "Do not use this field for a future-release reminder"
  ));
  assert(schema.properties.reminderDetails.description.includes(
    "updates the subscription record only after the adult confirms completing the external action"
  ));
});

await test("provider_ui", "responsive top-level views and chat controls exist", () => {
  const markup = fs.readFileSync("index.html", "utf8");
  for (const id of [
    "chatTab",
    "contextTab",
    "spendingTab",
    "evaluationsTab",
    "restartChat",
    "downloadFullChat",
    "chatFullscreenToggle",
    "exportHouseholdData",
    "importHouseholdData"
  ]) {
    assert(markup.includes(`id="${id}"`), `Missing UI control ${id}`);
  }
});

await test("provider_ui", "recommendation, refusal, and outcome cards render", () => {
  const state = context.createSeedState("SG-001");
  const refusal = ui.messageMarkup({
    kind: "refusal",
    role: "agent",
    text: "",
    time: "7:00 PM",
    refusalSections: {
      yourRequest: "Cancel Aurora+.",
      myResponse: "I cannot change the external account.",
      whyRefusing: "Streaming Guard is advisory only.",
      whatYouCanDoNext: "Please use the service account page."
    }
  }, {
    state,
    recommendation: null,
    accountUrl: "",
    activeControl: true
  });
  assert(refusal.includes("Execution refusal"));
  assert(refusal.includes("What you can do next"));
});

await test("memory", "an explicitly approved preference note is written through the controlled tool", () => {
  const harness = createHarness();
  harness.tools.update_household_context({
    updateType: "preference_note",
    payload: { preference: "Prefer cancellations only when monthly savings exceed $5." },
    source: "adult_feedback_approved",
    scope: "permanent"
  });
  const saved = harness.memory.getState().familyRules.preferenceNotes;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].source, "adult_feedback_approved");
  const contextMarkup = ui.memoryMarkup(harness.memory.getState());
  assert(contextMarkup.includes("Saved household preferences"));
  assert(contextMarkup.includes("Prefer cancellations only when monthly savings exceed $5."));
  assert(contextMarkup.includes("Ongoing · future recommendations"));
});

await test("provider_ui", "post-resolution recommendation feedback is scannable and explains approval", () => {
  const markup = ui.feedbackMarkup({ submitted: false });
  assert(markup.includes("Poor recommendation"));
  assert(markup.includes("explicitly approve"));
  assert(!markup.includes("regression"));
  assert(!markup.includes("createRegression"));
});

await test("safety_validation", "poor feedback creates one reviewer-controlled regression draft", () => {
  storageValues.delete("streaming_guard_feedback_and_regressions_v1");
  const savedFeedback = feedback.recordFeedback({
    scenarioId: "SG-001",
    recommendationVersion: 2,
    recommendationInstanceId: "component-recommendation-2",
    recommendationAction: "cancel",
    rating: "poor",
    reasons: ["Timing was wrong"],
    comment: "Do not cancel this close to a release."
  });
  const candidate = feedback.captureRegressionCandidate({
    sourceType: "recommendation_feedback",
    sourceKey: savedFeedback.id,
    title: "Timing regression",
    failureSummary: savedFeedback.comment
  });
  feedback.captureRegressionCandidate({
    sourceType: "recommendation_feedback",
    sourceKey: savedFeedback.id,
    title: "Duplicate"
  });
  assert.equal(candidate.reviewerRequired, true);
  assert.equal(candidate.status, "draft");
  assert.equal(feedback.regressionCandidates().length, 1);
});

await test("safety_validation", "regression export cannot silently promote a draft into official evals", () => {
  const payload = feedback.exportPayload();
  assert.equal(payload.exportType, "Draft regression candidates");
  assert(payload.notice.includes("human review"));
  assert(payload.candidates.every(candidate =>
    candidate.status === "draft" && candidate.reviewerRequired === true
  ));
});

const categoryScores = Object.fromEntries(
  [...new Set(results.map(result => result.category))].map(category => {
    const categoryResults = results.filter(result => result.category === category);
    const passed = categoryResults.filter(result => result.passed).length;
    return [category, {
      passed,
      total: categoryResults.length,
      successRate: Number(((passed / categoryResults.length) * 100).toFixed(1))
    }];
  })
);
const passed = results.filter(result => result.passed).length;
const report = {
  generatedAt: new Date().toISOString(),
  testType: "deterministic_component_quality",
  passed,
  total: results.length,
  successRate: Number(((passed / results.length) * 100).toFixed(1)),
  targetSuccessRate: 100,
  categoryScores,
  failures: results.filter(result => !result.passed)
};
fs.mkdirSync("tests/reports", { recursive: true });
fs.writeFileSync(
  "tests/reports/component_quality_results.json",
  `${JSON.stringify(report, null, 2)}\n`
);

console.log(`Deterministic component quality: ${passed}/${results.length} passed (${report.successRate}%).`);
Object.entries(categoryScores).forEach(([category, score]) => {
  console.log(`- ${category}: ${score.passed}/${score.total} (${score.successRate}%)`);
});
if (report.failures.length) {
  console.log("Failures:");
  report.failures.forEach(failure => console.log(`- ${failure.category} · ${failure.name}: ${failure.error.split("\n")[0]}`));
  process.exitCode = 1;
}
