import unittest
from identity import ConfiguredIdentityResolver, IdentityUnverified


class IdentityTests(unittest.TestCase):
    # Fabricated schema deliberately named as such: never a claim of upstream fields.
    def test_explicit_synthetic_path_matches(self):
        resolve = ConfiguredIdentityResolver('synthetic-account', '/synthetic_owner/stable_id')
        self.assertEqual(resolve({'synthetic_owner': {'stable_id': 'synthetic-account'}}), 'synthetic-account')

    def test_default_has_no_schema_and_rejects(self):
        with self.assertRaises(IdentityUnverified):
            ConfiguredIdentityResolver('synthetic-account')({'account_id': 'synthetic-account'})

    def test_mismatch_missing_nested_non_string_and_oversized_fail(self):
        resolve = ConfiguredIdentityResolver('synthetic-account', '/synthetic/id')
        for value in ({}, {'synthetic': {}}, {'synthetic': []}, {'synthetic': {'id': 'different'}},
                      {'synthetic': {'id': 123}}, {'synthetic': {'id': True}},
                      {'synthetic': {'id': 'x' * 201}}, None):
            with self.subTest(value=value), self.assertRaises(IdentityUnverified):
                resolve(value)

    def test_vm_and_credentials_and_labels_never_account_evidence(self):
        for path in ('/vm_id', '/vmId', '/nested/vm_name', '/vmAddress', '/account_label',
                     '/sidechat_label', '/access_token', '/cookie', '/cookies'):
            with self.subTest(path=path), self.assertRaises(IdentityUnverified):
                ConfiguredIdentityResolver('synthetic-account', path)

    def test_bad_pointer_never_guessed(self):
        for path in ('', 'account', '/', '/a~', '/a~2', '/a//b', '/x' * 17):
            with self.subTest(path=path), self.assertRaises(IdentityUnverified):
                ConfiguredIdentityResolver('synthetic-account', path)

    def test_rfc6901_escape_is_exact(self):
        resolve = ConfiguredIdentityResolver('synthetic-account', '/synthetic~1owner/id~0key')
        self.assertEqual(resolve({'synthetic/owner': {'id~key': 'synthetic-account'}}), 'synthetic-account')

    def test_unicode_exact_comparison(self):
        resolve = ConfiguredIdentityResolver('合成账号', '/synthetic')
        self.assertEqual(resolve({'synthetic': '合成账号'}), '合成账号')
        with self.assertRaises(IdentityUnverified):
            resolve({'synthetic': '合成账号 '})

    def test_invalid_config_and_redacted_errors(self):
        for expected in ('', ' x', 'x\n', 'x' * 201, '\ud800', 1):
            with self.assertRaises(IdentityUnverified):
                ConfiguredIdentityResolver(expected, '/synthetic')
        resolve = ConfiguredIdentityResolver('private-account', '/synthetic')
        self.assertNotIn('private-account', repr(resolve))
        with self.assertRaises(IdentityUnverified) as error:
            resolve({'synthetic': 'private-wrong-account'})
        self.assertEqual(str(error.exception), 'personal_gateway_identity_unverified')


if __name__ == '__main__':
    unittest.main()
