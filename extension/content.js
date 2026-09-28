const DESCRIPTION_SELECTORS = [
  "[data-testid='project-description']",
  ".ProjectDescription"
];
const BUDGET_SELECTORS = [
  "[data-testid='project-budget']",
  ".ProjectViewDetails-budget",
  ".PageProjectViewLogout-detail-tags"
];
const BID_INPUT_SELECTORS = [
  "textarea[name='description']",
  "textarea[id*='description']",
  "textarea",
  "[contenteditable='true']"
];
const SUBMIT_SELECTORS = [
  "[data-testid='submit-bid']",
  ".BidForm button",
  "button[type='submit']"
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function firstText(selectors) {
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.textContent?.trim();
    if (value) {
      return value;
    }
  }
  return "";
}

async function waitForElement(selectors, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
    }
    await wait(300);
  }
  return null;
}

function extractFreelancerProject() {
  return {
    title: document.querySelector("h1")?.textContent?.trim() || "Unknown title",
    description: firstText(DESCRIPTION_SELECTORS) || "Description not found",
    budget: firstText(BUDGET_SELECTORS) || "Budget not found",
    pageUrl: window.location.href
  };
}

async function extractWhenReady() {
  await waitForElement(DESCRIPTION_SELECTORS, 10000);
  return extractFreelancerProject();
}

function nativeValueSetter(element) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  return Object.getOwnPropertyDescriptor(prototype, "value").set;
}

function setNativeValue(element, value) {
  element.focus();
  if (element.isContentEditable) {
    element.textContent = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
    return;
  }
  nativeValueSetter(element).call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

// Typing delay ranges in ms per character.
const TYPING_SPEEDS = {
  fast: [15, 45],
  normal: [35, 95],
  slow: [70, 160]
};

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function pauseAfter(char, [min, max]) {
  let delay = randomBetween(min, max);
  if (char === "\n") delay += randomBetween(250, 600);
  else if (/[.!?]/.test(char)) delay += randomBetween(150, 400);
  else if (/[,;:]/.test(char)) delay += randomBetween(60, 180);
  else if (Math.random() < 0.015) delay += randomBetween(400, 1200); // occasional "thinking" pause
  return delay;
}

async function typeLikeHuman(element, text, speed) {
  const range = TYPING_SPEEDS[speed] || TYPING_SPEEDS.normal;
  element.focus();
  element.scrollIntoView({ block: "center" });
  setNativeValue(element, "");
  await wait(randomBetween(300, 800));

  let typed = "";
  let lastProgress = Date.now();
  for (const char of text) {
    typed += char;
    if (element.isContentEditable) {
      if (!document.execCommand("insertText", false, char)) {
        element.textContent = typed;
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: char }));
      }
    } else {
      nativeValueSetter(element).call(element, typed);
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: char }));
    }
    await wait(pauseAfter(char, range));

    // Keep the background worker awake and informed during long bids.
    if (Date.now() - lastProgress > 4000) {
      lastProgress = Date.now();
      chrome.runtime.sendMessage({ type: "TYPING_PROGRESS", typed: typed.length, total: text.length }).catch(() => {});
    }
  }
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function findSubmitButton() {
  for (const selector of SUBMIT_SELECTORS) {
    for (const button of document.querySelectorAll(selector)) {
      const text = button.textContent?.trim().toLowerCase() || "";
      if (text.includes("place bid") || text.includes("submit") || text.includes("bid")) {
        return button;
      }
    }
  }
  return null;
}

async function fillBid({ draft, autoSubmit, humanTyping, typingSpeed }) {
  if (!draft) {
    throw new Error("No draft text to fill.");
  }
  const bidInput = await waitForElement(BID_INPUT_SELECTORS);
  if (!bidInput) {
    throw new Error("Could not find bid description field.");
  }
  if (humanTyping) {
    await typeLikeHuman(bidInput, draft, typingSpeed);
  } else {
    setNativeValue(bidInput, draft);
  }

  const submitButton = findSubmitButton();
  if (!submitButton) {
    throw new Error("Could not find submit/place-bid button.");
  }
  if (autoSubmit) {
    await wait(randomBetween(700, 1800));
    submitButton.scrollIntoView({ block: "center" });
    submitButton.click();
  }
  return { submitClicked: Boolean(autoSubmit) };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handlers = {
    EXTRACT_PROJECT: async () => ({ project: await extractWhenReady() }),
    FILL_BID: () => fillBid(message)
  };
  const handler = handlers[message?.type];
  if (!handler) {
    return false;
  }
  handler()
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
