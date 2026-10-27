import socket,base64,hashlib,hmac,json,tempfile,time,unittest,subprocess
from pathlib import Path
from types import SimpleNamespace
from bridge import Config,Bridge,Store,verify,eligible_message,deliver_to_muse,subscribe,subscription_binding,verify_receipt,handle_reply,reply_client,cleanup_reply_socket,run_bridge
from unittest.mock import patch
from datetime import datetime,timezone
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
  restored=Store(self.c.state,recover=True);self.assertEqual(restored.counts(),{'unknown':1});self.assertIsNone(restored.take());restored.db.close()
 def test_session_is_scoped_and_identity_config_strict(self):
  self.c.validate();c2=Config(**{**self.c.__dict__,'channel':'other-group'});self.assertNotEqual(self.c.session,c2.session)
  for patch in [{'server':'http://commons.example'},{'muse_bin':'musegadget'},{'token':'apb_browser'},{'channel':'wrong scope'}]:
   with self.assertRaises(ValueError):Config(**{**self.c.__dict__,**patch}).validate()
 def test_scope_mismatch_and_legacy_unbound_fail_closed(self):
  store=Store(self.c.state,scope=self.c.session);store.add('event',7)
  with self.assertRaises(ValueError):Store(self.c.state,scope='other-scope')
  other=Path(self.temp.name)/'legacy.db';Store(other).add('old',1)
  with self.assertRaises(ValueError):Store(other,scope=self.c.session)
 def test_second_worker_cannot_recover_live_dispatch(self):
  store=Store(self.c.state,recover=True,scope=self.c.session);store.add('event',7);store.take()
  with self.assertRaises(RuntimeError):Store(self.c.state,recover=True,scope=self.c.session)
  self.assertEqual(store.counts(),{'dispatching':1})
 def test_maintenance_open_does_not_recover_live_dispatch(self):
  store=Store(self.c.state);store.add('evt',7);store.take()
  observer=Store(self.c.state,recover=False);self.assertEqual(observer.counts(),{'dispatching':1})
 def test_allowlist_is_explicit_root_only_and_never_self(self):
  config=Config(**{**self.c.__dict__,'allowed_agents':('helper',)})
  msg={'seq':7,'sender':{'kind':'agent','name':'helper'},'mentions':[self.c.agent],'body':'Task','reply_to':None}
  self.assertIsNone(eligible_message(self.c,7,{'messages':[msg]}))
  self.assertEqual(eligible_message(config,7,{'messages':[msg]}),'Task')
  for change in [{'sender':{'kind':'agent','name':'unknown'}},{'sender':{'kind':'agent','name':self.c.agent}},{'reply_to':6},{'reply_to':'6'},{'mentions':[]}]:
   self.assertIsNone(eligible_message(config,7,{'messages':[{**msg,**change}]}))
  with self.assertRaises(ValueError):Config(**{**self.c.__dict__,'allowed_agents':(self.c.agent,)}).validate()
 def test_message_seq_dedup_survives_distinct_event_ids_and_restart(self):
  store=Store(self.c.state);self.assertTrue(store.add('first',7));self.assertFalse(store.add('retry',7))
  store.take();store.finish('first','unknown');store.db.close()
  restored=Store(self.c.state);self.assertFalse(restored.add('another',7));self.assertIsNone(restored.take())
 def test_persistent_rate_budget_is_bounded(self):
  store=Store(self.c.state)
  self.assertTrue(store.reserve(1,100));self.assertFalse(store.reserve(1,159));store.db.close()
  store=Store(self.c.state);self.assertFalse(store.reserve(1,159));self.assertTrue(store.reserve(1,160))
 def test_renewal_opt_in_and_failure_preserves_success_expiry(self):
  config=Config(**{**self.c.__dict__,'callback':'https://bridge.example/events','auto_renew':True})
  bridge=Bridge(config);prior={'id':'sub_fixture','expires':1000,'binding':subscription_binding(config),'status':'active'}
  bridge.store.setting('subscription',prior)
  with patch('bridge.subscribe',side_effect=RuntimeError('offline')) as call:
   bridge.renew(100);call.assert_called_once()
   failed=bridge.store.setting('subscription');self.assertEqual(failed['expires'],1000);self.assertEqual(failed['status'],'renewal_failed')
   bridge.renew(101);self.assertEqual(call.call_count,1)
  with patch('bridge.subscribe') as call:
   bridge.config=self.c;bridge.renew(10000);call.assert_not_called()
 def test_renewal_only_same_existing_subscription_and_due(self):
  config=Config(**{**self.c.__dict__,'callback':'https://bridge.example/events','auto_renew':True})
  bridge=Bridge(config)
  with patch('bridge.subscribe') as call:
   bridge.renew();call.assert_not_called()
   bridge.store.setting('subscription',{'expires':10000,'binding':'wrong'})
   bridge.renew(10000);call.assert_not_called()
   bridge.store.setting('subscription',{'expires':10000,'binding':subscription_binding(config)})
   bridge.renew(100);call.assert_not_called()
   bridge.renew(6500);call.assert_called_once()
 def test_subscribe_saves_verified_receipt_without_secret(self):
  config=Config(**{**self.c.__dict__,'callback':'https://bridge.example/events'})
  store=Store(self.c.state);expires=datetime.fromtimestamp(time.time()+86400,timezone.utc).isoformat()
  with patch('bridge.rpc',return_value={'id':'sub_fixture','refreshBefore':expires}):subscribe(config,store)
  saved=store.setting('subscription');self.assertEqual(saved['status'],'active');self.assertNotIn(KEY,json.dumps(saved));self.assertNotIn(self.c.token,json.dumps(saved))
 def test_receipt_requires_exact_group_identity_and_correlated_reply(self):
  store=Store(self.c.state);store.add('evt',7);store.take();store.finish('evt','sent_to_muse')
  msg={'seq':8,'reply_to':7,'sender':{'kind':'agent','name':self.c.agent}}
  with patch('bridge.verify_identity'),patch('bridge.api',return_value={'messages':[msg]}):
   self.assertTrue(verify_receipt(self.c,store,8));self.assertEqual(store.counts(),{'reply_observed':1})
  for change in [{'sender':{'kind':'agent','name':'other'}},{'reply_to':6},{'seq':9}]:
   with patch('bridge.verify_identity'),patch('bridge.api',return_value={'messages':[{**msg,**change}]}):self.assertFalse(verify_receipt(self.c,store,8))
 def reply_fixture(self):
  store=Store(self.c.state);store.add('task-event',7);store.take();token=store.create_reply_task(7)
  return store,token
 def test_reply_capability_scoped_expiring_and_not_plaintext_in_store(self):
  store,token=self.reply_fixture()
  self.assertNotIn(token,str(store.db.execute('SELECT * FROM reply_tasks').fetchall()))
  with self.assertRaises(ValueError):store.create_reply_task(99)
  with self.assertRaises(ValueError):store.claim_reply('unknown','hash')
  with self.assertRaises(ValueError):store.claim_reply(token,'hash',time.time()+3601)
 def test_gadget_reply_posts_fixed_destination_then_readback_once(self):
  store,token=self.reply_fixture();calls=[]
  def fake_api(config,path,data=None):
   calls.append((path,data))
   if data is not None:return {'seq':8}
   return {'messages':[{'seq':8,'reply_to':7,'sender':{'name':self.c.agent,'kind':'agent'},'body':'Done'}]}
  with patch('bridge.verify_identity'),patch('bridge.api',side_effect=fake_api):
   result=handle_reply(self.c,store,{'task':token,'body':'Done'})
   self.assertEqual(result,{'status':'reply_verified','reply_seq':8,'task_completed':False})
   self.assertEqual(handle_reply(self.c,store,{'task':token,'body':'Done'}),result)
  self.assertEqual(len(calls),2);self.assertEqual(calls[0][0],'/api/channels/ch-test/messages')
  self.assertEqual(calls[0][1]['mentions'],[]);self.assertEqual(calls[0][1]['body_mentions'],[]);self.assertEqual(calls[0][1]['reply_to'],7)
  self.assertEqual(store.counts(),{'reply_observed':1})
  store.finish('task-event','sent_to_muse');self.assertEqual(store.counts(),{'reply_observed':1})
 def test_reply_rejects_routing_override_body_conflict_and_capability_echo(self):
  store,token=self.reply_fixture()
  for extra in [{'reply_to':9},{'channel':'other'},{'mentions':['other']},{'path':'/private'}]:
   with self.assertRaises(ValueError):handle_reply(self.c,store,{'task':token,'body':'Answer',**extra})
  with self.assertRaises(ValueError):handle_reply(self.c,store,{'task':token,'body':token})
  store.claim_reply(token,hashlib.sha256(b'Answer').hexdigest())
  with self.assertRaises(ValueError):handle_reply(self.c,store,{'task':token,'body':'Changed'})
 def test_reply_rejects_all_at_signs_before_capability_consumption(self):
  store,token=self.reply_fixture()
  for body in ['@helper please','@'+self.c.agent,'mail@example.com','code `@helper`','＠helper','请@助手处理']:
   with patch('bridge.api') as api_mock:
    with self.assertRaisesRegex(ValueError,'reply_mentions_not_allowed'):handle_reply(self.c,store,{'task':token,'body':body})
    api_mock.assert_not_called()
   self.assertEqual(store.db.execute('SELECT state FROM reply_tasks').fetchone()[0],'ready')
 def test_uncertain_reply_retry_reads_without_another_post(self):
  store,token=self.reply_fixture()
  with patch('bridge.verify_identity'),patch('bridge.api',side_effect=TimeoutError):
   self.assertEqual(handle_reply(self.c,store,{'task':token,'body':'Answer'})['status'],'reply_unknown')
  with patch('bridge.verify_identity'),patch('bridge.api',return_value={'messages':[]}) as api_mock:
   self.assertEqual(handle_reply(self.c,store,{'task':token,'body':'Answer'})['status'],'reply_unknown')
   self.assertEqual(len(api_mock.call_args.args),2);self.assertIn('?after=7&limit=100',api_mock.call_args.args[1])
 def test_unknown_reply_reconciles_exact_sender_seq_body_only(self):
  store,token=self.reply_fixture();store.claim_reply(token,hashlib.sha256(b'Answer').hexdigest());store.finish_reply(7,'reply_unknown')
  msg={'seq':8,'reply_to':7,'sender':{'kind':'agent','name':self.c.agent},'body':'Answer'}
  for patch_msg in [{'body':'Different'},{'reply_to':6},{'sender':{'kind':'agent','name':'other'}}]:
   with patch('bridge.verify_identity'),patch('bridge.api',return_value={'messages':[{**msg,**patch_msg}]}):
    self.assertEqual(handle_reply(self.c,store,{'task':token,'body':'Answer'})['status'],'reply_unknown')
  with patch('bridge.verify_identity'),patch('bridge.api',return_value={'messages':[msg]}):
   self.assertEqual(handle_reply(self.c,store,{'task':token,'body':'Answer'})['status'],'reply_verified')
 def test_inflight_reply_is_not_posted_again_and_restart_marks_unknown(self):
  store,token=self.reply_fixture();store.claim_reply(token,hashlib.sha256(b'Answer').hexdigest())
  with patch('bridge.api') as api_mock:
   self.assertEqual(handle_reply(self.c,store,{'task':token,'body':'Answer'})['status'],'reply_unknown');api_mock.assert_not_called()
  store.close();reopened=Store(self.c.state,recover=True)
  self.assertEqual(reopened.db.execute('SELECT state FROM reply_tasks').fetchone()[0],'reply_unknown')
 def test_gadget_prompt_uses_capability_not_mcp_or_global_secrets(self):
  config=Config(**{**self.c.__dict__,'reply_socket':'/run/commons/reply.sock','gadget_socket':'/run/custom-muse/socket'});seen=[]
  def run(args,**kwargs):seen.append(kwargs);return SimpleNamespace(returncode=0)
  with patch.dict('os.environ',{'AGENT_COMMONS_AGENT_TOKEN':'ap_secret','MUSE_BRIDGE_SIGNING_SECRET':KEY}):
   deliver_to_muse(config,7,'Task',run,reply_task='capability-fixture')
  prompt=seen[0]['input'];self.assertIn('No Muse MCP connector is required',prompt);self.assertIn('system.run',prompt);self.assertIn('capability-fixture',prompt)
  self.assertNotIn('ap_secret',str(seen));self.assertNotIn(KEY,str(seen));self.assertNotIn('AGENT_COMMONS_AGENT_TOKEN',seen[0]['env']);self.assertEqual(seen[0]['env']['MUSEGADGET_SOCKET'],'/run/custom-muse/socket')
  with self.assertRaises(ValueError):Config(**{**self.c.__dict__,'gadget_socket':'relative.sock'}).validate()
 def test_reply_client_rejects_relative_socket_and_unbounded_input_without_network(self):
  with self.assertRaises(ValueError):reply_client('relative.sock',b'{}')
  with self.assertRaises(ValueError):reply_client('/run/reply.sock',b'x'*65537)
 def test_socket_cleanup_only_removes_own_socket_not_replacement(self):
  # This sandbox prohibits AF_UNIX creation; test inode/type decisions with stat fixtures.
  with patch('bridge.Path.lstat',return_value=SimpleNamespace(st_mode=0o140600,st_dev=1,st_ino=2)),patch('bridge.Path.unlink') as unlink:
   cleanup_reply_socket('/run/reply.sock',(1,2));unlink.assert_called_once()
  for metadata in [SimpleNamespace(st_mode=0o100600,st_dev=1,st_ino=2),SimpleNamespace(st_mode=0o140600,st_dev=1,st_ino=3)]:
   with patch('bridge.Path.lstat',return_value=metadata),patch('bridge.Path.unlink') as unlink:
    cleanup_reply_socket('/run/reply.sock',(1,2));unlink.assert_not_called()
 def test_sigterm_uses_cleanup_path_and_restores_previous_handler(self):
  calls=[];previous=object()
  def register(sig,handler):calls.append((sig,handler));return previous
  def serve(*args):calls[0][1](15,None)
  with patch('bridge.signal.signal',side_effect=register),patch('bridge.Bridge',return_value=object()),patch('bridge.server',side_effect=serve):
   run_bridge(self.c,8799)
  self.assertEqual(len(calls),2);self.assertIs(calls[1][1],previous)
 def test_verified_reply_is_terminal_under_late_reconciliation(self):
  store,token=self.reply_fixture();store.claim_reply(token,hashlib.sha256(b'Answer').hexdigest())
  store.finish_reply(7,'reply_verified',8);store.finish_reply(7,'reply_unknown');store.finish_reply(7,'reply_verified',9)
  self.assertEqual(store.db.execute('SELECT state,reply_seq FROM reply_tasks').fetchone(),('reply_verified',8))
if __name__=='__main__':unittest.main()
