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

// Total typing time for the whole bid, in seconds. Older saved values are mapped to the new ones.
const TYPING_SECONDS = { 8: 8, 15: 15, 25: 25, fast: 8, normal: 15, slow: 25 };
const DEFAULT_TYPING_SECONDS = 8;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

// Splits the total time into a base delay per character plus a pool for pauses at punctuation and line breaks,
// so the whole bid takes about the chosen number of seconds whatever its length.
function typingPlan(text, seconds) {
  const totalMs = seconds * 1000;
  const pauseSpots = (text.match(/[.!?,;:\n]/g) || []).length;
  const pauseBudget = totalMs * 0.2;
  return {
    base: (totalMs - pauseBudget) / Math.max(1, text.length),
    pause: pauseSpots ? pauseBudget / pauseSpots : 0
  };
}

function pauseAfter(char, plan) {
  let delay = plan.base * randomBetween(0.45, 1.55);
  if (char === "\n") delay += plan.pause * randomBetween(1.2, 1.8);
  else if (/[.!?]/.test(char)) delay += plan.pause * randomBetween(0.9, 1.4);
  else if (/[,;:]/.test(char)) delay += plan.pause * randomBetween(0.4, 0.8);
  return delay;
}

async function typeLikeHuman(element, text, speed) {
  const seconds = TYPING_SECONDS[speed] || DEFAULT_TYPING_SECONDS;
  const plan = typingPlan(text, seconds);
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
    await wait(pauseAfter(char, plan));

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

function describeElement(element) {
  if (!element) return "none";
  const id = element.id ? `#${element.id}` : "";
  const classes = element.className && typeof element.className === "string" ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
  return `${element.tagName.toLowerCase()}${id}${classes} "${normalizedText(element).slice(0, 30)}"`;
}

// Picks the element that sends the bid. Pages can contain several "Place Bid" texts (for example a link near the
// top that only scrolls to the form), so candidates are scored: real buttons in the bid form, after the bid box, win.
function findSubmitButton(bidInput) {
  const explicit = document.querySelector(SUBMIT_SELECTORS[0]);
  if (explicit && isVisible(explicit)) return explicit;

  const form = bidInput ? bidInput.closest("form") : null;
  const candidates = [...document.querySelectorAll("button, [role='button'], input[type='submit'], a")].filter(
    (element) => isVisible(element) && normalizedText(element).length < 40
  );
  let best = null;
  let bestScore = -Infinity;
  for (const element of candidates) {
    const text = normalizedText(element) || element.value?.toLowerCase() || "";
    const patternIndex = SUBMIT_TEXT.findIndex((pattern) => pattern.test(text));
    if (patternIndex === -1) continue;
    let score = (SUBMIT_TEXT.length - patternIndex) * 10;
    if (element.matches("button, input[type='submit']")) score += 8;
    if (element.tagName === "A") score -= 8;
    if (form && form.contains(element)) score += 12;
    if (bidInput && bidInput.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) score += 6;
    if (!isDisabled(element)) score += 2;
    if (score > bestScore) {
      best = element;
      bestScore = score;
    }
  }
  return best;
}

async function waitForSubmitButton(bidInput, timeoutMs = 10000) {
  const start = Date.now();
  let button = null;
  while (Date.now() - start < timeoutMs) {
    button = findSubmitButton(bidInput);
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
  // One more click in the box after typing, then real keystrokes so the page's form registers the text.
  await wait(randomBetween(300, 700));
  await humanClick(bidInput);
  const registered = await confirmTypedText(bidInput);

  let sealed = "skipped";
  if (sealedBid) {
    await wait(randomBetween(400, 900));
    sealed = await selectUpgrade(/^sealed$/);
  }

  const submitButton = await waitForSubmitButton(bidInput, autoSubmit ? 10000 : 2000);
  if (!autoSubmit) {
    return { submitClicked: false, submitFound: Boolean(submitButton), submitTarget: describeElement(submitButton), sealed, registered };
  }
  if (!submitButton) {
    throw new Error("Bid typed, but the Place Bid button was not found on the page.");
  }
  if (isDisabled(submitButton)) {
    throw new Error("Bid typed, but the Place Bid button is disabled. Check the amount and other required fields.");
  }
  await wait(randomBetween(700, 1800));
  const submit = await pressSubmit(submitButton, bidInput, draft);
  return { submitClicked: true, submitFound: true, sealed, registered, ...submit };
}

// ----- making the page's form notice the typed text -----

function currentText(element) {
  return element.isContentEditable ? element.textContent : element.value;
}

function fireKey(element, key, keyCode) {
  for (const type of ["keydown", "keypress", "keyup"]) {
    element.dispatchEvent(new KeyboardEvent(type, { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true }));
  }
}

// After typing, press Enter and Backspace (as events) so frameworks watching the box re-read its value,
// then fire input/change/blur. The text ends exactly as typed.
async function confirmTypedText(element) {
  const expected = currentText(element);
  element.focus({ preventScroll: true });
  if (!element.isContentEditable) element.setSelectionRange(expected.length, expected.length);

  fireKey(element, "Enter", 13);
  if (!element.isContentEditable) {
    nativeValueSetter(element).call(element, `${expected}\n`);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertLineBreak", data: null }));
  }
  await wait(randomBetween(120, 260));
  fireKey(element, "Backspace", 8);
  if (!element.isContentEditable) {
    nativeValueSetter(element).call(element, expected);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }));
  }
  await wait(randomBetween(80, 160));
  if (currentText(element) !== expected) setNativeValue(element, expected);
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  return "enter+backspace";
}

// Re-enter the proposal in one go (paste-like), for a retry after the form said the box was empty.
async function retypeText(element, text) {
  element.focus({ preventScroll: true });
  setNativeValue(element, "");
  await wait(randomBetween(150, 300));
  if (element.isContentEditable) {
    element.textContent = text;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: text }));
  } else {
    nativeValueSetter(element).call(element, text);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: text }));
  }
  await confirmTypedText(element);
}

// ----- submit -----

const CONFIRM_TEXT = /\b(bid|proposal) (has been |was )?(placed|submitted|sent)\b|you('ve| have) (already )?(bid|placed a bid)\b/i;
const ERROR_TEXT = /failed to create bid|please complete all fields|please enter (your )?proposal|minimum \d+ characters|is required/i;

function pageText() {
  return (document.body.innerText || "").slice(0, 30000);
}

// Signs that the bid was sent (or rejected). `before` is the page text before clicking, so only new messages count.
function bidSubmittedSignal(button, before) {
  const text = pageText();
  const newError = text.match(ERROR_TEXT);
  if (newError && !ERROR_TEXT.test(before)) return `error: ${newError[0]}`;
  if (!button.isConnected || !isVisible(button)) return "button gone";
  if (isDisabled(button)) return "button disabled";
  if (button.querySelector("[class*='spinner'], [class*='loading']")) return "button busy";
  if (!document.querySelector(BID_INPUT_SELECTORS.join(","))) return "bid form gone";
  const confirmation = text.match(CONFIRM_TEXT);
  if (confirmation && !CONFIRM_TEXT.test(before)) return `confirmation: ${confirmation[0]}`;
  return null;
}

async function waitForSubmitSignal(button, before, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const signal = bidSubmittedSignal(button, before);
    if (signal) return signal;
    await wait(250);
  }
  return null;
}

async function clickSubmitOnce(button, before) {
  // 1. Pointer-driven click: the full mouse event sequence on the element under the pointer, and on the button itself.
  const point = await movePointerTo(button);
  await wait(randomBetween(90, 220));
  const under = document.elementFromPoint(point.x, point.y);
  const target = under && button.contains(under) ? under : button;
  firePointerAndMouse(target, "mouseover", point.x, point.y);
  firePointerAndMouse(target, "mousemove", point.x, point.y);
  firePointerAndMouse(target, "mousedown", point.x, point.y, { buttons: 1 });
  button.focus({ preventScroll: true });
  await wait(randomBetween(50, 130));
  firePointerAndMouse(target, "mouseup", point.x, point.y);
  firePointerAndMouse(target, "click", point.x, point.y);
  let signal = await waitForSubmitSignal(button, before, 2500);
  if (signal) return { submitMethod: "mouse events", signal };

  // 2. The element's own click(), and the click on the parent component (custom button wrappers).
  button.click();
  signal = await waitForSubmitSignal(button, before, 1500);
  if (signal) return { submitMethod: "element.click", signal };
  const wrapper = button.parentElement;
  if (wrapper && wrapper.tagName.includes("-")) {
    firePointerAndMouse(wrapper, "click", point.x, point.y);
    signal = await waitForSubmitSignal(button, before, 1500);
    if (signal) return { submitMethod: "wrapper click", signal };
  }

  // 3. Submit the surrounding form the way a submit button would.
  const form = button.form || button.closest("form");
  if (form) {
    if (typeof form.requestSubmit === "function") {
      try {
        form.requestSubmit(button.matches("button, input[type='submit']") && button.form === form ? button : undefined);
      } catch (_error) {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
    } else {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }
    signal = await waitForSubmitSignal(button, before, 2500);
    if (signal) return { submitMethod: "form submit", signal };
  }

  // 4. Keyboard activation.
  button.focus({ preventScroll: true });
  fireKey(button, "Enter", 13);
  fireKey(button, " ", 32);
  signal = await waitForSubmitSignal(button, before, 1500);
  return { submitMethod: signal ? "keyboard" : "all methods tried", signal };
}

async function pressSubmit(button, bidInput, draft) {
  const before = pageText();
  let attempt = await clickSubmitOnce(button, before);

  // The page rejected the form (typically "please enter your proposal"): re-enter the text and retry once.
  if (attempt.signal && attempt.signal.startsWith("error:") && bidInput.isConnected) {
    await retypeText(bidInput, draft);
    await wait(randomBetween(600, 1200));
    const retryButton = findSubmitButton(bidInput) || button;
    const second = await clickSubmitOnce(retryButton, pageText());
    attempt = { ...second, note: [attempt.signal, "text re-entered", second.note].filter(Boolean).join("; ") };
  }

  schedulePointerHide();
  const ok = attempt.signal && !attempt.signal.startsWith("error:");
  return {
    submitMethod: attempt.submitMethod,
    submitConfirmed: ok ? attempt.signal : null,
    submitTarget: describeElement(button),
    submitNote: attempt.note || (attempt.signal || undefined)
  };
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
