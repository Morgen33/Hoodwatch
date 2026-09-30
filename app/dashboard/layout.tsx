import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/SignInButton";
import { getUser } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const { supabase, user } = await getUser();
  if (!user) redirect("/");
  const { data: profile } = await supabase.from("profiles").select("x_handle, avatar_url").eq("id", user.id).single();

  const nav = [
    ["/dashboard", "Spaces"],
    ["/dashboard/regulars", "Regulars"],
    ["/dashboard/campaigns", "Allowlists"],
    ["/dashboard/extension", "Extension"],
  ];

  return (
    <div className="flex-1 flex flex-col">
      <header className="border-b" style={{ borderColor: "var(--line)" }}>
        <div className="mx-auto max-w-6xl px-5 h-14 flex items-center gap-6">
          <Link href="/dashboard" className="font-black tracking-tight text-lg">
            tapped<span style={{ color: "var(--accent)" }}>in</span>
          </Link>
          <nav className="flex gap-1 overflow-x-auto">
            {nav.map(([href, label]) => (
              <Link key={href} href={href} className="px-3 py-1.5 rounded-lg text-sm muted hover:text-white hover:bg-white/5">
                {label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {profile?.avatar_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatar_url} alt="" width={28} height={28} className="rounded-full" />
            )}
            <span className="text-sm hidden sm:inline">@{profile?.x_handle ?? "you"}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl w-full px-5 py-8 flex-1">{children}</main>
    </div>
  );
}
