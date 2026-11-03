import OneOnOnePrivateChat from "@/components/dating/OneOnOnePrivateChat";
export default async function PrivateChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main className="mx-auto max-w-2xl px-4 py-6 pb-24"><OneOnOnePrivateChat matchId={id} /></main>;
}
