/**
 * Chat memory ONLY. No product catalogue data is stored here beyond the
 * lightweight references needed to resolve "the second one".
 *
 * The store is defined behind an interface so a Redis/Postgres implementation
 * can be dropped in without touching chat.service.js.
 */

const RECENT_MESSAGE_LIMIT = 5;
const SUMMARIZE_AFTER = 10;
const THREAD_TTL_MS = 1000 * 60 * 60 * 2;

/** @typedef {{role:"user"|"assistant", content:string, at:number}} ChatMessage */

/**
 * @typedef {object} ThreadState
 * @property {string} threadId
 * @property {string} summary rolling summary of everything older than the window
 * @property {ChatMessage[]} messages
 * @property {{position:number, productId:string, title:string, url:string|null}[]} lastShownProducts
 * @property {string|null} lastSelectedProductId
 * @property {number} updatedAt
 */

export class MemoryStore {
  // eslint-disable-next-line no-unused-vars
  async get(threadId) {
    throw new Error("not implemented");
  }
  // eslint-disable-next-line no-unused-vars
  async set(threadId, state) {
    throw new Error("not implemented");
  }
  // eslint-disable-next-line no-unused-vars
  async delete(threadId) {
    throw new Error("not implemented");
  }
}

export class InMemoryStore extends MemoryStore {
  constructor() {
    super();
    /** @type {Map<string, ThreadState>} */
    this.threads = new Map();
  }

  async get(threadId) {
    const state = this.threads.get(threadId);
    if (!state) return null;
    if (Date.now() - state.updatedAt > THREAD_TTL_MS) {
      this.threads.delete(threadId);
      return null;
    }
    return state;
  }

  async set(threadId, state) {
    this.threads.set(threadId, state);
  }

  async delete(threadId) {
    this.threads.delete(threadId);
  }
}

let store = new InMemoryStore();

/** Swap in a persistent implementation at boot. */
export function setMemoryStore(nextStore) {
  store = nextStore;
}

function emptyState(threadId) {
  return {
    threadId,
    summary: "",
    messages: [],
    lastShownProducts: [],
    lastSelectedProductId: null,
    updatedAt: Date.now(),
  };
}

export async function loadThread(threadId) {
  return (await store.get(threadId)) || emptyState(threadId);
}

export async function saveThread(state) {
  state.updatedAt = Date.now();
  await store.set(state.threadId, state);
  return state;
}

export async function clearThread(threadId) {
  await store.delete(threadId);
}

export function appendMessage(state, role, content) {
  state.messages.push({ role, content, at: Date.now() });
  return state;
}

/** The last N messages actually sent to the model. */
export function recentMessages(state, limit = RECENT_MESSAGE_LIMIT) {
  return state.messages.slice(-limit);
}

/**
 * Cheap extractive rolling summary — keeps token cost flat without another
 * LLM call. Older turns are compressed into a few bullet lines.
 */
export function updateSummary(state, limit = RECENT_MESSAGE_LIMIT) {
  if (state.messages.length <= SUMMARIZE_AFTER) return state;

  const overflow = state.messages.slice(0, state.messages.length - limit);
  const lines = overflow.map(
    (message) => `${message.role === "user" ? "Customer" : "Assistant"}: ${truncate(message.content, 160)}`
  );
  const combined = [state.summary, ...lines].filter(Boolean).join("\n");
  state.summary = combined.split("\n").slice(-12).join("\n");
  state.messages = state.messages.slice(-limit);
  return state;
}

function truncate(text, max) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export const memoryConfig = { RECENT_MESSAGE_LIMIT, SUMMARIZE_AFTER, THREAD_TTL_MS };
