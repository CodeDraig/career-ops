package data

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

var (
	reReportLink     = regexp.MustCompile(`\[(\d+)\]\(([^)]+)\)`)
	reScoreValue     = regexp.MustCompile(`(\d+\.?\d*)/5`)
	reSeparatorRow   = regexp.MustCompile(`^\|\s*:?-+:?(?:\s*\|\s*:?-+:?)*\s*\|?\s*$`)
	reArchetype      = regexp.MustCompile(`(?i)\*\*(?:Arquetipo|Archetype)(?:\s+(?:detectado|detected))?\*\*\s*\|\s*(.+)`)
	reTlDr           = regexp.MustCompile(`(?i)\*\*TL;DR\*\*\s*\|\s*(.+)`)
	reTlDrColon      = regexp.MustCompile(`(?i)\*\*TL;DR:\*\*\s*(.+)`)
	reRemote         = regexp.MustCompile(`(?i)\*\*Remote\*\*\s*\|\s*(.+)`)
	reComp           = regexp.MustCompile(`(?i)\*\*Comp\*\*\s*\|\s*(.+)`)
	reArchetypeColon = regexp.MustCompile(`(?i)\*\*(?:Arquetipo|Archetype):\*\*\s*(.+)`)
	reArchetypeYAML  = regexp.MustCompile(`(?m)^archetype:\s*"?([^"\n]+)"?\s*$`)
	reReportURL      = regexp.MustCompile(`(?m)^\*\*URL:\*\*\s*(https?://\S+)`)
	reBatchID        = regexp.MustCompile(`(?m)^\*\*Batch ID:\*\*\s*(\d+)`)
	reDiscardReasons = regexp.MustCompile(`(?s)discard_reasons:\s*\n((?:\s*-\s*.+?\n)+)`)
	reDiscardItem    = regexp.MustCompile(`\s*-\s*([^\n]+)`)
)

// resolveReportPath resolves relative to the tracker file and returns a data-root-relative path.
func resolveReportPath(careerOpsPath, trackerPath, link string) string {
	resolved := filepath.Join(filepath.Dir(trackerPath), link)
	if rel, err := filepath.Rel(careerOpsPath, resolved); err == nil {
		return rel
	}
	return link
}

func getRepoRoot() string {
	cwd, err := os.Getwd()
	if err != nil {
		return "."
	}
	current := cwd
	for {
		if _, err := os.Stat(filepath.Join(current, "path-resolver.mjs")); err == nil {
			return current
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	return cwd
}

func resolveTrackerPath(careerOpsPath string) string {
	if envTracker := strings.TrimSpace(os.Getenv("CAREER_OPS_TRACKER")); envTracker != "" {
		if filepath.IsAbs(envTracker) {
			return filepath.Clean(envTracker)
		}
		return filepath.Clean(filepath.Join(getRepoRoot(), envTracker))
	}
	return filepath.Clean(filepath.Join(careerOpsPath, "data", "applications.md"))
}

// ParseApplications reads applications.md and returns parsed applications.
func ParseApplications(careerOpsPath string) []model.CareerApplication {
	filePath := resolveTrackerPath(careerOpsPath)
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil
	}

	lines := strings.Split(string(content), "\n")
	apps := make([]model.CareerApplication, 0)
	num := 0

	// Map columns by header name rather than fixed position, so a customized or
	// reordered tracker (e.g. an inserted Location column) does not desync the
	// reader. An unsupported header yields no applications.
	// This matches the Node tracker tooling, which became header-aware in #954.
	cols := detectTrackerColumns(lines)
	if cols == nil {
		return nil
	}

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "# ") || reSeparatorRow.MatchString(line) || strings.HasPrefix(line, "| #") {
			continue
		}
		if !strings.HasPrefix(line, "|") {
			continue
		}
		// A recognized header can start with any column (or Num instead of #).
		// Use the same full-schema check as column detection, never a lone label.
		if detectTrackerColumns([]string{line}) != nil {
			continue
		}

		fields := splitTrackerRow(line)
		if len(fields) < 8 {
			continue
		}

		at := func(name string) string {
			if idx, ok := cols[name]; ok && idx >= 0 && idx < len(fields) {
				return fields[idx]
			}
			return ""
		}

		num++
		trackerNumber := num
		rawNumber := at("num")
		missingNumber := rawNumber == "" || strings.IndexFunc(rawNumber, func(r rune) bool { return r < '0' || r > '9' }) >= 0
		if parsedNumber, err := strconv.Atoi(rawNumber); err == nil && !missingNumber {
			trackerNumber = parsedNumber
		} else {
			missingNumber = true
		}
		app := model.CareerApplication{
			Number:               trackerNumber,
			TrackerNumberMissing: missingNumber,
			Date:                 at("date"),
			Company:              at("company"),
			Role:                 at("role"),
			JobURL:               extractCellURL(at("url")),
			Status:               at("status"),
			HasPDF:               strings.Contains(at("pdf"), "\u2705"),
			Location:             CanonicalizeLocation(at("location")),
		}

		// Parse score from the Score column.
		app.ScoreRaw = at("score")
		if sm := reScoreValue.FindStringSubmatch(at("score")); sm != nil {
			if score, err := strconv.ParseFloat(sm[1], 64); err == nil {
				app.Score = score
				app.HasScore = true
			}
		}

		// Parse report link. Tracker links are written relative to the
		// tracker file itself (e.g. ../reports/... when the tracker lives in
		// data/), so resolve against the tracker's directory and normalize
		// back to a careerOpsPath-relative path, which is what every
		// consumer joins against. Legacy root-relative links are kept as a
		// fallback when the resolved file does not exist.
		if rm := reReportLink.FindStringSubmatch(at("report")); rm != nil {
			app.ReportNumber = rm[1]
			app.ReportPath = resolveReportPath(careerOpsPath, filePath, rm[2])
		}

		// Notes column, when present.
		app.Notes = at("notes")

		// Lift location / work mode / pay / last-contact out of the notes free-text
		deriveNoteFields(&app)

		apps = append(apps, app)
	}

	// Enrich with job URLs using the tracker URL as tier zero, followed by the
	// legacy 5-tier strategy for trackers that predate the URL column:
	// 0. URL column in the tracker
	// 1. **URL:** field in report header (newest reports)
	// 2. **Batch ID:** in report -> batch-input.tsv URL lookup
	// 3. report_num -> batch-state completed mapping (legacy)
	// 4. scan-history.tsv (pipeline scan entries matched by company+role)
	// 5. company name fallback from batch-input.tsv
	batchURLs := loadBatchInputURLs(careerOpsPath)
	reportNumURLs := loadJobURLs(careerOpsPath)

	for i := range apps {
		if apps[i].JobURL != "" {
			continue
		}
		if apps[i].ReportPath == "" {
			continue
		}
		fullReport := filepath.Join(careerOpsPath, apps[i].ReportPath)
		reportContent, err := os.ReadFile(fullReport)
		if err != nil {
			continue
		}
		header := string(reportContent)
		// Only scan the header (first 1000 bytes) for speed
		if len(header) > 1000 {
			header = header[:1000]
		}

		// Strategy 1: **URL:** in report
		if m := reReportURL.FindStringSubmatch(header); m != nil {
			apps[i].JobURL = m[1]
			continue
		}

		// Strategy 2: **Batch ID:** -> batch-input.tsv
		if m := reBatchID.FindStringSubmatch(header); m != nil {
			if url, ok := batchURLs[m[1]]; ok {
				apps[i].JobURL = url
				continue
			}
		}

		// Strategy 3: report_num -> batch-state completed mapping
		if reportNumURLs != nil {
			if url, ok := reportNumURLs[apps[i].ReportNumber]; ok {
				apps[i].JobURL = url
				continue
			}
		}
	}

	// Strategy 4: scan-history.tsv (pipeline scan entries matched by company+role)
	enrichFromScanHistory(careerOpsPath, apps)

	// Strategy 5: company name fallback from batch-input.tsv
	enrichAppURLsByCompany(careerOpsPath, apps)

	return apps
}

// loadBatchInputURLs reads batch-input.tsv and returns a map of batch ID -> job URL.
func loadBatchInputURLs(careerOpsPath string) map[string]string {
	inputPath := filepath.Join(careerOpsPath, "batch", "batch-input.tsv")
	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		return nil
	}
	result := make(map[string]string)
	for _, line := range strings.Split(string(inputData), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) < 4 || fields[0] == "id" {
			continue
		}
		id := fields[0]
		notes := fields[3]
		// Extract real job URL from notes: "Title @ Company | Match% | https://actual-url"
		if idx := strings.LastIndex(notes, "| "); idx >= 0 {
			u := strings.TrimSpace(notes[idx+2:])
			if strings.HasPrefix(u, "http") {
				result[id] = u
				continue
			}
		}
		// Fallback: use JackJill URL
		if strings.HasPrefix(fields[1], "http") {
			result[id] = fields[1]
		}
	}
	return result
}

// batchEntry holds parsed data from batch-input.tsv.
type batchEntry struct {
	id      string
	url     string
	company string
	role    string
}

// loadJobURLs reads batch TSV files and returns a map of report_num -> job URL.
// Uses two strategies: (1) report_num mapping for completed jobs, (2) company name
// matching as fallback for failed/missing jobs.
func loadJobURLs(careerOpsPath string) map[string]string {
	// Read batch-input.tsv: id \t url \t source \t notes
	inputPath := filepath.Join(careerOpsPath, "batch", "batch-input.tsv")
	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		return nil
	}

	// Parse batch-input: extract job URL, company, and role from notes
	entries := make(map[string]batchEntry) // keyed by id
	for _, line := range strings.Split(string(inputData), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) < 4 || fields[0] == "id" {
			continue
		}
		e := batchEntry{id: fields[0]}
		notes := fields[3]

		// Extract URL from notes: "Title @ Company | Match% | https://actual-url"
		if idx := strings.LastIndex(notes, "| "); idx >= 0 {
			u := strings.TrimSpace(notes[idx+2:])
			if strings.HasPrefix(u, "http") {
				e.url = u
			}
		}
		// Fallback: use JackJill URL from field 1
		if e.url == "" && strings.HasPrefix(fields[1], "http") {
			e.url = fields[1]
		}

		// Extract company and role: "Role @ Company | Match% | URL"
		notesPart := notes
		if pipeIdx := strings.Index(notesPart, " | "); pipeIdx >= 0 {
			notesPart = notesPart[:pipeIdx]
		}
		if atIdx := strings.LastIndex(notesPart, " @ "); atIdx >= 0 {
			e.role = strings.TrimSpace(notesPart[:atIdx])
			e.company = strings.TrimSpace(notesPart[atIdx+3:])
		}

		if e.url != "" {
			entries[fields[0]] = e
		}
	}

	// Read batch-state.tsv: id \t url \t status \t ... \t report_num \t ...
	statePath := filepath.Join(careerOpsPath, "batch", "batch-state.tsv")
	stateData, err := os.ReadFile(statePath)
	if err != nil {
		return nil
	}

	// Strategy 1: map report_num -> URL only for COMPLETED jobs
	reportToURL := make(map[string]string)
	for _, line := range strings.Split(string(stateData), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) < 6 || fields[0] == "id" {
			continue
		}
		id := fields[0]
		status := fields[2]
		reportNum := fields[5]
		if status != "completed" || reportNum == "" || reportNum == "-" {
			continue
		}
		if e, ok := entries[id]; ok {
			reportToURL[reportNum] = e.url
			if len(reportNum) < 3 {
				reportToURL[fmt.Sprintf("%03s", reportNum)] = e.url
			}
		}
	}

	return reportToURL
}

// enrichFromScanHistory fills JobURL from scan-history.tsv by matching company name.
func enrichFromScanHistory(careerOpsPath string, apps []model.CareerApplication) {
	scanPath := filepath.Join(careerOpsPath, "scan-history.tsv")
	scanData, err := os.ReadFile(scanPath)
	if err != nil {
		return
	}

	// Build company -> URL index from scan-history
	type scanEntry struct {
		url     string
		company string
		title   string
	}
	byCompany := make(map[string][]scanEntry)
	for _, line := range strings.Split(string(scanData), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) < 5 || fields[0] == "url" {
			continue
		}
		url := fields[0]
		company := fields[4]
		title := fields[3]
		if url == "" || !strings.HasPrefix(url, "http") {
			continue
		}
		key := normalizeCompany(company)
		byCompany[key] = append(byCompany[key], scanEntry{url: url, company: company, title: title})
	}

	for i := range apps {
		if apps[i].JobURL != "" {
			continue
		}
		key := normalizeCompany(apps[i].Company)
		matches := byCompany[key]
		if len(matches) == 1 {
			apps[i].JobURL = matches[0].url
		} else if len(matches) > 1 {
			// Multiple entries: pick best role match
			appRole := strings.ToLower(apps[i].Role)
			best := matches[0].url
			bestScore := 0
			for _, m := range matches {
				score := 0
				mTitle := strings.ToLower(m.title)
				for _, word := range strings.Fields(appRole) {
					if len(word) > 2 && strings.Contains(mTitle, word) {
						score++
					}
				}
				if score > bestScore {
					bestScore = score
					best = m.url
				}
			}
			apps[i].JobURL = best
		}
	}
}

// normalizeCompany strips common suffixes and lowercases a company name.
func normalizeCompany(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	for _, suffix := range []string{" inc.", " inc", " llc", " ltd", " corp", " corporation", " technologies", " technology", " group", " co."} {
		s = strings.TrimSuffix(s, suffix)
	}
	return strings.TrimSpace(s)
}

// enrichAppURLsByCompany fills in JobURL for apps that didn't get one via report_num mapping.
// It matches by company name from batch-input.tsv notes.
func enrichAppURLsByCompany(careerOpsPath string, apps []model.CareerApplication) {
	inputPath := filepath.Join(careerOpsPath, "batch", "batch-input.tsv")
	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		return
	}

	// Build company -> []entry index
	type entry struct {
		role string
		url  string
	}
	byCompany := make(map[string][]entry)
	for _, line := range strings.Split(string(inputData), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) < 4 || fields[0] == "id" {
			continue
		}
		notes := fields[3]
		var url string
		if idx := strings.LastIndex(notes, "| "); idx >= 0 {
			u := strings.TrimSpace(notes[idx+2:])
			if strings.HasPrefix(u, "http") {
				url = u
			}
		}
		if url == "" && strings.HasPrefix(fields[1], "http") {
			url = fields[1]
		}
		if url == "" {
			continue
		}
		notesPart := notes
		if pipeIdx := strings.Index(notesPart, " | "); pipeIdx >= 0 {
			notesPart = notesPart[:pipeIdx]
		}
		if atIdx := strings.LastIndex(notesPart, " @ "); atIdx >= 0 {
			role := strings.TrimSpace(notesPart[:atIdx])
			company := strings.TrimSpace(notesPart[atIdx+3:])
			key := normalizeCompany(company)
			byCompany[key] = append(byCompany[key], entry{role: role, url: url})
		}
	}

	for i := range apps {
		if apps[i].JobURL != "" {
			continue
		}
		key := normalizeCompany(apps[i].Company)
		matches := byCompany[key]
		if len(matches) == 1 {
			apps[i].JobURL = matches[0].url
		} else if len(matches) > 1 {
			// Multiple entries for same company: pick best role match
			appRole := strings.ToLower(apps[i].Role)
			best := matches[0].url
			bestScore := 0
			for _, m := range matches {
				score := 0
				mRole := strings.ToLower(m.role)
				// Count matching words
				for _, word := range strings.Fields(appRole) {
					if len(word) > 2 && strings.Contains(mRole, word) {
						score++
					}
				}
				if score > bestScore {
					bestScore = score
					best = m.url
				}
			}
			apps[i].JobURL = best
		}
	}
}

// NormalizeStatus folds canonical English stage names without legacy aliases.
func NormalizeStatus(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}

// LoadReportSummary extracts key fields from a report file.
func LoadReportSummary(careerOpsPath, reportPath string) (archetype, tldr, remote, comp string) {
	fullPath := filepath.Join(careerOpsPath, reportPath)
	content, err := os.ReadFile(fullPath)
	if err != nil {
		return
	}
	text := string(content)

	if m := reArchetype.FindStringSubmatch(text); m != nil {
		archetype = cleanTableCell(m[1])
	} else if m := reArchetypeColon.FindStringSubmatch(text); m != nil {
		archetype = cleanTableCell(m[1])
	} else if m := reArchetypeYAML.FindStringSubmatch(text); m != nil {
		archetype = strings.TrimSpace(m[1])
	}

	// Try table-format TL;DR first (most reports), then colon format
	if m := reTlDr.FindStringSubmatch(text); m != nil {
		tldr = cleanTableCell(m[1])
	} else if m := reTlDrColon.FindStringSubmatch(text); m != nil {
		tldr = cleanTableCell(m[1])
	}

	if m := reRemote.FindStringSubmatch(text); m != nil {
		remote = cleanTableCell(m[1])
	}

	if m := reComp.FindStringSubmatch(text); m != nil {
		comp = cleanTableCell(m[1])
	}

	// Truncate long fields
	if len(tldr) > 120 {
		tldr = tldr[:117] + "..."
	}

	return
}

func UpdateApplicationStatus(careerOpsPath string, app model.CareerApplication, newStatus string) error {
	return UpdateApplicationStatusAndNotes(careerOpsPath, app, newStatus, "")
}

// UpdateApplicationStatusAndNotes delegates to the canonical writer so status,
// notes, the transition ledger and Applied follow-up seeding share one path.
// Notes use the CLI's idempotent "; " separator; empty notes are unchanged.
// Only the child takes the tracker lock: holding it here would deadlock.
func UpdateApplicationStatusAndNotes(careerOpsPath string, app model.CareerApplication, newStatus, notesAppend string) error {
	if strings.ContainsAny(notesAppend, "|\r\n\t") {
		return fmt.Errorf("notes cannot contain table delimiters or line breaks")
	}
	if !isCanonicalStatusName(newStatus) {
		return fmt.Errorf("unrecognized status: %q", newStatus)
	}
	if app.ReportNumber == "" {
		return fmt.Errorf("application has no report identity; use set-status.mjs --row to select a tracker row")
	}
	return runStatusWriter(careerOpsPath, app.ReportNumber, newStatus, notesAppend)
}

// Reject malformed UI input cheaply; the writer validates against states.yml.
func isCanonicalStatusName(status string) bool {
	switch strings.ToLower(status) {
	case "evaluated", "applied", "responded", "assessment", "interview", "offer", "hired", "rejected", "discarded", "skip":
		return true
	}
	return false
}

// cleanTableCell removes trailing pipes and whitespace from a table cell value.
func cleanTableCell(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimRight(s, "|")
	return strings.TrimSpace(s)
}

// LoadReportDiscardReasons parses predicted discard reasons from a report file.
func LoadReportDiscardReasons(careerOpsPath, reportPath string) []string {
	if reportPath == "" {
		return nil
	}
	p := reportPath
	if strings.Contains(p, "](") {
		idx := strings.Index(p, "](")
		p = p[idx+2:]
		p = strings.TrimSuffix(p, ")")
	}
	fullPath := filepath.Join(careerOpsPath, p)
	content, err := os.ReadFile(fullPath)
	if err != nil {
		return nil
	}
	text := string(content)

	match := reDiscardReasons.FindStringSubmatch(text)
	if len(match) < 2 {
		return nil
	}

	itemsMatch := reDiscardItem.FindAllStringSubmatch(match[1], -1)
	var reasons []string
	for _, item := range itemsMatch {
		reasons = append(reasons, strings.TrimSpace(item[1]))
	}
	return reasons
}

// SaveAnonymousStat records an anonymized win stat to data/reported-hires.tsv.
func SaveAnonymousStat(careerOpsPath string, role string, weeks int) error {
	dirPath := filepath.Join(careerOpsPath, "data")
	if err := os.MkdirAll(dirPath, 0755); err != nil {
		return err
	}
	filePath := filepath.Join(dirPath, "reported-hires.tsv")
	f, err := os.OpenFile(filePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()

	fi, err := f.Stat()
	if err == nil && fi.Size() == 0 {
		_, _ = f.WriteString("Date\tRoleType\tWeeksToHire\n")
	}

	dateStr := time.Now().Format("2006-01-02")
	_, err = f.WriteString(fmt.Sprintf("%s\t%s\t%d\n", dateStr, role, weeks))
	return err
}
