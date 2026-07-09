/**
 * KRONEXA — Health Check Endpoint
 * Deploy como Edge Function: supabase functions deploy kronexa-health --project-ref ...
 *
 * Monitoramento simples: GET /health
 * Uso: Upptime, Checkly, ou qualquer uptime monitor
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req: Request) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Use GET" }), { status: 405, headers: cors });
  }

  const checks: Record<string, { status: string; latency_ms: number }> = {};

  // 1. Supabase DB
  const t0 = Date.now();
  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { error } = await sb.from("kh_clinicas").select("id").limit(1);
    checks.database = {
      status: error ? `error: ${error.message}` : "ok",
      latency_ms: Date.now() - t0,
    };
  } catch (e) {
    checks.database = { status: `error: ${e.message}`, latency_ms: Date.now() - t0 };
  }

  // 2. Gemini API
  const t1 = Date.now();
  try {
    const key = Deno.env.get("GEMINI_API_KEY");
    if (key) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          contents: [{ parts: [{ text: "ping" }] }], generationConfig: { maxOutputTokens: 1 },
        }) },
      );
      checks.gemini = { status: r.ok ? "ok" : `error: HTTP ${r.status}`, latency_ms: Date.now() - t1 };
    } else {
      checks.gemini = { status: "not_configured", latency_ms: 0 };
    }
  } catch (e) {
    checks.gemini = { status: `error: ${e.message}`, latency_ms: Date.now() - t1 };
  }

  // 3. Evolution API
  const t2 = Date.now();
  try {
    const url = Deno.env.get("EVOLUTION_API_URL");
    const key = Deno.env.get("EVOLUTION_API_KEY");
    if (url && key) {
      const r = await fetch(`${url}/instance/connectionState/mecani-oficina-01`, {
        headers: { apikey: key },
      });
      checks.evolution_api = { status: r.ok ? "ok" : `error: HTTP ${r.status}`, latency_ms: Date.now() - t2 };
    } else {
      checks.evolution_api = { status: "not_configured", latency_ms: 0 };
    }
  } catch (e) {
    checks.evolution_api = { status: `error: ${e.message}`, latency_ms: Date.now() - t2 };
  }

  const allOk = Object.values(checks).every(c => c.status === "ok" || c.status === "not_configured");

  return new Response(JSON.stringify({
    service: "kronexa",
    timestamp: new Date().toISOString(),
    status: allOk ? "healthy" : "degraded",
    checks,
    uptime_seconds: Math.floor(performance.now() / 1000),
  }), {
    status: allOk ? 200 : 503,
    headers: { ...cors, "Cache-Control": "no-store" },
  });
});
