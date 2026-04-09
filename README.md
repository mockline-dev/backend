# Mockline Backend

AI-powered backend generator. Users describe what they want in natural language — the system generates a complete, runnable backend project.

## Stack

- **Framework**: FeathersJS v5 + Koa (TypeScript)
- **Database**: MongoDB + Cloudflare R2 (file storage) + ChromaDB (vectors)
- **Queue**: BullMQ + Redis
- **LLM**: Groq (primary) + MiniMax (fallback)
- **Sandbox**: OpenSandbox (isolated Docker containers)
- **Auth**: JWT + Firebase

## Getting Started

```bash
pnpm install
pnpm run dev       # dev server with hot reload
pnpm run compile   # compile TypeScript → lib/
pnpm start         # run compiled output
```

## Dev Infrastructure

Requires Redis, ChromaDB, and OpenSandbox running locally:

```bash
./scripts/infra.sh start
```

| Service | Port |
|---------|------|
| Redis | `127.0.0.1:6379` |
| ChromaDB | `127.0.0.1:8000` |
| OpenSandbox | `127.0.0.1:8080` |

## Tests

```bash
npx vitest run              # unit tests (no live deps)
npx vitest run src/path/to/file.test.ts  # single file
pnpm test                   # integration tests (requires live services)
```

## BullMQ Monitor

`http://localhost:3030/admin/queues`

## Key Docs



