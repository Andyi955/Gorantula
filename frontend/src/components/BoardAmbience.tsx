import { useEffect, useRef } from 'react';
import { useViewport } from 'reactflow';
import { BOARD_GRID_SIZE } from './boardGeometry';

export type BoardAmbienceMode = 'off' | 'signals' | 'horizon';

const PULSE_COUNT = 12;
const MAX_BURSTS = 14;
const CROSS_DISTANCE = 26;
const CROSS_COOLDOWN_S = 1.2;
const BURST_TTL_S = 2.4;
const SIGNAL_PALETTE = ['#59e4ff', '#90f3da', '#8ee8ff', '#59e4ff', '#bc13fe'];
const BURST_PALETTE = ['#ffd166', '#ff8ce8', '#ecfdff', '#a3ff9e'];

interface SignalPulse {
    orientation: 'h' | 'v';
    lane: number;
    pos: number;
    speed: number;
    color: string;
    size: number;
    lastBurstAt: number;
}

interface SignalBurst {
    orientation: 'h' | 'v';
    lane: number;
    pos: number;
    speed: number;
    color: string;
    size: number;
    age: number;
    ttl: number;
}

const createPulses = (): SignalPulse[] =>
    Array.from({ length: PULSE_COUNT }, (_, index) => ({
        orientation: index % 3 === 2 ? 'v' : 'h',
        lane: -24 + ((index * 7) % 48),
        pos: ((index * 977) % 4000) - 2000,
        speed: (index % 2 === 0 ? 1 : -1) * (52 + ((index * 37) % 88)),
        color: SIGNAL_PALETTE[index % SIGNAL_PALETTE.length],
        size: 1.6 + (index % 3) * 0.5,
        lastBurstAt: -Infinity,
    }));

const hexToRgba = (hex: string, alpha: number) => {
    const value = Number.parseInt(hex.slice(1), 16);
    const r = (value >> 16) & 0xff;
    const g = (value >> 8) & 0xff;
    const b = value & 0xff;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const prefersReducedMotion = () =>
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const wrapIntoRange = (pos: number, lo: number, hi: number) => {
    const span = Math.max(1, hi - lo);
    const raw = (pos - lo) % span;
    return lo + (raw < 0 ? raw + span : raw);
};

/* Pulses wrap within a padded window around the *current view*, so the teleport
   always happens off-screen and never reads as a flicker. */
const pulseWindowRange = (lo: number, hi: number) => {
    const margin = Math.max(320, (hi - lo) * 0.25);
    return { lo: lo - margin, hi: hi + margin };
};

const recyclePulse = (
    pulse: SignalPulse,
    flowX: number,
    flowY: number,
    flowWidth: number,
    flowHeight: number,
) => {
    if (pulse.orientation === 'h') {
        const minLane = Math.floor(flowY / BOARD_GRID_SIZE) - 6;
        const maxLane = Math.ceil((flowY + flowHeight) / BOARD_GRID_SIZE) + 6;
        pulse.lane = minLane + Math.floor(Math.random() * Math.max(1, maxLane - minLane));
        pulse.pos = pulse.speed >= 0 ? flowX - 140 : flowX + flowWidth + 140;
    } else {
        const minLane = Math.floor(flowX / BOARD_GRID_SIZE) - 6;
        const maxLane = Math.ceil((flowX + flowWidth) / BOARD_GRID_SIZE) + 6;
        pulse.lane = minLane + Math.floor(Math.random() * Math.max(1, maxLane - minLane));
        pulse.pos = pulse.speed >= 0 ? flowY - 140 : flowY + flowHeight + 140;
    }
};

const drawComet = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    color: string,
    size: number,
    zoom: number,
    alphaScale = 1,
) => {
    const trail = 64 * zoom;
    const tailX = x + dirX * trail;
    const tailY = y + dirY * trail;

    const trailGradient = ctx.createLinearGradient(x, y, tailX, tailY);
    trailGradient.addColorStop(0, hexToRgba(color, 0.6 * alphaScale));
    trailGradient.addColorStop(1, hexToRgba(color, 0));
    ctx.strokeStyle = trailGradient;
    ctx.lineWidth = Math.max(1, size * zoom * 0.6);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();

    const headRadius = Math.max(1.4, size * zoom);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, headRadius * 3.2);
    glow.addColorStop(0, hexToRgba(color, 0.9 * alphaScale));
    glow.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, headRadius * 3.2, 0, Math.PI * 2);
    ctx.fill();
};

const BoardAmbience = ({ mode }: { mode: BoardAmbienceMode }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const viewport = useViewport();
    const viewportRef = useRef(viewport);
    const pulsesRef = useRef<SignalPulse[] | null>(null);
    const burstsRef = useRef<SignalBurst[]>([]);
    const burstColorIndexRef = useRef(0);

    useEffect(() => {
        viewportRef.current = viewport;
    }, [viewport]);

    useEffect(() => {
        if (mode === 'off' || prefersReducedMotion()) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas || !canvas.parentElement) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }
        if (!pulsesRef.current) {
            pulsesRef.current = createPulses();
        }

        let animationFrame = 0;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const parent = canvas.parentElement;

        const resize = () => {
            const rect = parent.getBoundingClientRect();
            canvas.width = Math.max(1, Math.floor(rect.width * dpr));
            canvas.height = Math.max(1, Math.floor(rect.height * dpr));
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        resize();

        const observer = new ResizeObserver(resize);
        observer.observe(parent);

        let lastFrameAt = performance.now();
        const draw = (now: number) => {
            const dt = Math.min(0.1, Math.max(0, (now - lastFrameAt) / 1000));
            lastFrameAt = now;
            const elapsed = now / 1000;
            const { x: viewportX, y: viewportY, zoom } = viewportRef.current;
            const width = canvas.width / dpr;
            const height = canvas.height / dpr;
            ctx.clearRect(0, 0, width, height);

            const toScreenX = (flowX: number) => flowX * zoom + viewportX;
            const toScreenY = (flowY: number) => flowY * zoom + viewportY;

            if (mode === 'signals') {
                const pulses = pulsesRef.current || [];
                const flowX = -viewportX / zoom;
                const flowY = -viewportY / zoom;
                const flowWidth = width / zoom;
                const flowHeight = height / zoom;
                const xWindow = pulseWindowRange(flowX, flowX + flowWidth);
                const yWindow = pulseWindowRange(flowY, flowY + flowHeight);

                for (const pulse of pulses) {
                    const wobble = 1 + Math.sin(elapsed * 0.9 + pulse.lane * 1.7) * 0.22;
                    const window = pulse.orientation === 'h' ? xWindow : yWindow;
                    pulse.pos = wrapIntoRange(pulse.pos + pulse.speed * wobble * dt, window.lo, window.hi);
                }

                // Crossing detection: horizontal-lane pulses vs vertical-lane pulses.
                const bursts = burstsRef.current;
                for (const a of pulses) {
                    if (a.orientation !== 'h' || elapsed - a.lastBurstAt < CROSS_COOLDOWN_S) continue;
                    const laneY = a.lane * BOARD_GRID_SIZE;
                    for (const b of pulses) {
                        if (b.orientation !== 'v' || elapsed - b.lastBurstAt < CROSS_COOLDOWN_S) continue;
                        const laneX = b.lane * BOARD_GRID_SIZE;
                        if (Math.abs(a.pos - laneX) > CROSS_DISTANCE || Math.abs(b.pos - laneY) > CROSS_DISTANCE) {
                            continue;
                        }
                        if (bursts.length >= MAX_BURSTS) {
                            break;
                        }

                        const parent = Math.abs(a.speed) >= Math.abs(b.speed) ? a : b;
                        const color = BURST_PALETTE[burstColorIndexRef.current % BURST_PALETTE.length];
                        burstColorIndexRef.current += 1;
                        bursts.push({
                            orientation: parent.orientation,
                            lane: parent.lane,
                            pos: parent.orientation === 'h' ? laneX : laneY,
                            speed: parent.speed * 1.7,
                            color,
                            size: 2.2,
                            age: 0,
                            ttl: BURST_TTL_S,
                        });
                        // The two touching signals are consumed and respawn off-screen on fresh lanes.
                        a.lastBurstAt = elapsed;
                        b.lastBurstAt = elapsed;
                        recyclePulse(a, flowX, flowY, flowWidth, flowHeight);
                        recyclePulse(b, flowX, flowY, flowWidth, flowHeight);
                        break;
                    }
                }

                for (const burst of bursts) {
                    burst.age += dt;
                    burst.pos += burst.speed * dt;
                }
                burstsRef.current = bursts.filter((burst) => burst.age < burst.ttl);

                for (const pulse of pulses) {
                    const lively = 0.78 + Math.sin(elapsed * 2.6 + pulse.lane * 1.31) * 0.22;
                    if (pulse.orientation === 'h') {
                        const y = toScreenY(pulse.lane * BOARD_GRID_SIZE);
                        if (y < -24 || y > height + 24) continue;
                        const x = toScreenX(pulse.pos);
                        if (x < -80 || x > width + 80) continue;
                        drawComet(ctx, x, y, pulse.speed >= 0 ? -1 : 1, 0, pulse.color, pulse.size, zoom, lively);
                    } else {
                        const x = toScreenX(pulse.lane * BOARD_GRID_SIZE);
                        if (x < -24 || x > width + 24) continue;
                        const y = toScreenY(pulse.pos);
                        if (y < -80 || y > height + 80) continue;
                        drawComet(ctx, x, y, 0, pulse.speed >= 0 ? -1 : 1, pulse.color, pulse.size, zoom, lively);
                    }
                }

                for (const burst of burstsRef.current) {
                    const fade = 1 - burst.age / burst.ttl;
                    if (burst.orientation === 'h') {
                        const y = toScreenY(burst.lane * BOARD_GRID_SIZE);
                        if (y < -24 || y > height + 24) continue;
                        const x = toScreenX(burst.pos);
                        if (x < -80 || x > width + 80) continue;
                        drawComet(ctx, x, y, burst.speed >= 0 ? -1 : 1, 0, burst.color, burst.size, zoom, fade);
                    } else {
                        const x = toScreenX(burst.lane * BOARD_GRID_SIZE);
                        if (x < -24 || x > width + 24) continue;
                        const y = toScreenY(burst.pos);
                        if (y < -80 || y > height + 80) continue;
                        drawComet(ctx, x, y, 0, burst.speed >= 0 ? -1 : 1, burst.color, burst.size, zoom, fade);
                    }
                }
            } else {
                // Horizon: sweep centered on the current view so it is always visible.
                const flowCenterX = (width / 2 - viewportX) / zoom;
                const flowCenterY = (height / 2 - viewportY) / zoom;
                const sweepRadius = Math.max(width, height) * 1.15;

                ctx.save();
                ctx.translate(toScreenX(flowCenterX), toScreenY(flowCenterY));
                ctx.rotate(elapsed * 0.28);
                const wedgeGradient = ctx.createLinearGradient(0, 0, sweepRadius, 0);
                wedgeGradient.addColorStop(0, 'rgba(142, 232, 255, 0.13)');
                wedgeGradient.addColorStop(0.6, 'rgba(142, 232, 255, 0.045)');
                wedgeGradient.addColorStop(1, 'rgba(142, 232, 255, 0)');
                ctx.fillStyle = wedgeGradient;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.arc(0, 0, sweepRadius, -0.22, 0.22);
                ctx.closePath();
                ctx.fill();

                const beamGradient = ctx.createLinearGradient(0, 0, sweepRadius * 0.85, 0);
                beamGradient.addColorStop(0, 'rgba(172, 240, 255, 0.5)');
                beamGradient.addColorStop(1, 'rgba(172, 240, 255, 0)');
                ctx.strokeStyle = beamGradient;
                ctx.lineWidth = 1.6;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(sweepRadius * 0.85, 0);
                ctx.stroke();
                ctx.restore();

                const cycle = (elapsed % 6) / 6;
                const ringRadius = cycle * 640 * zoom;
                ctx.beginPath();
                ctx.arc(toScreenX(flowCenterX), toScreenY(flowCenterY), ringRadius, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(142, 232, 255, ${(0.18 * (1 - cycle)).toFixed(3)})`;
                ctx.lineWidth = 1.4;
                ctx.stroke();
            }

            animationFrame = requestAnimationFrame(draw);
        };

        animationFrame = requestAnimationFrame(draw);

        return () => {
            cancelAnimationFrame(animationFrame);
            observer.disconnect();
        };
    }, [mode]);

    if (mode === 'off') {
        return null;
    }

    return <canvas ref={canvasRef} data-testid="board-ambience" className="forensic-board-ambience" aria-hidden="true" />;
};

export default BoardAmbience;
