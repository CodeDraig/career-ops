package i18n

import (
	"testing"
	"time"
)

func TestStatusLabel(t *testing.T) {
	tests := []struct {
		norm string
		en   string
	}{
		{"interview", "Interview"},
		{"offer", "Offer"},
		{"hired", "Hired"},
		{"responded", "Responded"},
		{"assessment", "Assessment"},
		{"applied", "Applied"},
		{"evaluated", "Evaluated"},
		{"skip", "SKIP"},
		{"rejected", "Rejected"},
		{"discarded", "Discarded"},
		{"unknown", "unknown"},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.norm, func(t *testing.T) {
			t.Parallel()
			if got := En.StatusLabel(tt.norm); got != tt.en {
				t.Fatalf("En.StatusLabel(%q) = %q, expected %q", tt.norm, got, tt.en)
			}
		})
	}
}

func TestFormatTimeAgo(t *testing.T) {
	// Mock time to ensure deterministic tests
	mockNow := time.Date(2023, 10, 27, 12, 0, 0, 0, time.Local)
	originalNowFunc := NowFunc
	NowFunc = func() time.Time { return mockNow }
	defer func() { NowFunc = originalNowFunc }()

	today := mockNow.Format("2006-01-02")
	yesterday := mockNow.AddDate(0, 0, -1).Format("2006-01-02")
	threeDaysAgo := mockNow.AddDate(0, 0, -3).Format("2006-01-02")
	tomorrow := mockNow.AddDate(0, 0, 1).Format("2006-01-02")

	// English tests
	if got := En.FormatTimeAgo(today); got != "today" {
		t.Errorf("En.FormatTimeAgo(today) = %q; want \"today\"", got)
	}
	if got := En.FormatTimeAgo(yesterday); got != "yesterday" {
		t.Errorf("En.FormatTimeAgo(yesterday) = %q; want \"yesterday\"", got)
	}
	if got := En.FormatTimeAgo(threeDaysAgo); got != "3d ago" {
		t.Errorf("En.FormatTimeAgo(3d ago) = %q; want \"3d ago\"", got)
	}
	if got := En.FormatTimeAgo(tomorrow); got != "today" {
		t.Errorf("En.FormatTimeAgo(tomorrow) = %q; want \"today\"", got)
	}
	if got := En.FormatTimeAgo("not-a-date"); got != "not-a-date" {
		t.Errorf("En.FormatTimeAgo(invalid) = %q; want \"not-a-date\"", got)
	}

}

func TestSortModeLabel(t *testing.T) {
	type sortTestCase struct {
		name string
		mode string
		want string
	}

	enCases := []sortTestCase{
		{name: "score", mode: "score", want: "score"},
		{name: "date", mode: "date", want: "date"},
		{name: "company", mode: "company", want: "company"},
		{name: "status", mode: "status", want: "status"},
		{name: "location", mode: "location", want: "location"},
		{name: "pay", mode: "pay", want: "pay"},
		{name: "last", mode: "last", want: "last"},
		{name: "unknown", mode: "unknown", want: "unknown"},
	}

	for _, tc := range enCases {
		t.Run("En/"+tc.name, func(t *testing.T) {
			if got := En.SortModeLabel(tc.mode); got != tc.want {
				t.Errorf("En.SortModeLabel(%q) = %q; want %q", tc.mode, got, tc.want)
			}
		})
	}

}

func TestEnglishIgnoresEnvironment(t *testing.T) {
	for _, lang := range []string{"tr_TR.UTF-8", "es_ES.UTF-8", "ja_JP.UTF-8"} {
		t.Setenv("LANG", lang)
		if Current != &En || Current.StatusLabel("interview") != "Interview" {
			t.Fatalf("LANG=%s changed English output", lang)
		}
	}
}

func TestViewModeLabel(t *testing.T) {
	type viewTestCase struct {
		name string
		mode string
		want string
	}

	enCases := []viewTestCase{
		{name: "grouped", mode: "grouped", want: "grouped"},
		{name: "flat", mode: "flat", want: "flat"},
		{name: "unknown", mode: "unknown", want: "unknown"},
	}

	for _, tc := range enCases {
		t.Run("En/"+tc.name, func(t *testing.T) {
			if got := En.ViewModeLabel(tc.mode); got != tc.want {
				t.Errorf("En.ViewModeLabel(%q) = %q; want %q", tc.mode, got, tc.want)
			}
		})
	}

}
