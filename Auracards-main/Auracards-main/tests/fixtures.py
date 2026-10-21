"""Tiny real document fixtures; also used to build the included Python examples."""
from io import BytesIO
from docx import Document
from pptx import Presentation
from pptx.util import Inches
from pypdf import PdfWriter
from pypdf.generic import NameObject, DictionaryObject, DecodedStreamObject

FACTS = [
    'A variable is a name that refers to an object in Python.',
    'A list is an ordered mutable collection that can contain duplicate items.',
    'A tuple is an ordered immutable sequence that can contain duplicate items.',
    'A dictionary is a mutable mapping from unique hashable keys to values.',
    'A set is an unordered collection of distinct hashable elements.',
    'A function is a reusable block of code defined with the def keyword.',
    'The return statement sends a result from a function to its caller.',
    'A parameter is a named input in a function definition.',
    'An argument is a value supplied when a function is called.',
    'A class is a definition used to create objects with data and behavior.',
    'An instance is an individual object created from a class.',
    'The len function returns the number of items in an object.',
    'The range function produces an immutable sequence of integers.',
    'A for loop iterates over the elements of an iterable object.',
    'A while loop repeats a block of code while its condition is true.',
    'A try statement is used to handle exceptions with except clauses.',
    'A list comprehension creates a list from an iterable using a compact expression.',
    'The with statement manages a context and runs its cleanup when the block exits.',
]


def pdf_bytes(facts=FACTS):
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
    def escape(s):
        return s.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
    # 76-character lines fit the letter page at 10pt; avoid splitting sentences.
    import textwrap
    lines=['Python Study Notes', '']
    for fact in facts:
        lines.extend(textwrap.wrap(fact, 84))
        lines.append('')
    content='BT /F1 10 Tf 42 754 Td 14 TL\n'+'\n'.join(f'({escape(line)}) Tj T*' for line in lines)+'\nET'
    stream=DecodedStreamObject(); stream.set_data(content.encode('ascii'))
    page[NameObject('/Contents')] = writer._add_object(stream)
    out=BytesIO();writer.write(out);return out.getvalue()


def docx_bytes(facts=FACTS):
    doc=Document();doc.add_heading('Python Study Notes', 0)
    for fact in facts: doc.add_paragraph(fact)
    out=BytesIO();doc.save(out);return out.getvalue()


def pptx_bytes(facts=FACTS):
    deck=Presentation()
    for start in range(0,len(facts),4):
        slide=deck.slides.add_slide(deck.slide_layouts[5]);slide.shapes.title.text='Python Study Notes'
        frame=slide.shapes.add_textbox(Inches(.6),Inches(1.3), Inches(8.7), Inches(5.5)).text_frame
        frame.word_wrap=True
        for i,fact in enumerate(facts[start:start+4]):
            p=frame.paragraphs[0] if i==0 else frame.add_paragraph();p.text=fact
    out=BytesIO();deck.save(out);return out.getvalue()
