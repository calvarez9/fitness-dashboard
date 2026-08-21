import { supabase } from "./supabaseClient.js";

const $ = (sel) => document.querySelector(sel);

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
    const email = $("#loginEmail").value.trim();
    const password = $("#loginPassword").value;
    $("#loginError").hidden = true;
    if (!email || !password) return;

    $("#loginBtn").disabled = true;
    $("#loginBtn").textContent = "Signing in…";
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    $("#loginBtn").disabled = false;
    $("#loginBtn").textContent = "Sign in";

    if (error) {
      $("#loginError").textContent = error.message;
      $("#loginError").hidden = false;
    }
  });
  $("#loginPassword").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#loginBtn").click();
  });

  $("#recoveryBtn").addEventListener("click", async () => {
    const p1 = $("#recoveryPassword").value;
    const p2 = $("#recoveryPassword2").value;
    $("#recoveryError").hidden = true;

    if (p1.length < 8) {
      $("#recoveryError").textContent = "Password must be at least 8 characters.";
      $("#recoveryError").hidden = false;
      return;
    }
    if (p1 !== p2) {
      $("#recoveryError").textContent = "Passwords don't match.";
      $("#recoveryError").hidden = false;
      return;
    }

    $("#recoveryBtn").disabled = true;
    $("#recoveryBtn").textContent = "Saving…";
    const { error } = await supabase.auth.updateUser({ password: p1 });
    $("#recoveryBtn").disabled = false;
    $("#recoveryBtn").textContent = "Set password";

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
