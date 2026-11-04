# warden-link

Runs Warden commands inside one local workspace. The client polls your control
plane, executes allowlisted commands, and posts results back. No inbound ports,
no shell access, no dependencies.

## Install

```bash
npm install -g warden-link
# or run without installing:
npx warden-link --help
```

Requires Node 20 or newer and `git` on PATH (only used for `pushit`).

## Run

```bash
warden-link start \
  --url https://your-api.example.com \
  --key <your-jwt> \
  --workspace ~/repos/my-app
```

Get `<your-jwt>` by signing in to the Warden dashboard (the same token the web
app stores after OTP verification). Optional flags: `--interval-ms` (poll
cadence, default 5000, min 1000), `--name` (label shown in server logs).

## Commands the server can send

- `read_file { path }` — returns file text (256KB cap, secret files refused).
- `write_file { path, content }` — writes UTF-8, creating parent dirs (1MB cap).
- `pushit { summary, bullets?, targetBranch?, skipPush? }` — version-check,
  stage, commit in pushit format, push to origin. Never force-pushes.

All paths are relative to `--workspace`. Absolute paths and `..` escapes are
refused, and `.env` files plus private keys are never readable.

## Enqueue from anywhere

```bash
curl -X POST $API/api/client/enqueue \
  -H "Authorization: Bearer <jwt>" \
  -H 'Content-Type: application/json' \
  -d '{"command":{"kind":"write_file","path":"hello.txt","content":"hi"}}'

curl "$API/api/client/result?id=<command-id>" \
  -H "Authorization: Bearer <jwt>"
```

## Troubleshooting

- `poll failed with HTTP 401` — the `--key` token is missing, expired, or for
  a different server. Sign in again and retry.
- `workspace is not a directory` — `--workspace` must already exist.
- `nothing to commit` from pushit — no staged changes after exclusions.
- The client retries with backoff when the server is unreachable; fix the
  server and it resumes on its own.
