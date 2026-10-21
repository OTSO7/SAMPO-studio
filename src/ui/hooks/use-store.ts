import { useCallback, useSyncExternalStore } from "react";

import type { Store } from "@app/store";

/**
 * Subscribes a component to part of a store. The selector must return a value that only
 * changes identity when the data changes, such as a field or a primitive.
 */
export function useStore<S extends object, T>(store: Store<S>, selector: (state: S) => T): T {
  const subscribe = useCallback((onChange: () => void) => store.subscribe(onChange), [store]);
  return useSyncExternalStore(subscribe, () => selector(store.getState()));
}
