/** Retry 429 (rate limit) and 503 (overloaded) with exponential backoff. Max 3 attempts. */
export async function fetchWithRetry(url, options, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, options);
    const shouldRetry = (res.status === 429 || res.status === 503) && attempt < maxAttempts;
    if (!shouldRetry) return res;
    const retryAfter = parseInt(res.headers.get("retry-after") || "0", 10);
    const delayMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * 2 ** attempt, 10000);
    console.warn(`[ollama] ${res.status} ${res.status === 429 ? "Rate exceeded" : "Service unavailable"}, retry ${attempt}/${maxAttempts} in ${delayMs}ms`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null; // unreachable
}

export async function ollamaEmbed(text) {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
  
  // Truncate text if it's too long (embedding models have context limits)
  // nomic-embed-text has ~8192 token limit
  // Conservative estimate: ~4 chars per token, but use 10000 for safety
  const maxEmbeddingLength = parseInt(process.env.MAX_EMBEDDING_LENGTH || "10000", 10);
  let truncatedText = text;
  
  if (!text || typeof text !== "string") {
    throw new Error("Text must be a non-empty string");
  }
  
  if (text.length > maxEmbeddingLength) {
    console.warn(`[ollamaEmbed] Text length ${text.length} exceeds max embedding length ${maxEmbeddingLength}, truncating...`);
    truncatedText = text.substring(0, maxEmbeddingLength);
    // Try to truncate at a newline to avoid cutting mid-sentence
    const lastNewline = truncatedText.lastIndexOf("\n");
    if (lastNewline > maxEmbeddingLength * 0.9) {
      truncatedText = truncatedText.substring(0, lastNewline);
      console.warn(`[ollamaEmbed] Truncated at newline, final length: ${truncatedText.length}`);
    } else {
      console.warn(`[ollamaEmbed] Truncated at character limit, final length: ${truncatedText.length}`);
    }
  }

  // Additional safety check - if still too long after truncation, reduce further
  if (truncatedText.length > maxEmbeddingLength) {
    truncatedText = truncatedText.substring(0, maxEmbeddingLength);
    console.warn(`[ollamaEmbed] Additional truncation applied, final length: ${truncatedText.length}`);
  }

  // Try with progressively smaller sizes if it fails
  const sizesToTry = [truncatedText.length, 8000, 5000, 3000];
  
  for (const size of sizesToTry) {
    if (size > truncatedText.length) continue;
    
    let textToUse = truncatedText;
    if (size < truncatedText.length) {
      textToUse = truncatedText.substring(0, size);
      const lastNewline = textToUse.lastIndexOf("\n");
      if (lastNewline > size * 0.9) {
        textToUse = textToUse.substring(0, lastNewline);
      }
      console.warn(`[ollamaEmbed] Trying with ${textToUse.length} chars...`);
    }

    try {
      let res;
      try {
        res = await fetchWithRetry(`${baseUrl}/api/embeddings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt: textToUse }),
        });
        if (!res) throw new Error("429 retries exhausted");
      } catch (fetchErr) {
        const cause = fetchErr?.cause?.message || fetchErr?.cause || fetchErr?.message;
        throw new Error(`Ollama embeddings fetch failed (${baseUrl}): ${cause}`);
      }

      if (!res.ok) {
        const body = await res.text();
        const isContextLengthError = body.toLowerCase().includes("context length") || 
                                     body.toLowerCase().includes("exceeds the context") ||
                                     body.toLowerCase().includes("input length exceeds");
        
        if (isContextLengthError && size > 3000) {
          console.warn(`[ollamaEmbed] Context length error with ${textToUse.length} chars, trying smaller size...`);
          continue;
        }
        
        throw new Error(`Ollama embeddings failed: ${res.status} ${body.slice(0, 200)}`);
      }

      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        const body = await res.text();
        throw new Error(`Ollama returned non-JSON (${ct}): ${body.slice(0, 150)}`);
      }
      const data = await res.json();
      if (!data?.embedding?.length) throw new Error("No embedding returned from Ollama");
      return data.embedding;
    } catch (error) {
      // If it's a context length error and we have more sizes to try, continue
      if (error.message.includes("context length") || error.message.includes("exceeds") && size > 3000) {
        console.warn(`[ollamaEmbed] Error with ${textToUse.length} chars: ${error.message}, trying smaller...`);
        continue;
      }
      // Otherwise, rethrow
      throw error;
    }
  }
  
  // If we get here, all sizes failed
  throw new Error(`Ollama embeddings failed: Could not find a text size that works (tried sizes: ${sizesToTry.join(", ")})`);

  const data = await res.json();
  if (!data?.embedding?.length) throw new Error("No embedding returned from Ollama");
  return data.embedding;
}

export async function ollamaChat({ prompt }) {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_CHAT_MODEL || "llama3.1";

  let res;
  try {
    res = await fetchWithRetry(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false
      }),
    });
    if (!res) throw new Error("429 retries exhausted");
  } catch (fetchErr) {
    const cause = fetchErr?.cause?.message || fetchErr?.cause || fetchErr?.message;
    throw new Error(`Ollama generate fetch failed (${baseUrl}): ${cause}`);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama generate failed: ${res.status} ${body.slice(0, 200)}`);
  }

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const body = await res.text();
    throw new Error(`Ollama returned non-JSON (${ct}): ${body.slice(0, 150)}`);
  }
  const data = await res.json();
  return (data?.response || "").trim();
}
