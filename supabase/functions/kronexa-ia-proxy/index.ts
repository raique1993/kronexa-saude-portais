/**
 * KRONEXA — Proxy de IA Compartilhado
 * Edge Function que protege a chave Gemini no servidor
 * Deploy: supabase functions deploy kronexa-ia-proxy --project-ref tcjynyfusqkqtdohnyzq
 *
 * Rate limit: 50 req/dia por tenant (demo), 500 req/dia (pro)
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Rate limiting simples em memoria (reseta no cold start)
const dailyUsage = new Map<string, number>();
const DAILY_LIMIT = 50;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { prompt, imageBase64, tenant_id, action } = body;

    if (!prompt) {
      return new Response(JSON.stringify({ error: "prompt obrigatorio" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit por tenant
    const key = tenant_id || "anonymous";
    const used = dailyUsage.get(key) || 0;
    if (used >= DAILY_LIMIT) {
      return new Response(JSON.stringify({
        error: `Limite diario de ${DAILY_LIMIT} analises atingido. Faca upgrade para o plano Pro.`,
        used, limit: DAILY_LIMIT,
      }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    dailyUsage.set(key, used + 1);

    if (!GEMINI_KEY) {
      return new Response(JSON.stringify({ error: "IA nao configurada no servidor" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Montar payload Gemini
    const parts: Array<Record<string, unknown>> = [];
    if (imageBase64) {
      parts.push({ inline_data: { mime_type: "image/jpeg", data: imageBase64 } });
    }
    parts.push({ text: prompt });

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
        }),
      },
    );

    const data = await geminiRes.json();

    if (data.error) {
      return new Response(JSON.stringify({ error: data.error.message }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    return new Response(JSON.stringify({ ok: true, text, used: used + 1, limit: DAILY_LIMIT }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: "Erro interno" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
