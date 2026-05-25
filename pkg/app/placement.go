package app

import "context"

type placementJoinRow struct {
	ID                   int64   `bun:"id"`
	ViewID               int64   `bun:"view_id"`
	ElementID            int64   `bun:"element_id"`
	PositionX            float64 `bun:"position_x"`
	PositionY            float64 `bun:"position_y"`
	Name                 string  `bun:"name"`
	Kind                 *string `bun:"kind"`
	Description          *string `bun:"description"`
	Technology           *string `bun:"technology"`
	URL                  *string `bun:"url"`
	LogoURL              *string `bun:"logo_url"`
	TechnologyConnectors string  `bun:"technology_connectors"`
	Tags                 string  `bun:"tags"`
	Repo                 *string `bun:"repo"`
	Branch               *string `bun:"branch"`
	FilePath             *string `bun:"file_path"`
	Language             *string `bun:"language"`
}

func (s *Store) Placements(ctx context.Context, viewID int64) ([]PlacedElement, error) {
	var scanned []placementJoinRow
	if err := s.bun.NewSelect().
		TableExpr("placements AS p").
		ColumnExpr("p.id, p.view_id, p.element_id, p.position_x, p.position_y").
		ColumnExpr("e.name, e.kind, e.description, e.technology, e.url, e.logo_url, e.technology_connectors, e.tags, e.repo, e.branch, e.file_path, e.language").
		Join("JOIN elements AS e ON e.id = p.element_id").
		Where("p.view_id = ?", viewID).
		Order("p.id").
		Scan(ctx, &scanned); err != nil {
		return nil, err
	}
	viewMeta, err := s.childViewMetaMap(ctx)
	if err != nil {
		return nil, err
	}

	out := make([]PlacedElement, 0, len(scanned))
	for _, row := range scanned {
		item := placedElementFromPlacementRow(row)
		if meta, ok := viewMeta[item.ElementID]; ok {
			item.HasView = meta.hasView
			item.ViewLabel = meta.label
		}
		out = append(out, item)
	}
	return out, nil
}

func (s *Store) AllPlacements(ctx context.Context) ([]PlacedElement, error) {
	var scanned []placementJoinRow
	if err := s.bun.NewSelect().
		TableExpr("placements AS p").
		ColumnExpr("p.id, p.view_id, p.element_id, p.position_x, p.position_y").
		ColumnExpr("e.name, e.kind, e.description, e.technology, e.url, e.logo_url, e.technology_connectors, e.tags, e.repo, e.branch, e.file_path, e.language").
		Join("JOIN elements AS e ON e.id = p.element_id").
		Order("p.view_id").
		Order("p.id").
		Scan(ctx, &scanned); err != nil {
		return nil, err
	}
	viewMeta, err := s.childViewMetaMap(ctx)
	if err != nil {
		return nil, err
	}

	out := make([]PlacedElement, 0, len(scanned))
	for _, row := range scanned {
		item := placedElementFromPlacementRow(row)
		if meta, ok := viewMeta[item.ElementID]; ok {
			item.HasView = meta.hasView
			item.ViewLabel = meta.label
		}
		out = append(out, item)
	}
	return out, nil
}

func (s *Store) ElementPlacements(ctx context.Context, viewID int64) ([]ElementPlacement, error) {
	var rows []elementPlacementModel
	if err := s.bun.NewSelect().
		Model(&rows).
		Where("view_id = ?", viewID).
		Order("id").
		Scan(ctx); err != nil {
		return nil, err
	}
	out := make([]ElementPlacement, 0, len(rows))
	for _, row := range rows {
		out = append(out, elementPlacementFromModel(row))
	}
	return out, nil
}

func (s *Store) AddPlacement(ctx context.Context, viewID, elementID int64, x, y float64) (ElementPlacement, error) {
	now := nowString()
	row := &elementPlacementModel{
		ViewID:    viewID,
		ElementID: elementID,
		PositionX: x,
		PositionY: y,
		CreatedAt: now,
		UpdatedAt: now,
	}
	_, err := s.bun.NewInsert().
		Model(row).
		On("CONFLICT(view_id, element_id) DO UPDATE").
		Set("position_x = excluded.position_x").
		Set("position_y = excluded.position_y").
		Set("updated_at = excluded.updated_at").
		Exec(ctx)
	if err != nil {
		return ElementPlacement{}, err
	}
	var got elementPlacementModel
	if err := s.bun.NewSelect().
		Model(&got).
		Where("view_id = ?", viewID).
		Where("element_id = ?", elementID).
		Scan(ctx); err != nil {
		return ElementPlacement{}, err
	}
	return elementPlacementFromModel(got), nil
}

func (s *Store) UpdatePlacement(ctx context.Context, viewID, elementID int64, x, y float64) error {
	_, err := s.bun.NewUpdate().
		Model((*elementPlacementModel)(nil)).
		Set("position_x = ?", x).
		Set("position_y = ?", y).
		Set("updated_at = ?", nowString()).
		Where("view_id = ?", viewID).
		Where("element_id = ?", elementID).
		Exec(ctx)
	return err
}

func (s *Store) DeletePlacement(ctx context.Context, viewID, elementID int64) error {
	_, err := s.bun.NewDelete().
		Model((*elementPlacementModel)(nil)).
		Where("view_id = ?", viewID).
		Where("element_id = ?", elementID).
		Exec(ctx)
	return err
}

func placedElementFromPlacementRow(row placementJoinRow) PlacedElement {
	return PlacedElement{
		ID:                   row.ID,
		ViewID:               row.ViewID,
		ElementID:            row.ElementID,
		PositionX:            row.PositionX,
		PositionY:            row.PositionY,
		Name:                 row.Name,
		Kind:                 row.Kind,
		Description:          row.Description,
		Technology:           row.Technology,
		URL:                  row.URL,
		LogoURL:              row.LogoURL,
		TechnologyConnectors: parseTechnologyConnectors(row.TechnologyConnectors),
		Tags:                 parseStrings(row.Tags),
		Repo:                 row.Repo,
		Branch:               row.Branch,
		FilePath:             row.FilePath,
		Language:             row.Language,
	}
}
