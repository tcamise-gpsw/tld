package store

import "github.com/uptrace/bun"

type workspaceVersionModel struct {
	bun.BaseModel `bun:"table:workspace_versions"`

	ID              int64   `bun:"id,pk,autoincrement"`
	VersionID       string  `bun:"version_id"`
	Source          string  `bun:"source"`
	ParentVersionID *int64  `bun:"parent_version_id"`
	ViewCount       int64   `bun:"view_count"`
	ElementCount    int64   `bun:"element_count"`
	ConnectorCount  int64   `bun:"connector_count"`
	Description     *string `bun:"description"`
	WorkspaceHash   *string `bun:"workspace_hash"`
	CreatedAt       string  `bun:"created_at"`
}

type workspaceVersionSettingsModel struct {
	bun.BaseModel `bun:"table:workspace_version_settings"`

	ID                   int64 `bun:"id,pk"`
	CLIVersioningEnabled int   `bun:"cli_versioning_enabled"`
}

type placementLayoutModel struct {
	bun.BaseModel `bun:"table:placements"`

	ID        int64   `bun:"id,pk,autoincrement"`
	ViewID    int64   `bun:"view_id"`
	ElementID int64   `bun:"element_id"`
	PositionX float64 `bun:"position_x"`
	PositionY float64 `bun:"position_y"`
}

type connectorLayoutModel struct {
	bun.BaseModel `bun:"table:connectors"`

	ID              int64 `bun:"id,pk,autoincrement"`
	ViewID          int64 `bun:"view_id"`
	SourceElementID int64 `bun:"source_element_id"`
	TargetElementID int64 `bun:"target_element_id"`
}

type countModel struct {
	bun.BaseModel `bun:"table:views"`

	ID int64 `bun:"id,pk,autoincrement"`
}

type elementCountModel struct {
	bun.BaseModel `bun:"table:elements"`

	ID int64 `bun:"id,pk,autoincrement"`
}

type connectorCountModel struct {
	bun.BaseModel `bun:"table:connectors"`

	ID int64 `bun:"id,pk,autoincrement"`
}

type visibilityOverrideModel struct {
	bun.BaseModel `bun:"table:view_visibility_overrides"`

	ViewID       int64  `bun:"view_id,pk"`
	ResourceType string `bun:"resource_type,pk"`
	ResourceID   int64  `bun:"resource_id,pk"`
	LevelDelta   int    `bun:"level_delta"`
	CreatedAt    string `bun:"created_at"`
	UpdatedAt    string `bun:"updated_at"`
}

func visibilityOverrideFromModel(row visibilityOverrideModel) VisibilityOverride {
	return VisibilityOverride{
		ViewID:       row.ViewID,
		ResourceType: row.ResourceType,
		ResourceID:   row.ResourceID,
		LevelDelta:   row.LevelDelta,
		CreatedAt:    row.CreatedAt,
		UpdatedAt:    row.UpdatedAt,
	}
}
