import { createContext } from "react";

import type { AppDeps } from "@app/commands";
import type { Autosave, PromptStore } from "@app/store";

export interface Services {
  readonly deps: AppDeps;
  readonly prompts: PromptStore;
  readonly autosave: Autosave;
}

export const ServicesContext = createContext<Services | null>(null);
