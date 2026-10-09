# Homer

Homer is an experimental, local agentic roleplaying engine for medieval political fantasy. This repository is a source checkpoint of an additive MythEngine overhaul, with a familiar story and control surface, typed Markdown canon, constrained tools, and explicit NPC decision questions.

## Implemented

- Independent campaign creation and selection; editable GM and Assistant instruction resources; persistent controls and recoverable author edits.
- Character identity and origin separated from evolving state; nested locations; actor-specific visibility and secret knowledge.
- Canonical Markdown read/search, bounded grep in a Docker sandbox, proposals, questions, dice, event-backed updates, and guarded child-agent tasks.
- NPC questions can address friction, betrayal, flirtation, obligation, status, and other political or personal choices. Categories are optional; holding position is valid.
- Plot Director guidance is retired. Selected inherited retirement fixtures remain solely to verify that old forecasting owners fail closed.
- Shared GM/NPC context construction, source citations, context inspection, canonical memory fallback, and a disabled native MemWeave integration boundary.
- Additive culture records, affiliations and deviations; private aliases and source visibility; bounded XML projection validated against reviewed character XSDs. Canon remains typed Markdown rather than importing the illustrative YAML example.
- OpenRouter and NanoGPT model/profile controls with explicit account setup for the separate local installation. Account keys remain in server memory and must be reconnected after restart. Missing setup is an error; this installation does not silently generate synthetic play.

## Setup

Use Node.js 22.19 or newer (this checkpoint was tested with Node.js 24), npm, Git, and Python 3 with `lxml` for culture XML validation. Docker with the configured BusyBox image is needed for command-sandbox operations. Native MemWeave execution is disabled and is not a setup requirement.

```sh
npm ci --ignore-scripts
node scripts/homer-build.mjs
```

The build writes only ignored `fixture-data/homer-release-build`. Standard inherited launch/build commands deliberately fail closed; use the explicit Homer scripts.

For a separate installation with fresh data and provider account setup:

```sh
node scripts/prepare-homer-local.mjs 20261008
cd ../Homer-local-20261008
node launch.mjs
```

The checkpoint-specific preparation command requires a clean Git checkout, a built artifact, and working Python/lxml. It refuses to overwrite an existing installation. Distinct suffixes `20261008-r2` through `20261008-r9` are supported. It copies a versioned build and installed runtime dependencies, records hashes, and pins the local XML worker. The launcher binds `http://127.0.0.1:5280` and stores new campaign/runtime data under that installation's own `fixture-data`. It scrubs inherited provider/database environment settings and does not load private `.env` files or a production database.

In Homer, create a campaign, edit GM instructions, choose a provider/model, connect your account in Controls, and select the profiles for GM, NPC and Assistant. Set explicit request, token and dollar limits before submitting play. **Provider calls cost money according to the provider and model.** Connecting an account does not run generation. Current public model metadata is checked at dispatch; failed setup or price verification blocks play.

For a separately labeled synthetic demonstration, without provider dispatch:

```sh
npm run overhaul:preview
```

This binds loopback port 5277 and uses entirely invented fixtures. It is a qualification preview, not evidence of live narrative quality.

## Checks and limitations

```sh
node --test --test-timeout=60000 --test-concurrency=2 src/lib/server/overhaul/*.test.mjs
node scripts/homer-build.mjs
```

The tests use invented worlds, recorded provider responses, and mocked native-memory workers; they do not authorize paid inference or native MemWeave execution. Docker-dependent command tests require Docker. Culture projection tests require Python/lxml. Browser qualification and operational evidence stay local and are not included in this public source snapshot.

- This is an experimental checkpoint. Paid live narrative behavior, model quality, and cost/cache savings have not been qualified by this publication.
- Native MemWeave execution remains disabled; memory uses a disclosed canonical fallback. Persistent native indexing is not claimed.
- Exact culture XML token counting currently supports the installed `gpt-4o` tokenizer mapping. Unsupported model tokenizers explicitly withhold the XML; ordinary configured play and canonical search remain available.
- Foreign culture provenance must reference a currently authorized canonical revision; historical source projection is not implemented.
- Culture schemas are additive. Legacy strict Markdown remains supported; this is not a complete schema migration.
- The control surface is intended for a trusted local operator. Public hosting, multi-user authentication, remote phone access, and actual iOS Safari/home-screen behavior are not qualified. Keep the listener on loopback.
- This source checkpoint has not been deployed as a durable local installation. Existing production MythEngine and its story data are outside this repository.

## Lineage and licensing

`SOURCE-LINEAGE.json` identifies the local source checkpoint. The public repository begins with a sanitized initial snapshot; full local history, operational evidence, private campaigns, credentials, account metadata, logs, databases and generated releases remain outside it. `SOURCE-MANIFEST.json` records the published source bytes, excluding itself.

Inherited source notices are retained. No new project license has been selected; public visibility alone does not grant an open-source license. Third-party dependencies retain their own licenses.
