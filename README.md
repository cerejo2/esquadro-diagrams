# Esquadro

Esquadro turns Java, C, Bash and SQL code into diagrams that look drawn by a careful person: UML class diagrams, relational schemas, Chen ER diagrams, SQL Server database diagrams, call graphs and ISO 5807 flowcharts. Every inferred relationship points to the line of code behind it, and the result stays editable.

Everything runs in the browser. Your code never leaves your computer.

**Status:** early development. A provisional page is live at https://cerejo2.github.io/esquadro-diagrams/.

## Run locally

```sh
npm install
npm run dev
```

`npm test`, `npm run lint`, `npm run typecheck` and `npm run build` are what CI runs. `npm run bench` measures the analyzers against the fixtures (see `docs/fixtures.md`).

## License

MIT
