"""Wire-level integration tests against a local llama-server fixture; no model required."""
import io
import http.cookiejar
import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from urllib.request import build_opener, HTTPCookieProcessor, ProxyHandler, Request
from werkzeug.serving import make_server
from app import create_app
from backend.errors import UserError
from backend.extraction import DocumentText, TextUnit
from fixtures import pdf_bytes, docx_bytes, pptx_bytes
from backend.llamacpp import local_base, discover, inspect, generate, generate_details, _content

FACT='Photosynthesis converts light energy into chemical energy in plants.'


class LlamaCppTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args): pass
            def send(self,data,status=200):
                body=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
            def do_GET(self):
                if cls.mode=='auth': return self.send({},401)
                if cls.mode=='loading':return self.send({},503)
                if self.path=='/v1/models':return self.send({'data':[{'id':'local-gemma-any-name.gguf'},{'id':'different-model-alias'}]})
                if self.path.startswith('/props'):return self.send({'default_generation_settings':{'n_ctx':cls.context},'total_slots':1})
                return self.send({},404)
            def do_POST(self):
                body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                if self.path=='/tokenize':
                    cls.tokenizations.append(body)
                    return self.send({'tokens':[1]*600})
                cls.calls.append(body)
                if cls.mode=='redirect':
                    self.send_response(307);self.send_header('Location','https://example.com/inference');self.end_headers();return
                task=json.loads(body['messages'][1]['content']);source=task['source_passages'][0]
                quote=cls.evidence if cls.mode!='badquote' else 'An entirely fabricated statement without supporting evidence.'
                facts=[('How does a polymerase build DNA?', 'A polymerase synthesizes new DNA strands using a template.'),('What is the role of ribosomes?', 'Ribosomes assemble proteins by joining amino acids.'),('How do chloroplasts use sunlight?', 'Chloroplasts convert sunlight into chemical energy.'),('How do lysosomes process waste?', 'Lysosomes digest waste using specialized enzymes.')]
                stage=task['stage']
                if stage=='flash':
                    entries=facts if cls.mode in ('refill','partial','adaptive') else [('What does photosynthesis convert in plants?',quote)]
                    entries=[(q,a) for q,a in entries if q not in task['avoid_questions']]
                    if cls.mode=='partial' and task['avoid_questions']:return self.send({},503)
                    if cls.mode=='refill':entries=entries[:1]
                    cards=[{'question':q,'answer':a,'source_id':source['id'],'quote':a,'kind':'function'} for q,a in entries[:task['requirements']['maximum_cards']]]
                    if cls.mode=='invented_number':
                        for c in cards:c['answer']='Photosynthesis requires a temperature of 42 degrees Celsius.'
                    if cls.mode=='wrong_style':
                        for c in cards:c['kind']='cloze'
                    result={'cards':cards}
                elif stage=='plan':
                    entries=facts if cls.mode in ('refill','adaptive','partial') else [('What does photosynthesis convert in plants?',quote)]
                    objectives=[{'source_id':source['id'],'topic':'Biology','objective':q,'quote':a,'kind':'function','importance':3} for q,a in entries]
                    if task.get('avoid_objectives'):objectives=[o for o in objectives if o['objective'] not in task['avoid_objectives']]
                    result={'objectives':objectives[:task['requirements']['maximum_objectives']]}
                elif stage=='draft':
                    objectives=task['learning_objectives']
                    if cls.mode in ('refill','partial'):objectives=objectives[:1]
                    cards=[{'objective_id':o['id'],'question':o['objective'],'answer':o['quote'],'source_id':source['id'],'quote':o['quote'],'kind':'function'} for o in objectives]
                    if cls.mode=='partial' and task['requirements']['avoid_questions']:return self.send({},503)
                    if cls.mode=='repair':
                        for c in cards:c['answer']='Light energy.'
                    if cls.mode=='invented_number':
                        for c in cards:c['answer']='Photosynthesis requires a temperature of 42 degrees Celsius.'
                    result={'cards':cards}
                else:
                    cards=task['draft_cards']
                    if cls.mode=='badreview':cards[0]['quote']='Fabricated reviewer evidence does not occur in the source.'
                    if cls.mode=='repair':
                        for c in cards:c['answer']=c['quote']
                    result={'reviews':[{'objective_id':c['objective_id'],'verdict':'revise' if cls.mode=='repair' else 'drop' if cls.mode=='review_drop' else 'keep','issue':'incomplete' if cls.mode=='repair' else 'unsupported' if cls.mode=='review_drop' else 'none','card':{**c,'objective_id':'foreign'} if cls.mode=='foreign_objective' else c} for c in cards]}
                text=json.dumps(result)
                if cls.mode=='thought':text='<think>Private reasoning.</think>\n```json\n'+text+'\n```'
                if cls.mode=='malformed':text='not json'
                self.send({'choices':[{'finish_reason':'length' if cls.mode=='length' or (cls.mode=='adaptive' and stage=='draft' and len(task['learning_objectives'])>1) else 'stop','message':{'content':text}}]})
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.base='http://127.0.0.1:'+str(cls.server.server_port)
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join()
    def setUp(self):
        type(self).mode='good';type(self).calls=[];type(self).context=8192;type(self).evidence=FACT;type(self).tokenizations=[]
        self.document=DocumentText([TextUnit('Topic: Photosynthesis\n'+FACT+'\n\n   Study notes: visual wrapping and bullets.','Page 2')],[])
    def test_discovery_custom_v1_any_model_and_saved_choice(self):
        status=discover(self.base+'/v1/')
        self.assertTrue(status['ready']);self.assertEqual(status['base_url'],self.base)
        self.assertEqual(status['model'],'local-gemma-any-name.gguf')
        self.assertEqual(discover(self.base,'different-model-alias')['model'],'different-model-alias')
        with patch('backend.llamacpp.DEFAULT_BASES',(self.base,)):
            self.assertTrue(discover()['ready'])
        self.assertEqual(discover(self.base,'removed')['code'],'llamacpp_model')
    def test_url_limits_redirects_and_no_internet_fallback(self):
        for url in ['https://example.com','http://192.168.1.2:8080','http://user:pass@localhost:8080','http://localhost:bad','http://localhost:8080/private','http://localhost:8080?remote=yes']:
            with self.subTest(url=url),self.assertRaises(UserError):local_base(url)
        type(self).mode='redirect'
        with self.assertRaises(UserError) as caught:generate(self.document,4,'mixed',inspect(self.base))
        self.assertEqual(caught.exception.code,'llamacpp_redirect')
    def test_draft_review_evidence_and_arbitrary_model(self):
        cards,notes=generate(self.document,4,'mixed',inspect(self.base,'different-model-alias'))
        self.assertEqual(len(cards),1);self.assertGreaterEqual(len(self.calls),4)
        self.assertEqual(cards[0]['source'],{'label':'Page 2','excerpt':FACT})
        self.assertIn('llama.cpp',cards[0]['tags'])
        self.assertTrue(all(c['model']=='different-model-alias' for c in self.calls))
        self.assertFalse(self.calls[0]['stream']);self.assertFalse(self.calls[0]['chat_template_kwargs']['enable_thinking'])
        self.assertIn('schema',self.calls[0]['response_format'])
        self.assertEqual(json.loads(self.calls[0]['messages'][1]['content'])['stage'],'plan')
        self.assertTrue(any(json.loads(c['messages'][1]['content'])['stage']=='review' for c in self.calls))
    def test_bad_evidence_rejected_before_saving(self):
        for mode in ['badquote','badreview']:
            type(self).mode=mode
            with self.subTest(mode=mode),self.assertRaises(UserError) as caught:generate(self.document,4,'mixed',inspect(self.base))
            self.assertEqual(caught.exception.code,'no_cards')
    def test_incomplete_malformed_loading_and_auth_messages(self):
        for mode,code in [('length','llamacpp_incomplete'),('malformed','llamacpp_output')]:
            type(self).mode=mode
            with self.subTest(mode=mode),self.assertRaises(UserError) as caught:generate(self.document,4,'mixed',inspect(self.base))
            self.assertEqual(caught.exception.code,code)
        for mode,code in [('auth','llamacpp_auth'),('loading','llamacpp_loading')]:
            type(self).mode=mode;self.assertEqual(inspect(self.base)['code'],code)
    def test_think_tags_small_context_and_duplicate_batches(self):
        type(self).mode='thought'
        cards,notes=generate(self.document,12,'mixed',inspect(self.base))
        self.assertEqual(len(cards),1);self.assertNotIn('reasoning',cards[0]['answer'])
        type(self).context=2048
        with self.assertRaises(UserError) as caught:generate(self.document,3,'mixed',inspect(self.base))
        self.assertEqual(caught.exception.code,'llamacpp_context')
    def test_underfilled_batches_are_refilled_without_losing_answer_detail(self):
        type(self).mode='refill'
        text='A polymerase synthesizes new DNA strands using a template.\nRibosomes assemble proteins by joining amino acids.\nChloroplasts convert sunlight into chemical energy.\nLysosomes digest waste using specialized enzymes.'
        doc=DocumentText([TextUnit(text,'Biology notes')],[])
        cards,notes=generate(doc,4,'mixed',inspect(self.base))
        self.assertEqual(len(cards),4)
        self.assertEqual(len({c['question'] for c in cards}),4)
        self.assertEqual(len(self.calls),9)
        self.assertTrue(all(c['answer']==c['source']['excerpt'] for c in cards))
        self.assertIn('essential steps',self.calls[0]['messages'][0]['content'])
        self.assertEqual(json.loads(self.calls[0]['messages'][1]['content'])['requirements']['difficulty'],'mixed')

    def test_review_repairs_detail_and_conditions_and_reports_it(self):
        type(self).mode='repair'
        type(self).evidence=FACT+' Chloroplasts capture the light, and the resulting energy supports sugar synthesis. The process depends on a sufficient light supply; low light reduces its rate.'
        doc=DocumentText([TextUnit(self.evidence,'Page 9')],[])
        progress=[]
        cards,notes,report=generate_details(doc,1,'advanced',inspect(self.base),detail='expanded',progress=progress.append)
        self.assertIn('low light reduces its rate',cards[0]['answer'])
        self.assertIn('Chloroplasts capture',cards[0]['answer'])
        self.assertEqual(report['repaired_cards'],1);self.assertEqual(report['model_calls'],3)
        self.assertEqual(progress[-1]['accepted'],1)
        task=json.loads(self.calls[1]['messages'][1]['content'])
        self.assertEqual(task['requirements']['difficulty'],'advanced')
        self.assertIn('maximum 1400 characters',task['requirements']['answer_detail'])
        self.assertNotIn('Light energy.',cards[0]['answer'])

    def test_untrusted_review_cannot_bypass_numeric_or_objective_checks(self):
        for mode in ('invented_number','foreign_objective','review_drop'):
            type(self).mode=mode
            with self.subTest(mode=mode),self.assertRaises(UserError) as caught:
                generate(self.document,1,'mixed',inspect(self.base))
            self.assertEqual(caught.exception.code,'no_cards')

    def test_small_supported_context_and_invalid_controls(self):
        type(self).context=4096
        cards,_,report=generate_details(self.document,1,'beginner',inspect(self.base,'different-model-alias'),detail='focused',depth='balanced')
        self.assertEqual(len(cards),1);self.assertEqual(report['depth'],'balanced')
        self.assertTrue(self.tokenizations);self.assertTrue(all(t['model']=='different-model-alias' for t in self.tokenizations))
        for kwargs in ({'depth':'fake'},{'detail':'fake'}):
            with self.assertRaises(UserError) as caught:generate_details(self.document,1,'mixed',inspect(self.base),**kwargs)
            self.assertEqual(caught.exception.code,'invalid_options')

    def test_flash_direct_generation_is_one_call_with_no_mapping_or_model_review(self):
        progress=[]
        cards,notes,report=generate_details(self.document,1,'advanced',inspect(self.base,'different-model-alias'),depth='flash',detail='focused',progress=progress.append)
        self.assertEqual(len(cards),1);self.assertEqual(len(self.calls),1)
        self.assertEqual(report['model_calls'],1);self.assertEqual(report['pipeline'],'flash-v1')
        self.assertEqual(report['mapped_concepts'],0);self.assertEqual(report['repaired_cards'],0)
        self.assertEqual(cards[0]['source']['excerpt'],FACT)
        self.assertTrue(any('separate model review' in n for n in notes))
        self.assertEqual({e['phase'] for e in progress},{'reading','drafting','checking','complete'})
        task=json.loads(self.calls[0]['messages'][1]['content'])
        self.assertEqual(task['stage'],'flash');self.assertEqual(task['requirements']['difficulty'],'advanced')
        self.assertNotIn('learning_objectives',task)
        self.assertEqual(self.calls[0]['model'],'different-model-alias')

    def test_flash_rejects_invented_evidence_numbers_and_incorrect_style(self):
        for mode in ('badquote','invented_number','wrong_style'):
            type(self).mode=mode
            with self.subTest(mode=mode),self.assertRaises(UserError) as caught:
                generate_details(self.document,1,'mixed',inspect(self.base),depth='flash',style='qa')
            self.assertEqual(caught.exception.code,'no_cards')

    def test_flash_bounded_refill_deduplication_and_partial_recovery(self):
        text='A polymerase synthesizes new DNA strands using a template. Ribosomes assemble proteins by joining amino acids. Chloroplasts convert sunlight into chemical energy. Lysosomes digest waste using specialized enzymes.'
        doc=DocumentText([TextUnit(text,'Biology')],[])
        type(self).mode='refill'
        cards,notes,report=generate_details(doc,4,'mixed',inspect(self.base),depth='flash')
        self.assertEqual(len(cards),3)  # Three attempts per section is a Flash limit.
        self.assertEqual(len({c['question'] for c in cards}),3)
        self.assertEqual(report['model_calls'],3)
        self.assertTrue(any('3 supported cards of 4' in n for n in notes))
        type(self).mode='partial'
        cards,notes,_=generate_details(doc,4,'mixed',inspect(self.base),depth='flash')
        self.assertEqual(len(cards),3)
        self.assertTrue(any('preserving automatically checked' in n for n in notes))
        type(self).mode='good'
        cards,_,report=generate_details(self.document,10,'mixed',inspect(self.base),depth='flash')
        self.assertEqual(len(cards),1);self.assertLessEqual(report['model_calls'],3)

    def test_flash_budget_preserves_checked_cards_and_starts_no_further_request(self):
        clock=[0]
        def draft(*args,**kwargs):
            clock[0]=181
            return [{'question':'What does photosynthesis convert in plants?','answer':FACT,'quote':FACT,'source_id':'S1','kind':'function'}]
        with patch('backend.llamacpp.time.monotonic',side_effect=lambda:clock[0]),patch('backend.llamacpp._stage',side_effect=draft) as stage:
            cards,notes,report=generate_details(self.document,4,'mixed',{'ready':True,'context_size':8192},depth='flash')
        self.assertEqual(stage.call_count,1);self.assertEqual(len(cards),1)
        self.assertTrue(any('three-minute' in n for n in notes))

    def test_flash_multipart_stream_reports_checks_without_claiming_model_review(self):
        with tempfile.TemporaryDirectory() as tmp:
            app=create_app({'TESTING':True,'DATA_DIR':tmp,'SECRET_KEY':'test','LLAMA_URL':self.base,'EXTRACTOR':lambda *args:self.document})
            client=app.test_client();csrf=client.get('/api/config').json['csrf_token']
            response=client.post('/api/generate',data={'file':(io.BytesIO(b'test'),'study.pdf'),'name':'Flash study','category':'Science','count':'1','engine':'llamacpp','generation_depth':'flash','answer_detail':'focused'},headers={'X-Aura-CSRF':csrf,'Accept':'application/x-ndjson'})
            self.assertEqual(response.status_code,200)
            events=[json.loads(line) for line in response.data.splitlines()]
            self.assertEqual(events[-1]['type'],'result',events)
            result=events[-1]['data'];self.assertEqual(result['generated_count'],1)
            self.assertEqual(result['generation_report']['depth'],'flash')
            self.assertEqual(result['generation_report']['pipeline'],'flash-v1')
            self.assertFalse(any(e.get('phase') in ('mapping','reviewing') for e in events))

    def test_adaptive_batches_and_partial_results(self):
        text=' '.join(['A polymerase synthesizes new DNA strands using a template.', 'Ribosomes assemble proteins by joining amino acids.', 'Chloroplasts convert sunlight into chemical energy.', 'Lysosomes digest waste using specialized enzymes.'])
        doc=DocumentText([TextUnit(text,'Biology')],[])
        type(self).mode='adaptive'
        cards,notes,report=generate_details(doc,4,'advanced',inspect(self.base))
        self.assertEqual(len(cards),4);self.assertTrue(any('Reduced' in n for n in notes))
        draft_sizes=[len(json.loads(c['messages'][1]['content'])['learning_objectives']) for c in self.calls if json.loads(c['messages'][1]['content'])['stage']=='draft']
        self.assertGreater(draft_sizes[0],1);self.assertIn(1,draft_sizes)
        self.assertEqual(report['covered_concepts'],4)
        type(self).mode='partial'
        cards,notes,report=generate_details(doc,4,'mixed',inspect(self.base))
        self.assertEqual(len(cards),1);self.assertTrue(any('preserving reviewed' in n for n in notes))

    def test_streaming_api_real_progress_and_multipart_options(self):
        with tempfile.TemporaryDirectory() as tmp:
            app=create_app({'TESTING':True,'DATA_DIR':tmp,'SECRET_KEY':'test','LLAMA_URL':self.base,'EXTRACTOR':lambda *args:self.document})
            client=app.test_client();csrf=client.get('/api/config').json['csrf_token']
            data={'file':(io.BytesIO(b'test'),'messy.pdf'),'name':'Study','category':'Science','count':'4','difficulty':'advanced','engine':'llamacpp','llama_base':self.base,'llama_model':'different-model-alias','input_format':'auto','style':'qa','focus':'photosynthesis','generation_depth':'balanced','answer_detail':'focused'}
            response=client.post('/api/generate',data=data,headers={'X-Aura-CSRF':csrf,'Accept':'application/x-ndjson'})
            self.assertEqual(response.status_code,200)
            events=[json.loads(line) for line in response.data.splitlines()]
            phases=[e['phase'] for e in events if e['type']=='progress']
            self.assertTrue({'mapping','drafting','reviewing','complete'}.issubset(phases))
            result=next(e['data'] for e in events if e['type']=='result')
            self.assertEqual(result['generation_report']['pipeline'],'curriculum-v2')
            self.assertEqual(result['generation_report']['answer_detail'],'focused')
            self.assertEqual(result['generation_report']['depth'],'balanced')
            self.assertEqual(result['generation_report']['covered_concepts'],len(result['cards']))
            self.assertNotIn('Private reasoning',response.data.decode())
            # The semaphore is released even after a stream error.
            type(self).mode='malformed'
            data['file']=(io.BytesIO(b'test'),'messy.pdf')
            error=client.post('/api/generate',data=data,headers={'X-Aura-CSRF':csrf,'Accept':'application/x-ndjson'})
            errors=[json.loads(line) for line in error.data.splitlines()]
            self.assertTrue(any(e['type']=='error' for e in errors));self.assertFalse(any(e['type']=='result' for e in errors))
            type(self).mode='good';data['file']=(io.BytesIO(b'test'),'messy.pdf')
            self.assertEqual(client.post('/api/generate',data=data,headers={'X-Aura-CSRF':csrf}).status_code,200)

    def test_stream_over_real_http(self):
        with tempfile.TemporaryDirectory() as tmp:
            app=create_app({'TESTING':True,'DATA_DIR':tmp,'SECRET_KEY':'test','LLAMA_URL':self.base,'EXTRACTOR':lambda *args:self.document})
            server=make_server('127.0.0.1',0,app,threaded=True)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            client=build_opener(ProxyHandler({}),HTTPCookieProcessor(http.cookiejar.CookieJar()))
            base=f'http://127.0.0.1:{server.server_port}'
            try:
                with client.open(base+'/api/config') as response:csrf=json.load(response)['csrf_token']
                boundary='AuraStreamTest'
                fields={'name':'Network study','category':'Science','count':'1','engine':'llamacpp','generation_depth':'thorough','answer_detail':'expanded'}
                parts=[f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k,v in fields.items()]
                parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="study.pdf"\r\nContent-Type: application/pdf\r\n\r\ntest\r\n--{boundary}--\r\n'.encode())
                req=Request(base+'/api/generate',data=b''.join(parts),headers={'X-Aura-CSRF':csrf,'Content-Type':'multipart/form-data; boundary='+boundary,'Accept':'application/x-ndjson'})
                with client.open(req,timeout=10) as response:
                    self.assertIn('application/x-ndjson',response.headers['Content-Type'])
                    self.assertEqual(response.headers['Cache-Control'],'no-store')
                    events=[json.loads(line) for line in response if line.strip()]
                self.assertEqual(events[0]['type'],'progress')
                self.assertEqual(events[-1]['type'],'result')
                self.assertEqual(events[-1]['data']['generated_count'],1)
                self.assertEqual(events[-1]['data']['cards'][0]['source']['excerpt'],FACT)
            finally:
                server.shutdown();server.server_close();thread.join()

    def test_real_pdf_docx_pptx_with_messy_spacing_and_wraps(self):
        messy='Photo-\nsynthesis converts  light energy into\nchemical energy in plants.'
        with tempfile.TemporaryDirectory() as tmp:
            app=create_app({'TESTING':True,'DATA_DIR':tmp,'SECRET_KEY':'test','LLAMA_URL':self.base})
            client=app.test_client();csrf=client.get('/api/config').json['csrf_token']
            for ext,raw in [('pdf',pdf_bytes([FACT.replace(' light ','  light  ')])),('docx',docx_bytes([messy])),('pptx',pptx_bytes([messy]))]:
                with self.subTest(format=ext):
                    response=client.post('/api/generate',data={'file':(io.BytesIO(raw),'messy.'+ext),'name':'Messy notes','category':'Science','count':'4','engine':'llamacpp'},headers={'X-Aura-CSRF':csrf})
                    self.assertEqual(response.status_code,200,response.json)
                    self.assertEqual(response.json['cards'][0]['source']['excerpt'],FACT)

    def test_flask_upload_round_trip_and_source_review(self):
        with tempfile.TemporaryDirectory() as tmp:
            app=create_app({'TESTING':True,'DATA_DIR':tmp,'SECRET_KEY':'test','LLAMA_URL':self.base,'EXTRACTOR':lambda *args:self.document})
            client=app.test_client();config=client.get('/api/config').json
            self.assertIn('llamacpp',config['generators']);self.assertNotIn('api_key',config['llamacpp'])
            self.assertTrue(client.get('/api/llamacpp/status').json['ready'])
            self.assertEqual(client.get('/api/llamacpp/status',headers={'Origin':'https://other.example'}).status_code,403)
            data={'file':(io.BytesIO(b'test'),'messy.pdf'),'name':'Study','category':'Science','count':'4','engine':'llamacpp','llama_base':self.base+'/v1','llama_model':'different-model-alias'}
            response=client.post('/api/generate',data=data,headers={'X-Aura-CSRF':config['csrf_token']})
            self.assertEqual(response.status_code,200,response.json)
            self.assertEqual(response.json['engine'],'llamacpp');self.assertEqual(response.json['local_model'],'different-model-alias')
            self.assertEqual(response.json['cards'][0]['source']['excerpt'],FACT)
            self.assertTrue(any('supported cards' in n for n in response.json['warnings']))

if __name__=='__main__':unittest.main()
