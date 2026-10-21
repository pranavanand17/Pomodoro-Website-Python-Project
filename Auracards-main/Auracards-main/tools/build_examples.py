"""Rebuild the small structured-input examples with the project dependencies."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tests'))
from fixtures import pdf_bytes, docx_bytes, pptx_bytes

LINES = [
    'Q: What is a tuple?',
    'A: An immutable ordered sequence that can contain duplicate items.',
    'Q: What does len return?',
    'A: The number of items in an object.',
    'Topic: Inheritance',
    'Explanation: A class reuses behavior from a base class.',
    'Topic: Python lists',
    'Explanation: Lists are mutable ordered collections that permit duplicates.',
]

if __name__ == '__main__':
    target = Path(__file__).resolve().parents[1] / 'examples'
    for extension, builder in [('pdf', pdf_bytes), ('docx', docx_bytes), ('pptx', pptx_bytes)]:
        path = target / ('Structured_Python_Notes.' + extension)
        path.write_bytes(builder(LINES))
        print(path.name)
