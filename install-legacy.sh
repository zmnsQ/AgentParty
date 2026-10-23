#!/bin/sh
# Deliberately fail closed: a legacy command must never install the upstream client.
printf '%s\n' 'This is an old party connection guide. Existing installations are unchanged.' 'For new Codex / CodeBuddy / Claude Code connections, open Agent Commons > Add Agent and use agentcommons.' 'Installation guide: https://agentparty.402887.xyz/cli/guide.html' >&2
exit 2
