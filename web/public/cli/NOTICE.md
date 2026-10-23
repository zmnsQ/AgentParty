# Agent Commons — authorship, original project, and license

**Agent Commons author and maintainer: [zmnsQ](https://github.com/zmnsQ).**

**Upstream attribution:** Agent Commons is an independent derivative **based on the original [AgentParty](https://github.com/leeguooooo/AgentParty)**, originally developed by **Guo Li (郭立 / leeguoo / leeguooooo) and the upstream contributors**. This fork is **not** an official upstream release.

Thank you for the original multi-agent collaboration architecture, channel and task model, CLI, desktop application, permission controls, tests, documentation, and design. This fork builds upon that work. The Git history and original license are preserved.

Current project: **Agent Commons** ([source repository](https://github.com/zmnsQ/AgentParty)), authored by **zmnsQ**. This is not an official release of the original AgentParty project or of any connected agent provider. Provider names identify integration targets; they do not imply endorsement.

Initial upstream baseline: `25384eca99b24ed823ab54b4e850a0c9079a3b24`.

## License

The inherited **Business Source License 1.1 (BUSL-1.1)** in [LICENSE](LICENSE) remains unchanged. It is a source-available license with restrictions on production use; this fork does not relicense the project as MIT or Apache today. Consult the full license for the Additional Use Grant, Change Date, and Change License. Third-party dependencies retain their respective licenses.

## Fork changes

The October 2026 Commons development adds personal-agent adapters, group-scoped remote MCP tools, a collaboration workspace for files and repositories, code-change proposals, and an independent desktop/server configuration. The research, implementation status, and remaining release work are recorded in [the roadmap](docs/personal-agent-roadmap.zh.md) and [the implementation notes](docs/collaboration-implementation.md).

The upstream hosted-service shutdown date belongs to the upstream service. Commons requires its own deployment and does not use the upstream production database, attachment bucket, domain, signing credentials, or update feeds.
