package data

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// Node and web load this JSON directly; Go's compiled mirror must cover the
// entire table, including older aliases, rather than just this PR's additions.
func TestTrackerHeaderAliasesMatchSharedJSON(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("..", "..", "..", "tracker-aliases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var aliases map[string]string
	if err := json.Unmarshal(content, &aliases); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(trackerHeaderAliases, aliases) {
		t.Errorf("Go tracker aliases differ from tracker-aliases.json: got %v, want %v", trackerHeaderAliases, aliases)
	}
}

func TestUnsupportedTrackerHeaders(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER", "")
	for _, header := range []string{
		"| # | Fecha | Empresa | Puesto | Score | Status | PDF | Report |",
		"| # | Datum | Firma | Rolle | Score | Status | PDF | Report |",
		"",
	} {
		dir, _ := writeTracker(t, header+"\n| 1 | 2026-01-01 | Acme | Engineer | 4/5 | Applied | — | — |\n")
		if cols := detectTrackerColumns([]string{header}); cols != nil {
			t.Fatalf("unsupported header accepted: %v", cols)
		}
		if apps := ParseApplications(dir); len(apps) != 0 {
			t.Fatalf("unsupported tracker parsed: %v", apps)
		}
	}
}

func TestTrackerSeparatorRows(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER", "")
	for _, cell := range []string{"---", " --- ", " :--- ", " ---: ", " :---: "} {
		for _, ending := range []string{"with terminal pipe", "without terminal pipe"} {
			t.Run(cell+"/"+ending, func(t *testing.T) {
				lines := strings.Split(strings.Replace(insertedColumnTracker, "hot lead", "hot --- lead", 1), "\n")
				for i, line := range lines {
					if strings.HasPrefix(line, "|---") {
						lines[i] = "|" + strings.Repeat(cell+"|", len(splitTrackerRow(line)))
						if ending == "without terminal pipe" {
							lines[i] = strings.TrimSuffix(lines[i], "|")
						}
					}
				}
				dir, _ := writeTracker(t, strings.Join(lines, "\n"))
				apps := ParseApplications(dir)
				if len(apps) != 1 || apps[0].Company != "Acme" || apps[0].Notes != "hot --- lead" {
					t.Fatalf("separator must be skipped while data containing --- survives: %+v", apps)
				}
			})
		}
	}
}
