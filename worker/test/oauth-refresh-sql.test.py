"""Offline SQL invariant checks; supplements, never replaces, workerd integration tests.
Run: python3 worker/test/oauth-refresh-sql.test.py
"""
from pathlib import Path
import re
import sqlite3
import unittest

SOURCE = (Path(__file__).parents[1] / 'src/collaboration/oauth.ts').read_text()
REFRESH = SOURCE[SOURCE.index('const updated=await db.batch(['):]
QUERIES = re.findall(r'db.prepare\(`(.*?)`\)', REFRESH, re.S)[:2]


class RefreshAtomicity(unittest.TestCase):
    def test_identity_guard_and_single_winner(self):
        for state in ('valid', 'access_expired', 'missing', 'revoked', 'changed', 'wrong_channel'):
            with self.subTest(state=state), sqlite3.connect(':memory:') as db:
                db.executescript('''
                    CREATE TABLE connector_oauth_grants(id TEXT, client_id TEXT,
                    refresh_hash TEXT, revoked_at INTEGER, refresh_expires_at INTEGER,
                    resource TEXT, access_hash TEXT, access_expires_at INTEGER, updated_at INTEGER);
                    CREATE TABLE tokens(name TEXT, owner TEXT, role TEXT, hash TEXT,
                    revoked_at INTEGER, child_expires_at INTEGER, channel_scope TEXT);
                ''')
                db.execute('INSERT INTO connector_oauth_grants VALUES(?,?,?,?,?,?,?,?,?)',
                           ('id', 'client', 'oldrefresh', None, 1000, 'resource', 'oldaccess', 0, 0))
                if state != 'missing':
                    db.execute('INSERT INTO tokens VALUES(?,?,?,?,?,?,?)', (
                        'agent', 'owner', 'agent', 'changed' if state == 'changed' else 'oldaccess',
                        1 if state == 'revoked' else None,
                        0 if state == 'access_expired' else 1000,
                        'wrong' if state == 'wrong_channel' else 'channel'))
                args = ('newaccess', 700, 'newrefresh', 2000, 100, 'id', 'client',
                        'oldrefresh', 100, 'resource', 'agent', 'owner', 'oldaccess', 'channel')
                with db:
                    grant_changes = db.execute(QUERIES[0], args).rowcount
                    token_changes = db.execute(QUERIES[1], (
                        'newaccess', 700, 'agent', 'owner', 'id', 'newaccess')).rowcount
                success = state in ('valid', 'access_expired')
                self.assertEqual((grant_changes, token_changes), (1, 1) if success else (0, 0))
                self.assertEqual(db.execute('SELECT refresh_hash FROM connector_oauth_grants').fetchone()[0],
                                 'newrefresh' if success else 'oldrefresh')
                if success:
                    self.assertEqual(db.execute(QUERIES[0], args).rowcount, 0)


if __name__ == '__main__':
    unittest.main()
