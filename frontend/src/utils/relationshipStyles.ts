export type RelationshipPattern =
    | 'solid'
    | 'dashed'
    | 'dotted'
    | 'long-dash'
    | 'sparse-dash'
    | 'dash-dot';

export type RelationshipShape =
    | 'none'
    | 'round'
    | 'square'
    | 'angular'
    | 'staggered';

export interface TagStyle {
    color: string;
    pattern: RelationshipPattern;
    shape: RelationshipShape;
}

export interface RelationshipEdgeVisuals {
    animated: boolean;
    strokeDasharray?: string;
    strokeLinecap?: 'butt' | 'round' | 'square';
    strokeWidth?: number;
}

export const SUPPORTED_RELATIONSHIP_PATTERNS: RelationshipPattern[] = [
    'solid',
    'dashed',
    'dotted',
    'long-dash',
    'sparse-dash',
    'dash-dot',
];

export const SUPPORTED_RELATIONSHIP_SHAPES: RelationshipShape[] = [
    'none',
    'round',
    'square',
    'angular',
    'staggered',
];

const DEFAULT_TAG_COLOR = '#bc13fe';

// Legacy saved boards can contain partial or stale style data, so normalize each entry before use.
export const sanitizeTagStyles = (rawValue: unknown): Record<string, TagStyle> => {
    if (!rawValue || typeof rawValue !== 'object') {
        return {};
    }

    return Object.entries(rawValue as Record<string, unknown>).reduce<Record<string, TagStyle>>((acc, [tag, value]) => {
        if (!value || typeof value !== 'object') {
            return acc;
        }

        const candidate = value as Partial<TagStyle>;
        acc[tag] = {
            color: typeof candidate.color === 'string' && candidate.color.trim() ? candidate.color : DEFAULT_TAG_COLOR,
            pattern: normalizeRelationshipPattern(candidate.pattern),
            shape: normalizeRelationshipShape(candidate.shape),
        };
        return acc;
    }, {});
};

export const normalizeRelationshipPattern = (pattern: unknown): RelationshipPattern =>
    SUPPORTED_RELATIONSHIP_PATTERNS.includes(pattern as RelationshipPattern)
        ? pattern as RelationshipPattern
        : 'solid';

export const normalizeRelationshipShape = (shape: unknown): RelationshipShape =>
    SUPPORTED_RELATIONSHIP_SHAPES.includes(shape as RelationshipShape)
        ? shape as RelationshipShape
        : 'none';

export const createTagStyle = (tag: string): TagStyle => {
    let hash = 0;
    for (let i = 0; i < tag.length; i += 1) {
        hash = tag.charCodeAt(i) + ((hash << 5) - hash);
    }

    const r = (Math.abs(hash) % 156) + 100;
    const g = (Math.abs(hash * 3) % 156) + 100;
    const b = (Math.abs(hash * 7) % 156) + 100;

    return {
        color: `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`,
        pattern: SUPPORTED_RELATIONSHIP_PATTERNS[Math.abs(hash) % SUPPORTED_RELATIONSHIP_PATTERNS.length],
        shape: 'none',
    };
};

// Shape acts as a dash/dot motif modifier rather than an overlay marker.
export const getRelationshipEdgeVisuals = (
    pattern: RelationshipPattern,
    shape: RelationshipShape = 'none',
): RelationshipEdgeVisuals => {
    const normalizedShape = normalizeRelationshipShape(shape);

    switch (pattern) {
        case 'dashed':
            switch (normalizedShape) {
                case 'round':
                    return { animated: true, strokeDasharray: '5 6', strokeLinecap: 'round' };
                case 'square':
                    return { animated: true, strokeDasharray: '6 4', strokeLinecap: 'square' };
                case 'angular':
                    return { animated: true, strokeDasharray: '2 4 8 4', strokeLinecap: 'butt' };
                case 'staggered':
                    return { animated: true, strokeDasharray: '8 3 3 3', strokeLinecap: 'square' };
                case 'none':
                default:
                    return { animated: true, strokeDasharray: '6 4' };
            }
        case 'dotted':
            switch (normalizedShape) {
                case 'round':
                    return { animated: true, strokeDasharray: '1 7', strokeLinecap: 'round', strokeWidth: 3 };
                case 'square':
                    return { animated: true, strokeDasharray: '1 7', strokeLinecap: 'square', strokeWidth: 3 };
                case 'angular':
                    return { animated: true, strokeDasharray: '1 4 1 8', strokeLinecap: 'butt', strokeWidth: 3 };
                case 'staggered':
                    return { animated: true, strokeDasharray: '2 5 2 9', strokeLinecap: 'square', strokeWidth: 3 };
                case 'none':
                default:
                    return { animated: true, strokeDasharray: '1 7', strokeLinecap: 'round' };
            }
        case 'long-dash':
            switch (normalizedShape) {
                case 'round':
                    return { animated: true, strokeDasharray: '12 8', strokeLinecap: 'round' };
                case 'square':
                    return { animated: true, strokeDasharray: '14 7', strokeLinecap: 'square' };
                case 'angular':
                    return { animated: true, strokeDasharray: '3 4 12 5', strokeLinecap: 'butt' };
                case 'staggered':
                    return { animated: true, strokeDasharray: '10 3 4 3', strokeLinecap: 'square' };
                case 'none':
                default:
                    return { animated: true, strokeDasharray: '14 7' };
            }
        case 'sparse-dash':
            switch (normalizedShape) {
                case 'round':
                    return { animated: true, strokeDasharray: '4 10', strokeLinecap: 'round' };
                case 'square':
                    return { animated: true, strokeDasharray: '4 9', strokeLinecap: 'square' };
                case 'angular':
                    return { animated: true, strokeDasharray: '2 5 5 11', strokeLinecap: 'butt' };
                case 'staggered':
                    return { animated: true, strokeDasharray: '6 4 2 10', strokeLinecap: 'square' };
                case 'none':
                default:
                    return { animated: true, strokeDasharray: '4 9' };
            }
        case 'dash-dot':
            switch (normalizedShape) {
                case 'round':
                    return { animated: true, strokeDasharray: '10 4 1 5', strokeLinecap: 'round' };
                case 'square':
                    return { animated: true, strokeDasharray: '10 4 2 4', strokeLinecap: 'square' };
                case 'angular':
                    return { animated: true, strokeDasharray: '3 4 9 4 1 4', strokeLinecap: 'butt' };
                case 'staggered':
                    return { animated: true, strokeDasharray: '8 3 3 3 2 4', strokeLinecap: 'square' };
                case 'none':
                default:
                    return { animated: true, strokeDasharray: '10 4 2 4', strokeLinecap: 'round' };
            }
        case 'solid':
        default:
            switch (normalizedShape) {
                case 'round':
                    return { animated: false, strokeLinecap: 'round' };
                case 'square':
                case 'staggered':
                    return { animated: false, strokeLinecap: 'square' };
                case 'angular':
                case 'none':
                default:
                    return { animated: false };
            }
    }
};
