package ui

import (
	"fmt"
	"spider-agent/models"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

var (
	green  = lipgloss.NewStyle().Foreground(lipgloss.Color("41")).Bold(true)
	yellow = lipgloss.NewStyle().Foreground(lipgloss.Color("220")).Bold(true)
	gray   = lipgloss.NewStyle().Foreground(lipgloss.Color("240"))
	white  = lipgloss.NewStyle().Foreground(lipgloss.Color("252")).Bold(true)
	purple = lipgloss.NewStyle().Foreground(lipgloss.Color("93")).Bold(true)
	cyan   = lipgloss.NewStyle().Foreground(lipgloss.Color("51")).Bold(true)
)

type UIModel struct {
	State        models.SpiderUIModel
	CurrentTab   string // "spider" or "board"
	SynthesisRes string
	VaultPath    string
}

func InitialModel() UIModel {
	m := UIModel{
		CurrentTab: "spider",
		State: models.SpiderUIModel{
			BrainState:    "Idle",
			LegStates:     make(map[int]string),
			TotalGathered: 0,
		},
	}
	for i := 0; i < 8; i++ {
		m.State.LegStates[i] = "Idle"
	}
	return m
}

func (m UIModel) Init() tea.Cmd {
	return nil
}

func (m UIModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {

	case tea.KeyMsg:
		if msg.String() == "ctrl+c" || msg.String() == "q" {
			return m, tea.Quit
		}
		if msg.String() == "tab" {
			if m.CurrentTab == "spider" {
				m.CurrentTab = "board"
			} else {
				m.CurrentTab = "spider"
			}
		}

	case models.BrainStateMsg:
		m.State.BrainState = string(msg)

	case models.LegStateMsg:
		m.State.LegStates[msg.LegID] = msg.State

	case models.NutrientGatheredMsg:
		m.State.TotalGathered += 1

	case models.SynthesisCompleteMsg:
		m.SynthesisRes = msg.Result
		m.VaultPath = msg.VaultPath

	case models.QuitMsg:
		return m, tea.Quit
	}

	return m, nil
}

func (m UIModel) View() string {
	b := strings.Builder{}

	// Header Tabs
	spiderTab := " Spider View "
	boardTab := " Detective Board "
	if m.CurrentTab == "spider" {
		spiderTab = purple.Render(spiderTab)
		boardTab = gray.Render(boardTab)
	} else {
		spiderTab = gray.Render(spiderTab)
		boardTab = cyan.Render(boardTab)
	}
	b.WriteString(fmt.Sprintf("\n [%s|%s] (Press Tab to switch)\n\n", spiderTab, boardTab))

	if m.CurrentTab == "spider" {
		b.WriteString(purple.Render(fmt.Sprintf(" 🕷️  Brain State: %s\n", m.State.BrainState)))
		b.WriteString(" " + strings.Repeat("-", 60) + "\n")

		// ASCII Spider core
		b.WriteString(cyan.Render("        /\\  /\\ \n"))
		b.WriteString(cyan.Render("       /  \\/  \\ \n"))
		b.WriteString(cyan.Render("      |   ()   |\n"))
		b.WriteString(cyan.Render("       \\  /\\  /\n"))
		b.WriteString(cyan.Render("        \\/  \\/\n"))
		b.WriteString("\n")

		// Legs
		for i := 0; i < 8; i++ {
			state := m.State.LegStates[i]
			legStr := fmt.Sprintf("Leg %d: %s", i, state)
			if state == "Searching Brave" {
				b.WriteString(green.Render("  \\/  ") + legStr + "\n")
			} else if strings.HasPrefix(state, "Scraping") {
				b.WriteString(yellow.Render("  \\/  ") + legStr + "\n")
			} else {
				b.WriteString(gray.Render("  --  ") + legStr + "\n")
			}
		}

		b.WriteString(" " + strings.Repeat("-", 60) + "\n")
		b.WriteString(white.Render(fmt.Sprintf(" 🧪 Abdomen (Articles Digested): %d\n", m.State.TotalGathered)))

	} else {
		// Detective Board View
		b.WriteString(cyan.Render(" 📂 Vault Path: ") + m.VaultPath + "\n")
		b.WriteString(" " + strings.Repeat("-", 60) + "\n")
		if m.SynthesisRes == "" {
			b.WriteString(gray.Render(" Waiting for synthesis to complete...\n"))
		} else {
			// Limit output length so it fits on screen somewhat, or let tea handle it
			b.WriteString(m.SynthesisRes + "\n")
		}
	}

	b.WriteString("\n Press q to quit.\n")
	return b.String()
}
