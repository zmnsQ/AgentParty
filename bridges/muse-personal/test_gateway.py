import unittest
from unittest.mock import Mock,patch
from urllib.error import HTTPError
from gateway import (Gateway,GatewayError,AuthRequired,UnknownDelivery,TransportUnavailable,
                     ScopeError,HttpReply,SendAck,FixedOriginHttps,_NoRedirect)
SESSION='b6e0da66-7313-4d8a-87aa-8c8ec8718b7c'
OTHER='a6e0da66-7313-4d8a-87aa-8c8ec8718b7c'

class GatewayTests(unittest.TestCase):
 def setUp(self):
  self.secret=Mock();self.secret.cookie.return_value='hatch_sess=PRIVATE_COOKIE'
  self.http=Mock();self.http.request.side_effect=[HttpReply(200,{'vm_id':'fixture-vm','fixture_owner':'approved'}),HttpReply(200,{'access_token':'PRIVATE_ACCESS'}),HttpReply(200,{'token':'PRIVATE_HATCH'})]
  self.channel=Mock();self.channel.identity.return_value={'fixture_owner':'approved'};self.factory=Mock(return_value=self.channel)
  self.gateway=Gateway(secrets=self.secret,session_id=SESSION,account_id='approved',http=self.http,noise_factory=self.factory,account_resolver=lambda info:info['fixture_owner'])
 def test_absent_noise_or_account_verifier_does_not_read_credentials(self):
  for fields in [{},{'noise_factory':self.factory}]:
   gateway=Gateway(secrets=self.secret,session_id=SESSION,account_id='approved',**fields)
   with self.assertRaises(TransportUnavailable):gateway.verify_account()
  self.secret.cookie.assert_not_called()
 def test_auth_bootstrap_pins_host_vm_and_does_not_forward_cookie_to_noise(self):
  self.assertEqual(self.gateway.verify_account(),'approved')
  self.assertEqual([call.args[0] for call in self.http.request.call_args_list],['/api/session','/api/auth/check','/api/hatch/token'])
  bootstrap=self.factory.call_args.args[0];self.assertEqual(bootstrap.host,'hatch.metaaivm.com');self.assertEqual(bootstrap.vm_id,'fixture-vm')
  self.assertNotIn('PRIVATE',repr(bootstrap));self.assertNotIn('PRIVATE',repr(self.gateway))
  self.assertFalse(hasattr(bootstrap,'cookie'));self.assertEqual(self.http.request.call_args.kwargs['payload'],{'vmAddress':'wss://fixture-vm.metaaivm.com/','vmName':'fixture-vm'})
 def test_wrong_identity_closes_channel_before_history_or_send(self):
  self.channel.identity.return_value={'fixture_owner':'other'}
  with self.assertRaises(ScopeError):self.gateway.verify_account()
  self.channel.close.assert_called_once();self.channel.send.assert_not_called();self.channel.history.assert_not_called()
  self.assertIsNone(self.gateway._channel)
 def test_vm_injection_stops_before_token_exchange(self):
  self.http.request.side_effect=[HttpReply(200,{'vm_id':'vm/evil?token=x'})]
  with self.assertRaises(GatewayError):self.gateway.verify_account()
  self.factory.assert_not_called()
 def test_auth_denied_or_secret_in_error_is_sanitized_without_retry(self):
  self.http.request.side_effect=RuntimeError('PRIVATE_COOKIE https://evil/?token=PRIVATE_HATCH')
  with self.assertRaises(GatewayError) as ctx:self.gateway.verify_account()
  self.assertEqual(str(ctx.exception),'personal_gateway_unavailable');self.assertEqual(self.http.request.call_count,1)
 def test_cookie_header_injection_rejected_before_http(self):
  self.secret.cookie.return_value='hatch_sess=x\r\nX-Evil: y'
  with self.assertRaises(AuthRequired):self.gateway.verify_account()
  self.http.request.assert_not_called()
 def test_expired_cookie_reports_auth_required(self):
  self.http.request.side_effect=[HttpReply(401,{})]
  with self.assertRaises(AuthRequired):self.gateway.verify_account()
  self.assertEqual(self.http.request.call_count,1)
 def test_main_and_other_sessions_rejected_without_connection(self):
  for session in ['',None,OTHER]:
   with self.assertRaises(ScopeError):self.gateway.history(session,0)
   with self.assertRaises(ScopeError):self.gateway.send(session,'Hi','op-1')
  self.secret.cookie.assert_not_called()
 def test_history_scoped_and_no_causal_correlation_invented(self):
  self.channel.history.return_value={'chat_events':[{'seq':7,'message_id':'m-7','event_name':'message.assistant','payload':{'display_text':'Answer','status':'completed','correlation_id':'unverified'}}]}
  rows=self.gateway.history(SESSION,6)
  self.channel.history.assert_called_once_with(SESSION,20)
  self.assertEqual(rows,[{'id':'m-7','seq':7,'session_id':SESSION,'role':'assistant','status':'completed','text':'Answer'}])
 def test_history_foreign_session_or_malformed_result_is_not_returned(self):
  self.channel.history.return_value={'chat_events':[{'session_id':OTHER,'seq':7}]}
  with self.assertRaises(ScopeError):self.gateway.history(SESSION,0)
  self.channel.history.return_value={'chat_events':[{}]}
  with self.assertRaises(GatewayError):self.gateway.history(SESSION,0)
 def test_ack_is_only_acceptance_and_duplicate_never_posts_twice(self):
  self.channel.send.return_value=SendAck(SESSION,True,'m-8')
  expected={'accepted':True,'message_id':'m-8'}
  self.assertEqual(self.gateway.send(SESSION,'Hi','op-1'),expected)
  self.assertEqual(self.gateway.send(SESSION,'Hi','op-1'),expected)
  self.channel.send.assert_called_once_with(SESSION,'Hi')
  with self.assertRaises(ScopeError):self.gateway.send(SESSION,'Changed','op-1')
 def test_timeout_and_invalid_ack_are_unknown_no_blind_retry(self):
  self.channel.send.side_effect=TimeoutError('PRIVATE_HATCH')
  for _ in range(2):
   with self.assertRaises(UnknownDelivery) as ctx:self.gateway.send(SESSION,'Hi','op-1')
   self.assertNotIn('PRIVATE',str(ctx.exception))
  self.channel.send.assert_called_once()
 def test_cross_session_ack_is_unknown(self):
  self.channel.send.return_value=SendAck(OTHER,True,'m-8')
  with self.assertRaises(UnknownDelivery):self.gateway.send(SESSION,'Hi','op-1')
 def test_http_rejects_unlisted_paths_and_redirects(self):
  http=FixedOriginHttps()
  with self.assertRaises(ScopeError):http.request('https://evil.test','secret')
  with self.assertRaises(GatewayError):_NoRedirect().redirect_request(None,None,302,None,None,'https://evil.test')
 def test_https_cookie_only_fixed_host_without_fingerprint_and_bounded_response(self):
  response=Mock();response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False);response.status=200;response.read.return_value=b'{"vm_id":"vm"}'
  opener=Mock();opener.open.return_value=response
  with patch('gateway.build_opener',return_value=opener):FixedOriginHttps().request('/api/session','secret')
  request=opener.open.call_args.args[0];self.assertEqual(request.full_url,'https://muse.ai/api/session');self.assertEqual(request.get_method(),'GET');self.assertEqual(request.get_header('Cookie'),'secret')
  self.assertIsNone(request.get_header('Sec-fetch-site'));self.assertIsNone(request.get_header('User-agent'))
  response.read.assert_called_once_with(262145)
 def test_close_does_not_emit_adapter_errors_or_tokens(self):
  self.gateway.verify_account();self.channel.close.side_effect=RuntimeError('PRIVATE_HATCH')
  self.gateway.close();self.channel.close.assert_called_once()

 def test_close_is_terminal_and_full_unseen_window_cannot_skip_gaps(self):
  self.channel.history.return_value={'chat_events':[{'seq':n} for n in range(1,21)]}
  with self.assertRaises(GatewayError):self.gateway.history(SESSION,0)
  self.gateway.close()
  with self.assertRaises(TransportUnavailable):self.gateway.verify_account()

 def reset_auth(self):
  self.http.request.side_effect=[HttpReply(200,{'vm_id':'fixture-vm','fixture_owner':'approved'}),HttpReply(200,{'access_token':'NEW_ACCESS'}),HttpReply(200,{'token':'NEW_HATCH'})]
 def test_expired_history_requires_explicit_reconnect_and_new_secret(self):
  self.channel.history.side_effect=AuthRequired()
  with self.assertRaises(AuthRequired):self.gateway.history(SESSION,0)
  self.assertEqual(self.secret.cookie.call_count,1)
  self.secret.cookie.return_value='new_cookie';self.reset_auth()
  replacement=Mock();replacement.identity.return_value={'fixture_owner':'approved'};replacement.history.return_value={'chat_events':[]};self.factory.return_value=replacement
  self.assertEqual(self.gateway.reconnect(),'approved')
  self.channel.close.assert_called_once();self.assertEqual(self.secret.cookie.call_count,2)
  self.assertEqual(self.http.request.call_args.args[1],'new_cookie')
  self.assertEqual(self.gateway.history(SESSION,0),[])
  replacement.send.assert_not_called()
 def test_history_network_error_is_sanitized_without_auto_reconnect(self):
  self.channel.history.side_effect=OSError('PRIVATE_HATCH')
  with self.assertRaises(GatewayError) as ctx:self.gateway.history(SESSION,0)
  self.assertEqual(str(ctx.exception),'personal_gateway_unavailable')
  self.channel.history.assert_called_once();self.assertEqual(self.secret.cookie.call_count,1)
 def test_reconnect_preserves_unknown_and_accepted_attempts(self):
  self.channel.send.return_value=SendAck(SESSION,True,'m-8')
  receipt=self.gateway.send(SESSION,'Known','known')
  self.channel.send.side_effect=TimeoutError()
  with self.assertRaises(UnknownDelivery):self.gateway.send(SESSION,'Unknown','unknown')
  self.reset_auth();replacement=Mock();replacement.identity.return_value={'fixture_owner':'approved'};self.factory.return_value=replacement
  self.gateway.reconnect()
  self.assertEqual(self.gateway.send(SESSION,'Known','known'),receipt)
  with self.assertRaises(UnknownDelivery):self.gateway.send(SESSION,'Unknown','unknown')
  replacement.send.assert_not_called()
 def test_failed_reconnect_drops_old_channel_and_close_is_terminal(self):
  self.gateway.verify_account();self.channel.close.side_effect=RuntimeError('PRIVATE')
  self.http.request.side_effect=[HttpReply(401,{})]
  with self.assertRaises(AuthRequired):self.gateway.reconnect()
  self.assertIsNone(self.gateway._channel)
  self.assertEqual(self.secret.cookie.call_count,2)
  self.gateway.close()
  with self.assertRaises(TransportUnavailable):self.gateway.reconnect()
  self.assertEqual(self.secret.cookie.call_count,2)
 def test_text_limits_outbound_8000_history_12000(self):
  with self.assertRaises(ScopeError):self.gateway.send(SESSION,'x'*8001,'too-long')
  self.secret.cookie.assert_not_called()
  event={'seq':1,'id':'m1','event_name':'message.assistant','payload':{'display_text':'x'*12000}}
  self.channel.history.return_value={'chat_events':[event]}
  self.assertEqual(len(self.gateway.history(SESSION,0)[0]['text']),12000)
  event['payload']['display_text']+='x'
  with self.assertRaises(GatewayError):self.gateway.history(SESSION,0)

 def test_history_supports_observed_payload_message_id(self):
  self.channel.history.return_value={'chat_events':[{'seq':1,'event_name':'message.assistant','payload':{'display_text':'Answer','message_id':'p1'}}]}
  self.assertEqual(self.gateway.history(SESSION,0)[0]['id'],'p1')

if __name__=='__main__':unittest.main()
