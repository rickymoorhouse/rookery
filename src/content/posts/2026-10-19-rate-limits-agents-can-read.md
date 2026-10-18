---
title: A rate limit is a message, so write it for an agent to read
description: Agents meet rate limits as text in their context, often after the useful numbers have been stripped out. Here is how to keep the signal intact, from the HTTP response to the tool result to the task's own budget.
pubDate: 2026-10-19
tags: [agents, rate limiting, mcp, api design]
---

A rate limit is a message from a server to a client: slow down, here is by how much, here is
when to try again. For most of the history of HTTP APIs, the reader of that message was a
developer, once, while writing a retry loop. For an agent, the reader is the model, at runtime,
and the message often reaches it with the useful parts removed. If you want agents to behave
well under load, the rate limit has to survive the trip into the model's context as something
it can act on.

[Last week](../every-agent-is-an-api-client/) I argued that agents need the API governance we
already have, taken more seriously in a few places. Consumption was one of them. This post is
about the narrowest, most practical piece of that: what an agent actually sees when it is told
to slow down.

## What the wire already says

HTTP has a decent vocabulary for this. Status `429 Too Many Requests` was defined in
[RFC 6585](https://www.rfc-editor.org/rfc/rfc6585#section-4), and the
[`Retry-After`](https://www.rfc-editor.org/rfc/rfc9110#field.retry-after) field tells the
client how long to wait, as a number of seconds or a date. A response like this one is about as
clear as a refusal gets:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
Content-Type: application/problem+json

{"type": "https://iana.org/assignments/http-problem-types#quota-exceeded",
 "title": "Request cannot be satisfied as assigned quota has been exceeded",
 "violated-policies": ["burst"]}
```

Beyond that, every provider has its own dialect. GitHub's REST API is a good example because
its [rate limit documentation](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
is unusually thorough. A client that exceeds its primary limit gets a `403` *or* a `429`, with
`x-ratelimit-remaining: 0` and a reset time in `x-ratelimit-reset` as UTC epoch seconds. Then
there are secondary limits, on concurrency, points per minute, CPU time and content creation,
and "there is not a way to check the status of your secondary rate limit". The documented
client behaviour is a small decision tree: honour `retry-after` if present, otherwise the reset
header if remaining is zero, otherwise wait at least a minute, then back off exponentially and
give up after a while. It ends with a warning that continuing to make requests while limited
"may result in the banning of your integration."

None of that is unreasonable. It is exactly the kind of thing a developer reads once and
encodes in a client library. The question is what happens when the client is an agent and
nobody encoded it.

## Where the signal gets lost

Most agents don't call APIs directly. They call tools, and a tool wraps the API. The Model
Context Protocol is the common case, and its
[current specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#error-handling)
is clear on two points. Servers **MUST** "rate limit tool invocations". And failures from the
API underneath, the kind a rate limit produces, come back as a tool result with
`isError: true` and content for the model to read. Clients **SHOULD** pass those errors to the
model "to enable self-correction".

That design is sensible, but notice what it does to the rate limit. The status code, the
`Retry-After` value and the problem type are HTTP. The tool result is text. Whatever survives
the translation is whatever the server author chose to write. I can find no field in the
2026-07-28 schema for "rate limited, retry in 30 seconds"; it is left to the content.

Here are two tool results for the same `429` from the backend. Both are invented, and both are
plausible.

```json
{ "content": [{ "type": "text", "text": "Error: request failed" }], "isError": true }
```

```json
{ "content": [{ "type": "text",
    "text": "Rate limited by the orders API (policy: burst, 100 requests per 60s). Retry after 30 seconds. Other tools on this server are not affected." }],
  "isError": true }
```

The first leaves a model to guess. A reasonable guess is that the call was malformed, so it
rephrases and tries again, which is the one thing the server asked it not to do. Another
reasonable guess is that the tool is broken, so it reaches for a different tool that hits the
same backend. Each of those is another request against an exhausted quota. The second result
gives the model what a developer would have had: what limit, how long, and how far the damage
spreads.

## A standard shape is on the way

The IETF HTTPAPI working group has a draft that would replace the vendor dialects:
[RateLimit header fields for HTTP](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/).
At the time of writing it is still an Internet-Draft, so treat the details as subject to
change. It defines two fields. `RateLimit-Policy` describes the quotas that apply, and
`RateLimit` says how much is left right now:

```http
RateLimit-Policy: "burst";q=100;w=60,"daily";q=1000;w=86400
RateLimit: "burst";r=12;t=41
```

Read that as: 100 requests a minute and 1,000 a day; 12 left in the burst window, which has 41
seconds to run. Two details matter for agents in particular. Quotas can be counted in units
other than requests, including `concurrent-requests`, which is the limit an agent that fans out
is most likely to hit. And an optional partition key, `pk`, tells the client which bucket a
request was counted against. The draft's own example of when that helps is a client "making
requests on behalf of different users", which is a fair description of a lot of agents.

The draft is also honest about limits. The numbers are hints, and clients "MUST NOT consider
the available quota parameter as a service level agreement". The server can still say no.

## The counter-argument: keep the model out of it

The strongest objection is that none of this should reach the model at all. Retries are
plumbing. The HTTP client or the agent host should honour `Retry-After`, back off, and hand the
model a result once there is one. Asking a language model to schedule retries is asking a
probabilistic system to do a deterministic job.

For short waits, I agree, and that's where the work should start. If the server says 30
seconds, the host should wait 30 seconds without the model spending a token on it.

But some rate limits are not plumbing; they are information about the task. A daily quota with
4 calls left changes what an agent should plan to do. A wait of an hour is a decision: wait,
take another route, or go back to the person who asked and say the job will be late. A host
that silently absorbs a long wait makes the agent look hung. A host that silently fails makes
the tool look broken. In both cases the model reasons from the wrong picture. The split I'd
argue for is mechanical waits in code, and anything that changes the plan surfaced to the model
with the numbers intact.

## Budgets the server can't set

There is one limit no server can send you: how much this particular task should cost. A server
quota protects the server. It says nothing about whether 3,000 calls is a sensible way to
answer a question that should have taken 20. As far as the API is concerned, a looping agent
with plenty of quota is a very good customer.

That budget has to live on the client side, with the agent host, and it should work the same
way as a server's limit: counted per task and per person the agent is acting for, enforced in
code, and visible to the model before it runs out rather than after. "You have used 18 of 25
calls for this task" is something a model can plan around. A hard stop at 25 with no warning is
just another error to misread.

## What to do

If you run an API that agents call:

1. Send `Retry-After` with every `429` and `503`, and use
   [problem details](https://www.rfc-editor.org/rfc/rfc9457) so the error has a type, not just
   a status. Consider emitting the draft `RateLimit` fields alongside whatever you send today.

If you build MCP servers or other tool wrappers:

2. Never flatten a rate limit into "request failed". Say which limit, the wait in seconds, and
   what else is affected, in the same shape every time.

If you run the agent host:

3. Handle short `Retry-After` waits in code, surface long ones to the model, and set a call
   budget per task that the model can see.

The thing I'm still chewing on is whether MCP should grow a structured rate limit error, so the
numbers travel as data rather than as prose a server author may or may not write well. Text is
what models read best. Data is what hosts can enforce. A rate limit needs both readers.
