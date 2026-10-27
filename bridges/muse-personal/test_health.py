import unittest,json
from health import report
class Tests(unittest.TestCase):
 def test_fixed_payload_no_login_material(self):
  r=report('group','binding','polling','pending_verification',1793094000000,'n'*16,'s'*43)
  self.assertEqual(set(json.loads(r['body'])),{'binding_id','state','reason'})
  self.assertNotIn('s'*43,repr(r));self.assertEqual(len(r['headers']['x-muse-signature']),64)
 def test_cross_group_signature_changes(self):
  args=('binding','auth_required','session_unavailable',1793094000000,'n'*16,'s'*43)
  self.assertNotEqual(report('a',*args)['headers']['x-muse-signature'],report('b',*args)['headers']['x-muse-signature'])
 def test_no_raw_errors_or_arbitrary_path(self):
  with self.assertRaises(ValueError):report('../other','b','polling','ready',1793094000000,'n'*16,'s'*43)
  with self.assertRaises(ValueError):report('g','b','polling','raw private error',1793094000000,'n'*16,'s'*43)
if __name__=='__main__':unittest.main()
