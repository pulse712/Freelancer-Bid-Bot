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

function setNativeValue(element, value) {
  element.focus();
  if (element.isContentEditable) {
    element.textContent = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
    return;
  }
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
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

async function fillBid({ draft, autoSubmit }) {
  if (!draft) {
    throw new Error("No draft text to fill.");
  }
  const bidInput = await waitForElement(BID_INPUT_SELECTORS);
  if (!bidInput) {
    throw new Error("Could not find bid description field.");
  }
  setNativeValue(bidInput, draft);

  const submitButton = findSubmitButton();
  if (!submitButton) {
    throw new Error("Could not find submit/place-bid button.");
  }
  if (autoSubmit) {
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
