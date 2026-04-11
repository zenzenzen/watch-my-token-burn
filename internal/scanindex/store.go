package scanindex

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type Entry struct {
	Version          int             `json:"version"`
	Path             string          `json:"path"`
	Size             int64           `json:"size"`
	ModTimeUnixMilli int64           `json:"mtimeMs"`
	Offset           int64           `json:"offset"`
	LatestTimestamp  string          `json:"latestTimestamp,omitempty"`
	Payload          json.RawMessage `json:"payload,omitempty"`
}

type File struct {
	Version   int               `json:"version"`
	UpdatedAt string            `json:"updatedAt,omitempty"`
	Files     map[string]*Entry `json:"files"`
}

func DefaultConfigDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "."
	}
	return filepath.Join(home, ".config", "token-gauge")
}
