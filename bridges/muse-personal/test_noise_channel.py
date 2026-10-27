import json
import ssl
import unittest
from unittest.mock import Mock, patch
from gateway import Bootstrap, GatewayError, AuthRequired, UnknownDelivery, ScopeError, TransportUnavailable
from noise_channel import NoiseChannel, MAX_FRAME
S='b6e0da66-7313-4d8a-87aa-8c8ec8718b7c'
N='a6e0da66-7313-4d8a-87aa-8c8ec8718b7c'

class WireTests(unittest.TestCase):
 def setUp(self):
  self.ws=Mock();self.ws.recv.return_value=b'msg2';self.connect=Mock(return_value=self.ws)
  self.noise=Mock();self.noise.write_message.side_effect=[b'msg1',b'msg3'];self.noise.read_message.return_value=b'';self.noise.handshake_finished=True
  self.noise.encrypt.side_effect=lambda data:b'cipher'+data;self.noise.decrypt.return_value=b'frame'
  self.codec=Mock();self.codec.encode_request.return_value=b'request'
 def make(self,**kw):
  return NoiseChannel(Bootstrap('fixture-vm','SECRET_TOKEN'),session_id=S,node_id=N,codec=self.codec,ws_connect=self.connect,noise_factory=lambda:self.noise,**kw)
 def test_handshake_fixed_host_tls_no_proxy_no_fingerprint_or_logs(self):
  c=self.make();args=self.connect.call_args
  self.assertTrue(args.args[0].startswith('wss://hatch.metaaivm.com/v1/noise?vm_id=fixture-vm&auth_token='))
  k=args.kwargs;self.assertIsNone(k['proxy']);self.assertIsNone(k['user_agent_header']);self.assertIsNone(k['compression'])
  self.assertEqual(k['ssl'].verify_mode,ssl.CERT_REQUIRED);self.assertTrue(k['ssl'].check_hostname)
  self.assertTrue(k['logger'].disabled);self.assertFalse(k['logger'].propagate)
  self.assertEqual([x.args[0] for x in self.ws.send.call_args_list],[b'msg1',b'msg3'])
  self.assertNotIn('SECRET',repr(c))
 def test_nonempty_handshake_payload_or_text_frame_fails_closed(self):
  self.noise.read_message.return_value=b'unsupported attestation'
  with self.assertRaises(GatewayError):self.make()
  self.ws.close.assert_called_once()
 def test_handshake_timeout_sanitized(self):
  self.ws.recv.side_effect=TimeoutError('SECRET_TOKEN')
  with self.assertRaises(GatewayError) as ctx:self.make()
  self.assertNotIn('SECRET',str(ctx.exception));self.ws.close.assert_called_once()
 def test_history_scoped_frame_and_response(self):
  c=self.make();self.codec.decode_response.return_value={'stream_id':1,'kind':'response','status':200,'body':b'{"chat_events":[]}','end_body':True}
  self.assertEqual(c.history(S,20),{'chat_events':[]})
  self.codec.encode_request.assert_called_once_with(1,'/chat/history?session_id='+S+'&limit=20','GET',b'')
 def test_identity_is_only_read_only_identity_route(self):
  c=self.make();self.codec.decode_response.return_value={'stream_id':1,'kind':'response','status':200,'body':b'{"opaque":"value"}','end_body':True}
  self.assertEqual(c.identity(),{'opaque':'value'})
  self.codec.encode_request.assert_called_once_with(1,'/identity','GET',b'')
 def test_chunks_require_status_and_end(self):
  c=self.make();self.codec.decode_response.side_effect=[{'stream_id':1,'kind':'response','status':200,'body':b'{"result":','end_body':False},{'stream_id':1,'kind':'body_chunk','body':b'{"chat_events":[]}}','end_body':True}]
  self.assertEqual(c.history(S,20),{'chat_events':[]})
 def test_foreign_stream_and_expired_auth_close_without_retry(self):
  for frame,error in [({'stream_id':2,'kind':'response','status':200},GatewayError),({'stream_id':1,'kind':'response','status':401},AuthRequired)]:
   self.setUp();c=self.make();self.codec.decode_response.return_value=frame
   with self.assertRaises(error):c.history(S,20)
   self.ws.close.assert_called_once()
   with self.assertRaises(TransportUnavailable):c.history(S,20)
   self.assertEqual(self.connect.call_count,1)
 def test_frame_count_budget_and_oversize_close(self):
  c=self.make();self.codec.decode_response.side_effect=[{'stream_id':1,'kind':'response','status':200,'body':b'','end_body':False}]+[{'stream_id':1,'kind':'body_chunk','body':b'','end_body':False}]*63
  with self.assertRaises(GatewayError):c.history(S,20)
  self.assertEqual(self.codec.decode_response.call_count,64)
 def test_bad_scope_rejected_without_write(self):
  c=self.make()
  for session in ['',N]:
   with self.assertRaises(ScopeError):c.history(session,20)
  with self.assertRaises(ScopeError):c.history(S,21)
  self.codec.encode_request.assert_not_called()
 def test_send_is_once_and_always_unknown_no_made_up_ack(self):
  c=self.make()
  with self.assertRaises(UnknownDelivery):c.send(S,'Hello')
  stream,path,verb,body=self.codec.encode_request.call_args.args
  self.assertEqual((stream,path,verb),(1,'/chat/stream','POST'))
  self.assertEqual(json.loads(body),{'items':[{'type':'text','text':'Hello'}],'node_id':N,'capabilities':{},'session_id':S})
  self.codec.decode_response.assert_not_called();self.ws.close.assert_called_once()
  with self.assertRaises(TransportUnavailable):c.send(S,'Hello')
  self.codec.encode_request.assert_called_once()
 def test_socket_send_error_is_unknown_no_retry(self):
  c=self.make();self.ws.send.side_effect=OSError('SECRET_TOKEN')
  with self.assertRaises(UnknownDelivery) as ctx:c.send(S,'Hello')
  self.assertNotIn('SECRET',str(ctx.exception));self.codec.encode_request.assert_called_once()
 def test_close_discards_noise_and_is_idempotent(self):
  c=self.make();c.close();c.close();self.assertIsNone(c._noise);self.ws.close.assert_called_once()

 def test_real_codec_full_response_without_third_party_repo_execution(self):
  import codec
  c=self.make();c._codec=codec
  payload=codec._integer(1,200)+codec._bytes(3,b'{"chat_events":[]}')+codec._integer(4,1)
  frame=codec._integer(1,1)+codec._bytes(3,payload)
  service=codec._bytes(1,frame)
  self.noise.decrypt.return_value=codec._integer(1,1)+codec._integer(2,0)+codec._integer(3,1)+codec._bytes(4,service)
  self.assertEqual(c.history(S,20),{'chat_events':[]})
 def test_send_deadline_aborts_only_owned_socket(self):
  c=self.make()
  def timer_factory(delay,callback):
   timer=Mock();timer.start.side_effect=callback
   return timer
  with patch('noise_channel.threading.Timer',side_effect=timer_factory):
   with self.assertRaises(UnknownDelivery):c.send(S,'Hello')
  self.ws.socket.shutdown.assert_called_once()
 def test_oversized_frame_drops_connection(self):
  c=self.make();self.ws.recv.return_value=b'x'*(MAX_FRAME+1)
  with self.assertRaises(GatewayError):c.history(S,20)
  self.ws.close.assert_called_once()

if __name__=='__main__':unittest.main()
