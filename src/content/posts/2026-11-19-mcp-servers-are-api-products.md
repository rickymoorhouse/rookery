---
title: "An MCP server is an API product, so give it an owner and a catalogue entry"
description: "An MCP server has two sides: the team that publishes it and the people whose agents connect to it. Each has its own job, from owning the tools and their retirement to recording who connected what and with which credentials. The protocol and the official registry cover part of both. A catalogue joins the rest."
pubDate: 2026-11-19
tags: ["mcp", "api governance", "agents", "versioning"]
social: "An MCP server has a provider who owns its tools and a consumer who added one line to an agent config. Both sides have work to do, and most of it is API practice we already know. The catalogue is where they meet."
---

An MCP server is an API product, and like any API it has two sides. The provider publishes it
and owns its tools, its versions and its retirement. The consumer connects an agent to it, often
with one line in a configuration file, and owns that decision and the credentials that come
with it. Each side has its own questions to answer, and most organisations answer neither. The
Model Context Protocol and its official registry help with part of the provider's job and very
little of the consumer's. The rest is API practice we already know, and the place the two sides
meet is the catalogue.

## Two sides, two sets of questions

Ricky Moorhouse's [MCP Ponderings](https://rickymoorhouse.uk/blog/2026/mcp-ponderings/)
describes the two shapes MCP servers come in: local servers you download and run like a CLI
tool, often with a one-line `npx` or `uvx` command, and remote servers you reach through a URL
"just like an API". That one line is where most governance goes missing. It is quick to add,
it skips whatever review a new third-party API would get, and nothing records who added it.

The provider and the consumer need different things written down.

| Provider: we publish this server | Consumer: our agents connect to it |
| --- | --- |
| Which team owns the code and the tool descriptions? | Who decided to connect it, and who answers for it? |
| Which version is live, and which is on its way out? | Which server and version did we review? |
| Which API does it front, and with what credentials? | What credentials does it hold for us, and who can revoke them? |
| Who connects to it, so we can tell them about a retirement? | Where will we hear that it is being retired? |

Inside one organisation, the same team can be on both sides. The questions are still different,
and they need different people to answer them.

## The provider side

The [official MCP Registry](https://modelcontextprotocol.io/registry/about), still in preview,
does a good share of the provider's job for public servers. Server names use reverse DNS, such
as `com.example/orders`, and publishers must prove they control the namespace through GitHub,
DNS or an HTTP challenge. Every publication needs a version string that is
[unique and immutable](https://modelcontextprotocol.io/registry/versioning) once published.
The registry's [API](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/openapi.yaml)
also has a lifecycle: a version's status is `active`, `deprecated` or `deleted`, with an
optional `statusMessage` of up to 500 characters, such as "Please upgrade to version 2.0.0".

What it leaves out is ownership. The
[`server.json` schema](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/draft/server.schema.json)
requires three fields: `name`, `description` and `version`. There is a `repository` and a
`websiteUrl`, but no owner, no support contact and no field for which API the server fronts.
The registry calls its own metadata "deliberately unopinionated" and leaves curation to
downstream aggregators. It also
[does not accept private servers](https://modelcontextprotocol.io/registry/about#relationship-with-server-developers):
for anything on an internal network, it recommends hosting your own registry, ideally one that
implements the same OpenAPI interface so host applications can read it.

So a provider still needs its own catalogue entry. Here is the one I would want for an internal
server. The format is invented and the service is made up; the fields are the point.

```yaml
name: com.example/orders-mcp
kind: mcp-server
owner: team-fulfilment           # owns the code and the tool descriptions
support: "#fulfilment-oncall"
status: active                   # active | deprecated | deleted
sunset: null                     # set a date when deprecated
fronts:
  - api: orders-api
    version: v3
url: https://mcp.example.internal/orders/v3
credentials:
  kind: token-exchange           # acts for the user; holds no standing secret
  scopes: [orders:read, orders:cancel]
tools_version: 3.4.0
```

The owner here owns more than code. As
[last week's post](../api-descriptions-that-stand-alone/) argued, the model decides what to
call from the tool description alone, so someone has to own that text the way they own a
schema. They also own the retirement. When `orders-api v3` is sunset, the `Sunset` header
reaches the MCP server, not the agent host, and certainly not the person whose agent config
still points at it. The provider is the one who has to pass that on.

## The consumer side

The protocol gives a consumer less to work with than you might expect. The current
specification, [revision 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning),
puts the protocol version on every request, but that version describes the wire format, not the
server's tools. A server can describe itself through
[`server/discover`](https://modelcontextprotocol.io/specification/2026-07-28/server/discover),
which returns a `serverInfo` name and version, and the specification is candid that this "is
self-reported by the server and is not verified by the protocol". Clients "SHOULD NOT" use it
to change their behaviour or make security decisions.

The tools carry no version at all. The
[`Tool` type](https://modelcontextprotocol.io/specification/2026-07-28/schema) has a name, a
title, a description, input and output schemas, annotations, icons and `_meta`. A server can
change its tool list at any time and, if it declared the `listChanged` capability, send a
[`notifications/tools/list_changed`](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
to clients that are listening. `tools/list` results carry
[caching hints](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching),
a `ttlMs` that works like `Cache-Control: max-age`. That keeps a client current, which is good
engineering. A consumer who wants to review a change before an agent acts on it has to build
that step for themselves. I argued in
[an earlier post](../agents-absorb-breaking-changes/#the-description-is-part-of-the-contract)
that tool descriptions are part of the contract; the protocol treats them as data that is
allowed to move.

So the consumer's record is about the decision to connect, not the server:

```yaml
server: com.example/orders-mcp
approved_by: team-support-tools  # owns the decision to connect
hosts: [support-assistant]
reviewed:
  tools_version: 3.4.0
  definitions_sha256: 9f2c...    # hash of the tools/list result we reviewed
  write_tools: [cancel_order]
credentials: per-user token exchange; no shared secret
watch: registry status, plus #fulfilment-oncall announcements
```

`definitions_sha256` is what turns a moving tool list into something a review can approve: when
the hash a host sees stops matching the reviewed one, a person looks before the agent does.
`approved_by` matters most for third-party servers. You don't own the code, but someone decided
to connect it, and that decision has an owner.

## Where the two sides meet

The provider's entry and the consumer's records are two halves of one relationship, and the
catalogue is where they join. For an internal server, the list of consumer records pointing at
`com.example/orders-mcp` is the provider's list of who to tell. Without it, retirement is a
guess. For a third-party server, the registry's status is the provider's half, and your record
is the only place your half lives.

Retirement is where a missing half shows. The provider sets `deprecated` and a sunset date. The
consumer needs to hear it through something they actually watch, and the person who added the
config line needs to hear it too, because the agent host won't tell them. If you publish a
machine-readable catalogue, [RFC 9727](https://www.rfc-editor.org/rfc/rfc9727) defines a
`/.well-known/api-catalog` document that links to a publisher's APIs and explicitly allows
metadata about deprecated versions. Nothing stops an MCP endpoint from sitting in that list
beside the REST APIs.

## "It's a wrapper, so catalogue the API"

The best objection is that most MCP servers are thin layers over an API you already catalogue.
[Someone on Bluesky](https://bsky.app/profile/mpchlets.bsky.social/post/3mzwec6xt7c2y) put it
bluntly last week: they have still found no argument for an MCP server over an OpenAPI spec. If
the server is generated from the OpenAPI document and passes the caller's token straight
through, a second entry looks like paperwork.

On the provider side, I half agree. A generated, pass-through server can sit as a channel under
the API's own entry, the way you might list an SDK. It still needs an owner for its tool
descriptions and for the subset of operations it chose to expose. On the consumer side, the
objection doesn't help at all. Whether or not the server is generated, an agent is now calling
that API with somebody's credentials, and the consumer record is still the only place that says
whose.

## What to do this week

If you publish MCP servers:

1. **Give each one an owner and an entry,** alongside the API it fronts.
2. **Use the registry's lifecycle words.** `active`, `deprecated` and `deleted` with a message
   are a fine vocabulary. If you run a private registry, implement the official registry's
   OpenAPI interface so hosts can read status from it rather than from a wiki.
3. **Plan the retirement before the launch:** a sunset date, a replacement and a way to reach
   consumers.

If your agents connect to MCP servers:

1. **Find them.** Agent host configurations, gateway logs and egress logs will show which MCP
   endpoints are in use.
2. **Record who approved each one,** which hosts use it and what credentials it holds. No
   record, no connection, which is the rule most organisations already apply, at least on paper,
   to third-party APIs.
3. **Store a hash of the reviewed `tools/list`** and alert when a host sees something
   different.

The part I'm unsure about is whether the official registry should grow an `owner` or
`support` field, or whether that belongs downstream, in the private registries and
aggregators it expects to exist. Keeping the public registry unopinionated has clear merits.
But a registry that can mark a version deprecated, and can't say who to ask why, has done half
of a lifecycle.
