# Identity, permissions and removal audit — 2026-10-28

Baseline: `5f9400ba`. Scope: Worker identity reads, handle/nickname updates,
channel-scoped agent management and participant-removal boundaries. Local test
fixtures only; no production reads, account changes, credentials or migration.

## Confirmed defects fixed

1. **Owned agents could change their human owner's global handle.**
   `PUT /api/me/handle` described a human-only operation but rejected only the
   `readonly` role. Both scoped and unscoped agent tokens with an owner account
   passed the guard and changed `account_profiles`. Two regression tests failed
   against the baseline with an actual successful mutation (expected 403).
   The guard now requires `role === human` and an account. Agent self-nickname
   remains available through its separate per-identity endpoint.
2. **Case variants bypassed the reserved human handle.** `handleConflict` used a
   case-sensitive check while the shared mention namespace and agent nickname
   reserved check are case-insensitive. `system`, `SYSTEM`, and `System` now
   return 409 without changing the saved profile. Ordinary handles retain case.

## Coverage matrix

| Boundary | Evidence / result |
|---|---|
| Human own handle update | Success retained; profile test and new post-denial update |
| Owned scoped / unscoped agent → human handle | 403; saved human profile unchanged |
| Readonly → human handle | 403; profile unchanged |
| Deleted/revoked agent → handle | 401 after actual local DELETE; profile unchanged |
| Agent own nickname | Success retained, human account profile not modified |
| Other owner's agent rename, even group owner | 404; nickname table unchanged |
| Correct owner, wrong channel | 404; no cross-group mutation |
| Identity GET access / visible roster | Existing channel ACL first, no new roster entries |
| Removed name / removed account | Tombstones continue filtering identity projection |
| Alias accounts / legacy ownership | Existing account alias and removal suite retained |
| Explicit nickname vs opaque/generated appearance | Table-backed nickname retained; no appearance inference |
| Human label provenance | Saved readable handle preferred; no claim of manual-edit proof |
| Connector display projection | Recognized redirect/config only; unknown omitted; no secrets/URLs |
| Optional integration schema | Only known absent optional tables degrade; other SQL errors surface |
| Agent deletion / rotation / rename | Existing agent management suite run unchanged |

## Current identity projection review

The GET still gates through `canAccessLoadedChannel` before loading identity
metadata. Scope mismatch, account bans and participant tombstones are checked.
Nickname and connector queries are bounded to agent names already in the
channel roster; neither creates membership, grants permission nor claims online
presence. The final name/account removal filter is retained. Connector metadata
is display provenance, **not** verified platform identity or authentication state.

Optional connector tables originate in migrations 0046, 0052 and 0054, not the
experimental 0055. A specifically recognized `no such table` error omits that
optional projection; broad SQL, schema-column and infrastructure errors are not
silently swallowed. Local tests temporarily rename/restore tables/one column
with `finally`, proving both the safe fallback and non-fallback error boundary.

## Limits and unverified boundaries

- No production migration inventory, live OAuth identity, remote removal delivery,
  or actual client refresh was examined or claimed verified.
- The profile schema has no manual-handle provenance flag. Known GitHub/SSO
  generated defaults are excluded, but deliberately choosing exactly that default
  cannot be distinguished. Other saved readable handles are not proven manual.
- Conflict helpers preflight multiple tables; existing same-table unique indexes
  provide collision protection. This audit does not claim a proof of arbitrary
  simultaneous cross-table handle/nickname namespace races. A transactional
  namespace design requires a separate design review; no migration added here.
- Removal and authorization behavior is covered by existing local integration
  tests, not a proof over every distributed interleaving or external client cache.

## Validation

- Baseline reproduction: `/tmp/identity-permission-before.log` (two agent guard
  failures; cross-owner/cross-group rejection already passes).
- Final targeted integration run: `/tmp/identity-audit-tests.log` (**85 passed / 0 failed across 7 files**, real local Workerd/D1/DO fixtures).
- No tests weakened, no ACL loosened, no experimental Muse path enabled.

## Muse setup asynchronous recovery addendum

The setup UI uses per-server/group in-memory operation locks to prevent duplicate
same-turn submissions and stale-scope secret/status updates. These are not
persistent recovery records. Status refresh and token refresh do not themselves
clear an ambiguous mutation. A readback that explicitly lists the **same target
client ID as disabled**, after the operation has settled, clears an uncertain
revocation; missing IDs or unrelated disabled clients do not prove success.

Ambiguous creation still requires human reconciliation of the client inventory.
The API has no request/idempotency identifier tying an observed new client to a
specific create attempt. Pre/post ID differences therefore cannot prove causality
under concurrent administration, and cannot recover its one-time secret. This UI
does not automatically retry, create replacements, revoke clients or bypass
reauthorization. Its warning says the previous result needs confirmation. A full
page/component remount loses these in-memory locks; that is an explicit remaining
limitation, not a claim that every recovery path is solved. Mock regression:
`/tmp/muse-ui-recovery.log` — 17 tests / 65 assertions passed. No real credentials
or external authorization were created during these tests.

## Account display parity

`/api/me` now adds `preferred_display` and, where known, `nickname`, sharing the
same saved-human-handle policy used by channel identities. An agent's preferred
label comes only from its own nickname or identity name, never its owner's
profile. Existing `handle`, `display_name` and owner fields are retained for old
clients. `provider_user_id` is read internally to recognize an existing generated
GitHub handle but is not exposed. There is no manual-edit provenance column:
known generated defaults are excluded, and an intentionally identical chosen
handle remains indistinguishable without a future schema change.

The account chip and Settings use the preferred label. Confirmed handle saves
update it immediately and invalidate channel labels. Old-server agent responses
fall back to identity name rather than guessing whether an owner-shaped display
field belongs to the agent. Account/identity authorization and routing continue
to use immutable identity fields, never labels.
