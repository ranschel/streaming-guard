(function initializeUiRenderers(global) {
  "use strict";

  const math = global.StreamingGuardMath;
  const engine = global.StreamingGuardRecommendationEngine;
  const llm = global.StreamingGuardOpenAI;

  function modelSourceLabel(model) {
    const info = llm?.modelInfo(model);
    return info ? `${llm.providerName(info.provider)} · ${info.label}` : model || "configured model";
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    })[character]);
  }

  function displayChatText(value) {
    return String(value).replace(/https?:\/\/[^\s<>"']+/gi, matchedUrl => {
      let url = matchedUrl;
      let punctuation = "";
      while (/[.,;:!?)]$/.test(url)) {
        punctuation = `${url.slice(-1)}${punctuation}`;
        url = url.slice(0, -1);
      }
      try {
        const parsed = new global.URL(url);
        const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
        return `${parsed.host}${path}${parsed.search}${parsed.hash}${punctuation}`;
      } catch (_) {
        return `${url.replace(/^https?:\/\//i, "").replace(/\/$/, "")}${punctuation}`;
      }
    });
  }

  function welcomeMarkup() {
    return `<div class="welcome-stack">
      <section class="welcome-card welcome-intro-card" aria-labelledby="welcomeTitle">
        <div class="welcome-icon" aria-hidden="true">✓</div>
        <h1 id="welcomeTitle">Your subscriptions, thoughtfully reviewed.</h1>
        <p>Choose how this household subscription review begins. You’ll make every final decision and complete every external action.</p>
      </section>
      <section class="welcome-card scenario-picker-card" aria-labelledby="scenarioPickerTitle">
        <h2 id="scenarioPickerTitle">Choose a demo scenario</h2>
        <div class="demo-trigger-grid">
          <button class="demo-trigger-card primary-button" type="button" data-action="run-background-sweep">
            <strong>Run daily background sweep</strong>
            <span>Review completed viewing, current priorities, renewals, and spending for an underused service.</span>
          </button>
          <button class="demo-trigger-card secondary-button" type="button" data-action="review-subscription-request">
            <strong>Review a new subscription request</strong>
            <span>Compare TidePlay with the household’s existing ViewFlix coverage for Riley’s requested title.</span>
          </button>
          <button class="demo-trigger-card manual-scenario-button" type="button" data-action="start-manual-scenario">
            <strong>Enter a manual scenario</strong>
            <span>Ask a subscription-planning question or tell me what changed in the household.</span>
          </button>
        </div>
      </section>
    </div>`;
  }

  function recommendationRow(label, value) {
    return `<div class="rec-row" role="row"><div class="rec-label" role="rowheader">${escapeHtml(label)}</div><div class="rec-value" role="cell">${escapeHtml(displayChatText(value))}</div></div>`;
  }

  function financialImpactRow(recommendation) {
    const headline = recommendation.financialHeadline || recommendation.financial;
    const details = recommendation.financialDetails || "";
    return `<div class="rec-row" role="row"><div class="rec-label" role="rowheader">Financial impact</div><div class="rec-value rec-financial" role="cell"><strong>${escapeHtml(displayChatText(headline))}</strong>${details ? `<small>${escapeHtml(displayChatText(details))}</small>` : ""}</div></div>`;
  }

  function prominentRecommendationRow(label, headline, details = "") {
    return `<div class="rec-row" role="row"><div class="rec-label" role="rowheader">${escapeHtml(label)}</div><div class="rec-value rec-prominent" role="cell"><strong>${escapeHtml(displayChatText(headline))}</strong>${details ? `<small>${escapeHtml(displayChatText(details))}</small>` : ""}</div></div>`;
  }

  function confidenceText(recommendation) {
    const level = String(recommendation.confidenceLevel || "").trim();
    const rawExplanation = String(recommendation.confidence || "")
      .trim()
      .replace(/^(high|medium|low)(?:\s+confidence)?\s*[:.\-–—]\s*/i, "");
    const explanation = rawExplanation
      ? `${rawExplanation.charAt(0).toUpperCase()}${rawExplanation.slice(1)}`
      : "";
    if (!level) return explanation;
    return `${level} confidence.${explanation ? ` ${explanation}` : ""}`;
  }

  function politeManualText(value) {
    return String(value || "")
      .replace(/^Morgan must\s+/i, "Please ")
      .replace(/^You must\s+/i, "Please ")
      .replace(/^Use the validated\s+/i, "Please use the ")
      .replace(/\bvalidated ([A-Za-z0-9+ -]+ account (?:link|page))/gi, "$1");
  }

  function recommendationMarkup(recommendation) {
    const judgment = recommendation.status === "Adult judgment required";
    const generated = ["llm", "openai"].includes(recommendation.source);
    const pending = ["pending_llm", "pending_openai"].includes(recommendation.source);
    const sourceLabel = generated
      ? `Generated with ${modelSourceLabel(recommendation.sourceModel)}`
      : pending
        ? "The selected AI model is generating this recommendation"
      : "AI recommendation unavailable";
    const sourceClass = generated
      ? "openai"
      : pending
        ? "pending"
        : "fallback";
    return `<article class="recommendation-card">
      <div class="rec-header"><div><div class="eyebrow">Subscription recommendation</div><div class="recommendation-source ${sourceClass}">${escapeHtml(sourceLabel)}</div><h2>${escapeHtml(displayChatText(recommendation.action))}</h2></div><span class="rec-status ${judgment ? "judgment" : ""}">${escapeHtml(recommendation.status)}</span></div>
      <div class="rec-body" role="table" aria-label="Subscription recommendation details">
        <div class="rec-table-head" role="row"><span role="columnheader">Recommendation field</span><span role="columnheader">Details</span></div>
        ${recommendationRow("Confidence", confidenceText(recommendation))}
        ${recommendationRow("Triggering event", recommendation.trigger)}
        ${financialImpactRow(recommendation)}
        ${recommendationRow("Viewing rationale", recommendation.rationale)}
        ${judgment ? prominentRecommendationRow("Information needed from you", recommendation.decisionHeadline || recommendation.decision, recommendation.decisionDetails) : ""}
        ${prominentRecommendationRow("Manual next steps", politeManualText(recommendation.nextHeadline || recommendation.next), politeManualText(recommendation.nextDetails))}
        ${prominentRecommendationRow("Household record reminder", recommendation.reminderHeadline || recommendation.reminder, recommendation.reminderDetails)}
      </div>
      <details class="evidence-disclosure">
        <summary>View grounding evidence</summary>
        <div class="evidence-panel"><ul class="evidence-list">${recommendation.evidence.map(item => `<li>${escapeHtml(displayChatText(item))}</li>`).join("")}</ul></div>
      </details>
    </article>`;
  }

  function refusalSectionsFromText(text) {
    const match = String(text || "").match(
      /^Your request\s*\n([\s\S]*?)\n\s*My response\s*\n([\s\S]*?)\n\s*Why I am refusing\s*\n([\s\S]*?)\n\s*What you can do next\s*\n([\s\S]*)$/i
    );
    if (!match) return null;
    return {
      yourRequest: match[1].trim(),
      myResponse: match[2].trim(),
      whyRefusing: match[3].trim(),
      whatYouCanDoNext: match[4].trim()
    };
  }

  function refusalMarkup(sections, time = "") {
    return `<div class="refusal-message">
      <article class="recommendation-card refusal-card">
        <div class="rec-header">
          <div><div class="eyebrow">Execution refusal</div><h2>I can’t complete this external account action.</h2></div>
          <span class="rec-status refusal">Advisory only</span>
        </div>
        <div class="rec-body" role="table" aria-label="Execution refusal details">
          <div class="rec-table-head" role="row"><span role="columnheader">Refusal field</span><span role="columnheader">Details</span></div>
          ${recommendationRow("Your request", sections.yourRequest)}
          ${prominentRecommendationRow("My response", sections.myResponse)}
          ${recommendationRow("Why I’m refusing", sections.whyRefusing)}
          ${prominentRecommendationRow("What you can do next", politeManualText(sections.whatYouCanDoNext))}
        </div>
      </article>
      ${time ? `<div class="message-time">${escapeHtml(time)}</div>` : ""}
    </div>`;
  }

  function choicesMarkup(state, recommendation) {
    const discussionOpen = !state.review.discussionStatus || state.review.discussionStatus === "open";
    const safetyAllowsChoices = !state.review.safetyDisposition ||
      ["normal", "adult_judgment_required"].includes(state.review.safetyDisposition);
    if (!discussionOpen || !safetyAllowsChoices || !recommendation || ["waiting_for_external_action", "completed", "discussion_resolved"].includes(state.review.status)) return "";
    if (recommendation.status === "Adult judgment required") {
      return `<div class="choices" aria-label="Respond to recommendation">
        <button class="choice-button" type="button" data-action="disagree">Add or correct information</button>
        <button class="choice-button" type="button" data-action="question">Ask a question</button>
      </div>`;
    }
    return `<div class="choices" aria-label="Respond to recommendation">
      <button class="choice-button agree" type="button" data-action="agree">I agree</button>
      <button class="choice-button" type="button" data-action="disagree">I disagree or have more information</button>
      <button class="choice-button" type="button" data-action="question">Ask a question</button>
    </div>`;
  }

  function confirmationMarkup(state, recommendation, accountUrl) {
    const subscription = engine.targetSubscription(state);
    if (!recommendation || state.review.externalActionConfirmed || subscription?.status !== "active") return "";
    const language = engine.actionLanguage[recommendation.actionType] || engine.actionLanguage.keep;
    const link = accountUrl
      ? `<a class="secondary-button" href="${escapeHtml(accountUrl)}" target="_blank" rel="noopener" style="text-decoration:none;display:inline-flex;align-items:center">Open ${escapeHtml(state.scenario.targetServiceName)} account page</a>`
      : `<span class="context-warning">No verified account link is available.</span>`;
    return `<section class="action-confirm">
      <strong>Please complete the ${escapeHtml(language.noun)} in ${escapeHtml(state.scenario.targetServiceName)}.</strong>
      <p>Agreeing did not change the external subscription or the household record. Please confirm only after you have completed the action.</p>
      <div class="action-buttons">
        ${link}
        <button class="primary-button" type="button" data-action="confirm-action">I completed the ${escapeHtml(language.noun)}</button>
        <button class="secondary-button" type="button" data-action="not-yet">Not yet</button>
      </div>
    </section>`;
  }

  function messageMarkup(message, { state, recommendation, accountUrl, activeControl = true }) {
    if (message.kind === "recommendation") return recommendationMarkup(recommendation);
    if (message.kind === "refusal") return refusalMarkup(message.refusalSections, message.time);
    if (message.kind === "choices") return activeControl ? choicesMarkup(state, recommendation) : "";
    if (message.kind === "confirmation") return activeControl ? confirmationMarkup(state, recommendation, accountUrl) : "";
    const legacyRefusal = message.role !== "user" ? refusalSectionsFromText(message.text) : null;
    if (legacyRefusal) return refusalMarkup(legacyRefusal, message.time);
    return `<div class="message ${escapeHtml(message.role)}"><div class="bubble"><p>${escapeHtml(displayChatText(message.text))}</p></div><div class="message-time">${escapeHtml(message.time)}</div></div>`;
  }

  function detailMarkup(state, recommendation) {
    if (state.review.manualScenario && !recommendation) {
      return `<div class="empty-detail"><strong>Manual scenario ready</strong> <small>Your message will use the same stored household context, instructions, safety boundaries, and selected live agent model as the guided demos.</small></div>`;
    }
    if (!state.review.started) return `<div class="empty-detail">Choose a demo trigger to see the decision summary.</div>`;
    if (!recommendation) {
      const error = state.review.recommendationError
        ? `<small>${escapeHtml(state.review.recommendationError)}</small>`
        : "<small>The model has not returned a validated decision yet.</small>";
      return `<div class="empty-detail"><strong>No recommendation available</strong>${error}</div>`;
    }
    const discussionResolved = state.review.discussionStatus === "resolved";
    const effectiveAction = discussionResolved
      ? state.review.resolutionAction || recommendation.actionType
      : recommendation.actionType;
    const finances = discussionResolved
      ? engine.recommendationFinancesForAction(state, effectiveAction)
      : recommendation.finances;
    const subscription = engine.targetSubscription(state);
    const targetActive = subscription.status === "active";
    const reducesSpend = ["cancel", "pause"].includes(effectiveAction);
    const monthlyImpact = targetActive && reducesSpend
      ? `Save ${engine.formatMoney(state, finances.monthlySavings)}`
      : recommendation.status === "Adult judgment required"
        ? `${engine.formatMoney(state, 0)} until clarified`
        : targetActive
          ? "No monthly change"
        : `${engine.formatMoney(state, finances.monthlySavings)} saved`;
    const renewal = engine.displayDate(subscription.nextRenewal, state.household.locale);
    const externalActionLabel = state.review.externalActionConfirmed
      ? "Completion confirmed"
      : discussionResolved
        ? "Not required"
        : "Not confirmed";
    const stateLabel = value => String(value || "")
      .replaceAll("_", " ")
      .replace(/\b\w/g, character => character.toUpperCase());
    const contractState = [
      state.review.lastTurnType
        ? `<div class="detail-item"><span>Latest turn type</span><strong>${escapeHtml(stateLabel(state.review.lastTurnType))}</strong></div>`
        : "",
      state.review.nextExpectedInput && state.review.nextExpectedInput !== "none"
        ? `<div class="detail-item"><span>Next expected input</span><strong>${escapeHtml(stateLabel(state.review.nextExpectedInput))}</strong></div>`
        : "",
      state.review.safetyDisposition && state.review.safetyDisposition !== "normal"
        ? `<div class="detail-item"><span>Safety disposition</span><strong>${escapeHtml(stateLabel(state.review.safetyDisposition))}</strong></div>`
        : ""
    ].join("");

    return `<div class="detail-stack">
      <div class="detail-item"><span>Status</span><strong>${escapeHtml(discussionResolved ? "Discussion resolved" : recommendation.status)}</strong></div>
      <div class="detail-item"><span>Recommendation source</span><strong>${["llm", "openai"].includes(recommendation.source) ? `${escapeHtml(modelSourceLabel(recommendation.sourceModel))} decision` : "AI recommendation unavailable"}</strong>${recommendation.sourceError ? `<small>${escapeHtml(recommendation.sourceError)}</small>` : ""}</div>
      <div class="detail-item"><span>Service</span><strong>${escapeHtml(state.scenario.targetServiceName)}</strong><small>${escapeHtml(state.scenario.targetPlanName)}</small></div>
      <div class="detail-item"><span>Renewal</span><strong>${escapeHtml(renewal)}</strong><small>${escapeHtml(subscription.commitmentTerms || subscription.billingCadence)}</small></div>
      <div class="detail-item"><span>Monthly impact</span><strong class="savings">${escapeHtml(monthlyImpact)}</strong></div>
      <div class="detail-item"><span>Adult decision</span><strong>${escapeHtml(state.review.adultDecision || "Waiting for response")}</strong></div>
      <div class="detail-item"><span>External action</span><strong>${escapeHtml(externalActionLabel)}</strong></div>
      ${contractState}
    </div>`;
  }

  function resolutionMarkup(state) {
    const action = state.review.resolutionAction || "keep";
    const resolution = state.review.resolution;
    const service = state.scenario.targetServiceName;
    const language = engine.actionLanguage[action] || engine.actionLanguage.keep;
    let title = "Discussion resolved";
    let summary = `${service} will remain unchanged. No external action is required.`;
    let badge = "Closed";
    let allowRevisit = true;

    if (state.review.externalActionConfirmed || resolution === "external_action_completed") {
      title = "External action confirmed";
      summary = `${service} is recorded as ${language.past}. Future checks will use the updated subscription status.`;
      badge = "Completed";
      allowRevisit = false;
    } else if (resolution === "recommendation_accepted" && action === "keep") {
      title = "Recommendation accepted";
      summary = `${service} will remain unchanged. No external action is required.`;
      badge = "Accepted";
    } else if (resolution === "recommendation_declined") {
      title = "Recommendation declined";
      summary = `${service} will remain unchanged. No external action is required.`;
      badge = "Resolved";
    }

    return `<section class="resolution-card" aria-label="Recommendation resolution">
      <div class="resolution-card-head"><span class="resolution-icon" aria-hidden="true">✓</span><span class="resolution-badge">${escapeHtml(badge)}</span></div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(summary)}</p>
      ${allowRevisit ? `<button class="resolution-revisit" type="button" data-action="revisit-recommendation">Revisit recommendation</button>` : ""}
    </section>`;
  }

  function safetyMarkup(state) {
    const disposition = state.review.safetyDisposition;
    const content = {
      execution_refused: [
        "Execution request declined",
        "Streaming Guard is advisory only. The adult must complete external account actions directly."
      ],
      sensitive_information_warning: [
        "Sensitive information warning",
        "Please do not share passwords, payment details, authentication codes, or other credentials in this chat."
      ],
      billing_or_legal_escalation: [
        "Planning paused",
        "This account issue requires adult judgment and the streaming provider’s official support channel."
      ],
      out_of_scope: [
        "Outside Streaming Guard’s scope",
        "This assistant can help only with household streaming-subscription planning, management, viewing access, and spending."
      ]
    }[disposition] || [
      "Adult judgment required",
      "The agent needs a specific adult decision or clarification before continuing."
    ];
    return `<section class="resolution-card safety-card" aria-label="Conversation safeguard">
      <div class="resolution-card-head"><span class="resolution-icon" aria-hidden="true">!</span><span class="resolution-badge">Safeguard</span></div>
      <h3>${escapeHtml(content[0])}</h3>
      <p>${escapeHtml(content[1])}</p>
    </section>`;
  }

  function progressMarkup(state) {
    if (state.review.safetyDisposition && !["normal", "adult_judgment_required"].includes(state.review.safetyDisposition)) {
      return safetyMarkup(state);
    }
    const selectedAction = state.review.generatedRecommendation?.actionType || state.scenario.requestedAction;
    const language = engine.actionLanguage[selectedAction] || engine.actionLanguage.keep;
    const stageIndex = {
      not_started: 0,
      trigger: 1,
      model_request: 3,
      recommendation_ready: 4,
      family_discussion: 5,
      final_agreement: 5,
      external_action: 5,
      completion_confirmed: 6
    };
    const currentIndex = state.review.discussionStatus === "resolved"
      ? 6
      : stageIndex[state.review.progressStage] ?? (state.review.started ? 1 : 0);
    const householdRequest = state.scenario.triggerType === "household_request";
    const humanDetail = state.review.progressStage === "completion_confirmed"
      ? "Adult confirmed the external action; household details were updated"
      : state.review.progressStage === "external_action"
        ? `Adult completes the ${language.noun} outside Streaming Guard and confirms it`
        : "Adult agrees, disagrees, asks questions, or adds information";
    const steps = [
      householdRequest
        ? ["Input", "New subscription request", "The adult’s request starts the review"]
        : ["Input", "Daily background sweep", "The household-triggered sweep starts the review"],
      ["Context", "Grounded household evidence", "Relevant data, policies, and calculations are assembled"],
      ["Decision", "Agent evaluates the options", "The selected model determines the best-supported recommendation"],
      ["Output", "Structured recommendation", "Evidence, financial impact, and the next step are presented in chat"],
      ["Human", "Adult review and action", humanDetail]
    ];
    const items = steps.slice(0, currentIndex).map((step, index) => {
      const oneBased = index + 1;
      const stateClass = oneBased < currentIndex ? "complete" : oneBased === currentIndex ? "current" : "";
      const symbol = oneBased < currentIndex ? "✓" : String(oneBased);
      return `<li class="progress-step ${stateClass}"><span class="progress-dot">${symbol}</span><span class="progress-phase">${escapeHtml(step[0])}</span><strong>${escapeHtml(step[1])}</strong><small>${escapeHtml(step[2])}</small></li>`;
    }).join("");
    const progress = items ? `<ol class="progress-list">${items}</ol>` : "";
    const resolution = state.review.discussionStatus === "resolved" ? resolutionMarkup(state) : "";
    return `${progress}${resolution}`;
  }

  function llmActivityMarkup(activity = {}) {
    if (!activity.status || activity.status === "idle") return "";
    const statusLabels = {
      preparing: "Preparing model request",
      waiting: "Waiting for model response",
      received: "Response received and validated",
      error: "Model request failed",
      canceled: "Model request canceled",
      not_connected: "Model connection required"
    };
    const statusRank = {
      preparing: 1,
      waiting: 3,
      received: 4,
      error: 4,
      canceled: 4,
      not_connected: 1
    }[activity.status] || 0;
    const finalMilestone = activity.status === "error"
      ? "Request failed"
      : activity.status === "canceled"
        ? "Request canceled"
        : activity.status === "not_connected"
          ? "Connection required"
          : "Response received and validated";
    const milestones = [
      ["Prepared input", 1],
      ["Request sent", 2],
      ["Waiting for response", 3],
      [finalMilestone, 4]
    ].map(([label, rank]) => {
      const complete = statusRank > rank || (activity.status === "received" && statusRank === rank);
      const current = statusRank === rank && activity.status !== "received";
      return `<li class="${complete ? "complete" : current ? "current" : ""}"><span>${complete ? "✓" : current ? "•" : "○"}</span>${escapeHtml(label)}</li>`;
    }).join("");
    const inputSummary = Array.isArray(activity.inputSummary) && activity.inputSummary.length
      ? `<details class="api-input-summary"${["preparing", "waiting"].includes(activity.status) ? " open" : ""}>
          <summary>Context</summary>
          <ul>${activity.inputSummary.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </details>`
      : "";
    const elapsed = Number.isFinite(activity.elapsedMs)
      ? `${(activity.elapsedMs / 1000).toFixed(1)}s elapsed`
      : "";
    const usage = activity.usageText ? `<span>${escapeHtml(activity.usageText)}</span>` : "";
    const response = activity.responseId
      ? `<span>Response ${escapeHtml(String(activity.responseId).slice(0, 18))}</span>`
      : "";
    return `<section class="api-activity-card ${escapeHtml(activity.status)}" aria-label="Live AI API activity">
      <div class="api-activity-heading"><span class="api-live-dot" aria-hidden="true"></span><div><small>Live AI API activity</small><strong>${escapeHtml(statusLabels[activity.status] || activity.status)}</strong></div></div>
      <div class="api-model-line"><span>${escapeHtml(activity.provider || "AI provider")}</span><strong>${escapeHtml(activity.model || "Selected model")}</strong></div>
      <ol class="api-milestones">${milestones}</ol>
      ${inputSummary}
      ${activity.error ? `<p class="api-error">${escapeHtml(activity.error)}</p>` : ""}
      <div class="api-activity-meta">${elapsed ? `<span>${escapeHtml(elapsed)}</span>` : ""}${usage}${response}</div>
      <p class="api-security-note">API keys and full prompt contents are never displayed here.</p>
    </section>`;
  }

  function contextPolicyTraceMarkup(activity = {}, state = {}) {
    const trace = activity.trace;
    if (!trace) {
      if (!state.review?.manualScenario) return "";
      return `<section class="context-trace-card context-trace-empty" aria-label="Context and policy trace">
        <div class="context-trace-heading">
          <div><small>Context and policy trace</small><strong>Waiting for your first message</strong></div>
        </div>
        <p>Each manual-chat interaction will show the relevant household data, policies, simulated tools, validation, and memory result here.</p>
      </section>`;
    }
    const statusLabels = {
      preparing: "Preparing grounded context",
      waiting: "Context sent to the model",
      received: "Context use validated",
      error: "Interaction could not be completed",
      canceled: "Interaction canceled",
      not_connected: "Model connection required"
    };
    const rows = items => (Array.isArray(items) ? items : []).map(item => `
      <li><span class="context-trace-check" aria-hidden="true">✓</span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.detail)}</small></div></li>
    `).join("");
    const sections = [
      ["Relevant data", Array.isArray(trace.sources) ? trace.sources : []],
      ["Instructions and policies", Array.isArray(trace.policies) ? trace.policies : []],
      ["Simulated tools", Array.isArray(trace.tools) ? trace.tools : []]
    ].map(([label, items], index) => `
      <details class="context-trace-group"${index === 0 ? " open" : ""}>
        <summary>${escapeHtml(label)} <span>${items.length}</span></summary>
        <ul>${rows(items)}</ul>
      </details>
    `).join("");
    return `<section class="context-trace-card ${escapeHtml(activity.status || "preparing")}" aria-label="Context and policy trace">
      <div class="context-trace-heading">
        <span class="context-trace-live-dot" aria-hidden="true"></span>
        <div><small>Context and policy trace</small><strong>${escapeHtml(statusLabels[activity.status] || "Context prepared")}</strong></div>
        <span class="context-trace-count">${Array.isArray(trace.sources) ? trace.sources.length : 0} sources</span>
      </div>
      ${sections}
      <div class="context-trace-outcome"><span>Validation</span><strong>${escapeHtml(trace.validationOutcome || "No validation result is available yet.")}</strong></div>
      <div class="context-trace-outcome"><span>Memory</span><strong>${escapeHtml(trace.memoryOutcome || "No memory result is available yet.")}</strong></div>
    </section>`;
  }

  function spendingMarkup(state) {
    const table = (label, headers, rows) => `<div class="settings-table-wrap"><table class="settings-table" aria-label="${escapeHtml(label)}"><thead><tr>${headers.map(header => `<th scope="col">${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
    const currentMonthlySpend = math.sumMonthlyCosts(state.subscriptions);
    const history = (state.householdSpendingHistory || [])
      .map(record => ({
        ...record,
        totalMonthlySpend: Number(record.monthOffset) === 0
          ? currentMonthlySpend
          : Number(record.totalMonthlySpend),
        recommendationSavings: Number(record.recommendationSavings || 0)
      }))
      .sort((left, right) => left.monthOffset - right.monthOffset);
    const monthDate = offset => {
      const date = new Date(`${state.systemDate}T12:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() + Number(offset));
      return date;
    };
    const monthLabel = (offset, format = "short") => new Intl.DateTimeFormat(state.household.locale, {
      month: format,
      year: format === "long" ? "numeric" : undefined,
      timeZone: "UTC"
    }).format(monthDate(offset));
    const currentYear = monthDate(0).getUTCFullYear();
    const annualByYear = new Map();
    history.forEach(record => {
      const year = monthDate(record.monthOffset).getUTCFullYear();
      const annual = annualByYear.get(year) || { year, monthsTracked: 0, subscriptionSpending: 0, recommendationSavings: 0 };
      annual.monthsTracked += 1;
      annual.subscriptionSpending = math.roundCurrency(annual.subscriptionSpending + record.totalMonthlySpend);
      annual.recommendationSavings = math.roundCurrency(annual.recommendationSavings + record.recommendationSavings);
      annualByYear.set(year, annual);
    });
    const annualHistory = [...annualByYear.values()].sort((left, right) => right.year - left.year);
    const currentAnnual = annualByYear.get(currentYear) || { subscriptionSpending: 0, recommendationSavings: 0, monthsTracked: 0 };
    const totalTrackedSpending = math.roundCurrency(history.reduce((total, record) => total + record.totalMonthlySpend, 0));
    const totalRecommendationSavings = math.roundCurrency(history.reduce((total, record) => total + record.recommendationSavings, 0));
    const budgetUtilization = math.calculateBudgetUtilization(currentMonthlySpend, state.familyRules.monthlyBudgetCap);
    const lastTwelveMonths = history.slice(-12);

    const chartMarkup = (() => {
      if (!lastTwelveMonths.length) return `<p>No household spending history is available.</p>`;
      const width = 720;
      const height = 250;
      const padding = { top: 24, right: 20, bottom: 42, left: 58 };
      const plotWidth = width - padding.left - padding.right;
      const plotHeight = height - padding.top - padding.bottom;
      const highestValue = Math.max(
        state.familyRules.monthlyBudgetCap,
        ...lastTwelveMonths.flatMap(record => [record.totalMonthlySpend, record.recommendationSavings])
      );
      const axisMaximum = Math.max(10, Math.ceil(highestValue / 10) * 10);
      const x = index => padding.left + (lastTwelveMonths.length === 1 ? 0 : (index / (lastTwelveMonths.length - 1)) * plotWidth);
      const y = value => padding.top + (1 - Number(value) / axisMaximum) * plotHeight;
      const spendingPoints = lastTwelveMonths.map((record, index) => `${x(index).toFixed(1)},${y(record.totalMonthlySpend).toFixed(1)}`).join(" ");
      const savingsPoints = lastTwelveMonths.map((record, index) => `${x(index).toFixed(1)},${y(record.recommendationSavings).toFixed(1)}`).join(" ");
      const grid = [axisMaximum, axisMaximum / 2, 0].map(value => {
        const gridY = y(value);
        return `<g><line class="spending-chart-grid" x1="${padding.left}" y1="${gridY}" x2="${width - padding.right}" y2="${gridY}"></line><text class="spending-chart-axis" x="${padding.left - 10}" y="${gridY + 4}" text-anchor="end">${escapeHtml(engine.formatMoney(state, value))}</text></g>`;
      }).join("");
      const budgetY = y(state.familyRules.monthlyBudgetCap);
      const labels = lastTwelveMonths.map((record, index) =>
        `<text class="spending-chart-month" x="${x(index)}" y="${height - 12}" text-anchor="middle">${escapeHtml(monthLabel(record.monthOffset))}</text>`
      ).join("");
      const spendingDots = lastTwelveMonths.map((record, index) =>
        `<circle class="spending-chart-point${Number(record.monthOffset) === 0 ? " current" : ""}" cx="${x(index)}" cy="${y(record.totalMonthlySpend)}" r="${Number(record.monthOffset) === 0 ? 5 : 3}"><title>${escapeHtml(`${monthLabel(record.monthOffset, "long")} subscription spending: ${engine.formatMoney(state, record.totalMonthlySpend)}. ${record.changeNote || ""}`)}</title></circle>`
      ).join("");
      const savingsDots = lastTwelveMonths.map((record, index) =>
        `<circle class="spending-chart-point savings${Number(record.monthOffset) === 0 ? " current" : ""}" cx="${x(index)}" cy="${y(record.recommendationSavings)}" r="${Number(record.monthOffset) === 0 ? 5 : 3}"><title>${escapeHtml(`${monthLabel(record.monthOffset, "long")} savings from recommendations: ${engine.formatMoney(state, record.recommendationSavings)}`)}</title></circle>`
      ).join("");
      return `<div class="spending-chart-wrap">
        <div class="spending-chart-legend"><span><i class="spending-legend-line"></i>Subscription spending</span><span><i class="spending-legend-line savings"></i>Savings from recommendations</span></div>
        <svg class="spending-chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="spendingChartTitle spendingChartDescription">
          <title id="spendingChartTitle">Household subscription spending and recommendation savings over the past 12 months</title>
          <desc id="spendingChartDescription">The chart compares monthly subscription spending with realized savings attributed to completed Streaming Guard recommendations.</desc>
          ${grid}
          <line class="spending-chart-budget" x1="${padding.left}" y1="${budgetY}" x2="${width - padding.right}" y2="${budgetY}"></line>
          <text class="spending-chart-budget-label" x="${width - padding.right}" y="${Math.max(12, budgetY - 7)}" text-anchor="end">Monthly budget ${escapeHtml(engine.formatMoney(state, state.familyRules.monthlyBudgetCap))}</text>
          <polyline class="spending-chart-line" points="${spendingPoints}"></polyline>
          <polyline class="spending-chart-line savings" points="${savingsPoints}"></polyline>
          ${spendingDots}
          ${savingsDots}
          ${labels}
        </svg>
      </div>`;
    })();

    const annualRows = annualHistory.map(annual => `<tr>
      <th scope="row">${escapeHtml(annual.year)}${annual.year === currentYear ? " <small>Year to date</small>" : ""}</th>
      <td>${escapeHtml(annual.monthsTracked)}</td>
      <td><strong>${escapeHtml(engine.formatMoney(state, annual.subscriptionSpending))}</strong></td>
      <td><strong class="savings">${escapeHtml(engine.formatMoney(state, annual.recommendationSavings))}</strong></td>
    </tr>`);

    const subscriptionRows = state.subscriptions
      .filter(subscription => subscription.status === "active")
      .sort((left, right) => left.service.localeCompare(right.service))
      .map(subscription => {
        const nonRenewing = subscription.renewalStatus === "non_renewing";
        const promotion = String(subscription.promotionOrBundle || "none");
        const hasPromotion = promotion.toLowerCase() !== "none";
        const constraintParts = [
          subscription.billingCadence ? `Billed ${String(subscription.billingCadence).replaceAll("_", " ")}` : "",
          subscription.commitmentTerms || "",
          subscription.prepaidThrough ? `Prepaid through ${engine.displayDate(subscription.prepaidThrough, state.household.locale)}` : "",
          subscription.cancellationConsequences || ""
        ].filter(Boolean);
        return `<tr>
          <td><strong>${escapeHtml(subscription.service)}</strong></td>
          <td>${escapeHtml(subscription.plan)}</td>
          <td><span class="subscription-state-badge${nonRenewing ? " non-renewing" : ""}">${nonRenewing ? "Active · will not renew" : "Active · auto-renews"}</span></td>
          <td>${escapeHtml(engine.formatMoney(state, subscription.monthlyCost))}</td>
          <td><strong>${nonRenewing ? "Expires" : "Renews"} ${escapeHtml(engine.displayDate(nonRenewing ? subscription.expirationDate : subscription.nextRenewal, state.household.locale))}</strong>${nonRenewing ? "<small>Access remains active until this date.</small>" : ""}</td>
          <td>${hasPromotion ? `<span class="promotion-badge">${escapeHtml(promotion)}</span>` : "Standard price"}</td>
          <td>${escapeHtml(constraintParts.join(" · ") || "No special subscription constraints")}</td>
        </tr>`;
      });

    const recentEvents = (state.recommendationSavingsEvents || []).slice(-5).reverse();
    const recentEventsMarkup = recentEvents.length
      ? `<div class="spending-events">${recentEvents.map(event => `<div><span>${escapeHtml(engine.displayDate(event.confirmedOn, state.household.locale))}</span><strong>${escapeHtml(event.service)} ${escapeHtml(event.action)}</strong><small>${escapeHtml(engine.formatMoney(state, event.monthlySavings))} added to recognized monthly savings</small></div>`).join("")}</div>`
      : `<p>No new recommendation savings have been confirmed during the current saved demo state.</p>`;

    return `<div class="spending-dashboard">
      <section class="memory-block spending-summary-card">
        <div class="context-overview-heading"><div><span>Financial overview</span><h3>Tracked household spending and savings</h3><p>Tracking began ${escapeHtml(monthLabel(history[0]?.monthOffset || 0, "long"))}.</p></div><span class="context-current-badge">Updated from household records</span></div>
        <div class="spending-kpis">
          <div class="context-metric featured"><span>Current monthly spending</span><strong>${escapeHtml(engine.formatMoney(state, currentMonthlySpend))}</strong><small>${escapeHtml(budgetUtilization.utilizationPercent.toFixed(1))}% of the monthly budget</small></div>
          <div class="context-metric"><span>${escapeHtml(currentYear)} spending</span><strong>${escapeHtml(engine.formatMoney(state, currentAnnual.subscriptionSpending))}</strong><small>${escapeHtml(currentAnnual.monthsTracked)} months tracked year to date</small></div>
          <div class="context-metric savings-metric"><span>${escapeHtml(currentYear)} recommendation savings</span><strong>${escapeHtml(engine.formatMoney(state, currentAnnual.recommendationSavings))}</strong><small>realized savings year to date</small></div>
          <div class="context-metric savings-metric"><span>Total saved to date</span><strong>${escapeHtml(engine.formatMoney(state, totalRecommendationSavings))}</strong><small>across all tracked recommendations</small></div>
          <div class="context-metric"><span>Total subscription spending</span><strong>${escapeHtml(engine.formatMoney(state, totalTrackedSpending))}</strong><small>across ${escapeHtml(history.length)} tracked months</small></div>
        </div>
      </section>
      <section class="memory-block"><h3>Past 12 months</h3><p>Monthly subscription spending compared with savings realized from completed recommendations.</p>${chartMarkup}</section>
      <section class="memory-block"><h3>Annual history</h3><p>Subscription spending and recognized recommendation savings are aggregated from the household’s monthly financial history.</p>${table("Annual subscription spending and recommendation savings", ["Year", "Months tracked", "Subscription spending", "Saved with recommendations"], annualRows)}</section>
      <section class="memory-block"><h3>Current subscriptions</h3><p>Active services remain part of current spending until they are canceled, paused, or reach a recorded expiration date.</p>${table("Current household subscriptions", ["Service", "Plan", "Status", "Monthly price", "Renewal or expiration", "Pricing", "Subscription constraints"], subscriptionRows)}</section>
      <section class="memory-block"><h3>Recently confirmed savings</h3><p>A saving is recorded only after the adult confirms completing the recommended external action.</p>${recentEventsMarkup}</section>
      <section class="spending-method-note"><strong>How savings are counted</strong><p>Streaming Guard records realized monthly savings after a confirmed cancellation or pause. Agreement alone does not count as savings, and repeated confirmation cannot count the same active subscription twice.</p></section>
    </div>`;
  }

  function evaluationMarkup(model) {
    const caseCount = model.cases.length;
    const running = Boolean(model.runningEvalId || model.runningAll);
    const canRun = model.promptApproved && model.connected && !running;
    const runComplete = model.hasCurrentResults && model.counts.not_run === 0 && !running;
    const verdictLabel = verdict => ({
      pass: "Passed",
      fail: "Failed",
      error: "Error",
      not_run: "Not run"
    })[verdict] || "Not run";
    const dateTime = value => value
      ? new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit"
        }).format(new Date(value))
      : "";
    const promptSpecs = [
      {
        key: "coreSystemPrompt",
        title: "Core System Prompt",
        description: "Section 1 · instructions/core_system_prompt.md",
        prompt: model.prompts.coreSystemPrompt
      },
      {
        key: "immutableEscalationPolicy",
        title: "Immutable Escalation Policy",
        description: "Section 2 · instructions/immutable_escalation_policy.md",
        prompt: model.prompts.immutableEscalationPolicy
      },
      {
        key: "runtimeGroundingRules",
        title: "Runtime Grounding Rules",
        description: "Section 3 · instructions/runtime_grounding_rules.md",
        prompt: model.prompts.runtimeGroundingRules
      },
      {
        key: "recommendationAddon",
        title: "Recommendation Add-On",
        description: "Section 4 · instructions/recommendation_add_on.md",
        prompt: model.prompts.recommendationAddon
      },
      {
        key: "conversationAddon",
        title: "Conversation Add-On",
        description: "Section 5 · instructions/conversation_add_on.md",
        prompt: model.prompts.conversationAddon
      },
      {
        key: "evaluationJudge",
        title: "Evaluation Judge Instructions",
        description: "Section 6 · instructions/evaluation_judge.md",
        prompt: model.prompts.evaluationJudge
      }
    ];
    const promptCard = ({ key, title, description, prompt }) => `<div class="eval-prompt-card-shell">
      <details class="eval-prompt-card">
        <summary><div><h4>${escapeHtml(title)}</h4><p>${escapeHtml(description)}</p></div></summary>
        <pre class="eval-prompt-text">${escapeHtml(prompt)}</pre>
      </details>
      <button class="eval-prompt-fullscreen-button" type="button" data-eval-action="open-instruction-fullscreen" data-instruction-key="${escapeHtml(key)}" aria-label="Read ${escapeHtml(title)} in full screen">Read full screen</button>
    </div>`;
    const selectedPrompt = promptSpecs.find(item => item.key === model.fullScreenInstructionKey);
    const activeEvalId = model.cases.some(item => item.eval_id === model.selectedEvalId)
      ? model.selectedEvalId
      : model.cases.find(item => ["fail", "error"].includes(item.result?.verdict))?.eval_id || model.cases[0]?.eval_id;
    const caseList = model.cases.map(item => {
      const result = item.result;
      const verdict = result?.verdict || "not_run";
      const isRunning = model.runningEvalId === item.eval_id;
      const selected = item.eval_id === activeEvalId;
      return `<button class="eval-case-nav-item ${selected ? "selected" : ""}" type="button" data-eval-action="select-case" data-eval-id="${escapeHtml(item.eval_id)}" aria-selected="${selected}">
        <span class="eval-case-nav-id">${escapeHtml(item.eval_id)}</span>
        <strong>${escapeHtml(item.case_name)}</strong>
        <span class="eval-case-nav-verdict ${escapeHtml(verdict)}">${isRunning ? "Running…" : escapeHtml(verdictLabel(verdict))}</span>
      </button>`;
    }).join("");

    const selectedItem = model.cases.find(item => item.eval_id === activeEvalId) || model.cases[0];
    const canRunSelected = model.promptApproved && !running && (model.connected || selectedItem?.task_type === "workflow");
    const selectedResult = selectedItem?.result;
    const selectedVerdict = selectedResult?.verdict || "not_run";
    const isSelectedRunning = model.runningEvalId === selectedItem?.eval_id;
    const selectedCriteria = selectedResult?.criteria || [];
    const criteriaPassed = selectedCriteria.filter(check => check.passed).length;
    const criteriaMarkup = selectedCriteria.length
      ? `<details class="eval-checks"${["fail", "error"].includes(selectedVerdict) ? " open" : ""}>
          <summary><span>${selectedItem?.task_type === "workflow" ? "Deterministic workflow checks" : "Validation and judge checks"}</span><strong>${escapeHtml(criteriaPassed)} of ${escapeHtml(selectedCriteria.length)} passed</strong></summary>
          <ul class="eval-criteria">${selectedCriteria.map(check => `<li class="${check.passed ? "pass" : "fail"}"><span aria-hidden="true">${check.passed ? "✓" : "×"}</span><div><strong>${escapeHtml(check.label)}</strong><small>${escapeHtml(check.detail)}</small></div></li>`).join("")}</ul>
        </details>`
      : "";
    const selectedOutput = selectedResult?.output
      ? `<details class="eval-output"><summary>${selectedItem?.task_type === "workflow" ? "Structured workflow output" : "Structured model output"}</summary><pre>${escapeHtml(JSON.stringify(selectedResult.output, null, 2))}</pre></details>`
      : "";
    const selectedJudgment = selectedResult?.judgment
      ? `<details class="eval-output"><summary>Independent judge output</summary><pre>${escapeHtml(JSON.stringify(selectedResult.judgment, null, 2))}</pre></details>`
      : "";
    const selectedError = selectedResult?.error ? `<p class="eval-error">${escapeHtml(selectedResult.error)}</p>` : "";

    return `<div class="evaluation-runner">
      <section class="eval-command-bar" aria-label="Evaluation controls">
        <div class="eval-score-chips" aria-label="Evaluation results">
          <span class="pass"><strong>${escapeHtml(model.counts.pass)}</strong> passed</span>
          <span class="fail"><strong>${escapeHtml(model.counts.fail)}</strong> failed</span>
          <span class="error"><strong>${escapeHtml(model.counts.error)}</strong> errors</span>
          <span><strong>${escapeHtml(model.counts.not_run)}</strong> not run</span>
        </div>
        <div class="eval-toolbar-actions">
          ${running
            ? `<button class="eval-stop-button" type="button" data-eval-action="stop-tests">Stop tests</button>`
            : `<button class="primary-button" type="button" data-eval-action="run-all" ${canRun ? "" : "disabled"}>${runComplete ? "Run all cases again" : "Run all cases"}</button>`}
          <button class="secondary-button" type="button" data-eval-action="copy-all-results" ${model.hasSavedResults && !running ? "" : "disabled"}>Copy output</button>
          <button class="secondary-button" type="button" data-eval-action="clear-results" ${running ? "disabled" : ""}>Clear results</button>
          <details class="eval-more-menu">
            <summary>More</summary>
            <div>
              <button type="button" data-eval-action="rejudge-results" ${model.hasRejudgeableResults && canRun ? "" : "disabled"}>Rejudge saved outputs</button>
              ${model.promptApproved ? `<button type="button" data-eval-action="revoke-approval">Revoke instructions approval</button>` : ""}
            </div>
          </details>
        </div>
      </section>

      ${model.hasSavedResults && model.counts.not_run === caseCount && model.hasRejudgeableResults ? `<p class="eval-notice">The saved agent outputs are compatible with the current agent instructions. Approve the current judge instructions, then rejudge them without regenerating the responses.</p>` : ""}
      ${model.hasSavedResults && model.counts.not_run === caseCount && !model.hasRejudgeableResults ? `<p class="eval-notice">Saved outputs from an incompatible prompt version remain available through Copy output.</p>` : ""}
      ${!model.promptApproved ? `<p class="eval-notice">Open Instructions, review the prompt bundle and ${escapeHtml(caseCount)} expected outcomes, then approve it before running a case.</p>` : ""}
      ${model.promptApproved && !model.connected ? `<p class="eval-notice">The prompt is approved. Connect the providers required by the selected models from the top banner.</p>` : ""}

      <div class="eval-results-workspace">
        <aside class="eval-case-navigator" aria-label="Evaluation cases">
          <header><div><span>Overall set</span><h3>${escapeHtml(caseCount)} cases</h3></div><small>Select a case to review</small></header>
          <div class="eval-case-nav-list" role="listbox">${caseList}</div>
        </aside>

        <section class="eval-selected-case" aria-label="Selected evaluation result">
          <article class="eval-case-card">
            <div class="eval-case-heading">
              <div><span>${escapeHtml(selectedItem.eval_id)} · ${escapeHtml(selectedItem.task_type === "conversation" ? "Conversation boundary" : selectedItem.task_type === "workflow" ? "Local workflow" : "Recommendation")}</span><h3>${escapeHtml(selectedItem.case_name)}</h3></div>
              <div class="eval-case-heading-actions">
                <span class="eval-verdict ${escapeHtml(selectedVerdict)}">${isSelectedRunning ? "Running…" : escapeHtml(verdictLabel(selectedVerdict))}</span>
                <button class="eval-case-run" type="button" data-eval-action="run-case" data-eval-id="${escapeHtml(selectedItem.eval_id)}" ${canRunSelected ? "" : "disabled"}>${selectedResult ? "Run case again" : "Run this case"}</button>
              </div>
            </div>
            <details class="eval-case-definition"${selectedResult ? "" : " open"}>
              <summary>Case definition and expected outcome</summary>
              <div class="eval-case-grid">
                <div><span>Fixed input</span><p>${escapeHtml(selectedItem.input_summary)}</p>${selectedItem.user_input ? `<blockquote>${escapeHtml(selectedItem.user_input)}</blockquote>` : ""}</div>
                <div><span>Expected outcome</span><p><strong>${escapeHtml(selectedItem.expected_status)}</strong> · ${escapeHtml(selectedItem.expected_action)}</p><p>${escapeHtml(selectedItem.expected_behavior)}</p></div>
              </div>
            </details>
            <details class="eval-manual-review"${selectedResult ? " open" : ""}>
              <summary>Human-readable input and output</summary>
              <div class="eval-manual-grid">
                <section><span>Human-readable input</span><div class="eval-readable-text">${escapeHtml(selectedItem.humanReadableInput)}</div></section>
                <section><span>Human-readable output</span><div class="eval-readable-text">${escapeHtml(selectedItem.humanReadableOutput)}</div></section>
              </div>
            </details>
            ${criteriaMarkup}${selectedError}${selectedOutput}${selectedJudgment}
            <div class="eval-case-footer">
              <small>${selectedResult?.completedAt ? `Completed ${escapeHtml(dateTime(selectedResult.completedAt))}${selectedResult.model ? ` · response ${escapeHtml(selectedResult.model)}` : ""}${selectedResult.judgeModel ? ` · judge ${escapeHtml(selectedResult.judgeModel)}` : ""}` : "No API call has been made for this case."}</small>
            </div>
          </article>
        </section>
      </div>

      <button class="eval-drawer-backdrop" type="button" data-eval-action="close-instructions" aria-label="Close instructions"${model.instructionsOpen ? "" : " hidden"}></button>
      <aside class="eval-instructions-drawer" aria-label="Evaluation instructions"${model.instructionsOpen ? "" : " hidden"}>
        <header class="eval-drawer-header"><div><span>Required review gate</span><h3>Instructions</h3></div><button class="eval-drawer-close" type="button" data-eval-action="close-instructions" aria-label="Close instructions">×</button></header>
        <div class="eval-drawer-scroll">
          <div class="eval-section-heading"><div><p>These are the exact provider-independent instruction components used by every live model call.</p></div><code>${escapeHtml(model.promptHash)}</code></div>
          <p class="eval-component-map">Sections 1–3 are global. Recommendation calls add section 4; conversation calls add section 5. Section 6 governs the independent judge.</p>
          ${promptSpecs.map(promptCard).join("")}
          <div class="eval-approval-gate ${model.promptApproved ? "approved" : ""}">
            ${model.promptApproved
              ? `<div><strong>Prompt review approved</strong><span>${escapeHtml(dateTime(model.approvedAt))} · Expires automatically if the instructions or cases change.</span></div><button type="button" data-eval-action="revoke-approval">Revoke approval</button>`
              : `<label><input id="promptReviewConfirmation" type="checkbox"> <span>I reviewed all six instruction sections and ${escapeHtml(caseCount)} expected outcomes.</span></label><button type="button" data-eval-action="approve-prompt" disabled>Approve for eval run</button>`}
          </div>
        </div>
      </aside>
      ${selectedPrompt ? `<section class="eval-instruction-fullscreen" role="dialog" aria-modal="true" aria-labelledby="fullScreenInstructionTitle">
        <header>
          <div>
            <span>${escapeHtml(selectedPrompt.description)}</span>
            <h3 id="fullScreenInstructionTitle">${escapeHtml(selectedPrompt.title)}</h3>
          </div>
          <button class="eval-instruction-fullscreen-close" type="button" data-eval-action="close-instruction-fullscreen" data-instruction-key="${escapeHtml(selectedPrompt.key)}" aria-label="Close full-screen instruction">×</button>
        </header>
        <pre>${escapeHtml(selectedPrompt.prompt)}</pre>
      </section>` : ""}
    </div>`;
  }

  function memoryMarkup(state) {
    const memberById = memberId => state.members.find(member => member.id === memberId);
    const memberName = memberId => memberById(memberId)?.name || memberId;
    const effectiveDate = (record, dateField, offsetField) => record[dateField]
      || (state.systemDate && Number.isFinite(record[offsetField]) ? math.addDays(state.systemDate, record[offsetField]) : null);
    const contentType = value => ({
      tv_series: "TV show",
      limited_series: "Limited series",
      documentary_series: "Documentary series",
      movie: "Movie"
    })[value] || String(value || "Title").replaceAll("_", " ");
    const statusLabel = value => ({
      active: "Want to watch",
      completed: "Completed",
      watching: "Currently watching",
      not_started: "Not started"
    })[value] || String(value || "Unknown").replaceAll("_", " ");
    const priorityRank = { high: 0, medium: 1, low: 2 };
    const priorityMarkup = priority => {
      const normalized = ["high", "medium", "low"].includes(priority) ? priority : "low";
      return `<span class="priority-badge priority-${normalized}">${escapeHtml(normalized[0].toUpperCase() + normalized.slice(1))}</span>`;
    };
    const table = (label, headers, rows) => `<div class="settings-table-wrap"><table class="settings-table" aria-label="${escapeHtml(label)}"><thead><tr>${headers.map(header => `<th scope="col">${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
    const collapsibleCard = (title, description, content, { open = false } = {}) => `<details class="memory-block memory-block-wide memory-collapsible"${open ? " open" : ""}><summary><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div></summary><div class="memory-collapsible-content">${content}</div></details>`;

    const authorizedAdult = memberById(state.household.authorizedAdultMemberId);
    const householdMembers = state.members.map(member =>
      `<li><strong>${escapeHtml(member.name)}</strong>${Number(member.age) < 18 ? ` <span>· age ${escapeHtml(member.age)}</span>` : ""}</li>`
    ).join("");
    const preferenceRows = state.members.map(member => {
      const viewingPreference = String(member.viewingPriority || "").trim();
      const preferenceNote = viewingPreference
        ? viewingPreference[0].toUpperCase() + viewingPreference.slice(1)
        : "No additional viewing preference recorded";
      return `<tr><th scope="row">${escapeHtml(member.name)}</th><td>${escapeHtml((member.preferences || []).join(", "))}</td><td>${escapeHtml(preferenceNote)}</td></tr>`;
    });
    const adsPreference = state.household.advertisingTolerance === "limited"
      ? "A limited number of ads is acceptable, but the family prefers fewer interruptions."
      : state.household.advertisingTolerance === "none"
        ? "The family prefers plans without ads."
        : "Plans with ads are acceptable.";
    const picturePreference = /4K.*2K/i.test(state.household.resolutionPreference)
      ? "Use the best available picture quality for shared movie nights; regular high-definition quality is fine otherwise."
      : state.household.resolutionPreference;
    const territory = state.household.territory === "US" ? "United States" : state.household.territory;
    const confirmedDate = offset => engine.displayDate(
      math.addDays(state.systemDate, Number.isFinite(offset) ? offset : 0),
      state.household.locale
    );
    const freshness = state.contextFreshness || {};
    const freshnessRows = [
      ["Household profile", freshness.householdOffsetDays],
      ["Family rules", freshness.familyRulesOffsetDays],
      ["Current subscriptions", freshness.subscriptionsOffsetDays],
      ["Household watchlist", freshness.watchlistOffsetDays],
      ["Viewing information", freshness.viewingOffsetDays]
    ].map(([category, offset]) => `<tr><th scope="row">${escapeHtml(category)}</th><td>${escapeHtml(confirmedDate(offset))}</td></tr>`);
    const freshnessOffsets = Object.values(freshness).filter(Number.isFinite);
    const latestConfirmedOffset = freshnessOffsets.length ? Math.max(...freshnessOffsets) : 0;
    const activeSubscriptions = state.subscriptions.filter(subscription => subscription.status === "active");
    const nonRenewingSubscriptions = activeSubscriptions.filter(subscription => subscription.renewalStatus === "non_renewing");
    const householdWatchlistCount = (state.householdWatchlist || state.watchlist).length;
    const currentlyWatchingCount = (state.householdViewing || state.viewing).filter(record => record.status === "watching").length;

    const restrictionRows = state.members.map(member => {
      const rule = state.familyRules.contentLimits.find(item => item.member_id === member.id);
      const titleExceptions = (state.familyRules.contentRatingExceptions || [])
        .filter(item => item.memberId === member.id && item.approved)
        .map(item => `${item.titleName || item.titleId} (${item.rating || "rating recorded"})`);
      let restriction = "No household viewing restriction";
      if (rule) {
        const television = rule.television_limit.startsWith("Through ")
          ? `${rule.television_limit.replace("Through ", "")} or below for TV shows`
          : `${rule.television_limit} for TV shows`;
        const movies = rule.movie_limit.startsWith("Through ")
          ? `${rule.movie_limit.replace("Through ", "")} or below for movies`
          : `${rule.movie_limit} for movies`;
        restriction = `${television}; ${movies}`;
      }
      if (titleExceptions.length) {
        restriction += `. Approved title-specific exception${titleExceptions.length === 1 ? "" : "s"}: ${titleExceptions.join(", ")}`;
      }
      return `<tr><td>${escapeHtml(member.name)}${Number(member.age) < 18 ? ` <small>Age ${escapeHtml(member.age)}</small>` : ""}</td><td>${escapeHtml(restriction)}</td></tr>`;
    });

    const householdWatchlist = (state.householdWatchlist || state.watchlist).map(entry => {
      const current = state.watchlist.find(item => item.id === entry.id);
      return current ? { ...entry, ...current } : entry;
    });
    const householdViewingByKey = new Map((state.householdViewing || []).map(record => [
      `${record.caseId}|${record.memberId}|${record.titleId}`,
      record
    ]));
    state.viewing.forEach(record => {
      householdViewingByKey.set(`${state.scenario.id}|${record.memberId}|${record.titleId}`, {
        ...record,
        caseId: state.scenario.id,
        title: state.watchlist.find(entry => entry.titleId === record.titleId)?.title || state.scenario.titleName
      });
    });
    const watchlistRows = state.members.map(member => {
      const titles = householdWatchlist
        .filter(entry => entry.memberId === member.id)
        .sort((left, right) => (priorityRank[left.priority] ?? 3) - (priorityRank[right.priority] ?? 3) || left.title.localeCompare(right.title));
      const titleList = titles.length ? titles.map(entry => {
        const priority = ["high", "medium", "low"].includes(entry.priority) ? entry.priority : "low";
        const viewing = householdViewingByKey.get(`${entry.caseId}|${entry.memberId}|${entry.titleId}`);
        const viewingStatus = viewing?.status || entry.status;
        const progress = viewingStatus === "watching" && Number.isFinite(viewing?.progressPercent)
          ? ` · ${Math.round(viewing.progressPercent)}% complete`
          : "";
        const waitPreference = entry.status === "completed"
          ? ""
          : Number(entry.acceptableWaitDays) > 0
            ? `Willing to wait up to ${Math.round(entry.acceptableWaitDays)} days`
            : "Prefers immediate availability";
        return `<li class="watchlist-title-item">
          <div><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(contentType(entry.contentType))}${waitPreference ? ` · ${escapeHtml(waitPreference)}` : ""}</small></div>
          <div class="title-status">${priorityMarkup(priority)}<span>${escapeHtml(statusLabel(viewingStatus))}${escapeHtml(progress)}</span></div>
        </li>`;
      }).join("") : `<li class="empty-table-cell">No watchlist titles</li>`;
      return `<tr><th scope="row">${escapeHtml(member.name)}</th><td><ul class="grouped-title-list">${titleList}</ul></td></tr>`;
    });

    const upcomingByTitle = new Map();
    householdWatchlist.forEach(entry => {
      const releaseDate = effectiveDate(entry, "nextReleaseDate", "nextReleaseOffsetDays");
      if (!releaseDate || releaseDate < state.systemDate) return;
      const key = `${entry.titleId}|${releaseDate}`;
      const existing = upcomingByTitle.get(key);
      if (existing) {
        if (!existing.memberIds.includes(entry.memberId)) existing.memberIds.push(entry.memberId);
      } else {
        upcomingByTitle.set(key, { ...entry, releaseDate, memberIds: [entry.memberId] });
      }
    });
    const upcomingRows = [...upcomingByTitle.values()]
      .sort((left, right) => left.releaseDate.localeCompare(right.releaseDate))
      .slice(0, 5)
      .map(entry => `<tr>
        <td><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(entry.nextReleaseLabel || "Upcoming release")}</small></td>
        <td>${escapeHtml(contentType(entry.contentType))}</td>
        <td>${escapeHtml(engine.displayDate(entry.releaseDate, state.household.locale))}</td>
        <td>${escapeHtml(entry.memberIds.map(memberName).join(", "))}</td>
      </tr>`);

    const viewingById = new Map((state.householdViewingHistory || []).map(record => [record.id, record]));
    state.viewing.forEach(record => {
      if (record.status !== "completed") {
        viewingById.delete(record.id);
        return;
      }
      const existing = viewingById.get(record.id) || {};
      viewingById.set(record.id, {
        ...existing,
        ...record,
        title: existing.title || state.watchlist.find(entry => entry.titleId === record.titleId)?.title || state.scenario.titleName
      });
    });
    const recentViewingRows = state.members.map(member => {
      const records = [...viewingById.values()]
        .filter(record => record.memberId === member.id)
        .map(record => ({ ...record, displayCompletedOn: effectiveDate(record, "completedOn", "completionOffsetDays") }))
        .filter(record => record.displayCompletedOn)
        .sort((left, right) => right.displayCompletedOn.localeCompare(left.displayCompletedOn))
        .slice(0, 3);
      if (!records.length) {
        return `<tr><th scope="row">${escapeHtml(member.name)}</th><td class="empty-table-cell">No completed viewing reported</td></tr>`;
      }
      const completedTitles = records.map(record => `<li class="completed-title-item"><strong>${escapeHtml(record.title)}</strong><span>${escapeHtml(engine.displayDate(record.displayCompletedOn, state.household.locale))}</span></li>`).join("");
      return `<tr><th scope="row">${escapeHtml(member.name)}</th><td><ul class="grouped-title-list">${completedTitles}</ul></td></tr>`;
    });

    return `<div class="memory-grid context-organized">
      <section class="memory-block memory-block-wide context-overview-card">
        <div class="context-overview-heading">
          <div><span>Household at a glance</span><h3>${escapeHtml(state.household.name)}</h3><p>${escapeHtml(state.household.billingRegion)}, ${escapeHtml(territory)}</p></div>
          <span class="context-current-badge">Current household context</span>
        </div>
        <div class="context-metrics">
          <div class="context-metric featured"><span>Family members</span><strong>${escapeHtml(state.members.length)}</strong><small>${escapeHtml(authorizedAdult?.name || "Adult")} makes final decisions</small></div>
          <div class="context-metric"><span>Active services</span><strong>${escapeHtml(activeSubscriptions.length)}</strong><small>available to the household</small></div>
          <div class="context-metric"><span>Will not renew</span><strong>${escapeHtml(nonRenewingSubscriptions.length)}</strong><small>${nonRenewingSubscriptions.length ? "active until expiration" : "none scheduled"}</small></div>
          <div class="context-metric"><span>Watchlist entries</span><strong>${escapeHtml(householdWatchlistCount)}</strong><small>across all family members</small></div>
          <div class="context-metric"><span>Currently watching</span><strong>${escapeHtml(currentlyWatchingCount)}</strong><small>titles with active viewing</small></div>
          <div class="context-metric"><span>Last confirmed</span><strong class="context-date-value">${escapeHtml(confirmedDate(latestConfirmedOffset))}</strong><small>most recently updated category</small></div>
        </div>
        <div class="household-summary context-household-summary">
          <div><span>Family members</span><ul class="member-list">${householdMembers}</ul></div>
          <div><span>How this information is used</span><p>Streaming Guard uses confirmed household details, current subscriptions, viewing information, watchlists, and family rules to prepare recommendations.</p></div>
        </div>
      </section>
      ${collapsibleCard(
        "Viewing and watchlists",
        "What each family member wants to watch, what is in progress, upcoming releases, and recently completed titles.",
        `<div class="context-section-group"><h4>Household watchlist</h4>${table("Household watchlist by family member", ["Family member", "Watchlist titles"], watchlistRows)}</div>
        <div class="context-section-group"><h4>Upcoming watchlist releases</h4>${upcomingRows.length ? table("Next five upcoming watchlist releases", ["Title", "Type", "Release date", "Watchlisted by"], upcomingRows) : `<p>No upcoming watchlist releases are currently scheduled.</p>`}</div>
        <div class="context-section-group"><h4>Recently completed viewing</h4>${table("Recently completed viewing by family member", ["Family member", "Recently completed titles"], recentViewingRows)}</div>`
      )}
      ${collapsibleCard(
        "Household preferences and rules",
        "Plan preferences, family viewing priorities, and age-specific viewing restrictions.",
        `<div class="household-summary"><div><span>Household preferences</span><p>${escapeHtml(picturePreference)}<br>${escapeHtml(adsPreference)}<br>${escapeHtml(authorizedAdult?.name || "The authorized adult")} makes final subscription decisions.</p></div><div><span>Current family rules</span><p>High-priority titles matter most, while viewing restrictions and subscription terms still apply. Financial limits and history are shown in the Spending tab.</p></div></div>
        <div class="context-section-group"><h4>Viewing preferences by family member</h4>${table("Viewing preferences by family member", ["Family member", "Enjoys watching", "Other preference"], preferenceRows)}</div>
        <div class="context-section-group"><h4>Viewing restrictions</h4>${table("Viewing restrictions by family member", ["Family member", "Viewing restriction"], restrictionRows)}</div>`
      )}
      ${collapsibleCard(
        "Data freshness",
        "When each category of household context was last confirmed or updated.",
        `<p>These dates help identify information that may need to be confirmed before a recommendation is trusted.</p>${table("Household context confirmation dates", ["Context category", "Last confirmed"], freshnessRows)}`
      )}
    </div>`;
  }

  global.StreamingGuardUI = Object.freeze({
    escapeHtml,
    welcomeMarkup,
    messageMarkup,
    detailMarkup,
    progressMarkup,
    llmActivityMarkup,
    contextPolicyTraceMarkup,
    memoryMarkup,
    spendingMarkup,
    evaluationMarkup
  });
})(window);
