(function initializeScenarioConfig(global) {
  "use strict";

  global.SubscriptionGuardScenarioConfig = Object.freeze({
    activeScenarioId: "SG-001",
    demoScenarios: Object.freeze({
      backgroundSweep: "SG-001",
      subscriptionRequest: "SG-005"
    }),
    subscriptionRequestMemberId: "MEM-003",
    reviewHorizonMonths: 12,
    useBrowserDate: true,
    actionCompletionStatus: Object.freeze({
      cancel: "canceled",
      pause: "paused",
      subscribe: "active",
      keep: "unchanged"
    })
  });
})(window);
