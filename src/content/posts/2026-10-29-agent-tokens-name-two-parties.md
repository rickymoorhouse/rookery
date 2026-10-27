---
title: "An agent's token should name two parties: the person and the agent"
description: "When an agent calls an API for someone, the token usually names one party: the agent's service account or the person it is acting for. OAuth Token Exchange has a way to name both. Here is what that looks like on the wire, what MCP already requires, and where it stops helping."
pubDate: 2026-10-29
tags: ["agents", "identity", "oauth", "mcp", "api governance"]
social: "When an agent calls your API for someone, whose name is on the token? Usually only one of them. RFC 8693 has had a way to carry both, the person and the agent, since 2020. It is worth using."
---

When an agent calls an API for a person, the access token it presents should name both of
them: the person the work is for, and the agent doing it. Most setups today name only one. The
agent either uses its own service credential, and the person disappears, or it forwards the
person's token, and the agent disappears. OAuth has had a standard way to carry both since 2020.
This post is about what that looks like, why agents make it worth the effort, and the one place
where the standard deliberately stops short.

In the [first Rookery post](../every-agent-is-an-api-client/) I called this the first strain
point and moved on quickly. This is the longer version.

## Two ways to lose a name

Take an invented but ordinary case. A travel assistant agent books trips for staff. It calls an
internal orders API.

If the agent uses its own client credentials, every call reaches the orders API as
`travel-assistant`. The API can't tell which employee a booking was for, so it can't enforce
that one employee can't see another's bookings. That check moves into the agent, where a
prompt or a bug can skip it. The audit log says the agent did everything.

If the agent forwards the employee's own token, the API sees the employee and enforces their
permissions, which is better. But now the log says the employee did everything, including
things they never clicked. You can't revoke the agent without revoking the person, and you
can't write a rule that treats "the employee" differently from "software acting for the
employee".

[RFC 8693](https://www.rfc-editor.org/rfc/rfc8693#section-1.1) names these two models.
Impersonation is when A "is given all the rights that B has" and is treated as B. Delegation is
when "principal A still has its own identity separate from B". The forwarded token is
impersonation. What we usually want from an agent is delegation.

## What delegation looks like on the wire

Token exchange is a request to the authorisation server's token endpoint. The agent host sends
the person's token as the `subject_token`, "the party on behalf of whom the request is being
made", and its own credential as the `actor_token`, "the identity of the acting party"
([section 2.1](https://www.rfc-editor.org/rfc/rfc8693#section-2.1)). It also says which API the
new token is for and how much it should allow. The values here are invented:

```http
POST /token HTTP/1.1
Host: auth.example.com
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&subject_token=eyJ...employee
&subject_token_type=urn:ietf:params:oauth:token-type:access_token
&actor_token=eyJ...agent
&actor_token_type=urn:ietf:params:oauth:token-type:jwt
&resource=https://orders.example.com
&scope=orders:read
```

If policy allows it, the token that comes back carries both parties. The person stays in `sub`,
and the agent goes in the `act` claim
([section 4.1](https://www.rfc-editor.org/rfc/rfc8693#section-4.1)):

```json
{
  "iss": "https://auth.example.com",
  "aud": "https://orders.example.com",
  "sub": "employee-4821",
  "scope": "orders:read",
  "act": { "sub": "travel-assistant" },
  "exp": 1793361600
}
```

The authorisation server decides whether this agent may act for this person at all. The
[`may_act` claim](https://www.rfc-editor.org/rfc/rfc8693#section-4.4) is one way to record that
in the subject's token. That is a single place to grant or withdraw an agent's right to act for
someone, which is exactly what the forwarded-token model lacks.

## What the API can do with it

Once both names arrive, the API can write rules that need both. Here is an invented
[Rego](https://www.openpolicyagent.org/docs/policy-language) policy that lets an agent read an
employee's bookings but keeps cancellation for the employee in person:

```rego
package orders.authz

default allow := false

# The person, or software acting for them, may read their own bookings.
allow if {
    input.method == "GET"
    input.token.sub == input.booking.owner
}

# Only the person, with no actor in the token, may cancel.
allow if {
    input.method == "DELETE"
    input.token.sub == input.booking.owner
    not input.token.act
}
```

And the log line can finally answer the question I suggested in that first post: which human
was the agent acting for? It is in the token.

## MCP already rules out the shortcut

If the agent reaches the orders API through an MCP server, the
[Model Context Protocol's authorisation spec](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#token-handling)
closes off forwarding. MCP servers "MUST validate that access tokens were issued specifically
for them as the intended audience", and "MUST NOT accept or transit any other tokens". Clients
must name the MCP server in a `resource` parameter
([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)) when they ask for a token.

The spec's [security best practices](https://modelcontextprotocol.io/specification/latest/basic/security_best_practices#token-passthrough)
call passing a client's token straight through to the API underneath an anti-pattern, and the
risks they list include exactly the logging problem above: the downstream API's logs "may show
requests that appear to come from a different source with a different identity".

So an MCP server that calls another API needs a separate token for that API. The spec doesn't
say how to get one. Token exchange is the obvious candidate: the server already holds a token
that names the person, and it can trade it for one with the right audience and itself as the
actor. That is my reading, not something the spec requires.

## The counter-argument: this is ordinary on-behalf-of

The strongest objection is that none of this is about agents. Service A calling service B for a
user is an old problem, and on-behalf-of flows exist precisely for it. Why treat an agent
differently from any other middle tier?

Mostly, I wouldn't. The mechanism is the same, and if your platform already does token
exchange for microservices, an agent should get the same treatment. The difference is in why
the actor matters. A microservice runs a fixed code path that someone reviewed. An agent decides
at runtime which calls to make, from instructions that can include text it read in a tool
result. "The person asked for this" and "the agent decided this" are not the same claim, and
for an ordinary middle tier you rarely need to tell them apart. For an agent, that distinction
is most of what an investigation needs.

There is also a practical objection. Many APIs, especially third-party SaaS, only accept a
token their own authorisation server issued, often for a user, and support nothing like token
exchange. Across trust domains, the OAuth working group's
[identity chaining draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-identity-chaining)
combines token exchange with a JWT authorisation grant to carry identity over the boundary, but
it is still an Internet-Draft. Where the API can't see the actor, record it yourself: the agent
host knows which agent made which call for whom, and should log it before the request leaves.

## Where the standard stops

Delegation chains are where agents get interesting. An orchestrating agent hands a task to a
sub-agent, which calls a tool, which calls an API. RFC 8693 handles this by nesting: the
outermost `act` is the current actor, and nested ones are prior actors. But it is firm about how
they are used. For access control, only the top-level claims and the current actor count. Prior
actors are "informational only"
([section 4.1](https://www.rfc-editor.org/rfc/rfc8693#section-4.1)).

That is a sensible rule for keeping policy simple. It also means an API can't, by the standard,
refuse a request because of who was earlier in the chain.

## What to do

If you run an API:

1. Accept and log the `act` claim when it is present, next to `sub`. Even before you write
   rules on it, the log becomes answerable.

If you build MCP servers or other tool wrappers:

2. Never forward the client's token downstream. Get a token for the downstream API with its own
   audience, through token exchange where your authorisation server supports it.

If you run the agent host:

3. Exchange for a narrow, short-lived token per task, scoped to the API it is about to call,
   rather than holding one broad credential for the session.

The question I'm still chewing on is that last rule about prior actors. If a sub-agent three
links down was steered by text in a web page, the current actor looks perfectly respectable. Do
APIs need to make decisions on the whole chain, which the RFC tells them not to, or is that a
job for the agent host before the request is ever made?
