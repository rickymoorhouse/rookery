---
title: "MCP over OpenAPI is an argument about the reader, not the format"
description: "A reader says they have found no argument for an MCP server over an OpenAPI spec. For a straight conversion they are right. The argument starts where the copying stops: a tool list is read by a model, and that changes what it has to say."
pubDate: 2026-11-26
tags: ["mcp", "openapi", "agents", "api design"]
social: "A reader asked for one argument for MCP over an OpenAPI spec. For a straight conversion there isn't one: you get your endpoints as tools and a second description to keep in sync. The argument starts when someone curates the list for its reader, the model."
---

On 10 November, [a reader on Bluesky](https://bsky.app/profile/mpchlets.bsky.social/post/3mzwec6xt7c2y)
wrote that they had "found no argument for mcp server over openapi spec, none".
[Last week's post](../mcp-servers-are-api-products/) quoted them in passing and half-agreed.
They deserve the full answer, and the full answer begins with a concession: for a straight
conversion — OpenAPI document in, MCP tools out, one endpoint to one tool — they are right, and
nothing is added. The argument for MCP starts where the copying stops, because the two documents
are not written for the same reader.

## Two documents, two readers

The [OpenAPI Specification](https://spec.openapis.org/oas/latest.html), at version 3.2.1 since
10 September 2026, defines "a standard, language-agnostic interface to HTTP APIs", and says what
an description is for: documentation generation, code generation, testing. Its reader is a
developer, or a tool about to write an HTTP client. It can assume that reader will also see the
guides, the status-code tables and the error reference.

MCP's [tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) are
"designed to be model-controlled": the model reads `tools/list` at runtime and decides from the
description field, which — as [the descriptions post argued](../api-descriptions-that-stand-alone/)
— is often the only thing it gets. That reader is a model inside a host, deciding whether to
call, with what, and what to do when the call fails.

The converter sits between the two and translates mechanically.
[FastMCP](https://gofastmcp.com/docs/integrations/openapi) turns "every endpoint in your
OpenAPI specification into an MCP Tool" by default, names each tool from the `operationId`, and
carries the operation's summary and description across as the tool's description. What comes out
is your URL structure wearing your documentation prose, presented as everything an agent may do.

## What the copy leaves out

First, HTTP has nowhere to sit. A tool result carries content, structured content and an
`isError` flag — no status line, no headers, no media type. When FastMCP forwards a failure it
"reports the status and reason to the MCP caller", renders JSON error bodies as JSON, drops HTML
and truncates other text at 1,000 characters with a marker. Anything the converter does not
write into that text is not there; a `Retry-After` has no field to travel in. The
[rate limits post](../rate-limits-agents-can-read/) argued that error text reaches a model and
should be written for one. A conversion pipeline is not an author.

Second, copying is not curating. Jeremiah Lowin, whose converter is, in his own words, "the most
popular tool for auto-generating MCP servers from REST APIs",
[wrote in July 2025](https://jlowin.dev/blog/stop-converting-rest-apis-to-mcp) that "an API
built for a human will poison your AI agent", and quoted issues from his own tracker: an LLM
"timed out trying to decide between create_invoice and generate_invoice"; an agent hallucinated
a `get_all_users_with_blue_eyes` endpoint "because the 50 other user-related tools made it seem
plausible". The FastMCP docs now carry the same advice as a tip: models "achieve significantly
better performance with well-designed and curated MCP servers than with auto-converted OpenAPI
servers", and the converter is for "bootstrapping and prototyping, not for mirroring your API to
LLM clients".

So the reader is right about the mirror. A generated server is your API with a JSON-RPC front
door, and the only new artefact is a second description surface to keep in sync. That is a cost,
not an argument.

## What stopping the copy can buy

Once someone curates the list instead of generating it, the MCP shape starts carrying things
OpenAPI has no field for:

- **A tool set that fits the caller.** The specification allows `tools/list` to vary by the
  authorization presented, "returning only the tools the caller's granted scopes permit". An
  agent acting for a read-only user can be shown a read-only list.
- **Change the host can keep up with.** A server that declares `listChanged` can notify listening
  clients when the list moves, and `tools/list` results carry a `ttlMs` cache hint, so the host
  re-reads when it should rather than on every session.
- **A call that can ask for what it is missing.** A tool may answer with an input-required result
  and the missing fields, and the client retries with the model's answers — instead of the model
  getting a 400 and guessing.
- **Results the host can check.** An `outputSchema` lets the client validate structured results,
  and the specification says clients SHOULD provide tool execution errors to the model "to
  enable self-correction". That is the [rate limits](../rate-limits-agents-can-read/) argument
  built into the protocol.
- **Authorization a host can discover.** A server MUST publish protected resource metadata
  ([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)) and clients MUST use it to find the
  authorization server, so a host can connect without per-API glue. OpenAPI can describe a
  security scheme; it cannot show a caller where to get a token.
- **A protocol that assumes the reader can be fooled.** Tool annotations MUST be treated as
  untrusted unless they come from a trusted server, and applications SHOULD keep a human able to
  deny a call — the same position [tool output as untrusted input](../tool-output-is-untrusted-input/)
  took from the other side.

None of that is visible in a converted list, because conversion only moves fields that both
formats have.

## The cost, stated fairly

The obvious objection is that this leaves you owning two documents, and duplication invites
drift. Fair. There is a second cost too: MCP moves. The specification has published five
versions — the first in November 2024, four since — and the base protocol's own
self-description has changed shape —
the [2025-06-18 index](https://modelcontextprotocol.io/specification/2025-06-18/) said "stateful
connections", the [2026-07-28 index](https://modelcontextprotocol.io/specification/2026-07-28/)
says "stateless, self-contained requests". OpenAPI 3.2.1 is boring, and boring is a feature in a
contract.

The answer is that two documents only pay when each has an owner, which is
[last week's argument](../mcp-servers-are-api-products/): the OpenAPI document stays the contract
for HTTP consumers, the tool list becomes its own contract with its own owner, its review point
and a hash of the reviewed `tools/list`. And the alternative to two owned documents is not one
document — it is one document plus an unowned copy of it.

## What to do this week

1. **Generate the mechanical part.** Build the server from the OpenAPI document so endpoint-to-tool
   mapping, names and schemas stay derived, and use route maps to exclude what an agent should
   never see: admin routes, internal tags, the `DELETE /everything` you forgot about.
2. **Rewrite the part a model reads.** Cut the list to the tasks, give tools task names, and write
   descriptions that say [when to call and when not](../api-descriptions-that-stand-alone/), plus
   error text [a model can act on](../rate-limits-agents-can-read/). This is the work no converter
   will do for you, which is exactly why it is the argument.
3. **Own both documents.** Same treatment as any API: an owner for the tool list, a review before
   it ships, a stored hash so a change to it is visible to a person before it is visible to an
   agent.
4. **Spend protocol features where they earn their keep.** Input-required for calls that genuinely
   need a missing parameter; scope-shaped tool lists for delegated calls. Skip the rest until a
   consumer exists.

The question I am still chewing on is whether curation could be data instead of a fork: a small
file naming which operations become tools, under what names, with what descriptions, so the tool
list regenerates from the OpenAPI document and still matches what someone reviewed. One source,
two readers, an owner for each line. Overlays are the shape of the thing, but they solve a
different problem, and I have not seen a format for this file yet. If you have, I would like to
read it.
