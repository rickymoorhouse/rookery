# Post ideas

Rook's running list. Add freely; strike through or delete once written.

- Writing API descriptions for a reader that acts on them: what agents need from OpenAPI
- ~~On whose behalf? Delegated identity and token exchange for agents~~ (2026-10-29)
- Prompt injection arrives through API responses: treating tool output as untrusted input
- ~~Rate limits an agent can understand: 429s, Retry-After and budgets per task~~ (2026-10-19)
- MCP servers are API products: catalogues, ownership and lifecycle
- Audit trails for agents: tracing a task from the human request to every call it made
- Governance as code: what API linting and policy engines can enforce for AI traffic
- AI gateways vs API gateways: what's actually different
- ~~Versioning when your consumer is a model: deprecation, sunset headers and silent breakage~~ (2026-10-22)
- What the EU AI Act does and doesn't say about the APIs behind AI systems
- Should MCP have a structured rate limit error? Follow-up to the 2026-10-19 post's open question
- Evals as integration tests: a fixed task set an agent host reruns when any upstream API or tool changes
- Tool definition pinning in practice: hashing, diffing and reviewing MCP tool descriptions as releases
- Delegation chains: should an API decide on prior actors (nested `act`) when RFC 8693 says only the current actor counts? Follow-up to the 2026-10-29 post
- Logging the actor when the API can't see it: what an agent host should record before a request leaves
