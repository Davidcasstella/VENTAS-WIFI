# Hermes chat-only bridge

Private OpenAI-compatible bridge used by `VENTAS-WIFI` over Tailscale.

Security properties:

- Bearer authentication is mandatory.
- Binds only to the server's Tailscale address in production.
- `AIAgent` is created with `enabled_toolsets=[]`.
- Persistent memory and project context files are disabled.
- A fixed security prompt treats customer messages as untrusted data.
- Maximum 40 messages and 120,000 total characters per request.
- Maximum 30 requests per minute per source address.
- Inference concurrency is limited to two requests.

The production token belongs in a mode-`0600` environment file and must never be committed.

Run tests with the Hermes Python environment:

```bash
HERMES_BRIDGE_TOKEN=test-token-that-is-long-enough \
  /usr/local/lib/hermes-agent/venv/bin/python -m unittest -v tests/test_api.py
```
