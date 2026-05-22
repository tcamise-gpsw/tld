package store

import "github.com/uptrace/bun"

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
