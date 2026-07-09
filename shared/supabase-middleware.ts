/**
 * KRONEXA — Cliente Supabase Unificado + Middleware para Edge Functions
 *
 * Uso:
 *   import { createSB, corsHeaders, errorResponse, successResponse, requireAuth } from "../shared/supabase-middleware.ts"
 *
 * Segurança: Service role key NUNCA deve ser usada. Use anon key + RLS para operações
 * de leitura, e service role apenas para operações administrativas essenciais.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ═══ CORS RESTRITO ═══
const ALLOWED_ORIGINS = [
  "https://saude.kronexa.com.br",
  "https://store.kronexa.com.br",
  "https://app.kronexa.com.br",
  "https://social.kronexa.com.br",
  "https://kronexa.com.br",
  "https://mecaniia.com.br",
];

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) || origin.startsWith("http://localhost")
    ? origin : ALLOWED_ORIGINS[0];

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

// ═══ CLIENTES SUPABASE ═══

/** Cliente anon (seguro para frontend — usa RLS) */
export function createSB() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
}

/** Cliente admin (apenas para operações que realmente precisam — use com cautela) */
export function createSBAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// ═══ RESPONSES PADRONIZADAS ═══
export function successResponse(data: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify({ ok: true, ...data as object }), {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

export function errorResponse(message: string, status = 400, headers: Record<string, string>) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

// ═══ VALIDAÇÃO DE INPUT ═══
export function validateRequired(body: Record<string, unknown>, fields: string[]): string | null {
  for (const field of fields) {
    if (!body[field]) return `Campo obrigatorio ausente: ${field}`;
  }
  return null;
}

export function sanitizeString(input: string, maxLength = 5000): string {
  return input
    .replace(/<\/?[^>]+(>|$)/g, "")  // Remove HTML tags
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")  // Remove control chars
    .substring(0, maxLength);
}

// ═══ RATE LIMITING ═══
const rateLimitStore = new Map<string, { count: number; reset: number }>();

export function checkRateLimit(key: string, maxRequests = 100, windowMs = 60000): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (!entry || now > entry.reset) {
    rateLimitStore.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}

// ═══ LOGGING ESTRUTURADO ═══
export function log(level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  };
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(JSON.stringify(entry));
}
