package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/mertcikla/tld/v2/internal/app"
	"github.com/uptrace/bun"
)

const (
	MinDensityLevel  = -2
	MaxDensityLevel  = 2
	MinOverrideDelta = -4
	MaxOverrideDelta = 4
)

type VisibilityOverride struct {
	ViewID       int64  `json:"view_id"`
	ResourceType string `json:"resource_type"`
	ResourceID   int64  `json:"resource_id"`
	LevelDelta   int    `json:"level_delta"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
}

type ProjectedViewContent struct {
	Placements []app.PlacedElement `json:"placements"`
	Connectors []app.Connector     `json:"connectors"`
}

type densitySignalKey struct {
	resourceType string
	resourceID   int64
}

type densitySignals struct {
	filterScore            map[densitySignalKey]float64
	filterTier             map[densitySignalKey]int
	architectureConfidence map[densitySignalKey]float64
}

func ValidateDensityLevel(level int) error {
	if level < MinDensityLevel || level > MaxDensityLevel {
		return fmt.Errorf("density_level must be between %d and %d", MinDensityLevel, MaxDensityLevel)
	}
	return nil
}

func ValidateResourceType(resourceType string) error {
	if resourceType != "element" && resourceType != "connector" {
		return errors.New("resource_type must be element or connector")
	}
	return nil
}

func clampOverrideDelta(delta int) int {
	return min(MaxOverrideDelta, max(MinOverrideDelta, delta))
}

func (s *SQLiteStore) ViewDensityLevel(ctx context.Context, viewID int64) (int, error) {
	var row struct {
		DensityLevel int `bun:"density_level"`
	}
	err := s.legacy.BunDB().NewSelect().
		Table("views").
		Column("density_level").
		Where("id = ?", viewID).
		Scan(ctx, &row)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	return row.DensityLevel, err
}

func (s *SQLiteStore) SetViewDensityLevel(ctx context.Context, viewID int64, level int) error {
	if err := ValidateDensityLevel(level); err != nil {
		return err
	}
	res, err := s.legacy.BunDB().NewUpdate().
		Table("views").
		Set("density_level = ?", level).
		Set("updated_at = ?", nowString()).
		Where("id = ?", viewID).
		Exec(ctx)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *SQLiteStore) VisibilityOverrides(ctx context.Context, viewID int64) ([]VisibilityOverride, error) {
	var rows []visibilityOverrideModel
	if err := s.legacy.BunDB().NewSelect().
		Model(&rows).
		Where("view_id = ?", viewID).
		Order("resource_type").
		Order("resource_id").
		Scan(ctx); err != nil {
		return nil, err
	}
	out := make([]VisibilityOverride, 0, len(rows))
	for _, row := range rows {
		out = append(out, visibilityOverrideFromModel(row))
	}
	return out, nil
}

func (s *SQLiteStore) SetVisibilityOverride(ctx context.Context, viewID int64, resourceType string, resourceID int64, delta int) (VisibilityOverride, error) {
	if err := ValidateResourceType(resourceType); err != nil {
		return VisibilityOverride{}, err
	}
	delta = clampOverrideDelta(delta)
	if delta == 0 {
		if err := s.DeleteVisibilityOverride(ctx, viewID, resourceType, resourceID); err != nil {
			return VisibilityOverride{}, err
		}
		return VisibilityOverride{ViewID: viewID, ResourceType: resourceType, ResourceID: resourceID, LevelDelta: 0}, nil
	}
	now := nowString()
	row := &visibilityOverrideModel{ViewID: viewID, ResourceType: resourceType, ResourceID: resourceID, LevelDelta: delta, CreatedAt: now, UpdatedAt: now}
	_, err := s.legacy.BunDB().NewInsert().
		Model(row).
		On("CONFLICT(view_id, resource_type, resource_id) DO UPDATE").
		Set("level_delta = excluded.level_delta").
		Set("updated_at = excluded.updated_at").
		Exec(ctx)
	if err != nil {
		return VisibilityOverride{}, err
	}
	return s.visibilityOverride(ctx, viewID, resourceType, resourceID)
}

func (s *SQLiteStore) AdjustVisibilityOverride(ctx context.Context, viewID int64, resourceType string, resourceID int64, step int) (VisibilityOverride, error) {
	if err := ValidateResourceType(resourceType); err != nil {
		return VisibilityOverride{}, err
	}
	var row visibilityOverrideModel
	err := s.legacy.BunDB().NewSelect().
		Model(&row).
		Column("level_delta").
		Where("view_id = ?", viewID).
		Where("resource_type = ?", resourceType).
		Where("resource_id = ?", resourceID).
		Scan(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return VisibilityOverride{}, err
	}
	return s.SetVisibilityOverride(ctx, viewID, resourceType, resourceID, row.LevelDelta+step)
}

func (s *SQLiteStore) DeleteVisibilityOverride(ctx context.Context, viewID int64, resourceType string, resourceID int64) error {
	if err := ValidateResourceType(resourceType); err != nil {
		return err
	}
	_, err := s.legacy.BunDB().NewDelete().
		Model((*visibilityOverrideModel)(nil)).
		Where("view_id = ?", viewID).
		Where("resource_type = ?", resourceType).
		Where("resource_id = ?", resourceID).
		Exec(ctx)
	return err
}

func (s *SQLiteStore) DeleteResourceVisibilityOverrides(ctx context.Context, resourceType string, resourceID int64) error {
	if err := ValidateResourceType(resourceType); err != nil {
		return err
	}
	_, err := s.legacy.BunDB().NewDelete().
		Model((*visibilityOverrideModel)(nil)).
		Where("resource_type = ?", resourceType).
		Where("resource_id = ?", resourceID).
		Exec(ctx)
	return err
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

func (s *SQLiteStore) visibilityOverride(ctx context.Context, viewID int64, resourceType string, resourceID int64) (VisibilityOverride, error) {
	var row visibilityOverrideModel
	err := s.legacy.BunDB().NewSelect().
		Model(&row).
		Where("view_id = ?", viewID).
		Where("resource_type = ?", resourceType).
		Where("resource_id = ?", resourceID).
		Scan(ctx)
	return visibilityOverrideFromModel(row), err
}

func (s *SQLiteStore) ProjectedViewContent(ctx context.Context, viewID int64, densityOverride *int) (ProjectedViewContent, error) {
	level, err := s.ViewDensityLevel(ctx, viewID)
	if err != nil {
		return ProjectedViewContent{}, err
	}
	if densityOverride != nil {
		if err := ValidateDensityLevel(*densityOverride); err != nil {
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
	caps := capsForDensity(level)
	overrides, err := s.VisibilityOverrides(ctx, viewID)
	if err != nil {
		return ProjectedViewContent{}, err
	}
	signals := emptyDensitySignals()
	if !caps.full {
		signals, err = s.densitySignals(ctx, placements, connectors)
		if err != nil {
			return ProjectedViewContent{}, err
		}
	}
	return projectViewContent(placements, connectors, overrides, level, signals), nil
}

func emptyDensitySignals() densitySignals {
	return densitySignals{
		filterScore:            map[densitySignalKey]float64{},
		filterTier:             map[densitySignalKey]int{},
		architectureConfidence: map[densitySignalKey]float64{},
	}
}

func (s *SQLiteStore) densitySignals(ctx context.Context, placements []app.PlacedElement, connectors []app.Connector) (densitySignals, error) {
	signals := emptyDensitySignals()

	elementIDs := make([]int64, 0, len(placements))
	for _, placement := range placements {
		elementIDs = append(elementIDs, placement.ElementID)
	}
	connectorIDs := make([]int64, 0, len(connectors))
	for _, connector := range connectors {
		connectorIDs = append(connectorIDs, connector.ID)
	}

	if err := s.loadFilterSignals(ctx, signals, "element", elementIDs); err != nil {
		return densitySignals{}, err
	}
	if err := s.loadFilterSignals(ctx, signals, "connector", connectorIDs); err != nil {
		return densitySignals{}, err
	}
	if err := s.loadArchitectureSignals(ctx, signals, "element", elementIDs); err != nil {
		return densitySignals{}, err
	}
	if err := s.loadArchitectureSignals(ctx, signals, "connector", connectorIDs); err != nil {
		return densitySignals{}, err
	}

	return signals, nil
}

func (s *SQLiteStore) loadFilterSignals(ctx context.Context, signals densitySignals, resourceType string, resourceIDs []int64) error {
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
			key := densitySignalKey{resourceType: row.ResourceType, resourceID: row.ResourceID}
			if row.Score != nil {
				signals.filterScore[key] = *row.Score
			}
			if row.Tier != nil {
				signals.filterTier[key] = *row.Tier
			}
		}
		return nil
	})
}

func (s *SQLiteStore) loadArchitectureSignals(ctx context.Context, signals densitySignals, resourceType string, resourceIDs []int64) error {
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
				signals.architectureConfidence[densitySignalKey{resourceType: row.ResourceType, resourceID: row.ResourceID}] = *row.Confidence
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

type densityCaps struct {
	elements   int
	connectors int
	full       bool
}

func capsForDensity(level int) densityCaps {
	switch level {
	case -2:
		return densityCaps{elements: 4, connectors: 8}
	case -1:
		return densityCaps{elements: 8, connectors: 16}
	case 1:
		return densityCaps{elements: 32, connectors: 64}
	case 2:
		return densityCaps{full: true}
	default:
		return densityCaps{elements: 12, connectors: 24}
	}
}

type rankedElement struct {
	item  app.PlacedElement
	score float64
	delta int
}

type rankedConnector struct {
	item  app.Connector
	score float64
	delta int
}

func projectViewContent(placements []app.PlacedElement, connectors []app.Connector, overrides []VisibilityOverride, level int, signals densitySignals) ProjectedViewContent {
	caps := capsForDensity(level)
	elementDeltas := make(map[int64]int)
	connectorDeltas := make(map[int64]int)
	for _, override := range overrides {
		switch override.ResourceType {
		case "element":
			elementDeltas[override.ResourceID] = override.LevelDelta
		case "connector":
			connectorDeltas[override.ResourceID] = override.LevelDelta
		}
	}

	degree := make(map[int64]int)
	for _, connector := range connectors {
		degree[connector.SourceElementID]++
		degree[connector.TargetElementID]++
	}

	rankedElements := make([]rankedElement, 0, len(placements))
	for _, placement := range placements {
		delta := elementDeltas[placement.ElementID]
		rankedElements = append(rankedElements, rankedElement{
			item:  placement,
			score: baseElementScore(placement, degree[placement.ElementID], signals) + float64(delta)*100,
			delta: delta,
		})
	}
	sort.SliceStable(rankedElements, func(i, j int) bool {
		if rankedElements[i].score == rankedElements[j].score {
			return rankedElements[i].item.ID < rankedElements[j].item.ID
		}
		return rankedElements[i].score > rankedElements[j].score
	})

	visibleElements := make(map[int64]struct{})
	elementLimit := caps.elements
	if caps.full {
		elementLimit = len(rankedElements)
	}
	for _, ranked := range rankedElements {
		if ranked.delta <= -4 || (caps.full && ranked.delta < 0) {
			continue
		}
		if !caps.full && len(visibleElements) >= elementLimit && ranked.delta <= 0 {
			continue
		}
		visibleElements[ranked.item.ElementID] = struct{}{}
	}

	rankedConnectors := make([]rankedConnector, 0, len(connectors))
	for _, connector := range connectors {
		delta := connectorDeltas[connector.ID]
		rankedConnectors = append(rankedConnectors, rankedConnector{
			item:  connector,
			score: baseConnectorScore(connector, signals) + float64(delta)*100,
			delta: delta,
		})
	}
	sort.SliceStable(rankedConnectors, func(i, j int) bool {
		if rankedConnectors[i].score == rankedConnectors[j].score {
			return rankedConnectors[i].item.ID < rankedConnectors[j].item.ID
		}
		return rankedConnectors[i].score > rankedConnectors[j].score
	})

	visibleConnectors := make(map[int64]struct{})
	connectorLimit := caps.connectors
	if caps.full {
		connectorLimit = len(rankedConnectors)
	}
	for _, ranked := range rankedConnectors {
		connector := ranked.item
		if ranked.delta <= -4 || (caps.full && ranked.delta < 0) {
			continue
		}
		if ranked.delta > 0 {
			visibleElements[connector.SourceElementID] = struct{}{}
			visibleElements[connector.TargetElementID] = struct{}{}
		}
		_, sourceVisible := visibleElements[connector.SourceElementID]
		_, targetVisible := visibleElements[connector.TargetElementID]
		if !sourceVisible || !targetVisible {
			continue
		}
		if !caps.full && len(visibleConnectors) >= connectorLimit && ranked.delta <= 0 {
			continue
		}
		visibleConnectors[connector.ID] = struct{}{}
	}

	outPlacements := make([]app.PlacedElement, 0, len(visibleElements))
	for _, placement := range placements {
		if _, ok := visibleElements[placement.ElementID]; ok {
			outPlacements = append(outPlacements, placement)
		}
	}
	outConnectors := make([]app.Connector, 0, len(visibleConnectors))
	for _, connector := range connectors {
		if _, ok := visibleConnectors[connector.ID]; ok {
			outConnectors = append(outConnectors, connector)
		}
	}
	return ProjectedViewContent{Placements: outPlacements, Connectors: outConnectors}
}

func baseElementScore(placement app.PlacedElement, degree int, signals densitySignals) float64 {
	score := float64(degree) * 12
	key := densitySignalKey{resourceType: "element", resourceID: placement.ElementID}
	score += signals.filterScore[key] * 30
	if tier, ok := signals.filterTier[key]; ok {
		score += float64(max(0, 10-tier)) * 5
	}
	score += signals.architectureConfidence[key] * 20
	if placement.HasView {
		score += 20
	}
	if placement.Description != nil && *placement.Description != "" {
		score += 4
	}
	if len(placement.Tags) > 0 {
		score += 3
	}
	if placement.FilePath != nil && *placement.FilePath != "" {
		score += 2
	}
	return score - math.Log1p(float64(max(0, placement.ID)))*0.001
}

func baseConnectorScore(connector app.Connector, signals densitySignals) float64 {
	score := 0.0
	key := densitySignalKey{resourceType: "connector", resourceID: connector.ID}
	score += signals.filterScore[key] * 30
	if tier, ok := signals.filterTier[key]; ok {
		score += float64(max(0, 10-tier)) * 5
	}
	score += signals.architectureConfidence[key] * 20
	if connector.Relationship != nil && *connector.Relationship != "" {
		score += 10
	}
	if connector.Label != nil && *connector.Label != "" {
		score += 6
	}
	if connector.Description != nil && *connector.Description != "" {
		score += 3
	}
	return score - math.Log1p(float64(max(0, connector.ID)))*0.001
}

func nowString() string {
	return time.Now().UTC().Format(time.RFC3339)
}
