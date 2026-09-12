import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { loadPayload } from "../vendor/prompt-context/injector.mjs";
import { harnessBoundingRect, harnessComputedStyle } from "./renderer-layout-harness.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

export function rendererHarness(payload, { windowOverrides = {} } = {}) {
  let timerSequence = 0;
  const timers = new Map();
  const animationFrames = new Map();
  const idleCallbacks = { scheduled: 0, cancelled: 0 };
  const mutationObservers = [];
  const documentListeners = new Map();
  const windowListeners = new Map();

  const addListener = (registry, name, listener) => {
    const listeners = registry.get(name) ?? new Set();
    listeners.add(listener);
    registry.set(name, listeners);
  };
  const removeListener = (registry, name, listener) => registry.get(name)?.delete(listener);
  const dispatch = (registry, name, event = {}) => {
    for (const listener of [...(registry.get(name) ?? [])]) listener({ type: name, ...event });
  };

  class FakeNode {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this.nodeType = 1;
      this.children = [];
      this.parentElement = null;
      this.dataset = {};
      this.style = {};
      this.className = "";
      this.id = "";
      this.isConnected = true;
      this.attributes = new Map();
      this.listeners = new Map();
      this.classList = {
        contains: (name) => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/), ...names])].join(" ").trim(); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(" "); },
      };
      this._textContent = "";
      Object.defineProperty(this, "textContent", {
        configurable: true,
        get: () => {
          if (this.children.length) return this.children.map((child) => child.textContent || "").join("");
          if (typeof this.innerHTML === "string") {
            return this.innerHTML.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
          }
          return this._textContent;
        },
        set: (value) => {
          this._textContent = String(value ?? "");
          this.children = [];
          this.innerHTML = undefined;
        },
      });
      this.boundingRect = {
        x: 0, y: 0, top: 0, right: 120, bottom: 28, left: 0, width: 120, height: 28,
      };
    }

    appendChild(child) {
      if (child.parentElement) child.remove();
      child.parentElement = this;
      child.isConnected = true;
      this.children.push(child);
      return child;
    }

    append(...children) {
      for (const child of children) this.appendChild(child);
    }

    remove() {
      this.isConnected = false;
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter((item) => item !== this);
      }
      this.parentElement = null;
    }

    setAttribute(name, value) {
      const text = String(value);
      this.attributes.set(name, text);
      if (name.startsWith("data-")) {
        const key = name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
        this.dataset[key] = text;
      }
      if (!this.rectExplicit && name === "data-composer-footer-responsive") {
        this.boundingRect = { x: 80, y: 600, left: 80, top: 600, right: 1080, bottom: 720,
          width: 1000, height: 120 };
      }
      if (!this.rectExplicit && name === "data-composer-navigation-target" && value === "permissions") {
        this.boundingRect = { x: 100, y: 680, left: 100, top: 680, right: 200, bottom: 708,
          width: 100, height: 28 };
      }
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) {
      this.attributes.delete(name);
      if (name.startsWith("data-")) {
        const key = name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
        delete this.dataset[key];
      }
    }
    addEventListener(name, listener) {
      const listeners = this.listeners.get(name) ?? new Set();
      listeners.add(listener);
      this.listeners.set(name, listeners);
    }
    removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
    dispatchEvent(event) {
      const payload = {
        preventDefault() {},
        stopPropagation() {},
        target: this,
        ...event,
      };
      for (const listener of [...(this.listeners.get(payload.type) ?? [])]) listener(payload);
      return true;
    }
    click() { return this.dispatchEvent({ type: "click" }); }
    matches(selector) {
      if (selector.includes(",")) return selector.split(",").some((part) => this.matches(part.trim()));
      if (selector === "*") return true;
      const attribute = String(selector).match(/^\[([a-z0-9-]+)(?:="([^"]*)")?\]$/i);
      if (attribute) {
        const value = this.getAttribute(attribute[1]);
        return value !== null && (attribute[2] === undefined || value === attribute[2]);
      }
      const element = String(selector).match(/^([a-z][a-z0-9-]*)?(?:\.([a-z0-9_-]+))?$/i);
      if (!element) return false;
      const tagMatches = !element[1] || this.tagName === element[1].toUpperCase();
      const classes = String(this.className).split(/\s+/).filter(Boolean);
      return tagMatches && (!element[2] || classes.includes(element[2]));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    querySelectorAll(selector) {
      const result = [];
      const visit = (node) => {
        for (const child of node.children ?? []) {
          if (child.matches?.(selector)) result.push(child);
          visit(child);
        }
      };
      visit(this);
      return result;
    }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) {
        if (node.matches?.(selector)) return node;
      }
      return null;
    }
    contains(candidate) { return candidate === this || this.children.some((child) => child.contains(candidate)); }
    setBoundingClientRect(rect) {
      this.rectExplicit = true;
      this.boundingRect = { ...this.boundingRect, ...rect };
      this.boundingRect.x = this.boundingRect.left;
      this.boundingRect.y = this.boundingRect.top;
      this.boundingRect.right = this.boundingRect.left + this.boundingRect.width;
      this.boundingRect.bottom = this.boundingRect.top + this.boundingRect.height;
    }
    getBoundingClientRect() { return harnessBoundingRect(this); }
  }

  const allElements = () => {
    const result = [];
    const visit = (node) => {
      if (!node) return;
      result.push(node);
      for (const child of node.children ?? []) visit(child);
    };
    visit(document.documentElement);
    return result;
  };
  const document = {
    documentElement: null,
    head: null,
    body: null,
    visibilityState: "visible",
    title: "Codex",
    createElement(tagName) { return new FakeNode(tagName); },
    getElementById(id) { return allElements().find((element) => element.id === id) ?? null; },
    querySelector(selector) {
      if (document.documentElement?.matches?.(selector)) return document.documentElement;
      return document.documentElement?.querySelector?.(selector) ?? null;
    },
    querySelectorAll(selector) {
      const root = document.documentElement;
      if (!root) return [];
      return [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];
    },
    elementsFromPoint(x, y) {
      return allElements().reverse().filter((node) => {
        const style = harnessComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return node.isConnected && style.display !== "none" && style.visibility !== "hidden"
          && x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
      });
    },
    elementFromPoint(x, y) { return this.elementsFromPoint(x, y)[0] ?? null; },
    addEventListener(name, listener) { addListener(documentListeners, name, listener); },
    removeEventListener(name, listener) { removeListener(documentListeners, name, listener); },
  };
  const window = {
    addEventListener(name, listener) { addListener(windowListeners, name, listener); },
    removeEventListener(name, listener) { removeListener(windowListeners, name, listener); },
    innerWidth: 1280,
    innerHeight: 800,
    getComputedStyle: harnessComputedStyle,
    ...windowOverrides,
  };
  window.window = window;
  const scheduleTimer = (callback) => {
    timerSequence += 1;
    timers.set(timerSequence, callback);
    return timerSequence;
  };
  const clearTimer = (identifier) => timers.delete(identifier);
  const context = vm.createContext({
    window,
    document,
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    Node: FakeNode,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; mutationObservers.push(this); }
      observe(target, options) { this.target = target; this.options = options; }
      disconnect() {}
    },
    setTimeout: scheduleTimer,
    clearTimeout: clearTimer,
    requestIdleCallback(callback) {
      idleCallbacks.scheduled += 1;
      return scheduleTimer(callback);
    },
    cancelIdleCallback(identifier) {
      idleCallbacks.cancelled += 1;
      clearTimer(identifier);
    },
    requestAnimationFrame(callback) {
      const id = ++timerSequence;
      animationFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { animationFrames.delete(id); },
    getComputedStyle: window.getComputedStyle,
    console,
    Date,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Map,
    Set,
    WeakSet,
    Promise,
    Error,
    URL,
  });
  new vm.Script(payload, { filename: "renderer-harness.js" }).runInContext(context);
  return {
    window,
    document,
    timers,
    idleCallbacks,
    mutationObservers,
    nodes: allElements,
    createDom() {
      const root = new FakeNode("html");
      const head = new FakeNode("head");
      const body = new FakeNode("body");
      root.appendChild(head);
      root.appendChild(body);
      document.documentElement = root;
      document.head = head;
      document.body = body;
    },
    dispatchDocument(name, event) { dispatch(documentListeners, name, event); },
    dispatchWindow(name, event) { dispatch(windowListeners, name, event); },
    execute(source) { return new vm.Script(source).runInContext(context); },
    listenerCount(scope, name) {
      const registry = scope === "window" ? windowListeners : documentListeners;
      return registry.get(name)?.size ?? 0;
    },
    runNextTimer() {
      const entry = [...timers.entries()].sort((left, right) => left[0] - right[0])[0];
      if (!entry) return false;
      timers.delete(entry[0]);
      entry[1]();
      return true;
    },
    async flush() {
      for (let pass = 0; pass < 16; pass += 1) {
        await Promise.resolve();
        const frames = [...animationFrames.values()];
        animationFrames.clear();
        for (const callback of frames) callback();
      }
    },
    cleanup() {
      window.__CODEX_BASE_PROMPT_SWITCHER__?.cleanup?.();
      timers.clear();
      animationFrames.clear();
    },
  };
}

export async function makePayload(overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-prompt-renderer-"));
  const prompt = path.join(directory, "dev.md");
  const profiles = path.join(directory, "profiles.json");
  await fs.writeFile(prompt, "developer test prompt\n", { mode: 0o600 });
  await fs.writeFile(profiles, `${JSON.stringify({
    schema: "codex-base-prompt-profiles/1",
    features: { prompt: true, context: true },
    profiles: [{ id: "work", label: "Work", path: prompt }],
    defaultProfileId: "work",
    promptSelectionRevision: 1,
    contexts: [
      { id: "native", label: "Native / Official", native: true },
      {
        id: "lab",
        label: "Lab 384K",
        contextWindow: 384000,
        autoCompactTokenLimit: 340000,
        scope: "body_after_prefix",
      },
    ],
    defaultContextId: "lab",
    contextSelectionRevision: 1,
    ...overrides,
  }, null, 2)}\n`, { mode: 0o600 });
  return { directory, prompt, loaded: await loadPayload(profiles) };
}
