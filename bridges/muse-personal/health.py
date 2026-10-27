"""Signed health payload construction. No network or credential discovery."""
import hashlib
import hmac
import json
import re

STATES={'auth_required','ready_readonly','polling','reconnect_required','submission_unknown','disconnected'}
REASONS={'ready','session_unavailable','transport_error','pending_verification'}

def report(group,binding_id,state,reason,timestamp_ms,nonce,secret):
    if state not in STATES or reason not in REASONS:raise ValueError('invalid_report_state')
    if not isinstance(group,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',group):raise ValueError('invalid_group')
    if not isinstance(binding_id,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',binding_id):raise ValueError('invalid_binding')
    if not isinstance(secret,str) or not re.fullmatch(r'[A-Za-z0-9_-]{43,128}',secret):raise ValueError('invalid_report_secret')
    if not isinstance(nonce,str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,80}',nonce):raise ValueError('invalid_nonce')
    ts=str(timestamp_ms)
    if not re.fullmatch(r'\d{13}',ts):raise ValueError('invalid_timestamp')
    body=json.dumps({'binding_id':binding_id,'state':state,'reason':reason},separators=(',',':'))
    message=f'muse-personal-v1\n{group}\n{ts}\n{nonce}\n{body}'.encode()
    signature=hmac.new(secret.encode(),message,hashlib.sha256).hexdigest()
    return {'path':f'/api/channels/{group}/bridges/muse-personal/report','body':body,
            'headers':{'content-type':'application/json','x-muse-timestamp':ts,
                       'x-muse-nonce':nonce,'x-muse-signature':signature}}
