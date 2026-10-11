package data

import (
	"fmt"
	"sort"
	"time"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

// ComputeMetrics calculates aggregate metrics from applications.
func ComputeMetrics(apps []model.CareerApplication) model.PipelineMetrics {
	m := model.PipelineMetrics{
		Total:    len(apps),
		ByStatus: make(map[string]int),
	}

	var totalScore float64
	var scored int

	for _, app := range apps {
		status := NormalizeStatus(app.Status)
		m.ByStatus[status]++

		if app.Score > 0 {
			totalScore += app.Score
			scored++
			if app.Score > m.TopScore {
				m.TopScore = app.Score
			}
		}
		if app.HasPDF {
			m.WithPDF++
		}
		if status != "skip" && status != "rejected" && status != "discarded" {
			m.Actionable++
		}
	}

	if scored > 0 {
		m.AvgScore = totalScore / float64(scored)
	}

	return m
}

// StatusPriority returns the sort priority for a status (lower = higher priority).
func StatusPriority(status string) int {
	switch NormalizeStatus(status) {
	case "interview":
		return 0
	case "offer":
		return 1
	case "assessment":
		return 2
	case "responded":
		return 3
	case "applied":
		return 4
	case "evaluated":
		return 5
	case "skip":
		return 6
	case "rejected":
		return 7
	case "discarded":
		return 8
	default:
		return 9
	}
}

// ComputeProgressMetrics computes progress-oriented analytics from applications.
func ComputeProgressMetrics(apps []model.CareerApplication, history ...map[int]int) model.ProgressMetrics {
	pm := model.ProgressMetrics{}

	// Count by normalized status
	statusCounts := make(map[string]int)
	var totalScore float64
	var scored int

	for _, app := range apps {
		norm := NormalizeStatus(app.Status)
		statusCounts[norm]++

		if app.Score > 0 {
			totalScore += app.Score
			scored++
			if app.Score > pm.TopScore {
				pm.TopScore = app.Score
			}
		}

		if norm != "skip" && norm != "rejected" && norm != "discarded" {
			pm.ActiveApps++
		}
	}

	if scored > 0 {
		pm.AvgScore = totalScore / float64(scored)
	}

	// Funnel: each stage counts all apps that reached at least that stage.
	// An app in "interview" has passed through evaluated -> applied -> responded -> assessment -> interview.
	// "hired" is terminal success and proves every earlier stage (a landed job
	// proves the offer, the interviews, the response, and the submission), so it
	// counts into all four existing funnel tiers — matching computeFunnel() in stats.mjs, the
	// canonical funnel definition, whose docstring already describes this exact
	// math as mirroring this function.
	total := len(apps)
	applied := statusCounts["applied"] + statusCounts["responded"] + statusCounts["assessment"] + statusCounts["interview"] + statusCounts["offer"] + statusCounts["hired"] + statusCounts["rejected"]
	responded := statusCounts["responded"] + statusCounts["assessment"] + statusCounts["interview"] + statusCounts["offer"] + statusCounts["hired"] + statusCounts["rejected"]
	assessment := statusCounts["assessment"] + statusCounts["interview"] + statusCounts["offer"] + statusCounts["hired"]
	interview := statusCounts["interview"] + statusCounts["offer"] + statusCounts["hired"]
	offer := statusCounts["offer"] + statusCounts["hired"]
	if len(history) > 0 {
		applied, responded, assessment, interview, offer = 0, 0, 0, 0, 0
		ranks := make(map[int]int)
		var unnumberedRanks []int
		for _, app := range apps {
			if NormalizeStatus(app.Status) == "skip" {
				continue
			}
			rank := funnelRank(app.Status)
			if app.TrackerNumberMissing {
				unnumberedRanks = append(unnumberedRanks, rank)
				continue
			}
			if history[0][app.Number] > rank {
				rank = history[0][app.Number]
			}
			if rank > ranks[app.Number] {
				ranks[app.Number] = rank
			}
		}
		for _, rank := range ranks {
			unnumberedRanks = append(unnumberedRanks, rank)
		}
		for _, rank := range unnumberedRanks {
			if rank >= 1 {
				applied++
			}
			if rank >= 2 {
				responded++
			}
			if rank >= 3 {
				assessment++
			}
			if rank >= 4 {
				interview++
			}
			if rank >= 5 {
				offer++
			}
		}
	}

	// The Progress headline and funnel must report the same historical offers.
	pm.TotalOffers = offer

	// Top stage counts every tracked row, including rows backfilled without a
	// score (#1799) — hence "Tracked", not "Evaluated", which already means both
	// a status value and the Stats screen's scored count.
	pm.FunnelStages = []model.FunnelStage{
		{Label: "Tracked", Count: total, Pct: 100.0},
		{Label: "Applied", Count: applied, Pct: safePct(applied, total)},
		{Label: "Responded", Count: responded, Pct: safePct(responded, applied)},
		{Label: "Assessment", Count: assessment, Pct: safePct(assessment, applied)},
		{Label: "Interview", Count: interview, Pct: safePct(interview, applied)},
		{Label: "Offer", Count: offer, Pct: safePct(offer, applied)},
	}

	// Rates (relative to applied). The denominator travels with them so the
	// renderer can tell an absent rate from a measured 0% — see
	// model.ProgressMetrics.RatesDenominator.
	pm.RatesDenominator = applied
	if applied > 0 {
		pm.ResponseRate = float64(responded) / float64(applied) * 100
		pm.InterviewRate = float64(interview) / float64(applied) * 100
		pm.OfferRate = float64(offer) / float64(applied) * 100
	}

	// Score distribution
	buckets := [5]int{} // 0: 4.5-5.0, 1: 4.0-4.4, 2: 3.5-3.9, 3: 3.0-3.4, 4: <3.0
	for _, app := range apps {
		if app.Score <= 0 {
			continue
		}
		switch {
		case app.Score >= 4.5:
			buckets[0]++
		case app.Score >= 4.0:
			buckets[1]++
		case app.Score >= 3.5:
			buckets[2]++
		case app.Score >= 3.0:
			buckets[3]++
		default:
			buckets[4]++
		}
	}
	pm.ScoreBuckets = []model.ScoreBucket{
		{Label: "4.5-5.0", Count: buckets[0]},
		{Label: "4.0-4.4", Count: buckets[1]},
		{Label: "3.5-3.9", Count: buckets[2]},
		{Label: "3.0-3.4", Count: buckets[3]},
		{Label: "  <3.0", Count: buckets[4]},
	}

	// Weekly activity: group by ISO week from Date field, show last 8 weeks.
	weekCounts := make(map[string]int)
	for _, app := range apps {
		if app.Date == "" {
			continue
		}
		t, err := time.Parse("2006-01-02", app.Date)
		if err != nil {
			continue
		}
		year, week := t.ISOWeek()
		key := fmt.Sprintf("%d-W%02d", year, week)
		weekCounts[key]++
	}

	// Sort weeks and take last 8
	var weeks []string
	for w := range weekCounts {
		weeks = append(weeks, w)
	}
	sort.Strings(weeks)
	if len(weeks) > 8 {
		weeks = weeks[len(weeks)-8:]
	}

	for _, w := range weeks {
		pm.WeeklyActivity = append(pm.WeeklyActivity, model.WeekActivity{
			Week:  w,
			Count: weekCounts[w],
		})
	}

	return pm
}

// safePct returns the percentage of part/whole, or 0 if whole is 0.
func safePct(part, whole int) float64 {
	if whole == 0 {
		return 0
	}
	return float64(part) / float64(whole) * 100
}
