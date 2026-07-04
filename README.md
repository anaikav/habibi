# Habibi

An AI chat assistant for Dubai. See `SPEC.md` for the full build spec.

The whole thing is static: plain HTML + CSS + JS, no frameworks, no build step.
It's designed to be dropped onto GitHub Pages as-is.

## Run locally

Because we load `locations.json` and (later) call the Anthropic API, opening
`index.html` straight from disk (`file://`) will hit CORS/fetch errors. Serve
the folder over HTTP instead:

```bash
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000
```

## GitHub Pages

To publish: on GitHub → repo → **Settings** → **Pages** → set the source to
**Deploy from branch → main → /(root)**. After the first deploy the site is
live at `https://<your-username>.github.io/habibi/`.

## Where we are in the build

- **Phase 0** — file skeletons + blank page. ✅
- Phase 1 — mock APIs (clock, moi, history, patterns, context). *(next)*
- Phase 2 — LLM agent + tools + memory.
- Phase 3 — chat UI + ride card.
- Phase 4 — L2 personalization (one-shot card, memory screen).
- Phase 5 — L3 anticipation (surge cause, proactive nudge).
- Phase 6 — polish.
