"""Explicitly configured identity extraction; not an upstream identity schema.

Reviewed upstream dbc7624368fd3aec20258c545f50654dbc92cc5f exposes
GET /identity (routes.json) and outputs its JSON unchanged (cli.py cmd_status).
It does NOT document a reliable account field. An operator must first inspect a
separately authorized, read-only identity response and approve its account JSON
pointer and expected stable account identifier. No default field is guessed.
Use ONLY with that identity RPC response, never /api/session or a decoded token.
Configuration labels and VM identifiers are not evidence of account identity.
This module makes no network requests, reads no secrets, and logs no payloads.
"""
from __future__ import annotations

import hmac
from collections.abc import Mapping


class IdentityUnverified(ValueError):
    def __init__(self):
        super().__init__('personal_gateway_identity_unverified')


def _valid_account(value):
    if type(value) is str:
        try:
            value.encode('utf-8')
        except UnicodeEncodeError:
            return False
    return (type(value) is str and 0 < len(value) <= 200
            and value == value.strip()
            and not any(ord(c) < 32 or ord(c) == 127 for c in value))


class ConfiguredIdentityResolver:
    """Fail-closed RFC6901 pointer chosen after actual response-field review.

    Calling this compares a bounded string at the approved path with an expected
    account identifier. A passing synthetic test is NOT real account validation.
    Neither constructor nor repr reveals the pointer or expected identity.
    """
    def __init__(self, expected_account: str, approved_json_pointer: str | None = None):
        self._account = expected_account
        self._parts = None
        if not _valid_account(expected_account):
            raise IdentityUnverified()
        if approved_json_pointer is None:
            return  # Default remains disabled until the path is explicitly reviewed.
        if (type(approved_json_pointer) is not str or not approved_json_pointer.startswith('/')
                or len(approved_json_pointer) > 1024):
            raise IdentityUnverified()
        raw = approved_json_pointer[1:].split('/')
        if len(raw) > 16:
            raise IdentityUnverified()
        parts = []
        forbidden = {'vmid', 'vmname', 'vmaddress', 'gatewayurl', 'accountlabel',
                     'sidechatlabel', 'accesstoken', 'token', 'cookie', 'cookies'}
        for part in raw:
            # RFC6901 permits only ~0 and ~1; reject invalid escape sequences.
            i = 0
            while i < len(part):
                if part[i] == '~':
                    if i + 1 == len(part) or part[i + 1] not in '01':
                        raise IdentityUnverified()
                    i += 1
                i += 1
            decoded = part.replace('~1', '/').replace('~0', '~')
            normalized = ''.join(c for c in decoded.lower() if c.isalnum())
            if not decoded or normalized in forbidden or any(ord(c) < 32 for c in decoded):
                raise IdentityUnverified()
            parts.append(decoded)
        self._parts = tuple(parts)

    @property
    def configured(self):
        return self._parts is not None

    def __repr__(self):
        return '<ConfiguredIdentityResolver approved-schema-required>'

    def __call__(self, identity_response: Mapping) -> str:
        if self._parts is None or not isinstance(identity_response, Mapping):
            raise IdentityUnverified()
        current = identity_response
        for part in self._parts:
            if not isinstance(current, Mapping) or part not in current:
                raise IdentityUnverified()
            current = current[part]
        if not _valid_account(current):
            raise IdentityUnverified()
        if not hmac.compare_digest(current.encode('utf-8'), self._account.encode('utf-8')):
            raise IdentityUnverified()
        return self._account
