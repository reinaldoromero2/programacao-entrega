import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl } from "@workspace/api-client-react";

// When deployed to Vercel the frontend is served separately from the API.
// VITE_API_URL overrides the default; falls back to the production Render URL.
setBaseUrl(import.meta.env.VITE_API_URL || "https://programa-odeentrega.onrender.com");

createRoot(document.getElementById("root")!).render(<App />);
