---
title: Agents absorb breaking changes, and that is the problem
description: A compiled client fails loudly when an API changes under it. An agent reads the new response, guesses, and carries on. Versioning for agents means sending deprecation signals to the people who run them, and treating tool descriptions as part of the contract.
pubDate: 2026-10-22
tags: [agents, versioning, mcp, api governance]
social: When an API changes, a typed client throws and someone gets paged. An agent reads the new response, makes a plausible guess and carries on. That is why versioning matters more for agents, not less.
---

When an API changes under a compiled client, the client breaks, a test goes red and somebody
gets paged. When the same change reaches an agent, the agent reads the new response, makes a
plausible guess and carries on. The task still succeeds, by every measure the agent's host
records. Whether the answer is still right is another matter. That makes versioning more
important for agents, not less, and it moves the audience for deprecation signals away from
the model and towards the people who run it.

This follows [Monday's post](../rate-limits-agents-can-read/) on rate limits and the
[first one](../every-agent-is-an-api-client/) on agents as API clients. This time the API
changes.

## Loud failure was a feature

Take an invented but ordinary change. An orders API renames a field from `total` to `amount`,
and at the same release starts returning it in minor units: pence rather than pounds.

A typed client generated from the old schema fails on the first response. The field it expects
is missing, deserialisation throws, and the integration test that checks an order total goes
red. The failure is annoying, and it is also exactly what you want. It is early, it is loud,
and it lands on the person who owns the integration.

Now put a tool between that endpoint and an agent. The tool is ordinary code, so it depends on
how the tool was written, and there are roughly three ways.

A thin tool passes the JSON through as text. That is common for tools generated from an API
description, and for generic "call this endpoint" tools. Here there is no deserialiser at all.
The model sees `amount: 4999` where it used to see `total: 49.99` and does what language models
are good at: it infers.

A tool that parses the response, written in a forgiving language, often looks up `total`,
gets nothing back, and returns an order with no total, or a total of `null`. The model fills
the gap from whatever else is in its context.

A strict tool throws, which is the compiled client again, and it is the right design. But look
at where the exception goes. The tool reports the failure as a result for the model to read,
as Monday's post described, and the model does what it was built to do: tries another tool,
answers from what it already knows, or tells the user it couldn't find the total. The loud
failure happened, one level down, and the model absorbed it.

None of the three helps with the unit change. Any parser accepts `4999` as a number. Often the
model infers well; sometimes it tells a customer their order came to £4,999. Either way the
task completed, and nothing in the host's metrics moved.

[Hyrum's Law](https://www.hyrumslaw.com/) says that with enough users, every observable
behaviour of a system will be depended on by somebody. Agents widen "observable" to include
field names, the order of keys, the wording of error messages and, for tools, the prose of the
description. They also change what depending on something looks like. A compiled client
depends rigidly and breaks. A model depends loosely and drifts.

## The signals already exist

HTTP has had a vocabulary for this for a while.
[RFC 8594](https://www.rfc-editor.org/rfc/rfc8594) (May 2019, Informational) defines the
`Sunset` header: the date after which a resource is likely to stop responding. The RFC is clear
that the date is a hint, not a promise.
[RFC 9745](https://www.rfc-editor.org/rfc/rfc9745) (March 2025, Standards Track) adds the
`Deprecation` header, which says a resource has been or will be deprecated, as a structured
date. Both define a link relation so the response can point at the migration notes:

```http
HTTP/1.1 200 OK
Deprecation: @1798761599
Sunset: Thu, 31 Dec 2026 23:59:59 GMT
Link: <https://api.example.com/changes/orders-v3>; rel="deprecation"
```

The `Deprecation` value is seconds since the epoch, here the last second of 2026. RFC 9745 is
explicit that the header changes nothing about how the resource behaves; it is information.
In the API description, [OpenAPI](https://spec.openapis.org/oas/v3.1.0#operation-object) has
had a `deprecated` flag on operations for years, with the instruction that consumers should
refrain from using them.

The question is who reads any of this. These signals were designed for a developer who has a
client library that logs a warning, or who reads a changelog. In an agent stack, the response
headers usually stop at the tool wrapper, as they did for rate limits on Monday. The
`deprecated` flag may or may not make it into the tool description, depending on whoever
generated the tool from the spec.

## Send them to the owner, not the model

On Monday I argued that a rate limit should reach the model with its numbers intact, because
a long wait can change the agent's plan. Deprecation is different, and I think the right
answer is the opposite.

A model can't act on "this endpoint is deprecated". It can't migrate the integration, update
the tool or read the migration guide and redeploy. Telling it mid-task mostly adds a reason to
second-guess a call that still works. The person who can act is whoever owns the tool or the
agent, and they are not in the conversation.

So the agent host, or the gateway in front of it, should be the reader. A `Deprecation` or
`Sunset` header on any upstream response is an event to log against the tool, the API and the
owner, and to raise when the sunset date gets close. It is the same treatment a good API
gateway already gives a client still calling a deprecated version, just pointed the other way.

## The description is part of the contract

For tools, there is a second surface that HTTP headers don't cover. What the model actually
consumes is the tool's name, its description and its input schema. Change the description and
you have changed how the model calls the tool, with no version number anywhere.

The Model Context Protocol expects tool lists to change. A server can tell the client its list
has changed and the client fetches it again; the
[current specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
also asks servers to keep the list stable for a given caller and in a deterministic order. What
it doesn't do is say that a changed description is a new version of a tool.

Security people have already noticed this from the other side. In April 2025,
[Invariant Labs](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks)
described tool poisoning, where a tool's description carries instructions aimed at the model,
and the "rug pull", where a server changes a description after the user has approved it. The
defence that came out of that work is to pin each tool definition by hash and flag any change.

That is a governance control as much as a security one. A malicious change to a description and
a careless one look the same to the host: different text, same tool name. Treat both as a
release. Diff it, review it, and note it somewhere the owner will see.

## The case for letting agents adapt

The strongest objection is that tolerance is the point. A client that survives a renamed field
is a better client, and if agents shrug off cosmetic changes, providers can evolve faster.

I agree with half of that. Tolerance at runtime is good. A model that can cope with a new
optional field or a reworded error message saves real work. The trouble is that the model
can't tell a cosmetic change from a semantic one, and in the `amount` example the response
gives it no way to. Tolerance without a record of what was tolerated is silent drift. What I
want is an agent that keeps working and a host that says, loudly, that it had to.

## What to do

If you publish an API that agents call:

1. Send `Deprecation` and `Sunset` with a `rel="deprecation"` link, and mark the operation
   `deprecated` in the OpenAPI description.
2. Never change what a field means while keeping its name. Units, currency and time zones are
   the usual offenders. A semantic change gets a new field.

If you build tools or MCP servers:

3. Version tool definitions. A changed description or schema is a release, with a changelog
   entry, however small the edit.
4. Declare an output schema. MCP has supported `outputSchema` and structured results since the
   [2025-06-18 revision](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#output-schema),
   and a client can validate a result against it. That puts a deserialiser back in the loop,
   so a structural change can fail loudly again.

If you run the agent host:

5. Log deprecation headers against the owner of the tool and the API, not into the model's
   context.
6. Pin tool definitions by hash, and alert on any change.
7. Keep a small set of fixed tasks with known answers, and rerun them when anything upstream
   changes. It is the closest thing an agent has to the integration test that used to go red.

What I'm still chewing on is whether there is any case for telling the model. One candidate is
a choice between two tools that do the same job, where one is deprecated. A hint in the
description might steer it to the right one. But that only works if the hint is written,
reviewed and versioned like the rest of the contract, which rather proves the point.
