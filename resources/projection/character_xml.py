"""Fixed local serializer/XSD validator. stdin is bounded JSON, never file paths."""
import hashlib
import copy
import json
import pathlib
import sys
from lxml import etree

SCHEMA_HASH = 'dbdd84b431d9e3addcc22ab60abcaf20efd1d01dce706395b5873b2d3db99037'
schema_path = pathlib.Path(__file__).parent.parent / 'contracts' / 'character.schema.xsd'
if schema_path.is_symlink() or hashlib.sha256(schema_path.read_bytes()).hexdigest() != SCHEMA_HASH:
    raise ValueError('Reviewed schema identity changed')
raw = sys.stdin.buffer.read(524289)
if len(raw) > 524288:
    raise ValueError('Projection input exceeds its bound')
payload = json.loads(raw)
count = 0
def element(row, depth=0):
    global count
    count += 1
    if depth > 12 or count > 1024 or set(row) - {'tag', 'attrs', 'text', 'children'}:
        raise ValueError('Invalid bounded XML tree')
    node = etree.Element(row['tag'], row.get('attrs', {}))
    node.text = row.get('text')
    for child in row.get('children', []):
        node.append(element(child, depth + 1))
    return node
parser = etree.XMLParser(resolve_entities=False, load_dtd=False, no_network=True)
schema_doc = etree.parse(str(schema_path), parser)
if schema_doc.docinfo.doctype or schema_doc.xpath('//*[local-name()="include" or local-name()="import"]'):
    raise ValueError('External schema references forbidden')
schema = etree.XMLSchema(schema_doc)
output = []
if 'documents' in payload:
    documents = payload['documents']
    if not isinstance(documents, list) or not 1 <= len(documents) <= 16:
        raise ValueError('Invalid document count')
    roots = []
    definitions = {}
    def merge(target, incoming):
        if target.attrib != incoming.attrib:
            raise ValueError('Conflicting culture definition revisions')
        for child in incoming:
            key = (child.tag, child.get('id'), child.get('culture_ref'),
                   child.get('kind'), child.get('ref'))
            existing = next((row for row in target if
                (row.tag, row.get('id'), row.get('culture_ref'),
                 row.get('kind'), row.get('ref')) == key and
                (child.tag != 'norm' or row.text == child.text)), None)
            if existing is None:
                target.append(copy.deepcopy(child))
            elif child.tag == 'variant':
                merge(existing, child)
            elif etree.tostring(existing) != etree.tostring(child):
                raise ValueError('Conflicting culture cue or source')
        order = {'source': 0, 'scope': 1, 'inherits': 2, 'related': 3,
                 'norm': 4, 'cue': 5, 'variant': 6}
        target[:] = sorted(target, key=lambda row:
            (order[row.tag], row.get('id', ''), row.get('culture_ref', ''),
             row.get('kind', ''), row.text or ''))
    for xml in documents:
        if '<!doctype' in xml.lower() or len(xml.encode('utf-8')) > 65536:
            raise ValueError('Unsafe XML document')
        root = etree.fromstring(xml.encode('utf-8'), parser)
        schema.assertValid(root)
        cultures = root.find('cultures')
        if cultures is not None:
            for culture in cultures:
                if culture.get('id') in definitions:
                    merge(definitions[culture.get('id')], culture)
                else:
                    definitions[culture.get('id')] = copy.deepcopy(culture)
            root.remove(cultures)
        roots.append(root)
    if definitions:
        container = etree.Element('cultures')
        for culture_id in sorted(definitions):
            container.append(definitions[culture_id])
        roots[0].insert(0, container)
    cues = {(culture_id, cue.get('id')) for culture_id, culture in definitions.items()
            for cue in culture.findall('.//cue')}
    for root in roots:
        for deviation in root.findall('character/deviation'):
            if (deviation.get('culture_ref'), deviation.get('cue_ref')) not in cues:
                raise ValueError('Deviation lost its target cue')
        schema.assertValid(root)
        output.append(etree.tostring(root, encoding='unicode'))
else:
    candidates = payload['candidates']
    if not isinstance(candidates, list) or not 1 <= len(candidates) <= 33:
        raise ValueError('Invalid candidate count')
    for candidate in candidates:
        count = 0
        root = element(candidate)
        schema.assertValid(root)
        serialized = etree.tostring(root, encoding='unicode')
        if len(serialized.encode('utf-8')) > 65536:
            raise ValueError('Projection output exceeds its bound')
        output.append(serialized)
sys.stdout.write(json.dumps(output))
