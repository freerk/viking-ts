# Self-Hosting Principles: The Product That Develops Itself

This document captures a reusable architectural principle that emerged during the development of viking-ts and the broader OpenClaw ecosystem: **a product that uses itself as its own most demanding customer**.

## The pattern

Build a system, then make it the first and most complete test case of itself.

This is not just dogfooding. Dogfooding is "we use our own product." This is stronger: **the system's own development process depends on the system functioning correctly**. If it breaks, development itself breaks. The feedback loop is immediate and inescapable.

## How it manifests in this project

### viking-ts indexes its own build history

The ingest CLI imports conversation sessions, workspace memories, and identity files into viking-ts. Those sessions include the conversations where viking-ts itself was being developed. The agent that built the feature is the same agent that uses the feature.

When we run:

```bash
node scripts/ingest.mjs --agent simon --skills ~/apps/openclaw/skills
```

The memories being ingested include decisions about how the ingest script should work. The architecture discussions about L0/L1/L2 become memories that the agent can recall when working on the L0/L1/L2 code.

### The context engine provides its own context

The OpenClaw plugin is a context engine. When the agent works on the plugin code, the plugin itself provides the context. The agent recalls memories about how the plugin should work while working on the plugin. If the recall quality is bad, the agent works less effectively on improving recall quality. The incentive to fix problems is built into the system.

### Skills describe themselves

Each skill is a markdown file with frontmatter (name, description, tags) and content. The ingest CLI imports these skills into viking-ts. The agent then searches for relevant skills during conversations. The skill that teaches the agent how to write good code reviews is itself subject to code review. The skill that describes how to structure documentation is used while writing documentation for the skills system.

### The editorial pipeline edits its own documentation

When a documentation agent (Librarian) uses viking-ts as its context engine, it has access to:
- Its own identity files (SOUL.md, IDENTITY.md)
- Its own past editing sessions
- The documentation it has previously written

The agent that writes the docs is the agent that reads the docs. If the docs are unclear, the agent produces worse work, which shows up immediately.

## The bootstrapping analogy

This pattern mirrors the historical bootstrapping of compilers:

1. The first C compiler was written in assembly
2. It compiled itself, producing a C compiler written in C
3. From that point on, the compiler was maintained in C, compiled by itself

Similarly:

1. viking-ts was initially built without a memory system (just code and conversation)
2. Once functional, it ingested its own development history
3. From that point on, development benefits from the memory of how it was built

The system becomes self-sustaining. Each improvement to the memory system improves the quality of future development, which further improves the memory system.

## Why this matters

### Immediate feedback loops

When a developer builds a product for external users, feedback is delayed: ship, wait for adoption, collect reports, prioritize fixes. When the product develops itself, feedback is instant. A bad search algorithm means the agent cannot find the code it needs to fix the search algorithm. The problem is both obvious and blocking.

### Honest quality standards

It is easy to ship a feature that "works" for others but that you would never rely on yourself. When the system depends on itself, there is no gap between "shipped" and "production-quality." Every rough edge is something you personally hit every day.

### Emergent test coverage

The system exercises its own APIs through real usage patterns:
- The ingest CLI tests every POST endpoint
- Auto-recall tests the search pipeline
- Auto-capture tests session ingestion and memory extraction
- Skill sync tests list and delete operations

This does not replace unit tests, but it provides a layer of integration testing that synthetic test suites cannot replicate: the tests are real workloads.

### Living documentation

The memories stored in viking-ts include the reasoning behind design decisions, the problems encountered, and the solutions chosen. This is richer than documentation written after the fact. It captures the messy, iterative reality of development.

## Applying the principle to other projects

This pattern works whenever:

1. **The product has a data layer**: it stores something that can include its own development artifacts
2. **The product has a retrieval layer**: it can surface relevant information to its own developers (or their agents)
3. **The development process generates artifacts**: conversations, decisions, documents that are worth storing

Concrete examples:

- **A search engine** that indexes its own codebase and documentation, so developers can search for internal architecture decisions
- **A CI/CD pipeline** that tracks its own build history as structured data, learning from past failures to surface relevant context for new ones
- **A knowledge base** that includes its own product roadmap, design decisions, and user feedback, making it the authoritative source for its own development context
- **A monitoring system** that monitors its own infrastructure, so outages in the monitoring system are the first thing detected

## The principle, stated simply

> The strongest test of a system is to make it responsible for its own operation. The strongest documentation of a system is the memory of building it. The strongest incentive to fix a system is to depend on it yourself.

Build the product, then put it to work on itself. If it survives that, it is ready for others.
