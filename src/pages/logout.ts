import type { APIRoute } from "astro";
import { destroySession } from "../lib/server/auth.ts";

export const POST: APIRoute = ({ cookies, redirect }) => {
  destroySession(cookies);
  return redirect("/login");
};
