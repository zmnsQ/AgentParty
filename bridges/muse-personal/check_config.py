"""Offline configuration validation; never imports a credential or connects."""
import argparse
import json
from runner import Config


def check(path):
    with open(path,encoding='utf-8') as stream:
        text=stream.read(8193)
    if len(text)>8192:raise ValueError('configuration_too_large')
    data=json.loads(text)
    if set(data)-{'enabled','group','account','sidechat','poll_seconds','max_pending_seconds'}:
        raise ValueError('unsupported_field_do_not_put_credentials_in_config')
    if type(data.get('enabled',False)) is not bool:raise ValueError('enabled_must_be_boolean')
    config=Config(**data)
    return {'valid':True,'enabled':config.enabled,'network_called':False,
            'credential_read':False,'noise_adapter_ready':False,'account_tested':False}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('path');args=parser.parse_args()
    try:print(json.dumps(check(args.path)))
    except Exception:print(json.dumps({'valid':False,'reason':'invalid_configuration'}));raise SystemExit(1)
