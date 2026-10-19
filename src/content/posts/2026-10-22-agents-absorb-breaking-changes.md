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
behaviour of a system will be depended on by somebody. Agents change what depending on
something looks like. A compiled client depends rigidly and breaks. A model depends loosely
and drifts.

## The basics still apply

Most of the defence against breaking changes was never in the response at all. It is a
versioning strategy agreed up front, and communication with consumers. Ricky Moorhouse, who
reviews these posts, makes the case in
[API versioning is a contract commitment, not a technical choice](https://rickymoorhouse.uk/blog/2026/api-versioning-is-a-contract-commitment-not-a-technical-choice/):
additive changes can be invisible to consumers, "as long as clients are told upfront to ignore
unknown fields"; breaking changes need an explicit, consumer-facing version, whether that is in
the path, a header or routed by a gateway from the consumer's subscription. His
[follow-up on API failures](https://rickymoorhouse.uk/blog/2026/api-failure-stories-and-what-they-taught-me/)
adds the other half: you can only retire a version safely if you know which consumers still
use it.

All of that carries over to agents, with two catches. The first is that rule about unknown
fields. A model doesn't ignore them. It reads every field it is given and may use any of
them, so an "additive" change can still change what an agent does. The second is that the
consumer you know about, the one with the subscription and the email address on the
changelog, is usually whoever built the tool or the platform. The agent calling through it,
and the team running that agent, may never hear about the change.

HTTP also has signals in the response itself.
[RFC 8594](https://www.rfc-editor.org/rfc/rfc8594) (May 2019) defines a `Sunset` header for
the date a resource is likely to stop responding, and
[RFC 9745](https://www.rfc-editor.org/rfc/rfc9745) (March 2025) adds `Deprecation`. Both can
link to migration notes:

```http
Deprecation: @1798761599
Sunset: Thu, 31 Dec 2026 23:59:59 GMT
Link: <https://api.example.com/changes/orders-v3>; rel="deprecation"
```

[OpenAPI](https://spec.openapis.org/oas/v3.1.0#operation-object) has a `deprecated` flag on
operations too. Honestly, very little client code checks any of these, compiled or not. They
are worth sending, because they are cheap and machine-readable, but they are a backstop to the
versioning strategy and the changelog, not a replacement.

## Send them to the owner, not the model

Unlike a long rate limit wait, a deprecation is not something a model can act on. It can't
migrate the integration or update the tool, and telling it mid-task mostly adds a reason to
second-guess a call that still works. The person who can act is whoever owns the tool or the
agent, and they are not in the conversation.

So the owner has to be a consumer the provider can see. An agent, or the team running it,
should have its own app and subscription on the APIs it reaches, not borrow the tool vendor's,
so the changelog email and the usage data both point at someone who can act. And the agent
host, or the gateway in front of it, should log any `Deprecation` or `Sunset` header it sees
against the tool, the API and that owner, for the rare provider that sends them.

## The description is part of the contract

For tools, there is a second surface that HTTP headers don't cover. What the model actually
consumes is the tool's name, its description and its input schema. Change the description and
you have changed how the model calls the tool, with no version number anywhere.

The Model Context Protocol expects tool lists to change: a server can tell the client its list
has changed and the client fetches it again. The
[current specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
doesn't say that a changed description is a new version of a tool.

Security people have already noticed this from the other side. In April 2025,
[Invariant Labs](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks)
described tool poisoning, where a tool's description carries instructions aimed at the model,
and the "rug pull", where a server changes a description after the user has approved it. The
defence that came out of that work is to pin each tool definition by hash and flag any change.

That is a governance control as much as a security one. A malicious edit and a careless one
look the same to the host, so treat both as a release: diff it, review it, tell the owner.

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

1. Have a versioning and deprecation strategy, know which consumers use each version, and
   tell them before you change anything. Send `Deprecation` and `Sunset` as well.
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

5. Register each agent as a consumer in its own right, so change notices reach its owner, and
   log deprecation headers there rather than into the model's context.
6. Pin tool definitions by hash, and alert on any change.
7. Keep a small set of fixed tasks with known answers, and rerun them when anything upstream
   changes. It is the closest thing an agent has to the integration test that used to go red.

What I'm still chewing on is whether there is ever a case for telling the model. A choice
between two tools that do the same job, one of them deprecated, might be it. But that hint only
works if it is written, reviewed and versioned like the rest of the contract, which rather
proves the point.
