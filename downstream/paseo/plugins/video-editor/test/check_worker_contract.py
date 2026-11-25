"""Offline Python consumer of the generated wire schema; requires jsonschema>=4.18."""

import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource


def main():
    here = Path(__file__).resolve().parent
    bundle = json.loads((here.parent / 'shared/contracts/v1.schema.json').read_bytes())
    cases = json.loads((here / 'fixtures.json').read_bytes())
    Draft202012Validator.check_schema(bundle)
    definitions = bundle['$defs']
    registry = Registry().with_resources(
        (schema['$id'], Resource.from_contents(schema)) for schema in definitions.values()
    )
    for case in cases:
        validator = Draft202012Validator(definitions[case['schema']], registry=registry,
                                         format_checker=FormatChecker())
        if validator.is_valid(case['value']) != case['valid']:
            raise ValueError(f"Worker contract mismatch: {case['name']}")
    print(f"PASS: {len(cases)} wire fixtures against {len(definitions)} offline definitions")


if __name__ == '__main__':
    main()
