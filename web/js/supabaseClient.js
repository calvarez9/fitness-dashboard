import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://geayvolcgdhenlrkmofn.supabase.co";
// Publishable/anon key — safe to expose client-side, protected by RLS.
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdlYXl2b2xjZ2RoZW5scmttb2ZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyODA0MDksImV4cCI6MjEwMjg1NjQwOX0.1m2uuECuSGqZcST77jJTjnVn1bDv0FiWJdnc1pcNq8M";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
