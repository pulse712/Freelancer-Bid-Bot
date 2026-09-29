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

function dialogRoots() {
  return visibleDeep(
    "[role='dialog'], [aria-modal='true'], .modal, [class*='Modal'], [class*='modal'], [class*='overlay'], [class*='Overlay'], [class*='dialog'], [class*='Dialog'], [class*='popup'], [class*='Popup']"
  ).filter((element) => element.getBoundingClientRect().width > 180);
}

function signerIframes() {
  const frames = visibleDeep("iframe").filter((frame) => {
    const rect = frame.getBoundingClientRect();
    return rect.width > 200 && rect.height > 120;
  });
  const bySrc = frames.filter((frame) => {
    const src = `${frame.src || ""} ${frame.getAttribute("name") || ""} ${frame.className || ""}`.toLowerCase();
    return /hellosign|dropboxsign|hs-embed|embeddedsigning|app\.hellosign|embedded\.hellosign/i.test(src);
  });
  if (bySrc.length) return bySrc;
  const inDialog = frames.filter((frame) => {
    const rect = frame.getBoundingClientRect();
    return rect.width > 360 && rect.height > 240 && Boolean(frame.closest("[role='dialog'], [aria-modal='true'], .modal, [class*='Modal'], [class*='overlay']"));
  });
  return inDialog;
}

function mustSignBanner(element) {
  const text = normalizedText(element);
  return text.length > 0 && text.length < 900 && /you must sign|please sign the freelancer|before you can (place a )?bid|to work on this project/i.test(text);
}

function isAgreementEntryLink(element) {
  const text = normalizedText(element);
  if (!text || text.length > 55) return false;
  return (
    /^(the )?(non[-\s]?disclosure agreement|nda)$/i.test(text) ||
    /^(the )?(ip agreement|intellectual property agreement)$/i.test(text) ||
    Boolean(agreementKindOf(text) && text.length < 40)
  );
}

function findAgreementEntryLinks() {
  const banners = [];
  for (const doc of sameOriginFrames()) {
    const candidates = queryDeep(
      doc,
      "a, button, p, div, span, section, aside, li, article, [class*='alert'], [class*='banner'], [class*='notice'], [class*='warning']"
    );
    for (const element of candidates) {
      if (isVisible(element) && mustSignBanner(element)) banners.push(element);
    }
  }

  const found = [];
  const consider = (scope) => {
    const inner = queryDeep(scope, "a, button, [role='link'], [role='button']").filter((element) => isVisible(element) && isAgreementEntryLink(element));
    inner.sort((a, b) => normalizedText(a).length - normalizedText(b).length);
    found.push(...inner);
  };

  for (const banner of banners) {
    let scope = banner;
    for (let depth = 0; depth < 6 && scope; depth += 1) {
      const before = found.length;
      consider(scope);
      if (found.length > before) break;
      scope = scope.parentElement;
    }
  }

  if (!found.length) {
    found.push(
      ...visibleDeep("a, button, [role='link'], [role='button']").filter((element) => isAgreementEntryLink(element))
    );
  }

  const unique = [];
  const seen = new Set();
  for (const link of found) {
    const kind = agreementKindOf(normalizedText(link)) || normalizedText(link);
    if (seen.has(kind)) continue;
    seen.add(kind);
    unique.push(link);
  }
  unique.sort((a, b) => {
    const order = { nda: 0, ip: 1 };
    return (order[agreementKindOf(normalizedText(a))] ?? 2) - (order[agreementKindOf(normalizedText(b))] ?? 2);
  });
  return unique;
}

function unsignedAgreementLinks() {
  return findAgreementEntryLinks();
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
  return largestDrawCanvas(root);
}

function largestDrawCanvas(root) {
  const canvases = queryDeep(root, "canvas")
    .filter((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return isVisible(canvas) && rect.width >= 80 && rect.height >= 28;
    })
    .sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    });
  return canvases[0] || null;
}

function signatureDrawHint(root) {
  return queryDeep(root, "h1, h2, h3, h4, div, span, p, legend, label, strong").find((element) => {
    if (!isVisible(element)) return false;
    const text = normalizedText(element);
    return text.length < 90 && /add your signature|draw your signature|use your mouse to draw/i.test(text);
  });
}

function signatureModalRoot() {
  for (const doc of sameOriginFrames()) {
    const hint = signatureDrawHint(doc);
    if (hint) return nearestSignerRoot(hint);
  }
  const dialogs = dialogRoots();
  for (const dialog of [...dialogs].reverse()) {
    const text = `${dialog.innerText || ""}`.slice(0, 2500);
    if (/add your signature|draw your signature|use your mouse to draw/i.test(text)) return dialog;
  }
  return null;
}

function findDrawSurface(scope) {
  const canvas = largestDrawCanvas(scope);
  if (canvas) return canvas;
  const boxes = queryDeep(scope, "div, section, span").filter((element) => {
    if (!isVisible(element)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 180 || rect.height < 48 || rect.height > 320) return false;
    const bg = getComputedStyle(element).backgroundColor;
    const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return false;
    const [, r, g, b] = match.map(Number);
    return r > 220 && g > 220 && b > 220;
  });
  boxes.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return rb.width * rb.height - ra.width * ra.height;
  });
  return boxes[0] || null;
}

function findSignaturePad() {
  for (const doc of sameOriginFrames()) {
    const hint = signatureDrawHint(doc);
    if (!hint) continue;
    const scope = nearestSignerRoot(hint);
    const canvas = findDrawSurface(scope) || findDrawSurface(doc.body || doc);
    if (canvas) return { scope, canvas };
  }
  const scope = signatureModalRoot();
  if (scope) {
    const canvas = findDrawSurface(scope);
    if (canvas) return { scope, canvas };
  }
  return null;
}

async function waitForSignatureModal(timeoutMs = 16000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pad = findSignaturePad();
    if (pad?.canvas) return pad;
    await wait(250);
  }
  return null;
}

function fireCanvasPointer(canvas, type, x, y, extra = {}) {
  const rect = canvas.getBoundingClientRect();
  const clientX = rect.left + x;
  const clientY = rect.top + y;
  const buttons = extra.buttons ?? (type === "mouseup" ? 0 : 1);
  const init = mouseEventInit(clientX, clientY, {
    buttons,
    pageX: clientX + window.scrollX,
    pageY: clientY + window.scrollY,
    movementX: extra.movementX || 0,
    movementY: extra.movementY || 0
  });
  const pointerInit = {
    ...init,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    pressure: buttons ? 0.65 : 0,
    width: 2.5,
    height: 2.5
  };
  const pointerType = type.replace("mouse", "pointer");
  const hit = document.elementFromPoint(clientX, clientY) || canvas;
  const targets = [canvas, hit, document, window];
  for (const target of targets) {
    if (!target || typeof target.dispatchEvent !== "function") continue;
    target.dispatchEvent(new PointerEvent(pointerType, pointerInit));
    target.dispatchEvent(new MouseEvent(type, init));
  }
  if (type === "mousedown") {
    try {
      canvas.setPointerCapture(1);
    } catch (_error) {
      // not all canvases allow capture on synthetic pointers
    }
  }
  if (type === "mouseup") {
    try {
      canvas.releasePointerCapture(1);
    } catch (_error) {
      // already released
    }
  }
}

function canvasBitmapPoint(canvas, cssX, cssY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = (canvas.width || rect.width) / (rect.width || 1);
  const scaleY = (canvas.height || rect.height) / (rect.height || 1);
  return { x: cssX * scaleX, y: cssY * scaleY };
}

function paintInk(canvas, points) {
  if (!points.length || typeof canvas.getContext !== "function") return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  ctx.save();
  ctx.strokeStyle = "#111111";
  ctx.fillStyle = "#111111";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2.8, ((canvas.height || rect.height) / rect.height) * 2.6);
  ctx.beginPath();
  const first = canvasBitmapPoint(canvas, points[0].x, points[0].y);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i += 1) {
    const prev = canvasBitmapPoint(canvas, points[i - 1].x, points[i - 1].y);
    const cur = canvasBitmapPoint(canvas, points[i].x, points[i].y);
    const mid = { x: (prev.x + cur.x) / 2, y: (prev.y + cur.y) / 2 };
    ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y);
  }
  const last = canvasBitmapPoint(canvas, points[points.length - 1].x, points[points.length - 1].y);
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();
}

function parseGlyph(char) {
  const raw = HAND_GLYPHS[char] || HAND_GLYPHS[char.toLowerCase()];
  if (!raw) return null;
  return raw.map((stroke) => {
    const nums = stroke.trim().split(/\s+/).map(Number);
    const points = [];
    for (let i = 0; i < nums.length; i += 2) points.push({ x: nums[i], y: nums[i + 1] });
    return points;
  });
}

function interpolatePoints(points, spacing) {
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    const cur = points[i];
    if (!out.length) {
      out.push(cur);
      continue;
    }
    const prev = out[out.length - 1];
    const dist = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const steps = Math.max(1, Math.ceil(dist / spacing));
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      out.push({ x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t });
    }
  }
  return out;
}

function handwrittenStrokes(name, width, height) {
  const text = String(name || "Sign").replace(/[^A-Za-z ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 18) || "Sign";
  const letters = [...text];
  const usable = width * 0.9;
  const cell = Math.min(usable / Math.max(letters.length, 1), height * 0.85);
  let x = width * 0.05;
  const base = height * 0.08;
  const strokeH = height * 0.72;
  const italic = cell * 0.28;
  const connected = [];

  for (const char of letters) {
    if (char === " ") {
      x += cell * 0.4;
      continue;
    }
    const glyph = parseGlyph(char) || parseGlyph("n");
    const tall = char === char.toUpperCase() && char !== char.toLowerCase();
    const gy = tall ? base : base + strokeH * 0.16;
    const gh = tall ? strokeH : strokeH * 0.78;
    const mapped = glyph.flat().map((pt) => ({
      x: x + pt.x * cell * 0.92 + (1 - pt.y) * italic + randomBetween(-0.4, 0.4),
      y: gy + pt.y * gh + randomBetween(-0.5, 0.5)
    }));
    if (connected.length && mapped.length) {
      const from = connected[connected.length - 1];
      connected.push(...interpolatePoints([from, mapped[0]], 2));
    }
    connected.push(...mapped);
    x += cell * (char === "i" || char === "l" || char === "t" ? 0.55 : 0.78);
  }

  return [interpolatePoints(connected, 1.4)];
}

function clampPad(x, y, width, height) {
  return {
    x: Math.max(4, Math.min(width - 4, x)),
    y: Math.max(4, Math.min(height - 4, y))
  };
}

async function drawSignature(canvas, name) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(40, rect.width);
  const height = Math.max(24, rect.height);
  const strokes = handwrittenStrokes(name, width, height);
  await movePointerTo(canvas);
  await wait(180);

  for (const stroke of strokes) {
    if (stroke.length < 2) continue;
    const points = stroke.map((pt) => clampPad(pt.x, pt.y, width, height));
    paintInk(canvas, points);
    const first = points[0];
    fireCanvasPointer(canvas, "mousedown", first.x, first.y, { buttons: 1 });
    placePointer(rect.left + first.x, rect.top + first.y);
    await wait(16);
    let prev = first;
    for (let i = 1; i < points.length; i += 1) {
      const pt = points[i];
      fireCanvasPointer(canvas, "mousemove", pt.x, pt.y, {
        buttons: 1,
        movementX: pt.x - prev.x,
        movementY: pt.y - prev.y
      });
      placePointer(rect.left + pt.x, rect.top + pt.y);
      prev = pt;
      if (i % 3 === 0) await wait(8);
    }
    const last = points[points.length - 1];
    fireCanvasPointer(canvas, "mouseup", last.x, last.y, { buttons: 0 });
    paintInk(canvas, points);
    await wait(50);
  }
  schedulePointerHide();
}

// Compact cursive-ish strokes in a 0..1 letter cell (y grows downward).
const HAND_GLYPHS = {
  a: ["0.78 0.46 0.58 0.36 0.28 0.42 0.16 0.62 0.28 0.84 0.58 0.84 0.80 0.62 0.72 0.46 0.86 0.84"],
  b: ["0.20 0.06 0.22 0.84 0.22 0.46 0.52 0.34 0.80 0.50 0.74 0.80 0.42 0.90 0.22 0.70"],
  c: ["0.82 0.48 0.62 0.36 0.30 0.40 0.16 0.62 0.30 0.84 0.64 0.86 0.84 0.74"],
  d: ["0.78 0.08 0.78 0.84 0.78 0.46 0.52 0.34 0.22 0.48 0.16 0.70 0.34 0.86 0.62 0.84 0.80 0.68"],
  e: ["0.18 0.62 0.72 0.58 0.78 0.44 0.58 0.34 0.28 0.42 0.16 0.64 0.30 0.84 0.62 0.86 0.82 0.74"],
  f: ["0.70 0.10 0.48 0.06 0.32 0.18 0.32 0.88 0.22 0.42 0.58 0.42"],
  g: ["0.78 0.42 0.58 0.34 0.28 0.42 0.18 0.62 0.30 0.80 0.58 0.80 0.78 0.62 0.78 0.42 0.78 0.80 0.70 1.12 0.42 1.18 0.22 1.04"],
  h: ["0.20 0.06 0.22 0.84 0.24 0.50 0.52 0.36 0.78 0.50 0.80 0.84"],
  i: ["0.42 0.18 0.44 0.10", "0.36 0.40 0.40 0.84 0.58 0.84"],
  j: ["0.58 0.16 0.60 0.08", "0.50 0.40 0.56 0.88 0.48 1.14 0.24 1.16 0.14 1.00"],
  k: ["0.22 0.06 0.22 0.84", "0.70 0.36 0.24 0.58 0.78 0.86"],
  l: ["0.38 0.06 0.32 0.84 0.50 0.86"],
  m: ["0.10 0.84 0.14 0.42 0.30 0.36 0.42 0.52 0.44 0.84 0.46 0.48 0.64 0.34 0.78 0.52 0.80 0.84"],
  n: ["0.16 0.84 0.20 0.42 0.40 0.34 0.62 0.48 0.66 0.84"],
  o: ["0.50 0.36 0.22 0.46 0.14 0.66 0.32 0.86 0.66 0.82 0.84 0.62 0.72 0.40 0.50 0.36"],
  p: ["0.22 0.36 0.20 1.16 0.22 0.48 0.50 0.34 0.78 0.48 0.70 0.76 0.40 0.84 0.22 0.68"],
  q: ["0.76 0.42 0.56 0.34 0.26 0.44 0.16 0.64 0.30 0.82 0.58 0.80 0.76 0.62 0.76 0.42 0.78 1.16 0.92 1.08"],
  r: ["0.20 0.84 0.24 0.44 0.46 0.36 0.72 0.46"],
  s: ["0.76 0.44 0.56 0.32 0.28 0.40 0.34 0.56 0.64 0.62 0.74 0.78 0.48 0.90 0.18 0.80"],
  t: ["0.40 0.08 0.38 0.80 0.52 0.86 0.68 0.78", "0.22 0.36 0.62 0.36"],
  u: ["0.16 0.38 0.20 0.76 0.40 0.86 0.64 0.76 0.70 0.38 0.74 0.84"],
  v: ["0.12 0.38 0.40 0.84 0.78 0.38"],
  w: ["0.08 0.38 0.22 0.84 0.42 0.50 0.62 0.84 0.86 0.38"],
  x: ["0.16 0.38 0.78 0.86", "0.78 0.38 0.16 0.86"],
  y: ["0.14 0.38 0.40 0.84 0.74 0.38 0.62 0.90 0.42 1.16 0.18 1.08"],
  z: ["0.18 0.38 0.78 0.38 0.20 0.84 0.80 0.84"],
  A: ["0.10 0.86 0.48 0.10 0.86 0.86", "0.30 0.58 0.68 0.58"],
  B: ["0.20 0.08 0.20 0.86 0.20 0.08 0.62 0.12 0.74 0.28 0.58 0.46 0.20 0.46 0.66 0.50 0.82 0.68 0.64 0.88 0.20 0.86"],
  C: ["0.82 0.22 0.50 0.08 0.20 0.28 0.14 0.50 0.24 0.78 0.56 0.92 0.84 0.76"],
  D: ["0.20 0.08 0.20 0.86 0.20 0.08 0.58 0.12 0.84 0.36 0.84 0.62 0.58 0.88 0.20 0.86"],
  E: ["0.76 0.10 0.22 0.10 0.22 0.86 0.78 0.86", "0.22 0.48 0.62 0.48"],
  F: ["0.22 0.86 0.22 0.10 0.78 0.10", "0.22 0.48 0.60 0.48"],
  G: ["0.82 0.24 0.52 0.08 0.22 0.28 0.14 0.52 0.26 0.80 0.58 0.92 0.86 0.70 0.86 0.54 0.56 0.54"],
  H: ["0.20 0.08 0.20 0.86", "0.78 0.08 0.78 0.86", "0.20 0.48 0.78 0.48"],
  I: ["0.28 0.10 0.70 0.10", "0.50 0.10 0.50 0.86", "0.28 0.86 0.70 0.86"],
  J: ["0.30 0.10 0.78 0.10", "0.62 0.10 0.62 0.74 0.46 0.90 0.22 0.80"],
  K: ["0.22 0.08 0.22 0.86", "0.78 0.10 0.24 0.48 0.82 0.86"],
  L: ["0.24 0.08 0.24 0.86 0.80 0.86"],
  M: ["0.10 0.86 0.14 0.10 0.48 0.58 0.82 0.10 0.88 0.86"],
  N: ["0.18 0.86 0.18 0.10 0.80 0.86 0.80 0.10"],
  O: ["0.50 0.08 0.20 0.22 0.10 0.50 0.22 0.80 0.50 0.92 0.80 0.78 0.90 0.48 0.78 0.20 0.50 0.08"],
  P: ["0.22 0.86 0.22 0.08 0.62 0.08 0.80 0.24 0.70 0.46 0.22 0.48"],
  Q: ["0.50 0.08 0.20 0.22 0.10 0.50 0.22 0.80 0.50 0.92 0.80 0.78 0.90 0.48 0.78 0.20 0.50 0.08", "0.56 0.68 0.86 0.94"],
  R: ["0.22 0.86 0.22 0.08 0.62 0.08 0.80 0.24 0.68 0.46 0.22 0.48 0.50 0.50 0.82 0.86"],
  S: ["0.78 0.22 0.52 0.08 0.22 0.20 0.28 0.40 0.62 0.50 0.80 0.68 0.58 0.92 0.22 0.80"],
  T: ["0.14 0.10 0.86 0.10", "0.50 0.10 0.50 0.86"],
  U: ["0.16 0.10 0.18 0.68 0.36 0.88 0.64 0.88 0.82 0.68 0.84 0.10"],
  V: ["0.10 0.10 0.48 0.86 0.88 0.10"],
  W: ["0.06 0.10 0.26 0.86 0.48 0.36 0.70 0.86 0.92 0.10"],
  X: ["0.14 0.10 0.84 0.86", "0.84 0.10 0.14 0.86"],
  Y: ["0.12 0.10 0.50 0.48 0.88 0.10", "0.50 0.48 0.50 0.86"],
  Z: ["0.16 0.10 0.84 0.10 0.16 0.86 0.86 0.86"]
};

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
  /^submit document$/,
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
const INSERT_PATTERNS = [/^insert$/, /^insert signature$/, /^save$/, /^use signature$/, /^add full name$/, /^add full address$/];
const ADD_SIGNATURE_CONFIRM = [/^add signature$/, /^insert signature$/, /^insert$/, /^save$/, /^use signature$/];

function looksLikeHelloSignSteps(root = document) {
  if (requiredStepButtons(root).length) return true;
  if (findChecklistButton(root, "signature")) return true;
  const text = (root.innerText || "").slice(0, 8000);
  return /complete these steps|\+ add (signature|full name|full address)|add your signature|use your mouse to draw/i.test(text);
}

function looksLikeSignerUi(root = document) {
  if (looksLikeHelloSignSteps(root)) return true;
  if (signatureTargets(root).length) return true;
  if (signatureCanvas(root)) return true;
  return false;
}

function stepButtonPatterns(kind) {
  if (kind === "signature") return [/^\+\s*add signature$/, /^add signature$/];
  if (kind === "name") return [/^\+\s*add full name$/, /^add full name$/, /^full name$/];
  return [/^\+\s*add full address$/, /^add full address$/, /^full address$/];
}

function findChecklistButton(root, kind, preferPlus = true) {
  const patterns = stepButtonPatterns(kind);
  const scopes =
    !root || root === document || root === document.documentElement || root === document.body
      ? sameOriginFrames()
      : [root];
  const nodes = scopes
    .flatMap((scope) => queryDeep(scope, "a, button, [role='button'], [role='link'], div, span"))
    .filter((element) => {
    if (!isVisible(element)) return false;
    const text = normalizedText(element);
    if (text.length >= 40) return false;
    if (!patterns.some((pattern) => pattern.test(text))) return false;
    const around = `${element.closest("[role='dialog'], [aria-modal='true']")?.innerText || ""}`.slice(0, 800);
    if (kind === "signature" && /add your signature|draw your signature|use your mouse to draw/i.test(around) && /^add signature$/.test(text)) {
      return false;
    }
    return true;
  });
  const unique = nodes.filter((element) => !nodes.some((other) => other !== element && element.contains(other)));
  const plus = unique.find((element) => normalizedText(element).startsWith("+"));
  const plain = unique.find((element) => !normalizedText(element).startsWith("+"));
  if (preferPlus) return plus || plain || unique[0] || null;
  return plain || plus || unique[0] || null;
}

function requiredStepButtons(root) {
  return ["signature", "name", "address"].map((kind) => findChecklistButton(root, kind)).filter(Boolean);
}

function isEditableNode(element) {
  if (!element || !element.isConnected) return false;
  if (element.isContentEditable) return true;
  if (element.tagName === "TEXTAREA") return true;
  if (element.tagName !== "INPUT") return false;
  const type = (element.type || "text").toLowerCase();
  return !["hidden", "checkbox", "radio", "submit", "button", "file", "image"].includes(type);
}

function findYellowPlaceholder(root, kind) {
  const hint =
    kind === "address"
      ? /your full address goes here|full address goes here|address goes here/i
      : /your (full )?name goes here|name goes here|click to type your name/i;
  const labeled = queryDeep(root, "div, span, p, label, td, [role='tooltip'], [class*='tip'], [class*='Tip']").filter(
    (element) => isVisible(element) && hint.test(normalizedText(element)) && normalizedText(element).length < 90
  );
  for (const label of labeled) {
    const parent = label.parentElement;
    const nearby = [label.previousElementSibling, label.nextElementSibling, parent, parent?.previousElementSibling, ...(parent ? [...parent.children] : [])].filter(
      Boolean
    );
    const yellow = nearby.find((element) => isYellowish(element) && element.getBoundingClientRect().width >= 80);
    if (yellow) return yellow;
    const box = nearby.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width >= 100 && rect.height >= 28 && rect.height < 280 && element !== label;
    });
    if (box) return box;
    return label;
  }
  const yellows = queryDeep(root, "div, span, td, canvas, [class*='field'], [class*='Field']").filter((element) => {
    if (!isVisible(element) || !isYellowish(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 80 && rect.height >= 24 && rect.height < 280;
  });
  return yellows[0] || null;
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

async function confirmSignatureModal(scope) {
  const button = findActionButton(scope, ADD_SIGNATURE_CONFIRM);
  if (!button) return false;
  await humanClick(button);
  button.click();
  await wait(700);
  return true;
}

async function typeIntoAny(element, value) {
  if (!element || !value) return false;
  await humanClick(element);
  element.click();
  await wait(350);
  const start = Date.now();
  while (Date.now() - start < 2500) {
    const active = document.activeElement;
    const field =
      (isEditableNode(active) && active) ||
      queryDeep(document, "input:not([type='hidden']):not([type='checkbox']):not([type='radio']), textarea, [contenteditable='true']").find(
        (candidate) => isVisible(candidate) && isEditableNode(candidate)
      );
    if (field) {
      if (field.tagName === "INPUT" || field.tagName === "TEXTAREA") await typeIntoField(field, value);
      else await typeLikeHuman(field, value, "3");
      return true;
    }
    await wait(200);
  }
  if (element.isContentEditable) {
    await typeLikeHuman(element, value, "3");
    return true;
  }
  return false;
}

async function waitForTypedEditor(root, kind, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const dialog = dialogRoots().slice(-1)[0];
    const scope = dialog || root;
    const field =
      findField(scope, kind) ||
      queryDeep(scope, "input:not([type='hidden']):not([type='checkbox']):not([type='radio']), textarea, [contenteditable='true']").find(
        (element) => isVisible(element) && isEditableNode(element)
      );
    if (field) return { scope, field };
    if (isEditableNode(document.activeElement)) return { scope, field: document.activeElement };
    const yellow = findYellowPlaceholder(root, kind);
    if (yellow) return { scope: root, field: yellow };
    await wait(200);
  }
  return { scope: root };
}

async function clickChecklistButton(root, kind, preferPlus = true) {
  const button = findChecklistButton(root, kind, preferPlus);
  if (!button) return false;
  await humanClick(button);
  await wait(900);
  return true;
}

async function fillNameOrAddressStep(root, kind, value) {
  const opened = await clickChecklistButton(root, kind, true);
  if (!opened) return false;
  const editor = await waitForTypedEditor(root, kind, 6000);
  if (value && editor.field) await typeIntoAny(editor.field, value);
  await wait(400);
  const again = findChecklistButton(root, kind, false);
  if (again) {
    await humanClick(again);
    again.click();
    await wait(600);
  } else {
    await confirmPopup(editor.scope || root);
  }
  return Boolean(value && editor.field);
}

async function clickSubmitDocument(root, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const buttons = queryDeep(root, "button, [role='button'], a, input[type='submit'], input[type='button'], div").filter((element) => {
      if (!isVisible(element)) return false;
      const text = normalizedText(element);
      return text.length < 40 && /^submit( document)?$/.test(text);
    });
    const unique = buttons.filter((element) => !buttons.some((other) => other !== element && element.contains(other)));
    const enabled =
      unique.find((element) => !isDisabled(element) && /^submit document$/.test(normalizedText(element))) ||
      unique.find((element) => !isDisabled(element));
    if (enabled) {
      await humanClick(enabled);
      enabled.click();
      await wait(900);
      return true;
    }
    await wait(400);
  }
  return false;
}

async function completeRequiredSteps(root, signerName, signerAddress) {
  let filledName = false;
  let filledAddress = false;
  let drew = false;

  let pad = findSignaturePad();
  if (!pad?.canvas && findChecklistButton(root, "signature")) {
    await clickChecklistButton(root, "signature", true);
    pad = await waitForSignatureModal(16000);
  }
  if (!pad?.canvas && findChecklistButton(root, "signature")) {
    await clickChecklistButton(root, "signature", true);
    pad = await waitForSignatureModal(8000);
  }
  if (pad?.canvas && signerName) {
    await drawSignature(pad.canvas, signerName);
    drew = true;
    await confirmSignatureModal(pad.scope);
    await wait(700);
  }

  if (findChecklistButton(root, "name")) {
    await clickChecklistButton(root, "name", true);
    filledName = true;
    await wait(700);
  }

  if (signerAddress && findChecklistButton(root, "address")) {
    filledAddress = await fillNameOrAddressStep(root, "address", signerAddress);
  }

  const signed = await clickSubmitDocument(root);
  return { filledName, filledAddress, drew, signed };
}

async function fillAgreementForm(root, signerName, signerAddress) {
  for (const pattern of START_PATTERNS) {
    await clickIfPresent(root, [pattern]);
  }

  const steps = await completeRequiredSteps(root, signerName, signerAddress);
  let filledName = steps.filledName;
  let filledAddress = steps.filledAddress;
  let drew = steps.drew;
  let signed = steps.signed;

  if (!filledName) {
    filledName = Boolean(findChecklistButton(root, "name") === null && drew);
  }

  if (!filledAddress) {
    const addressField = findField(root, "address");
    if (addressField && signerAddress && (addressField.value || addressField.textContent || "").trim() !== signerAddress) {
      await typeIntoField(addressField, signerAddress);
      filledAddress = true;
    }
  }

  if (!signed) signed = await clickSubmitDocument(root);
  if (!signed) signed = await clickIfPresent(root, CONFIRM_PATTERNS);
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

async function waitForAgreementUi(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (signerIframes().length) return { kind: "iframe", node: signerIframes()[0] };
    if (looksLikeHelloSignSteps(document)) {
      const box = signatureTargets(document)[0];
      return { kind: "page", node: box ? nearestSignerRoot(box) : document.body };
    }
    const stored = await chrome.storage.local.get(["agreementFrameResult"]);
    if (stored.agreementFrameResult && Date.now() - stored.agreementFrameResult.at < 25000) {
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

async function fillSignerPage(signerName, signerAddress) {
  await setPendingSigner({ signerName, signerAddress });
  const start = Date.now();
  while (Date.now() - start < 22000) {
    if (looksLikeHelloSignSteps(document) || looksLikeSignerUi(document)) {
      const filled = await fillAgreementForm(document, signerName, signerAddress);
      const note = describeFill("nda-tab", filled);
      await chrome.storage.local.set({
        agreementFrameResult: { ok: Boolean(filled.signed || filled.drew || filled.filledName), note, at: Date.now() }
      });
      return { agreements: note, ...filled };
    }
    if (signerIframes().length) {
      const frame = await waitForFrameSigner(28000);
      return { agreements: frame?.note || "signed in embedded window", frame };
    }
    await clickIfPresent(document, START_PATTERNS);
    await wait(400);
  }
  throw new Error("Opened the NDA tab, but + Add Signature / Full Name / Address was not found.");
}

async function signAgreements({ signerName, signerAddress, enabled }) {
  if (!enabled) return "skipped";
  if (looksLikeHelloSignSteps(document) || looksLikeSignerUi(document) || signerIframes().length) {
    const filled = await fillSignerPage(signerName, signerAddress);
    return filled.agreements || "signed";
  }
  return "none required";
}

function serializeAgreementLink(link) {
  return {
    kind: agreementKindOf(normalizedText(link)) || "agreement",
    text: normalizedText(link),
    href: link.href || link.getAttribute("href") || "",
    target: link.getAttribute("target") || ""
  };
}

function listAgreements() {
  return findAgreementEntryLinks().map(serializeAgreementLink);
}

async function clickAgreementOnce(kind) {
  const links = findAgreementEntryLinks();
  const link = kind ? links.find((item) => agreementKindOf(normalizedText(item)) === kind) || links[0] : links[0];
  if (!link) return { clicked: false };
  await humanClick(link);
  return { clicked: true, ...serializeAgreementLink(link) };
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
async function tryEmbeddedSigner() {
  if (IS_TOP || embedBusy || !looksLikeHelloSignSteps(document)) return;
  const stored = await chrome.storage.local.get(["pendingAgreementSign", "agreementFrameResult"]);
  if (stored.agreementFrameResult && Date.now() - stored.agreementFrameResult.at < 20000) return;
  if (!stored.pendingAgreementSign || Date.now() - stored.pendingAgreementSign.at > 90000) return;
  embedBusy = true;
  try {
    await fillEmbeddedAgreement(stored.pendingAgreementSign.signerName, stored.pendingAgreementSign.signerAddress);
  } catch (error) {
    await chrome.storage.local.set({
      agreementFrameResult: { ok: false, note: error.message, at: Date.now() }
    });
  }
  embedBusy = false;
}

async function watchEmbeddedSigner() {
  if (IS_TOP || embedWatching) return;
  embedWatching = true;
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.pendingAgreementSign?.newValue) void tryEmbeddedSigner();
  });
  setInterval(() => {
    void tryEmbeddedSigner();
  }, 800);
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
  const text = (document.body?.innerText || "").slice(0, 25000);
  const signerOpen =
    signerIframes().length > 0 ||
    Boolean(findChecklistButton(document, "signature")) ||
    /complete these steps|\+ add signature|add your signature|your name goes here|your full address goes here/i.test(text);
  const mustSign =
    /you must sign|please sign (the |this )?(nda|n\.?d\.?a|agreement)|sign to (view|bid|continue|unlock)|before you can (place a )?bid/i.test(
      text
    );
  const ndaMention = /(non[-\s]?disclosure|\bnda\b|ip agreement|intellectual property)/i.test(text);
  const needsSign = links.length > 0 || signerOpen || (mustSign && ndaMention);
  const kinds = [
    ...new Set(
      links
        .map((link) => agreementKindOf(normalizedText(link)))
        .filter(Boolean)
    )
  ];
  if (needsSign && !kinds.length) kinds.push(signerOpen ? "agreement" : "nda");
  return {
    nda: needsSign,
    bidReady: Boolean(findBidInput()) && !needsSign,
    hasBidForm: Boolean(findBidInput()),
    kinds
  };
}

function findBidTermField(kind) {
  const inputs = queryDeep(
    document,
    "input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit']), [contenteditable='true']"
  ).filter((element) => isVisible(element) && element.tagName !== "TEXTAREA");
  let best = null;
  let bestScore = 0;
  for (const input of inputs) {
    const bits = [
      input.getAttribute("name"),
      input.id,
      input.getAttribute("placeholder"),
      input.getAttribute("aria-label"),
      input.getAttribute("data-testid"),
      input.closest("label")?.textContent,
      input.previousElementSibling?.textContent,
      input.parentElement?.innerText?.slice(0, 140)
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .replace(/\s+/g, " ");
    let score = 0;
    if (kind === "amount") {
      if (/bid amount|\bamount\b|bid.?price|hourly rate/.test(bits)) score += 8;
      if (/\$|usd|currency|budget|\/hr|hourly/.test(bits)) score += 2;
      if (/paid to you|fee/.test(bits)) score += 1;
      if (/deliver|period|days|duration|proposal|profile/.test(bits)) score -= 6;
    } else {
      if (/delivered in|delivery|period|duration|\bdays\b/.test(bits)) score += 8;
      if (/this project will be delivered/.test(bits)) score += 4;
      if (/amount|budget|\$|proposal|profile/.test(bits)) score -= 6;
    }
    if (score > bestScore) {
      best = input;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

async function fillShortField(element, value) {
  await humanClick(element);
  element.focus({ preventScroll: true });
  if (typeof element.select === "function") element.select();
  setNativeValue(element, "");
  await wait(80);
  setNativeValue(element, value);
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
}

async function fillBidTerms(bidAmount, bidDeadlineDays) {
  const notes = [];
  const amount = String(bidAmount || "").trim();
  const days = String(bidDeadlineDays || "").trim();
  if (amount) {
    const field = findBidTermField("amount");
    if (!field) notes.push("amount field not found");
    else {
      await fillShortField(field, amount);
      notes.push(`amount ${amount}`);
    }
  }
  if (days) {
    const field = findBidTermField("days");
    if (!field) notes.push("deadline field not found");
    else {
      await fillShortField(field, days.replace(/[^\d]/g, "") || days);
      notes.push(`deadline ${days} days`);
    }
  }
  return notes.join(", ") || "unchanged";
}

async function fillBid({ draft, autoSubmit, humanTyping, typingSpeed, sealedBid, signAgreements: shouldSign, signerName, signerAddress, bidAmount, bidDeadlineDays }) {
  if (!draft) {
    throw new Error("No draft text to fill.");
  }

  const gate = detectNda();
  let agreements = "none required";
  if (shouldSign !== false && (looksLikeHelloSignSteps(document) || looksLikeSignerUi(document))) {
    agreements = await signAgreements({
      enabled: true,
      signerName: (signerName || "").trim(),
      signerAddress: (signerAddress || "").trim()
    });
    if (typeof agreements === "string" && agreements.startsWith("needed:")) {
      throw new Error(agreements);
    }
  }

  const bidInput = await waitForBidInput(gate.nda ? 20000 : 15000);
  if (!bidInput) {
    throw new Error("Could not find the bid proposal field (skipped Clarification Board).");
  }

  const terms = await fillBidTerms(bidAmount, bidDeadlineDays);

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
    return { submitClicked: false, submitFound: Boolean(submitButton), submitTarget: describeElement(submitButton), sealed, registered, agreements, terms };
  }
  if (!submitButton) {
    throw new Error("Bid typed, but the Place Bid button was not found on the page.");
  }
  if (isDisabled(submitButton)) {
    throw new Error("Bid typed, but the Place Bid button is disabled. Check the amount and other required fields.");
  }
  await wait(randomBetween(700, 1800));
  const submit = await pressSubmit(submitButton, bidInput, draft);
  return { submitClicked: true, submitFound: true, sealed, registered, agreements, terms, ...submit };
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
  if (!IS_TOP && (message?.type === "EXTRACT_PROJECT" || message?.type === "FILL_BID" || message?.type === "DETECT_NDA" || message?.type === "SIGN_AGREEMENTS" || message?.type === "LIST_AGREEMENTS" || message?.type === "CLICK_AGREEMENT" || message?.type === "FILL_SIGNER_PAGE")) {
    return false;
  }
  const handlers = {
    EXTRACT_PROJECT: async () => ({ project: await extractWhenReady() }),
    DETECT_NDA: async () => detectNda(),
    LIST_AGREEMENTS: async () => ({ agreements: listAgreements() }),
    CLICK_AGREEMENT: () => clickAgreementOnce(message.kind),
    FILL_SIGNER_PAGE: () => fillSignerPage((message.signerName || "").trim(), (message.signerAddress || "").trim()),
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
