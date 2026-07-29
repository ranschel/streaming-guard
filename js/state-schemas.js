(function initializeStreamingGuardStateSchemas(global) {
  "use strict";

  const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";
  const HOUSEHOLD_SCHEMA_VERSION = 1;
  const SESSION_SCHEMA_VERSION = 1;
  const CONTEXT_PLAN_SCHEMA_VERSION = 1;
  const TOOL_COMMAND_SCHEMA_VERSION = 1;

  const HOUSEHOLD_KEYS = Object.freeze([
    "household",
    "members",
    "familyRules",
    "subscriptions",
    "viewing",
    "watchlist",
    "householdWatchlist",
    "householdViewing",
    "householdViewingHistory",
    "householdSpendingHistory",
    "recommendationSavingsEvents",
    "subscriptionChangeLog",
    "contextFreshness"
  ]);
  const SESSION_KEYS = Object.freeze([
    "systemDate",
    "scenario",
    "review",
    "messages",
    "toolAudit",
    "workflow",
    "traces"
  ]);

  const householdSchema = Object.freeze({
    $schema: JSON_SCHEMA_DIALECT,
    $id: "https://streaming-guard.local/schemas/household-state-v1.json",
    title: "Streaming Guard Household State",
    type: "object",
    required: [
      "schemaVersion",
      "householdRevision",
      "household",
      "members",
      "familyRules",
      "subscriptions",
      "viewing",
      "watchlist",
      "householdWatchlist",
      "householdViewing",
      "householdViewingHistory",
      "householdSpendingHistory",
      "recommendationSavingsEvents",
      "subscriptionChangeLog",
      "contextFreshness",
      "appliedCommandIds"
    ],
    properties: {
      schemaVersion: { const: HOUSEHOLD_SCHEMA_VERSION },
      householdRevision: { type: "integer", minimum: 0 },
      household: { type: "object" },
      members: { type: "array" },
      familyRules: { type: "object" },
      subscriptions: { type: "array" },
      viewing: { type: "array" },
      watchlist: { type: "array" },
      householdWatchlist: { type: "array" },
      householdViewing: { type: "array" },
      householdViewingHistory: { type: "array" },
      householdSpendingHistory: { type: "array" },
      recommendationSavingsEvents: { type: "array" },
      subscriptionChangeLog: { type: "array" },
      contextFreshness: { type: "object" },
      appliedCommandIds: { type: "array", items: { type: "string" }, maxItems: 500 }
    },
    additionalProperties: false
  });

  const sessionSchema = Object.freeze({
    $schema: JSON_SCHEMA_DIALECT,
    $id: "https://streaming-guard.local/schemas/session-state-v1.json",
    title: "Streaming Guard Conversation And Demo Session",
    type: "object",
    required: [
      "schemaVersion",
      "sessionRevision",
      "systemDate",
      "scenario",
      "review",
      "messages",
      "toolAudit",
      "workflow",
      "traces"
    ],
    properties: {
      schemaVersion: { const: SESSION_SCHEMA_VERSION },
      sessionRevision: { type: "integer", minimum: 0 },
      systemDate: { type: ["string", "null"] },
      scenario: { type: "object" },
      review: { type: "object" },
      messages: { type: "array" },
      toolAudit: { type: "array" },
      workflow: { type: "object" },
      traces: { type: "array", maxItems: 100 }
    },
    additionalProperties: false
  });

  const contextPlanSchema = Object.freeze({
    $schema: JSON_SCHEMA_DIALECT,
    $id: "https://streaming-guard.local/schemas/context-plan-v1.json",
    title: "Streaming Guard Context Plan",
    type: "object",
    required: [
      "schemaVersion",
      "intent",
      "scope",
      "entityIds",
      "requiredRecordTypes",
      "selectedRecordCounts",
      "missingRequirements",
      "selectionReasons",
      "tokenBudget",
      "contextHash",
      "coverageStatus"
    ],
    properties: {
      schemaVersion: { const: CONTEXT_PLAN_SCHEMA_VERSION },
      intent: { type: "string", minLength: 1 },
      scope: { enum: ["scenario", "focused", "subscription_inventory", "household_wide"] },
      entityIds: {
        type: "object",
        required: ["services", "titles", "members"],
        properties: {
          services: { type: "array", items: { type: "string" } },
          titles: { type: "array", items: { type: "string" } },
          members: { type: "array", items: { type: "string" } }
        }
      },
      requiredRecordTypes: { type: "array", items: { type: "string" } },
      selectedRecordCounts: { type: "object" },
      missingRequirements: { type: "array", items: { type: "string" } },
      selectionReasons: { type: "array" },
      tokenBudget: { type: "integer", minimum: 1 },
      contextHash: { type: "string", minLength: 1 },
      coverageStatus: { enum: ["complete", "clarification_required", "incomplete"] }
    }
  });

  const toolCommandSchema = Object.freeze({
    $schema: JSON_SCHEMA_DIALECT,
    $id: "https://streaming-guard.local/schemas/tool-command-v1.json",
    title: "Streaming Guard Idempotent Tool Command",
    type: "object",
    required: ["schemaVersion", "commandId", "expectedHouseholdRevision", "updateType", "payload"],
    properties: {
      schemaVersion: { const: TOOL_COMMAND_SCHEMA_VERSION },
      commandId: { type: "string", minLength: 8 },
      expectedHouseholdRevision: { type: "integer", minimum: 0 },
      updateType: { type: "string", minLength: 1 },
      payload: { type: "object" }
    }
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function assertObject(value, label) {
    if (!isObject(value)) throw new TypeError(`${label} must be an object.`);
  }

  function assertArray(value, label) {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  }

  function validateHouseholdDocument(document) {
    assertObject(document, "Household state");
    if (document.schemaVersion !== HOUSEHOLD_SCHEMA_VERSION) {
      throw new RangeError(`Unsupported household schema version: ${document.schemaVersion}.`);
    }
    if (!Number.isInteger(document.householdRevision) || document.householdRevision < 0) {
      throw new TypeError("householdRevision must be a non-negative integer.");
    }
    ["household", "familyRules", "contextFreshness"].forEach(key => assertObject(document[key], key));
    [
      "members",
      "subscriptions",
      "viewing",
      "watchlist",
      "householdWatchlist",
      "householdViewing",
      "householdViewingHistory",
      "householdSpendingHistory",
      "recommendationSavingsEvents",
      "subscriptionChangeLog",
      "appliedCommandIds"
    ].forEach(key => assertArray(document[key], key));
    if (!document.household.id || !document.household.authorizedAdultMemberId) {
      throw new TypeError("Household identity and authorized-adult fields are required.");
    }
    if (!document.members.some(member => member.id === document.household.authorizedAdultMemberId)) {
      throw new TypeError("The authorized adult must match a household member.");
    }
    const serviceIds = new Set();
    document.subscriptions.forEach(subscription => {
      if (!subscription.serviceId || !subscription.planId || !subscription.status) {
        throw new TypeError("Each subscription requires service, plan, and status identifiers.");
      }
      if (serviceIds.has(subscription.serviceId)) {
        throw new TypeError(`Duplicate household subscription service: ${subscription.serviceId}.`);
      }
      serviceIds.add(subscription.serviceId);
      if (!Number.isFinite(Number(subscription.monthlyCost)) || Number(subscription.monthlyCost) < 0) {
        throw new TypeError(`Invalid monthly cost for ${subscription.serviceId}.`);
      }
    });
    if (document.appliedCommandIds.some(commandId => typeof commandId !== "string")) {
      throw new TypeError("appliedCommandIds may contain only strings.");
    }
    return document;
  }

  function validateSessionDocument(document) {
    assertObject(document, "Session state");
    if (document.schemaVersion !== SESSION_SCHEMA_VERSION) {
      throw new RangeError(`Unsupported session schema version: ${document.schemaVersion}.`);
    }
    if (!Number.isInteger(document.sessionRevision) || document.sessionRevision < 0) {
      throw new TypeError("sessionRevision must be a non-negative integer.");
    }
    ["scenario", "review", "workflow"].forEach(key => assertObject(document[key], key));
    ["messages", "toolAudit", "traces"].forEach(key => assertArray(document[key], key));
    return document;
  }

  function validateContextPlan(plan) {
    assertObject(plan, "Context plan");
    if (plan.schemaVersion !== CONTEXT_PLAN_SCHEMA_VERSION) {
      throw new RangeError(`Unsupported context-plan schema version: ${plan.schemaVersion}.`);
    }
    if (!["scenario", "focused", "subscription_inventory", "household_wide"].includes(plan.scope)) {
      throw new RangeError(`Unsupported context scope: ${plan.scope}.`);
    }
    assertObject(plan.entityIds, "Context-plan entityIds");
    ["services", "titles", "members"].forEach(key => assertArray(plan.entityIds[key], `entityIds.${key}`));
    ["requiredRecordTypes", "missingRequirements", "selectionReasons"].forEach(key => assertArray(plan[key], key));
    assertObject(plan.selectedRecordCounts, "selectedRecordCounts");
    if (!Number.isInteger(plan.tokenBudget) || plan.tokenBudget < 1) {
      throw new TypeError("Context-plan tokenBudget must be a positive integer.");
    }
    if (!plan.contextHash || !["complete", "clarification_required", "incomplete"].includes(plan.coverageStatus)) {
      throw new TypeError("Context-plan hash and coverage status are required.");
    }
    return plan;
  }

  function validateToolCommand(command) {
    assertObject(command, "Tool command");
    if (command.schemaVersion !== TOOL_COMMAND_SCHEMA_VERSION) {
      throw new RangeError(`Unsupported tool-command schema version: ${command.schemaVersion}.`);
    }
    if (typeof command.commandId !== "string" || command.commandId.length < 8) {
      throw new TypeError("A stable commandId of at least eight characters is required.");
    }
    if (!Number.isInteger(command.expectedHouseholdRevision) || command.expectedHouseholdRevision < 0) {
      throw new TypeError("expectedHouseholdRevision must be a non-negative integer.");
    }
    if (!command.updateType || !isObject(command.payload)) {
      throw new TypeError("Tool commands require an updateType and object payload.");
    }
    return command;
  }

  function provenance({
    source,
    recordedAt = null,
    verifiedAt = null,
    effectiveFrom = null,
    effectiveTo = null,
    confidence = "confirmed"
  }) {
    return {
      source,
      recordedAt,
      verifiedAt: verifiedAt || recordedAt,
      effectiveFrom,
      effectiveTo,
      confidence
    };
  }

  function annotateRecords(state) {
    const effectiveDate = state.systemDate || null;
    const baseline = (source, existing = null) => existing || provenance({
      source,
      recordedAt: effectiveDate,
      verifiedAt: effectiveDate,
      confidence: "confirmed"
    });
    state.household._provenance = baseline("household_profile.json", state.household._provenance);
    state.familyRules._provenance = baseline("family_rules.json", state.familyRules._provenance);
    const collections = [
      ["members", "household_members_profile.json"],
      ["subscriptions", "household_subscriptions.csv"],
      ["viewing", "viewing_status.csv"],
      ["watchlist", "watchlist.csv"],
      ["householdWatchlist", "watchlist.csv"],
      ["householdViewing", "viewing_status.csv"],
      ["householdViewingHistory", "viewing_status.csv"],
      ["householdSpendingHistory", "household_spending_history.csv"]
    ];
    collections.forEach(([key, source]) => {
      (state[key] || []).forEach(record => {
        record._provenance = baseline(source, record._provenance);
      });
    });
    return state;
  }

  function splitState(state) {
    const household = {
      schemaVersion: HOUSEHOLD_SCHEMA_VERSION,
      householdRevision: Number.isInteger(state.householdRevision) ? state.householdRevision : 0,
      appliedCommandIds: Array.isArray(state.appliedCommandIds) ? clone(state.appliedCommandIds) : []
    };
    HOUSEHOLD_KEYS.forEach(key => {
      household[key] = clone(state[key]);
    });
    const session = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionRevision: Number.isInteger(state.sessionRevision) ? state.sessionRevision : 0
    };
    SESSION_KEYS.forEach(key => {
      session[key] = clone(state[key]);
    });
    return {
      household: validateHouseholdDocument(household),
      session: validateSessionDocument(session)
    };
  }

  function combineState(household, session) {
    validateHouseholdDocument(household);
    validateSessionDocument(session);
    const state = {
      householdRevision: household.householdRevision,
      appliedCommandIds: clone(household.appliedCommandIds),
      sessionRevision: session.sessionRevision
    };
    HOUSEHOLD_KEYS.forEach(key => {
      state[key] = clone(household[key]);
    });
    SESSION_KEYS.forEach(key => {
      state[key] = clone(session[key]);
    });
    return annotateRecords(state);
  }

  function migrateLegacyState(legacyState, seedState) {
    const merged = {
      ...clone(seedState),
      ...clone(legacyState || {})
    };
    merged.householdRevision = Number.isInteger(legacyState?.householdRevision)
      ? legacyState.householdRevision
      : 0;
    merged.sessionRevision = Number.isInteger(legacyState?.sessionRevision)
      ? legacyState.sessionRevision
      : 0;
    merged.appliedCommandIds = Array.isArray(legacyState?.appliedCommandIds)
      ? legacyState.appliedCommandIds
      : [];
    merged.workflow = isObject(legacyState?.workflow)
      ? legacyState.workflow
      : { state: "not_started", version: 1, history: [] };
    merged.traces = Array.isArray(legacyState?.traces) ? legacyState.traces : [];
    return splitState(annotateRecords(merged));
  }

  global.StreamingGuardStateSchemas = Object.freeze({
    versions: Object.freeze({
      household: HOUSEHOLD_SCHEMA_VERSION,
      session: SESSION_SCHEMA_VERSION,
      contextPlan: CONTEXT_PLAN_SCHEMA_VERSION,
      toolCommand: TOOL_COMMAND_SCHEMA_VERSION
    }),
    householdKeys: HOUSEHOLD_KEYS,
    sessionKeys: SESSION_KEYS,
    schemas: Object.freeze({
      household: householdSchema,
      session: sessionSchema,
      contextPlan: contextPlanSchema,
      toolCommand: toolCommandSchema
    }),
    splitState,
    combineState,
    migrateLegacyState,
    validateHouseholdDocument,
    validateSessionDocument,
    validateContextPlan,
    validateToolCommand,
    annotateRecords,
    provenance,
    clone
  });
})(window);
