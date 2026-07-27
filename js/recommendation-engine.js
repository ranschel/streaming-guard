(function initializeRecommendationEngine(global) {
  "use strict";

  const math = global.SubscriptionGuardMath;
  if (!math) throw new Error("Streaming Guard calculator failed to load.");

  const actionLanguage = Object.freeze({
    cancel: { imperative: "Cancel", gerund: "Canceling", past: "canceled", noun: "cancellation" },
    pause: { imperative: "Pause", gerund: "Pausing", past: "paused", noun: "pause" },
    subscribe: { imperative: "Subscribe to", gerund: "Subscribing to", past: "activated", noun: "subscription" },
    keep: { imperative: "Keep", gerund: "Keeping", past: "left unchanged", noun: "keep decision" }
  });

  function displayDate(isoDate, locale = "en-US") {
    if (!isoDate) return "No date available";
    return new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
      .format(new Date(`${isoDate}T00:00:00Z`));
  }

  function formatMoney(state, value) {
    return math.formatCurrency(value, state.household.currency, state.household.locale);
  }

  function recommendedAccessStartDate(state) {
    if (!state.scenario.nextReleaseDate) return null;
    const dayBeforeRelease = math.addDays(state.scenario.nextReleaseDate, -1);
    return state.systemDate && dayBeforeRelease < state.systemDate
      ? state.systemDate
      : dayBeforeRelease;
  }

  function memberById(state, memberId) {
    return state.members.find(member => member.id === memberId);
  }

  function viewerName(state, memberId) {
    return memberById(state, memberId)?.firstName || memberById(state, memberId)?.name || memberId;
  }

  function intendedViewingRecords(state) {
    return state.scenario.intendedViewerIds.map(memberId => ({
      memberId,
      member: memberById(state, memberId),
      viewing: state.viewing.find(record =>
        record.memberId === memberId && record.titleId === state.scenario.titleId
      )
    }));
  }

  function allViewersComplete(state) {
    return intendedViewingRecords(state).every(record => record.viewing?.status === "completed");
  }

  const ratingScales = Object.freeze({
    television: Object.freeze(["TV-Y", "TV-Y7", "TV-G", "TV-PG", "TV-14", "TV-MA"]),
    movie: Object.freeze(["G", "PG", "PG-13", "R", "NC-17"])
  });

  function ratingCategory(contentType) {
    return String(contentType || "").toLowerCase().includes("movie") ? "movie" : "television";
  }

  function ratingIndexInText(text, scale) {
    const normalized = String(text || "").toUpperCase();
    return scale.reduce((highest, rating, index) => {
      const escaped = rating.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const found = new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`).test(normalized);
      return found ? Math.max(highest, index) : highest;
    }, -1);
  }

  function titleChildSafetyContext(state, title) {
    const category = ratingCategory(title.contentType);
    const scale = ratingScales[category];
    const titleRating = String(title.contentRating || "").toUpperCase();
    const titleRatingIndex = scale.indexOf(titleRating);
    const exceptions = state.familyRules.contentRatingExceptions || [];
    const intendedChildren = title.intendedViewerIds
      .map(memberId => memberById(state, memberId))
      .filter(member => member && Number(member.age) < 18)
      .map(member => {
        const limit = state.familyRules.contentLimits.find(rule => rule.member_id === member.id);
        const limitText = category === "movie" ? limit?.movie_limit : limit?.television_limit;
        const limitIndex = ratingIndexInText(limitText, scale);
        const exception = exceptions.find(item =>
          item.approved === true &&
          item.memberId === member.id &&
          item.titleId === title.titleId
        );
        const exceedsLimit = titleRatingIndex < 0 || limitIndex < 0 || titleRatingIndex > limitIndex;
        return {
          memberId: member.id,
          memberName: member.firstName || member.name,
          age: Number(member.age),
          titleId: title.titleId,
          titleName: title.titleName,
          contentType: title.contentType,
          titleRating: title.contentRating || null,
          applicableLimit: limitText || null,
          titleSpecificExceptionApproved: Boolean(exception),
          compliant: !exceedsLimit || Boolean(exception),
          issue: titleRatingIndex < 0
            ? "title_rating_missing_or_unrecognized"
            : limitIndex < 0
              ? "child_rating_limit_missing_or_unrecognized"
              : titleRatingIndex > limitIndex
                ? "title_exceeds_child_limit"
                : null
        };
      });
    return {
      category,
      titleId: title.titleId,
      titleName: title.titleName,
      titleRating: title.contentRating || null,
      intendedChildren,
      conflicts: intendedChildren.filter(child => !child.compliant),
      allIntendedChildrenCompliant: intendedChildren.every(child => child.compliant)
    };
  }

  function childSafetyContext(state) {
    const primaryTitle = {
      titleId: state.scenario.titleId,
      titleName: state.scenario.titleName,
      contentType: state.scenario.titleContentType,
      contentRating: state.scenario.titleRating,
      intendedViewerIds: state.scenario.intendedViewerIds
    };
    const primaryAssessment = titleChildSafetyContext(state, primaryTitle);
    const supportingTitleAssessments = (state.scenario.supportingPriorityTitles || [])
      .filter(title => title.titleId !== primaryTitle.titleId)
      .map(title => titleChildSafetyContext(state, title));
    const allAssessments = [primaryAssessment, ...supportingTitleAssessments];
    const intendedChildren = allAssessments.flatMap(assessment => assessment.intendedChildren);
    const conflicts = intendedChildren.filter(child => !child.compliant);
    return {
      category: primaryAssessment.category,
      titleRating: primaryAssessment.titleRating,
      intendedChildren,
      conflicts,
      allIntendedChildrenCompliant: conflicts.length === 0,
      primaryTitleAssessment: primaryAssessment,
      supportingTitleAssessments,
      exceptionPolicy: "Only the authorized adult may approve an exception, and it applies only to the named title and named child viewer."
    };
  }

  function targetSubscription(state) {
    return state.subscriptions.find(subscription => subscription.serviceId === state.scenario.targetServiceId);
  }

  function pauseWindow(state, subscription = targetSubscription(state)) {
    const pauseStartDate = subscription?.nextRenewal || state.systemDate || null;
    const nextNeedDate = state.scenario.nextReleaseDate || null;
    const maxPauseDays = Number(subscription?.maxPauseDays || 0);
    const maxPauseMonths = Number(subscription?.maxPauseMonths || 0);
    const daysUntilNextNeed = pauseStartDate && nextNeedDate
      ? math.daysBetween(pauseStartDate, nextNeedDate)
      : null;
    const eligible = Boolean(
      subscription?.pauseEligible &&
      maxPauseDays > 0 &&
      maxPauseMonths > 0 &&
      Number.isFinite(daysUntilNextNeed) &&
      daysUntilNextNeed > 0 &&
      daysUntilNextNeed <= maxPauseDays
    );
    return Object.freeze({
      eligible,
      pauseStartDate,
      nextNeedDate,
      daysUntilNextNeed,
      maxPauseDays,
      maxPauseMonths,
      pauseDurationMonths: eligible
        ? Math.min(maxPauseMonths, Math.max(1, Math.ceil(daysUntilNextNeed / 30)))
        : 0,
      chosenPauseDays: eligible ? daysUntilNextNeed : 0,
      pauseEndDate: eligible ? math.addDays(nextNeedDate, -1) : null,
      pauseTerms: subscription?.pauseTerms || "not_available"
    });
  }

  function calculateScenarioFinancials(state) {
    return math.calculateCancellationImpact({
      subscriptions: state.subscriptions,
      targetServiceId: state.scenario.targetServiceId,
      monthlyBudgetCap: state.familyRules.monthlyBudgetCap,
      projectionMonths: state.scenario.reviewHorizonMonths
    });
  }

  const policyEscalationScenarioTypes = new Set([
    "regional_unavailability",
    "material_preference_conflict"
  ]);

  function adultJudgmentReasons(state) {
    const reasons = [];
    const completionRequired = /underuse|missing_viewing_status|bundle_prepaid_conflict/i
      .test(state.scenario.scenarioType);
    const missingCompletionNames = completionRequired
      ? intendedViewingRecords(state)
        .filter(record => record.viewing?.status !== "completed")
        .map(record => viewerName(state, record.memberId))
      : [];
    if (missingCompletionNames.length) {
      reasons.push({
        code: "missing_viewing_completion",
        details: missingCompletionNames
      });
    }

    const ratingConflicts = childSafetyContext(state).conflicts;
    if (ratingConflicts.length) {
      reasons.push({
        code: "child_rating_conflict",
        details: ratingConflicts.map(conflict => conflict.memberName)
      });
    }

    const subscription = targetSubscription(state);
    if (subscription?.status !== "active") {
      const subscribeImpact = planImpactForAction(state, "subscribe");
      if (subscribeImpact.proposedBudget.overage > 0) {
        reasons.push({
          code: "household_budget_conflict",
          details: subscribeImpact.proposedBudget.overage
        });
      }
    }

    if (policyEscalationScenarioTypes.has(state.scenario.scenarioType)) {
      reasons.push({
        code: state.scenario.scenarioType,
        details: null
      });
    }
    return reasons;
  }

  function allowedDecisionActions(state) {
    const judgmentReasons = adultJudgmentReasons(state);
    if (judgmentReasons.length) return ["request_adult_judgment"];

    const subscription = targetSubscription(state);
    const actions = new Set(["keep"]);
    if (subscription?.status === "active") {
      actions.add("cancel");
      if (pauseWindow(state, subscription).eligible) {
        actions.add("pause");
      }
    } else {
      actions.add("subscribe");
    }
    return [...actions];
  }

  function planImpactForAction(state, action) {
    const normalizedAction = action === "request_adult_judgment" ? "keep" : action;
    const subscription = targetSubscription(state);
    const activePauseWindow = pauseWindow(state, subscription);
    const impact = math.calculatePlanFinancialImpact({
      subscriptions: state.subscriptions,
      action: normalizedAction,
      targetServiceId: state.scenario.targetServiceId,
      targetPlan: normalizedAction === "subscribe" ? {
        billingCadence: subscription?.billingCadence || "monthly",
        monthlyPrice: subscription?.planMonthlyCost,
        annualPrice: subscription?.planAnnualCost,
        upfrontCost: subscription?.planUpfrontCost
      } : null,
      monthlyBudgetCap: state.familyRules.monthlyBudgetCap,
      projectionMonths: state.scenario.reviewHorizonMonths,
      pauseDurationMonths: normalizedAction === "pause" ? activePauseWindow.pauseDurationMonths : 0
    });
    if (
      ["cancel", "pause"].includes(normalizedAction) &&
      subscription?.status === "active" &&
      Number.isFinite(subscription.postCancellationMonthlyCost)
    ) {
      const proposedMonthly = math.roundCurrency(
        impact.currentMonthly - subscription.monthlyCost + subscription.postCancellationMonthlyCost
      );
      const monthlyChange = math.roundCurrency(proposedMonthly - impact.currentMonthly);
      const projectedChange = math.roundCurrency(monthlyChange * impact.projectionMonths);
      return Object.freeze({
        ...impact,
        proposedMonthly,
        monthlyChange,
        monthlySavings: Math.max(0, -monthlyChange),
        monthlyIncrease: Math.max(0, monthlyChange),
        projectedChange,
        projectedSavings: Math.max(0, -projectedChange),
        projectedIncrease: Math.max(0, projectedChange),
        forfeitedValue: math.roundCurrency(subscription.forfeitedValue || 0),
        promotionOrBundleImpact: subscription.promotionOrBundle,
        proposedBudget: Object.freeze(math.calculateBudgetUtilization(proposedMonthly, state.familyRules.monthlyBudgetCap))
      });
    }
    return impact;
  }

  function recommendationFinancesForAction(state, action) {
    const cancellation = calculateScenarioFinancials(state);
    if (action === "cancel") return cancellation;
    const subscription = targetSubscription(state);
    const impact = planImpactForAction(state, action);
    const activeSubscriptionCount = math.countSubscriptions(state.subscriptions);
    const targetMonthlyCost = subscription?.status === "active"
      ? subscription.monthlyCost
      : subscription?.planMonthlyCost ?? impact.monthlyIncrease;
    const afterActionSubscriptionCount = action === "subscribe"
      ? activeSubscriptionCount + (subscription?.status === "active" ? 0 : 1)
      : activeSubscriptionCount;
    return Object.freeze({
      ...cancellation,
      targetMonthlyCost,
      activeMonthly: impact.currentMonthly,
      beforeActionMonthly: impact.currentMonthly,
      afterActionMonthly: impact.proposedMonthly,
      monthlySavings: impact.monthlySavings,
      monthlyIncrease: impact.monthlyIncrease,
      projectionMonths: impact.projectionMonths,
      projectedSavings: impact.projectedSavings,
      projectedIncrease: impact.projectedIncrease,
      upfrontCost: impact.upfrontCost,
      activeSubscriptionCount,
      beforeActionSubscriptionCount: activeSubscriptionCount,
      afterActionSubscriptionCount,
      beforeBudget: impact.currentBudget,
      afterBudget: impact.proposedBudget,
      activeBudget: impact.currentBudget,
      pauseDurationMonths: impact.pauseDurationMonths,
      postPauseMonthly: impact.postPauseMonthly
    });
  }

  function buildDecisionPacket(state) {
    const subscription = targetSubscription(state);
    const effectiveTargetMonthlyCost = subscription?.status === "active"
      ? subscription.monthlyCost
      : subscription?.planMonthlyCost;
    const viewerRecords = intendedViewingRecords(state).map(record => ({
      memberId: record.memberId,
      memberName: record.member?.firstName || record.member?.name || record.memberId,
      titleId: state.scenario.titleId,
      titleName: state.scenario.titleName,
      status: record.viewing?.status || "unknown",
      completedOn: record.viewing?.completedOn || null,
      completedOnDisplay: record.viewing?.completedOn
        ? displayDate(record.viewing.completedOn, state.household.locale)
        : null,
      reportedOn: record.viewing?.reportedOn || null,
      reportedOnDisplay: record.viewing?.reportedOn
        ? displayDate(record.viewing.reportedOn, state.household.locale)
        : null
    }));
    const viewersWithoutConfirmedCompletionNames = viewerRecords
      .filter(record => record.status !== "completed")
      .map(record => record.memberName);
    const completionRequiredForDecision = /underuse|missing_viewing_status|bundle_prepaid_conflict/i
      .test(state.scenario.scenarioType);
    const missingCompletionNames = completionRequiredForDecision
      ? viewersWithoutConfirmedCompletionNames
      : [];
    const judgmentReasons = adultJudgmentReasons(state);
    const actions = allowedDecisionActions(state);
    const activePauseWindow = pauseWindow(state, subscription);
    const actionFinancialImpacts = Object.fromEntries(actions.map(action => {
      const impact = planImpactForAction(state, action);
      const {
        pauseDurationMonths,
        ...publicImpact
      } = impact;
      return [action, {
        ...publicImpact,
        ...(action === "pause" ? {
          selectedPauseDurationDays: activePauseWindow.chosenPauseDays,
          maximumPauseDays: activePauseWindow.maxPauseDays,
          avoidedBillingCycles: pauseDurationMonths
        } : {}),
        currentMonthlyDisplay: formatMoney(state, impact.currentMonthly),
        proposedMonthlyDisplay: formatMoney(state, impact.proposedMonthly),
        monthlySavingsDisplay: formatMoney(state, impact.monthlySavings),
        monthlyIncreaseDisplay: formatMoney(state, impact.monthlyIncrease),
        projectedSavingsDisplay: formatMoney(state, impact.projectedSavings),
        projectedIncreaseDisplay: formatMoney(state, impact.projectedIncrease),
        forfeitedValueDisplay: formatMoney(state, impact.forfeitedValue || 0),
        budgetCapDisplay: formatMoney(state, impact.currentBudget.monthlyBudgetCap),
        proposedBudgetRemainingDisplay: formatMoney(state, impact.proposedBudget.remaining),
        proposedBudgetOverageDisplay: formatMoney(state, impact.proposedBudget.overage)
      }];
    }));
    const knownDateDisplays = [
      state.systemDate ? displayDate(state.systemDate, state.household.locale) : null,
      subscription?.nextRenewal ? displayDate(subscription.nextRenewal, state.household.locale) : null,
      state.scenario.nextReleaseDate ? displayDate(state.scenario.nextReleaseDate, state.household.locale) : null,
      activePauseWindow.pauseStartDate
        ? displayDate(activePauseWindow.pauseStartDate, state.household.locale)
        : null,
      activePauseWindow.nextNeedDate
        ? displayDate(activePauseWindow.nextNeedDate, state.household.locale)
        : null,
      activePauseWindow.pauseEndDate
        ? displayDate(activePauseWindow.pauseEndDate, state.household.locale)
        : null,
      recommendedAccessStartDate(state)
        ? displayDate(recommendedAccessStartDate(state), state.household.locale)
        : null,
      ...(state.scenario.supportingPriorityTitles || []).map(title =>
        title.availabilityDate ? displayDate(title.availabilityDate, state.household.locale) : null
      ),
      ...viewerRecords.flatMap(record => [record.completedOnDisplay, record.reportedOnDisplay])
    ].filter(Boolean);
    const subscriptionCurrencyFields = [
      "monthlyCost",
      "planMonthlyCost",
      "planAnnualCost",
      "planUpfrontCost",
      "postCancellationMonthlyCost",
      "forfeitedValue"
    ];
    const suppliedSubscriptionCurrencyDisplays = state.subscriptions.flatMap(item =>
      subscriptionCurrencyFields
        .map(field => item[field])
        .filter(value => Number.isFinite(value))
        .map(value => formatMoney(state, value))
    );
    const knownCurrencyDisplays = [...new Set([
      ...Object.values(actionFinancialImpacts).flatMap(impact => Object.entries(impact)
        .filter(([key, value]) => key.endsWith("Display") && typeof value === "string" && value.startsWith("$"))
        .map(([, value]) => value)),
      ...suppliedSubscriptionCurrencyDisplays,
      formatMoney(state, state.familyRules.monthlyBudgetCap)
    ])];

    const childSafety = childSafetyContext(state);
    return Object.freeze({
      currentDate: state.systemDate,
      currentDateDisplay: state.systemDate
        ? displayDate(state.systemDate, state.household.locale)
        : null,
      target: {
        serviceId: state.scenario.targetServiceId,
        serviceName: state.scenario.targetServiceName,
        planId: state.scenario.targetPlanId,
        planName: state.scenario.targetPlanName,
        subscriptionStatus: subscription?.status || "unknown",
        monthlyCost: effectiveTargetMonthlyCost ?? null,
        monthlyCostDisplay: Number.isFinite(effectiveTargetMonthlyCost) ? formatMoney(state, effectiveTargetMonthlyCost) : null,
        nextRenewal: subscription?.nextRenewal || null,
        nextRenewalDisplay: subscription?.nextRenewal
          ? displayDate(subscription.nextRenewal, state.household.locale)
          : null,
        billingCadence: subscription?.billingCadence || null,
        promotionOrBundle: subscription?.promotionOrBundle || "none",
        commitmentTerms: subscription?.commitmentTerms || "",
        cancellationConsequences: subscription?.cancellationConsequences || "",
        pauseEligible: subscription?.pauseEligible || false,
        maxPauseDays: subscription?.maxPauseDays || 0,
        maxPauseMonths: subscription?.maxPauseMonths || 0,
        pauseTerms: subscription?.pauseTerms || "not_available",
        postCancellationMonthlyCost: subscription?.postCancellationMonthlyCost ?? null,
        forfeitedValue: subscription?.forfeitedValue ?? 0,
        approvedAccountUrl: subscription?.approvedAccountUrl || null,
        approvedSupportUrl: subscription?.approvedSupportUrl || null
      },
      triggerContext: {
        triggerType: state.scenario.triggerType,
        scenarioType: state.scenario.scenarioType,
        titleId: state.scenario.titleId,
        titleName: state.scenario.titleName,
        targetServiceId: state.scenario.targetServiceId
      },
      viewingSignal: {
        titleId: state.scenario.titleId,
        titleName: state.scenario.titleName,
        contentType: state.scenario.titleContentType || null,
        contentRating: state.scenario.titleRating || null,
        intendedViewers: viewerRecords,
        completionRequiredForDecision,
        viewersWithoutConfirmedCompletionNames,
        missingCompletionNames,
        allIntendedViewersCompleted: viewersWithoutConfirmedCompletionNames.length === 0
      },
      childSafety,
      priorityCoverage: {
        otherHighPriorityTitlesOnTargetService: state.scenario.otherPriorityTitlesOnTarget,
        supportingPriorityTitles: (state.scenario.supportingPriorityTitles || []).map(title => ({
          titleId: title.titleId,
          titleName: title.titleName,
          contentType: title.contentType || null,
          contentRating: title.contentRating || null,
          priority: title.priority,
          intendedViewerIds: [...title.intendedViewerIds],
          serviceId: title.serviceId || state.scenario.targetServiceId,
          serviceName: title.serviceName || state.scenario.targetServiceName,
          availabilityDate: title.availabilityDate,
          availabilityDateDisplay: title.availabilityDate
            ? displayDate(title.availabilityDate, state.household.locale)
            : null,
          availabilityEndDate: title.availabilityEndDate || null,
          availabilityEndDateDisplay: title.availabilityEndDate
            ? displayDate(title.availabilityEndDate, state.household.locale)
            : null,
          availableNow: Boolean(title.availableNow),
          releasePattern: title.releasePattern || null
        })),
        reviewHorizonMonths: state.scenario.reviewHorizonMonths
      },
      nextRelevantRelease: {
        label: state.scenario.nextReleaseLabel || null,
        date: state.scenario.nextReleaseDate || null,
        dateDisplay: state.scenario.nextReleaseDate
          ? displayDate(state.scenario.nextReleaseDate, state.household.locale)
          : null,
        recommendedAccessStartDate: recommendedAccessStartDate(state),
        recommendedAccessStartDateDisplay: recommendedAccessStartDate(state)
          ? displayDate(recommendedAccessStartDate(state), state.household.locale)
          : null,
        releasePattern: state.scenario.nextReleasePattern || null
      },
      pauseWindow: {
        ...activePauseWindow,
        pauseStartDateDisplay: activePauseWindow.pauseStartDate
          ? displayDate(activePauseWindow.pauseStartDate, state.household.locale)
          : null,
        pauseEndDateDisplay: activePauseWindow.pauseEndDate
          ? displayDate(activePauseWindow.pauseEndDate, state.household.locale)
          : null,
        nextNeedDateDisplay: activePauseWindow.nextNeedDate
          ? displayDate(activePauseWindow.nextNeedDate, state.household.locale)
          : null
      },
      allowedActions: actions,
      adultJudgmentGate: {
        required: judgmentReasons.length > 0,
        reasons: judgmentReasons
      },
      actionFinancialImpacts,
      mandatoryValidationRules: {
        missingViewingCompletionRequiresAdultJudgment: true,
        externalAccountActionsRequireAdultExecution: true,
        agreementDoesNotConfirmExternalCompletion: true,
        householdBudgetConflictsRequireAdultJudgment: true,
        childRatingConflictsRequireAdultJudgment: true,
        childRatingExceptionsMustBeTitleSpecific: true,
        missingOrAmbiguousContractConsequencesRequireAdultJudgment: true,
        pauseRequiresKnownReturnWithinVerifiedMaximumWindow: true,
        pauseSavingsMustEndWhenThePauseEnds: true
      },
      groundingVocabulary: {
        knownDateDisplays: [...new Set(knownDateDisplays)],
        knownCurrencyDisplays
      }
    });
  }

  function buildRecommendation(state) {
    const scenario = state.scenario;
    const subscription = targetSubscription(state);
    const finances = calculateScenarioFinancials(state);
    const viewers = intendedViewingRecords(state);
    const missingViewer = viewers.find(record => record.viewing?.status !== "completed");
    const language = actionLanguage[scenario.requestedAction] || actionLanguage.keep;
    const renewal = displayDate(subscription.nextRenewal, state.household.locale);
    const nextRelease = displayDate(scenario.nextReleaseDate, state.household.locale);
    const viewerNames = viewers.map(record => record.member?.firstName || record.member?.name || record.memberId);
    const completedEvidence = viewers
      .filter(record => record.viewing?.status === "completed")
      .map(record => `${record.member?.firstName || record.memberId} completed ${scenario.titleName} on ${displayDate(record.viewing.completedOn, state.household.locale)}`);
    const actionAlreadyCompleted = scenario.requestedAction === "cancel"
      ? subscription.status === scenario.completionStatus
      : state.review.externalActionConfirmed;

    if (actionAlreadyCompleted) {
      return {
        status: "Action completed",
        route: "completed",
        action: `${scenario.targetServiceName} is recorded as ${language.past}.`,
        confidenceLevel: "High",
        confidence: `The external ${language.noun} was explicitly confirmed by the adult.`,
        trigger: "Adult completion confirmation.",
        financialHeadline: `${formatMoney(state, finances.monthlySavings)} monthly saving confirmed`,
        financialDetails: `Active monthly streaming spending is now ${formatMoney(state, finances.activeMonthly)}, leaving ${formatMoney(state, finances.activeBudget.remaining)} within the ${formatMoney(state, finances.activeBudget.monthlyBudgetCap)} budget.`,
        financial: `${formatMoney(state, finances.activeMonthly)} per month, leaving ${formatMoney(state, finances.activeBudget.remaining)} within the ${formatMoney(state, finances.activeBudget.monthlyBudgetCap)} budget.`,
        rationale: `No further ${scenario.targetServiceName} action is needed.`,
        evidence: [`The adult confirmed completing the ${language.noun}.`, `${scenario.targetServiceName} was removed from the active monthly total.`],
        decisionHeadline: "No decision is required.",
        decisionDetails: "",
        decision: "No decision is required.",
        nextHeadline: "No further action is required.",
        nextDetails: "",
        next: "None.",
        reminderHeadline: "Use the updated subscription record for future recommendations.",
        reminderDetails: "",
        reminder: "Future recommendations will use the updated subscription state.",
        finances,
        scenario
      };
    }

    if (missingViewer) {
      const missingName = missingViewer.member?.firstName || missingViewer.memberId;
      return {
        status: "Adult judgment required",
        route: "adult_judgment_required",
        action: `Keep ${scenario.targetServiceName} unchanged for now.`,
        confidenceLevel: "Low",
        confidence: `Low confidence because ${missingName}’s viewing completion is not confirmed.`,
        trigger: `${completedEvidence.length ? `${completedEvidence.join(", and ")}, but ` : ""}${missingName} has not confirmed finishing ${scenario.titleName}.`,
        financialHeadline: "No savings assumed",
        financialDetails: `The subscription remains unchanged, so current streaming spending stays at ${formatMoney(state, finances.activeMonthly)} per month against the ${formatMoney(state, finances.activeBudget.monthlyBudgetCap)} budget.`,
        financial: `Current spending remains ${formatMoney(state, finances.activeMonthly)} per month against the ${formatMoney(state, finances.activeBudget.monthlyBudgetCap)} budget. No savings are assumed.`,
        rationale: `I will not treat ${scenario.targetServiceName} as unused until every intended viewer’s completion is confirmed.`,
        evidence: [
          `${scenario.targetServiceName} ${scenario.targetPlanName} costs ${formatMoney(state, finances.targetMonthlyCost)} per month and renews ${renewal}.`,
          ...completedEvidence.map(statement => `${statement}.`),
          `${missingName}’s completion is not confirmed.`
        ],
        decisionHeadline: `Please confirm whether ${missingName} finished watching ${scenario.titleName}.`,
        decisionDetails: "You can also share any other relevant information.",
        decision: `Please confirm whether ${missingName} finished watching ${scenario.titleName}, or share any other relevant information.`,
        nextHeadline: "No external subscription action is needed right now.",
        nextDetails: "",
        next: "There is no external subscription action to take right now.",
        reminderHeadline: "Please provide the missing viewing information.",
        reminderDetails: "I can then reconsider the recommendation with the updated household context.",
        reminder: "I can reconsider the recommendation after the viewing information is updated.",
        finances,
        scenario
      };
    }

    return {
      status: "Action recommended",
      route: "action_recommended",
      action: `${language.imperative} ${scenario.targetServiceName} before it renews on ${renewal}.`,
      confidenceLevel: "High",
      confidence: "The household information is complete and I did not find an important information gap.",
      trigger: `${viewerNames.join(" and ")} confirmed finishing ${scenario.titleName}, leaving ${scenario.targetServiceName} without a currently watched priority title.`,
      financialHeadline: `Save ${formatMoney(state, finances.monthlySavings)} per month`,
      financialDetails: `${language.gerund} ${scenario.targetServiceName} would reduce total monthly streaming spending from ${formatMoney(state, finances.beforeActionMonthly)} to ${formatMoney(state, finances.afterActionMonthly)}. That equals ${formatMoney(state, finances.projectedSavings)} over ${finances.projectionMonths} months. The ${formatMoney(state, finances.beforeBudget.monthlyBudgetCap)} monthly budget is before tax.`,
      financial: `Current spending is ${formatMoney(state, finances.beforeActionMonthly)} per month. ${language.gerund} ${scenario.targetServiceName} would reduce it to ${formatMoney(state, finances.afterActionMonthly)}, saving ${formatMoney(state, finances.monthlySavings)} per month and ${formatMoney(state, finances.projectedSavings)} over ${finances.projectionMonths} months. The monthly budget is ${formatMoney(state, finances.beforeBudget.monthlyBudgetCap)} before tax.`,
      rationale: `No other high-priority ${scenario.targetServiceName} title is scheduled within the next ${scenario.reviewHorizonMonths} months.`,
      evidence: [
        `The family currently has ${finances.beforeActionSubscriptionCount} active subscriptions totaling ${formatMoney(state, finances.beforeActionMonthly)} per month.`,
        `${completedEvidence.join(", and ")}.`,
        `${scenario.targetServiceName} ${scenario.targetPlanName} costs ${formatMoney(state, finances.targetMonthlyCost)} per month and renews ${renewal}.`,
        scenario.nextReleaseDate
          ? `The next ${scenario.titleName} release, ${scenario.nextReleaseLabel}, starts ${nextRelease}.`
          : `No next ${scenario.titleName} release is currently recorded.`
      ],
      decisionHeadline: "",
      decisionDetails: "",
      decision: `Please confirm whether you agree with ${language.gerund.toLowerCase()} ${scenario.targetServiceName} before ${renewal}. If you disagree, tell me what I should reconsider. You can also ask a question or add information.`,
      nextHeadline: `If you agree, please open your ${scenario.targetServiceName} account page and complete the ${language.noun} before ${renewal}.`,
      nextDetails: "I will wait for your completion confirmation before updating the household record.",
      next: `If you agree, open your ${scenario.targetServiceName} account page and complete the ${language.noun} before ${renewal}. I will wait for your completion confirmation before updating the household record.`,
      reminderHeadline: `After you complete the ${language.noun}, please tell me it is complete.`,
      reminderDetails: "I will then update the household’s Streaming Guard record.",
      reminder: `After you complete the ${language.noun}, please tell me so I can update the household’s Streaming Guard record.`,
      finances,
      scenario
    };
  }

  global.SubscriptionGuardRecommendationEngine = Object.freeze({
    actionLanguage,
    buildRecommendation,
    buildDecisionPacket,
    allowedDecisionActions,
    pauseWindow,
    recommendationFinancesForAction,
    calculateScenarioFinancials,
    allViewersComplete,
    intendedViewingRecords,
    childSafetyContext,
    targetSubscription,
    viewerName,
    displayDate,
    formatMoney
  });
})(window);
