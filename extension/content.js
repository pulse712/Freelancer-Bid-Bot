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
  "textarea[id*='proposal']",
  "textarea[id*='description']",
  "textarea[placeholder*='proposal' i]",
  "textarea[aria-label*='proposal' i]"
];

const NOT_BID_CONTEXT = /clarification board|ask a question|view \d+ more questions|no spam, self-promotion|post a (question|comment)/i;
const BID_CONTEXT = /describe your proposal|proposal \(minimum|write (your )?bid|bid description|cover letter|minimum \d+ characters/i;
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
const TYPING_SECONDS = { 3: 3, 10: 10, 8: 3, 15: 10, 25: 10, fast: 3, normal: 10, slow: 10 };
const DEFAULT_TYPING_SECONDS = 3;

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

// ----- NDA / IP agreements -----

const IS_TOP = window === window.top;
const AGREEMENT_KIND = [
  { id: "nda", pattern: /non[-\s]?disclosure|\bnda\b/i },
  { id: "ip", pattern: /\bip (agreement|contract)\b|intellectual property/i }
];

function agreementKindOf(text) {
  const match = AGREEMENT_KIND.find((kind) => kind.pattern.test(text));
  return match ? match.id : null;
}

function queryDeep(root, selector) {
  const found = [];
  const visit = (node) => {
    if (!node || !node.querySelectorAll) return;
    try {
      found.push(...node.querySelectorAll(selector));
    } catch (_error) {
      return;
    }
    for (const element of node.querySelectorAll("*")) {
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };
  visit(root);
  return found;
}

function sameOriginFrames(win = window) {
  const docs = [];
  const walk = (w) => {
    try {
      docs.push(w.document);
      for (const frame of w.frames) walk(frame);
    } catch (_error) {
      // Cross-origin; the all_frames content script handles that document.
    }
  };
  walk(win);
  return docs;
}

function visibleDeep(selector) {
  return sameOriginFrames().flatMap((doc) => queryDeep(doc, selector)).filter(isVisible);
}

function unsignedAgreementLinks() {
  const clickables = visibleDeep("a, button, [role='button'], [role='link']").filter((element) => {
    const text = normalizedText(element);
    return text.length > 0 && text.length < 80 && Boolean(agreementKindOf(text));
  });

  const banners = [];
  for (const doc of sameOriginFrames()) {
    const candidates = queryDeep(
      doc,
      "a, button, p, div, span, section, aside, li, h2, h3, [class*='alert'], [class*='banner'], [class*='notice'], [class*='warning']"
    );
    for (const element of candidates) {
      if (!isVisible(element)) continue;
      const text = normalizedText(element);
      if (/you must sign/i.test(text) && text.length < 800) banners.push(element);
    }
  }

  const fromBanners = [];
  for (const banner of banners) {
    const inside = clickables.filter((link) => banner.contains(link));
    if (inside.length) fromBanners.push(...inside);
    else {
      const kind = agreementKindOf(normalizedText(banner));
      const nearby = clickables.find((link) => agreementKindOf(normalizedText(link)) === kind);
      if (nearby) fromBanners.push(nearby);
    }
  }
  const chosen = fromBanners.length ? fromBanners : clickables;
  const unique = [];
  const seen = new Set();
  for (const link of chosen) {
    const kind = agreementKindOf(normalizedText(link)) || normalizedText(link);
    if (seen.has(kind)) continue;
    seen.add(kind);
    unique.push(link);
  }
  return unique;
}

function dialogRoots() {
  return visibleDeep("[role='dialog'], [aria-modal='true'], .modal, [class*='Modal'], [class*='modal'], [class*='overlay'], [class*='Overlay']").filter(
    (element) => element.getBoundingClientRect().width > 180
  );
}

function signerIframes() {
  return visibleDeep("iframe").filter((frame) => {
    const src = `${frame.src || ""} ${frame.getAttribute("name") || ""}`.toLowerCase();
    const rect = frame.getBoundingClientRect();
    return (
      rect.width > 200 &&
      rect.height > 120 &&
      /hellosign|dropbox|sign|hs-embed|embedded/i.test(src)
    );
  });
}

function isYellowish(element) {
  const style = getComputedStyle(element);
  const color = `${style.backgroundColor} ${style.borderColor}`;
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return false;
  const [, r, g, b] = match.map(Number);
  return r > 180 && g > 160 && b < 140 && r - b > 40;
}

function signatureTargets(root = document) {
  const nodes = queryDeep(root, "canvas, input, textarea, [contenteditable='true'], button, a, div, span, p, label, td, [class*='sign'], [class*='Sign']");
  return nodes.filter((element) => {
    if (!isVisible(element)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 60 || rect.height < 18) return false;
    const text = normalizedText(element);
    if (/your name goes here|click to (sign|type)|click here to sign|type your name|sign here/i.test(text)) return true;
    if (element.tagName === "CANVAS" && rect.width >= 100 && rect.height >= 36) return true;
    if (isYellowish(element) && rect.width >= 100 && rect.height >= 28 && rect.height < 220 && text.length < 80) return true;
    return false;
  });
}

function fieldScore(element, kind) {
  const bits = [
    element.getAttribute("name"),
    element.getAttribute("id"),
    element.getAttribute("placeholder"),
    element.getAttribute("aria-label"),
    element.getAttribute("autocomplete"),
    element.getAttribute("data-qa"),
    element.closest("label")?.textContent,
    element.previousElementSibling?.textContent,
    element.parentElement?.innerText?.slice(0, 80)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (kind === "name") {
    if (/address|email|phone|city|country|search|company/.test(bits)) return -1;
    if (/full.?name|legal.?name|your.?name|signer|print.?name|typed name/i.test(bits)) return 4;
    if (/\bname\b/.test(bits)) return 2;
    return 0;
  }
  if (/email/.test(bits)) return -1;
  if (/address|street|city|country|post.?code|zip/.test(bits)) return 3;
  return 0;
}

function findField(root, kind) {
  const candidates = queryDeep(
    root,
    "input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='submit']):not([type='button']), textarea, [contenteditable='true']"
  ).filter(isVisible);
  let best = null;
  let bestScore = 0;
  for (const element of candidates) {
    const score = fieldScore(element, kind);
    if (score > bestScore) {
      best = element;
      bestScore = score;
    }
  }
  return best;
}

async function typeIntoField(element, value) {
  await humanClick(element);
  setNativeValue(element, "");
  await wait(randomBetween(80, 180));
  await typeLikeHuman(element, value, "3");
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
}

function signatureCanvas(root) {
  return queryDeep(root, "canvas").find((canvas) => {
    const rect = canvas.getBoundingClientRect();
    return isVisible(canvas) && rect.width >= 100 && rect.height >= 36;
  });
}

function fireCanvasPointer(canvas, type, x, y, extra = {}) {
  const rect = canvas.getBoundingClientRect();
  const clientX = rect.left + x;
  const clientY = rect.top + y;
  const init = mouseEventInit(clientX, clientY, extra);
  canvas.dispatchEvent(
    new PointerEvent(type.replace("mouse", "pointer"), {
      ...init,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      pressure: extra.buttons ? 0.5 : 0
    })
  );
  canvas.dispatchEvent(new MouseEvent(type, init));
}

async function drawSignature(canvas, name) {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  const start = { x: width * 0.12, y: height * 0.62 };
  await movePointerTo(canvas);
  fireCanvasPointer(canvas, "mousedown", start.x, start.y, { buttons: 1 });
  placePointer(rect.left + start.x, rect.top + start.y);

  const letters = Math.min(12, Math.max(6, (name || "sign").replace(/\s+/g, "").length));
  let x = start.x;
  let y = start.y;
  for (let i = 0; i < letters; i += 1) {
    x += width * randomBetween(0.04, 0.08);
    y = start.y + Math.sin(i * 1.1) * height * 0.18 + randomBetween(-4, 4);
    fireCanvasPointer(canvas, "mousemove", x, Math.max(8, Math.min(height - 8, y)), { buttons: 1 });
    placePointer(rect.left + x, rect.top + y);
    await wait(18);
  }
  fireCanvasPointer(canvas, "mouseup", x, y);
  schedulePointerHide();
}

function findActionButton(root, patterns) {
  const buttons = queryDeep(root, "button, [role='button'], a, input[type='submit'], input[type='button']").filter(isVisible);
  for (const pattern of patterns) {
    const match = buttons.find(
      (button) => pattern.test(normalizedText(button)) && normalizedText(button).length < 48 && !isDisabled(button)
    );
    if (match) return match;
  }
  return null;
}

async function clickIfPresent(root, patterns) {
  const button = findActionButton(root, patterns);
  if (!button) return false;
  await humanClick(button);
  button.click();
  await wait(randomBetween(400, 800));
  return true;
}

const START_PATTERNS = [/get started/, /start signing/, /review (and|&) sign/, /i agree to (the )?terms/, /continue to sign/];
const CONFIRM_PATTERNS = [
  /^i agree$/,
  /^agree$/,
  /^accept$/,
  /^sign( now)?$/,
  /^continue$/,
  /^ok$/,
  /^done$/,
  /^submit$/,
  /^finish$/
];
const INSERT_PATTERNS = [/^insert$/, /^insert signature$/, /^type$/, /^save$/, /^use signature$/];

function looksLikeSignerUi(root = document) {
  if (signatureTargets(root).length) return true;
  if (signatureCanvas(root)) return true;
  if (findField(root, "name") || findField(root, "address")) return true;
  if (requiredStepButtons(root).length) return true;
  const text = (root.innerText || "").slice(0, 8000);
  return /your name goes here|click to sign|please sign|type your name|complete these steps|\+ add (signature|full name|full address)/i.test(text);
}

function requiredStepButtons(root) {
  const nodes = queryDeep(root, "a, button, [role='button'], [role='link'], div, span, td");
  const matches = nodes.filter((element) => {
    if (!isVisible(element)) return false;
    const text = normalizedText(element);
    return text.length < 40 && /^\+?\s*add (signature|full name|full address)$/i.test(text);
  });
  return matches.filter((element) => !matches.some((other) => other !== element && element.contains(other)));
}

function stepKind(text) {
  if (/signature/i.test(text)) return "signature";
  if (/address/i.test(text)) return "address";
  if (/name/i.test(text)) return "name";
  return "name";
}

async function waitForPopupField(timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const dialog = dialogRoots().slice(-1)[0];
    const scope = dialog || document;
    const field =
      findField(scope, "name") ||
      findField(scope, "address") ||
      queryDeep(scope, "input:not([type='hidden']):not([type='checkbox']):not([type='radio']), textarea, [contenteditable='true']").find(isVisible);
    if (field) return { scope, field };
    if (signatureCanvas(scope)) return { scope, canvas: signatureCanvas(scope) };
    await wait(250);
  }
  return { scope: dialogRoots().slice(-1)[0] || document };
}

async function confirmPopup(scope) {
  await clickIfPresent(scope, INSERT_PATTERNS);
  await clickIfPresent(scope, [/^insert$/, /^ok$/, /^save$/, /^apply$/, /^done$/]);
  await wait(400);
}

async function completeRequiredSteps(root, signerName, signerAddress) {
  let filledName = false;
  let filledAddress = false;
  let drew = false;
  const seen = new Set();

  for (let round = 0; round < 6; round += 1) {
    const buttons = requiredStepButtons(root);
    const next = buttons.find((button) => !seen.has(normalizedText(button)));
    if (!next) break;
    const kind = stepKind(normalizedText(next));
    seen.add(normalizedText(next));
    await humanClick(next);
    next.click();
    await wait(500);
    const popup = await waitForPopupField();
    const value = kind === "address" ? signerAddress : signerName;
    if (kind === "signature") {
      const canvas = popup.canvas || signatureCanvas(popup.scope);
      const typeTab = findActionButton(popup.scope, [/^type$/, /^keyboard$/]);
      if (typeTab) {
        await humanClick(typeTab);
        typeTab.click();
        await wait(300);
      }
      const field = popup.field || findField(popup.scope, "name");
      if (field && signerName) {
        await typeIntoField(field, signerName);
        filledName = true;
      } else if (canvas && signerName) {
        await drawSignature(canvas, signerName);
        drew = true;
      }
    } else if (value) {
      const field = popup.field || findField(popup.scope, kind);
      if (field) {
        await typeIntoField(field, value);
        if (kind === "address") filledAddress = true;
        else filledName = true;
      }
    }
    await confirmPopup(popup.scope);
  }
  return { filledName, filledAddress, drew };
}

async function fillAgreementForm(root, signerName, signerAddress) {
  for (const pattern of START_PATTERNS) {
    await clickIfPresent(root, [pattern]);
  }

  const steps = await completeRequiredSteps(root, signerName, signerAddress);
  let filledName = steps.filledName;
  let filledAddress = steps.filledAddress;
  let drew = steps.drew;

  const nameField = findField(root, "name");
  if (nameField && signerName && (nameField.value || nameField.textContent || "").trim() !== signerName) {
    await typeIntoField(nameField, signerName);
    filledName = true;
  }

  const addressField = findField(root, "address");
  if (addressField && signerAddress && (addressField.value || addressField.textContent || "").trim() !== signerAddress) {
    await typeIntoField(addressField, signerAddress);
    filledAddress = true;
  }

  const boxes = signatureTargets(root);
  for (const box of boxes) {
    const label = normalizedText(box);
    await humanClick(box);
    await wait(500);
    const active = document.activeElement;
    const wantsAddress = /address|street|city/i.test(label) && signerAddress;
    const value = wantsAddress ? signerAddress : signerName;
    if (value && active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) {
      await typeIntoField(active, value);
      if (wantsAddress) filledAddress = true;
      else filledName = true;
    } else if (value) {
      const popup = dialogRoots().pop() || root;
      const field = findField(popup, wantsAddress ? "address" : "name");
      if (field) {
        await typeIntoField(field, value);
        if (wantsAddress) filledAddress = true;
        else filledName = true;
      }
    }
    await clickIfPresent(root, INSERT_PATTERNS);
    const canvas = signatureCanvas(root);
    if (canvas && signerName) {
      await drawSignature(canvas, signerName);
      drew = true;
    }
  }

  const canvas = signatureCanvas(root);
  if (canvas && signerName && !drew) {
    await drawSignature(canvas, signerName);
    drew = true;
  }

  const signed = await clickIfPresent(root, CONFIRM_PATTERNS);
  return { filledName, filledAddress, signed, drew };
}

function nearestSignerRoot(element) {
  let node = element;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    const cls = `${node.className || ""} ${node.id || ""}`;
    if (
      node.getAttribute("role") === "dialog" ||
      node.getAttribute("aria-modal") === "true" ||
      /modal|overlay|hello.?sign|sign-widget/i.test(cls) ||
      (style.position === "fixed" && node.getBoundingClientRect().width > 200 && node.getBoundingClientRect().height > 120)
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return document.body;
}

async function waitForAgreementUi(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (signerIframes().length) return { kind: "iframe", node: signerIframes()[0] };
    const dialogs = dialogRoots();
    if (dialogs.length) {
      const withUi = dialogs.reverse().find((dialog) => looksLikeSignerUi(dialog)) || dialogs[dialogs.length - 1];
      return { kind: "dialog", node: withUi };
    }
    if (looksLikeSignerUi(document)) {
      const box = signatureTargets(document)[0];
      return { kind: "page", node: box ? nearestSignerRoot(box) : document.body };
    }
    const stored = await chrome.storage.local.get(["agreementFrameResult"]);
    if (stored.agreementFrameResult && Date.now() - stored.agreementFrameResult.at < 20000) {
      return { kind: "frame-done", node: null, result: stored.agreementFrameResult };
    }
    await wait(350);
  }
  return null;
}

async function closeAgreementUi(root) {
  if (!root || root === document.body) return;
  const close = findActionButton(root, [/^close$/, /^cancel$/]);
  if (close) {
    await humanClick(close);
    await wait(400);
  }
}

async function setPendingSigner(payload) {
  await chrome.storage.local.set({
    pendingAgreementSign: { ...payload, at: Date.now() },
    agreementFrameResult: null
  });
}

async function clearPendingSigner() {
  await chrome.storage.local.set({ pendingAgreementSign: null });
}

async function waitForFrameSigner(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { agreementFrameResult } = await chrome.storage.local.get(["agreementFrameResult"]);
    if (agreementFrameResult && Date.now() - agreementFrameResult.at < 25000) {
      return agreementFrameResult;
    }
    if (!unsignedAgreementLinks().length && !signerIframes().length && !dialogRoots().length) {
      return { ok: true, note: "banners gone" };
    }
    await wait(400);
  }
  return null;
}

function describeFill(kind, filled) {
  if (!filled) return `${kind}: opened but no form appeared`;
  return `${kind}: ${filled.signed ? "signed" : "filled, confirm on page"}${filled.drew ? ", signature drawn" : ""}${
    filled.filledAddress ? ", address entered" : filled.filledName ? ", name entered" : ""
  }`;
}

async function signAgreements({ signerName, signerAddress, enabled }) {
  if (!enabled) return "skipped";
  const links = unsignedAgreementLinks();
  if (!links.length) {
    if (looksLikeSignerUi(document) || signerIframes().length) {
      await setPendingSigner({ signerName, signerAddress });
      const filled = looksLikeSignerUi(document) ? await fillAgreementForm(document, signerName, signerAddress) : null;
      const frame = await waitForFrameSigner(18000);
      await clearPendingSigner();
      if (filled?.signed || filled?.filledName) return describeFill("agreement", filled);
      if (frame) return `agreement: ${frame.note || "signed in embedded window"}`;
    }
    return "none required";
  }
  if (!signerName) return "needed: fill Full legal name in the side panel";

  const results = [];
  for (const link of links) {
    const kind = agreementKindOf(normalizedText(link)) || normalizedText(link).slice(0, 24);
    await setPendingSigner({ signerName, signerAddress, kind });
    await humanClick(link);
    const ui = await waitForAgreementUi();
    if (!ui) {
      results.push(`${kind}: opened but no form appeared`);
      continue;
    }
    let filled = null;
    if (ui.kind === "iframe" || ui.kind === "frame-done") {
      const frame = ui.result || (await waitForFrameSigner(18000));
      results.push(frame ? `${kind}: ${frame.note || "signed in embedded window"}` : `${kind}: sign window opened, waiting for fields`);
    } else {
      filled = await fillAgreementForm(ui.node, signerName, signerAddress);
      await wait(600);
      if (dialogRoots().includes(ui.node) && isVisible(ui.node) && !filled.signed) {
        await closeAgreementUi(ui.node);
      }
      results.push(describeFill(kind, filled));
    }
    await wait(500);
  }
  await clearPendingSigner();
  return results.join("; ") || "none required";
}

async function fillEmbeddedAgreement(signerName, signerAddress) {
  const start = Date.now();
  while (Date.now() - start < 8000 && !looksLikeSignerUi(document)) {
    await clickIfPresent(document, START_PATTERNS);
    await wait(400);
  }
  if (!looksLikeSignerUi(document)) {
    return { ok: false, note: "no sign fields in this frame" };
  }
  const filled = await fillAgreementForm(document, signerName, signerAddress);
  const note = describeFill("embedded", filled);
  await chrome.storage.local.set({ agreementFrameResult: { ok: Boolean(filled.signed || filled.filledName || filled.drew), note, at: Date.now() } });
  return { ok: true, note, ...filled };
}

let embedWatching = false;
let embedBusy = false;
async function watchEmbeddedSigner() {
  if (IS_TOP || embedWatching) return;
  embedWatching = true;
  setInterval(async () => {
    if (embedBusy || !looksLikeSignerUi(document)) return;
    const stored = await chrome.storage.local.get(["pendingAgreementSign", "agreementFrameResult"]);
    if (stored.agreementFrameResult && Date.now() - stored.agreementFrameResult.at < 20000) return;
    if (!stored.pendingAgreementSign || Date.now() - stored.pendingAgreementSign.at > 60000) return;
    embedBusy = true;
    try {
      await fillEmbeddedAgreement(stored.pendingAgreementSign.signerName, stored.pendingAgreementSign.signerAddress);
    } catch (error) {
      await chrome.storage.local.set({
        agreementFrameResult: { ok: false, note: error.message, at: Date.now() }
      });
    }
    embedBusy = false;
  }, 1200);
}

watchEmbeddedSigner();

function fieldContext(element) {
  const bits = [
    element.getAttribute("name"),
    element.id,
    element.getAttribute("placeholder"),
    element.getAttribute("aria-label"),
    element.getAttribute("data-testid")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  let nearby = bits;
  let node = element;
  for (let i = 0; i < 5 && node && node !== document.body; i += 1, node = node.parentElement) {
    const tag = node.tagName || "";
    if (/^H[1-6]$/.test(tag) || tag === "LABEL" || tag === "LEGEND") nearby += " " + normalizedText(node);
    let sibling = node.previousElementSibling;
    while (sibling) {
      if (/^H[1-6]$/.test(sibling.tagName) || sibling.tagName === "LABEL" || sibling.tagName === "LEGEND") {
        nearby += " " + normalizedText(sibling).slice(0, 180);
        break;
      }
      sibling = sibling.previousElementSibling;
    }
  }
  return nearby.replace(/\s+/g, " ");
}

function findBidInput() {
  const listed = [];
  for (const selector of BID_INPUT_SELECTORS) {
    try {
      listed.push(...document.querySelectorAll(selector));
    } catch (_error) {
      // invalid selector in older engines
    }
  }
  const extra = typeof queryDeep === "function" ? queryDeep(document, "textarea, [contenteditable='true']") : [];
  const fields = [...new Set([...listed, ...extra])].filter((element) => {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
  let best = null;
  let bestScore = -Infinity;
  for (const element of fields) {
    const ctx = fieldContext(element);
    let score = 0;
    if (NOT_BID_CONTEXT.test(ctx)) score -= 80;
    if (/\b(question|comment|message|chat)\b/.test(ctx) && !BID_CONTEXT.test(ctx)) score -= 25;
    if (BID_CONTEXT.test(ctx)) score += 50;
    if (/\b(proposal|bid description|write my bid)\b/.test(ctx)) score += 20;
    const form = element.closest("form") || element.parentElement;
    const formText = normalizedText(form || element).slice(0, 800);
    if (/\bplace bid\b/.test(formText)) score += 25;
    if (/\bcancel\b/.test(formText) && /\bpost\b/.test(formText) && !/\bplace bid\b/.test(formText)) score -= 40;
    if (element.matches("textarea[name='description'], textarea[id*='proposal'], textarea[id*='description']")) score += 10;
    if (score > bestScore) {
      best = element;
      bestScore = score;
    }
  }
  if (best && !NOT_BID_CONTEXT.test(fieldContext(best))) return best;
  return fields.find((element) => !NOT_BID_CONTEXT.test(fieldContext(element))) || null;
}

async function waitForBidInput(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const field = findBidInput();
    if (field) return field;
    await wait(300);
  }
  return null;
}

function detectNda() {
  const links = unsignedAgreementLinks();
  const text = (document.body?.innerText || "").slice(0, 20000);
  const banner = /you must sign/i.test(text) && /(non[-\s]?disclosure|\bnda\b|ip agreement|intellectual property)/i.test(text);
  const kinds = [
    ...new Set(
      links
        .map((link) => agreementKindOf(normalizedText(link)))
        .filter(Boolean)
    )
  ];
  if (banner && !kinds.length) kinds.push("nda");
  return { nda: links.length > 0 || banner, kinds };
}

async function fillBid({ draft, autoSubmit, humanTyping, typingSpeed, sealedBid, signAgreements: shouldSign, signerName, signerAddress }) {
  if (!draft) {
    throw new Error("No draft text to fill.");
  }
  const agreements =
    shouldSign === false
      ? "skipped"
      : await signAgreements({
          enabled: true,
          signerName: (signerName || "").trim(),
          signerAddress: (signerAddress || "").trim()
        });
  if (agreements.startsWith("needed:")) {
    throw new Error(agreements);
  }

  const bidInput = await waitForBidInput();
  if (!bidInput) {
    throw new Error("Could not find the bid proposal field (skipped Clarification Board).");
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
    return { submitClicked: false, submitFound: Boolean(submitButton), submitTarget: describeElement(submitButton), sealed, registered, agreements };
  }
  if (!submitButton) {
    throw new Error("Bid typed, but the Place Bid button was not found on the page.");
  }
  if (isDisabled(submitButton)) {
    throw new Error("Bid typed, but the Place Bid button is disabled. Check the amount and other required fields.");
  }
  await wait(randomBetween(700, 1800));
  const submit = await pressSubmit(submitButton, bidInput, draft);
  return { submitClicked: true, submitFound: true, sealed, registered, agreements, ...submit };
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
  if (!findBidInput()) return "bid form gone";
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
  if (!IS_TOP && (message?.type === "EXTRACT_PROJECT" || message?.type === "FILL_BID" || message?.type === "DETECT_NDA" || message?.type === "SIGN_AGREEMENTS")) {
    return false;
  }
  const handlers = {
    EXTRACT_PROJECT: async () => ({ project: await extractWhenReady() }),
    DETECT_NDA: async () => detectNda(),
    SIGN_AGREEMENTS: () =>
      signAgreements({
        enabled: true,
        signerName: (message.signerName || "").trim(),
        signerAddress: (message.signerAddress || "").trim()
      }).then((agreements) => ({ agreements })),
    FILL_BID: () => fillBid(message),
    FILL_AGREEMENT: () =>
      fillEmbeddedAgreement(message.signerName || "", message.signerAddress || "")
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
