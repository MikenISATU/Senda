"use client";

import { useParams } from "next/navigation";
import { Chat } from "@/components/app/Chat";

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  return <div className="mx-auto w-full max-w-[780px]"><Chat id={id} /></div>;
}
