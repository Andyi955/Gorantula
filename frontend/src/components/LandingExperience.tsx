import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { animate, motion, useReducedMotion, type Variants } from 'framer-motion'
import {
  ArrowRight,
  Brain,
  Clock,
  Database,
  MessageSquare,
  Network,
  Terminal,
  type LucideIcon,
} from 'lucide-react'

export type LandingTargetTab = 'spider' | 'board' | 'timeline' | 'brain' | 'chat'

export interface LandingExperienceStats {
  investigations: number
  evidence: number
  relationships: number
}

interface LandingExperienceProps {
  onEnter: (tab?: LandingTargetTab) => void
  stats?: LandingExperienceStats
}

interface WebParticle {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  hub: boolean
  phase: number
}

interface LandingFeatureCard {
  id: string
  tab: LandingTargetTab
  icon: LucideIcon
  title: string
  blurb: string
  accent: string
}

const CONNECTION_DISTANCE = 150
const POINTER_GRAVITY_RADIUS = 240

const FEATURE_CARDS: LandingFeatureCard[] = [
  {
    id: 'spider',
    tab: 'spider',
    icon: Terminal,
    title: 'Spider View',
    blurb: 'Launch crawls and guided rabbit-hole descents across the open web.',
    accent: '#bc13fe',
  },
  {
    id: 'board',
    tab: 'board',
    icon: Database,
    title: 'Detective Board',
    blurb: 'Pin evidence to an infinite canvas and wire the connections yourself.',
    accent: '#8ee8ff',
  },
  {
    id: 'timeline',
    tab: 'timeline',
    icon: Clock,
    title: 'Timeline',
    blurb: 'Reconstruct events in order and spot the gaps in the story.',
    accent: '#90f3da',
  },
  {
    id: 'brain',
    tab: 'brain',
    icon: Brain,
    title: 'Brain Signals',
    blurb: 'Let the brain surface cross-case patterns you missed.',
    accent: '#f6c879',
  },
  {
    id: 'chat',
    tab: 'chat',
    icon: MessageSquare,
    title: 'Vault Chat',
    blurb: 'Interrogate everything the vault knows, in plain language.',
    accent: '#ff8c86',
  },
]

const MARQUEE_KEYWORDS = [
  'OSINT CRAWLING',
  'EVIDENCE GRAPH',
  'RABBIT-HOLE DESCENT',
  'TIMELINE RECONSTRUCTION',
  'PERSONA ANALYSIS',
  'CROSS-CASE SYNTHESIS',
  'VAULT INTERROGATION',
  'DISCOVERY ALERTS',
]

const TITLE_LETTERS = 'GORANTULA'.split('')

const WebCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    let animationFrame = 0
    let particles: WebParticle[] = []
    let width = 0
    let height = 0
    // The web is a faint decorative backdrop, so a capped backing scale keeps the
    // per-frame clear + redraw cheap on high-DPI displays without a visible cost.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const pointer = { x: 0, y: 0, active: false }

    // Precompute a small set of connection stroke styles and batch every in-range
    // edge into one of a few stroked paths per frame. Avoiding one rgba() string
    // plus one beginPath()/stroke() per edge (thousands per frame) is what turns
    // this background from a main-thread hog into a cheap overlay.
    const edgeAlphaBuckets = 8
    const connectionStyles: string[] = []
    const maxEdgeAlpha = 0.34
    const minEdgeAlpha = 0.1
    for (let bucket = 0; bucket < edgeAlphaBuckets; bucket += 1) {
      const t = bucket / (edgeAlphaBuckets - 1)
      const alpha = maxEdgeAlpha - t * (maxEdgeAlpha - minEdgeAlpha)
      connectionStyles.push(`rgba(129, 227, 255, ${alpha.toFixed(3)})`)
    }
    const edgeBuckets: number[][] = Array.from({ length: edgeAlphaBuckets }, () => [])

    const seedParticles = () => {
      const target = Math.max(30, Math.min(70, Math.floor((width * height) / 22000)))
      particles = Array.from({ length: target }, (_, index) => ({
        x: Math.random() * Math.max(width, 1),
        y: Math.random() * Math.max(height, 1),
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        radius: index % 12 === 0 ? 2.4 : 1.15,
        hub: index % 12 === 0,
        phase: Math.random() * Math.PI * 2,
      }))
    }

    const resize = () => {
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      seedParticles()
    }

    const renderFrame = (time: number) => {
      context.clearRect(0, 0, width, height)

      for (const particle of particles) {
        particle.x += particle.vx
        particle.y += particle.vy

        if (pointer.active) {
          const dx = pointer.x - particle.x
          const dy = pointer.y - particle.y
          const distSq = dx * dx + dy * dy
          if (distSq > 0.01 && distSq < POINTER_GRAVITY_RADIUS * POINTER_GRAVITY_RADIUS) {
            const dist = Math.sqrt(distSq)
            const pull = (1 - dist / POINTER_GRAVITY_RADIUS) * 0.55
            particle.x += (dx / dist) * pull
            particle.y += (dy / dist) * pull
          }
        }

        if (particle.x < -20) particle.x = width + 20
        if (particle.x > width + 20) particle.x = -20
        if (particle.y < -20) particle.y = height + 20
        if (particle.y > height + 20) particle.y = -20
      }

      for (let bucket = 0; bucket < edgeBuckets.length; bucket += 1) {
        edgeBuckets[bucket].length = 0
      }
      for (let i = 0; i < particles.length; i += 1) {
        const a = particles[i]
        for (let j = i + 1; j < particles.length; j += 1) {
          const b = particles[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const distSq = dx * dx + dy * dy
          if (distSq > CONNECTION_DISTANCE * CONNECTION_DISTANCE) {
            continue
          }
          const alpha = (1 - Math.sqrt(distSq) / CONNECTION_DISTANCE) * (a.hub || b.hub ? 0.34 : 0.2)
          const clampedAlpha = alpha < minEdgeAlpha ? minEdgeAlpha : alpha > maxEdgeAlpha ? maxEdgeAlpha : alpha
          const bucketIndex = Math.round(
            ((maxEdgeAlpha - clampedAlpha) / (maxEdgeAlpha - minEdgeAlpha)) * (edgeAlphaBuckets - 1),
          )
          edgeBuckets[bucketIndex].push(a.x, a.y, b.x, b.y)
        }
      }

      for (let bucket = 0; bucket < edgeBuckets.length; bucket += 1) {
        const edgePath = edgeBuckets[bucket]
        if (edgePath.length === 0) {
          continue
        }
        context.strokeStyle = connectionStyles[bucket]
        context.lineWidth = 1
        context.beginPath()
        for (let edgeIndex = 0; edgeIndex < edgePath.length; edgeIndex += 4) {
          context.moveTo(edgePath[edgeIndex], edgePath[edgeIndex + 1])
          context.lineTo(edgePath[edgeIndex + 2], edgePath[edgeIndex + 3])
        }
        context.stroke()
      }

      for (const particle of particles) {
        const pulse = particle.hub ? Math.sin(time / 600 + particle.phase) * 0.9 : 0
        const radius = Math.max(0.6, particle.radius + pulse)
        context.beginPath()
        context.arc(particle.x, particle.y, radius, 0, Math.PI * 2)
        context.fillStyle = particle.hub ? 'rgba(144, 243, 218, 0.85)' : 'rgba(142, 232, 255, 0.55)'
        context.fill()

        if (particle.hub) {
          context.beginPath()
          context.arc(particle.x, particle.y, radius + 5 + pulse * 2, 0, Math.PI * 2)
          context.strokeStyle = 'rgba(144, 243, 218, 0.16)'
          context.lineWidth = 1
          context.stroke()
        }
      }
    }

    const tick = (time: number) => {
      renderFrame(time)
      animationFrame = window.requestAnimationFrame(tick)
    }

    const handlePointerMove = (event: PointerEvent) => {
      pointer.x = event.clientX
      pointer.y = event.clientY
      pointer.active = true
    }

    const handlePointerLeave = () => {
      pointer.active = false
    }

    resize()
    window.addEventListener('resize', resize)

    if (reduceMotion) {
      renderFrame(0)
    } else {
      window.addEventListener('pointermove', handlePointerMove)
      document.documentElement.addEventListener('pointerleave', handlePointerLeave)
      animationFrame = window.requestAnimationFrame(tick)
    }

    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', handlePointerMove)
      document.documentElement.removeEventListener('pointerleave', handlePointerLeave)
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
      }
    }
  }, [reduceMotion])

  return <canvas ref={canvasRef} className="landing-web-canvas" aria-hidden="true" />
}

const CountUp = ({ value }: { value: number }) => {
  const reduceMotion = useReducedMotion()
  const [display, setDisplay] = useState(reduceMotion ? value : 0)

  useEffect(() => {
    if (reduceMotion) {
      setDisplay(value)
      return
    }
    const controls = animate(0, value, {
      duration: 1.6,
      ease: [0.16, 0.84, 0.28, 1],
      onUpdate: (latest) => setDisplay(Math.round(latest)),
    })
    return () => controls.stop()
  }, [value, reduceMotion])

  return <>{display.toLocaleString('en-US')}</>
}

const LandingExperience = ({ onEnter, stats }: LandingExperienceProps) => {
  const reduceMotion = useReducedMotion()

  const sectionVariants: Variants = useMemo(() => ({
    hidden: {},
    visible: {
      transition: { staggerChildren: reduceMotion ? 0.02 : 0.12, delayChildren: reduceMotion ? 0 : 0.15 },
    },
  }), [reduceMotion])

  const itemVariants: Variants = useMemo(() => ({
    hidden: reduceMotion ? { opacity: 0 } : { opacity: 0, y: 30 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: reduceMotion ? 0.2 : 0.7, ease: [0.16, 0.84, 0.28, 1] },
    },
  }), [reduceMotion])

  const titleVariants: Variants = useMemo(() => ({
    hidden: {},
    visible: { transition: { staggerChildren: reduceMotion ? 0.01 : 0.055, delayChildren: reduceMotion ? 0 : 0.35 } },
  }), [reduceMotion])

  const letterVariants: Variants = useMemo(() => ({
    hidden: reduceMotion ? { opacity: 0 } : { opacity: 0, y: 52, rotateX: -75 },
    visible: {
      opacity: 1,
      y: 0,
      rotateX: 0,
      transition: reduceMotion
        ? { duration: 0.2 }
        : { type: 'spring', stiffness: 210, damping: 22 },
    },
  }), [reduceMotion])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        onEnter()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onEnter])

  const showStats = Boolean(stats && stats.investigations > 0)

  return (
    <motion.div
      data-testid="landing-experience"
      className="landing-shell"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduceMotion
        ? { opacity: 0, transition: { duration: 0.15 } }
        : { opacity: 0, scale: 1.05, transition: { duration: 0.45, ease: [0.4, 0, 0.2, 1] } }}
      transition={{ duration: 0.5 }}
    >
      <WebCanvas />
      <div className="landing-vignette" aria-hidden="true" />
      <div className="landing-scanline" aria-hidden="true" />

      <div className="landing-content">
        <motion.header
          className="landing-topbar"
          variants={sectionVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.div className="landing-brandmark" variants={itemVariants}>
            <Network size={16} aria-hidden="true" />
            <span>GORANTULA // FORENSIC ENGINE</span>
          </motion.div>
          <motion.div className="landing-status" variants={itemVariants} role="status">
            <span className="landing-status-dot" aria-hidden="true" />
            SYSTEMS NOMINAL
          </motion.div>
        </motion.header>

        <motion.main
          className="landing-hero"
          variants={sectionVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.p className="landing-eyebrow" variants={itemVariants}>
            WEB-SCALE EVIDENCE INTELLIGENCE
          </motion.p>

          <motion.h1
            className="landing-title"
            aria-label="Gorantula"
            variants={titleVariants}
          >
            {TITLE_LETTERS.map((letter, index) => (
              <motion.span key={`${letter}-${index}`} variants={letterVariants} aria-hidden="true">
                {letter}
              </motion.span>
            ))}
          </motion.h1>

          <motion.p className="landing-tagline" variants={itemVariants}>
            Spin the crawl. Pin the evidence. Watch the web connect itself.
          </motion.p>

          <motion.div className="landing-cta-row" variants={itemVariants}>
            <motion.button
              type="button"
              data-testid="landing-enter-button"
              className="landing-cta-primary"
              onClick={() => onEnter()}
              whileHover={reduceMotion ? undefined : { scale: 1.045, y: -2 }}
              whileTap={reduceMotion ? undefined : { scale: 0.96 }}
            >
              <span>ENTER THE VAULT</span>
              <ArrowRight size={16} aria-hidden="true" />
            </motion.button>
            <span className="landing-cta-hint">or press Enter</span>
          </motion.div>

          {showStats && stats && (
            <motion.dl className="landing-stats" variants={itemVariants} data-testid="landing-stats">
              <div className="landing-stat">
                <dt>Active cases</dt>
                <dd><CountUp value={stats.investigations} /></dd>
              </div>
              <div className="landing-stat">
                <dt>Evidence items</dt>
                <dd><CountUp value={stats.evidence} /></dd>
              </div>
              <div className="landing-stat">
                <dt>Relationships</dt>
                <dd><CountUp value={stats.relationships} /></dd>
              </div>
            </motion.dl>
          )}

          <motion.div className="landing-card-grid" variants={sectionVariants}>
            {FEATURE_CARDS.map((card) => {
              const Icon = card.icon
              return (
                <motion.button
                  key={card.id}
                  type="button"
                  data-testid={`landing-card-${card.id}`}
                  className="landing-card"
                  variants={itemVariants}
                  whileHover={reduceMotion ? undefined : { y: -6, scale: 1.02 }}
                  whileTap={reduceMotion ? undefined : { scale: 0.97 }}
                  onClick={() => onEnter(card.tab)}
                  style={{ '--landing-card-accent': card.accent } as CSSProperties}
                >
                  <span className="landing-card-icon">
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <span className="landing-card-title">{card.title}</span>
                  <span className="landing-card-blurb">{card.blurb}</span>
                  <span className="landing-card-open">
                    OPEN
                    <ArrowRight size={12} aria-hidden="true" />
                  </span>
                </motion.button>
              )
            })}
          </motion.div>
        </motion.main>

        <footer className="landing-marquee" aria-hidden="true">
          <div className="landing-marquee-track">
            {[0, 1].map((copy) => (
              <span key={copy} className="landing-marquee-copy">
                {MARQUEE_KEYWORDS.map((keyword) => (
                  <span key={keyword} className="landing-marquee-keyword">
                    {keyword}
                    <span className="landing-marquee-divider">✦</span>
                  </span>
                ))}
              </span>
            ))}
          </div>
        </footer>
      </div>
    </motion.div>
  )
}

export default LandingExperience
