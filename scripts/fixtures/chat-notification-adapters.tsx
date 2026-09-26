import type { ReactNode } from "react";
type Listener = { event: string; filter: Record<string, unknown>; callback: (payload: { new: unknown }) => void };
type Channel = { name: string; active: boolean; listeners: Listener[]; on: (event: string, filter: Record<string, unknown>, callback: Listener["callback"]) => Channel; subscribe: () => Channel };
const channels: Channel[] = [];
const fixtureWindow = () => window as unknown as {
  fixtureNavigations: string[]; fixtureEmit: (event: string, thread: string, row: unknown, late?: boolean) => void;
};
fixtureWindow().fixtureNavigations = [];
fixtureWindow().fixtureEmit = (event, thread, row, late = false) => {
  for (const channel of channels) {
    if (!late && !channel.active) continue;
    if (late && (channel.active || channel.name !== "dating-chat-thread:" + thread)) continue;
    for (const listener of channel.listeners) if (listener.filter.event === event &&
      (listener.filter.filter === "thread_id=eq." + thread || listener.filter.filter === "id=eq." + thread ||
        (!late && listener.filter.filter === "receiver_id=eq.fixture-member"))) listener.callback({ new: row });
  }
};
const client = {
  auth: { getUser: async () => ({ data: { user: { id: "fixture-member" } } }) },
  channel: (name: string) => {
    const channel: Channel = { name, active: true, listeners: [],
      on(event, filter, callback) { this.listeners.push({ event, filter, callback }); return this; },
      subscribe() { return this; } };
    channels.push(channel); return channel;
  },
  removeChannel: async (channel: Channel) => { channel.active = false; },
};
export const createClient = () => client;
const router = { push: (href: string) => { fixtureWindow().fixtureNavigations.push(href); window.history.pushState(null, "", href); } };
export const useRouter = () => router;
export default function Link({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return <a href={href} className={className}>{children}</a>;
}
