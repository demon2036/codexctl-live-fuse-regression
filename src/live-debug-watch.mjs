import fs from "node:fs";

export class LiveDebugWatcher {
  #closed = false;
  #dirty = false;
  #error;
  #paused = false;
  #reload;
  #running = false;
  #timer = null;
  #watchers = [];

  constructor({ sources, reload, error }) {
    if (typeof reload !== "function" || typeof error !== "function") {
      throw new TypeError("debug watcher callbacks are required");
    }
    this.#reload = reload;
    this.#error = error;
    try {
      for (const { directory, accept = () => true } of sources) {
        const watcher = fs.watch(directory, { recursive: true }, (_event, filename) => {
          if (accept(filename)) this.#markDirty();
        });
        this.#watchers.push(watcher);
        watcher.on("error", (watchError) => { void error(watchError); });
      }
    } catch (error) {
      this.close();
      throw error;
    }
  }

  #markDirty() {
    if (this.#closed) return;
    this.#dirty = true;
    if (this.#running || this.#paused) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => { void this.#flush(); }, 120);
  }

  async #flush() {
    clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#closed || this.#paused || this.#running || !this.#dirty) return;
    this.#running = true;
    try {
      while (this.#dirty && !this.#closed && !this.#paused) {
        this.#dirty = false;
        try { await this.#reload(); }
        catch (error) { if (!this.#closed) await this.#error(error); }
      }
    } finally { this.#running = false; }
  }

  get dirty() { return this.#dirty; }

  pause() {
    this.#paused = true;
    this.#dirty = false;
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  arm() {
    this.#paused = false;
    if (this.#dirty) this.#markDirty();
  }

  close() {
    this.#closed = true;
    clearTimeout(this.#timer);
    this.#timer = null;
    for (const watcher of this.#watchers.splice(0)) watcher.close();
    // Reload closes its own watcher during handoff; waiting here would deadlock.
  }
}
