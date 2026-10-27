"""Experimental real Noise XX wire transport; not a verified Muse integration.

Only the approved side-session history route is readable. A chat.stream write
has no reviewed ACK schema and ALWAYS yields UnknownDelivery, never acceptance.
No browser impersonation, automatic reconnect, account discovery or main chat.
Dependencies for the default factories: websockets==16.0, noiseprotocol==0.3.1.
"""
from __future__ import annotations
import json
import logging
import os
import re
import ssl
import socket
from importlib.metadata import version
import threading
import time
from urllib.parse import urlencode
from gateway import Bootstrap, GatewayError, AuthRequired, UnknownDelivery, ScopeError, TransportUnavailable, _session, _secret

MAX_FRAME = 65535
MAX_BODY = 262144


def _default_noise():
    try:
        if version('noiseprotocol') != '0.3.1': raise TransportUnavailable()
        from noise.connection import NoiseConnection, Keypair
        noise = NoiseConnection.from_name(b'Noise_XX_25519_AESGCM_SHA256')
        noise.set_as_initiator()
        noise.set_keypair_from_private_bytes(Keypair.STATIC, os.urandom(32))
        noise.start_handshake()
        return noise
    except Exception:
        raise TransportUnavailable() from None


def _default_connect(url, **kwargs):
    try:
        import websockets
        if websockets.__version__ != '16.0': raise TransportUnavailable()
        from websockets.sync.client import connect
        return connect(url, **kwargs)
    except TransportUnavailable: raise
    except Exception: raise GatewayError() from None


class NoiseChannel:
    def __init__(self, bootstrap: Bootstrap, *, session_id: str, codec,
                 node_id: str | None = None, ws_connect=None, noise_factory=None):
        self._session = _session(session_id)
        self._node = None if node_id is None else _session(node_id)
        if bootstrap.host != 'hatch.metaaivm.com' or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}', bootstrap.vm_id):
            raise ScopeError()
        token = _secret(bootstrap.hatch_token)
        self._codec, self._lock = codec, threading.RLock()
        self._ws = self._noise = None
        self._stream = 0
        self._closed = False
        # Separate disabled logger: no root/debug handlers can print URL token,
        # request headers, ciphertext or decrypted messages via this dependency.
        logger = logging.Logger('personal-muse-wire-private')
        logger.disabled = True
        logger.propagate = False
        try:
            noise = (noise_factory or _default_noise)()
            url = 'wss://hatch.metaaivm.com/v1/noise?' + urlencode({'vm_id':bootstrap.vm_id,'auth_token':token})
            self._ws = (ws_connect or _default_connect)(url, ssl=ssl.create_default_context(),
                proxy=None, compression=None, user_agent_header=None, open_timeout=20,
                close_timeout=2, max_size=MAX_FRAME, max_queue=4, ping_interval=None,
                logger=logger)
            self._send_bounded(bytes(noise.write_message(b'')))
            m2 = self._ws.recv(timeout=20)
            if not isinstance(m2, bytes) or len(m2) > MAX_FRAME: raise GatewayError()
            if bytes(noise.read_message(m2)) != b'': raise GatewayError()
            self._send_bounded(bytes(noise.write_message(b'')))
            if noise.handshake_finished is not True: raise GatewayError()
            self._noise = noise
        except TransportUnavailable:
            self.close()
            raise
        except Exception:
            self.close()
            raise GatewayError() from None

    def __repr__(self): return '<PersonalMuseNoiseChannel scoped experimental transport>'

    def _scope(self, session_id):
        if _session(session_id) != self._session: raise ScopeError()
        if self._closed or self._noise is None: raise TransportUnavailable()

    def _send_bounded(self, data):
        # websockets.sync.send has no public write timeout. Abort only our own
        # transport socket on deadline to unblock a stalled TLS write. No retry.
        ws, expired = self._ws, threading.Event()
        def abort():
            expired.set()
            try: ws.socket.shutdown(socket.SHUT_RDWR)
            except Exception: pass
        timer = threading.Timer(20, abort)
        timer.daemon = True
        timer.start()
        try:
            ws.send(data)
            if expired.is_set(): raise GatewayError()
        finally:
            timer.cancel()
            timer.join()

    def _write(self, path, verb, body):
        self._stream += 1
        plain = self._codec.encode_request(self._stream, path, verb, body)
        if not isinstance(plain, bytes) or len(plain) > MAX_FRAME - 16: raise GatewayError()
        encrypted = bytes(self._noise.encrypt(plain))
        self._send_bounded(encrypted)
        return self._stream

    def identity(self):
        return self._read_json('/identity')

    def history(self, session_id, limit):
        self._scope(session_id)
        if type(limit) is not int or not 1 <= limit <= 20: raise ScopeError()
        return self._read_json('/chat/history?' + urlencode({'session_id':self._session,'limit':limit}))

    def _read_json(self, path):
        with self._lock:
            self._scope(self._session)
            try:
                sid = self._write(path, 'GET', b'')
                deadline, chunks, status, size = time.monotonic()+30, [], None, 0
                for _ in range(64):
                    remaining = deadline-time.monotonic()
                    if remaining <= 0: raise GatewayError()
                    raw = self._ws.recv(timeout=remaining)
                    if not isinstance(raw, bytes) or len(raw) > MAX_FRAME: raise GatewayError()
                    frame = self._codec.decode_response(bytes(self._noise.decrypt(raw)))
                    if frame['stream_id'] != sid: raise GatewayError()
                    kind = frame['kind']
                    if kind == 'response':
                        if status is not None: raise GatewayError()
                        status = frame['status']
                        if status in (401,403): raise AuthRequired()
                        if type(status) is not int or not 200 <= status < 300: raise GatewayError()
                    elif kind != 'body_chunk' or status is None: raise GatewayError()
                    body = frame.get('body', b'')
                    if not isinstance(body, bytes): raise GatewayError()
                    size += len(body)
                    if size > MAX_BODY: raise GatewayError()
                    chunks.append(body)
                    if frame.get('end_body') is True:
                        result = json.loads(b''.join(chunks))
                        if not isinstance(result,dict) or result.get('ok') is False: raise GatewayError()
                        result = result.get('result',result)
                        if not isinstance(result,dict): raise GatewayError()
                        return result
                raise GatewayError()
            except AuthRequired:
                self.close()
                raise
            except Exception:
                self.close()
                raise GatewayError() from None

    def send(self, session_id, text):
        with self._lock:
            self._scope(session_id)
            if self._node is None or not isinstance(text,str) or not text.strip() or len(text)>8000: raise ScopeError()
            try:
                body=json.dumps({'items':[{'type':'text','text':text}],'node_id':self._node,
                    'capabilities':{},'session_id':self._session},ensure_ascii=False).encode()
                self._write('/chat/stream','POST',body)
                # A socket write is not a server ACK. No invented echo fields,
                # implicit history polling, time-based reply correlation or retry.
            except Exception:
                pass
            finally:
                self.close()
            raise UnknownDelivery() from None

    def close(self):
        with self._lock:
            self._closed = True
            ws, self._ws = self._ws, None
            self._noise = None
            if ws is not None:
                try: ws.close()
                except Exception: pass
