"""Optional real-server smoke test. Runs a full one-minute focus session.
Run from the project folder with the environment Python: python tests/http_smoke.py
"""
import http.cookiejar
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import build_opener, HTTPCookieProcessor, ProxyHandler, Request
import uuid

ROOT=Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory() as data_dir:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        base=f'http://localhost:{port}'
        env={**os.environ,'AURA_DATA_DIR':data_dir}
        server=subprocess.Popen([sys.executable,str(ROOT/'app.py'),'--port',str(port)],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        client=build_opener(ProxyHandler({}),HTTPCookieProcessor(http.cookiejar.CookieJar()))
        def request(path,body=None,headers=None,method=None,expected=200):
            try:response=client.open(Request(base+path,data=body,headers=headers or {},method=method),timeout=40)
            except HTTPError as error:response=error
            with response:
                raw=response.read();assert response.status==expected,(response.status,raw[:500])
                return json.loads(raw) if response.headers.get('Content-Type','').startswith('application/json') else raw
        try:
            deadline=time.monotonic()+10
            while True:
                try:request('/api/health');break
                except URLError:
                    if server.poll() is not None:raise RuntimeError(server.stderr.read().decode())
                    if time.monotonic()>deadline:raise RuntimeError('Server startup timed out.')
                    time.sleep(.05)
            csrf=request('/api/config')['csrf_token']
            assert b'Aura Cards' in request('/')
            assert b'timerClock' in request('/pomodoro')
            for kind, structured in [(k, s) for s in [False, True] for k in ['pdf','docx','pptx']]:
                boundary='Aura'+uuid.uuid4().hex
                fields={'name':'Python Smoke Test','category':'Python Basics','count':'10','difficulty':'mixed','engine':'extractive'}
                parts=[]
                for key,value in fields.items():parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
                filename=('Structured_Python_Notes.' if structured else 'Python_Study_Notes.')+kind
                parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode()+(ROOT/'examples'/filename).read_bytes()+b'\r\n')
                parts.append(f'--{boundary}--\r\n'.encode())
                result=request('/api/generate',b''.join(parts),{'Content-Type':'multipart/form-data; boundary='+boundary,'X-Aura-CSRF':csrf})
                expected_count=4 if structured else 10
                assert result['generated_count']==expected_count and len(result['cards'])==expected_count
                if structured:
                    assert result['structured_cards']==4
                    assert [(c['question'],c['origin']) for c in result['cards']]==[('What is a tuple?','qa'),('What does len return?','qa'),('What is Inheritance?','topic'),('What are Python lists?','topic')]
                assert all(c['answer'].casefold().rstrip('.') in c['source']['excerpt'].casefold() for c in result['cards'])
                print(f'HTTP upload → {kind.upper()} → {expected_count} source-grounded cards: passed',flush=True)
            if '--uploads-only' in sys.argv:
                print('All six real-server document uploads passed.',flush=True)
                return
            body=json.dumps({'deck_id':'http-smoke','duration_minutes':1,'timer_url':base+'/pomodoro'}).encode()
            session=request('/api/focus-sessions',body,{'Content-Type':'application/json','X-Aura-CSRF':csrf},expected=201)
            endpoint='/api/focus-sessions/'+session['session_id'];headers={'Content-Type':'application/json','Authorization':'Bearer '+session['completion_token'],'Origin':base}
            def action(name,expected=200):return request(endpoint,json.dumps({'action':name}).encode(),headers,expected=expected)
            action('complete',409);action('start');time.sleep(.2)
            paused=action('pause');time.sleep(.2)
            assert request(endpoint,headers=headers)['elapsed_seconds']==paused['elapsed_seconds']
            running=action('start');print('HTTP focus → early completion rejected; pause/resume verified. Running full minute…',flush=True)
            wait_until=time.monotonic()+running['remaining_seconds']+.3
            while time.monotonic()<wait_until:time.sleep(.2)
            assert action('complete')['status']=='completed';action('complete')
            summary=request('/api/focus-sessions');assert summary['completed_sessions']==1 and summary['total_minutes']==1
            print('HTTP focus → full minute completed; duplicate completion adds no second entry: passed',flush=True)
            request('/api/focus-sessions',headers={'X-Aura-CSRF':csrf},method='DELETE')
            assert request('/api/focus-sessions')['total_minutes']==0
            assert sorted(p.name for p in Path(data_dir).iterdir())==['focus.sqlite3','session-secret']
            print('Full HTTP smoke test passed. Server stored no uploaded documents.',flush=True)
        finally:
            server.terminate()
            try:server.communicate(timeout=5)
            except subprocess.TimeoutExpired:server.kill();server.communicate()


if __name__=='__main__':main()
