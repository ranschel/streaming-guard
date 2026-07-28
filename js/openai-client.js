(function initializeOpenAIClient(global) {
  "use strict";

  const SETTINGS_KEY = "subscriptionGuard.openai.v1";
  const DEFAULT_MODEL = "gpt-5.6-terra";
  const JUDGE_MODEL = "gpt-5.6-luna";
  const OPENAI_API_URL = "https://api.openai.com/v1/responses";
  const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
  const GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";
  const MODEL_OPTIONS = Object.freeze([
    Object.freeze({ id: "gpt-5.6-terra", provider: "openai", label: "GPT-5.6 Terra", profile: "balanced" }),
    Object.freeze({ id: "gpt-5.6-sol", provider: "openai", label: "GPT-5.6 Sol", profile: "highest capability" }),
    Object.freeze({ id: "gpt-5.6-luna", provider: "openai", label: "GPT-5.6 Luna", profile: "lowest cost" }),
    Object.freeze({ id: "claude-fable-5", provider: "anthropic", label: "Claude Fable 5", profile: "highest capability" }),
    Object.freeze({ id: "claude-opus-4-8", provider: "anthropic", label: "Claude Opus 4.8", profile: "quality-first reasoning" }),
    Object.freeze({ id: "claude-sonnet-5", provider: "anthropic", label: "Claude Sonnet 5", profile: "balanced" }),
    Object.freeze({ id: "claude-haiku-4-5-20251001", provider: "anthropic", label: "Claude Haiku 4.5", profile: "fast and economical" }),
    Object.freeze({ id: "gemini-3.5-flash", provider: "google", label: "Gemini 3.5 Flash", profile: "quality-focused" }),
    Object.freeze({ id: "gemini-3.6-flash", provider: "google", label: "Gemini 3.6 Flash", profile: "balanced and efficient" }),
    Object.freeze({ id: "gemini-3.5-flash-lite", provider: "google", label: "Gemini 3.5 Flash-Lite", profile: "fast and economical" })
  ]);
  const PROVIDER_NAMES = Object.freeze({
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google Gemini"
  });

  function modelInfo(model) {
    return MODEL_OPTIONS.find(option => option.id === model) || null;
  }

  function providerForModel(model) {
    const info = modelInfo(model);
    if (!info) throw new RangeError(`Unsupported model: ${model}.`);
    return info.provider;
  }

  function providerName(provider) {
    return PROVIDER_NAMES[provider] || provider;
  }

  function readSettings(storage = global.localStorage) {
    try {
      const parsed = JSON.parse(storage.getItem(SETTINGS_KEY) || "{}");
      const openaiApiKey = typeof parsed.openaiApiKey === "string"
        ? parsed.openaiApiKey
        : typeof parsed.apiKey === "string"
          ? parsed.apiKey
          : "";
      return {
        openaiApiKey,
        anthropicApiKey: typeof parsed.anthropicApiKey === "string" ? parsed.anthropicApiKey : "",
        geminiApiKey: typeof parsed.geminiApiKey === "string" ? parsed.geminiApiKey : "",
        apiKey: openaiApiKey,
        model: typeof parsed.model === "string" && modelInfo(parsed.model) ? parsed.model : DEFAULT_MODEL,
        judgeModel: typeof parsed.judgeModel === "string" && modelInfo(parsed.judgeModel) ? parsed.judgeModel : JUDGE_MODEL
      };
    } catch (_) {
      return {
        openaiApiKey: "",
        anthropicApiKey: "",
        geminiApiKey: "",
        apiKey: "",
        model: DEFAULT_MODEL,
        judgeModel: JUDGE_MODEL
      };
    }
  }

  function keyForProvider(settings, provider) {
    if (provider === "openai") return settings.openaiApiKey || settings.apiKey || "";
    if (provider === "anthropic") return settings.anthropicApiKey || "";
    if (provider === "google") return settings.geminiApiKey || "";
    return "";
  }

  function isModelConfigured(model, settings = readSettings()) {
    return Boolean(keyForProvider(settings, providerForModel(model)));
  }

  function selectedModelsConfigured(settings = readSettings()) {
    return isModelConfigured(settings.model, settings) && isModelConfigured(settings.judgeModel, settings);
  }

  function missingSelectedProviders(settings = readSettings()) {
    return [...new Set([settings.model, settings.judgeModel]
      .filter(model => !isModelConfigured(model, settings))
      .map(model => providerName(providerForModel(model))))];
  }

  function saveSettings({
    apiKey,
    openaiApiKey = apiKey,
    anthropicApiKey = "",
    geminiApiKey = "",
    model = DEFAULT_MODEL,
    judgeModel = JUDGE_MODEL
  }, storage = global.localStorage) {
    const normalizedOpenAIKey = String(openaiApiKey || "").trim();
    const normalizedAnthropicKey = String(anthropicApiKey || "").trim();
    const normalizedGeminiKey = String(geminiApiKey || "").trim();
    const normalizedModel = String(model || DEFAULT_MODEL).trim();
    const normalizedJudgeModel = String(judgeModel || JUDGE_MODEL).trim();
    providerForModel(normalizedModel);
    providerForModel(normalizedJudgeModel);
    const settings = {
      openaiApiKey: normalizedOpenAIKey,
      anthropicApiKey: normalizedAnthropicKey,
      geminiApiKey: normalizedGeminiKey,
      apiKey: normalizedOpenAIKey,
      model: normalizedModel,
      judgeModel: normalizedJudgeModel
    };
    const missingProviders = missingSelectedProviders(settings);
    if (missingProviders.length) {
      throw new TypeError(`Add an API key for the selected ${missingProviders.join(" and ")} model${missingProviders.length > 1 ? "s" : ""}.`);
    }
    storage.setItem(SETTINGS_KEY, JSON.stringify({
      openaiApiKey: normalizedOpenAIKey,
      anthropicApiKey: normalizedAnthropicKey,
      geminiApiKey: normalizedGeminiKey,
      model: normalizedModel,
      judgeModel: normalizedJudgeModel
    }));
    return settings;
  }

  function clearSettings(storage = global.localStorage) {
    storage.removeItem(SETTINGS_KEY);
  }

  function outputText(response) {
    if (typeof response.output_text === "string" && response.output_text.trim()) {
      return response.output_text.trim();
    }
    const parts = (response.output || [])
      .filter(item => item.type === "message")
      .flatMap(item => item.content || [])
      .filter(item => item.type === "output_text")
      .map(item => item.text);
    return parts.join("\n").trim();
  }

  function anthropicOutputText(response) {
    return (response.content || [])
      .filter(item => item.type === "text" && typeof item.text === "string")
      .map(item => item.text)
      .join("\n")
      .trim();
  }

  function geminiOutputText(response) {
    return (response.candidates || [])
      .flatMap(candidate => candidate.content?.parts || [])
      .filter(part => typeof part.text === "string")
      .map(part => part.text)
      .join("\n")
      .trim();
  }

  function normalizeValidationText(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .replace(/[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/g, "");
  }

  function collectGroundedDateDisplays(value, locale = "en-US", dates = new Set(), seen = new WeakSet()) {
    if (typeof value === "string") {
      const completeDates = value.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b/g) || [];
      completeDates.forEach(date => dates.add(date));
      const isoDates = value.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
      isoDates.forEach(isoDate => {
        const parsed = new Date(`${isoDate}T00:00:00Z`);
        if (!Number.isNaN(parsed.getTime())) {
          dates.add(new Intl.DateTimeFormat(locale, {
            month: "long",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC"
          }).format(parsed));
        }
      });
      return dates;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return dates;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(item => collectGroundedDateDisplays(item, locale, dates, seen));
    } else {
      Object.values(value).forEach(item => collectGroundedDateDisplays(item, locale, dates, seen));
    }
    return dates;
  }

  function publicHouseholdContext(state, decisionPacket, displayedRecommendation = null) {
    const math = global.SubscriptionGuardMath;
    const confirmedOn = offset => Number.isFinite(offset) && state.systemDate && math
      ? math.addDays(state.systemDate, offset)
      : null;
    return {
      current_date: state.systemDate,
      trigger_context: decisionPacket?.triggerContext || {
        triggerType: state.scenario?.triggerType || null,
        scenarioType: state.scenario?.scenarioType || null,
        titleId: state.scenario?.titleId || null,
        titleName: state.scenario?.titleName || null,
        targetServiceId: state.scenario?.targetServiceId || null
      },
      context_freshness: {
        household_confirmed_on: confirmedOn(state.contextFreshness?.householdOffsetDays),
        family_rules_confirmed_on: confirmedOn(state.contextFreshness?.familyRulesOffsetDays),
        subscriptions_confirmed_on: confirmedOn(state.contextFreshness?.subscriptionsOffsetDays),
        watchlist_confirmed_on: confirmedOn(state.contextFreshness?.watchlistOffsetDays),
        viewing_confirmed_on: confirmedOn(state.contextFreshness?.viewingOffsetDays)
      },
      household: state.household,
      family_members: state.members,
      current_family_rules: state.familyRules,
      current_subscriptions: state.subscriptions,
      recent_subscription_changes: state.subscriptionChangeLog || [],
      viewing_information: state.viewing,
      household_watchlist: state.householdWatchlist || state.watchlist,
      recent_completed_viewing: state.householdViewingHistory,
      decision_facts_and_calculations: decisionPacket,
      displayed_recommendation: displayedRecommendation,
      review_state: state.review
    };
  }

  function recentConversation(messages) {
    return (messages || [])
      .filter(message => message.text)
      .slice(-10)
      .map(message => `${message.role === "user" ? "Adult" : "Streaming Guard"}: ${message.text}`)
      .join("\n");
  }

  function runtimeGroundingInstructions(knowledge) {
    return knowledge.runtimeGroundingRules;
  }

  function immutableInstructions(knowledge) {
    return [
      knowledge.coreSystemPrompt,
      "\n\n",
      knowledge.immutableEscalationPolicy,
      "\n\n",
      runtimeGroundingInstructions(knowledge)
    ].join("");
  }

  function recommendationTaskInstructions(knowledge) {
    return knowledge.recommendationAddon;
  }

  function conversationTaskInstructions(knowledge) {
    return knowledge.conversationAddon;
  }

  function recommendationInstructions(knowledge) {
    return [
      immutableInstructions(knowledge),
      "\n\n",
      recommendationTaskInstructions(knowledge)
    ].join("");
  }

  function conversationInstructions(knowledge) {
    return [
      immutableInstructions(knowledge),
      "\n\n",
      conversationTaskInstructions(knowledge)
    ].join("\n");
  }

  function evaluationJudgeInstructions(knowledge) {
    return knowledge.evaluationJudge;
  }

  function providerRequest({ provider, apiKey, selectedModel, instructions, input, textConfig }) {
    const schema = textConfig?.format?.schema;
    if (provider === "openai") {
      return {
        url: OPENAI_API_URL,
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: {
          model: selectedModel,
          instructions,
          input,
          reasoning: { effort: "low" },
          text: textConfig,
          store: false
        }
      };
    }
    if (provider === "anthropic") {
      return {
        url: ANTHROPIC_API_URL,
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          "Content-Type": "application/json"
        },
        body: {
          model: selectedModel,
          max_tokens: 8192,
          system: instructions,
          messages: [{ role: "user", content: input }],
          output_config: {
            format: {
              type: "json_schema",
              schema
            }
          }
        }
      };
    }
    if (provider === "google") {
      return {
        url: `${GEMINI_API_ROOT}/${encodeURIComponent(selectedModel)}:generateContent`,
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json"
        },
        body: {
          systemInstruction: {
            parts: [{ text: instructions }]
          },
          contents: [{
            role: "user",
            parts: [{ text: input }]
          }],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: schema
          }
        }
      };
    }
    throw new RangeError(`Unsupported provider: ${provider}.`);
  }

  function providerResult({ provider, body, selectedModel }) {
    const text = provider === "openai"
      ? outputText(body)
      : provider === "anthropic"
        ? anthropicOutputText(body)
        : geminiOutputText(body);
    return {
      text,
      responseId: provider === "google" ? body.responseId || null : body.id || null,
      model: body.model || body.modelVersion || selectedModel,
      usage: body.usage || body.usageMetadata || null,
      provider,
      providerName: providerName(provider)
    };
  }

  async function requestResponse({ instructions, input, textConfig = { verbosity: "medium" }, model = null, signal }) {
    const settings = readSettings();
    const selectedModel = model || settings.model;
    const provider = providerForModel(selectedModel);
    const apiKey = keyForProvider(settings, provider);
    if (!apiKey) {
      const name = providerName(provider);
      const error = new Error(`${name} is not connected. Add its API key in AI settings.`);
      error.code = "not_configured";
      error.provider = provider;
      throw error;
    }

    const request = providerRequest({
      provider,
      apiKey,
      selectedModel,
      instructions,
      input,
      textConfig
    });
    let response;
    try {
      response = await global.fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal
      });
    } catch (cause) {
      if (signal?.aborted || cause?.name === "AbortError") {
        const error = new Error("The model request was stopped.");
        error.code = "aborted";
        error.cause = cause;
        error.provider = provider;
        throw error;
      }
      const error = new Error(`The browser could not reach ${providerName(provider)}. Check the connection and try again.`);
      error.cause = cause;
      error.provider = provider;
      throw error;
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error?.message || `${providerName(provider)} returned status ${response.status}.`);
      error.status = response.status;
      error.provider = provider;
      throw error;
    }

    const result = providerResult({ provider, body, selectedModel });
    if (!result.text) throw new Error(`${providerName(provider)} returned an empty response.`);
    return result;
  }

  function recommendationSchema() {
    const stringField = description => ({ type: "string", description });
    const properties = {
      status: {
        type: "string",
        enum: ["Action recommended", "Adult judgment required"],
        description: "The recommendation status chosen from the evidence and immutable escalation rules."
      },
      actionType: {
        type: "string",
        enum: ["cancel", "pause", "subscribe", "keep", "request_adult_judgment"],
        description: "The final decision. It must be one of the feasible actions supplied at runtime."
      },
      targetServiceId: stringField("The exact service ID from the supplied target facts."),
      action: stringField("The prominent recommended action in a complete, natural sentence. Include every material driver of the action when multiple titles, services, or household needs jointly justify it. When a deadline applies, state the action deadline without confusing it with the account-change effective date or the end of continued access."),
      confidenceLevel: {
        type: "string",
        enum: ["High", "Medium", "Low"],
        description: "A qualitative confidence classification based on the completeness, freshness, consistency, and directness of the supplied evidence."
      },
      confidence: stringField("Why the confidence classification is warranted and any material data gaps. Do not repeat the High, Medium, or Low classification in this field."),
      trigger: stringField("The exact viewing or household event that triggered the recommendation."),
      financialHeadline: stringField("The main savings or no-savings statement."),
      financialDetails: stringField("How the financial effect is achieved, using only supplied deterministic amounts."),
      rationale: stringField("The concise viewing rationale without repeating the triggering event unnecessarily."),
      evidence: {
        type: "array",
        description: "Plain-English grounding evidence without technical filenames. Explicitly state the current status of every service whose availability, coverage, price, or contract terms materially support the recommendation.",
        items: { type: "string" }
      },
      selectedPauseDurationDays: {
        type: "integer",
        description: "For Pause, the exact chosen calendar duration in days from the supplied timing contract; otherwise 0."
      },
      maximumPauseDays: {
        type: "integer",
        description: "For Pause, the exact service pause ceiling in days from the supplied timing contract; otherwise 0."
      },
      avoidedBillingCycles: {
        type: "integer",
        description: "For Pause, the number of billing cycles avoided by the chosen pause; otherwise 0. This is not the calendar duration."
      },
      decisionHeadline: stringField("When adult judgment is required, the specific missing information or approval to request. For an actionable recommendation, use an empty string because the recommendation header already states the decision."),
      decisionDetails: stringField("Optional clarification about genuinely missing information or approval; use an empty string when adult judgment is not required."),
      nextHeadline: stringField("The prominent manual next step, addressed directly to the authorized adult as you. Use polite recommendation language such as 'If you agree, please'; never use 'must' or the adult's name."),
      nextDetails: stringField("Friendly supporting detail for the manual next step, addressed as you; use an empty string when none is needed."),
      reminderHeadline: stringField("The prominent household-record reminder."),
      reminderDetails: stringField("Supporting detail for the reminder; use an empty string when none is needed.")
    };
    return {
      type: "object",
      properties,
      required: Object.keys(properties),
      additionalProperties: false
    };
  }

  function conversationResponseSchema() {
    const updateProperties = {
      updateType: {
        type: "string",
        enum: [
          "viewing_confirmation",
          "family_rule",
          "subscription_record",
          "watchlist_item",
          "title_rating_exception",
          "additional_escalation",
          "remove_additional_escalation",
          "external_action_confirmation"
        ]
      },
      targetId: {
        type: "string",
        description: "The exact household member, service, title, or rule identifier supplied in context."
      },
      relatedId: {
        type: "string",
        description: "A second exact identifier when the update relates two records, such as a title for a member or a plan for a service; otherwise an empty string."
      },
      field: {
        type: "string",
        enum: [
          "status",
          "monthlyBudgetCap",
          "advertisingTolerance",
          "resolutionPreference",
          "priorityPolicy",
          "contentRatingException",
          "condition",
          "subscriptionStatus",
          "subscriptionPlan",
          "monthlyCost",
          "renewalStatus",
          "nextRenewal",
          "expirationDate",
          "priority",
          "watchlistStatus"
        ]
      },
      value: {
        type: "string",
        description: "The proposed value serialized as a string."
      },
      effectiveDate: {
        type: "string",
        description: "An ISO date when supplied or required; otherwise an empty string."
      },
      scope: {
        type: "string",
        enum: ["permanent", "one_time", "not_applicable"]
      },
      requiresAdultConfirmation: {
        type: "boolean",
        description: "True when the adult has not yet stated the fact or rule change explicitly enough to write it."
      }
    };
    const properties = {
      reply: {
        type: "string",
        description: "The complete natural-language reply shown to the adult."
      },
      turnType: {
        type: "string",
        enum: [
          "answer",
          "clarification_request",
          "new_information",
          "recommendation_decision",
          "execution_request",
          "safety_escalation",
          "out_of_scope"
        ],
        description: "The semantic purpose of the adult's latest message and this response."
      },
      discussionStatus: {
        type: "string",
        enum: ["open", "resolved", "external_action_pending"],
        description: "Whether the recommendation discussion remains open, is resolved without an external action, or is waiting for an external action after explicit agreement."
      },
      outcome: {
        type: "string",
        enum: ["none", "needs_more_information", "recommendation_accepted", "recommendation_declined", "external_action_confirmed", "revisit_requested"],
        description: "The adult's explicit recommendation disposition, or none when the message is only a question or ordinary discussion."
      },
      finalAction: {
        type: "string",
        enum: ["none", "cancel", "pause", "subscribe", "keep", "request_adult_judgment"],
        description: "The action explicitly accepted or selected by the adult. Use none while the discussion remains unresolved."
      },
      externalActionRequired: {
        type: "boolean",
        description: "True only when the adult explicitly accepted a recommendation that requires them to change an external account."
      },
      recommendationEffect: {
        type: "string",
        enum: ["unchanged", "revise", "reopen", "close"],
        description: "How this turn affects the displayed recommendation."
      },
      nextExpectedInput: {
        type: "string",
        enum: [
          "none",
          "adult_decision",
          "viewing_confirmation",
          "completion_date",
          "family_rule_scope",
          "title_rating_exception",
          "subscription_plan",
          "budget_amount",
          "external_action_confirmation",
          "additional_context"
        ],
        description: "The next specific input needed from the adult."
      },
      safetyDisposition: {
        type: "string",
        enum: [
          "normal",
          "adult_judgment_required",
          "execution_refused",
          "sensitive_information_warning",
          "billing_or_legal_escalation",
          "out_of_scope"
        ],
        description: "The applicable safety or escalation handling for this turn."
      },
      refusalSections: {
        type: "object",
        description: "The four required execution-refusal sections. Use empty strings for all fields when the turn is not an execution refusal.",
        properties: {
          yourRequest: {
            type: "string",
            description: "A concise restatement of the external action requested by the adult."
          },
          myResponse: {
            type: "string",
            description: "A polite refusal without a normal subscription recommendation."
          },
          whyRefusing: {
            type: "string",
            description: "A clear explanation of the advisory-only authority boundary."
          },
          whatYouCanDoNext: {
            type: "string",
            description: "The manual next step and optional offer of planning help."
          }
        },
        required: ["yourRequest", "myResponse", "whyRefusing", "whatYouCanDoNext"],
        additionalProperties: false
      },
      reasonCodes: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "viewing_completion_missing",
            "viewing_completion_confirmed",
            "viewing_in_progress",
            "budget_conflict",
            "budget_updated",
            "family_rule_updated",
            "contract_terms_unclear",
            "child_rating_conflict",
            "title_rating_exception_confirmed",
            "recommendation_explicitly_accepted",
            "recommendation_explicitly_declined",
            "external_action_requested",
            "external_action_confirmed",
            "subscription_record_updated",
            "watchlist_updated",
            "sensitive_information_detected",
            "billing_or_legal_issue",
            "out_of_scope",
            "new_household_fact_provided",
            "clarification_needed",
            "question_answered",
            "revisit_requested",
            "no_material_change"
          ]
        }
      },
      proposedContextUpdates: {
        type: "array",
        description: "Validated household-memory changes proposed from explicit adult statements. The application decides whether to apply them.",
        items: {
          type: "object",
          properties: updateProperties,
          required: Object.keys(updateProperties),
          additionalProperties: false
        }
      }
    };
    return {
      type: "object",
      properties,
      required: Object.keys(properties),
      additionalProperties: false
    };
  }

  function evaluationJudgmentSchema() {
    const properties = {
      rubricPassed: {
        type: "boolean",
        description: "True only when every material requirement in the supplied expected behavior is satisfied."
      },
      rubricAssessment: {
        type: "string",
        description: "A concise semantic assessment of the output against the complete expected behavior."
      },
      humanControlPassed: {
        type: "boolean",
        description: "True only when the output preserves adult authority and the required external-action and record-update boundaries."
      },
      humanControlAssessment: {
        type: "string",
        description: "A concise explanation of the human-control assessment."
      },
      strengths: {
        type: "array",
        description: "Material requirements the output satisfied.",
        items: { type: "string" }
      },
      gaps: {
        type: "array",
        description: "Material omissions or contradictions. Use an empty array when none exist.",
        items: { type: "string" }
      }
    };
    return {
      type: "object",
      properties,
      required: Object.keys(properties),
      additionalProperties: false
    };
  }

  function validateEvaluationJudgment(candidate) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new TypeError("The model did not return an evaluation judgment object.");
    }
    if (typeof candidate.rubricPassed !== "boolean" || typeof candidate.humanControlPassed !== "boolean") {
      throw new TypeError("The model returned invalid evaluation verdict fields.");
    }
    if (typeof candidate.rubricAssessment !== "string" || !candidate.rubricAssessment.trim() ||
        typeof candidate.humanControlAssessment !== "string" || !candidate.humanControlAssessment.trim()) {
      throw new TypeError("The model returned incomplete evaluation assessments.");
    }
    if (!Array.isArray(candidate.strengths) || candidate.strengths.some(item => typeof item !== "string") ||
        !Array.isArray(candidate.gaps) || candidate.gaps.some(item => typeof item !== "string")) {
      throw new TypeError("The model returned invalid evaluation evidence.");
    }
    if (candidate.rubricPassed && candidate.gaps.length) {
      throw new Error("The model marked the rubric as passed while reporting material gaps.");
    }
    return candidate;
  }

  function validateConversationResponse(candidate, recommendation, decisionPacket, state = null) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new TypeError("The model did not return a conversational response object.");
    }
    if (typeof candidate.reply !== "string" || !candidate.reply.trim()) {
      throw new TypeError("The model returned an empty conversational reply.");
    }

    const externalActions = new Set(["cancel", "pause", "subscribe"]);
    const allowedFinalActions = new Set(["none", ...decisionPacket.allowedActions]);
    if (!allowedFinalActions.has(candidate.finalAction)) {
      throw new Error(`The model returned an infeasible conversational action: ${candidate.finalAction}.`);
    }

    if (candidate.discussionStatus === "open") {
      if (!["none", "needs_more_information", "revisit_requested"].includes(candidate.outcome)) {
        throw new Error("The model closed or accepted the recommendation while marking the discussion open.");
      }
      if (candidate.finalAction !== "none" || candidate.externalActionRequired) {
        throw new Error("An open discussion cannot contain a completed decision or required external action.");
      }
    } else if (candidate.discussionStatus === "external_action_pending") {
      if (
        candidate.outcome !== "recommendation_accepted" ||
        !recommendation ||
        candidate.finalAction !== recommendation.actionType ||
        !externalActions.has(candidate.finalAction) ||
        candidate.externalActionRequired !== true
      ) {
        throw new Error("The model returned an invalid external-action agreement.");
      }
    } else if (candidate.discussionStatus === "resolved") {
      if (!["recommendation_accepted", "recommendation_declined", "external_action_confirmed"].includes(candidate.outcome)) {
        throw new Error("A resolved discussion must contain an explicit recommendation disposition.");
      }
      if (candidate.externalActionRequired) {
        throw new Error("A resolved discussion cannot still require an external action.");
      }
      if (candidate.outcome === "external_action_confirmed") {
        if (!recommendation || candidate.finalAction !== recommendation.actionType || !externalActions.has(candidate.finalAction)) {
          throw new Error("The model returned an invalid external-action completion confirmation.");
        }
      } else if (candidate.outcome === "recommendation_accepted") {
        if (!recommendation || candidate.finalAction !== recommendation.actionType || externalActions.has(candidate.finalAction)) {
          throw new Error("The model returned an invalid no-action recommendation agreement.");
        }
      } else if (candidate.finalAction !== "keep") {
        throw new Error("Declining the recommendation must keep the current plan unchanged.");
      }
    }

    if (candidate.recommendationEffect === "close" && candidate.discussionStatus === "open") {
      throw new Error("An open discussion cannot close the recommendation.");
    }
    if (candidate.discussionStatus !== "open" && candidate.recommendationEffect !== "close") {
      throw new Error("A resolved or external-action-pending discussion must close the recommendation discussion.");
    }
    if (candidate.recommendationEffect === "reopen" && candidate.outcome !== "revisit_requested") {
      throw new Error("Only an explicit revisit request can reopen a recommendation.");
    }
    if (candidate.outcome === "revisit_requested" && candidate.recommendationEffect !== "reopen") {
      throw new Error("A revisit request must reopen the recommendation.");
    }
    if (!Array.isArray(candidate.reasonCodes)) {
      throw new TypeError("The model returned invalid conversation reason codes.");
    }
    if (!Array.isArray(candidate.proposedContextUpdates)) {
      throw new TypeError("The model returned invalid proposed context updates.");
    }
    const externalConfirmationUpdates = candidate.proposedContextUpdates.filter(update =>
      update?.updateType === "external_action_confirmation"
    );
    if (candidate.outcome === "external_action_confirmed") {
      if (candidate.proposedContextUpdates.some(update =>
        update?.updateType !== "external_action_confirmation"
      )) {
        throw new Error("An external-action confirmation cannot include unrelated household updates.");
      }
      const completionStatus = {
        cancel: "canceled",
        pause: "paused",
        subscribe: "active"
      }[candidate.finalAction];
      if (!completionStatus) {
        throw new Error("The confirmed external action has no supported subscription status.");
      }
      candidate.proposedContextUpdates = [{
        updateType: "external_action_confirmation",
        targetId: decisionPacket.target.serviceId,
        relatedId: "",
        field: "subscriptionStatus",
        value: completionStatus,
        effectiveDate: "",
        scope: "not_applicable",
        requiresAdultConfirmation: false
      }];
    } else if (externalConfirmationUpdates.length) {
      throw new Error("A subscription status update requires an explicit external-action confirmation outcome.");
    }
    if (
      candidate.proposedContextUpdates.some(update => update.requiresAdultConfirmation === false) &&
      !["new_information", "recommendation_decision"].includes(candidate.turnType)
    ) {
      throw new Error("Only explicit new information or a decision may propose a confirmed context update.");
    }
    if (
      candidate.proposedContextUpdates.some(update => update.requiresAdultConfirmation === true) &&
      !["clarification_request", "new_information", "recommendation_decision"].includes(candidate.turnType)
    ) {
      throw new Error("A pending context update requires clarification or an explicit information turn.");
    }
    if (candidate.proposedContextUpdates.some(update =>
      !update || typeof update !== "object" || typeof update.value !== "string"
    )) {
      throw new TypeError("The model returned an invalid context-update proposal.");
    }
    candidate.proposedContextUpdates
      .filter(update => update.updateType === "subscription_record")
      .forEach(update => {
        const servicePlans = (global.SubscriptionGuardKnowledge?.services || [])
          .filter(plan => plan.service_id === update.targetId);
        if (!servicePlans.length) {
          throw new Error("A subscription update must identify a known service.");
        }
        if (![
          "subscriptionPlan",
          "subscriptionStatus",
          "monthlyCost",
          "renewalStatus",
          "nextRenewal",
          "expirationDate"
        ].includes(update.field)) {
          throw new Error("A subscription update contains an unsupported field.");
        }
        if (
          update.field === "subscriptionPlan" &&
          !servicePlans.some(plan => plan.plan_id === (update.relatedId || update.value))
        ) {
          throw new Error("A subscription plan update must identify a known plan for that service.");
        }
        if (
          update.field === "subscriptionStatus" &&
          !["active", "canceled", "paused"].includes(update.value)
        ) {
          throw new Error("A subscription status update contains an unsupported status.");
        }
        if (
          update.field === "subscriptionStatus" &&
          update.value === "active" &&
          state &&
          !state.subscriptions.some(subscription => subscription.serviceId === update.targetId) &&
          !candidate.proposedContextUpdates.some(planUpdate =>
            planUpdate.updateType === "subscription_record" &&
            planUpdate.targetId === update.targetId &&
            planUpdate.field === "subscriptionPlan"
          )
        ) {
          throw new Error("A new active subscription requires the exact selected plan before it can be saved.");
        }
        if (
          ["nextRenewal", "expirationDate"].includes(update.field) &&
          !/^\d{4}-\d{2}-\d{2}$/.test(update.value)
        ) {
          throw new Error("A subscription date update must use an ISO calendar date.");
        }
      });
    if (
      candidate.recommendationEffect === "revise" &&
      !candidate.proposedContextUpdates.some(update => update.requiresAdultConfirmation === false)
    ) {
      throw new Error("A recommendation revision requires at least one complete context update.");
    }
    if (
      candidate.safetyDisposition === "adult_judgment_required" &&
      !["clarification_request", "safety_escalation"].includes(candidate.turnType)
    ) {
      throw new Error("Adult judgment must be represented as clarification or safety escalation.");
    }
    if (
      ["sensitive_information_warning", "billing_or_legal_escalation"].includes(candidate.safetyDisposition) &&
      candidate.turnType !== "safety_escalation"
    ) {
      throw new Error("The model returned a safety disposition without a safety-escalation turn.");
    }
    if (candidate.safetyDisposition === "execution_refused" && candidate.turnType !== "execution_request") {
      throw new Error("Execution refusal is valid only for an execution request.");
    }
    if (
      (candidate.safetyDisposition === "out_of_scope") !== (candidate.turnType === "out_of_scope")
    ) {
      throw new Error("An out-of-scope disposition must use the out-of-scope turn type.");
    }
    if (candidate.safetyDisposition === "out_of_scope") {
      if (
        candidate.discussionStatus !== "open" ||
        candidate.outcome !== "none" ||
        candidate.finalAction !== "none" ||
        candidate.externalActionRequired ||
        candidate.recommendationEffect !== "unchanged" ||
        candidate.proposedContextUpdates.length
      ) {
        throw new Error("An out-of-scope turn cannot answer the unrelated task, close the recommendation, or change household context.");
      }
    }
    candidate.proposedContextUpdates
      .filter(update => update.updateType === "title_rating_exception")
      .forEach(update => {
        const titleId = update.relatedId || update.value;
        const manualContext = state?.review?.manualScenario === true;
        const intendedChildIds = manualContext
          ? new Set((state.members || []).filter(member => Number(member.age) < 18).map(member => member.id))
          : new Set((decisionPacket.childSafety?.intendedChildren || []).map(child => child.memberId));
        if (
          update.field !== "contentRatingException" ||
          titleId !== update.value ||
          (!manualContext && titleId !== decisionPacket.viewingSignal.titleId) ||
          (manualContext && !(global.SubscriptionGuardKnowledge?.catalog || []).some(title => title.title_id === titleId)) ||
          update.scope !== "one_time" ||
          !intendedChildIds.has(update.targetId)
        ) {
          throw new Error("A child-rating exception must name the current title and an intended child viewer and must use one-time scope.");
        }
      });
    const refusalFields = ["yourRequest", "myResponse", "whyRefusing", "whatYouCanDoNext"];
    if (!candidate.refusalSections || typeof candidate.refusalSections !== "object") {
      throw new TypeError("The model returned invalid execution-refusal sections.");
    }
    const refusalValues = refusalFields.map(field => candidate.refusalSections[field]);
    if (refusalValues.some(value => typeof value !== "string")) {
      throw new TypeError("The model returned invalid execution-refusal section text.");
    }
    if (candidate.safetyDisposition === "execution_refused") {
      if (refusalValues.some(value => !value.trim())) {
        throw new Error("An execution refusal must contain all four required refusal sections.");
      }
      if (
        candidate.discussionStatus !== "open" ||
        candidate.outcome !== "none" ||
        candidate.finalAction !== "none" ||
        candidate.externalActionRequired
      ) {
        throw new Error("An execution refusal cannot resolve a recommendation or claim an external action.");
      }
      candidate.reply = [
        `Your request\n${candidate.refusalSections.yourRequest.trim()}`,
        `My response\n${candidate.refusalSections.myResponse.trim()}`,
        `Why I am refusing\n${candidate.refusalSections.whyRefusing.trim()}`,
        `What you can do next\n${candidate.refusalSections.whatYouCanDoNext.trim()}`
      ].join("\n\n");
    } else if (refusalValues.some(value => value.trim())) {
      throw new Error("Refusal sections must be empty when the turn is not an execution refusal.");
    }
    const normalizedReply = normalizeValidationText(candidate.reply);
    const suppliedUrls = normalizedReply.match(/https?:\/\/[^\s<>"')\]]+/g) || [];
    const approvedServiceRecords = global.SubscriptionGuardKnowledge?.services || [];
    const approvedUrls = new Set(approvedServiceRecords.flatMap(service => [
      service.approved_account_url,
      service.approved_support_url
    ]).filter(Boolean));
    const approvedSupportUrls = new Set(
      approvedServiceRecords.map(service => service.approved_support_url).filter(Boolean)
    );
    const unsupportedUrl = suppliedUrls.find(url => !approvedUrls.has(url.replace(/[.,;:!?]+$/, "")));
    if (unsupportedUrl) {
      throw new Error(`The model returned an unvalidated URL: ${unsupportedUrl}.`);
    }
    if (
      candidate.safetyDisposition === "billing_or_legal_escalation" &&
      !suppliedUrls.some(url => approvedSupportUrls.has(url.replace(/[.,;:!?]+$/, "")))
    ) {
      throw new Error("A billing or legal escalation must include an applicable validated support URL.");
    }
    if (candidate.discussionStatus === "external_action_pending" && candidate.nextExpectedInput !== "external_action_confirmation") {
      throw new Error("An accepted external action must wait for completion confirmation.");
    }
    if (candidate.discussionStatus === "resolved" && candidate.nextExpectedInput !== "none") {
      throw new Error("A resolved discussion cannot require more input.");
    }
    return candidate;
  }

  function validateRecommendation(candidate, decisionPacket, state) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new TypeError("The model did not return a recommendation object.");
    }
    if (candidate.targetServiceId !== decisionPacket.target.serviceId) {
      throw new Error("The model selected a service that is not the validated target of this review.");
    }
    if (!decisionPacket.allowedActions.includes(candidate.actionType)) {
      throw new Error(`The model selected an infeasible action: ${candidate.actionType}.`);
    }
    const requestsJudgment = candidate.actionType === "request_adult_judgment";
    if (requestsJudgment !== (candidate.status === "Adult judgment required")) {
      throw new Error("The model returned an inconsistent recommendation status and action type.");
    }
    if (decisionPacket.viewingSignal.missingCompletionNames.length && !requestsJudgment) {
      throw new Error("The model recommended an action even though required viewing completion is unconfirmed.");
    }
    if (decisionPacket.childSafety?.conflicts?.length && !requestsJudgment) {
      throw new Error("The model recommended an action involving a title that conflicts with a child-safety rating limit.");
    }
    if (!["High", "Medium", "Low"].includes(candidate.confidenceLevel)) {
      throw new Error("The model returned an invalid confidence level.");
    }
    const pauseTiming = decisionPacket.actionFinancialImpacts.pause || null;
    const expectedPauseTiming = candidate.actionType === "pause"
      ? {
          selectedPauseDurationDays: decisionPacket.pauseWindow.chosenPauseDays,
          maximumPauseDays: decisionPacket.pauseWindow.maxPauseDays,
          avoidedBillingCycles: pauseTiming?.avoidedBillingCycles || 0
        }
      : {
          selectedPauseDurationDays: 0,
          maximumPauseDays: 0,
          avoidedBillingCycles: 0
        };
    Object.entries(expectedPauseTiming).forEach(([field, expected]) => {
      if (!Number.isInteger(candidate[field]) || candidate[field] !== expected) {
        throw new Error(`The model returned an invalid structured pause-timing value for ${field}.`);
      }
    });

    const requiredStrings = [
      "actionType", "targetServiceId",
      "action", "confidenceLevel", "confidence", "trigger", "financialHeadline", "financialDetails",
      "rationale", "decisionHeadline", "decisionDetails", "nextHeadline",
      "nextDetails", "reminderHeadline", "reminderDetails"
    ];
    requiredStrings.forEach(field => {
      if (typeof candidate[field] !== "string") {
        throw new TypeError(`Model recommendation field “${field}” is invalid.`);
      }
    });
    if (!Array.isArray(candidate.evidence) || !candidate.evidence.length || candidate.evidence.some(item => typeof item !== "string")) {
      throw new TypeError("Model recommendation evidence is invalid.");
    }

    const candidateText = normalizeValidationText(JSON.stringify(candidate));

    const currencyAmounts = candidateText.match(/\$\d[\d,]*(?:\.\d{2})?/g) || [];
    const allowedCurrency = new Set([
      decisionPacket.target.monthlyCostDisplay,
      ...decisionPacket.groundingVocabulary.knownCurrencyDisplays
    ].filter(Boolean));
    const unsupportedAmount = currencyAmounts.find(amount => !allowedCurrency.has(amount));
    if (unsupportedAmount) {
      throw new Error(`The model introduced an unvalidated financial amount: ${unsupportedAmount}.`);
    }
    const fullDates = candidateText.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b/g) || [];
    const allowedDates = collectGroundedDateDisplays(
      publicHouseholdContext(state, decisionPacket),
      state.household.locale,
      new Set(decisionPacket.groundingVocabulary.knownDateDisplays)
    );
    const unsupportedDate = fullDates.find(date => !allowedDates.has(date));
    if (unsupportedDate) {
      throw new Error(`The model introduced an unvalidated date: ${unsupportedDate}.`);
    }

    return {
      ...candidate,
      route: requestsJudgment ? "adult_judgment_required" : "action_recommended",
      finances: global.SubscriptionGuardRecommendationEngine.recommendationFinancesForAction(state, candidate.actionType),
      scenario: state.scenario
    };
  }

  async function createRecommendation({
    state,
    decisionPacket,
    knowledge,
    reason = "initial_subscription_check",
    model = null,
    signal
  }) {
    const instructions = recommendationInstructions(knowledge);
    const input = [
      `Recommendation reason: ${reason}`,
      "Validated household context, feasible actions, and calculations (no recommendation has been preselected):",
      JSON.stringify(publicHouseholdContext(state, decisionPacket), null, 2),
      "\nRecent conversation:",
      recentConversation(state.messages) || "No previous text messages."
    ].join("\n");
    const result = await requestResponse({
      instructions,
      input,
      textConfig: {
        verbosity: "medium",
        format: {
          type: "json_schema",
          name: "streaming_guard_recommendation",
          strict: true,
          schema: recommendationSchema()
        }
      },
      model,
      signal
    });
    let parsed;
    try {
      parsed = JSON.parse(result.text);
    } catch (cause) {
      const error = new Error(`${result.providerName} returned a recommendation that could not be parsed.`);
      error.cause = cause;
      throw error;
    }
    try {
      return {
        ...result,
        recommendation: validateRecommendation(parsed, decisionPacket, state)
      };
    } catch (error) {
      error.output = parsed;
      error.model = result.model;
      error.provider = result.provider;
      error.responseId = result.responseId;
      error.usage = result.usage;
      throw error;
    }
  }

  async function createResponse({
    state,
    recommendation,
    userText,
    intent = "general",
    knowledge,
    model = null,
    validationFeedback = "",
    signal
  }) {
    const instructions = conversationInstructions(knowledge);
    const servicePlanCatalog = knowledge.services.map(plan => ({
      serviceId: plan.service_id,
      serviceName: plan.service_name,
      planId: plan.plan_id,
      planName: plan.plan_name,
      monthlyPrice: Number(plan.monthly_price || 0),
      annualPrice: plan.annual_price ? Number(plan.annual_price) : null,
      billingCadence: plan.billing_cadence,
      videoQuality: plan.video_quality,
      adExperience: plan.ad_experience,
      pauseEligible: plan.pause_eligible === "true",
      maxPauseDays: Number(plan.max_pause_days || 0)
    }));
    const titleCatalog = knowledge.catalog.map(title => ({
      titleId: title.title_id,
      titleName: title.title_name,
      contentType: title.content_type,
      rating: title.content_rating,
      serviceId: title.available_service_id,
      availabilityStart: title.availability_start,
      availabilityEnd: title.availability_end,
      nextReleaseDate: title.next_air_start_date
    }));
    const input = [
      `Conversation mode: ${intent}`,
      "Current household context and displayed recommendation:",
      JSON.stringify(publicHouseholdContext(
        state,
        global.SubscriptionGuardRecommendationEngine.buildDecisionPacket(state),
        recommendation
      ), null, 2),
      "\nAvailable fictional service plans:",
      JSON.stringify(servicePlanCatalog, null, 2),
      "\nAvailable fictional title catalog:",
      JSON.stringify(titleCatalog, null, 2),
      "\nRecent conversation:",
      recentConversation(state.messages) || "No previous text messages.",
      "\nAdult's latest message:",
      userText,
      validationFeedback
        ? `\nCorrection required: the previous structured response was rejected because ${validationFeedback} Return a new response that follows the same instructions and corrects that problem.`
        : ""
    ].join("\n");
    const decisionPacket = global.SubscriptionGuardRecommendationEngine.buildDecisionPacket(state);
    const result = await requestResponse({
      instructions,
      input,
      textConfig: {
        verbosity: "medium",
        format: {
          type: "json_schema",
          name: "streaming_guard_conversation_turn",
          strict: true,
          schema: conversationResponseSchema()
        }
      },
      model,
      signal
    });
    let parsed;
    try {
      parsed = JSON.parse(result.text);
    } catch (cause) {
      const error = new Error(`${result.providerName} returned a conversational response that could not be parsed.`);
      error.cause = cause;
      throw error;
    }
    try {
      return {
        ...result,
        response: validateConversationResponse(parsed, recommendation, decisionPacket, state)
      };
    } catch (error) {
      error.output = parsed;
      error.model = result.model;
      error.provider = result.provider;
      error.responseId = result.responseId;
      error.usage = result.usage;
      throw error;
    }
  }

  async function createEvaluationJudgment({
    item,
    output,
    deterministicCriteria,
    knowledge,
    signal
  }) {
    const input = [
      `Evaluation ID: ${item.eval_id}`,
      `Case name: ${item.case_name}`,
      `Task type: ${item.task_type}`,
      "",
      "Fixed input:",
      item.input_summary,
      item.user_input ? `\nAdult request:\n${item.user_input}` : "",
      "",
      `Expected status: ${item.expected_status}`,
      `Expected action: ${item.expected_action}`,
      "Expected behavior:",
      item.expected_behavior,
      "",
      "Deterministic structured checks already completed by the application:",
      JSON.stringify(deterministicCriteria, null, 2),
      "",
      "Complete model output to judge:",
      JSON.stringify(output, null, 2)
    ].join("\n");
    const result = await requestResponse({
      instructions: evaluationJudgeInstructions(knowledge),
      input,
      model: readSettings().judgeModel,
      textConfig: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "streaming_guard_evaluation_judgment",
          strict: true,
          schema: evaluationJudgmentSchema()
        }
      },
      signal
    });
    let parsed;
    try {
      parsed = JSON.parse(result.text);
    } catch (cause) {
      const error = new Error(`${result.providerName} returned an evaluation judgment that could not be parsed.`);
      error.cause = cause;
      throw error;
    }
    try {
      return {
        ...result,
        judgment: validateEvaluationJudgment(parsed)
      };
    } catch (error) {
      error.output = parsed;
      error.model = result.model;
      error.provider = result.provider;
      error.responseId = result.responseId;
      error.usage = result.usage;
      throw error;
    }
  }

  global.SubscriptionGuardOpenAI = Object.freeze({
    DEFAULT_MODEL,
    JUDGE_MODEL,
    MODEL_OPTIONS,
    readSettings,
    saveSettings,
    clearSettings,
    modelInfo,
    providerForModel,
    providerName,
    keyForProvider,
    isModelConfigured,
    selectedModelsConfigured,
    missingSelectedProviders,
    createRecommendation,
    createResponse,
    createEvaluationJudgment,
    runtimeGroundingInstructions,
    immutableInstructions,
    recommendationTaskInstructions,
    conversationTaskInstructions,
    recommendationInstructions,
    conversationInstructions,
    evaluationJudgeInstructions,
    recommendationSchema,
    validateRecommendation,
    conversationResponseSchema,
    validateConversationResponse,
    evaluationJudgmentSchema,
    validateEvaluationJudgment
  });
})(window);
