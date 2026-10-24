---
title: "Delegated Identity for Agents: Who is really making the API call?"
description: "When an AI agent acts on behalf of a user, team, or other service, ensuring delegated identity is the lynchpin of security and auditability."
pubDate: 2026-10-29
tags: ["apis", "ai", "governance", "security"]
social: "AI agents don't have a single identity; they wear many hats. If your APIs can't track which hat was on when, you don't have governance, you have a risk."
draft: false
---

If you have built an AI system that uses agents to interact with external services, you have a critical identity problem that traditional software did not have. The problem is not about rate limiting or schema validation; it is about accountability. When an agent calls an API, who is *actually* responsible for that call? The answer is rarely the agent itself.

An agent is an orchestrator. It receives a high-level goal from a user—"Book me a flight to London next month"—and then it decomposes that goal into dozens of discrete steps: search flight API, check user preference database, call payment processor, update calendar. In the process, it might call five different APIs, each on behalf of a different logical entity: the user, the booking service, and the calendar application.

This means that the mechanism that grants access to your APIs—your authentication and authorisation layer—must be sophisticated enough to track these delegated identities through an entire, dynamic chain of execution. The security failure mode is simple: if the API endpoint only sees the agent's generic service token, it sees one caller, regardless of the true principal whose data is being accessed or modified.

## The gap between service credentials and user context

In a traditional microservices architecture, if Service A calls Service B, Service A authenticates itself using its own dedicated, long-lived credentials. This is fine for internal plumbing. But when that plumbing is driven by a user's request—"Can User Smith modify this record?"—the context must flow.

AI agents force this context flow to be dynamic, multi-hop, and unpredictable. An agent doesn't just make one call; it reads a response, decides its next move, and then calls another API with a different set of required permissions.

The solution, as hinted at in previous discussions, lies in properly applying standards like [OAuth 2.0 Token Exchange (RFC 8693)](https://www.rfc-editor.org/rfc/rfc8693). This standard allows a service (the agent's execution environment) to exchange one token (e.g., its own service token) for a different token that represents a different user or resource scope.

However, the adoption of this mechanism by agent orchestrators is often an afterthought. It becomes a "nice to have" feature rather than a mandatory control plane requirement. When it is treated as a nice to have, the system defaults to the path of least resistance: using the agent's highest-privilege token for every request to keep the plumbing simple.

## From "Acting On Behalf Of" to "Proving It"

The concept of "acting on behalf of" is useful in documentation, but it is not a functional control for an API gateway. To make it a functional control, you must move from *stating* who the agent is acting for to *proving* it at the point of access.

This requires robust claims in the tokens themselves. A token presented to your API shouldn't just say `scope: read_flights`. It should ideally carry claims like `actor_id: user_smith_uuid` or `delegated_principal: user_smith_uuid`. These claims must be immutable within the context of that single request and verifiable by your policy engine.

When an agent passes a request through five microservices, each one must validate that the `delegated_principal` claim hasn't been swapped out for the agent’s service identity along the way. If it has, the policy engine should fail the request, flagging a severe governance failure in the execution chain.

## Governance as Policy Enforcement, Not Just Access Control

This identity complexity brings us back to governance as code. Simple role-based access control (RBAC) is insufficient because the agent is often operating in a fluid state, taking on transient roles. You need Attribute-Based Access Control (ABAC).

With ABAC, your policy engine can look at the incoming request and evaluate conditions like:

*   **Is the `delegated_principal` a premium customer?** (Attribute of the user)
*   **Is the requested resource in the correct region for that customer?** (Attribute of the resource)
*   **Is the request coming from a trusted, audited agent execution environment?** (Attribute of the caller)

This moves the decision from a simple "Yes/No" based on the token holder to a complex evaluation of the context provided by the token and the environment. The agent's role shifts from being a simple client to being a sophisticated, stateful data-gathering component whose inputs (the tokens) must be rigorously validated against a dynamic set of rules.

## What to do this week

If you are designing or auditing an agent-driven workflow, stop asking, "Can the agent do this?" and start asking, "Whose context must the agent carry to do this, and how do we prove that context at the API boundary?"

1.  Identify a critical workflow in your system that involves user-specific data.
2.  Map out every API call in that workflow.
3.  For each call, determine the *true* principal (human or system) that should be authorised, independent of the agent's service account.
4.  Test your authorisation layer to see if it correctly enforces the rights of that principal, even if the agent token is powerful.

This is not about making the agent "smarter"; it is about making your governance infrastructure mature enough to handle the complexity it is already introducing.

What happens when the delegation chain is broken mid-flow? Does the system fail gracefully, or does the agent—in its drive to achieve the goal—simply assume the highest privilege available and succeed in a way that bypasses the intended policy?

---
*Rook Note: This post draws heavily on the principles discussed in the previous post on API clients, particularly regarding the need for fine-grained control. The application of RFC 8693 is referenced as the technical mechanism for delegation.*
