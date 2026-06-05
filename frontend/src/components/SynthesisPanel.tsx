import { Children, isValidElement, useCallback, useState, useEffect, useMemo, useRef, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { Network, ChevronRight, Hash, Clock, Database, ChevronLeft, ArrowRightToLine, ArrowLeft, CheckCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { type PersistedSynthesisAlert } from '../utils/hierarchicalCanvas';
import { BOARD_TOGGLE_SYNTHESIS_PANEL_EVENT } from '../utils/boardWorkspaceEvents';
import {
    getCachedBoardStateForInvestigation,
    loadBoardStateForInvestigation,
    saveBoardStateForInvestigation,
} from '../utils/investigationPersistence';
import {
    BROWSER_QA_SYNTHESIS_DEMO_EVENT,
    createBrowserQaSynthesisDemoAlerts,
    type BrowserQaSynthesisDemoDetail,
} from '../utils/browserQaSeed';

interface NodeContextPayload {
    vaultId: string;
    nodeId: string;
    summary: string;
}

export interface MergeCandidateNode {
    vaultId: string;
    nodeId: string;
}

interface SynthesisAlert {
    type: string;
    alertKey?: string;
    entity: string;
    currentVaultId: string;
    connectedCases: string[];
    nodes: NodeContextPayload[];
    analysis: string;
    timestamp: string;
    score?: number;
}

type AlertBuckets = Record<string, SynthesisAlert[]>;
const EMPTY_ALERTS: SynthesisAlert[] = [];

const LEGACY_ALERTS_KEY = 'gorantula_synthesis_alerts';
const ALERT_BUCKETS_KEY = 'gorantula_synthesis_alerts_by_investigation';
const MAX_ALERTS_PER_INVESTIGATION = 20;
const MAX_TOTAL_ALERTS = 80;
const MAX_ANALYSIS_LENGTH = 700;
const MAX_NODE_SUMMARY_LENGTH = 220;
const SYNTHESIS_REVEAL_DURATION_MS = 1700;
const THEORY_REVEAL_DURATION_MS = 1600;
const THEORY_SECTION_STAGGER_MS = 90;

const prefersReducedMotion = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false;
    }

    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

const parseAlertBuckets = (raw: string | null): AlertBuckets => {
    if (!raw) {
        return {};
    }

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }

        return Object.entries(parsed).reduce<AlertBuckets>((acc, [investigationId, alerts]) => {
            if (!Array.isArray(alerts)) {
                return acc;
            }

            acc[investigationId] = alerts
                .filter((alert): alert is SynthesisAlert => {
                    return Boolean(
                        alert &&
                        typeof alert === 'object' &&
                        typeof (alert as SynthesisAlert).entity === 'string' &&
                        typeof (alert as SynthesisAlert).currentVaultId === 'string',
                    );
                })
                .map(normalizeAlert)
                .slice(0, MAX_ALERTS_PER_INVESTIGATION);
            return acc;
        }, {});
    } catch {
        return {};
    }
};

const trimText = (value: string, maxLength: number): string => {
    const normalized = value.trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength - 3)}...`;
};

const buildAlertKey = (alert: Partial<SynthesisAlert>): string => {
    const currentVaultId = (alert.currentVaultId || '').trim();
    const entity = (alert.entity || 'unknown').trim().toLowerCase();
    const connectedCases = Array.isArray(alert.connectedCases)
        ? Array.from(new Set(alert.connectedCases.filter((caseId): caseId is string => typeof caseId === 'string' && caseId.trim().length > 0))).sort()
        : [];

    return [currentVaultId, entity, connectedCases.join('|')].join('::');
};

const normalizeAlert = (alert: SynthesisAlert): SynthesisAlert => ({
    ...alert,
    alertKey: alert.alertKey || buildAlertKey(alert),
    entity: trimText(alert.entity || 'unknown', 80),
    analysis: trimText(alert.analysis || '', MAX_ANALYSIS_LENGTH),
    connectedCases: Array.isArray(alert.connectedCases) ? alert.connectedCases.slice(0, 8) : [],
    nodes: Array.isArray(alert.nodes)
        ? alert.nodes.slice(0, 8).map((node) => ({
            vaultId: node.vaultId,
            nodeId: node.nodeId,
            summary: trimText(node.summary || '', MAX_NODE_SUMMARY_LENGTH),
        }))
        : [],
});

const THEORY_TABLE_ROW_PATTERN = /^\s*\|.*\|\s*$/;
const THEORY_REFERENCE_TOKEN_PATTERN = /\b(?:https?:\/\/|(?:vault|timeline|rabbit):\/\/)[^\s),;]+|\binv-[A-Za-z0-9_-]+/gi;
const THEORY_VAULT_ID_PATTERN = /\binv-[A-Za-z0-9_-]+/i;
const THEORY_TRAILING_PUNCTUATION_PATTERN = /[.,;:)\]]+$/;

const normalizeTheoryMarkdown = (report: string) => {
    const lines = report.replace(/\r\n/g, '\n').split('\n');
    const normalizedLines: string[] = [];

    lines.forEach((line, index) => {
        const isBlank = line.trim().length === 0;
        const previousLine = normalizedLines[normalizedLines.length - 1] || '';
        const nextLine = lines[index + 1] || '';
        if (
            isBlank &&
            THEORY_TABLE_ROW_PATTERN.test(previousLine) &&
            THEORY_TABLE_ROW_PATTERN.test(nextLine)
        ) {
            return;
        }
        normalizedLines.push(line);
    });

    return normalizedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const splitTheoryReport = (report: string) => normalizeTheoryMarkdown(report)
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean);

type TheoryTableData = {
    headers: string[];
    rows: string[][];
};

const getElementChildren = (node: ReactNode): ReactNode | undefined => {
    if (!isValidElement<{ children?: ReactNode }>(node)) {
        return undefined;
    }
    return node.props.children;
};

const getElementTagName = (node: ReactNode) => {
    if (!isValidElement(node) || typeof node.type !== 'string') {
        return '';
    }
    return node.type;
};

const getReactNodeText = (node: ReactNode): string => {
    if (node === null || node === undefined || typeof node === 'boolean') {
        return '';
    }
    if (typeof node === 'string' || typeof node === 'number') {
        return String(node);
    }
    if (Array.isArray(node)) {
        return node.map(getReactNodeText).join('');
    }
    return getReactNodeText(getElementChildren(node));
};

const collectElementsByTag = (node: ReactNode, tagName: string): ReactElement<{ children?: ReactNode }>[] => {
    const matches: ReactElement<{ children?: ReactNode }>[] = [];
    Children.toArray(node).forEach((child) => {
        if (!isValidElement<{ children?: ReactNode }>(child)) {
            return;
        }
        if (getElementTagName(child) === tagName) {
            matches.push(child);
            return;
        }
        matches.push(...collectElementsByTag(child.props.children, tagName));
    });
    return matches;
};

const getTheoryTableRows = (node: ReactNode): string[][] => collectElementsByTag(node, 'tr')
    .map((row) => Children.toArray(row.props.children)
        .filter((cell) => getElementTagName(cell) === 'th' || getElementTagName(cell) === 'td')
        .map((cell) => getReactNodeText(cell).replace(/\s+/g, ' ').trim()))
    .filter((row) => row.some(Boolean));

const getTheoryTableData = (children: ReactNode): TheoryTableData => {
    const thead = collectElementsByTag(children, 'thead')[0];
    const tbody = collectElementsByTag(children, 'tbody')[0];
    const headerRows = thead ? getTheoryTableRows(thead) : [];
    const bodyRows = tbody ? getTheoryTableRows(tbody) : [];
    const fallbackRows = getTheoryTableRows(children);
    const headers = headerRows[0] || fallbackRows[0] || [];
    const rows = bodyRows.length > 0 ? bodyRows : fallbackRows.slice(headers.length > 0 ? 1 : 0);
    return { headers, rows };
};

const getTheoryReferenceVaultId = (reference: string) => reference.match(THEORY_VAULT_ID_PATTERN)?.[0] || null;

const stripTheoryReferencePunctuation = (reference: string) => {
    const trailing = reference.match(THEORY_TRAILING_PUNCTUATION_PATTERN)?.[0] || '';
    return {
        cleanReference: trailing ? reference.slice(0, -trailing.length) : reference,
        trailing,
    };
};

const getTheoryLinkedInvestigationIds = (report: string, currentInvestigationId: string | null) => {
    const seen = new Set<string>();
    const matches = report.match(new RegExp(THEORY_VAULT_ID_PATTERN.source, 'gi')) || [];
    matches.forEach((match) => {
        if (match && match !== currentInvestigationId) {
            seen.add(match);
        }
    });
    return Array.from(seen).slice(0, 8);
};

const renderTheoryLinkedText = (text: string, onNavigateReference?: (reference: string) => void): ReactNode => {
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    const pattern = new RegExp(THEORY_REFERENCE_TOKEN_PATTERN.source, 'gi');
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
        const token = match[0];
        const tokenIndex = match.index;
        if (tokenIndex > lastIndex) {
            parts.push(text.slice(lastIndex, tokenIndex));
        }

        const { cleanReference, trailing } = stripTheoryReferencePunctuation(token);
        const vaultId = getTheoryReferenceVaultId(cleanReference);
        if (/^https?:\/\//i.test(cleanReference)) {
            parts.push(
                <a
                    key={`${tokenIndex}-${cleanReference}`}
                    href={cleanReference}
                    target="_blank"
                    rel="noreferrer"
                    className="forensic-synthesis-theory-inline-link"
                >
                    {cleanReference}
                </a>,
            );
        } else if (vaultId && onNavigateReference) {
            parts.push(
                <button
                    key={`${tokenIndex}-${cleanReference}`}
                    type="button"
                    onClick={() => onNavigateReference(cleanReference)}
                    className="forensic-synthesis-theory-inline-case"
                    title={`Open linked investigation ${vaultId}`}
                >
                    {vaultId}
                </button>,
            );
        } else {
            parts.push(
                <span key={`${tokenIndex}-${cleanReference}`} className="forensic-synthesis-theory-inline-ref">
                    {cleanReference}
                </span>,
            );
        }

        if (trailing) {
            parts.push(trailing);
        }
        lastIndex = tokenIndex + token.length;
    }

    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
    }
    return parts.length > 0 ? parts : text;
};

const TheoryMarkdownTable = ({
    children,
    onNavigateReference,
}: {
    children?: ReactNode;
    onNavigateReference?: (reference: string) => void;
}) => {
    const tableData = getTheoryTableData(children);
    const hasCardRows = tableData.headers.length > 0 && tableData.rows.length > 0;

    return (
        <div
            data-testid="synthesis-theory-table-wrap"
            className={`forensic-synthesis-theory-table-wrap ${hasCardRows ? 'forensic-synthesis-theory-table-wrap-carded' : ''}`}
        >
            <table className="forensic-synthesis-theory-table">{children}</table>
            {hasCardRows && (
                <div className="forensic-synthesis-theory-table-cards" aria-hidden="true">
                    {tableData.rows.map((row, rowIndex) => (
                        <div key={`${rowIndex}-${row.join('|').slice(0, 32)}`} className="forensic-synthesis-theory-table-card-row">
                            {row.map((cell, cellIndex) => {
                                if (!cell) {
                                    return null;
                                }
                                return (
                                    <div key={`${cellIndex}-${cell.slice(0, 18)}`} className="forensic-synthesis-theory-table-card-cell">
                                        <span className="forensic-synthesis-theory-table-card-label">
                                            {tableData.headers[cellIndex] || `Field ${cellIndex + 1}`}
                                        </span>
                                        <span className="forensic-synthesis-theory-table-card-value">
                                            {renderTheoryLinkedText(cell, onNavigateReference)}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const upsertAlertBucket = (alerts: SynthesisAlert[], incomingAlert: SynthesisAlert): SynthesisAlert[] => {
    const deduped = alerts.filter((alert) => (alert.alertKey || buildAlertKey(alert)) !== incomingAlert.alertKey);
    return [incomingAlert, ...deduped].slice(0, MAX_ALERTS_PER_INVESTIGATION);
};

const persistInvestigationAlerts = (investigationId: string, alerts: SynthesisAlert[]) => {
    const savedState = getCachedBoardStateForInvestigation(investigationId);
    if (!savedState) {
        return;
    }

    void saveBoardStateForInvestigation(investigationId, {
        ...savedState,
        synthesisAlerts: alerts as PersistedSynthesisAlert[],
    });
};

const pruneBucketsForStorage = (buckets: AlertBuckets): AlertBuckets => {
    const orderedEntries = Object.entries(buckets).map(([investigationId, alerts]) => [
        investigationId,
        alerts.map(normalizeAlert).slice(0, MAX_ALERTS_PER_INVESTIGATION),
    ] as const);

    let runningCount = 0;
    const pruned: AlertBuckets = {};
    for (const [investigationId, alerts] of orderedEntries) {
        if (runningCount >= MAX_TOTAL_ALERTS) {
            break;
        }
        const remaining = MAX_TOTAL_ALERTS - runningCount;
        const trimmedAlerts = alerts.slice(0, remaining);
        if (trimmedAlerts.length === 0) {
            continue;
        }
        pruned[investigationId] = trimmedAlerts;
        runningCount += trimmedAlerts.length;
    }
    return pruned;
};

const persistAlertBuckets = (buckets: AlertBuckets): AlertBuckets => {
    const pruned = pruneBucketsForStorage(buckets);
    try {
        localStorage.setItem(ALERT_BUCKETS_KEY, JSON.stringify(pruned));
        return pruned;
    } catch (error) {
        console.warn('[SynthesisPanel] Failed to persist synthesis alert cache; continuing in-memory only.', error);
        return pruned;
    }
};

const pruneBucketsForState = (buckets: AlertBuckets, prioritizedInvestigationId?: string | null): AlertBuckets => {
    const prioritizedEntries = Object.entries(buckets).sort(([leftId], [rightId]) => {
        if (leftId === prioritizedInvestigationId) {
            return -1;
        }
        if (rightId === prioritizedInvestigationId) {
            return 1;
        }
        return 0;
    });

    let runningCount = 0;
    const pruned: AlertBuckets = {};
    for (const [investigationId, alerts] of prioritizedEntries) {
        if (runningCount >= MAX_TOTAL_ALERTS) {
            break;
        }

        const remaining = MAX_TOTAL_ALERTS - runningCount;
        const trimmedAlerts = alerts.slice(0, remaining);
        if (trimmedAlerts.length === 0) {
            continue;
        }

        pruned[investigationId] = trimmedAlerts;
        runningCount += trimmedAlerts.length;
    }

    return pruned;
};

const migrateLegacyAlerts = (): AlertBuckets => {
    const migrated = parseAlertBuckets(localStorage.getItem(ALERT_BUCKETS_KEY));
    if (Object.keys(migrated).length > 0) {
        return migrated;
    }

    const legacyRaw = localStorage.getItem(LEGACY_ALERTS_KEY);
    if (!legacyRaw) {
        return {};
    }

    try {
        const parsed = JSON.parse(legacyRaw);
        if (!Array.isArray(parsed)) {
            localStorage.removeItem(LEGACY_ALERTS_KEY);
            return {};
        }

        const buckets = parsed.reduce<AlertBuckets>((acc, alert) => {
            if (
                alert &&
                typeof alert === 'object' &&
                typeof alert.currentVaultId === 'string'
            ) {
                const current = acc[alert.currentVaultId] || [];
                acc[alert.currentVaultId] = [...current, normalizeAlert(alert as SynthesisAlert)].slice(0, MAX_ALERTS_PER_INVESTIGATION);
            }
            return acc;
        }, {});

        const persisted = persistAlertBuckets(buckets);
        localStorage.removeItem(LEGACY_ALERTS_KEY);
        return persisted;
    } catch {
        localStorage.removeItem(LEGACY_ALERTS_KEY);
        return {};
    }
};

interface SynthesisPanelProps {
    sharedSocket: WebSocket | null;
    currentInvestigationId: string | null;
    onNavigateVault?: (id: string, nodeId?: string) => void;
    returnVaultId: string | null;
    investigations?: { id: string; topic: string; displayTopic?: string }[];
    onMergeInvestigations?: (entity: string, connectedCases: string[], relevantNodes: MergeCandidateNode[]) => void;
    showHandle?: boolean;
    currentTheoryReport?: string | null;
    hasTheoryReady?: boolean;
    hasUnreadTheory?: boolean;
    onMarkTheoryRead?: () => void;
}

export default function SynthesisPanel({
    sharedSocket,
    currentInvestigationId,
    onNavigateVault,
    returnVaultId,
    investigations = [],
    onMergeInvestigations,
    showHandle = true,
    currentTheoryReport = null,
    hasTheoryReady = false,
    hasUnreadTheory = false,
    onMarkTheoryRead,
}: SynthesisPanelProps) {
    const [alertsByInvestigation, setAlertsByInvestigation] = useState<AlertBuckets>({});
    const [qaAlertsByInvestigation, setQaAlertsByInvestigation] = useState<AlertBuckets>({});
    const [isOpen, setIsOpen] = useState(false);
    const [unreadByInvestigation, setUnreadByInvestigation] = useState<Record<string, boolean>>({});
    const [pulledNodeId, setPulledNodeId] = useState<string | null>(null);
    const [revealingAlertKeys, setRevealingAlertKeys] = useState<Set<string>>(() => new Set());
    const [revealingTheoryKey, setRevealingTheoryKey] = useState<string | null>(null);
    const knownAlertKeysRef = useRef<Set<string>>(new Set());
    const alertRevealTimersRef = useRef<Map<string, number>>(new Map());
    const knownTheoryByInvestigationRef = useRef<Record<string, string>>({});
    const theoryRevealTimerRef = useRef<number | null>(null);
    const currentAlerts = currentInvestigationId ? (alertsByInvestigation[currentInvestigationId] ?? EMPTY_ALERTS) : EMPTY_ALERTS;
    const currentQaAlerts = currentInvestigationId ? (qaAlertsByInvestigation[currentInvestigationId] ?? EMPTY_ALERTS) : EMPTY_ALERTS;
    const trimmedTheoryReport = (currentTheoryReport || '').trim();
    const theorySections = useMemo(() => splitTheoryReport(trimmedTheoryReport), [trimmedTheoryReport]);
    const theoryLinkedInvestigationIds = useMemo(
        () => getTheoryLinkedInvestigationIds(trimmedTheoryReport, currentInvestigationId),
        [currentInvestigationId, trimmedTheoryReport],
    );
    const currentTheoryKey = currentInvestigationId && trimmedTheoryReport
        ? `${currentInvestigationId}::${trimmedTheoryReport}`
        : null;
    const shouldRevealTheorySections = Boolean(currentTheoryKey && revealingTheoryKey === currentTheoryKey);
    const hasUnread = currentInvestigationId
        ? Boolean(unreadByInvestigation[currentInvestigationId]) || Boolean(hasUnreadTheory)
        : false;

    const markCurrentTheoryRead = useCallback(() => {
        if (!currentInvestigationId) {
            return;
        }
        setUnreadByInvestigation(prev => ({
            ...prev,
            [currentInvestigationId]: false,
        }));
        setQaAlertsByInvestigation(prev => {
            const updated = { ...prev };
            delete updated[currentInvestigationId];
            return updated;
        });
        onMarkTheoryRead?.();
    }, [currentInvestigationId, onMarkTheoryRead]);

    const markAlertForReveal = (alertKey?: string) => {
        if (!alertKey || prefersReducedMotion()) {
            return;
        }

        if (alertRevealTimersRef.current.has(alertKey)) {
            window.clearTimeout(alertRevealTimersRef.current.get(alertKey));
        }
        setRevealingAlertKeys((current) => {
            const next = new Set(current);
            next.add(alertKey);
            return next;
        });

        const timerId = window.setTimeout(() => {
            alertRevealTimersRef.current.delete(alertKey);
            setRevealingAlertKeys((current) => {
                const next = new Set(current);
                next.delete(alertKey);
                return next;
            });
        }, SYNTHESIS_REVEAL_DURATION_MS);
        alertRevealTimersRef.current.set(alertKey, timerId);
    };

    useEffect(() => {
        console.debug('[SynthesisPanel] Mounted.');
        setAlertsByInvestigation(migrateLegacyAlerts());
    }, []);

    useEffect(() => {
        Object.values(alertsByInvestigation).forEach((alerts) => {
            alerts.forEach((alert) => {
                knownAlertKeysRef.current.add(alert.alertKey || buildAlertKey(alert));
            });
        });
    }, [alertsByInvestigation]);

    useEffect(() => () => {
        alertRevealTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
        alertRevealTimersRef.current.clear();
        if (theoryRevealTimerRef.current !== null) {
            window.clearTimeout(theoryRevealTimerRef.current);
            theoryRevealTimerRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (!currentInvestigationId) {
            setRevealingTheoryKey(null);
            return;
        }

        const previousReport = knownTheoryByInvestigationRef.current[currentInvestigationId];
        if (previousReport === undefined) {
            knownTheoryByInvestigationRef.current[currentInvestigationId] = trimmedTheoryReport;
            setRevealingTheoryKey(null);
            return;
        }

        if (!trimmedTheoryReport || previousReport === trimmedTheoryReport) {
            return;
        }

        knownTheoryByInvestigationRef.current[currentInvestigationId] = trimmedTheoryReport;
        if (prefersReducedMotion()) {
            setRevealingTheoryKey(null);
            return;
        }

        const nextTheoryKey = `${currentInvestigationId}::${trimmedTheoryReport}`;
        setRevealingTheoryKey(nextTheoryKey);
        if (theoryRevealTimerRef.current !== null) {
            window.clearTimeout(theoryRevealTimerRef.current);
        }
        theoryRevealTimerRef.current = window.setTimeout(() => {
            setRevealingTheoryKey((current) => current === nextTheoryKey ? null : current);
            theoryRevealTimerRef.current = null;
        }, THEORY_REVEAL_DURATION_MS);
    }, [currentInvestigationId, trimmedTheoryReport]);

    useEffect(() => {
        console.debug('[SynthesisPanel] Investigation state changed', {
            currentInvestigationId,
            alertCount: currentAlerts.length,
            hasUnread,
            isOpen,
        });
    }, [currentAlerts.length, currentInvestigationId, hasUnread, isOpen]);

    useEffect(() => {
        if (!currentInvestigationId) {
            return;
        }

        let cancelled = false;
        void (async () => {
            const savedState = await loadBoardStateForInvestigation(currentInvestigationId);
            if (cancelled) {
                return;
            }
            const hasExplicitAlertSnapshot = Boolean(
                savedState &&
                Object.prototype.hasOwnProperty.call(savedState, 'synthesisAlerts') &&
                Array.isArray(savedState.synthesisAlerts),
            );
            if (!hasExplicitAlertSnapshot) {
                return;
            }
            const persistedAlerts = savedState?.synthesisAlerts?.map((alert) => normalizeAlert(alert as SynthesisAlert)) || [];
            if (persistedAlerts.length === 0) {
                return;
            }

            setAlertsByInvestigation(prev => {
                console.debug('[SynthesisPanel] Rehydrating synthesis alerts from persisted board state', {
                    currentInvestigationId,
                    count: persistedAlerts.length,
                });

                const nextBucketsDraft = {
                    ...prev,
                    [currentInvestigationId]: persistedAlerts,
                };
                const nextBuckets = pruneBucketsForState(nextBucketsDraft, currentInvestigationId);
                persistAlertBuckets(nextBuckets);
                return nextBuckets;
            });
        })();

        return () => {
            cancelled = true;
        };
    }, [currentInvestigationId]);

    useEffect(() => {
        Object.entries(alertsByInvestigation).forEach(([investigationId, alerts]) => {
            persistInvestigationAlerts(investigationId, alerts);
        });
    }, [alertsByInvestigation]);

    useEffect(() => {
        if (!sharedSocket) return;

        const handleMessage = (e: MessageEvent) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === 'SYNTHESIS_ALERT') {
                    const newAlert = normalizeAlert(msg.payload as SynthesisAlert);
                    console.debug('[SynthesisPanel] Received SYNTHESIS_ALERT', {
                        currentInvestigationId,
                        alertCurrentVaultId: newAlert.currentVaultId,
                        alertKey: newAlert.alertKey,
                        entity: newAlert.entity,
                        connectedCases: newAlert.connectedCases,
                    });
                    if (!newAlert.currentVaultId) {
                        console.warn('[SynthesisPanel] Ignoring alert without currentVaultId', newAlert);
                        return;
                    }
                    const alertKey = newAlert.alertKey || buildAlertKey(newAlert);
                    const isNewAlertKey = !knownAlertKeysRef.current.has(alertKey);
                    knownAlertKeysRef.current.add(alertKey);
                    if (isNewAlertKey) {
                        markAlertForReveal(alertKey);
                    }
                    setAlertsByInvestigation(prev => {
                        const currentAlertsForVault = prev[newAlert.currentVaultId] || [];
                        const updatedBucket = upsertAlertBucket(currentAlertsForVault, newAlert);
                        console.debug('[SynthesisPanel] Updating alert bucket', {
                            targetVaultId: newAlert.currentVaultId,
                            previousCount: currentAlertsForVault.length,
                            nextCount: updatedBucket.length,
                            duplicateKey: currentAlertsForVault.some((alert) => (alert.alertKey || buildAlertKey(alert)) === newAlert.alertKey),
                        });
                        const updated = pruneBucketsForState({
                            ...prev,
                            [newAlert.currentVaultId]: updatedBucket,
                        }, newAlert.currentVaultId);
                        persistAlertBuckets(updated);
                        return updated;
                    });
                    setUnreadByInvestigation(prev => ({
                        ...prev,
                        [newAlert.currentVaultId]: true,
                    }));
                    if (newAlert.currentVaultId !== currentInvestigationId) {
                        console.debug('[SynthesisPanel] Alert stored for non-active investigation', {
                            currentInvestigationId,
                            alertCurrentVaultId: newAlert.currentVaultId,
                        });
                    }
                }
            } catch (error) {
                console.warn('[SynthesisPanel] Failed to process synthesis alert message.', error);
            }
        };

        sharedSocket.addEventListener('message', handleMessage);
        return () => sharedSocket.removeEventListener('message', handleMessage);
    }, [currentInvestigationId, sharedSocket]);

    useEffect(() => {
        const handleBrowserQaSynthesisDemo = (event: Event) => {
            const detail = (event as CustomEvent<BrowserQaSynthesisDemoDetail>).detail;
            const targetInvestigationId = typeof detail?.investigationId === 'string'
                ? detail.investigationId.trim()
                : '';
            if (!targetInvestigationId) {
                return;
            }

            const demoAlerts = createBrowserQaSynthesisDemoAlerts(targetInvestigationId).map((alert) => normalizeAlert(alert as SynthesisAlert));
            demoAlerts.forEach((alert) => {
                const alertKey = alert.alertKey || buildAlertKey(alert);
                knownAlertKeysRef.current.add(alertKey);
                markAlertForReveal(alertKey);
            });
            setQaAlertsByInvestigation((current) => ({
                ...current,
                [targetInvestigationId]: demoAlerts,
            }));
            setUnreadByInvestigation((current) => ({
                ...current,
                [targetInvestigationId]: true,
            }));
        };

        window.addEventListener(BROWSER_QA_SYNTHESIS_DEMO_EVENT, handleBrowserQaSynthesisDemo as EventListener);
        return () => window.removeEventListener(BROWSER_QA_SYNTHESIS_DEMO_EVENT, handleBrowserQaSynthesisDemo as EventListener);
    }, [currentInvestigationId]);

    const togglePanel = () => {
        setIsOpen(!isOpen);
        if (!isOpen && currentInvestigationId) {
            markCurrentTheoryRead();
        }
    };

    useEffect(() => {
        const handlePanelToggle = () => {
            setIsOpen((current) => {
                const next = !current;
                if (next && currentInvestigationId) {
                    markCurrentTheoryRead();
                }
                return next;
            });
        };

        window.addEventListener(BOARD_TOGGLE_SYNTHESIS_PANEL_EVENT, handlePanelToggle);
        return () => window.removeEventListener(BOARD_TOGGLE_SYNTHESIS_PANEL_EVENT, handlePanelToggle);
    }, [currentInvestigationId, markCurrentTheoryRead]);

    const clearAlerts = () => {
        if (!currentInvestigationId) {
            return;
        }

        setAlertsByInvestigation(prev => {
            const updated = { ...prev };
            delete updated[currentInvestigationId];
            persistInvestigationAlerts(currentInvestigationId, []);
            persistAlertBuckets(updated);
            return updated;
        });
        setUnreadByInvestigation(prev => ({
            ...prev,
            [currentInvestigationId]: false,
        }));
        onMarkTheoryRead?.();
    };

    const handleJump = (vaultId: string, nodeId?: string) => {
        if (onNavigateVault) onNavigateVault(vaultId, nodeId);
    };

    const handleTheoryReferenceJump = useCallback((reference: string) => {
        const vaultId = getTheoryReferenceVaultId(reference);
        if (vaultId && onNavigateVault) {
            onNavigateVault(vaultId);
        }
    }, [onNavigateVault]);

    const theoryMarkdownComponents = useMemo(() => ({
        table: ({ children }: { children?: ReactNode }) => (
            <TheoryMarkdownTable children={children} onNavigateReference={handleTheoryReferenceJump} />
        ),
    }), [handleTheoryReferenceJump]);

    const handleReturn = () => {
        if (returnVaultId && onNavigateVault) {
            onNavigateVault(returnVaultId);
        }
    };

    const combinedCurrentAlerts = [...currentQaAlerts, ...currentAlerts];
    const displayedAlerts = combinedCurrentAlerts;
    const hasPanelAlerts = displayedAlerts.length > 0;
    const showPanelHandle = Boolean(currentInvestigationId) && showHandle;

    if (!currentInvestigationId) return null;

    return (
        <>
            {/* Floating Toggle Button */}
            {showPanelHandle && (
                <button
                    onClick={togglePanel}
                    aria-label={`${isOpen ? 'Hide synthesis panel' : 'Show synthesis panel'}${hasTheoryReady ? ' - Grand Unified Theory ready' : ''}`}
                    title={`${isOpen ? 'Hide synthesis panel' : 'Show synthesis panel'}${hasTheoryReady ? ' - Grand Unified Theory ready' : ''}`}
                    className="forensic-overlay-handle absolute right-0 top-24 z-[60] flex items-center gap-2 rounded-l-xl p-3 transition-all hover:bg-[var(--forensic-accent)] hover:text-black"
                >
                    {isOpen ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                    <Network size={20} className={hasUnread ? "forensic-synthesis-handle-unread text-[var(--forensic-accent)]" : hasTheoryReady ? "text-[var(--forensic-accent)]" : ""} />
                    {hasUnread && (
                        <span className="forensic-synthesis-handle-badge absolute -top-2 -left-2 bg-red-500 text-white text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full">
                            !
                        </span>
                    )}
                </button>
            )}

            {/* Slide-out Panel */}
            <div
                className={`forensic-overlay-panel absolute top-0 right-0 bottom-0 w-96 z-50 transform transition-transform duration-300 flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'
                    }`}
            >
                    <div className="p-4 border-b border-[rgba(129,227,255,0.15)] flex flex-col gap-2 bg-[linear-gradient(180deg,rgba(129,227,255,0.08),rgba(129,227,255,0.03))]">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2 text-[var(--forensic-accent)] font-black uppercase tracking-[0.16em]">
                            <Network size={20} />
                            <h2>GRAND UNIFIED THEORY</h2>
                        </div>
                        <div className="flex items-center gap-3">
                            <button onClick={clearAlerts} className="text-[var(--forensic-text-faint)] hover:text-[var(--forensic-danger)] text-xs font-bold">
                                CLEAR
                            </button>
                            <button onClick={togglePanel} className="text-[var(--forensic-text-faint)] hover:text-white">
                                <ChevronRight size={20} />
                            </button>
                        </div>
                    </div>
                    {returnVaultId && (
                        <div className="forensic-board-section rounded-xl p-2 flex justify-between items-center text-xs text-[var(--forensic-accent)] animate-pulse">
                            <span>Viewing Portal Node</span>
                            <button onClick={handleReturn} className="flex items-center gap-1 font-bold hover:text-white bg-black/40 px-2 py-1 rounded-lg border border-white/8">
                                <ArrowLeft size={12} /> RETURN
                            </button>
                        </div>
                    )}
                </div>

                    <div className={`flex-1 min-h-0 p-4 ${hasPanelAlerts ? 'overflow-y-auto space-y-4' : 'overflow-hidden'}`}>
                    {hasPanelAlerts ? displayedAlerts.map((alert, idx) => {
                        const alertKey = alert.alertKey || buildAlertKey(alert);
                        const isRevealing = revealingAlertKeys.has(alertKey);

                        return (
                        <div
                            key={alertKey || idx}
                            data-testid={`synthesis-alert-card-${alertKey}`}
                            className={`forensic-board-section forensic-synthesis-alert-card p-4 rounded-[1.25rem] relative group hover:border-[var(--forensic-border-strong)] transition-colors ${isRevealing ? 'forensic-synthesis-alert-reveal' : ''}`}
                        >
                            <div className="absolute top-0 right-0 p-2 opacity-[0.08]">
                                <Network size={40} />
                            </div>

                            <div className="flex items-center gap-2 mb-3">
                                <span className="forensic-badge rounded px-2 py-0.5 text-[10px] font-bold uppercase">
                                    Overlap Detected
                                </span>
                                <span className="text-[var(--forensic-text-faint)] text-[10px] flex items-center gap-1">
                                    <Clock size={10} /> {alert.timestamp}
                                </span>
                            </div>

                            <div className="mb-4">
                                <h3 className="text-[var(--forensic-text)] font-bold text-lg mb-1 flex items-center gap-2">
                                    <Hash size={16} className="text-[var(--forensic-accent)]" />
                                    <span className="text-[var(--forensic-accent)]">{alert.entity}</span>
                                </h3>
                                <p className="text-[var(--forensic-text-muted)] text-xs leading-relaxed">
                                    {alert.analysis}
                                </p>
                                {alert.connectedCases.length >= 2 && onMergeInvestigations && (
                                    <button
                                        onClick={() => onMergeInvestigations(
                                            alert.entity,
                                            alert.connectedCases,
                                            alert.nodes.map((node) => ({ vaultId: node.vaultId, nodeId: node.nodeId })),
                                        )}
                                        className="forensic-badge mt-3 inline-flex items-center gap-2 rounded px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] transition-colors hover:bg-[var(--forensic-accent)] hover:text-black"
                                    >
                                        <Network size={12} />
                                        Merge Investigation
                                    </button>
                                )}
                            </div>

                            <div className="mt-4 pt-3 border-t border-[rgba(255,255,255,0.06)]">
                                <div className="text-[10px] text-[var(--forensic-text-faint)] mb-2 flex items-center justify-between uppercase">
                                    <div className="flex items-center gap-1"><Database size={10} /> Connected Vaults</div>
                                    {alert.score !== undefined && (
                                        <div className="text-[var(--forensic-success)]/70">Rarity: {alert.score.toFixed(2)}</div>
                                    )}
                                </div>
                                <div className="flex flex-col gap-2">
                                    {alert.connectedCases.map((caseId, cIdx) => {
                                        const caseNodes = alert.nodes?.filter(n => n.vaultId === caseId) || [];
                                        return (
                                            <div key={cIdx} className="rounded-xl border border-[rgba(118,177,214,0.14)] bg-[rgba(255,255,255,0.025)] text-[var(--forensic-text-muted)] p-2 text-xs flex flex-col gap-2">
                                                <div className="flex justify-between items-center">
                                                    <span className="font-mono text-[10px] text-[var(--forensic-accent)] truncate max-w-[200px]" title={caseId}>
                                                        {investigations.find(inv => inv.id === caseId)?.displayTopic || investigations.find(inv => inv.id === caseId)?.topic || caseId}
                                                        {caseId === currentInvestigationId && ' (CURRENT)'}
                                                    </span>
                                                    {caseId !== currentInvestigationId && (
                                                        <button
                                                            onClick={() => handleJump(caseId, caseNodes[0]?.nodeId)}
                                                            className="rounded-lg border border-[rgba(129,227,255,0.18)] bg-[rgba(129,227,255,0.08)] px-2 py-0.5 text-[9px] text-[var(--forensic-accent-strong)] hover:bg-[var(--forensic-accent)] hover:text-black transition-colors flex items-center gap-1 font-bold"
                                                        >
                                                            PORTAL JUMP <ArrowRightToLine size={10} />
                                                        </button>
                                                    )}
                                                </div>
                                                {/* Hover context nodes */}
                                                <div className="flex flex-col gap-1">
                                                    {caseNodes.map((n, i) => (
                                                        <div key={i} className="group/node relative truncate max-w-full text-[10px] text-[var(--forensic-text-faint)] cursor-help hover:text-white border-l-2 border-[rgba(129,227,255,0.26)] pl-2">
                                                            {n.summary}
                                                            {/* Tooltip on hover */}
                                                            <div className="absolute top-full left-0 mt-1 hidden group-hover/node:block z-50 forensic-board-dialog p-2 w-64 text-xs text-[var(--forensic-text-muted)] whitespace-normal break-words rounded-xl">
                                                                <div className="text-[var(--forensic-accent)] font-bold mb-1 border-b border-[rgba(129,227,255,0.14)] pb-1">Context Node ({n.nodeId})</div>
                                                                {n.summary}
                                                                
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        const targetId = returnVaultId || currentInvestigationId;
                                                                        if (sharedSocket && sharedSocket.readyState === WebSocket.OPEN && targetId) {
                                                                            sharedSocket.send(JSON.stringify({
                                                                                type: 'PULL_NODE',
                                                                                payload: {
                                                                                    sourceVaultId: n.vaultId,
                                                                                    sourceNodeId: n.nodeId,
                                                                                    targetVaultId: targetId
                                                                                }
                                                                            }));
                                                                            setPulledNodeId(n.nodeId);
                                                                            setTimeout(() => setPulledNodeId(null), 3000);
                                                                        }
                                                                    }}
                                                                    title="IMPORT NODE: Bring this context into your active investigation board"
                                                                    className={`mt-3 w-full py-1.5 px-3 rounded-lg font-black transition-all flex items-center justify-center gap-2 text-[9px] tracking-widest uppercase ${
                                                                        pulledNodeId === n.nodeId 
                                                                        ? 'bg-[var(--forensic-success)] text-black shadow-[0_0_10px_rgba(144,243,218,0.32)]' 
                                                                        : 'bg-[rgba(129,227,255,0.08)] text-[var(--forensic-accent)] border border-[rgba(129,227,255,0.24)] hover:bg-[var(--forensic-accent)] hover:text-black hover:border-transparent'
                                                                    }`}
                                                                >
                                                                    {pulledNodeId === n.nodeId ? <CheckCircle size={12} /> : <ArrowRightToLine size={12} />}
                                                                    {pulledNodeId === n.nodeId ? 'IMPORT SUCCESS' : (returnVaultId ? 'IMPORT TO ACTIVE' : 'IMPORT TO BOARD')}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                        );
                    }) : trimmedTheoryReport ? (
                        <div className="forensic-board-section forensic-synthesis-theory-reader rounded-[1.2rem] text-xs leading-relaxed text-[var(--forensic-text-muted)]">
                            <div className="forensic-synthesis-theory-reader-header">
                                <div className="flex items-center gap-2 text-[var(--forensic-accent)]">
                                    <Database size={12} />
                                    <span className="text-[10px] font-black uppercase tracking-[0.18em]">Current Investigation Theory</span>
                                </div>
                                {theoryLinkedInvestigationIds.length > 0 && (
                                    <div className="forensic-synthesis-theory-linked-cases" aria-label="Linked investigations">
                                        {theoryLinkedInvestigationIds.map((caseId) => {
                                            const investigation = investigations.find((inv) => inv.id === caseId);
                                            const label = investigation?.displayTopic || investigation?.topic || caseId;
                                            return (
                                                <button
                                                    key={caseId}
                                                    type="button"
                                                    onClick={() => handleJump(caseId)}
                                                    className="forensic-synthesis-theory-case-chip"
                                                    title={`Open linked investigation ${caseId}`}
                                                >
                                                    <Network size={10} />
                                                    <span>{label}</span>
                                                    <ArrowRightToLine size={10} />
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                            <div className="forensic-synthesis-theory-scroll">
                                {theorySections.map((section, index) => (
                                    <div
                                        key={`${index}-${section.slice(0, 24)}`}
                                        data-testid={`synthesis-theory-section-${index}`}
                                        className={`forensic-synthesis-theory-markdown ${shouldRevealTheorySections ? 'forensic-synthesis-theory-section-reveal' : ''}`}
                                        style={{
                                            '--synthesis-theory-section-delay': `${index * THEORY_SECTION_STAGGER_MS}ms`,
                                        } as CSSProperties}
                                    >
                                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={theoryMarkdownComponents}>
                                            {section}
                                        </ReactMarkdown>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="forensic-board-section rounded-[1.2rem] p-4 text-xs leading-relaxed text-[var(--forensic-text-muted)]">
                            No cross-investigation overlaps yet for this investigation. Run <span className="font-black uppercase tracking-[0.16em] text-[var(--forensic-accent)]">Reconnect The Dots</span> to check for links against older cases.
                        </div>
                    )}
                    </div>
                </div>
        </>
    );
}
