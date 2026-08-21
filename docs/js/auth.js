import { supabase } from "./supabaseClient.js";

const $ = (sel) => document.querySelector(sel);

// This dashboard has exactly one account (yours), so the login gate is
// just a 6-digit PIN -- Supabase auth still enforces it server-side (this
// email isn't a secret in the first place, and the real credential is the
// PIN itself, checked by Supabase, not by this JS).
const ACCOUNT_EMAIL = "carlos.alvarez9@upr.edu";
const PIN_PATTERN = /^\d{6}$/;

export function initAuth({ onSignedIn, onSignedOut }) {
  let inRecovery = false;

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

  supabase.auth.getSession().then(({ data }) => {
    if (inRecovery) return;
    if (data.session) onSignedIn(data.session);
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
    const { error } = await supabase.auth.signInWithPassword({ email: ACCOUNT_EMAIL, password: pin });
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
    const { error } = await supabase.auth.updateUser({ password: p1 });
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
