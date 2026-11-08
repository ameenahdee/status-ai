// Isolated localStorage for tests. Nothing here ever touches the real browser storage.
export const KEY = 'statusai.v1'
export const SET_ASIDE_KEY = 'statusai.v1.set-aside'
export const PRE_MIGRATION_KEY = 'statusai.v1.pre-v2'

// failSet / failGet are plain properties, so a test can flip them mid-test (for example "the disk
// was full, now it has space again"). Each may be true (every call fails) or a list of keys.
export function makeStorage(initial = {}, { failSet = false, failGet = false } = {}) {
  const data = new Map(Object.entries(initial))
  const s = {
    data,
    failSet,
    failGet,
    writes: [], // the key of every successful write, in order
    getItem(k) {
      if (s.failGet === true || (Array.isArray(s.failGet) && s.failGet.includes(k))) {
        throw new Error('SecurityError: storage is unavailable')
      }
      return data.has(k) ? data.get(k) : null
    },
    setItem(k, v) {
      if (s.failSet === true || (Array.isArray(s.failSet) && s.failSet.includes(k))) {
        throw new Error('QuotaExceededError: storage is full')
      }
      s.writes.push(k)
      data.set(k, String(v))
    },
    removeItem: (k) => data.delete(k),
    clear: () => data.clear(),
  }
  return s
}

// Loads a brand-new instance of src/store.js bound to the given storage, like a fresh page load.
// (store.js reads localStorage when the module is first evaluated, so each call imports a new copy.)
let instance = 0
export async function loadStore(storage = makeStorage()) {
  globalThis.localStorage = storage
  return import(`../../src/store.js?instance=${++instance}`)
}

export const releaseStorage = () => {
  delete globalThis.localStorage
}

// What a page refresh would see: the persisted state, parsed. (Reads the raw map, so it also works
// for a storage whose getItem is deliberately failing.)
export const readPersisted = (storage) => JSON.parse(storage.data.get(KEY))
