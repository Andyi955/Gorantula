package brain

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"spider-agent/models"
)

const (
	RabbitHoleToolWebSearch       = "web_search"
	RabbitHoleToolVaultSearch     = "vault_search"
	RabbitHoleToolTimelineContext = "timeline_context"

	RabbitHoleNodeStateProvisional = "provisional"
	RabbitHoleNodeStatePromoted    = "promoted"
	RabbitHoleNodeStateStale       = "stale"
)

type RabbitHoleToolTask struct {
	ID        string `json:"id"`
	Tool      string `json:"tool"`
	Query     string `json:"query"`
	Rationale string `json:"rationale"`
}

type RabbitHoleToolPlan struct {
	Tasks []RabbitHoleToolTask `json:"tasks"`
}

type RabbitHoleEvidenceRecord struct {
	Tool      string
	Query     string
	Source    string
	Content   string
	Rationale string
	NodeID    string
	Pass      int
}

type RabbitHolePlanningInput struct {
	OriginalPrompt    string
	PassNumber        int
	SuggestedQueries  []string
	EvidenceSummaries []string
}

func (b *Brain) planRabbitHoleToolTasks(ctx context.Context, input RabbitHolePlanningInput) ([]RabbitHoleToolTask, error) {
	provider := b.GetSearchProvider()
	if provider == nil {
		return fallbackRabbitHoleToolPlan(input.OriginalPrompt, input.PassNumber, input.SuggestedQueries).Tasks, nil
	}
	prompt := fmt.Sprintf(`You are the Rabbit Hole Planner for Gorantula.
Build an agentic tool plan for pass %d.

Original investigation:
%s

Gatekeeper suggested queries:
%s

Evidence already gathered:
%s

Available tools:
- web_search: search and fetch fresh web evidence
- vault_search: search older saved investigations and current vault memory
- timeline_context: extract chronological context and date conflicts from gathered evidence

Return ONLY JSON:
{
  "tasks": [
    {"tool":"web_search|vault_search|timeline_context","query":"concrete query","rationale":"why this tool matters"}
  ]
}

Use vault_search at least once when older investigation context could help. Use timeline_context when dates, permits, filings, announcements, hearings, or sequencing matter. Keep the plan focused.`, input.PassNumber, input.OriginalPrompt, strings.Join(input.SuggestedQueries, "\n"), strings.Join(input.EvidenceSummaries, "\n\n---\n\n"))

	var plan RabbitHoleToolPlan
	if err := b.generateJSONWithFallback(ctx, "rabbit hole planner", provider, prompt, &plan); err != nil {
		return nil, err
	}
	clean := sanitizeRabbitHoleToolPlan(plan)
	if len(clean.Tasks) == 0 {
		clean = fallbackRabbitHoleToolPlan(input.OriginalPrompt, input.PassNumber, input.SuggestedQueries)
	}
	return clean.Tasks, nil
}

func sanitizeRabbitHoleToolPlan(plan RabbitHoleToolPlan) RabbitHoleToolPlan {
	const maxTasks = 12
	safeTools := map[string]struct{}{
		RabbitHoleToolWebSearch:       {},
		RabbitHoleToolVaultSearch:     {},
		RabbitHoleToolTimelineContext: {},
	}
	seen := map[string]struct{}{}
	clean := make([]RabbitHoleToolTask, 0, len(plan.Tasks))
	for _, task := range plan.Tasks {
		tool := strings.ToLower(strings.TrimSpace(task.Tool))
		query := strings.TrimSpace(task.Query)
		if query == "" {
			continue
		}
		if _, ok := safeTools[tool]; !ok {
			continue
		}
		key := tool + "\x00" + strings.ToLower(query)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		clean = append(clean, RabbitHoleToolTask{
			ID:        fmt.Sprintf("rabbit-tool-%d", len(clean)+1),
			Tool:      tool,
			Query:     query,
			Rationale: strings.TrimSpace(task.Rationale),
		})
		if len(clean) >= maxTasks {
			break
		}
	}
	return RabbitHoleToolPlan{Tasks: clean}
}

func fallbackRabbitHoleToolPlan(prompt string, passNumber int, suggestedQueries []string) RabbitHoleToolPlan {
	baseQueries := []string{strings.TrimSpace(prompt)}
	baseQueries = append(baseQueries, suggestedQueries...)
	queries := make([]string, 0, len(baseQueries))
	for _, query := range baseQueries {
		query = strings.TrimSpace(query)
		if query != "" {
			queries = append(queries, query)
		}
	}
	if len(queries) == 0 {
		queries = []string{"Rabbit Hole investigation"}
	}

	tasks := []RabbitHoleToolTask{
		{Tool: RabbitHoleToolWebSearch, Query: queries[0], Rationale: "Gather fresh external evidence for the active descent."},
		{Tool: RabbitHoleToolVaultSearch, Query: queries[0], Rationale: "Search older investigations for matching entities, claims, and timelines."},
		{Tool: RabbitHoleToolTimelineContext, Query: queries[0], Rationale: "Extract dates and chronological pressure points from gathered evidence."},
	}
	if passNumber > 1 && len(queries) > 1 {
		tasks = append([]RabbitHoleToolTask{
			{Tool: RabbitHoleToolWebSearch, Query: strings.Join(queries, " "), Rationale: "Pursue Gatekeeper-suggested unresolved angles."},
		}, tasks[1:]...)
	}
	return sanitizeRabbitHoleToolPlan(RabbitHoleToolPlan{Tasks: tasks})
}

func buildRabbitHoleProvisionalNode(nutrient models.NutrientFlow, task RabbitHoleToolTask, vaultID string, passNumber int, index int) models.MemoryNode {
	title := rabbitHoleTitleFromTask(task, nutrient)
	summary := strings.TrimSpace(firstSentence(nutrient.Content))
	if summary == "" {
		summary = fmt.Sprintf("Rabbit Hole %s result for %q.", strings.ReplaceAll(task.Tool, "_", " "), task.Query)
	}
	fullText := strings.TrimSpace(nutrient.Content)
	if task.Rationale != "" {
		fullText = fmt.Sprintf("Rabbit tool: %s\nQuery: %s\nRationale: %s\n\n%s", task.Tool, task.Query, task.Rationale, fullText)
	}
	return models.MemoryNode{
		ID:          fmt.Sprintf("rabbit-%s-%d-%d-%d", safeNodeIDPart(vaultID), passNumber, time.Now().UnixNano(), index),
		Title:       title,
		Summary:     summary,
		FullText:    fullText,
		SourceURL:   strings.TrimSpace(nutrient.SourceURL),
		Origin:      "rabbit-hole",
		RabbitState: RabbitHoleNodeStateProvisional,
		RabbitTool:  task.Tool,
		RabbitPass:  passNumber,
		Confidence:  0.55,
	}
}

func (b *Brain) buildTaggedRabbitHoleProvisionalNode(ctx context.Context, nutrient models.NutrientFlow, task RabbitHoleToolTask, vaultID string, passNumber int, index int) models.MemoryNode {
	node := buildRabbitHoleProvisionalNode(nutrient, task, vaultID, passNumber, index)
	title, summary, err := b.summarizeNode(ctx, node.FullText)
	if err != nil || strings.TrimSpace(title) == "" || strings.TrimSpace(summary) == "" {
		return node
	}

	node.Title = title
	node.Summary = summary
	return node
}

func rabbitHoleTitleFromTask(task RabbitHoleToolTask, nutrient models.NutrientFlow) string {
	query := strings.TrimSpace(task.Query)
	if query == "" {
		query = strings.TrimSpace(nutrient.SourceURL)
	}
	words := strings.FieldsFunc(query, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	if len(words) == 0 {
		return "Rabbit Trail"
	}
	if len(words) > 5 {
		words = words[:5]
	}
	return strings.ToUpper(strings.Join(words, " "))
}

func firstSentence(text string) string {
	text = strings.Join(strings.Fields(text), " ")
	if text == "" {
		return ""
	}
	for _, delimiter := range []string{". ", "! ", "? ", "\n"} {
		if index := strings.Index(text, delimiter); index >= 80 {
			return strings.TrimSpace(text[:index+1])
		}
	}
	runes := []rune(text)
	if len(runes) > 260 {
		return strings.TrimSpace(string(runes[:260]))
	}
	return text
}

func safeNodeIDPart(raw string) string {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" {
		return "vault"
	}
	var builder strings.Builder
	for _, r := range raw {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			builder.WriteRune(r)
		}
	}
	if builder.Len() == 0 {
		return "vault"
	}
	return builder.String()
}

type rabbitVaultMatch struct {
	record RabbitHoleEvidenceRecord
	score  int
}

func searchRabbitHoleVaultMemoryInRoot(root string, currentVaultID string, query string, limit int) []RabbitHoleEvidenceRecord {
	root = strings.TrimSpace(root)
	if root == "" || limit <= 0 {
		return nil
	}
	queryTokens := rabbitHoleTokenSet(query)
	if len(queryTokens) == 0 {
		return nil
	}

	matches := []rabbitVaultMatch{}
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry == nil || entry.IsDir() {
			return nil
		}
		if strings.ToLower(filepath.Ext(path)) != ".md" {
			return nil
		}
		contentBytes, readErr := os.ReadFile(path)
		if readErr != nil {
			return nil
		}
		content := strings.TrimSpace(string(contentBytes))
		score := rabbitHoleTokenOverlap(queryTokens, content)
		if score <= 0 {
			return nil
		}
		vaultID := vaultIDFromMemoryPath(root, path)
		if vaultID != "" && vaultID == currentVaultID {
			return nil
		}
		matches = append(matches, rabbitVaultMatch{
			score: score,
			record: RabbitHoleEvidenceRecord{
				Tool:    RabbitHoleToolVaultSearch,
				Query:   query,
				Source:  "vault://" + filepath.ToSlash(strings.TrimPrefix(path, root+string(os.PathSeparator))),
				Content: rabbitHoleSnippet(content, queryTokens, 1200),
			},
		})
		return nil
	})

	sort.SliceStable(matches, func(i, j int) bool {
		if matches[i].score != matches[j].score {
			return matches[i].score > matches[j].score
		}
		return matches[i].record.Source < matches[j].record.Source
	})
	if len(matches) > limit {
		matches = matches[:limit]
	}
	records := make([]RabbitHoleEvidenceRecord, 0, len(matches))
	for _, match := range matches {
		records = append(records, match.record)
	}
	return records
}

func vaultIDFromMemoryPath(root string, path string) string {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return ""
	}
	parts := strings.Split(filepath.ToSlash(rel), "/")
	if len(parts) == 0 {
		return ""
	}
	return parts[0]
}

func rabbitHoleTokenSet(text string) map[string]struct{} {
	tokens := map[string]struct{}{}
	for _, token := range strings.FieldsFunc(strings.ToLower(text), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}) {
		if len(token) >= 4 {
			tokens[token] = struct{}{}
		}
	}
	return tokens
}

func rabbitHoleTokenOverlap(tokens map[string]struct{}, content string) int {
	contentTokens := rabbitHoleTokenSet(content)
	score := 0
	for token := range tokens {
		if _, ok := contentTokens[token]; ok {
			score++
		}
	}
	return score
}

func rabbitHoleSnippet(content string, tokens map[string]struct{}, limit int) string {
	if limit <= 0 {
		return ""
	}
	lower := strings.ToLower(content)
	bestIndex := 0
	for token := range tokens {
		if index := strings.Index(lower, token); index >= 0 {
			bestIndex = index
			break
		}
	}
	start := bestIndex - limit/4
	if start < 0 {
		start = 0
	}
	runes := []rune(content[start:])
	if len(runes) > limit {
		runes = runes[:limit]
	}
	return strings.TrimSpace(string(runes))
}

var rabbitHoleDatePattern = regexp.MustCompile(`\b(?:20\d{2}[-/]\d{2}[-/]\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2})\b`)

func buildRabbitHoleTimelineContext(records []RabbitHoleEvidenceRecord, query string) RabbitHoleEvidenceRecord {
	type datedLine struct {
		date   string
		source string
		line   string
	}
	lines := []datedLine{}
	for _, record := range records {
		for _, match := range rabbitHoleDatePattern.FindAllString(record.Content, -1) {
			lines = append(lines, datedLine{
				date:   normalizeRabbitHoleDate(match),
				source: record.Source,
				line:   firstSentence(record.Content),
			})
		}
	}
	sort.SliceStable(lines, func(i, j int) bool {
		return lines[i].date < lines[j].date
	})
	if len(lines) > 12 {
		lines = lines[:12]
	}
	var builder strings.Builder
	builder.WriteString("Rabbit Hole timeline context for: ")
	builder.WriteString(strings.TrimSpace(query))
	for _, line := range lines {
		builder.WriteString("\n- ")
		builder.WriteString(line.date)
		builder.WriteString(" :: ")
		builder.WriteString(line.source)
		builder.WriteString(" :: ")
		builder.WriteString(line.line)
	}
	if len(lines) == 0 {
		builder.WriteString("\n- No explicit dates found yet; use follow-up search to establish chronology.")
	}
	return RabbitHoleEvidenceRecord{
		Tool:    RabbitHoleToolTimelineContext,
		Query:   query,
		Source:  "rabbit://timeline-context",
		Content: builder.String(),
	}
}

func normalizeRabbitHoleDate(raw string) string {
	raw = strings.TrimSpace(raw)
	for _, layout := range []string{"2006-01-02", "2006/01/02", "January 2, 2006", "January 2 2006", "Jan 2, 2006", "Jan 2 2006"} {
		if parsed, err := time.Parse(layout, raw); err == nil {
			return parsed.Format("2006-01-02")
		}
	}
	return raw
}
