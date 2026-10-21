import { createStore, type Store } from "./create-store";

export interface Notice {
  readonly tone: "error" | "info";
  readonly title: string;
  readonly details?: readonly string[];
}

export interface NoticeState {
  readonly notice: Notice | null;
}

export type NoticeStore = Store<NoticeState>;

export function createNoticeStore(): NoticeStore {
  return createStore<NoticeState>({ notice: null });
}

export function showNotice(store: NoticeStore, notice: Notice): void {
  store.setState({ notice });
}

export function dismissNotice(store: NoticeStore): void {
  store.setState({ notice: null });
}
