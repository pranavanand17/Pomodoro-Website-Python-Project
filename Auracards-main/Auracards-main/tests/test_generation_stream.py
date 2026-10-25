"""Progress transport releases the generation semaphore and honors disconnects."""
import json
import threading
import unittest
from backend.generation_stream import stream_generation
from backend.errors import UserError


class StreamTests(unittest.TestCase):
    def test_disconnect_prevents_next_model_stage_and_releases_lock(self):
        can_continue=threading.Event();released=threading.Event();cancelled=threading.Event()
        def run(progress):
            progress({'phase':'mapping','message':'Mapping…'})
            can_continue.wait(2)
            try:progress({'phase':'drafting','message':'Should be cancelled'})
            except UserError as error:
                if error.code=='generation_cancelled':cancelled.set()
                raise
            return {'cards':[]}
        response=stream_generation(run,released.set)
        iterator=iter(response.response)
        self.assertEqual(json.loads(next(iterator))['phase'],'mapping')
        response.close();can_continue.set()
        self.assertTrue(released.wait(2));self.assertTrue(cancelled.is_set())

    def test_disconnect_before_first_stream_read_also_cancels(self):
        can_continue=threading.Event();released=threading.Event();cancelled=threading.Event()
        def run(progress):
            can_continue.wait(2)
            try:progress({'phase':'mapping'})
            except UserError:cancelled.set();raise
            return {}
        response=stream_generation(run,released.set)
        response.close();can_continue.set()
        self.assertTrue(released.wait(2));self.assertTrue(cancelled.is_set())

    def test_unexpected_error_does_not_expose_document_or_server_internals(self):
        released=threading.Event()
        def fail(progress):raise RuntimeError('Sensitive document text')
        response=stream_generation(fail,released.set)
        events=[json.loads(line) for line in ''.join(response.response).splitlines()]
        self.assertTrue(released.wait(1))
        self.assertEqual(events[0]['type'],'error');self.assertNotIn('Sensitive',str(events))

if __name__=='__main__':unittest.main()
