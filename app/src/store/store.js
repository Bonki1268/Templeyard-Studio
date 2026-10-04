// 資料儲存層：單一 JSON 檔（db.json），同步寫入暫存檔再改名，避免寫到一半。
// 每筆資料有 rev；修改時舊版本放進歷史，不刪除。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const clone = v => (v === undefined ? v : structuredClone(v));

class Store {
  constructor(dir, { clock = () => new Date() } = {}) {
    this.dir = dir;
    this.clock = clock;
    this.file = path.join(dir, 'db.json');
    fs.mkdirSync(dir, { recursive: true });
    this.data = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, 'utf8'))
      : { collections: {}, history: {} };
  }

  now() { return this.clock().toISOString(); }

  newId() { return crypto.randomUUID().replace(/-/g, '').slice(0, 12); }

  table(name) { return (this.data.collections[name] ||= {}); }

  persist() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  get(collection, id) { return clone(this.table(collection)[id] ?? null); }

  list(collection, filter = () => true) {
    return Object.values(this.table(collection)).filter(filter).map(clone);
  }

  insert(collection, doc) {
    const now = this.now();
    const row = { id: doc.id || this.newId(), ...clone(doc), rev: 1, createdAt: now, updatedAt: now };
    this.table(collection)[row.id] = row;
    this.persist();
    return clone(row);
  }

  // change 可以是物件（淺層合併）或函式（直接修改複本）。
  update(collection, id, change) {
    const current = this.table(collection)[id];
    if (!current) throw new Error(`找不到 ${collection}/${id}`);
    const next = clone(current);
    if (typeof change === 'function') change(next);
    else Object.assign(next, clone(change));
    next.id = id;
    next.rev = current.rev + 1;
    next.updatedAt = this.now();
    const key = `${collection}/${id}`;
    (this.data.history[key] ||= []).push(current);
    this.table(collection)[id] = next;
    this.persist();
    return clone(next);
  }

  history(collection, id) { return clone(this.data.history[`${collection}/${id}`] || []); }
}

module.exports = { Store };
