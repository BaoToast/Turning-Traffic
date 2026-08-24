import React from "react";
import { createRoot } from "react-dom/client";
import TrafficApp from "../app/traffic-app";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(<React.StrictMode><TrafficApp /></React.StrictMode>);
