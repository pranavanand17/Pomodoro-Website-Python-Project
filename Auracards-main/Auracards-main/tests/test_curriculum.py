"""Regressions for source coverage, real defects and preserving distinct facts."""
from collections import Counter
import unittest
from backend.curriculum import (source_windows, select_sources, valid_objectives, valid_drafts,
                                quality_issue, duplicate, choose_objectives)
from backend.extraction import DocumentText, TextUnit


class CurriculumTests(unittest.TestCase):
    def setUp(self):
        self.fact='The enzyme operates at 37 degrees Celsius only when the cofactor is present.'
        self.source={'id':'S1','text':self.fact,'label':'Page 5','heading':'Enzymes'}
        self.objective={'id':'O1','source_id':'S1','topic':'Enzyme conditions','objective':'Recall the conditions required for this enzyme to operate.', 'quote':self.fact,'kind':'fact','importance':3}
        self.card={'objective_id':'O1','source_id':'S1','question':'Under what conditions does the enzyme operate?', 'answer':'At 37 degrees Celsius, only when the cofactor is present.', 'quote':self.fact,'kind':'fact'}

    def test_source_windows_preserve_sentence_and_table_provenance(self):
        fact='This protein binds the receptor only when the cofactor is present. '
        doc=DocumentText([TextUnit(fact*90,'Page 7',heading='Signaling',columns=('Protein','Function'))],[])
        sources=source_windows(doc,4096)
        self.assertGreater(len(sources),3)
        self.assertTrue(all(len(s['text'])<=900 for s in sources))
        self.assertTrue(all(s['text'].endswith('.') for s in sources))
        self.assertTrue(all(s['heading']=='Signaling' and s['columns']==['Protein','Function'] and s['label']=='Page 7' for s in sources))
        self.assertEqual(len({s['id'] for s in sources}),len(sources))

    def test_neighboring_word_paragraphs_keep_question_and_answer_together(self):
        doc=DocumentText([TextUnit('Q: What is a cofactor?','Paragraph 1'),TextUnit('A: A molecule required for enzyme activity.','Paragraph 2'),TextUnit('The cofactor stabilizes the active site.','Paragraph 3')],[])
        sources=source_windows(doc,8192)
        self.assertEqual(len(sources),1)
        self.assertIn('Q: What is a cofactor?\nA: A molecule',sources[0]['text'])
        self.assertEqual(sources[0]['label'],'Paragraph 1 – Paragraph 3')
        # Different headings remain independent sections.
        doc.units.append(TextUnit('Cells have a plasma membrane.','Paragraph 4',heading='Cells'))
        self.assertEqual(len(source_windows(doc,8192)),2)

    def test_focus_finds_late_material_without_prior_60000_character_sampling(self):
        units=[TextUnit(('General biology covers organisms and cells. '*60),f'Page {i}') for i in range(60)]
        units.append(TextUnit('Enzyme cofactors enable a specific catalytic reaction.','Page 61',heading='Cofactors'))
        sources=source_windows(DocumentText(units,[]),8192)
        chosen=select_sources(sources,10,'enzyme cofactors','thorough')
        self.assertEqual(len(chosen),1);self.assertEqual(chosen[0]['label'],'Page 61')
        distributed=select_sources(sources,10,'','thorough')
        self.assertGreater(distributed[-1]['position'],len(sources)*.7)

    def test_blueprint_requires_real_quote_and_citation(self):
        valid=valid_objectives([self.objective,{**self.objective,'quote':'Unrelated fabricated evidence.'},{**self.objective,'source_id':'wrong'}],[self.source],10)
        self.assertEqual(len(valid),1)
        self.assertFalse(valid_objectives([{**self.objective,'importance':True}],[self.source],10))

    def test_card_association_evidence_and_style_cannot_be_faked(self):
        for bad in [{'objective_id':'O2'},{'source_id':'S2'},{'quote':'The enzyme never requires a cofactor.'},{'kind':'cloze'}]:
            cards,rejected=valid_drafts([{**self.card,**bad}],[self.source],[self.objective],'qa','expanded')
            self.assertFalse(cards);self.assertTrue(rejected)
        cards,_=valid_drafts([self.card],[self.source],[self.objective],'qa','expanded')
        self.assertEqual(cards[0]['source']['label'],'Page 5');self.assertEqual(quality_issue(cards[0]),'')

    def test_invented_numbers_and_answer_leakage_are_rejected(self):
        self.assertEqual(quality_issue({**self.card,'answer':'At 42 degrees Celsius.'}),'unsupported_numbers')
        self.assertEqual(quality_issue({**self.card,'answer':'37 degrees Celsius','question':'Is the enzyme active at 37 degrees Celsius?'}),'')
        self.assertEqual(quality_issue({**self.card,'answer':'A blue light activates the receptor.','question':'Does a blue light activates the receptor. occur?'}),'answer_leakage')
        self.assertEqual(quality_issue({**self.card,'question':'What activates the enzyme? Why is it active?'}),'compound_question')
        self.assertEqual(quality_issue({**self.card,'answer':'1. Add the cofactor.\n2. Incubate at 37 degrees Celsius.'}),'')

    def test_expanded_answers_can_retain_supported_explanations_beyond_old_limit(self):
        answer=('The cofactor stabilizes the enzyme and permits substrate binding. '*12).strip()
        source={**self.source,'text':answer}
        card={**self.card,'answer':answer,'quote':answer}
        self.assertGreater(len(answer),650)
        self.assertTrue(valid_drafts([card],[source],[self.objective],'qa','expanded')[0])
        self.assertFalse(valid_drafts([{**card,'answer':answer*2}],[source],[self.objective],'qa','focused')[0])

    def test_duplicate_answers_but_distinct_numbers_and_polarity_survive(self):
        self.assertTrue(duplicate({**self.card,'objective_id':'O2','question':'When can this enzyme operate?'},[self.card]))
        self.assertFalse(duplicate({**self.card,'objective_id':'O2','question':'At what temperature does the second enzyme operate?','answer':'At 42 degrees Celsius, only when the cofactor is present.'},[self.card]))
        self.assertFalse(duplicate({**self.card,'objective_id':'O2','question':'How does negative feedback affect output?','answer':'Negative feedback decreases output.'},[{**self.card,'question':'How does positive feedback affect output?','answer':'Positive feedback increases output.'}]))

    def test_uncovered_sections_and_new_objectives_are_prioritized(self):
        objectives=[self.objective,{**self.objective,'id':'O2'},{**self.objective,'id':'O3','source_id':'S2','importance':2}]
        accepted=[self.card]
        self.assertEqual(choose_objectives(objectives,accepted,Counter(),'mixed',1)[0]['id'],'O3')
        self.assertEqual(choose_objectives(objectives,accepted,Counter({'O3':2}),'mixed',1)[0]['id'],'O2')

if __name__=='__main__':unittest.main()
