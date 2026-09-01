// Brain radar emblem: one refined shared mark for every place the old PNG was
// pasted (panel loading overlay, signal-card rails). Drawn as an inline SVG so
// it stays crisp at any size and the sweep can animate without image swaps.

interface BrainRadarEmblemProps {
  size?: number
  animated?: boolean
  /** Slow ambient sweep (rails, cards) instead of the quick loading spin. */
  ambient?: boolean
  className?: string
}

const EMBLEM_TICKS = Array.from({ length: 12 }, (_, index) => {
  const radians = (index * 30 * Math.PI) / 180
  return {
    id: index,
    x1: 48 + Math.cos(radians) * 41,
    y1: 48 + Math.sin(radians) * 41,
    x2: 48 + Math.cos(radians) * 44.5,
    y2: 48 + Math.sin(radians) * 44.5,
  }
})

const EMBLEM_CONTACTS = [
  { id: 'a', angle: 24, radius: 30, tone: 'hot' },
  { id: 'b', angle: 152, radius: 19, tone: 'warm' },
  { id: 'c', angle: 262, radius: 30, tone: 'cool' },
]

export default function BrainRadarEmblem({ size = 76, animated = false, ambient = false, className = '' }: BrainRadarEmblemProps) {
  const classes = [
    'brain-radar-emblem',
    animated ? 'brain-radar-emblem-animated' : '',
    ambient ? 'brain-radar-emblem-ambient' : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      aria-hidden="true"
      focusable="false"
      className={classes}
    >
      <defs>
        <linearGradient id="brain-radar-emblem-sweep" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8ee8ff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#8ee8ff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="brain-radar-emblem-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#d9f7ff" />
          <stop offset="55%" stopColor="#8ee8ff" />
          <stop offset="100%" stopColor="#8ee8ff" stopOpacity="0.25" />
        </radialGradient>
      </defs>

      <circle className="brain-radar-emblem-bezel" cx="48" cy="48" r="45.5" />
      <circle className="brain-radar-emblem-ring" cx="48" cy="48" r="31" strokeDasharray="3 4" />
      <circle className="brain-radar-emblem-ring" cx="48" cy="48" r="19" />
      {EMBLEM_TICKS.map((tick) => (
        <line
          key={`emblem-tick-${tick.id}`}
          className="brain-radar-emblem-tick"
          x1={tick.x1.toFixed(2)}
          y1={tick.y1.toFixed(2)}
          x2={tick.x2.toFixed(2)}
          y2={tick.y2.toFixed(2)}
        />
      ))}
      <g className="brain-radar-emblem-sweep-g">
        <path
          className="brain-radar-emblem-sweep"
          d="M48 48 L48 5.5 A42.5 42.5 0 0 1 73.6 15.9 Z"
          fill="url(#brain-radar-emblem-sweep)"
        />
      </g>
      {EMBLEM_CONTACTS.map((contact) => {
        const radians = (contact.angle * Math.PI) / 180
        return (
          <circle
            key={`emblem-contact-${contact.id}`}
            className={`brain-radar-emblem-contact is-${contact.tone}`}
            cx={(48 + Math.cos(radians) * contact.radius).toFixed(2)}
            cy={(48 + Math.sin(radians) * contact.radius).toFixed(2)}
            r="2.1"
          />
        )
      })}
      <circle className="brain-radar-emblem-glow" cx="48" cy="48" r="9" />
      <circle className="brain-radar-emblem-core" cx="48" cy="48" r="4.4" fill="url(#brain-radar-emblem-core)" />
    </svg>
  )
}
