(function initializeStreamingGuardApp(global) {
  "use strict";

  const context = global.StreamingGuardContext;
  const math = global.StreamingGuardMath;
  const engine = global.StreamingGuardRecommendationEngine;
  const ui = global.StreamingGuardUI;
  const memoryFactory = global.StreamingGuardMemory;
  const toolFactory = global.StreamingGuardAgentTools;
  const openAI = global.StreamingGuardOpenAI;
  const evaluationFactory = global.StreamingGuardEvaluations;
  const contextSelector = global.StreamingGuardContextSelector;
  const traceFactory = global.StreamingGuardTraceManager;
  const workflowEngine = global.StreamingGuardWorkflow;

  if (![
    context,
    math,
    engine,
    ui,
    memoryFactory,
    toolFactory,
    openAI,
    evaluationFactory,
    contextSelector,
    traceFactory,
    workflowEngine
  ].every(Boolean)) {
    throw new Error("Streaming Guard application dependencies failed to load.");
  }

  // Retain the pre-rename storage key so existing browser-local demo state
  // survives the product rename from Subscription Guard to Streaming Guard.
  const memory = memoryFactory.createMemoryStore({
    storageKey: "subscriptionGuard.v7",
    createSeedState: context.createSeedState
  });

  function rebaseScenarioDates(browserDateIso, { onlyWhenMissing = false } = {}) {
    memory.transact(draft => {
      const effectiveSystemDate = onlyWhenMissing && draft.systemDate ? draft.systemDate : browserDateIso;
      context.rebaseStateDates(draft, effectiveSystemDate);
    });
  }

  rebaseScenarioDates(math.localDateIso(new Date()), { onlyWhenMissing: true });
  const traceManager = traceFactory.createTraceManager({ memory });
  const tools = toolFactory.createAgentTools({
    memory,
    knowledge: context.knowledge,
    traceManager
  });
  const evaluations = evaluationFactory.createEvaluationRunner({
    knowledge: context.knowledge,
    context,
    engine,
    openAI
  });
  let state = memory.getState();

  let composerIntent = "general";

  const messagesElement = document.getElementById("messages");
  const messageInput = document.getElementById("messageInput");
  const composerMode = document.getElementById("composerMode");
  const memoryView = document.getElementById("memoryView");
  const spendingView = document.getElementById("spendingView");
  const evaluationsView = document.getElementById("evaluationsView");
  const appShell = document.getElementById("appShell");
  const contextTab = document.getElementById("contextTab");
  const spendingTab = document.getElementById("spendingTab");
  const chatTab = document.getElementById("chatTab");
  const evaluationsTab = document.getElementById("evaluationsTab");
  const aiSettingsDialog = document.getElementById("aiSettingsDialog");
  const aiSettingsForm = document.getElementById("aiSettingsForm");
  const apiKeyInput = document.getElementById("openAIApiKey");
  const anthropicApiKeyInput = document.getElementById("anthropicApiKey");
  const geminiApiKeyInput = document.getElementById("geminiApiKey");
  const modelInput = document.getElementById("openAIModel");
  const judgeModelInput = document.getElementById("openAIJudgeModel");
  const informationDialog = document.getElementById("informationDialog");
  const informationDialogTitle = document.getElementById("informationDialogTitle");
  const informationDialogContent = document.getElementById("informationDialogContent");
  const chatFullscreenToggle = document.getElementById("chatFullscreenToggle");
  const restartChatButton = document.getElementById("restartChat");
  const downloadFullChatButton = document.getElementById("downloadFullChat");
  const copyAIChatLogButton = document.getElementById("copyAIChatLog");
  const exportHouseholdDataButton = document.getElementById("exportHouseholdData");
  const importHouseholdDataButton = document.getElementById("importHouseholdData");
  const importHouseholdDataInput = document.getElementById("importHouseholdDataInput");
  let responseController = null;
  let chatSequenceVersion = 0;
  let apiActivityTimer = null;
  let liveApiActivity = { status: "idle" };
  let aiChatDebugLog = [];
  let pendingChatMessages = [];
  let sessionOnlyChatMessages = [];
  let selectedEvaluationId = "EVAL-01";
  let evaluationInstructionsOpen = false;
  let fullScreenEvaluationInstruction = null;
  const localOperatorMode = ["127.0.0.1", "localhost"].includes(global.location.hostname);
  let localOperatorAvailable = false;
  let localOperatorPublishing = false;
  let localOperatorStatus = "";
  let localOperatorStatusType = "";
  const stagedMessageDelayMs = 0;

  const informationTopics = Object.freeze({
    about: {
      title: "About Streaming Guard",
      content: `
        <h3>What this prototype does</h3>
        <p>Streaming Guard is an AI product-management capstone prototype that helps an authorized adult review household streaming subscriptions, viewing access, and spending.</p>
        <p>It demonstrates two guided household subscription stories and a free-form manual scenario in one WhatsApp-style interface. Every path uses the same household context, instructions, safety boundaries, adult discussion, and explicit human control over external actions.</p>
        <h3>What it does not do</h3>
        <p>Streaming Guard is advisory only. It cannot purchase, cancel, pause, pay for, or modify an external streaming account. It is not connected to WhatsApp, Messenger, Netflix, or any fictional streaming service shown in the demo.</p>
        <h3>Prototype data</h3>
        <p>The household, services, titles, prices, and viewing records are fictional and designed to demonstrate realistic United States streaming-market scenarios.</p>
      `
    },
    terms: {
      title: "Terms of Use",
      content: `
        <p><strong>Last updated: July 28, 2026</strong></p>
        <h3>Educational prototype</h3>
        <p>This site is an educational course prototype provided for demonstration and evaluation. It is not a production subscription-management service.</p>
        <h3>Your responsibility</h3>
        <ul>
          <li>You remain responsible for every streaming purchase, cancellation, pause, payment, plan change, and parental-control decision.</li>
          <li>Do not treat a recommendation as confirmation that an external action occurred.</li>
          <li>Verify prices, availability, billing terms, and provider policies through the applicable service before acting.</li>
        </ul>
        <h3>Permitted use</h3>
        <p>Use the prototype only for lawful demonstration, learning, and evaluation. Do not enter passwords, payment details, authentication codes, confidential business information, or real household personal data.</p>
        <h3>Model-provider API usage</h3>
        <p>If you connect an OpenAI, Anthropic, or Google Gemini API key, usage is charged under the corresponding provider account. You are responsible for each connected account, its billing, and its usage limits. A full ten-case evaluation makes nine calls to the selected agent provider and nine calls to the selected judge provider. The no-action restraint case runs locally and makes no model call.</p>
        <h3>No warranty</h3>
        <p>The prototype is provided “as is” without warranties. It may contain incomplete information or demonstration-only behavior and should not be relied upon for legal, financial, or professional advice.</p>
      `
    },
    privacy: {
      title: "Privacy Policy",
      content: `
        <p><strong>Last updated: July 28, 2026</strong></p>
        <h3>Data stored in this browser</h3>
        <p>Prototype household context, chat history, recommendation progress, evaluation state, and optional provider settings are stored in this browser using local storage. Streaming Guard does not operate a project database or server that receives this local state.</p>
        <p>Adult messages remain visible exactly as entered in the current chat. Messages identified as sensitive or clearly outside Streaming Guard’s scope are displayed only for the current browser session: their content is not added to persistent chat history, household context, AI request logs, or model requests. Previously saved messages containing recognizable credentials are removed when local state is loaded.</p>
        <h3>AI-provider connections</h3>
        <p>If you connect OpenAI, Anthropic, or Google Gemini and request a recommendation or chat response, the relevant system instructions, fictional household context, calculations, recent conversation, and your message are sent directly from this browser to the provider selected for the agent. Evaluation cases are sent only after you explicitly approve the instruction bundle and run a case. Each evaluation output is then sent to the separately selected judge provider with its fixed case and expected behavior for independent semantic assessment.</p>
        <p>The API key is stored in this browser’s local storage for this private prototype. A publicly deployed version should use a secure server-side connection instead.</p>
        <h3>Your controls</h3>
        <ul>
          <li><strong>Restart chat</strong> clears only the active WhatsApp-style conversation and returns to the three-path starting screen. Model connections and evaluation results remain saved.</li>
          <li><strong>Restart demo</strong> removes prototype progress while preserving saved provider connections.</li>
          <li><strong>Reset all saved data</strong> removes prototype state and every saved provider connection.</li>
          <li><strong>Disconnect all</strong> removes every saved provider key.</li>
        </ul>
        <h3>Do not enter real sensitive information</h3>
        <p>Do not provide real customer or household data, passwords, payment information, bank details, authentication codes, API keys in chat, or other confidential information. Automated redaction reduces accidental retention but is not a substitute for keeping sensitive information out of the prototype.</p>
      `
    },
    copyright: {
      title: "Copyright",
      content: `
        <p><strong>© 2026 Streaming Guard prototype. All rights reserved.</strong></p>
        <p>The Streaming Guard name, prototype interface, original text, code, fictional household records, fictional service names, fictional titles, and original visual assets are presented as part of an educational capstone project.</p>
        <h3>Third-party references</h3>
        <p>WhatsApp, Messenger, Netflix, OpenAI, Anthropic, Google Gemini, and other referenced third-party names and marks belong to their respective owners. Their appearance is for prototype explanation or demonstration and does not imply sponsorship, affiliation, or endorsement.</p>
        <h3>Reuse</h3>
        <p>Do not republish, sell, or represent the prototype or its original assets as your own without permission from the project owner.</p>
      `
    }
  });

  function openInformationDialog(topic) {
    const information = informationTopics[topic];
    if (!information) return;
    informationDialogTitle.textContent = information.title;
    informationDialogContent.innerHTML = information.content;
    if (!informationDialog.open) informationDialog.showModal();
  }

  function refreshState() {
    state = memory.getState();
    return state;
  }

  function targetAccountUrl() {
    const targetPlans = tools.get_service_details({
      serviceId: state.scenario.targetServiceId,
      planId: state.scenario.targetPlanId
    });
    const candidateAccountUrl = targetPlans[0]?.approved_account_url || "";
    if (!candidateAccountUrl) return "";
    return tools.validate_output_url({
      serviceId: state.scenario.targetServiceId,
      url: candidateAccountUrl,
      urlType: "account"
    }).url;
  }

  function targetSubscription() {
    return engine.targetSubscription(state);
  }

  function targetActive() {
    return targetSubscription()?.status === "active";
  }

  function subscriptionFinancialBaseline(sourceState = state) {
    return Object.freeze({
      activeMonthly: math.sumMonthlyCosts(sourceState.subscriptions),
      monthlyBudgetCap: Number(sourceState.familyRules.monthlyBudgetCap)
    });
  }

  function signedMoney(value, sourceState = state) {
    const amount = math.roundCurrency(value);
    if (amount === 0) return "no change";
    return `${amount > 0 ? "+" : "−"}${engine.formatMoney(sourceState, Math.abs(amount))}`;
  }

  function subscriptionChangeServiceNames(updates) {
    return [...new Set(updates.map(update => {
      const serviceId = update.updateType === "external_action_confirmation"
        ? state.scenario.targetServiceId
        : update.targetId;
      return state.subscriptions.find(subscription => subscription.serviceId === serviceId)?.service
        || context.knowledge.services.find(plan => plan.service_id === serviceId)?.service_name
        || serviceId;
    }).filter(Boolean))];
  }

  function sendSubscriptionFinancialConfirmation(beforeBaseline, appliedUpdates, summary = "") {
    const afterBaseline = subscriptionFinancialBaseline();
    const impact = math.calculateSubscriptionChangeImpact({
      beforeMonthly: beforeBaseline.activeMonthly,
      afterMonthly: afterBaseline.activeMonthly,
      monthlyBudgetCap: afterBaseline.monthlyBudgetCap
    });
    const services = subscriptionChangeServiceNames(appliedUpdates);
    const savedChange = summary || (
      services.length
        ? `${services.join(" and ")} household subscription details were updated.`
        : "The household subscription details were updated."
    );
    const budgetPosition = impact.afterBudget.overage > 0
      ? `The updated total is ${engine.formatMoney(state, impact.afterBudget.overage)} over the monthly budget.`
      : `That leaves ${engine.formatMoney(state, impact.afterBudget.remaining)} within the monthly budget.`;
    const budgetFollowUp = impact.afterBudget.overage > 0
      ? ` Would you like to keep the monthly budget at ${engine.formatMoney(state, impact.afterBudget.monthlyBudgetCap)}, increase it to ${engine.formatMoney(state, impact.afterMonthly)} to match the new spending, or set a higher monthly amount? I’ll keep the current budget unchanged until you tell me.`
      : "";
    sendChat({
      text: `${savedChange} Expected financial impact: the monthly payment changes from ${engine.formatMoney(state, impact.beforeMonthly)} to ${engine.formatMoney(state, impact.afterMonthly)} (${signedMoney(impact.monthlyChange)}). The annualized payment changes from ${engine.formatMoney(state, impact.beforeAnnual)} to ${engine.formatMoney(state, impact.afterAnnual)} (${signedMoney(impact.annualChange)}). Household budget utilization changes from ${impact.beforeBudget.utilizationPercent.toFixed(1)}% to ${impact.afterBudget.utilizationPercent.toFixed(1)}% of the ${engine.formatMoney(state, impact.afterBudget.monthlyBudgetCap)} monthly budget. ${budgetPosition}${budgetFollowUp}`
    });
    if (impact.afterBudget.overage > 0) {
      transact(draft => {
        draft.review.nextExpectedInput = "budget_amount";
        draft.review.reasonCodes = [...new Set([
          ...(draft.review.reasonCodes || []),
          "budget_conflict"
        ])];
      });
      return true;
    }
    return false;
  }

  function scenarioLanguage() {
    const selectedAction = currentRecommendation()?.actionType || state.scenario.requestedAction;
    return engine.actionLanguage[selectedAction] || engine.actionLanguage.keep;
  }

  function currentRecommendation() {
    const generated = state.review.generatedRecommendation;
    if (generated && generated.version === state.review.recommendationVersion) {
      return {
        ...generated,
        source: state.review.recommendationSource,
        sourceModel: state.review.recommendationModel,
        sourceError: state.review.recommendationError
      };
    }
    return null;
  }

  function showToast(text) {
    const toast = document.getElementById("toast");
    toast.textContent = text;
    toast.classList.add("show");
    global.setTimeout(() => toast.classList.remove("show"), 2400);
  }

  function householdDataFilename() {
    return `streaming-guard-household-data-${math.localDateIso(new Date())}.json`;
  }

  function exportHouseholdData() {
    const payload = memory.exportHouseholdData();
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8"
    });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = householdDataFilename();
    document.body.appendChild(link);
    link.click();
    link.remove();
    global.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    showToast("Household data exported as JSON");
  }

  async function importHouseholdData(file) {
    if (!file) return;
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch (_) {
      throw new Error("The selected file is not valid JSON.");
    }

    const householdName =
      payload?.household?.household?.name ||
      payload?.memory?.household?.name ||
      "the exported household";
    if (!global.confirm(
      `Import ${householdName}? This will replace durable household details and start a fresh local demo session.`
    )) return;

    memory.importHouseholdData(payload);
    rebaseScenarioDates(math.localDateIso(new Date()));
    renderAll();
    showProductView("context");
    showToast("Household data imported");
  }

  async function copyText(text) {
    if (global.navigator.clipboard?.writeText) {
      try {
        await global.navigator.clipboard.writeText(text);
        return;
      } catch (_) {
        // Local file pages may not receive Clipboard API permission.
      }
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("The browser could not copy the evaluation output.");
  }

  function refreshAIChatLogButton() {
    copyAIChatLogButton.disabled = aiChatDebugLog.length === 0;
    copyAIChatLogButton.title = aiChatDebugLog.length
      ? `${aiChatDebugLog.length} raw AI call${aiChatDebugLog.length === 1 ? "" : "s"} available`
      : "Run an AI recommendation or chat interaction first";
  }

  function recordAIChatDebugCall({
    requestType,
    attempt = 1,
    result = null,
    error = null,
    validatedOutput = null,
    validationStatus = "accepted"
  }) {
    const debug = result?.debug || error?.debug;
    if (!debug) return;
    aiChatDebugLog.push({
      sequence: aiChatDebugLog.length + 1,
      recordedAt: new Date().toISOString(),
      requestType,
      attempt,
      validation: {
        status: validationStatus,
        error: error?.message || null
      },
      request: debug.request,
      response: debug.response,
      validatedApplicationOutput: validatedOutput
    });
    if (error) error.aiChatDebugLogged = true;
    refreshAIChatLogButton();
  }

  function exportAIChatDebugLog() {
    return JSON.stringify({
      product: "Streaming Guard",
      exportType: "Complete chat AI request and response log",
      exportedAt: new Date().toISOString(),
      security: "API keys and authorization headers are excluded. This export contains complete model instructions, selected household context, retained chat history, user input, schemas, and raw model responses.",
      currentScenario: {
        id: state.scenario?.id || null,
        evalCase: state.scenario?.evalCase || null,
        scenarioType: state.scenario?.scenarioType || null,
        systemDate: state.systemDate
      },
      executionTraces: state.traces || [],
      calls: aiChatDebugLog
    }, null, 2);
  }

  async function copyAIChatDebugLog() {
    if (!aiChatDebugLog.length) {
      showToast("No AI calls have been made in this chat yet");
      return;
    }
    await copyText(exportAIChatDebugLog());
    showToast(`Copied ${aiChatDebugLog.length} complete AI call${aiChatDebugLog.length === 1 ? "" : "s"}`);
  }

  function transact(mutator) {
    memory.transact(mutator);
    refreshState();
  }

  function transitionWorkflow(event, details = "") {
    memory.dispatchWorkflow(event, {
      traceId: traceManager.activeTraceId(),
      details
    });
    refreshState();
  }

  function renderSidebar() {
    const recommendation = currentRecommendation();
    const selectedAction = state.review.discussionStatus === "resolved"
      ? state.review.resolutionAction
      : recommendation?.actionType || null;
    const finances = selectedAction
      ? engine.recommendationFinancesForAction(state, selectedAction)
      : engine.calculateScenarioFinancials(state);
    const language = engine.actionLanguage[selectedAction] || scenarioLanguage();
    const savingsAction = ["cancel", "pause"].includes(selectedAction);
    const discussionResolved = state.review.discussionStatus === "resolved";
    const actionConfirmed = state.review.externalActionConfirmed;
    document.getElementById("afterBudget").hidden = !actionConfirmed;
    document.getElementById("savingsCallout").hidden = !actionConfirmed;
    document.getElementById("beforeBudgetLabel").textContent = actionConfirmed ? "Before action" : "Current monthly streaming";
    document.getElementById("afterBudgetLabel").textContent = `After ${language.noun}`;
    document.getElementById("beforeBudgetAmount").textContent = engine.formatMoney(state, finances.beforeActionMonthly);
    const beforeBudgetPercent = finances.beforeBudget.utilizationPercent;
    const beforeBudgetPercentLabel = beforeBudgetPercent.toFixed(1).replace(/\.0$/, "");
    const beforeBudgetVisualPercent = math.clampPercent(beforeBudgetPercent);
    document.getElementById("beforeBudgetFill").style.width = `${beforeBudgetVisualPercent}%`;
    document.getElementById("beforeBudgetPercent").textContent = `${beforeBudgetPercentLabel}%`;
    document.getElementById("beforeBudgetTrack").setAttribute("aria-valuenow", String(Math.round(beforeBudgetVisualPercent)));
    document.getElementById("beforeBudgetTrack").setAttribute(
      "aria-valuetext",
      `${beforeBudgetPercentLabel}% of the monthly streaming budget`
    );
    document.getElementById("afterBudgetAmount").textContent = engine.formatMoney(state, finances.afterActionMonthly);
    document.getElementById("afterBudgetFill").style.width = `${math.clampPercent(finances.afterBudget.utilizationPercent)}%`;
    document.getElementById("monthlySavingsAmount").textContent = engine.formatMoney(state, finances.monthlySavings);
    const currentBudget = actionConfirmed ? finances.afterBudget : finances.beforeBudget;
    const overBudget = currentBudget.overage > 0;
    document.getElementById("monthlyBudgetCard").classList.toggle("over-budget", overBudget);
    document.getElementById("budgetState").textContent = overBudget
      ? `${engine.formatMoney(state, currentBudget.overage)} over the ${engine.formatMoney(state, currentBudget.monthlyBudgetCap)} monthly budget`
      : actionConfirmed
        ? `Confirmed after adult-reported completion · ${engine.formatMoney(state, currentBudget.remaining)} remaining`
        : `${engine.formatMoney(state, currentBudget.remaining)} remaining within the ${engine.formatMoney(state, currentBudget.monthlyBudgetCap)} monthly budget`;

    const viewerRecords = engine.intendedViewingRecords(state).sort((left, right) => {
      const leftDate = left.viewing?.completedOn || left.viewing?.reportedOn || "";
      const rightDate = right.viewing?.completedOn || right.viewing?.reportedOn || "";
      return rightDate.localeCompare(leftDate);
    });
    const viewerEvidence = viewerRecords.map(record => {
      const name = record.member?.firstName || record.memberId;
      const complete = record.viewing?.status === "completed";
      return `<span class="${complete ? "context-check" : "context-warning"}">${ui.escapeHtml(name)}: ${complete ? `completed ${ui.escapeHtml(engine.displayDate(record.viewing.completedOn, state.household.locale))}` : "completion not confirmed"}</span>`;
    }).join("<br>");
    const nextRelease = engine.displayDate(state.scenario.nextReleaseDate, state.household.locale);
    const releasePattern = state.scenario.nextReleasePattern === "all_at_once" ? "all episodes" : state.scenario.nextReleasePattern.replaceAll("_", " ");

    if (state.scenario.scenarioType === "catalog_migration") {
      const requestedBy = state.members.find(member =>
        member.id === state.scenario.requestedByMemberId
      )?.firstName || "A family member";
      const existingService = state.subscriptions.find(subscription =>
        subscription.serviceId === state.scenario.secondaryServiceId && subscription.status === "active"
      );
      const targetSubscription = engine.targetSubscription(state);
      const waitDays = state.scenario.nextReleaseDate
        ? math.daysBetween(state.systemDate, state.scenario.nextReleaseDate)
        : null;
      document.getElementById("recommendationContext").innerHTML = `
        <div class="context-item"><span>Trigger</span><strong>${ui.escapeHtml(requestedBy || "A family member")} requested ${ui.escapeHtml(state.scenario.titleName)}</strong><small>A new high-priority viewing request requires a subscription comparison</small></div>
        <div class="context-item"><span>Available now</span><strong>${ui.escapeHtml(state.scenario.targetServiceName)} · ${ui.escapeHtml(engine.formatMoney(state, targetSubscription.monthlyCost))} monthly</strong><small>The household does not currently subscribe to this service</small></div>
        <div class="context-item"><span>Existing coverage</span><strong>${ui.escapeHtml(existingService?.service || "Current household service")}</strong><small>${ui.escapeHtml(state.scenario.titleName)} becomes available ${ui.escapeHtml(nextRelease)}${Number.isFinite(waitDays) ? ` · ${waitDays} days from this review` : ""}</small></div>
        <div class="context-item"><span>Other priority titles</span><strong>${state.scenario.otherPriorityTitlesOnTarget ? `${state.scenario.otherPriorityTitlesOnTarget} additional priority title(s)` : "No other priority title requires TidePlay"}</strong><small>Within the ${state.scenario.reviewHorizonMonths}-month review horizon</small></div>
        <div class="context-item"><span>Budget effect</span><strong class="context-savings">${selectedAction ? "Keep current monthly spending unchanged" : `Avoid adding ${ui.escapeHtml(engine.formatMoney(state, targetSubscription.monthlyCost))} monthly`}</strong><small>Current lineup: ${ui.escapeHtml(engine.formatMoney(state, finances.activeMonthly))} monthly · Proposed TidePlay addition: ${ui.escapeHtml(engine.formatMoney(state, finances.activeMonthly + targetSubscription.monthlyCost))} monthly</small></div>`;
    } else {
      document.getElementById("recommendationContext").innerHTML = `
        <div class="context-item"><span>Trigger</span><strong>${ui.escapeHtml(state.scenario.targetServiceName)} is not being used anymore</strong><small>Underuse detected from confirmed viewing and current priority-title coverage</small></div>
        <div class="context-item"><span>Viewing evidence</span><strong>${ui.escapeHtml(state.scenario.titleName)}</strong><small>${viewerEvidence}</small></div>
        <div class="context-item"><span>Priority-title coverage</span><strong>${state.scenario.otherPriorityTitlesOnTarget ? `${state.scenario.otherPriorityTitlesOnTarget} other priority title(s)` : "No other priority title"}</strong><small>On ${ui.escapeHtml(state.scenario.targetServiceName)} within ${state.scenario.reviewHorizonMonths} months</small></div>
        <div class="context-item"><span>Next relevant release</span><strong>${ui.escapeHtml(state.scenario.titleName)} · ${ui.escapeHtml(state.scenario.nextReleaseLabel || "No release announced")}</strong><small>${ui.escapeHtml(nextRelease)} · ${ui.escapeHtml(releasePattern)}</small></div>
        <div class="context-item"><span>Budget effect</span><strong class="context-savings">${selectedAction ? (savingsAction ? `${targetActive() ? "Save" : "Saved"} ${engine.formatMoney(state, finances.monthlySavings)} monthly` : discussionResolved ? "No monthly cost change" : "No monthly cost change recommended") : `Potential saving: ${engine.formatMoney(state, finances.monthlySavings)} monthly`}</strong><small>${selectedAction ? `Total monthly subscription cost: ${engine.formatMoney(state, finances.beforeActionMonthly)} → ${engine.formatMoney(state, finances.afterActionMonthly)} with the ${discussionResolved ? "resolved" : "recommended"} ${language.noun}` : `If canceled, total monthly subscription cost would change from ${engine.formatMoney(state, finances.beforeActionMonthly)} to ${engine.formatMoney(state, finances.afterActionMonthly)}`}</small></div>`;
    }
  }

  function renderDetails(recommendation) {
    const discussionResolved = state.review.discussionStatus === "resolved";
    const manualScenario = state.review.manualScenario;
    const safetyActive = state.review.safetyDisposition &&
      !["normal", "adult_judgment_required"].includes(state.review.safetyDisposition);
    document.getElementById("scenarioProgressTitle").textContent = discussionResolved
      ? "Recommendation outcome"
      : safetyActive
        ? "Conversation safeguard"
        : manualScenario
          ? "Manual scenario"
        : "Recommendation progress";
    document.getElementById("scenarioProgressIntro").textContent = discussionResolved
      ? "The discussion is closed unless the family chooses to revisit it."
      : safetyActive
        ? "The agent paused the normal recommendation flow and explained what the adult should do next."
        : manualScenario
          ? "Use the chat to test a streaming-subscription situation against the live agent’s instructions and boundaries."
        : "This advances as the family discusses and completes the recommendation.";
    const scenarioProgress = document.getElementById("scenarioProgress");
    const decisionSection = document.getElementById("decisionSection");
    scenarioProgress.hidden = manualScenario;
    decisionSection.hidden = manualScenario;
    scenarioProgress.innerHTML = manualScenario ? "" : ui.progressMarkup(state);
    document.getElementById("detailContent").innerHTML = manualScenario
      ? ""
      : ui.detailMarkup(state, recommendation);
    renderApiActivity();
  }

  function usageText(usage) {
    if (!usage || typeof usage !== "object") return "";
    const inputTokens = usage.input_tokens ?? usage.inputTokens ?? usage.promptTokenCount;
    const outputTokens = usage.output_tokens ?? usage.outputTokens ?? usage.candidatesTokenCount;
    const parts = [];
    if (Number.isFinite(Number(inputTokens))) parts.push(`${Number(inputTokens).toLocaleString()} input tokens`);
    if (Number.isFinite(Number(outputTokens))) parts.push(`${Number(outputTokens).toLocaleString()} output tokens`);
    return parts.join(" · ");
  }

  function renderApiActivity() {
    const activityElement = document.getElementById("llmActivity");
    const traceElement = document.getElementById("contextPolicyTrace");
    if (!activityElement) return;
    const reconciledTrace = reconcileTraceWithSavedState(liveApiActivity.trace);
    if (reconciledTrace !== liveApiActivity.trace) {
      liveApiActivity = { ...liveApiActivity, trace: reconciledTrace };
    }
    activityElement.innerHTML = ui.llmActivityMarkup(liveApiActivity);
    if (traceElement) {
      try {
        traceElement.innerHTML = ui.contextPolicyTraceMarkup(liveApiActivity, state);
      } catch (_) {
        traceElement.innerHTML = `<section class="context-trace-card context-trace-empty" aria-label="Context and policy trace"><div class="context-trace-heading"><div><small>Context and policy trace</small><strong>Trace unavailable</strong></div></div><p>The evaluator trace could not be displayed. The chat and model request continue normally.</p></section>`;
      }
    }
  }

  function reconcileTraceWithSavedState(trace) {
    if (!trace || !state.review?.externalActionConfirmed) return trace;
    const serviceId = state.scenario?.targetServiceId;
    const subscription = state.subscriptions.find(item => item.serviceId === serviceId);
    if (!subscription) return trace;
    const update = {
      updateType: "external_action_confirmation",
      targetId: serviceId,
      relatedId: "",
      field: "subscriptionStatus",
      value: subscription.status,
      effectiveDate: state.review.resolvedAt || state.systemDate
    };
    const description = describeMemoryUpdate(update);
    const expectedMemoryOutcome = `Saved ${description}.`;
    const expectedValidationOutcome = "The explicit adult external-action confirmation was validated and saved locally.";
    const existingTool = (trace.tools || []).find(tool => tool.name === "update_household_context");
    if (
      trace.memoryOutcome === expectedMemoryOutcome &&
      trace.validationOutcome === expectedValidationOutcome &&
      existingTool?.detail === `Saved ${description}`
    ) {
      return trace;
    }
    return {
      ...trace,
      tools: appendTraceTool(trace.tools, "update_household_context", `Saved ${description}`),
      memoryOutcome: expectedMemoryOutcome,
      validationOutcome: expectedValidationOutcome
    };
  }

  function stopApiActivityTimer() {
    if (apiActivityTimer) global.clearInterval(apiActivityTimer);
    apiActivityTimer = null;
  }

  function updateApiActivity(update) {
    liveApiActivity = { ...liveApiActivity, ...update };
    if (liveApiActivity.startedAt) {
      liveApiActivity.elapsedMs = Date.now() - liveApiActivity.startedAt;
    }
    renderApiActivity();
  }

  function appendTraceTool(sourceTools, name, detail) {
    const traceTools = Array.isArray(sourceTools) ? [...sourceTools] : [];
    const existingIndex = traceTools.findIndex(tool => tool.name === name);
    const nextTool = { name, detail };
    if (existingIndex >= 0) {
      traceTools[existingIndex] = nextTool;
    } else {
      traceTools.push(nextTool);
    }
    return traceTools;
  }

  function recordLiveTraceTool(name, detail) {
    const currentTrace = liveApiActivity.trace;
    if (!currentTrace) return;
    updateApiActivity({
      trace: {
        ...currentTrace,
        tools: appendTraceTool(currentTrace.tools, name, detail)
      }
    });
  }

  function memoryMemberName(memberId) {
    const member = state.members.find(candidate => candidate.id === memberId);
    return member?.firstName || member?.name || memberId || "the household member";
  }

  function memoryTitleName(titleId) {
    return state.watchlist.find(item => item.titleId === titleId)?.title
      || context.knowledge.catalog.find(item => item.title_id === titleId)?.title_name
      || titleId
      || "the title";
  }

  function memoryServiceName(serviceId) {
    return state.subscriptions.find(subscription => subscription.serviceId === serviceId)?.service
      || context.knowledge.services.find(plan => plan.service_id === serviceId)?.service_name
      || serviceId
      || "the service";
  }

  function displayMemoryValue(field, value) {
    if (field === "monthlyBudgetCap" || field === "monthlyCost") {
      return engine.formatMoney(state, Number(value));
    }
    if (["nextRenewal", "expirationDate"].includes(field) && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      return engine.displayDate(value, state.household.locale);
    }
    return String(value || "").replaceAll("_", " ");
  }

  function describeMemoryUpdate(update) {
    if (!update) return "a household detail";
    const member = memoryMemberName(update.targetId);
    const titleId = update.relatedId || (update.updateType === "title_rating_exception" ? update.value : "");
    const title = memoryTitleName(titleId);
    const serviceId = update.updateType === "external_action_confirmation"
      ? state.scenario.targetServiceId
      : update.targetId;
    const service = memoryServiceName(serviceId);
    const displayedValue = displayMemoryValue(update.field, update.value);

    if (update.updateType === "viewing_confirmation") {
      const date = update.effectiveDate
        ? ` on ${engine.displayDate(update.effectiveDate, state.household.locale)}`
        : "";
      return `${member}’s viewing status for ${title} as ${displayedValue}${date}`;
    }
    if (update.updateType === "family_rule") {
      const ruleNames = {
        monthlyBudgetCap: "monthly streaming budget",
        advertisingTolerance: "advertising preference",
        resolutionPreference: "video-resolution preference",
        priorityPolicy: "watchlist-priority policy"
      };
      return `the household ${ruleNames[update.field] || update.field} as ${displayedValue}`;
    }
    if (update.updateType === "subscription_record") {
      const subscription = state.subscriptions.find(item => item.serviceId === update.targetId);
      const fieldNames = {
        subscriptionPlan: "plan",
        subscriptionStatus: "status",
        monthlyCost: "monthly cost",
        renewalStatus: "renewal setting",
        nextRenewal: "next renewal",
        expirationDate: "expiration date"
      };
      const savedValue = update.field === "subscriptionPlan"
        ? subscription?.plan || displayedValue
        : update.field === "subscriptionStatus"
          ? subscription?.status || displayedValue
          : displayedValue;
      return `${service} ${fieldNames[update.field] || update.field} as ${savedValue}`;
    }
    if (update.updateType === "watchlist_item") {
      return `${member}’s ${update.field === "priority" ? "priority" : "watchlist status"} for ${title} as ${displayedValue}`;
    }
    if (update.updateType === "title_rating_exception") {
      return `a one-title rating exception for ${member} to view ${title}`;
    }
    if (update.updateType === "additional_escalation") {
      return `the additional household escalation “${update.value}”`;
    }
    if (update.updateType === "remove_additional_escalation") {
      return `removal of the household escalation “${update.value}”`;
    }
    if (update.updateType === "external_action_confirmation") {
      const savedStatus = state.subscriptions.find(item => item.serviceId === serviceId)?.status;
      return `${service} as ${String(savedStatus || "updated").replaceAll("_", " ")} after the adult’s external-action confirmation`;
    }
    return `${update.updateType.replaceAll("_", " ")}: ${displayedValue}`;
  }

  function completedMemoryOutcome({ turn, updateResult, recommendation }) {
    if (turn && ["sensitive_information_warning", "out_of_scope"].includes(turn.safetyDisposition)) {
      return turn.safetyDisposition === "out_of_scope"
        ? "Out-of-scope content excluded from persistent household context."
        : "Sensitive content redacted; household context unchanged.";
    }
    if (updateResult?.applied?.length) {
      const descriptions = updateResult.applied.map(describeMemoryUpdate);
      return `Saved ${descriptions.length === 1 ? descriptions[0] : `${descriptions.length} changes: ${descriptions.join("; ")}`}.`;
    }
    if (updateResult?.pending?.length) {
      return `No memory change yet. Waiting for adult confirmation before saving ${updateResult.pending.map(describeMemoryUpdate).join("; ")}.`;
    }
    if (updateResult?.rejected?.length) {
      return `No memory change. Validation rejected ${updateResult.rejected.map(item => describeMemoryUpdate(item.update)).join("; ")}.`;
    }
    if (recommendation) {
      return "Recommendation saved; household subscription records remain unchanged until the adult confirms any external action.";
    }
    return "No persistent household change was requested in this interaction.";
  }

  function updateTraceForLocalMemoryChange(update, validationOutcome) {
    const currentTrace = liveApiActivity.trace;
    if (!currentTrace || !update) return;
    const description = describeMemoryUpdate(update);
    updateApiActivity({
      trace: {
        ...currentTrace,
        tools: appendTraceTool(
          currentTrace.tools,
          "update_household_context",
          `Saved ${description}`
        ),
        memoryOutcome: `Saved ${description}.`,
        validationOutcome
      }
    });
  }

  function updateCompletedTrace({ turn = null, updateResult = null, recommendation = false } = {}) {
    const currentTrace = liveApiActivity.trace;
    if (!currentTrace) return;
    let traceTools = appendTraceTool(
      currentTrace.tools,
      "validate_structured_response",
      "The model response passed the structured contract and grounding checks"
    );
    const responsePayload = recommendation ? currentRecommendation() : turn;
    if (/https?:\/\//i.test(JSON.stringify(responsePayload || {}))) {
      traceTools = appendTraceTool(
        traceTools,
        "validate_output_url",
        "The included service URL matched the stored approved service record"
      );
    }
    if (updateResult?.applied?.length) {
      traceTools = appendTraceTool(
        traceTools,
        "update_household_context",
        `Saved ${updateResult.applied.map(describeMemoryUpdate).join("; ")}`
      );
    } else if (updateResult?.rejected?.length) {
      traceTools = appendTraceTool(
        traceTools,
        "validate_context_update",
        "The requested memory change failed validation and was not written"
      );
    }
    updateApiActivity({
      trace: {
        ...currentTrace,
        tools: traceTools,
        memoryOutcome: completedMemoryOutcome({ turn, updateResult, recommendation }),
        validationOutcome: "Structured response received, grounded, and validated."
      }
    });
    traceManager.span(
      "validation",
      "Structured response received, grounded, and validated."
    );
    traceManager.complete({
      status: "complete",
      validationOutcome: "Structured response received, grounded, and validated."
    });
  }

  function selectedContextInputSummary(contextSelection, instructionSummary, schemaSummary) {
    const householdContext = contextSelection?.householdContext || {};
    const selection = householdContext.context_selection || {};
    const members = householdContext.family_members || [];
    const subscriptions = householdContext.current_subscriptions || [];
    const titles = contextSelection?.catalogTitles || [];
    const scope = String(contextSelection?.scope || "unknown").replaceAll("_", " ");
    const plan = contextSelection?.contextPlan;
    return [
      instructionSummary,
      `Selection scope: ${scope}`,
      plan
        ? `Context plan: ${plan.intent} · ${plan.coverageStatus} · ${plan.contextHash}`
        : "Context plan unavailable",
      `Members sent: ${members.map(member => member.firstName || member.name || member.id).join(", ") || "none"}`,
      `Subscription records sent: ${subscriptions.map(subscription => subscription.service || subscription.serviceId).join(", ") || "none"}`,
      `Catalog titles sent: ${titles.map(title => title.title_name || title.title_id).join(", ") || "none"}`,
      `${Math.min(10, (state.messages || []).filter(message => message.text).length)} recent retained chat messages sent`,
      selection.ambiguities?.length
        ? `Unresolved context ambiguity sent for clarification: ${selection.ambiguities.map(item => item.message).join(" ")}`
        : "No unresolved context ambiguity",
      schemaSummary
    ];
  }

  function beginApiActivity({ requestType, settings, inputSummary, contextSelection = null }) {
    stopApiActivityTimer();
    const modelInfo = openAI.modelInfo(settings.model);
    traceManager.start({
      operation: requestType,
      promptHash: traceFactory.stableHash({
        instructionBundleUpdatedAt: context.knowledge.instructionBundleUpdatedAt,
        requestType
      }),
      contextPlan: contextSelection?.contextPlan || null,
      provider: openAI.providerName(modelInfo?.provider || openAI.providerForModel(settings.model)),
      model: modelInfo?.label || settings.model
    });
    traceManager.span(
      "context",
      contextSelection?.contextPlan
        ? `${contextSelection.contextPlan.intent}; ${contextSelection.contextPlan.coverageStatus}; context ${contextSelection.contextPlan.contextHash}`
        : "Context selection was not supplied."
    );
    liveApiActivity = {
      status: "preparing",
      requestType,
      provider: openAI.providerName(modelInfo?.provider || openAI.providerForModel(settings.model)),
      model: modelInfo?.label || settings.model,
      inputSummary,
      trace: contextSelection?.trace || null,
      startedAt: Date.now(),
      elapsedMs: 0,
      responseId: null,
      usageText: "",
      error: ""
    };
    renderApiActivity();
  }

  function markApiWaiting() {
    updateApiActivity({ status: "waiting" });
    stopApiActivityTimer();
    apiActivityTimer = global.setInterval(() => {
      if (liveApiActivity.status !== "waiting") return;
      updateApiActivity({});
    }, 1000);
  }

  function completeApiActivity(result) {
    stopApiActivityTimer();
    updateApiActivity({
      status: "received",
      responseId: result?.responseId || null,
      usageText: usageText(result?.usage),
      error: ""
    });
    traceManager.span(
      "model_response",
      `Response received${result?.responseId ? ` as ${result.responseId}` : ""}.`
    );
  }

  function failApiActivity(error, status = "error") {
    stopApiActivityTimer();
    updateApiActivity({
      status,
      error: error?.message || String(error || "")
    });
    traceManager.span("failure", error?.message || String(error || ""), status);
    traceManager.complete({
      status,
      validationOutcome: error?.message || String(error || "")
    });
  }

  function resetApiActivity() {
    stopApiActivityTimer();
    liveApiActivity = { status: "idle" };
    renderApiActivity();
  }

  function renderConversation() {
    const preservedScrollTop = messagesElement.scrollTop;
    const recommendation = currentRecommendation();
    if (
      !state.review.started &&
      !state.messages.length &&
      !sessionOnlyChatMessages.length &&
      !pendingChatMessages.length
    ) {
      messagesElement.innerHTML = ui.welcomeMarkup();
    } else {
      const lastControlIndex = state.messages.findLastIndex(message => ["choices", "confirmation"].includes(message.kind));
      const transcript = [];
      for (let index = 0; index <= state.messages.length; index += 1) {
        sessionOnlyChatMessages
          .filter(message => Math.min(message.insertAt, state.messages.length) === index)
          .forEach(message => {
            transcript.push(ui.messageMarkup(message, {
              state,
              recommendation,
              accountUrl: targetAccountUrl(),
              activeControl: false
            }));
          });
        if (index < state.messages.length) {
          transcript.push(ui.messageMarkup(state.messages[index], {
            state,
            recommendation,
            accountUrl: targetAccountUrl(),
            activeControl: index === lastControlIndex
          }));
        }
      }
      const pendingMessages = pendingChatMessages.map(message => ui.messageMarkup(message, {
        state,
        recommendation,
        accountUrl: targetAccountUrl(),
        activeControl: false
      })).join("");
      const conversationLabel = state.review.manualScenario
        ? "Manual scenario"
        : state.review.started
          ? "Subscription review"
          : "Household context update";
      messagesElement.innerHTML = `<div class="day-marker">${conversationLabel} · ${ui.escapeHtml(engine.displayDate(state.systemDate, state.household.locale))}</div>${transcript.join("")}${pendingMessages}`;
    }
    renderDetails(recommendation);
    global.requestAnimationFrame(() => {
      const maximumScrollTop = Math.max(0, messagesElement.scrollHeight - messagesElement.clientHeight);
      messagesElement.scrollTop = Math.min(preservedScrollTop, maximumScrollTop);
    });
  }

  function renderAll() {
    refreshState();
    renderSidebar();
    renderConversation();
    renderAIStatus();
    document.getElementById("memoryContent").innerHTML = ui.memoryMarkup(state);
    document.getElementById("spendingContent").innerHTML = ui.spendingMarkup(state);
    renderEvaluations();
  }

  function evaluationScrollState(content) {
    const navigator = content.querySelector(".eval-case-navigator");
    const navigatorList = content.querySelector(".eval-case-nav-list");
    const selectedCase = content.querySelector(".eval-selected-case");
    const selectedNavItem = content.querySelector(".eval-case-nav-item.selected");
    return {
      content: content.scrollTop,
      navigator: navigator?.scrollTop || 0,
      navigatorListTop: navigatorList?.scrollTop || 0,
      navigatorListLeft: navigatorList?.scrollLeft || 0,
      selectedCase: selectedCase?.scrollTop || 0,
      selectedEvalId: selectedNavItem?.dataset.evalId || null
    };
  }

  function restoreEvaluationScroll(content, scrollState, activeEvalId) {
    global.requestAnimationFrame(() => {
      content.scrollTop = scrollState.content;
      const navigator = content.querySelector(".eval-case-navigator");
      const navigatorList = content.querySelector(".eval-case-nav-list");
      const selectedCase = content.querySelector(".eval-selected-case");
      if (navigator) {
        navigator.scrollTop = scrollState.navigator;
        const selectedNavItem = Array.from(navigator.querySelectorAll(".eval-case-nav-item"))
          .find(item => item.dataset.evalId === activeEvalId);
        if (selectedNavItem) {
          const navigatorRect = navigator.getBoundingClientRect();
          const itemRect = selectedNavItem.getBoundingClientRect();
          if (itemRect.top < navigatorRect.top) {
            navigator.scrollTop -= navigatorRect.top - itemRect.top + 8;
          } else if (itemRect.bottom > navigatorRect.bottom) {
            navigator.scrollTop += itemRect.bottom - navigatorRect.bottom + 8;
          }
        }
      }
      if (navigatorList) {
        navigatorList.scrollTop = scrollState.navigatorListTop;
        navigatorList.scrollLeft = scrollState.navigatorListLeft;
        const selectedNavItem = Array.from(navigatorList.querySelectorAll(".eval-case-nav-item"))
          .find(item => item.dataset.evalId === activeEvalId);
        if (selectedNavItem) {
          const listRect = navigatorList.getBoundingClientRect();
          const itemRect = selectedNavItem.getBoundingClientRect();
          if (itemRect.left < listRect.left) {
            navigatorList.scrollLeft -= listRect.left - itemRect.left + 8;
          } else if (itemRect.right > listRect.right) {
            navigatorList.scrollLeft += itemRect.right - listRect.right + 8;
          }
        }
      }
      if (selectedCase) {
        selectedCase.scrollTop = scrollState.selectedEvalId === activeEvalId
          ? scrollState.selectedCase
          : 0;
      }
    });
  }

  function renderEvaluations() {
    const content = document.getElementById("evaluationsContent");
    const scrollState = evaluationScrollState(content);
    const model = evaluations.model();
    const instructionsButton = document.getElementById("openEvaluationInstructions");
    instructionsButton.classList.toggle("approval-needed", !model.promptApproved);
    instructionsButton.setAttribute(
      "aria-label",
      model.promptApproved ? "Open approved evaluation instructions" : "Open and approve evaluation instructions"
    );
    if (model.runningEvalId) selectedEvaluationId = model.runningEvalId;
    if (!model.cases.some(item => item.eval_id === selectedEvaluationId)) {
      selectedEvaluationId = model.cases.find(item => ["fail", "error"].includes(item.result?.verdict))?.eval_id
        || model.cases[0]?.eval_id;
    }
    content.innerHTML = ui.evaluationMarkup({
      ...model,
      selectedEvalId: selectedEvaluationId,
      instructionsOpen: evaluationInstructionsOpen,
      fullScreenInstructionKey: fullScreenEvaluationInstruction,
      operatorMode: localOperatorMode,
      operatorAvailable: localOperatorAvailable,
      operatorPublishing: localOperatorPublishing,
      operatorStatus: localOperatorStatus,
      operatorStatusType: localOperatorStatusType
    });
    restoreEvaluationScroll(content, scrollState, selectedEvaluationId);
  }

  async function refreshLocalOperatorAvailability() {
    if (!localOperatorMode) return false;
    try {
      const response = await global.fetch("/__streaming_guard/operator", {
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      const body = response.ok ? await response.json() : null;
      localOperatorAvailable = Boolean(body?.available);
    } catch (_) {
      localOperatorAvailable = false;
    }
    renderEvaluations();
    return localOperatorAvailable;
  }

  function useDefaultEvaluationModels() {
    const settings = openAI.readSettings();
    if (!settings.openaiApiKey) {
      throw new Error("Connect OpenAI before running the default agent and judge.");
    }
    if (settings.model === openAI.DEFAULT_MODEL && settings.judgeModel === openAI.JUDGE_MODEL) {
      return false;
    }
    openAI.saveSettings({
      openaiApiKey: settings.openaiApiKey,
      anthropicApiKey: settings.anthropicApiKey,
      geminiApiKey: settings.geminiApiKey,
      model: openAI.DEFAULT_MODEL,
      judgeModel: openAI.JUDGE_MODEL
    });
    renderAIStatus();
    return true;
  }

  function evaluationPublishPayload(model) {
    return {
      agentModel: model.model,
      judgeModel: model.judgeModel,
      promptHash: model.promptHash,
      counts: model.counts,
      cases: model.cases.map(item => ({
        evalId: item.eval_id,
        verdict: item.result?.verdict || "not_run",
        promptHash: item.result?.promptHash || null,
        completedAt: item.result?.completedAt || null,
        model: item.result?.model || null,
        judgeModel: item.result?.judgeModel || null,
        criteriaCount: item.result?.criteria?.length || 0,
        criteriaPassed: item.result?.criteria?.filter(check => check.passed).length || 0
      })),
      exportText: evaluations.exportResultsText()
    };
  }

  async function runDefaultEvaluationsAndPublish() {
    if (!localOperatorMode) throw new Error("Validated publishing is available only from the localhost site.");
    if (!localOperatorAvailable && !await refreshLocalOperatorAvailability()) {
      throw new Error("Start run-evals-and-publish.command, then try again.");
    }
    const changedModels = useDefaultEvaluationModels();
    if (changedModels) {
      localOperatorStatus = "Default models selected. Review and approve the updated instruction fingerprint, then run the shortcut again.";
      localOperatorStatusType = "warning";
      renderEvaluations();
      throw new Error(localOperatorStatus);
    }
    const before = evaluations.model();
    if (!before.promptApproved) {
      evaluationInstructionsOpen = true;
      renderEvaluations();
      throw new Error("Review and approve all six instruction sections and ten expected outcomes before publishing.");
    }
    if (!global.confirm(
      "Run all ten evaluation cases with GPT-5.6 Terra and independent GPT-5.6 Luna judging? A GitHub push will occur only if all ten pass."
    )) return;

    localOperatorStatus = "Running all ten cases with the default agent and independent judge…";
    localOperatorStatusType = "running";
    renderEvaluations();
    await evaluations.runAll(renderEvaluations);
    const completed = evaluations.model();
    if (
      completed.counts.pass !== 10 ||
      completed.counts.fail !== 0 ||
      completed.counts.error !== 0 ||
      completed.counts.not_run !== 0
    ) {
      localOperatorStatus = `Publish blocked: ${completed.counts.pass} passed, ${completed.counts.fail} failed, ${completed.counts.error} errors, ${completed.counts.not_run} not run.`;
      localOperatorStatusType = "error";
      renderEvaluations();
      showToast("Evaluation did not pass 10 of 10; GitHub was not changed");
      return;
    }

    localOperatorPublishing = true;
    localOperatorStatus = "All ten cases passed. Running local validation and publishing to GitHub…";
    localOperatorStatusType = "running";
    renderEvaluations();
    try {
      const response = await global.fetch("/__streaming_guard/publish", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(evaluationPublishPayload(completed))
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "The validated GitHub publish failed.");
      localOperatorStatus = `${result.message} GitHub Pages will update shortly.`;
      localOperatorStatusType = "success";
      showToast(`Published ${result.commit} after 10 of 10 passed`);
    } finally {
      localOperatorPublishing = false;
      renderEvaluations();
    }
  }

  function renderAIStatus() {
    const settings = openAI.readSettings();
    const connected = openAI.selectedModelsConfigured(settings);
    const button = document.getElementById("openAISettings");
    const status = document.getElementById("aiStatusText");
    button.classList.toggle("connected", connected);
    const roleLabel = model => {
      const info = openAI.modelInfo(model);
      return info ? `${openAI.providerName(info.provider)} ${info.label}` : model;
    };
    status.replaceChildren();
    if (!connected) {
      status.textContent = "Connect AI Models";
      return;
    }
    const role = (label, value, type) => {
      const container = document.createElement("span");
      container.className = `ai-model-role ${type}`;
      const roleName = document.createElement("span");
      roleName.className = "ai-model-role-label";
      roleName.textContent = label;
      const modelName = document.createElement("strong");
      modelName.textContent = value;
      container.append(roleName, modelName);
      return container;
    };
    const divider = document.createElement("span");
    divider.className = "ai-model-divider";
    divider.setAttribute("aria-hidden", "true");
    status.append(
      role("Main model", roleLabel(settings.model), "agent"),
      divider,
      role("Independent judge", roleLabel(settings.judgeModel), "judge")
    );
  }

  function setChatBusy(busy) {
    messageInput.disabled = busy;
    document.querySelector(".send-button").disabled = busy;
    document.querySelectorAll('[data-action="run-check"], [data-action="run-background-sweep"], [data-action="review-subscription-request"], [data-action="start-manual-scenario"]').forEach(button => {
      button.disabled = busy;
    });
    if (busy) {
      document.getElementById("aiStatusText").textContent = "The selected AI model is thinking…";
    } else {
      renderAIStatus();
    }
    document.getElementById("openAISettings").classList.toggle("thinking", busy);
  }

  function chatMessageTime() {
    return new Intl.DateTimeFormat(state.household.locale || "en-US", {
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date());
  }

  function showPendingConversation(text) {
    const time = chatMessageTime();
    pendingChatMessages = [
      {
        id: `pending-user-${Date.now()}`,
        role: "user",
        kind: "text",
        text,
        time,
        pending: true
      },
      {
        id: `pending-agent-${Date.now()}`,
        role: "agent",
        kind: "processing",
        text: "Processing",
        time: "",
        pending: true
      }
    ];
    renderConversation();
  }

  function showPendingDecision() {
    pendingChatMessages = [{
      id: `pending-agent-${Date.now()}`,
      role: "agent",
      kind: "processing",
      text: "Processing",
      time: "",
      pending: true
    }];
    renderConversation();
  }

  function clearPendingChat() {
    pendingChatMessages = [];
  }

  function applyContextUpdateProposal(update, turn) {
    const scope = update.scope === "one_time" ? "one_time" : "permanent";
    if (update.updateType === "viewing_confirmation") {
      if (update.field !== "status") throw new Error("The viewing update field is unsupported.");
      const status = update.value;
      if (!["not_started", "watching", "completed", "unknown"].includes(status)) {
        throw new Error("The proposed viewing status is unsupported.");
      }
      if (status === "completed" && !/^\d{4}-\d{2}-\d{2}$/.test(update.effectiveDate)) {
        throw new Error("A completed viewing update requires a valid completion date.");
      }
      tools.update_household_context({
        updateType: "viewing_confirmation",
        payload: {
          memberId: update.targetId,
          titleId: update.relatedId || state.scenario.titleId,
          status,
          completedOn: status === "completed" ? update.effectiveDate : null
        },
        source: "adult_chat",
        scope
      });
      return { externalActionConfirmed: false };
    }

    if (update.updateType === "family_rule") {
      if (!["monthlyBudgetCap", "advertisingTolerance", "resolutionPreference", "priorityPolicy"].includes(update.field)) {
        throw new Error("The proposed family-rule field is unsupported.");
      }
      const value = update.field === "monthlyBudgetCap" ? Number(update.value) : update.value;
      tools.update_household_context({
        updateType: "family_rule",
        payload: { rule: update.field, value },
        source: "adult_chat",
        scope
      });
      return { externalActionConfirmed: false };
    }

    if (update.updateType === "subscription_record") {
      if (![
        "subscriptionPlan",
        "subscriptionStatus",
        "monthlyCost",
        "renewalStatus",
        "nextRenewal",
        "expirationDate"
      ].includes(update.field)) {
        throw new Error("The proposed subscription field is unsupported.");
      }
      tools.update_household_context({
        updateType: "subscription_record",
        payload: {
          serviceId: update.targetId,
          planId: update.relatedId,
          field: update.field,
          value: update.value,
          effectiveDate: update.effectiveDate
        },
        source: "adult_chat",
        scope: "not_applicable"
      });
      return { externalActionConfirmed: false };
    }

    if (update.updateType === "watchlist_item") {
      if (!["priority", "watchlistStatus"].includes(update.field)) {
        throw new Error("The proposed watchlist field is unsupported.");
      }
      tools.update_household_context({
        updateType: "watchlist_item",
        payload: {
          memberId: update.targetId,
          titleId: update.relatedId,
          field: update.field,
          value: update.value,
          effectiveDate: update.effectiveDate
        },
        source: "adult_chat",
        scope
      });
      return { externalActionConfirmed: false };
    }

    if (update.updateType === "title_rating_exception") {
      const titleId = update.relatedId || update.value;
      if (
        update.field !== "contentRatingException" ||
        titleId !== update.value ||
        update.scope !== "one_time"
      ) {
        throw new Error("A child-rating exception must identify one exact title.");
      }
      const child = state.members.find(member => member.id === update.targetId && Number(member.age) < 18);
      if (!child) throw new Error("The proposed child-rating exception does not identify an intended child viewer.");
      tools.update_household_context({
        updateType: "title_rating_exception",
        payload: {
          memberId: child.id,
          titleId,
          approved: true
        },
        source: "authorized_adult_chat",
        scope: "one_time"
      });
      return { externalActionConfirmed: false };
    }

    if (["additional_escalation", "remove_additional_escalation"].includes(update.updateType)) {
      if (update.field !== "condition" || !update.value.trim()) {
        throw new Error("An escalation update requires a specific condition.");
      }
      tools.update_household_context({
        updateType: update.updateType,
        payload: { condition: update.value.trim() },
        source: "adult_chat",
        scope
      });
      return { externalActionConfirmed: false };
    }

    if (update.updateType === "external_action_confirmation") {
      const recommendation = currentRecommendation();
      const selectedAction = recommendation?.actionType;
      const expectedStatus = global.StreamingGuardScenarioConfig.actionCompletionStatus[selectedAction];
      if (
        turn.outcome !== "external_action_confirmed" ||
        !expectedStatus ||
        turn.finalAction !== selectedAction
      ) {
        throw new Error("The external-action confirmation does not match the active recommendation.");
      }
      tools.update_household_context({
        updateType: "external_action_confirmation",
        payload: {
          serviceId: state.scenario.targetServiceId,
          newStatus: expectedStatus,
          confirmed: true
        },
        source: "adult_chat",
        scope: "not_applicable"
      });
      return { externalActionConfirmed: true };
    }

    throw new Error("The proposed context update type is unsupported.");
  }

  function applyProposedContextUpdates(turn) {
    const result = {
      applied: [],
      pending: [],
      rejected: [],
      externalActionConfirmed: false
    };
    turn.proposedContextUpdates.forEach(update => {
      if (update.requiresAdultConfirmation) {
        result.pending.push(update);
        return;
      }
      try {
        const outcome = applyContextUpdateProposal(update, turn);
        result.applied.push(update);
        result.externalActionConfirmed ||= outcome.externalActionConfirmed;
        refreshState();
      } catch (error) {
        result.rejected.push({ update, error: error.message });
      }
    });
    return result;
  }

  function persistAdultMessage(text) {
    return sendChat({
      role: "user",
      text
    });
  }

  function displayAdultMessageWithoutRetention(text, safetyDisposition) {
    const message = {
      id: `session-only-user-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      role: "user",
      kind: "text",
      text,
      time: chatMessageTime(),
      insertAt: state.messages.length,
      sessionOnly: true,
      safetyDisposition
    };
    sessionOnlyChatMessages.push(message);
    recordLiveTraceTool(
      "display_session_only_message",
      "Adult message displayed verbatim for this browser session; content excluded from persistence, context, logs, and model requests."
    );
    renderConversation();
    return message;
  }

  function isLikelyStreamingScopeMessage(text) {
    const message = String(text || "");
    const activePlanningFollowUp = Boolean(currentRecommendation()) && (
      /\b(?:agree|disagree|approve|reject|override|revisit|not yet|tell me more|why|what if|i did it|i completed it|it is done)\b/i
        .test(message) ||
      (
        state.review.nextExpectedInput &&
        state.review.nextExpectedInput !== "none" &&
        /^(?:yes|no|okay|ok|correct|finished|completed|done)\b/i.test(message.trim())
      )
    );
    return activePlanningFollowUp || contextSelector.isLikelyStreamingRequest({
      message,
      state,
      knowledge: context.knowledge
    });
  }

  function recordSafetyDisposition(safetyDisposition, reasonCode) {
    transact(draft => {
      draft.review.lastTurnType = "safety_escalation";
      draft.review.safetyDisposition = safetyDisposition;
      draft.review.reasonCodes = [reasonCode];
      draft.review.nextExpectedInput = "none";
      draft.review.pendingContextUpdates = [];
    });
  }

  async function askOpenAI(text, intent) {
    const settings = openAI.readSettings();
    let adultMessagePersisted = false;
    let conversationAttempt = 1;
    showPendingConversation(text);
    const decisionPacket = engine.buildDecisionPacket(state);
    const contextSelection = openAI.selectRequestContext({
      state,
      knowledge: context.knowledge,
      decisionPacket,
      recommendation: currentRecommendation(),
      userText: text,
      requestType: "conversation"
    });
    beginApiActivity({
      requestType: "conversation",
      settings,
      contextSelection,
      inputSummary: selectedContextInputSummary(
        contextSelection,
        "Global system instructions and the conversation task add-on",
        "Strict structured conversation response schema"
      )
    });
    transitionWorkflow(workflowEngine.events.INPUT_RECEIVED, "Adult chat input accepted.");
    transitionWorkflow(
      workflowEngine.events.CONTEXT_SELECTED,
      `Context plan ${contextSelection.contextPlan?.contextHash || "unavailable"} selected.`
    );
    transitionWorkflow(workflowEngine.events.DECISION_REQUESTED, "Conversation decision requested from the selected model.");
    responseController?.abort();
    responseController = new AbortController();
    setChatBusy(true);
    try {
      const requestConversationResponse = validationFeedback => openAI.createResponse({
          state,
          recommendation: currentRecommendation(),
          userText: text,
          intent,
          knowledge: context.knowledge,
          validationFeedback,
          contextSelection,
          signal: responseController.signal
        });
      let responsePromise = requestConversationResponse("");
      markApiWaiting();
      let result;
      try {
        result = await responsePromise;
      } catch (firstError) {
        if (!firstError.output || firstError.name === "AbortError") throw firstError;
        recordAIChatDebugCall({
          requestType: "conversation",
          attempt: conversationAttempt,
          error: firstError,
          validatedOutput: firstError.output,
          validationStatus: "rejected_by_application_validator"
        });
        updateApiActivity({
          inputSummary: [
            ...liveApiActivity.inputSummary,
            "The first structured response failed validation; one corrected response was requested automatically"
          ]
        });
        conversationAttempt += 1;
        responsePromise = requestConversationResponse(firstError.message);
        result = await responsePromise;
      }
      const turn = result.response;
      transitionWorkflow(workflowEngine.events.OUTPUT_VALIDATED, "Conversation output passed application validation.");
      recordAIChatDebugCall({
        requestType: "conversation",
        attempt: conversationAttempt,
        result,
        validatedOutput: turn
      });
      if (["sensitive_information_warning", "out_of_scope"].includes(turn.safetyDisposition)) {
        displayAdultMessageWithoutRetention(text, turn.safetyDisposition);
      } else {
        persistAdultMessage(text);
      }
      adultMessagePersisted = true;
      completeApiActivity(result);
      const beforeSubscriptionBaseline = subscriptionFinancialBaseline();
      const safetyOnlyTurn = ["sensitive_information_warning", "out_of_scope"]
        .includes(turn.safetyDisposition);
      const updateResult = safetyOnlyTurn
        ? {
            applied: [],
            pending: [],
            rejected: [],
            externalActionConfirmed: false
          }
        : applyProposedContextUpdates(turn);
      refreshState();
      const appliedSubscriptionUpdates = updateResult.applied.filter(update =>
        ["subscription_record", "external_action_confirmation"].includes(update.updateType)
      );
      const recommendation = currentRecommendation();
      transact(draft => {
        draft.review.lastTurnType = turn.turnType;
        draft.review.recommendationEffect = turn.recommendationEffect;
        draft.review.nextExpectedInput = turn.nextExpectedInput;
        draft.review.safetyDisposition = turn.safetyDisposition;
        draft.review.reasonCodes = [...turn.reasonCodes];
        draft.review.pendingContextUpdates = [...updateResult.pending, ...updateResult.rejected.map(item => ({
          ...item.update,
          requiresAdultConfirmation: true
        }))];
        if (
          turn.outcome === "external_action_confirmed" &&
          !updateResult.externalActionConfirmed
        ) {
          draft.review.progressStage = "external_action";
          draft.review.discussionStatus = "external_action_pending";
          draft.review.resolution = "recommendation_accepted";
          draft.review.resolutionAction = turn.finalAction;
          draft.review.resolvedAt = null;
          draft.review.status = "waiting_for_external_action";
          draft.review.nextExpectedInput = "external_action_confirmation";
          draft.review.adultDecision = "Agreed with final recommendation";
        } else if (updateResult.externalActionConfirmed) {
          draft.review.progressStage = "completion_confirmed";
          draft.review.discussionStatus = "resolved";
          draft.review.resolution = "external_action_completed";
          draft.review.resolutionAction = turn.finalAction;
          draft.review.resolvedAt = draft.systemDate;
          draft.review.status = "completed";
          draft.review.adultDecision = "Agreed and completed externally";
        } else if (turn.discussionStatus === "resolved") {
          draft.review.progressStage = "final_agreement";
          draft.review.discussionStatus = "resolved";
          draft.review.resolution = turn.outcome;
          draft.review.resolutionAction = turn.finalAction;
          draft.review.resolvedAt = draft.systemDate;
          draft.review.status = "discussion_resolved";
          draft.review.adultDecision = turn.outcome === "recommendation_declined"
            ? `Declined recommendation; chose to ${turn.finalAction}`
            : `Accepted recommendation to ${turn.finalAction}`;
        } else if (turn.discussionStatus === "external_action_pending") {
          draft.review.progressStage = "external_action";
          draft.review.discussionStatus = "external_action_pending";
          draft.review.resolution = turn.outcome;
          draft.review.resolutionAction = turn.finalAction;
          draft.review.resolvedAt = null;
          draft.review.status = "waiting_for_external_action";
          draft.review.adultDecision = "Agreed with final recommendation";
        } else {
          draft.review.progressStage = "family_discussion";
          draft.review.discussionStatus = "open";
          draft.review.resolution = null;
          draft.review.resolutionAction = null;
          draft.review.resolvedAt = null;
          draft.review.status = recommendation?.route || draft.review.status;
          if (turn.outcome === "revisit_requested") {
            draft.review.adultDecision = "Reopened recommendation discussion";
          }
        }
      });
      if (turn.safetyDisposition === "execution_refused") {
        transitionWorkflow(workflowEngine.events.EXECUTION_REFUSED, "The advisory execution boundary was enforced.");
      } else if (updateResult.externalActionConfirmed) {
        transitionWorkflow(workflowEngine.events.DISCUSSION_OPENED, "Validated output returned to the adult.");
        transitionWorkflow(workflowEngine.events.ADULT_AGREED, "The adult confirmed the external action.");
        transitionWorkflow(workflowEngine.events.EXTERNAL_ACTION_CONFIRMED, "The confirmed external action was saved.");
      } else if (turn.discussionStatus === "external_action_pending") {
        transitionWorkflow(workflowEngine.events.DISCUSSION_OPENED, "Validated output returned to the adult.");
        transitionWorkflow(workflowEngine.events.ADULT_AGREED, "Adult agreement recorded; external action remains pending.");
      } else if (turn.discussionStatus === "resolved") {
        transitionWorkflow(workflowEngine.events.DISCUSSION_OPENED, "Validated output returned to the adult.");
        transitionWorkflow(workflowEngine.events.COMPLETE_WITHOUT_ACTION, "The discussion closed without a pending external action.");
      } else if (turn.safetyDisposition === "adult_judgment_required") {
        transitionWorkflow(workflowEngine.events.ADULT_JUDGMENT_REQUESTED, "Specific adult information or judgment is required.");
      } else {
        transitionWorkflow(workflowEngine.events.DISCUSSION_OPENED, "The adult can continue the conversation.");
      }
      updateCompletedTrace({ turn, updateResult });
      const replyText = updateResult.rejected.length
        ? `${turn.reply} I understood the requested update, but I could not validate it against the stored household context, so I did not save it.`
        : turn.reply;
      sendChat(turn.safetyDisposition === "execution_refused"
        ? {
            kind: "refusal",
            text: replyText,
            refusalSections: turn.refusalSections
          }
        : { text: replyText });
      let budgetFollowUpRequired = false;
      if (appliedSubscriptionUpdates.length) {
        const language = engine.actionLanguage[turn.finalAction] || engine.actionLanguage.keep;
        budgetFollowUpRequired = sendSubscriptionFinancialConfirmation(
          beforeSubscriptionBaseline,
          appliedSubscriptionUpdates,
          updateResult.externalActionConfirmed
            ? `The household record now shows ${state.scenario.targetServiceName} as ${language.past}.`
            : ""
        );
      }
      if (updateResult.externalActionConfirmed) {
        showToast("Household details updated after adult confirmation");
      } else if (
        turn.recommendationEffect === "revise" &&
        updateResult.applied.length &&
        !budgetFollowUpRequired
      ) {
        await replaceRecommendationMessages("relevant_chat_information_added");
      } else if (updateResult.applied.length) {
        showToast("Household details updated");
      } else if (turn.discussionStatus === "external_action_pending") {
        sendChat({ kind: "confirmation" });
      } else if (turn.discussionStatus === "open") {
        sendChat({ kind: "choices" });
      }
    } catch (error) {
      if (!error.aiChatDebugLogged) {
        recordAIChatDebugCall({
          requestType: "conversation",
          attempt: conversationAttempt,
          error,
          validatedOutput: error.output || null,
          validationStatus: error.output ? "rejected_by_application_validator" : "request_error"
        });
      }
      if (error.name === "AbortError") {
        failApiActivity(error, "canceled");
        return;
      }
      if (!adultMessagePersisted) persistAdultMessage(text);
      const friendlyError = error.output
        ? "The AI response could not be validated after one automatic retry. Nothing was changed. Please try again."
        : "The selected AI model could not respond. Nothing was changed. Please try again.";
      transitionWorkflow(workflowEngine.events.FAILED, friendlyError);
      failApiActivity(
        new Error(error.code === "not_configured" ? error.message : friendlyError),
        error.code === "not_configured" ? "not_connected" : "error"
      );
      sendChat({
        text: error.code === "not_configured"
          ? "The selected agent provider is not connected yet. Please open AI model settings above, add the required API key, and then send your message again."
          : friendlyError
      });
      showToast("AI response unavailable");
    } finally {
      clearPendingChat();
      responseController = null;
      setChatBusy(false);
      renderAll();
    }
  }

  function sendChat(message) {
    const storedMessage = tools.send_chat_response(message);
    recordLiveTraceTool(
      "send_chat_response",
      `${storedMessage.role === "user" ? "Adult message stored in the chat" : "Agent response rendered in the chat"}${storedMessage.redacted ? " with safety redaction" : ""}`
    );
    refreshState();
    return storedMessage;
  }

  function beginChatSequence() {
    chatSequenceVersion += 1;
    return chatSequenceVersion;
  }

  function cancelChatSequence() {
    chatSequenceVersion += 1;
  }

  async function waitForMessageBeat(sequenceVersion) {
    await new Promise(resolve => global.setTimeout(resolve, stagedMessageDelayMs));
    return sequenceVersion === chatSequenceVersion;
  }

  async function sendStagedChat(message, sequenceVersion) {
    if (!await waitForMessageBeat(sequenceVersion)) return false;
    sendChat(message);
    renderAll();
    return true;
  }

  function storeRecommendation(recommendation, {
    source,
    model = null,
    responseId = null,
    usage = null,
    error = null
  }) {
    transact(draft => {
      draft.review.generatedRecommendation = {
        ...recommendation,
        version: draft.review.recommendationVersion
      };
      draft.review.progressStage = "recommendation_ready";
      draft.review.status = recommendation.route;
      draft.review.discussionStatus = "open";
      draft.review.resolution = null;
      draft.review.resolutionAction = null;
      draft.review.resolvedAt = null;
      draft.review.lastTurnType = null;
      draft.review.recommendationEffect = "unchanged";
      draft.review.nextExpectedInput = recommendation.status === "Adult judgment required" ? "additional_context" : "adult_decision";
      draft.review.safetyDisposition = recommendation.status === "Adult judgment required" ? "adult_judgment_required" : "normal";
      draft.review.reasonCodes = [];
      draft.review.pendingContextUpdates = [];
      draft.review.recommendationSource = source;
      draft.review.recommendationModel = model;
      draft.review.recommendationResponseId = responseId;
      draft.review.recommendationUsage = usage;
      draft.review.recommendationError = error;
    });
    transitionWorkflow(workflowEngine.events.OUTPUT_VALIDATED, "Recommendation output passed application validation.");
    transitionWorkflow(
      recommendation.status === "Adult judgment required"
        ? workflowEngine.events.ADULT_JUDGMENT_REQUESTED
        : workflowEngine.events.DISCUSSION_OPENED,
      recommendation.status === "Adult judgment required"
        ? "The recommendation requires a specific adult judgment."
        : "The recommendation is ready for adult review."
    );
  }

  async function generateRecommendation(reason) {
    refreshState();
    showPendingDecision();
    const decisionPacket = engine.buildDecisionPacket(state);
    const settings = openAI.readSettings();
    const contextSelection = openAI.selectRequestContext({
      state,
      knowledge: context.knowledge,
      decisionPacket,
      recommendation: null,
      userText: "",
      requestType: "recommendation",
      reason
    });
    beginApiActivity({
      requestType: "recommendation",
      settings,
      contextSelection,
      inputSummary: selectedContextInputSummary(
        contextSelection,
        "Global system instructions, recommendation task add-on, and deterministic decision packet",
        "Strict structured recommendation response schema"
      )
    });
    transitionWorkflow(
      workflowEngine.events.CONTEXT_SELECTED,
      `Context plan ${contextSelection.contextPlan?.contextHash || "unavailable"} selected.`
    );
    transitionWorkflow(workflowEngine.events.DECISION_REQUESTED, "Recommendation decision requested from the selected model.");
    transact(draft => {
      draft.review.progressStage = "model_request";
    });
    renderDetails(currentRecommendation());
    if (!openAI.isModelConfigured(settings.model, settings)) {
      const connectionError = `${openAI.providerName(openAI.providerForModel(settings.model))} is not connected.`;
      transact(draft => {
        draft.review.generatedRecommendation = null;
        draft.review.recommendationSource = "llm_unavailable";
        draft.review.recommendationError = connectionError;
      });
      failApiActivity(new Error(connectionError), "not_connected");
      transitionWorkflow(workflowEngine.events.FAILED, connectionError);
      clearPendingChat();
      renderConversation();
      return { source: "llm_unavailable", error: new Error(connectionError) };
    }

    responseController?.abort();
    responseController = new AbortController();
    setChatBusy(true);
    try {
      const responsePromise = openAI.createRecommendation({
        state,
        decisionPacket,
        knowledge: context.knowledge,
        reason,
        contextSelection,
        signal: responseController.signal
      });
      markApiWaiting();
      const result = await responsePromise;
      recordAIChatDebugCall({
        requestType: "recommendation",
        result,
        validatedOutput: result.recommendation
      });
      storeRecommendation(result.recommendation, {
        source: "llm",
        model: result.model,
        responseId: result.responseId,
        usage: result.usage
      });
      completeApiActivity(result);
      updateCompletedTrace({ recommendation: true });
      return { source: "llm", result };
    } catch (error) {
      if (!error.aiChatDebugLogged) {
        recordAIChatDebugCall({
          requestType: "recommendation",
          error,
          validatedOutput: error.output || null,
          validationStatus: error.output ? "rejected_by_application_validator" : "request_error"
        });
      }
      if (error.name === "AbortError") {
        failApiActivity(error, "canceled");
        return { source: "aborted", error };
      }
      transact(draft => {
        draft.review.generatedRecommendation = null;
        draft.review.recommendationSource = "llm_unavailable";
        draft.review.recommendationModel = settings.model;
        draft.review.recommendationError = error.message;
      });
      failApiActivity(error);
      transitionWorkflow(workflowEngine.events.FAILED, error.message);
      return { source: "llm_unavailable", error };
    } finally {
      clearPendingChat();
      responseController = null;
      setChatBusy(false);
      renderConversation();
    }
  }

  function sendRecommendationSourceNotice(generation) {
    if (generation.source !== "llm_unavailable") return;
    const explanation = generation.error?.message || "The live recommendation was unavailable.";
    sendChat({
      text: `I couldn’t generate a recommendation because the selected AI decision step is unavailable. No code-generated recommendation will be substituted. ${explanation}`
    });
  }

  function activateDemoScenario(scenarioId, triggerType) {
    responseController?.abort();
    responseController = null;
    sessionOnlyChatMessages = [];
    memory.reset({ scenarioId });
    rebaseScenarioDates(math.localDateIso(new Date()));
    refreshState();
    transact(draft => {
      draft.scenario.triggerType = triggerType;
    });
  }

  function prepareScenarioReview() {
    resetApiActivity();
    composerIntent = "general";
    composerMode.textContent = "";
    messageInput.placeholder = "Ask a question or share more information…";
    rebaseScenarioDates(math.localDateIso(new Date()));
    refreshState();
    transact(draft => {
      draft.review.started = true;
      draft.review.manualScenario = false;
      draft.review.progressStage = "trigger";
      draft.review.recommendationVersion += 1;
      draft.review.adultDecision = null;
      draft.review.discussionStatus = "open";
      draft.review.resolution = null;
      draft.review.resolutionAction = null;
      draft.review.resolvedAt = null;
      draft.review.lastTurnType = null;
      draft.review.recommendationEffect = "unchanged";
      draft.review.nextExpectedInput = "none";
      draft.review.safetyDisposition = "normal";
      draft.review.reasonCodes = [];
      draft.review.pendingContextUpdates = [];
      draft.review.externalActionConfirmed = false;
      draft.review.dailyReminderEnabled = false;
      draft.review.lastReminderOn = null;
      draft.review.generatedRecommendation = null;
      draft.review.recommendationSource = "pending_llm";
      draft.review.recommendationModel = null;
      draft.review.recommendationResponseId = null;
      draft.review.recommendationUsage = null;
      draft.review.recommendationError = null;
      draft.messages = [];
    });
    transitionWorkflow(workflowEngine.events.INPUT_RECEIVED, "The selected demo trigger was accepted.");
  }

  async function runBackgroundSweep({ resetScenario = true } = {}) {
    if (resetScenario) {
      activateDemoScenario(global.StreamingGuardScenarioConfig.demoScenarios.backgroundSweep, "daily_background_sweep");
    }
    prepareScenarioReview();
    const sequenceVersion = beginChatSequence();

    const sweep = tools.run_daily_sweep();
    transact(draft => {
      draft.review.status = sweep.status;
    });
    if (sweep.status === "no_action") {
      sendChat({ text: "The daily background sweep is complete. I did not find an actionable change, so I have not generated a subscription recommendation or changed any household details." });
      renderAll();
      return;
    }
    sendChat({ text: `The daily background sweep found that ${state.scenario.targetServiceName} may no longer be needed. I’m reviewing the family’s latest confirmed viewing, watchlist priorities, renewal terms, and budget before making a recommendation.` });
    renderAll();
    const generation = await generateRecommendation("daily_background_sweep");
    if (generation.source === "aborted") return;
    sendRecommendationSourceNotice(generation);
    if (generation.source !== "llm") {
      renderAll();
      return;
    }
    if (!await sendStagedChat({ text: `I have a subscription recommendation for ${state.scenario.targetServiceName} ready for you to review.` }, sequenceVersion)) return;
    if (!await sendStagedChat({ kind: "recommendation" }, sequenceVersion)) return;
    if (await sendStagedChat({ kind: "choices" }, sequenceVersion)) {
      transact(draft => {
        draft.review.progressStage = "family_discussion";
      });
      renderAll();
    }
  }

  async function reviewSubscriptionRequest() {
    activateDemoScenario(global.StreamingGuardScenarioConfig.demoScenarios.subscriptionRequest, "household_request");
    prepareScenarioReview();
    const sequenceVersion = beginChatSequence();
    transact(draft => {
      draft.review.status = draft.scenario.expectedRoute;
      draft.scenario.requestedByMemberId = global.StreamingGuardScenarioConfig.subscriptionRequestMemberId;
    });

    const requestingMember = state.members.find(member =>
      member.id === state.scenario.requestedByMemberId
    );
    sendChat({
      role: "user",
      text: `${requestingMember?.firstName || "A family member"} wants to watch ${state.scenario.titleName}. Should we subscribe to ${state.scenario.targetServiceName}?`
    });
    renderAll();
    const existingService = state.subscriptions.find(subscription =>
      subscription.serviceId === state.scenario.secondaryServiceId && subscription.status === "active"
    );
    if (!await sendStagedChat({
      text: `I’ll compare a new ${state.scenario.targetServiceName} subscription with the household’s current ${existingService?.service || "streaming"} coverage, the title’s confirmed availability dates, viewing priorities, and budget.`
    }, sequenceVersion)) return;
    const generation = await generateRecommendation("new_subscription_request");
    if (generation.source === "aborted") return;
    sendRecommendationSourceNotice(generation);
    if (generation.source !== "llm") {
      renderAll();
      return;
    }
    if (!await sendStagedChat({ text: `I have a subscription recommendation for ${state.scenario.titleName} ready for you to review.` }, sequenceVersion)) return;
    if (!await sendStagedChat({ kind: "recommendation" }, sequenceVersion)) return;
    if (await sendStagedChat({ kind: "choices" }, sequenceVersion)) {
      transact(draft => {
        draft.review.progressStage = "family_discussion";
      });
      renderAll();
    }
  }

  function startManualScenario() {
    activateDemoScenario(
      global.StreamingGuardScenarioConfig.demoScenarios.backgroundSweep,
      "manual_scenario"
    );
    resetApiActivity();
    composerIntent = "general";
    composerMode.textContent = "Manual scenario";
    messageInput.placeholder = "Describe a streaming-subscription situation or request…";
    transact(draft => {
      draft.review.started = false;
      draft.review.manualScenario = true;
      draft.review.progressStage = "not_started";
      draft.review.status = "manual_scenario";
      draft.review.discussionStatus = "open";
      draft.review.lastTurnType = null;
      draft.review.recommendationEffect = "unchanged";
      draft.review.nextExpectedInput = "additional_context";
      draft.review.safetyDisposition = "normal";
      draft.review.reasonCodes = [];
      draft.review.pendingContextUpdates = [];
      draft.review.generatedRecommendation = null;
      draft.messages = [];
    });
    transitionWorkflow(workflowEngine.events.INPUT_RECEIVED, "Manual chat mode is ready for adult input.");
    renderAll();
    messageInput.focus();
  }

  function handleAgree() {
    const recommendation = currentRecommendation();
    if (!recommendation || recommendation.status === "Adult judgment required") {
      showToast("There is no actionable recommendation to agree with yet");
      return;
    }
    const language = engine.actionLanguage[recommendation.actionType] || engine.actionLanguage.keep;
    const requiresExternalAction = ["cancel", "pause", "subscribe"].includes(recommendation.actionType);
    transact(draft => {
      draft.review.progressStage = requiresExternalAction ? "external_action" : "final_agreement";
      draft.review.adultDecision = "Agreed with final recommendation";
      draft.review.status = requiresExternalAction ? "waiting_for_external_action" : "completed";
      draft.review.discussionStatus = requiresExternalAction ? "external_action_pending" : "resolved";
      draft.review.resolution = "recommendation_accepted";
      draft.review.resolutionAction = recommendation.actionType;
      draft.review.resolvedAt = requiresExternalAction ? null : draft.systemDate;
      draft.review.lastTurnType = "recommendation_decision";
      draft.review.recommendationEffect = "close";
      draft.review.nextExpectedInput = requiresExternalAction ? "external_action_confirmation" : "none";
      draft.review.safetyDisposition = "normal";
      draft.review.reasonCodes = ["recommendation_explicitly_accepted"];
      draft.review.pendingContextUpdates = [];
    });
    transitionWorkflow(
      requiresExternalAction
        ? workflowEngine.events.ADULT_AGREED
        : workflowEngine.events.COMPLETE_WITHOUT_ACTION,
      requiresExternalAction
        ? "Adult agreement recorded; external account action remains pending."
        : "Adult agreement recorded; no external action is required."
    );
    sendChat({ role: "user", text: "I agree with the recommendation." });
    if (requiresExternalAction) {
      sendChat({
        text: `Thanks. Please complete the ${language.noun} through your ${state.scenario.targetServiceName} account before ${engine.displayDate(targetSubscription().nextRenewal, state.household.locale)}. I have not changed the subscription record, because agreeing is separate from completing the external action.`
      });
      sendChat({ kind: "confirmation" });
    } else {
      sendChat({ text: `Thanks. I recorded your agreement to ${recommendation.actionType} for now. No external account action or subscription-record change is required.` });
    }
    renderAll();
  }

  function setComposer(intent) {
    composerIntent = intent;
    composerMode.textContent = "";
    if (intent === "disagree") {
      composerMode.textContent = "Disagree or add information";
      messageInput.placeholder = "Tell me what I should reconsider or add…";
    } else if (intent === "question") {
      composerMode.textContent = "Ask about this recommendation";
      messageInput.placeholder = "What would you like to know?";
    } else if (intent === "context-update") {
      composerMode.innerHTML = `<span>Update stored household context</span><button class="composer-run-check" type="button" data-action="run-check">Run daily background sweep without changes</button>`;
      messageInput.placeholder = "Tell me which person, title, subscription, budget, or family rule changed…";
    }
    messageInput.focus();
  }

  function setExpectedInputComposer(expectedInput) {
    const states = {
      adult_decision: ["Decision needed", "Agree, disagree, ask a question, or add information…"],
      viewing_confirmation: ["Viewing confirmation needed", "Please confirm whether the family member finished the title…"],
      completion_date: ["Completion date needed", "Please provide the date the title was completed…"],
      family_rule_scope: ["Rule scope needed", "Should this family-rule change be one-time or permanent?"],
      title_rating_exception: ["Child-safety approval needed", "Please approve or decline the rating exception for the named title and child viewer…"],
      subscription_plan: ["Subscription plan needed", "Which exact service plan did you add or change to?"],
      budget_amount: ["Budget decision needed", "Keep the current budget, match the new monthly spending, or enter a higher amount…"],
      external_action_confirmation: ["External action confirmation needed", "Please confirm only after you complete the external action…"],
      additional_context: ["Additional context needed", "Please provide the missing or corrected information…"]
    };
    const [label = "", placeholder = "Ask a question or share more information…"] = states[expectedInput] || [];
    composerMode.textContent = label;
    messageInput.placeholder = placeholder;
  }

  async function replaceRecommendationMessages(reason = "household_context_updated") {
    transact(draft => {
      draft.messages = draft.messages.filter(message => !["recommendation", "choices"].includes(message.kind));
      draft.review.generatedRecommendation = null;
      draft.review.recommendationSource = "pending_llm";
      draft.review.recommendationModel = null;
      draft.review.recommendationResponseId = null;
      draft.review.recommendationUsage = null;
      draft.review.recommendationError = null;
      draft.review.discussionStatus = "open";
      draft.review.resolution = null;
      draft.review.resolutionAction = null;
      draft.review.resolvedAt = null;
      draft.review.recommendationEffect = "revise";
      draft.review.nextExpectedInput = "none";
      draft.review.pendingContextUpdates = [];
    });
    renderAll();
    const generation = await generateRecommendation(reason);
    if (generation.source === "aborted") return;
    sendRecommendationSourceNotice(generation);
    if (generation.source !== "llm") return;
    sendChat({ kind: "recommendation" });
    sendChat({ kind: "choices" });
  }

  function mentionedViewer(normalizedText) {
    return state.scenario.intendedViewerIds
      .map(memberId => state.members.find(member => member.id === memberId))
      .find(member => member && normalizedText.includes(member.firstName.toLowerCase()));
  }

  async function handleAdultText(text) {
    const normalized = text.toLowerCase();
    if (global.StreamingGuardMemory.containsSensitiveAccountInformation(text)) {
      displayAdultMessageWithoutRetention(text, "sensitive_information_warning");
      recordSafetyDisposition("sensitive_information_warning", "sensitive_information_detected");
      sendChat({
        text: "For your security, I removed that message from saved chat history. Please do not share passwords, payment details, bank information, authentication codes, API keys, or other credentials here. Complete sensitive account activity only through the streaming service’s official interface."
      });
      composerIntent = "general";
      composerMode.textContent = "";
      messageInput.placeholder = "Ask a question or share more information…";
      renderAll();
      return;
    }
    if (!isLikelyStreamingScopeMessage(text)) {
      displayAdultMessageWithoutRetention(text, "out_of_scope");
      recordSafetyDisposition("out_of_scope", "request_outside_streaming_scope");
      sendChat({
        text: "I can help only with household streaming-subscription planning, management, viewing access, and spending. Please ask a question or share an update related to those topics."
      });
      composerIntent = "general";
      composerMode.textContent = "";
      messageInput.placeholder = "Ask a question or share more information…";
      renderAll();
      return;
    }
    const providerSettings = openAI.readSettings();
    if (openAI.isModelConfigured(providerSettings.model, providerSettings)) {
      await askOpenAI(text, composerIntent);
      composerIntent = "general";
      setExpectedInputComposer(state.review.nextExpectedInput);
      return;
    }
    persistAdultMessage(text);
    const viewer = mentionedViewer(normalized);
    const language = scenarioLanguage();
    const budgetMatch = composerIntent === "context-update"
      ? normalized.match(/(?:monthly\s+)?budget(?:\s+(?:is|to|should be|changed to))?\s*\$?([0-9]+(?:\.[0-9]{1,2})?)/)
      : null;

    if (viewer && /(not finished|hasn't finished|has not finished|still watching|didn't finish)/.test(normalized)) {
      tools.update_household_context({
        updateType: "viewing_confirmation",
        payload: { memberId: viewer.id, titleId: state.scenario.titleId, status: "watching" },
        source: "adult_chat"
      });
      transact(draft => {
        draft.review.status = "adult_judgment_required";
        draft.review.adultDecision = "Added viewing information";
        draft.review.recommendationVersion += 1;
      });
      updateTraceForLocalMemoryChange({
        updateType: "viewing_confirmation",
        targetId: viewer.id,
        relatedId: state.scenario.titleId,
        field: "status",
        value: "watching",
        effectiveDate: ""
      }, "The explicit adult viewing update was validated and saved locally.");
      sendChat({ text: `Thanks for clarifying that ${viewer.firstName} is still watching ${state.scenario.titleName}. I’ve updated the household details. The selected agent model will now reconsider the subscription recommendation using that active-viewing fact.` });
      await replaceRecommendationMessages("viewing_still_in_progress");
    } else if (viewer && /(finished today|completed today|done today)/.test(normalized)) {
      tools.update_household_context({
        updateType: "viewing_confirmation",
        payload: { memberId: viewer.id, titleId: state.scenario.titleId, status: "completed", completedOn: state.systemDate },
        source: "adult_chat"
      });
      transact(draft => {
        draft.review.status = "action_recommended";
        draft.review.adultDecision = "Added viewing information";
        draft.review.recommendationVersion += 1;
      });
      updateTraceForLocalMemoryChange({
        updateType: "viewing_confirmation",
        targetId: viewer.id,
        relatedId: state.scenario.titleId,
        field: "status",
        value: "completed",
        effectiveDate: state.systemDate
      }, "The explicit adult viewing update was validated and saved locally.");
      sendChat({ text: `Thanks for confirming that ${viewer.firstName} finished ${state.scenario.titleName} today. I’ve saved that update and recalculated the recommendation using the completed viewing information.` });
      await replaceRecommendationMessages("viewing_completion_confirmed");
    } else if (viewer && /(finished|completed|done)/.test(normalized)) {
      sendChat({ text: `Thanks. Please tell me the date ${viewer.firstName} finished ${state.scenario.titleName} so I can save the completion without guessing.` });
      sendChat({ kind: "choices" });
    } else if (budgetMatch) {
      const updatedBudget = Number(budgetMatch[1]);
      tools.update_household_context({
        updateType: "family_rule",
        payload: { rule: "monthlyBudgetCap", value: updatedBudget },
        source: "adult_chat"
      });
      refreshState();
      updateTraceForLocalMemoryChange({
        updateType: "family_rule",
        targetId: state.household.id || state.household.householdId || "household",
        relatedId: "",
        field: "monthlyBudgetCap",
        value: String(updatedBudget),
        effectiveDate: state.systemDate
      }, "The explicit adult budget update was validated and saved locally.");
      sendChat({ text: `Thanks. I updated the household’s monthly streaming budget to ${engine.formatMoney(state, updatedBudget)} and saved today as the latest family-rules confirmation date.` });
      if (state.review.started) {
        transact(draft => {
          draft.review.recommendationVersion += 1;
          draft.review.adultDecision = "Updated household budget";
        });
        await replaceRecommendationMessages("household_budget_updated");
      }
    } else if (/(why|reason|evidence|how did you)/.test(normalized)) {
      const recommendation = engine.buildRecommendation(state);
      sendChat({ text: `The recommendation is based on the confirmed viewing, current priority-title coverage, ${state.scenario.targetServiceName}’s ${engine.formatMoney(state, recommendation.finances.targetMonthlyCost)} monthly price, and its ${engine.displayDate(targetSubscription().nextRenewal, state.household.locale)} renewal. ${language.gerund} the service would change monthly spending from ${engine.formatMoney(state, recommendation.finances.beforeActionMonthly)} to ${engine.formatMoney(state, recommendation.finances.afterActionMonthly)} without blocking a current priority title.` });
      sendChat({ kind: "choices" });
    } else if (/(next season|next release|when.*return)/.test(normalized)) {
      const waitDays = state.scenario.nextReleaseDate ? math.daysBetween(state.systemDate, state.scenario.nextReleaseDate) : null;
      sendChat({ text: state.scenario.nextReleaseDate
        ? `${state.scenario.titleName} ${state.scenario.nextReleaseLabel} is scheduled to arrive on ${state.scenario.targetServiceName} on ${engine.displayDate(state.scenario.nextReleaseDate, state.household.locale)}. That is ${waitDays} days after this review, so the family could reconsider the service closer to that date.`
        : `No next release is currently recorded for ${state.scenario.titleName}.` });
      sendChat({ kind: "choices" });
    } else if (/(budget|afford|spend)/.test(normalized)) {
      const finances = engine.calculateScenarioFinancials(state);
      sendChat({ text: `The household currently spends ${engine.formatMoney(state, finances.beforeActionMonthly)} of its ${engine.formatMoney(state, finances.beforeBudget.monthlyBudgetCap)} monthly streaming budget, leaving ${engine.formatMoney(state, finances.beforeBudget.remaining)}. ${language.gerund} ${state.scenario.targetServiceName} would change spending to ${engine.formatMoney(state, finances.afterActionMonthly)} and leave ${engine.formatMoney(state, finances.afterBudget.remaining)} before tax.` });
      sendChat({ kind: "choices" });
    } else {
      sendChat({
        text: composerIntent === "disagree"
          ? "Thanks for sharing that. I need a specific viewing, watchlist, subscription, budget, or family-rule fact before I can change the recommendation. What fact should I update?"
          : composerIntent === "context-update"
            ? "I’m ready to update the stored household context. Please identify the family member, title, subscription, budget amount, or family rule that changed, and provide the new information."
          : "I can answer questions about the viewing evidence, renewal date, budget impact, next release, or why I made this recommendation. What would you like to explore?"
      });
      sendChat({ kind: "choices" });
    }

    composerIntent = "general";
    composerMode.textContent = "";
    messageInput.placeholder = "Ask a question or share more information…";
    if (!responseController) renderAll();
  }

  function confirmExternalAction() {
    const recommendation = currentRecommendation();
    const selectedAction = recommendation?.actionType || state.scenario.requestedAction;
    const language = engine.actionLanguage[selectedAction] || engine.actionLanguage.keep;
    const completionStatus = global.StreamingGuardScenarioConfig.actionCompletionStatus[selectedAction] || "unchanged";
    const beforeSubscriptionBaseline = subscriptionFinancialBaseline();
    tools.update_household_context({
      updateType: "external_action_confirmation",
      payload: {
        serviceId: state.scenario.targetServiceId,
        newStatus: completionStatus,
        confirmed: true
      },
      source: "adult_chat"
    });
    refreshState();
    updateTraceForLocalMemoryChange({
      updateType: "external_action_confirmation",
      targetId: state.scenario.targetServiceId,
      relatedId: "",
      field: "subscriptionStatus",
      value: completionStatus,
      effectiveDate: state.systemDate
    }, "The explicit adult external-action confirmation was validated and saved locally.");
    transact(draft => {
      draft.review.progressStage = "completion_confirmed";
      draft.review.discussionStatus = "resolved";
      draft.review.resolution = "external_action_completed";
      draft.review.resolutionAction = selectedAction;
      draft.review.resolvedAt = draft.systemDate;
      draft.review.lastTurnType = "new_information";
      draft.review.recommendationEffect = "close";
      draft.review.nextExpectedInput = "none";
      draft.review.safetyDisposition = "normal";
      draft.review.reasonCodes = ["external_action_confirmed"];
      draft.review.pendingContextUpdates = [];
    });
    transitionWorkflow(
      workflowEngine.events.EXTERNAL_ACTION_CONFIRMED,
      "The adult confirmed the external action and the durable household record was updated."
    );
    sendChat({ role: "user", text: `I completed the ${state.scenario.targetServiceName} ${language.noun}.` });
    const budgetFollowUpRequired = sendSubscriptionFinancialConfirmation(
      beforeSubscriptionBaseline,
      [{
        updateType: "external_action_confirmation",
        targetId: state.scenario.targetServiceId
      }],
      `Thanks for confirming. I updated the household record to show ${state.scenario.targetServiceName} as ${language.past}.`
    );
    if (budgetFollowUpRequired) setExpectedInputComposer("budget_amount");
    renderAll();
    showToast("Household details updated after adult confirmation");
  }

  function revisitRecommendation() {
    const recommendation = currentRecommendation();
    if (!recommendation || state.review.externalActionConfirmed) return;
    transact(draft => {
      draft.review.progressStage = "family_discussion";
      draft.review.discussionStatus = "open";
      draft.review.resolution = null;
      draft.review.resolutionAction = null;
      draft.review.resolvedAt = null;
      draft.review.status = recommendation.route;
      draft.review.adultDecision = "Reopened recommendation discussion";
      draft.review.lastTurnType = "recommendation_decision";
      draft.review.recommendationEffect = "reopen";
      draft.review.nextExpectedInput = "adult_decision";
      draft.review.safetyDisposition = "normal";
      draft.review.reasonCodes = ["revisit_requested"];
      draft.review.pendingContextUpdates = [];
    });
    transitionWorkflow(workflowEngine.events.REVISIT_REQUESTED, "The adult reopened the recommendation discussion.");
    sendChat({ role: "user", text: "I want to revisit this recommendation." });
    sendChat({ text: `Of course. We can revisit the ${state.scenario.targetServiceName} recommendation. You can ask a question, disagree, or add more information.` });
    sendChat({ kind: "choices" });
    renderAll();
  }

  document.addEventListener("click", event => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "run-background-sweep") runBackgroundSweep();
    if (action === "review-subscription-request") reviewSubscriptionRequest();
    if (action === "start-manual-scenario") startManualScenario();
    if (action === "run-check") {
      const backgroundScenarioId = global.StreamingGuardScenarioConfig.demoScenarios.backgroundSweep;
      runBackgroundSweep({ resetScenario: state.scenario.id !== backgroundScenarioId });
    }
    if (action === "agree") handleAgree();
    if (action === "disagree") setComposer("disagree");
    if (action === "question") setComposer("question");
    if (action === "confirm-action") confirmExternalAction();
    if (action === "revisit-recommendation") revisitRecommendation();
    if (action === "not-yet") {
      const today = math.localDateIso(new Date());
      transact(draft => {
        draft.review.dailyReminderEnabled = true;
        draft.review.lastReminderOn = today;
      });
      const selectedAction = currentRecommendation()?.actionType || state.scenario.requestedAction;
      const reminderAction = selectedAction === "cancel"
        ? `unsubscribe from ${state.scenario.targetServiceName}`
        : `complete the ${scenarioLanguage().noun} for ${state.scenario.targetServiceName}`;
      sendChat({ text: `No problem. I’ll leave ${state.scenario.targetServiceName} unchanged and remind you once a day in this chat to ${reminderAction} until you confirm it is complete.` });
      renderAll();
      showToast("Daily reminder enabled");
    }
  });

  document.getElementById("composerForm").addEventListener("submit", async event => {
    event.preventDefault();
    const text = messageInput.value.trim();
    if (!text) return;
    messageInput.value = "";
    await handleAdultText(text);
  });

  messageInput.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      document.getElementById("composerForm").requestSubmit();
    }
  });

  function showProductView(view, { focusTab = false } = {}) {
    const showingContext = view === "context";
    const showingSpending = view === "spending";
    const showingChat = view === "chat";
    const showingEvaluations = view === "evaluations";
    memoryView.hidden = !showingContext;
    spendingView.hidden = !showingSpending;
    appShell.hidden = !showingChat;
    evaluationsView.hidden = !showingEvaluations;
    contextTab.classList.toggle("active", showingContext);
    spendingTab.classList.toggle("active", showingSpending);
    chatTab.classList.toggle("active", showingChat);
    evaluationsTab.classList.toggle("active", showingEvaluations);
    contextTab.setAttribute("aria-selected", String(showingContext));
    spendingTab.setAttribute("aria-selected", String(showingSpending));
    chatTab.setAttribute("aria-selected", String(showingChat));
    evaluationsTab.setAttribute("aria-selected", String(showingEvaluations));
    contextTab.tabIndex = showingContext ? 0 : -1;
    spendingTab.tabIndex = showingSpending ? 0 : -1;
    chatTab.tabIndex = showingChat ? 0 : -1;
    evaluationsTab.tabIndex = showingEvaluations ? 0 : -1;
    if (!showingEvaluations) {
      evaluationInstructionsOpen = false;
      fullScreenEvaluationInstruction = null;
    }
    if (!showingChat) setChatFullscreen(false);
    if (focusTab) ({ context: contextTab, spending: spendingTab, chat: chatTab, evaluations: evaluationsTab }[view] || contextTab).focus();
  }

  function setChatFullscreen(enabled) {
    document.body.classList.toggle("chat-fullscreen", enabled);
    chatFullscreenToggle.setAttribute("aria-pressed", String(enabled));
    chatFullscreenToggle.setAttribute("aria-label", enabled ? "Exit full-screen chat" : "Show chat full screen");
    chatFullscreenToggle.querySelector("span").textContent = enabled ? "↙" : "↗";
    chatFullscreenToggle.querySelector("strong").textContent = enabled ? "Exit full screen" : "Full screen";
  }

  function openHouseholdContext({ focusTab = false } = {}) {
    refreshState();
    document.getElementById("memoryContent").innerHTML = ui.memoryMarkup(state);
    showProductView("context", { focusTab });
  }

  contextTab.addEventListener("click", () => openHouseholdContext());
  spendingTab.addEventListener("click", () => showProductView("spending"));
  chatTab.addEventListener("click", () => showProductView("chat"));
  evaluationsTab.addEventListener("click", () => {
    renderEvaluations();
    showProductView("evaluations");
  });
  const productTabs = [chatTab, contextTab, spendingTab, evaluationsTab];
  productTabs.forEach((tab, index) => {
    tab.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? productTabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + productTabs.length) % productTabs.length;
      const nextView = ["chat", "context", "spending", "evaluations"][nextIndex];
      if (nextView === "context") openHouseholdContext({ focusTab: true });
      else {
        if (nextView === "evaluations") renderEvaluations();
        showProductView(nextView, { focusTab: true });
      }
    });
  });
  document.getElementById("askAboutSpending").addEventListener("click", () => {
    showProductView("chat");
    global.setTimeout(() => setComposer("question"), 0);
  });
  document.getElementById("updateHouseholdContext").addEventListener("click", () => {
    showProductView("chat");
    global.setTimeout(() => setComposer("context-update"), 0);
  });
  exportHouseholdDataButton.addEventListener("click", exportHouseholdData);
  importHouseholdDataButton.addEventListener("click", () => importHouseholdDataInput.click());
  importHouseholdDataInput.addEventListener("change", event => {
    const [file] = event.target.files || [];
    importHouseholdData(file)
      .catch(error => showToast(error.message))
      .finally(() => {
        event.target.value = "";
      });
  });
  document.getElementById("openEvaluationInstructions").addEventListener("click", () => {
    evaluationInstructionsOpen = true;
    fullScreenEvaluationInstruction = null;
    renderEvaluations();
    document.querySelector(".eval-instructions-drawer .eval-drawer-close")?.focus();
  });

  document.getElementById("evaluationsContent").addEventListener("change", event => {
    if (event.target.id !== "promptReviewConfirmation") return;
    const approveButton = document.querySelector('[data-eval-action="approve-prompt"]');
    if (approveButton) approveButton.disabled = !event.target.checked;
  });

  document.getElementById("evaluationsContent").addEventListener("click", async event => {
    const button = event.target.closest("[data-eval-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.evalAction;
    try {
      if (action === "select-case") {
        selectedEvaluationId = button.dataset.evalId;
        renderEvaluations();
        return;
      }
      if (action === "open-instructions") {
        evaluationInstructionsOpen = true;
        renderEvaluations();
        document.querySelector(".eval-instructions-drawer .eval-drawer-close")?.focus();
        return;
      }
      if (action === "close-instructions") {
        fullScreenEvaluationInstruction = null;
        evaluationInstructionsOpen = false;
        renderEvaluations();
        document.getElementById("openEvaluationInstructions")?.focus();
        return;
      }
      if (action === "open-instruction-fullscreen") {
        fullScreenEvaluationInstruction = button.dataset.instructionKey;
        renderEvaluations();
        document.querySelector(".eval-instruction-fullscreen-close")?.focus();
        return;
      }
      if (action === "close-instruction-fullscreen") {
        const instructionKey = button.dataset.instructionKey;
        fullScreenEvaluationInstruction = null;
        renderEvaluations();
        document.querySelector(`[data-eval-action="open-instruction-fullscreen"][data-instruction-key="${instructionKey}"]`)?.focus();
        return;
      }
      if (action === "approve-prompt") {
        const confirmation = document.getElementById("promptReviewConfirmation");
        if (!confirmation?.checked) {
          showToast("Please confirm that you reviewed the instructions and ten cases");
          return;
        }
        evaluations.approvePromptReview();
        renderEvaluations();
        return;
      }
      if (action === "revoke-approval") {
        evaluations.revokePromptReview();
        renderEvaluations();
        return;
      }
      if (action === "clear-results") {
        evaluations.clearResults();
        renderEvaluations();
        return;
      }
      if (action === "stop-tests") {
        evaluations.stopTests();
        renderEvaluations();
        showToast("Stopping evaluation tests…");
        return;
      }
      if (action === "copy-all-results") {
        await copyText(evaluations.exportResultsText());
        showToast("Copied all evaluation outputs");
        return;
      }
      if (action === "rejudge-results") {
        await evaluations.rejudgeSavedResults(renderEvaluations);
        showToast("Rejudged saved outputs with independent API calls");
        return;
      }
      if (action === "run-case") {
        await evaluations.runCase(button.dataset.evalId, renderEvaluations);
        return;
      }
      if (action === "run-all") {
        await evaluations.runAll(renderEvaluations);
        return;
      }
      if (action === "run-defaults-and-publish") {
        await runDefaultEvaluationsAndPublish();
      }
    } catch (error) {
      showToast(error.message);
      renderEvaluations();
    }
  });

  document.querySelector(".site-footer").addEventListener("click", event => {
    const link = event.target.closest("[data-information-topic]");
    if (!link) return;
    event.preventDefault();
    openInformationDialog(link.dataset.informationTopic);
  });
  document.getElementById("closeInformationDialog").addEventListener("click", () => informationDialog.close());
  document.getElementById("dismissInformationDialog").addEventListener("click", () => informationDialog.close());
  informationDialog.addEventListener("click", event => {
    if (event.target === informationDialog) informationDialog.close();
  });

  function openAISettingsDialog() {
    const settings = openAI.readSettings();
    apiKeyInput.value = settings.openaiApiKey;
    anthropicApiKeyInput.value = settings.anthropicApiKey;
    geminiApiKeyInput.value = settings.geminiApiKey;
    modelInput.value = settings.model;
    judgeModelInput.value = settings.judgeModel;
    if (!aiSettingsDialog.open) aiSettingsDialog.showModal();
  }

  document.getElementById("openAISettings").addEventListener("click", openAISettingsDialog);
  document.getElementById("closeAISettings").addEventListener("click", () => aiSettingsDialog.close());
  document.getElementById("disconnectOpenAI").addEventListener("click", () => {
    openAI.clearSettings();
    apiKeyInput.value = "";
    anthropicApiKeyInput.value = "";
    geminiApiKeyInput.value = "";
    aiSettingsDialog.close();
    renderAIStatus();
    renderEvaluations();
    showToast("All AI providers were disconnected and their saved keys were removed");
  });
  aiSettingsForm.addEventListener("submit", event => {
    event.preventDefault();
    try {
      openAI.saveSettings({
        openaiApiKey: apiKeyInput.value,
        anthropicApiKey: anthropicApiKeyInput.value,
        geminiApiKey: geminiApiKeyInput.value,
        model: modelInput.value,
        judgeModel: judgeModelInput.value
      });
      aiSettingsDialog.close();
      renderAIStatus();
      renderEvaluations();
      showToast("AI model connections saved");
    } catch (error) {
      showToast(error.message);
    }
  });

  function resetDemo({ removeOpenAIConnection = false } = {}) {
    cancelChatSequence();
    resetApiActivity();
    responseController?.abort();
    responseController = null;
    aiChatDebugLog = [];
    sessionOnlyChatMessages = [];
    refreshAIChatLogButton();
    memory.reset();
    evaluations.reset();
    if (removeOpenAIConnection) openAI.clearSettings();
    rebaseScenarioDates(math.localDateIso(new Date()));
    setChatBusy(false);
    renderAll();
    showProductView("chat");
    global.requestAnimationFrame(() => {
      messagesElement.scrollTop = 0;
    });
  }

  function restartChat() {
    cancelChatSequence();
    resetApiActivity();
    responseController?.abort();
    responseController = null;
    aiChatDebugLog = [];
    sessionOnlyChatMessages = [];
    refreshAIChatLogButton();
    memory.reset({
      scenarioId: global.StreamingGuardScenarioConfig.demoScenarios.backgroundSweep
    });
    rebaseScenarioDates(math.localDateIso(new Date()));
    composerIntent = "general";
    composerMode.textContent = "";
    messageInput.placeholder = "Ask a question or share more information…";
    setChatBusy(false);
    renderAll();
    showProductView("chat");
    global.requestAnimationFrame(() => {
      messagesElement.scrollTop = 0;
    });
    showToast("Chat restarted — choose a demo scenario");
  }

  function chatImageFilename() {
    const now = new Date();
    const date = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0")
    ].join("-");
    const time = [
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0")
    ].join("");
    return `streaming-guard-chat-${date}-${time}.png`;
  }

  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error("The browser could not create the chat image."));
      }, "image/png");
    });
  }

  async function downloadFullChatImage() {
    if (typeof global.html2canvas !== "function") {
      showToast("Full-chat image export is unavailable in this browser");
      return;
    }

    const chatElement = document.querySelector(".chat");
    const exportSurface = document.createElement("section");
    const appBar = chatElement.querySelector(".whatsapp-appbar").cloneNode(true);
    const chatHeader = chatElement.querySelector(".chat-header").cloneNode(true);
    const completeMessages = messagesElement.cloneNode(true);
    const exportWidth = Math.min(1400, Math.max(900, Math.round(chatElement.getBoundingClientRect().width)));

    exportSurface.className = "chat-export-surface";
    exportSurface.style.width = `${exportWidth}px`;
    exportSurface.setAttribute("aria-hidden", "true");
    appBar.querySelector(".whatsapp-appbar-actions")?.remove();
    const exportAvatar = chatHeader.querySelector(".agent-avatar");
    exportAvatar?.querySelector("img")?.remove();
    if (exportAvatar) exportAvatar.textContent = "SG";
    completeMessages.querySelectorAll("img").forEach(image => image.remove());
    completeMessages.removeAttribute("id");
    exportSurface.append(appBar, chatHeader, completeMessages);
    document.body.append(exportSurface);

    downloadFullChatButton.disabled = true;
    downloadFullChatButton.setAttribute("aria-busy", "true");
    downloadFullChatButton.querySelector("strong").textContent = "Saving…";

    try {
      await document.fonts?.ready;
      const canvas = await global.html2canvas(exportSurface, {
        backgroundColor: "#efeae2",
        logging: false,
        scale: Math.min(2, Math.max(1, global.devicePixelRatio || 1)),
        useCORS: true,
        width: exportSurface.scrollWidth,
        height: exportSurface.scrollHeight,
        windowWidth: exportSurface.scrollWidth,
        windowHeight: exportSurface.scrollHeight
      });
      const blob = await canvasBlob(canvas);
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = chatImageFilename();
      document.body.append(link);
      link.click();
      link.remove();
      global.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      showToast("Complete chat saved as one PNG image");
    } catch (error) {
      showToast("The complete chat could not be saved. Please refresh and try again.");
    } finally {
      exportSurface.remove();
      downloadFullChatButton.disabled = false;
      downloadFullChatButton.removeAttribute("aria-busy");
      downloadFullChatButton.querySelector("strong").textContent = "Save full chat";
    }
  }

  document.getElementById("restartDemo").addEventListener("click", () => {
    if (!global.confirm("Restart the demo from the beginning? Your saved AI provider connections will be kept.")) return;
    resetDemo();
  });

  document.getElementById("resetPrototype").addEventListener("click", () => {
    if (!global.confirm("Delete the demo progress, household changes, and all saved AI provider connections?")) return;
    resetDemo({ removeOpenAIConnection: true });
  });

  restartChatButton.addEventListener("click", restartChat);
  downloadFullChatButton.addEventListener("click", downloadFullChatImage);
  copyAIChatLogButton.addEventListener("click", () => {
    copyAIChatDebugLog().catch(error => showToast(error.message));
  });

  document.getElementById("detailsToggle").addEventListener("click", event => {
    const shell = document.getElementById("appShell");
    const isOpen = shell.classList.toggle("details-open");
    event.currentTarget.setAttribute("aria-expanded", String(isOpen));
    event.currentTarget.textContent = isOpen ? "Hide details" : "Show details";
  });

  chatFullscreenToggle.addEventListener("click", () => {
    setChatFullscreen(!document.body.classList.contains("chat-fullscreen"));
  });

  document.addEventListener("keydown", event => {
    if (
      localOperatorMode &&
      (event.metaKey || event.ctrlKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === "e"
    ) {
      event.preventDefault();
      renderEvaluations();
      showProductView("evaluations");
      runDefaultEvaluationsAndPublish().catch(error => {
        showToast(error.message);
        renderEvaluations();
      });
      return;
    }
    if (event.key !== "Escape") return;
    if (fullScreenEvaluationInstruction) {
      const instructionKey = fullScreenEvaluationInstruction;
      fullScreenEvaluationInstruction = null;
      renderEvaluations();
      document.querySelector(`[data-eval-action="open-instruction-fullscreen"][data-instruction-key="${instructionKey}"]`)?.focus();
      return;
    }
    if (evaluationInstructionsOpen) {
      fullScreenEvaluationInstruction = null;
      evaluationInstructionsOpen = false;
      renderEvaluations();
      document.getElementById("openEvaluationInstructions")?.focus();
      return;
    }
    if (document.body.classList.contains("chat-fullscreen")) {
      setChatFullscreen(false);
      chatFullscreenToggle.focus();
    }
  });

  global.StreamingGuardApp = Object.freeze({
    tools,
    getState: () => memory.getState(),
    render: renderAll
  });

  function openEvaluationRouteFromHash() {
    if (global.location.hash !== "#evaluations" && global.location.hash !== "#eval-publish") return;
    renderEvaluations();
    showProductView("evaluations");
    if (global.location.hash !== "#eval-publish") return;
    refreshLocalOperatorAvailability().then(available => {
      if (!available || global.location.hash !== "#eval-publish") return;
      runDefaultEvaluationsAndPublish().catch(error => {
        showToast(error.message);
        renderEvaluations();
      });
    });
  }

  global.addEventListener("hashchange", openEvaluationRouteFromHash);

  function deliverDailyReminderIfDue() {
    refreshState();
    if (!state.review.dailyReminderEnabled || state.review.externalActionConfirmed) return;
    const today = math.localDateIso(new Date());
    if (state.review.lastReminderOn === today) return;
    const selectedAction = currentRecommendation()?.actionType || state.scenario.requestedAction;
    const reminderAction = selectedAction === "cancel"
      ? `unsubscribe from ${state.scenario.targetServiceName}`
      : `complete the ${scenarioLanguage().noun} for ${state.scenario.targetServiceName}`;
    sendChat({ text: `Daily reminder: Please ${reminderAction}. I’ll keep the subscription record unchanged until you confirm the external action is complete.` });
    transact(draft => {
      draft.review.lastReminderOn = today;
    });
  }

  deliverDailyReminderIfDue();
  renderAll();
  if (global.location.hash === "#evaluations" || global.location.hash === "#eval-publish") {
    openEvaluationRouteFromHash();
  } else {
    showProductView("chat");
    refreshLocalOperatorAvailability();
  }
})(window);
