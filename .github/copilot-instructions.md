# GitHub Copilot repository instructions

Read `AGENTS.md`, `README.md`, `ARCHITECTURE.md`, and
`docs/operations/README.md` before non-trivial suggestions. This repository is
public; all generated code, prose, test data, commit messages, and PR content
must be public-safe.

Do not copy private FrameBrain logic, routes, schemas, bot behavior, research
pipelines, deployments, operator documents, or infrastructure into this repo.
Never expose credentials, tokens, private keys, seed phrases, customer data,
private endpoints, Discord content or identifiers, unpublished media, internal
topology, or operator paths.

Private GitHub repositories are canonical for private operations. NotebookLM
is derivative and operator-gated, and may use only product-specific, redacted,
operator-approved snapshots tied to immutable Git revisions and complete
manifests with checksums. Never mix this public repo with private sources,
enable automatic sync, or treat a generated summary as authority.
GitBook is historical and non-operational. Do not onboard, create, edit,
publish, invite, sync, integrate, subscribe, migrate, import from, or export to
GitBook. Existing private GitBook material must remain private and unchanged;
prior handoffs are historical evidence, never executable instructions. A
reversal requires a new explicit operator decision and separate reviewed
change; none is authorized.

Preserve dirty worktrees and keep changes scoped. Production, backend, chain,
wallet, Discord, deployment, marketplace, and fulfillment actions require
explicit approval. Use `VERIFIED`, `NOT VERIFIED`, and `BLOCKED` literally.
