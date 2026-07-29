(function initializeStreamingGuardTraceManager(global) {
  "use strict";

  function stableHash(value) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function createTraceManager({ memory, clock = () => new Date().toISOString() }) {
    if (!memory) throw new TypeError("Memory is required for trace management.");
    let activeTraceId = null;

    function updateTrace(traceId, mutator) {
      memory.transact(state => {
        const trace = (state.traces || []).find(item => item.traceId === traceId);
        if (!trace) throw new RangeError(`Unknown trace: ${traceId}.`);
        mutator(trace);
      });
    }

    return Object.freeze({
      start({
        operation,
        promptHash = "",
        contextPlan = null,
        model = "",
        provider = ""
      }) {
        const state = memory.getState();
        const startedAt = clock();
        const traceId = `trace-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
        const trace = {
          schemaVersion: 1,
          traceId,
          operation,
          status: "active",
          startedAt,
          completedAt: null,
          householdRevision: state.householdRevision,
          sessionRevision: state.sessionRevision,
          promptHash,
          contextHash: contextPlan?.contextHash || "",
          contextScope: contextPlan?.scope || "",
          provider,
          model,
          spans: [{
            name: "input",
            status: "complete",
            timestamp: startedAt,
            details: "Adult or workflow input accepted."
          }]
        };
        memory.transact(draft => {
          draft.traces = [...(draft.traces || []), trace].slice(-100);
        });
        activeTraceId = traceId;
        return traceId;
      },
      span(name, details = "", status = "complete", traceId = activeTraceId) {
        if (!traceId) return null;
        updateTrace(traceId, trace => {
          trace.spans.push({ name, status, timestamp: clock(), details });
        });
        return traceId;
      },
      complete({
        status = "complete",
        validationOutcome = "",
        traceId = activeTraceId
      } = {}) {
        if (!traceId) return null;
        updateTrace(traceId, trace => {
          trace.status = status;
          trace.completedAt = clock();
          trace.validationOutcome = validationOutcome;
        });
        if (activeTraceId === traceId) activeTraceId = null;
        return traceId;
      },
      activeTraceId() {
        return activeTraceId;
      },
      hash: stableHash
    });
  }

  global.StreamingGuardTraceManager = Object.freeze({
    createTraceManager,
    stableHash
  });
})(window);
