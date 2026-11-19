import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// Kernel's tokens and component CSS first, so theme.css (which retunes the
// tokens to this app's palette) loads after them. Kernel's reset.css is
// deliberately NOT imported: its reduced-motion rule gives every element a
// 0.01ms transition, which (with the OS "reduce motion" setting on) makes
// every SVG geometry change on the canvas a CSS transition and lags pans and
// drags by a frame. The two rules the app needs are copied into theme.css.
import "@kernelui-lib/styles/tokens.css";
import "@kernelui-lib/react/styles.css";
import "./theme.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("missing #root element");
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
