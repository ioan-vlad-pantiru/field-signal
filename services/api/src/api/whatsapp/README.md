# Field Signal · WhatsApp assistant (Twilio sandbox)

A chat assistant that explains Field Signal to farmers and talks them through their own results.

| Farmer sends | Bot does | How |
|---|---|---|
| Location pin | Results summary: main risk, 3 rotations, scores + ranges | Fixed template, exact API numbers, instant |
| "de ce 2" / "why 2" | Evidence, benefits, risks, gaps, confidence | Fixed template, instant |
| "bună", "ajutor", "help" | Welcome: what Field Signal is, how to use it | Fixed template |
| "en" / "ro" | Switch language (Romanian default) | |
| Anything else ("ce e NDVI?", "de ce soia?", "cum funcționează?") | Grounded chat answer | LLM (Qwen), sent via Twilio REST in the background |

**Grounding:** the LLM only sees `knowledge.md` plus the computed results for the farmer's field.
The prompt forbids new numbers, marks advice as options, and sends anything uncertain to an agronomist.
The numbers in results always come from fixed templates, never from the LLM.

## In this repo

Lives in `services/api/src/api/whatsapp/` and is mounted in `api/main.py`; tests are in
`services/api/tests/test_whatsapp.py`. It runs the same analysis as `/v1/fields/analyze`
(`api.analysis.run_field_analysis`) in-process, with the regional default rotation
(maize → wheat → maize) and equal priorities, since the bot does not ask for them.
`models.from_contract` is the only code that knows the API contract.

## Environment

All of these can go in the repo-root `.env`.


| Variable | Value |
|---|---|
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Twilio console → Account info |
| `TWILIO_WHATSAPP_FROM` | sandbox number, default `whatsapp:+14155238886` (check yours in the console) |
| `PUBLIC_WEBHOOK_URL` | exact URL set in the sandbox (signature check uses it) |
| `LLM_API_KEY` | key for the chat model; without it the bot only sends the fixed templates |
| `LLM_BASE_URL` | OpenAI-compatible endpoint, default `https://local-inference-api.ccrolabs.com/v1` (Qwen) |
| `LLM_MODEL` | model id, default `qwen` |
| `LLM_EXTRA_BODY` | JSON merged into each request; default turns off Qwen thinking |
| `FIELDSIGNAL_RESULTS_BASE_URL` | web app for the "Full results" link, default `https://fieldsignal.land` |
| `BOT_FALLBACK_TO_DEMO` | `true` (default): serve `demo_analysis.json` if the analysis fails |
| `TWILIO_VALIDATE_SIGNATURE` | `false` only for local curl tests |

## Sandbox setup (10 minutes)

1. Twilio console → Messaging → Try it out → **Send a WhatsApp message**. Each phone sends `join <code>` once. Re-join Sunday morning (joins expire after ~72 h).
2. `pnpm dev:api` (port 8000) + `ngrok http 8000` (or `cloudflared tunnel --url http://localhost:8000`).
3. Sandbox settings → **When a message comes in** → `POST https://<tunnel>/v1/whatsapp/webhook`; same URL in `PUBLIC_WEBHOOK_URL`; restart.
4. Phone: "bună" → 📎 Location → "de ce 2" → "ce înseamnă NDVI?"

## Before the pitch

- `knowledge.md` is what the assistant is allowed to say. Have Răzvan check the method lines and a mentor check the lines marked `[agro]`.
- Replace `demo_analysis.json` (values marked `[mock]`) with the real cached result for the demo field.
- Test 10 tricky questions (doses, prices, "should I plant soy?", subsidies, off-topic) and tighten the prompt in `assistant.py` if any answer invents something.
- Record the backup video: pin → summary → "de ce 2" → one chat question.
