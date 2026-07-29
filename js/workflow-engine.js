(function initializeStreamingGuardWorkflowEngine(global) {
  "use strict";

  const VERSION = 1;
  const STATES = Object.freeze([
    "not_started",
    "input_received",
    "context_ready",
    "decision_pending",
    "output_ready",
    "adult_discussion",
    "adult_judgment_required",
    "external_action_pending",
    "completed",
    "refused",
    "failed"
  ]);
  const EVENTS = Object.freeze({
    RESET: "RESET",
    INPUT_RECEIVED: "INPUT_RECEIVED",
    CONTEXT_SELECTED: "CONTEXT_SELECTED",
    DECISION_REQUESTED: "DECISION_REQUESTED",
    OUTPUT_VALIDATED: "OUTPUT_VALIDATED",
    DISCUSSION_OPENED: "DISCUSSION_OPENED",
    ADULT_JUDGMENT_REQUESTED: "ADULT_JUDGMENT_REQUESTED",
    ADULT_AGREED: "ADULT_AGREED",
    COMPLETE_WITHOUT_ACTION: "COMPLETE_WITHOUT_ACTION",
    EXTERNAL_ACTION_CONFIRMED: "EXTERNAL_ACTION_CONFIRMED",
    EXECUTION_REFUSED: "EXECUTION_REFUSED",
    REVISIT_REQUESTED: "REVISIT_REQUESTED",
    FAILED: "FAILED"
  });
  const TARGETS = Object.freeze({
    RESET: "not_started",
    INPUT_RECEIVED: "input_received",
    CONTEXT_SELECTED: "context_ready",
    DECISION_REQUESTED: "decision_pending",
    OUTPUT_VALIDATED: "output_ready",
    DISCUSSION_OPENED: "adult_discussion",
    ADULT_JUDGMENT_REQUESTED: "adult_judgment_required",
    ADULT_AGREED: "external_action_pending",
    COMPLETE_WITHOUT_ACTION: "completed",
    EXTERNAL_ACTION_CONFIRMED: "completed",
    EXECUTION_REFUSED: "refused",
    REVISIT_REQUESTED: "adult_discussion",
    FAILED: "failed"
  });
  const ALLOWED_FROM = Object.freeze({
    RESET: STATES,
    INPUT_RECEIVED: STATES,
    CONTEXT_SELECTED: ["input_received", "adult_discussion", "adult_judgment_required", "output_ready"],
    DECISION_REQUESTED: ["context_ready", "input_received", "adult_discussion"],
    OUTPUT_VALIDATED: ["decision_pending", "context_ready"],
    DISCUSSION_OPENED: ["output_ready", "adult_judgment_required", "completed", "external_action_pending"],
    ADULT_JUDGMENT_REQUESTED: ["decision_pending", "output_ready", "adult_discussion"],
    ADULT_AGREED: ["output_ready", "adult_discussion"],
    COMPLETE_WITHOUT_ACTION: ["output_ready", "adult_discussion"],
    EXTERNAL_ACTION_CONFIRMED: ["external_action_pending"],
    EXECUTION_REFUSED: ["input_received", "context_ready", "decision_pending", "output_ready", "adult_discussion", "adult_judgment_required"],
    REVISIT_REQUESTED: ["completed", "external_action_pending", "output_ready"],
    FAILED: ["input_received", "context_ready", "decision_pending", "output_ready", "adult_discussion"]
  });

  function initial() {
    return {
      version: VERSION,
      state: "not_started",
      lastEvent: null,
      updatedAt: null,
      history: []
    };
  }

  function transition(workflow, event, {
    timestamp = new Date().toISOString(),
    traceId = null,
    details = ""
  } = {}) {
    const current = workflow && STATES.includes(workflow.state) ? workflow : initial();
    const target = TARGETS[event];
    if (!target) throw new RangeError(`Unknown workflow event: ${event}.`);
    const allowed = ALLOWED_FROM[event] || [];
    if (!allowed.includes(current.state)) {
      const error = new Error(`Workflow event ${event} is not allowed from ${current.state}.`);
      error.code = "invalid_workflow_transition";
      throw error;
    }
    const entry = {
      sequence: (current.history || []).length + 1,
      event,
      from: current.state,
      to: target,
      timestamp,
      traceId,
      details
    };
    return {
      version: VERSION,
      state: target,
      lastEvent: event,
      updatedAt: timestamp,
      history: [...(current.history || []), entry].slice(-100)
    };
  }

  function deriveFromReview(review = {}) {
    if (review.externalActionConfirmed || review.status === "completed") return "completed";
    if (review.safetyDisposition === "execution_refused") return "refused";
    if (review.discussionStatus === "external_action_pending") return "external_action_pending";
    if (review.status === "adult_judgment_required") return "adult_judgment_required";
    if (review.generatedRecommendation) {
      return review.discussionStatus === "open" ? "adult_discussion" : "output_ready";
    }
    if (review.progressStage === "model_request") return "decision_pending";
    if (review.started || review.manualScenario) return "input_received";
    return "not_started";
  }

  global.StreamingGuardWorkflow = Object.freeze({
    version: VERSION,
    states: STATES,
    events: EVENTS,
    initial,
    transition,
    deriveFromReview
  });
})(window);
