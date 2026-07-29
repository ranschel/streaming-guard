(function initializeStreamingGuardContextSelector(global) {
  "use strict";

  const schemas = global.StreamingGuardStateSchemas;
  const traceFactory = global.StreamingGuardTraceManager;
  if (!schemas || !traceFactory) {
    throw new Error("Streaming Guard context-plan dependencies failed to load.");
  }

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\+/g, " plus ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function recordReason(source, recordId, includedBecause) {
    return { source, recordId, includedBecause };
  }

  function messageContainsName(message, name) {
    const normalizedName = normalize(name);
    if (!normalizedName) return false;
    return ` ${message} `.includes(` ${normalizedName} `);
  }

  function serviceAliases(serviceName) {
    const normalizedName = normalize(serviceName);
    return unique([
      normalizedName,
      normalizedName.replace(/\s+plus$/, ""),
      normalizedName.replace(/\s+(?:stream|play|tv|flix)$/, "")
    ]).filter(alias => alias.length >= 3);
  }

  function memberName(member) {
    return member.firstName || member.name || member.id;
  }

  function titlePriorityRank(priority) {
    return { high: 0, medium: 1, low: 2 }[String(priority || "").toLowerCase()] ?? 3;
  }

  function joinedLabels(values, emptyLabel = "none") {
    const labels = unique(values.map(value => String(value || "").trim()).filter(Boolean));
    return labels.length ? labels.join("; ") : emptyLabel;
  }

  function isBroadRequest(message) {
    return /\b(?:review everything|review all|all subscriptions|entire household|whole household|portfolio|current spending|budget utilization|how much (?:do )?(?:we|i) spend|reduce (?:our |my )?spending|cut (?:our |my )?spending|save (?:us |me )?money|optimi[sz]e|what should (?:we|i) subscribe|what (?:should|can) (?:we|i) add|subscribe to next|what should (?:we|i) watch next)\b/
      .test(message);
  }

  function isSubscriptionInventoryRequest(message) {
    return /\b(?:what subscriptions (?:do|does) (?:we|i|the household) have|which subscriptions (?:do|does) (?:we|i|the household) have|what (?:are )?(?:our|my|the household s) (?:current |active )?subscriptions|which subscriptions are (?:currently )?active|what (?:streaming )?services (?:do|does) (?:we|i|the household) have|which (?:streaming )?services (?:are we|am i|is the household) subscribed to|what (?:are we|am i|is the household) subscribed to|(?:list|show)(?: me)? (?:our|my|the household s|the current) subscriptions|current subscriptions|active subscriptions)\b/
      .test(message);
  }

  function isBroadSubscriptionDiscovery(message) {
    return /\b(?:what should (?:we|i) subscribe|what (?:should|can) (?:we|i) add|subscribe to next|new subscription|next subscription)\b/
      .test(message);
  }

  function isSpendingReview(message) {
    return /\b(?:reduce|cut|save|spend|spending|budget|cost|price|expensive|over budget|portfolio)\b/
      .test(message);
  }

  function selectionScope({ requestType, normalizedMessage }) {
    if (requestType === "recommendation") return "scenario";
    if (isSubscriptionInventoryRequest(normalizedMessage)) return "subscription_inventory";
    if (isBroadRequest(normalizedMessage)) return "household_wide";
    return "focused";
  }

  function selectionIntent({ requestType, scope, normalizedMessage, scenarioType }) {
    if (requestType === "recommendation") {
      return `recommendation:${scenarioType || "subscription_review"}`;
    }
    if (scope === "subscription_inventory") return "subscription_inventory";
    if (isBroadSubscriptionDiscovery(normalizedMessage)) return "subscription_discovery";
    if (isSpendingReview(normalizedMessage)) return "spending_review";
    return "focused_conversation";
  }

  function select({
    state,
    knowledge,
    decisionPacket = null,
    recommendation = null,
    userText = "",
    requestType = "conversation",
    reason = ""
  }) {
    if (!state || !knowledge) throw new TypeError("State and knowledge are required for context selection.");
    const normalizedMessage = normalize(`${userText} ${reason}`);
    const scope = selectionScope({ requestType, normalizedMessage });
    const subscriptionInventory = scope === "subscription_inventory";
    const broadSubscriptionDiscovery = isBroadSubscriptionDiscovery(normalizedMessage);
    const spendingReview = isSpendingReview(normalizedMessage);
    const provenance = [];
    const ambiguities = [];
    const selectedServiceIds = new Set();
    const selectedTitleIds = new Set();
    const selectedMemberIds = new Set();

    const servicesById = new Map();
    (knowledge.services || []).forEach(service => {
      if (!servicesById.has(service.service_id)) servicesById.set(service.service_id, []);
      servicesById.get(service.service_id).push(service);
    });
    const serviceNames = [...servicesById.entries()].map(([serviceId, plans]) => ({
      serviceId,
      serviceName: plans[0]?.service_name || serviceId
    }));
    const catalog = knowledge.catalog || [];
    const catalogByTitleId = new Map();
    catalog.forEach(record => {
      if (!catalogByTitleId.has(record.title_id)) catalogByTitleId.set(record.title_id, []);
      catalogByTitleId.get(record.title_id).push(record);
    });
    const watchlist = state.householdWatchlist || state.watchlist || [];

    if (requestType === "recommendation") {
      [
        state.scenario?.targetServiceId,
        state.scenario?.secondaryServiceId
      ].filter(Boolean).forEach(serviceId => selectedServiceIds.add(serviceId));
      if (state.scenario?.titleId) selectedTitleIds.add(state.scenario.titleId);
      (state.scenario?.supportingPriorityTitles || []).forEach(title => {
        if (title.titleId) selectedTitleIds.add(title.titleId);
        if (title.serviceId) selectedServiceIds.add(title.serviceId);
      });
      (state.scenario?.intendedViewerIds || []).forEach(memberId => selectedMemberIds.add(memberId));
      provenance.push(recordReason(
        "trigger_context",
        state.scenario?.id || "current",
        "Structured trigger directly identifies the target service, title, and intended viewers."
      ));
    } else {
      serviceNames.forEach(service => {
        if (serviceAliases(service.serviceName).some(alias => messageContainsName(normalizedMessage, alias))) {
          selectedServiceIds.add(service.serviceId);
          provenance.push(recordReason(
            "streaming_services.csv",
            service.serviceId,
            `The adult named ${service.serviceName}.`
          ));
        }
      });
      [...catalogByTitleId.entries()].forEach(([titleId, records]) => {
        const titleName = records[0]?.title_name;
        if (titleName && messageContainsName(normalizedMessage, titleName)) {
          selectedTitleIds.add(titleId);
          provenance.push(recordReason(
            "streaming_catalog.csv",
            titleId,
            `The adult named ${titleName}.`
          ));
        }
      });
      (state.members || []).forEach(member => {
        if (
          messageContainsName(normalizedMessage, member.firstName) ||
          messageContainsName(normalizedMessage, member.name)
        ) {
          selectedMemberIds.add(member.id);
          provenance.push(recordReason(
            "household_members_profile.json",
            member.id,
            `The adult named ${memberName(member)}.`
          ));
        }
      });

      const childMembers = (state.members || []).filter(member => Number(member.age) < 18);
      if (/\b(?:my child|my kid|the child|the kid)\b/.test(normalizedMessage)) {
        if (childMembers.length === 1) {
          selectedMemberIds.add(childMembers[0].id);
        } else if (childMembers.length > 1) {
          childMembers.forEach(member => selectedMemberIds.add(member.id));
          ambiguities.push({
            type: "viewer",
            message: "More than one child could match the adult’s wording.",
            options: childMembers.map(member => ({ id: member.id, label: memberName(member) }))
          });
        }
      }
      if (
        (!subscriptionInventory && /\b(?:family|household|everyone|we|us)\b/.test(normalizedMessage)) ||
        scope === "household_wide"
      ) {
        (state.members || []).forEach(member => selectedMemberIds.add(member.id));
      }

      const usesConversationReference = /\b(?:it|that service|this service|that title|this title|the recommendation)\b/
        .test(normalizedMessage);
      if (usesConversationReference && state.scenario) {
        if (state.scenario.targetServiceId) selectedServiceIds.add(state.scenario.targetServiceId);
        if (state.scenario.secondaryServiceId) selectedServiceIds.add(state.scenario.secondaryServiceId);
        if (state.scenario.titleId) selectedTitleIds.add(state.scenario.titleId);
        (state.scenario.intendedViewerIds || []).forEach(memberId => selectedMemberIds.add(memberId));
        provenance.push(recordReason(
          "conversation_state",
          state.scenario.id,
          "A conversational reference was resolved against the active scenario or displayed recommendation."
        ));
      }
    }

    if (subscriptionInventory) {
      (state.subscriptions || []).forEach(subscription => selectedServiceIds.add(subscription.serviceId));
      provenance.push(recordReason(
        "household_subscriptions.csv",
        "current_household_subscriptions",
        "The adult requested the household’s current subscription inventory."
      ));
    } else if (scope === "household_wide") {
      if (broadSubscriptionDiscovery) {
        watchlist
          .filter(entry => entry.status !== "completed")
          .sort((left, right) =>
            titlePriorityRank(left.priority) - titlePriorityRank(right.priority)
          )
          .slice(0, 12)
          .forEach(entry => {
            selectedTitleIds.add(entry.titleId);
            selectedMemberIds.add(entry.memberId);
            provenance.push(recordReason(
              "watchlist.csv",
              entry.id || entry.titleId,
              "An unfinished household watchlist need may justify a future subscription."
            ));
          });
      } else {
        watchlist.forEach(entry => {
          selectedTitleIds.add(entry.titleId);
          selectedMemberIds.add(entry.memberId);
        });
      }
      (state.subscriptions || [])
        .filter(subscription => spendingReview ? subscription.status === "active" : true)
        .forEach(subscription => selectedServiceIds.add(subscription.serviceId));
    }

    selectedTitleIds.forEach(titleId => {
      (catalogByTitleId.get(titleId) || []).forEach(record => {
        if (record.available_service_id) selectedServiceIds.add(record.available_service_id);
        if (record.migration_service_id) selectedServiceIds.add(record.migration_service_id);
      });
      watchlist.filter(entry => entry.titleId === titleId).forEach(entry => selectedMemberIds.add(entry.memberId));
      (state.viewing || []).filter(entry => entry.titleId === titleId).forEach(entry => selectedMemberIds.add(entry.memberId));
    });

    if (!subscriptionInventory) {
      selectedServiceIds.forEach(serviceId => {
        catalog
          .filter(record =>
            record.available_service_id === serviceId ||
            record.migration_service_id === serviceId
          )
          .forEach(record => {
            if (
              selectedTitleIds.has(record.title_id) ||
              watchlist.some(entry =>
                entry.titleId === record.title_id &&
                entry.status !== "completed" &&
                ["high", "medium"].includes(String(entry.priority || "").toLowerCase())
              )
            ) {
              selectedTitleIds.add(record.title_id);
            }
          });
      });
    }

    if (
      requestType === "conversation" &&
      scope === "focused" &&
      !selectedServiceIds.size &&
      !selectedTitleIds.size &&
      !selectedMemberIds.size
    ) {
      if (recommendation || state.review?.generatedRecommendation) {
        if (state.scenario?.targetServiceId) selectedServiceIds.add(state.scenario.targetServiceId);
        if (state.scenario?.secondaryServiceId) selectedServiceIds.add(state.scenario.secondaryServiceId);
        if (state.scenario?.titleId) selectedTitleIds.add(state.scenario.titleId);
        (state.scenario?.intendedViewerIds || []).forEach(memberId => selectedMemberIds.add(memberId));
        provenance.push(recordReason(
          "displayed_recommendation",
          state.scenario?.id || "current",
          "No new entity was named, so the message remains scoped to the displayed recommendation."
        ));
      } else if (!ambiguities.length) {
        ambiguities.push({
          type: "scope",
          message: "No service, title, viewer, or household-wide planning intent was identified.",
          options: []
        });
      }
    }

    const financialRequest = requestType === "recommendation" ||
      spendingReview ||
      /\b(?:subscribe|cancel|pause|renew|plan|payment|budget|cost|price)\b/.test(normalizedMessage);
    const selectedSubscriptions = (state.subscriptions || []).filter(subscription =>
      selectedServiceIds.has(subscription.serviceId) ||
      (scope === "household_wide" && subscription.status === "active")
    );
    const selectedMembers = (state.members || []).filter(member =>
      scope === "household_wide" ||
      selectedMemberIds.has(member.id) ||
      member.id === state.household?.authorizedAdultMemberId
    );
    const selectedViewing = subscriptionInventory ? [] : (state.viewing || []).filter(record =>
      (!selectedTitleIds.size || selectedTitleIds.has(record.titleId)) &&
      (!selectedMemberIds.size || selectedMemberIds.has(record.memberId))
    );
    const selectedWatchlist = subscriptionInventory ? [] : watchlist.filter(record =>
      (!selectedTitleIds.size || selectedTitleIds.has(record.titleId)) &&
      (!selectedMemberIds.size || selectedMemberIds.has(record.memberId))
    );
    const selectedHistory = subscriptionInventory ? [] : (state.householdViewingHistory || []).filter(record =>
      (!selectedTitleIds.size || selectedTitleIds.has(record.titleId)) &&
      (!selectedMemberIds.size || selectedMemberIds.has(record.memberId))
    );
    const selectedCatalog = catalog
      .filter(record => selectedTitleIds.has(record.title_id))
      .map(record => ({
        ...record,
        _provenance: record._provenance || schemas.provenance({
          source: "streaming_catalog.csv",
          recordedAt: state.systemDate,
          verifiedAt: state.systemDate,
          confidence: "prototype_record"
        })
      }));
    const selectedPlans = (knowledge.services || [])
      .filter(plan => selectedServiceIds.has(plan.service_id))
      .map(plan => ({
        ...plan,
        _provenance: plan._provenance || schemas.provenance({
          source: "streaming_services.csv",
          recordedAt: state.systemDate,
          verifiedAt: state.systemDate,
          confidence: "prototype_record"
        })
      }));
    const selectedChanges = (state.subscriptionChangeLog || []).filter(change =>
      !change.serviceId || selectedServiceIds.has(change.serviceId)
    );

    const selectedRecordCounts = {
      household: state.household ? 1 : 0,
      familyRules: state.familyRules ? 1 : 0,
      members: selectedMembers.length,
      subscriptions: selectedSubscriptions.length,
      viewing: selectedViewing.length,
      watchlist: selectedWatchlist.length,
      viewingHistory: selectedHistory.length,
      catalog: selectedCatalog.length,
      servicePlans: selectedPlans.length,
      subscriptionChanges: selectedChanges.length,
      decisionFacts: decisionPacket ? 1 : 0
    };
    const requiredRecordTypes = unique([
      "household",
      "familyRules",
      "authorizedAdult",
      ...(scope === "subscription_inventory" ? ["subscriptions"] : []),
      ...(financialRequest ? ["subscriptions", "servicePlans", "budget"] : []),
      ...(selectedTitleIds.size ? ["catalog", "watchlist", "viewing"] : []),
      ...(requestType === "recommendation" ? ["triggerContext", "decisionFacts"] : [])
    ]);
    const missingRequirements = [];
    if (!state.household) missingRequirements.push("household");
    if (!state.familyRules) missingRequirements.push("familyRules");
    if (!selectedMembers.some(member => member.id === state.household?.authorizedAdultMemberId)) {
      missingRequirements.push("authorizedAdult");
    }
    if (requiredRecordTypes.includes("subscriptions") && !Array.isArray(state.subscriptions)) {
      missingRequirements.push("subscriptions");
    }
    if (requiredRecordTypes.includes("servicePlans") && !selectedPlans.length) {
      missingRequirements.push("servicePlans");
    }
    if (requiredRecordTypes.includes("catalog") && !selectedCatalog.length) {
      missingRequirements.push("catalog");
    }
    if (requiredRecordTypes.includes("decisionFacts") && !decisionPacket) {
      missingRequirements.push("decisionFacts");
    }
    const contextPlan = {
      schemaVersion: schemas.versions.contextPlan,
      intent: selectionIntent({
        requestType,
        scope,
        normalizedMessage,
        scenarioType: state.scenario?.scenarioType
      }),
      scope,
      entityIds: {
        services: [...selectedServiceIds],
        titles: [...selectedTitleIds],
        members: [...selectedMemberIds]
      },
      requiredRecordTypes,
      selectedRecordCounts,
      missingRequirements: unique(missingRequirements),
      selectionReasons: provenance,
      tokenBudget: {
        scenario: 9000,
        focused: 7000,
        subscription_inventory: 5000,
        household_wide: 12000
      }[scope],
      contextHash: traceFactory.stableHash({
        householdRevision: state.householdRevision || 0,
        scope,
        entities: {
          services: [...selectedServiceIds],
          titles: [...selectedTitleIds],
          members: [...selectedMemberIds]
        },
        records: {
          counts: selectedRecordCounts,
          subscriptions: selectedSubscriptions.map(record => ({
            serviceId: record.serviceId,
            planId: record.planId,
            status: record.status,
            monthlyCost: record.monthlyCost,
            nextRenewal: record.nextRenewal,
            expirationDate: record.expirationDate
          })),
          catalog: selectedCatalog.map(record => ({
            titleId: record.title_id,
            serviceId: record.available_service_id,
            availabilityStart: record.availability_start,
            availabilityEnd: record.availability_end,
            migrationServiceId: record.migration_service_id,
            migrationDate: record.migration_date
          })),
          plans: selectedPlans.map(record => ({
            serviceId: record.service_id,
            planId: record.plan_id,
            monthlyPrice: record.monthly_price,
            pauseEligible: record.pause_eligible,
            maxPauseDays: record.max_pause_days
          })),
          familyRules: state.familyRules
        }
      }),
      coverageStatus: ambiguities.length
        ? "clarification_required"
        : missingRequirements.length
          ? "incomplete"
          : "complete"
    };
    schemas.validateContextPlan(contextPlan);

    const activeSubscriptions = (state.subscriptions || []).filter(subscription => subscription.status === "active");
    const activeMonthlySpend = activeSubscriptions.reduce(
      (sum, subscription) => sum + Number(subscription.monthlyCost || 0),
      0
    );
    const monthlyBudgetCap = Number(state.familyRules?.monthlyBudgetCap || 0);
    const candidateServices = [...selectedServiceIds].map(serviceId => {
      const plans = servicesById.get(serviceId) || [];
      const titleIds = unique(selectedCatalog
        .filter(record =>
          record.available_service_id === serviceId ||
          record.migration_service_id === serviceId
        )
        .map(record => record.title_id));
      const relevantTitles = titleIds.map(titleId => {
        const catalogRecord = (catalogByTitleId.get(titleId) || [])[0];
        const priorities = selectedWatchlist
          .filter(entry => entry.titleId === titleId)
          .map(entry => entry.priority);
        return {
          titleId,
          titleName: catalogRecord?.title_name || titleId,
          priorities: unique(priorities)
        };
      });
      const monthlyPrices = plans.map(plan => Number(plan.monthly_price)).filter(Number.isFinite);
      return {
        serviceId,
        serviceName: plans[0]?.service_name || serviceId,
        alreadyActive: activeSubscriptions.some(subscription => subscription.serviceId === serviceId),
        lowestMonthlyPrice: monthlyPrices.length ? Math.min(...monthlyPrices) : null,
        relevantTitles
      };
    });

    const householdContext = {
      current_date: state.systemDate,
      context_scope: scope,
      context_selection: {
        selected_service_ids: [...selectedServiceIds],
        selected_title_ids: [...selectedTitleIds],
        selected_member_ids: [...selectedMemberIds],
        ambiguities,
        provenance
      },
      context_plan: contextPlan,
      trigger_context: requestType === "recommendation"
        ? decisionPacket?.triggerContext || state.scenario
        : {
            triggerType: state.scenario?.triggerType || "manual_chat",
            scenarioType: state.scenario?.scenarioType || null
          },
      context_freshness: state.contextFreshness,
      household: state.household,
      family_members: selectedMembers,
      current_family_rules: state.familyRules,
      current_subscriptions: selectedSubscriptions,
      recent_subscription_changes: selectedChanges,
      viewing_information: selectedViewing,
      household_watchlist: selectedWatchlist,
      recent_completed_viewing: selectedHistory,
      portfolio_summary: {
        activeSubscriptionCount: activeSubscriptions.length,
        activeMonthlySpend,
        annualizedSpend: activeMonthlySpend * 12,
        monthlyBudgetCap,
        budgetRemaining: monthlyBudgetCap - activeMonthlySpend
      },
      candidate_services: candidateServices,
      decision_facts_and_calculations: requestType === "recommendation" || recommendation
        ? decisionPacket
        : null,
      displayed_recommendation: recommendation,
      review_state: {
        discussionStatus: state.review?.discussionStatus,
        nextExpectedInput: state.review?.nextExpectedInput,
        safetyDisposition: state.review?.safetyDisposition,
        pendingContextUpdates: state.review?.pendingContextUpdates || []
      }
    };

    const sourceTrace = [
      {
        name: "household_profile.json",
        detail: `${state.household?.territory || state.household?.billingRegion || "Household"} · authorized adult ${memberName(
          (state.members || []).find(member => member.id === state.household?.authorizedAdultMemberId) || {}
        )}`
      },
      {
        name: "family_rules.json",
        detail: `$${monthlyBudgetCap.toFixed(2)} monthly budget plus household and member content rules`
      },
      {
        name: "household_members_profile.json",
        detail: joinedLabels(selectedMembers.map(member =>
          `${memberName(member)}${Number(member.age) < 18 ? ` (age ${member.age})` : ""}`
        ))
      },
      {
        name: "household_subscriptions.csv",
        detail: joinedLabels(selectedSubscriptions.map(subscription =>
          `${subscription.service} — ${subscription.plan} (${subscription.status})`
        ))
      }
    ];
    const recentMessageCount = Math.min(10, (state.messages || []).filter(message => message.text).length);
    if (recentMessageCount) sourceTrace.push({
      name: "recent conversation",
      detail: `${recentMessageCount} most recent retained chat message${recentMessageCount === 1 ? "" : "s"}`
    });
    if (selectedViewing.length) sourceTrace.push({
      name: "viewing_status.csv",
      detail: joinedLabels(selectedViewing.map(record => {
        const member = (state.members || []).find(item => item.id === record.memberId);
        const title = (catalogByTitleId.get(record.titleId) || [])[0];
        return `${memberName(member || {})}: ${title?.title_name || record.titleId} — ${record.status}`;
      }))
    });
    if (selectedWatchlist.length) sourceTrace.push({
      name: "watchlist.csv",
      detail: joinedLabels(selectedWatchlist.map(record => {
        const member = (state.members || []).find(item => item.id === record.memberId);
        return `${memberName(member || {})}: ${record.title} — ${record.priority} priority, ${record.status}`;
      }))
    });
    if (selectedCatalog.length) sourceTrace.push({
      name: "streaming_catalog.csv",
      detail: joinedLabels(selectedCatalog.map(record =>
        `${record.title_name} on ${
          serviceNames.find(service => service.serviceId === record.available_service_id)?.serviceName ||
          record.available_service_id
        }`
      ))
    });
    if (selectedPlans.length) sourceTrace.push({
      name: "streaming_services.csv",
      detail: joinedLabels(selectedPlans.map(plan =>
        `${plan.service_name} — ${plan.plan_name} ($${Number(plan.monthly_price || 0).toFixed(2)}/month)`
      ))
    });

    const policies = [
      { name: "core_system_prompt.md", detail: "Scope, advisory boundary, child safety, and adult control" },
      {
        name: requestType === "recommendation" ? "recommendation_add_on.md" : "conversation_add_on.md",
        detail: requestType === "recommendation"
          ? "Structured recommendation contract"
          : "Conversation and context-update contract"
      },
      { name: "immutable_escalation_policy.md", detail: "Mandatory escalation boundaries" },
      { name: "runtime_grounding_rules.md", detail: "Grounded records, dates, calculations, and URLs" }
    ];
    const tools = [
      { name: "select_context", detail: `${scope.replaceAll("_", " ")} context selected from resolved entities and relationships` },
      { name: "load_household_context", detail: "Loaded only the selected household records" }
    ];
    if (selectedCatalog.length) tools.push({
      name: "query_catalog",
      detail: `${selectedCatalog.length} related catalog record${selectedCatalog.length === 1 ? "" : "s"} selected`
    });
    if (selectedPlans.length) tools.push({
      name: "get_service_details",
      detail: `${selectedPlans.length} related plan${selectedPlans.length === 1 ? "" : "s"} selected`
    });
    if (financialRequest) tools.push({
      name: "calculate_plan_financial_impact",
      detail: "Current portfolio totals and relevant action calculations included"
    });
    return Object.freeze({
      scope,
      contextPlan,
      householdContext,
      servicePlans: selectedPlans,
      catalogTitles: selectedCatalog,
      trace: {
        sources: sourceTrace,
        policies,
        tools,
        memoryOutcome: "Household context read; no persistent change yet.",
        validationOutcome: contextPlan.coverageStatus === "clarification_required"
          ? `${ambiguities.length} unresolved context ambiguity requires clarification.`
          : contextPlan.coverageStatus === "incomplete"
            ? `Context coverage is incomplete: ${contextPlan.missingRequirements.join(", ")}.`
            : "Selected context is grounded in stored records and relationship links."
      }
    });
  }

  global.StreamingGuardContextSelector = Object.freeze({
    normalize,
    isBroadRequest,
    isSubscriptionInventoryRequest,
    select
  });
})(window);
