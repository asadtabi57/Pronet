# Pronet AI Architecture & Implementation Plan

This document outlines the architecture and step-by-step implementation plan for integrating a suite of 10 AI features into Pronet. All solutions are designed to be $0 cost using generous free tiers (Gemini 1.5 Flash via Google AI Studio) and local/database processing where appropriate.

## Core Free Providers
1. **Generative LLM (Text):** Google Gemini API (`gemini-1.5-flash`). Generous free tier: 15 RPM, 1M tokens/min, 1,500 RPD. Perfect for drafting, summarizing, and extraction.
2. **Embeddings (Vectors):** `@google/generative-ai` (`text-embedding-004`) OR local `@xenova/transformers` (running `all-MiniLM-L6-v2` in Node). We will use Gemini embeddings for simplicity and consistency unless rate limits force us local.
3. **Vector Database:** Supabase Postgres with `pgvector` (already available in the free tier).
4. **Voice/Audio:** Web Speech API (SpeechRecognition/SpeechSynthesis) natively in the browser for $0 voice IO, backed by Gemini for text logic.

---

## 1. Foundational Vector Infrastructure (Enables #1, #4, #8)

**Features Supported:** "Smart Match", Semantic Search, Career Path Analyzer.

### Architecture
- **Supabase DB:** Enable `pgvector`. Add an `embedding vector(768)` column to the `users` table.
- **Trigger/Worker:** When a user updates their profile (headline, about, skills), concatenate these fields into a single string.
- **Node.js:** Call Google's `text-embedding-004` API to generate the vector. Store it in Supabase.
- **Search Query:** Use `pgvector`'s `<->` (cosine distance) or `<=>` (inner product) operator in raw SQL to find nearest neighbors.

### Implementation Steps
1. **Migration:**
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ALTER TABLE users ADD COLUMN embedding vector(768);
   -- Index for fast retrieval (HNSW or IVFFlat)
   CREATE INDEX ON users USING hnsw (embedding vector_cosine_ops);
   ```
2. **Node Setup:** `npm install @google/generative-ai`. Initialize with `process.env.GEMINI_API_KEY`.
3. **Embedding Function:** Create `lib/ai.js` with `generateEmbedding(text)`.
4. **Sync Process:** Add a hook in `PUT /api/users/:id` to asynchronously update the `embedding` column after a successful profile save.
5. **Backfill Script:** Create a standalone script to generate embeddings for existing seeded users.

---

## 2. AI "Smart Match" & Semantic Search (Features #1 & #4)

### Architecture
- **API Endpoint:** `GET /api/network/smart-matches` and `GET /api/search?q=...`
- **Logic:**
  - For Smart Match: Grab the requesting user's vector, run SQL `ORDER BY embedding <=> $1 LIMIT 10`, exclude existing connections.
  - For Semantic Search: Embed the search query `q`, run the same SQL against the users table.

### Implementation Steps
1. Add `GET /api/network/smart-matches` in `server.js`.
2. Add the SQL query using pg syntax: `SELECT id, name, headline, avatar_color FROM users WHERE id != $1 ORDER BY embedding <=> $2 LIMIT 10`.
3. Update the `network.html` UI to show a "Smart Recommendations" section using this endpoint.
4. Update `search.js` / `search.html` to intercept the query, embed it via a new backend endpoint, and return semantic results alongside exact matches.

---

## 3. Generative Features: Enhancer, Writer, Warm Intro, Icebreaker (Features #2, #3, #7)

### Architecture
- **Provider:** Gemini 1.5 Flash via REST API in Node.js.
- **Prompt Engineering:** Strict system prompts demanding concise, professional LinkedIn-style output.

### Implementation Steps
1. **Profile Enhancer:**
   - Endpoint: `POST /api/ai/enhance-profile`.
   - Payload: `{ notes: "did react 3 yrs" }`.
   - Prompt: "You are an expert resume writer. Turn these notes into a professional 2-3 sentence LinkedIn About section. Output ONLY the text."
   - UI: ✨ button in `profile.html` edit modal.
2. **Post Writer:**
   - Endpoint: `POST /api/ai/draft-post`.
   - Payload: `{ topic: "new aws cert" }`.
   - Prompt: "Draft a professional LinkedIn post about: [topic]. Include 2-3 relevant hashtags."
   - UI: ✨ button in the `feed.html` composer.
3. **Warm Intro / Icebreaker:**
   - Endpoint: `POST /api/ai/draft-intro`.
   - Payload: `{ targetUserId: 123 }`.
   - Backend logic: Fetch viewer's profile text and target's profile text.
   - Prompt: "Draft a 2-sentence connection request from [Viewer Name] ([Viewer Headline]) to [Target Name] ([Target Headline]). Find common ground. Be polite. Output ONLY the message."
   - UI: ✨ button next to "Connect" on profiles.

---

## 4. Smart Replies & Tone Guardian (Features #3b, #10)

### Architecture
- **Provider:** Gemini 1.5 Flash.
- **Execution:** Server-side for Tone, Client-side or Server-side for Replies.

### Implementation Steps
1. **Tone Guardian:**
   - Intercept `POST /api/posts`, `POST /api/comments`, `POST /api/messages`.
   - Pass content to a fast, local Regex/Keyword filter first (to save API calls). If suspicious, call Gemini: "Does this text contain aggressive, toxic, or unprofessional language? Answer only YES or NO."
   - If YES, return `400 Bad Request` with `{ warning: "Tone flagged" }`.
2. **Smart Replies:**
   - Endpoint: `POST /api/ai/suggest-replies`.
   - Payload: `{ messageContext: "Can we meet tomorrow?" }`.
   - Prompt: "Suggest 3 short, distinct, professional replies to this message. Format as a JSON array of strings."
   - UI: Render 3 pill buttons above the message composer in `messages.html`.

---

## 5. Daily Network TL;DR & B2B Lead Scorer (Features #5, #9)

### Architecture
- **Execution:** Background Cron Job (Node `setInterval` or Railway Cron).
- **Logic:** Batch processing to stay within Gemini free tier limits.

### Implementation Steps
1. **Network TL;DR:**
   - Script runs daily. Finds users who haven't logged in for > 24h.
   - Fetches top 10 posts from their network.
   - Prompt: "Summarize these 10 posts into 3 bullet points starting with 'Today...'"
   - Store in a new table `feed_summaries` and push a notification to the user.
2. **B2B Lead Scorer (Intent Signals):**
   - Hook into the post-creation flow (`POST /api/posts`).
   - Async call to Gemini: "Does this post indicate the user is looking for a job or struggling with software? Answer YES or NO."
   - If YES, flag the post in a new `lead_signals` table.
   - UI: Create a `/premium-dashboard.html` for premium users showing these flagged posts.

---

## 6. AI "Mock Interview" Lounge (Feature #6)

### Architecture
- **Audio IO:** Web Speech API (built into Chrome/Edge) for STT (Speech-to-Text) and TTS (Text-to-Speech) to keep costs exactly $0. No OpenAI Realtime API needed.
- **Logic:** Gemini manages the conversation state.

### Implementation Steps
1. **UI (`lounge.html`):** Add a "Start Mock Interview" interface. Input for Job Title/Description.
2. **Client-Side STT:** Use `webkitSpeechRecognition` to capture user audio, convert to text.
3. **Backend API (`POST /api/ai/interview-turn`):**
   - Receives user text + conversation history.
   - Prompt: "You are interviewing a candidate for [Job]. This is the transcript so far. Ask the next logical technical or behavioral question. Be concise."
   - Returns the interviewer's next question.
4. **Client-Side TTS:** Use `speechSynthesis.speak()` to read the returned question aloud.
5. **Scorecard:** After 5 turns, prompt Gemini to evaluate the transcript and generate a Markdown scorecard.

---

## 7. Career Path Analyzer (Feature #8)

### Architecture
- **Logic:** Aggregation + Gemini synthesis.

### Implementation Steps
1. **Endpoint:** `POST /api/ai/career-gap`.
2. **Payload:** `{ targetRole: "Senior React Dev" }`.
3. **Backend:**
   - Use `pgvector` to find 5 users whose headline semantically matches the target role.
   - Extract their skills.
   - Compare with the requesting user's skills.
   - Prompt Gemini: "User has skills [X]. Successful people in [Target Role] have skills [Y]. Write a 3-sentence gap analysis advising the user on what to learn next."
4. **UI:** Add an "Analyze Path" button in the Premium section or on the profile page.

---

## Execution Strategy for the AI LLM Coder (Opus)

1. **Phase 1: Foundation.** Add `pgvector`, `@google/generative-ai`, and the `lib/ai.js` helper. Run the backfill script.
2. **Phase 2: High Visibility.** Implement "Enhance Profile", "Post Writer", and "Smart Replies". These are standard REST endpoints.
3. **Phase 3: The Magic.** Implement "Smart Match" and "Warm Intro" to tie the vector DB and the generative LLM together.
4. **Phase 4: Advanced.** Implement Tone Guardian, TL;DR Cron, Mock Interview, and Lead Scorer.
