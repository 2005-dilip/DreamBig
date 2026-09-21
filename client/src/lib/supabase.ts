import { createClient } from "@supabase/supabase-js";

// Public, browser-safe configuration. These come from Vite env vars
// (VITE_*), never from hardcoded secrets. The publishable/anon key is
// designed to be shipped to the browser and is gated by Supabase RLS.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined;

export const supabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

if (!supabaseConfigured) {
  // Surfaced in the console (not the UI) to help during setup. We avoid
  // printing the key value itself.
  console.warn(
    "[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. " +
      "Add them to your .env file."
  );
}

// A single shared client for the whole app. Auth session is persisted in
// localStorage so the owner stays signed in across reloads, and the
// authenticated JWT is automatically attached to every PostgREST request,
// which is what RLS policies rely on.
export const supabase = createClient(supabaseUrl ?? "", supabasePublishableKey ?? "", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
