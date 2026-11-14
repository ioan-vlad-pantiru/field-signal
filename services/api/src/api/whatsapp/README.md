# Field Signal · WhatsApp assistant (Meta WhatsApp Cloud API)

A chat assistant that explains Field Signal to farmers and talks them through their own results.

| Farmer sends | Bot does | How |
|---|---|---|
| Location pin | Results summary: main risk, 3 rotations, scores + ranges | Fixed template, exact API numbers, instant |
| "de ce 2" / "why 2" | Evidence, benefits, risks, gaps, confidence | Fixed template, instant |
| "bună", "ajutor", "help" | Welcome: what Field Signal is, how to use it | Fixed template |
| "en" / "ro" | Switch language (Romanian default) | |
| Anything else ("ce e NDVI?", "de ce soia?", "cum funcționează?") | Grounded chat answer | LLM (Qwen) |

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
Every reply is sent through the Cloud API from a background task, so the webhook answers Meta at once.


| Variable | Value |
|---|---|
| `WHATSAPP_TOKEN` | System User access token (Business settings → System users). The API Setup page's temporary token expires after 24 h |
| `WHATSAPP_PHONE_NUMBER_ID` | API Setup → "Phone number ID" (not the phone number) |
| `WHATSAPP_APP_SECRET` | App settings → Basic → App secret; checks `X-Hub-Signature-256` on every call |
| `WHATSAPP_VERIFY_TOKEN` | any string you pick; type the same one in the webhook config |
| `WHATSAPP_GRAPH_VERSION` | Graph API version, default `v23.0` |
| `LLM_API_KEY` | key for the chat model; without it the bot only sends the fixed templates |
| `LLM_BASE_URL` | OpenAI-compatible endpoint, default `https://local-inference-api.ccrolabs.com/v1` (Qwen) |
| `LLM_MODEL` | model id, default `qwen` |
| `LLM_EXTRA_BODY` | JSON merged into each request; default turns off Qwen thinking |
| `FIELDSIGNAL_RESULTS_BASE_URL` | web app for the "Full results" link, default `https://fieldsignal.land` |
| `BOT_FALLBACK_TO_DEMO` | `true` (default): serve `demo_analysis.json` if the analysis fails |
| `WHATSAPP_VALIDATE_SIGNATURE` | `false` only for local curl tests |

## Meta setup (15 minutes, free)

1. developers.facebook.com → **Create app** → type *Business* → add the **WhatsApp** product. Meta gives you a free test number.
2. WhatsApp → **API Setup**: copy the *Phone number ID*; under *To*, add and verify each phone that will test the bot (up to 5 on the test number).
3. Business settings → **System users** → add an admin user → assign the app → **Generate token** with `whatsapp_business_messaging` and `whatsapp_business_management`, expiry *Never*. That is `WHATSAPP_TOKEN`.
4. Set the env vars above and deploy (or run `pnpm dev:api` + `cloudflared tunnel --url http://localhost:8000`).
5. WhatsApp → **Configuration** → Webhook: Callback URL `https://<host>/v1/whatsapp/webhook`, Verify token = `WHATSAPP_VERIFY_TOKEN` → **Verify and save**, then subscribe to **messages**.
6. From a verified phone, message the test number: "bună" → 📎 Location → "de ce 2" → "ce înseamnă NDVI?"

**Cost:** replies within 24 h of the farmer's last message are free on the Cloud API, and this bot only ever replies.
Only messages the business starts (templates) are billed. To let any farmer use it, register your own number
under API Setup → *Add phone number* (it cannot also be on the WhatsApp app).

## Before the pitch

- `knowledge.md` is what the assistant is allowed to say. Have Răzvan check the method lines and a mentor check the lines marked `[agro]`.
- Replace `demo_analysis.json` (values marked `[mock]`) with the real cached result for the demo field.
- Test 10 tricky questions (doses, prices, "should I plant soy?", subsidies, off-topic) and tighten the prompt in `assistant.py` if any answer invents something.
- Record the backup video: pin → summary → "de ce 2" → one chat question.
