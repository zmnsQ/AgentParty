import base64,hashlib,hmac,json,tempfile,time,unittest,subprocess
from pathlib import Path
from types import SimpleNamespace
from bridge import Config,Bridge,Store,verify,eligible_message,deliver_to_muse
KEY='whsec_'+base64.b64encode(b'x'*32).decode()
class BridgeTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.c=Config('https://commons.example','ch-test','muse-group-agent','ap_fixture',KEY,'/usr/local/bin/musegadget',Path(self.temp.name)/'state.db')
 def tearDown(self):self.temp.cleanup()
 def signed(self,data,event='evt_fixture'):
  raw=json.dumps(data).encode();stamp=str(int(time.time()));sig=base64.b64encode(hmac.new(b'x'*32,event.encode()+b'.'+stamp.encode()+b'.'+raw,hashlib.sha256).digest()).decode()
  return {'webhook-id':event,'webhook-timestamp':stamp,'webhook-signature':'v1,'+sig},raw
 def test_signed_challenge(self):
  bridge=Bridge(self.c);headers,body=self.signed({'type':'verification','challenge':'fixture-challenge-1234'})
  self.assertEqual(bridge.accept(headers,body),(200,{'challenge':'fixture-challenge-1234'}));self.assertEqual(bridge.store.counts(),{})
 def test_forged_or_old_signature_rejected(self):
  headers,raw=self.signed({'type':'verification','challenge':'fixture-challenge-1234'})
  with self.assertRaises(ValueError):verify(KEY,headers,raw+b'x')
  with self.assertRaises(ValueError):verify(KEY,headers,raw,now=time.time()+600)
 def test_event_deduplicated_without_claiming_completion(self):
  bridge=Bridge(self.c);headers,raw=self.signed({'eventId':'evt_fixture','name':'message.created','data':{'channel_id':'ch-test','message_seq':1}})
  for _ in range(2):self.assertEqual(bridge.accept(headers,raw),(202,{'accepted':True,'completed':False}))
  self.assertEqual(bridge.store.counts(),{'queued':1})
 def test_wrong_group_never_queued(self):
  bridge=Bridge(self.c);headers,raw=self.signed({'eventId':'evt_fixture','name':'message.created','data':{'channel_id':'another-group','message_seq':1}})
  with self.assertRaises(ValueError):bridge.accept(headers,raw)
  self.assertEqual(bridge.store.counts(),{})
 def test_only_exact_human_mention_is_eligible(self):
  msg={'seq':7,'sender':{'kind':'human'},'mentions':['muse-group-agent'],'body':'Please summarize.'}
  self.assertEqual(eligible_message(self.c,7,{'messages':[msg]}),'Please summarize.')
  for replacement in [{'seq':8},{'sender':{'kind':'agent'}},{'mentions':[]},{'body':'x'*12001}]:
   self.assertIsNone(eligible_message(self.c,7,{'messages':[{**msg,**replacement}]}))
 def test_official_cli_uses_stdin_and_isolated_side_session_no_shell(self):
  seen=[]
  def run(args,**kwargs):seen.append((args,kwargs));return SimpleNamespace(returncode=0)
  self.assertEqual(deliver_to_muse(self.c,7,'untrusted; rm -rf /',run),'sent_to_muse')
  args,kwargs=seen[0];self.assertEqual(args[:2],['/usr/local/bin/musegadget','send-user-msg']);self.assertIn('--session-id',args)
  self.assertNotIn('shell',kwargs);self.assertNotIn('rm -rf',str(args));self.assertIn('rm -rf',kwargs['input'])
  self.assertNotIn(self.c.token,kwargs['input']);self.assertNotIn(KEY,kwargs['input'])
 def test_timeout_is_unknown_not_silently_retried(self):
  def timeout(*args,**kwargs):raise subprocess.TimeoutExpired('musegadget',100)
  self.assertEqual(deliver_to_muse(self.c,7,'Task',timeout),'unknown')
 def test_uncertain_dispatch_is_not_replayed_after_restart(self):
  store=Store(self.c.state);store.add('event1',1);self.assertEqual(store.take(),('event1',1));store.db.close()
  restored=Store(self.c.state);self.assertEqual(restored.counts(),{'unknown':1});self.assertIsNone(restored.take());restored.db.close()
 def test_session_is_scoped_and_identity_config_strict(self):
  self.c.validate();c2=Config(**{**self.c.__dict__,'channel':'other-group'});self.assertNotEqual(self.c.session,c2.session)
  for patch in [{'server':'http://commons.example'},{'muse_bin':'musegadget'},{'token':'apb_browser'},{'channel':'wrong scope'}]:
   with self.assertRaises(ValueError):Config(**{**self.c.__dict__,**patch}).validate()
if __name__=='__main__':unittest.main()
