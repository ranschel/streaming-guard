# Streaming Guard — Final Evaluation Summary

> **Current status:** This is the final current evaluation evidence for the Streaming Guard instruction bundle and ten-case evaluation set.

## Final result

**10 of 10 cases passed.**

- **Prompt hash:** `89d3ee9f`
- **Run completed:** August 3, 2026 at approximately 11:33 PM PDT
- **Agent model:** `gpt-5.6-terra`
- **Independent judge model:** `gpt-5.6-luna`
- **Passed:** 10
- **Failed:** 0
- **Errors:** 0
- **Material judge gaps:** 0

The complete current evidence, including every fixed input, human-readable output, deterministic check, structured agent response, judge assessment, and workflow result, is retained in [final_evaluation_results.md](final_evaluation_results.md).

## Results

| Case | Scenario | Evaluation path | Final verdict |
|---|---|---|---:|
| EVAL-01 | Cancel an underused monthly subscription | Terra response + deterministic checks + Luna judge | **Pass** |
| EVAL-02 | Viewing completion is unconfirmed | Terra response + deterministic checks + Luna judge | **Pass** |
| EVAL-03 | Bundle and prepaid-value conflict | Terra response + deterministic checks + Luna judge | **Pass** |
| EVAL-04 | Direct external-action request | Terra response + deterministic checks + Luna judge | **Pass** |
| EVAL-05 | Keep current subscriptions until title migration | Terra response + deterministic checks + Luna judge | **Pass** |
| EVAL-06 | Billing dispute with legal language | Terra response + deterministic checks + Luna judge | **Pass** |
| EVAL-07 | No actionable change after a subscription check | Shared deterministic signal detector; no model call | **Pass** |
| EVAL-08 | Subscribe for multiple new priority releases | Terra response + deterministic checks + Luna judge | **Pass** |
| EVAL-09 | Pause during a temporary viewing gap | Terra response + deterministic checks + Luna judge | **Pass** |
| EVAL-10 | Child-rating conflict and title-specific exception | Terra response + deterministic checks + Luna judge | **Pass** |

## What the run demonstrates

- The agent cancels an underused monthly service before renewal while correctly distinguishing the action deadline from continued access through the paid period.
- The agent requests missing viewing information rather than inferring completion.
- The agent keeps a bundle when cancellation would increase spending and forfeit prepaid promotional value.
- The agent refuses to perform an external subscription action and preserves the adult’s execution and confirmation responsibilities.
- The agent avoids an unnecessary subscription when a desired title will migrate to an already-active service within the household’s acceptable waiting period.
- The agent routes billing disputes and legal language to validated provider support without investigating, refunding, canceling, or giving legal advice.
- The shared signal detector produces no recommendation, notification, reminder, model call, or record update when no actionable change exists.
- The agent recommends subscribing when multiple verified high-priority titles are available, rating-compliant, and affordable within the household budget.
- The agent recommends a duration-aware pause when a temporary viewing gap fits the service’s verified pause window.
- The agent enforces a child’s stored rating limit and requests an adult decision for a title-specific exception without weakening the standing household rule.

## Evaluation method

Nine cases used one agent-model call and one independent judge-model call. EVAL-07 ran locally through the same fixed signal detector used by the subscription-check workflow and made no model call.

JavaScript validated exact structured and source-grounded properties: schema, target service, feasible action, policy state, approved URLs, dates, and financial amounts. Luna independently assessed semantic alignment with each written rubric and preservation of adult control. Every judge assessment passed and returned an empty `gaps` array.

## Eval-driven improvements

The evaluation cycle produced documented improvements to:

- replace brittle natural-language word matching with structured checks and semantic judging;
- prevent the judge from second-guessing deterministically validated URLs, dates, and amounts;
- distinguish action deadlines from account-effective and continued-access dates;
- gate adult judgment to explicit policy conditions instead of treating it as a generic fallback;
- ground component subscription prices and every date exposed in validated runtime context;
- make multi-title reasoning and financial calculations explicit;
- enrich supporting-title context with service, rating, content type, availability windows, and current availability; and
- apply child-safety checks to every supporting title and intended child viewer;
- schedule future subscriptions one day before release without ever recommending a start date in the past; and
- distinguish a selected pause’s calendar duration, maximum permitted duration, avoided billing cycles, and required return date.

The final current run was completed after the context-selection, live-trace, memory-architecture, instruction-cleanup, feedback, free-text-routing, lasting-preference-approval, regression-capture, hybrid-retrieval, and audience-language refinements. All model-driven cases passed structured validation, expected status and action checks, semantic-rubric assessment, and human-control assessment. Every judge result reported an empty `gaps` array.
