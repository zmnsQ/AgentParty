import unittest
from unittest.mock import Mock
from runner import Config,Runner
from gateway import Gateway,HttpReply,SendAck
SESSION='b6e0da66-7313-4d8a-87aa-8c8ec8718b7c'

class Tests(unittest.TestCase):
 def test_unconfigured_identity_reads_no_credentials(self):
  from identity import ConfiguredIdentityResolver
  from gateway import TransportUnavailable
  secret=Mock()
  gateway=Gateway(secrets=secret, account_id='owner',session_id=SESSION,
    noise_factory=Mock(),account_resolver=ConfiguredIdentityResolver('owner'))
  with self.assertRaises(TransportUnavailable):gateway.verify_account()
  secret.cookie.assert_not_called()

 def test_adapter_runner_contract_without_network(self):
  secret=Mock();secret.cookie.return_value='synthetic-cookie'
  http=Mock();http.request.side_effect=[HttpReply(200,{'vm_id':'fixture-vm','fixture_owner':'owner'}),HttpReply(200,{'access_token':'synthetic-access'}),HttpReply(200,{'token':'synthetic-gateway'})]
  channel=Mock();channel.identity.return_value={'fixture_owner':'owner'};channel.history.side_effect=[{'chat_events':[]},{'chat_events':[{'id':'message','seq':1,'session_id':SESSION,'event_name':'message.assistant','payload':{'status':'completed','display_text':'synthetic reply'}}]}]
  channel.send.return_value=SendAck(SESSION,True,'sent-message')
  gateway=Gateway(secrets=secret,account_id='owner',session_id=SESSION,http=http,noise_factory=lambda bootstrap:channel,account_resolver=lambda info:info['fixture_owner'])
  runner=Runner(Config('group','owner',SESSION,True),gateway,':memory:',binding_guard=lambda g,s:True)
  self.assertEqual(runner.submit('request','synthetic task',group='group',actor_kind='human',approved=True),'pending')
  self.assertEqual(runner.poll('request')[0]['state'],'needs_confirmation')
  self.assertEqual(http.request.call_count,3);self.assertEqual(channel.send.call_count,1)
  self.assertFalse(runner.health()['end_to_end_verified'])
  runner.disconnect();runner.db.close()
if __name__=='__main__':unittest.main()
