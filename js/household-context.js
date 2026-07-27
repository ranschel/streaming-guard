(function initializeHouseholdContext(global) {
  "use strict";

  const knowledge = global.SubscriptionGuardKnowledge;
  const config = global.SubscriptionGuardScenarioConfig;
  const math = global.SubscriptionGuardMath;
  if (!knowledge || !config || !math) throw new Error("Streaming Guard context dependencies failed to load.");

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function firstName(name) {
    return String(name || "").trim().split(/\s+/)[0];
  }

  function findPlan(serviceId, planId) {
    const plan = knowledge.services.find(record => record.service_id === serviceId && record.plan_id === planId);
    if (!plan) throw new RangeError(`No plan record found for ${serviceId}/${planId}.`);
    return plan;
  }

  function createScenarioState(scenarioId = config.activeScenarioId) {
    const scenarioRecord = knowledge.agentEvals.find(record => record.case_id === scenarioId);
    if (!scenarioRecord) throw new RangeError(`No scenario record found for ${scenarioId}.`);

    const householdProfile = knowledge.householdProfile;
    const baselineSystemDate = scenarioRecord.system_date;
    const scenarioSubscriptionRows = knowledge.scenarioSubscriptions.filter(record => record.case_id === scenarioId);
    const subscriptionRows = scenarioSubscriptionRows.length ? scenarioSubscriptionRows : knowledge.householdSubscriptions;

    const subscriptions = subscriptionRows.map(record => {
      const plan = findPlan(record.service_id, record.plan_id);
      const householdRecord = knowledge.householdSubscriptions.find(subscription =>
        subscription.household_id === scenarioRecord.household_id &&
        subscription.service_id === record.service_id
      );
      const renewalDate = record.next_renewal_date || householdRecord?.next_renewal_date || "";
      const expirationDate = record.expiration_date || householdRecord?.expiration_date || "";
      return {
        id: record.scenario_subscription_id || record.subscription_id,
        serviceId: record.service_id,
        service: plan.service_name,
        planId: record.plan_id,
        plan: plan.plan_name,
        status: record.status,
        monthlyCost: Number(record.monthly_cost),
        planMonthlyCost: Number(plan.monthly_price || 0),
        planAnnualCost: plan.annual_price ? Number(plan.annual_price) : null,
        planUpfrontCost: Number(plan.upfront_cost || plan.monthly_price || 0),
        billingCadence: record.billing_cadence,
        renewalStatus: record.renewal_status || householdRecord?.renewal_status || "auto_renew",
        renewalOffsetDays: renewalDate
          ? math.daysBetween(baselineSystemDate, renewalDate)
          : null,
        nextRenewal: null,
        expirationOffsetDays: expirationDate
          ? math.daysBetween(baselineSystemDate, expirationDate)
          : null,
        expirationDate: null,
        prepaidThrough: record.prepaid_through || null,
        promotionOrBundle: record.promotion_or_bundle || "none",
        commitmentTerms: record.commitment_terms || "",
        cancellationConsequences: record.cancellation_consequences || "",
        pauseEligible: plan.pause_eligible === "true",
        maxPauseDays: Number(plan.max_pause_days || 0),
        maxPauseMonths: Number(plan.max_pause_months || 0),
        pauseTerms: plan.pause_terms || "not_available",
        postCancellationMonthlyCost: record.post_cancellation_monthly_cost
          ? Number(record.post_cancellation_monthly_cost)
          : null,
        forfeitedValue: record.forfeited_value
          ? Number(record.forfeited_value)
          : 0,
        approvedAccountUrl: plan.approved_account_url || "",
        approvedSupportUrl: plan.approved_support_url || ""
      };
    });

    const members = knowledge.householdMembers
      .filter(member => member.household_id === scenarioRecord.household_id)
      .map(member => ({
        id: member.member_id,
        name: member.name,
        firstName: firstName(member.name),
        age: member.age,
        role: member.role,
        preferences: member.preferences,
        viewingPriority: member.viewing_priority
      }));

    const viewing = knowledge.viewingStatus
      .filter(record => record.case_id === scenarioId && record.title_id === scenarioRecord.title_id)
      .map(record => ({
        id: record.viewing_id,
        titleId: record.title_id,
        memberId: record.member_id,
        status: record.status,
        progressPercent: Number(record.progress_percent || 0),
        completionOffsetDays: record.date_completed
          ? math.daysBetween(baselineSystemDate, record.date_completed)
          : null,
        completedOn: null,
        reportOffsetDays: record.reported_date
          ? math.daysBetween(baselineSystemDate, record.reported_date)
          : null,
        reportedOn: null,
        source: record.report_source,
        notes: record.notes
      }));

    const watchlist = knowledge.watchlist
      .filter(record => record.case_id === scenarioId)
      .map(record => ({
        id: record.watchlist_id,
        memberId: record.member_id,
        titleId: record.title_id,
        title: record.title_name,
        contentType: record.content_type,
        priority: record.priority,
        status: record.watchlist_status,
        completionOffsetDays: record.date_completed
          ? math.daysBetween(baselineSystemDate, record.date_completed)
          : null,
        completedOn: null,
        acceptableWaitDays: Number(record.acceptable_wait_days || 0),
        nextReleaseLabel: record.next_release_label || "",
        nextReleaseOffsetDays: record.next_air_start_date
          ? math.daysBetween(baselineSystemDate, record.next_air_start_date)
          : null,
        nextReleaseDate: null,
        releasePattern: record.release_pattern,
        episodeCount: Number(record.episode_count || 0),
        notes: record.notes
      }));

    const householdCases = knowledge.agentEvals.filter(record => record.household_id === householdProfile.household_id);
    const householdCaseDates = new Map(householdCases.map(record => [record.case_id, record.system_date]));
    const householdCaseIds = new Set(householdCases.map(record => record.case_id));

    const householdWatchlist = knowledge.watchlist
      .filter(record => householdCaseIds.has(record.case_id))
      .map(record => {
        const caseDate = householdCaseDates.get(record.case_id);
        return {
          id: record.watchlist_id,
          caseId: record.case_id,
          memberId: record.member_id,
          titleId: record.title_id,
          title: record.title_name,
          contentType: record.content_type,
          priority: record.priority,
          status: record.watchlist_status,
          acceptableWaitDays: Number(record.acceptable_wait_days || 0),
          completionOffsetDays: record.date_completed ? math.daysBetween(caseDate, record.date_completed) : null,
          completedOn: null,
          nextReleaseLabel: record.next_release_label || "",
          nextReleaseOffsetDays: record.next_air_start_date ? math.daysBetween(caseDate, record.next_air_start_date) : null,
          nextReleaseDate: null,
          releasePattern: record.release_pattern || ""
        };
      });

    const householdViewing = knowledge.viewingStatus
      .filter(record => householdCaseIds.has(record.case_id))
      .map(record => {
        const caseDate = householdCaseDates.get(record.case_id);
        const title = knowledge.catalog.find(item => item.case_id === record.case_id && item.title_id === record.title_id);
        return {
          id: record.viewing_id,
          caseId: record.case_id,
          memberId: record.member_id,
          titleId: record.title_id,
          title: title?.title_name || record.title_id,
          status: record.status,
          progressPercent: Number(record.progress_percent || 0),
          completionOffsetDays: record.date_completed ? math.daysBetween(caseDate, record.date_completed) : null,
          completedOn: null
        };
      });
    const householdViewingHistory = householdViewing.filter(record => record.status === "completed");
    const latestOffset = offsets => offsets.length ? Math.min(0, Math.max(...offsets)) : 0;
    const householdProfileOffset = householdProfile.profile_updated_at
      ? math.daysBetween(baselineSystemDate, householdProfile.profile_updated_at)
      : 0;
    const subscriptionConfirmedOffset = latestOffset(subscriptionRows
      .filter(record => record.record_updated_at)
      .map(record => math.daysBetween(baselineSystemDate, record.record_updated_at)));
    const watchlistConfirmedOffset = latestOffset(knowledge.watchlist
      .filter(record => householdCaseIds.has(record.case_id) && record.added_date)
      .map(record => math.daysBetween(householdCaseDates.get(record.case_id), record.added_date)));
    const viewingConfirmedOffset = latestOffset(knowledge.viewingStatus
      .filter(record => householdCaseIds.has(record.case_id) && record.reported_date)
      .map(record => math.daysBetween(householdCaseDates.get(record.case_id), record.reported_date)));

    const titleRecord = knowledge.catalog.find(record =>
      record.case_id === scenarioId && record.title_id === scenarioRecord.title_id
    );
    if (!titleRecord) throw new RangeError(`No catalog record found for ${scenarioRecord.title_id}.`);

    const targetSubscription = subscriptions.find(subscription => subscription.serviceId === scenarioRecord.primary_service_id);
    if (!targetSubscription) throw new RangeError(`No target subscription found for ${scenarioRecord.primary_service_id}.`);
    const targetPlan = findPlan(targetSubscription.serviceId, targetSubscription.planId);

    const intendedViewerIds = [...new Set([
      ...viewing.map(record => record.memberId),
      ...watchlist.filter(record => record.titleId === scenarioRecord.title_id).map(record => record.memberId)
    ])];

    const supportingPriorityTitleMap = new Map();
    watchlist.forEach(entry => {
      if (entry.priority !== "high") return;
      const catalogRecord = knowledge.catalog.find(record =>
        record.case_id === scenarioId &&
        record.title_id === entry.titleId &&
        record.available_service_id === scenarioRecord.primary_service_id
      );
      if (!catalogRecord) return;
      const existing = supportingPriorityTitleMap.get(entry.titleId);
      if (existing) {
        existing.intendedViewerIds.push(entry.memberId);
        return;
      }
      supportingPriorityTitleMap.set(entry.titleId, {
        titleId: entry.titleId,
        titleName: entry.title,
        contentType: catalogRecord.content_type || entry.contentType || "",
        contentRating: catalogRecord.content_rating || "",
        priority: entry.priority,
        intendedViewerIds: [entry.memberId],
        serviceId: catalogRecord.available_service_id,
        serviceName: targetSubscription.service,
        availabilityOffsetDays: catalogRecord.availability_start
          ? math.daysBetween(baselineSystemDate, catalogRecord.availability_start)
          : null,
        availabilityDate: null,
        availabilityEndOffsetDays: catalogRecord.availability_end
          ? math.daysBetween(baselineSystemDate, catalogRecord.availability_end)
          : null,
        availabilityEndDate: null,
        availableNow: false,
        releasePattern: catalogRecord.current_release_pattern || entry.releasePattern || ""
      });
    });
    const supportingPriorityTitles = [...supportingPriorityTitleMap.values()];
    const otherPriorityTitlesOnTarget = supportingPriorityTitles
      .filter(entry => entry.titleId !== scenarioRecord.title_id)
      .length;
    const householdSpendingHistory = knowledge.householdSpendingHistory
      .filter(record => record.household_id === scenarioRecord.household_id)
      .map(record => ({
        monthOffset: Number(record.month_offset),
        totalMonthlySpend: Number(record.total_monthly_spend),
        recommendationSavings: Number(record.recommendation_savings || 0),
        changeNote: record.change_note || ""
      }))
      .sort((left, right) => left.monthOffset - right.monthOffset);

    return {
      systemDate: null,
      household: {
        id: householdProfile.household_id,
        name: householdProfile.household_name,
        territory: householdProfile.territory,
        locale: householdProfile.locale,
        currency: householdProfile.currency,
        billingRegion: householdProfile.billing_region,
        advertisingTolerance: householdProfile.advertising_tolerance,
        resolutionPreference: householdProfile.resolution_preference,
        authorizedAdultMemberId: householdProfile.authorized_adult_member_id
      },
      members,
      familyRules: {
        monthlyBudgetCap: Number(householdProfile.monthly_streaming_budget_cap),
        budgetCurrency: householdProfile.currency,
        pricesExcludeTax: !householdProfile.prices_include_tax,
        contentLimits: clone(knowledge.familyRules.content_limits),
        contentRatingExceptions: [],
        priorityPolicy: knowledge.familyRules.priority_policy,
        additionalEscalations: clone(knowledge.familyRules.additional_escalations),
        ruleChanges: []
      },
      subscriptions,
      viewing,
      watchlist,
      householdWatchlist,
      householdViewing,
      householdViewingHistory,
      householdSpendingHistory,
      recommendationSavingsEvents: [],
      subscriptionChangeLog: [],
      contextFreshness: {
        householdOffsetDays: Math.min(0, householdProfileOffset),
        familyRulesOffsetDays: Math.min(0, householdProfileOffset),
        subscriptionsOffsetDays: subscriptionConfirmedOffset,
        watchlistOffsetDays: watchlistConfirmedOffset,
        viewingOffsetDays: viewingConfirmedOffset
      },
      scenario: {
        id: scenarioRecord.case_id,
        evalCase: scenarioRecord.eval_case,
        triggerType: scenarioRecord.trigger_type,
        scenarioType: scenarioRecord.scenario_type,
        requestedAction: scenarioRecord.requested_action,
        expectedRoute: scenarioRecord.expected_route,
        targetServiceId: scenarioRecord.primary_service_id,
        secondaryServiceId: scenarioRecord.secondary_service_id || null,
        targetServiceName: targetPlan.service_name,
        targetPlanId: targetPlan.plan_id,
        targetPlanName: targetPlan.plan_name,
        titleId: scenarioRecord.title_id,
        titleName: titleRecord.title_name,
        titleContentType: titleRecord.content_type,
        titleRating: titleRecord.content_rating || "",
        intendedViewerIds,
        reviewHorizonMonths: config.reviewHorizonMonths,
        completionStatus: config.actionCompletionStatus[scenarioRecord.requested_action] || "unchanged",
        nextReleaseLabel: titleRecord.next_release_label || "",
        nextReleaseOffsetDays: titleRecord.next_air_start_date
          ? math.daysBetween(baselineSystemDate, titleRecord.next_air_start_date)
          : null,
        nextReleaseDate: null,
        nextReleasePattern: titleRecord.next_release_pattern || "",
        otherPriorityTitlesOnTarget,
        supportingPriorityTitles
      },
      review: {
        started: false,
        manualScenario: false,
        progressStage: "not_started",
        status: "not_started",
        recommendationVersion: 0,
        generatedRecommendation: null,
        recommendationSource: null,
        recommendationModel: null,
        recommendationResponseId: null,
        recommendationUsage: null,
        recommendationError: null,
        adultDecision: null,
        discussionStatus: "not_started",
        resolution: null,
        resolutionAction: null,
        resolvedAt: null,
        lastTurnType: null,
        recommendationEffect: "unchanged",
        nextExpectedInput: "none",
        safetyDisposition: "normal",
        reasonCodes: [],
        pendingContextUpdates: [],
        externalActionConfirmed: false,
        dailyReminderEnabled: false,
        lastReminderOn: null,
        updatedAt: null
      },
      messages: [],
      toolAudit: [],
      emailOutbox: []
    };
  }

  function rebaseStateDates(state, systemDate) {
    const rebased = state;
    rebased.systemDate = systemDate;
    rebased.subscriptions.forEach(subscription => {
      subscription.nextRenewal = Number.isFinite(subscription.renewalOffsetDays)
        ? math.addDays(systemDate, subscription.renewalOffsetDays)
        : null;
      subscription.expirationDate = Number.isFinite(subscription.expirationOffsetDays)
        ? math.addDays(systemDate, subscription.expirationOffsetDays)
        : null;
    });
    rebased.viewing.forEach(record => {
      record.completedOn = record.status === "completed" && Number.isFinite(record.completionOffsetDays)
        ? math.addDays(systemDate, record.completionOffsetDays)
        : null;
      record.reportedOn = Number.isFinite(record.reportOffsetDays)
        ? math.addDays(systemDate, record.reportOffsetDays)
        : null;
    });
    rebased.watchlist.forEach(entry => {
      entry.completedOn = Number.isFinite(entry.completionOffsetDays)
        ? math.addDays(systemDate, entry.completionOffsetDays)
        : null;
      entry.nextReleaseDate = Number.isFinite(entry.nextReleaseOffsetDays)
        ? math.addDays(systemDate, entry.nextReleaseOffsetDays)
        : null;
    });
    rebased.householdWatchlist.forEach(entry => {
      entry.completedOn = Number.isFinite(entry.completionOffsetDays)
        ? math.addDays(systemDate, entry.completionOffsetDays)
        : null;
      entry.nextReleaseDate = Number.isFinite(entry.nextReleaseOffsetDays)
        ? math.addDays(systemDate, entry.nextReleaseOffsetDays)
        : null;
    });
    rebased.householdViewingHistory.forEach(record => {
      record.completedOn = Number.isFinite(record.completionOffsetDays)
        ? math.addDays(systemDate, record.completionOffsetDays)
        : null;
    });
    rebased.householdViewing.forEach(record => {
      record.completedOn = record.status === "completed" && Number.isFinite(record.completionOffsetDays)
        ? math.addDays(systemDate, record.completionOffsetDays)
        : null;
    });
    rebased.scenario.nextReleaseDate = Number.isFinite(rebased.scenario.nextReleaseOffsetDays)
      ? math.addDays(systemDate, rebased.scenario.nextReleaseOffsetDays)
      : null;
    (rebased.scenario.supportingPriorityTitles || []).forEach(title => {
      title.availabilityDate = Number.isFinite(title.availabilityOffsetDays)
        ? math.addDays(systemDate, title.availabilityOffsetDays)
        : null;
      title.availabilityEndDate = Number.isFinite(title.availabilityEndOffsetDays)
        ? math.addDays(systemDate, title.availabilityEndOffsetDays)
        : null;
      title.availableNow = Boolean(
        title.availabilityDate &&
        title.availabilityDate <= systemDate &&
        (!title.availabilityEndDate || systemDate <= title.availabilityEndDate)
      );
    });
    return rebased;
  }

  global.SubscriptionGuardContext = Object.freeze({
    knowledge,
    config,
    createSeedState: createScenarioState,
    rebaseStateDates,
    clone
  });
})(window);
