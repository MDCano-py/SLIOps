/**
 * File-backed Redis-compatible client for local hub + portal dev.
 * Persists to for-dev/local-hub-data/redis.json
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'local-hub-data');
const DATA_FILE = path.join(DATA_DIR, 'redis.json');

function emptyDb() {
  return { strings: {}, zsets: {}, sets: {}, lists: {}, counters: {} };
}

function loadDb() {
  try {
    if (!fs.existsSync(DATA_FILE)) return emptyDb();
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...emptyDb(), ...parsed };
  } catch {
    return emptyDb();
  }
}

function createLocalRedis() {
  let db = loadDb();
  let lastMtime = 0;
  try {
    if (fs.existsSync(DATA_FILE)) lastMtime = fs.statSync(DATA_FILE).mtimeMs;
  } catch {
    /* ignore */
  }
  let persistChain = Promise.resolve();
  let logged = false;

  function reloadIfStale() {
    try {
      if (!fs.existsSync(DATA_FILE)) return;
      const mtime = fs.statSync(DATA_FILE).mtimeMs;
      if (mtime > lastMtime) {
        db = loadDb();
        lastMtime = mtime;
      }
    } catch {
      /* ignore reload errors — keep in-memory copy */
    }
  }

  function touchMtime() {
    try {
      if (fs.existsSync(DATA_FILE)) lastMtime = fs.statSync(DATA_FILE).mtimeMs;
    } catch {
      /* ignore */
    }
  }

  function schedulePersist() {
    persistChain = persistChain
      .then(() => {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
        touchMtime();
        if (!logged) {
          logged = true;
        }
      })
      .catch((err) => console.error('[local-redis] persist failed:', err.message));
    return persistChain;
  }

  function getZset(key) {
    if (!db.zsets[key]) db.zsets[key] = [];
    return db.zsets[key];
  }

  function getSet(key) {
    if (!db.sets[key]) db.sets[key] = [];
    return db.sets[key];
  }

  function getList(key) {
    if (!db.lists[key]) db.lists[key] = [];
    return db.lists[key];
  }

  function zrangeMembers(key, start, end, opts = {}) {
    let entries = getZset(key).slice();
    if (opts.byScore) {
      const min = Number(start);
      const max = Number(end);
      entries = entries.filter((e) => e.score >= min && e.score <= max);
      entries.sort((a, b) => a.score - b.score);
    } else {
      entries.sort((a, b) => a.score - b.score);
      const s = start < 0 ? Math.max(0, entries.length + start) : start;
      const e = end < 0 ? entries.length + end : end;
      entries = entries.slice(s, e + 1);
    }
    if (opts.rev) entries.reverse();
    return entries.map((e) => e.member);
  }

  const api = {
    async get(key) {
      reloadIfStale();
      return db.strings[key] ?? null;
    },

    async set(key, value, options) {
      reloadIfStale();
      db.strings[key] = value;
      if (options?.ex) {
        /* TTL ignored in local dev — keys persist until cleared */
      }
      await schedulePersist();
      return 'OK';
    },

    async del(key) {
      let n = 0;
      if (db.strings[key] !== undefined) {
        delete db.strings[key];
        n++;
      }
      if (db.zsets[key]) {
        delete db.zsets[key];
        n++;
      }
      if (db.sets[key]) {
        delete db.sets[key];
        n++;
      }
      if (db.lists[key]) {
        delete db.lists[key];
        n++;
      }
      if (db.counters[key] !== undefined) {
        delete db.counters[key];
        n++;
      }
      await schedulePersist();
      return n;
    },

    async mget(...keys) {
      reloadIfStale();
      const flat = keys.length === 1 && Array.isArray(keys[0]) ? keys[0] : keys;
      return flat.map((k) => (db.strings[k] !== undefined ? db.strings[k] : null));
    },

    async incr(key) {
      db.counters[key] = (db.counters[key] || 0) + 1;
      await schedulePersist();
      return db.counters[key];
    },

    async zadd(key, item) {
      const z = getZset(key);
      const score = item.score;
      const member = item.member;
      const idx = z.findIndex((e) => e.member === member);
      if (idx >= 0) z[idx].score = score;
      else z.push({ member, score });
      await schedulePersist();
      return 1;
    },

    async zrem(key, member) {
      const z = getZset(key);
      const before = z.length;
      db.zsets[key] = z.filter((e) => e.member !== member);
      await schedulePersist();
      return before - db.zsets[key].length;
    },

    async zrange(key, start, end, opts = {}) {
      reloadIfStale();
      return zrangeMembers(key, start, end, opts);
    },

    async sadd(key, member) {
      const s = getSet(key);
      if (!s.includes(member)) s.push(member);
      await schedulePersist();
      return 1;
    },

    async srem(key, member) {
      const s = getSet(key);
      const before = s.length;
      db.sets[key] = s.filter((m) => m !== member);
      await schedulePersist();
      return before - db.sets[key].length;
    },

    async smembers(key) {
      reloadIfStale();
      return getSet(key).slice();
    },

    async lpush(key, value) {
      getList(key).unshift(value);
      await schedulePersist();
      return getList(key).length;
    },

    async ltrim(key, start, end) {
      const list = getList(key);
      db.lists[key] = list.slice(start, end + 1);
      await schedulePersist();
      return 'OK';
    },

    async lrange(key, start, end) {
      const list = getList(key);
      return list.slice(start, end + 1);
    },

    pipeline() {
      const ops = [];
      const pipe = {
        set(k, v) {
          ops.push(() => {
            db.strings[k] = v;
          });
          return pipe;
        },
        get(k) {
          ops.push(() => db.strings[k] ?? null);
          return pipe;
        },
        del(k) {
          ops.push(() => {
            delete db.strings[k];
            delete db.zsets[k];
            delete db.sets[k];
            delete db.lists[k];
            delete db.counters[k];
          });
          return pipe;
        },
        zadd(k, item) {
          ops.push(() => {
            const z = getZset(k);
            const idx = z.findIndex((e) => e.member === item.member);
            if (idx >= 0) z[idx].score = item.score;
            else z.push({ member: item.member, score: item.score });
          });
          return pipe;
        },
        zrem(k, member) {
          ops.push(() => {
            db.zsets[k] = getZset(k).filter((e) => e.member !== member);
          });
          return pipe;
        },
        sadd(k, member) {
          ops.push(() => {
            const s = getSet(k);
            if (!s.includes(member)) s.push(member);
          });
          return pipe;
        },
        srem(k, member) {
          ops.push(() => {
            db.sets[k] = getSet(k).filter((m) => m !== member);
          });
          return pipe;
        },
        lpush(k, v) {
          ops.push(() => {
            getList(k).unshift(v);
          });
          return pipe;
        },
        ltrim(k, start, end) {
          ops.push(() => {
            db.lists[k] = getList(k).slice(start, end + 1);
          });
          return pipe;
        },
        async exec() {
          const results = [];
          for (const op of ops) {
            results.push(op());
          }
          await schedulePersist();
          return results;
        },
      };
      return pipe;
    },
  };

  return api;
}

module.exports = { createLocalRedis, DATA_FILE };
