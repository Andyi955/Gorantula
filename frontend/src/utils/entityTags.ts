// Central definition of the entity-highlight tag vocabulary shared by the
// backend prompt and the board renderers. Keeping the list in one place means
// adding a category (a new color) only touches this module plus the backend
// prompt, instead of every regex that enumerates the tag types.
//
// Tags look like [TYPE:value], e.g. [PERSON:Elon Musk], [ORG:OpenAI],
// [LOC:London], [DATE:2026-02-24].

export const ENTITY_TAG_TYPES = [
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
] as const;

// Matches any [UPPERCASE:value] entity tag. Capture 1 is the type, capture 2 is
// the (possibly empty) value. Case-insensitive so we tolerate whatever casing
// the model emits; the value is scanned lazily up to the first closing bracket.
export const ENTITY_TAG_PATTERN = /\[([A-Z]+):([^\]]*)\]/gi;

// Chip styling per entity type. Keep each as one complete class string so the
// Tailwind JIT picks the utilities up verbatim from this source file.
export const ENTITY_TAG_CHIP_CLASSES: Record<string, string> = {
    PERSON:
        'text-white font-black bg-cyber-purple/22 px-1.5 py-0.5 rounded border border-cyber-purple/55 text-[11px] uppercase tracking-tight',
    ORG:
        'text-white font-black bg-cyber-cyan/20 px-1.5 py-0.5 rounded border border-cyber-cyan/55 text-[11px] uppercase tracking-tight',
    LOC:
        'text-white font-black bg-orange-500/20 px-1.5 py-0.5 rounded border border-orange-500/55 text-[11px] uppercase tracking-tight',
    GPE:
        'text-white font-black bg-sky-500/20 px-1.5 py-0.5 rounded border border-sky-500/55 text-[11px] uppercase tracking-tight',
    DATE:
        'text-white font-black bg-yellow-500/20 px-1.5 py-0.5 rounded border border-yellow-500/55 text-[11px] uppercase tracking-tight',
    TIME:
        'text-white font-black bg-yellow-400/20 px-1.5 py-0.5 rounded border border-yellow-400/55 text-[11px] uppercase tracking-tight',
    EVENT:
        'text-white font-black bg-rose-500/20 px-1.5 py-0.5 rounded border border-rose-500/55 text-[11px] uppercase tracking-tight',
    PRODUCT:
        'text-white font-black bg-emerald-500/20 px-1.5 py-0.5 rounded border border-emerald-500/55 text-[11px] uppercase tracking-tight',
    MONEY:
        'text-white font-black bg-amber-500/20 px-1.5 py-0.5 rounded border border-amber-500/55 text-[11px] uppercase tracking-tight',
    PERCENT:
        'text-white font-black bg-teal-500/20 px-1.5 py-0.5 rounded border border-teal-500/55 text-[11px] uppercase tracking-tight',
    LAW:
        'text-white font-black bg-fuchsia-500/20 px-1.5 py-0.5 rounded border border-fuchsia-500/55 text-[11px] uppercase tracking-tight',
};

// Neutral chip for any tag type the renderer does not know, so unknown tags
// never surface as raw [TYPE:value] text (which reads as a missed highlight).
export const UNKNOWN_ENTITY_TAG_CHIP_CLASS =
    'text-white font-black bg-white/10 px-1.5 py-0.5 rounded border border-white/35 text-[11px] uppercase tracking-tight';

export const getEntityTagChipClass = (type: string): string =>
    ENTITY_TAG_CHIP_CLASSES[type.toUpperCase()] || UNKNOWN_ENTITY_TAG_CHIP_CLASS;
