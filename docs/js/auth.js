import { supabase } from "./supabaseClient.js";

const $ = (sel) => document.querySelector(sel);

// This dashboard has exactly one account (yours), so the login gate is
// just a 6-digit PIN -- Supabase auth still enforces it server-side (this
// email isn't a secret in the first place, and the real credential is the
// PIN itself, checked by Supabase, not by this JS).
const ACCOUNT_EMAIL = "carlos.alvarez9@upr.edu";
const PIN_PATTERN = /^\d{6}$/;

// Supabase's project-level password policy requires more than 8 characters
// (confirmed by the actual rejection: a bare 6-digit PIN doesn't clear it,
// and that's a project auth setting, not something this client-side code
// controls). Rather than change that policy or drop to a real password
// field, pad the PIN into something that satisfies it before it ever
// reaches Supabase -- the UI still only asks for 6 digits either way, and
// the fixed pad isn't the secret, the PIN still is.
function toSupabasePassword(pin) {
  return `fit-${pin}-dash`;
}

export function initAuth({ onSignedIn, onSignedOut }) {
  let inRecovery = false;

  // Single source of truth for auth state -- onAuthStateChange already
  // fires an INITIAL_SESSION event with the current session right after
  // registration, so a separate getSession() call is not just redundant
  // but actively dangerous here: on a real recovery-link visit it can
  // resolve with the now-valid session *before* the PASSWORD_RECOVERY
  // event has set inRecovery, calling onSignedIn() directly and skipping
  // the recovery screen entirely. Confirmed this was happening: a live
  // test of the verifyOtp recovery flow showed the real event order is
  // INITIAL_SESSION (no session yet) then PASSWORD_RECOVERY (session
  // now valid) -- both handled here, in order, by one listener, no race.
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      inRecovery = true;
      $("#loginView").hidden = true;
      $("#recoveryView").hidden = false;
      return;
    }
    if (inRecovery) return; // wait for the recovery form instead of jumping to the dashboard
    if (session) onSignedIn(session);
    else onSignedOut();
  });

  $("#loginBtn").addEventListener("click", async () => {
    const pin = $("#loginPin").value.trim();
    $("#loginError").hidden = true;

    if (!PIN_PATTERN.test(pin)) {
      $("#loginError").textContent = "Enter your 6-digit PIN.";
      $("#loginError").hidden = false;
      return;
    }

    $("#loginBtn").disabled = true;
    $("#loginBtn").textContent = "Signing in…";
    const { error } = await supabase.auth.signInWithPassword({ email: ACCOUNT_EMAIL, password: toSupabasePassword(pin) });
    $("#loginBtn").disabled = false;
    $("#loginBtn").textContent = "Sign in";

    if (error) {
      $("#loginError").textContent = error.message;
      $("#loginError").hidden = false;
    }
  });
  $("#loginPin").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#loginBtn").click();
  });

  $("#recoveryBtn").addEventListener("click", async () => {
    const p1 = $("#recoveryPassword").value.trim();
    const p2 = $("#recoveryPassword2").value.trim();
    $("#recoveryError").hidden = true;

    if (!PIN_PATTERN.test(p1)) {
      $("#recoveryError").textContent = "PIN must be exactly 6 digits.";
      $("#recoveryError").hidden = false;
      return;
    }
    if (p1 !== p2) {
      $("#recoveryError").textContent = "PINs don't match.";
      $("#recoveryError").hidden = false;
      return;
    }

    $("#recoveryBtn").disabled = true;
    $("#recoveryBtn").textContent = "Saving…";
    const { error } = await supabase.auth.updateUser({ password: toSupabasePassword(p1) });
    $("#recoveryBtn").disabled = false;
    $("#recoveryBtn").textContent = "Set PIN";

    if (error) {
      $("#recoveryError").textContent = error.message;
      $("#recoveryError").hidden = false;
      return;
    }

    inRecovery = false;
    $("#recoveryView").hidden = true;
    const { data } = await supabase.auth.getSession();
    if (data.session) onSignedIn(data.session);
  });

  $("#signOutBtn").addEventListener("click", () => supabase.auth.signOut());
}
