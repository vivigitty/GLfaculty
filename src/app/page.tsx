import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const auth = await getAuth();
  redirect(!auth ? "/login" : auth.session.role === "ADMIN" ? "/admin" : "/faculty");
}
