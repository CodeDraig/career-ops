package data

import "strings"

// splitTrackerRow splits pipe-delimited Markdown cells; tabs are cell whitespace.
func splitTrackerRow(line string) []string {
	fields := strings.Split(strings.Trim(strings.TrimSpace(line), "|"), "|")
	for i := range fields {
		fields[i] = strings.TrimSpace(fields[i])
	}
	return fields
}

// trackerHeaderAliases maps a lowercased header cell to a canonical field name.
// Mirrors tracker-aliases.json, which Node and web load directly. Keep the full
// table in sync; TestTrackerHeaderAliasesMatchSharedJSON guards exact parity.
var trackerHeaderAliases = map[string]string{
	"#":          "num",
	"num":        "num",
	"date":       "date",
	"company":    "company",
	"via":        "via",
	"role":       "role",
	"location":   "location",
	"score":      "score",
	"status":     "status",
	"pdf":        "pdf",
	"report":     "report",
	"apply link": "applylink",
	"follow-up":  "followup",
	"notes":      "notes",
	"url":        "url",
}

// detectTrackerColumns scans for the table header row and maps canonical field
// names to column indices in splitTrackerRow field space. It returns nil unless
// the essential columns are all present, so a stray pipe line cannot yield a
// bogus mapping. Mirrors
// detectColumns in tracker-parse.mjs (#954).
func detectTrackerColumns(lines []string) map[string]int {
	for _, line := range lines {
		if !strings.HasPrefix(strings.TrimSpace(line), "|") {
			continue
		}
		cells := splitTrackerRow(line)
		m := make(map[string]int)
		for i, c := range cells {
			if name, ok := trackerHeaderAliases[strings.ToLower(c)]; ok {
				// Unconditional assign: with a duplicated header name the LAST
				// occurrence wins, matching detectColumns in tracker-parse.mjs
				// (which this function mirrors) — first-wins here made the two
				// runtimes map the same header row differently.
				m[name] = i
			}
		}
		complete := true
		for _, k := range []string{"num", "company", "role", "score", "status"} {
			if _, ok := m[k]; !ok {
				complete = false
				break
			}
		}
		if complete {
			return m
		}
	}
	return nil
}
