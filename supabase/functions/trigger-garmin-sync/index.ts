// Lets the dashboard trigger the "Garmin sync (manual)" GitHub Actions
// workflow with a single fetch() call from the client, instead of sending
// you to github.com to click "Run workflow" yourself.
//
// Why this has to exist at all: triggering a GitHub Actions workflow needs
// a GitHub token with permission to do that, and a token like that is just
// as sensitive as the Supabase service_role key -- it can never be
// embedded in the dashboard's public HTML/JS. This function is what keeps
// it off the public page: the token (GITHUB_PAT) lives only in this
// function's own server-side environment (set once via the Supabase CLI,
// see the deploy instructions), and the browser only ever holds the
// public anon key, which is safe to expose the same way it already is
// everywhere else in this app.
//
// Deploy: supabase functions deploy trigger-garmin-sync
// Secret:  supabase secrets set GITHUB_PAT=github_pat_xxx

const GITHUB_OWNER = "calvarez9";
const GITHUB_REPO = "fitness-dashboard";
const WORKFLOW_FILE = "garmin-sync.yml";

Deno.serve(async (req) => {
  // Only POST, and only with a valid Supabase anon/authenticated request --
  // supabase.functions.invoke() from the client already sends the right
  // apikey/Authorization headers automatically, this just guards against
  // a bare unauthenticated request from elsewhere hitting the endpoint.
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }
  const apikey = req.headers.get("apikey");
  if (!apikey) {
    return new Response(JSON.stringify({ error: "Missing apikey" }), { status: 401 });
  }

  const githubPat = Deno.env.get("GITHUB_PAT");
  if (!githubPat) {
    return new Response(JSON.stringify({ error: "GITHUB_PAT secret not configured on this function" }), { status: 500 });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine -- backfill_days/activities_limit are both optional
  }
  const inputs: Record<string, string> = {};
  if (body.backfillDays) inputs.backfill_days = String(body.backfillDays);
  if (body.activitiesLimit) inputs.activities_limit = String(body.activitiesLimit);

  const ghRes = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubPat}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main", inputs }),
    }
  );

  if (!ghRes.ok) {
    const text = await ghRes.text();
    return new Response(JSON.stringify({ error: `GitHub API ${ghRes.status}: ${text}` }), { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
