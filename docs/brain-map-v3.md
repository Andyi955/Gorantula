# Gorantula Brain Map v3

## Goal

Brain Map v3 turns the Brain tab from a list-first surface into a readable memory radar. The current investigation stays at the center, only the strongest few memories are visible by default, and the side rail explains what fired, what changed, and what the selected memory means.

## Scope

- Add a visual memory radar as the primary Brain surface.
- Keep Active Signals and Linked Memory available as scan lists below the map.
- Show the current investigation, top linked memories, and top active signals as map nodes.
- Keep the map bounded to the strongest memories so it does not become a giant unreadable graph.
- Add a "What Changed" rail based on fresh auto memories, recent firings, and reinforced links.
- Make map nodes selectable and reuse the existing linked-memory detail model for durable links.

## Non-Goals

- No autonomous agents in v3.
- No force-directed all-history graph.
- No backend cluster persistence yet.
- No sub-memory expansion yet, but the map structure should leave room for that later.

## Implementation Notes

- Derive the v3 map from existing `BrainSignal` and `MemoryLink` payloads.
- Prefer deterministic layout slots over physics so tests and screenshots stay stable.
- Keep the current filters active across map, signal cards, and linked memories.
- Use the existing Brain API and persistence behavior from v2.
- Treat the visual map as a working tool view, not a marketing hero.
