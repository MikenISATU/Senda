import { Splash } from "@/components/ui/Loading";

/** Shown while a page outside the signed-in app is loading. */
export default function Loading() {
  return <div className="bg-cloud text-ink"><Splash /></div>;
}
