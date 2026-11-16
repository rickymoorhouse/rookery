---
title: "An MCP server is an API product, so give it an owner and a catalogue entry"
description: "Most MCP servers reach an organisation as one line in an agent's config, with no owner, no version anyone tracks and no plan for retiring them. The protocol and the official registry each cover part of the job. The rest is ordinary API product management, and it needs doing."
pubDate: 2026-11-19
tags: ["mcp", "api governance", "agents", "versioning"]
social: "An MCP server usually arrives as one line in an agent's config file. No owner, no tracked version, no retirement plan. It is an API with a different wire format, and it belongs in the same catalogue as the rest."
---

An MCP server is an API product. It has consumers, a contract, credentials, versions and,
eventually, a retirement. Yet most of them enter an organisation as a single line in someone's
agent configuration, and nobody writes down who owns it, which version is in use or what
happens when it goes away. The Model Context Protocol and its official registry each solve
part of that problem. Neither was meant to be your catalogue, so you need one, and it should be
the one you already keep for APIs.

## What a catalogue entry is for

An API catalogue entry earns its keep by answering a few dull questions quickly. Who owns
this? Who uses it? Which version is live, and which is on its way out? What credentials does
it hold, and who can revoke them? When something goes wrong at two in the morning, those
answers decide whether the incident takes ten minutes or a day.

MCP servers skip that step by default. Ricky Moorhouse's
[MCP Ponderings](https://rickymoorhouse.uk/blog/2026/mcp-ponderings/) describes the two
shapes they come in: local servers you download and run like a CLI tool, often with a one-line
`npx` or `uvx` command, and remote servers you reach through a URL "just like an API". Both are
easy to add and easy to forget. A remote MCP server in particular is a third-party API
integration that never went through the process a third-party API integration would.

## What the protocol tells you, and what it doesn't

The current MCP specification,
[revision 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning),
puts the protocol version on every request rather than agreeing it once in a handshake. That
version describes the wire format. It says nothing about whether the server's tools have
changed.

A server can describe itself through
[`server/discover`](https://modelcontextprotocol.io/specification/2026-07-28/server/discover),
which returns a `serverInfo` block with a name and version. The specification is candid about
its limits: `serverInfo` "is self-reported by the server and is not verified by the protocol",
and clients "SHOULD NOT" use it to change their behaviour or make security decisions. It is a
label for logs, not a contract.

The tools themselves carry no version at all. The
[`Tool` type](https://modelcontextprotocol.io/specification/2026-07-28/schema) has a name, a
title, a description, input and output schemas, annotations, icons and `_meta`. A server can
change its tool list at any time and, if it declared the `listChanged` capability, send a
[`notifications/tools/list_changed`](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
to clients that are listening. `tools/list` results also carry
[caching hints](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching),
a `ttlMs` that works like `Cache-Control: max-age`. That is good engineering for keeping a
client current. It is the opposite of what a governance process wants, which is to notice the
change and decide whether to accept it. I argued in
[an earlier post](../agents-absorb-breaking-changes/#the-description-is-part-of-the-contract)
that tool descriptions are part of the contract. The protocol treats them as data that is
allowed to move.

## What the registry tells you, and what it doesn't

The [official MCP Registry](https://modelcontextprotocol.io/registry/about), still in preview,
does more than the protocol here. Server names use reverse DNS, such as `com.example/orders`,
and publishers must prove they control the namespace through GitHub, DNS or an HTTP challenge.
Every publication needs a version string that is
[unique and immutable](https://modelcontextprotocol.io/registry/versioning) once published.
The registry's [API](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/openapi.yaml)
also has a lifecycle: a version's status is `active`, `deprecated` or `deleted`, with an
optional `statusMessage` of up to 500 characters, such as "Please upgrade to version 2.0.0".

That is a solid package index. It is not a catalogue, and it doesn't claim to be. The
[`server.json` schema](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/draft/server.schema.json)
requires three fields: `name`, `description` and `version`. There is a `repository` and a
`websiteUrl`, but no owner, no support contact and no field for which API the server fronts or
what credentials it needs to hold. The registry describes its own metadata as "deliberately
unopinionated" and leaves curation to downstream aggregators. It also
[does not accept private servers](https://modelcontextprotocol.io/registry/about#relationship-with-server-developers):
for anything on an internal network, it recommends hosting your own registry, ideally one that
implements the same OpenAPI interface so host applications can read it.

So the public registry tells you a server is who it says it is and whether its publisher still
stands behind a version. The questions your organisation needs answered are still yours.

## A catalogue entry for an MCP server

Here is the entry I would want for an internal server. The format is invented and the service
is made up; the fields are the point.

```yaml
name: com.example/orders-mcp
kind: mcp-server
owner: team-fulfilment           # required; a team, not a person
support: "#fulfilment-oncall"
status: active                   # active | deprecated | retired
sunset: null                     # set a date when deprecated
fronts:
  - api: orders-api
    version: v3
transport: streamable-http
url: https://mcp.example.internal/orders/v3
credentials:
  kind: token-exchange           # acts for the user; holds no standing secret
  scopes: [orders:read, orders:cancel]
tools:
  version: 3.4.0
  definitions_sha256: 9f2c...    # hash of the tools/list result we reviewed
  write_tools: [cancel_order]
consumers:
  - host: support-assistant
  - host: internal-coding-agents
```

Three lines in it do most of the work. `owner` means someone can be asked, and someone can be
woken. `definitions_sha256` turns the moving tool list into something a review can approve:
when the hash a host sees stops matching the reviewed one, a person looks before the agent
does. `consumers` is what makes retirement possible, because you can't tell people a server is
going away if you don't know who connects to it.

The same entry works for a third-party server, with one change. You don't own the code, but
someone in your organisation decided to connect it, and that decision has an owner. Put their
name in the field.

If you publish a machine-readable catalogue,
[RFC 9727](https://www.rfc-editor.org/rfc/rfc9727) defines a `/.well-known/api-catalog`
document that links to a publisher's APIs, and it explicitly allows metadata about deprecated
versions. Nothing in it stops an MCP endpoint from sitting in the same list as the REST APIs
beside it.

## "It's a wrapper, so catalogue the API"

The best objection is that most MCP servers are thin layers over an API you already catalogue.
[Someone on Bluesky](https://bsky.app/profile/mpchlets.bsky.social/post/3mzwec6xt7c2y) put it
bluntly last week: they have still found no argument for an MCP server over an OpenAPI spec. If the server is generated from the OpenAPI document and
passes the caller's token straight through, a second catalogue entry looks like paperwork.

I half agree. A generated, pass-through server can sit as a channel under the API's own entry,
the way you might list a GraphQL facade or an SDK. But it still needs its own owner line,
because three things change at that layer even when the code is generated.

The descriptions change, or should. As
[last week's post](../api-descriptions-that-stand-alone/) argued, the model decides what to
call from the description alone, and someone has to own that text. The surface changes: a
server exposes the operations someone chose, often fewer, sometimes combined into one tool
that makes several calls. And the retirement path changes. When `orders-api v3` is sunset,
the `Sunset` header reaches the MCP server, not the agent host, and certainly not the person
whose agent config still points at it. The server's owner is the one who has to pass that on.

## What to do this week

1. **Find the servers.** Agent host configurations, gateway logs and egress logs will show
   which MCP endpoints are in use. Expect more than anyone thinks.
2. **Give each one an entry with an owner.** No owner, no connection. This is the same rule
   most organisations already apply, at least on paper, to third-party APIs.
3. **Reuse the registry's lifecycle words.** `active`, `deprecated` and `deleted` with a
   message are a fine vocabulary. If you run a private registry, implement the official
   registry's OpenAPI interface so hosts can read status from it rather than from a wiki.
4. **Record the reviewed tool list.** Store a hash of `tools/list` per version and alert when
   a host sees something different.
5. **Plan the retirement before the launch.** A sunset date, a replacement and the list of
   consumers to tell. For agents, telling the host is not enough; the people who configured it
   need to hear too.

The part I'm unsure about is whether the official registry should grow an `owner` or
`support` field, or whether that belongs downstream, in the private registries and
aggregators it expects to exist. Keeping the public registry unopinionated has clear merits.
But a registry that can mark a version deprecated, and can't say who to ask why, has done half
of a lifecycle.
