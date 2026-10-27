"""Experimental personal Muse runner; injected adapters, disabled by default.
No credential import, gateway construction, automatic group subscription or CLI daemon.
"""
import hashlib
import json
import sqlite3
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    group: str
    account: str
    sidechat: str
    enabled: bool = False
    poll_seconds: int = 10
    max_pending_seconds: int = 900

    def __post_init__(self):
        if not all(isinstance(v,str) and v.strip() for v in (self.group,self.account,self.sidechat)):
            raise ValueError('explicit_binding_required')
        if self.poll_seconds < 5 or self.max_pending_seconds < self.poll_seconds:
            raise ValueError('bounded_polling_required')


class Runner:
    """One group + one account + one dedicated side chat per ledger.

    Network adapters are deliberately injected. No side chat is created implicitly.
    Remote response correlation is unproven: all replies require manual confirmation.
    """
    def __init__(self, config, gateway, ledger, clock=time.time, binding_guard=None):
        self.config,self.gateway,self.clock=config,gateway,clock
        self.binding_guard=binding_guard
        self.db=sqlite3.connect(ledger,isolation_level=None)
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS binding(singleton INTEGER PRIMARY KEY CHECK(singleton=1), group_id TEXT, account_id TEXT, sidechat TEXT);
          CREATE TABLE IF NOT EXISTS operation(id TEXT PRIMARY KEY, prompt_hash TEXT NOT NULL, baseline TEXT NOT NULL, state TEXT NOT NULL, created REAL NOT NULL, last_poll REAL NOT NULL DEFAULT 0);
          CREATE TABLE IF NOT EXISTS candidate(op TEXT REFERENCES operation(id), message_id TEXT, seq TEXT, text_hash TEXT, state TEXT NOT NULL, PRIMARY KEY(op,message_id,seq));
        ''')
        expected=(config.group,config.account,config.sidechat)
        self.db.execute('BEGIN IMMEDIATE')
        try:
            row=self.db.execute('SELECT group_id,account_id,sidechat FROM binding').fetchone()
            if row and row != expected:
                raise ValueError('ledger_binding_mismatch')
            if not row and self.db.execute('SELECT 1 FROM operation LIMIT 1').fetchone():
                raise ValueError('unbound_legacy_operations')
            self.db.execute('INSERT OR IGNORE INTO binding VALUES(1,?,?,?)',expected)
            self.db.execute('COMMIT')
        except Exception:
            self.db.execute('ROLLBACK');self.db.close();raise
        self.state='unconfigured' if not config.enabled else 'auth_required'
        self.last_checked=None

    def _enabled(self):
        if not self.config.enabled or self.state=='disconnected':raise PermissionError('bridge_disabled')
        try:
            current=self.binding_guard is not None and self.binding_guard(self.config.group,self.config.sidechat) is True
        except Exception:current=False
        if not current:
            self.state='disconnected';raise PermissionError('current_group_binding_required')

    def verify(self):
        self._enabled()
        try:
            if self.gateway.verify_account()!=self.config.account:
                raise PermissionError('account_mismatch')
        except Exception:
            self.state='auth_required'
            raise PermissionError('account_verification_required') from None
        self.last_checked=self.clock()
        pending=self.db.execute("SELECT state FROM operation WHERE state NOT IN ('resolved','rejected') LIMIT 1").fetchone()
        self.state=('submission_unknown' if pending[0] in ('submission_unknown','post_unknown') else 'polling') if pending else 'ready_readonly'
        return self.health()

    def health(self):
        return {'enabled':self.config.enabled,'configured':self.config.enabled,
                'state':self.state,'last_checked_at':self.last_checked,
                'evidence':'connector_reported','end_to_end_verified':False}

    @staticmethod
    def digest(text):return hashlib.sha256(text.encode()).hexdigest()

    def _history(self,after=0):
        self.verify()
        try:rows=self.gateway.history(self.config.sidechat,after)
        except Exception:
            self.state='reconnect_required';raise RuntimeError('history_unavailable') from None
        if not isinstance(rows,list) or len(rows)>1000:
            raise RuntimeError('history_incomplete_or_over_budget')
        total=0
        for r in rows:
            if not isinstance(r,dict) or r.get('session_id')!=self.config.sidechat:
                raise RuntimeError('unexpected_session')
            if not isinstance(r.get('id'),str) or not r['id'] or len(r['id'])>256 or type(r.get('seq')) is not int or r['seq']<0:
                raise RuntimeError('invalid_message_identity')
            text=r.get('text','')
            if not isinstance(text,str) or len(text)>12000:raise RuntimeError('message_over_budget')
            total+=len(text)
        if total>120000:raise RuntimeError('history_over_budget')
        return rows

    def submit(self,request_id,text,*,group,actor_kind,approved=False):
        self._enabled()
        if group!=self.config.group or actor_kind!='human' or not approved:
            raise PermissionError('explicit_human_group_approval_required')
        if not isinstance(request_id,str) or not request_id or len(request_id)>128 or not isinstance(text,str) or not text.strip() or len(text)>8000:
            raise ValueError('invalid_submission')
        existing=self.db.execute('SELECT prompt_hash,state FROM operation WHERE id=?',(request_id,)).fetchone()
        if existing:
            if existing[0]!=self.digest(text):raise ValueError('idempotency_conflict')
            return existing[1]
        rows=self._history()  # Never submit after a failed baseline read.
        baseline=max([r['seq'] for r in rows]+[0])
        self.db.execute('BEGIN IMMEDIATE')
        try:
            if self.db.execute("SELECT 1 FROM operation WHERE state NOT IN ('resolved','rejected') LIMIT 1").fetchone():
                raise RuntimeError('resolve_previous_operation_first')
            # Reserve UNKNOWN before calling the provider: process death is ambiguous.
            self.db.execute('INSERT INTO operation(id,prompt_hash,baseline,state,created) VALUES(?,?,?,?,?)',
                            (request_id,self.digest(text),str(baseline),'submission_unknown',self.clock()))
            self.db.execute('COMMIT')
        except Exception:self.db.execute('ROLLBACK');raise
        try:ack=self.gateway.send(self.config.sidechat,text,request_id)
        except Exception:
            self.state='submission_unknown';return self.state
        state='pending' if isinstance(ack,dict) and ack.get('accepted') is True else 'submission_unknown'
        self.db.execute("UPDATE operation SET state=? WHERE id=? AND state='submission_unknown'",(state,request_id))
        actual=self.db.execute('SELECT state FROM operation WHERE id=?',(request_id,)).fetchone()[0]
        self.state='polling' if actual=='pending' else 'ready_readonly' if actual=='resolved' else 'submission_unknown'
        return actual

    def poll(self,request_id):
        self._enabled()
        row=self.db.execute('SELECT baseline,state,created,last_poll FROM operation WHERE id=?',(request_id,)).fetchone()
        if not row:raise ValueError('unknown_operation')
        if row[1] in ('resolved','rejected'):return []
        if row[1]=='post_unknown':
            self.state='submission_unknown';return []
        now=self.clock()
        if now-row[2]>self.config.max_pending_seconds:
            self.db.execute("UPDATE operation SET state='submission_unknown' WHERE id=? AND state='pending'",(request_id,))
            self.state='submission_unknown';return []  # Bounded wait, keep unresolved ledger.
        if row[3] and now-row[3]<self.config.poll_seconds:return []
        self.db.execute('UPDATE operation SET last_poll=? WHERE id=?',(now,request_id))
        rows=self._history(int(row[0]));self.state='submission_unknown' if row[1]=='submission_unknown' else 'polling';result=[]
        for r in rows:
            if r['seq']<=int(row[0]) or r.get('role')!='assistant' or r.get('status')!='completed' or r.get('background'):
                continue
            cur=self.db.execute('INSERT OR IGNORE INTO candidate VALUES(?,?,?,?,?)',
              (request_id,r['id'],str(r['seq']),self.digest(r['text']),'needs_confirmation'))
            saved=self.db.execute('SELECT text_hash,state FROM candidate WHERE op=? AND message_id=? AND seq=?',(request_id,r['id'],str(r['seq']))).fetchone()
            if saved==(self.digest(r['text']),'needs_confirmation'):
                result.append({'id':r['id'],'seq':r['seq'],'text':r['text'],'state':'needs_confirmation'})
        return result

    def post_confirmed(self,request_id,message_id,seq,text,poster,*,group,approved=False):
        self._enabled()
        if not approved or group!=self.config.group:raise PermissionError('explicit_group_reply_approval_required')
        if '@' in text or '＠' in text:raise ValueError('mentions_require_separate_review')
        self.verify()
        row=self.db.execute('SELECT text_hash,state FROM candidate WHERE op=? AND message_id=? AND seq=?',
          (request_id,message_id,str(seq))).fetchone()
        if not row or row[0]!=self.digest(text):raise ValueError('candidate_mismatch')
        if row[1]!='needs_confirmation':return row[1]
        self.db.execute('BEGIN IMMEDIATE')
        try:
            claimed=self.db.execute("UPDATE operation SET state='post_unknown' WHERE id=? AND state IN ('pending','submission_unknown')",(request_id,))
            if not claimed.rowcount:
                self.db.execute('ROLLBACK');return 'operation_already_claimed_or_resolved'
            cur=self.db.execute("UPDATE candidate SET state='post_unknown' WHERE op=? AND message_id=? AND seq=? AND state='needs_confirmation'",
                               (request_id,message_id,str(seq)))
            if not cur.rowcount:
                self.db.execute('ROLLBACK');return 'post_unknown'
            self.db.execute('COMMIT')
        except Exception:self.db.execute('ROLLBACK');raise
        key=self.digest(json.dumps([self.config.group,request_id,message_id,str(seq)],separators=(',',':')))
        try:receipt=poster(self.config.group,text,key)
        except Exception:return 'post_unknown'
        if not isinstance(receipt,dict) or receipt.get('verified') is not True or receipt.get('group')!=self.config.group or receipt.get('idempotency_key')!=key:return 'post_unknown'
        self.db.execute("UPDATE candidate SET state='posted_verified' WHERE op=? AND message_id=? AND seq=?",(request_id,message_id,str(seq)))
        self.db.execute("UPDATE operation SET state='resolved' WHERE id=?",(request_id,))
        return 'posted_verified'

    def disconnect(self):
        self.gateway.close();self.state='disconnected'
        return {'local_disconnected':True,'provider_session_revoked':False}
