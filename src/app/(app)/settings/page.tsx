"use client";

import { useExportWallet } from "@privy-io/react-auth/extended-chains";
import { useState } from "react";
import { PageHeader } from "@/components/app/AppShell";
import { Avatar, Notice } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";
import { uploadFile } from "@/lib/client/upload";

export default function SettingsPage() {
  const s = useSession();
  const { exportWallet } = useExportWallet();
  const [displayName, setDisplayName] = useState(s.profile?.display_name ?? "");
  const [bio, setBio] = useState(s.profile?.bio ?? "");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(avatarPath?: string) {
    setBusy(true); setMsg(null);
    try {
      await s.api("/api/profile", { method: "PATCH", body: { displayName, bio, ...(avatarPath ? { avatarPath } : {}) } });
      await s.refresh();
      setMsg({ tone: "success", text: "Profile saved." });
    } catch (e) { setMsg({ tone: "danger", text: (e as Error).message }); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto w-full max-w-[780px] px-4 md:px-6">
      <PageHeader flush title="Settings" />
      <section className="sheet space-y-4 p-5" aria-labelledby="prof">
        <h2 id="prof" className="text-lg font-semibold">Profile</h2>
        <div className="flex items-center gap-4">
          <Avatar src={s.profile?.avatar_url} name={s.profile?.username} size={64} />
          <label className="btn-outline cursor-pointer">Change photo
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              try { const up = await uploadFile(s.api, f, "avatar"); await save(up.avatarPath); } catch (x) { setMsg({ tone: "danger", text: (x as Error).message }); }
            }} />
          </label>
        </div>
        <div><label className="label" htmlFor="dn">Display name</label><input id="dn" className="field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={50} /></div>
        <div><label className="label" htmlFor="bio">Bio</label><textarea id="bio" className="field min-h-24 py-2.5" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={280} /></div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <button className="btn-primary" disabled={busy} onClick={() => save()}>Save profile</button>
      </section>

      <section className="sheet mt-4 space-y-3 p-5" aria-labelledby="wal">
        <h2 id="wal" className="text-lg font-semibold">Wallet</h2>
        <p className="tabular break-all text-sm">{s.wallet}</p>
        <p className="text-sm text-slate">Your key is held by Privy's secure wallet infrastructure and only signs when you approve. You can export it to use the same account in another Stellar wallet.</p>
        <button className="btn-outline" onClick={() => s.wallet && exportWallet({ address: s.wallet })}>Export private key</button>
      </section>

      <section className="mt-4 p-1">
        <button className="btn-ghost text-danger" onClick={() => s.logout().then(() => (location.href = "/"))}>Sign out</button>
      </section>
    </div>
  );
}
