import fs from "node:fs";

export class LiveDebugWatcher {
  #apply;
  #armed = false;
  #build;
  #closed = false;
  #dirty = false;
  #error;
  #running = null;
  #sequence;
  #timer = null;
  #watcher;

  constructor({ apply, build, error, sequence = 1, source }) {
    if (typeof apply !== "function" || typeof build !== "function"
      || typeof error !== "function") throw new TypeError("debug watcher callbacks are required");
    this.#apply = apply;
    this.#build = build;
    this.#error = error;
    this.#sequence = sequence;
    this.#watcher = fs.watch(source, { recursive: true }, () => this.#markDirty());
    this.#watcher.on("error", (watchError) => { void this.#error(watchError); });
  }

  #markDirty() {
    if (this.#closed) return;
    this.#dirty = true;
    if (!this.#armed || this.#running) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => { void this.#flush(); }, 120);
  }

  #flush() {
    clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#closed || !this.#armed || this.#running || !this.#dirty) return this.#running;
    this.#running = (async () => {
      while (this.#dirty && !this.#closed && this.#armed) {
        this.#dirty = false;
        const sequence = ++this.#sequence;
        try {
          const artifact = await this.#build();
          if (!this.#closed && this.#armed) await this.#apply(artifact, sequence);
        } catch (buildError) {
          if (!this.#closed) await this.#error(buildError);
        }
      }
    })().finally(() => { this.#running = null; });
    return this.#running;
  }

  arm() {
    if (this.#closed) throw new Error("debug watcher is closed");
    this.#armed = true;
    if (this.#dirty) this.#markDirty();
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#armed = false;
    clearTimeout(this.#timer);
    this.#timer = null;
    this.#watcher.close();
    await this.#running;
  }
}
