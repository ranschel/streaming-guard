(function initializeMemoryStore(global) {
  "use strict";

  function createMemoryStore({
    storageKey,
    createSeedState,
    storage = global.localStorage,
    clock = () => new Date().toISOString()
  }) {
    if (!storageKey || typeof createSeedState !== "function") {
      throw new TypeError("storageKey and createSeedState are required.");
    }

    let state = load();

    function clone(value) {
      return JSON.parse(JSON.stringify(value));
    }

    function normalize(candidate) {
      const seed = createSeedState(candidate?.scenario?.id);
      const savedReview = { ...seed.review, ...(candidate.review || {}) };
      const seedTargetSubscription = seed.subscriptions.find(subscription =>
        subscription.serviceId === seed.scenario.targetServiceId
      );

      function migrateLegacyServiceUrls(value) {
        if (typeof value === "string") {
          return value
            .replaceAll("https://www.netflix.com/", seedTargetSubscription?.approvedAccountUrl || "")
            .replace(
              /https:\/\/example\.invalid\/[^/\s]+\/support/g,
              seedTargetSubscription?.approvedSupportUrl || ""
            );
        }
        if (Array.isArray(value)) return value.map(migrateLegacyServiceUrls);
        if (value && typeof value === "object") {
          return Object.fromEntries(
            Object.entries(value).map(([key, nestedValue]) => [key, migrateLegacyServiceUrls(nestedValue)])
          );
        }
        return value;
      }

      if (savedReview.generatedRecommendation) {
        savedReview.generatedRecommendation = migrateLegacyServiceUrls(savedReview.generatedRecommendation);
      }

      // Migrate prototypes saved before "Wait" was removed as a recommendation
      // action. Ordinary wording about waiting for a response or an external
      // action is unaffected.
      if (savedReview.resolutionAction === "wait") {
        savedReview.resolutionAction = "keep";
      }
      if (savedReview.generatedRecommendation?.actionType === "wait") {
        savedReview.generatedRecommendation = {
          ...savedReview.generatedRecommendation,
          actionType: "keep",
          action: "Keep the current subscription plan unchanged."
        };
      }
      if (typeof savedReview.adultDecision === "string") {
        savedReview.adultDecision = savedReview.adultDecision
          .replace(/\bchose to wait\b/gi, "chose to keep the current plan unchanged")
          .replace(/\baccepted recommendation to wait\b/gi, "accepted recommendation to keep the current plan unchanged");
      }
      if (
        savedReview.resolution === "external_action_confirmed" &&
        savedReview.externalActionConfirmed !== true
      ) {
        savedReview.progressStage = "external_action";
        savedReview.discussionStatus = "external_action_pending";
        savedReview.resolution = "recommendation_accepted";
        savedReview.status = "waiting_for_external_action";
        savedReview.nextExpectedInput = "external_action_confirmation";
        savedReview.resolvedAt = null;
        savedReview.adultDecision = "Agreed with final recommendation";
      }
      return {
        ...seed,
        ...candidate,
        household: { ...seed.household, ...(candidate.household || {}) },
        familyRules: { ...seed.familyRules, ...(candidate.familyRules || {}) },
        contextFreshness: { ...seed.contextFreshness, ...(candidate.contextFreshness || {}) },
        scenario: { ...seed.scenario, ...(candidate.scenario || {}) },
        review: savedReview,
        members: Array.isArray(candidate.members) ? candidate.members : seed.members,
        subscriptions: Array.isArray(candidate.subscriptions)
          ? candidate.subscriptions.map(subscription => {
              const seedSubscription = seed.subscriptions.find(item =>
                item.id === subscription.id || item.serviceId === subscription.serviceId
              );
              return {
                ...(seedSubscription || {}),
                ...subscription,
                approvedAccountUrl: seedSubscription?.approvedAccountUrl || subscription.approvedAccountUrl || "",
                approvedSupportUrl: seedSubscription?.approvedSupportUrl || subscription.approvedSupportUrl || ""
              };
            })
          : seed.subscriptions,
        viewing: Array.isArray(candidate.viewing) ? candidate.viewing : seed.viewing,
        watchlist: Array.isArray(candidate.watchlist) ? candidate.watchlist : seed.watchlist,
        householdWatchlist: Array.isArray(candidate.householdWatchlist) ? candidate.householdWatchlist : seed.householdWatchlist,
        householdViewing: Array.isArray(candidate.householdViewing) ? candidate.householdViewing : seed.householdViewing,
        householdViewingHistory: Array.isArray(candidate.householdViewingHistory) ? candidate.householdViewingHistory : seed.householdViewingHistory,
        householdSpendingHistory: Array.isArray(candidate.householdSpendingHistory)
          ? seed.householdSpendingHistory.map(seedRecord => {
              const savedRecord = candidate.householdSpendingHistory.find(record =>
                Number(record.monthOffset) === Number(seedRecord.monthOffset)
              );
              return savedRecord ? {
                ...seedRecord,
                ...savedRecord,
                recommendationSavings: Number.isFinite(Number(savedRecord.recommendationSavings))
                  ? Number(savedRecord.recommendationSavings)
                  : seedRecord.recommendationSavings
              } : seedRecord;
            })
          : seed.householdSpendingHistory,
        recommendationSavingsEvents: Array.isArray(candidate.recommendationSavingsEvents) ? candidate.recommendationSavingsEvents : seed.recommendationSavingsEvents,
        subscriptionChangeLog: Array.isArray(candidate.subscriptionChangeLog) ? candidate.subscriptionChangeLog : seed.subscriptionChangeLog,
        messages: Array.isArray(candidate.messages)
          ? candidate.messages.map(message => typeof message?.text === "string"
            ? {
                ...message,
                text: /^Manual scenario mode is ready\./i.test(message.text)
                  ? "Manual chat is ready. Ask any household streaming-subscription planning, management, viewing-access, or spending question, or tell me what changed. I can save explicit updates to subscriptions, plans, renewal details, viewing, watchlists, budgets, preferences, and family rules. If a required detail is missing, I’ll ask before saving anything."
                  : message.text.replace(
                      /\s+For example, you can ask me to subscribe to [^.]+ now\.$/i,
                      ""
                    )
              }
            : message)
          : [],
        toolAudit: Array.isArray(candidate.toolAudit) ? candidate.toolAudit : [],
        emailOutbox: Array.isArray(candidate.emailOutbox) ? candidate.emailOutbox : []
      };
    }

    function load() {
      try {
        const saved = storage.getItem(storageKey);
        return saved ? normalize(JSON.parse(saved)) : createSeedState();
      } catch (_) {
        return createSeedState();
      }
    }

    function persist() {
      state.review.updatedAt = clock();
      storage.setItem(storageKey, JSON.stringify(state));
    }

    return Object.freeze({
      getState() {
        return clone(state);
      },
      transact(mutator, { persist = true } = {}) {
        if (typeof mutator !== "function") throw new TypeError("mutator must be a function.");
        const draft = clone(state);
        const result = mutator(draft);
        state = normalize(draft);
        if (persist) this.save();
        return result;
      },
      save() {
        persist();
        return this.getState();
      },
      reset({ scenarioId } = {}) {
        storage.removeItem(storageKey);
        state = createSeedState(scenarioId);
        persist();
        return this.getState();
      },
      reload() {
        state = load();
        return this.getState();
      },
      storageKey
    });
  }

  global.SubscriptionGuardMemory = Object.freeze({ createMemoryStore });
})(window);
