import "server-only";

import { createClient } from "@supabase/supabase-js";

// Privileged client for the reviewed recommendation-saving RPC only.
// Never use this to load requests or candidates from browser-supplied IDs.
// The calling Server Action must first verify login and request ownership.
export function createMatchingWriter() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error("Server database configuration is missing.");
  }

  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}