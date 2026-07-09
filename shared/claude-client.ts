/**
 * KRONEXA — Cliente Claude Unificado (Fable 5)
 *
 * Uso: import { claude } from "./shared/claude-client.ts"
 *
 * Modelos:
 *   claude-fable-5   — mais capaz, tarefas complexas, diagnósticos
 *   claude-opus-4-8  — melhor custo-benefício, tarefas de produção
 *   claude-sonnet-5  — rápido, tarefas simples, classificação
 *
 * Segurança: API key via variável de ambiente CLAUDE_API_KEY
 */

const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY") || "";

// ═══ TIPOS ═══
export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | ClaudeContentBlock[];
}

export interface ClaudeContentBlock {
  type: "text" | "image";
  text?: string;
  source?: { type: "base64"; media_type: string; data: string };
}

export interface ClaudeOptions {
  model?: string;
  max_tokens?: number;
  system?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  stream?: boolean;
  tools?: ClaudeTool[];
}

export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ClaudeResponse {
  text: string;
  model: string;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

// ═══ CLIENTE PRINCIPAL ═══
export const claude = {
  /**
   * Chamada simples — texto
   */
  async ask(prompt: string, opts: ClaudeOptions = {}): Promise<ClaudeResponse> {
    const res = await callClaude({
      model: opts.model || "claude-sonnet-5",
      max_tokens: opts.max_tokens || 4096,
      system: opts.system,
      effort: opts.effort,
      messages: [{ role: "user", content: prompt }],
      tools: opts.tools,
    });
    return res;
  },

  /**
   * Chamada com conversa multi-turn
   */
  async chat(messages: ClaudeMessage[], opts: ClaudeOptions = {}): Promise<ClaudeResponse> {
    const res = await callClaude({
      model: opts.model || "claude-sonnet-5",
      max_tokens: opts.max_tokens || 4096,
      system: opts.system,
      effort: opts.effort,
      messages,
      tools: opts.tools,
    });
    return res;
  },

  /**
   * Diagnóstico clínico — usa Fable 5 com alto effort
   */
  async diagnosticar(prompt: string, imagemBase64?: string): Promise<ClaudeResponse> {
    const content: ClaudeContentBlock[] = [];
    if (imagemBase64) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: imagemBase64 },
      });
    }
    content.push({ type: "text", text: prompt });

    return callClaude({
      model: "claude-fable-5",
      max_tokens: 16000,
      effort: "xhigh",
      system: `Voce e um assistente de diagnostico clinico.
Forneca analise com:
- Diagnosticos diferenciais (alta/media/baixa probabilidade)
- CID-10 correspondente
- Recomendacoes baseadas em evidencias
- Referencias bibliograficas (PubMed/DOI quando disponivel)
IMPORTANTE: Sempre inclua o disclaimer "Este e um diagnostico assistido por IA. Confirmacao clinica e obrigatoria."`,
      messages: [{ role: "user", content }],
    });
  },

  /**
   * Verifica se a API key está configurada
   */
  isConfigured(): boolean {
    return !!CLAUDE_API_KEY;
  },
};

// ═══ IMPLEMENTAÇÃO ═══
async function callClaude(params: {
  model: string;
  max_tokens: number;
  system?: string;
  effort?: string;
  messages: ClaudeMessage[];
  tools?: ClaudeTool[];
}): Promise<ClaudeResponse> {
  if (!CLAUDE_API_KEY) {
    throw new Error("CLAUDE_API_KEY nao configurada. Configure no Supabase Dashboard > Edge Functions > Secrets.");
  }

  const isFableModel = params.model.includes("fable");
  const isNewModel = params.model.includes("sonnet-5") || params.model.includes("opus-4-8") || params.model.includes("opus-4-7") || isFableModel;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": CLAUDE_API_KEY,
    "anthropic-version": "2023-06-01",
  };

  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.max_tokens,
    messages: params.messages,
  };

  if (params.system) body.system = params.system;
  if (params.tools) body.tools = params.tools;

  // Fable 5: omitir thinking (sempre ligado, explicit disabled = 400)
  // Opus 4.8/4.7 e Sonnet 5: adaptive thinking com effort
  if (isNewModel && !isFableModel) {
    body.thinking = { type: "adaptive" };
  }

  // Effort: controla profundidade do pensamento
  if (params.effort && isNewModel) {
    body.output_config = { effort: params.effort };
  }

  // Fable 5 fallback para Opus 4.8 em caso de refusal
  if (isFableModel) {
    headers["anthropic-beta"] = "server-side-fallback-2026-06-01";
    body.betas = ["server-side-fallback-2026-06-01"];
    body.fallbacks = [{ model: "claude-opus-4-8" }];
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (data.error) {
    throw new Error(`Claude API (${data.error.type}): ${data.error.message}`);
  }

  // Fable 5: refusal handling
  if (data.stop_reason === "refusal") {
    return {
      text: "[Conteudo recusado por politica de seguranca]",
      model: data.model,
      stop_reason: "refusal",
      usage: data.usage || { input_tokens: 0, output_tokens: 0 },
    };
  }

  const text = data.content?.find((b: { type: string }) => b.type === "text")?.text || "";

  return {
    text,
    model: data.model,
    stop_reason: data.stop_reason,
    usage: {
      input_tokens: data.usage?.input_tokens || 0,
      output_tokens: data.usage?.output_tokens || 0,
    },
  };
}
