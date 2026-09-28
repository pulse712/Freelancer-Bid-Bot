const DEFAULT_PROMPT = `You are an experienced freelancer writing a bid for the Freelancer.com project below.
Write only the proposal text: plain text, no markdown, 120-220 words.
Show you understood the project, give 3 short reasons you are a good fit, outline a 2-3 step plan, and end with a clear call to action.

Title: {title}
Budget: {budget}
Skills: {skills}
Description:
{description}`;

const DEFAULT_MODELS = {
  openai: "gpt-4o-mini",
  cursor: "gpt-4o-mini",
  claude: "claude-3-5-sonnet-latest",
  gemini: "gemini-1.5-pro"
};

const PLACEHOLDERS = ["title", "description", "budget", "skills", "url"];

function renderPrompt(template, project) {
  const values = {
    title: project.title,
    description: project.description,
    budget: project.budget,
    skills: project.skills,
    url: project.pageUrl
  };
  const pattern = new RegExp(`\\{(${PLACEHOLDERS.join("|")})\\}`, "g");
  return (template || DEFAULT_PROMPT).replace(pattern, (_match, key) => values[key] || "");
}

const STATUS_HINTS = {
  400: "request rejected; check the model name and base URL",
  401: "API key rejected",
  403: "API key has no access to this model or endpoint",
  404: "model or endpoint not found",
  429: "rate limit hit or quota/credits used up"
};

async function readJson(response, label) {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const hint = STATUS_HINTS[response.status];
    throw new Error(`${label} returned ${response.status}${hint ? ` (${hint})` : ""}: ${body.slice(0, 200)}`);
  }
  return response.json();
}

async function callOpenAICompatible(prompt, settings, model) {
  const response = await fetch(settings.baseUrl || "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.5,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const payload = await readJson(response, "OpenAI-compatible API");
  return payload?.choices?.[0]?.message?.content?.trim();
}

async function callClaude(prompt, settings, model) {
  const response = await fetch(settings.baseUrl || "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const payload = await readJson(response, "Claude API");
  return payload?.content?.find((item) => item.type === "text")?.text?.trim();
}

async function callGemini(prompt, settings, model) {
  const endpoint =
    settings.baseUrl ||
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(settings.apiKey)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  const payload = await readJson(response, "Gemini API");
  return payload?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
}

const PROVIDERS = {
  openai: callOpenAICompatible,
  cursor: callOpenAICompatible,
  claude: callClaude,
  gemini: callGemini
};

async function complete(prompt, settings) {
  const call = PROVIDERS[settings.provider];
  if (!call) {
    throw new Error("No AI provider selected in Settings");
  }
  if (!settings.apiKey) {
    throw new Error("No AI API key saved in Settings");
  }
  const model = settings.model || DEFAULT_MODELS[settings.provider];
  return { text: await call(prompt, settings, model), model };
}

async function generateBid(project, settings) {
  const { text } = await complete(renderPrompt(settings.prompt, project), settings);
  if (!text) {
    throw new Error("AI provider returned an empty bid");
  }
  return text;
}

async function testConnection(settings) {
  const started = Date.now();
  const { text, model } = await complete("Reply with the single word OK.", settings);
  if (!text) {
    throw new Error("Provider answered but returned no text");
  }
  return { model, reply: text.slice(0, 100), latencyMs: Date.now() - started };
}

module.exports = { generateBid, testConnection, DEFAULT_PROMPT, DEFAULT_MODELS, PLACEHOLDERS };
