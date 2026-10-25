import tempfile
import unittest
from app import create_app

class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = create_app({'TESTING':True, 'DATA_DIR':self.tmp.name})
        self.client = self.app.test_client()
        self.csrf = self.client.get('/api/config').json['csrf_token']
        self.decks = [{'id':'deck1','name':'Revision','cards':[{'id':'card1','question':'2 < 3?','answer':'Yes.'}]}]
    def tearDown(self): self.tmp.cleanup()
    def publish(self, decks):
        return self.client.post('/api/study-library',json={'decks':decks},headers={'X-Aura-CSRF':self.csrf})
    def test_publish_peer_read_delete(self):
        self.assertEqual(self.publish(self.decks).status_code,200)
        self.assertEqual(self.client.get('/api/integration/decks').json['decks'],self.decks)
        self.assertEqual(self.publish([]).status_code,200)
        self.assertEqual(self.client.get('/api/integration/decks').json['decks'],[])
    def test_origin_and_csrf(self):
        self.assertEqual(self.client.post('/api/study-library',json={'decks':self.decks}).status_code,403)
        for headers in ({'Origin':'http://evil.test'}, {'Sec-Fetch-Site':'same-origin'}):
            self.assertEqual(self.client.get('/api/integration/decks',headers=headers).status_code,403)
        self.assertEqual(self.client.post('/api/linked/timer',json={'action':'reset'}).status_code,403)
    def test_invalid_data(self):
        for decks in (None,{},[None],[{'id':'x','name':'N','cards':[{}]}],self.decks*2):
            self.assertEqual(self.publish(decks).status_code,400)
    def test_devices_do_not_overwrite_each_other(self):
        self.publish(self.decks)
        other = self.app.test_client()
        csrf = other.get('/api/config').json['csrf_token']
        other.post('/api/study-library',json={'decks':[]},headers={'X-Aura-CSRF':csrf})
        self.assertEqual(len(self.client.get('/api/integration/decks').json['decks']),1)

if __name__ == '__main__': unittest.main()
