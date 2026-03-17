import {
  createTagStyle,
  getRelationshipEdgeVisuals,
  sanitizeTagStyles,
  SUPPORTED_RELATIONSHIP_PATTERNS,
  SUPPORTED_RELATIONSHIP_SHAPES,
} from '../../src/utils/relationshipStyles'

describe('relationshipStyles', () => {
  it('creates tag styles using only supported patterns', () => {
    const styles = ['RELATED', 'ASSOCIATED_WITH', 'FUNDED_BY', 'SEEN_WITH'].map((tag) => createTagStyle(tag))

    styles.forEach((style) => {
      expect(SUPPORTED_RELATIONSHIP_PATTERNS).toContain(style.pattern)
      expect(SUPPORTED_RELATIONSHIP_SHAPES).toContain(style.shape)
      expect(style.color).toMatch(/^#([0-9a-f]{6})$/i)
    })
  })

  it('maps each pattern to the expected edge visuals', () => {
    expect(getRelationshipEdgeVisuals('solid', 'none')).toEqual({ animated: false })
    expect(getRelationshipEdgeVisuals('dashed', 'none')).toEqual({ animated: true, strokeDasharray: '6 4' })
    expect(getRelationshipEdgeVisuals('dashed', 'square')).toEqual({ animated: true, strokeDasharray: '6 4', strokeLinecap: 'square' })
    expect(getRelationshipEdgeVisuals('dotted', 'round')).toEqual({ animated: true, strokeDasharray: '1 7', strokeLinecap: 'round', strokeWidth: 3 })
    expect(getRelationshipEdgeVisuals('dotted', 'square')).toEqual({ animated: true, strokeDasharray: '1 7', strokeLinecap: 'square', strokeWidth: 3 })
    expect(getRelationshipEdgeVisuals('dashed', 'angular')).toEqual({ animated: true, strokeDasharray: '2 4 8 4', strokeLinecap: 'butt' })
    expect(getRelationshipEdgeVisuals('dash-dot', 'staggered')).toEqual({ animated: true, strokeDasharray: '8 3 3 3 2 4', strokeLinecap: 'square' })
  })

  it('sanitizes legacy and invalid saved styles without migration', () => {
    expect(
      sanitizeTagStyles({
        RELATED: { color: '#ff00ff', pattern: 'dashed' },
        ALIAS: { color: '#00ffaa', pattern: 'dotted' },
        UNKNOWN: { color: '#ffffff', pattern: 'zigzag' },
      }),
    ).toEqual({
      RELATED: { color: '#ff00ff', pattern: 'dashed', shape: 'none' },
      ALIAS: { color: '#00ffaa', pattern: 'dotted', shape: 'none' },
      UNKNOWN: { color: '#ffffff', pattern: 'solid', shape: 'none' },
    })
  })

  it('defaults new tag styles to no extra line shape until the user chooses one', () => {
    const style = createTagStyle('MANUALLY_REVIEWED')

    expect(style.shape).toBe('none')
  })
})
