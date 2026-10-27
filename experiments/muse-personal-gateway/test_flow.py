import unittest
from flow import Binding, FakeTransport, Flow, State

class Tests(unittest.TestCase):
    def setUp(self):
        self.t = FakeTransport()
        self.f = Flow(Binding('fixture-account', 'fixture-group', 'dedicated-sidechat'), self.t)
    def ready(self): self.f.verify()
    def sent(self): self.ready(); self.f.send('one', 'synthetic message', human_approved=True)
    def event(self, **kw):
        e = dict(id='event-1',seq=9007199254740999,session='dedicated-sidechat',role='assistant',status='completed',text='synthetic reply')
        e.update(kw);self.t.records.append(e)
    def test_rejects_live_adapter(self):
        with self.assertRaises(TypeError): Flow(self.f.binding, object())
    def test_requires_explicit_sidechat(self):
        with self.assertRaises(ValueError): Binding('account','group','')
    def test_verify_read_only(self):
        self.ready();self.assertEqual(self.f.state,State.READ_ONLY)
        self.assertEqual([x[0] for x in self.t.calls],['authenticate','history'])
    def test_wrong_account_stops(self):
        self.t.account='other'
        with self.assertRaises(PermissionError):self.ready()
        self.assertFalse(any(x[0]=='history' for x in self.t.calls))
    def test_requires_message_approval(self):
        self.ready()
        with self.assertRaises(PermissionError):self.f.send('one','hello')
    def test_failed_baseline_never_sends(self):
        self.ready();self.t.fail_read=True
        with self.assertRaises(ConnectionError):self.f.send('one','hello',human_approved=True)
        self.assertFalse(any(x[0]=='submit' for x in self.t.calls))
    def test_expiry_requires_reauthorization(self):
        self.ready();self.t.expire=True
        with self.assertRaises(PermissionError):self.f.send('one','hello',human_approved=True)
        self.assertEqual(self.f.state,State.REAUTH)
    def test_unknown_submission_not_repeated(self):
        self.ready();self.t.ambiguous_send=True
        with self.assertRaises(TimeoutError):self.f.send('one','hello',human_approved=True)
        self.f.send('one','hello',human_approved=True);self.f.verify()
        self.assertEqual(self.f.state,State.UNKNOWN)
        self.assertEqual(sum(x[0]=='submit' for x in self.t.calls),1)
    def test_no_concurrent_request(self):
        self.sent()
        with self.assertRaises(RuntimeError):self.f.send('two','other',human_approved=True)
    def test_id_conflict(self):
        self.sent()
        with self.assertRaises(ValueError):self.f.send('one','different',human_approved=True)
    def test_session_isolation(self):
        self.sent();self.event(session='personal-main')
        self.assertEqual(self.f.reconcile(),[])
    def test_no_heuristic_auto_reply(self):
        self.sent();self.event()
        result=self.f.reconcile();self.assertEqual(result[0]['status'],'needs_human_confirmation')
        with self.assertRaises(PermissionError):self.f.confirm_candidate('event-1')
        self.assertFalse(self.f.confirm_candidate('event-1',human_approved=True)['posted'])
    def test_dedup_and_large_integer(self):
        self.sent();self.event();self.assertEqual(len(self.f.reconcile()),1)
        self.assertEqual(self.f.reconcile(),[])
    def test_incomplete_or_failed_not_candidate(self):
        self.sent();self.event(status='failed');self.event(id='two',status='running')
        self.assertEqual(self.f.reconcile(),[])
    def test_read_budget_fails_closed(self):
        self.f.max_records=0;self.event()
        with self.assertRaises(RuntimeError):self.ready()
        self.assertEqual(self.f.state,State.UNBOUND)
    def test_running_event_can_later_complete(self):
        self.sent();self.event(status='running');self.assertEqual(self.f.reconcile(),[])
        self.t.records[0]['status']='completed'
        self.assertEqual(len(self.f.reconcile()),1)
    def test_expired_candidate_can_be_reverified_without_resend(self):
        self.sent();self.event();self.f.reconcile();self.t.expire=True
        with self.assertRaises(PermissionError):self.f.verify()
        self.assertEqual(self.f.candidates,{})
        self.t.expire=False;self.f.verify();self.assertEqual(len(self.f.reconcile()),1)
        self.assertFalse(self.f.confirm_candidate('event-1',human_approved=True)['posted'])
        self.assertEqual(sum(x[0]=='submit' for x in self.t.calls),1)
    def test_oversized_candidate_is_rejected(self):
        self.sent();self.event(text='x'*12001)
        with self.assertRaises(RuntimeError):self.f.reconcile()
        self.assertEqual(self.f.candidates,{})
    def test_background_not_forwarded(self):
        self.sent();self.event(background=True);self.assertEqual(self.f.reconcile(),[])
    def test_reconnect_only_reads(self):
        self.sent();self.f.verify();self.f.reconcile()
        self.assertEqual(sum(x[0]=='submit' for x in self.t.calls),1)
    def test_disconnect_is_not_provider_revoke(self):
        self.sent();result=self.f.disconnect()
        self.assertFalse(result['provider_session_revoked'])
        with self.assertRaises(PermissionError):self.f.verify()

if __name__=='__main__':unittest.main()
