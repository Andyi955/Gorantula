import {
  createTagStyle,
  getRelationshipEdgeVisuals,
  sanitizeTagStyles,
  SUPPORTED_RELATIONSHIP_PATTERNS,
} from '../../src/utils/relationshipStyles'

describe('relationshipStyles', () => {
  it('creates tag styles using only supported patterns', () => {
    const styles = ['RELATED', 'ASSOCIATED_WITH', 'FUNDED_BY', 'SEEN_WITH'].map((tag) => createTagStyle(tag))

    styles.forEach((style) => {
      expect(SUPPORTED_RELATIONSHIP_PATTERNS).toContain(style.pattern)
      expect(style.color).toMatch(/^#([0-9a-f]{6})$/i)
    })
  })

  it('maps each pattern to the expected edge visuals', () => {
    expect(getRelationshipEdgeVisuals('solid')).toEqual({ animated: false })
    expect(getRelationshipEdgeVisuals('dashed')).toEqual({ animated: true, strokeDasharray: '6 4' })
    expect(getRelationshipEdgeVisuals('dotted')).toEqual({ animated: true, strokeDasharray: '1 7', strokeLinecap: 'round' })
    expect(getRelationshipEdgeVisuals('long-dash')).toEqual({ animated: true, strokeDasharray: '14 7' })
    expect(getRelationshipEdgeVisuals('sparse-dash')).toEqual({ animated: true, strokeDasharray: '4 9' })
    expect(getRelationshipEdgeVisuals('dash-dot')).toEqual({ animated: true, strokeDasharray: '10 4 2 4', strokeLinecap: 'round' })
  })

  it('sanitizes legacy and invalid saved styles without migration', () => {
    expect(
      sanitizeTagStyles({
        RELATED: { color: '#ff00ff', pattern: 'dashed' },
        ALIAS: { color: '#00ffaa', pattern: 'dotted' },
        UNKNOWN: { color: '#ffffff', pattern: 'zigzag' },
      }),
    ).toEqual({
      RELATED: { color: '#ff00ff', pattern: 'dashed' },
      ALIAS: { color: '#00ffaa', pattern: 'dotted' },
      UNKNOWN: { color: '#ffffff', pattern: 'solid' },
    })
  })
})
