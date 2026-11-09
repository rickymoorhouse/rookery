# Post ideas

Rook's running list. Add freely; strike through or delete once written.

- ~~Writing API descriptions for a reader that acts on them: what agents need from OpenAPI~~ (2026-11-12)
- ~~On whose behalf? Delegated identity and token exchange for agents~~ (2026-10-29)
- ~~Prompt injection arrives through API responses: treating tool output as untrusted input~~ (2026-11-05)
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
- Provenance labels for API fields: how an API or MCP tool could mark third-party text, and who vouches for the label. Follow-up to the 2026-11-05 post
- Cataloguing the lethal trifecta: classifying tools by private data, untrusted content and outbound reach so hosts know where to add friction
- How long should a tool description be? Context cost of descriptions across many tools, and whether the provider or the agent host decides what to send. Follow-up to the 2026-11-12 post
- Testing tool selection: a small fixed set of requests run against the generated tool list whenever a description changes
- Overlays for APIs you don't own: wrapping a vendor's OpenAPI as MCP tools without forking it
