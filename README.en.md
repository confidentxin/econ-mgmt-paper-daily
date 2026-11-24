# Econ & Management Literature Daily

A daily literature site for economics and management graduate students. It collects newly deposited papers from UTD24, FT50 and ABS 3/4 journals through Crossref, classifies them by research field, scores the abstract, and writes a Chinese title, summary and recommendation.

This is the English introduction to **经管科研站**. The main documentation is in [简体中文](README.md); the framework architecture is in [framework notes](docs/framework.md).

## What it does

- Follows 452 English journals and 899 ISSNs, checking Crossref every three hours.
- Sorts papers into economics, finance, accounting, management, marketing, information systems, and interdisciplinary work.
- Uses two independent 0–100 assessments of the abstract. Journal tier sets the selection threshold; the scoring model does not see the journal name.
- Publishes selected papers, topic pages, a daily report at 08:00 Beijing time, weekly and monthly reports, RSS, a public API and MCP.
- Runs on Node.js 24, PostgreSQL 17 and Docker Compose.

## Run locally

You need Docker, Node.js 24 and an OpenAI-compatible model API key.

```bash
git clone https://github.com/confidentxin/econ-mgmt-paper-daily.git
cd econ-mgmt-paper-daily
node scripts/init-env.ts --llm-key <your-model-api-key>
docker compose up -d --build
```

Open <http://localhost:3000>. The admin is at `/admin`; its password is in `.env`. To explore the interface without collecting papers or calling a model, set `COLLECT_ENABLED=false` and `MODEL_CALLS_ENABLED=false`.

## Current limits

The MVP does not yet include the 85 FMS Chinese journals, citation/download-based heat, or email and Feishu delivery. Some Elsevier papers have no Crossref abstract; title-only records wait for an abstract or full text and are not scored. Classification and selection thresholds are initial values and have not been calibrated against a human-labelled sample.

The operating entity, effective date and contact details on the legal pages must be completed before a public deployment.

## Checks

```bash
npm run typecheck
npm run test:standalone
DATABASE_URL=postgres://…/xxx_test npm test
npm run build -w @aihot/web
npm run test:web
```

The database name used for tests must end in `_test` or `_ci`.

Browser tests need Playwright's Chromium and WebKit. Backup integration tests need `pg_dump` and `pg_restore` and are skipped when those clients are absent. Tests that depend on POSIX signals are skipped on Windows and run on Linux/macOS and in the project's Docker environment.

## License

The code is under the MIT License. Upstream attribution and third-party notices are in [NOTICE](NOTICE). Paper metadata comes from Crossref; the original papers remain the property of their authors and publishers.
