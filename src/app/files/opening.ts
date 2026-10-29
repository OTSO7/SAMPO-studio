import { createStore } from "../store/create-store";

/**
 * A story being opened. The first time a package opens on a computer its pictures and sounds
 * are unpacked, which for a gigabyte of music takes a while; `done` and `total` count the
 * bytes of that, `total` is 0 until known.
 */
export const opening = createStore({ active: false, done: 0, total: 0 });
