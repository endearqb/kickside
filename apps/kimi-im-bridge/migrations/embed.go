package migrations

import (
	"embed"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

//go:embed *.sql
var sqlFiles embed.FS

type Migration struct {
	Version int
	Name    string
	SQL     string
}

func InitialSchema() string {
	raw, _ := sqlFiles.ReadFile("0001_init.sql")
	return string(raw)
}

func Ordered() ([]Migration, error) {
	entries, err := sqlFiles.ReadDir(".")
	if err != nil {
		return nil, fmt.Errorf("failed to enumerate migrations: %w", err)
	}

	migrations := make([]Migration, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		version, err := parseVersion(entry.Name())
		if err != nil {
			return nil, err
		}
		sql, err := sqlFiles.ReadFile(entry.Name())
		if err != nil {
			return nil, fmt.Errorf("failed to read migration %s: %w", entry.Name(), err)
		}
		migrations = append(migrations, Migration{
			Version: version,
			Name:    entry.Name(),
			SQL:     string(sql),
		})
	}

	sort.Slice(migrations, func(i, j int) bool {
		return migrations[i].Version < migrations[j].Version
	})
	return migrations, nil
}

func parseVersion(name string) (int, error) {
	prefix, _, ok := strings.Cut(name, "_")
	if !ok {
		return 0, fmt.Errorf("migration file %s must start with <version>_", name)
	}
	version, err := strconv.Atoi(prefix)
	if err != nil {
		return 0, fmt.Errorf("migration file %s has invalid version prefix: %w", name, err)
	}
	return version, nil
}
