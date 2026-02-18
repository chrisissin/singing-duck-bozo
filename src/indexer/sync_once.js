import "dotenv/config";
import { ensureSecrets } from "../db/ensureSecrets.js";
import { slackClient } from "../slack/client.js";
import { UserResolver } from "../slack/userResolver.js";
import { listAllPublicChannels, fetchHistory, fetchThreadReplies } from "./slackFetch.js";
import { buildThreadChunk, buildWindows } from "./chunker.js";
import { ollamaEmbed } from "../rag/ollama.js";
import { upsertChunk, getCursor, setCursor } from "../db/slackChunksRepo.js";

/**
 * Incremental sync:
 * - Ensure all public channels the bot is a member of have a cursor row
 * - For each channel, fetch history since latest_ts and index new content
 *
 * Safe default: still indexes only what the bot can see.
 */
async function main() {
  await ensureSecrets();
  const web = slackClient();
  const resolver = new UserResolver(web);

  const auth = await web.auth.test();
  const team_id = auth.team_id;

  const limit = parseInt(process.env.HISTORY_PAGE_LIMIT || "200", 10);
  const maxMessages = parseInt(process.env.MAX_MESSAGES_PER_WINDOW || "20", 10);
  const maxMinutes = parseInt(process.env.MAX_WINDOW_MINUTES || "10", 10);
  const channelDelayMs = parseInt(process.env.SLACK_CHANNEL_DELAY_MS || "6000", 10);
  const threadDelayMs = parseInt(process.env.SLACK_THREAD_DELAY_MS || "1000", 10);
  const embedConcurrency = parseInt(process.env.INDEXER_EMBED_CONCURRENCY || "4", 10);

  const channels = await listAllPublicChannels(web);
  console.log(`Syncing ${channels.length} channels...`);

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    if (i > 0 && channelDelayMs > 0) {
      await new Promise((r) => setTimeout(r, channelDelayMs));
    }
    const channel_id = ch.id;
    const channel_name = ch.name;

    const cursor = await getCursor({ team_id, channel_id });

    // If no cursor yet, initialize cursor to "now" (don't backfill unexpectedly)
    if (!cursor) {
      // Use the latest message ts as baseline
      const recent = await fetchHistory(web, channel_id, { oldest: undefined, limit: 10 });
      const latest = recent[recent.length - 1]?.ts;
      if (latest) await setCursor({ team_id, channel_id, latest_ts: latest });
      console.log(`Initialized cursor for #${channel_name} to ${latest || "n/a"}`);
      continue;
    }

    // Fetch messages after cursor. Slack 'oldest' is inclusive; add a tiny epsilon by string math isn't safe.
    // We'll dedupe via chunk_key anyway, so inclusive is OK.
    const newMessages = await fetchHistory(web, channel_id, { oldest: cursor, limit });

    if (!newMessages.length) {
      // nothing new
      continue;
    }

    console.log(`#${channel_name}: ${newMessages.length} new-ish messages since ${cursor}`);

    const threadRoots = new Set();
    const nonThread = [];

    for (const m of newMessages) {
      if (!m?.text) continue;
      if (m.thread_ts) {
        threadRoots.add(m.thread_ts);
        continue;
      }
      nonThread.push(m);
    }

    const chunksToEmbed = [];

    let threadIdx = 0;
    for (const thread_ts of threadRoots) {
      if (threadIdx > 0 && threadDelayMs > 0) await new Promise((r) => setTimeout(r, threadDelayMs));
      threadIdx++;
      const threadMsgs = await fetchThreadReplies(web, channel_id, thread_ts, { limit });
      if (!threadMsgs?.length) continue;

      const chunk = await buildThreadChunk({
        team_id,
        channel: channel_id,
        channel_name,
        thread_ts,
        messages: threadMsgs,
        resolver
      });

      if (chunk.text?.trim()) chunksToEmbed.push(chunk);
    }

    const windows = await buildWindows({
      team_id,
      channel: channel_id,
      channel_name,
      messages: nonThread,
      resolver,
      maxMessages,
      maxMinutes
    });

    for (const w of windows) {
      if (w.text?.trim()) chunksToEmbed.push(w);
    }

    if (chunksToEmbed.length > 0) {
      async function processWithConcurrency(items, fn, concurrency) {
        const results = [];
        for (let i = 0; i < items.length; i += concurrency) {
          const batch = items.slice(i, i + concurrency);
          const batchResults = await Promise.all(batch.map((item) => fn(item)));
          results.push(...batchResults);
        }
        return results;
      }
      await processWithConcurrency(
        chunksToEmbed,
        async (chunk) => {
          try {
            const embedding = await ollamaEmbed(chunk.text);
            await upsertChunk({ ...chunk, embedding });
          } catch (e) {
            console.error(`[indexer] Ollama embed failed for #${channel_name}:`, e?.message || e);
            throw e;
          }
        },
        embedConcurrency
      );
    }

    const latest_ts = newMessages[newMessages.length - 1]?.ts;
    if (latest_ts) {
      await setCursor({ team_id, channel_id, latest_ts });
      console.log(`#${channel_name}: cursor -> ${latest_ts}`);
    }
  }

  console.log("Sync once complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
