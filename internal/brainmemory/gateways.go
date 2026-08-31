package brainmemory

import (
	"errors"
	"sort"
	"strings"
	"time"
)

// The gateway registry makes gateways first-class, addressable matchers: every
// gateway has a stable code that firings and queries can reference, plus a
// human-readable definition explaining what it matches. The registry is
// persisted in brain vault state and seeded deterministically with the built-in
// recall gateways, so new gateways (pattern, claims, semantic/embedding) can be
// added later without changing the matching code.

const gatewaysFilename = "gateways.json"

const (
	GatewayKindRecall        = "recall"
	GatewayKindContradiction = "contradiction"
)

var ErrGatewayNotFound = errors.New("brain gateway not found")

type GatewayDefinition struct {
	Code        string `json:"code"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Kind        string `json:"kind"`
	Enabled     bool   `json:"enabled"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

// GatewayUsage summarises how much traffic a gateway has carried across the
// whole vault. Derived from persisted signals on read — no extra state to
// maintain.
type GatewayUsage struct {
	Definition         GatewayDefinition `json:"definition"`
	FiringCount        int               `json:"firingCount"`
	ActiveCount        int               `json:"activeCount"`
	InvestigationCount int               `json:"investigationCount"`
	LastFiredAt        string            `json:"lastFiredAt,omitempty"`
	TopSignalScore     float64           `json:"topSignalScore"`
	TopSignalTitle     string            `json:"topSignalTitle,omitempty"`
}

// GatewayRoute is one concrete "evidence -> gateway -> memory" trail: a signal
// that fired through this gateway, optionally narrowed to one matched value.
type GatewayRoute struct {
	SignalID              string   `json:"signalId"`
	InvestigationID       string   `json:"investigationId"`
	InvestigationTitle    string   `json:"investigationTitle"`
	TargetInvestigationID string   `json:"targetInvestigationId"`
	TargetTitle           string   `json:"targetTitle"`
	Value                 string   `json:"value"`
	Label                 string   `json:"label"`
	Detail                string   `json:"detail"`
	Score                 float64  `json:"score"`
	Relevance             string   `json:"relevance,omitempty"`
	ActivationCount       int      `json:"activationCount"`
	LastFiredAt           string   `json:"lastFiredAt,omitempty"`
	CurrentNodeIDs        []string `json:"currentNodeIds"`
	TargetNodeIDs         []string `json:"targetNodeIds"`
}

type GatewayDetail struct {
	Definition  GatewayDefinition `json:"definition"`
	Routes      []GatewayRoute    `json:"routes"`
	TotalRoutes int               `json:"totalRoutes"`
	FiringCount int               `json:"firingCount"`
	ActiveCount int               `json:"activeCount"`
}

func builtinGatewayDefinitions(now string) []GatewayDefinition {
	return []GatewayDefinition{
		{
			Code:        GatewayEntityDate,
			Name:        "Entity & Date",
			Description: "Fires when a named entity (person, organisation, location) or a calendar date from the current investigation appears in an older one.",
			Kind:        GatewayKindRecall,
			Enabled:     true,
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		{
			Code:        GatewaySourceDomain,
			Name:        "Source Domain",
			Description: "Fires when the current investigation and an older one cite sources from the same domain.",
			Kind:        GatewayKindRecall,
			Enabled:     true,
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		{
			Code:        GatewayRelationshipTag,
			Name:        "Relationship Tag",
			Description: "Fires when the same relationship tag connects evidence across the current and an older investigation.",
			Kind:        GatewayKindRecall,
			Enabled:     true,
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		{
			Code:        GatewayContradiction,
			Name:        "Contradiction",
			Description: "Fires when new evidence conflicts with claims remembered from an older case and needs verification.",
			Kind:        GatewayKindContradiction,
			Enabled:     true,
			CreatedAt:   now,
			UpdatedAt:   now,
		},
	}
}

func (s *Service) loadGateways() (map[string]GatewayDefinition, error) {
	gateways := []GatewayDefinition{}
	if err := s.loadBrainJSON(gatewaysFilename, &gateways); err != nil {
		return nil, err
	}
	byCode := make(map[string]GatewayDefinition, len(gateways))
	for _, gateway := range gateways {
		if strings.TrimSpace(gateway.Code) != "" {
			byCode[gateway.Code] = gateway
		}
	}
	return byCode, nil
}

func (s *Service) saveGateways(gateways map[string]GatewayDefinition) error {
	list := make([]GatewayDefinition, 0, len(gateways))
	for _, gateway := range gateways {
		list = append(list, gateway)
	}
	sort.SliceStable(list, func(i, j int) bool {
		return list[i].Code < list[j].Code
	})
	return s.saveBrainJSON(gatewaysFilename, list)
}

// ensureGatewayRegistryLocked seeds the built-in recall gateways on first use
// and returns the merged registry while s.mu is held. Persisted definitions
// win over built-ins (operators may rename or disable them later); custom
// gateways are preserved.
func (s *Service) ensureGatewayRegistryLocked() (map[string]GatewayDefinition, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	persisted, err := s.loadGateways()
	if err != nil {
		return nil, err
	}
	merged := make(map[string]GatewayDefinition, len(persisted)+4)
	for _, builtin := range builtinGatewayDefinitions(now) {
		if _, exists := persisted[builtin.Code]; !exists {
			merged[builtin.Code] = builtin
		}
	}
	changed := false
	for code, definition := range merged {
		if _, exists := persisted[code]; !exists {
			persisted[code] = definition
			changed = true
		}
	}
	if changed {
		if err := s.saveGateways(persisted); err != nil {
			return nil, err
		}
	}
	return persisted, nil
}

// ListGateways returns the registry with per-gateway usage derived from
// persisted signals. Read-only apart from first-run seeding.
func (s *Service) ListGateways() ([]GatewayUsage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	registry, err := s.ensureGatewayRegistryLocked()
	if err != nil {
		return nil, err
	}
	signals, err := s.loadSignals()
	if err != nil {
		return nil, err
	}

	usage := make(map[string]*GatewayUsage, len(registry))
	for code, definition := range registry {
		usage[code] = &GatewayUsage{Definition: definition}
	}
	for _, signal := range signals {
		for _, code := range signal.Gateways {
			stats, ok := usage[code]
			if !ok {
				continue
			}
			stats.FiringCount++
			if !signal.Dismissed && !signal.Linked {
				stats.ActiveCount++
			}
			if signal.Score > stats.TopSignalScore {
				stats.TopSignalScore = signal.Score
				stats.TopSignalTitle = signal.TargetTitle
			}
			if signal.LastFiredAt > stats.LastFiredAt {
				stats.LastFiredAt = signal.LastFiredAt
			}
		}
	}
	seenInvestigations := map[string]map[string]bool{}
	for _, signal := range signals {
		for _, code := range signal.Gateways {
			if _, ok := usage[code]; !ok {
				continue
			}
			if seenInvestigations[code] == nil {
				seenInvestigations[code] = map[string]bool{}
			}
			if !seenInvestigations[code][signal.InvestigationID] {
				seenInvestigations[code][signal.InvestigationID] = true
				usage[code].InvestigationCount++
			}
		}
	}

	result := make([]GatewayUsage, 0, len(usage))
	for _, stats := range usage {
		result = append(result, *stats)
	}
	sort.SliceStable(result, func(i, j int) bool {
		return result[i].Definition.Code < result[j].Definition.Code
	})
	return result, nil
}

// GatewayDetail resolves one gateway by code and lists its concrete routes:
// every persisted firing that went through it, optionally narrowed to a single
// matched value. This is the "new investigation can go look a gateway up" query.
func (s *Service) GatewayDetail(code string, value string) (GatewayDetail, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return GatewayDetail{}, ErrGatewayNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	registry, err := s.ensureGatewayRegistryLocked()
	if err != nil {
		return GatewayDetail{}, err
	}
	definition, ok := registry[code]
	if !ok {
		return GatewayDetail{}, ErrGatewayNotFound
	}
	signals, err := s.loadSignals()
	if err != nil {
		return GatewayDetail{}, err
	}

	detail := GatewayDetail{Definition: definition}
	value = strings.TrimSpace(value)
	for _, signal := range signals {
		if !signal.HasGateway(code) {
			continue
		}
		detail.FiringCount++
		if !signal.Dismissed && !signal.Linked {
			detail.ActiveCount++
		}
		for _, reason := range signal.Reasons {
			if reason.Gateway != code {
				continue
			}
			if value != "" && reason.Value != value && reason.Label != value {
				continue
			}
			detail.Routes = append(detail.Routes, GatewayRoute{
				SignalID:              signal.ID,
				InvestigationID:       signal.InvestigationID,
				InvestigationTitle:    signal.InvestigationTitle,
				TargetInvestigationID: signal.TargetInvestigationID,
				TargetTitle:           signal.TargetTitle,
				Value:                 reason.Value,
				Label:                 reason.Label,
				Detail:                reason.Detail,
				Score:                 signal.Score,
				Relevance:             signal.Relevance,
				ActivationCount:       signal.ActivationCount,
				LastFiredAt:           signal.LastFiredAt,
				CurrentNodeIDs:        reason.CurrentNodeIDs,
				TargetNodeIDs:         reason.TargetNodeIDs,
			})
		}
	}
	detail.TotalRoutes = len(detail.Routes)
	sort.SliceStable(detail.Routes, func(i, j int) bool {
		if detail.Routes[i].Score == detail.Routes[j].Score {
			return detail.Routes[i].LastFiredAt > detail.Routes[j].LastFiredAt
		}
		return detail.Routes[i].Score > detail.Routes[j].Score
	})
	return detail, nil
}
