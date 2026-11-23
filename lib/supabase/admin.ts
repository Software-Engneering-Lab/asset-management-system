// ADMIN Supabase client – uses the SECRET key, which can change any user's password.
// Use ONLY from server code ("use server" actions). Never import it in a
// "use client" component, and never prefix the key with NEXT_PUBLIC_.
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("createAdminClient() must only run on the server.");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error("SUPABASE_SECRET_KEY is missing from .env.local (server only).");
  }
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
