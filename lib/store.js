// JSON-file persistence with debounced atomic writes.
import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(file) {
    this.file = file;
    this.data = { sessions: {} };
    this.timer = null;
    this.dirty = false;
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.sessions === 'object') this.data = parsed;
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('store: could not read', this.file, e.message);
    }
    return this.data;
  }

  save() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 150);
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('store: write failed', e.message);
    }
  }
}
