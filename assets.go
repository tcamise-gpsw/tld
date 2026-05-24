package assets

import "embed"

//go:embed frontend/dist migrations/*.sql migrations/postgres/*.sql
var FS embed.FS
