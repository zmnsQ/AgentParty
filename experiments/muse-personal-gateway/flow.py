"""Offline-only flow prototype. No network, cookie reader, SDK or credential store.

Transport is an injected in-memory fake. This is NOT a working Muse connector.
It models safe UI transitions before any future live adapter is authorized.
"""
from dataclasses import dataclass, field
from enum import Enum


class State(str, Enum):
    UNBOUND = 'unbound'
    READ_ONLY = 'read_only_verified'
    PENDING = 'submission_pending'
    UNKNOWN = 'submission_unknown'
    CANDIDATE = 'reply_needs_confirmation'
    REAUTH = 'reauthorization_required'
    REVOKED = 'locally_disconnected'


@dataclass(frozen=True)
class Binding:
    account: str
    group: str
    session: str  # Existing, dedicated side chat, never implicit personal main chat.

    def __post_init__(self):
        if not all(isinstance(x, str) and x.strip() for x in (self.account, self.group, self.session)):
            raise ValueError('explicit_account_group_and_sidechat_required')


@dataclass
class FakeTransport:
    """Synthetic records only; no transport URL or real credential is accepted."""
    account: str = 'fixture-account'
    records: list = field(default_factory=list)
    calls: list = field(default_factory=list)
    fail_read: bool = False
    expire: bool = False
    ambiguous_send: bool = False

    def authenticate(self):
        self.calls.append(('authenticate',))
        if self.expire:
            raise PermissionError('login_expired')
        return self.account

    def history(self, session):
        self.calls.append(('history', session))
        if self.fail_read:
            raise ConnectionError('read_incomplete')
        return [dict(x) for x in self.records if x['session'] == session]

    def submit(self, session, text):
        self.calls.append(('submit', session, text))
        if self.ambiguous_send:
            raise TimeoutError('acceptance_unknown')
        return 'transport-accepted-not-completed'

    def close(self):
        self.calls.append(('close',))


class Flow:
    def __init__(self, binding, transport):
        # Deliberately disallow a live adapter in this experimental deliverable.
        if type(transport) is not FakeTransport:
            raise TypeError('offline_fake_transport_only')
        self.binding, self.transport = binding, transport
        self.max_records = 1000
        self.state = State.UNBOUND
        self.baseline = 0
        self.seen = set()
        self.operations = {}
        self.candidates = {}
        self.active_request = None

    def verify(self):
        if self.state == State.REVOKED:
            raise PermissionError('disconnected_create_new_flow_after_consent')
        previous = self.state
        try:
            account = self.transport.authenticate()
            if account != self.binding.account:
                raise PermissionError('account_mismatch')
            records = self.transport.history(self.binding.session)
            if len(records) > self.max_records:
                raise RuntimeError("history_page_truncated_or_over_budget")
        except PermissionError:
            self.state = State.REAUTH
            self.candidates.clear()
            self.seen.clear()  # Re-read scoped candidates only after identity is verified again.
            raise
        # A reconnect must not silently clear an in-flight/unknown submission.
        if previous in (State.UNBOUND, State.REAUTH):
            self.state = State.UNKNOWN if self.active_request else State.READ_ONLY
        return records

    def send(self, request_id, text, *, human_approved=False):
        if not human_approved:
            raise PermissionError('explicit_single_message_approval_required')
        if len(self.operations) >= 100 or len(text) > 12000:
            raise ValueError("operation_budget_exceeded")
        if not request_id or not text.strip():
            raise ValueError('request_id_and_text_required')
        if request_id in self.operations:
            if self.operations[request_id] != text:
                raise ValueError('request_id_content_conflict')
            return self.state  # Never repeat a remotely uncertain submission.
        if self.state != State.READ_ONLY:
            raise RuntimeError('verify_or_resolve_previous_submission_first')
        records = self.verify()  # Failure means NO send, including baseline failure.
        self.baseline = max([x['seq'] for x in records] + [0])
        self.operations[request_id] = text
        self.active_request = request_id
        self.state = State.PENDING
        try:
            self.transport.submit(self.binding.session, text)
        except Exception:
            self.state = State.UNKNOWN
            raise
        return self.state

    def reconcile(self):
        if self.state in (State.REVOKED, State.UNBOUND, State.REAUTH):
            raise PermissionError('verified_binding_required')
        if not self.active_request:
            return []
        records = self.verify()  # Read only. No resend after reconnect.
        found = []
        for event in records:
            key = (self.binding.account, self.binding.session, event['id'], event['seq'])
            if key in self.seen or event['seq'] <= self.baseline:
                continue
            if event.get('role') != 'assistant' or event.get('background') or event.get('status') != 'completed':
                continue  # A later history read may complete this same id/seq.
            if not isinstance(event.get('text'), str) or len(event['text']) > 12000:
                raise RuntimeError('candidate_text_budget_exceeded')
            if sum(len(x['text']) for x in self.candidates.values()) + len(event['text']) > 120000:
                raise RuntimeError('total_candidate_text_budget_exceeded')
            if len(self.seen) >= self.max_records:
                raise RuntimeError('event_budget_exceeded')
            self.seen.add(key)
            # seq/time proximity does NOT establish request causality.
            self.candidates[event['id']] = event
            found.append({'id': event['id'], 'text': event['text'], 'status': 'needs_human_confirmation'})
        if found:
            self.state = State.CANDIDATE
        return found

    def confirm_candidate(self, event_id, *, human_approved=False):
        if self.state != State.CANDIDATE or not human_approved or event_id not in self.candidates:
            raise PermissionError('explicit_reply_confirmation_required')
        # A preview only. This prototype never writes back to Agent Commons.
        return {'group': self.binding.group, 'session': self.binding.session,
                'text': self.candidates[event_id]['text'], 'posted': False}

    def disconnect(self):
        self.transport.close()
        self.candidates.clear()
        self.operations.clear()
        self.active_request = None
        self.state = State.REVOKED
        return {'local_disconnected': True, 'provider_session_revoked': False}
