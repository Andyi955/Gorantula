import { useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle,
    Bot,
    CheckSquare,
    FileText,
    Layers3,
    MessageSquareText,
    RefreshCw,
    Search,
    Send,
    ShieldCheck,
    Square,
    User,
    X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface VaultChatbotProps {
    sharedSocket: WebSocket | null;
    investigationContext?: VaultReadyQuestionContext | null;
}

type QueryMode = 'strict' | 'compare' | 'summarize';

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    mode?: QueryMode;
    files?: VaultFile[];
    createdAt: string;
}

interface VaultFile {
    fileName: string;
    filePath: string;
    modTime: string;
}

export interface VaultReadyQuestionEvidence {
    id: string;
    title: string;
    summary: string;
    sourceURL?: string;
}

export interface VaultReadyQuestionDiscovery {
    title: string;
    claim: string;
    impact: string;
    confidence?: number;
    sourceNodeIDs?: string[];
}

export interface VaultReadyQuestionContext {
    investigationId?: string | null;
    title?: string | null;
    summary?: string | null;
    fullReport?: string | null;
    evidenceCount?: number;
    relationshipCount?: number;
    importCount?: number;
    confidenceScore?: number;
    hasTheoryReport?: boolean;
    relationshipLabels?: string[];
    evidence?: VaultReadyQuestionEvidence[];
    discoveries?: VaultReadyQuestionDiscovery[];
}

const QUERY_MODES: Array<{ id: QueryMode; label: string; hint: string }> = [
    { id: 'strict', label: 'Strict', hint: 'Answer only from selected evidence files.' },
    { id: 'compare', label: 'Compare', hint: 'Compare selected cases before answering.' },
    { id: 'summarize', label: 'Summarize', hint: 'Compress the selected evidence into a brief.' },
];

const SUGGESTED_QUESTIONS = [
    'What are the strongest recurring claims across these investigations?',
    'Which sources disagree or leave gaps?',
    'Summarize the operational risk picture.',
];

export const VAULT_READY_QUESTIONS_QA_INVESTIGATION_ID = 'qa-ready-questions';

const QA_READY_QUESTION_CONTEXT: VaultReadyQuestionContext = {
    investigationId: VAULT_READY_QUESTIONS_QA_INVESTIGATION_ID,
    title: 'QA Rivergate Cooling Case',
    summary: 'Briarline Cooling Cooperative and Northgate Substation A-17 recur across contract, permit, and operator-note evidence.',
    hasTheoryReport: true,
    evidenceCount: 3,
    relationshipCount: 2,
    importCount: 1,
    relationshipLabels: ['Pressure Point', 'Timeline Lead'],
    evidence: [
        {
            id: 'qa-briarline-contract',
            title: 'Briarline cooling contract',
            summary: 'Briarline Cooling Cooperative names Northgate Substation A-17 as the load constraint for Rivergate expansion.',
        },
        {
            id: 'qa-northgate-note',
            title: 'Northgate operator note',
            summary: 'Northgate Substation A-17 logs a transformer warning after the Briarline dispatch window.',
        },
    ],
    discoveries: [
        {
            title: 'Cooling cooperative overlap',
            claim: 'Briarline Cooling Cooperative and Northgate Substation A-17 appear in multiple evidence cards.',
            impact: 'The overlap turns a contract detail into a concrete infrastructure pressure point.',
        },
    ],
};

const READY_ENTITY_PATTERN = /\b(?:[A-Z][A-Za-z0-9&'.-]+|[A-Z]{2,}|[A-Z]-\d+)(?:\s+(?:[A-Z][A-Za-z0-9&'.-]+|[A-Z]{2,}|[A-Z]-\d+)){1,5}\b/g;
const READY_ENTITY_STOP_WORDS = new Set([
    'Question',
    'Summary',
    'Evidence',
    'Investigation',
    'Historical Evidence',
    'Vault Chat Interface',
]);

const cleanQuestionFragment = (value?: string | null) => (value || '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const addUniqueFragment = (items: string[], value?: string | null) => {
    const cleaned = cleanQuestionFragment(value);
    if (!cleaned || cleaned.length < 3 || READY_ENTITY_STOP_WORDS.has(cleaned)) {
        return;
    }

    if (!items.some((item) => item.toLowerCase() === cleaned.toLowerCase())) {
        items.push(cleaned);
    }
};

const extractReadyQuestionEntities = (context?: VaultReadyQuestionContext | null, selectedEntities: string[] = []) => {
    const entities: string[] = [];
    const textBlocks = [
        context?.summary,
        ...(context?.evidence || []).map((item) => item.summary),
        ...(context?.discoveries || []).flatMap((item) => [item.title, item.claim, item.impact]),
        context?.fullReport,
    ];

    textBlocks.forEach((text) => {
        cleanQuestionFragment(text).match(READY_ENTITY_PATTERN)?.forEach((match) => addUniqueFragment(entities, match));
    });
    (context?.evidence || []).forEach((item) => addUniqueFragment(entities, item.title));
    selectedEntities.forEach((entity) => addUniqueFragment(entities, entity));

    return entities.slice(0, 8);
};

const buildReadyQuestions = (
    context?: VaultReadyQuestionContext | null,
    selectedEntities: string[] = [],
) => {
    const entities = extractReadyQuestionEntities(context, selectedEntities);
    const caseTitle = cleanQuestionFragment(context?.title) || 'this investigation';
    const relationshipLabel = cleanQuestionFragment(context?.relationshipLabels?.[0]);
    const discovery = (context?.discoveries || [])[0];
    const evidence = (context?.evidence || [])[0];
    const questions: string[] = [];

    if (entities.length >= 2) {
        questions.push(`Why do ${entities[0]} and ${entities[1]} matter in ${caseTitle}, and which evidence supports that link?`);
    }
    if (relationshipLabel && entities[0]) {
        questions.push(`What evidence supports the "${relationshipLabel}" relationship around ${entities[0]}, and what weakens it?`);
    }
    if (discovery?.title) {
        questions.push(`What does "${cleanQuestionFragment(discovery.title)}" actually prove, and which source nodes should I verify?`);
    }
    if (context?.hasTheoryReport) {
        questions.push(`Challenge the current unified theory for ${caseTitle}: where is it strongest, and where could it be overfitting?`);
    }
    if (evidence?.title) {
        questions.push(`Which claims in "${cleanQuestionFragment(evidence.title)}" are corroborated elsewhere in this vault?`);
    }
    if (selectedEntities.length >= 2) {
        questions.push(`Across the selected vault files, where do ${selectedEntities[0]} and ${selectedEntities[1]} agree or conflict?`);
    } else if (entities[0]) {
        questions.push(`What should I investigate next about ${entities[0]} before trusting this case?`);
    }

    const uniqueQuestions = questions.filter((question, index) =>
        questions.findIndex((candidate) => candidate.toLowerCase() === question.toLowerCase()) === index
    );

    return uniqueQuestions.length > 0 ? uniqueQuestions.slice(0, 6) : SUGGESTED_QUESTIONS;
};

const formatDateTime = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value || 'Unknown';
    }
    return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const formatClock = (value: string | null) => {
    if (!value) {
        return 'No answer yet';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
    });
};

const getFileTags = (fileName: string) => {
    const cleanName = fileName
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.md$/i, '')
        .replace(/[_-]+/g, ' ') || fileName;
    const words = cleanName
        .split(/\s+/)
        .map((word) => word.replace(/[^a-z0-9]/gi, '').trim())
        .filter((word) => word.length >= 3 && !/^\d+$/.test(word));
    return Array.from(new Set(words)).slice(0, 3);
};

const getEntityChips = (files: VaultFile[]) => {
    const counts = new Map<string, number>();
    files.forEach((file) => {
        getFileTags(file.fileName).forEach((tag) => {
            const normalized = tag.toLowerCase();
            counts.set(normalized, (counts.get(normalized) || 0) + 1);
        });
    });
    return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 10)
        .map(([tag]) => tag);
};

const getFreshnessTone = (file: VaultFile) => {
    const modified = new Date(file.modTime).getTime();
    if (Number.isNaN(modified)) {
        return 'unknown';
    }
    const ageDays = (Date.now() - modified) / 86_400_000;
    if (ageDays <= 30) {
        return 'fresh';
    }
    if (ageDays <= 180) {
        return 'aged';
    }
    return 'archive';
};

const buildQueryForMode = (mode: QueryMode, query: string) => {
    if (mode === 'compare') {
        return `Compare the selected vault files before answering. Question: ${query}`;
    }
    if (mode === 'summarize') {
        return `Summarize the selected vault evidence while answering this question: ${query}`;
    }
    return query;
};

export default function VaultChatbot({ sharedSocket, investigationContext }: VaultChatbotProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [availableFiles, setAvailableFiles] = useState<VaultFile[]>([]);
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
    const [fileSearch, setFileSearch] = useState('');
    const [queryMode, setQueryMode] = useState<QueryMode>('strict');
    const [isWaiting, setIsWaiting] = useState(false);
    const [isLoadingFiles, setIsLoadingFiles] = useState(false);
    const [lastAnswerAt, setLastAnswerAt] = useState<string | null>(null);
    const [qaReadyQuestionContext, setQaReadyQuestionContext] = useState<VaultReadyQuestionContext | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const pendingContextRef = useRef<{ files: VaultFile[]; mode: QueryMode } | null>(null);
    const socketReady = Boolean(sharedSocket) && (typeof sharedSocket?.readyState !== 'number' || sharedSocket.readyState === WebSocket.OPEN);
    const isQaReadyQuestionInvestigation = investigationContext?.investigationId === VAULT_READY_QUESTIONS_QA_INVESTIGATION_ID;
    const showVaultQaTools = (import.meta.env.DEV || import.meta.env.MODE === 'test') && isQaReadyQuestionInvestigation;

    const loadVaultFiles = () => {
        setIsLoadingFiles(true);
        fetch('http://localhost:8080/api/vault-files')
            .then((res) => res.json())
            .then((data) => {
                if (Array.isArray(data)) {
                    setAvailableFiles(data);
                }
            })
            .catch((err) => {
                console.debug('Vault files unavailable; backend may be offline.', err);
                setAvailableFiles([]);
            })
            .finally(() => setIsLoadingFiles(false));
    };

    useEffect(() => {
        loadVaultFiles();
    }, []);

    useEffect(() => {
        if (!sharedSocket) return undefined;

        const handleMessage = (event: MessageEvent) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'CHAT_RESPONSE') {
                    const context = pendingContextRef.current;
                    const createdAt = new Date().toISOString();
                    setMessages((prev) => [...prev, {
                        id: `bot-${Date.now()}`,
                        role: 'assistant',
                        content: String(msg.payload || ''),
                        files: context?.files || [],
                        mode: context?.mode || queryMode,
                        createdAt,
                    }]);
                    pendingContextRef.current = null;
                    setLastAnswerAt(createdAt);
                    setIsWaiting(false);
                } else if (msg.type === 'ERROR' && isWaiting) {
                    const context = pendingContextRef.current;
                    setMessages((prev) => [...prev, {
                        id: `err-${Date.now()}`,
                        role: 'assistant',
                        content: `**Error:** ${msg.payload}`,
                        files: context?.files || [],
                        mode: context?.mode || queryMode,
                        createdAt: new Date().toISOString(),
                    }]);
                    pendingContextRef.current = null;
                    setIsWaiting(false);
                }
            } catch (e) {
                console.error('Failed to parse websocket message', e);
            }
        };

        sharedSocket.addEventListener('message', handleMessage);
        return () => sharedSocket.removeEventListener('message', handleMessage);
    }, [sharedSocket, isWaiting, queryMode]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isWaiting]);

    const filteredFiles = useMemo(() => {
        const query = fileSearch.trim().toLowerCase();
        if (!query) {
            return availableFiles;
        }
        return availableFiles.filter((file) => `${file.fileName} ${file.filePath}`.toLowerCase().includes(query));
    }, [availableFiles, fileSearch]);

    const selectedFileRecords = useMemo(() => (
        availableFiles.filter((file) => selectedFiles.has(file.filePath))
    ), [availableFiles, selectedFiles]);

    const selectedEntities = useMemo(() => getEntityChips(selectedFileRecords), [selectedFileRecords]);
    const effectiveInvestigationContext = qaReadyQuestionContext || investigationContext || null;
    const readyQuestions = useMemo(
        () => buildReadyQuestions(effectiveInvestigationContext, selectedEntities),
        [effectiveInvestigationContext, selectedEntities],
    );
    const selectedCoverage = availableFiles.length > 0 ? Math.round((selectedFiles.size / availableFiles.length) * 100) : 0;
    const modeDefinition = QUERY_MODES.find((mode) => mode.id === queryMode) || QUERY_MODES[0];

    useEffect(() => {
        setQaReadyQuestionContext(null);
    }, [investigationContext?.investigationId]);

    const toggleFileSelection = (filePath: string) => {
        setSelectedFiles((current) => {
            const nextSet = new Set(current);
            if (nextSet.has(filePath)) {
                nextSet.delete(filePath);
            } else {
                nextSet.add(filePath);
            }
            return nextSet;
        });
    };

    const selectAllVisible = () => {
        setSelectedFiles(new Set(filteredFiles.map((file) => file.filePath)));
    };

    const selectNone = () => {
        setSelectedFiles(new Set());
    };

    const applyReadyQuestion = (question: string) => {
        setInput(question);
    };

    const loadQaReadyQuestions = () => {
        setQaReadyQuestionContext(QA_READY_QUESTION_CONTEXT);
        setInput('');
    };

    const clearTranscript = () => {
        setMessages([]);
        setLastAnswerAt(null);
        pendingContextRef.current = null;
    };

    const handleSend = () => {
        if (!input.trim() || !socketReady || selectedFiles.size === 0) return;

        const userQuery = input.trim();
        const contextFiles = selectedFileRecords;
        pendingContextRef.current = { files: contextFiles, mode: queryMode };
        setMessages((prev) => [...prev, {
            id: `user-${Date.now()}`,
            role: 'user',
            content: userQuery,
            files: contextFiles,
            mode: queryMode,
            createdAt: new Date().toISOString(),
        }]);
        setInput('');
        setIsWaiting(true);

        sharedSocket?.send(JSON.stringify({
            type: 'CHAT_RAG',
            payload: {
                query: buildQueryForMode(queryMode, userQuery),
                files: contextFiles.map((file) => file.filePath),
            },
        }));
    };

    const sendDisabled = !input.trim() || selectedFiles.size === 0 || !socketReady || isWaiting;

    return (
        <section className="forensic-vault-root" data-testid="vault-chatbot">
            <header className="forensic-vault-status-strip">
                <div className="forensic-vault-title-block">
                    <span>Vault Interrogation</span>
                    <strong>Historical Evidence Chat</strong>
                </div>
                <div className="forensic-vault-metrics" aria-label="Vault chat metrics">
                    <div>
                        <span>Selected Cases</span>
                        <strong>{selectedFiles.size} / {availableFiles.length}</strong>
                    </div>
                    <div>
                        <span>Total Vault Files</span>
                        <strong>{availableFiles.length}</strong>
                    </div>
                    <div>
                        <span>Query Mode</span>
                        <strong>{modeDefinition.label}</strong>
                    </div>
                    <div>
                        <span>WebSocket</span>
                        <strong className={socketReady ? 'forensic-vault-success' : 'forensic-vault-warning'}>
                            {socketReady ? 'Connected' : 'Offline'}
                        </strong>
                    </div>
                    <div>
                        <span>Last Answer</span>
                        <strong>{formatClock(lastAnswerAt)}</strong>
                    </div>
                </div>
            </header>

            <div className="forensic-vault-workspace">
                <aside className="forensic-vault-panel forensic-vault-dossiers" aria-label="Vault evidence files">
                    <div className="forensic-vault-panel-heading">
                        <div>
                            <span>Vault Evidence</span>
                            <strong>{selectedFiles.size} Selected</strong>
                        </div>
                        <button type="button" onClick={loadVaultFiles} className="forensic-vault-icon-button" aria-label="Refresh vault files">
                            <RefreshCw size={15} />
                        </button>
                    </div>

                    <label className="forensic-vault-search" aria-label="Search vault files">
                        <Search size={15} />
                        <input
                            value={fileSearch}
                            onChange={(event) => setFileSearch(event.target.value)}
                            placeholder="Search vault files..."
                        />
                        {fileSearch ? (
                            <button type="button" onClick={() => setFileSearch('')} aria-label="Clear vault search">
                                <X size={13} />
                            </button>
                        ) : null}
                    </label>

                    <div className="forensic-vault-dossier-actions">
                        <button type="button" onClick={selectAllVisible} disabled={filteredFiles.length === 0}>Select Visible</button>
                        <button type="button" onClick={selectNone} disabled={selectedFiles.size === 0}>Clear</button>
                    </div>

                    <div className="forensic-vault-health-row" aria-label="Vault file health">
                        <span><i className="forensic-vault-dot forensic-vault-dot-fresh" /> Fresh {availableFiles.filter((file) => getFreshnessTone(file) === 'fresh').length}</span>
                        <span><i className="forensic-vault-dot forensic-vault-dot-aged" /> Aged {availableFiles.filter((file) => getFreshnessTone(file) === 'aged').length}</span>
                        <span><i className="forensic-vault-dot forensic-vault-dot-archive" /> Archive {availableFiles.filter((file) => getFreshnessTone(file) === 'archive').length}</span>
                    </div>

                    <div className="forensic-vault-file-list">
                        {isLoadingFiles ? (
                            <div className="forensic-vault-empty-list">Scanning vault index...</div>
                        ) : filteredFiles.length === 0 ? (
                            <div className="forensic-vault-empty-list">No historical investigations found in the vault.</div>
                        ) : filteredFiles.map((file) => {
                            const selected = selectedFiles.has(file.filePath);
                            const tone = getFreshnessTone(file);
                            return (
                                <button
                                    key={file.filePath}
                                    type="button"
                                    onClick={() => toggleFileSelection(file.filePath)}
                                    className={`forensic-vault-file-row ${selected ? 'forensic-vault-file-row-selected' : ''}`}
                                    aria-label={`${selected ? 'Deselect' : 'Select'} vault file ${file.fileName}`}
                                >
                                    {selected ? <CheckSquare size={16} /> : <Square size={16} />}
                                    <FileText size={15} />
                                    <span className="forensic-vault-file-main">
                                        <strong title={file.fileName}>{file.fileName}</strong>
                                        <span className="forensic-vault-file-tags">
                                            {getFileTags(file.fileName).map((tag) => <i key={tag}>{tag}</i>)}
                                        </span>
                                    </span>
                                    <span className="forensic-vault-file-meta">
                                        <i className={`forensic-vault-dot forensic-vault-dot-${tone}`} />
                                        {formatDateTime(file.modTime)}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="forensic-vault-panel-footer">
                        <span>{availableFiles.length} files in vault</span>
                        <span>Coverage {selectedCoverage}%</span>
                    </div>
                </aside>

                <main className="forensic-vault-panel forensic-vault-transcript" aria-label="Interrogation transcript">
                    <div className="forensic-vault-panel-heading">
                        <div>
                            <span>Interrogation Transcript</span>
                            <strong>{messages.length} Messages</strong>
                        </div>
                        <button type="button" onClick={clearTranscript} className="forensic-vault-clear-button" disabled={messages.length === 0}>
                            Clear
                        </button>
                    </div>

                    <div className="forensic-vault-message-scroll">
                        {messages.length === 0 ? (
                            <div className="forensic-vault-empty-state">
                                <div className="forensic-vault-empty-icon">
                                    <Bot size={36} />
                                </div>
                                <span>Vault Chat Interface</span>
                                <p>Select vault evidence files, then interrogate only the gathered intelligence inside those files.</p>
                                <div className="forensic-vault-suggestion-grid">
                                    {readyQuestions.map((question) => (
                                        <button type="button" key={question} onClick={() => applyReadyQuestion(question)}>
                                            {question}
                                        </button>
                                    ))}
                                </div>
                                {showVaultQaTools ? (
                                    <button
                                        type="button"
                                        className="forensic-vault-qa-button"
                                        onClick={loadQaReadyQuestions}
                                    >
                                        Load QA Ready Questions
                                    </button>
                                ) : null}
                            </div>
                        ) : messages.map((msg) => (
                            <article key={msg.id} className={`forensic-vault-message forensic-vault-message-${msg.role}`}>
                                <div className="forensic-vault-message-icon">
                                    {msg.role === 'user' ? <User size={15} /> : <Bot size={15} />}
                                </div>
                                <div className="forensic-vault-message-card">
                                    <div className="forensic-vault-message-head">
                                        <span>{msg.role === 'user' ? 'You' : 'Gorantula Analyst'}</span>
                                        <strong>{formatDateTime(msg.createdAt)}</strong>
                                    </div>
                                    <div className="forensic-vault-markdown">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                            {msg.content}
                                        </ReactMarkdown>
                                    </div>
                                    {msg.role === 'assistant' ? (
                                        <div className="forensic-vault-message-evidence">
                                            <span>Cited Context</span>
                                            <div>
                                                {(msg.files || []).slice(0, 4).map((file) => <i key={file.filePath}>{file.fileName}</i>)}
                                                {(msg.files || []).length === 0 ? <i>No context snapshot</i> : null}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="forensic-vault-message-evidence">
                                            <span>Mode</span>
                                            <div><i>{QUERY_MODES.find((mode) => mode.id === msg.mode)?.label || 'Strict'}</i></div>
                                        </div>
                                    )}
                                </div>
                            </article>
                        ))}

                        {isWaiting && (
                            <div className="forensic-vault-message forensic-vault-message-assistant">
                                <div className="forensic-vault-message-icon"><Bot size={15} /></div>
                                <div className="forensic-vault-thinking">
                                    <span /> Gorantula analyst is reading selected evidence...
                                </div>
                            </div>
                        )}
                        <div ref={bottomRef} className="forensic-vault-scroll-anchor" />
                    </div>
                </main>

                <aside className="forensic-vault-panel forensic-vault-grounding" aria-label="Answer grounding">
                    <section>
                        <div className="forensic-vault-side-heading">
                            <span>Selected Sources</span>
                            <strong>{selectedFileRecords.length}</strong>
                        </div>
                        <div className="forensic-vault-source-list">
                            {selectedFileRecords.length === 0 ? (
                                <p>No evidence files selected yet.</p>
                            ) : selectedFileRecords.slice(0, 6).map((file) => (
                                <div key={file.filePath} className="forensic-vault-source-row">
                                    <span title={file.fileName}>{file.fileName}</span>
                                    <strong>{getFileTags(file.fileName).length || 1} tags</strong>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section>
                        <div className="forensic-vault-side-heading">
                            <span>Top Entities</span>
                            <strong>{selectedEntities.length}</strong>
                        </div>
                        <div className="forensic-vault-entity-cloud">
                            {selectedEntities.length === 0 ? <p>Choose files to extract entity hints.</p> : selectedEntities.map((entity) => <span key={entity}>{entity}</span>)}
                        </div>
                    </section>

                    {messages.length > 0 ? (
                        <section>
                            <div className="forensic-vault-side-heading">
                                <span>Ready Questions</span>
                                <strong>{readyQuestions.length}</strong>
                            </div>
                            <div className="forensic-vault-ready-question-list">
                                {readyQuestions.map((question) => (
                                    <button type="button" key={question} onClick={() => applyReadyQuestion(question)}>
                                        {question}
                                    </button>
                                ))}
                            </div>
                            {showVaultQaTools ? (
                                <button
                                    type="button"
                                    className="forensic-vault-qa-button forensic-vault-qa-button-compact"
                                    onClick={loadQaReadyQuestions}
                                >
                                    Load QA Ready Questions
                                </button>
                            ) : null}
                        </section>
                    ) : null}

                    <section>
                        <div className="forensic-vault-side-heading">
                            <span>Source Coverage</span>
                            <strong>{selectedCoverage}%</strong>
                        </div>
                        <div className="forensic-vault-coverage">
                            <span style={{ width: `${selectedCoverage}%` }} />
                        </div>
                        <p className="forensic-vault-side-copy">
                            {selectedFileRecords.length === 0
                                ? 'Select evidence files to bind the answer to specific archived intelligence.'
                                : `${selectedFileRecords.length} evidence file${selectedFileRecords.length === 1 ? '' : 's'} selected for grounded vault interrogation.`}
                        </p>
                    </section>
                </aside>
            </div>

            <footer className="forensic-vault-command-bar">
                <div className="forensic-vault-mode-panel">
                    <div className="forensic-vault-command-label">
                        <Layers3 size={14} />
                        Query Mode
                    </div>
                    <div className="forensic-vault-mode-toggle" role="group" aria-label="Vault query mode">
                        {QUERY_MODES.map((mode) => (
                            <button
                                key={mode.id}
                                type="button"
                                className={queryMode === mode.id ? 'forensic-vault-mode-active' : ''}
                                onClick={() => setQueryMode(mode.id)}
                                title={mode.hint}
                            >
                                {mode.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="forensic-vault-input-panel">
                    <textarea
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                handleSend();
                            }
                        }}
                        placeholder={selectedFiles.size > 0 ? 'Ask across selected evidence...' : 'Select vault evidence before interrogating the archive'}
                        disabled={selectedFiles.size === 0 || isWaiting || !socketReady}
                    />
                    <div className="forensic-vault-input-meta">
                        <span><MessageSquareText size={12} /> Shift + Enter for newline</span>
                        {!socketReady ? <strong><AlertTriangle size={12} /> WebSocket offline</strong> : <strong><ShieldCheck size={12} /> Grounded mode ready</strong>}
                    </div>
                </div>

                <button
                    type="button"
                    onClick={handleSend}
                    disabled={sendDisabled}
                    className="forensic-vault-send-button"
                >
                    <Send size={18} />
                    Interrogate
                </button>
            </footer>
        </section>
    );
}
