import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Chat from "../../app/chat/page";
import Notifications from "../../app/notifications/page";
const fixtureWindow = window as unknown as { fixtureIgnoreAbort?: boolean; fixtureFastTimeout?: boolean; fixtureUnmount: () => void };
// Test a response that still arrives despite cancellation; no real service is used.
if (fixtureWindow.fixtureIgnoreAbort) {
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => original(input, /^\/api\/dating\/chat\/(thread|profile)/.test(String(input)) ? { ...init, signal: undefined } : init);
}
if (fixtureWindow.fixtureFastTimeout) {
  const original = window.setTimeout.bind(window);
  window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => original(handler, timeout === 8000 ? 80 : timeout, ...args)) as typeof window.setTimeout;
}
const root = createRoot(document.getElementById("root")!);
fixtureWindow.fixtureUnmount = () => root.unmount();
root.render(<StrictMode>{location.pathname === "/chat" ? <Chat /> : <Notifications />}</StrictMode>);
