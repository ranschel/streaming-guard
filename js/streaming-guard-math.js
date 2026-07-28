(function initializeSubscriptionGuardMath(global) {
  "use strict";

  const DEFAULT_LOCALE = "en-US";
  const DEFAULT_CURRENCY = "USD";

  function requireFiniteNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new TypeError(`${label} must be a finite number.`);
    }
    return number;
  }

  function toCents(value, label = "amount") {
    return Math.round(requireFiniteNumber(value, label) * 100);
  }

  function fromCents(value) {
    return value / 100;
  }

  function roundCurrency(value) {
    return fromCents(toCents(value));
  }

  function formatCurrency(value, currency = DEFAULT_CURRENCY, locale = DEFAULT_LOCALE) {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(roundCurrency(value));
  }

  function sumMonthlyCosts(subscriptions, status = "active") {
    if (!Array.isArray(subscriptions)) {
      throw new TypeError("subscriptions must be an array.");
    }

    const totalCents = subscriptions
      .filter(subscription => status === null || subscription.status === status)
      .reduce((total, subscription) => (
        total + toCents(subscription.monthlyCost, `${subscription.service || "subscription"} monthlyCost`)
      ), 0);

    return fromCents(totalCents);
  }

  function countSubscriptions(subscriptions, status = "active") {
    if (!Array.isArray(subscriptions)) {
      throw new TypeError("subscriptions must be an array.");
    }
    return subscriptions.filter(subscription => status === null || subscription.status === status).length;
  }

  function calculateBudgetUtilization(monthlySpend, monthlyBudgetCap) {
    const spendCents = toCents(monthlySpend, "monthlySpend");
    const budgetCents = toCents(monthlyBudgetCap, "monthlyBudgetCap");

    if (budgetCents <= 0) {
      throw new RangeError("monthlyBudgetCap must be greater than zero.");
    }

    return {
      monthlySpend: fromCents(spendCents),
      monthlyBudgetCap: fromCents(budgetCents),
      remaining: fromCents(budgetCents - spendCents),
      overage: fromCents(Math.max(0, spendCents - budgetCents)),
      utilizationPercent: (spendCents / budgetCents) * 100
    };
  }

  function calculateSubscriptionChangeImpact({
    beforeMonthly,
    afterMonthly,
    monthlyBudgetCap
  }) {
    const beforeMonthlyCents = toCents(beforeMonthly, "beforeMonthly");
    const afterMonthlyCents = toCents(afterMonthly, "afterMonthly");
    const monthlyChangeCents = afterMonthlyCents - beforeMonthlyCents;

    return Object.freeze({
      beforeMonthly: fromCents(beforeMonthlyCents),
      afterMonthly: fromCents(afterMonthlyCents),
      monthlyChange: fromCents(monthlyChangeCents),
      beforeAnnual: fromCents(beforeMonthlyCents * 12),
      afterAnnual: fromCents(afterMonthlyCents * 12),
      annualChange: fromCents(monthlyChangeCents * 12),
      beforeBudget: Object.freeze(calculateBudgetUtilization(
        fromCents(beforeMonthlyCents),
        monthlyBudgetCap
      )),
      afterBudget: Object.freeze(calculateBudgetUtilization(
        fromCents(afterMonthlyCents),
        monthlyBudgetCap
      ))
    });
  }

  function clampPercent(value) {
    return Math.min(100, Math.max(0, requireFiniteNumber(value, "percentage")));
  }

  function calculateCancellationImpact({
    subscriptions,
    targetService = "",
    targetServiceId = "",
    monthlyBudgetCap,
    projectionMonths = 12
  }) {
    if (!targetService && !targetServiceId) {
      throw new TypeError("targetService or targetServiceId is required.");
    }

    const target = subscriptions.find(subscription =>
      (targetServiceId && subscription.serviceId === targetServiceId) ||
      (targetService && subscription.service === targetService)
    );
    if (!target) {
      throw new RangeError(`No target subscription found.`);
    }

    const months = requireFiniteNumber(projectionMonths, "projectionMonths");
    if (months < 0) {
      throw new RangeError("projectionMonths cannot be negative.");
    }

    const activeMonthlyCents = toCents(sumMonthlyCosts(subscriptions), "activeMonthly");
    const targetMonthlyCents = toCents(target.monthlyCost, `${target.service || targetServiceId} monthlyCost`);
    const targetIsActive = target.status === "active";

    // Preserve the before/after comparison after the adult confirms cancellation.
    const beforeActionCents = targetIsActive
      ? activeMonthlyCents
      : activeMonthlyCents + targetMonthlyCents;
    const afterActionCents = beforeActionCents - targetMonthlyCents;
    const projectedSavingsCents = Math.round(targetMonthlyCents * months);

    const beforeActionMonthly = fromCents(beforeActionCents);
    const afterActionMonthly = fromCents(afterActionCents);
    const activeMonthly = fromCents(activeMonthlyCents);
    const monthlySavings = fromCents(targetMonthlyCents);

    return Object.freeze({
      targetService: target.service,
      targetServiceId: target.serviceId,
      targetIsActive,
      targetMonthlyCost: monthlySavings,
      activeMonthly,
      beforeActionMonthly,
      afterActionMonthly,
      monthlySavings,
      projectionMonths: months,
      projectedSavings: fromCents(projectedSavingsCents),
      activeSubscriptionCount: countSubscriptions(subscriptions),
      beforeActionSubscriptionCount: countSubscriptions(subscriptions) + (targetIsActive ? 0 : 1),
      afterActionSubscriptionCount: countSubscriptions(subscriptions) - (targetIsActive ? 1 : 0),
      beforeBudget: Object.freeze(calculateBudgetUtilization(beforeActionMonthly, monthlyBudgetCap)),
      afterBudget: Object.freeze(calculateBudgetUtilization(afterActionMonthly, monthlyBudgetCap)),
      activeBudget: Object.freeze(calculateBudgetUtilization(activeMonthly, monthlyBudgetCap))
    });
  }

  function calculatePlanFinancialImpact({
    subscriptions,
    action,
    targetService = "",
    targetServiceId = "",
    targetPlan = null,
    monthlyBudgetCap,
    projectionMonths = 12,
    pauseDurationMonths = 0,
    remainingPrepaidValue = 0,
    promotionOrBundleImpact = "none"
  }) {
    const currentMonthlyCents = toCents(sumMonthlyCosts(subscriptions), "currentMonthly");
    const months = requireFiniteNumber(projectionMonths, "projectionMonths");
    const requestedPauseMonths = requireFiniteNumber(pauseDurationMonths, "pauseDurationMonths");
    if (months < 0 || requestedPauseMonths < 0) {
      throw new RangeError("Projection and pause durations cannot be negative.");
    }
    const targetSubscription = subscriptions.find(subscription =>
      (targetServiceId && subscription.serviceId === targetServiceId) ||
      (targetService && subscription.service === targetService)
    );
    let changeCents = 0;
    let upfrontCostCents = 0;

    if (["cancel", "pause"].includes(action)) {
      if (!targetSubscription) throw new RangeError("No target subscription found.");
      if (action === "pause" && requestedPauseMonths <= 0) {
        throw new RangeError("pauseDurationMonths must be greater than zero for a pause calculation.");
      }
      if (targetSubscription.status === "active") {
        changeCents = -toCents(targetSubscription.monthlyCost, `${targetService} monthlyCost`);
      }
    } else if (action === "subscribe") {
      if (!targetPlan) throw new TypeError("targetPlan is required for a subscribe calculation.");
      const planMonthly = targetPlan.billingCadence === "annual"
        ? monthlyEquivalent({ price: targetPlan.annualPrice ?? targetPlan.price, billingCadence: "annual" })
        : requireFiniteNumber(targetPlan.monthlyPrice ?? targetPlan.price, "targetPlan monthly price");
      changeCents = toCents(planMonthly, "targetPlan monthly equivalent");
      upfrontCostCents = toCents(targetPlan.upfrontCost ?? planMonthly, "targetPlan upfront cost");
    } else if (action !== "keep") {
      throw new RangeError(`Unsupported action: ${action}.`);
    }

    const proposedMonthlyCents = currentMonthlyCents + changeCents;
    const effectiveProjectionMonths = action === "pause"
      ? Math.min(months, requestedPauseMonths)
      : months;
    const projectedChangeCents = Math.round(changeCents * effectiveProjectionMonths);
    const prepaidCents = toCents(remainingPrepaidValue, "remainingPrepaidValue");

    return Object.freeze({
      action,
      targetService: targetSubscription?.service || targetService,
      targetServiceId: targetSubscription?.serviceId || targetServiceId,
      currentMonthly: fromCents(currentMonthlyCents),
      proposedMonthly: fromCents(proposedMonthlyCents),
      monthlyChange: fromCents(changeCents),
      monthlySavings: fromCents(Math.max(0, -changeCents)),
      monthlyIncrease: fromCents(Math.max(0, changeCents)),
      projectionMonths: effectiveProjectionMonths,
      reviewHorizonMonths: months,
      pauseDurationMonths: action === "pause" ? effectiveProjectionMonths : 0,
      postPauseMonthly: action === "pause" ? fromCents(currentMonthlyCents) : null,
      projectedChange: fromCents(projectedChangeCents),
      projectedSavings: fromCents(Math.max(0, -projectedChangeCents)),
      projectedIncrease: fromCents(Math.max(0, projectedChangeCents)),
      upfrontCost: fromCents(upfrontCostCents),
      remainingPrepaidValue: fromCents(prepaidCents),
      promotionOrBundleImpact,
      currentBudget: Object.freeze(calculateBudgetUtilization(fromCents(currentMonthlyCents), monthlyBudgetCap)),
      proposedBudget: Object.freeze(calculateBudgetUtilization(fromCents(proposedMonthlyCents), monthlyBudgetCap))
    });
  }

  function monthlyEquivalent({ price, billingCadence }) {
    const priceCents = toCents(price, "price");
    if (billingCadence === "monthly") return fromCents(priceCents);
    if (billingCadence === "annual") return fromCents(Math.round(priceCents / 12));
    throw new RangeError(`Unsupported billing cadence: ${billingCadence}.`);
  }

  function daysBetween(startDate, endDate) {
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new TypeError("startDate and endDate must be valid ISO dates.");
    }
    return Math.round((end.getTime() - start.getTime()) / 86_400_000);
  }

  function localDateIso(date = new Date()) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new TypeError("date must be a valid Date.");
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function addDays(isoDate, dayOffset) {
    const date = new Date(`${isoDate}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) throw new TypeError("isoDate must be a valid ISO date.");
    const offset = requireFiniteNumber(dayOffset, "dayOffset");
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }

  global.SubscriptionGuardMath = Object.freeze({
    roundCurrency,
    formatCurrency,
    sumMonthlyCosts,
    countSubscriptions,
    calculateBudgetUtilization,
    calculateSubscriptionChangeImpact,
    calculateCancellationImpact,
    calculatePlanFinancialImpact,
    monthlyEquivalent,
    clampPercent,
    daysBetween,
    localDateIso,
    addDays
  });
})(window);
