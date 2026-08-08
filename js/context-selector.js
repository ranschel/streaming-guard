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

  function words(value) {
    return normalize(value).split(" ").filter(Boolean);
  }

  function editDistance(left, right) {
    const a = String(left || "");
    const b = String(right || "");
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let row = 1; row <= a.length; row += 1) {
      const current = [row];
      for (let column = 1; column <= b.length; column += 1) {
        current[column] = Math.min(
          current[column - 1] + 1,
          previous[column] + 1,
          previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
        );
      }
      previous.splice(0, previous.length, ...current);
    }
    return previous[b.length];
  }

  function textSimilarity(left, right) {
    const a = normalize(left);
    const b = normalize(right);
    const longest = Math.max(a.length, b.length);
    if (!longest) return 1;
    return 1 - editDistance(a, b) / longest;
  }

  function fuzzyMessageContainsAlias(message, alias, threshold = 0.78) {
    const aliasWords = words(alias);
    if (!aliasWords.length || normalize(alias).length < 5) return false;
    const messageWords = words(message);
    const candidateWidths = unique([
      Math.max(1, aliasWords.length - 1),
      aliasWords.length,
      aliasWords.length + 1
    ]);
    return candidateWidths.some(width =>
      messageWords.some((_, start) => {
        const candidate = messageWords.slice(start, start + width).join(" ");
        return candidate && textSimilarity(candidate, alias) >= threshold;
      })
    );
  }

  function semanticConcepts(message) {
    const normalizedMessage = normalize(message);
    const concepts = new Set(words(normalizedMessage));
    const add = (...values) => values.forEach(value => concepts.add(value));
    const conceptRules = [
      [/\b(?:science fiction|sci fi|space drama)\b/, ["science_fiction", "series"]],
      [/\b(?:finished|finish|completed|complete|done|already watched|saw)\b/, ["completed"]],
      [/\b(?:currently watching|still watching|midway|in progress)\b/, ["watching"]],
      [/\b(?:not started|unstarted|hasn t started|haven t started)\b/, ["not_started"]],
      [/\b(?:hasn t confirmed|not confirmed|unknown)\b/, ["unknown"]],
      [/\b(?:limited series|miniseries)\b/, ["limited_series", "series"]],
      [/\b(?:tv series|tv show|show)\b/, ["tv_series", "series"]],
      [/\b(?:documentary|docuseries|doc)\b/, ["documentary_series", "documentary"]],
      [/\b(?:movie|film|feature)\b/, ["movie"]],
      [/\b(?:period piece|costume drama|period drama)\b/, ["period_drama"]],
      [/\b(?:cooking|food|kitchen)\b/, ["cooking"]],
      [/\b(?:music|musical)\b/, ["music"]],
      [/\b(?:nature|animals|wildlife)\b/, ["nature"]],
      [/\b(?:crime|detective|police)\b/, ["crime_drama"]],
      [/\b(?:mystery|whodunit)\b/, ["mystery"]],
      [/\b(?:thriller|suspense|mature)\b/, ["thriller"]],
      [/\b(?:comedy|funny|sitcom)\b/, ["comedy"]],
      [/\b(?:mariner|maritime|seafaring|ocean|sea adventure)\b/, ["adventure_drama", "adventure"]],
      [/\b(?:family movie|family film)\b/, ["family_drama", "movie"]],
      [/\b(?:weekly|one episode a week)\b/, ["weekly_over_3_months"]],
      [/\b(?:all at once|full season|binge)\b/, ["all_at_once"]],
      [/\b(?:high priority|must watch|important)\b/, ["high"]],
      [/\b(?:medium priority|nice to have)\b/, ["medium"]],
      [/\b(?:low priority|optional)\b/, ["low"]],
      [/\b(?:moves|moving|migrates|migration|coming to|switches services|changes platforms)\b/, ["migration"]],
      [/\b(?:arrives|lands|releases|premieres|becomes available|coming)\b/, ["release"]],
      [/\b(?:age appropriate|appropriate|allowed|safe for|viewing limit|content limit|rating|adult rated)\b/, ["content_rating"]],
      [/\b(?:freeze|suspend|suspension|take a break|temporarily stop)\b/, ["pause"]],
      [/\b(?:sixty|60)\b/, ["60"]],
      [/\b(?:thirty|30)\b/, ["30"]],
      [/\b(?:two months?|2 months?)\b/, ["60"]],
      [/\b(?:one month|1 month)\b/, ["30"]]
    ];
    conceptRules.forEach(([pattern, values]) => {
      if (pattern.test(normalizedMessage)) add(...values);
    });
    return concepts;
  }

  function hasAnyConcept(concepts, values) {
    return values.some(value => concepts.has(value));
  }

  function serviceAliases(serviceName) {
    const normalizedName = normalize(serviceName);
    return unique([
      normalizedName,
      normalizedName.replace(/\s+plus$/, ""),
      normalizedName.replace(/\s+(?:stream|play|tv|flix)$/, ""),
      normalizedName.replace(/(?:screen|stream|play|tv|flix)$/, "")
    ]).filter(alias => alias.length >= 3);
  }

  function titleAliases(titleName) {
    const normalizedName = normalize(titleName);
    // Single-word aliases are useful for distinctive references such as
    // “Starward,” but short words create false matches with ordinary chat.
    const genericTitleWords = new Set(["family"]);
    const words = normalizedName.split(" ").filter(word =>
      word.length >= 6 && !genericTitleWords.has(word)
    );
    return unique([
      normalizedName,
      ...words
    ]).filter(alias => alias.length >= 4);
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
    return /\b(?:review everything|review all|all subscriptions|entire household|whole household|portfolio|current spending|budget utilization|how much (?:do )?(?:we|i) spend|reduce (?:our |my )?spending|reduce what we pay|make more room in (?:the )?(?:streaming )?budget|cut (?:our |my )?spending|save (?:us |me )?money|optimi[sz]e|what should (?:we|i) subscribe|what (?:should|can) (?:we|i) add|subscribe to next|what should (?:we|i) watch next|monthly allowance|lower (?:the )?(?:our |household )?(?:entertainment )?bill|trim (?:our )?(?:streaming |streamng )?expenses|platform should we add|membership best covers|new servce best covers|next service for (?:our )?queue|best new platform for (?:the )?(?:household )?wishlist)\b/
      .test(message);
  }

  function isSubscriptionInventoryRequest(message) {
    return /\b(?:what subscriptions (?:do|does) (?:we|i|the household) have|which subscriptions (?:do|does) (?:we|i|the household) have|what (?:are )?(?:our|my|the household s) (?:current |active )?subscriptions|which subscriptions are (?:currently )?active|what (?:streaming )?services (?:do|does) (?:we|i|the household) have|which (?:streaming )?services (?:are we|am i|is the household) subscribed to|what (?:are we|am i|is the household) subscribed to|(?:list|show)(?: me)? (?:our|my|the household s|the current) subscriptions|current subscriptions|active subscriptions|streaming memberships (?:are )?we paying for|lineup of paid platforms|active subscriptons|streaming service currently being billed|paid streaming roster)\b/
      .test(message);
  }

  function isBroadSubscriptionDiscovery(message) {
    return /\b(?:what should (?:we|i) subscribe|what (?:should|can) (?:we|i) add|subscribe to next|new subscription|next subscription|platform should we add next|membership best covers (?:our )?(?:viewing )?queue|new servce best covers (?:the )?family s wishlist|next service for (?:our )?queue|best new platform for (?:the )?(?:household )?wishlist)\b/
      .test(message);
  }

  function isSpendingReview(message) {
    return /\b(?:reduce|cut|save|spend|spending|budget|cost|price|bill|expensive|over budget|portfolio|monthly allowance|lower (?:the )?(?:our |household )?(?:entertainment )?bill|trim (?:our )?(?:streaming |streamng )?expenses)\b/
      .test(message);
  }

  function isProductMetaRequest(message) {
    const productSubject = /\b(?:streaming guard|subscription planning agent|this prototype|the prototype)\b/.test(message);
    const productQuestion = /\b(?:success|successful|real life|real world|production|prototype|work|works|working|capabilit|limitation|evidence|evaluation|evaluated|eval)\w*\b/
      .test(message);
    return productSubject && productQuestion;
  }

  function isHouseholdRosterRequest(message) {
    const rosterSubject = /\b(?:family|household|home|kids?|children|child|wife|husband|spouse|partner|members?|people|adults?)\b/
      .test(message);
    const rosterQuestion =
      /\b(?:who (?:is|are|lives?)|who lives|what (?:is|are) the names?|names? of|give me .* names|list|show me|which (?:people|members)|how old)\b/
        .test(message);
    return rosterSubject && rosterQuestion;
  }

  function isExecutionRequest(message) {
    const action = /\b(?:subscribe|cancel|pause|resume|upgrade|downgrade|switch|change|sign (?:us|me) up|drop|terminate|make .+ (?:active|inactive))\b/.test(message);
    const asksAgentToAct =
      /^(?:please )?(?:subscribe|cancel|pause|resume|upgrade|downgrade|switch|change)\b/.test(message) ||
      /\b(?:sign (?:us|me) up|(?:drop|terminate) .+ on (?:my|our) behalf|make .+ (?:active|inactive) for us|for me|on my behalf|do it|complete (?:it|the|this)|make (?:the|this) change|right now|now)\b/.test(message);
    return action && asksAgentToAct;
  }

  function hasStreamingDomainLanguage(message) {
    return /\b(?:streaming|streamng|subscription|subscriptons|membership|service|servce|platform|price|cost|spend|expense|bill|budget|allowance|renew|cancel|pause|freeze|subscribe|watch|watchlist|wishlist|viewing|movie|film|show|series|season|episode|title|release|catalog|rating|parental|prototype|agent)\b/
      .test(message);
  }

  function isObviousOutOfScopeRequest(message) {
    if (!message) return false;
    if (
      isProductMetaRequest(message) ||
      isHouseholdRosterRequest(message) ||
      isSubscriptionInventoryRequest(message) ||
      isBroadRequest(message)
    ) {
      return false;
    }
    if (
      /\b(?:grocer(?:y|ies)|restaurant|meal|recipe|rent|mortgage|electricity|utility|utilities|gas bill|phone bill|insurance)\b/
        .test(message) &&
      !/\b(?:streaming|subscription|membership|service|platform|watch|movie|show|series)\b/.test(message)
    ) {
      return true;
    }
    if (/\b(?:what time is it|what is the time|current time|time now)\b/.test(message)) return true;
    return false;
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
    if (isObviousOutOfScopeRequest(normalizedMessage)) return "out_of_scope";
    if (isProductMetaRequest(normalizedMessage)) return "product_meta";
    if (isHouseholdRosterRequest(normalizedMessage)) return "household_roster";
    if (isExecutionRequest(normalizedMessage)) return "external_execution_request";
    if (scope === "subscription_inventory") return "subscription_inventory";
    if (isBroadSubscriptionDiscovery(normalizedMessage)) return "subscription_discovery";
    if (isSpendingReview(normalizedMessage)) return "spending_review";
    return "focused_conversation";
  }

  function isLikelyStreamingRequest({ message = "", state = null, knowledge = null } = {}) {
    const normalizedMessage = normalize(message);
    const scope = selectionScope({ requestType: "conversation", normalizedMessage });
    const intent = selectionIntent({
      requestType: "conversation",
      scope,
      normalizedMessage,
      scenarioType: state?.scenario?.scenarioType
    });
    if (intent === "out_of_scope") return false;
    if (intent !== "focused_conversation" || hasStreamingDomainLanguage(normalizedMessage)) return true;
    const serviceMatch = (knowledge?.services || []).some(service =>
      serviceAliases(service.service_name).some(alias =>
        messageContainsName(normalizedMessage, alias) ||
        fuzzyMessageContainsAlias(normalizedMessage, alias, 0.78)
      )
    );
    if (serviceMatch) return true;
    const titleMatch = (knowledge?.catalog || []).some(record =>
      titleAliases(record.title_name).some(alias =>
        messageContainsName(normalizedMessage, alias) ||
        fuzzyMessageContainsAlias(normalizedMessage, alias, 0.8)
      )
    );
    if (titleMatch) return true;
    return (state?.members || []).some(member =>
      messageContainsName(normalizedMessage, member.firstName || member.name) ||
      fuzzyMessageContainsAlias(normalizedMessage, member.firstName || member.name, 0.8)
    );
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
    let scope = selectionScope({ requestType, normalizedMessage });
    const subscriptionInventory = scope === "subscription_inventory";
    const broadSubscriptionDiscovery = isBroadSubscriptionDiscovery(normalizedMessage);
    const spendingReview = isSpendingReview(normalizedMessage);
    let intent = selectionIntent({
      requestType,
      scope,
      normalizedMessage,
      scenarioType: state.scenario?.scenarioType
    });
    let productMetaRequest = intent === "product_meta";
    let rosterRequest = intent === "household_roster";
    let executionRequest = intent === "external_execution_request";
    let outOfScopeRequest = intent === "out_of_scope";
    const provenance = [];
    const ambiguities = [];
    const selectedServiceIds = new Set();
    const selectedTitleIds = new Set();
    const selectedMemberIds = new Set();
    const keywordMatches = [];
    const fuzzyMatches = [];
    const semanticMatches = [];
    const concepts = semanticConcepts(normalizedMessage);
    const watchlistRequest = /\b(?:watchlist|wish list|wishlist|viewing queue)\b/.test(normalizedMessage);

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
    const titleAliasMatches = new Map();
    [...catalogByTitleId.entries()].forEach(([titleId, records]) => {
      titleAliases(records[0]?.title_name).forEach(alias => {
        if (!titleAliasMatches.has(alias)) titleAliasMatches.set(alias, new Set());
        titleAliasMatches.get(alias).add(titleId);
      });
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
      if (!productMetaRequest && !outOfScopeRequest && !rosterRequest) {
        serviceNames.forEach(service => {
          const aliases = serviceAliases(service.serviceName);
          const exactAlias = aliases.find(alias => messageContainsName(normalizedMessage, alias));
          const fuzzyAlias = exactAlias
            ? null
            : aliases.find(alias => fuzzyMessageContainsAlias(normalizedMessage, alias, 0.78));
          if (exactAlias || fuzzyAlias) {
            selectedServiceIds.add(service.serviceId);
            (exactAlias ? keywordMatches : fuzzyMatches).push({
              type: "service",
              id: service.serviceId,
              matched: exactAlias || fuzzyAlias
            });
            provenance.push(recordReason(
              "streaming_services.csv",
              service.serviceId,
              exactAlias
                ? `The adult named ${service.serviceName}.`
                : `A close spelling match resolved “${fuzzyAlias}” to ${service.serviceName}.`
            ));
          }
        });
      }
      if (!productMetaRequest && !outOfScopeRequest && !rosterRequest && !executionRequest) {
        [...catalogByTitleId.entries()].forEach(([titleId, records]) => {
          const titleName = records[0]?.title_name;
          const matchedAlias = titleAliases(titleName).find(alias =>
            titleAliasMatches.get(alias)?.size === 1 &&
            messageContainsName(normalizedMessage, alias)
          );
          const fuzzyAlias = matchedAlias
            ? null
            : titleAliases(titleName).find(alias =>
                titleAliasMatches.get(alias)?.size === 1 &&
                fuzzyMessageContainsAlias(normalizedMessage, alias, 0.8)
              );
          if (titleName && (matchedAlias || fuzzyAlias)) {
            selectedTitleIds.add(titleId);
            (matchedAlias ? keywordMatches : fuzzyMatches).push({
              type: "title",
              id: titleId,
              matched: matchedAlias || fuzzyAlias
            });
            provenance.push(recordReason(
              "streaming_catalog.csv",
              titleId,
              matchedAlias === normalize(titleName)
                ? `The adult named ${titleName}.`
                : matchedAlias
                  ? `The adult’s title reference “${matchedAlias}” resolved uniquely to ${titleName}.`
                  : `A close spelling match resolved the adult’s title reference to ${titleName}.`
            ));
          }
        });
      }
      (state.members || []).forEach(member => {
        const exactMember =
          messageContainsName(normalizedMessage, member.firstName) ||
          messageContainsName(normalizedMessage, member.name);
        const fuzzyMember = !exactMember &&
          fuzzyMessageContainsAlias(normalizedMessage, member.firstName || member.name, 0.8);
        if (exactMember || fuzzyMember) {
          selectedMemberIds.add(member.id);
          (exactMember ? keywordMatches : fuzzyMatches).push({
            type: "member",
            id: member.id,
            matched: memberName(member)
          });
          provenance.push(recordReason(
            "household_members_profile.json",
            member.id,
            exactMember
              ? `The adult named ${memberName(member)}.`
              : `A close spelling match resolved the household member as ${memberName(member)}.`
          ));
        }
      });

      const childMembers = (state.members || []).filter(member => Number(member.age) < 18);
      const asksForChildren = /\b(?:my |the )?(?:children|child|kids?|minors?|underage members?)\b/.test(normalizedMessage);
      if (asksForChildren) {
        if (childMembers.length === 1) {
          selectedMemberIds.add(childMembers[0].id);
        } else if (childMembers.length > 1 && /\b(?:my child|my kid|the child|the kid)\b/.test(normalizedMessage)) {
          childMembers.forEach(member => selectedMemberIds.add(member.id));
          ambiguities.push({
            type: "viewer",
            message: "More than one child could match the adult’s wording.",
            options: childMembers.map(member => ({ id: member.id, label: memberName(member) }))
          });
        } else {
          childMembers.forEach(member => selectedMemberIds.add(member.id));
        }
      }
      const ageWords = {
        one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
        nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
        fifteen: 15, sixteen: 16, seventeen: 17
      };
      const ageReference = normalizedMessage.match(
        /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|\d{1,2}) year old\b/
      );
      if (ageReference) {
        const referencedAge = ageWords[ageReference[1]] ?? Number(ageReference[1]);
        (state.members || [])
          .filter(member => Number(member.age) === referencedAge)
          .forEach(member => selectedMemberIds.add(member.id));
      }
      if (
        rosterRequest &&
        /\b(?:wife|husband|spouse|partner|adults?)\b/.test(normalizedMessage)
      ) {
        (state.members || [])
          .filter(member => Number(member.age) >= 18)
          .forEach(member => selectedMemberIds.add(member.id));
      } else if (
        rosterRequest &&
        !asksForChildren &&
        /\b(?:members?|family|household|home|people)\b/.test(normalizedMessage)
      ) {
        (state.members || []).forEach(member => selectedMemberIds.add(member.id));
      }
      if (/\b(?:both adults|the adults|every adult|all adults)\b/.test(normalizedMessage)) {
        (state.members || [])
          .filter(member => Number(member.age) >= 18)
          .forEach(member => selectedMemberIds.add(member.id));
      }
      if (
        (
          !subscriptionInventory &&
          !rosterRequest &&
          hasStreamingDomainLanguage(normalizedMessage) &&
          /\b(?:family|household|everyone|we|us)\b/.test(normalizedMessage)
        ) ||
        scope === "household_wide"
      ) {
        (state.members || []).forEach(member => selectedMemberIds.add(member.id));
      }

      // A watchlist question scoped to a named member is a relationship query:
      // the member match identifies which watchlist rows—and therefore which
      // titles—must be supplied. Without this expansion the model sees the
      // person but receives an empty watchlist and can only give a false
      // absence answer.
      if (
        watchlistRequest &&
        !productMetaRequest &&
        !outOfScopeRequest &&
        !rosterRequest &&
        !executionRequest
      ) {
        const memberScopedWatchlist = selectedMemberIds.size
          ? watchlist.filter(entry => selectedMemberIds.has(entry.memberId))
          : watchlist;
        memberScopedWatchlist.forEach(entry => {
          selectedTitleIds.add(entry.titleId);
          selectedMemberIds.add(entry.memberId);
          provenance.push(recordReason(
            "watchlist.csv",
            entry.id || entry.titleId,
            `The adult requested ${memberName((state.members || []).find(member => member.id === entry.memberId) || { id: entry.memberId })}’s watchlist.`
          ));
        });
        semanticMatches.push({
          type: "relationship",
          id: selectedMemberIds.size ? "member_watchlist" : "household_watchlist",
          score: 1
        });
      }

      const titleSemanticRequest = hasAnyConcept(concepts, [
        "tv_series",
        "series",
        "limited_series",
        "documentary_series",
        "documentary",
        "movie",
        "science_fiction",
        "period_drama",
        "cooking",
        "music",
        "nature",
        "crime_drama",
        "mystery",
        "thriller",
        "comedy",
        "adventure_drama",
        "family_drama",
        "completed",
        "watching",
        "not_started",
        "unknown",
        "migration",
        "release",
        "content_rating"
      ]);
      if (
        titleSemanticRequest &&
        !productMetaRequest &&
        !outOfScopeRequest &&
        !rosterRequest &&
        !executionRequest &&
        !selectedTitleIds.size
      ) {
        const titleScores = [...catalogByTitleId.entries()].map(([titleId, records]) => {
          const record = records[0] || {};
          const relatedWatchlist = watchlist.filter(entry => entry.titleId === titleId);
          const relatedViewing = (state.viewing || []).filter(entry => entry.titleId === titleId);
          const recordConcepts = semanticConcepts([
            record.title_name,
            record.content_type,
            record.genre,
            record.content_rating,
            record.current_release_pattern,
            record.next_release_pattern,
            record.availability_type,
            record.territory
          ].join(" "));
          let score = 0;
          [
            "science_fiction",
            "limited_series",
            "tv_series",
            "documentary_series",
            "movie",
            "period_drama",
            "cooking",
            "music",
            "nature",
            "crime_drama",
            "mystery",
            "thriller",
            "comedy",
            "adventure_drama",
            "family_drama",
            "weekly_over_3_months",
            "all_at_once"
          ].forEach(concept => {
            if (concepts.has(concept) && recordConcepts.has(concept)) score += 5;
          });
          if (
            concepts.has("content_rating") ||
            ["pg", "13", "tv", "ma", "14", "g", "r"].some(value => concepts.has(value))
          ) {
            const ratingWords = words(record.content_rating);
            ratingWords.forEach(value => {
              if (concepts.has(value)) score += 3;
            });
          }
          if (
            selectedServiceIds.has(record.available_service_id) ||
            selectedServiceIds.has(record.migration_service_id)
          ) {
            score += 7;
          }
          selectedMemberIds.forEach(memberId => {
            if (relatedWatchlist.some(entry => entry.memberId === memberId)) score += 5;
            if (relatedViewing.some(entry => entry.memberId === memberId)) score += 3;
          });
          ["high", "medium", "low"].forEach(priority => {
            if (concepts.has(priority) && relatedWatchlist.some(entry => entry.priority === priority)) score += 4;
          });
          ["completed", "watching", "not_started", "unknown"].forEach(status => {
            if (
              concepts.has(status) &&
              (
                relatedViewing.some(entry => entry.status === status) ||
                relatedWatchlist.some(entry =>
                  status === "completed"
                    ? entry.status === "completed"
                    : status === "watching"
                      ? entry.status === "active"
                      : false
                )
              )
            ) {
              score += 6;
            }
          });
          if (concepts.has("migration") && record.migration_service_id) score += 6;
          if (concepts.has("release") && (record.release_date || record.next_air_start_date)) score += 2;
          if (concepts.has("canada") && record.territory === "CA") score += 6;
          if (/\b(?:child|children|kids)\b/.test(normalizedMessage)) {
            const childIds = new Set((state.members || [])
              .filter(member => Number(member.age) < 18)
              .map(member => member.id));
            if (relatedWatchlist.some(entry => childIds.has(entry.memberId))) score += 4;
          }
          return { titleId, titleName: record.title_name || titleId, score };
        });
        const bestScore = Math.max(0, ...titleScores.map(candidate => candidate.score));
        if (bestScore >= 7) {
          titleScores
            .filter(candidate => candidate.score >= bestScore - 1 && candidate.score >= 7)
            .sort((left, right) => right.score - left.score)
            .slice(0, 5)
            .forEach(candidate => {
              selectedTitleIds.add(candidate.titleId);
              semanticMatches.push({
                type: "title",
                id: candidate.titleId,
                score: candidate.score
              });
              provenance.push(recordReason(
                "hybrid_semantic_index",
                candidate.titleId,
                `Semantic metadata and household relationships matched ${candidate.titleName} with relevance score ${candidate.score}.`
              ));
            });
        }
      }

      if (
        !selectedServiceIds.size &&
        concepts.has("pause") &&
        !productMetaRequest &&
        !outOfScopeRequest &&
        !rosterRequest
      ) {
        const serviceScores = serviceNames.map(service => {
          const plans = servicesById.get(service.serviceId) || [];
          let score = 0;
          if (plans.some(plan => String(plan.pause_eligible).toLowerCase() === "true")) score += 5;
          if (concepts.has("60") && plans.some(plan => Number(plan.max_pause_days) === 60)) score += 7;
          if (concepts.has("30") && plans.some(plan => Number(plan.max_pause_days) === 30)) score += 7;
          if (
            /\b(?:billing|payment)\b/.test(normalizedMessage) &&
            plans.some(plan => /billing suspended/i.test(plan.pause_terms || ""))
          ) {
            score += 3;
          }
          if (
            /\b(?:profile|library)\b/.test(normalizedMessage) &&
            plans.some(plan => /profile|library/i.test(plan.pause_terms || ""))
          ) {
            score += 3;
          }
          return { ...service, score };
        });
        const bestScore = Math.max(0, ...serviceScores.map(candidate => candidate.score));
        if (bestScore >= 8) {
          serviceScores
            .filter(candidate => candidate.score === bestScore)
            .forEach(candidate => {
              selectedServiceIds.add(candidate.serviceId);
              semanticMatches.push({
                type: "service",
                id: candidate.serviceId,
                score: candidate.score
              });
              provenance.push(recordReason(
                "hybrid_semantic_index",
                candidate.serviceId,
                `Pause terms and plan capabilities matched ${candidate.serviceName} with relevance score ${candidate.score}.`
              ));
            });
        }
      }

      const usesConversationReference =
        !outOfScopeRequest &&
        /\b(?:that service|this service|that title|this title|the recommendation|what about (?:it|that)|keep it|cancel it|pause it)\b/
          .test(normalizedMessage);
      if (usesConversationReference && state.scenario) {
        if (state.scenario.targetServiceId) selectedServiceIds.add(state.scenario.targetServiceId);
        if (state.scenario.secondaryServiceId) selectedServiceIds.add(state.scenario.secondaryServiceId);
        if (!executionRequest) {
          if (state.scenario.titleId) selectedTitleIds.add(state.scenario.titleId);
          (state.scenario.intendedViewerIds || []).forEach(memberId => selectedMemberIds.add(memberId));
        }
        provenance.push(recordReason(
          "conversation_state",
          state.scenario.id,
          "A conversational reference was resolved against the active scenario or displayed recommendation."
        ));
      }
    }

    if (
      requestType === "conversation" &&
      scope === "focused" &&
      spendingReview &&
      hasStreamingDomainLanguage(normalizedMessage) &&
      !selectedServiceIds.size &&
      !selectedTitleIds.size
    ) {
      scope = "household_wide";
      semanticMatches.push({
        type: "scope",
        id: "household_wide_spending_comparison",
        score: 1
      });
      provenance.push(recordReason(
        "hybrid_scope_router",
        "active_subscription_portfolio",
        "The adult requested a financial comparison without naming one service, so the active subscription portfolio is required."
      ));
    }

    const pendingPreference = (state.review?.pendingContextUpdates || []).some(update =>
      update?.updateType === "preference_note" &&
      update?.requiresAdultConfirmation === true
    );

    if (
      requestType === "conversation" &&
      intent === "focused_conversation" &&
      !selectedServiceIds.size &&
      !selectedTitleIds.size &&
      !selectedMemberIds.size &&
      !hasStreamingDomainLanguage(normalizedMessage) &&
      !pendingPreference
    ) {
      intent = "out_of_scope";
      outOfScopeRequest = true;
      productMetaRequest = false;
      rosterRequest = false;
      executionRequest = false;
      semanticMatches.push({
        type: "intent",
        id: "out_of_scope",
        score: 1
      });
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
      } else if (spendingReview) {
        const activeServiceIds = new Set((state.subscriptions || [])
          .filter(subscription => subscription.status === "active")
          .map(subscription => subscription.serviceId));
        watchlist
          .filter(entry => (catalogByTitleId.get(entry.titleId) || []).some(record =>
            activeServiceIds.has(record.available_service_id)
          ))
          .forEach(entry => {
            selectedTitleIds.add(entry.titleId);
            selectedMemberIds.add(entry.memberId);
            provenance.push(recordReason(
              "watchlist.csv",
              entry.id || entry.titleId,
              "This household title is tied to an active service being compared for savings."
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

    if (!subscriptionInventory && !executionRequest && !rosterRequest) {
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
      if (productMetaRequest || outOfScopeRequest || executionRequest) {
        // These intents are complete without household entities. Product metadata,
        // scope boundaries, and execution authority come from application-owned
        // context and immutable instructions rather than household records.
      } else if (pendingPreference) {
        if (state.scenario?.targetServiceId) selectedServiceIds.add(state.scenario.targetServiceId);
        if (state.scenario?.secondaryServiceId) selectedServiceIds.add(state.scenario.secondaryServiceId);
        if (state.scenario?.titleId) selectedTitleIds.add(state.scenario.titleId);
        (state.scenario?.intendedViewerIds || []).forEach(memberId => selectedMemberIds.add(memberId));
        provenance.push(recordReason(
          "pending_preference",
          "current",
          "The adult is responding to a typed pending household-preference interaction."
        ));
      } else if (recommendation || state.review?.generatedRecommendation) {
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

    const financialRequest = !executionRequest && !productMetaRequest && !outOfScopeRequest && !rosterRequest && (
      requestType === "recommendation" ||
      spendingReview ||
      /\b(?:subscribe|cancel|pause|renew|plan|payment|budget|cost|price)\b/.test(normalizedMessage)
    );
    const includeHouseholdBase = !productMetaRequest && !outOfScopeRequest && !executionRequest;
    const includeFamilyRules = includeHouseholdBase && (
      requestType === "recommendation" ||
      scope === "household_wide" ||
      financialRequest ||
      selectedTitleIds.size > 0
    );
    const includeTitleContext = !executionRequest && selectedTitleIds.size > 0;
    const includeDecisionFacts = requestType === "recommendation" || Boolean(recommendation);
    const selectedSubscriptions = (state.subscriptions || []).filter(subscription =>
      selectedServiceIds.has(subscription.serviceId) ||
      (scope === "household_wide" && subscription.status === "active")
    );
    const selectedMembers = (state.members || []).filter(member =>
      (rosterRequest && selectedMemberIds.has(member.id)) ||
      (!rosterRequest && scope === "household_wide") ||
      selectedMemberIds.has(member.id) ||
      (!rosterRequest && includeHouseholdBase && member.id === state.household?.authorizedAdultMemberId)
    );
    const selectedViewing = includeTitleContext ? (state.viewing || []).filter(record =>
      selectedTitleIds.has(record.titleId) &&
      (!selectedMemberIds.size || selectedMemberIds.has(record.memberId))
    ) : [];
    const selectedWatchlist = includeTitleContext ? watchlist.filter(record =>
      selectedTitleIds.has(record.titleId) &&
      (!selectedMemberIds.size || selectedMemberIds.has(record.memberId))
    ) : [];
    const selectedHistory = includeTitleContext ? (state.householdViewingHistory || []).filter(record =>
      selectedTitleIds.has(record.titleId) &&
      (!selectedMemberIds.size || selectedMemberIds.has(record.memberId))
    ) : [];
    const selectedCatalog = catalog
      .filter(record => selectedTitleIds.has(record.title_id))
      .map(record => ({
        ...record,
        next_air_start_date: (() => {
          const runtimeDates = unique(selectedWatchlist
            .filter(entry => entry.titleId === record.title_id)
            .map(entry => entry.nextReleaseDate)
            .filter(Boolean));
          if (runtimeDates.length === 1) return runtimeDates[0];
          if (runtimeDates.length > 1) {
            ambiguities.push({
              type: "data_conflict",
              message: `Stored watchlist records disagree about the next release date for ${record.title_name}.`,
              options: runtimeDates.map(date => ({ id: date, label: date }))
            });
          }
          return record.next_air_start_date;
        })(),
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
      selectedServiceIds.size > 0 && change.serviceId && selectedServiceIds.has(change.serviceId)
    );

    const selectedRecordCounts = {
      household: includeHouseholdBase && state.household ? 1 : 0,
      familyRules: includeFamilyRules && state.familyRules ? 1 : 0,
      members: selectedMembers.length,
      subscriptions: selectedSubscriptions.length,
      viewing: selectedViewing.length,
      watchlist: selectedWatchlist.length,
      viewingHistory: selectedHistory.length,
      catalog: selectedCatalog.length,
      servicePlans: selectedPlans.length,
      subscriptionChanges: selectedChanges.length,
      decisionFacts: includeDecisionFacts && decisionPacket ? 1 : 0
    };
    const requiredRecordTypes = unique([
      ...(includeHouseholdBase ? ["household"] : []),
      ...(includeFamilyRules ? ["familyRules"] : []),
      ...(includeHouseholdBase && !rosterRequest ? ["authorizedAdult"] : []),
      ...(rosterRequest ? ["members"] : []),
      ...(scope === "subscription_inventory" ? ["subscriptions"] : []),
      ...(financialRequest ? ["subscriptions", "servicePlans", "budget"] : []),
      ...(includeTitleContext ? ["catalog", "watchlist", "viewing"] : []),
      ...(requestType === "recommendation" ? ["triggerContext", "decisionFacts"] : [])
    ]);
    const missingRequirements = [];
    if (requiredRecordTypes.includes("household") && !state.household) missingRequirements.push("household");
    if (requiredRecordTypes.includes("familyRules") && !state.familyRules) missingRequirements.push("familyRules");
    if (
      requiredRecordTypes.includes("authorizedAdult") &&
      !selectedMembers.some(member => member.id === state.household?.authorizedAdultMemberId)
    ) {
      missingRequirements.push("authorizedAdult");
    }
    if (requiredRecordTypes.includes("members") && !selectedMembers.length) {
      missingRequirements.push("members");
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
      intent,
      scope,
      searchStrategy: "hybrid_keyword_semantic",
      retrievalSignals: {
        keywordMatches,
        fuzzyMatches,
        semanticMatches
      },
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
        searchStrategy: "hybrid_keyword_semantic",
        retrievalSignals: {
          keywordMatches,
          fuzzyMatches,
          semanticMatches
        },
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
      context_intent: intent,
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
        : (productMetaRequest || outOfScopeRequest || rosterRequest || executionRequest)
          ? {
              triggerType: state.review?.manualScenario ? "manual_chat" : "active_chat",
              scenarioType: null
            }
        : {
            triggerType: state.scenario?.triggerType || "manual_chat",
            scenarioType: state.scenario?.scenarioType || null
          },
      context_freshness: includeHouseholdBase ? state.contextFreshness : null,
      household: includeHouseholdBase ? state.household : null,
      family_members: selectedMembers,
      current_family_rules: includeFamilyRules ? state.familyRules : null,
      current_subscriptions: selectedSubscriptions,
      recent_subscription_changes: selectedChanges,
      viewing_information: selectedViewing,
      household_watchlist: selectedWatchlist,
      recent_completed_viewing: selectedHistory,
      portfolio_summary: financialRequest || subscriptionInventory || scope === "household_wide"
        ? {
            activeSubscriptionCount: activeSubscriptions.length,
            activeMonthlySpend,
            annualizedSpend: activeMonthlySpend * 12,
            monthlyBudgetCap,
            budgetRemaining: monthlyBudgetCap - activeMonthlySpend
          }
        : null,
      product_context: productMetaRequest
        ? {
            implementationStatus: "Course prototype",
            productionOutcomeEvidenceAvailable: false,
            supportedClaim: "The prototype can demonstrate its designed workflow and evaluation results, but it has no real-world household outcome evidence."
          }
        : null,
      candidate_services: candidateServices,
      decision_facts_and_calculations: includeDecisionFacts
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

    const sourceTrace = [];
    if (includeHouseholdBase) sourceTrace.push({
        name: "household_profile.json",
        detail: `${state.household?.territory || state.household?.billingRegion || "Household"} · authorized adult ${memberName(
          (state.members || []).find(member => member.id === state.household?.authorizedAdultMemberId) || {}
        )}`
      });
    if (includeFamilyRules) sourceTrace.push({
        name: "family_rules.json",
        detail: `$${monthlyBudgetCap.toFixed(2)} monthly budget plus household and member content rules`
      });
    if (selectedMembers.length) sourceTrace.push({
        name: "household_members_profile.json",
        detail: joinedLabels(selectedMembers.map(member =>
          `${memberName(member)}${Number(member.age) < 18 ? ` (age ${member.age})` : ""}`
        ))
      });
    if (selectedSubscriptions.length) sourceTrace.push({
        name: "household_subscriptions.csv",
        detail: joinedLabels(selectedSubscriptions.map(subscription =>
          `${subscription.service} — ${subscription.plan} (${subscription.status})`
        ))
      });
    if (productMetaRequest) sourceTrace.push({
      name: "prototype status",
      detail: "Course prototype capabilities and evidence boundary"
    });
    const shouldUseRecentConversation = Boolean(
      recommendation ||
      state.review?.generatedRecommendation ||
      provenance.some(reason => ["conversation_state", "displayed_recommendation"].includes(reason.source))
    );
    const recentMessageCount = shouldUseRecentConversation
      ? Math.min(6, (state.messages || []).filter(message => message.text && !message.redacted).length)
      : 0;
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
      {
        name: "select_context",
        detail: `${scope.replaceAll("_", " ")} context selected with hybrid keyword, fuzzy, semantic, and relationship matching`
      },
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
      intent,
      contextPlan,
      householdContext,
      servicePlans: selectedPlans,
      catalogTitles: selectedCatalog,
      recentConversationLimit: recentMessageCount,
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
    isLikelyStreamingRequest,
    select
  });
})(window);
