# Geld companion

The local companion connects a Claude login to Geld without sending Claude sign-in tokens to Geld. It uses Anthropic's Agent SDK with an explicit path to your own installed, unmodified Claude Code executable. Sign-in runs `claude auth login` directly with your terminal attached. Geld does not read Claude credential files, import authentication cookies or implement a replacement sign-in flow.

From a checkout, install dependencies with `pnpm install`. Add **Claude → Claude login through local companion** in dashboard provider settings, then choose **Pair local companion**. Your operator must first configure the public HTTPS relay endpoint.

```sh
pnpm --filter @geld/companion start pair /path/to/geld-companion.json
pnpm --filter @geld/companion start login
pnpm --filter @geld/companion start serve
```

Delete the downloaded pairing file after importing it. The imported file is stored under `~/.config/geld/companion.json` with mode 0600. Its secret authorizes Geld relay requests only. Pairing again revokes the earlier connection. Removing the provider or deleting the Geld account revokes its relay channel. Stop the process to stop accepting work. A running request has a 90-second local deadline.

The companion opens no inbound port. It polls the operator's relay over HTTPS. The relay pins only the model catalog and completion operations, signs request and response bodies and keeps work in memory. It never receives a Claude login credential. Repository prompts and generated responses pass through the relay transiently. Login connections return the complete assistant response after generation; API-key connections support incremental streaming.

Each request uses an empty temporary directory, no repository checkout, no tools, no MCP servers, no skills, no project/user settings, no persisted session and an explicit permission callback that denies tools. Temporary directories are removed after requests. Only a small operating-system environment allowlist reaches the CLI, excluding API keys and OAuth-token variables. Claude remains responsible for its own sign-in state and provider retention. Organisational machine policy may still govern the CLI. Check its policy before connecting sensitive repositories.

Set `GELD_CLAUDE_EXECUTABLE` to an absolute path if Claude is not on PATH. Model IDs come from the installed CLI's supported model catalog; `sonnet` is the default CLI alias. Only one generation runs at a time. SDK errors are replaced with a safe message rather than logging prompts, credentials or raw errors.

For the relay broker, configure `RELAY_DATABASE_URL` and the same `TOKEN_ENCRYPTION_KEY` as the dashboard. Production should use a database role with read-only access to `relay_channels`. The dashboard uses `RELAY_BROKER_URL` internally and `RELAY_PUBLIC_BROKER_URL` for downloadable pairing. TLS termination and channel-sticky routing are required for a multi-process deployment. Static Enterprise channels remain supported for existing self-hosted connectors.

No Claude sign-in or billable generation is exercised by tests. Tests inject an engine and run the actual signed outbound relay round trip. Agent Client Protocol support remains a future adapter.
