"""Bounded protobuf wire codec for the observed Muse envelope schema.

Schema evidence: nikships/muse-cli dbc7624 desc0.bin/desc1.bin (MIT).
Written independently; not a general protobuf parser. Fragmented outer frames
are rejected rather than partially interpreted. No credentials or I/O here.
"""
import os
import uuid
from urllib.parse import urlsplit,parse_qs

MAX_FRAME=1024*1024
class ProtocolError(RuntimeError):
    def __init__(self,*_ignored):super().__init__('personal_gateway_protocol_error')

def _varint(n):
    if type(n) is not int or n<0 or n>2**64-1:raise ProtocolError()
    result=bytearray()
    while n>=128:result.append((n&127)|128);n>>=7
    result.append(n);return bytes(result)

def _integer(k,n):return _varint(k<<3)+_varint(n)
def _bytes(k,b):
    if not isinstance(b,bytes) or len(b)>MAX_FRAME:raise ProtocolError()
    return _varint((k<<3)|2)+_varint(len(b))+b

def _read_varint(data,i):
    v=0
    for shift in range(0,70,7):
        if i>=len(data):raise ProtocolError()
        c=data[i];i+=1
        if shift==63 and c>1:raise ProtocolError()
        v|=(c&127)<<shift
        if c<128:return v,i
    raise ProtocolError()

def fields(data):
    if not isinstance(data,bytes) or len(data)>MAX_FRAME:raise ProtocolError()
    i=0;result={};count=0
    while i<len(data):
        tag,i=_read_varint(data,i);k,w=tag>>3,tag&7;count+=1
        if not k or count>10000:raise ProtocolError()
        if w==0:value,i=_read_varint(data,i)
        elif w==2:
            size,i=_read_varint(data,i)
            if size>MAX_FRAME or i+size>len(data):raise ProtocolError()
            value=data[i:i+size];i+=size
        elif w in (1,5):
            size=8 if w==1 else 4
            if i+size>len(data):raise ProtocolError()
            value=data[i:i+size];i+=size
        else:raise ProtocolError()
        result.setdefault(k,[]).append((w,value))
    return result

def one(obj,k,w,default=None):
    entries=obj.get(k,[])
    if not entries:return default
    if len(entries)!=1 or entries[0][0]!=w:raise ProtocolError()
    return entries[0][1]

def _allowed(path,verb):
    u=urlsplit(path)
    if u.scheme or u.netloc or u.fragment:raise ProtocolError()
    if path=='/identity' and verb=='GET':return
    if path=='/chat/stream' and verb=='POST':return
    if u.path!='/chat/history' or verb!='GET':raise ProtocolError()
    q=parse_qs(u.query,strict_parsing=True)
    if set(q)!={'session_id','limit'} or any(len(v)!=1 for v in q.values()):raise ProtocolError()
    try:
        if str(uuid.UUID(q['session_id'][0]))!=q['session_id'][0] or not 1<=int(q['limit'][0])<=20:raise ValueError()
    except (ValueError,KeyError):raise ProtocolError() from None

def encode_request(stream,path,verb,body=b''):
    try:_allowed(path,verb)
    except Exception:raise ProtocolError() from None
    if type(stream) is not int or not 1<=stream<2**63 or not isinstance(body,bytes) or len(body)>32768:raise ProtocolError()
    if verb=='GET' and body:raise ProtocolError()
    # Header{key=1,value=2}; ApplicationRequest{verb=1,path=2,headers=3,body=4,end_body=5}.
    header=_bytes(1,b'x-request-id')+_bytes(2,str(uuid.uuid4()).encode())
    req=_bytes(1,verb.encode())+_bytes(2,path.encode())+_bytes(3,header)
    if body:req+=_bytes(3,_bytes(1,b'content-type')+_bytes(2,b'application/json'))+_bytes(4,body)
    req+=_integer(5,1)
    frame=_integer(1,stream)+_bytes(2,req)
    service=_integer(1,0)+_bytes(2,frame)  # daemon only
    chunk=int.from_bytes(os.urandom(8),'little')&((1<<63)-1)
    return _integer(1,chunk)+_integer(2,0)+_integer(3,1)+_bytes(4,service)

def decode_response(data):
    outer=fields(data)
    # Presence matters for optional fragmentation fields; no assumed single frame.
    if one(outer,1,0) is None or one(outer,2,0)!=0 or one(outer,3,0)!=1:raise ProtocolError()
    service=fields(one(outer,4,2,b''));frame=fields(one(service,1,2,b''))
    sid=one(frame,1,0)
    if type(sid) is not int or not 1<=sid<2**63:raise ProtocolError()
    kinds=[k for k in (2,3,4,5) if k in frame]
    if len(kinds)!=1 or kinds[0]==2:raise ProtocolError()
    k=kinds[0];payload=fields(one(frame,k,2,b''))
    if k==5:return {'stream_id':sid,'kind':'reset','body':b'','end_body':True}
    if k==3:
        status=one(payload,1,0)
        if type(status) is not int or not 100<=status<=599:raise ProtocolError()
        end=one(payload,4,0,0);body=one(payload,3,2,b'')
        if end not in (0,1):raise ProtocolError()
        return {'stream_id':sid,'kind':'response','status':status,'body':body,'end_body':bool(end)}
    end=one(payload,2,0,0)
    if end not in (0,1):raise ProtocolError()
    return {'stream_id':sid,'kind':'body_chunk','body':one(payload,1,2,b''),'end_body':bool(end)}
