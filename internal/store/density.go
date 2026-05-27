package store

import (
	"context"
	"time"

	"github.com/mertcikla/tld/v2/pkg/app"
	"github.com/uptrace/bun"
)

type VisibilityOverride = app.VisibilityOverride

type ProjectedViewContent = app.ProjectedViewContent

const (
	MinDensityLevel  = app.MinDensityLevel
	MaxDensityLevel  = app.MaxDensityLevel
	MinOverrideDelta = app.MinOverrideDelta
	MaxOverrideDelta = app.MaxOverrideDelta
)

func ValidateDensityLevel(level int) error { return app.ValidateDensityLevel(level) }

func ValidateResourceType(resourceType string) error { return app.ValidateResourceType(resourceType) }

func (s *SQLiteStore) ViewDensityLevel(ctx context.Context, viewID int64) (int, error) {
	return s.legacy.ViewDensityLevel(ctx, viewID)
}

func (s *SQLiteStore) SetViewDensityLevel(ctx context.Context, viewID int64, level int) error {
	return s.legacy.SetViewDensityLevel(ctx, viewID, level)
}

func (s *SQLiteStore) VisibilityOverrides(ctx context.Context, viewID int64) ([]VisibilityOverride, error) {
	return s.legacy.VisibilityOverrides(ctx, viewID)
}

func (s *SQLiteStore) SetVisibilityOverride(ctx context.Context, viewID int64, resourceType string, resourceID int64, delta int) (VisibilityOverride, error) {
	return s.legacy.SetVisibilityOverride(ctx, viewID, resourceType, resourceID, delta)
}

func (s *SQLiteStore) AdjustVisibilityOverride(ctx context.Context, viewID int64, resourceType string, resourceID int64, step int) (VisibilityOverride, error) {
	return s.legacy.AdjustVisibilityOverride(ctx, viewID, resourceType, resourceID, step)
}

func (s *SQLiteStore) DeleteVisibilityOverride(ctx context.Context, viewID int64, resourceType string, resourceID int64) error {
	return s.legacy.DeleteVisibilityOverride(ctx, viewID, resourceType, resourceID)
}

func (s *SQLiteStore) DeleteResourceVisibilityOverrides(ctx context.Context, resourceType string, resourceID int64) error {
	return s.legacy.DeleteResourceVisibilityOverrides(ctx, resourceType, resourceID)
}

func (s *SQLiteStore) ExportDensityState(ctx context.Context) (map[int64]int, []VisibilityOverride, error) {
	levels := map[int64]int{}
	var levelRows []struct {
		ID           int64 `bun:"id"`
		DensityLevel int   `bun:"density_level"`
	}
	if err := s.legacy.BunDB().NewSelect().
		Table("views").
		Column("id", "density_level").
		Order("id").
		Scan(ctx, &levelRows); err != nil {
		return nil, nil, err
	}
	for _, row := range levelRows {
		if row.DensityLevel != 0 {
			levels[row.ID] = row.DensityLevel
		}
	}

	var overrideRows []visibilityOverrideModel
	if err := s.legacy.BunDB().NewSelect().
		Model(&overrideRows).
		Order("view_id").
		Order("resource_type").
		Order("resource_id").
		Scan(ctx); err != nil {
		return nil, nil, err
	}
	overrides := make([]VisibilityOverride, 0, len(overrideRows))
	for _, row := range overrideRows {
		overrides = append(overrides, visibilityOverrideFromModel(row))
	}
	return levels, overrides, nil
}

func (s *SQLiteStore) ProjectedViewContent(ctx context.Context, viewID int64, densityOverride *int) (ProjectedViewContent, error) {
	level, err := s.legacy.ViewDensityLevel(ctx, viewID)
	if err != nil {
		return ProjectedViewContent{}, err
	}
	if densityOverride != nil {
		if err := app.ValidateDensityLevel(*densityOverride); err != nil {
			return ProjectedViewContent{}, err
		}
		level = *densityOverride
	}
	placements, err := s.legacy.Placements(ctx, viewID)
	if err != nil {
		return ProjectedViewContent{}, err
	}
	connectors, err := s.legacy.Connectors(ctx, viewID)
	if err != nil {
		return ProjectedViewContent{}, err
	}
	if len(placements) == 0 {
		return ProjectedViewContent{Placements: placements, Connectors: connectors}, nil
	}
	caps := app.CapsForDensity(level)
	overrides, err := s.legacy.VisibilityOverrides(ctx, viewID)
	if err != nil {
		return ProjectedViewContent{}, err
	}

	signals := app.EmptyDensitySignals()
	if !caps.Full {
		var err error
		signals, err = s.densitySignals(ctx, placements, connectors)
		if err != nil {
			return ProjectedViewContent{}, err
		}
	}
	return app.ProjectViewContent(placements, connectors, overrides, level, signals), nil
}

func (s *SQLiteStore) densitySignals(ctx context.Context, placements []app.PlacedElement, connectors []app.Connector) (app.DensitySignals, error) {
	signals := app.EmptyDensitySignals()

	elementIDs := make([]int64, 0, len(placements))
	for _, placement := range placements {
		elementIDs = append(elementIDs, placement.ElementID)
	}
	connectorIDs := make([]int64, 0, len(connectors))
	for _, connector := range connectors {
		connectorIDs = append(connectorIDs, connector.ID)
	}

	if err := s.loadFilterSignals(ctx, &signals, "element", elementIDs); err != nil {
		return app.DensitySignals{}, err
	}
	if err := s.loadFilterSignals(ctx, &signals, "connector", connectorIDs); err != nil {
		return app.DensitySignals{}, err
	}
	if err := s.loadArchitectureSignals(ctx, &signals, "element", elementIDs); err != nil {
		return app.DensitySignals{}, err
	}
	if err := s.loadArchitectureSignals(ctx, &signals, "connector", connectorIDs); err != nil {
		return app.DensitySignals{}, err
	}

	return signals, nil
}

func (s *SQLiteStore) loadFilterSignals(ctx context.Context, signals *app.DensitySignals, resourceType string, resourceIDs []int64) error {
	return queryIDChunks(resourceIDs, 450, func(ids []int64) error {
		var rows []struct {
			ResourceType string   `bun:"resource_type"`
			ResourceID   int64    `bun:"resource_id"`
			Score        *float64 `bun:"score"`
			Tier         *int     `bun:"tier"`
		}
		if err := s.legacy.BunDB().NewSelect().
			TableExpr("watch_materialization AS wm").
			ColumnExpr("wm.resource_type").
			ColumnExpr("wm.resource_id").
			ColumnExpr("MAX(wfd.score) AS score").
			ColumnExpr("MIN(wfd.tier) AS tier").
			Join("JOIN watch_filter_decisions AS wfd ON wfd.owner_type = wm.owner_type AND wfd.owner_key = wm.owner_key").
			Where("wm.resource_type = ?", resourceType).
			Where("wm.resource_id IN (?)", bun.List(ids)).
			Group("wm.resource_type").
			Group("wm.resource_id").
			Scan(ctx, &rows); err != nil {
			return err
		}
		for _, row := range rows {
			key := app.DensitySignalKey{ResourceType: row.ResourceType, ResourceID: row.ResourceID}
			if row.Score != nil {
				signals.FilterScore[key] = *row.Score
			}
			if row.Tier != nil {
				signals.FilterTier[key] = *row.Tier
			}
		}
		return nil
	})
}

func (s *SQLiteStore) loadArchitectureSignals(ctx context.Context, signals *app.DensitySignals, resourceType string, resourceIDs []int64) error {
	return queryIDChunks(resourceIDs, 450, func(ids []int64) error {
		var rows []struct {
			ResourceType string   `bun:"target_resource_type"`
			ResourceID   int64    `bun:"target_resource_id"`
			Confidence   *float64 `bun:"confidence"`
		}
		if err := s.legacy.BunDB().NewSelect().
			Table("watch_architecture_links").
			Column("target_resource_type", "target_resource_id").
			ColumnExpr("MAX(confidence) AS confidence").
			Where("target_resource_type = ?", resourceType).
			Where("target_resource_id IN (?)", bun.List(ids)).
			Group("target_resource_type").
			Group("target_resource_id").
			Scan(ctx, &rows); err != nil {
			return err
		}
		for _, row := range rows {
			if row.Confidence != nil {
				signals.ArchitectureConfidence[app.DensitySignalKey{ResourceType: row.ResourceType, ResourceID: row.ResourceID}] = *row.Confidence
			}
		}
		return nil
	})
}

func queryIDChunks(ids []int64, size int, fn func([]int64) error) error {
	if len(ids) == 0 {
		return nil
	}
	for start := 0; start < len(ids); start += size {
		end := min(start+size, len(ids))
		if err := fn(ids[start:end]); err != nil {
			return err
		}
	}
	return nil
}

func nowString() string {
	return time.Now().UTC().Format(time.RFC3339)
}
