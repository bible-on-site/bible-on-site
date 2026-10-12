"""Completed round and separator-boundary regression tests."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from listening_review import ReviewStore, digest_file, write_json
from listening_round import archive_round, load_review_evidence
from listening_tail import correct_ends, verify_corrections, METHOD, END_METHOD

class ListeningRoundTests(unittest.TestCase):
    def setUp(self):
        folder=tempfile.TemporaryDirectory();self.addCleanup(folder.cleanup);self.root=Path(folder.name)
        self.case={"id":"1-1","candidateSha256":"old","clipSha256":"clip"}
        self.old={"cases":[self.case],"queueSha256":"old-queue"};self.path=self.root/'old.json'
        self.reviews=self.root/'reviews.json';write_json(self.path,self.old)
        write_json(self.reviews,{"entries":[{"caseId":"1-1","candidateSha256":"old","note":"real answer"}]})
    def test_archive_preserves_all_bytes(self):
        before=self.reviews.read_bytes()
        with patch('listening_round.load_queue',return_value=self.old):a=archive_round(self.path,self.reviews,self.root/'archive')
        self.assertEqual(digest_file(Path(a['path'])),a['sha256'])
        self.assertEqual((self.root/'archive/reviews.json').read_bytes(),before)
        self.assertEqual(self.reviews.read_bytes(),before)
    def test_changed_candidate_requires_new_answer_unchanged_candidate_keeps_binding(self):
        for expected in ['old','new']:
            active={'cases':[] if expected=='old' else [{**self.case,'candidateSha256':'new'}], 'queueSha256':'new-queue','archivedQueues':[{'path':str(self.path),'sha256':digest_file(self.path)}]}
            with patch('listening_round.load_queue',side_effect=lambda p:self.old if p==self.path else active):q,b=load_review_evidence(self.root/'active.json')
            self.assertEqual(q['cases'][0]['candidateSha256'],expected)
            self.assertEqual(b['1-1'],['old-queue'] if expected=='old' else ['new-queue'])
            self.assertEqual(bool(ReviewStore(self.reviews,q).snapshot()),expected=='old')
    def test_modified_archive_or_cycle_fails_closed(self):
        active={'cases':[],'queueSha256':'q','archivedQueues':[{'path':str(self.path),'sha256':'bad'}]}
        with patch('listening_round.load_queue',return_value=active):
            with self.assertRaisesRegex(ValueError,'archive changed'):load_review_evidence(self.root/'active.json')
        active['archivedQueues'][0]['sha256']=digest_file(self.path)
        with patch('listening_round.load_queue',return_value=active):
            with self.assertRaisesRegex(ValueError,'Cyclic'):load_review_evidence(self.root/'active.json')
    def test_actual_separator_required_and_other_fields_immutable(self):
        rows=[{'pasuk':1,'segment':1,'text':'נתתה','startMs':100,'endMs':400,'acousticScore':.8}]
        evidence=[{'pasuk':1,'segment':1,'letterStartMs':100,'letterEndMs':400,'separatorStartMs':570,'separatorEndMs':590,'followingWordStartMs':650}]
        corrected,changes=correct_ends(rows,evidence,{(1,1)})
        self.assertEqual(corrected[0]['endMs'],570);self.assertEqual(rows[0]['endMs'],400)
        d={'boundaryMethod':METHOD,'letterCandidates':rows,'diagnosticCandidates':corrected,'boundaryCorrections':changes};verify_corrections(d)
        for change in [lambda d:d['diagnosticCandidates'][0].update(endMs=600),lambda d:d['diagnosticCandidates'][0].update(startMs=80),lambda d:d.update(boundaryCorrections=[]),lambda d:d['boundaryCorrections'][0].update(followingWordStartMs=550)]:
            candidate=deepcopy(d);change(candidate)
            with self.assertRaises(ValueError):verify_corrections(candidate)
        evidence[0]['separatorStartMs']=400
        corrected,changes=correct_ends(rows,evidence,{(1,1)},boundary="end")
        self.assertEqual(corrected[0]['endMs'],590)
        verify_corrections({'boundaryMethod':END_METHOD,'letterCandidates':rows,
            'diagnosticCandidates':corrected,'boundaryCorrections':changes})
        evidence[0]['separatorStartMs']=390
        with self.assertRaises(ValueError):correct_ends(rows,evidence,{(1,1)})

if __name__=='__main__':unittest.main()