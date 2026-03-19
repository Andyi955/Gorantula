import type { Edge, Node } from 'reactflow'
import { detectiveBoardLayoutTestUtils } from '../../src/components/detectiveBoardLayout'
import { detectiveBoardTestUtils } from '../../src/components/DetectiveBoard'

const createNode = (id: string): Node => ({
  id,
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    summary: `${id} summary`,
    fullText: '',
    onReadFull: () => {},
  },
  style: {
    width: 320,
    height: 180,
  },
})

const createEdge = (source: string, target: string): Edge => ({
  id: `${source}-${target}`,
  source,
  target,
})

describe('detective board layout', () => {
  it('places disconnected nodes above the connected graph', () => {
    const nodes = [createNode('a'), createNode('b'), createNode('c')]
    const edges = [createEdge('a', 'b')]

    const { nodes: layoutedNodes } = detectiveBoardLayoutTestUtils.getLayoutedElements(nodes, edges)
    const disconnectedNode = layoutedNodes.find((node) => node.id === 'c')
    const connectedNodes = layoutedNodes.filter((node) => node.id !== 'c')

    expect(disconnectedNode).toBeDefined()
    expect(disconnectedNode!.position.y + Number(disconnectedNode!.style?.height ?? 0)).toBeLessThan(
      Math.min(...connectedNodes.map((node) => node.position.y)),
    )
  })

  it('arranges fully disconnected boards into a single top lane without overlap', () => {
    const nodes = [createNode('a'), createNode('b'), createNode('c')]

    const { nodes: layoutedNodes } = detectiveBoardLayoutTestUtils.getLayoutedElements(nodes, [])

    expect(new Set(layoutedNodes.map((node) => node.position.y)).size).toBe(1)

    for (let index = 1; index < layoutedNodes.length; index += 1) {
      const previous = layoutedNodes[index - 1]
      const current = layoutedNodes[index]
      const previousRight = previous.position.x + Number(previous.style?.width ?? 0)

      expect(current.position.x).toBeGreaterThan(previousRight)
    }
  })

  it('keeps fully connected layouts in the main graph without creating a separate orphan lane', () => {
    const nodes = [createNode('a'), createNode('b'), createNode('c')]
    const edges = [createEdge('a', 'b'), createEdge('b', 'c')]

    const { nodes: layoutedNodes } = detectiveBoardLayoutTestUtils.getLayoutedElements(nodes, edges)

    expect(new Set(layoutedNodes.map((node) => node.position.y)).size).toBe(1)
  })

  it('places disconnected nodes into the first strict-grid rows before connected nodes', () => {
    const nodes = [createNode('a'), createNode('b'), createNode('c'), createNode('d')]
    const edges = [createEdge('a', 'b'), createEdge('b', 'c')]

    const layoutedNodes = detectiveBoardTestUtils.getStrictGridLayoutedNodes(nodes, edges)
    const disconnectedNode = layoutedNodes.find((node) => node.id === 'd')
    const connectedNodes = layoutedNodes.filter((node) => node.id !== 'd')

    expect(disconnectedNode).toBeDefined()
    expect(disconnectedNode!.position.y).toBeLessThan(Math.min(...connectedNodes.map((node) => node.position.y)))
  })

  it('produces stable results for repeated layout runs with the same input', () => {
    const nodes = [createNode('a'), createNode('b'), createNode('c')]
    const edges = [createEdge('a', 'b')]

    const first = detectiveBoardLayoutTestUtils.getLayoutedElements(nodes, edges)
    const second = detectiveBoardLayoutTestUtils.getLayoutedElements(nodes, edges)

    expect(second).toEqual(first)
  })
})
