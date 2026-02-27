/**
 * llmService.ts
 *
 * Calls the server-side /api/llm proxy to generate rich, context-aware
 * coaching hints and move explanations. All API keys and endpoint details
 * stay on the server — the browser never sees them.
 *
 * Falls back gracefully when the proxy is unavailable or AI is disabled.
 */

// ── Proxy helper ────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Send messages to the server-side proxy at /api/llm.
 * The proxy attaches the API key and forwards to Azure/OpenAI.
 */
async function chatCompletion(
  messages: ChatMessage[],
  maxTokens = 300,
): Promise<string> {
  const res = await fetch('/api/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, max_tokens: maxTokens }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      (data as { error?: string }).error ?? `API proxy error ${res.status}`,
    );
  }

  const data = await res.json();
  const content = (data as { content?: string }).content?.trim();
  if (!content) throw new Error('Empty response from AI');
  return content;
}

// ── Public API ──────────────────────────────────────────────────────────────

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Ask the LLM for a coaching hint given the current position and engine data.
 * The hint should guide the player without revealing the exact move.
 */
export async function generateLLMHint(
  fen: string,
  bestMoveSan: string,
  bestMoveUci: string,
  scoreCp: number | null,
  mateIn: number | null,
  pv: string[],
  allMovesSan: string[],
): Promise<string> {
  const evalStr =
    mateIn !== null
      ? `mate in ${Math.abs(mateIn)}`
      : scoreCp !== null
        ? `${(scoreCp / 100).toFixed(1)} pawns`
        : 'unknown';

  const moveNumber = parseInt(fen.split(' ')[5] || '1');
  const phase =
    moveNumber <= 10 ? 'opening' : moveNumber <= 25 ? 'middlegame' : 'endgame';
  const sideToMove = fen.split(' ')[1] === 'w' ? 'White' : 'Black';

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are a friendly, expert chess coach. The student is playing as ${sideToMove} and it is their turn.

RULES:
- Give a helpful coaching hint that guides the student toward the best move WITHOUT telling them the exact move or the exact square.
- Mention the type of idea (tactic, positional plan, piece activity, king safety, pawn structure, etc.).
- You may mention which piece type to look at (e.g. "look at what your knight can do") but NEVER say the exact square it should go to.
- Keep the hint to 2-4 sentences, conversational and encouraging.
- Reference the game phase (${phase}) if relevant.
- Do NOT use chess notation like "Nf3" or "e2e4".`,
    },
    {
      role: 'user',
      content: `Position (FEN): ${fen}
Game phase: ${phase}
Engine's best move: ${bestMoveSan} (${bestMoveUci})
Evaluation: ${evalStr}
Principal variation (next few moves): ${pv.slice(0, 5).join(' ')}
Other candidate moves: ${allMovesSan.slice(1, 4).join(', ') || 'none'}

Give me a coaching hint for this position.`,
    },
  ];

  return chatCompletion(messages, 250);
}

/**
 * Ask the LLM to explain why a move was good/bad after the player moves.
 */
export async function generateLLMExplanation(
  fen: string,
  userMoveSan: string,
  bestMoveSan: string,
  quality: string,
  centipawnLoss: number,
  bestScoreCp: number | null,
  bestMateIn: number | null,
  userScoreCp: number | null,
  userMateIn: number | null,
): Promise<string> {
  const bestEvalStr =
    bestMateIn !== null
      ? `mate in ${Math.abs(bestMateIn)}`
      : bestScoreCp !== null
        ? `${(bestScoreCp / 100).toFixed(1)} pawns`
        : 'unknown';

  const userEvalStr =
    userMateIn !== null
      ? `mate in ${Math.abs(userMateIn)}`
      : userScoreCp !== null
        ? `${(userScoreCp / 100).toFixed(1)} pawns`
        : 'unknown';

  const moveNumber = parseInt(fen.split(' ')[5] || '1');
  const phase =
    moveNumber <= 10 ? 'opening' : moveNumber <= 25 ? 'middlegame' : 'endgame';
  const sideToMove = fen.split(' ')[1] === 'w' ? 'White' : 'Black';

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are a friendly, expert chess coach giving feedback on a student's move. The student is playing as ${sideToMove}.

RULES:
- Explain why the student's move was ${quality} in clear, instructive language.
- If the move wasn't the best, explain what the best move achieves that theirs doesn't.
- Mention relevant chess concepts (tactics, positional ideas, threats).
- Be encouraging even when the move was bad — focus on learning.
- Keep the explanation to 2-4 sentences.
- You may use standard chess notation (like Nf3, Bxe5) when referring to specific moves.`,
    },
    {
      role: 'user',
      content: `Position (FEN): ${fen}
Game phase: ${phase}
Student played: ${userMoveSan} (eval: ${userEvalStr})
Best move was: ${bestMoveSan} (eval: ${bestEvalStr})
Move quality: ${quality}
Centipawn loss: ${centipawnLoss}

Explain this move to me.`,
    },
  ];

  return chatCompletion(messages, 300);
}

/**
 * Continue a conversation about a chess position.
 * Sends the user's follow-up question along with prior conversation context.
 */
export async function chatFollowUp(
  question: string,
  fen: string,
  conversationHistory: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const moveNumber = parseInt(fen.split(' ')[5] || '1');
  const phase =
    moveNumber <= 10 ? 'opening' : moveNumber <= 25 ? 'middlegame' : 'endgame';
  const sideToMove = fen.split(' ')[1] === 'w' ? 'White' : 'Black';

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are a friendly, expert chess coach having a conversation with a student. The current position is in the ${phase} phase, and it is ${sideToMove} to move.

FEN: ${fen}

RULES:
- Answer the student's chess questions clearly and helpfully.
- You may use standard chess notation (like Nf3, Bxe5) when referring to specific moves.
- Be encouraging and instructive.
- Keep answers concise (2-5 sentences) unless the student asks for more detail.
- If the question is not about chess, politely redirect to chess topics.`,
    },
    ...conversationHistory.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    })),
    {
      role: 'user' as const,
      content: question,
    },
  ];

  return chatCompletion(messages, 400);
}
