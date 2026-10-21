import React from "react";
import ReactDOM from "react-dom/client";

import "@ui/theme";
import { createServices } from "@ui/services/create-services";
import { ServicesProvider } from "@ui/services/ServicesProvider";
import App from "./App";

const services = createServices();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ServicesProvider services={services}>
      <App />
    </ServicesProvider>
  </React.StrictMode>,
);
