import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/lib/security";
export default async function YourUptickRedirect() {
  let token: string | undefined;
  try {
    const value = (await cookies()).get("uptick-member-access")?.value;
    if (value) token = decrypt(value);
  } catch {}
  redirect(token ? `/u/${token}` : "/join");
}
