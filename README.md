# Streaming Guard

<p align="center">
  <img src="assets/streaming-guard-shield-256.png" width="160" alt="Streaming Guard shield">
</p>

Streaming Guard is an advisory agent prototype that helps a household decide whether to subscribe, keep the current plan unchanged, pause, or cancel a streaming service.

It brings together subscription costs, renewal dates, viewing confirmations, watchlist priorities, release schedules, household preferences, and family rules to produce one clear recommendation for an adult to review.

> **Prototype status:** Develop phase. The browser demo is functional and persistent, can connect directly to OpenAI, Anthropic, or Google Gemini for live recommendations and conversation, and remains disconnected from external streaming accounts.

## What the prototype demonstrates

The WhatsApp-style Chat offers two source-backed demonstration triggers. Both anchor their dates to the browser’s local calendar:

1. **Run daily background sweep** simulates the proactive daily check. Streaming Guard detects that Aurora+ is no longer being used after Morgan and Riley finish *Starward Station*, reviews the household context, and recommends canceling before the next renewal.
2. **Review a new subscription request** begins with Riley asking to watch *The Last Mariner*. Streaming Guard compares a new $7.99 TidePlay subscription with the household’s existing ViewFlix coverage and recommends keeping the current lineup because the title reaches ViewFlix in two months.

In either story, the adult can agree, disagree, ask a question, or provide additional information, and the model can revise its recommendation when relevant facts change. Any recommended external subscription action remains manual. The local subscription record changes only after the adult confirms completing that action.

The interface makes the complete agent loop visible:

```text
Trigger → context → decision → recommendation → adult review → external action → confirmation
```

The recommendation-progress rail reveals only steps that have started, so future actions do not appear before they become relevant. During a live agent call, a privacy-safe API activity card shows the selected provider and model, a summary of the instruction and context categories sent, request and waiting status, elapsed time, validation completion, available token usage, and a shortened response identifier. It never displays an API key or the complete prompt contents.

New WhatsApp messages never force the conversation to jump to the bottom. The interface preserves the adult’s current scroll position as messages and controls appear, leaving conversation navigation fully under the user’s control.

The application has four permanent top-level views: **Chat**, **Context**, **Spending**, and **Evals**. Every refresh starts on Chat, and the adult can switch among the views without opening or dismissing a modal. The Chat view retains the three-column prototype dashboard. Its WhatsApp application bar includes a **Full screen** toggle that expands the conversation across the entire viewport, hides the prototype navigation and guidance panels, and preserves the active conversation. The user can select **Exit full screen** or press Escape to restore the complete dashboard. **Save full chat** creates one local PNG containing the WhatsApp header and complete conversation, including messages outside the visible scroll area; the capture stays in the browser and is not uploaded.

The supporting dashboard, household-context view, and spending view use a midnight-violet design system: Deep Iris canvas, progressively lighter violet surfaces, cyan data accents, mint positive states, geometric typography, rounded cards, and pill actions. The center conversation intentionally retains its familiar WhatsApp-inspired treatment so the adult-facing channel remains visually distinct from the prototype guidance panels.

Household context starts with an at-a-glance summary and groups nonfinancial information into **Viewing and watchlists**, **Household preferences and rules**, and **Data freshness**.

The Spending view contains the current monthly total, budget utilization, current plans, renewal and expiration dates, a 12-month spending-and-savings chart, annual subscription spending, annual realized savings from completed Streaming Guard recommendations, and total savings to date. Financial history covers 36 tracked months. A saving is recorded only after the adult confirms completing a recommended cancellation or pause; agreement alone does not count, and a repeated confirmation cannot count the same active subscription twice.

The Evals view contains the ten-case evaluation runner. The first five cases preserve the official capstone baseline; EVAL-06 and EVAL-07 add the original PRD billing-escalation and silent-no-action cases; EVAL-08 and EVAL-09 add supported subscribe and duration-aware pause decisions; and EVAL-10 tests the child-rating boundary and title-specific adult exception. Pause recommendations carry three independently validated structured values—selected calendar days, maximum permitted days, and avoided billing cycles—so models cannot conflate a 57-day pause with two avoided monthly charges. The semantic judge accepts natural equivalents such as keeping or retaining an existing record instead of requiring the literal phrase “no record change.” A compact results dashboard continuously shows passed, failed, error, and not-run totals. The top action bar keeps **Run all cases**, **Copy output**, and **Clear results** visible, while **Rejudge saved outputs** and **Revoke instructions approval** live under **More**. During an active run, **Stop tests** replaces **Run all cases**, aborts the in-flight model request, preserves completed results, and leaves unstarted cases as not run. The separate **Instructions** button in the page header opens the six exact instruction files, fingerprint, and approval gate without reducing the result area. The results-first workspace uses a narrow selectable ten-case list and gives the remaining space to one focused case. Human-readable input and output appear first; the case definition, deterministic and judge checks, structured response, and raw judge result are collapsible. On narrow screens, the case list becomes a horizontal selector above the result. No evaluation is available until the user reviews the instruction bundle and explicitly approves its current fingerprint. Editing an instruction, case definition, agent-model selection, or judge-model selection automatically invalidates that approval and hides results from the older version. Nine cases each make one call to the selected agent model and one call to the separately selected semantic-judge model; EVAL-07 runs its fixed inputs through the shared signal detector locally and verifies that the no-action path makes no model call. **Copy output** creates a paste-ready report containing every saved verdict, structured check, judge assessment, error, prompt hash, and complete output. **Rejudge saved outputs** sends compatible saved agent outputs to the selected judge without regenerating the responses; compatibility requires the same agent model, agent instructions, and case definitions.

## Product principles

- **Advisory only:** Streaming Guard cannot purchase, cancel, pause, pay for, or modify an external account.
- **Adult-controlled:** Agreement with a recommendation is separate from completing the external action.
- **Confirmation before memory updates:** A subscription status changes only after the adult confirms completing the action externally.
- **Grounded recommendations:** Titles, prices, renewal dates, viewing status, release dates, and financial calculations must come from the supplied records.
- **No inferred viewing:** A title is complete for a family member only after completion is explicitly reported.
- **Streaming-only scope:** The agent does not answer or store requests unrelated to household streaming-subscription planning, management, viewing access, or spending.
- **No recommendation with blocking gaps:** Missing, stale, conflicting, ambiguous, or unconfirmed required information must be requested from the authorized adult before a recommendation is made.
- **Child-safety rating enforcement:** The agent checks each intended child viewer’s age-based television or movie rating limit. Only the authorized adult may approve an exception, and every exception is restricted to one named title and named child viewer.
- **Immutable system escalation policy:** The household may add stricter escalation conditions, but cannot remove or weaken system-required escalations.
- **Household-configurable rules:** The authorized adult may explicitly update household preferences and rules, such as the budget or content limits.
- **Sensitive-data boundary:** Passwords, payment details, authentication codes, and API keys must never be stored in project files or household memory.

## Run it locally

No installation, package manager, build step, or local server is required.

1. Download or clone this repository.
2. Keep `index.html`, `assets/`, `css/`, and `js/` together.
3. Double-click `index.html`.
4. Select **Run daily background sweep** or **Review a new subscription request** to begin a demo story.

The demo stores its state in browser `localStorage`. Refreshing or reopening the file preserves the current scenario and evaluation state. Use **Restart chat** in the WhatsApp header to clear only the active conversation and return to the three-path picker: two guided demo stories plus a free-form manual scenario. The manual path can answer any in-scope subscription-planning, management, viewing-access, or spending question and can save explicit adult-reported subscription, plan, renewal, price, viewing, watchlist, budget, preference, or family-rule changes without requiring an active recommendation. It asks for a missing exact plan or other required value instead of guessing or saving a partial record. Every message uses the same stored household context, fictional service and title catalogs, global instructions, conversation add-on, safety boundaries, and selected live agent model. Execution refusals appear in a dedicated four-row card covering the request, the refusal, its reason, and the adult’s next step. Model connections and evaluation results remain saved. Use **Restart demo** to clear the conversation, scenario progress, reminders, household changes, evaluation approval, and evaluation results while keeping saved provider connections. Use **Reset all saved data** to remove that state and all provider connections.

The browser date becomes the scenario’s system date. Renewal dates, recent viewing-completion dates, and the future season date are derived from relative offsets, so the decision logic and urgency remain consistent whenever the demo is run.

## Current implementation

The working prototype is a single-page application built with:

- HTML
- CSS
- Vanilla JavaScript
- Browser `localStorage`

Streaming Guard uses a hybrid agent architecture. Deterministic tools assemble verified evidence, calculate financial effects, identify feasible actions, and enforce immutable safety and approval boundaries. The selected OpenAI, Claude, or Gemini model chooses the final recommendation status and action, generates the complete adult-facing structured recommendation, and handles open-ended conversation through the same provider-independent contract. The browser application is separated into knowledge, active-scenario configuration, household context, memory, calculation, recommendation, controlled-tool, LLM-client, rendering, and orchestration modules. `index.html` contains only the page shell and ordered resource references.

A persistent footer provides self-contained **About**, **Terms of Use**, **Privacy Policy**, and **Copyright** panels. The privacy disclosure explains browser-local storage, optional direct provider API requests, evaluation-call approval, saved-key controls, and the prohibition on real sensitive information.

The CSV, JSON, policy, and LLM-instruction files remain the editable sources of truth. `scripts/build-knowledge.mjs` generates the checked-in browser knowledge bundle used by the double-click demo. `js/scenario-config.js` selects the active source-backed scenario and review horizon; service, plan, title, household members, viewing records, subscription snapshot, prices, and relative dates are resolved from the knowledge bundle at runtime. When the LLM is connected, the same layers can be assembled into its runtime context.

## Repository structure

```text
.
├── index.html
├── README.md
├── assets/
│   └── streaming-guard-shield-256.png
├── css/
│   └── streaming-guard.css
├── js/
│   ├── agent-tools.js
│   ├── app.js
│   ├── evaluation-runner.js
│   ├── household-context.js
│   ├── knowledge-base.js
│   ├── memory-store.js
│   ├── openai-client.js
│   ├── recommendation-engine.js
│   ├── scenario-config.js
│   ├── streaming-guard-math.js
│   └── ui-renderers.js
├── data/
│   ├── agent_evals.csv
│   ├── eval_cases.csv
│   ├── family_rules.json
│   ├── household_members_profile.json
│   ├── household_profile.json
│   ├── household_spending_history.csv
│   ├── household_subscriptions.csv
│   ├── simulation_subscription_scenarios.csv
│   ├── streaming_catalog.csv
│   ├── streaming_services.csv
│   ├── viewing_status.csv
│   └── watchlist.csv
├── instructions/
│   ├── core_system_prompt.md
│   ├── immutable_escalation_policy.md
│   ├── runtime_grounding_rules.md
│   ├── recommendation_add_on.md
│   ├── conversation_add_on.md
│   └── evaluation_judge.md
├── policies/
│   └── family_rules.md
├── scripts/
│   └── build-knowledge.mjs
├── prd/
│   └── streaming_guard_prd.md
└── todo/
    └── streaming_guard_fast_follows.md
```

## Data and memory model

The project separates four kinds of context:

| Layer | Purpose | Can the household change it? |
|---|---|---|
| System instructions | Agent authority, grounding, privacy, and immutable boundaries | No |
| System escalation policy | Required abstentions, refusals, and adult-judgment conditions | No |
| Household rules | Budget, content limits, preferences, and additional escalation conditions | Yes, through an explicit adult instruction |
| Household records | Subscriptions, watchlists, viewing confirmations, and relevant planning context | Yes, when the adult explicitly supplies or confirms a change |

The current browser demo persists the household and scenario state locally. Structured household rules are initialized from `data/family_rules.json`; the prose policy remains useful documentation and LLM context. It does not connect to a production database or share state across browsers or devices.

## Multi-provider model connection

Choose **Connect AI Models** in the global top banner, enter the keys for the providers you intend to use, and select separate agent and judge models. The banner is available from every product tab and is the single place where connection status and both model roles appear. Supported choices are GPT-5.6 Sol, Terra, and Luna; Claude Fable 5, Opus 4.8, Sonnet 5, and Haiku 4.5; and Gemini 3.5 Flash, 3.6 Flash, and 3.5 Flash-Lite. The defaults remain `gpt-5.6-terra` for the agent and `gpt-5.6-luna` for the judge.

OpenAI requests use the Responses API, Anthropic requests use the Messages API, and Gemini requests use `generateContent`; every adapter uses the provider’s JSON-schema response feature. All three receive the same immutable system prompt, escalation policy, recommendation style examples, current household context, source-freshness dates, actual trigger context, applicable title rating, validated URLs, feasible actions, deterministic calculations, and recent conversation. The application never supplies a preselected action, status, or expected eval route.

Agent and judge models can be changed independently and may use different providers. A full ten-case evaluation makes nine calls to the selected agent provider and nine calls to the selected judge provider; the no-action restraint case runs locally. **Rejudge saved outputs** preserves compatible agent outputs and makes only nine new calls to the currently selected judge.

Before displaying a generated recommendation, the application validates its schema, target, action feasibility, factual grounding, financial amounts, and immutable escalation requirements. Validation can reject an unsafe or unsupported model response, but it cannot replace the model’s decision with a code-selected one. The recommendation card identifies the exact provider and model. If the selected provider is disconnected, fails, or returns an invalid result, the prototype displays no recommendation and explains that the selected AI decision step is unavailable.

Open-ended chat turns also use the shared structured-output contract. Alongside the natural-language reply, the selected model returns the semantic turn type, discussion status, recommendation effect, final action, next expected adult input, safety disposition, stable reason codes, four dedicated execution-refusal sections, and any proposed household-context updates. Recommendations classify confidence as High, Medium, or Low. The contract includes explicit out-of-scope handling and a one-title, one-child rating-exception update type. Execution requests and billing or legal issues remain conversation-only safety paths instead of generating the normal ten-field recommendation. When the selected agent provider is connected, all adult chat uses this contract; hardcoded phrase recognition is retained only as an offline fallback.

The application validates every proposed update before invoking a controlled tool. The model cannot directly write memory, confirm an external action, change a financial calculation, or override an immutable boundary. Incomplete proposals remain pending and trigger one decision-ready clarification question that lists the relevant known options or gives grounded examples from the current household, plan, title, and policy context. Valid confirmed updates can revise the recommendation; explicit external-action confirmation must match the active recommendation before the subscription record changes. After a subscription addition, cancellation, pause, reactivation, price update, or plan change is saved, the application calculates a confirmation showing the before-and-after monthly payment, annualized payment, and household budget utilization. If the saved change puts spending above budget, the chat asks whether to keep the current cap, raise it to match the new monthly total, or set a higher amount; the budget remains unchanged until the adult explicitly chooses.

The application persists the conversation outcome, shows only the latest relevant chat controls, removes decision buttons when the discussion is resolved, and replaces the right-side progress tracker with a compact outcome card. A resolved no-action decision can be reopened with **Revisit recommendation**. Guided scenarios show their recommendation steps and decision summary; the unstructured manual scenario hides both while retaining its short scenario explanation and live model-communication status. The left-side monthly streaming card displays the true budget-utilization percentage even above 100%; when spending exceeds the cap, the card switches to a red warning treatment and states the positive amount over budget instead of showing a negative remaining balance.

Provider API keys are stored only in this browser’s `localStorage`; they are never written to the repository. **Restart demo** preserves them, while **Reset all saved data** and **Disconnect all** remove them. Anthropic’s direct-browser request requires its explicit direct-browser access header. This client-side arrangement is limited to the private local course prototype. Before publishing the app for other users, move every provider call behind a server-side endpoint so visitors cannot inspect or reuse credentials.

## Controlled agent tools

Every tool named in the PRD has a callable browser implementation:

| Tool | Prototype behavior |
|---|---|
| `get_service_details` | Retrieves plan, price, feature, contract, and approved-URL records |
| `query_catalog` | Searches title, availability, release, and migration records |
| `load_household_context` | Assembles current household memory and applicable policy layers |
| `calculate_plan_financial_impact` | Delegates deterministic financial calculations to the calculator |
| `run_daily_sweep` | Evaluates material signals and remains silent when no action is found |
| `update_household_context` | Applies validated adult-provided updates and enforces confirmation boundaries |
| `validate_output_url` | Allows only an exact account or support URL from the service records |
| `send_email_notification` | Writes a structured email preview to the local prototype outbox |
| `send_chat_response` | Adds a structured response to the visible conversation |

The email tool does not transmit an external email, and no tool can modify a streaming account. Tool activity is recorded in local household memory for inspection.

## Evaluation approach

The review-first runner uses ten representative cases covering:

- A supported cancellation recommendation
- Missing viewing information
- Bundle and prepaid-value reasoning
- Refusal of a direct execution request
- Keeping the current subscriptions unchanged until a title migrates to an already-active service
- Escalating a billing dispute and legal language to validated provider support
- Remaining silent when a complete subscription check finds no actionable change
- Subscribing for multiple new priority releases while remaining within budget
- Pausing during a temporary viewing gap inside a verified service pause window
- Requesting adult judgment when a title exceeds a child viewer’s stored rating limit and allowing only a title-specific exception

Seven cases invoke the recommendation contract. Two cases invoke the conversational safety contract. The no-action case invokes the shared sweep-signal detector locally and verifies that no agent call, judge call, notification, or record update occurs. Runs are sequential and user-initiated; the runner never retries or hides an API or validation error.

Each model-driven case has a hybrid five-part verdict:

- JavaScript verifies only exact structured facts: schema and policy-state validity, target-service ID, action feasibility, approved URLs, grounded dates and amounts, expected structured status, and expected structured action or execution state.
- A separate structured-output call to the selected judge provider assesses semantic alignment with the complete written rubric.
- The same independent judge separately assesses the adult-control, external-action, confirmation, and record-update boundary.
- The final verdict passes only when every applicable deterministic check and both judge assessments pass.

EVAL-07 has six deterministic workflow checks: the shared signal detector ran, all ten fixed change signals were evaluated as nonmaterial, the result was correctly classified as no action, no agent or judge model was called, no notification or clarification/reminder was produced, and no household record changed.

The evaluation runner and runtime validators contain no word-matching or regular-expression grading of natural-language output. Clear paraphrases, natural evidence statements, and synonyms are assessed for meaning by the judge. JavaScript checks structured target and action fields directly and uses regular expressions only to extract exact URLs, complete calendar dates, and currency amounts for source-backed grounding validation. When those deterministic checks pass, the judge treats each explicitly validated property as authoritative instead of second-guessing it from public brand names. A material fact can satisfy the rubric wherever it appears in the complete response; technical record labels and repetition in a dedicated evidence array are not required. The judge still independently checks that every materially required fact and behavior is present. Every case also includes a manual-review panel with a plain-English version of the complete fixed input and the actual output. Raw structured agent and judge results—or the complete local workflow result for EVAL-07—remain available underneath for technical inspection, and the copy-all export includes both readable and structured evidence.

The most recent pre-rename Develop evaluation passed **10 of 10 cases** with zero failures, errors, or material judge gaps. The Streaming Guard rename changed the instruction fingerprint, so a fresh ten-case run is required before these files become the final current evidence. See the [evaluation summary](evals/final_evaluation_summary.md) and [complete historical results](evals/final_evaluation_results.md).

The instruction architecture has one agent-global layer, two agent task add-ons, and one independent judge instruction:

- Every LLM request receives the core system prompt, fixed escalation policy, and runtime grounding rules as its global instruction layer.
- Recommendation requests add the recommendation task instructions.
- Conversation requests add the conversation task instructions.
- Evaluation judgments use only the separate evaluation-judge instruction, the fixed case, expected behavior, deterministic check results, and complete model output.

The Evals view shows six numbered sections that map one-to-one to six Markdown files in `instructions/`. The displayed text is the exact file content; no hidden instruction text is appended in JavaScript. Each section can be expanded in the instruction drawer or opened by itself in a full-screen reader for detailed review. At runtime, the application assembles either **sections 1–3 + section 4** for a recommendation or **sections 1–3 + section 5** for a conversation. Section 6 governs the independent judge call. Approval is tied to a fingerprint containing all six instruction strings and all ten case definitions.

The project contains a broader case library for later testing, including migration timing, budget conflicts, content-rating boundaries, stale data, annual-plan constraints, and no-action restraint.

Automated verdicts report only what the five explicit checks establish for each case. An LLM judge can still make a judgment error, so the complete agent and judge outputs remain visible and exportable for final human review.

## Project documentation

- [Product requirements](prd/streaming_guard_prd.md)
- [Core System Prompt](instructions/core_system_prompt.md)
- [Immutable Escalation Policy](instructions/immutable_escalation_policy.md)
- [Runtime Grounding Rules](instructions/runtime_grounding_rules.md)
- [Recommendation Add-On](instructions/recommendation_add_on.md)
- [Conversation Add-On](instructions/conversation_add_on.md)
- [Evaluation Judge Instructions](instructions/evaluation_judge.md)
- [Final Evaluation Summary](evals/final_evaluation_summary.md)
- [Household rules](policies/family_rules.md)
- [Prototype fast-follow tracker](todo/streaming_guard_fast_follows.md)

## Known prototype limitations

- A live recommendation or answer requires an API key with active API billing for the selected model provider.
- Recommendation facts, calculations, feasible actions, and external-action boundaries are validated deterministically; the selected provider model chooses the final status and action and generates the structured adult-facing recommendation.
- Streaming availability and pricing are read from project data, not live provider APIs.
- External subscription actions are never executed by the prototype.
- Browser memory is local to the current browser and device.
- A full ten-case evaluation uses eighteen API calls: nine agent responses and nine independent judgments. EVAL-07 is local and makes no API call. Rejudging the nine saved model outputs uses nine additional judge calls.
- No live evaluation run should be treated as current until all six instruction components and ten expected outcomes are reviewed and approved in the Evals view.

## Publishing with GitHub Pages

The current prototype can be hosted as a static GitHub Pages site:

1. Push the repository to GitHub.
2. Open the repository’s **Settings → Pages**.
3. Choose **Deploy from a branch**.
4. Select the publishing branch and the repository root.
5. Save and wait for the Pages URL to become available.

Keep the `assets/`, `css/`, and `js/` directories beside `index.html`; the prototype uses relative paths for its brand assets, stylesheet, knowledge, memory, tools, calculations, and application behavior. Do not commit API keys, credentials, browser-storage exports, personal household information, private production-planning documents, local work logs, hosting metadata, or machine-specific synchronization files. The project `.gitignore` excludes these local-only artifacts.

See GitHub’s official [publishing-source documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) for the current Pages options.

## Roadmap

The pre-rename ten-case hybrid evaluation completed under prompt hash `a1b11dd4`: all ten cases passed with zero failures, errors, or material judge gaps. The Streaming Guard identity now produces a different instruction fingerprint, invalidates the previous approval, and requires one fresh ten-case run. The set covers cancellation, missing information, bundle economics, execution refusal, catalog migration, billing escalation, shared-detector no-action restraint, subscription timing, duration-aware pause, and child-rating exceptions.

The [prototype fast-follow tracker](todo/streaming_guard_fast_follows.md) is now closed with no remaining prototype items. Production infrastructure, integrations, monitoring, and decision-quality gaps are maintained separately in a private backlog that is intentionally excluded from GitHub publishing.

---

Created by **Rotem Anschel** for the Agentic AI Product Management Capstone.
