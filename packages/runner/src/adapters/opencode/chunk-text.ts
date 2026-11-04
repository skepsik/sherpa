/** Лимит текста `send_message` / inbound message на проводе контракта. */
export const ASSISTANT_TEXT_CHUNK_MAX = 4096;

/** Режет текст на куски ≤ лимита; пустая строка → []. */
export function listTextChunks(
  text: string,
  maxChars: number = ASSISTANT_TEXT_CHUNK_MAX,
): string[] {
  if (text.length === 0) return [];
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += maxChars) {
    chunks.push(text.slice(offset, offset + maxChars));
  }
  return chunks;
}
