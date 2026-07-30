import fs from "node:fs";
import vm from "node:vm";

const storageValues = new Map();
const storage = {
  getItem: key => storageValues.get(key) ?? null,
  setItem: (key, value) => storageValues.set(key, String(value)),
  removeItem: key => storageValues.delete(key)
};
const window = {
  localStorage: storage,
  location: { protocol: "file:" },
  fetch: async () => {
    throw new Error("Network calls are disabled in the context-search benchmark.");
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
  "js/context-selector.js"
]) {
  vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

const knowledge = window.StreamingGuardKnowledge;
const context = window.StreamingGuardContext;
const engine = window.StreamingGuardRecommendationEngine;
const selector = window.StreamingGuardContextSelector;

function expected({
  id,
  category,
  scenario = "SG-001",
  query,
  intent,
  scope,
  services = [],
  titles = [],
  members = [],
  excludeServices = [],
  excludeTitles = [],
  minimumWatchlist = null,
  minimumViewing = null,
  minimumSubscriptions = null,
  minimumPlans = null,
  coverage = null
}) {
  return {
    id,
    category,
    scenario,
    query,
    intent,
    scope,
    services,
    titles,
    members,
    excludeServices,
    excludeTitles,
    minimumWatchlist,
    minimumViewing,
    minimumSubscriptions,
    minimumPlans,
    coverage
  };
}

const cases = [
  // Direct keyword and entity retrieval.
  expected({ id: "K01", category: "keyword", scenario: "SG-001", query: "Tell me about Starward Station", titles: ["TTL-STARWARD"], services: ["SVC-AURORA"] }),
  expected({ id: "K02", category: "keyword", scenario: "SG-002", query: "What is happening with The Glass Garden?", titles: ["TTL-GARDEN"], services: ["SVC-ORBIT"] }),
  expected({ id: "K03", category: "keyword", scenario: "SG-003", query: "Review Harbor Kitchen", titles: ["TTL-HARBOR"], services: ["SVC-TRIO"] }),
  expected({ id: "K04", category: "keyword", scenario: "SG-004", query: "Where can we watch Copper Skies?", titles: ["TTL-COPPER"], services: ["SVC-SUMMIT"] }),
  expected({ id: "K05", category: "keyword", scenario: "SG-005", query: "When does The Last Mariner move?", titles: ["TTL-MARINER"], services: ["SVC-TIDE", "SVC-VIEWFLIX"] }),
  expected({ id: "K06", category: "keyword", scenario: "SG-006", query: "Is Orchard House available?", titles: ["TTL-ORCHARD"], services: ["SVC-EMBER"] }),
  expected({ id: "K07", category: "keyword", scenario: "SG-006", query: "Who wants Frequency Club?", titles: ["TTL-FREQUENCY"], services: ["SVC-EMBER"], members: ["MEM-003"] }),
  expected({ id: "K08", category: "keyword", scenario: "SG-006", query: "Review The Midnight Map", titles: ["TTL-MIDNIGHT-MAP"], services: ["SVC-EMBER"] }),
  expected({ id: "K09", category: "keyword", scenario: "SG-007", query: "When is Clockwork County back?", titles: ["TTL-CLOCKWORK"], services: ["SVC-MEADOW"] }),
  expected({ id: "K10", category: "keyword", scenario: "SG-009", query: "Is After Dark Harbor allowed for Casey?", titles: ["TTL-AFTER-DARK"], services: ["SVC-LANTERN"], members: ["MEM-004"] }),
  expected({ id: "K11", category: "keyword", scenario: "SG-012", query: "Who is watching Blue Hour Animals?", titles: ["TTL-BLUE-HOUR"], services: ["SVC-QUIET"], members: ["MEM-003", "MEM-004"] }),
  expected({ id: "K12", category: "keyword", scenario: "SG-012", query: "Did Jordan finish The Summer Kite?", titles: ["TTL-SUMMER-KITE"], services: ["SVC-QUIET"], members: ["MEM-002"] }),
  expected({ id: "K13", category: "keyword", query: "What plans does Aurora+ offer?", services: ["SVC-AURORA"], excludeServices: ["SVC-ORBIT"] }),
  expected({ id: "K14", category: "keyword", query: "Show Orbit+ pricing", services: ["SVC-ORBIT"], excludeServices: ["SVC-AURORA"] }),
  expected({ id: "K15", category: "keyword", query: "Explain the TrioStream bundle", services: ["SVC-TRIO"] }),
  expected({ id: "K16", category: "keyword", query: "What does Summit+ cost?", services: ["SVC-SUMMIT"] }),
  expected({ id: "K17", category: "keyword", query: "Compare TidePlay plans", services: ["SVC-TIDE"] }),
  expected({ id: "K18", category: "keyword", query: "Is ViewFlix active?", services: ["SVC-VIEWFLIX"] }),
  expected({ id: "K19", category: "keyword", query: "Does EmberScreen have an ad-free plan?", services: ["SVC-EMBER"] }),
  expected({ id: "K20", category: "keyword", query: "How long can MeadowTV be paused?", services: ["SVC-MEADOW"] }),
  expected({ id: "K21", category: "keyword", query: "What are the Lantern+ rating options?", services: ["SVC-LANTERN"] }),
  expected({ id: "K22", category: "keyword", query: "What does QuietFlix cost?", services: ["SVC-QUIET"] }),
  expected({ id: "K23", category: "keyword", query: "What is on Morgan's watchlist?", members: ["MEM-001"] }),
  expected({ id: "K24", category: "keyword", query: "What has Jordan completed?", members: ["MEM-002"] }),
  expected({ id: "K25", category: "keyword", query: "What is Riley watching?", members: ["MEM-003"] }),
  expected({ id: "K26", category: "keyword", query: "What is appropriate for Casey?", members: ["MEM-004"] }),
  expected({ id: "K27", category: "keyword", query: "What subscriptions do we have?", intent: "subscription_inventory", scope: "subscription_inventory" }),
  expected({ id: "K28", category: "keyword", query: "How much do we spend on streaming?", intent: "spending_review", scope: "household_wide" }),
  expected({ id: "K29", category: "keyword", query: "Who are the kids in this household?", intent: "household_roster", members: ["MEM-003", "MEM-004"], excludeTitles: ["TTL-SATELLITE-KIDS"] }),
  expected({ id: "K30", category: "keyword", query: "Can Streaming Guard work in production?", intent: "product_meta" }),
  expected({ id: "K31", category: "keyword", query: "Subscribe to Summit+ for me now", intent: "external_execution_request", services: ["SVC-SUMMIT"], excludeTitles: ["TTL-COPPER"] }),
  expected({ id: "K32", category: "keyword", query: "What time is it?", intent: "out_of_scope", excludeServices: ["SVC-AURORA"], excludeTitles: ["TTL-STARWARD"] }),

  // Semantic and relationship-based retrieval without exact title wording.
  expected({ id: "S01", category: "semantic", scenario: "SG-001", query: "Which science-fiction series did Morgan and Riley just finish?", titles: ["TTL-STARWARD"], services: ["SVC-AURORA"], members: ["MEM-001", "MEM-003"], minimumViewing: 2 }),
  expected({ id: "S02", category: "semantic", scenario: "SG-002", query: "Find the mystery limited series Riley has not confirmed finishing", titles: ["TTL-GARDEN"], services: ["SVC-ORBIT"], members: ["MEM-003"] }),
  expected({ id: "S03", category: "semantic", scenario: "SG-003", query: "Which cooking show did Jordan complete?", titles: ["TTL-HARBOR"], services: ["SVC-TRIO"], members: ["MEM-002"] }),
  expected({ id: "S04", category: "semantic", scenario: "SG-004", query: "Show the unstarted adventure movie Morgan wants on Summit", titles: ["TTL-COPPER"], services: ["SVC-SUMMIT"], members: ["MEM-001"] }),
  expected({ id: "S05", category: "semantic", scenario: "SG-005", query: "Find the PG-13 maritime movie moving to a service we already pay for", titles: ["TTL-MARINER"], services: ["SVC-TIDE", "SVC-VIEWFLIX"] }),
  expected({ id: "S06", category: "semantic", scenario: "SG-006", query: "Which high-priority period drama for Jordan arrives on Ember?", titles: ["TTL-ORCHARD"], services: ["SVC-EMBER"], members: ["MEM-002"] }),
  expected({ id: "S07", category: "semantic", scenario: "SG-006", query: "Find Riley's high-priority music documentary releasing weekly on Ember", titles: ["TTL-FREQUENCY"], services: ["SVC-EMBER"], members: ["MEM-003"] }),
  expected({ id: "S08", category: "semantic", scenario: "SG-006", query: "Which medium-priority mystery movie for Morgan lands on Ember?", titles: ["TTL-MIDNIGHT-MAP"], services: ["SVC-EMBER"], members: ["MEM-001"] }),
  expected({ id: "S09", category: "semantic", scenario: "SG-007", query: "Which mystery show did both adults complete before the next season?", titles: ["TTL-CLOCKWORK"], services: ["SVC-MEADOW"], members: ["MEM-001", "MEM-002"] }),
  expected({ id: "S10", category: "semantic", scenario: "SG-009", query: "Find Casey's mature thriller that conflicts with the child's viewing limit", titles: ["TTL-AFTER-DARK"], services: ["SVC-LANTERN"], members: ["MEM-004"] }),
  expected({ id: "S11", category: "semantic", scenario: "SG-010", query: "Which weekly period drama is Jordan requesting right away?", titles: ["TTL-WILDFLOWER"], services: ["SVC-CHORUS"], members: ["MEM-002"] }),
  expected({ id: "S12", category: "semantic", scenario: "SG-011", query: "Find Riley's completed music documentary with a distant next season", titles: ["TTL-RIDGELINE"], services: ["SVC-CEDAR"], members: ["MEM-003"] }),
  expected({ id: "S13", category: "semantic", scenario: "SG-012", query: "Which nature documentary are the children currently watching?", titles: ["TTL-BLUE-HOUR"], services: ["SVC-QUIET"], members: ["MEM-003", "MEM-004"] }),
  expected({ id: "S14", category: "semantic", scenario: "SG-012", query: "Which family movie has Jordan already completed?", titles: ["TTL-SUMMER-KITE"], services: ["SVC-QUIET"], members: ["MEM-002"] }),
  expected({ id: "S15", category: "semantic", scenario: "SG-008", query: "Find the Canada-only crime drama Jordan wants", titles: ["TTL-GLASS-CITY"], services: ["SVC-NORTHLIGHT"], members: ["MEM-002"] }),
  expected({ id: "S16", category: "semantic", scenario: "SG-013", query: "Which comedy on CivicLive is connected to the household's disputed charge?", titles: ["TTL-LOCAL-FREQUENCY"], services: ["SVC-CIVICLIVE"] }),
  expected({ id: "S17", category: "semantic", query: "Which service lets us freeze billing for up to sixty days?", services: ["SVC-MEADOW"] }),
  expected({ id: "S18", category: "semantic", query: "Find the platform with a thirty-day billing suspension and retained profile", services: ["SVC-QUIET"] }),
  expected({ id: "S19", category: "semantic", query: "Which streaming memberships are we paying for?", intent: "subscription_inventory", scope: "subscription_inventory" }),
  expected({ id: "S20", category: "semantic", query: "Show me our lineup of paid platforms", intent: "subscription_inventory", scope: "subscription_inventory" }),
  expected({ id: "S21", category: "semantic", query: "How much of our monthly allowance is being used?", intent: "spending_review", scope: "household_wide" }),
  expected({ id: "S22", category: "semantic", query: "Can we lower the household entertainment bill?", intent: "spending_review", scope: "household_wide" }),
  expected({ id: "S23", category: "semantic", query: "Which platform should we add next?", intent: "subscription_discovery", scope: "household_wide" }),
  expected({ id: "S24", category: "semantic", query: "What membership best covers our viewing queue?", intent: "subscription_discovery", scope: "household_wide" }),
  expected({ id: "S25", category: "semantic", query: "Who lives in this home?", intent: "household_roster", members: ["MEM-001", "MEM-002", "MEM-003", "MEM-004"] }),
  expected({ id: "S26", category: "semantic", query: "Give me the children's names", intent: "household_roster", members: ["MEM-003", "MEM-004"] }),
  expected({ id: "S27", category: "semantic", query: "What are this prototype's real-world limitations?", intent: "product_meta" }),
  expected({ id: "S28", category: "semantic", query: "How well has the subscription planning agent been evaluated?", intent: "product_meta" }),
  expected({ id: "S29", category: "semantic", query: "Sign us up for Aurora", intent: "external_execution_request", services: ["SVC-AURORA"] }),
  expected({ id: "S30", category: "semantic", query: "Drop MeadowTV on my behalf", intent: "external_execution_request", services: ["SVC-MEADOW"] }),

  // Mixed keyword, fuzzy spelling, and semantic intent.
  expected({ id: "M01", category: "mixed", scenario: "SG-001", query: "How is Starwrd doing?", titles: ["TTL-STARWARD"], services: ["SVC-AURORA"] }),
  expected({ id: "M02", category: "mixed", query: "Show Aurorra pricing", services: ["SVC-AURORA"] }),
  expected({ id: "M03", category: "mixed", query: "What does Orbt Plus cost?", services: ["SVC-ORBIT"] }),
  expected({ id: "M04", category: "mixed", query: "Compare Tide Play and View Flix for the mariner movie", titles: ["TTL-MARINER"], services: ["SVC-TIDE", "SVC-VIEWFLIX"] }),
  expected({ id: "M05", category: "mixed", scenario: "SG-006", query: "Is EmbrScreen good for the music doc Riley wants?", titles: ["TTL-FREQUENCY"], services: ["SVC-EMBER"], members: ["MEM-003"] }),
  expected({ id: "M06", category: "mixed", scenario: "SG-007", query: "Can Medow TV be frozen until the county mystery returns?", titles: ["TTL-CLOCKWORK"], services: ["SVC-MEADOW"] }),
  expected({ id: "M07", category: "mixed", scenario: "SG-009", query: "Would Lanturn Plus be safe for Casey's dark harbor show?", titles: ["TTL-AFTER-DARK"], services: ["SVC-LANTERN"], members: ["MEM-004"] }),
  expected({ id: "M08", category: "mixed", scenario: "SG-002", query: "Did Rily finish the Glass Gardn?", titles: ["TTL-GARDEN"], services: ["SVC-ORBIT"], members: ["MEM-003"] }),
  expected({ id: "M09", category: "mixed", scenario: "SG-003", query: "What cooking series did Jordon complete?", titles: ["TTL-HARBOR"], members: ["MEM-002"] }),
  expected({ id: "M10", category: "mixed", query: "List our active subscriptons", intent: "subscription_inventory", scope: "subscription_inventory" }),
  expected({ id: "M11", category: "mixed", query: "How can we trim our streamng expenses?", intent: "spending_review", scope: "household_wide" }),
  expected({ id: "M12", category: "mixed", query: "Which new servce best covers the family's wishlist?", intent: "subscription_discovery", scope: "household_wide" }),

  // Clear negatives must not drag active scenario context into the request.
  expected({ id: "N01", category: "negative", query: "What is the weather tomorrow?", intent: "out_of_scope", excludeServices: ["SVC-AURORA"], excludeTitles: ["TTL-STARWARD"] }),
  expected({ id: "N02", category: "negative", query: "Give me a pasta recipe", intent: "out_of_scope", excludeServices: ["SVC-AURORA"], excludeTitles: ["TTL-STARWARD"] }),
  expected({ id: "N03", category: "negative", query: "Who did I feed today?", intent: "out_of_scope", excludeServices: ["SVC-AURORA"], excludeTitles: ["TTL-STARWARD"] }),
  expected({ id: "N04", category: "negative", query: "What was the baseball score?", intent: "out_of_scope", excludeServices: ["SVC-AURORA"], excludeTitles: ["TTL-STARWARD"] }),
  expected({ id: "N05", category: "negative", query: "Help with algebra homework", intent: "out_of_scope", excludeServices: ["SVC-AURORA"], excludeTitles: ["TTL-STARWARD"] }),
  expected({ id: "N06", category: "negative", query: "Write a birthday poem", intent: "out_of_scope", excludeServices: ["SVC-AURORA"], excludeTitles: ["TTL-STARWARD"] }),

  // Held-out paraphrases added after the first tuning pass.
  expected({ id: "V01", category: "held_out", scenario: "SG-001", query: "Find the space series completed by the teen and Morgan", titles: ["TTL-STARWARD"], services: ["SVC-AURORA"], members: ["MEM-001", "MEM-003"] }),
  expected({ id: "V02", category: "held_out", scenario: "SG-002", query: "Which mystery miniseries still lacks the teen's completion report?", titles: ["TTL-GARDEN"], services: ["SVC-ORBIT"], members: ["MEM-003"] }),
  expected({ id: "V03", category: "held_out", scenario: "SG-003", query: "Which food series has Jordan already watched?", titles: ["TTL-HARBOR"], services: ["SVC-TRIO"], members: ["MEM-002"] }),
  expected({ id: "V04", category: "held_out", scenario: "SG-005", query: "Locate the sea-adventure film that changes platforms later", titles: ["TTL-MARINER"], services: ["SVC-TIDE", "SVC-VIEWFLIX"] }),
  expected({ id: "V05", category: "held_out", scenario: "SG-006", query: "Which nonfiction music program for Riley is coming to Ember?", titles: ["TTL-FREQUENCY"], services: ["SVC-EMBER"], members: ["MEM-003"] }),
  expected({ id: "V06", category: "held_out", scenario: "SG-007", query: "What county whodunit have all adults already watched?", titles: ["TTL-CLOCKWORK"], services: ["SVC-MEADOW"], members: ["MEM-001", "MEM-002"] }),
  expected({ id: "V07", category: "held_out", scenario: "SG-009", query: "Find the adult-rated harbor thriller requested by the nine-year-old", titles: ["TTL-AFTER-DARK"], services: ["SVC-LANTERN"], members: ["MEM-004"] }),
  expected({ id: "V08", category: "held_out", scenario: "SG-012", query: "Which animal program are the kids partway through?", titles: ["TTL-BLUE-HOUR"], services: ["SVC-QUIET"], members: ["MEM-003", "MEM-004"] }),
  expected({ id: "V09", category: "held_out", scenario: "SG-008", query: "Which crime show has a Canada-only license?", titles: ["TTL-GLASS-CITY"], services: ["SVC-NORTHLIGHT"] }),
  expected({ id: "V10", category: "held_out", query: "Which provider supports a two-month billing pause?", services: ["SVC-MEADOW"] }),
  expected({ id: "V11", category: "held_out", query: "Which provider allows a one-month pause?", services: ["SVC-QUIET"] }),
  expected({ id: "V12", category: "held_out", query: "Show every streaming service currently being billed", intent: "subscription_inventory", scope: "subscription_inventory" }),
  expected({ id: "V13", category: "held_out", query: "What is our paid streaming roster?", intent: "subscription_inventory", scope: "subscription_inventory" }),
  expected({ id: "V14", category: "held_out", query: "How can we reduce what we pay each month for streaming?", intent: "spending_review", scope: "household_wide" }),
  expected({ id: "V15", category: "held_out", query: "Help make more room in the streaming budget", intent: "spending_review", scope: "household_wide" }),
  expected({ id: "V16", category: "held_out", query: "What should the next service for our queue be?", intent: "subscription_discovery", scope: "household_wide" }),
  expected({ id: "V17", category: "held_out", query: "Find the best new platform for the household wishlist", intent: "subscription_discovery", scope: "household_wide" }),
  expected({ id: "V18", category: "held_out", query: "List the people in the household", intent: "household_roster", members: ["MEM-001", "MEM-002", "MEM-003", "MEM-004"] }),
  expected({ id: "V19", category: "held_out", query: "What are the names of the underage members?", intent: "household_roster", members: ["MEM-003", "MEM-004"] }),
  expected({ id: "V20", category: "held_out", query: "How mature is this prototype for real deployment?", intent: "product_meta" }),
  expected({ id: "V21", category: "held_out", query: "Make the Aurora membership active for us", intent: "external_execution_request", services: ["SVC-AURORA"] }),
  expected({ id: "V22", category: "held_out", query: "Terminate Orbit on our behalf", intent: "external_execution_request", services: ["SVC-ORBIT"] }),
  expected({ id: "V23", category: "held_out", scenario: "SG-001", query: "When does Staward return?", titles: ["TTL-STARWARD"], services: ["SVC-AURORA"] }),
  expected({ id: "V24", category: "held_out", query: "Can Meadow Tv be suspended?", services: ["SVC-MEADOW"] }),
  expected({ id: "V25", category: "held_out", query: "How much is QuetFlix?", services: ["SVC-QUIET"] }),
  expected({ id: "V26", category: "held_out", query: "Show me Lantrn pricing", services: ["SVC-LANTERN"] }),
  expected({ id: "V27", category: "held_out", query: "What is safe for Casy to watch?", members: ["MEM-004"] }),
  expected({ id: "V28", category: "held_out", query: "Show Morgn's viewing queue", members: ["MEM-001"] }),
  expected({ id: "V29", category: "held_out", scenario: "SG-006", query: "Find Rileys weekly music documentary", titles: ["TTL-FREQUENCY"], members: ["MEM-003"] }),
  expected({ id: "V30", category: "held_out", scenario: "SG-006", query: "Which period drama is Jordans priority?", titles: ["TTL-ORCHARD"], members: ["MEM-002"] }),
  expected({ id: "V31", category: "held_out", query: "Find flights to Seattle", intent: "out_of_scope" }),
  expected({ id: "V32", category: "held_out", query: "Summarize today's political news", intent: "out_of_scope" }),
  expected({ id: "V33", category: "held_out", query: "Add a dentist appointment to my calendar", intent: "out_of_scope" }),
  expected({ id: "V34", category: "held_out", query: "Translate this sentence into French", intent: "out_of_scope" }),
  expected({ id: "V35", category: "held_out", query: "Should I buy this stock?", intent: "out_of_scope" }),
  expected({ id: "V36", category: "held_out", query: "Create a workout plan", intent: "out_of_scope" }),
  expected({ id: "V37", category: "held_out", query: "Draft an email to my manager", intent: "out_of_scope" }),
  expected({ id: "V38", category: "held_out", query: "Debug this Python function", intent: "out_of_scope" }),
  expected({ id: "V39", category: "held_out", query: "Tell me a joke", intent: "out_of_scope" }),
  expected({ id: "V40", category: "held_out", query: "Suggest a restaurant for a family dinner", intent: "out_of_scope" }),

  // Real-world portfolio-comparison queries added after the first production-log review.
  expected({
    id: "R01",
    category: "portfolio_comparison",
    query: "Can you recommend a service for cancellation that will save us $10 a month?",
    intent: "spending_review",
    scope: "household_wide",
    minimumSubscriptions: 5,
    minimumPlans: 5,
    coverage: "complete"
  }),
  expected({
    id: "R02",
    category: "portfolio_comparison",
    query: "Which subscription could we cut to free at least $15 each month?",
    intent: "spending_review",
    scope: "household_wide",
    minimumSubscriptions: 5,
    minimumPlans: 5,
    coverage: "complete"
  }),
  expected({
    id: "R03",
    category: "portfolio_comparison",
    query: "Help us choose a streaming membership to drop so the monthly bill is lower",
    intent: "spending_review",
    scope: "household_wide",
    minimumSubscriptions: 5,
    minimumPlans: 5,
    coverage: "complete"
  }),
  expected({
    id: "R04",
    category: "portfolio_comparison",
    query: "What can we cancel to make $20 more room in our streaming budget?",
    intent: "spending_review",
    scope: "household_wide",
    minimumSubscriptions: 5,
    minimumPlans: 5,
    coverage: "complete"
  }),
  expected({
    id: "R05",
    category: "portfolio_comparison",
    query: "Would canceling Aurora+ save us at least $10 per month?",
    intent: "spending_review",
    scope: "focused",
    services: ["SVC-AURORA"],
    excludeServices: ["SVC-ORBIT"],
    minimumSubscriptions: 1,
    minimumPlans: 1,
    coverage: "complete"
  }),
  expected({
    id: "R06",
    category: "portfolio_comparison",
    query: "Can you save me $10 a month on groceries?",
    intent: "out_of_scope",
    excludeServices: ["SVC-AURORA"],
    excludeTitles: ["TTL-STARWARD"]
  })
];

function includesAll(actual, expectedValues) {
  return expectedValues.every(value => actual.includes(value));
}

function evaluate(testCase) {
  const state = context.createSeedState(testCase.scenario);
  const packet = selector.select({
    state,
    knowledge,
    decisionPacket: engine.buildDecisionPacket(state),
    recommendation: null,
    userText: testCase.query,
    requestType: "conversation",
    reason: ""
  });
  const selection = packet.householdContext.context_selection;
  const failures = [];
  if (testCase.intent && packet.contextPlan.intent !== testCase.intent) {
    failures.push(`intent ${packet.contextPlan.intent} != ${testCase.intent}`);
  }
  if (testCase.scope && packet.scope !== testCase.scope) {
    failures.push(`scope ${packet.scope} != ${testCase.scope}`);
  }
  if (!includesAll(selection.selected_service_ids, testCase.services)) {
    failures.push(`services missing ${testCase.services.filter(value => !selection.selected_service_ids.includes(value)).join(",")}`);
  }
  if (!includesAll(selection.selected_title_ids, testCase.titles)) {
    failures.push(`titles missing ${testCase.titles.filter(value => !selection.selected_title_ids.includes(value)).join(",")}`);
  }
  if (!includesAll(selection.selected_member_ids, testCase.members)) {
    failures.push(`members missing ${testCase.members.filter(value => !selection.selected_member_ids.includes(value)).join(",")}`);
  }
  const unexpectedServices = testCase.excludeServices.filter(value => selection.selected_service_ids.includes(value));
  if (unexpectedServices.length) failures.push(`unexpected services ${unexpectedServices.join(",")}`);
  const unexpectedTitles = testCase.excludeTitles.filter(value => selection.selected_title_ids.includes(value));
  if (unexpectedTitles.length) failures.push(`unexpected titles ${unexpectedTitles.join(",")}`);
  if (
    testCase.minimumWatchlist !== null &&
    packet.householdContext.household_watchlist.length < testCase.minimumWatchlist
  ) {
    failures.push(`watchlist ${packet.householdContext.household_watchlist.length} < ${testCase.minimumWatchlist}`);
  }
  if (
    testCase.minimumViewing !== null &&
    packet.householdContext.viewing_information.length < testCase.minimumViewing
  ) {
    failures.push(`viewing ${packet.householdContext.viewing_information.length} < ${testCase.minimumViewing}`);
  }
  if (
    testCase.minimumSubscriptions !== null &&
    packet.householdContext.current_subscriptions.length < testCase.minimumSubscriptions
  ) {
    failures.push(
      `subscriptions ${packet.householdContext.current_subscriptions.length} < ${testCase.minimumSubscriptions}`
    );
  }
  if (
    testCase.minimumPlans !== null &&
    packet.servicePlans.length < testCase.minimumPlans
  ) {
    failures.push(`plans ${packet.servicePlans.length} < ${testCase.minimumPlans}`);
  }
  if (testCase.coverage && packet.contextPlan.coverageStatus !== testCase.coverage) {
    failures.push(`coverage ${packet.contextPlan.coverageStatus} != ${testCase.coverage}`);
  }
  return {
    ...testCase,
    passed: failures.length === 0,
    failures,
    actual: {
      intent: packet.contextPlan.intent,
      scope: packet.scope,
      services: [...selection.selected_service_ids],
      titles: [...selection.selected_title_ids],
      members: [...selection.selected_member_ids],
      strategy: packet.contextPlan.searchStrategy || "keyword_rules"
    }
  };
}

const results = cases.map(evaluate);
const categories = [...new Set(cases.map(testCase => testCase.category))];
const categoryScores = Object.fromEntries(categories.map(category => {
  const categoryResults = results.filter(result => result.category === category);
  const passed = categoryResults.filter(result => result.passed).length;
  return [category, {
    passed,
    total: categoryResults.length,
    successRate: Number((passed / categoryResults.length * 100).toFixed(1))
  }];
}));
const passed = results.filter(result => result.passed).length;
const successRate = Number((passed / results.length * 100).toFixed(1));
const report = {
  generatedAt: new Date().toISOString(),
  benchmarkVersion: 1,
  passed,
  total: results.length,
  successRate,
  categoryScores,
  failures: results.filter(result => !result.passed)
};

const reportPath = "reports/context_search_benchmark_results.json";
fs.mkdirSync("reports", { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Context search benchmark: ${passed}/${results.length} passed (${successRate}%).`);
categories.forEach(category => {
  const score = categoryScores[category];
  console.log(`- ${category}: ${score.passed}/${score.total} (${score.successRate}%)`);
});
if (report.failures.length) {
  console.log(`Failures written to ${reportPath}:`);
  report.failures.forEach(result => {
    console.log(`- ${result.id} [${result.category}] ${result.query}: ${result.failures.join("; ")}`);
  });
}

const requiredArgument = process.argv.find(argument => argument.startsWith("--require="));
const requiredRate = requiredArgument ? Number(requiredArgument.split("=")[1]) : 0;
if (Number.isFinite(requiredRate) && successRate < requiredRate) process.exitCode = 1;
