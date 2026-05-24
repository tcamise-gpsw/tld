package assets

import "embed"

//go:embed frontend/dist migrations/*.up.sql migrations/postgres/*.up.sql
var FS embed.FS
