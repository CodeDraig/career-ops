package data

import (
	"regexp"
	"strings"
	"unicode"
)

var reMarkdownDestEscape = regexp.MustCompile(`\\([\\()<> ])`)

// extractCellURL returns the posting URL a tracker URL cell points at, in
// either written form: the href of the first http(s) markdown link, or the cell
// verbatim when it holds none (a bare URL on an older tracker, or a "—"/"N/A"
// placeholder the callers already treat as absent).
//
// This is a PORT of extractCellUrl / parseMarkdownLinks / markdownLinkDestination
// in tracker-parse.mjs, not an approximation of it. It used to be two regexes,
// and they disagreed with Node at the edges: a hand-edited cell holding two
// adjacent links read as one malformed URL spanning both. The JobURL tier and
// merge-tracker's dedup key must agree on a row's URL, so the boundary rules —
// first link wins, balanced parentheses kept, `[`/`]` allowed in the
// destination, the same escapes undone — are the same code, not a lookalike.
//
// This reader is tier 0 of the JobURL enrichment chain since #3452, and a
// markdown-wrapped cell it could not read would not error — it would look like
// a row with no URL and silently fall through to the report/scan-history tiers,
// which resolve a DIFFERENT posting often enough to matter.
func extractCellURL(cellValue string) string {
	value := strings.TrimSpace(cellValue)
	if value == "" {
		return ""
	}
	for _, link := range parseMarkdownLinks(value) {
		target := strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(link.target), "<"), ">")
		lower := strings.ToLower(target)
		if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
			return target
		}
	}
	return value
}

type markdownLink struct {
	label  string
	target string
}

// parseMarkdownLinks returns every markdown link in value, in order. Mirrors
// parseMarkdownLinks in tracker-parse.mjs: the label ends at the first
// unescaped `]`, it must be followed directly by `(`, and the destination runs
// to the `)` that balances it, so `(remote)` inside a href survives whole.
// Works on runes; every delimiter involved is ASCII.
func parseMarkdownLinks(value string) []markdownLink {
	r := []rune(value)
	var links []markdownLink
	cursor := 0
	for cursor < len(r) {
		labelStart := -1
		for i := cursor; i < len(r); i++ {
			if r[i] == '[' {
				labelStart = i
				break
			}
		}
		if labelStart == -1 {
			break
		}
		labelEnd := -1
		for i := labelStart + 1; i < len(r); i++ {
			if r[i] == '\\' {
				i++
			} else if r[i] == ']' {
				labelEnd = i
				break
			}
		}
		if labelEnd == -1 || labelEnd+1 >= len(r) || r[labelEnd+1] != '(' {
			cursor = labelStart + 1
			continue
		}
		depth, linkEnd := 1, -1
		for i := labelEnd + 2; i < len(r); i++ {
			if r[i] == '\\' {
				i++
			} else if r[i] == '(' {
				depth++
			} else if r[i] == ')' {
				depth--
				if depth == 0 {
					linkEnd = i
					break
				}
			}
		}
		if linkEnd == -1 {
			cursor = labelStart + 1
			continue
		}
		if target, ok := markdownLinkDestination(string(r[labelEnd+2 : linkEnd])); ok {
			links = append(links, markdownLink{label: string(r[labelStart+1 : labelEnd]), target: target})
		}
		cursor = linkEnd + 1
	}
	return links
}

// markdownLinkDestination extracts the destination from the text between `](`
// and its balancing `)`: an angle-bracketed `<...>` form, or the run up to the
// first whitespace outside parentheses. Mirrors markdownLinkDestination in
// tracker-parse.mjs, including undoing the same escapes.
func markdownLinkDestination(raw string) (string, bool) {
	r := []rune(strings.TrimLeftFunc(raw, unicode.IsSpace))
	if len(r) > 0 && r[0] == '<' {
		for i := 1; i < len(r); i++ {
			if r[i] == '\\' {
				i++
			} else if r[i] == '>' {
				return reMarkdownDestEscape.ReplaceAllString(string(r[1:i]), "$1"), true
			}
		}
		return "", false
	}
	depth, end := 0, len(r)
	for i := 0; i < len(r); i++ {
		switch {
		case r[i] == '\\':
			i++
		case r[i] == '(':
			depth++
		case r[i] == ')' && depth > 0:
			depth--
		case unicode.IsSpace(r[i]) && depth == 0:
			end = i
		}
		if end != len(r) {
			break
		}
	}
	destination := strings.TrimSpace(string(r[:end]))
	if destination == "" {
		return "", false
	}
	return reMarkdownDestEscape.ReplaceAllString(destination, "$1"), true
}
