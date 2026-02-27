/**
 * Azure Function: POST /api/llm
 *
 * Server-side proxy for LLM chat completions. Keeps API keys and endpoint
 * details on the server — the browser never sees them.
 *
 * Expects JSON body: { messages: ChatMessage[], max_tokens?: number }
 * Returns JSON body: { content: string } or { error: string }
 *
 * Reads configuration from Application Settings (environment variables):
 *   LLM_PROVIDER          – "azure" | "openai"
 *   LLM_API_KEY           – secret key
 *   LLM_BASE_URL          – endpoint URL
 *   LLM_MODEL             – deployment name / model id
 *   LLM_AZURE_API_VERSION – Azure API version (only for azure provider)
 */

import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface RequestBody {
  messages: ChatMessage[];
  max_tokens?: number;
}

async function llmHandler(
  req: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  // ── Read config from env ────────────────────────────────────────────────
  const provider = (process.env.LLM_PROVIDER ?? 'azure').toLowerCase();
  const apiKey = process.env.LLM_API_KEY ?? '';
  const baseUrl = (process.env.LLM_BASE_URL ?? '').replace(/\/+$/, '');
  const model = process.env.LLM_MODEL ?? 'gpt-4o-mini';
  const azureApiVersion =
    process.env.LLM_AZURE_API_VERSION ?? '2024-12-01-preview';

  if (!apiKey || !baseUrl) {
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error:
          'LLM not configured on server. Set LLM_API_KEY and LLM_BASE_URL in Application Settings.',
      }),
    };
  }

  // ── Parse request ───────────────────────────────────────────────────────
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
    if (!body?.messages || !Array.isArray(body.messages)) {
      throw new Error('Missing or invalid "messages" array');
    }
  } catch (err) {
    return {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: err instanceof Error ? err.message : 'Invalid request body',
      }),
    };
  }

  const maxTokens = body.max_tokens ?? 300;

  // ── Build upstream request ──────────────────────────────────────────────
  let url: string;
  let headers: Record<string, string>;
  let payload: Record<string, unknown>;

  if (provider === 'azure') {
    url =
      `${baseUrl}/openai/deployments/${encodeURIComponent(model)}` +
      `/chat/completions?api-version=${encodeURIComponent(azureApiVersion)}`;
    headers = {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    };
    payload = {
      messages: body.messages,
      max_tokens: maxTokens,
      temperature: 0.7,
    };
  } else {
    // OpenAI / compatible
    url = `${baseUrl}/chat/completions`;
    headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
    payload = {
      model,
      messages: body.messages,
      max_tokens: maxTokens,
      temperature: 0.7,
    };
  }

  // ── Forward to LLM ─────────────────────────────────────────────────────
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      context.log(
        `LLM upstream error ${upstream.status}: ${errText.slice(0, 300)}`,
      );
      return {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `LLM returned ${upstream.status}` }),
      };
    }

    const data = await upstream.json();
    const content: string | undefined = (
      data as { choices?: { message?: { content?: string } }[] }
    )?.choices?.[0]?.message?.content?.trim();

    if (!content) {
      return {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Empty response from LLM' }),
      };
    }

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    };
  } catch (err) {
    context.log('LLM proxy error:', err);
    return {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: err instanceof Error ? err.message : 'LLM request failed',
      }),
    };
  }
}

app.http('llm', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'llm',
  handler: llmHandler,
});
