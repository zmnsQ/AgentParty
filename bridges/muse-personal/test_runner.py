import tempfile
import unittest
from pathlib import Path
from runner import Config, Runner

class Fake:
    def __init__(self):self.account='acct';self.rows=[];self.sent=[];self.fail=False;self.unknown=False
    def verify_account(self):return self.account
    def history(self,session,after):
        if self.fail:raise RuntimeError('sensitive remote log')
        return self.rows
    def send(self,s,t,k):
        self.sent.append((s,t,k))
        if self.unknown:raise TimeoutError('private token in upstream exception')
        return {'accepted':True}
    def close(self):pass

class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=str(Path(self.tmp.name)/'ledger.sqlite')
        self.g=Fake();self.now=1000.;self.c=Config('group','acct','side',True)
        self.r=Runner(self.c,self.g,self.path,lambda:self.now,binding_guard=lambda g,s:True)
    def tearDown(self):self.r.db.close();self.tmp.cleanup()
    def send(self):return self.r.submit('one','hello',group='group',actor_kind='human',approved=True)
    def event(self,**kw):
        d=dict(id='reply',seq=9007199254740995,session_id='side',role='assistant',status='completed',text='reply');d.update(kw);self.g.rows=[d]
    def test_default_disabled(self):
        x=Runner(Config('g','a','s'),Fake(),':memory:')
        with self.assertRaises(PermissionError):x.verify()
        x.db.close()
    def test_missing_or_revoked_binding_cannot_send(self):
        self.r.binding_guard=None
        with self.assertRaises(PermissionError):self.send()
        self.assertEqual(self.g.sent,[])
    def test_binding_mismatch(self):
        with self.assertRaises(ValueError):Runner(Config('other','acct','side',True),self.g,self.path)
    def test_wrong_account(self):
        self.g.account='different'
        with self.assertRaises(PermissionError):self.send()
        self.assertEqual(self.g.sent,[])
    def test_read_failed_no_send(self):
        self.g.fail=True
        with self.assertRaisesRegex(RuntimeError,'history_unavailable'):self.send()
        self.assertEqual(self.g.sent,[])
    def test_approval_and_actor_boundary(self):
        for g,a,p in [('other','human',True),('group','agent',True),('group','human',False)]:
            with self.assertRaises(PermissionError):self.r.submit('one','x',group=g,actor_kind=a,approved=p)
    def test_restart_does_not_resend_unknown(self):
        self.g.unknown=True;self.assertEqual(self.send(),'submission_unknown');self.r.db.close()
        self.r=Runner(self.c,self.g,self.path,lambda:self.now,binding_guard=lambda g,s:True);self.send();self.r.verify()
        self.assertEqual(len(self.g.sent),1);self.assertEqual(self.r.state,'submission_unknown')
    def test_idempotency_conflict(self):
        self.send()
        with self.assertRaises(ValueError):self.r.submit('one','different',group='group',actor_kind='human',approved=True)
    def test_single_inflight(self):
        self.send()
        with self.assertRaises(RuntimeError):self.r.submit('two','other',group='group',actor_kind='human',approved=True)
    def test_candidate_no_automatic_post(self):
        self.send();self.event();result=self.r.poll('one');self.assertEqual(result[0]['state'],'needs_confirmation')
        with self.assertRaises(PermissionError):self.r.post_confirmed('one','reply',result[0]['seq'],'reply',lambda *a:None,group='group')
    def test_poll_throttle_and_expiry(self):
        self.send();self.event();self.assertEqual(len(self.r.poll('one')),1);self.assertEqual(self.r.poll('one'),[])
        self.now+=1000;self.assertEqual(self.r.poll('one'),[]);self.assertEqual(self.r.state,'submission_unknown')
    def test_running_then_complete(self):
        self.send();self.event(status='running');self.assertEqual(self.r.poll('one'),[])
        self.event();self.now+=10;self.assertEqual(len(self.r.poll('one')),1)
    def test_candidate_restored_after_restart(self):
        self.send();self.event();self.r.poll('one');self.r.db.close();self.now+=10
        self.r=Runner(self.c,self.g,self.path,lambda:self.now,binding_guard=lambda g,s:True)
        self.assertEqual(len(self.r.poll('one')),1)
        self.assertEqual(len(self.g.sent),1)
    def test_unbound_legacy_rejected(self):
        self.send();self.r.db.execute('DELETE FROM binding')
        with self.assertRaises(ValueError):Runner(self.c,self.g,self.path)
    def test_wrong_session_fails_closed(self):
        self.send();self.event(session_id='main')
        with self.assertRaises(RuntimeError):self.r.poll('one')
    def test_post_unknown_not_repeated(self):
        self.send();self.event();self.r.poll('one');calls=[]
        def p(*args):calls.append(args);raise TimeoutError()
        args=('one','reply',9007199254740995,'reply',p)
        self.assertEqual(self.r.post_confirmed(*args,group='group',approved=True),'post_unknown')
        self.assertEqual(self.r.post_confirmed(*args,group='group',approved=True),'post_unknown');self.assertEqual(len(calls),1)
        self.r.verify();self.r.poll('one');self.assertEqual(self.r.state,'submission_unknown')
    def test_verified_post_scoped_receipt(self):
        self.send();self.event();self.r.poll('one')
        def p(g,t,k):return {'verified':True,'group':g,'idempotency_key':k}
        self.assertEqual(self.r.post_confirmed('one','reply',9007199254740995,'reply',p,group='group',approved=True),'posted_verified')
    def test_two_candidates_cannot_both_post(self):
        self.send();self.event();self.r.poll('one');first=self.g.rows[0].copy()
        self.event(id='second',seq=9007199254740996);self.now+=10;self.r.poll('one');calls=[]
        def p(g,t,k):calls.append(k);return {'verified':True,'group':g,'idempotency_key':k}
        self.r.post_confirmed('one','reply',first['seq'],'reply',p,group='group',approved=True)
        result=self.r.post_confirmed('one','second',9007199254740996,'reply',p,group='group',approved=True)
        self.assertEqual(result,'operation_already_claimed_or_resolved');self.assertEqual(len(calls),1)
    def test_timeout_survives_verify(self):
        self.send();self.now+=1000;self.r.poll('one');self.r.verify()
        self.assertEqual(self.r.state,'submission_unknown')
    def test_no_secrets_or_message_body_in_ledger(self):
        self.send();dump='\n'.join(self.r.db.iterdump());self.assertNotIn('hello',dump)
    def test_local_disconnect_not_remote_revoke(self):
        self.assertFalse(self.r.disconnect()['provider_session_revoked'])
        with self.assertRaises(PermissionError):self.send()

if __name__=='__main__':unittest.main()
