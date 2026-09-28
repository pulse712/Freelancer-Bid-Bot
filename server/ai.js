function buildPrompt(project, profileSummary) {
  return [
    "You are an expert freelancer writing high-converting bids.",
    "Return only the proposal text in plain format.",
    "Length: 120-220 words. Tone: confident, practical, professional.",
    "Mention understanding of project, 3 concise strengths, short execution steps, and call-to-action.",
    "",
    "Freelancer profile:",
    profileSummary || "Skilled freelancer with consistent delivery and communication.",
    "",
    "Project context:",
    `Title: ${project.title || ""}`,
    `Description: ${project.description || ""}`,
    `Budget: ${project.budget || ""}`,
    `URL: ${project.pageUrl || ""}`
  ].join("\n");
}

function buildTemplateDraft(project, profileSummary) {
  const summary = profileSummary || "Skilled freelancer with reliable delivery and communication.";
  return [
    "Hello,",
    "",
    `I reviewed your project: "${project.title || "Project"}".`,
    "I can deliver this efficiently with clear milestones and frequent updates.",
    "",
    "Why I am a strong fit:",
    `- ${summary}`,
    "- Hands-on experience delivering similar client projects.",
    "- Clear communication and quick iteration cycles.",
    "",
    "Proposed execution:",
    "1) Confirm requirements and acceptance criteria",
    "2) Deliver first working milestone quickly",
    "3) Refine and finalize after your feedback",
    "",
    "If this matches your expectations, I can start immediately.",
    "Best regards"
  ].join("\n");
}

async function callOpenAICompatible(prompt, aiConfig) {
  const endpoint = aiConfig.baseUrl || "https://api.openai.com/v1/chat/completions";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${aiConfig.apiKey}`
    },
    body: JSON.stringify({
      model: aiConfig.model || "gpt-4o-mini",
      temperature: 0.5,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!response.ok) {
    throw new Error(`OpenAI-compatible call failed (${response.status})`);
  }
  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content?.trim();
}

async function callClaude(prompt, aiConfig) {
  const endpoint = aiConfig.baseUrl || "https://api.anthropic.com/v1/messages";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": aiConfig.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: aiConfig.model || "claude-3-5-sonnet-latest",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!response.ok) {
    throw new Error(`Claude call failed (${response.status})`);
  }
  const payload = await response.json();
  return payload?.content?.find((item) => item.type === "text")?.text?.trim();
}

async function callGemini(prompt, aiConfig) {
  const model = aiConfig.model || "gemini-1.5-pro";
  const endpoint =
    aiConfig.baseUrl ||
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(aiConfig.apiKey)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  if (!response.ok) {
    throw new Error(`Gemini call failed (${response.status})`);
  }
  const payload = await response.json();
  return payload?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
}

const PROVIDERS = {
  openai: callOpenAICompatible,
  cursor: callOpenAICompatible,
  claude: callClaude,
  gemini: callGemini
};

async function generateDraft(project, profileSummary, aiConfig) {
  if (!aiConfig?.provider || !aiConfig?.apiKey) {
    return { draft: buildTemplateDraft(project, profileSummary), source: "template" };
  }
  const call = PROVIDERS[aiConfig.provider];
  if (!call) {
    throw new Error(`Unsupported provider: ${aiConfig.provider}`);
  }
  const draft = await call(buildPrompt(project, profileSummary), aiConfig);
  if (!draft) {
    throw new Error("Provider returned empty draft");
  }
  return { draft, source: aiConfig.provider };
}

module.exports = { generateDraft, buildTemplateDraft };
