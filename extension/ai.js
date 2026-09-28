// AI provider access for the extension. Same behaviour as server/ai.js, but runs in the browser.
// Loaded as a plain script in the side panel and via importScripts() in the background worker.
(function attachBidBotAI(root) {
  const DEFAULT_PROMPT = `You are an experienced freelancer writing a bid for the Freelancer.com project below.
Write only the proposal text: plain text, no markdown, 120-220 words.
Show you understood the project, give 3 short reasons you are a good fit, outline a 2-3 step plan, and end with a clear call to action.

Title: {title}
Budget: {budget}
Skills: {skills}
Description:
{description}`;

  const DEFAULT_MODELS = {
    openai: "gpt-5-mini",
    cursor: "gpt-5-mini",
    claude: "claude-sonnet-5",
    gemini: "gemini-3.8-flash"
  };

  const DEFAULT_URLS = {
    openai: "https://api.openai.com/v1/chat/completions",
    cursor: "https://api.openai.com/v1/chat/completions",
    claude: "https://api.anthropic.com/v1/messages",
    gemini: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
  };

  const GENERATE_TIMEOUT_MS = 60000;
  const TEST_TIMEOUT_MS = 20000;
  const PLACEHOLDERS = ["title", "description", "budget", "skills", "url"];

  const STATUS_HINTS = {
    400: "request rejected; check the model name and base URL",
    401: "API key rejected",
    403: "API key has no access to this model or endpoint",
    404: "model or endpoint not found",
    429: "rate limit hit or quota/credits used up"
  };

  const NON_CHAT_MODEL =
    /embed|tts|whisper|dall-e|davinci|babbage|moderation|image|imagen|veo|audio|realtime|transcribe|search|sora|computer-use|codex|instruct|robotics|aqa|live/i;

  const SYSTEM_PROMPT =
    "You write proposals (bids) that a freelancer pastes into the Freelancer.com bid box. " +
    "Reply with the final proposal text only, exactly as it should appear in the bid box. " +
    "No introduction, no explanation, no headings, no markdown, no code blocks, no quotes around the text, no closing remarks.";

  const PROJECT_BLOCK = `Title: {title}
Budget: {budget}
Skills: {skills}
Description:
{description}`;

  function renderPrompt(template, project) {
    const values = {
      title: project.title,
      description: project.description,
      budget: project.budget,
      skills: project.skills,
      url: project.pageUrl
    };
    const pattern = new RegExp(`\\{(${PLACEHOLDERS.join("|")})\\}`, "g");
    let text = template || DEFAULT_PROMPT;
    if (!pattern.test(text)) {
      // The prompt has no placeholders, so the AI would never see the project. Append it.
      text = `${text.trim()}\n\nProject to bid on:\n${PROJECT_BLOCK}`;
    }
    return text.replace(pattern, (_match, key) => values[key] || "");
  }

  const PREAMBLE = /^(here('s| is| are)\b|sure\b|certainly\b|of course\b|okay\b|below is\b|this (bid|proposal)\b|i('ve| have) (written|drafted)\b|absolutely\b)/i;

  // Remove markdown and chatty framing so only the proposal text gets typed into the bid box.
  function cleanBid(raw) {
    let text = String(raw || "").replace(/\r\n/g, "\n").trim();
    text = text.replace(/^```[a-z]*\s*$/gim, "").replace(/```/g, "");
    let lines = text.split("\n").map((line) => line.replace(/\s+$/, ""));

    lines = lines.filter((line) => !/^\s*([-*_]\s*){3,}$/.test(line)); // --- or *** rules
    lines = lines.filter((line) => !(/^\s{0,3}#{1,6}\s+/.test(line) && line.length < 80)); // headings
    lines = lines.map((line) => line.replace(/^\s*>\s?/, "")); // quotes

    // Drop an opening remark such as "Here is your bid:" (first paragraph only, if short).
    const firstBlank = lines.findIndex((line) => !line.trim());
    const firstParagraph = lines.slice(0, firstBlank === -1 ? lines.length : firstBlank).join(" ");
    if (firstBlank !== -1 && firstParagraph.length < 200 && PREAMBLE.test(firstParagraph.trim())) {
      lines = lines.slice(firstBlank + 1);
    }
    // Drop a lone label line like "Proposal:" or "Bid:" at the start.
    while (lines.length && /^\s*(proposal|bid|cover letter)\s*:?\s*$/i.test(lines[0])) {
      lines.shift();
    }

    text = lines.join("\n");
    text = text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1"); // bold
    text = text.replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?]|$)/g, "$1$2"); // italics
    text = text.replace(/`([^`\n]+)`/g, "$1"); // inline code
    text = text.replace(/\n{3,}/g, "\n\n").trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("“") && text.endsWith("”"))) {
      text = text.slice(1, -1).trim();
    }
    return text;
  }

  class ProviderError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  async function request(url, options, label, timeoutMs) {
    let response;
    try {
      response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        throw new ProviderError(`${label} did not answer within ${Math.round(timeoutMs / 1000)} s`);
      }
      throw new ProviderError(`${label} could not be reached: ${error.message}`);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const invalidKey = response.status === 400 && /API_KEY_INVALID|API key not valid/i.test(body);
      const status = invalidKey ? 401 : response.status;
      const hint = STATUS_HINTS[status];
      throw new ProviderError(`${label} returned ${response.status}${hint ? ` (${hint})` : ""}: ${body.slice(0, 200)}`, status);
    }
    return response.json();
  }

  function endpointFor(settings, model) {
    return (settings.baseUrl || DEFAULT_URLS[settings.provider]).replace("{model}", encodeURIComponent(model));
  }

  function authHeaders(settings) {
    if (settings.provider === "claude") {
      return {
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      };
    }
    if (settings.provider === "gemini") {
      return { "x-goog-api-key": settings.apiKey };
    }
    return { Authorization: `Bearer ${settings.apiKey}` };
  }

  async function callOpenAICompatible(prompt, settings, model, timeoutMs, system) {
    const payload = await request(
      endpointFor(settings, model),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(settings) },
        body: JSON.stringify({
          model,
          messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }]
        })
      },
      "OpenAI-compatible API",
      timeoutMs
    );
    return payload?.choices?.[0]?.message?.content?.trim();
  }

  async function callClaude(prompt, settings, model, timeoutMs, system) {
    const payload = await request(
      endpointFor(settings, model),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(settings) },
        body: JSON.stringify({
          model,
          max_tokens: 2000,
          ...(system ? { system } : {}),
          messages: [{ role: "user", content: prompt }]
        })
      },
      "Claude API",
      timeoutMs
    );
    return payload?.content?.find((item) => item.type === "text")?.text?.trim();
  }

  async function callGemini(prompt, settings, model, timeoutMs, system) {
    const payload = await request(
      endpointFor(settings, model),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(settings) },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: [{ parts: [{ text: prompt }] }]
        })
      },
      "Gemini API",
      timeoutMs
    );
    const parts = payload?.candidates?.[0]?.content?.parts || [];
    return parts
      .filter((part) => part.text && !part.thought)
      .map((part) => part.text)
      .join("")
      .trim();
  }

  const PROVIDERS = {
    openai: callOpenAICompatible,
    cursor: callOpenAICompatible,
    claude: callClaude,
    gemini: callGemini
  };

  function resolve(settings) {
    if (!PROVIDERS[settings.provider]) {
      throw new Error("No AI provider selected");
    }
    if (!settings.apiKey) {
      throw new Error("No AI API key saved");
    }
    return settings.model || DEFAULT_MODELS[settings.provider];
  }

  async function complete(prompt, settings, timeoutMs = GENERATE_TIMEOUT_MS, system = null) {
    const model = resolve(settings);
    return { text: await PROVIDERS[settings.provider](prompt, settings, model, timeoutMs, system), model };
  }

  async function generateBid(project, settings) {
    const { text } = await complete(renderPrompt(settings.prompt, project), settings, GENERATE_TIMEOUT_MS, SYSTEM_PROMPT);
    const bid = cleanBid(text);
    if (!bid) {
      throw new Error("AI provider returned an empty bid");
    }
    return bid;
  }

  function modelsUrlFor(settings) {
    if (settings.provider === "gemini") {
      return settings.baseUrl ? null : "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000";
    }
    const base = settings.baseUrl || DEFAULT_URLS[settings.provider];
    const suffix = settings.provider === "claude" ? /\/messages\/?$/ : /\/chat\/completions\/?$/;
    if (!suffix.test(base)) {
      return null;
    }
    return base.replace(suffix, "/models") + (settings.provider === "claude" ? "?limit=1000" : "");
  }

  function toCatalogEntry(item, provider) {
    const id = String(item.id || item.name || "").replace(/^models\//, "");
    const label = item.display_name || item.displayName || "";
    const created = item.created ? item.created * 1000 : item.created_at ? Date.parse(item.created_at) : 0;
    const methods = item.supportedGenerationMethods;
    const chat =
      !NON_CHAT_MODEL.test(id) && (provider !== "gemini" || !methods || methods.includes("generateContent"));
    return { id, label: label && label !== id ? label : "", created, chat };
  }

  async function fetchModelCatalog(settings) {
    const url = modelsUrlFor(settings);
    if (!url) {
      return null;
    }
    try {
      const payload = await request(url, { headers: authHeaders(settings) }, "Model list", TEST_TIMEOUT_MS);
      const items = payload?.data || payload?.models || [];
      return items.map((item) => toCatalogEntry(item, settings.provider)).filter((entry) => entry.id);
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        throw new Error(`API key rejected by ${settings.provider}. Check that the key is correct and active.`);
      }
      error.listFailed = true;
      throw error;
    }
  }

  async function listModels(settings) {
    resolve(settings);
    const catalog = await fetchModelCatalog(settings);
    if (!catalog) {
      throw new Error('This Base URL has no model list. Pick "Custom model" and type the model name.');
    }
    return catalog
      .filter((entry) => entry.chat)
      .map((entry, index) => ({ ...entry, index }))
      .sort((a, b) => b.created - a.created || a.index - b.index)
      .map(({ id, label }) => ({ id, label }));
  }

  function modelAvailable(models, model) {
    return models.some((id) => id === model || id.startsWith(`${model}-`));
  }

  async function testConnection(settings) {
    const started = Date.now();
    const model = resolve(settings);
    let models = null;
    try {
      models = (await fetchModelCatalog(settings))?.map((entry) => entry.id) || null;
    } catch (error) {
      if (!error.listFailed) throw error;
    }
    if (models && models.length && !modelAvailable(models, model)) {
      const examples = models.slice(0, 8).join(", ");
      throw new Error(
        `The API key works, but model "${model}" is not available to it. Pick a different model. Available models include: ${examples}`
      );
    }
    const { text } = await complete("Reply with the single word OK.", settings, TEST_TIMEOUT_MS);
    if (!text) {
      throw new Error(`The API key works, but model "${model}" returned no text`);
    }
    return { model, reply: text.slice(0, 100), latencyMs: Date.now() - started };
  }

  root.BidBotAI = { generateBid, testConnection, listModels, renderPrompt, cleanBid, DEFAULT_PROMPT, DEFAULT_MODELS, PLACEHOLDERS };
})(typeof self !== "undefined" ? self : globalThis);
