import { parseAlert } from "./parser/parserEngine.js";
import { decide } from "./decision/decide.js";
import { formatReport } from "./report/formatReport.js";
import { retrieveContexts } from "./rag/retrieve.js";
import { buildRagPrompt } from "./rag/prompt.js";
import { ollamaChat } from "./rag/ollama.js";

/**
 * Combined Logic: 
 * 1. Try Parser (Regex/LLM Policy)
 * 2. Always run RAG to get context from Slack history
 * 3. Return both results if available
 */
export async function processIncomingMessage({ text, channel_id }) {
  // --- PHASE 1: PARSER ENGINE ---
  // Uses your existing parserEngine.js logic 
  const parseResult = await parseAlert(text);
  let policyResult = null;

  if (parseResult.matched) {
    // Make decision (AUTO_REPLACE vs NEEDS_APPROVAL)
    const decision = decide(parseResult.parsed, parseResult.policy);
    
    // Format the remediation report/action
    const report = await formatReport({ 
      parsed: parseResult.parsed, 
      decision, 
      policy: parseResult.policy,
      originalText: text
    });
    
    policyResult = {
      source: "policy_engine",
      text: report.summary,
      data: report
    };
  }

  // --- PHASE 2: RAG (Always run, even if policy matched) ---
  // Always look through Slack history for context
  const contexts = await retrieveContexts({ channel_id, question: text });
  let ragResult = null;
  
  if (contexts.length > 0) {
    const prompt = buildRagPrompt({ question: text, contexts });
    const answer = await ollamaChat({ prompt });
    
    ragResult = {
      source: "rag_history",
      text: answer || "I found history but couldn't generate a response.",
      data: null
    };
  }

  // --- COMBINE RESULTS ---
  // If both policy and RAG matched, combine them
  if (policyResult && ragResult) {
    return {
      source: "both",
      text: `${policyResult.text}\n\n--- Additional Context from Slack History ---\n\n${ragResult.text}`,
      policy_result: policyResult,
      rag_result: ragResult,
      data: policyResult.data
    };
  }
  
  // If only policy matched
  if (policyResult) {
    return {
      ...policyResult,
      rag_result: null
    };
  }
  
  // If only RAG matched
  if (ragResult) {
    return {
      ...ragResult,
      policy_result: null
    };
  }

  // Neither matched
  return {
    source: "none",
    text: "I couldn't identify an action or find relevant history to answer that.",
    policy_result: null,
    rag_result: null,
    data: null
  };
}
