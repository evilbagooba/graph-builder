# Agent notes

See `CLAUDE.md` for commands and architecture.

- Run `npm run typecheck` and `npm test` after changes.
- Projects live in the tako hub's folder (`~/tako/` by default) and belong
  to whoever is running it. Change them through the hub (ops), not by
  rewriting the files. For testing, start a hub on a scratch folder
  (`tako --dir /tmp/x --port 4199`) and open the app with
  `?hub=http://localhost:4199`.
