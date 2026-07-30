(function initializeMemoryStore(global) {
  "use strict";

  const schemas = global.StreamingGuardStateSchemas;
  const persistence = global.StreamingGuardPersistence;
  const workflowEngine = global.StreamingGuardWorkflow;
  if (!schemas || !persistence || !workflowEngine) {
    throw new Error("Streaming Guard state, persistence, and workflow dependencies failed to load.");
  }

  const HOUSEHOLD_DATA_FORMAT = "streaming-guard-household-data";
  const HOUSEHOLD_DATA_VERSION = 1;

  function containsSensitiveAccountInformation(text) {
    const value = String(text || "");
    const labeledSecret =
      /\b(?:password|passcode|pin|cvv|cvc|security code|authentication code|verification code|one[- ]time code|otp|api key|secret key|routing number|bank account|account number)\b\s*(?:is|:|=)\s*\S+/i;
    const paymentCardNumber = /\b(?:\d[ -]*?){13,19}\b/;
    const providerKey = /\b(?:sk|pk|api)[-_][A-Za-z0-9_-]{12,}\b/;
    const bearerToken = /\bbearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i;
    return labeledSecret.test(value) ||
      paymentCardNumber.test(value) ||
      providerKey.test(value) ||
      bearerToken.test(value);
  }

  function createMemoryStore({
    storageKey,
    createSeedState,
    storage = global.localStorage,
    clock = () => new Date().toISOString()
  }) {
    if (!storageKey || typeof createSeedState !== "function") {
      throw new TypeError("storageKey and createSeedState are required.");
    }

    const adapter = persistence.createLocalStorageJsonAdapter(storage);
    const householdStorageKey = `${storageKey}.household.v1`;
    const sessionStorageKey = `${storageKey}.session.v1`;
    const householdRepository = persistence.createVersionedRepository({
      adapter,
      key: householdStorageKey,
      validate: schemas.validateHouseholdDocument,
      revisionField: "householdRevision",
      clock
    });
    const sessionRepository = persistence.createVersionedRepository({
      adapter,
      key: sessionStorageKey,
      validate: schemas.validateSessionDocument,
      revisionField: "sessionRevision",
      clock
    });

    function clone(value) {
      return schemas.clone(value);
    }

    function seedState(scenarioId) {
      const seed = createSeedState(scenarioId);
      seed.householdRevision = 0;
      seed.sessionRevision = 0;
      seed.appliedCommandIds = [];
      seed.workflow = workflowEngine.initial();
      seed.traces = [];
      return schemas.annotateRecords(seed);
    }

    function normalize(candidate = {}) {
      const seed = seedState(candidate?.scenario?.id);
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
      if (savedReview.resolutionAction === "wait") savedReview.resolutionAction = "keep";
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
      if (savedReview.resolution === "external_action_confirmed" && savedReview.externalActionConfirmed !== true) {
        Object.assign(savedReview, {
          progressStage: "external_action",
          discussionStatus: "external_action_pending",
          resolution: "recommendation_accepted",
          status: "waiting_for_external_action",
          nextExpectedInput: "external_action_confirmation",
          resolvedAt: null,
          adultDecision: "Agreed with final recommendation"
        });
      }

      const next = {
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
        recommendationSavingsEvents: Array.isArray(candidate.recommendationSavingsEvents)
          ? candidate.recommendationSavingsEvents
          : seed.recommendationSavingsEvents,
        subscriptionChangeLog: Array.isArray(candidate.subscriptionChangeLog)
          ? candidate.subscriptionChangeLog
          : seed.subscriptionChangeLog,
        messages: Array.isArray(candidate.messages)
          ? candidate.messages
            .filter(message =>
              !/^Manual (?:scenario mode|chat) is ready\./i.test(message?.text || "") &&
              !message?.redacted &&
              !containsSensitiveAccountInformation(message?.text)
            )
            .map(message => {
              if (typeof message?.text !== "string") return message;
              return {
                ...message,
                text: message.text.replace(
                  /\s+For example, you can ask me to subscribe to [^.]+ now\.$/i,
                  ""
                )
              };
            })
          : [],
        toolAudit: Array.isArray(candidate.toolAudit) ? candidate.toolAudit : [],
        traces: Array.isArray(candidate.traces) ? candidate.traces : [],
        appliedCommandIds: Array.isArray(candidate.appliedCommandIds) ? candidate.appliedCommandIds : [],
        householdRevision: Number.isInteger(candidate.householdRevision) ? candidate.householdRevision : 0,
        sessionRevision: Number.isInteger(candidate.sessionRevision) ? candidate.sessionRevision : 0
      };
      next.workflow = candidate.workflow && workflowEngine.states.includes(candidate.workflow.state)
        ? candidate.workflow
        : {
            ...workflowEngine.initial(),
            state: workflowEngine.deriveFromReview(savedReview)
          };
      return schemas.annotateRecords(next);
    }

    function domainFingerprint(document, revisionField) {
      const copy = clone(document);
      delete copy[revisionField];
      return JSON.stringify(copy);
    }

    function persistState(nextState) {
      nextState.review.updatedAt = clock();
      const documents = schemas.splitState(normalize(nextState));
      const storedHousehold = householdRepository.load();
      let savedHousehold = storedHousehold;
      if (!storedHousehold ||
          domainFingerprint(storedHousehold, "householdRevision") !==
          domainFingerprint(documents.household, "householdRevision")) {
        savedHousehold = householdRepository.save(documents.household, {
          expectedRevision: storedHousehold?.householdRevision ?? null
        });
      }
      const storedSession = sessionRepository.load();
      const savedSession = sessionRepository.save(documents.session, {
        expectedRevision: storedSession?.sessionRevision ?? null
      });
      return normalize(schemas.combineState(savedHousehold || documents.household, savedSession));
    }

    function load() {
      try {
        const household = householdRepository.load();
        const session = sessionRepository.load();
        if (household && session) return normalize(schemas.combineState(household, session));

        const legacy = adapter.read(storageKey);
        if (legacy) {
          const seed = seedState(legacy?.scenario?.id);
          const migrated = schemas.migrateLegacyState(normalize(legacy), seed);
          householdRepository.replace(migrated.household);
          sessionRepository.replace(migrated.session);
          adapter.remove(storageKey);
          return normalize(schemas.combineState(migrated.household, migrated.session));
        }
      } catch (_) {
        householdRepository.remove();
        sessionRepository.remove();
      }
      return persistState(seedState());
    }

    let state = load();

    function validateHouseholdDataExport(candidate) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new Error("This file is not a valid Streaming Guard household-data export.");
      }
      if (candidate.format !== HOUSEHOLD_DATA_FORMAT || candidate.version !== HOUSEHOLD_DATA_VERSION) {
        throw new Error("This file uses an unsupported household-data format or version.");
      }
      if (candidate.household) return schemas.validateHouseholdDocument(clone(candidate.household));
      if (candidate.memory) return schemas.splitState(normalize(candidate.memory)).household;
      throw new Error("The household-data export does not contain durable household memory.");
    }

    return Object.freeze({
      getState() {
        return clone(state);
      },
      transact(mutator, {
        persist = true,
        expectedHouseholdRevision = null
      } = {}) {
        if (typeof mutator !== "function") throw new TypeError("mutator must be a function.");
        if (expectedHouseholdRevision != null &&
            Number(state.householdRevision) !== Number(expectedHouseholdRevision)) {
          const error = new Error(
            `Household state is at revision ${state.householdRevision}, not ${expectedHouseholdRevision}.`
          );
          error.code = "revision_conflict";
          throw error;
        }
        const draft = clone(state);
        const result = mutator(draft);
        state = normalize(draft);
        if (persist) state = persistState(state);
        return result;
      },
      dispatchWorkflow(event, details = {}) {
        const timestamp = details.timestamp || clock();
        this.transact(draft => {
          draft.workflow = workflowEngine.transition(draft.workflow, event, {
            ...details,
            timestamp
          });
        });
        return this.getState().workflow;
      },
      save() {
        state = persistState(state);
        return this.getState();
      },
      reset({ scenarioId } = {}) {
        adapter.remove(storageKey);
        householdRepository.remove();
        sessionRepository.remove();
        state = persistState(seedState(scenarioId));
        return this.getState();
      },
      reload() {
        state = load();
        return this.getState();
      },
      exportHouseholdData() {
        return {
          format: HOUSEHOLD_DATA_FORMAT,
          version: HOUSEHOLD_DATA_VERSION,
          product: "Streaming Guard",
          exportedAt: clock(),
          household: schemas.splitState(state).household
        };
      },
      importHouseholdData(candidate) {
        const importedHousehold = validateHouseholdDataExport(candidate);
        const freshSession = schemas.splitState(seedState(state.scenario?.id)).session;
        householdRepository.replace(importedHousehold);
        sessionRepository.replace(freshSession);
        adapter.remove(storageKey);
        state = normalize(schemas.combineState(importedHousehold, freshSession));
        return this.getState();
      },
      householdRevision() {
        return Number(state.householdRevision || 0);
      },
      storageKey,
      storageKeys: Object.freeze({
        legacy: storageKey,
        household: householdStorageKey,
        session: sessionStorageKey
      })
    });
  }

  global.StreamingGuardMemory = Object.freeze({
    createMemoryStore,
    containsSensitiveAccountInformation,
    householdDataFormat: HOUSEHOLD_DATA_FORMAT,
    householdDataVersion: HOUSEHOLD_DATA_VERSION
  });
})(window);
