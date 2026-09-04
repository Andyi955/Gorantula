import { describe, it, expect } from 'vitest';
import {
    ENTITY_TAG_PATTERN,
    ENTITY_TAG_TYPES,
    getEntityTagChipClass,
    UNKNOWN_ENTITY_TAG_CHIP_CLASS,
} from '../../src/utils/entityTags';

describe('entityTags', () => {
    it('exposes every supported entity type with a distinct chip style', () => {
        expect(ENTITY_TAG_TYPES).toEqual([
            'PERSON',
            'ORG',
            'LOC',
            'GPE',
            'DATE',
            'TIME',
            'EVENT',
            'PRODUCT',
            'MONEY',
            'PERCENT',
            'LAW',
        ]);

        const chipClasses = ENTITY_TAG_TYPES.map((type) => getEntityTagChipClass(type));
        // Every supported type gets its own styling (so each color is distinct).
        expect(new Set(chipClasses).size).toBe(ENTITY_TAG_TYPES.length);
        for (const type of ENTITY_TAG_TYPES) {
            const chipClass = getEntityTagChipClass(type);
            expect(chipClass).toContain('text-white');
            expect(chipClass).toContain('rounded');
        }
        // Person keeps its existing purple chip.
        expect(getEntityTagChipClass('PERSON')).toContain('bg-cyber-purple/22');
    });

    it('renders unknown tag types as a neutral chip instead of leaking raw text', () => {
        expect(getEntityTagChipClass('UNKNOWN')).toBe(UNKNOWN_ENTITY_TAG_CHIP_CLASS);
        // Case-insensitive lookup.
        expect(getEntityTagChipClass('person')).toBe(getEntityTagChipClass('PERSON'));
    });

    it('matches every entity tag type including the new ones', () => {
        const text = '[PERSON:Ada] met [ORG:Acme] in [LOC:Berlin] ([GPE:Germany]) for [EVENT:the summit] on [DATE:2026-01-01] at [TIME:09:30] for [PRODUCT:GPT-5] with [MONEY:$2.4B] and [PERCENT:38%] under [LAW:DSA].';
        const matches = text.match(ENTITY_TAG_PATTERN) || [];
        expect(matches).toHaveLength(11);
        expect(getEntityTagChipClass('GPE')).not.toBe(getEntityTagChipClass('LOC'));
        expect(getEntityTagChipClass('EVENT')).not.toBe(getEntityTagChipClass('ORG'));
    });
});
