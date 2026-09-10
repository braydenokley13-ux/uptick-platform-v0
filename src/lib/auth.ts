import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { localMode } from "./config";
import { sign, equal, encrypt, decrypt } from "./security";
import { getDb } from "./db";
import type { Actor } from "./domain";
const COOKIE = "uptick-session";
export async function setSession(userId: string, accessToken?: string) {
  const value = Buffer.from(
    JSON.stringify({
      userId,
      accessToken: accessToken ? encrypt(accessToken) : undefined,
      expires: Date.now() + 55 * 60 * 1000,
    }),
  ).toString("base64url");
  (await cookies()).set(COOKIE, `${value}.${sign(value)}`, {
    httpOnly: true,
    secure: !localMode(),
    sameSite: "lax",
    maxAge: 55 * 60,
    path: "/",
  });
}
export async function clearSession() {
  (await cookies()).delete(COOKIE);
}
export async function getActor(): Promise<Actor | null> {
  try {
    const raw = (await cookies()).get(COOKIE)?.value;
    if (!raw) return null;
    const parts = raw.split(".");
    if (parts.length !== 2) return null;
    const [value, sig] = parts;
    if (!value || !sig || !equal(sign(value), sig)) return null;
    const session = JSON.parse(Buffer.from(value, "base64url").toString());
    if (
      typeof session.userId !== "string" ||
      !Number.isFinite(session.expires) ||
      session.expires <= Date.now()
    )
      return null;
    if (!localMode()) {
      if (!session.accessToken) return null;
      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } },
      );
      const { data, error } = await supabase.auth.getUser(
        decrypt(session.accessToken),
      );
      if (error || data.user?.id !== session.userId) return null;
    }
    const [member] = await (
      await getDb()
    ).query<{
      user_id: string;
      role: "merchant" | "operator";
      organization_id: string;
      can_export: boolean;
    }>(
      "select * from memberships where user_id=$1 order by role desc limit 1",
      [session.userId],
    );
    return member
      ? {
          id: member.user_id,
          role: member.role,
          organizationId: member.organization_id,
          canExport: member.can_export,
        }
      : null;
  } catch {
    return null;
  }
}
export async function requireActor(operator = false) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (operator && actor.role !== "operator") redirect("/merchant");
  return actor;
}
