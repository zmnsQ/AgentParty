import unittest
from codec import encode_request,decode_response,fields,one,ProtocolError,_integer as i,_bytes as b
S='b6e0da66-7313-4d8a-87aa-8c8ec8718b7c'
def outer(frame):return i(1,10)+i(2,0)+i(3,1)+b(4,b(1,frame))
class Tests(unittest.TestCase):
 def test_request_shape(self):
  raw=encode_request(1,'/chat/history?session_id='+S+'&limit=20','GET');o=fields(raw)
  service=fields(one(o,4,2));f=fields(one(service,2,2));r=fields(one(f,2,2))
  self.assertEqual(one(service,1,0),0);self.assertEqual(one(r,1,2),b'GET');self.assertEqual(one(r,5,0),1)
 def test_small_golden_response(self):
  # ServiceFrame stream1, ApplicationResponse status200/body{}/end=true.
  raw=bytes.fromhex('080a10001801220f0a0d08011a0908c8011a027b7d2001')
  self.assertEqual(decode_response(raw),{'stream_id':1,'kind':'response','status':200,'body':b'{}','end_body':True})
 def test_response_and_chunk(self):
  self.assertFalse(decode_response(outer(i(1,3)+b(3,i(1,200))))['end_body'])
  self.assertEqual(decode_response(outer(i(1,3)+b(4,b(1,b'x')+i(2,1))))['body'],b'x')
 def test_reset_has_no_private_reason(self):
  r=decode_response(outer(i(1,3)+b(5,i(1,1)+b(2,b'private token'))));self.assertNotIn('private',repr(r))
 def test_fragmentation_and_duplicate_oneof_rejected(self):
  for raw in [i(1,1)+i(2,0)+i(3,2)+b(4,b'x'),outer(i(1,1)+b(3,i(1,200))+b(4,b''))]:
   with self.assertRaises(ProtocolError):decode_response(raw)
 def test_malformed_lengths_and_varints(self):
  for raw in [b'\x80'*11,b'\x0a\xff\xff\xff\x7f',b'\x00',b'\x09\x01']:
   with self.assertRaises(ProtocolError):fields(raw)
 def test_routes_and_scope(self):
  for p,v in [('/chat/history','GET'),('/identity','POST'),('/api/admin','GET'),('https://evil/chat/stream','POST')]:
   with self.assertRaises(ProtocolError):encode_request(1,p,v)
  self.assertTrue(encode_request(1,'/identity','GET'))
if __name__=='__main__':unittest.main()
