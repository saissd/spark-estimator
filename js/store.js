/* ============================================================
 * store.js — persistence layer.
 *
 * Two stores, on purpose:
 *   • localStorage  — small JSON: projects, selections, quantities,
 *                     per-project price overrides, global price list.
 *   • IndexedDB     — photo blobs, keyed by id. Photos NEVER go in
 *                     localStorage (the reference app does, and silently
 *                     drops them when the ~5MB quota blows). Blobs in
 *                     IndexedDB scale to hundreds of MB.
 *
 * Everything is namespaced and versioned so a future schema bump
 * won't corrupt an agent's saved work.
 * ============================================================ */

const Store = (() => {
  const K_PROJECTS = 'spark.projects.v1';
  const K_PRICES   = 'spark.prices.v1';       // global price list (id -> cost)
  const K_ACTIVE   = 'spark.activeProject.v1'; // last opened project id

  // ---------- localStorage helpers ----------
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('localStorage write failed', key, e);
      return false;
    }
  }

  // ---------- Projects ----------
  // A project: { id, name, createdAt, updatedAt, rooms:[{id,type,name}],
  //              entries:{ [roomId:itemId]: {checked,qty,serial} },
  //              overrides:{ [itemId]: cost }, custom:[{id,name,cost,unit,group}],
  //              deleted:[itemId...], deal:{purchase,arv,extra}, photoIds:[...] }
  function listProjects() {
    return readJSON(K_PROJECTS, []);
  }
  function saveProject(project) {
    const list = listProjects();
    const idx = list.findIndex(p => p.id === project.id);
    if (idx >= 0) list[idx] = project;
    else list.unshift(project);
    return writeJSON(K_PROJECTS, list);
  }
  function getProject(id) {
    return listProjects().find(p => p.id === id) || null;
  }
  function deleteProject(id) {
    writeJSON(K_PROJECTS, listProjects().filter(p => p.id !== id));
    // photos are cleaned up by the caller via Photos.deleteForProject
  }
  function getActiveId() { return readJSON(K_ACTIVE, null); }
  function setActiveId(id) { writeJSON(K_ACTIVE, id); }

  // ---------- Global price list ----------
  // Seeded from the CSV catalog on first run; editable globally.
  function getGlobalPrices() { return readJSON(K_PRICES, null); }
  function setGlobalPrices(map) { writeJSON(K_PRICES, map); }
  function resetGlobalPrices() {
    try { localStorage.removeItem(K_PRICES); } catch { /* storage unavailable (private mode) — safe to ignore */ }
  }

  // ---------- IndexedDB (photos) ----------
  const DB_NAME = 'spark.photos.v1';
  const STORE = 'photos';
  let _dbPromise = null;

  function db() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) {
          const os = d.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('projectId', 'projectId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _dbPromise;
  }

  async function tx(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const os = t.objectStore(STORE);
      let out;
      Promise.resolve(fn(os)).then(r => { out = r; }).catch(reject);
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const Photos = {
    // record: { id, projectId, roomId, itemId, blob, type, addedAt, serial? }
    async add(record) {
      await tx('readwrite', os => os.put(record));
      return record.id;
    },
    async get(id) {
      return tx('readonly', os => new Promise((res, rej) => {
        const r = os.get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      }));
    },
    async listForProject(projectId) {
      return tx('readonly', os => new Promise((res, rej) => {
        const out = [];
        const idx = os.index('projectId');
        const r = idx.openCursor(IDBKeyRange.only(projectId));
        r.onsuccess = () => { const c = r.result; if (c) { out.push(c.value); c.continue(); } else res(out); };
        r.onerror = () => rej(r.error);
      }));
    },
    async remove(id) { await tx('readwrite', os => os.delete(id)); },
    async deleteForProject(projectId) {
      const all = await Photos.listForProject(projectId);
      await tx('readwrite', os => { all.forEach(p => os.delete(p.id)); });
    },
    async update(record) { await tx('readwrite', os => os.put(record)); },
  };

  return {
    listProjects, saveProject, getProject, deleteProject,
    getActiveId, setActiveId,
    getGlobalPrices, setGlobalPrices, resetGlobalPrices,
    Photos,
  };
})();

window.Store = Store;
