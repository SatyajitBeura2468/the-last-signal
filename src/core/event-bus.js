export function createEventBus() {
  const listeners = new Map();

  return {
    on(type, listener) {
      const group = listeners.get(type) ?? new Set();
      group.add(listener);
      listeners.set(type, group);
      return () => group.delete(listener);
    },
    emit(type, payload) {
      for (const listener of listeners.get(type) ?? []) listener(payload);
      for (const listener of listeners.get('*') ?? []) listener({ type, payload });
    },
    clear() {
      listeners.clear();
    },
  };
}
