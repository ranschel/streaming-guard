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

  if (![context, math, engine, ui, memoryFactory, toolFactory, openAI, evaluationFactory].every(Boolean)) {
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
  const tools = toolFactory.createAgentTools({ memory, knowledge: context.knowledge });
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
  let responseController = null;
  let chatSequenceVersion = 0;
  let apiActivityTimer = null;
  let liveApiActivity = { status: "idle" };
  let selectedEvaluationId = "EVAL-01";
  let evaluationInstructionsOpen = false;
  let fullScreenEvaluationInstruction = null;
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
        <p>Adult messages are safety-classified before they become persistent chat history. Messages identified as sensitive or outside Streaming Guard’s scope are replaced with neutral redaction notices, and an unclassified message is discarded if the selected model cannot respond safely. Obvious credentials and payment details are blocked locally before any model request. Previously saved messages containing recognizable credentials are redacted when local state is loaded.</p>
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

  function transact(mutator) {
    memory.transact(mutator);
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
    if (!activityElement) return;
    activityElement.innerHTML = ui.llmActivityMarkup(liveApiActivity);
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

  function beginApiActivity({ requestType, settings, inputSummary }) {
    stopApiActivityTimer();
    const modelInfo = openAI.modelInfo(settings.model);
    liveApiActivity = {
      status: "preparing",
      requestType,
      provider: openAI.providerName(modelInfo?.provider || openAI.providerForModel(settings.model)),
      model: modelInfo?.label || settings.model,
      inputSummary,
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
  }

  function failApiActivity(error, status = "error") {
    stopApiActivityTimer();
    updateApiActivity({
      status,
      error: error?.message || String(error || "")
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
    if (!state.review.started && !state.messages.length) {
      messagesElement.innerHTML = ui.welcomeMarkup();
    } else {
      const lastControlIndex = state.messages.findLastIndex(message => ["choices", "confirmation"].includes(message.kind));
      const messages = state.messages.map((message, index) => ui.messageMarkup(message, {
        state,
        recommendation,
        accountUrl: targetAccountUrl(),
        activeControl: index === lastControlIndex
      })).join("");
      const conversationLabel = state.review.manualScenario
        ? "Manual scenario"
        : state.review.started
          ? "Subscription review"
          : "Household context update";
      messagesElement.innerHTML = `<div class="day-marker">${conversationLabel} · ${ui.escapeHtml(engine.displayDate(state.systemDate, state.household.locale))}</div>${messages}`;
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
      fullScreenInstructionKey: fullScreenEvaluationInstruction
    });
    restoreEvaluationScroll(content, scrollState, selectedEvaluationId);
  }

  function renderAIStatus() {
    const settings = openAI.readSettings();
    const connected = openAI.selectedModelsConfigured(settings);
    const button = document.getElementById("openAISettings");
    button.classList.toggle("connected", connected);
    const roleLabel = model => {
      const info = openAI.modelInfo(model);
      return info ? `${openAI.providerName(info.provider)} ${info.label}` : model;
    };
    document.getElementById("aiStatusText").textContent = connected
      ? `Agent ${roleLabel(settings.model)} · Judge ${roleLabel(settings.judgeModel)}`
      : "Connect AI Models";
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

  const CHAT_REDACTION_TEXT = Object.freeze({
    sensitive_information_warning: global.StreamingGuardMemory.sensitiveMessagePlaceholder,
    out_of_scope: "[Out-of-scope message not retained.]",
    unclassified: "[Message not retained because it could not be safely classified.]"
  });

  function persistAdultMessage(text, safetyDisposition = "normal") {
    const replacement = CHAT_REDACTION_TEXT[safetyDisposition];
    return sendChat({
      role: "user",
      text: replacement || text,
      redacted: Boolean(replacement),
      redactionReason: replacement ? safetyDisposition : null
    });
  }

  function isLikelyStreamingScopeMessage(text) {
    return /\b(?:streaming|subscription|service|plan|price|cost|spend|budget|renew|billing|bill|cancel|pause|subscribe|watch|watchlist|viewing|movie|show|series|season|episode|title|release|catalog|rating|parental|family|household|aurora|tideplay|viewflix|summit|orbit|triostream|meadow)\b/i
      .test(String(text || ""));
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
    beginApiActivity({
      requestType: "conversation",
      settings,
      inputSummary: [
        "Global system instructions and the conversation task add-on",
        state.review.manualScenario
          ? "Stored household context with no preselected recommendation"
          : "Current structured recommendation and household context",
        `Recent WhatsApp conversation including the adult’s ${intent === "general" ? "message" : intent}`,
        "Available context-update and financial-calculation tool contracts",
        "Strict structured conversation response schema"
      ]
    });
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
          signal: responseController.signal
        });
      let responsePromise = requestConversationResponse("");
      markApiWaiting();
      let result;
      try {
        result = await responsePromise;
      } catch (firstError) {
        if (!firstError.output || firstError.name === "AbortError") throw firstError;
        updateApiActivity({
          inputSummary: [
            ...liveApiActivity.inputSummary,
            "The first structured response failed validation; one corrected response was requested automatically"
          ]
        });
        responsePromise = requestConversationResponse(firstError.message);
        result = await responsePromise;
      }
      const turn = result.response;
      persistAdultMessage(text, turn.safetyDisposition);
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
      if (error.name === "AbortError") {
        failApiActivity(error, "canceled");
        return;
      }
      if (!adultMessagePersisted) persistAdultMessage(text, "unclassified");
      const friendlyError = error.output
        ? "The AI response could not be validated after one automatic retry. Nothing was changed. Please try again."
        : "The selected AI model could not respond. Nothing was changed. Please try again.";
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
      responseController = null;
      setChatBusy(false);
      renderAll();
    }
  }

  function sendChat(message) {
    const storedMessage = tools.send_chat_response(message);
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
  }

  async function generateRecommendation(reason) {
    refreshState();
    const decisionPacket = engine.buildDecisionPacket(state);
    const settings = openAI.readSettings();
    beginApiActivity({
      requestType: "recommendation",
      settings,
      inputSummary: [
        "Global system instructions and the recommendation task add-on",
        `${state.members.length} household members, ${state.subscriptions.length} subscription records, viewing confirmations, watchlist priorities, and family rules`,
        `Scenario trigger for ${state.scenario.titleName} and ${state.scenario.targetServiceName}`,
        `Deterministic decision packet with feasible actions, grounded dates, and budget calculations`,
        "Strict structured recommendation response schema"
      ]
    });
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
        signal: responseController.signal
      });
      markApiWaiting();
      const result = await responsePromise;
      storeRecommendation(result.recommendation, {
        source: "llm",
        model: result.model,
        responseId: result.responseId,
        usage: result.usage
      });
      completeApiActivity(result);
      return { source: "llm", result };
    } catch (error) {
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
      return { source: "llm_unavailable", error };
    } finally {
      responseController = null;
      setChatBusy(false);
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
    sendChat({
      text: "Manual chat is ready. Ask any household streaming-subscription planning, management, viewing-access, or spending question, or tell me what changed. I can save explicit updates to subscriptions, plans, renewal details, viewing, watchlists, budgets, preferences, and family rules. If a required detail is missing, I’ll ask before saving anything."
    });
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
      persistAdultMessage(text, "sensitive_information_warning");
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
    const providerSettings = openAI.readSettings();
    if (openAI.isModelConfigured(providerSettings.model, providerSettings)) {
      await askOpenAI(text, composerIntent);
      composerIntent = "general";
      setExpectedInputComposer(state.review.nextExpectedInput);
      return;
    }
    if (state.review.manualScenario && !isLikelyStreamingScopeMessage(text)) {
      persistAdultMessage(text, "out_of_scope");
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
  document.getElementById("closeMemory").addEventListener("click", () => showProductView("chat", { focusTab: true }));
  document.getElementById("spendingToChat").addEventListener("click", () => showProductView("chat", { focusTab: true }));
  document.getElementById("askAboutSpending").addEventListener("click", () => {
    showProductView("chat");
    global.setTimeout(() => setComposer("question"), 0);
  });
  document.getElementById("updateHouseholdContext").addEventListener("click", () => {
    showProductView("chat");
    global.setTimeout(() => setComposer("context-update"), 0);
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
  showProductView("chat");
})(window);
