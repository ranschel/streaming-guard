(function initializeStreamingGuardPersistence(global) {
  "use strict";

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function createLocalStorageJsonAdapter(storage = global.localStorage) {
    if (!storage) throw new TypeError("A storage implementation is required.");
    return Object.freeze({
      read(key) {
        const value = storage.getItem(key);
        if (value == null) return null;
        return JSON.parse(value);
      },
      write(key, value) {
        storage.setItem(key, JSON.stringify(value));
        return clone(value);
      },
      remove(key) {
        storage.removeItem(key);
      },
      exists(key) {
        return storage.getItem(key) != null;
      }
    });
  }

  function createVersionedRepository({
    adapter,
    key,
    validate,
    revisionField,
    clock = () => new Date().toISOString()
  }) {
    if (!adapter || !key || typeof validate !== "function" || !revisionField) {
      throw new TypeError("Repository adapter, key, validator, and revision field are required.");
    }

    return Object.freeze({
      key,
      load() {
        const document = adapter.read(key);
        return document == null ? null : clone(validate(document));
      },
      save(document, { expectedRevision = null, incrementRevision = true } = {}) {
        const current = adapter.read(key);
        const currentRevision = Number(current?.[revisionField] || 0);
        if (expectedRevision != null && current && currentRevision !== expectedRevision) {
          const error = new Error(
            `Saved state changed from revision ${expectedRevision} to ${currentRevision}; reload before applying this update.`
          );
          error.code = "revision_conflict";
          throw error;
        }
        const next = clone(document);
        next[revisionField] = incrementRevision
          ? currentRevision + 1
          : Number(next[revisionField] || currentRevision);
        validate(next);
        adapter.write(key, next);
        return clone(next);
      },
      replace(document) {
        const next = clone(document);
        validate(next);
        adapter.write(key, next);
        return clone(next);
      },
      remove() {
        adapter.remove(key);
      },
      revision() {
        return Number(adapter.read(key)?.[revisionField] || 0);
      }
    });
  }

  global.StreamingGuardPersistence = Object.freeze({
    createLocalStorageJsonAdapter,
    createVersionedRepository
  });
})(window);
