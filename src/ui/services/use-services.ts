import { useContext } from "react";

import { ServicesContext, type Services } from "./services";

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (services === null) throw new Error("useServices must be used inside <ServicesProvider>.");
  return services;
}
