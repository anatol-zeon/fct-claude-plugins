# fct-tg-bot

TBD (заполнится в проектном CLAUDE.md).

## Status

idea

## Quick start

```bash
git clone <url>
cd <project>
./scripts/bootstrap.sh
cp .env.example .env
# fill in values
./scripts/dev.sh
```

## Structure

```
.
├── services/          # independently runnable modules
├── docs/              # architecture, ADRs, API specs
├── test/              # cross-service integration tests
├── logs/<service>/    # runtime logs
├── out/<service>/     # generated artifacts
├── in/<service>/      # input data
├── raw/<service>/     # raw inputs (HAR, dumps) — gitignored
└── scripts/           # dev helpers
```

## Docs

- Architecture decisions: [docs/adr/](docs/adr/)
- API reference: [docs/api/](docs/api/)
- External APIs in use: [docs/apis.md](docs/apis.md)
- Dependencies: [docs/deps.md](docs/deps.md)

## Contributing

Conventional Commits. Pre-commit hooks must pass. See CLAUDE.md for full rules.
