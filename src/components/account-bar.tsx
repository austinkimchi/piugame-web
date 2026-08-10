import { LogOut } from "lucide-react";

import { AccountPreferencesPopup } from "@/components/account-preferences-popup";
import { AccountSignInPopup } from "@/components/account-sign-in-popup";
import { AdminViewBadge } from "@/components/admin-view-badge";
import { AccountIntegrations } from "@/components/account-integrations";
import { UsernamePrompt } from "@/components/username-prompt";
import { getCurrentUser } from "@/lib/auth";
import { hasDiscordOAuthConfig } from "@/lib/discord-oauth";
import { hasGoogleOAuthConfig } from "@/lib/google-oauth";

export async function AccountBar() {
  const user = await getCurrentUser();
  const googleReady = hasGoogleOAuthConfig();
  const discordReady = hasDiscordOAuthConfig();

  return (
    <div className="flex max-w-[calc(100vw-2.5rem)] items-center gap-2">
      {user ? (
        <>
          {user.username ? (
            <AccountPreferencesPopup user={user} />
          ) : (
            <UsernamePrompt variant="modal" />
          )}
          {user.roles.includes("admin") ? (
            <AdminViewBadge />
          ) : null}
          <AccountIntegrations user={user} discordReady={discordReady} />
          <form action="/api/auth/logout" method="post">
            <button className="inline-flex h-12 w-12 items-center justify-center border border-[#cdd5c5] bg-white/70 text-[#56604e] shadow-[0_10px_28px_rgba(29,35,24,0.07)] backdrop-blur transition hover:border-[#28c950] hover:bg-white hover:text-[#28c950]" title="Sign out" type="submit">
              <LogOut aria-hidden="true" size={17} />
            </button>
          </form>
        </>
      ) : (
        <AccountSignInPopup discordReady={discordReady} googleReady={googleReady} />
      )}
    </div>
  );
}
