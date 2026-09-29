(function attachBidBotBudget(root) {
  const DEFAULT_RULES = [
    { id: "f1", type: "fixed", min: 30, max: 250, bid: 120, days: 1 },
    { id: "f2", type: "fixed", min: 250, max: 750, bid: 350, days: 3 },
    { id: "f3", type: "fixed", min: 750, max: 1500, bid: 850, days: 5 },
    { id: "f4", type: "fixed", min: 1500, max: 3000, bid: 1800, days: 7 },
    { id: "f5", type: "fixed", min: 3000, max: 5000, bid: 3000, days: 10 },
    { id: "h1", type: "hourly", min: 15, max: 25, bid: 20, days: "" },
    { id: "h2", type: "hourly", min: 25, max: 50, bid: 40, days: "" }
  ];

  function asNumber(value) {
    const n = Number(String(value ?? "").replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : NaN;
  }

  function newRuleId() {
    return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  function normalizeRule(rule, index) {
    if (!rule || typeof rule !== "object") return null;
    const type = rule.type === "hourly" ? "hourly" : "fixed";
    const min = asNumber(rule.min);
    const max = asNumber(rule.max);
    const bid = asNumber(rule.bid);
    if (!(min > 0) || !(max > 0) || !(bid > 0) || max < min) return null;
    const daysRaw = asNumber(rule.days);
    return {
      id: String(rule.id || newRuleId()),
      type,
      min,
      max,
      bid,
      days: type === "fixed" && daysRaw > 0 ? daysRaw : "",
      order: index
    };
  }

  function coerceRules(rules) {
    if (!Array.isArray(rules)) return DEFAULT_RULES.map((rule) => ({ ...rule }));
    return rules.map((rule) => ({
      id: String(rule?.id || newRuleId()),
      type: rule?.type === "hourly" ? "hourly" : "fixed",
      min: rule?.min ?? "",
      max: rule?.max ?? "",
      bid: rule?.bid ?? "",
      days: rule?.type === "hourly" ? "" : rule?.days ?? ""
    }));
  }

  function normalizeRules(rules) {
    const list = Array.isArray(rules) ? rules : coerceRules(rules);
    return list.map(normalizeRule).filter(Boolean);
  }

  function parseBudgetText(text) {
    const raw = String(text || "");
    if (!raw || /not found/i.test(raw)) return null;
    const hourly = /hour|hourly|\/\s*hr|\bhr\b/i.test(raw);
    const nums = [...raw.replace(/,/g, "").matchAll(/(\d+(?:\.\d+)?)/g)]
      .map((match) => Number(match[1]))
      .filter((n) => n > 0 && n < 1000000);
    if (!nums.length) return null;
    if (nums.length === 1) return { min: nums[0], max: nums[0], hourly };
    return { min: Math.min(nums[0], nums[1]), max: Math.max(nums[0], nums[1]), hourly };
  }

  function parseProjectBudget(project) {
    if (!project) return null;
    const hourly =
      project.type === "hourly" || /hour|hourly|\/\s*hr/i.test(String(project.budget || ""));
    const min = asNumber(project.budgetMin);
    const max = asNumber(project.budgetMax);
    if (min > 0) {
      return { min, max: max > 0 ? max : min, hourly };
    }
    return parseBudgetText(project.budget);
  }

  function scoreRule(rule, parsed) {
    const pMin = parsed.min;
    const pMax = Number.isFinite(parsed.max) ? parsed.max : parsed.min;
    const mid = (pMin + pMax) / 2;
    if (Math.abs(rule.min - pMin) <= 1 && Math.abs(rule.max - pMax) <= 1) return 1000;
    if (mid >= rule.min && mid <= rule.max) {
      const span = Math.max(rule.max - rule.min, 1);
      return 200 + 100 / span;
    }
    if (pMax >= rule.min && pMin <= rule.max) return 20;
    return 0;
  }

  function formatAmount(value) {
    const n = asNumber(value);
    if (!(n > 0)) return "";
    return Number.isInteger(n) ? String(n) : String(n);
  }

  function ruleLabel(rule) {
    const range = `$${rule.min}–$${rule.max}`;
    if (rule.type === "hourly") return `${range}/hr → $${rule.bid}/hr`;
    const dayBit = rule.days ? `, ${rule.days} day${Number(rule.days) === 1 ? "" : "s"}` : "";
    return `${range} → $${rule.bid}${dayBit}`;
  }

  function resolveBidTerms(rules, project) {
    const parsed = parseProjectBudget(project);
    if (!parsed) {
      return {
        bidAmount: "",
        bidDeadlineDays: "",
        matched: false,
        hourly: false,
        summary: "",
        note: "project budget not found"
      };
    }
    const type = parsed.hourly ? "hourly" : "fixed";
    const candidates = normalizeRules(rules).filter((rule) => rule.type === type);
    let best = null;
    let bestScore = 0;
    for (const rule of candidates) {
      const score = scoreRule(rule, parsed);
      if (score > bestScore) {
        best = rule;
        bestScore = score;
      }
    }
    if (!best) {
      return {
        bidAmount: "",
        bidDeadlineDays: "",
        matched: false,
        hourly: parsed.hourly,
        summary: "",
        note: `no ${type} rule for $${parsed.min}–$${parsed.max}${parsed.hourly ? "/hr" : ""}`
      };
    }
    return {
      bidAmount: formatAmount(best.bid),
      bidDeadlineDays: type === "hourly" ? "" : formatAmount(best.days),
      matched: true,
      hourly: parsed.hourly,
      summary: ruleLabel(best),
      note: `matched ${ruleLabel(best)}`
    };
  }

  root.BidBotBudget = {
    DEFAULT_RULES,
    newRuleId,
    coerceRules,
    normalizeRules,
    parseProjectBudget,
    resolveBidTerms,
    ruleLabel
  };
})(typeof self !== "undefined" ? self : globalThis);
