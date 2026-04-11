package snapshot

type RateLimit struct {
	UsedPercent *float64 `json:"usedPercent,omitempty"`
	ResetsAt    *int64   `json:"resetsAt,omitempty"`
}

type Meta struct {
	SessionCount *int     `json:"sessionCount,omitempty"`
	ActiveCount  *int     `json:"activeCount,omitempty"`
	WeeklyTokens *int64   `json:"weeklyTokens,omitempty"`
	WeeklyCost   *float64 `json:"weeklyCostUsd,omitempty"`
	RecentThread *int     `json:"recentThreads,omitempty"`
	Source       string   `json:"source,omitempty"`
}

type Snapshot struct {
	Version        int        `json:"version"`
	Host           string     `json:"host"`
	Provider       string     `json:"provider"`
	SessionID      string     `json:"sessionId,omitempty"`
	Title          string     `json:"title"`
	SessionLabel   string     `json:"sessionLabel"`
	WorkspaceLabel string     `json:"workspaceLabel"`
	CWD            string     `json:"cwd,omitempty"`
	ModelID        string     `json:"modelId,omitempty"`
	ModelLabel     string     `json:"modelLabel"`
	StatusLabel    string     `json:"statusLabel"`
	TotalTokens    int64      `json:"totalTokens"`
	ContextTokens  int64      `json:"contextTokens"`
	ContextWindow  int64      `json:"contextWindow"`
	LastTokens     int64      `json:"lastTokens,omitempty"`
	CostUSD        *float64   `json:"costUsd"`
	PrimaryLimit   *RateLimit `json:"primaryLimit"`
	SecondaryLimit *RateLimit `json:"secondaryLimit"`
	Meta           *Meta      `json:"meta,omitempty"`
}
