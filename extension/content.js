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

// ----- visible, human-like mouse pointer -----

const CURSOR_ID = "bidbot-cursor";
const CURSOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="24" height="32">' +
  '<path d="M3 2 L3 26 L9 20 L13 30 L17 28 L13 18 L21 18 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';

const pointer = { element: null, x: window.innerWidth / 2, y: window.innerHeight / 2, hideTimer: null };

function ensurePointer() {
  if (pointer.element && pointer.element.isConnected) return pointer.element;
  const element = document.createElement("div");
  element.id = CURSOR_ID;
  element.style.cssText =
    "position:fixed;left:0;top:0;width:24px;height:32px;z-index:2147483647;pointer-events:none;" +
    "filter:drop-shadow(0 1px 2px rgba(0,0,0,.6));transition:opacity .4s;opacity:1;will-change:transform;";
  element.innerHTML = CURSOR_SVG;
  document.documentElement.appendChild(element);
  pointer.element = element;
  placePointer(pointer.x, pointer.y);
  return element;
}

function placePointer(x, y) {
  pointer.x = x;
  pointer.y = y;
  if (pointer.element) pointer.element.style.transform = `translate(${x - 3}px, ${y - 2}px)`;
}

function schedulePointerHide(delayMs = 4000) {
  clearTimeout(pointer.hideTimer);
  pointer.hideTimer = setTimeout(() => {
    if (pointer.element) pointer.element.style.opacity = "0";
  }, delayMs);
}

function showPointer() {
  const element = ensurePointer();
  element.style.opacity = "1";
  clearTimeout(pointer.hideTimer);
}

function mouseEventInit(x, y, extra = {}) {
  return { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, ...extra };
}

function firePointerAndMouse(target, type, x, y, extra = {}) {
  const init = mouseEventInit(x, y, extra);
  if (typeof PointerEvent === "function" && type !== "click") {
    target.dispatchEvent(new PointerEvent(`pointer${type.replace("mouse", "")}`, { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true }));
  }
  target.dispatchEvent(new MouseEvent(type, init));
}

function randomPointIn(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width * randomBetween(0.3, 0.7),
    y: rect.top + rect.height * randomBetween(0.35, 0.65)
  };
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

async function movePointerTo(element) {
  showPointer();
  element.scrollIntoView({ block: "center" });
  await wait(randomBetween(150, 350));

  const from = { x: pointer.x, y: pointer.y };
  const to = randomPointIn(element);
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const duration = Math.min(1400, Math.max(350, 300 + distance * 0.9));
  // A curved path: a control point pushed sideways from the straight line.
  const bend = (Math.random() < 0.5 ? -1 : 1) * Math.min(160, distance * randomBetween(0.15, 0.35));
  const control = { x: (from.x + to.x) / 2 + (-(to.y - from.y) / (distance || 1)) * bend, y: (from.y + to.y) / 2 + ((to.x - from.x) / (distance || 1)) * bend };

  const start = performance.now();
  while (true) {
    const t = Math.min(1, (performance.now() - start) / duration);
    const e = easeInOut(t);
    const jitter = t < 1 ? randomBetween(-1.2, 1.2) : 0;
    const x = (1 - e) * (1 - e) * from.x + 2 * (1 - e) * e * control.x + e * e * to.x + jitter;
    const y = (1 - e) * (1 - e) * from.y + 2 * (1 - e) * e * control.y + e * e * to.y + jitter;
    placePointer(x, y);
    const under = document.elementFromPoint(x, y) || document.body;
    firePointerAndMouse(under, "mousemove", x, y);
    if (t >= 1) break;
    await wait(16);
  }
  return to;
}

async function humanClick(element) {
  const { x, y } = await movePointerTo(element);
  await wait(randomBetween(90, 220));
  const target = document.elementFromPoint(x, y) || element;
  firePointerAndMouse(target, "mouseover", x, y);
  firePointerAndMouse(target, "mousedown", x, y, { buttons: 1 });
  if (pointer.element) pointer.element.style.transform += " scale(0.85)";
  await wait(randomBetween(50, 130));
  firePointerAndMouse(target, "mouseup", x, y);
  placePointer(x, y);
  firePointerAndMouse(target, "click", x, y);
  if (target !== element && !element.contains(target)) {
    element.click(); // the spot was covered by something else; make sure the intended element still gets the click
  }
  if (typeof element.focus === "function") element.focus({ preventScroll: true });
  schedulePointerHide();
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
  element.focus({ preventScroll: true });
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

function isVisible(element) {
  if (!element || !element.isConnected) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const style = getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none";
}

function normalizedText(element) {
  return (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isDisabled(element) {
  return Boolean(
    element.disabled ||
      element.getAttribute("aria-disabled") === "true" ||
      element.closest("[aria-disabled='true'], [disabled]")
  );
}

// Text patterns for the button that sends the bid, most specific first.
const SUBMIT_TEXT = [/^place (a )?bid$/, /^submit (bid|proposal)$/, /^place bid/, /^submit$/, /^bid now$/];

function findSubmitButton() {
  const explicit = document.querySelector(SUBMIT_SELECTORS[0]);
  if (explicit && isVisible(explicit)) return explicit;

  const candidates = [...document.querySelectorAll("button, [role='button'], input[type='submit'], a")].filter(
    (element) => isVisible(element) && normalizedText(element).length < 40
  );
  for (const pattern of SUBMIT_TEXT) {
    const match = candidates.find((element) => pattern.test(normalizedText(element) || element.value?.toLowerCase() || ""));
    if (match) return match;
  }
  return null;
}

async function waitForSubmitButton(timeoutMs = 10000) {
  const start = Date.now();
  let button = null;
  while (Date.now() - start < timeoutMs) {
    button = findSubmitButton();
    if (button && !isDisabled(button)) return button;
    await wait(400);
  }
  return button;
}

function checkboxState(element) {
  if (element.matches("input[type='checkbox']")) return element.checked;
  const aria = element.getAttribute("aria-checked");
  if (aria !== null) return aria === "true";
  return element.classList.contains("checked") || element.classList.contains("is-checked");
}

// Finds the checkbox next to an upgrade label such as "Sealed" and turns it on.
async function selectUpgrade(labelPattern) {
  const badges = [...document.querySelectorAll("span, div, label, p, b, strong")].filter(
    (element) => isVisible(element) && labelPattern.test(normalizedText(element)) && normalizedText(element).length < 20
  );
  if (!badges.length) return "not found";

  for (const badge of badges) {
    let container = badge;
    for (let depth = 0; depth < 7 && container; depth += 1, container = container.parentElement) {
      const boxes = [...container.querySelectorAll("input[type='checkbox'], [role='checkbox'], [role='switch']")];
      if (boxes.length !== 1) continue; // keep climbing until exactly this upgrade's checkbox is in view
      const box = boxes[0];
      if (checkboxState(box)) return "already selected";

      const visibleTarget = [box.closest("label"), badge, box].find((candidate) => candidate && isVisible(candidate));
      await humanClick(visibleTarget || box);
      await wait(300);
      if (checkboxState(box)) return "selected";
      for (const target of [box.closest("label"), box, badge]) {
        if (!target) continue;
        target.click();
        await wait(300);
        if (checkboxState(box)) return "selected";
      }
      return "click did not register";
    }
  }
  return "checkbox not found near label";
}

async function fillBid({ draft, autoSubmit, humanTyping, typingSpeed, sealedBid }) {
  if (!draft) {
    throw new Error("No draft text to fill.");
  }
  const bidInput = await waitForElement(BID_INPUT_SELECTORS);
  if (!bidInput) {
    throw new Error("Could not find bid description field.");
  }
  await humanClick(bidInput);
  if (humanTyping) {
    await typeLikeHuman(bidInput, draft, typingSpeed);
  } else {
    setNativeValue(bidInput, draft);
  }
  // One more click in the box after typing, so the page registers the finished text.
  await wait(randomBetween(300, 700));
  await humanClick(bidInput);

  let sealed = "skipped";
  if (sealedBid) {
    await wait(randomBetween(400, 900));
    sealed = await selectUpgrade(/^sealed$/);
  }

  const submitButton = await waitForSubmitButton(autoSubmit ? 10000 : 2000);
  if (!autoSubmit) {
    return { submitClicked: false, submitFound: Boolean(submitButton), sealed };
  }
  if (!submitButton) {
    throw new Error("Bid typed, but the Place Bid button was not found on the page.");
  }
  if (isDisabled(submitButton)) {
    throw new Error("Bid typed, but the Place Bid button is disabled. Check the amount and other required fields.");
  }
  await wait(randomBetween(700, 1800));
  await humanClick(submitButton);
  return { submitClicked: true, submitFound: true, sealed };
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
