  const finiteNonNegative = (value) => {
    if (value == null || value === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
  };

  const firstObject = (...values) => values.find((value) => (
    value && typeof value === "object" && !Array.isArray(value)
  )) ?? null;

  const firstTokenNumber = (object, ...keys) => {
    if (!object || typeof object !== "object") return null;
    for (const key of keys) {
      const numeric = finiteNonNegative(object[key]);
      if (numeric != null) return numeric;
    }
    return null;
  };

  const conversationForThread = (threadId) => {
    if (!threadId) return null;
    try {
      const direct = state.manager?.getConversation?.(threadId);
      if (direct) return direct;
    } catch {}
    try { return state.manager?.conversations?.get?.(threadId) ?? null; } catch { return null; }
  };

  const normalizedTokenBucket = (bucket) => ({
    inputTokens: firstTokenNumber(bucket, "inputTokens", "input_tokens"),
    cachedInputTokens: firstTokenNumber(
      bucket,
      "cachedInputTokens",
      "cached_input_tokens",
    ),
    outputTokens: firstTokenNumber(bucket, "outputTokens", "output_tokens"),
    reasoningOutputTokens: firstTokenNumber(
      bucket,
      "reasoningOutputTokens",
      "reasoning_output_tokens",
    ),
    totalTokens: firstTokenNumber(bucket, "totalTokens", "total_tokens"),
  });

  const cacheMetrics = (bucket) => {
    const normalized = normalizedTokenBucket(bucket);
    const inputTokens = normalized.inputTokens;
    const cachedInputTokens = normalized.cachedInputTokens;
    const exact = inputTokens != null && cachedInputTokens != null;
    if (!exact) {
      return {
        inputTokens,
        cachedInputTokens,
        uncachedInputTokens: null,
        percent: null,
      };
    }
    return {
      inputTokens,
      cachedInputTokens,
      uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens),
      percent: inputTokens > 0 ? (cachedInputTokens / inputTokens) * 100 : 0,
    };
  };

  const SOURCE_CATEGORIES = Object.freeze([
    {
      id: "tool_calls",
      label: "Tool calls & outputs",
      aliases: ["tool_calls", "toolCalls", "tool_calls_and_outputs", "toolCallsAndOutputs"],
    },
    {
      id: "developer",
      label: "Developer context",
      aliases: ["developer", "developer_context", "developerContext", "developer_prompt", "developerPrompt"],
    },
    { id: "messages", label: "Messages", aliases: ["messages", "message_tokens", "messageTokens"] },
    {
      id: "tools",
      label: "Tool definitions",
      aliases: ["tools", "tool_definitions", "toolDefinitions", "tool_definition_tokens", "toolDefinitionTokens"],
    },
    { id: "reasoning", label: "Reasoning", aliases: ["reasoning", "reasoning_tokens", "reasoningTokens"] },
    {
      id: "system_prompt",
      label: "System prompt",
      aliases: ["system_prompt", "systemPrompt", "system", "system_context", "systemContext"],
    },
  ]);

  const ROLE_CATEGORIES = Object.freeze([
    { id: "system", label: "System" },
    { id: "developer", label: "Developer" },
    { id: "user", label: "User" },
    { id: "assistant", label: "Assistant" },
    { id: "tool", label: "Tool" },
    { id: "reasoning", label: "Reasoning" },
    { id: "tool_definitions", label: "Tool definitions" },
  ]);

  const sourceTokenValue = (container, aliases) => {
    for (const alias of aliases) {
      const value = container?.[alias];
      const direct = finiteNonNegative(value);
      if (direct != null) return direct;
      const nested = firstTokenNumber(value, "tokens", "tokenCount", "token_count", "value");
      if (nested != null) return nested;
    }
    return null;
  };

  const exactContextSources = (conversation, usage) => {
    const container = firstObject(
      usage?.contextSources,
      usage?.context_sources,
      usage?.contextBreakdown,
      usage?.context_breakdown,
      conversation?.contextSources,
      conversation?.context_sources,
      conversation?.contextBreakdown,
      conversation?.context_breakdown,
    );
    if (!container) return null;
    const categoryContainer = firstObject(container.categories, container.sources) ?? container;
    const values = SOURCE_CATEGORIES.map((category) => ({
      ...category,
      tokens: sourceTokenValue(categoryContainer, category.aliases),
    })).filter((category) => category.tokens != null);
    if (values.length !== SOURCE_CATEGORIES.length) return null;
    const denominator = values.reduce((sum, category) => sum + category.tokens, 0);
    return {
      mode: "exact",
      categories: values.map(({ aliases: _aliases, ...category }) => ({
        ...category,
        percent: denominator > 0 ? (category.tokens / denominator) * 100 : 0,
      })),
    };
  };

  const textForEstimate = (value) => {
    if (typeof value === "string") return value;
    if (value == null) return "";
    try { return JSON.stringify(value); } catch { return String(value); }
  };

  const estimateTokens = (value) => {
    const text = textForEstimate(value);
    if (!text) return 0;
    let tokenWeight = 0;
    for (const character of text) {
      const code = character.codePointAt(0) ?? 0;
      tokenWeight += code > 0x2ff ? 1 : /\s/.test(character) ? 0.12 : 0.25;
    }
    return Math.max(1, Math.round(tokenWeight));
  };

  const itemType = (item) => String(
    item?.type ?? item?.item?.type ?? item?.kind ?? item?.item?.kind ?? "",
  ).toLowerCase().replace(/[^a-z0-9]/g, "");

  const itemRole = (item) => String(
    item?.role ?? item?.item?.role ?? item?.message?.role ?? "",
  ).toLowerCase();

  const turnItems = (turn) => {
    if (Array.isArray(turn)) return turn;
    for (const candidate of [turn?.items, turn?.output, turn?.input, turn?.messages]) {
      if (Array.isArray(candidate)) return candidate;
    }
    return [];
  };

  const conversationTurns = (conversation) => {
    const entities = conversation?.turnHistory?.history?.entitiesByKey;
    let canonical = [];
    if (entities instanceof Map) canonical = [...entities.values()];
    else if (entities && typeof entities === "object" && !Array.isArray(entities)) {
      canonical = Object.values(entities);
    }
    if (canonical.length) return canonical;
    return Array.isArray(conversation?.turns) ? conversation.turns : [];
  };

  const usageAnalysisCache = new WeakMap();

  const analyzeConversation = (conversation) => {
    if (!conversation || typeof conversation !== "object") return null;
    const cached = usageAnalysisCache.get(conversation);
    if (cached) return cached;
    const tokens = Object.fromEntries(SOURCE_CATEGORIES.map(({ id }) => [id, 0]));
    const roles = Object.fromEntries(ROLE_CATEGORIES.map(({ id }) => [id, 0]));
    const add = (id, value) => { tokens[id] += estimateTokens(value); };
    const addRole = (id, value) => { roles[id] += estimateTokens(value); };
    const tools = conversation?.tools ?? conversation?.toolDefinitions ?? conversation?.tool_definitions;
    const system = conversation?.systemPrompt ?? conversation?.system_prompt
      ?? conversation?.instructions?.system;
    const developer = conversation?.developerPrompt ?? conversation?.developer_prompt
      ?? conversation?.instructions?.developer;
    add("tools", tools); addRole("tool_definitions", tools);
    add("system_prompt", system); addRole("system", system);
    add("developer", developer); addRole("developer", developer);
    const turns = conversationTurns(conversation);
    let compactionCount = 0;
    let latestCompactionTurn = null;
    turns.forEach((turn, turnIndex) => {
      for (const wrapped of turnItems(turn)) {
        const item = wrapped?.item && typeof wrapped.item === "object" ? wrapped.item : wrapped;
        if (!item) continue;
        const type = itemType(item);
        if (type === "contextcompaction" || type === "compacted") {
          compactionCount += 1;
          latestCompactionTurn = turnIndex;
          continue;
        }
        const role = itemRole(item);
        if (role === "system") { add("system_prompt", item); addRole("system", item); }
        else if (role === "developer" || type.includes("developer")) {
          add("developer", item); addRole("developer", item);
        } else if (type.includes("reasoning")) { add("reasoning", item); addRole("reasoning", item); }
        else if (role === "tool"
          || /(?:function|tool|shell|command|mcp)(?:call|output|result)|(?:call|output|result)(?:function|tool)/.test(type)) {
          add("tool_calls", item); addRole("tool", item);
        } else if (role === "user" || role === "assistant" || type.includes("message")) {
          add("messages", item);
          if (role === "user" || type.includes("usermessage")) addRole("user", item);
          else addRole("assistant", item);
        }
      }
    });
    const analysis = {
      rawSources: tokens,
      rawRoles: roles,
      compaction: {
        count: compactionCount,
        turnsAgo: latestCompactionTurn == null
          ? null : Math.max(0, turns.length - latestCompactionTurn - 1),
      },
    };
    usageAnalysisCache.set(conversation, analysis);
    return analysis;
  };

  const invalidateUsageAnalysis = (threadId) => {
    const conversation = conversationForThread(threadId);
    if (conversation && typeof conversation === "object") usageAnalysisCache.delete(conversation);
  };

  const estimatedContextSources = (conversation, targetTokens) => {
    if (!conversation || targetTokens == null) return null;
    const raw = analyzeConversation(conversation)?.rawSources;
    if (!raw) return null;
    let entries = SOURCE_CATEGORIES.map(({ aliases: _aliases, ...category }) => ({
      ...category,
      tokens: raw[category.id],
    })).filter((category) => category.tokens > 0);
    const rawTotal = entries.reduce((sum, category) => sum + category.tokens, 0);
    if (rawTotal > targetTokens && rawTotal > 0) {
      let allocated = 0;
      entries = entries.map((category, index) => {
        const tokens = index === entries.length - 1
          ? Math.max(0, targetTokens - allocated)
          : Math.floor((category.tokens / rawTotal) * targetTokens);
        allocated += tokens;
        return { ...category, tokens };
      });
    } else if (rawTotal < targetTokens) {
      entries.push({
        id: "unclassified",
        label: "Unclassified runtime context",
        tokens: targetTokens - rawTotal,
      });
    }
    const denominator = entries.reduce((sum, category) => sum + category.tokens, 0);
    return {
      mode: "estimated",
      categories: entries
        .map((category) => ({
          ...category,
          percent: denominator > 0 ? (category.tokens / denominator) * 100 : 0,
        }))
        .sort((left, right) => right.tokens - left.tokens),
    };
  };

  const estimatedRoleBreakdown = (conversation, targetTokens, exactSources) => {
    if (!conversation || targetTokens == null) return null;
    const raw = analyzeConversation(conversation)?.rawRoles;
    if (!raw) return null;
    const exact = new Map((exactSources?.categories ?? []).map(({ id, tokens }) => [id, tokens]));
    const values = Object.fromEntries(ROLE_CATEGORIES.map(({ id }) => [id, raw[id] ?? 0]));
    if (exactSources?.mode === "exact") {
      values.system = exact.get("system_prompt") ?? values.system;
      values.developer = exact.get("developer") ?? values.developer;
      values.tool = exact.get("tool_calls") ?? values.tool;
      values.reasoning = exact.get("reasoning") ?? values.reasoning;
      values.tool_definitions = exact.get("tools") ?? values.tool_definitions;
      const messageTokens = exact.get("messages") ?? 0;
      const messageWeight = values.user + values.assistant;
      if (messageWeight > 0) {
        values.user = Math.floor((values.user / messageWeight) * messageTokens);
        values.assistant = messageTokens - values.user;
      } else {
        values.user = 0;
        values.assistant = 0;
      }
    }
    let assigned = Object.values(values).reduce((sum, tokens) => sum + tokens, 0);
    if (assigned > targetTokens && assigned > 0) {
      let allocated = 0;
      ROLE_CATEGORIES.forEach(({ id }, index) => {
        values[id] = index === ROLE_CATEGORIES.length - 1
          ? Math.max(0, targetTokens - allocated)
          : Math.floor((values[id] / assigned) * targetTokens);
        allocated += values[id];
      });
      assigned = targetTokens;
    }
    const categories = ROLE_CATEGORIES.map((category) => ({
      ...category,
      tokens: values[category.id],
      percent: targetTokens > 0 ? (values[category.id] / targetTokens) * 100 : 0,
    }));
    categories.push({
      id: "unclassified",
      label: "Unclassified",
      tokens: Math.max(0, targetTokens - assigned),
      percent: targetTokens > 0 ? (Math.max(0, targetTokens - assigned) / targetTokens) * 100 : 0,
    });
    return { mode: "estimated", categories };
  };

  const compactionMetrics = (conversation) => {
    return analyzeConversation(conversation)?.compaction ?? { count: 0, turnsAgo: null };
  };

  const usageMetricsForThread = (threadId, { includeBreakdown = true } = {}) => {
    const conversation = conversationForThread(threadId);
    const usage = firstObject(
      conversation?.latestTokenUsageInfo,
      conversation?.latest_token_usage_info,
      conversation?.tokenUsage,
      conversation?.token_usage,
    );
    const last = firstObject(
      usage?.last,
      usage?.lastTokenUsage,
      usage?.last_token_usage,
    );
    const total = firstObject(
      usage?.total,
      usage?.totalTokenUsage,
      usage?.total_token_usage,
    );
    const lastTokens = normalizedTokenBucket(last);
    const contextWindow = firstTokenNumber(
      usage,
      "modelContextWindow",
      "model_context_window",
      "contextWindow",
      "context_window",
    );
    const usedTokens = lastTokens.totalTokens;
    const currentExact = contextWindow != null && contextWindow > 0 && usedTokens != null;
    const lastCache = cacheMetrics(last);
    const conversationCache = cacheMetrics(total);
    const exactSources = includeBreakdown ? exactContextSources(conversation, usage) : null;
    return {
      current: {
        usedTokens,
        contextWindow,
        remainingTokens: contextWindow != null && usedTokens != null
          ? Math.max(0, contextWindow - usedTokens) : null,
        percent: currentExact ? (usedTokens / contextWindow) * 100 : null,
      },
      cache: {
        last: lastCache,
        conversation: conversationCache,
      },
      exact: {
        context: currentExact,
        cache: lastCache.inputTokens != null && lastCache.cachedInputTokens != null
          && conversationCache.inputTokens != null
          && conversationCache.cachedInputTokens != null,
      },
      sources: includeBreakdown
        ? exactSources ?? estimatedContextSources(conversation, usedTokens)
        : null,
      roles: includeBreakdown
        ? estimatedRoleBreakdown(conversation, usedTokens, exactSources)
        : null,
      compaction: includeBreakdown
        ? compactionMetrics(conversation)
        : { count: 0, turnsAgo: null },
    };
  };
