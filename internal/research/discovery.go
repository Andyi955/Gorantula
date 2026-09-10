package research

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/Andyi955/Gorantula/models"
)

var discoveryMu sync.Mutex

// ErrDiscoveryNotFound is returned when a discovery id does not exist; it wraps
// os.ErrNotExist so the API layer maps it to 404.
var ErrDiscoveryNotFound = fmt.Errorf("discovery not found: %w", os.ErrNotExist)

// ErrDiscoveryRunning is returned when a caller tries to archive or delete a
// discovery whose background run is still writing its own record.
var ErrDiscoveryRunning = errors.New("discovery is still running; wait for it to finish")

// ErrDiscoveryNotRunning is returned when a caller tries to stop a round that
// has already finished.
var ErrDiscoveryNotRunning = errors.New("discovery is not running")

// discoveryCancels holds the cancel function of every in-flight round, keyed by
// run id, so an operator can stop one from the API. Guarded by discoveryMu.
var discoveryCancels = map[string]context.CancelFunc{}

func (s *Service) registerDiscoveryCancel(id string, cancel context.CancelFunc) {
	discoveryMu.Lock()
	defer discoveryMu.Unlock()
	discoveryCancels[id] = cancel
}

func (s *Service) clearDiscoveryCancel(id string) {
	discoveryMu.Lock()
	defer discoveryMu.Unlock()
	delete(discoveryCancels, id)
}

// StopDiscovery cancels an in-flight round. The round records what it had
// already established and marks every question it never reached as skipped, so
// a stopped round is still an honest record rather than a hole.
func (s *Service) StopDiscovery(id string) (models.DiscoveryRun, error) {
	discoveryMu.Lock()
	run, err := s.loadDiscovery(id)
	if err != nil {
		discoveryMu.Unlock()
		return run, err
	}
	cancel := discoveryCancels[id]
	discoveryMu.Unlock()
	if run.Status != "running" {
		return run, ErrDiscoveryNotRunning
	}
	if cancel == nil {
		// The process restarted, or the goroutine already exited: record the
		// stop so the round does not sit at "running" forever.
		run.Status = "stopped"
		run.StopReason = "stopped by the operator"
		run.CompletedAt = time.Now().UTC().Format(time.RFC3339)
		if err := s.saveDiscovery(run); err != nil {
			return run, err
		}
		return run, nil
	}
	cancel()
	return s.GetDiscovery(id)
}

func (s *Service) discoveryStore() *Store {
	return NewStore(filepath.Join(s.store.root, "discoveries"))
}

// StartDiscovery generates `count` candidate research questions (grounded in a
// scan of open-data repositories and any corpus evidence for the theme), runs
// each through the topic pipeline, and scores them as a worked discovery (a
// recorded computation/figure) or a no-data rejection. It runs asynchronously
// and returns the run id immediately; callers poll GetDiscovery for progress.
func (s *Service) StartDiscovery(ctx context.Context, theme string, count int, stopOnResult bool) (models.DiscoveryRun, error) {
	if count < 1 {
		count = 1
	}
	if count > 4 {
		count = 4
	}
	if s.brain == nil {
		return models.DiscoveryRun{}, fmt.Errorf("discovery needs a model provider")
	}
	token := make([]byte, 16)
	if _, err := rand.Read(token); err != nil {
		return models.DiscoveryRun{}, err
	}
	run := models.DiscoveryRun{
		ID:           hex.EncodeToString(token),
		Theme:        strings.TrimSpace(theme),
		Status:       "running",
		CreatedAt:    time.Now().UTC().Format(time.RFC3339),
		Questions:    make([]models.DiscoveryQuestion, 0, count),
		StopOnResult: stopOnResult,
	}
	if err := s.saveDiscovery(run); err != nil {
		return models.DiscoveryRun{}, err
	}
	// Run the discovery in the background with a context NOT tied to the HTTP
	// request, which is cancelled as soon as the handler returns. The context is
	// kept so an operator can stop the round from the API.
	runCtx, cancel := context.WithCancel(context.Background())
	s.registerDiscoveryCancel(run.ID, cancel)
	go s.executeDiscovery(runCtx, run, count)
	return run, nil
}

func (s *Service) saveDiscovery(run models.DiscoveryRun) error {
	discoveryMu.Lock()
	defer discoveryMu.Unlock()
	return s.saveDiscoveryLocked(run)
}

// saveDiscoveryLocked writes a discovery record; the caller must already hold
// discoveryMu, so callers that mutate a run under the lock never re-enter it.
func (s *Service) saveDiscoveryLocked(run models.DiscoveryRun) error {
	return s.discoveryStore().saveSlice(run.ID+".json", run)
}

func (s *Service) loadDiscovery(id string) (models.DiscoveryRun, error) {
	var run models.DiscoveryRun
	if !verificationID.MatchString(id) {
		return run, ErrDiscoveryNotFound
	}
	err := s.discoveryStore().readJSON(id+".json", &run)
	if err != nil || run.ID != id {
		return run, ErrDiscoveryNotFound
	}
	return run, nil
}

// ListDiscoveries returns discovery runs that have not been archived.
func (s *Service) ListDiscoveries() ([]models.DiscoveryRun, error) {
	all, err := s.listAllDiscoveries()
	if err != nil {
		return nil, err
	}
	out := make([]models.DiscoveryRun, 0, len(all))
	for _, run := range all {
		if run.Dismissed {
			continue
		}
		out = append(out, run)
	}
	return out, nil
}

// ListDiscoveriesIncludingDismissed returns every discovery run, archived ones
// included, so a caller can show and restore dismissed runs.
func (s *Service) ListDiscoveriesIncludingDismissed() ([]models.DiscoveryRun, error) {
	return s.listAllDiscoveries()
}

// listAllDiscoveries returns every stored run in jsonIDs order, dismissed or not.
func (s *Service) listAllDiscoveries() ([]models.DiscoveryRun, error) {
	discoveryMu.Lock()
	defer discoveryMu.Unlock()
	ids, err := jsonIDs(s.discoveryStore().root)
	if err != nil {
		return nil, err
	}
	out := make([]models.DiscoveryRun, 0, len(ids))
	for _, id := range ids {
		run, err := s.loadDiscovery(id)
		if err != nil {
			continue
		}
		out = append(out, run)
	}
	return out, nil
}

// DismissDiscovery archives a discovery run: it is retained on disk with a
// dismissed marker and timestamp and hidden from the default listing, exactly
// like a dismissed brain suggestion. RestoreDiscovery reverses it.
func (s *Service) DismissDiscovery(id string) (models.DiscoveryRun, error) {
	discoveryMu.Lock()
	defer discoveryMu.Unlock()
	run, err := s.loadDiscovery(id)
	if err != nil {
		return run, err
	}
	if run.Status == "running" {
		return models.DiscoveryRun{}, ErrDiscoveryRunning
	}
	run.Dismissed = true
	if run.DismissedAt == "" {
		run.DismissedAt = time.Now().UTC().Format(time.RFC3339)
	}
	if err := s.saveDiscoveryLocked(run); err != nil {
		return models.DiscoveryRun{}, err
	}
	return run, nil
}

// RestoreDiscovery un-archives a dismissed discovery run.
func (s *Service) RestoreDiscovery(id string) (models.DiscoveryRun, error) {
	discoveryMu.Lock()
	defer discoveryMu.Unlock()
	run, err := s.loadDiscovery(id)
	if err != nil {
		return run, err
	}
	run.Dismissed = false
	run.DismissedAt = ""
	if err := s.saveDiscoveryLocked(run); err != nil {
		return models.DiscoveryRun{}, err
	}
	return run, nil
}

// DeleteDiscovery permanently removes a discovery run's record from disk.
func (s *Service) DeleteDiscovery(id string) error {
	discoveryMu.Lock()
	defer discoveryMu.Unlock()
	if !verificationID.MatchString(id) {
		return ErrDiscoveryNotFound
	}
	run, err := s.loadDiscovery(id)
	if err != nil {
		return err
	}
	if run.Status == "running" {
		return ErrDiscoveryRunning
	}
	if err := os.Remove(filepath.Join(s.discoveryStore().root, id+".json")); err != nil {
		if os.IsNotExist(err) {
			return ErrDiscoveryNotFound
		}
		return err
	}
	return nil
}

// GetDiscovery returns one discovery run with its per-question progress.
func (s *Service) GetDiscovery(id string) (models.DiscoveryRun, error) {
	return s.loadDiscovery(id)
}

func (s *Service) executeDiscovery(ctx context.Context, run models.DiscoveryRun, count int) {
	defer func() {
		if run.Status == "running" {
			run.Status = "completed"
		}
		// A stopped or failed round is finished too, so it gets a completion time
		// rather than looking like it is still in flight.
		if run.CompletedAt == "" {
			run.CompletedAt = time.Now().UTC().Format(time.RFC3339)
		}
		_ = s.saveDiscovery(run)
		s.clearDiscoveryCancel(run.ID)
	}()
	questions, err := s.generateDiscoveryQuestions(ctx, run.Theme, count)
	if err != nil {
		run.Status = "failed"
		run.Error = err.Error()
		return
	}
	run.Planned = len(questions)
	_ = s.saveDiscovery(run)

	// Mark every question the round will not reach, so a stopped or early-ended
	// round still accounts for the questions it proposed.
	skipRemaining := func(from int, reason string) {
		run.Questions = append(run.Questions, skippedDiscoveryQuestions(questions, from, reason)...)
	}

	for index, question := range questions {
		if ctx.Err() != nil {
			run.Status = "stopped"
			run.StopReason = "stopped by the operator"
			skipRemaining(index, "not run: the round was stopped")
			return
		}
		// Publish the question while it runs: without this the record only grows
		// when a question finishes, so a caller cannot see what is in flight.
		run.Questions = append(run.Questions, models.DiscoveryQuestion{
			ID:       hex.EncodeToString(randToken(8)),
			Question: question,
			Status:   "running",
		})
		_ = s.saveDiscovery(run)

		result := s.runDiscoveryQuestion(ctx, run.ID, question)
		if ctx.Err() != nil {
			// The round was stopped mid-question; the verification run also has to
			// be cancelled or it keeps working with nobody waiting for it.
			if result.RunID != "" {
				_ = s.CancelVerification(result.RunID)
			}
			result.Status = "stopped"
			// The operator-facing reason, not the raw "context canceled".
			result.Error = "stopped by the operator"
		}
		if len(run.Questions) > 0 {
			run.Questions[len(run.Questions)-1] = result
		}
		run.WorkedCount, run.RejectedCount = discoveryOutcomeCounts(run.Questions)
		_ = s.saveDiscovery(run)

		if ctx.Err() != nil {
			run.Status = "stopped"
			run.StopReason = "stopped by the operator"
			skipRemaining(index+1, "not run: the round was stopped")
			return
		}
		if run.StopOnResult && result.Status == "completed" {
			run.StopReason = "stopped early: this question produced a result"
			skipRemaining(index+1, "not run: the round stops at the first result")
			return
		}
	}
	run.WorkedCount, run.RejectedCount = discoveryOutcomeCounts(run.Questions)
}

// skippedDiscoveryQuestions records the questions a round proposed but never
// reached, so the record accounts for every question rather than hiding them.
func skippedDiscoveryQuestions(questions []string, from int, reason string) []models.DiscoveryQuestion {
	if from >= len(questions) {
		return nil
	}
	out := make([]models.DiscoveryQuestion, 0, len(questions)-from)
	for _, question := range questions[from:] {
		out = append(out, models.DiscoveryQuestion{
			ID:       hex.EncodeToString(randToken(8)),
			Question: question,
			Status:   "skipped",
			Error:    reason,
		})
	}
	return out
}

// discoveryOutcomeCounts scores a round from its questions, so a partially run
// round reports the same numbers a finished one would.
func discoveryOutcomeCounts(questions []models.DiscoveryQuestion) (worked int, rejected int) {
	for _, question := range questions {
		switch question.Status {
		case "completed":
			worked++
		case "rejected":
			rejected++
		}
	}
	return worked, rejected
}

// generateDiscoveryQuestions uses the LLM to propose `count` specific, testable
// research questions. To keep them grounded and computable, it scans open-data
// repositories for the theme (or a default discovery theme) and hands the LLM
// real dataset titles plus any corpus claims, and asks for questions a dataset
// or computation can actually answer.
func (s *Service) generateDiscoveryQuestions(ctx context.Context, theme string, count int) ([]string, error) {
	theme = strings.TrimSpace(theme)
	// Dismissed runs still count as prior work, so this reads every stored run
	// once and uses it for both seed rotation and question de-duplication.
	previous, _ := s.listAllDiscoveries()
	seeds := []string{theme}
	if theme == "" {
		seeds = rotatedDiscoverySeeds(len(previous))
	}
	var datasetMentions []string
	seen := map[string]bool{}
	for _, seed := range seeds {
		candidates, err := searchOpenData(ctx, seed)
		if err != nil {
			continue
		}
		for _, c := range candidates {
			if !seen[c.Name] && len(datasetMentions) < 12 {
				seen[c.Name] = true
				datasetMentions = append(datasetMentions, c.Name+" ("+c.Provider+", file "+c.File+")")
			}
		}
		if len(datasetMentions) >= 6 {
			break
		}
	}
	corpus, _ := s.ListClaims()
	var claimHints []string
	for _, c := range corpus {
		if len(claimHints) >= 8 {
			break
		}
		claimHints = append(claimHints, fmt.Sprintf("[%s] %s", c.ID, truncateRunes(c.Text, 160)))
	}
	payload, _ := json.Marshal(map[string]interface{}{"theme": theme, "datasets": datasetMentions, "corpusClaims": claimHints})
	var resp struct {
		Questions []string `json:"questions"`
	}
	out := make([]string, 0, count)
	accepted := make([]string, 0, count)
	// Avoid re-running the same question (in any wording) across discovery runs.
	var priorQuestions []string
	for _, prev := range previous {
		for _, q := range prev.Questions {
			if strings.TrimSpace(q.Question) != "" {
				priorQuestions = append(priorQuestions, q.Question)
			}
		}
	}
	isDuplicate := func(q string) bool {
		for _, p := range priorQuestions {
			if discoveryQuestionDuplicateSemantic(q, p) {
				return true
			}
		}
		for _, a := range accepted {
			if discoveryQuestionDuplicateSemantic(q, a) {
				return true
			}
		}
		return false
	}
	// The model occasionally returns no usable questions, usually because every
	// suggestion duplicates an earlier round. Retry, telling it what it already
	// proposed so it moves on instead of reformulating the same idea three times.
	var lastErr error
	var repeated []string
	for attempt := 0; attempt < 3; attempt++ {
		out = out[:0]
		accepted = accepted[:0]
		resp.Questions = nil
		prompt := `You propose ` + fmt.Sprintf("%d", count) + ` SPECIFIC, TESTABLE scientific research questions. Every question must be answerable with a computation on real data (a group comparison or a correlation), never vague or philosophical. Name a data source ONLY if it appears in the CONTEXT below, and copy that dataset's exact file name into the question (for example "In analysis_data.csv, does X correlate with Y"). Never name a repository, survey or dataset from your own knowledge (GBIF, eBird, World Bank, WHO and the like): if it is not in CONTEXT the question cannot be computed, and the round is wasted. Ask about variables that the named dataset actually contains, using only a group comparison or a correlation on its columns. Do not invent data. If the theme is empty, choose across different fields. Return JSON {"questions":["one plain question each, maximum 90 characters"]}. Requested count: ` + fmt.Sprintf("%d", count) + `. CONTEXT: ` + string(payload)
		if len(repeated) > 0 {
			prompt += ` These questions have already been asked in earlier rounds; do NOT repeat them or reword them. Move to a different field or a different variable: ` + strings.Join(repeated, " | ") + `.`
		}
		lastErr = s.brain.GetSearchProvider().GenerateJSON(ctx, prompt, &resp)
		if lastErr != nil {
			continue
		}
		for _, q := range resp.Questions {
			q = strings.TrimSpace(q)
			if q == "" || len(q) > 200 {
				continue
			}
			if strings.HasSuffix(q, "?") {
				q = strings.TrimSuffix(q, "?")
			}
			if isDuplicate(q) {
				if len(repeated) < 20 {
					repeated = append(repeated, q)
				}
				continue
			}
			out = append(out, q)
			accepted = append(accepted, q)
			if len(out) == count {
				break
			}
		}
		if len(out) > 0 {
			return out, nil
		}
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("the model did not propose any bounded research question")
}

// runDiscoveryQuestion runs one question through the topic verification pipeline
// and scores it: a recorded computation counts as a worked discovery, an honest
// no-data finish counts as rejected, and anything else counts as failed.
func (s *Service) runDiscoveryQuestion(ctx context.Context, discoveryID, question string) models.DiscoveryQuestion {
	q := models.DiscoveryQuestion{ID: hex.EncodeToString(randToken(8)), Question: question, Status: "failed"}
	// Dataset-first: find and register a dataset for this question, then seed the
	// run with it so the verification agent computes on that data instead of
	// re-searching papers and rejecting.
	datasetID := ""
	if candidates, err := searchOpenData(ctx, question); err == nil && len(candidates) > 0 {
		// Only seed with a dataset the model judges able to answer the question.
		// The search happily returns topically adjacent files (a precipitation
		// table for a question about Bayesian extrapolation), and a seeded run
		// then computes something real on the wrong data.
		checked := 0
		for _, c := range candidates {
			if checked >= discoveryDatasetChecks {
				break
			}
			data, _, ferr := downloadOpenDataset(ctx, c)
			if ferr != nil {
				continue
			}
			checked++
			if !s.discoveryDatasetFits(ctx, question, c, csvHeaderColumns(data)) {
				trace("discovery", fmt.Sprintf("skipped unrelated dataset %q for %q", truncateRunes(c.Name, 60), truncateRunes(question, 60)))
				continue
			}
			d, derr := s.RegisterDataset(c.Name+" (discovery)", "Open-data repository: "+c.Provider+"; file "+c.File+"; provenance unverified", string(data))
			if derr != nil {
				continue
			}
			datasetID = d.ID
			break
		}
	}
	vr, err := s.StartVerification(models.VerificationRequest{Mode: "agent", Topic: question, DatasetID: datasetID, AutoPrepare: true})
	if err != nil {
		q.Error = err.Error()
		return q
	}
	q.RunID = vr.ID
	deadline := time.Now().Add(10 * time.Minute)
	for {
		if time.Now().After(deadline) {
			q.Error = "discovery question timed out"
			return q
		}
		select {
		case <-ctx.Done():
			q.Error = ctx.Err().Error()
			return q
		case <-time.After(3 * time.Second):
		}
		current, err := s.GetVerificationRun(vr.ID)
		if err != nil {
			q.Error = err.Error()
			return q
		}
		if current.Status != "running" && current.Status != "queued" {
			hasResult := false
			for _, res := range current.Results {
				if res.Status == "completed" {
					hasResult = true
				}
			}
			q.Status = "rejected"
			if hasResult {
				q.Status = "completed"
				q.HasResult = true
			}
			q.ResultsCount = len(current.Results)
			q.PublicationID = current.PublicationID
			q.Hypothesis = current.Candidate.Hypothesis
			q.Interpretation = strings.TrimSpace(current.Interpretation)
			q.Error = current.Error
			return q
		}
	}
}

// discoverySeedPool is scanned when no theme is given. The window rotates with
// the number of prior runs: a fixed list made consecutive blank-theme batches
// converge on the same few fields, and the model then re-proposed variants of
// the same questions until de-duplication rejected every one of them.
var discoverySeedPool = []string{
	"ecology", "health", "climate", "agriculture", "metabolism",
	"marine biology", "nutrition", "forestry", "soil science", "economics",
}

func rotatedDiscoverySeeds(priorRuns int) []string {
	start := priorRuns % len(discoverySeedPool)
	seeds := make([]string, 0, 3)
	for i := 0; i < 3; i++ {
		seeds = append(seeds, discoverySeedPool[(start+i)%len(discoverySeedPool)])
	}
	return seeds
}

func randToken(n int) []byte {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return b
}

// discoveryDatasetChecks bounds how many candidate files are downloaded and
// judged per question. Providers are pooled, so this must be large enough to
// reach past a provider's loose keyword match to the right file.
const discoveryDatasetChecks = 5

// csvHeaderColumns returns the header names of a CSV payload for the relevance
// judgement. It tolerates a BOM and gives up quietly on anything unparseable.
func csvHeaderColumns(data []byte) []string {
	line, _, _ := strings.Cut(strings.TrimPrefix(string(data), "\ufeff"), "\n")
	fields := strings.Split(strings.TrimRight(line, "\r"), ",")
	if len(fields) > 32 {
		fields = fields[:32]
	}
	for i := range fields {
		fields[i] = strings.TrimSpace(fields[i])
	}
	return fields
}

// datasetAnswersQuestion asks the model whether a table's columns contain the
// variables a question needs, and requires it to name at least one column that
// actually exists. A bare "yes" is not enough, and the check fails open when no
// model is available, so it can never block every run.
func (s *Service) datasetAnswersQuestion(ctx context.Context, question, name, description string, columns []string) bool {
	if s.brain == nil || s.brain.GetSearchProvider() == nil {
		return true
	}
	prompt := fmt.Sprintf(`You decide whether a dataset can answer a research question using only a group comparison or a correlation on its own columns.
QUESTION: %s
DATASET: %s
DESCRIPTION: %s
COLUMNS: %s
Answer JSON {"relevant":true|false,"columns":["exact column names from COLUMNS you would use"]}.
Set relevant true only when the listed columns measure the exact quantities the question names. A column that measures a related but different quantity is NOT relevant, even when the topic is adjacent: healthy life expectancy is not life expectancy; per capita income is not GDP per capita unless the column is per capita; prevalence is not incidence. Name the columns you would use and nothing else.`, question, name, truncateRunes(description, 300), strings.Join(columns, ", "))
	var resp struct {
		Relevant bool     `json:"relevant"`
		Columns  []string `json:"columns"`
	}
	if err := s.brain.GetSearchProvider().GenerateJSON(ctx, prompt, &resp); err != nil {
		trace("discovery", fmt.Sprintf("relevance check unavailable for %q: %v", truncateRunes(question, 60), err))
		return true
	}
	if !resp.Relevant {
		return false
	}
	// The model must point at a real column, otherwise "relevant" is unsupported.
	for _, named := range resp.Columns {
		named = strings.ToLower(strings.TrimSpace(named))
		if named == "" {
			continue
		}
		for _, actual := range columns {
			if strings.ToLower(strings.TrimSpace(actual)) == named {
				return true
			}
		}
	}
	return false
}

// discoveryDatasetFits is the open-data candidate form of the relevance check.
func (s *Service) discoveryDatasetFits(ctx context.Context, question string, candidate openDataset, columns []string) bool {
	return s.datasetAnswersQuestion(ctx, question, candidate.Name, candidate.Description, columns)
}

// discoveryDedupStopwords are generic question scaffolding, not content. Subject
// nouns and measured variables (penguin, body mass, yield, richness…) are kept,
// so "species differ in body mass" and "penguins differ in mass" stay distinct
// while differently-worded phrasings of the SAME claim collide.
var discoveryDedupStopwords = map[string]bool{
	"do": true, "does": true, "is": true, "are": true, "was": true, "were": true,
	"what": true, "how": true, "can": true, "would": true, "could": true, "which": true,
	"the": true, "a": true, "an": true, "and": true, "or": true, "of": true,
	"in": true, "on": true, "to": true, "for": true, "with": true, "by": true,
	"between": true, "among": true, "than": true, "from": true, "vs": true, "versus": true,
	"differ": true, "differently": true, "difference": true, "different": true,
	"correlate": true, "correlates": true, "correlation": true, "related": true,
	"associated": true, "effect": true, "effects": true, "affect": true, "affects": true,
	"change": true, "changes": true, "increase": true, "decrease": true, "lower": true,
	"higher": true, "more": true, "less": true, "same": true, "not": true,
	"its": true, "their": true, "there": true, "be": true,
}

// discoveryQuestionWords returns the content words of a question, lowercased and
// with generic scaffolding removed.
func discoveryQuestionWords(q string) []string {
	var out []string
	for _, w := range strings.FieldsFunc(strings.ToLower(q), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}) {
		if w == "" || discoveryDedupStopwords[w] {
			continue
		}
		out = append(out, w)
	}
	return out
}

// discoveryWordMatch reports whether two content words are the same for dedup
// purposes: exact match, or one is a prefix of the other (so penguin/penguins
// collide without mangling words like iris or species).
func discoveryWordMatch(a, b string) bool {
	if a == b {
		return true
	}
	if len(a) >= 3 && len(b) >= 3 && (strings.HasPrefix(a, b) || strings.HasPrefix(b, a)) {
		return true
	}
	return false
}

// discoveryQuestionDuplicateSemantic reports whether two questions are
// near-duplicates (same meaning, possibly different wording) using Jaccard
// overlap on content words. Identical questions collide; a generic and a
// specific question (species vs penguins) generally do not.
func discoveryQuestionDuplicateSemantic(a, b string) bool {
	wa := discoveryQuestionWords(a)
	wb := discoveryQuestionWords(b)
	if len(wa) == 0 || len(wb) == 0 {
		return false
	}
	shared := 0
	for _, aw := range wa {
		for _, bw := range wb {
			if discoveryWordMatch(aw, bw) {
				shared++
				break
			}
		}
	}
	union := len(wa) + len(wb) - shared
	if union == 0 {
		return false
	}
	return float64(shared)/float64(union) >= 0.5
}
