(function initializeStreamingGuardFeedback(global) {
  "use strict";

  const STORAGE_KEY = "streaming_guard_feedback_and_regressions_v1";
  const FEEDBACK_REASONS = Object.freeze([
    "Helpful",
    "Savings too small",
    "Timing was wrong",
    "A title or viewer was missing",
    "A household preference was misunderstood",
    "The explanation was unclear",
    "Other"
  ]);
  const PREFERENCE_DECISIONS = Object.freeze({
    SAVE: "save",
    REJECT: "reject",
    EDIT: "edit"
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function emptyStore() {
    return { version: 1, feedback: [], regressionCandidates: [] };
  }

  function read() {
    try {
      const parsed = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || "null");
      if (
        parsed?.version === 1 &&
        Array.isArray(parsed.feedback) &&
        Array.isArray(parsed.regressionCandidates)
      ) return parsed;
    } catch (_) {
      // A corrupt optional feedback store must not block the prototype.
    }
    return emptyStore();
  }

  function write(store) {
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }

  function id(prefix) {
    const random = global.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}-${random}`;
  }

  function recordFeedback(entry) {
    const store = read();
    const scenarioId = String(entry.scenarioId || "");
    const recommendationVersion = Number(entry.recommendationVersion || 0);
    const recommendationInstanceId = String(entry.recommendationInstanceId || "");
    const existing = store.feedback.find(item =>
      recommendationInstanceId &&
      item.recommendationInstanceId === recommendationInstanceId &&
      item.scenarioId === scenarioId &&
      item.recommendationVersion === recommendationVersion
    );
    if (existing) return clone(existing);
    const feedback = {
      id: id("feedback"),
      capturedAt: new Date().toISOString(),
      scenarioId,
      recommendationVersion,
      recommendationInstanceId,
      displayAfterMessageCount: Math.max(0, Number(entry.displayAfterMessageCount || 0)),
      recommendationAction: String(entry.recommendationAction || ""),
      rating: entry.rating === "helpful" ? "helpful" : "poor",
      reasons: Array.isArray(entry.reasons)
        ? entry.reasons.filter(reason => FEEDBACK_REASONS.includes(reason))
        : [],
      comment: String(entry.comment || "").trim(),
      interpretationStatus: entry.interpretationStatus || "not_requested"
    };
    store.feedback.push(feedback);
    write(store);
    return clone(feedback);
  }

  function feedbackFor({ scenarioId, recommendationVersion, recommendationInstanceId }) {
    const instanceId = String(recommendationInstanceId || "");
    if (!instanceId) return null;
    return clone(read().feedback.find(item =>
      item.recommendationInstanceId === instanceId &&
      item.scenarioId === String(scenarioId || "") &&
      item.recommendationVersion === Number(recommendationVersion || 0)
    ) || null);
  }

  function interpretationRequest(feedback) {
    const comment = String(feedback?.comment || "").trim();
    const reasons = Array.isArray(feedback?.reasons)
      ? feedback.reasons.filter(reason => FEEDBACK_REASONS.includes(reason))
      : [];
    const reasonText = reasons.length ? ` Rating reasons: ${reasons.join(", ")}.` : "";
    const visibleText = comment || "I submitted feedback about this recommendation.";
    const contextText = `Feedback about the displayed streaming recommendation: ${visibleText}.${reasonText}`;
    const modelText = [
      contextText,
      "Internal feedback task: distinguish feedback about this one recommendation from a lasting household preference.",
      "Keep the completed recommendation state unchanged. Do not accept, decline, reopen, or reconfirm the recommendation and do not claim an external action.",
      "If this is one-time feedback, classify it as one-time feedback and do not propose a memory update.",
      "If it expresses a lasting preference, classify it as a lasting preference proposal, return the smallest unapproved durable preference for application review, and do not ask for a typed yes or no; the application will present blocking choices."
    ].join(" ");
    return { visibleText, contextText, modelText };
  }

  function isPendingPreference(update) {
    return Boolean(
      update &&
      update.updateType === "preference_note" &&
      update.field === "preferenceNote" &&
      update.scope === "permanent" &&
      update.requiresAdultConfirmation === true &&
      String(update.value || "").trim()
    );
  }

  function preferenceDecision(update, decision) {
    if (!isPendingPreference(update)) {
      throw new TypeError("A valid pending preference is required.");
    }
    if (!Object.values(PREFERENCE_DECISIONS).includes(decision)) {
      throw new RangeError("The preference decision is unsupported.");
    }
    if (decision === PREFERENCE_DECISIONS.SAVE) {
      return { ...clone(update), requiresAdultConfirmation: false };
    }
    if (decision === PREFERENCE_DECISIONS.EDIT) {
      return clone(update);
    }
    return null;
  }

  function preferenceEditRequest(update, adultText) {
    if (!isPendingPreference(update)) {
      throw new TypeError("A valid pending preference is required before editing.");
    }
    const visibleText = String(adultText || "").trim();
    if (!visibleText) throw new TypeError("A preference edit is required.");
    const contextText = `The adult is editing the pending household preference “${update.value}”. Requested edit: ${visibleText}`;
    const modelText = [
      contextText,
      "Internal preference-edit task: interpret only the requested revision.",
      "Return exactly one revised permanent preference_note with requiresAdultConfirmation true.",
      "Classify the result as a revised pending preference. Keep the completed recommendation unchanged, do not save the preference, and let the application present it for another explicit review."
    ].join(" ");
    return { visibleText, contextText, modelText };
  }

  function captureRegressionCandidate(entry) {
    const store = read();
    const sourceKey = String(entry.sourceKey || "");
    const existing = store.regressionCandidates.find(item =>
      item.sourceType === entry.sourceType && item.sourceKey === sourceKey
    );
    if (existing) return clone(existing);
    const candidate = {
      id: id("regression"),
      status: "draft",
      reviewerRequired: true,
      capturedAt: new Date().toISOString(),
      sourceType: String(entry.sourceType || ""),
      sourceKey,
      title: String(entry.title || "Regression candidate"),
      failureSummary: String(entry.failureSummary || ""),
      expectedBehaviorDraft: String(entry.expectedBehaviorDraft || ""),
      fixedInput: clone(entry.fixedInput || null),
      actualOutput: clone(entry.actualOutput || null),
      validationEvidence: clone(entry.validationEvidence || null),
      metadata: clone(entry.metadata || {})
    };
    store.regressionCandidates.push(candidate);
    write(store);
    return clone(candidate);
  }

  function regressionCandidates() {
    return clone(read().regressionCandidates);
  }

  function hasRegressionCandidate(sourceType, sourceKey) {
    return read().regressionCandidates.some(item =>
      item.sourceType === sourceType && item.sourceKey === String(sourceKey || "")
    );
  }

  function exportPayload() {
    return {
      product: "Streaming Guard",
      exportType: "Draft regression candidates",
      exportedAt: new Date().toISOString(),
      notice: "Drafts require human review before promotion into the official evaluation set.",
      candidates: regressionCandidates()
    };
  }

  function clearAll() {
    global.localStorage.removeItem(STORAGE_KEY);
  }

  global.StreamingGuardFeedback = Object.freeze({
    FEEDBACK_REASONS,
    PREFERENCE_DECISIONS,
    recordFeedback,
    feedbackFor,
    interpretationRequest,
    isPendingPreference,
    preferenceDecision,
    preferenceEditRequest,
    captureRegressionCandidate,
    regressionCandidates,
    hasRegressionCandidate,
    exportPayload,
    clearAll
  });
})(window);
