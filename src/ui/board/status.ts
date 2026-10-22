import type { BeatStatus } from "@core/model";

export const STATUS_NAMES: Readonly<Record<BeatStatus, string>> = {
  draft: "Draft",
  review: "Review",
  final: "Final",
};
