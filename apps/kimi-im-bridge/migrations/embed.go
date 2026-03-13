package migrations

import _ "embed"

//go:embed 0001_init.sql
var initialSchema string

func InitialSchema() string {
	return initialSchema
}
