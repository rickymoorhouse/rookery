---
title: "Write API descriptions for a reader who never sees your guides"
description: "OpenAPI descriptions used to be read by developers with a tutorial open beside them. Now tooling copies them straight into agents' tool definitions, and the description is all the model gets. It has to say when to call an operation, when not to, and what happens next."
pubDate: 2026-11-12
tags: ["agents", "api design", "openapi", "mcp", "api governance"]
social: "The description field in your OpenAPI document was written for a developer who also had the guides. An agent gets that field and nothing else, and acts on it every time it runs. Here's what it needs to say."
---

The `description` fields in an OpenAPI document were written for a developer who also had the
getting-started guide, the tutorials and someone to ask. More and more often the reader is an
agent, and the description is all it gets: tooling copies it into a tool definition, and the
model decides from that text alone whether to call the operation, with what, and what to do
next. So the description has to stand on its own. That isn't a new genre of documentation for
machines. It is reference documentation doing the job we always said it should, with the
safety net taken away.

## How the description reaches the model

OpenAPI gives each operation a `summary`, "a short summary of what the operation does", and a
`description`, "a verbose explanation of the operation behavior", which may use
[CommonMark](https://spec.openapis.org/oas/v3.1.0#rich-text-formatting)
([Operation Object](https://spec.openapis.org/oas/v3.1.0#operation-object)). Parameters get a
description too. None of `summary`, `description` or `operationId` is required, so a document
can be perfectly valid with all three missing.

An MCP tool is a name, a title, a description and an input schema
([MCP tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#tool)).
The quickest way to get an MCP server in front of an existing API is to generate one from the
OpenAPI document. FastMCP, for example,
[converts every endpoint into a tool by default](https://gofastmcp.com/integrations/openapi),
incorporating the OpenAPI description into the tool's description. Whatever was written in
that field for a docs portal some years ago is now, word for word, part of a prompt.

The people who build models are clear about how much that text matters. Anthropic's guidance
on defining tools calls detailed descriptions
["by far the most important factor in tool performance"](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use),
and asks for at least three or four sentences covering what the tool does, when it should and
shouldn't be used, what each parameter means, and its caveats. FastMCP's own documentation
says that models do significantly better with curated servers than with converted ones, and
recommends conversion for bootstrapping and prototyping.

## What the guides used to carry

Here is a thin operation description. I've invented it, so that no team is singled out:

```yaml
/orders/{orderId}/cancel:
  post:
    operationId: cancelOrder
    summary: Cancel order
    description: Cancels an order.
```

A developer integrating this would learn the rest elsewhere: that only orders that haven't
been dispatched can be cancelled, that the refund happens later, that a shipped order goes
through a separate returns flow, and what the 409 means. An agent learns none of it. Ask it to
"send this parcel back" and `cancelOrder` is a plausible choice. It may even look as if it
worked, if the error that comes back is vague enough.

The same operation, described for a reader with nothing else to go on:

```yaml
    description: |
      Cancels an order that has not been dispatched, and refunds the
      original payment method. The refund completes asynchronously: read
      `refund.status` from GET /orders/{orderId} to see when it is done.

      Only orders with `status` of `pending` or `paid` can be cancelled.
      For an order that has shipped, use createReturn instead; this
      operation returns 409 with type `order-dispatched`.

      Calling it again on a cancelled order returns 200 and changes nothing.
```

That adds four things, and each of them used to live in a guide. When to use the operation and
when not to, naming the alternative by its `operationId`. The preconditions, stated as values
the agent can check. The side effects and their timing. And what repeating the call does, along
with what the likely error means. None of it is specific to agents. A developer reading the
second version would also be glad of it.

## "Good documentation is good documentation"

The strongest objection is that there's nothing here but the old advice: write proper
reference docs. Keep one description, write it well, and don't invent an agent dialect that
drifts away from the human one.

I agree with most of that, and I'd resist any proposal for a separate "agent description"
written by a different team. What agents change is the cost of getting it wrong, not the kind
of writing. A developer who meets a thin description asks a colleague, once, while building
the integration, and the answer ends up in code. A model reads the description on every task,
at runtime, and acts on its own reading of it each time. A human choosing an operation has
usually already picked it from the guide. A model is choosing among every tool it has been
given at once, so the text that tells `cancelOrder` apart from `createReturn` carries more
weight than it ever did in a portal.

There's a second change, and it is less comfortable. Once descriptions feed a model, they are
instructions, and a channel for them. I wrote about
[tool poisoning and changed descriptions](../agents-absorb-breaking-changes/#the-description-is-part-of-the-contract)
as a versioning problem, and about
[text that reaches a model through tools](../tool-output-is-untrusted-input/) as a security one.
The upshot is the same: an edit to a description changes how agents behave, so it deserves the
review an edit to code gets.

## Where the words should live

The OpenAPI Initiative's
[Overlay Specification](https://spec.openapis.org/overlay/v1.0.0.html#introduction), published
in October 2024, offers another route. An overlay is a list of actions, each with a JSONPath
`target` and an `update` or `remove`, that can be applied repeatably to an OpenAPI description
([Action Object](https://spec.openapis.org/overlay/v1.0.0.html#action-object)). You could keep
your agent-facing descriptions in an overlay and apply it when you generate the MCP server.

If you own the API, I wouldn't. An overlay of descriptions is a second copy of the
documentation, and second copies drift. Put the words in the source, where the API's owner
reviews them. Overlays earn their place when you don't own the source: a team wrapping a
vendor's API as tools can add the missing "when not to use this" without forking the vendor's
document, and reapply it when a new version arrives.

Some guidance doesn't belong in any single operation. "Cancel, then poll until the refund
completes" is a sequence, and [Arazzo](https://spec.openapis.org/arazzo/latest.html) exists to
describe "sequences of calls and their dependencies" across API descriptions. I don't know how
many agent hosts read Arazzo documents directly today, so treat this as my own suggestion: if
three operation descriptions each explain part of one workflow, write the workflow down once,
as a workflow, and let the tool layer build from it.

## What to do this week

- **Lint for presence, review for content.** An OpenAPI linter can require a description on
  every operation and parameter, and flag one that only repeats the summary. It can't tell
  whether the description says when *not* to call the operation. That needs a reviewer.
- **Test descriptions the way an agent reads them.** My suggestion, not an established
  practice: give a model only the generated tool list and a dozen realistic requests, and check
  which operation it picks for each. Run it again whenever a description changes. It is cheap,
  and it finds the `cancelOrder` problem before a customer does.
- **Hold error responses to the same standard.** The description sets expectations, and the
  error is what the agent reads when they weren't met. As Ricky Moorhouse
  [put it](https://rickymoorhouse.uk/blog/2026/observability-as-a-design-requirement/), "An
  agent won't infer what's going on from an obscure error code and outdated documentation."
  I've written before about [errors an agent can act on](../rate-limits-agents-can-read/).
- **Treat a description change as a contract change.** Review it, note it in the changelog,
  and tell the teams who run agents against the API.

The question I haven't settled is length. Three or four sentences per operation is a floor,
but an agent given eighty tools pays for every word of every description in its context
before it does any work. Somewhere a description stops helping the model choose and starts
crowding out the task. I'd like to know where that line is, and whether it should be the API
provider or the agent host who decides how much of the description to send.
