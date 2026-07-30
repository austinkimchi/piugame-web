import { notFound } from "next/navigation";

import { AdminDashboard } from "@/components/admin-dashboard";
import { getCurrentUser, isAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!isAdmin(user)) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[#f7f8f2]">
      <AdminDashboard />
    </main>
  );
}
