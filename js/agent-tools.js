(function initializeAgentTools(global) {
  "use strict";

  const math = global.StreamingGuardMath;
  const engine = global.StreamingGuardRecommendationEngine;
  const schemas = global.StreamingGuardStateSchemas;
  if (!math || !engine || !schemas) throw new Error("Streaming Guard tool dependencies failed to load.");

  const TOOL_NAMES = Object.freeze([
    "get_service_details",
    "query_catalog",
    "load_household_context",
    "calculate_plan_financial_impact",
    "run_daily_sweep",
    "update_household_context",
    "validate_output_url",
    "send_chat_response"
  ]);

  const SWEEP_SIGNAL_KEYS = Object.freeze([
    "newWatchlistRelease",
    "availabilityChange",
    "migrationChange",
    "approachingRenewal",
    "budgetConflict",
    "viewingUpdate",
    "underuseSignal",
    "familyRuleConflict",
    "missingInformation",
    "contradictoryInformation"
  ]);

  function evaluateSweepSignals(signals) {
    if (!signals || typeof signals !== "object" || Array.isArray(signals)) {
      throw new TypeError("A complete sweep signal object is required.");
    }
    const missingSignals = SWEEP_SIGNAL_KEYS.filter(key =>
      !Object.prototype.hasOwnProperty.call(signals, key)
    );
    if (missingSignals.length) {
      throw new TypeError(`Sweep signals are incomplete: ${missingSignals.join(", ")}.`);
    }
    const evaluatedSignals = Object.fromEntries(
      SWEEP_SIGNAL_KEYS.map(key => [key, signals[key]])
    );
    const materialSignals = SWEEP_SIGNAL_KEYS.filter(key => {
      const value = evaluatedSignals[key];
      return value !== false && value !== 0 && value !== null;
    });
    if (!materialSignals.length) {
      return Object.freeze({
        status: "no_action",
        shouldNotify: false,
        recommendation: null,
        evaluatedSignals: Object.freeze(evaluatedSignals),
        materialSignals: Object.freeze([])
      });
    }
    return Object.freeze({
      status: "review_pending",
      shouldNotify: true,
      decisionMade: false,
      message: "Material household or subscription signals are ready for model review.",
      evaluatedSignals: Object.freeze(evaluatedSignals),
      materialSignals: Object.freeze(materialSignals)
    });
  }

  function createAgentTools({
    memory,
    knowledge,
    traceManager = null,
    clock = () => new Date().toISOString()
  }) {
    if (!memory || !knowledge) throw new TypeError("memory and knowledge are required.");
    let generatedCommandSequence = 0;

    function clone(value) {
      return JSON.parse(JSON.stringify(value));
    }

    function recordAudit(tool, outcome, details = "") {
      memory.transact(state => {
        state.toolAudit.push({
          tool,
          outcome,
          details,
          timestamp: clock(),
          traceId: traceManager?.activeTraceId?.() || null,
          householdRevision: state.householdRevision
        });
        state.toolAudit = state.toolAudit.slice(-100);
      });
    }

    function getServiceDetails({ serviceId = "", serviceName = "", planId = "" } = {}) {
      const matches = knowledge.services.filter(service =>
        (!serviceId || service.service_id === serviceId) &&
        (!serviceName || service.service_name.toLowerCase() === serviceName.toLowerCase()) &&
        (!planId || service.plan_id === planId)
      );
      recordAudit("get_service_details", matches.length ? "success" : "not_found", `${matches.length} plan record(s)`);
      return clone(matches);
    }

    function queryCatalog({
      titleId = "",
      titleName = "",
      serviceId = "",
      territory = "",
      availableOnDate = ""
    } = {}) {
      const effectiveTerritory = territory || memory.getState().household.territory;
      const normalizedTitle = titleName.toLowerCase();
      const matches = knowledge.catalog.filter(title => {
        if (titleId && title.title_id !== titleId) return false;
        if (normalizedTitle && !title.title_name.toLowerCase().includes(normalizedTitle)) return false;
        if (serviceId && title.available_service_id !== serviceId && title.migration_service_id !== serviceId) return false;
        if (effectiveTerritory && title.territory !== effectiveTerritory) return false;
        if (availableOnDate) {
          const availableNow = title.availability_start <= availableOnDate &&
            (!title.availability_end || title.availability_end >= availableOnDate);
          const availableAfterMigration = title.migration_service_id && title.migration_date <= availableOnDate;
          if (!availableNow && !availableAfterMigration) return false;
        }
        return true;
      });
      recordAudit("query_catalog", matches.length ? "success" : "not_found", `${matches.length} title record(s)`);
      return clone(matches);
    }

    function loadHouseholdContext() {
      const state = memory.getState();
      const context = {
        systemDate: state.systemDate,
        household: state.household,
        householdMembers: state.members,
        subscriptions: state.subscriptions,
        householdSpendingHistory: state.householdSpendingHistory,
        recommendationSavingsEvents: state.recommendationSavingsEvents,
        viewing: state.viewing,
        watchlist: state.watchlist,
        familyRules: state.familyRules,
        scenario: state.scenario,
        review: state.review,
        policies: {
          immutableEscalationPolicy: knowledge.immutableEscalationPolicy,
          householdFamilyRules: knowledge.policies.family
        }
      };
      recordAudit("load_household_context", "success", "Current household context loaded");
      return clone(context);
    }

    function calculatePlanFinancialImpact({
      action = "",
      targetService = "",
      targetServiceId = "",
      targetPlan = null,
      projectionMonths = null,
      pauseDurationMonths = null,
      remainingPrepaidValue = 0,
      promotionOrBundleImpact = "none"
    } = {}) {
      const state = memory.getState();
      const effectiveAction = action || state.scenario.requestedAction;
      const effectiveService = targetService || state.scenario.targetServiceName;
      const effectiveServiceId = targetServiceId || state.scenario.targetServiceId;
      const effectiveProjectionMonths = projectionMonths || state.scenario.reviewHorizonMonths;
      const effectivePauseDurationMonths = pauseDurationMonths ??
        (effectiveAction === "pause" ? engine.pauseWindow(state).pauseDurationMonths : 0);
      const normalizedTargetPlan = targetPlan ? {
        billingCadence: targetPlan.billingCadence || targetPlan.billing_cadence || "monthly",
        monthlyPrice: Number(targetPlan.monthlyPrice ?? targetPlan.monthly_price ?? targetPlan.price),
        annualPrice: Number(targetPlan.annualPrice ?? targetPlan.annual_price ?? targetPlan.price),
        upfrontCost: Number(targetPlan.upfrontCost ?? targetPlan.upfront_cost ?? targetPlan.monthlyPrice ?? targetPlan.monthly_price ?? 0)
      } : null;
      const result = math.calculatePlanFinancialImpact({
        subscriptions: state.subscriptions,
        action: effectiveAction,
        targetService: effectiveService,
        targetServiceId: effectiveServiceId,
        targetPlan: normalizedTargetPlan,
        monthlyBudgetCap: state.familyRules.monthlyBudgetCap,
        projectionMonths: effectiveProjectionMonths,
        pauseDurationMonths: effectivePauseDurationMonths,
        remainingPrepaidValue,
        promotionOrBundleImpact
      });
      recordAudit("calculate_plan_financial_impact", "success", `${effectiveAction} ${effectiveService}`);
      return clone(result);
    }

    function runDailySweep({ signals = null } = {}) {
      const state = memory.getState();
      const scenarioSignalMap = Object.freeze({
        viewing_completion_underuse: ["viewingUpdate", "underuseSignal"],
        missing_viewing_status: ["missingInformation"],
        bundle_prepaid_conflict: ["underuseSignal"],
        catalog_migration: ["availabilityChange", "migrationChange"],
        new_priority_release: ["newWatchlistRelease"],
        pause_eligible_underuse: ["viewingUpdate", "underuseSignal"],
        regional_unavailability: ["availabilityChange"],
        content_rating_conflict: ["familyRuleConflict"],
        material_preference_conflict: ["budgetConflict", "familyRuleConflict"],
        annual_prepaid_value: ["underuseSignal"],
        direct_execution_request: ["contradictoryInformation"],
        billing_legal_escalation: ["budgetConflict"]
      });
      const derivedMaterialSignals = new Set(scenarioSignalMap[state.scenario.scenarioType] || []);
      const effectiveSignals = signals || Object.fromEntries(
        SWEEP_SIGNAL_KEYS.map(key => [key, derivedMaterialSignals.has(key)])
      );
      const result = evaluateSweepSignals(effectiveSignals);
      if (result.status === "no_action") {
        recordAudit("run_daily_sweep", "no_action", "No material change detected");
        return clone(result);
      }

      recordAudit("run_daily_sweep", "success", "Signals prepared; no recommendation selected by code");
      return clone(result);
    }

    function updateHouseholdContext({
      updateType,
      payload = {},
      source = "adult_chat",
      scope = "permanent",
      commandId = "",
      expectedHouseholdRevision = null,
      schemaVersion = schemas.versions.toolCommand
    } = {}) {
      const allowedViewingStatuses = new Set(["not_started", "watching", "completed", "unknown"]);
      const timestamp = clock();
      const before = memory.getState();
      const effectiveCommandId = commandId ||
        `command-${updateType}-${timestamp}-${++generatedCommandSequence}`;
      const command = {
        schemaVersion,
        commandId: effectiveCommandId,
        expectedHouseholdRevision: expectedHouseholdRevision == null
          ? Number(before.householdRevision || 0)
          : Number(expectedHouseholdRevision),
        updateType,
        payload
      };
      schemas.validateToolCommand(command);
      if ((before.appliedCommandIds || []).includes(effectiveCommandId)) {
        recordAudit("update_household_context", "duplicate_ignored", effectiveCommandId);
        return memory.getState();
      }

      memory.transact(state => {
        if (updateType === "viewing_confirmation") {
          const {
            memberId = "",
            member = "",
            titleId = state.scenario.titleId,
            status,
            completedOn = null
          } = payload;
          const householdMember = state.members.find(item =>
            (memberId && item.id === memberId) ||
            (member && item.name.toLowerCase() === String(member).toLowerCase())
          );
          if (!householdMember) throw new RangeError("The household member was not found.");
          if (!allowedViewingStatuses.has(status)) throw new RangeError("Unsupported viewing status.");
          if (status === "completed" && !completedOn) throw new TypeError("completedOn is required for a completed viewing update.");
          const catalogTitle = knowledge.catalog.find(item => item.title_id === titleId);
          if (!catalogTitle) throw new RangeError("The viewing title was not found in the catalog.");
          const updateViewingCollection = (collection, { create = false } = {}) => {
            const index = collection.findIndex(item =>
              item.memberId === householdMember.id && item.titleId === titleId
            );
            if (index < 0) {
              if (!create) return;
              collection.push({
                id: `VIEW-MANUAL-${householdMember.id}-${titleId}`,
                caseId: "MANUAL",
                memberId: householdMember.id,
                titleId,
                title: catalogTitle.title_name,
                status,
                progressPercent: status === "completed" ? 100 : 0,
                completionOffsetDays: status === "completed"
                  ? math.daysBetween(state.systemDate, completedOn)
                  : null,
                completedOn: status === "completed" ? completedOn : null,
                source
              });
              return;
            }
            const previousViewing = collection[index];
            collection[index] = {
              ...previousViewing,
              status,
              progressPercent: status === "completed" ? 100 : previousViewing.progressPercent,
              completedOn: status === "completed" ? completedOn : null,
              completionOffsetDays: status === "completed"
                ? math.daysBetween(state.systemDate, completedOn)
                : previousViewing.completionOffsetDays,
              source
            };
          };
          updateViewingCollection(state.viewing);
          updateViewingCollection(state.householdViewing, { create: true });
          state.householdViewingHistory = state.householdViewing.filter(item => item.status === "completed");
          state.contextFreshness.viewingOffsetDays = 0;
        } else if (updateType === "subscription_record") {
          const {
            serviceId,
            field,
            value,
            planId = "",
            effectiveDate = ""
          } = payload;
          const servicePlans = knowledge.services.filter(plan => plan.service_id === serviceId);
          if (!servicePlans.length) throw new RangeError("The subscription service was not found.");
          let subscription = state.subscriptions.find(item => item.serviceId === serviceId);
          const currentMonth = state.householdSpendingHistory.find(record => Number(record.monthOffset) === 0);
          const adjustCurrentSpending = (delta, note) => {
            if (!currentMonth || !Number.isFinite(delta) || delta === 0) return;
            currentMonth.totalMonthlySpend = math.roundCurrency(
              Math.max(0, Number(currentMonth.totalMonthlySpend) + delta)
            );
            currentMonth.changeNote = note;
          };

          if (field === "subscriptionPlan") {
            const plan = servicePlans.find(item => item.plan_id === (planId || value));
            if (!plan) throw new RangeError("The subscription plan was not found for that service.");
            const previousMonthlyContribution = subscription?.status === "active"
              ? Number(subscription.monthlyCost || 0)
              : 0;
            const monthlyCost = Number(plan.monthly_price || 0);
            const planRecord = {
              id: subscription?.id || `SUB-MANUAL-${serviceId}`,
              serviceId,
              service: plan.service_name,
              planId: plan.plan_id,
              plan: plan.plan_name,
              status: "active",
              monthlyCost,
              planMonthlyCost: monthlyCost,
              planAnnualCost: plan.annual_price ? Number(plan.annual_price) : null,
              planUpfrontCost: Number(plan.upfront_cost || plan.monthly_price || 0),
              billingCadence: plan.billing_cadence,
              renewalStatus: subscription?.renewalStatus || "auto_renew",
              renewalOffsetDays: subscription?.renewalOffsetDays ?? null,
              nextRenewal: subscription?.nextRenewal || null,
              expirationOffsetDays: subscription?.expirationOffsetDays ?? null,
              expirationDate: subscription?.expirationDate || null,
              prepaidThrough: subscription?.prepaidThrough || null,
              promotionOrBundle: subscription?.promotionOrBundle || plan.promotion_terms || "none",
              commitmentTerms: plan.cancellation_terms || "month-to-month",
              cancellationConsequences: plan.cancellation_terms || "",
              pauseEligible: plan.pause_eligible === "true",
              maxPauseDays: Number(plan.max_pause_days || 0),
              maxPauseMonths: Number(plan.max_pause_months || 0),
              pauseTerms: plan.pause_terms || "not_available",
              postCancellationMonthlyCost: subscription?.postCancellationMonthlyCost ?? null,
              forfeitedValue: subscription?.forfeitedValue || 0,
              approvedAccountUrl: plan.approved_account_url || "",
              approvedSupportUrl: plan.approved_support_url || ""
            };
            if (subscription) {
              Object.assign(subscription, planRecord);
            } else {
              state.subscriptions.push(planRecord);
              subscription = planRecord;
            }
            adjustCurrentSpending(
              monthlyCost - previousMonthlyContribution,
              `${plan.service_name} changed to ${plan.plan_name} from adult-provided information`
            );
          } else {
            if (!subscription) throw new RangeError("The household does not yet have a matching subscription record; the plan is required first.");
            if (field === "subscriptionStatus") {
              if (!["active", "canceled", "paused"].includes(value)) throw new RangeError("Unsupported subscription status.");
              const previousStatus = subscription.status;
              subscription.status = value;
              const previousContribution = previousStatus === "active" ? Number(subscription.monthlyCost || 0) : 0;
              const nextContribution = value === "active" ? Number(subscription.monthlyCost || 0) : 0;
              adjustCurrentSpending(
                nextContribution - previousContribution,
                `${subscription.service} status changed to ${value} from adult-provided information`
              );
            } else if (field === "monthlyCost") {
              const monthlyCost = Number(value);
              if (!Number.isFinite(monthlyCost) || monthlyCost < 0) throw new RangeError("The monthly subscription cost is invalid.");
              const previousCost = Number(subscription.monthlyCost || 0);
              subscription.monthlyCost = monthlyCost;
              if (subscription.status === "active") {
                adjustCurrentSpending(
                  monthlyCost - previousCost,
                  `${subscription.service} monthly cost updated from adult-provided information`
                );
              }
            } else if (field === "renewalStatus") {
              if (!["auto_renew", "non_renewing"].includes(value)) throw new RangeError("Unsupported renewal status.");
              subscription.renewalStatus = value;
            } else if (["nextRenewal", "expirationDate"].includes(field)) {
              if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError("A valid subscription date is required.");
              subscription[field] = value;
              const offsetField = field === "nextRenewal" ? "renewalOffsetDays" : "expirationOffsetDays";
              subscription[offsetField] = math.daysBetween(state.systemDate, value);
            } else {
              throw new RangeError("Unsupported subscription-record field.");
            }
          }
          state.subscriptionChangeLog.push({
            id: `subscription-change-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            serviceId,
            service: servicePlans[0].service_name,
            field,
            value,
            planId,
            effectiveDate: effectiveDate || state.systemDate,
            source,
            timestamp
          });
          state.contextFreshness.subscriptionsOffsetDays = 0;
        } else if (updateType === "watchlist_item") {
          const { memberId, titleId, field, value, effectiveDate = "" } = payload;
          if (!state.members.some(member => member.id === memberId)) {
            throw new RangeError("The household member was not found.");
          }
          const catalogTitle = knowledge.catalog.find(item => item.title_id === titleId);
          if (!catalogTitle) throw new RangeError("The watchlist title was not found in the catalog.");
          const matchingEntries = state.householdWatchlist.filter(item =>
            item.memberId === memberId && item.titleId === titleId
          );
          if (field === "watchlistStatus" && value === "removed") {
            state.householdWatchlist = state.householdWatchlist.filter(item =>
              !(item.memberId === memberId && item.titleId === titleId)
            );
            state.watchlist = state.watchlist.filter(item =>
              !(item.memberId === memberId && item.titleId === titleId)
            );
          } else {
            let entry = matchingEntries[0];
            if (!entry) {
              entry = {
                id: `WL-MANUAL-${memberId}-${titleId}`,
                caseId: "MANUAL",
                memberId,
                titleId,
                title: catalogTitle.title_name,
                contentType: catalogTitle.content_type,
                priority: "medium",
                status: "active",
                acceptableWaitDays: 0,
                completionOffsetDays: null,
                completedOn: null,
                nextReleaseLabel: catalogTitle.next_release_label || "",
                nextReleaseOffsetDays: null,
                nextReleaseDate: catalogTitle.next_air_start_date || null,
                releasePattern: catalogTitle.next_release_pattern || ""
              };
              state.householdWatchlist.push(entry);
            }
            if (field === "priority") {
              if (!["high", "medium", "low"].includes(value)) throw new RangeError("Unsupported watchlist priority.");
              entry.priority = value;
            } else if (field === "watchlistStatus") {
              if (!["active", "completed"].includes(value)) throw new RangeError("Unsupported watchlist status.");
              entry.status = value;
              entry.completedOn = value === "completed" ? effectiveDate || state.systemDate : null;
            } else {
              throw new RangeError("Unsupported watchlist field.");
            }
          }
          state.contextFreshness.watchlistOffsetDays = 0;
        } else if (updateType === "title_rating_exception") {
          const {
            memberId,
            titleId,
            approved
          } = payload;
          const member = state.members.find(item => item.id === memberId);
          if (!member || Number(member.age) >= 18) throw new RangeError("A title-rating exception requires a household member under age 18.");
          const title = knowledge.catalog.find(item => item.title_id === titleId);
          if (!title) throw new RangeError("A title-rating exception must identify a known title.");
          if (approved !== true) throw new TypeError("Explicit authorized-adult approval is required.");
          if (scope !== "one_time") throw new RangeError("A child-rating exception must use one-time scope.");
          state.familyRules.contentRatingExceptions = (state.familyRules.contentRatingExceptions || [])
            .filter(item => !(item.memberId === memberId && item.titleId === titleId));
          state.familyRules.contentRatingExceptions.push({
            memberId,
            titleId,
            titleName: title.title_name,
            rating: title.content_rating,
            approved: true,
            scope: "one_time",
            source,
            timestamp
          });
          state.familyRules.ruleChanges.push({
            rule: "titleRatingException",
            value: `${memberId}:${titleId}`,
            scope: "one_time",
            source,
            timestamp
          });
          state.contextFreshness.familyRulesOffsetDays = 0;
        } else if (updateType === "family_rule") {
          const { rule, value } = payload;
          const editableRules = new Set(["monthlyBudgetCap", "advertisingTolerance", "resolutionPreference", "priorityPolicy"]);
          if (!editableRules.has(rule)) throw new RangeError("That family rule is not editable through this tool.");
          if (rule === "monthlyBudgetCap") {
            const budget = Number(value);
            if (!Number.isFinite(budget) || budget <= 0) throw new RangeError("The monthly budget must be greater than zero.");
            state.familyRules.monthlyBudgetCap = budget;
          } else if (rule in state.familyRules) {
            state.familyRules[rule] = value;
          } else {
            state.household[rule] = value;
          }
          state.familyRules.ruleChanges.push({ rule, value, scope, source, timestamp });
          state.contextFreshness.familyRulesOffsetDays = 0;
        } else if (updateType === "additional_escalation") {
          const condition = String(payload.condition || "").trim();
          if (!condition) throw new TypeError("An additional escalation condition is required.");
          if (!state.familyRules.additionalEscalations.includes(condition)) {
            state.familyRules.additionalEscalations.push(condition);
          }
          state.familyRules.ruleChanges.push({ rule: "additionalEscalation", value: condition, scope, source, timestamp });
          state.contextFreshness.familyRulesOffsetDays = 0;
        } else if (updateType === "remove_additional_escalation") {
          const condition = String(payload.condition || "").trim();
          state.familyRules.additionalEscalations = state.familyRules.additionalEscalations.filter(item => item !== condition);
          state.familyRules.ruleChanges.push({ rule: "additionalEscalationRemoved", value: condition, scope, source, timestamp });
          state.contextFreshness.familyRulesOffsetDays = 0;
        } else if (updateType === "external_action_confirmation") {
          const { serviceId = "", service = "", newStatus, confirmed } = payload;
          if (confirmed !== true) throw new TypeError("Explicit completion confirmation is required.");
          const subscription = state.subscriptions.find(item =>
            (serviceId && item.serviceId === serviceId) ||
            (service && item.service.toLowerCase() === String(service).toLowerCase())
          );
          if (!subscription) throw new RangeError("No matching subscription was found.");
          if (!["active", "canceled", "paused"].includes(newStatus)) throw new RangeError("Unsupported subscription status.");
          const previousStatus = subscription.status;
          subscription.status = newStatus;
          if (previousStatus === "active" && ["canceled", "paused"].includes(newStatus)) {
            const currentMonth = state.householdSpendingHistory.find(record => Number(record.monthOffset) === 0);
            if (currentMonth) {
              currentMonth.totalMonthlySpend = math.roundCurrency(
                Math.max(0, Number(currentMonth.totalMonthlySpend) - Number(subscription.monthlyCost))
              );
              currentMonth.recommendationSavings = math.roundCurrency(
                Number(currentMonth.recommendationSavings || 0) + Number(subscription.monthlyCost)
              );
              currentMonth.changeNote = `${subscription.service} ${newStatus}; Streaming Guard savings recorded`;
            }
            state.recommendationSavingsEvents.push({
              id: `savings-${state.scenario.id}-${subscription.serviceId}-${state.systemDate}`,
              serviceId: subscription.serviceId,
              service: subscription.service,
              action: newStatus === "paused" ? "pause" : "cancel",
              confirmedOn: state.systemDate,
              monthlySavings: Number(subscription.monthlyCost),
              sourceRecommendationId: state.scenario.id
            });
          }
          state.review.externalActionConfirmed = true;
          state.review.status = "completed";
          state.review.adultDecision = "Agreed and completed externally";
          state.review.dailyReminderEnabled = false;
          state.review.lastReminderOn = null;
          state.contextFreshness.subscriptionsOffsetDays = 0;
        } else {
          throw new RangeError("Unsupported household update type.");
        }

        const updateProvenance = schemas.provenance({
          source,
          recordedAt: timestamp,
          verifiedAt: timestamp,
          effectiveFrom: payload.effectiveDate || state.systemDate,
          confidence: "adult_confirmed"
        });
        if (updateType === "viewing_confirmation") {
          [...state.viewing, ...state.householdViewing].forEach(record => {
            if ((!payload.memberId || record.memberId === payload.memberId) &&
                (!payload.titleId || record.titleId === payload.titleId)) {
              record._provenance = updateProvenance;
            }
          });
        } else if (["subscription_record", "external_action_confirmation"].includes(updateType)) {
          state.subscriptions.forEach(record => {
            if ((!payload.serviceId || record.serviceId === payload.serviceId) &&
                (!payload.service || record.service === payload.service)) {
              record._provenance = updateProvenance;
            }
          });
        } else if (updateType === "watchlist_item") {
          state.householdWatchlist.forEach(record => {
            if (record.memberId === payload.memberId && record.titleId === payload.titleId) {
              record._provenance = updateProvenance;
            }
          });
        } else if ([
          "title_rating_exception",
          "family_rule",
          "additional_escalation",
          "remove_additional_escalation"
        ].includes(updateType)) {
          state.familyRules._provenance = updateProvenance;
        }
        state.appliedCommandIds = [...(state.appliedCommandIds || []), effectiveCommandId].slice(-500);
      }, {
        expectedHouseholdRevision: command.expectedHouseholdRevision
      });

      recordAudit(
        "update_household_context",
        "success",
        `${updateType} · ${effectiveCommandId} · revision ${memory.householdRevision()}`
      );
      traceManager?.span?.(
        "memory_write",
        `${updateType} applied as ${effectiveCommandId} at household revision ${memory.householdRevision()}.`
      );
      return memory.getState();
    }

    function validateOutputUrl({ serviceId = "", serviceName = "", url, urlType = "account" } = {}) {
      const state = memory.getState();
      const effectiveServiceId = serviceId || state.scenario.targetServiceId;
      const effectiveServiceName = serviceName || state.scenario.targetServiceName;
      const urlField = urlType === "support" ? "approved_support_url" : "approved_account_url";
      const plans = knowledge.services.filter(service =>
        (effectiveServiceId && service.service_id === effectiveServiceId) ||
        (effectiveServiceName && service.service_name.toLowerCase() === effectiveServiceName.toLowerCase())
      );
      const valid = plans.some(plan => plan[urlField] === url);
      const result = {
        valid,
        url: valid ? url : null,
        reason: valid ? "URL matches the approved service record." : "URL does not match an approved service record."
      };
      recordAudit("validate_output_url", valid ? "success" : "rejected", urlType);
      return result;
    }

    function sendChatResponse({
      text = "",
      kind = "text",
      role = "agent",
      refusalSections = null,
      redacted = false,
      redactionReason = null
    } = {}) {
      if (!["text", "recommendation", "choices", "confirmation", "refusal"].includes(kind)) {
        throw new RangeError("Unsupported chat response kind.");
      }
      if (kind === "text" && !text) throw new TypeError("text is required for a text chat response.");
      if (
        kind === "refusal" &&
        (!refusalSections || ["yourRequest", "myResponse", "whyRefusing", "whatYouCanDoNext"]
          .some(field => typeof refusalSections[field] !== "string" || !refusalSections[field].trim()))
      ) {
        throw new TypeError("A refusal response requires all four structured refusal sections.");
      }
      const locale = memory.getState().household.locale || "en-US";
      const message = {
        id: `message-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        role,
        text,
        kind,
        refusalSections: kind === "refusal" ? clone(refusalSections) : null,
        redacted: Boolean(redacted),
        redactionReason: redacted ? redactionReason : null,
        time: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(new Date())
      };
      memory.transact(state => {
        state.messages.push(message);
      });
      recordAudit("send_chat_response", "success", kind);
      return clone(message);
    }

    const implementations = Object.freeze({
      get_service_details: getServiceDetails,
      query_catalog: queryCatalog,
      load_household_context: loadHouseholdContext,
      calculate_plan_financial_impact: calculatePlanFinancialImpact,
      run_daily_sweep: runDailySweep,
      update_household_context: updateHouseholdContext,
      validate_output_url: validateOutputUrl,
      send_chat_response: sendChatResponse
    });

    return Object.freeze({
      names: TOOL_NAMES,
      invoke(name, argumentsObject = {}) {
        const implementation = implementations[name];
        if (!implementation) throw new RangeError(`Unknown tool: ${name}.`);
        return implementation(argumentsObject);
      },
      ...implementations
    });
  }

  global.StreamingGuardAgentTools = Object.freeze({
    createAgentTools,
    evaluateSweepSignals,
    sweepSignalKeys: SWEEP_SIGNAL_KEYS,
    toolNames: TOOL_NAMES
  });
})(window);
