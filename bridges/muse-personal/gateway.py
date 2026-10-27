"""Experimental, session-scoped personal Muse adapter boundary.

No browser automation, credential files, fingerprint impersonation, polling or
push implementation. The reviewed reverse-engineered source is evidence, not a
supported Meta API contract. Noise/protobuf transport is deliberately injectable:
without an independently reviewed implementation this module fails closed.
The audited session response does not establish an account identity schema. A
reviewed /identity account_resolver is required; absent identity evidence must fail closed,
never substitute a VM ID. reconnect() is explicit and read-only: no retry loop.
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
import uuid
from dataclasses import dataclass, field
from typing import Callable, Mapping, Protocol
from urllib.error import HTTPError
from urllib.request import Request, HTTPRedirectHandler, ProxyHandler, build_opener


class GatewayError(RuntimeError):
    def __init__(self, *_ignored): super().__init__('personal_gateway_unavailable')


class AuthRequired(GatewayError):
    def __init__(self, *_ignored): RuntimeError.__init__(self, 'personal_gateway_authorization_required')


class UnknownDelivery(GatewayError):
    def __init__(self, *_ignored): RuntimeError.__init__(self, 'personal_gateway_delivery_unknown')


class TransportUnavailable(GatewayError):
    def __init__(self, *_ignored): RuntimeError.__init__(self, 'personal_gateway_transport_not_configured')


class ScopeError(GatewayError):
    def __init__(self, *_ignored): RuntimeError.__init__(self, 'personal_gateway_scope_rejected')


class SecretProvider(Protocol):
    def cookie(self) -> str:
        """Return only explicitly authorized muse.ai cookies; never discover them."""
        ...


@dataclass(frozen=True, repr=False)
class HttpReply:
    status: int
    data: Mapping = field(repr=False)


class JsonHttp(Protocol):
    def request(self, path: str, cookie: str, *, bearer: str | None = None,
                payload: dict | None = None) -> HttpReply: ...


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs): raise GatewayError()


class FixedOriginHttps:
    """TLS verification enabled by urllib; no redirects, proxies or impersonation."""
    PATHS = frozenset(('/api/session', '/api/auth/check', '/api/hatch/token'))

    def request(self, path, cookie, *, bearer=None, payload=None):
        if path not in self.PATHS: raise ScopeError()
        headers = {'Accept': 'application/json', 'Content-Type': 'application/json',
                   'Cookie': _secret(cookie)}
        if bearer is not None: headers['Authorization'] = 'Bearer ' + _secret(bearer)
        # No arbitrary URL, Referer/Sec-Fetch forgery or browser TLS fingerprint.
        body = None if path == '/api/session' else (b'' if payload is None else json.dumps(payload).encode())
        request = Request('https://muse.ai' + path, headers=headers,
                          method='GET' if body is None else 'POST', data=body)
        try:
            with build_opener(ProxyHandler({}), _NoRedirect()).open(request, timeout=20) as response:
                raw = response.read(262145)
                if len(raw) > 262144: raise GatewayError()
                value = json.loads(raw)
                if not isinstance(value, dict): raise GatewayError()
                return HttpReply(response.status, value)
        except HTTPError as error:
            # Do not read/log bodies, URLs or headers from authentication failures.
            status = error.code
            error.close()
            if status in (401, 403): raise AuthRequired() from None
            raise GatewayError() from None
        except AuthRequired: raise
        except Exception: raise GatewayError() from None


def _secret(value):
    if not isinstance(value, str) or not value or len(value) > 16384 or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise AuthRequired()
    return value


def _session(value):
    try:
        if not isinstance(value, str) or str(uuid.UUID(value)) != value: raise ValueError()
    except (ValueError, AttributeError): raise ScopeError() from None
    return value


@dataclass(frozen=True)
class Bootstrap:
    vm_id: str
    hatch_token: str = field(repr=False)
    host: str = 'hatch.metaaivm.com'
    # Adapter must use TLS with certificate verification, expected host and a
    # reviewed Noise XX/protobuf implementation. Never put auth URLs in logs.


@dataclass(frozen=True)
class SendAck:
    """Normalized adapter evidence, NOT an invented upstream JSON format.

    accepted=True requires a validated server ACK, never just a socket write.
    No causal assistant-reply correlation is inferred from an ACK.
    """
    session_id: str
    accepted: bool
    message_id: str | None = None


class NoiseChannel(Protocol):
    def identity(self) -> Mapping:
        """Read only GET /identity; no account assumptions from the VM ID."""
        ...
    def history(self, session_id: str, limit: int) -> Mapping:
        """Issue chat.history with this exact nonempty session_id and limit."""
        ...
    def send(self, session_id: str, text: str) -> SendAck:
        """Send chat.stream text items + exact session_id; validate ACK or fail.

        Do not send the caller's local request_id as an undocumented wire field.
        No transport-level retries and no fallback to the main conversation.
        """
        ...
    def close(self) -> None: ...


class Gateway:
    """Exactly one approved account and side session; serialized transport calls.

    The caller must durably record an operation BEFORE calling send. This module
    only adds in-process duplicate protection; a restart cannot prove non-send.
    account_resolver is mandatory reviewed schema-specific account verification:
    a VM identifier alone is NOT evidence of the account's identity.
    """
    def __init__(self, *, secrets: SecretProvider, session_id: str, account_id: str,
                 http: JsonHttp | None = None,
                 noise_factory: Callable[[Bootstrap], NoiseChannel] | None = None,
                 account_resolver: Callable[[Mapping], str] | None = None):
        self._session = _session(session_id)
        if not isinstance(account_id, str) or not account_id or len(account_id) > 200: raise ScopeError()
        self._account = account_id
        self._secrets = secrets
        self._http = http or FixedOriginHttps()
        self._factory, self._resolver = noise_factory, account_resolver
        self._channel = None
        self._lock = threading.RLock()
        self._attempts = {}
        self._closed = False

    def __repr__(self): return '<PersonalMuseGateway session-scoped transport>'

    def _auth(self, path, cookie, **kwargs):
        reply = self._http.request(path, cookie, **kwargs)
        if reply.status in (401, 403): raise AuthRequired()
        if reply.status != 200 or not isinstance(reply.data, Mapping): raise GatewayError()
        return reply.data

    def _connect(self):
        if self._closed: raise TransportUnavailable()
        if self._channel is not None: return
        if self._factory is None or self._resolver is None: raise TransportUnavailable()
        if getattr(self._resolver, "configured", True) is False: raise TransportUnavailable()
        try:
            cookie = _secret(self._secrets.cookie())
            info = self._auth('/api/session', cookie)
            vm = info.get('vm_id')
            if not isinstance(vm, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}', vm): raise GatewayError()
            access = _secret(self._auth('/api/auth/check', cookie).get('access_token'))
            token = _secret(self._auth('/api/hatch/token', cookie, bearer=access,
              payload={'vmAddress': f'wss://{vm}.metaaivm.com/', 'vmName': vm}).get('token'))
            channel = self._factory(Bootstrap(vm, token))
            if channel is None: raise TransportUnavailable()
            try:
                identity = channel.identity()
                if not isinstance(identity, Mapping) or self._resolver(identity) != self._account: raise ScopeError()
            except Exception:
                try: channel.close()
                except Exception: pass
                raise
            self._channel = channel
        except (AuthRequired, ScopeError, TransportUnavailable): raise
        except Exception: raise GatewayError() from None
        # No token/cookie persisted on this object. Python immutable strings
        # cannot promise secure zeroization; provider/adapter owns their lifetime.

    def verify_account(self) -> str:
        with self._lock:
            self._connect()
            return self._account

    def reconnect(self) -> str:
        """Explicit read-only reauthentication; preserve all send deduplication.

        Drop the old channel even if closing it fails. The provider is consulted
        again; no cached Cookie/access/hatch token is reused by this gateway.
        Adapters must discard their own token references on close (Python cannot
        guarantee zeroization). Failure leaves no channel and never retries or
        replays any send. close() remains terminal.
        """
        with self._lock:
            if self._closed: raise TransportUnavailable()
            channel, self._channel = self._channel, None
            if channel is not None:
                try: channel.close()
                except Exception: pass
            self._connect()
            return self._account

    def _check_scope(self, session_id):
        if _session(session_id) != self._session: raise ScopeError()

    def history(self, session_id, after_seq: int):
        self._check_scope(session_id)
        if type(after_seq) is not int or after_seq < 0: raise ScopeError()
        with self._lock:
            self._connect()
            try:
                result = self._channel.history(self._session, 20)
                events = result.get('chat_events')
                if not isinstance(events, list) or len(events) > 20: raise GatewayError()
                # A full latest-page window may have skipped unseen events. Without
                # a verified pagination contract do not let a runner advance past a gap.
                if len(events) == 20 and all(isinstance(e,dict) and type(e.get('seq')) is int and e['seq'] > after_seq for e in events):
                    raise GatewayError()
                rows = []
                for event in events:
                    if not isinstance(event, dict): raise GatewayError()
                    if event.get('session_id', self._session) != self._session: raise ScopeError()
                    seq = event.get('seq')
                    if type(seq) is not int or seq < 0: raise GatewayError()
                    if seq <= after_seq: continue
                    role = {'message.user': 'user', 'message.assistant': 'assistant'}.get(event.get('event_name'))
                    if role is None: continue
                    payload = event.get('payload') or {}
                    if not isinstance(payload, dict): raise GatewayError()
                    text = payload.get('display_text', event.get('display_text'))
                    ident = payload.get('message_id') or event.get('message_id', event.get('id'))
                    if not isinstance(text, str) or len(text) > 12000 or not isinstance(ident, str) or not 1 <= len(ident) <= 200: raise GatewayError()
                    status = payload.get('status')
                    rows.append({'id':ident,'seq':seq,'session_id':self._session,'role':role,
                      'status':status if status in ('completed','running','failed') else 'unknown','text':text})
                # No correlation_id fabricated from timestamps, node_id or reply_to heuristics.
                return sorted(rows, key=lambda row:row['seq'])
            except (AuthRequired, ScopeError): raise
            except Exception: raise GatewayError() from None

    def send(self, session_id, text, request_id):
        self._check_scope(session_id)
        if not isinstance(text, str) or not text.strip() or len(text) > 8000 or not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', request_id): raise ScopeError()
        digest = hashlib.sha256(text.encode()).hexdigest()
        with self._lock:
            if request_id in self._attempts:
                previous, receipt = self._attempts[request_id]
                if previous != digest: raise ScopeError()
                if receipt is None: raise UnknownDelivery()
                return dict(receipt)
            self._connect()  # Auth failure before dispatch is not an uncertain send.
            self._attempts[request_id] = (digest, None)
            try:
                ack = self._channel.send(self._session, text)
                if not isinstance(ack, SendAck) or ack.accepted is not True or ack.session_id != self._session or not isinstance(ack.message_id, str) or not 1 <= len(ack.message_id) <= 200:
                    raise UnknownDelivery()
                receipt = {'accepted':True,'message_id':ack.message_id}
                self._attempts[request_id] = (digest, receipt)
                return dict(receipt)
            except Exception: raise UnknownDelivery() from None

    def close(self):
        with self._lock:
            self._closed = True
            channel, self._channel = self._channel, None
            if channel is not None:
                try: channel.close()
                except Exception: pass
